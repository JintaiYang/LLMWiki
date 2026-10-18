#!/usr/bin/env python3
"""回填仪表盘 data.json 的监管指标（NIM/不良率/拨备覆盖率/CET1）与估值（PB/PE）.

数据源:
  - 02_原始资料/05_iFind数据/银行专项指标/{code}_{name}_indicators.csv  (iFind 专项指标)
  - dashboard/stock_data/{code}.json  (records 含 pb/pe_ttm 估值序列)

只填充 data.json 中为空或非数字的监管指标（NIM 等字符串注释会被覆盖），报告期取最新年报（12-31）。
打分摘要 score_summary 从 _index.json 同步（前端按 name 匹配）。

用法: python3 scripts/backfill_dashboard_regulatory.py
"""

from __future__ import annotations

import json
import re
import sys
import warnings
from pathlib import Path

import pandas as pd

warnings.filterwarnings("ignore")

VAULT_ROOT = Path(__file__).resolve().parents[1]
IFIND_DIR = VAULT_ROOT / "02_原始资料" / "05_iFind数据" / "银行专项指标"
STOCK_DATA_DIR = VAULT_ROOT / "dashboard" / "stock_data"
DATA_JSON = VAULT_ROOT / "dashboard" / "data.json"

# data.json字段 -> iFind指标列
IFIND_FIELD_MAP = {
    "nim": "nim",
    "npl_ratio": "npl_ratio",
    "provision_coverage": "provision_coverage",
    "cet1": "cet1_ratio",
}


def is_missing_number(value) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, (int, float)):
        return False
    text = str(value).strip().replace(",", "")
    return not bool(re.match(r"^-?\d+(\.\d+)?%?$", text))


def latest_annual(df: pd.DataFrame) -> pd.Series | None:
    annual = df[df["report_date"].astype(str).str.endswith("12-31")]
    annual = annual.dropna(subset=["npl_ratio", "provision_coverage", "cet1_ratio", "nim"], how="all")
    if annual.empty:
        return None
    return annual.iloc[-1]


def main() -> int:
    index = json.loads((STOCK_DATA_DIR / "_index.json").read_text(encoding="utf-8"))
    code_by_name = {b["name"]: b["code"] for b in index.get("banks", [])}
    score_by_name = {b["name"]: b.get("score_summary") for b in index.get("banks", []) if b.get("score_summary")}

    data = json.loads(DATA_JSON.read_text(encoding="utf-8"))
    filled = {}
    for bank in data.get("banks", []):
        name = bank["name"]
        code = code_by_name.get(name)
        # 1) 打分摘要（六维+总分，前端排序用）
        if score_by_name.get(name):
            bank["score_summary"] = score_by_name[name]
        if not code:
            continue
        # 2) iFind 监管指标（最新年报）
        ind_path = IFIND_DIR / f"{code}_{name}_indicators.csv"
        if ind_path.exists():
            try:
                df = pd.read_csv(ind_path)
                row = latest_annual(df)
                if row is not None:
                    for field, col in IFIND_FIELD_MAP.items():
                        if is_missing_number(bank.get(field)):
                            v = row.get(col)
                            if pd.notna(v):
                                bank[field] = round(float(v), 2)
                                filled[field] = filled.get(field, 0) + 1
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] {name} iFind指标读取失败: {exc}")
        # 3) 估值 PB/PE（最新年报期，来自 stock_data records）
        if not bank.get("pb") or not bank.get("pe"):
            sj = STOCK_DATA_DIR / f"{code}.json"
            if sj.exists():
                try:
                    recs = json.loads(sj.read_text(encoding="utf-8")).get("records", [])
                    annual_recs = [r for r in recs if str(r.get("report_date", "")).endswith("12-31")]
                    if annual_recs:
                        r = annual_recs[-1]
                        if not bank.get("pb") and r.get("pb"):
                            bank["pb"] = round(float(r["pb"]), 2)
                            filled["pb"] = filled.get("pb", 0) + 1
                        if not bank.get("pe") and r.get("pe_ttm"):
                            bank["pe"] = round(float(r["pe_ttm"]), 2)
                            filled["pe"] = filled.get("pe", 0) + 1
                except Exception as exc:  # noqa: BLE001
                    print(f"[warn] {name} 估值读取失败: {exc}")

    DATA_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    n = len(data.get("banks", []))
    print(f"[done] data.json 回填完成（{n}家）。本次填充字段数: {filled}")
    for k in ("nim", "npl_ratio", "provision_coverage", "cet1", "pb", "pe"):
        non_null = sum(1 for b in data["banks"] if b.get(k))
        print(f"  {k}: {non_null}/{n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
