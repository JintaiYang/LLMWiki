"""Shared V5 financial-quality calculation approved from the book-based design."""
import math
import statistics


DIMENSIONS = [
    ("盈利质量", 25, [("operating_margin", 10, 0, 35), ("roa", 8, 0, 15), ("nonrecurring", 7, 30, 0)]),
    ("现金创造", 30, [("cfo_conversion", 12, .5, 1), ("fcf_conversion", 10, 0, .9), ("cfo_positive", 8, 60, 100)]),
    ("家底质量", 25, [("liquidity", 10, 0, 1), ("other_receivables", 8, 5, .5), ("receivables", 7, 15, 1)]),
    ("经营韧性", 10, [("revenue_cagr", 5, 0, 10), ("worst_revenue_yoy", 5, -30, 0)]),
    ("股东回报", 10, [("payout", 6, 0, 60), ("dividend_consistency", 4, 0, 100)]),
]

def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def anchor(value, zero, full):
    return max(0, min(1, (value - zero) / (full - zero)))


def score_book(annual):
    rows = {int(r["year"]): r for r in annual if r.get("year") is not None}
    observed = [y for y, r in rows.items() if any(finite(r.get(k)) for k in ("revenue", "net_profit", "cfo"))]
    latest_year = max(observed) if observed else None
    years = list(range(latest_year - 4, latest_year + 1)) if latest_year is not None else []
    window = [rows.get(y, {}) for y in years]
    values = {}

    def complete(seq):
        return len(seq) == 5 and all(finite(v) for v in seq)

    def series(field):
        return [r.get(field) for r in window]

    def put(key, seq, calculate, invalid=False):
        valid = complete(seq)
        values[key] = {"value": 0 if valid and invalid else calculate(seq) if valid else None,
                       "status": "economic_invalid" if valid and invalid else "scored" if valid else "missing",
                       "valid_years": sum(finite(v) for v in seq)}

    put("operating_margin", series("operating_margin"), statistics.median)
    put("roa", series("roa"), statistics.median)
    parent = series("net_profit")
    invalid_parent = complete(parent) and (sum(parent) <= 0 or parent[-1] < 0)
    dependence = []
    for row in window:
        profit, deducted = row.get("net_profit"), row.get("deduct_profit")
        ratio = row.get("nonrecurring_ratio")
        if finite(profit) and profit != 0 and finite(deducted):
            ratio = max(0, (profit - deducted) / abs(profit) * 100)
        dependence.append(ratio)
    matched_dependence = [a if finite(a) and finite(b) else None for a, b in zip(dependence, parent)]
    put("nonrecurring", parent if invalid_parent else matched_dependence,
        lambda xs: max(statistics.median(xs), xs[-1]), invalid_parent)

    cfo, consolidated = series("cfo"), series("consolidated_net_profit")
    fcf = [r["cfo"] - r["capex"] if finite(r.get("cfo")) and finite(r.get("capex")) and r["capex"] >= 0 else None for r in window]
    for key, cash in (("cfo_conversion", cfo), ("fcf_conversion", fcf)):
        matched = [a if finite(a) and finite(b) else None for a, b in zip(cash, consolidated)]
        invalid = complete(matched) and sum(consolidated) <= 0
        put(key, matched, lambda xs: sum(xs) / sum(consolidated), invalid)
    put("cfo_positive", cfo, lambda xs: sum(x > 0 for x in xs) / 5 * 100)

    liquidity = []
    components = []
    for r in window:
        cash, current, inventory, liabilities = (r.get(k) for k in ("cash", "current_assets", "inventory", "current_liabilities"))
        if not all(finite(v) for v in (cash, current, inventory, liabilities)) or liabilities < 0:
            liquidity.append(None)
            components.append(None)
            continue
        quick = current - inventory
        if liabilities == 0:
            factor = 1 if cash >= 0 and quick >= 0 else 0
            components.append({"current_liabilities": 0, "confirmed_no_current_liabilities": True})
        else:
            cash_ratio, quick_ratio = cash / liabilities * 100, quick / liabilities * 100
            factor = min(anchor(cash_ratio, 20, 100), anchor(quick_ratio, 50, 150))
            components.append({"cash_ratio_pct": cash_ratio, "quick_ratio_pct": quick_ratio})
        liquidity.append(factor)
        components[-1].update(year=r.get('year'), factor=factor)
    put("liquidity", liquidity, lambda xs: min(statistics.median(xs), xs[-1]))
    for key, field in (("other_receivables", "other_receivables_to_asset"), ("receivables", "receivables_to_revenue")):
        put(key, series(field), lambda xs: max(statistics.median(xs), xs[-1]))

    changes = []
    for y in years:
        current, previous = rows.get(y, {}).get("revenue"), rows.get(y - 1, {}).get("revenue")
        changes.append((current / previous - 1) * 100 if finite(current) and finite(previous) and previous > 0 else None)
    put("worst_revenue_yoy", changes, min)
    start = rows.get(years[0] - 1, {}).get("revenue") if years else None
    finish = window[-1].get("revenue") if window else None
    valid_growth = complete(changes) and finite(start) and start > 0 and finite(finish) and finish > 0
    put("revenue_cagr", changes if valid_growth else [None] * 5,
        lambda _: ((finish / start) ** (1 / 5) - 1) * 100)

    dividends = series("dividend_cash_CNY")
    matched = [a if finite(a) and a >= 0 and finite(b) else None for a, b in zip(dividends, parent)]
    invalid_payout = complete(matched) and sum(parent) <= 0
    put("payout", matched, lambda xs: sum(xs) / sum(parent) * 100, invalid_payout)
    put("dividend_consistency", [v if finite(v) and v >= 0 else None for v in dividends], lambda xs: sum(v > 0 for v in xs) / 5 * 100)
    if complete(matched) and sum(matched) == 0 and not invalid_payout:
        values["payout"]["status"] = "observed_zero"
        values["dividend_consistency"]["status"] = "observed_zero"

    dimensions = []
    for name, maximum, specs in DIMENSIONS:
        items = []
        for key, weight, zero, full in specs:
            item = values[key]
            points = None if item["value"] is None else 0 if item["status"] == "economic_invalid" else weight * anchor(item["value"], zero, full)
            items.append({"key": key, "max": weight, "zero": zero, "full": full, **item,
                          "score": round(points, 6) if points is not None else None})
        dimensions.append({"name": name, "max": maximum, "items": items,
                           "score": sum(i["score"] for i in items) if all(i["score"] is not None for i in items) else None})

    latest = window[-1] if window else {}
    assets, liabilities = latest.get("total_assets"), latest.get("total_liabilities")
    equity = assets - liabilities if finite(assets) and finite(liabilities) else None
    checks = [
        ("latest_loss", "最新年归母亏损", 49, finite(latest.get("net_profit")), finite(latest.get("net_profit")) and latest["net_profit"] < 0),
        ("two_negative_cfo", "连续两年经营现金流为负", 49, len(cfo) >= 2 and all(finite(v) for v in cfo[-2:]), len(cfo) >= 2 and all(finite(v) and v < 0 for v in cfo[-2:])),
        ("negative_equity", "最新年全部净资产非正", 39, finite(equity), finite(equity) and equity <= 0),
    ]
    risks = [{"key": key, "label": label, "cap": cap} for key, label, cap, valid, triggered in checks if valid and triggered]
    risk_missing = [key for key, _, _, valid, _ in checks if not valid]
    cap = min((r["cap"] for r in risks), default=100)
    items = [i for d in dimensions for i in d["items"]]
    missing = [i["key"] for i in items if i["score"] is None]
    covered = sum(i["max"] for i in items if i["score"] is not None)
    known = sum(i["score"] for i in items if i["score"] is not None)
    valid = bool(years and not missing and not risk_missing)
    observations = []
    if len(fcf) >= 3 and all(finite(v) for v in fcf[-3:]) and sum(fcf[-3:]) <= 0:
        observations.append("最近三年简化 FCF 合计非正；需区分扩产与经营问题，未自动压分")
    if len(parent) == 5 and finite(parent[-1]) and parent[-1] > 0 and finite(dependence[-1]) and dependence[-1] > 100:
        observations.append("最新年归母盈利但扣非归母亏损，需核查收益来源")
    return {"version": "V5.0-book-financial-quality", "years": years, "dimensions": dimensions,
            "raw_total": round(known, 2) if not missing and years else None,
            "total": round(min(known, cap), 2) if valid else None, "rankable": valid,
            "known_points": round(known, 2), "coverage": covered / 100,
            "score_range": [0 if risk_missing else round(min(known, cap), 2), round(min(known + 100 - covered, cap), 2)],
            "missing": missing, "risk_cap": cap, "risk_gates": risks, "risk_missing": risk_missing,
            "observations": observations, "liquidity_components": components,
            "strict_safety_status": "unverified",
            "safety_pending": ["受限现金与现金等价物", "全部有息债务及到期结构", "审计与持续经营", "资金占用、担保及或有事项"]}


