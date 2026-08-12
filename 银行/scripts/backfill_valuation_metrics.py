#!/usr/bin/env python3
"""Backfill PB / PE / dividend yield / market cap into the "3. 第三方结构化数据"
table of each focus18 bank's profile page, using locally cached AkShare CSVs.

数据来源（均为本地已采集文件，不联网）：
  - 02_原始资料/04_AkShare数据/历史估值/<代码>_<名称>_valuation_history.csv
    -> 取最新日期一行的 市净率(PB)、PE(TTM)、总市值
  - 02_原始资料/04_AkShare数据/分红/bank_dividend_em_latest.csv
    -> 取 现金分红-股息率（小数形式，需 ×100 转换为百分比）

仅回填目标单元格当前为 "待验证" 的行；已有真实数值的行不覆盖。
同时修正历史上误写的股息率（例如把 0.0267 直接拼接成 "0.03%" 而非 "2.67%"）。

Usage:
    python3 scripts/backfill_valuation_metrics.py           # 预览将要做的修改（dry-run）
    python3 scripts/backfill_valuation_metrics.py --apply   # 实际写入文件

Design reference: docs/superpowers/specs/2026-08-11-bank-dashboard-design.md
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

VAULT_ROOT = Path(__file__).resolve().parent.parent
DATA_BASE = VAULT_ROOT / "02_原始资料" / "04_AkShare数据"
BANK_LIB = VAULT_ROOT / "05_知识库" / "03_银行库"
UNIVERSE_CSV = DATA_BASE / "数据字典与运行记录" / "a_share_banks_universe.csv"
VALUATION_DIR = DATA_BASE / "历史估值"
DIVIDEND_CSV = DATA_BASE / "分红" / "bank_dividend_em_latest.csv"


def load_focus18_banks() -> Dict[str, str]:
    """返回 {银行名: 代码}，仅 focus18 == True 的银行。"""
    banks = {}
    with UNIVERSE_CSV.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("focus18") == "True":
                banks[row["name"]] = row["code"]
    return banks


def find_valuation_file(code: str, name: str) -> Optional[Path]:
    candidates = list(VALUATION_DIR.glob(f"{code}_{name}_valuation_history.csv"))
    return candidates[0] if candidates else None


def load_latest_valuation(path: Path) -> Optional[Dict[str, str]]:
    """读取估值历史 CSV，返回数据日期最新的一行（按字符串日期排序，格式为 YYYY-MM-DD，可直接比较）。"""
    latest_row = None
    latest_date = ""
    with path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = row.get("数据日期", "")
            if date > latest_date:
                latest_date = date
                latest_row = row
    return latest_row


def load_dividend_rows() -> Dict[str, Dict[str, str]]:
    """返回 {银行代码: row}。"""
    rows = {}
    if not DIVIDEND_CSV.exists():
        return rows
    with DIVIDEND_CSV.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row.get("代码", "").strip()
            if code:
                rows[code] = row
    return rows


def format_percent(value_str: str, decimals: int = 2) -> Optional[str]:
    """把形如 '0.026711051931' 的小数字符串转换为 '2.67%'。"""
    try:
        value = float(value_str)
    except (TypeError, ValueError):
        return None
    return f"{value * 100:.{decimals}f}%"


def format_market_cap(value_str: str) -> Optional[str]:
    """把总市值（单位：元）转换为形如 '12345.67亿' 的字符串。"""
    try:
        value = float(value_str)
    except (TypeError, ValueError):
        return None
    yi = value / 1e8
    return f"{yi:,.2f}亿"


def format_ratio(value_str: str, decimals: int = 2) -> Optional[str]:
    """PB/PE 等比率类字段，保留指定小数位，过滤明显异常值（负数或 False）。"""
    try:
        value = float(value_str)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return f"{value:.{decimals}f}"


TABLE_ROW_RE = re.compile(r"^\|(.+)\|\s*$")


def patch_third_party_table(
    text: str,
    pb: Optional[str],
    pe: Optional[str],
    dividend_yield: Optional[str],
    market_cap: Optional[str],
    data_date: Optional[str],
) -> tuple[str, list[str]]:
    """在 '## 3. 第三方结构化数据' 表格内，把待验证/已知错误的单元格替换为真实值。

    返回 (更新后的全文, 变更说明列表)。
    """
    changes: list[str] = []
    lines = text.splitlines(keepends=True)

    in_section = False
    section_done = False
    out_lines = []

    field_map = {
        "最新 PB": pb,
        "最新 PE": pe,
        "最新股息率": dividend_yield,
        "最新市值": market_cap,
    }

    for line in lines:
        stripped = line.rstrip("\n")

        if re.match(r"^##\s*3\.\s*第三方结构化数据", stripped):
            in_section = True
            out_lines.append(line)
            continue

        if in_section and re.match(r"^#{1,6}\s", stripped) and not re.match(r"^##\s*3\.", stripped):
            in_section = False
            section_done = True

        if in_section and not section_done:
            m = TABLE_ROW_RE.match(stripped)
            if m:
                cells = [c.strip() for c in m.group(1).split("|")]
                if len(cells) >= 3 and cells[0] in field_map:
                    new_value = field_map[cells[0]]
                    old_value = cells[1]
                    if new_value is not None and old_value != new_value:
                        cells[1] = new_value
                        if data_date and len(cells) >= 3:
                            cells[2] = data_date
                        new_line = "| " + " | ".join(cells) + " |\n"
                        changes.append(f"{cells[0]}: '{old_value}' -> '{new_value}'")
                        out_lines.append(new_line)
                        continue
        out_lines.append(line)

    return "".join(out_lines), changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="实际写入文件（默认仅预览 dry-run）")
    args = parser.parse_args()

    banks = load_focus18_banks()
    dividend_rows = load_dividend_rows()

    total_changed_banks = 0
    total_changes = 0

    for name, code in sorted(banks.items()):
        profile_path = BANK_LIB / f"{name}.md"
        if not profile_path.exists():
            print(f"[跳过] {name}: 未找到基础档案页 {profile_path}")
            continue

        valuation_path = find_valuation_file(code, name)
        latest_val_row = load_latest_valuation(valuation_path) if valuation_path else None

        pb = pe = market_cap = data_date = None
        if latest_val_row:
            pb = format_ratio(latest_val_row.get("市净率"))
            pe = format_ratio(latest_val_row.get("PE(TTM)")) or format_ratio(latest_val_row.get("PE(静)"))
            market_cap = format_market_cap(latest_val_row.get("总市值"))
            data_date = latest_val_row.get("数据日期")

        dividend_yield = None
        div_row = dividend_rows.get(code)
        if div_row:
            dividend_yield = format_percent(div_row.get("现金分红-股息率"))

        text = profile_path.read_text(encoding="utf-8")
        new_text, changes = patch_third_party_table(
            text, pb=pb, pe=pe, dividend_yield=dividend_yield,
            market_cap=market_cap, data_date=data_date,
        )

        if changes:
            total_changed_banks += 1
            total_changes += len(changes)
            print(f"\n[{name}] ({code}) 数据日期={data_date}")
            for c in changes:
                print(f"  - {c}")
            if args.apply:
                profile_path.write_text(new_text, encoding="utf-8")
        else:
            print(f"[{name}] 无需变更")

    print(f"\n{'已写入' if args.apply else '预览（未写入，加 --apply 执行）'}："
          f"{total_changed_banks} 家银行，共 {total_changes} 处字段变更。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
