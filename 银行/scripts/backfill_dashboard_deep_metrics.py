#!/usr/bin/env python3
"""回填仪表盘 data.json 的 deep_metrics（首页表格 NA）.

数据源（本地，不联网、不重算打分）:
  - 02_原始资料/04_AkShare数据/三大报表/利润表、资产负债表  2025A / 2024A
  - dashboard/stock_data/{code}.json  ROE/EPS/PB/PE/收盘价/总市值
  - 02_原始资料/05_iFind数据/银行专项指标  不良率、拨备覆盖率（用于拨贷比与贷款损失准备）

规则:
  - 已有且非空的 deep_metrics 指标不覆盖（18 家 AkShare 深度采集保持原值）
  - 空值 / "—" 才写入（股东权益合计 42 家原先全空）
  - 无 deep_metrics 的 24 家整包补上
  - 浅层 eps/bvps/roe/net_assets 若为空，用 stock_data 年报补

用法: python3 scripts/backfill_dashboard_deep_metrics.py
"""

from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd

warnings.filterwarnings("ignore")

VAULT_ROOT = Path(__file__).resolve().parents[1]
INC_DIR = VAULT_ROOT / "02_原始资料" / "04_AkShare数据" / "三大报表" / "利润表"
BAL_DIR = VAULT_ROOT / "02_原始资料" / "04_AkShare数据" / "三大报表" / "资产负债表"
IFIND_DIR = VAULT_ROOT / "02_原始资料" / "05_iFind数据" / "银行专项指标"
STOCK_DATA_DIR = VAULT_ROOT / "dashboard" / "stock_data"
DATA_JSON = VAULT_ROOT / "dashboard" / "data.json"

REPORT_YEAR = "2025"
PREV_YEAR = "2024"
EMPTY = {None, "", "—", "-", "NA", "na", "n/a"}


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def safe_float(val: Any) -> Optional[float]:
    if val is None or val in EMPTY:
        return None
    if isinstance(val, float) and pd.isna(val):
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if pd.isna(f):
        return None
    return f


def fmt_yi(val: Optional[float]) -> str:
    if val is None:
        return "—"
    return f"{val / 1e8:,.2f}亿"


def fmt_pct(val: Optional[float], decimals: int = 2) -> str:
    if val is None:
        return "—"
    return f"{val:.{decimals}f}%"


def fmt_ratio(val: Optional[float], decimals: int = 2) -> str:
    if val is None:
        return "—"
    return f"{val:.{decimals}f}"


def yi_metric(val: Optional[float]) -> Optional[Dict[str, Any]]:
    if val is None:
        return None
    return {"value_yi": fmt_yi(val), "raw": val}


def pct_metric(val: Optional[float]) -> Optional[Dict[str, Any]]:
    if val is None:
        return None
    return {"value_pct": fmt_pct(val), "raw": val}


def raw_metric(val: Optional[float], decimals: int = 2) -> Optional[Dict[str, Any]]:
    if val is None:
        return None
    return {"value": fmt_ratio(val, decimals), "raw": val}


def annual_row(df: pd.DataFrame, year: str) -> Optional[pd.Series]:
    if df is None or df.empty:
        return None
    mask = (df["REPORT_TYPE"].astype(str) == "年报") & df["REPORT_DATE"].astype(str).str.startswith(f"{year}-12-31")
    sub = df.loc[mask]
    if sub.empty:
        return None
    return sub.iloc[-1]


def num(row: Optional[pd.Series], col: str) -> Optional[float]:
    if row is None:
        return None
    return safe_float(row.get(col))


def yoy(row: Optional[pd.Series], col: str) -> Optional[float]:
    return num(row, col)


def is_empty_metric(m: Any) -> bool:
    if not m or not isinstance(m, dict):
        return True
    raw = m.get("raw")
    if isinstance(raw, (int, float)) and not pd.isna(raw):
        return False
    for key in ("value_yi", "value_pct", "value"):
        v = m.get(key)
        if v not in EMPTY:
            return False
    return True


def merge_metrics(dst: Dict[str, Any], src: Dict[str, Any]) -> int:
    filled = 0
    for key, val in src.items():
        if val is None:
            continue
        if is_empty_metric(dst.get(key)):
            dst[key] = val
            filled += 1
    return filled


def load_csv(path: Path) -> Optional[pd.DataFrame]:
    if not path.exists():
        return None
    return pd.read_csv(path)


def stock_annual(code: str, year: str) -> Optional[Dict[str, Any]]:
    path = STOCK_DATA_DIR / f"{code}.json"
    if not path.exists():
        return None
    recs = json.loads(path.read_text(encoding="utf-8")).get("records") or []
    want = f"{year}-12-31"
    for r in reversed(recs):
        if str(r.get("report_date")) == want:
            return r
    return None


def ifind_annual(code: str, name: str, year: str) -> Optional[pd.Series]:
    path = IFIND_DIR / f"{code}_{name}_indicators.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path)
    sub = df[df["report_date"].astype(str).str.startswith(f"{year}-12-31")]
    if sub.empty:
        return None
    return sub.iloc[-1]


def build_metrics(
    code: str,
    name: str,
    inc: Optional[pd.DataFrame],
    bal: Optional[pd.DataFrame],
) -> Dict[str, Any]:
    cur_i = annual_row(inc, REPORT_YEAR)
    prev_i = annual_row(inc, PREV_YEAR)
    cur_b = annual_row(bal, REPORT_YEAR)
    prev_b = annual_row(bal, PREV_YEAR)
    rec = stock_annual(code, REPORT_YEAR)
    ifind = ifind_annual(code, name, REPORT_YEAR)

    m: Dict[str, Any] = {}

    revenue = num(cur_i, "OPERATE_INCOME")
    net_int = num(cur_i, "INTEREST_NI")
    int_inc = num(cur_i, "INTEREST_INCOME")
    int_exp = num(cur_i, "INTEREST_EXPENSE")
    fee = num(cur_i, "FEE_COMMISSION_NI")
    invest = num(cur_i, "INVEST_INCOME")
    fv = num(cur_i, "FAIRVALUE_CHANGE_INCOME")
    opex = num(cur_i, "BUSINESS_MANAGE_EXPENSE")
    credit = num(cur_i, "CREDIT_IMPAIRMENT_LOSS")
    if credit is None:
        credit = num(cur_i, "ASSET_IMPAIRMENT_LOSS")
    op_profit = num(cur_i, "OPERATE_PROFIT")
    total_profit = num(cur_i, "TOTAL_PROFIT")
    net_profit = num(cur_i, "NETPROFIT")
    parent_np = num(cur_i, "PARENT_NETPROFIT") or net_profit

    m["营业收入"] = yi_metric(revenue)
    m["净利息收入"] = yi_metric(net_int)
    m["利息收入"] = yi_metric(int_inc)
    m["利息支出"] = yi_metric(int_exp)
    m["手续费及佣金净收入"] = yi_metric(fee)
    m["投资收益"] = yi_metric(invest)
    m["公允价值变动收益"] = yi_metric(fv)
    m["业务及管理费"] = yi_metric(opex)
    m["信用减值损失"] = yi_metric(credit)
    m["营业利润"] = yi_metric(op_profit)
    m["利润总额"] = yi_metric(total_profit)
    m["净利润"] = yi_metric(net_profit)
    m["归母净利润"] = yi_metric(parent_np)

    if revenue is not None and net_int is not None:
        non_int = revenue - net_int
        m["非息收入"] = yi_metric(non_int)
        if revenue:
            m["非息收入占比"] = pct_metric(non_int / revenue * 100)
    if revenue is not None and opex is not None:
        ppop = revenue - opex
        m["PPOP"] = yi_metric(ppop)
        if revenue:
            m["成本收入比(CIR)"] = pct_metric(opex / revenue * 100)
    if revenue and fee is not None:
        m["中收占比"] = pct_metric(fee / revenue * 100)

    m["营业收入增速"] = pct_metric(yoy(cur_i, "OPERATE_INCOME_YOY"))
    m["归母净利润增速"] = pct_metric(yoy(cur_i, "PARENT_NETPROFIT_YOY"))
    m["净利息收入增速"] = pct_metric(yoy(cur_i, "INTEREST_NI_YOY"))
    m["中收增速"] = pct_metric(yoy(cur_i, "FEE_COMMISSION_NI_YOY"))

    prev_rev = num(prev_i, "OPERATE_INCOME")
    prev_opex = num(prev_i, "BUSINESS_MANAGE_EXPENSE")
    prev_credit = num(prev_i, "CREDIT_IMPAIRMENT_LOSS")
    if prev_credit is None:
        prev_credit = num(prev_i, "ASSET_IMPAIRMENT_LOSS")
    m["信用减值损失_上年"] = yi_metric(prev_credit)
    cur_ppop = (m.get("PPOP") or {}).get("raw")
    if cur_ppop is not None and prev_rev is not None and prev_opex is not None:
        prev_ppop = prev_rev - prev_opex
        if prev_ppop:
            m["PPOP增速"] = pct_metric((cur_ppop / prev_ppop - 1) * 100)

    total_assets = num(cur_b, "TOTAL_ASSETS")
    loans = num(cur_b, "LOAN_ADVANCE")
    deposits = num(cur_b, "ACCEPT_DEPOSIT")
    iofi = num(cur_b, "IOFI_DEPOSIT")
    borrow = num(cur_b, "BORROW_FUND")
    interbank = None
    for v in (iofi, borrow):
        if v is not None:
            interbank = (interbank or 0) + v
    bonds = num(cur_b, "BOND_PAYABLE")
    parent_eq = num(cur_b, "TOTAL_PARENT_EQUITY")
    total_eq = num(cur_b, "TOTAL_EQUITY") or parent_eq
    total_liab = num(cur_b, "TOTAL_LIABILITIES")
    share_cap = num(cur_b, "SHARE_CAPITAL")

    m["总资产"] = yi_metric(total_assets)
    m["贷款总额"] = yi_metric(loans)
    m["客户存款"] = yi_metric(deposits)
    m["同业负债"] = yi_metric(interbank)
    m["应付债券"] = yi_metric(bonds)
    m["归母净资产"] = yi_metric(parent_eq)
    m["股东权益合计"] = yi_metric(total_eq)
    m["负债合计"] = yi_metric(total_liab)
    m["股本"] = yi_metric(share_cap)

    npl = safe_float(ifind.get("npl_ratio")) if ifind is not None else None
    cov = safe_float(ifind.get("provision_coverage")) if ifind is not None else None
    if npl is not None and cov is not None:
        # 拨贷比 = 不良率 × 拨备覆盖率（监管定义）
        prov_loan = npl * cov / 100
        m["拨贷比"] = pct_metric(prov_loan)
        if loans is not None:
            m["贷款损失准备"] = yi_metric(loans * prov_loan / 100)

    if total_assets and loans is not None:
        m["贷款/总资产"] = pct_metric(loans / total_assets * 100)
    if deposits and loans is not None:
        m["存贷比"] = pct_metric(loans / deposits * 100)
    if total_liab and interbank is not None:
        m["同业负债占比(粗略)"] = pct_metric(interbank / total_liab * 100)
    if parent_eq and total_assets is not None:
        m["杠杆倍数"] = raw_metric(total_assets / parent_eq)
    if total_assets and total_liab is not None:
        m["资产负债率"] = pct_metric(total_liab / total_assets * 100)

    m["总资产增速"] = pct_metric(yoy(cur_b, "TOTAL_ASSETS_YOY"))
    m["贷款增速"] = pct_metric(yoy(cur_b, "LOAN_ADVANCE_YOY"))
    m["存款增速"] = pct_metric(yoy(cur_b, "ACCEPT_DEPOSIT_YOY"))
    m["净资产增速"] = pct_metric(yoy(cur_b, "TOTAL_PARENT_EQUITY_YOY"))

    prev_loans = num(prev_b, "LOAN_ADVANCE")
    prev_assets = num(prev_b, "TOTAL_ASSETS")
    if credit is not None and prev_loans and loans:
        avg_loans = (prev_loans + loans) / 2
        if avg_loans:
            m["信用成本率"] = pct_metric(credit / avg_loans * 100)
    if parent_np is not None and prev_assets and total_assets:
        avg_ta = (prev_assets + total_assets) / 2
        if avg_ta:
            m["ROA"] = pct_metric(parent_np / avg_ta * 100)

    if rec:
        m["加权ROE"] = pct_metric(safe_float(rec.get("roe")))
        m["ROE(摊薄)"] = pct_metric(safe_float(rec.get("roe_diluted")) or safe_float(rec.get("roe")))
        m["EPS"] = raw_metric(safe_float(rec.get("eps")), 4)
        m["每股净资产"] = raw_metric(safe_float(rec.get("bvps")), 4)
        close = safe_float(rec.get("close"))
        if close is not None:
            item = raw_metric(close, 2)
            if item:
                item["date"] = str(rec.get("valuation_date") or rec.get("report_date") or "")
                m["收盘价"] = item
        mcap_yi = safe_float(rec.get("market_cap_yi"))
        if mcap_yi is not None:
            m["总市值"] = yi_metric(mcap_yi * 1e8)
        m["PB"] = raw_metric(safe_float(rec.get("pb")), 4)
        m["PE(TTM)"] = raw_metric(safe_float(rec.get("pe_ttm")), 4)

    if m.get("EPS") is None:
        m["EPS"] = raw_metric(num(cur_i, "BASIC_EPS"), 4)
    if m.get("每股净资产") is None and share_cap:
        m["每股净资产"] = raw_metric(parent_eq / share_cap if parent_eq else None, 4)

    close_v = (m.get("收盘价") or {}).get("raw")
    eps_v = (m.get("EPS") or {}).get("raw")
    if close_v and eps_v:
        m["PE(静)"] = raw_metric(close_v / eps_v, 4)

    return {k: v for k, v in m.items() if v is not None}


_EVAL_FN = "unset"


def make_evaluations(metrics: Dict[str, Any]) -> Dict[str, str]:
    """复用深度采集脚本的四维评价模板；akshare 不可用时跳过。"""
    global _EVAL_FN
    if _EVAL_FN == "unset":
        try:
            scripts_dir = str(Path(__file__).resolve().parent)
            if scripts_dir not in sys.path:
                sys.path.insert(0, scripts_dir)
            from fetch_bank_deep_metrics import generate_evaluation  # noqa: WPS433

            _EVAL_FN = generate_evaluation
        except Exception as exc:  # noqa: BLE001
            print(f"[info] 跳过四维评价生成: {exc}")
            _EVAL_FN = None
    if not _EVAL_FN:
        return {}
    try:
        return _EVAL_FN({"metrics": metrics})
    except Exception as exc:  # noqa: BLE001
        print(f"[info] 四维评价失败: {exc}")
        return {}


def fill_flat(bank: Dict[str, Any], rec: Optional[Dict[str, Any]], metrics: Dict[str, Any]) -> int:
    n = 0

    def set_if_empty(field: str, value: Any) -> None:
        nonlocal n
        if value is None or value in EMPTY:
            return
        if bank.get(field) in (None, ""):
            bank[field] = value
            n += 1

    if rec:
        eps = safe_float(rec.get("eps"))
        bvps = safe_float(rec.get("bvps"))
        roe = safe_float(rec.get("roe"))
        na = safe_float(rec.get("net_assets_attr"))
        set_if_empty("eps", f"{eps:.2f}" if eps is not None else None)
        set_if_empty("bvps", f"{bvps:.2f}" if bvps is not None else None)
        set_if_empty("roe", f"{roe:.2f}%" if roe is not None else None)
        if na is not None:
            set_if_empty("net_assets", f"{na:.2f}亿")
        pb = safe_float(rec.get("pb"))
        pe = safe_float(rec.get("pe_ttm"))
        if isinstance(bank.get("pb"), str) or bank.get("pb") in (None, ""):
            if pb is not None:
                bank["pb"] = round(pb, 2)
                n += 1
        if isinstance(bank.get("pe"), str) or bank.get("pe") in (None, ""):
            if pe is not None:
                bank["pe"] = round(pe, 2)
                n += 1
    parent = (metrics.get("归母净资产") or {}).get("raw")
    if parent is not None:
        set_if_empty("net_assets", f"{parent / 1e8:.2f}亿")
    return n


def main() -> int:
    index = json.loads((STOCK_DATA_DIR / "_index.json").read_text(encoding="utf-8"))
    code_by_name = {b["name"]: b["code"] for b in index.get("banks", [])}
    data = json.loads(DATA_JSON.read_text(encoding="utf-8"))

    created = 0
    merged = 0
    flat_n = 0
    for bank in data.get("banks", []):
        name = bank["name"]
        code = code_by_name.get(name)
        if not code:
            print(f"[warn] 无代码: {name}")
            continue
        inc = load_csv(INC_DIR / f"{code}_{name}_income.csv")
        bal = load_csv(BAL_DIR / f"{code}_{name}_balance.csv")
        if inc is None or bal is None:
            print(f"[warn] 缺三大报表: {name}")
            continue
        built = build_metrics(code, name, inc, bal)
        rec = stock_annual(code, REPORT_YEAR)
        flat_n += fill_flat(bank, rec, built)

        existing = bank.get("deep_metrics")
        if not existing:
            payload = {
                "bank_code": code,
                "bank_type": bank.get("type"),
                "report_period": f"{REPORT_YEAR}A",
                "fetch_time": now_iso(),
                "report_date": f"{REPORT_YEAR}1231",
                "metrics": built,
                "source": "三大报表+stock_data+iFind",
            }
            evals = make_evaluations(built)
            if evals:
                payload["evaluations"] = evals
            bank["deep_metrics"] = payload
            created += 1
            continue
        metrics = existing.setdefault("metrics", {})
        n = merge_metrics(metrics, built)
        merged += n
        if not existing.get("report_period"):
            existing["report_period"] = f"{REPORT_YEAR}A"
        if not existing.get("evaluations"):
            evals = make_evaluations(metrics)
            if evals:
                existing["evaluations"] = evals

    DATA_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] 新建 deep_metrics {created} 家；为已有银行补空指标 {merged} 项；浅层字段 {flat_n} 项")
    return 0


if __name__ == "__main__":
    sys.exit(main())
