"""Normalize AKShare statements with field-level evidence and actual fiscal periods."""
import json
import math
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "dashboard" / "data.json"


def load(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def normalize(company):
    code = company["code"]
    periods = {}
    kinds = {}
    for kind in ["income", "cashflow", "balance", "indicators"]:
        path = ROOT / "data" / "akshare" / f"{code}-{kind}.json"
        blob = load(path, {})
        kinds[kind] = blob.get("records", [])
        for row in kinds[kind]:
            day = str(row.get("REPORT_DATE", ""))[:10]
            if len(day) != 10 or day < "2020-01-01" or day > "2026-10-18":
                continue
            period = periods.setdefault(day, {"date": day, "start": None, "annual": False, "values": {}, "evidence": {}})
            start = str(row.get("START_DATE", ""))[:10]
            if len(start) == 10:
                period["start"] = start
            if row.get("DATE_TYPE_CODE") == "001" or "年报" in str(row.get("REPORT_TYPE", "")):
                period["annual"] = True

    def set_value(period, metric, value, kind, fields, note=""):
        if value is None:
            return
        period["values"][metric] = value
        period["evidence"][metric] = {"provider": "AKShare", "file": f"../data/akshare/{code}-{kind}.json",
            "field": fields, "unit": "%" if metric in ["roe", "roic", "liabilities", "grossMargin", "revenueYoY"] else "倍" if metric == "currentRatio" else "股" if metric == "dilutedShares" else "CNY",
            "note": note}

    for day, period in periods.items():
        maps = {}
        for kind in ["income", "cashflow", "balance"]:
            rows = [r for r in kinds[kind] if str(r.get("REPORT_DATE", ""))[:10] == day]
            maps[kind] = {str(r.get("STD_ITEM_NAME") or r.get("ITEM_NAME")): number(r.get("AMOUNT")) for r in rows}
            if kind == "income" and rows:
                row = rows[0]
                if row.get("REPORT_TYPE") == "年报" or "年报" in str(row.get("REPORT", "")):
                    period["annual"] = True

        def get(kind, names):
            for name in names:
                val = maps[kind].get(name)
                if val is not None:
                    return val, name
            return None, " / ".join(names)

        fields = {
            "revenue": ("income", ["营运收入", "营业收入", "营业总收入", "总收入", "营业额"]),
            "profit": ("income", ["股东应占溢利", "归属于母公司股东净利润", "归属于普通股股东净利润", "归属于母公司股东的净利润", "归属母公司净利润", "净利润"]),
            "opProfit": ("income", ["经营溢利", "营业利润", "经营利润", "经营收入"]),
            "grossProfit": ("income", ["毛利", "毛利润"]),
            "cfo": ("cashflow", ["经营业务现金净额", "经营活动产生的现金流量净额", "经营活动现金流量净额", "经营活动产生的现金流量"]),
            "fixedCapex": ("cashflow", ["购建固定资产", "购买固定资产", "购建固定资产、无形资产和其他长期资产支付的现金", "资本支出"]),
            "intangibleCapex": ("cashflow", ["购建无形资产及其他资产", "购买无形资产"]),
            "cash": ("balance", ["现金及等价物", "现金及现金等价物", "现金和现金等价物"]),
            "assets": ("balance", ["总资产", "资产总计", "资产总额"]),
            "debtTotal": ("balance", ["总负债", "负债合计", "负债总计"]),
            "currentAssets": ("balance", ["流动资产合计", "流动资产总计"]),
            "currentDebt": ("balance", ["流动负债合计", "流动负债总计"]),
            "dividends": ("cashflow", ["已付股息(融资)", "支付股利", "已付股息", "支付的股利"]),
            "buybacks": ("cashflow", ["回购股份", "回购普通股", "回购股票"]),
            "sbc": ("cashflow", ["股份支付", "股权激励", "以股份为基础的薪酬", "股份酬金", "股票薪酬", "基于股票的补偿费"]),
            "dilutedShares": ("income", ["摊薄加权平均股数-普通股", "摊薄加权平均股数"]),
        }
        for metric, (kind, names) in fields.items():
            value, field = get(kind, names)
            if metric in ["fixedCapex", "intangibleCapex", "dividends", "buybacks"] and value is not None:
                value = abs(value)
            set_value(period, metric, value, kind, field)
        indicator = next((r for r in kinds["indicators"] if str(r.get("REPORT_DATE", ""))[:10] == day), {})
        if "profit" not in period["values"] and "PARENT_HOLDER_NETPROFIT" in indicator:
            set_value(period, "profit", number(indicator["PARENT_HOLDER_NETPROFIT"]), "indicators", "PARENT_HOLDER_NETPROFIT")
        for metric, raw in {"revenue": "OPERATE_INCOME", "profit": "HOLDER_PROFIT", "revenueYoY": "OPERATE_INCOME_YOY", "roic": "ROIC_YEARLY", "roe": "ROE_AVG", "liabilities": "DEBT_ASSET_RATIO", "currentRatio": "CURRENT_RATIO", "grossMargin": "GROSS_PROFIT_RATIO"}.items():
            if metric not in period["values"]:
                set_value(period, metric, number(indicator.get(raw)), "indicators", raw)
        for extra in load(ROOT / "data" / "supplements.json", []):
            if extra["company"] == company["id"] and extra["date"] == day and extra["metric"] not in period["values"]:
                period["values"][extra["metric"]] = extra["value"]
                period["evidence"][extra["metric"]] = {k: value for k, value in extra.items() if k not in ["company", "date", "metric", "value"]}
        v = period["values"]

        def derived(metric, value, inputs, note):
            if value is None:
                return
            v[metric] = value
            period["evidence"][metric] = {"provider": "计算", "field": ", ".join(inputs), "note": note,
                "inputs": inputs, "unit": "%" if metric.endswith("Margin") or metric == "liabilities" else "倍" if metric == "currentRatio" else "CNY"}

        # Both purchase lines are cash outflows; missing intangible purchases remain explicit.
        if "fixedCapex" in v:
            capex = v["fixedCapex"] + v.get("intangibleCapex", 0)
            derived("capex", capex, ["fixedCapex"] + (["intangibleCapex"] if "intangibleCapex" in v else []),
                    "现金购建固定资产" + (" + 无形及其他资产" if "intangibleCapex" in v else "；未单列无形资产现金支出，范围或不完整"))
        if "cfo" in v and "capex" in v:
            derived("fcf", v["cfo"] - v["capex"], ["cfo", "capex"], "统一代理FCF = CFO - 现金购建资产；并非公司披露FCF")
        for metric, numerator in [("opMargin", "opProfit"), ("netMargin", "profit"), ("fcfMargin", "fcf")]:
            if numerator in v and v.get("revenue", 0) > 0:
                derived(metric, v[numerator] / v["revenue"] * 100, [numerator, "revenue"], "同期间比率")
        if "dividends" in v or "buybacks" in v:
            derived("cashReturn", v.get("dividends", 0) + v.get("buybacks", 0), [m for m in ["dividends", "buybacks"] if m in v], "合并报表现金分配代理值；已付股息可能包含少数股东分配；未单列项目不据此认定为零")
        if "liabilities" not in v and v.get("assets", 0) > 0 and "debtTotal" in v:
            derived("liabilities", v["debtTotal"] / v["assets"] * 100, ["debtTotal", "assets"], "负债总额 / 资产总额")
        if "currentRatio" not in v and v.get("currentDebt", 0) > 0 and "currentAssets" in v:
            derived("currentRatio", v["currentAssets"] / v["currentDebt"], ["currentAssets", "currentDebt"], "流动资产 / 流动负债")
        if period["start"]:
            length = (date.fromisoformat(day) - date.fromisoformat(period["start"])).days
            period["annual"] = 330 <= length <= 380
        period["label"] = ("FY" + day[:4] if company["id"] == "alibaba" else day[:4]) if period["annual"] else day[:7]
    annuals = sorted((p for p in periods.values() if p["annual"] and "revenue" in p["values"]), key=lambda p: p["date"])
    for index, p in enumerate(annuals):
        v = p["values"]
        if index and (date.fromisoformat(p["date"]) - date.fromisoformat(annuals[index - 1]["date"])).days in range(330, 381):
            old = annuals[index - 1]["values"]
            if old.get("revenue", 0) > 0:
                v["revenueYoY"] = (v["revenue"] / old["revenue"] - 1) * 100
                p["evidence"]["revenueYoY"] = {"provider": "计算", "field": "revenue", "unit": "%", "note": "同口径相邻完整财年收入同比", "dates": [annuals[index - 1]["date"], p["date"]]}
            if "opMargin" in v and "opMargin" in old:
                v["opMarginDelta"] = v["opMargin"] - old["opMargin"]
                p["evidence"]["opMarginDelta"] = {"provider": "计算", "field": "opMargin", "unit": "pct", "note": "同口径相邻财年经营利润率之差", "dates": [annuals[index - 1]["date"], p["date"]]}
            if "dilutedShares" in v and old.get("dilutedShares", 0) > 0:
                v["dilution"] = (v["dilutedShares"] / old["dilutedShares"] - 1) * 100
                p["evidence"]["dilution"] = {"provider": "计算", "field": "dilutedShares", "unit": "%", "note": "同口径摊薄加权平均股数同比", "dates": [annuals[index - 1]["date"], p["date"]]}
        if index >= 2:
            old = annuals[index - 2]
            days = (date.fromisoformat(p["date"]) - date.fromisoformat(old["date"])).days
            if 690 <= days <= 770 and old["values"].get("revenue", 0) > 0:
                v["revenueCagr"] = ((v["revenue"] / old["values"]["revenue"]) ** (365.25 / days) - 1) * 100
                p["evidence"]["revenueCagr"] = {"provider": "计算", "field": "revenue", "unit": "%", "note": "实际期间长度计算两年收入CAGR", "dates": [old["date"], p["date"]]}
            window = annuals[index - 2:index + 1]
            if all("fcf" in q["values"] for q in window) and all(330 <= (date.fromisoformat(window[i]["date"]) - date.fromisoformat(window[i - 1]["date"])).days <= 380 for i in [1, 2]):
                v["positiveFcfYears"] = sum(q["values"]["fcf"] > 0 for q in window)
                p["evidence"]["positiveFcfYears"] = {"provider": "计算", "field": "fcf", "unit": "年", "note": "连续三年完整财年代理FCF为正的数量", "dates": [q["date"] for q in window]}
    prices = load(ROOT / "data" / "akshare" / f"{code}-prices.json", {}).get("records", [])
    latest_price = next((r for r in reversed(prices) if str(r.get("日期", ""))[:10] <= "2026-10-16"), None)
    company.update({"currency": "CNY", "priceCurrency": "USD" if code == "PDD" else "HKD", "annuals": annuals,
        "recent": sorted((p for p in periods.values() if not p["annual"] and p["date"] > "2025-12-31" and "revenue" in p["values"]), key=lambda p: p["date"]),
        "price": {"value": latest_price.get("收盘"), "date": str(latest_price.get("日期"))[:10], "provider": "AKShare"} if latest_price else None})
    return company


def main():
    companies = [normalize(c) for c in load(ROOT / "data" / "universe.json")]
    payload = {"version": "V1.0", "asOf": "2026-10-18", "sourcePriority": ["AKShare", "官方财报PDF", "iFinD"],
        "companies": companies, "research": load(ROOT / "data" / "research.json", []),
        "official": load(ROOT / "data" / "official.json", []),
        "supplements": load(ROOT / "data" / "supplements.json", []),
        "collection": load(ROOT / "data" / "akshare" / "run.json", {})}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({c["short"]: {"annuals": len(c["annuals"]), "latest": c["annuals"][-1]["date"] if c["annuals"] else None} for c in companies}, ensure_ascii=False))


if __name__ == "__main__":
    main()
