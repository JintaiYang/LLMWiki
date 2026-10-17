#!/usr/bin/env python3
"""申万白酒Ⅲ上市公司财务采集和研究模型；只使用可核验的本地原始快照。"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
from bisect import bisect_left, bisect_right
from datetime import date, datetime, timezone
from pathlib import Path
from mature_score import SCORING_PARAMETERS, score_mature

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "02_原始资料" / "04_AkShare数据"
SUPPLEMENT = ROOT / "02_原始资料" / "05_iFind数据" / "supplement.csv"
SHARES = ROOT / "02_原始资料" / "verified_shares.csv"
SHARE_SNAPSHOT = RAW / "shares" / "total_shares.csv"
QUALITATIVE = ROOT / "02_原始资料" / "verified_qualitative.csv"
OUT = ROOT / "dashboard"
# 申万三级白酒Ⅲ（851251.SI）2026-10-09 成分。郎酒、剑南春未上市，不在成分内。
COMPANIES = {
    "600519": "贵州茅台", "000858": "五粮液", "000568": "泸州老窖", "600809": "山西汾酒", "002304": "洋河股份",
    "000596": "古井贡酒", "000799": "酒鬼酒", "000860": "顺鑫农业", "000995": "皇台酒业", "002646": "天佑德酒",
    "600197": "伊力特", "600199": "金种子酒", "600559": "老白干酒", "600702": "舍得酒业", "600779": "水井坊",
    "603198": "迎驾贡酒", "603369": "今世缘", "603589": "口子窖", "603919": "金徽酒",
}
STATEMENTS = {"income": "stock_profit_sheet_by_report_em", "balance": "stock_balance_sheet_by_report_em", "cashflow": "stock_cash_flow_sheet_by_report_em"}
YEARS = range(2016, 2026)
# 元、无比例缩放；严格选择列名，不使用模糊匹配或同比替代。
FIELDS = {
    "revenue": ("income", ("OPERATE_INCOME",)),
    "net_profit": ("income", ("PARENT_NETPROFIT",)),
    "consolidated_net_profit": ("income", ("NETPROFIT",)),
    "deduct_profit": ("income", ("DEDUCT_PARENT_NETPROFIT",)),
    "cost": ("income", ("OPERATE_COST",)),
    "operating_profit": ("income", ("OPERATE_PROFIT",)),
    "finance_expense": ("income", ("FINANCE_EXPENSE",)),
    "sales_expense": ("income", ("SALE_EXPENSE",)),
    "income_tax": ("income", ("INCOME_TAX",)),
    "total_profit": ("income", ("TOTAL_PROFIT",)),
    "cfo": ("cashflow", ("NETCASH_OPERATE",)),
    "sales_cash": ("cashflow", ("SALES_SERVICES",)),
    "capex": ("cashflow", ("CONSTRUCT_LONG_ASSET",)),
    "depreciation": ("cashflow", ("FA_IR_DEPR",)),
    "amortization": ("cashflow", ("IA_LPE_AMORTIZE",)),
    "contract_liabilities": ("balance", ("CONTRACT_LIAB",)),
    "inventory": ("balance", ("INVENTORY",)),
    "receivables": ("balance", ("ACCOUNTS_RECE",)),
    "other_receivables": ("balance", ("TOTAL_OTHER_RECE",)),
    "payables": ("balance", ("ACCOUNTS_PAYABLE",)),
    "parent_equity": ("balance", ("TOTAL_PARENT_EQUITY",)),
    "cash": ("balance", ("MONETARYFUNDS", "MONETARY_CAP",)),
    "total_assets": ("balance", ("TOTAL_ASSETS",)),
    "total_liabilities": ("balance", ("TOTAL_LIABILITIES",)),
    "current_assets": ("balance", ("TOTAL_CURRENT_ASSETS",)),
    "current_liabilities": ("balance", ("TOTAL_CURRENT_LIAB",)),
    "short_debt": ("balance", ("SHORT_LOAN",)),
    "long_debt": ("balance", ("LONG_LOAN",)),
    "bonds": ("balance", ("BOND_PAYABLE",)),
}
# Scoring is versioned separately from the existing cash-flow valuation model.
PARAMETERS = {
    **SCORING_PARAMETERS,
    "dcf": {
        "悲观": {"growth": -0.02, "terminal_growth": 0.01, "discount_rate": 0.11},
        "基准": {"growth": 0.03, "terminal_growth": 0.02, "discount_rate": 0.095},
        "乐观": {"growth": 0.06, "terminal_growth": 0.025, "discount_rate": 0.085},
        "years": 5,
        "sensitivity_discount_rate": [0.08, 0.09, 0.10, 0.11, 0.12],
        "sensitivity_terminal_growth": [0.01, 0.02, 0.03],
        "sensitivity_cash_flow_multiplier": [0.9, 1.0, 1.1],
        "owner_cost_of_equity_adjustment": 0.015,
        "growth_anchor_bounds": [-0.05, 0.06],
        "scenario_growth_bounds": [-0.10, 0.08],
        "scenario_growth_offsets": {"悲观": -0.05, "基准": 0, "乐观": 0.03},
    },
}

DISPLAY = ("revenue", "net_profit", "gross_margin", "operating_margin", "net_margin", "sales_expense_ratio", "gross_sales_spread", "nonrecurring_ratio", "roe", "roic", "return_on_capital", "cfo", "cfo_profit", "cfo_to_revenue", "sales_cash_ratio", "owner_fcf", "owner_fcf_to_profit", "fcf_to_revenue", "capex", "fcff", "dividend_cash_CNY", "cash", "total_assets", "total_liabilities", "current_assets", "current_liabilities", "short_debt", "long_debt", "bonds", "contract_liabilities", "inventory", "receivables", "other_receivables", "payables", "receivables_to_revenue", "inventory_receivables_to_revenue", "other_receivables_to_asset", "sales_expense", "debt_to_asset", "cash_to_current_liab", "cfo_to_current_liab", "quick_ratio")


DISPLAY += ("consolidated_net_profit", "roa")


def number(value):
    if value is None or isinstance(value, bool):
        return None
    s = str(value).strip().replace(",", "")
    if s in ("", "-", "--", "nan", "None", "null", "不适用"):
        return None
    try:
        n = float(s)
        return n if math.isfinite(n) else None
    except ValueError:
        return None


def ratio(n, d, scale=1):
    return n / d * scale if n is not None and d is not None and d > 0 else None


def clean_date(value):
    match = re.match(r"^(20\d{2})-?(\d{2})-?(\d{2})", str(value or ""))
    if not match:
        return None
    try:
        return date.fromisoformat("-".join(match.groups())).isoformat()
    except ValueError:
        return None


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    # allow_nan=False 防止浏览器消费无效 JSON。
    text = json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def load_csv(path):
    if not path.is_file():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def fetch(force=False):
    """独立采集三报表、未复权日线及分红；失败保留先前快照。"""
    try:
        os.environ.setdefault("TQDM_DISABLE", "1")
        import akshare as ak
    except ImportError as exc:
        print(f"AKShare 不可用：{type(exc).__name__}", file=sys.stderr)
        return 1
    failures = []
    for code, name in COMPANIES.items():
        symbol = ("SH" if code.startswith("6") else "SZ") + code
        for kind, api in STATEMENTS.items():
            path = RAW / kind / f"{code}.csv"
            if path.exists() and not force:
                continue
            try:
                frame = getattr(ak, api)(symbol=symbol)
                if frame is None or frame.empty or "REPORT_DATE" not in frame:
                    raise ValueError("空报表或无报告期")
                frame["REPORT_DATE"] = frame["REPORT_DATE"].astype(str).str[:10]
                frame = frame[(frame.REPORT_DATE >= "2015-01-01") & (frame.REPORT_DATE <= date.today().isoformat())]
                if frame.empty:
                    raise ValueError("无目标报告期")
                path.parent.mkdir(parents=True, exist_ok=True)
                frame.to_csv(path, index=False, encoding="utf-8-sig")
                print(f"{code} {kind}: {len(frame)} 期")
            except Exception as exc:
                failures.append(f"{code}/{kind}: {type(exc).__name__}: {str(exc)[:120]}")
            time.sleep(0.3)
        for kind, api, kwargs in (
            ("price", "stock_zh_a_hist", {"symbol": code, "period": "daily", "start_date": "20260101", "end_date": date.today().strftime("%Y%m%d"), "adjust": ""}),
            ("dividend", "stock_fhps_detail_em", {"symbol": code}),
        ):
            path = RAW / kind / f"{code}.csv"
            if path.exists() and not force:
                continue
            try:
                frame = getattr(ak, api)(**kwargs)
                if frame is None or frame.empty:
                    raise ValueError("空结果")
                path.parent.mkdir(parents=True, exist_ok=True)
                frame.to_csv(path, index=False, encoding="utf-8-sig")
                print(f"{code} {kind}: {len(frame)} 条")
            except Exception as exc:
                if kind == "price":
                    try:
                        tx = ak.stock_zh_a_hist_tx(symbol=("sh" if code.startswith("6") else "sz") + code, start_date="20260101", end_date=date.today().strftime("%Y%m%d"), adjust="")
                        if tx is None or tx.empty or not {"date", "close"}.issubset(tx.columns):
                            raise ValueError("腾讯日线无报价")
                        tx = tx.rename(columns={"date": "日期", "close": "收盘"})
                        path.parent.mkdir(parents=True, exist_ok=True)
                        tx.to_csv(path, index=False, encoding="utf-8-sig")
                        print(f"{code} price (AKShare 腾讯): {len(tx)} 条")
                    except Exception as fallback_exc:
                        failures.append(f"{code}/{kind}: 东财 {type(exc).__name__}; 腾讯 {type(fallback_exc).__name__}: {str(fallback_exc)[:120]}")
                else:
                    failures.append(f"{code}/{kind}: {type(exc).__name__}: {str(exc)[:120]}")
            time.sleep(0.3)
    if failures:
        print("采集失败（未用旧数据冒充新数据）：\n" + "\n".join(failures), file=sys.stderr)
    return int(bool(failures))


def ifind_missing(asof, existing=None):
    """仅枚举已从报表确认的报告期的原始字段；不把派生缺项当作 iFind 指标。"""
    existing = existing if existing is not None else supplement_rows()
    requests = []
    for code, name in COMPANIES.items():
        tables = {kind: report_rows(code, kind, asof) for kind in STATEMENTS}
        days = sorted({d for table in tables.values() for d in table if (d.endswith("12-31") and 2015 <= int(d[:4]) <= 2025) or (d.startswith("2026-") and d[5:] in ("03-31", "06-30", "09-30"))})
        for day in days:
            for field, (kind, columns) in FIELDS.items():
                if (code, day, field) in existing:
                    continue
                row = tables[kind].get(day, {})
                if any(number(row.get(col)) is not None for col in columns):
                    continue
                if field == "amortization" and number(row.get("IA_AMORTIZE")) is not None and number(row.get("LPE_AMORTIZE")) is not None:
                    continue
                requests.append({"code": code, "name": name, "report_date": day, "field": field})
    return requests


def ifind_fill(asof, limit=None, runner=subprocess.run):
    """原子新增严格验收的逐项证据；现有人工文件永不覆盖。"""
    if SUPPLEMENT.exists():
        print("[iFind] 已有 supplement.csv；为保护人工数据跳过自动写入", file=sys.stderr)
        return 0
    candidates = ifind_missing(asof)
    selected = candidates[:limit] if limit is not None else candidates
    print(f"[iFind] 缺项 {len(candidates)}；本次请求 {len(selected)}", file=sys.stderr)
    if not selected:
        return 0
    adapter = Path(__file__).resolve().with_name("liquor_ifind.js")
    if not adapter.is_file() or not shutil.which("node"):
        print("[iFind] Node 或本地适配器不存在，保留缺项", file=sys.stderr)
        return 0
    try:
        completed = runner(["node", str(adapter)], input=json.dumps({"requests": selected}), text=True,
                           capture_output=True, check=False, timeout=max(30, len(selected) * 30))
        if completed.returncode:
            print(f"[iFind] 适配器失败（状态 {completed.returncode}），保留缺项；不输出原始响应", file=sys.stderr)
            return 0
        response = json.loads(completed.stdout)
        if not isinstance(response, dict) or not isinstance(response.get("rows"), list):
            raise ValueError("无效结构化返回")
        wanted = {(r["code"], r["report_date"], r["field"]) for r in selected}
        accepted = []
        seen = set()
        for row in response["rows"]:
            key = (row.get("code"), row.get("report_date"), row.get("field"))
            if key not in wanted or key in seen or set(row) != {"code", "report_date", "field", "value", "unit", "source", "source_date"}:
                raise ValueError("回退字段不在请求清单或重复")
            if row["unit"] != "CNY" or number(row["value"]) is None or clean_date(row["source_date"]) != row["source_date"] or not row["report_date"] <= row["source_date"] <= asof:
                raise ValueError("回退单位、数值或来源日期无效")
            if row["source"] != f"iFind:get_stock_financials:{row['field']}":
                raise ValueError("回退来源未经核验")
            accepted.append(row)
            seen.add(key)
        if accepted:
            SUPPLEMENT.parent.mkdir(parents=True, exist_ok=True)
            # 排他创建，不创建临时文件，也不覆盖与执行期间并发创建的人工文件。
            created = False
            complete = False
            try:
                with SUPPLEMENT.open("x", encoding="utf-8", newline="") as f:
                    created = True
                    writer = csv.DictWriter(f, fieldnames=["code", "report_date", "field", "value", "unit", "source", "source_date"])
                    writer.writeheader()
                    writer.writerows(accepted)
                complete = True
            finally:
                if created and not complete:
                    SUPPLEMENT.unlink(missing_ok=True)
        print(f"[iFind] 验收 {len(accepted)}/{len(selected)}；拒绝或缺失 {len(selected)-len(accepted)}；仅保存已验证证据", file=sys.stderr)
    except (OSError, ValueError, TypeError, csv.Error, subprocess.TimeoutExpired) as exc:
        print(f"[iFind] 校验或调用失败 ({type(exc).__name__})，不发布补缺", file=sys.stderr)
    return 0


def supplement_rows():
    """经人工核验的 iFind 逐项补缺导入；禁止携带任意额外列及凭证。"""
    required = {"code", "report_date", "field", "value", "unit", "source", "source_date"}
    if not SUPPLEMENT.exists():
        return {}
    with SUPPLEMENT.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if set(reader.fieldnames or []) != required:
            raise ValueError("iFind supplement.csv 列必须恰为 " + ",".join(sorted(required)))
        rows = list(reader)
    result = {}
    for row in rows:
        code, day, field = row["code"], clean_date(row["report_date"]), row["field"]
        if code not in COMPANIES or day != row["report_date"] or field not in FIELDS:
            raise ValueError("iFind 补缺代码/报告期/字段不合法")
        if row["unit"] != "CNY" or number(row["value"]) is None or clean_date(row["source_date"]) != row["source_date"] or not day <= row["source_date"] <= date.today().isoformat():
            raise ValueError("iFind 补缺必须为数值、CNY 和有效来源日期")
        if not row["source"].startswith("iFind:") or len(row["source"]) > 200 or re.search(r"(?i)(token|password|secret|cookie|ssoid|authorization|bearer|key=|https?://[^/]*@)", row["source"]):
            raise ValueError("iFind 补缺来源须写 iFind: 指标及查询信息，不得含凭证")
        key = (code, day, field)
        if key in result:
            raise ValueError("iFind 同期同字段重复")
        result[key] = row
    return result


def report_rows(code, kind, asof):
    path = RAW / kind / f"{code}.csv"
    rows = {}
    for row in load_csv(path):
        day = clean_date(row.get("REPORT_DATE"))
        if not day or not "2015-01-01" <= day <= asof:
            continue
        if row.get("CURRENCY") and row["CURRENCY"] not in ("CNY", "RMB", "人民币", "1"):
            continue
        if row.get("SECURITY_CODE") and row["SECURITY_CODE"] != code:
            continue
        # 报表更新版本只取在本次运行前披露的最新版本。
        notice, updated = clean_date(row.get("NOTICE_DATE")), clean_date(row.get("UPDATE_DATE"))
        # 无公告日期不能确证已披露；修订日期晚于 as-of 不能使用当前快照回看历史。
        if not notice or notice > asof or (row.get("UPDATE_DATE") and (not updated or updated > asof)):
            continue
        old = rows.get(day)
        if old is None or (row.get("UPDATE_DATE", ""), row.get("NOTICE_DATE", "")) > (old.get("UPDATE_DATE", ""), old.get("NOTICE_DATE", "")):
            rows[day] = row
    return rows


def resolve(code, day, field, statements, supplement, provenance, conflicts, asof=None):
    kind, columns = FIELDS[field]
    row = statements[kind].get(day, {})
    candidates = [(col, number(row.get(col))) for col in columns if col in row and number(row.get(col)) is not None]
    preferred = candidates[0] if candidates else None
    secondary = supplement.get((code, day, field))
    if secondary and asof and secondary["source_date"] > asof:
        secondary = None
    if preferred:
        col, value = preferred
        path = RAW / kind / f"{code}.csv"
        source = {"provider": "AKShare/东方财富", "api": STATEMENTS[kind], "file": f"02_原始资料/04_AkShare数据/{kind}/{code}.csv", "column": col, "report_date": day, "notice_date": clean_date(row.get("NOTICE_DATE")), "update_date": clean_date(row.get("UPDATE_DATE")), "snapshot_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(), "unit": "CNY"}
        if secondary and not math.isclose(value, number(secondary["value"]), rel_tol=1e-6, abs_tol=0.01):
            conflicts.append({"report_date": day, "field": field, "akshare_value": value, "ifind_value": number(secondary["value"]), "akshare_source": source, "ifind_source": secondary["source"], "ifind_source_date": secondary["source_date"], "status": "unresolved_excluded"})
            provenance[f"{day}.{field}"] = {"status": "unresolved_conflict", "unit": "CNY", "report_date": day}
            return None
    elif secondary:
        value = number(secondary["value"])
        source = {"provider": "iFind/manual verified import", "file": "02_原始资料/05_iFind数据/supplement.csv", "indicator": secondary["source"], "report_date": day, "source_date": secondary["source_date"], "unit": "CNY"}
    else:
        return None
    provenance[f"{day}.{field}"] = source
    return value


def blank_zero(value):
    """利润表利息明细和摊销明细空着，表示这项没有发生。有息负债的空单元格不走这里。"""
    return 0.0 if value is None else value


def enterprise_fcff(row, prev):
    """企业自由现金流，和现金流量表上的经营现金流减资本开支不是同一个数。"""
    missing = []
    total_profit = row.get("total_profit")
    income_tax = row.get("income_tax")
    depreciation = row.get("depreciation")
    capex = row.get("capex")
    operating_fields = ("inventory", "receivables", "other_receivables", "payables", "contract_liabilities")
    tax_rate = None
    if total_profit is None or total_profit <= 0 or income_tax is None or not 0 <= income_tax / total_profit < 1:
        missing.append("tax_rate")
    else:
        tax_rate = income_tax / total_profit
    if depreciation is None:
        missing.append("depreciation")
    if capex is None:
        missing.append("capex")
    if row.get("operating_profit") is None:
        missing.append("operating_profit")
    if prev is None or any(row.get(field) is None or prev.get(field) is None for field in operating_fields):
        missing.append("operating_working_capital_components")
    if missing:
        return None, missing, {}
    if row.get("intangible_amortization") is not None or row.get("prepaid_amortization") is not None:
        amortization = blank_zero(row.get("intangible_amortization")) + blank_zero(row.get("prepaid_amortization"))
    else:
        amortization = blank_zero(row.get("amortization"))
    # Chinese income statements include finance expense in operating profit. Add it back
    # when disclosed to approximate unlevered EBIT; keep the adjustment explicit.
    finance_expense = row.get("finance_expense")
    ebit = row["operating_profit"] + finance_expense if finance_expense is not None else row["operating_profit"]
    da = depreciation + amortization + blank_zero(row.get("lease_amortization"))
    current_nwc = sum(row[field] for field in operating_fields[:3]) - sum(row[field] for field in operating_fields[3:])
    prior_nwc = sum(prev[field] for field in operating_fields[:3]) - sum(prev[field] for field in operating_fields[3:])
    change_nwc = current_nwc - prior_nwc
    value = ebit * (1 - tax_rate) + da - capex - change_nwc
    detail = {
        "ebit": ebit,
        "ebit_method": "operating_profit + finance_expense" if finance_expense is not None else "operating_profit (finance expense unavailable)",
        "tax_rate": tax_rate,
        "depreciation_amortization": da,
        "capex": capex,
        "current_operating_nwc": current_nwc,
        "prior_operating_nwc": prior_nwc,
        "change_nwc": change_nwc,
        "investment_property_depreciation_IR_DEPR": row.get("investment_property_depreciation"),
        "note": "企业自由现金流 = 调整后 EBIT × (1 - 所得税/利润总额) + 折旧与摊销 - 购建长期资产支付的现金 - Δ(存货 + 应收账款 + 其他应收 - 应付账款 - 合同负债)。不把货币资金或有息负债放进营运资金；有息负债空单元格不按 0。投资性房地产折旧不另加。",
    }
    return value, [], detail


def derive(row, prev, sources, day):
    def calc(field, value, inputs, unit):
        row[field] = value
        if value is not None:
            sources[f"{day}.{field}"] = {"provider": "derived", "formula": inputs, "report_date": day, "unit": unit}
    revenue, cost = row["revenue"], row["cost"]
    calc("gross_margin", ratio(revenue - cost, revenue, 100) if revenue is not None and cost is not None else None, "(revenue - cost) / revenue * 100", "%")
    calc("operating_margin", ratio(row["operating_profit"], revenue, 100), "operating_profit / revenue * 100", "%")
    calc("net_margin", ratio(row["net_profit"], revenue, 100), "parent_net_profit / revenue * 100", "%")
    sales_ratio = ratio(row["sales_expense"], revenue, 100)
    calc("sales_expense_ratio", sales_ratio, "sales_expense / revenue * 100", "%")
    spread = row["gross_margin"] - sales_ratio if row["gross_margin"] is not None and sales_ratio is not None else None
    calc("gross_sales_spread", spread, "gross_margin - sales_expense / revenue * 100", "pp")
    calc("cfo_to_revenue", ratio(row["cfo"], revenue, 100), "cfo / revenue * 100", "%")
    calc("receivables_to_revenue", ratio(row["receivables"], revenue, 100), "receivables / revenue * 100", "%")
    np_ = row["net_profit"]
    ded = row["deduct_profit"]
    nonrecurring = max(0.0, (np_ - ded) / abs(np_) * 100) if np_ not in (None, 0) and ded is not None else None
    calc("nonrecurring_ratio", nonrecurring, "max(0, (parent_net_profit - deduct_parent_net_profit) / abs(parent_net_profit) * 100)", "%")
    calc("sales_cash_ratio", ratio(row["sales_cash"], revenue, 100), "cash_received_from_sales / revenue * 100", "%")
    calc("cfo_profit", ratio(row["cfo"], np_) if np_ is not None and np_ > 0 else None, "cfo / parent_net_profit when parent_net_profit > 0", "x")
    owner_fcf = row["cfo"] - row["capex"] if row["cfo"] is not None and row["capex"] is not None else None
    calc("owner_fcf", owner_fcf, "cfo - capex", "CNY")
    calc("owner_fcf_to_profit", ratio(owner_fcf, np_) if owner_fcf is not None and np_ is not None and np_ > 0 else None, "(cfo - capex) / parent_net_profit when parent_net_profit > 0", "x")
    inventory_receivables = row["inventory"] + row["receivables"] if row["inventory"] is not None and row["receivables"] is not None else None
    calc("inventory_receivables_to_revenue", ratio(inventory_receivables, revenue, 100), "(inventory + receivables) / revenue * 100", "%")
    fcff, fcff_missing, fcff_detail = enterprise_fcff(row, prev)
    calc("fcf_to_revenue", ratio(fcff, revenue, 100), "enterprise FCFF / revenue * 100", "%")
    calc("other_receivables_to_asset", ratio(row["other_receivables"], row["total_assets"], 100), "other_receivables / total_assets * 100", "%")
    calc("debt_to_asset", ratio(row["total_liabilities"], row["total_assets"], 100), "total_liabilities / total_assets * 100", "%")
    calc("cash_to_current_liab", ratio(row["cash"], row["current_liabilities"], 100), "monetary_funds / current_liabilities * 100", "%")
    calc("cfo_to_current_liab", ratio(row["cfo"], row["current_liabilities"], 100), "cfo / current_liabilities * 100", "%")
    quick_assets = row["current_assets"] - row["inventory"] if row["current_assets"] is not None and row["inventory"] is not None else None
    calc("quick_ratio", ratio(quick_assets, row["current_liabilities"], 100), "(current_assets - inventory) / current_liabilities * 100", "%")
    equity = row["parent_equity"]
    prev_equity = prev["parent_equity"] if prev else None
    avg_equity = (equity + prev_equity) / 2 if equity is not None and prev_equity is not None else None
    calc("roe", ratio(row["net_profit"], avg_equity, 100), "parent_net_profit / average(parent_equity at same date prior year, current) * 100", "%")
    def invested(r):
        keys = ("parent_equity", "cash", "short_debt", "long_debt", "bonds")
        if not r or any(r[k] is None for k in keys):
            return None
        return r["parent_equity"] + r["short_debt"] + r["long_debt"] + r["bonds"] - r["cash"]
    tax = ratio(row["income_tax"], row["total_profit"])
    inv_now, inv_prev = invested(row), invested(prev)
    invested_avg = (inv_now + inv_prev) / 2 if inv_now is not None and inv_prev is not None else None
    finance_expense = row.get("finance_expense")
    ebit = row["operating_profit"] + finance_expense if row.get("operating_profit") is not None and finance_expense is not None else row.get("operating_profit")
    nopat = ebit * (1 - tax) if ebit is not None and tax is not None and 0 <= tax < 1 else None
    calc("roic", ratio(nopat, invested_avg, 100), "(operating_profit + finance_expense) * (1 - observed income_tax / total_profit) / average(parent_equity + interest_debt - cash) * 100; all debt components required", "%")
    if invested_avg is None or invested_avg <= 0:
        row["roic"] = None
        sources.pop(f"{day}.roic", None)
    calc("return_on_capital", row.get("roic"), "strict ROIC only; no ROE fallback", "%")
    average_assets = (row["total_assets"] + prev["total_assets"]) / 2 if prev and row.get("total_assets") is not None and prev.get("total_assets") is not None else None
    calc("roa", ratio(row.get("consolidated_net_profit"), average_assets, 100) if average_assets is not None and average_assets > 0 else None,
         "consolidated_net_profit / average(total_assets) * 100", "%")
    row["fcff_adjustment"] = {**fcff_detail, "missing": fcff_missing}
    calc("fcff", fcff, "adjusted_EBIT * (1 - income_tax / total_profit) + depreciation + amortization + lease_amortization - capex - change(inventory + receivables + other_receivables - payables - contract_liabilities)", "CNY")


def metrics_for(code, supplement, asof):
    statements = {kind: report_rows(code, kind, asof) for kind in STATEMENTS}
    provenance, conflicts = {}, []
    quarter_ends = ("03-31", "06-30", "09-30", "12-31")
    days = sorted({f"{y}-12-31" for y in range(2015, 2026)} | {d for table in statements.values() for d in table if d[:4] in ("2025", "2026") and d[5:] in quarter_ends} | {d for c, d, _ in supplement if c == code and d[:4] in ("2025", "2026") and d[5:] in quarter_ends})
    records = {}
    for day in days:
        if day > asof:
            continue
        row = {"report_date": day, "year": int(day[:4]), "period": "annual" if day.endswith("12-31") else "quarterly_ytd"}
        for field in FIELDS:
            row[field] = resolve(code, day, field, statements, supplement, provenance, conflicts, asof)
        cashrow = statements["cashflow"].get(day, {})
        income_row = statements["income"].get(day, {})
        row["intangible_amortization"] = number(cashrow.get("IA_AMORTIZE"))
        row["prepaid_amortization"] = number(cashrow.get("LPE_AMORTIZE"))
        row["lease_amortization"] = number(cashrow.get("USERIGHT_ASSET_AMORTIZE"))
        row["investment_property_depreciation"] = number(cashrow.get("IR_DEPR"))
        row["interest_expense"] = number(income_row.get("FE_INTEREST_EXPENSE"))
        row["interest_income"] = number(income_row.get("FE_INTEREST_INCOME"))
        if row["amortization"] is None and row["intangible_amortization"] is not None and row["prepaid_amortization"] is not None and provenance.get(f"{day}.amortization", {}).get("status") != "unresolved_conflict":
            provenance[f"{day}.amortization"] = {"provider": "AKShare/东方财富", "api": STATEMENTS["cashflow"], "file": f"02_原始资料/04_AkShare数据/cashflow/{code}.csv", "columns": ["IA_AMORTIZE", "LPE_AMORTIZE"], "formula": "sum of two disclosed components", "report_date": day, "unit": "CNY"}
        prev = records.get(f"{int(day[:4])-1}{day[4:]}")
        derive(row, prev, provenance, day)
        records[day] = row
    annual = [{k: r.get(k) for k in ("year", "report_date", "period", *DISPLAY, "fcff_adjustment")} for d, r in records.items() if d.endswith("12-31") and int(d[:4]) in YEARS]
    quarters = [{k: r.get(k) for k in ("year", "report_date", "period", *DISPLAY, "fcff_adjustment")} for d, r in records.items() if d[:4] in ("2025", "2026") and not d.endswith("12-31") and any(r.get(k) is not None for k in DISPLAY)]
    return records, annual, quarters, provenance, conflicts


def latest_price(code, asof):
    path = RAW / "price" / f"{code}.csv"
    results = []
    rows = load_csv(path)
    for row in rows:
        day = clean_date(row.get("日期"))
        close = number(row.get("收盘"))
        if day and day <= asof and close is not None and close > 0:
            results.append((day, close))
    if not results:
        return None
    day, close = max(results)
    provider = "AKShare stock_zh_a_hist_tx (Tencent)" if "open" in rows[0] else "AKShare stock_zh_a_hist (Eastmoney)"
    return {"close": close, "price_date": day, "unit": "CNY/share", "source": provider + " unadjusted", "file": f"02_原始资料/04_AkShare数据/price/{code}.csv", "snapshot_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()}


def dividend_observations(code, asof):
    observations = []
    for row in load_csv(RAW / "dividend" / f"{code}.csv"):
        amount = number(row.get("现金分红-现金分红比例"))
        report_date = clean_date(row.get("报告期"))
        # 最新公告可能在 as-of 之后修改方案；无法重建旧版本时整条排除。
        notice = clean_date(row.get("预案公告日")) or clean_date(row.get("业绩披露日期"))
        latest_notice = clean_date(row.get("最新公告日期"))
        if amount is not None and report_date and report_date <= asof and notice and notice <= asof and latest_notice and latest_notice <= asof:
            observations.append({"report_date": report_date, "notice_date": notice, "latest_notice_date": latest_notice, "cash_per_10_shares": amount, "unit": "CNY/10 shares", "status": row.get("方案进度") or None, "source": "AKShare stock_fhps_detail_em", "file": f"02_原始资料/04_AkShare数据/dividend/{code}.csv", "snapshot_at": datetime.fromtimestamp((RAW / "dividend" / f"{code}.csv").stat().st_mtime, timezone.utc).isoformat()})
    return observations


def cagr(start, end, years=3):
    return ((end / start) ** (1 / years) - 1) * 100 if start is not None and end is not None and start > 0 and end > 0 else None


def qualitative_evidence(code, asof):
    """可核验的定性事实仅作证据陈列；未批准的量表不得自动转分。"""
    required = {"code", "indicator", "observation", "source", "source_date"}
    if not QUALITATIVE.exists():
        return {}
    with QUALITATIVE.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if set(reader.fieldnames or []) != required:
            raise ValueError("verified_qualitative.csv 列必须恰为 code,indicator,observation,source,source_date")
        rows = list(reader)
    evidence = {}
    for row in rows:
        if row["code"] not in COMPANIES or row["indicator"] not in PARAMETERS["qualitative_indicators"] or not row["observation"].strip() or not row["source"].strip() or clean_date(row["source_date"]) != row["source_date"] or row["source_date"] > date.today().isoformat():
            raise ValueError("定性证据代码、指标、来源或日期无效")
        if re.search(r"(?i)(token|password|secret|cookie|ssoid|authorization|bearer|key=|https?://[^/]*@)", row["source"]):
            raise ValueError("定性来源不得含凭证")
        if row["source_date"] <= asof:
            evidence.setdefault(row["code"], {}).setdefault(row["indicator"], []).append({"observation": row["observation"], "source": row["source"], "source_date": row["source_date"]})
    return evidence


def _median(values, minimum=3):
    clean = [number(value) for value in values if number(value) is not None]
    return statistics.median(clean) if len(clean) >= minimum else None


def _stdev(values, minimum=3):
    clean = [number(value) for value in values if number(value) is not None]
    return statistics.pstdev(clean) if len(clean) >= minimum else None


def _score_value(value, zero_line, full_line, maximum):
    value = number(value)
    if value is None or zero_line == full_line:
        return None
    if full_line > zero_line:
        fraction = (value - zero_line) / (full_line - zero_line)
    else:
        fraction = (zero_line - value) / (zero_line - full_line)
    return round(max(0.0, min(1.0, fraction)) * maximum, 2)


def score_inputs(annual):
    """把多年报表压缩成评分所需的稳健统计量，避免单年异常主导排名。"""
    rows = sorted((r for r in annual if r.get("year") is not None and r.get("revenue") is not None), key=lambda r: r["year"])
    window = rows[-5:]
    latest = window[-1] if window else {}
    latest_year = latest.get("year")
    window_years = [r["year"] for r in window]

    def series(field):
        return [r.get(field) for r in window]

    def owner_fcf(row):
        if row.get("owner_fcf") is not None:
            return row.get("owner_fcf")
        if row.get("cfo") is not None and row.get("capex") is not None:
            return row["cfo"] - row["capex"]
        return None

    owner = [owner_fcf(r) for r in window]
    current_ratios = [r["current_assets"] / r["current_liabilities"] if r.get("current_assets") is not None and r.get("current_liabilities") not in (None, 0) else None for r in window]
    quick_ratios = [r["quick_ratio"] / 100 if r.get("quick_ratio") is not None else None for r in window]
    cash_ratios = [r.get("cash_to_current_liab") for r in window]
    inventory_ratios = [r["inventory"] / r["revenue"] * 100 if r.get("inventory") is not None and r.get("revenue") not in (None, 0) else None for r in window]
    margin_values = [r.get("operating_margin") for r in window]
    margin_median = _median(margin_values)
    margin_volatility = _stdev(margin_values)
    margin_stability = max(0.0, min(1.0, 1 - (margin_volatility or 0) / 20)) if margin_median is not None else None
    dividend_cash = [r.get("dividend_cash_CNY") for r in window]
    payout_fcf_coverage = [owner_fcf(r) / r["dividend_cash_CNY"] if owner_fcf(r) is not None and r.get("dividend_cash_CNY") not in (None, 0) else None for r in window]
    capex_to_cfo = [r["capex"] / r["cfo"] * 100 if r.get("capex") is not None and r.get("cfo") not in (None, 0) and r["cfo"] > 0 else None for r in window]
    negative_flags = [((r.get("net_profit") is not None and r["net_profit"] <= 0) or (owner_fcf(r) is not None and owner_fcf(r) < 0)) for r in window]
    median_fields = {
        "return_on_capital_median": series("return_on_capital"),
        "gross_margin_median": series("gross_margin"),
        "gross_sales_spread_median": series("gross_sales_spread"),
        "margin_stability": [margin_stability] * len(window),
        "cfo_to_revenue_median": series("cfo_to_revenue"),
        "cfo_profit_median": series("cfo_profit"),
        "owner_fcf_profit_median": series("owner_fcf_to_profit"),
        "sales_cash_ratio_median": series("sales_cash_ratio"),
        "cash_to_current_liab_median": cash_ratios,
        "cfo_to_current_liab_median": series("cfo_to_current_liab"),
        "debt_to_asset_median": series("debt_to_asset"),
        "inventory_to_revenue_median": inventory_ratios,
    }
    values = {field: _median(series_values) for field, series_values in median_fields.items()}
    values["revenue_cagr_3y"] = cagr(next((r.get("revenue") for r in window if latest_year and r.get("year") == latest_year - 3), None), latest.get("revenue"), 3)
    values["profit_cagr_3y"] = cagr(next((r.get("net_profit") for r in window if latest_year and r.get("year") == latest_year - 3), None), latest.get("net_profit"), 3)
    values["negative_year_ratio"] = sum(negative_flags) / len(negative_flags) if negative_flags else None
    values["payout_fcf_coverage_median"] = _median(payout_fcf_coverage)
    values["dividend_consistency"] = sum(v is not None and v > 0 for v in dividend_cash) / len(dividend_cash) if dividend_cash else None
    values["payout_pct_median"] = _median(series("payout_pct"))
    values["capex_to_cfo_median"] = _median(capex_to_cfo)
    methods = {field: "5-year median" for field in median_fields}
    methods.update({"margin_stability": "1 - operating margin population stdev / 20, clipped 0-1",
                    "revenue_cagr_3y": "latest year versus latest-3 year CAGR",
                    "profit_cagr_3y": "latest year versus latest-3 year CAGR",
                    "negative_year_ratio": "negative net profit or owner FCF years / window years",
                    "payout_fcf_coverage_median": "owner FCF / cash dividend, 5-year median",
                    "dividend_consistency": "years with cash dividend / window years",
                    "payout_pct_median": "cash payout ratio, 5-year median",
                    "capex_to_cfo_median": "capital expenditure / operating cash flow, 5-year median"})
    counts = {field: len([value for value in series_values if value is not None]) for field, series_values in median_fields.items()}
    counts.update({"negative_year_ratio": len(negative_flags),
                   "payout_fcf_coverage_median": len([v for v in payout_fcf_coverage if v is not None]),
                   "dividend_consistency": len([v for v in dividend_cash if v is not None]),
                   "payout_pct_median": len([v for v in series("payout_pct") if v is not None]),
                   "capex_to_cfo_median": len([v for v in capex_to_cfo if v is not None]),
                   "revenue_cagr_3y": 2 if values["revenue_cagr_3y"] is not None else 0,
                   "profit_cagr_3y": 2 if values["profit_cagr_3y"] is not None else 0})
    negative_years = [{"year": r.get("year"), "net_profit": r.get("net_profit"), "owner_fcf": owner_fcf(r)} for r in window if (r.get("net_profit") is not None and r.get("net_profit") <= 0) or (owner_fcf(r) is not None and owner_fcf(r) < 0)]
    prior_by_year = {r.get("year"): r for r in window}
    anomalies = []
    for row in window:
        prior = prior_by_year.get((row.get("year") or 0) - 1)
        if not prior:
            continue
        for field in ("revenue", "net_profit", "owner_fcf"):
            if field == "owner_fcf":
                current, previous = owner_fcf(row), owner_fcf(prior)
            else:
                current, previous = row.get(field), prior.get(field)
            if current is not None and previous not in (None, 0) and abs(current / previous - 1) >= 0.5:
                anomalies.append({"year": row.get("year"), "field": field, "change_pct": (current / previous - 1) * 100})
    blocking_anomalies = [item for item in anomalies if item["year"] == latest_year and item["field"] in ("revenue", "net_profit")]
    return values, methods, latest_year, window_years, latest, counts, negative_years, anomalies, blocking_anomalies


def _percentile(sorted_values, fraction):
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (position - lower)


def build_universe_stats(annual_by_code):
    """为每个评分项保留样本内稳健百分位的边界，不把相对排名当成经营事实。"""
    field_values = {}
    for _, annual in annual_by_code:
        values, _, _, _, _, _, _, _, _ = score_inputs(annual)
        for field, value in values.items():
            if value is not None:
                field_values.setdefault(field, []).append(value)
    stats = {}
    for field, values in field_values.items():
        ordered = sorted(values)
        stats[field] = {"values": ordered, "peer_count": len(ordered), "p05": _percentile(ordered, 0.05), "p95": _percentile(ordered, 0.95)}
    return stats


def _relative_percentile(value, stat, lower_is_better=False):
    if value is None or not stat or stat.get("peer_count", 0) < 5:
        return None
    lo, hi = stat.get("p05"), stat.get("p95")
    if lo is None or hi is None or hi <= lo:
        return 0.5
    peers = sorted(max(lo, min(hi, peer)) for peer in stat.get("values", []))
    if len(peers) < 5:
        return None
    clipped = max(lo, min(hi, value))
    left, right = bisect_left(peers, clipped), bisect_right(peers, clipped)
    # Use tied midranks so one extreme value cannot compress all peer scores.
    rank = (left + right - 1) / 2 if right > left else left - 0.5
    pct = max(0.0, min(1.0, rank / (len(peers) - 1)))
    return round(1 - pct if lower_is_better else pct, 4)


def score(annual, sources, evidence=None, universe_stats=None):
    return score_mature(annual, sources, evidence)


def verified_shares(asof):
    """只接受显式来源、股数、披露日期；不将资产负债表股本金额默认为股数。"""
    if not SHARES.exists():
        return {}
    with SHARES.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if set(reader.fieldnames or []) != {"code", "report_date", "shares", "unit", "source", "source_date"}:
            raise ValueError("verified_shares.csv 列必须为 code,report_date,shares,unit,source,source_date")
        rows = list(reader)
    result = {}
    for row in rows:
        if row["code"] not in COMPANIES or row["report_date"] != "2025-12-31" or row["unit"] != "shares" or not row["source"].strip() or clean_date(row["source_date"]) != row["source_date"] or row["source_date"] > asof or not number(row["shares"]) or number(row["shares"]) <= 0:
            raise ValueError("核验股数记录无效；仅支持有来源的 2025 年末总股数")
        if row["code"] in result:
            raise ValueError("重复股数记录")
        result[row["code"]] = {"shares": number(row["shares"]), "source": row["source"], "source_date": row["source_date"], "unit": "shares", "file": "02_原始资料/verified_shares.csv"}
    return result


def total_shares(asof):
    """行情总股本，单位是股。不使用资产负债表里的股本金额。"""
    path = RAW / "shares" / "total_shares.csv"
    if not path.exists():
        return {}
    required = {"code", "shares", "unit", "source", "source_date"}
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if set(reader.fieldnames or []) != required:
            raise ValueError("total_shares.csv 列必须为 code,shares,unit,source,source_date")
        rows = list(reader)
    result = {}
    for row in rows:
        if row["source_date"] > asof:
            continue
        if row["code"] not in COMPANIES or row["unit"] != "shares" or not row["source"].strip() or clean_date(row["source_date"]) != row["source_date"] or not number(row["shares"]) or number(row["shares"]) <= 0:
            raise ValueError("总股本快照无效")
        if row["code"] in result:
            raise ValueError("重复总股本")
        result[row["code"]] = {"shares": number(row["shares"]), "source": row["source"], "source_date": row["source_date"], "unit": "shares", "file": "02_原始资料/04_AkShare数据/shares/total_shares.csv"}
    return result


def price_closes(code, asof):
    closes = []
    for folder in ("price", "price_year_end"):
        for row in load_csv(RAW / folder / f"{code}.csv"):
            day = clean_date(row.get("日期"))
            close = number(row.get("收盘"))
            if day and day <= asof and close is not None and close > 0:
                closes.append((day, close))
    return closes


def close_on_or_before(closes, day):
    picked = [item for item in closes if item[0] <= day]
    return max(picked) if picked else None


def read_dividend_events(code, asof):
    path = RAW / "dividend" / f"{code}.csv"
    if not path.exists():
        return None
    events = []
    for row in load_csv(path):
        report_date = clean_date(row.get("报告期"))
        if not report_date or report_date > asof:
            continue
        latest = clean_date(row.get("最新公告日期"))
        notice = clean_date(row.get("预案公告日")) or clean_date(row.get("业绩披露日期")) or latest
        ex = clean_date(row.get("除权除息日"))
        if latest and latest > asof:
            continue
        shares = number(row.get("总股本"))
        events.append({
            "report_date": report_date,
            "year": int(report_date[:4]),
            "cash_per_10_shares": number(row.get("现金分红-现金分红比例")),
            "shares": shares if shares and shares > 0 else None,
            "status": (row.get("方案进度") or "").strip() or None,
            "notice_date": notice,
            "latest_notice_date": latest,
            "ex_date": ex,
            "description": (row.get("现金分红-现金分红比例描述") or "").strip() or None,
            "source": "AKShare stock_fhps_detail_em",
            "file": f"02_原始资料/04_AkShare数据/dividend/{code}.csv",
        })
    return events


def select_cash_dividends(events, year, asof):
    """同一会计年度内、截至 as-of 已经实施且已经除权的现金分红。预披露和尚未除权的方案不计入。"""
    selected = []
    for ev in events or []:
        if ev.get("year") != year or ev.get("status") != "实施分配" or ev.get("cash_per_10_shares") is None:
            continue
        notice = ev.get("latest_notice_date") or ev.get("notice_date")
        if not notice or notice > asof:
            continue
        if ev.get("ex_date") and ev["ex_date"] > asof:
            continue
        selected.append(ev)
    return selected


def dividend_package(code, asof, price, annual, share_row=None):
    latest_year = max((r["year"] for r in annual if r.get("revenue") is not None), default=None)
    events = read_dividend_events(code, asof)
    closes = price_closes(code, asof)
    profits = {r["year"]: r.get("net_profit") for r in annual}
    method = "年度股息率 = 该会计年度已实施现金分红（元/10股）合计 / 10 / 未复权收盘价。当前股息率用最新快照收盘价；历年曲线用年末收盘价。中期和末期按归属年度相加。预披露、未除权方案不计入。无该年记录保留缺失；已实施记录明确为零才记零。股数不足不推算派现总额。"
    if events is None or latest_year is None:
        return {"year": latest_year, "yield_pct": None, "dps": None, "cash_per_10": None, "payout_pct": None, "events": [], "history": [], "status": "missing_file", "method": method, "share_note": None}
    history = []
    for year in YEARS:
        selected = select_cash_dividends(events, year, asof)
        cash = sum(ev["cash_per_10_shares"] for ev in selected) if selected else None
        dps = cash / 10 if cash is not None else None
        ye = close_on_or_before(closes, f"{year}-12-31")
        yld = dps / ye[1] * 100 if ye and dps is not None else None
        payout = None
        profit = profits.get(year)
        total_paid = None
        if selected and cash == 0:
            total_paid = 0.0
        elif selected and all(ev.get("shares") for ev in selected):
            total_paid = sum(ev["cash_per_10_shares"] / 10 * ev["shares"] for ev in selected)
        if total_paid is not None and profit is not None and profit > 0:
            payout = total_paid / profit * 100
        history.append({
            "year": year,
            "cash_per_10": round(cash, 4) if cash is not None else None,
            "dps": round(dps, 6) if dps is not None else None,
            "yield_pct": round(yld, 4) if yld is not None else None,
            "year_end_price": ye[1] if ye else None,
            "year_end_price_date": ye[0] if ye else None,
            "payout_pct": round(payout, 2) if payout is not None else None,
            "cash_total_CNY": total_paid,
            "cash_status": "implemented" if selected and total_paid is not None else "observed_zero" if total_paid == 0 else "missing_evidence",
            "event_count": len(selected),
        })
    score_events = select_cash_dividends(events, latest_year, asof)
    score_hist = next(h for h in history if h["year"] == latest_year)
    cash = score_hist["cash_per_10"]
    dps = score_hist["dps"]
    px = price.get("close") if price else None
    yield_pct = dps / px * 100 if px and dps is not None else None
    share_note = None
    dividend_shares = next((ev["shares"] for ev in reversed(score_events) if ev.get("shares")), None)
    if share_row and dividend_shares and abs(dividend_shares - share_row["shares"]) / share_row["shares"] > 0.02:
        share_note = f"分红明细总股本 {dividend_shares:.0f} 股，行情总股本 {share_row['shares']:.0f} 股。派现总额用分红明细股本，每股价值用行情股本。"
    return {
        "year": latest_year,
        "cash_per_10": round(cash, 4) if cash is not None else None,
        "dps": round(dps, 6) if dps is not None else None,
        "yield_pct": round(yield_pct, 4) if yield_pct is not None else None,
        "price": px,
        "price_date": price.get("price_date") if price else None,
        "payout_pct": score_hist["payout_pct"],
        "year_end_yield_pct": score_hist["yield_pct"],
        "events": [{k: ev[k] for k in ("report_date", "cash_per_10_shares", "shares", "status", "notice_date", "ex_date", "description")} for ev in score_events],
        "history": history,
        "status": "computed" if yield_pct is not None else "missing_evidence" if dps is None else "missing_price",
        "method": method,
        "share_note": share_note,
        "source": "AKShare stock_fhps_detail_em",
        "file": f"02_原始资料/04_AkShare数据/dividend/{code}.csv",
    }


def stamp_dividend(annual, package):
    hist = {h["year"]: h for h in package.get("history") or []}
    for row in annual:
        item = hist.get(row["year"])
        if not item:
            continue
        row["dividend_cash_per_10"] = item["cash_per_10"]
        row["dps"] = item["dps"]
        # Total cash paid is only calculable when the implemented plan discloses
        # its share count. A blank is safer than treating an unknown share count as zero.
        row["dividend_cash_CNY"] = item.get("cash_total_CNY")
        row["dividend_cash_status"] = item.get("cash_status")
        row["payout_pct"] = item["payout_pct"]
        row["dividend_yield_year_end"] = item["yield_pct"]
        row["dividend_yield"] = item["yield_pct"]
        if row["year"] == package.get("year"):
            row["dividend_yield"] = package.get("yield_pct")


def project_equity(base, growth, terminal_growth, discount_rate, shares, net_cash, anchor_year=2025, cash_flow_multiplier=1.0):
    years = PARAMETERS["dcf"]["years"]
    base = base * cash_flow_multiplier
    if discount_rate <= terminal_growth:
        raise ValueError("永续增长率必须低于折现率")
    flows = []
    cash_flow = base
    for n in range(1, years + 1):
        # The current growth assumption fades linearly to the terminal rate.
        growth_rate = growth + (terminal_growth - growth) * ((n - 1) / max(years - 1, 1))
        cash_flow *= 1 + growth_rate
        discount_factor = (1 + discount_rate) ** n
        flows.append({"year": anchor_year + n, "growth_rate": growth_rate, "fcff_CNY": cash_flow,
                      "discount_factor": discount_factor,
                      "present_value_CNY": cash_flow / discount_factor})
    terminal = flows[-1]["fcff_CNY"] * (1 + terminal_growth) / (discount_rate - terminal_growth)
    terminal_pv = terminal / flows[-1]["discount_factor"]
    projected_pv = sum(flow["present_value_CNY"] for flow in flows)
    equity_value = projected_pv + terminal_pv + (net_cash if net_cash is not None else 0)
    return {"cashflows": flows, "projected_fcff_pv_CNY": projected_pv, "terminal_value_CNY": terminal,
            "terminal_value_pv_CNY": terminal_pv, "net_cash_CNY": net_cash,
            "equity_value_CNY": equity_value, "shares": shares, "base_cash_flow_CNY": base,
            "discount_rate": discount_rate, "terminal_growth": terminal_growth,
            "value_per_share": equity_value / shares}


def dcf_growth_anchor(annual):
    rows = {row.get("year"): row for row in annual}
    trend = cagr(rows.get(2022, {}).get("revenue"), rows.get(2025, {}).get("revenue"), 3)
    lower, upper = PARAMETERS["dcf"]["growth_anchor_bounds"]
    anchor = max(lower, min(upper, trend / 100)) if trend is not None else PARAMETERS["dcf"]["基准"]["growth"]
    return {"anchor": anchor, "revenue_cagr_3y": trend / 100 if trend is not None else None,
            "years": [2022, 2025], "bounds": [lower, upper],
            "status": "derived_trend_assumption" if trend is not None else "default_research_assumption",
            "method": "2022-2025 revenue CAGR clipped to mature-industry bounds; not a cash-flow forecast"}


def dcf_quotes(base, shares, price, net_cash, base_label, growth_anchor=None):
    scenarios = []
    owner_path = "owner FCF" in base_label
    rate_adjustment = PARAMETERS["dcf"].get("owner_cost_of_equity_adjustment", 0) if owner_path else 0
    rate_kind = "成本权益率代理" if owner_path else "WACC"
    anchor = growth_anchor if growth_anchor is not None else PARAMETERS["dcf"]["基准"]["growth"]
    lower, upper = PARAMETERS["dcf"]["scenario_growth_bounds"]
    for name in ("悲观", "基准", "乐观"):
        growth = max(lower, min(upper, anchor + PARAMETERS["dcf"]["scenario_growth_offsets"][name]))
        assumptions = {**PARAMETERS["dcf"][name], "growth": growth}
        rate = assumptions["discount_rate"] + rate_adjustment
        detail = project_equity(base, assumptions["growth"], assumptions["terminal_growth"], rate, shares, net_cash)
        fair = detail["value_per_share"]
        close = price.get("close") if price else None
        scenarios.append({
            "name": name,
            "value_per_share": round(fair, 2),
            "upside": round(fair / close - 1, 4) if close and fair > 0 and net_cash is not None else None,
            "margin_of_safety": round(1 - close / fair, 4) if close and fair > 0 and net_cash is not None else None,
            "assumptions": {**assumptions, "discount_rate": rate, "rate_kind": rate_kind, "base_label": base_label, "base_cash_flow_CNY": base, "forecast_years": PARAMETERS["dcf"]["years"], "growth_fades_to_terminal": True},
            "breakdown": detail,
        })
    sensitivity = []
    for discount_rate in PARAMETERS["dcf"]["sensitivity_discount_rate"]:
        for terminal in PARAMETERS["dcf"]["sensitivity_terminal_growth"]:
            if discount_rate <= terminal:
                continue
            for multiplier in PARAMETERS["dcf"]["sensitivity_cash_flow_multiplier"]:
                rate = discount_rate + rate_adjustment
                detail = project_equity(base, anchor, terminal, rate, shares, net_cash, cash_flow_multiplier=multiplier)
                sensitivity.append({"discount_rate": discount_rate, "effective_discount_rate": rate, "wacc": discount_rate, "terminal_growth": terminal,
                                    "growth": anchor, "cash_flow_multiplier": multiplier, "rate_kind": rate_kind,
                                    "value_per_share": round(detail["value_per_share"], 2),
                                    "upside": round(detail["value_per_share"] / price["close"] - 1, 4) if price and price.get("close") and net_cash is not None else None,
                                    "margin_of_safety": round(1 - price["close"] / detail["value_per_share"], 4) if price and price.get("close") and detail["value_per_share"] > 0 and net_cash is not None else None})
    return scenarios, sensitivity


def owner_fcf_bridge(annual):
    bridge = []
    for year in (2023, 2024, 2025):
        row = next((r for r in annual if r.get("year") == year), {})
        cfo, capex = row.get("cfo"), row.get("capex")
        owner_fcf = row.get("owner_fcf") if row.get("owner_fcf") is not None else cfo - capex if cfo is not None and capex is not None else None
        bridge.append({"year": year, "cfo": cfo, "capex": capex, "owner_fcf": owner_fcf, "fcff": row.get("fcff")})
    return bridge


def dcf(records, annual, price, shares=None):
    bridge = owner_fcf_bridge(annual)
    required_years = (2023, 2024, 2025)
    assumptions = "FCFF 只取 2023A、2024A、2025A 三个连续完整年度的中位数；若这三年 FCFF 不完整或中位数非正，回退到同三年的 owner FCF = 经营现金流 - 资本开支，并使用成本权益率代理。owner FCF 未加入净借款，且未区分维持性与扩张性资本开支，不等同于严格 FCFE 或 Buffett owner earnings。基准起始增长由 2022A-2025A 营收 CAGR 限制在 -5% 至 6%；悲观下调 5 个百分点、乐观上调 3 个百分点，情景限制在 -10% 至 8%。趋势缺失时回退 3% 并标记默认假设。预测期 5 年，年度增长线性收敛到永续增长率。净现金只有货币资金、短期借款、长期借款和应付债券均有明确数字时才计入，空单元格不写成 0。"
    rows_by_year = {r.get("year"): r for r in annual}
    fcff_values = [rows_by_year.get(year, {}).get("fcff") for year in required_years]
    owner_values = []
    for year in required_years:
        row = rows_by_year.get(year, {})
        owner_values.append(row.get("owner_fcf") if row.get("owner_fcf") is not None else row.get("cfo") - row.get("capex") if row.get("cfo") is not None and row.get("capex") is not None else None)
    fcff_complete = all(value is not None for value in fcff_values)
    owner_complete = all(value is not None for value in owner_values)
    base = statistics.median(fcff_values) if fcff_complete else None
    base_method = "median_3y_fcff"
    base_label = "2023-2025 FCFF 中位数"
    if base is None or base <= 0:
        base = statistics.median(owner_values) if owner_complete else None
        base_method = "median_3y_owner_fcf"
        base_label = "2023-2025 owner FCF 中位数"
    growth_basis = dcf_growth_anchor(annual)
    payload = {"bridge": bridge, "base_cash_flow_CNY": base, "base_year": 2025, "base_years": list(required_years), "base_method": base_method, "base_label": base_label, "growth_basis": growth_basis, "cash_flow_uneven": fcff_complete and max(fcff_values) - min(fcff_values) > abs(statistics.median(fcff_values)) * 0.5 if fcff_complete else False, "assumptions": assumptions}
    missing = []
    if not fcff_complete:
        missing.append("2023-2025 FCFF 完整三年")
    if not owner_complete:
        missing.append("2023-2025 owner FCF 完整三年")
    if not shares or shares <= 0:
        missing.append("核验总股本")
    if base is None or base <= 0 or not shares or shares <= 0:
        status = "negative_owner_fcf" if owner_complete and statistics.median(owner_values) <= 0 else "insufficient_inputs"
        return {**payload, "scenarios": [], "sensitivity": [], "status": status, "missing": missing or ["2023-2025 owner FCF 非正"]}
    balance = records.get("2025-12-31", {})
    balance_fields = ("cash", "short_debt", "long_debt", "bonds")
    net_cash = None
    net_cash_status = "not_verified"
    if all(balance.get(field) is not None for field in balance_fields):
        net_cash = balance["cash"] - balance["short_debt"] - balance["long_debt"] - balance["bonds"]
        net_cash_status = "verified"
    payload["net_cash_CNY"] = net_cash
    payload["net_cash_status"] = net_cash_status
    scenarios, sensitivity = dcf_quotes(base, shares, price, net_cash, base_label, growth_basis["anchor"])
    payload["price_comparable"] = net_cash_status == "verified"
    payload["value_type"] = "equity_value_per_share" if payload["price_comparable"] else "enterprise_value_per_share_before_net_cash"
    if not payload["price_comparable"]:
        missing.append("净现金未核验；每股值不用于和现价比较")
    return {**payload, "scenarios": scenarios, "sensitivity": sensitivity, "status": "research_hypothesis", "missing": missing}


def _sample_monitor_snapshot(companies, period, rows):
    """只聚合同一报告期且有值的上市样本，保留覆盖度，避免把样本合计冒充行业总量。"""
    rows = [row for row in rows if row]
    def total(field):
        values = [row.get(field) for row in rows if row.get(field) is not None]
        return (sum(values), len(values)) if values else (None, 0)
    def median(field):
        values = [row.get(field) for row in rows if row.get(field) is not None]
        return (statistics.median(values), len(values)) if values else (None, 0)
    revenue, revenue_count = total("revenue")
    net_profit, profit_count = total("net_profit")
    cfo, cfo_count = total("cfo")
    owner_fcf, owner_count = total("owner_fcf")
    inventory, inventory_count = total("inventory")
    contract_liabilities, contract_count = total("contract_liabilities")
    operating_margin, margin_count = median("operating_margin")
    sales_cash_ratio, cash_ratio_count = median("sales_cash_ratio")
    negative_owner = sum(1 for row in rows if row.get("owner_fcf") is not None and row["owner_fcf"] < 0)
    return {
        "period": period, "sample_count": len(companies), "rows_with_data": len(rows),
        "revenue_CNY": revenue, "net_profit_CNY": net_profit, "cfo_CNY": cfo, "owner_fcf_CNY": owner_fcf,
        "inventory_CNY": inventory, "contract_liabilities_CNY": contract_liabilities,
        "median_operating_margin_pct": operating_margin, "median_sales_cash_ratio_pct": sales_cash_ratio,
        "negative_owner_fcf_count": negative_owner,
        "coverage": {"revenue": revenue_count, "net_profit": profit_count, "cfo": cfo_count, "owner_fcf": owner_count, "inventory": inventory_count, "contract_liabilities": contract_count, "operating_margin": margin_count, "sales_cash_ratio": cash_ratio_count},
    }


def _sample_monitoring(companies):
    annual_2025 = [next((row for row in c["annual"] if row.get("year") == 2025), None) for c in companies]
    annual_2024 = [next((row for row in c["annual"] if row.get("year") == 2024), None) for c in companies]
    quarterly = {}
    for company in companies:
        for row in company.get("quarterly", []):
            quarterly.setdefault(row.get("report_date"), []).append(row)
    quarter_dates = sorted(quarterly)
    latest_date = quarter_dates[-1] if quarter_dates else None
    prior_date = None
    if latest_date:
        prior_date = next((day for day in reversed(quarter_dates) if day[:4] == str(int(latest_date[:4]) - 1) and day[5:] == latest_date[5:]), None)
    latest = _sample_monitor_snapshot(companies, latest_date, quarterly.get(latest_date, [])) if latest_date else None
    prior = _sample_monitor_snapshot(companies, prior_date, quarterly.get(prior_date, [])) if prior_date else None
    full_year = {"2025": _sample_monitor_snapshot(companies, "2025A", annual_2025), "2024": _sample_monitor_snapshot(companies, "2024A", annual_2024)}
    signals = []
    if latest and prior:
        for key, label in (("revenue_CNY", "样本营收同比"), ("net_profit_CNY", "样本净利同比"), ("cfo_CNY", "样本经营现金流同比"), ("inventory_CNY", "样本存货同比"), ("contract_liabilities_CNY", "样本合同负债同比")):
            current, previous = latest.get(key), prior.get(key)
            yoy = (current / previous - 1) * 100 if current is not None and previous not in (None, 0) else None
            coverage_key = key.replace("_CNY", "")
            current_cov = (latest.get("coverage") or {}).get(coverage_key, 0)
            prior_cov = (prior.get("coverage") or {}).get(coverage_key, 0)
            signals.append({"key": key, "label": label, "value": yoy, "unit": "%", "status": "listed_sample_not_industry", "current_coverage": current_cov, "prior_coverage": prior_cov, "matched_coverage": current_cov == prior_cov and current_cov > 0})
    return {
        "scope": "listed_sample_not_industry", "classification": "申万三级白酒Ⅲ 851251.SI",
        "sample_count": len(companies), "latest_ytd": latest, "prior_ytd": prior, "full_year": full_year,
        "signals": signals,
        "note": "监控值是申万白酒Ⅲ上市样本聚合，不代表未上市品牌或全行业；YTD 仅和同报告期 YTD 比较，不年化。",
    }


def build(asof=None):
    asof = asof or date.today().isoformat()
    supplements = supplement_rows()
    share_data = {**total_shares(asof), **verified_shares(asof)}
    evidence_by_code = qualitative_evidence(None, asof)
    companies, prices, prepared = [], {}, []
    for code, name in COMPANIES.items():
        records, annual, quarters, sources, conflicts = metrics_for(code, supplements, asof)
        evidence = evidence_by_code.get(code, {})
        price = latest_price(code, asof)
        if price:
            prices[code] = price
        shares = share_data.get(code)
        dividend = dividend_package(code, asof, price, annual, shares)
        stamp_dividend(annual, dividend)
        company = {"code": code, "name": name, "annual": annual, "quarterly": quarters,
                   "latest": quarters[-1] if quarters else annual[-1],
                   "dcf": dcf(records, annual, price, shares["shares"] if shares else None), "price": price, "shares": shares,
                   "dividend": dividend, "dividends": dividend_observations(code, asof),
                   "provenance": {"fields": sources, "conflicts": conflicts, "qualitative_file": "02_原始资料/verified_qualitative.csv" if evidence else None, "missing": [f"{y}-{field}" for y in YEARS for field in DISPLAY if next((r.get(field) for r in annual if r["year"] == y), None) is None], "unit_convention": "amount CNY; margins/ROE/ROIC percentage points; raw quarter income/cashflow cumulative YTD; 2026 interim not annualized"}}
        prepared.append({"company": company, "annual": annual, "sources": sources, "evidence": evidence})
    for item in prepared:
        item["company"]["score"] = score(item["annual"], item["sources"], item["evidence"])
        companies.append(item["company"])
    ranked = sorted((c for c in companies if c["score"]["rankable"]), key=lambda c: (-c["score"]["total"], c["code"]))
    for rank, company in enumerate(ranked, 1):
        company["score"]["rank"] = rank
    for company in companies:
        company["score"].setdefault("rank", None)
    stamp = datetime.now(timezone.utc).isoformat()
    payload = {"generated_at": stamp, "as_of": asof, "companies": companies, "prices": prices, "model": PARAMETERS}
    n = len(companies)
    labels = {"revenue": "营业收入合计", "net_profit": "归母净利润合计", "cfo": "经营现金流合计"}
    sample_series = []
    for field, label in labels.items():
        points = []
        for year in YEARS:
            values = [next((row.get(field) for row in company["annual"] if row["year"] == year), None) for company in companies]
            points.append({"year": year, "value": sum(values) if all(value is not None for value in values) else None,
                           "coverage": sum(value is not None for value in values), "report_date": f"{year}-12-31"})
        sample_series.append({"key": field, "name": f"申万白酒Ⅲ{n}家{label}", "unit": "CNY", "scope": "listed_sample_not_industry",
                              "source": "申万白酒Ⅲ上市公司同一完整年度的 AKShare 财报字段求和；逐项来源见 data.json", "points": points})
    industry = {"generated_at": stamp, "series": [], "sample_series": sample_series, "monitoring": _sample_monitoring(companies), "sample": {"codes": list(COMPANIES), "count": n, "representative": False, "classification": "申万三级白酒Ⅲ 851251.SI", "as_of_constituents": "2026-10-09", "status": "no_verified_industry_aggregate", "note": f"这是申万白酒Ⅲ {n} 家上市公司样本，不是白酒行业总体。未上市的郎酒、剑南春不在其中；顺鑫农业虽在该成分内，但业务含农业。未取得可靠同口径全行业序列。"}, "observations": []}
    return payload, industry


PNL_FIELDS = {
    "revenue": "OPERATE_INCOME", "interest": "INTEREST_INCOME", "total": "TOTAL_OPERATE_INCOME",
    "cogs": "OPERATE_COST", "tax_add": "OPERATE_TAX_ADD", "sale": "SALE_EXPENSE",
    "manage": "MANAGE_EXPENSE", "research": "ME_RESEARCH_EXPENSE", "finance": "FINANCE_EXPENSE",
    "impair_asset": "ASSET_IMPAIRMENT_LOSS", "impair_credit": "CREDIT_IMPAIRMENT_LOSS",
    "operate_profit": "OPERATE_PROFIT", "total_profit": "TOTAL_PROFIT", "tax": "INCOME_TAX",
    "parent": "PARENT_NETPROFIT", "minority": "MINORITY_INTEREST",
}


def write_pnl():
    """年报利润流向。金额为亿元，只取利润表年报，不把中报累计年化。"""
    result = {}
    for code in COMPANIES:
        years = {}
        for row in load_csv(RAW / "income" / f"{code}.csv"):
            if row.get("REPORT_TYPE") != "年报":
                continue
            day = clean_date(row.get("REPORT_DATE"))
            if not day or not day.endswith("12-31"):
                continue
            item = {}
            for key, col in PNL_FIELDS.items():
                value = number(row.get(col))
                item[key] = round(value / 1e8, 2) if value is not None else None
            years[day[:4]] = item
        result[code] = {"year_list": sorted(years), "years": years}
    dump(OUT / "pnl.json", result)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="先从 AKShare 采集缺失快照")
    parser.add_argument("--force", action="store_true", help="重新采集全部快照")
    parser.add_argument("--ifind-fill", action="store_true", help="对 AKShare 逐项缺失尝试 iFind 严格回退")
    parser.add_argument("--ifind-limit", type=int, default=None, help="仅试跑前 N 个缺项；不提供则处理全部")
    parser.add_argument("--as-of", default=date.today().isoformat(), help="只使用截至指定日期已披露数据 YYYY-MM-DD")
    args = parser.parse_args(argv)
    if clean_date(args.as_of) != args.as_of:
        parser.error("--as-of 必须是有效 YYYY-MM-DD 日期")
    if args.ifind_limit is not None and args.ifind_limit < 1:
        parser.error("--ifind-limit 必须为正整数")
    result = fetch(args.force) if args.fetch or args.force else 0
    if args.ifind_fill:
        ifind_fill(args.as_of, args.ifind_limit)
    payload, industry = build(args.as_of)
    dump(OUT / "data.json", payload)
    for company in payload["companies"]:
        dump(OUT / "stock_data" / (company["code"] + ".json"), company)
    dump(OUT / "industry.json", industry)
    write_pnl()
    print(f"输出 {len(payload['companies'])} 家；可排名 {sum(c['score']['rankable'] for c in payload['companies'])} 家；可与现价比较的 DCF {sum(c['dcf'].get('price_comparable') is True for c in payload['companies'])} 家")
    return result


if __name__ == "__main__":
    sys.exit(main())
