"""Healthcare V1 financial quality model. All ratios use matching reporting periods."""
import math
from statistics import median

WINDOW = (2023, 2024, 2025)
DIMENSIONS = [("A", "盈利质量", 25), ("B", "现金创造", 25), ("C", "财务缓冲", 20), ("D", "经营韧性", 20), ("E", "利润真实性", 10)]
PROFILES = {
    "制药": {"roe": 18, "margin": 20, "fcf": 12, "receivables": 45},
    "生物制品": {"roe": 20, "margin": 25, "fcf": 12, "receivables": 55},
    "中药": {"roe": 20, "margin": 20, "fcf": 12, "receivables": 35},
    "器械": {"roe": 20, "margin": 20, "fcf": 15, "receivables": 45},
    "CXO": {"roe": 18, "margin": 20, "fcf": 12, "receivables": 45},
    "服务": {"roe": 18, "margin": 12, "fcf": 10, "receivables": 35},
    "流通": {"roe": 12, "margin": 3, "fcf": 2, "receivables": 55},
    "零售": {"roe": 16, "margin": 5, "fcf": 5, "receivables": 25},
}
DEFINITIONS = [
    ("roe", "A", "三年中位ROE", 15, "%", "三年归母净利润 / 平均归母权益，取中位数", "roe"),
    ("adjusted_margin", "A", "三年中位扣非净利率", 10, "%", "三年扣非归母净利润 / 同期营业收入，取中位数", "margin"),
    ("cash_conversion", "B", "三年累计经营现金转化", 10, "倍", "三年CFO合计 / 同期合并净利润合计", None),
    ("fcf_margin", "B", "三年累计自由现金流率", 10, "%", "三年(CFO − 全部资本开支)合计 / 同期营收合计", "fcf"),
    ("positive_fcf", "B", "自由现金流为正年度占比", 5, "%", "三年FCF严格大于零的年数 / 3", None),
    ("liquidity", "C", "三年中位现金流动负债比", 8, "倍", "货币资金 / 流动负债合计，三年中位数；未扣受限资金", None),
    ("leverage", "C", "三年中位资产负债率", 6, "%", "负债合计 / 总资产，三年中位数；越低得分越高", None),
    ("receivables", "C", "三年中位应收收入比", 6, "%", "期末应收账款 / 同期营业收入，三年中位数；不是周转天数", "receivables"),
    ("growth", "D", "三年营收复合增速", 10, "%", "(2025营收 / 2022营收)^(1/3) − 1", None),
    ("positive_adjusted", "D", "扣非盈利年度占比", 10, "%", "三年扣非归母净利润严格大于零的年数 / 3", None),
    ("profit_authenticity", "E", "三年累计扣非归母占比", 10, "倍", "三年扣非归母净利润合计 / 同期归母净利润合计", None),
]


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def ratio(numerator, denominator, multiplier=1):
    return numerator / denominator * multiplier if finite(numerator) and finite(denominator) and denominator > 0 else None


def derive(row, previous=None):
    previous = previous or {}
    for key, numerator, denominator in [
        ("gross_margin", None, None), ("adjusted_margin", "adjusted_profit", "revenue"),
        ("net_margin", "net_profit", "revenue"), ("rd_ratio", "rd_expense", "revenue"),
        ("sales_ratio", "sales_expense", "revenue"), ("leverage", "liabilities", "assets"),
        ("receivables_ratio", "receivables", "revenue"), ("goodwill_equity", "goodwill", "equity"),
    ]:
        if key == "gross_margin":
            row[key] = ratio(row.get("revenue") - row.get("cost"), row.get("revenue"), 100) if finite(row.get("revenue")) and finite(row.get("cost")) else None
        else:
            row[key] = ratio(row.get(numerator), row.get(denominator), 100)
    row["fcf"] = row["cfo"] - row["capex"] if finite(row.get("cfo")) and finite(row.get("capex")) else None
    row["liquidity"] = ratio(row.get("cash"), row.get("current_liabilities"))
    row["cash_conversion"] = ratio(row.get("cfo"), row.get("consolidated_profit"))
    row["roe"] = ratio(row.get("net_profit"), (row["equity"] + previous["equity"]) / 2, 100) if finite(row.get("equity")) and finite(previous.get("equity")) and row["equity"] > 0 and previous["equity"] > 0 else None
    return row


def score(company):
    rows = {int(row["period"][:4]): row for row in company["annual"]}
    window = [rows.get(year, {}) for year in WINDOW]
    profile = PROFILES[company["profile"]]

    def values(key):
        result = [row.get(key) for row in window]
        return result if all(finite(item) for item in result) else None

    def mid(key):
        items = values(key)
        return median(items) if items is not None else None

    def total(key):
        items = values(key)
        return sum(items) if items is not None else None

    def positive(key):
        items = values(key)
        return sum(item > 0 for item in items) / 3 * 100 if items is not None else None

    metrics = {
        "roe": mid("roe"), "adjusted_margin": mid("adjusted_margin"),
        "cash_conversion": ratio(total("cfo"), total("consolidated_profit")),
        "fcf_margin": ratio(total("fcf"), total("revenue"), 100),
        "positive_fcf": positive("fcf"), "liquidity": mid("liquidity"),
        "leverage": mid("leverage"), "receivables": mid("receivables_ratio"),
        "growth": None, "positive_adjusted": positive("adjusted_profit"),
        "profit_authenticity": ratio(total("adjusted_profit"), total("net_profit")),
    }
    base, end = rows.get(2022, {}).get("revenue"), rows.get(2025, {}).get("revenue")
    if finite(base) and finite(end) and base > 0 and end > 0:
        metrics["growth"] = ((end / base) ** (1 / 3) - 1) * 100
    anchors = {"cash_conversion": (0.5, 1.2), "positive_fcf": (0, 100), "liquidity": (0.2, 1.2), "leverage": (80, 20), "growth": (-10, 15), "positive_adjusted": (0, 100), "profit_authenticity": (0.5, 1)}
    details = []
    for key, dimension, label, weight, unit, formula, profile_key in DEFINITIONS:
        zero, full = (profile[profile_key], 5) if key == "receivables" else (0, profile[profile_key]) if profile_key else anchors[key]
        value = metrics[key]
        status = "observed" if finite(value) else "missing"
        points = weight * max(0, min(1, (value - zero) / (full - zero))) if finite(value) else None
        denominator_key = {"cash_conversion": "consolidated_profit", "profit_authenticity": "net_profit"}.get(key)
        if denominator_key and total(denominator_key) is not None and total(denominator_key) <= 0 and total("cfo" if key == "cash_conversion" else "adjusted_profit") is not None:
            status, points = "economic_invalid", 0
        if key == "roe" and value is None and values("net_profit") is not None and values("equity") is not None and any(row["equity"] <= 0 for row in window):
            status, points = "economic_invalid", 0
        details.append({"key": key, "dimension": dimension, "label": label, "weight": weight, "unit": unit, "formula": formula, "zero": zero, "full": full, "value": value, "points": round(points, 4) if points is not None else None, "status": status})

    latest = rows.get(2025, {})
    risks, risk_missing = [], []
    checks = [
        ("最新年归母或扣非亏损", (latest.get("net_profit"), latest.get("adjusted_profit")), lambda x: any(v < 0 for v in x), 49),
        ("连续两年经营现金流为负", (rows.get(2024, {}).get("cfo"), latest.get("cfo")), lambda x: all(v < 0 for v in x), 49),
        ("三年自由现金流合计非正", (total("fcf"),), lambda x: x[0] <= 0, 59),
        ("归母净资产非正", (latest.get("equity"),), lambda x: x[0] <= 0, 39),
    ]
    for label, inputs, test, cap in checks:
        if not all(finite(v) for v in inputs):
            risk_missing.append(label)
        elif test(inputs):
            risks.append({"label": label, "cap": cap, "values": inputs})
    cap = min([r["cap"] for r in risks] + [100])
    known = sum(d["points"] for d in details if d["points"] is not None)
    missing_weight = sum(d["weight"] for d in details if d["points"] is None)
    complete = missing_weight == 0 and not risk_missing
    applicable = company.get("stage") != "biotech"
    return {
        "version": "V1", "years": list(WINDOW), "applicable": applicable,
        "status": "research_only" if not applicable else "complete" if complete else "partial",
        "raw": round(known, 2) if complete and applicable else None,
        "total": round(min(known, cap), 2) if complete and applicable else None,
        "known": round(known, 2) if applicable else None,
        "range": [round(min(known, cap), 2), round(min(known + missing_weight, cap), 2)] if applicable else None,
        "coverage": 100 - missing_weight, "cap": cap, "risks": risks, "risk_missing": risk_missing,
        "details": details,
        "dimensions": [{"key": key, "label": label, "weight": weight, "points": round(sum(d["points"] or 0 for d in details if d["dimension"] == key), 2), "missing": sum(d["weight"] for d in details if d["dimension"] == key and d["points"] is None)} for key, label, weight in DIMENSIONS],
    }
