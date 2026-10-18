#!/usr/bin/env python3
"""Build profit-flow Sankey payloads for every A-share bank stock page.

Reads AkShare 利润表 + iFind 利息附注, writes `pnl_sankey` into
`dashboard/stock_data/<code>.json` without wiping score/scale/indicators.

Usage:
    python3 scripts/generate_pnl_sankey_data.py
"""

from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

VAULT_ROOT = Path(__file__).resolve().parent.parent
INCOME_DIR = VAULT_ROOT / "02_原始资料" / "04_AkShare数据" / "三大报表" / "利润表"
NOTES_DIR = VAULT_ROOT / "02_原始资料" / "05_iFind数据" / "利息与非息附注"
STOCK_DIR = VAULT_ROOT / "dashboard" / "stock_data"

# 招商银行年报附注 49（集团，亿元）。其余银行年报未批量入库，业管费不拆。
OPEX_BREAK: Dict[str, Dict[str, Dict[str, float]]] = {
    "600036": {
        "2025": {
            "wage": 526.8,
            "social": 101.38,
            "staffOther": 58.71,
            "daa": 84.65,
            "admin": 307.98,
        },
        "2024": {
            "wage": 526.27,
            "social": 80.13,
            "staffOther": 74.48,
            "daa": 89.55,
            "admin": 305.73,
        },
        "2023": {
            "wage": 554.77,
            "social": 73.49,
            "staffOther": 75.22,
            "daa": 95.94,
            "admin": 318.44,
        },
    }
}


def yi(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    s = str(raw).strip()
    if s in ("", "None", "False", "-", "—"):
        return None
    try:
        return round(float(s) / 1e8, 2)
    except ValueError:
        return None


def num(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    s = str(raw).strip()
    if s in ("", "None", "False", "-", "—"):
        return None
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def nz(v: Optional[float]) -> float:
    return 0.0 if v is None else v


def load_income(path: Path) -> Dict[str, Dict[str, Optional[float]]]:
    out: Dict[str, Dict[str, Optional[float]]] = {}
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if "年报" not in (row.get("REPORT_TYPE") or ""):
                continue
            date = (row.get("REPORT_DATE") or "")[:10]
            if not date.endswith("-12-31"):
                continue
            credit = yi(row.get("CREDIT_IMPAIRMENT_LOSS"))
            if credit is None:
                credit = yi(row.get("ASSET_IMPAIRMENT_LOSS"))
            out[date[:4]] = {
                "opInc": yi(row.get("OPERATE_INCOME")),
                "nii": yi(row.get("INTEREST_NI")),
                "intInc": yi(row.get("INTEREST_INCOME")),
                "intExp": yi(row.get("INTEREST_EXPENSE")),
                "feeInc": yi(row.get("FEE_COMMISSION_INCOME")),
                "feeExp": yi(row.get("FEE_COMMISSION_EXPENSE")),
                "invest": yi(row.get("INVEST_INCOME")),
                "fv": yi(row.get("FAIRVALUE_CHANGE_INCOME")),
                "fx": yi(row.get("EXCHANGE_INCOME")),
                "otherBiz": yi(row.get("OTHER_BUSINESS_INCOME")),
                "opex": yi(row.get("BUSINESS_MANAGE_EXPENSE")),
                "credit": credit,
                "taxAdd": yi(row.get("OPERATE_TAX_ADD")),
                "otherBizCost": yi(row.get("OTHER_BUSINESS_COST")),
                "pretax": yi(row.get("TOTAL_PROFIT")),
                "tax": yi(row.get("INCOME_TAX")),
                "parent": yi(row.get("PARENT_NETPROFIT")),
                "minority": yi(row.get("MINORITY_INTEREST")),
            }
    return out


def load_notes(path: Path) -> Dict[str, Dict[str, Optional[float]]]:
    out: Dict[str, Dict[str, Optional[float]]] = {}
    if not path.exists():
        return out
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            date = (row.get("report_date") or "")[:10]
            if not date.endswith("-12-31"):
                continue
            out[date[:4]] = {
                "loan": yi(row.get("int_inc_loan")),
                "invInt": yi(row.get("int_inc_invest")),
                "pbc": yi(row.get("int_inc_pbc")),
                "ib": yi(row.get("int_inc_interbank")),
                "corpDemand": yi(row.get("int_exp_corp_demand")),
                "corpTime": yi(row.get("int_exp_corp_time")),
                "retailDemand": yi(row.get("int_exp_retail_demand")),
                "retailTime": yi(row.get("int_exp_retail_time")),
                "depInt": yi(row.get("int_exp_deposit")),
                "interbank": yi(row.get("int_exp_interbank")),
                "bond": yi(row.get("int_exp_bond")),
                "pbcExp": yi(row.get("int_exp_pbc")),
            }
    return out


def build_year(inc: Dict[str, Optional[float]], note: Dict[str, Optional[float]], opex_break: Optional[Dict[str, float]]) -> Optional[Dict[str, Any]]:
    op_inc = inc.get("opInc")
    opex = inc.get("opex")
    parent = inc.get("parent")
    if op_inc is None or opex is None or parent is None:
        return None

    int_inc = inc.get("intInc")
    int_exp = inc.get("intExp")
    nii = inc.get("nii")
    if nii is None and int_inc is not None and int_exp is not None:
        nii = round(int_inc - int_exp, 2)

    fee_inc = nz(inc.get("feeInc"))
    fee_exp = nz(inc.get("feeExp"))
    invest = nz(inc.get("invest"))
    fv = nz(inc.get("fv"))
    credit = nz(inc.get("credit"))
    pretax = nz(inc.get("pretax"))
    tax = nz(inc.get("tax"))
    minority = nz(inc.get("minority"))

    loan = note.get("loan")
    inv_int = note.get("invInt")
    pbc_ib = None
    if note.get("pbc") is not None or note.get("ib") is not None:
        pbc_ib = round(nz(note.get("pbc")) + nz(note.get("ib")), 2)
    if loan is not None and inv_int is not None and int_inc is not None:
        if pbc_ib is None:
            pbc_ib = round(int_inc - loan - inv_int, 2)
        else:
            residual = round(int_inc - loan - inv_int - pbc_ib, 2)
            if abs(residual) >= 0.05:
                pbc_ib = round(pbc_ib + residual, 2)

    dep_break = None
    splits = [note.get("corpDemand"), note.get("corpTime"), note.get("retailDemand"), note.get("retailTime")]
    if all(v is not None for v in splits):
        dep_break = {
            "corpDemand": note["corpDemand"],
            "corpTime": note["corpTime"],
            "retailDemand": note["retailDemand"],
            "retailTime": note["retailTime"],
        }

    dep_int = note.get("depInt")
    if dep_int is None and dep_break:
        dep_int = round(sum(dep_break.values()), 2)

    wholesale = None
    wholesale_break = None
    if int_exp is not None and dep_int is not None:
        wholesale = round(int_exp - dep_int, 2)
        ib = nz(note.get("interbank"))
        bond = nz(note.get("bond"))
        pbc_exp = nz(note.get("pbcExp"))
        known = round(ib + bond + pbc_exp, 2)
        other = round(wholesale - known, 2)
        wholesale_break = {
            "interbank": round(ib + (other if other > 0 else 0), 2) if other > 0 else ib,
            "bond": bond,
            "pbc": pbc_exp,
            "other": 0.0 if other > 0 else max(other, 0.0),
        }
        if other < -0.05:
            wholesale_break["interbank"] = ib
            wholesale_break["other"] = 0.0
        elif other <= 0:
            wholesale_break["interbank"] = ib
            wholesale_break["other"] = 0.0

    other_ni = None
    if nii is not None:
        other_ni = round(op_inc - nii - (fee_inc - fee_exp) - invest - fv, 2)

    other_cost = round(op_inc - opex - credit - pretax, 2)
    if abs(other_cost) < 0.05:
        other_cost = 0.0

    row: Dict[str, Any] = {
        "loan": loan,
        "invInt": inv_int,
        "pbcIb": pbc_ib,
        "intInc": int_inc,
        "intExp": int_exp,
        "feeInc": fee_inc,
        "feeExp": fee_exp,
        "invest": invest,
        "otherNi": other_ni,
        "fv": fv,
        "depInt": dep_int,
        "wholesaleInt": wholesale,
        "opex": opex,
        "credit": credit,
        "otherCost": other_cost,
        "pretax": pretax,
        "tax": tax,
        "parent": parent,
        "minority": minority,
        "opInc": op_inc,
        "nii": nii,
        "depBreak": dep_break,
        "wholesaleBreak": wholesale_break,
        "opexBreak": opex_break,
    }
    return row


def discover_income_files() -> List[Path]:
    return sorted(INCOME_DIR.glob("*_income.csv"))


def main() -> int:
    files = discover_income_files()
    if not files:
        print(f"错误：找不到利润表 {INCOME_DIR}", flush=True)
        return 1

    generated_at = datetime.now().isoformat(timespec="seconds")
    ok = 0
    skip = 0
    for path in files:
        code_name = path.name.replace("_income.csv", "")
        code, _, name = code_name.partition("_")
        if not name:
            name = code
        notes_path = NOTES_DIR / f"{code}_{name}_notes.csv"
        income = load_income(path)
        notes = load_notes(notes_path)
        years: Dict[str, Any] = {}
        for y, inc in income.items():
            row = build_year(inc, notes.get(y) or {}, (OPEX_BREAK.get(code) or {}).get(y))
            if row:
                years[y] = row
        if not years:
            skip += 1
            print(f"[skip] {code} {name}: 无可用年报")
            continue
        ordered = sorted(years.keys())
        stock_path = STOCK_DIR / f"{code}.json"
        if not stock_path.exists():
            skip += 1
            print(f"[skip] {code} {name}: 无 stock json")
            continue
        data = json.loads(stock_path.read_text(encoding="utf-8"))
        data["pnl_sankey"] = {
            "generated_at": generated_at,
            "years": years,
            "year_list": ordered,
        }
        stock_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        ok += 1
        latest = ordered[-1]
        print(f"[ok] {code} {name}: {len(ordered)} 年  最新{latest} 营收{years[latest]['opInc']}亿")

    print(f"完成 {ok} 家，跳过 {skip} 家")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
