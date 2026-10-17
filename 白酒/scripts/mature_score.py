"""Absolute, five-year financial quality rubric for mature consumer businesses."""
import math
import statistics


# Anchors are research assumptions, not empirically calibrated investment signals.
METRICS = {
    "roa_median": ("总资产收益率中位数", "%", 0, 15, "合并净利润 / 平均总资产 × 100；五年中位数"),
    "operating_margin_median": ("营业利润率中位数", "%", 0, 35, "会计营业利润 / 营业收入 × 100；五年中位数"),
    "margin_floor": ("利润率低谷保持率", "x", 0, .85, "五年最低营业利润率 / 五年中位营业利润率；中位数非正计零"),
    "cfo_conversion": ("累计经营现金转化", "x", .5, 1, "五年经营现金流合计 / 五年合并净利润合计"),
    "fcf_conversion": ("累计自由现金转化", "x", 0, .9, "五年(经营现金流 - 全部资本开支)合计 / 五年合并净利润合计"),
    "fcf_positive_ratio": ("自由现金流正值年占比", "%", 40, 100, "五年 CFO - 全部资本开支 > 0 的年度数 / 5 × 100"),
    "cash_buffer_median": ("现金覆盖中位数", "%", 20, 150, "货币资金 / 流动负债 × 100；五年中位数，含合同负债、未扣受限资金"),
    "other_receivables_median": ("其他应收占资产", "%", 5, .5, "其他应收款合计 / 总资产 × 100；五年中位数"),
    "payout_cumulative": ("累计派现率", "%", 0, 60, "五年按利润归属年汇总的已实施现金分红 / 同期归母净利润合计 × 100"),
    "dividend_fcf_coverage": ("分红的自由现金覆盖", "x", 0, 1.2, "同一五年窗口 CFO - 全部资本开支合计 / 归属年度现金分红合计"),
    "dividend_consistency": ("分红连续性", "%", 0, 100, "五年有已实施现金分红的年度数 / 5 × 100"),
    "revenue_worst_yoy": ("最差年度营收同比", "%", -30, 0, "五年中最差的相邻年度营收同比；窗口首年另取前一年作比较"),
    "profit_positive_ratio": ("归母盈利年占比", "%", 40, 100, "五年归母净利润 > 0 的年度数 / 5 × 100"),
}
DIMENSIONS = [
    ("盈利持续性", 25, [("roa_median", 10), ("operating_margin_median", 10), ("margin_floor", 5)]),
    ("现金创造", 25, [("cfo_conversion", 10), ("fcf_conversion", 10), ("fcf_positive_ratio", 5)]),
    ("财务缓冲", 15, [("cash_buffer_median", 8), ("other_receivables_median", 7)]),
    ("股东回报", 20, [("payout_cumulative", 8), ("dividend_fcf_coverage", 7), ("dividend_consistency", 5)]),
    ("经营韧性", 15, [("revenue_worst_yoy", 7), ("profit_positive_ratio", 8)]),
]
REFERENCES = ["product_mix", "channel_health", "cycle_resilience", "capital_allocation", "governance"]
SCORING_PARAMETERS = {
    "version": "V4.0-mature-financial-quality",
    "dimensions": DIMENSIONS,
    "score_anchors": {key: [spec[2], spec[3]] for key, spec in METRICS.items()},
    "metric_definitions": {key: {"label": spec[0], "unit": spec[1], "formula": spec[4]} for key, spec in METRICS.items()},
    "lower_is_better": ["other_receivables_median"],
    "qualitative_indicators": REFERENCES,
    "window_years": 5,
    "method": "absolute_anchors_no_peer_bonus",
    "risk_rules": [
        {"key": "latest_loss", "label": "最新完整年归母亏损", "cap": 49},
        {"key": "two_negative_cfo", "label": "连续两年经营现金流为负", "cap": 49},
        {"key": "three_year_negative_fcf", "label": "最近三年自由现金流合计非正", "cap": 59},
        {"key": "negative_equity", "label": "最新完整年净资产非正", "cap": 39},
    ],
    "style": {"quality_min": 80, "cheap_upside": .20, "growth_dimension": "经营韧性", "growth_weak_below": .5},
    "research_sources": [
        {"name": "Damodaran：增长、再投资与资本回报", "url": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/a7.htm"},
        {"name": "Damodaran：永续增长与再投资的一致性", "url": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/a11.htm"},
        {"name": "Coca-Cola 2025 Form 10-K：销量、渠道与现金流", "url": "https://investors.coca-colacompany.com/filings-reports/all-sec-filings/content/0001628280-26-010047/ko-20251231.htm"},
    ],
}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def score_mature(annual, sources=None, evidence=None):
    rows = {r["year"]: r for r in annual if r.get("year") is not None}
    observed_years = [year for year, row in rows.items() if any(finite(row.get(k)) for k in ("revenue", "net_profit", "cfo"))]
    year = max(observed_years) if observed_years else None
    years = list(range(year - 4, year + 1)) if year is not None else []
    window = [rows.get(y, {}) for y in years]
    values, states, counts = {}, {}, {}

    def series(field):
        return [row.get(field) for row in window]

    def complete(vals):
        return len(vals) == 5 and all(finite(v) for v in vals)

    def put(key, value, vals, status="scored"):
        counts[key] = sum(finite(v) for v in vals)
        values[key] = value if complete(vals) and finite(value) else None
        states[key] = status if values[key] is not None else "missing"

    def median(key, field):
        vals = series(field)
        put(key, statistics.median(vals) if complete(vals) else None, vals)

    median("roa_median", "roa")
    median("operating_margin_median", "operating_margin")
    median("cash_buffer_median", "cash_to_current_liab")
    median("other_receivables_median", "other_receivables_to_asset")
    margins = series("operating_margin")
    mid = statistics.median(margins) if complete(margins) else None
    put("margin_floor", min(margins) / mid if mid is not None and mid > 0 else 0, margins,
        "economic_invalid" if mid is not None and mid <= 0 else "scored")
    cfo, profit, parent = series("cfo"), series("consolidated_net_profit"), series("net_profit")
    fcf = [r.get("owner_fcf") if finite(r.get("owner_fcf")) else r["cfo"] - r["capex"]
           if finite(r.get("cfo")) and finite(r.get("capex")) else None for r in window]
    dividends = series("dividend_cash_CNY")
    for key, cash in (("cfo_conversion", cfo), ("fcf_conversion", fcf)):
        valid = complete(cash) and complete(profit)
        denominator = sum(profit) if valid else None
        vals = [a if finite(a) and finite(b) else None for a, b in zip(cash, profit)]
        put(key, sum(cash) / denominator if valid and denominator > 0 else 0, vals,
            "economic_invalid" if valid and denominator <= 0 else "scored")
    put("fcf_positive_ratio", sum(finite(v) and v > 0 for v in fcf) / 5 * 100, fcf)
    put("profit_positive_ratio", sum(finite(v) and v > 0 for v in parent) / 5 * 100, parent)
    valid_payout = complete(parent) and complete(dividends)
    put("payout_cumulative", sum(dividends) / sum(parent) * 100 if valid_payout and sum(parent) > 0 else 0,
        [a if finite(a) and finite(b) else None for a, b in zip(dividends, parent)],
        "economic_invalid" if valid_payout and sum(parent) <= 0 else "observed_zero" if valid_payout and sum(dividends) == 0 else "scored")
    valid_cover = complete(fcf) and complete(dividends)
    put("dividend_fcf_coverage", sum(fcf) / sum(dividends) if valid_cover and sum(dividends) > 0 else 0,
        [a if finite(a) and finite(b) else None for a, b in zip(dividends, fcf)],
        "observed_zero" if valid_cover and sum(dividends) == 0 else "scored")
    put("dividend_consistency", sum(finite(v) and v > 0 for v in dividends) / 5 * 100, dividends,
        "observed_zero" if complete(dividends) and sum(dividends) == 0 else "scored")
    changes = []
    for y, row in zip(years, window):
        current, previous = row.get("revenue"), rows.get(y - 1, {}).get("revenue")
        changes.append((current / previous - 1) * 100 if finite(current) and finite(previous) and previous > 0 else None)
    put("revenue_worst_yoy", min(changes) if complete(changes) else None, changes)

    dims = []
    for name, weight, specs in DIMENSIONS:
        items = []
        for key, maximum in specs:
            label, unit, zero, full, formula = METRICS[key]
            value = values.get(key)
            points = round(maximum * max(0, min(1, (value - zero) / (full - zero))), 4) if value is not None else None
            if states[key] == "economic_invalid":
                points = 0.0
            items.append({"name": key, "label": label, "unit": unit, "value": value, "score": points,
                          "absolute_score": points, "relative_percentile": None, "max": maximum,
                          "zero_line": zero, "full_line": full, "status": states[key], "method": formula,
                          "valid_years": counts[key], "window": years,
                          "source": f"{years[0]}–{years[-1]} 同口径年度报表与已实施派息记录；{formula}" if years else None})
        dims.append({"name": name, "weight": weight,
                     "score": round(sum(i["score"] for i in items), 4) if all(i["score"] is not None for i in items) else None,
                     "items": items})

    latest = rows.get(year, {})
    missing = [i["name"] for d in dims for i in d["items"] if i["score"] is None]
    available = sum(i["max"] for d in dims for i in d["items"] if i["score"] is not None)
    known = sum(i["score"] for d in dims for i in d["items"] if i["score"] is not None)
    equity = latest.get("total_assets") - latest.get("total_liabilities") if finite(latest.get("total_assets")) and finite(latest.get("total_liabilities")) else None
    risks, risk_missing = [], []
    checks = [
        ("latest_loss", finite(latest.get("net_profit")), finite(latest.get("net_profit")) and latest["net_profit"] < 0),
        ("two_negative_cfo", len(cfo) >= 2 and all(finite(v) for v in cfo[-2:]), len(cfo) >= 2 and all(finite(v) and v < 0 for v in cfo[-2:])),
        ("three_year_negative_fcf", len(fcf) >= 3 and all(finite(v) for v in fcf[-3:]), len(fcf) >= 3 and all(finite(v) for v in fcf[-3:]) and sum(fcf[-3:]) <= 0),
        ("negative_equity", finite(equity), finite(equity) and equity <= 0),
    ]
    rules = {r["key"]: r for r in SCORING_PARAMETERS["risk_rules"]}
    for key, valid, triggered in checks:
        if not valid:
            risk_missing.append(key)
        elif triggered:
            risks.append(rules[key])
    cap = min((r["cap"] for r in risks), default=100)
    rankable = bool(years and not missing and not risk_missing)
    raw = round(known, 2) if not missing and years else None
    flags = [f"{r['label']}，总分上限 {r['cap']}" for r in risks]
    if missing:
        flags.append(f"{len(missing)} 个评分项缺失，不进入排名")
    if risk_missing:
        flags.append("风险闸门资料不足")
    return {
        "version": SCORING_PARAMETERS["version"], "annual_year": year, "window_years": years,
        "total": round(min(known, cap), 2) if rankable else None, "raw_total": raw,
        "observed_total": raw, "known_points": round(known, 2), "max_total": 100,
        "score_range": [round(min(known, cap), 2), round(min(known + 100 - available, cap), 2)] if years else None,
        "risk_cap": cap, "risk_gates": risks, "risk_missing": risk_missing,
        "rankable": rankable, "coverage": available / 100, "dimensions": dims, "missing": missing,
        "quality_flags": flags, "negative_years": [r for r in window if finite(r.get("net_profit")) and r["net_profit"] < 0],
        "references": [{"name": k, "evidence": (evidence or {}).get(k, []), "status": "reference"} for k in REFERENCES],
        "financial_proxies_unscored": {k: latest.get(k) / latest["revenue"] if finite(latest.get(k)) and finite(latest.get("revenue")) and latest["revenue"] > 0 else None for k in ("contract_liabilities", "inventory", "receivables", "sales_expense")},
        "universe_stats": {"method": "absolute_anchors_no_peer_bonus", "peer_count": 0},
        "assumptions": "V4 五年财务质量分；固定绝对阈值，不使用同行百分位。ROA 不等于 ROIC 或品牌价值。自由现金流为 CFO 减全部资本开支的简化代理。分红按归属年度对齐、仅计已实施记录。亏损和已核验零值不当作缺项；缺项不补零、不归一化。风险闸门约束总分。权重及锚点为未经收益回测的研究假设；质量、品牌渠道证据、景气和估值独立。",
    }
