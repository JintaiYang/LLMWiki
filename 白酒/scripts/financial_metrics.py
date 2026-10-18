"""Financial quick-reference metrics, separate from the production scoring rubric."""
import calendar
import math


EXTRA_FIELDS = {
    "management_expense": ("income", ("MANAGE_EXPENSE",)),
    "research_expense": ("income", ("RESEARCH_EXPENSE", "ME_RESEARCH_EXPENSE")),
    "basic_eps": ("income", ("BASIC_EPS",)),
    "cfi": ("cashflow", ("NETCASH_INVEST",)),
    "cff": ("cashflow", ("NETCASH_FINANCE",)),
    "cash_net_increase": ("cashflow", ("CCE_ADD",)),
    "cash_equivalents": ("cashflow", ("END_CCE",)),
    "fixed_assets": ("balance", ("FIXED_ASSET",)),
    "construction_in_progress": ("balance", ("CIP",)),
    "total_equity": ("balance", ("TOTAL_EQUITY",)),
}

# Unit "亿元" is a display conversion only; stored monetary amounts remain CNY.
GROUPS = [
    ("profit", "盈利成长", [
        ("revenue", "营业收入", "亿元", "利润表营业收入；不混用营业总收入"),
        ("consolidated_net_profit", "合并净利润", "亿元", "合并净利润，包含少数股东损益"),
        ("net_profit", "归母净利润", "亿元", "归属于母公司股东的净利润"),
        ("deduct_profit", "扣非归母净利", "亿元", "采用利润表披露的扣非归母净利润，不以投资收益机械替代"),
        ("gross_margin", "毛利率", "%", "(营业收入 - 营业成本) / 营业收入 × 100"),
        ("operating_margin", "营业利润率", "%", "报表营业利润 / 营业收入 × 100；可能包含投资及公允价值收益"),
        ("consolidated_net_margin", "合并净利率", "%", "合并净利润 / 营业收入 × 100"),
        ("net_margin", "归母净利率", "%", "归母净利润 / 营业收入 × 100，与合并净利率区分"),
        ("nonrecurring_ratio", "正向非经常收益依赖", "%", "max(0, (归母净利 - 扣非归母净利) / |归母净利|) × 100；零利润不计算"),
        ("revenue_cagr_3y", "营收三年 CAGR", "%", "(本年营业收入 / 三年前营业收入)^(1/3) - 1；正数基础，间隔三年"),
        ("profit_cagr_3y", "归母净利三年 CAGR", "%", "(本年归母净利 / 三年前归母净利)^(1/3) - 1；两端均为正才计算"),
        ("basic_eps", "基本每股收益", "元 / 股", "采用财报披露的基本 EPS，非归母净利直接除以年末股数"),
    ]),
    ("returns", "回报周转", [
        ("roa", "总资产收益率 ROA", "%", "合并净利润 / 期初期末平均总资产 × 100"),
        ("roe", "归母 ROE", "%", "归母净利润 / 期初期末平均归母权益 × 100"),
        ("consolidated_roe", "合并 ROE", "%", "合并净利润 / 平均全部权益 × 100；权益需为正"),
        ("equity_multiplier", "权益乘数", "倍", "平均总资产 / 平均全部权益，与合并 ROE 的口径匹配"),
        ("asset_turnover", "总资产周转率", "次", "营业收入 / 期初期末平均总资产"),
        ("receivables_turnover", "应收账款周转率", "次", "营业收入 / 平均应收账款净额；不含票据及合同资产"),
        ("receivables_days", "应收账款周转天数", "天", "当年实际天数 / 应收账款周转率；非每张欠条的真实账龄"),
        ("inventory_turnover", "存货周转率", "次", "营业成本 / 平均存货；不以营业收入代替成本"),
        ("inventory_days", "存货周转天数", "天", "当年实际天数 / 存货周转率；需结合基酒、成品酒结构"),
        ("fixed_asset_turnover", "固定资产周转率", "次", "营业收入 / 平均固定资产净额；折旧后的低账面额会影响解释"),
    ]),
    ("expenses", "费用投入", [
        ("sales_expense_ratio", "销售费用率", "%", "销售费用 / 营业收入 × 100"),
        ("management_expense_ratio", "管理费用率", "%", "管理费用 / 营业收入 × 100"),
        ("research_expense_ratio", "研发费用率", "%", "费用化研发费用 / 营业收入 × 100；单列项目优先，历史管理费用子项备选，留意口径变化；不含资本化研发，缺项不按零"),
        ("finance_expense_ratio", "财务费用率", "%", "财务费用 / 营业收入 × 100；净财务收益可为负，不代表无借款"),
        ("capex", "资本开支", "亿元", "购建固定资产、无形资产和其他长期资产支付的现金，使用正数"),
        ("capex_intensity", "资本开支强度", "%", "资本开支 / 营业收入 × 100；未区分维持与扩张"),
        ("capex_to_cfo", "资本开支 / CFO", "%", "资本开支 / 经营现金流 × 100；CFO 非正时不计算"),
        ("fixed_construction_ratio", "固定资产与在建占比", "%", "(固定资产净额 + 在建工程) / 总资产 × 100；不含土地等，不称完整生产资产占比"),
    ]),
    ("cash", "现金质量", [
        ("cfo", "经营现金流 CFO", "亿元", "经营活动产生的现金流量净额，合并口径"),
        ("cfi", "投资现金流 CFI", "亿元", "投资活动产生的现金流量净额，保留负号"),
        ("cff", "筹资现金流 CFF", "亿元", "筹资活动产生的现金流量净额，保留分红与偿债等影响"),
        ("cash_net_increase", "现金及等价物净增加额", "亿元", "现金流量表披露净增加额，包含汇率等影响，不用三类现金流简单猜测"),
        ("cash_equivalents", "期末现金及现金等价物", "亿元", "现金流量表期末余额，不等同资产负债表货币资金"),
        ("cashflow_profit", "净现比（合并）", "倍", "经营现金流 / 合并净利润；合并净利润非正时不计算"),
        ("cashflow_profit_3y", "三年累计净现比", "倍", "连续三年 CFO 合计 / 同期合并净利润合计，非年度比率平均"),
        ("sales_cash_ratio", "销售收现比", "%", "销售商品及提供劳务收到现金 / 营业收入 × 100；含税、预收及跨期回款影响"),
        ("cfo_to_revenue", "经营现金流 / 营收", "%", "CFO / 营业收入 × 100"),
        ("owner_fcf", "资本开支后现金余量", "亿元", "CFO - 全部资本开支，简化 FCF；非严格 FCFF/FCFE 或可分红金额"),
        ("free_cashflow_profit", "现金余量 / 合并净利", "倍", "(CFO - 全部资本开支) / 合并净利润；利润非正时不计算"),
        ("free_cashflow_margin", "现金余量 / 营收", "%", "(CFO - 全部资本开支) / 营业收入 × 100"),
    ]),
    ("balance", "安全结构", [
        ("total_assets", "总资产", "亿元", "合并资产负债表期末总资产"),
        ("total_liabilities", "总负债", "亿元", "合并总负债，包含无息负债及合同负债"),
        ("parent_equity", "归母权益", "亿元", "归属于母公司所有者的期末权益"),
        ("total_equity", "全部权益", "亿元", "合并期末全部权益，包含少数股东权益"),
        ("debt_to_asset", "资产负债率", "%", "总负债 / 总资产 × 100，不等同有息负债率"),
        ("current_ratio", "流动比率", "倍", "流动资产 / 流动负债，正分母才计算"),
        ("quick_ratio_multiple", "速动比率（简式）", "倍", "(流动资产 - 存货) / 流动负债，未进一步剔除预付等项目"),
        ("cash", "货币资金", "亿元", "资产负债表披露余额，未扣受限资金，不称可动用现金"),
        ("cash_to_current_liab", "货币资金 / 流动负债", "%", "货币资金 / 流动负债 × 100，不称现金短债覆盖"),
        ("cfo_to_current_liab", "CFO / 流动负债", "%", "年度 CFO / 期末流动负债 × 100"),
    ]),
    ("channel", "资产渠道", [
        ("inventory", "厂商存货", "亿元", "厂家合并存货账面额，不等于经销商库存"),
        ("receivables", "应收账款", "亿元", "应收账款净额，未合并应收票据和合同资产"),
        ("other_receivables", "其他应收款", "亿元", "其他应收款合计，需结合性质核查，不直接认定资金占用"),
        ("payables", "应付账款", "亿元", "经营性应付账款，仍有支付义务"),
        ("contract_liabilities", "合同负债", "亿元", "预收及待履约义务，需结合直销占比、政策与交付节奏"),
        ("receivables_to_revenue", "应收账款 / 营收", "%", "期末应收账款净额 / 年度营业收入 × 100"),
        ("other_receivables_to_asset", "其他应收 / 总资产", "%", "期末其他应收款 / 总资产 × 100"),
        ("inventory_to_revenue", "厂商存货 / 营收", "%", "期末存货 / 年度营业收入 × 100；不同于存货周转率"),
        ("contract_to_revenue", "合同负债 / 营收", "%", "期末合同负债 / 年度营业收入 × 100，不单向判断渠道强弱"),
    ]),
    ("shareholder", "股东估值", [
        ("dps", "每股现金分红", "元 / 股", "按利润归属年度汇总、截至研究日已实施的每股现金分红"),
        ("dividend_cash_CNY", "现金分红总额", "亿元", "同一利润归属年度的已实施金额，无记录保留缺失"),
        ("payout_pct", "年度派现率", "%", "归属年度现金分红 / 归母净利润 × 100；利润非正不计算"),
        ("dividend_yield_year_end", "年末价对应股息率", "%", "归属年度已实施分红 / 同年末收盘价；事后财报口径，非当时已知股息率"),
        ("year_end_price", "年末收盘价", "元 / 股", "同一自然年最后一个实际交易日的未复权收盘价，不跨年借价"),
        ("year_end_pe", "年末 PE（年报 EPS）", "倍", "同年末收盘价 / 披露的基本 EPS；事后财报口径，非历史时点可得 TTM PE；EPS 非正不计算"),
    ]),
]

PENDING = [
    ("有息负债率", "需完整短借、长借、债券、租赁、到期部分及其他融资，核对重复计算"),
    ("现金短债覆盖", "需可动用现金、受限明细及全部短期到期有息债务，不能以流动负债代替"),
    ("现金总债覆盖", "需完整有息债务；无有息债应标明状态，不用无穷大"),
    ("受限资金比例", "需货币资金受限附注、限制性质和解除时间"),
    ("利息保障倍数", "需一致的 EBIT、费用化与资本化利息及财务子公司范围"),
    ("坏账准备覆盖", "需应收账面余额、对应减值准备与账龄明细，不能用净额替代"),
    ("年末 PB", "需各年末真实股数及归母权益；不倒填当前股数或以股本金额猜股数"),
    ("严格生产资产占比", "需按一致定义拆出土地等资产；已另列固定资产与在建的部分口径"),
    ("严格 ROIC", "需完整有息债、净经营资产及超额现金核验，ROE 不代替 ROIC"),
]


def catalog():
    return {"groups": [{"id": key, "label": label, "metrics": [m[0] for m in metrics]} for key, label, metrics in GROUPS],
            "metrics": {key: {"key": key, "label": label, "unit": unit, "formula": formula, "group": group}
                        for group, _, metrics in GROUPS for key, label, unit, formula in metrics},
            "pending": [{"label": label, "reason": reason} for label, reason in PENDING],
            "source_note": "《手把手教你读财报》读书笔记 · 关键财务指标速查；诊断指标独立于财务评分"}


def valid(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def quotient(numerator, denominator, scale=1):
    return numerator / denominator * scale if valid(numerator) and valid(denominator) and denominator > 0 else None


def enrich(row, previous, records, sources, day):
    def add(key, value, formula, unit):
        row[key] = value if valid(value) else None
        if row[key] is not None:
            sources[f"{day}.{key}"] = {"provider": "derived", "formula": formula, "report_date": day, "unit": unit}

    def ratio(key, numerator, denominator, scale=100, unit="%"):
        add(key, quotient(numerator, denominator, scale), catalog_metrics[key]["formula"], unit)

    catalog_metrics = CATALOG["metrics"]
    revenue = row.get("revenue")
    for key, field in (("management_expense_ratio", "management_expense"), ("research_expense_ratio", "research_expense"),
                       ("finance_expense_ratio", "finance_expense"), ("consolidated_net_margin", "consolidated_net_profit"),
                       ("capex_intensity", "capex"), ("inventory_to_revenue", "inventory"), ("contract_to_revenue", "contract_liabilities"),
                       ("free_cashflow_margin", "owner_fcf")):
        ratio(key, row.get(field), revenue)
    ratio("cashflow_profit", row.get("cfo"), row.get("consolidated_net_profit"), 1, "x")
    ratio("free_cashflow_profit", row.get("owner_fcf"), row.get("consolidated_net_profit"), 1, "x")
    ratio("capex_to_cfo", row.get("capex"), row.get("cfo"))
    ratio("current_ratio", row.get("current_assets"), row.get("current_liabilities"), 1, "x")
    quick = row["current_assets"] - row["inventory"] if valid(row.get("current_assets")) and valid(row.get("inventory")) else None
    ratio("quick_ratio_multiple", quick, row.get("current_liabilities"), 1, "x")
    fixed = row["fixed_assets"] + row["construction_in_progress"] if valid(row.get("fixed_assets")) and valid(row.get("construction_in_progress")) else None
    ratio("fixed_construction_ratio", fixed, row.get("total_assets"))
    # These diagnostics use full-year flows and genuine beginning/end balances.
    full_year = day.endswith("-12-31")
    def average(field, positive=False):
        a, b = row.get(field), (previous or {}).get(field)
        if not full_year or not valid(a) or not valid(b) or positive and (a <= 0 or b <= 0):
            return None
        return (a + b) / 2
    assets, equity = average("total_assets"), average("total_equity", positive=True)
    ratio("consolidated_roe", row.get("consolidated_net_profit"), equity)
    ratio("equity_multiplier", assets, equity, 1, "x")
    for key, balance, flow in (("asset_turnover", "total_assets", "revenue"), ("receivables_turnover", "receivables", "revenue"),
                               ("inventory_turnover", "inventory", "cost"), ("fixed_asset_turnover", "fixed_assets", "revenue")):
        ratio(key, row.get(flow), average(balance), 1, "x")
    days = 366 if calendar.isleap(int(day[:4])) else 365
    ratio("receivables_days", days, row.get("receivables_turnover"), 1, "days")
    ratio("inventory_days", days, row.get("inventory_turnover"), 1, "days")
    for key, field in (("revenue_cagr_3y", "revenue"), ("profit_cagr_3y", "net_profit")):
        start, end = records.get(f"{int(day[:4]) - 3}-12-31", {}).get(field), row.get(field)
        value = ((end / start) ** (1 / 3) - 1) * 100 if full_year and valid(start) and valid(end) and start > 0 and end > 0 else None
        add(key, value, catalog_metrics[key]["formula"], "%")
    window = [records.get(f"{int(day[:4]) - offset}-12-31", {}) if offset else row for offset in (0, 1, 2)]
    cfo = [r.get("cfo") for r in window]
    profits = [r.get("consolidated_net_profit") for r in window]
    complete = full_year and all(valid(v) for v in cfo + profits)
    ratio("cashflow_profit_3y", sum(cfo) if complete else None, sum(profits) if complete else None, 1, "x")


def valuation_history(annual, dividend, sources):
    history = {r["year"]: r for r in dividend.get("history", [])}
    for row in annual:
        h = history.get(row["year"], {})
        price = h.get("year_end_price") if str(h.get("year_end_price_date", "")).startswith(str(row["year"]) + "-") else None
        row["year_end_price"] = price
        row["year_end_pe"] = quotient(price, row.get("basic_eps"))
        day = row["report_date"]
        for field in ("year_end_price", "year_end_pe"):
            if row[field] is not None:
                price_source = h.get("year_end_price_source") or {}
                sources[f"{day}.{field}"] = {**price_source, "provider": "derived" if field == "year_end_pe" else price_source.get("provider", "历史未复权收盘价快照"),
                    "formula": CATALOG["metrics"][field]["formula"], "report_date": day,
                    "price_date": h.get("year_end_price_date"), "unit": "x" if field == "year_end_pe" else "CNY/share",
                    "basis": "ex_post_fiscal_year_not_point_in_time_TTM"}


CATALOG = catalog()
DIAGNOSTIC_FIELDS = tuple(dict.fromkeys([*EXTRA_FIELDS, "cost", "deduct_profit", "parent_equity", "finance_expense",
                                       *[key for key in CATALOG["metrics"] if key not in ("dps", "dividend_cash_CNY", "payout_pct", "dividend_yield_year_end", "year_end_price", "year_end_pe")]]))
