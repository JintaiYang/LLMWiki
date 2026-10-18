#!/usr/bin/env python3
"""解析 iFind MCP 采集的银行专项指标原始文本，输出结构化CSV.

输入: 02_原始资料/05_iFind数据/raw/{code}_A.txt 与 {code}_B.txt
  - A查询: 不良贷款率、拨备覆盖率、核心一级资本充足率（含自动扩展的资本净额等列）
  - B查询: 净息差、关注类贷款比例、活期存款、个人存款、计息负债成本率
  - 原始文本为 iFind 返回的 markdown 表格（|证券代码|...），或包含该表格的原始JSON

输出: 02_原始资料/05_iFind数据/银行专项指标/{code}_{name}_indicators.csv
  列: report_date, npl_ratio, provision_coverage, cet1_ratio, cet1_capital_yi,
      nim, special_mention_ratio, demand_deposits_yi, personal_deposits_yi,
      interest_bearing_liab_cost, source_files

金额解析: "1.375万亿"→1.375e12, "4034.09亿"→4.03409e11, "\t"/空→None
日期解析: "20251231"→"2025-12-31"

用法: python3 scripts/parse_ifind_indicators.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

VAULT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = VAULT_ROOT / "02_原始资料" / "05_iFind数据" / "raw"
OUT_DIR = VAULT_ROOT / "02_原始资料" / "05_iFind数据" / "银行专项指标"
UNIVERSE_CSV = VAULT_ROOT / "02_原始资料" / "04_AkShare数据" / "数据字典与运行记录" / "a_share_banks_universe.csv"

# 输出列定义（含列名匹配规则，按优先级顺序匹配）
# (输出列名, [列名包含关键词列表], 是否金额(需解析万亿/亿))
COLUMN_DEFS = [
    ("npl_ratio", ["不良贷款比例", "不良贷款率"], False),
    ("provision_coverage", ["拨备覆盖率"], False),
    ("cet1_ratio", ["核心一级资本充足率"], False),
    ("tier1_ratio", ["一级资本充足率"], False),  # 注意须在 cet1 之后匹配
    ("car_ratio", ["资本充足率"], False),  # 兜底：不含"核心一级"/"一级"前缀的资本充足率
    ("cet1_capital", ["核心一级资本净额"], True),
    ("nim", ["净息差"], False),
    ("special_mention_ratio", ["关注-占比", "关注类贷款比例", "关注类占比"], False),
    ("demand_deposits", ["活期存款"], True),
    ("personal_deposits", ["个人存款"], True),
    ("interest_bearing_liab_cost", ["计息负债收益率", "计息负债成本率", "计息负债合计-平均成本率"], False),
]

# 排除规则：car_ratio 不能匹配到 核心一级资本充足率 / 一级资本充足率 / 核心资本充足率
CAR_EXCLUDE = ["核心一级资本充足率", "一级资本充足率", "核心资本充足率", "核心一级资本净额", "一级资本净额"]
TIER1_EXCLUDE = ["核心一级资本充足率"]


def parse_amount(raw: str) -> Optional[float]:
    """解析 iFind 金额/数值单元格: '1.375万亿'/'4034.09亿'/纯数字/'\\t'。"""
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").replace("\\t", "").strip()
    if s in ("", "-", "—", "None", "nan", "False"):
        return None
    mult = 1.0
    if s.endswith("万亿"):
        mult, s = 1e12, s[:-2]
    elif s.endswith("亿"):
        mult, s = 1e8, s[:-1]
    elif s.endswith("万"):
        mult, s = 1e4, s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return None


def norm_date(raw: str) -> Optional[str]:
    s = str(raw).strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    m = re.search(r"(\d{4})-?(\d{2})-?(\d{2})", s)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def extract_table_text(text: str) -> Optional[str]:
    """从原始文本中提取 |证券代码| 开头的 markdown 表格。"""
    lines = text.splitlines()
    table_lines = [ln for ln in lines if ln.lstrip().startswith("|") and ("证券代码" in ln or re.match(r"^\|\d{6}\.", ln.strip()))]
    if not table_lines:
        return None
    # 保留表格行及其相邻的分隔行
    keep = []
    for ln in lines:
        s = ln.strip()
        if s.startswith("|") and ("证券代码" in s or re.match(r"^\|-+", s) or re.match(r"^\|\d{6}\.", s) or "单位" in s):
            keep.append(s)
    return "\n".join(keep) if keep else "\n".join(table_lines)


def parse_table(table_text: str) -> List[Dict[str, Any]]:
    """解析 markdown 表格为 [{列名: 单元格}] 列表。"""
    rows: List[List[str]] = []
    header: Optional[List[str]] = None
    for line in table_text.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if all(re.fullmatch(r"-{2,}", c.replace(":", "").replace(" ", "")) or c == "" for c in cells):
            continue  # 分隔行
        if header is None and "证券代码" in s:
            header = cells
            continue
        if header is not None and len(cells) == len(header) and re.match(r"^\d{6}\.", cells[0] or ""):
            rows.append(cells)
    if header is None:
        return []
    out = []
    for r in rows:
        out.append({header[i]: r[i] for i in range(min(len(header), len(r)))})
    return out


def map_columns(row: Dict[str, str]) -> Dict[str, Optional[float]]:
    """把一行中文列名数据映射到标准输出列。"""
    result: Dict[str, Optional[float]] = {}
    for out_col, keywords, _ in COLUMN_DEFS:
        val = None
        for col_name, cell in row.items():
            matched = any(k in col_name for k in keywords)
            if not matched:
                continue
            # car_ratio / tier1_ratio 需排除更具体的资本充足率列
            if out_col == "car_ratio" and any(k in col_name for k in CAR_EXCLUDE):
                continue
            if out_col == "tier1_ratio" and any(k in col_name for k in TIER1_EXCLUDE):
                continue
            v = parse_amount(cell)
            if v is not None:
                val = v
                break
        result[out_col] = val
    return result


def load_raw(path: Path) -> List[Dict[str, Any]]:
    """读取一个原始文件，返回 [{report_date, 标准列...}]。"""
    if not path.exists() or path.stat().st_size == 0:
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    table = extract_table_text(text)
    if table is None:
        # 尝试从 JSON 里挖 answer
        try:
            m = re.search(r'"answer"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
            if m:
                answer = json.loads(f'"{m.group(1)}"')
                table = extract_table_text(answer)
        except Exception:
            pass
    if table is None:
        return []
    parsed = []
    for row in parse_table(table):
        d = row.get("日期") or row.get("报告期")
        nd = norm_date(d) if d else None
        if not nd:
            continue
        entry = {"report_date": nd}
        entry.update(map_columns(row))
        parsed.append(entry)
    return parsed


def merge_bank(code: str) -> Optional[List[Dict[str, Any]]]:
    """合并 A/B 两个查询的数据（按 report_date 合并，非空值优先）。"""
    a_rows = load_raw(RAW_DIR / f"{code}_A.txt")
    b_rows = load_raw(RAW_DIR / f"{code}_B.txt")
    if not a_rows and not b_rows:
        return None
    merged: Dict[str, Dict[str, Any]] = {}
    for rows in (a_rows, b_rows):
        for row in rows:
            rd = row["report_date"]
            if rd not in merged:
                merged[rd] = {"report_date": rd}
            for k, v in row.items():
                if k == "report_date":
                    continue
                if v is not None:
                    merged[rd][k] = v
    return sorted(merged.values(), key=lambda r: r["report_date"])


def main() -> int:
    import pandas as pd

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    universe = pd.read_csv(UNIVERSE_CSV, dtype={"code": str})
    summary = []
    for _, bank in universe.iterrows():
        code, name = bank["code"], bank["name"]
        rows = merge_bank(code)
        if not rows:
            summary.append((code, name, 0, "no_data"))
            continue
        df = pd.DataFrame(rows).sort_values("report_date").reset_index(drop=True)
        out_path = OUT_DIR / f"{code}_{name}_indicators.csv"
        df.to_csv(out_path, index=False, encoding="utf-8-sig")
        summary.append((code, name, len(df), "ok"))
        print(f"[ok] {code} {name}: {len(df)}期 "
              f"({df['report_date'].min()} ~ {df['report_date'].max()}) "
              f"不良率非空 {int(df['npl_ratio'].notna().sum()) if 'npl_ratio' in df else 0}期")
    no_data = [s for s in summary if s[3] != "ok"]
    print(f"\n[done] 解析完成 {len(summary) - len(no_data)}/{len(summary)} 家；无数据: "
          f"{', '.join(f'{s[0]}{s[1]}' for s in no_data) if no_data else '无'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
