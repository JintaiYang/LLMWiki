"""Industry research definitions and diagnostics, separate from company quality scores."""
from copy import deepcopy
import math


VERSION = "industry-research-1.0"
REVIEWED_ON = "2026-10-17"
SOURCES = [
    {"id": "buffett2007", "title": "伯克希尔 2007 年股东信：优秀、良好与糟糕的生意", "date": "2008-02-29",
     "url": "https://www.berkshirehathaway.com/letters/2007ltr.pdf", "kind": "投资人原始论述",
     "location": "PDF 第 5–7 页，正文第 6–8 页", "finding": "从长期经济特征、竞争壁垒和新增资本需求判断盈利持续性。指标体系是本研究的归纳，不是作者发布的打分公式。"},
    {"id": "cada2026", "title": "中国酒业协会：2026 四川国际美酒博览会及中期报告发布", "date": "2026-06-19",
     "url": "https://www.cada.cc/Item/1555.aspx", "kind": "协会原文",
     "location": "刘振国发布《2026中国白酒市场中期研究报告》段落", "finding": "关注消费场景、性价比、产品分层和渠道变化；发布报道不是完整量化调查，不据此填充库存月数或动销增速。"},
    {"id": "nbs2024", "title": "国家统计局：2024 年经济运行及统计范围说明", "date": "2025-01-17",
     "url": "https://www.stats.gov.cn/sj/zxfb/202501/t20250117_1958332.html", "kind": "官方统计方法",
     "location": "附注（3）规模以上工业、（5）零售统计范围", "finding": "规上企业范围会变化，官方可比同比可能不同于相邻发布值直接相除；规上产量和限额以上零售不是全行业终端消费。"},
    {"id": "maotai2024", "title": "贵州茅台 2024 年年度报告", "date": "2025-04-03",
     "url": "", "file": "sources/maotai2024.pdf", "kind": "公司年报原文",
     "location": "PDF 第 9–13 页、93 页", "finding": "产品/渠道收入、产销和基酒周期需分别研究；存货区分原材料、在产品、库存商品和自制半成品，财务公司影响经营现金流。"},
]


def tracking(key, group, label, priority, frequency, formula, interpretation, caveat, source_ids):
    return {"key": key, "group": group, "label": label, "priority": priority, "frequency": frequency,
            "formula": formula, "interpretation": interpretation, "caveat": caveat, "source_ids": source_ids,
            "value": None, "status": "pending", "observation_date": None, "source_url": None}


TRACKING = [
    tracking("sell_through", "需求", "同店终端动销", "核心", "月度 / 春节中秋国庆",
             "同一终端样本本期实际售出量 / 上年同节日窗口售出量 − 1",
             "看真实消费量、复购与主销价格带是否恢复", "农历节日错位需对齐节前节后周数；出厂发货和电商交易额不能代替开瓶消费。", ["cada2026"]),
    tracking("price_mix", "需求", "消费场景与价格带", "补充", "季度 / 节假日",
             "宴席、商务、自饮等场景和各价格带的销量、复购、客单价",
             "辨别长期需求与降级/升级，识别新增人群是否贡献增量", "问卷意愿不是购买；烟酒零售含烟草和其他酒，不能当作白酒销售。", ["cada2026", "nbs2024"]),
    tracking("wholesale_price", "价格", "核心单品批价", "核心", "每周；取连续 4 周",
             "固定品牌、规格、度数、年份及原箱/散瓶的含税成交价；跟踪周变化",
             "批价连续企稳需与动销和库存去化相互确认", "报价与成交价分开；控货也会提价，单日价格不证明需求回暖；飞天、普五、国窖、青花分别跟踪。", ["cada2026"]),
    tracking("dealer_margin", "价格", "经销商实际毛利 / 倒挂", "核心", "每月 / 政策调整时",
             "(净销售到手价 − 同含税口径进货成本) / 进货成本；另扣运费及资金成本",
             "倒挂收窄且回款改善，才有可持续补库动力", "实际进货成本需扣已兑现返利；名义出厂价不是完整成本，零售指导价不是经销商收入。", ["cada2026"]),
    tracking("channel_inventory", "渠道", "经销商库存月数", "核心", "每月 / 节后",
             "经销商同一单品可售库存 / 近 3 个月平均实际售出量",
             "库存月数回落、动销改善、价格稳定需要同时发生", "淡旺季单独比较；无销量时不可计算；不得用厂商报表库存或所谓全行业周转天数替代。", ["cada2026", "maotai2024"]),
    tracking("dealer_orders", "渠道", "回款、补货与退货", "核心", "每月 / 季度",
             "自愿补货量、回款完成率、退货率及返利/授信政策",
             "观察补库是否来自终端拉动，而非压货、赊销或返利刺激", "合同负债受打款和发货、直销结构影响，余额单独上升或下降都没有唯一方向。", ["cada2026", "maotai2024"]),
    tracking("production", "供给", "规上白酒产量与官方同比", "核心", "每月 / 年度",
             "官方白酒折 65 度商品量；累计值、当月值、官方可比同比分别存储",
             "看供给收缩与行业出清，结合需求和价格判断平衡", "不是终端销量，也不是所有酒企；严禁把累计数误作全年数，万吨和万千升不能直接混用。", ["nbs2024"]),
    tracking("capacity", "供给", "基酒储备与有效产能", "补充", "半年 / 年度",
             "按香型分基酒产量、合格基酒储备、实际可售量、扩产投产时间",
             "判断高端供给约束是否真实及未来资本开支压力", "设计产能不等于有效产能；基酒不同于成品酒；不能机械用当年基酒产量计算当年产销率。", ["maotai2024"]),
    tracking("share", "竞争", "分价格带份额与集中度", "核心", "半年 / 年度",
             "同价格带、同地区、同渠道的品牌销售额 / 同口径总额",
             "验证品牌、区域与渠道优势是否兑现为份额和回报", "上市样本集中度不是行业集中度；收入份额与利润份额必须分开。", ["buffett2007", "cada2026"]),
    tracking("product_economics", "竞争", "量价拆分与产品渠道结构", "核心", "半年 / 年度",
             "酒类收入 = 可比销量 × 实现均价；分产品、分地区、直销/批发拆分",
             "区分真实提价、产品升级和直销占比变化，再看毛利与销售费用", "均价含产品/渠道结构效应，不等于同品提价；合并收入不能直接除以白酒销量。", ["maotai2024"]),
    tracking("reinvestment", "长期回报", "正常化资本回报与再投资", "补充", "年度 / 3–5 年窗口",
             "正常化税后经营利润 / 平均投入资本；区分维持与增长性资本开支",
             "看高回报能否延续、扩产是否创造价值，而非只看行业增速", "投入资本非正或金融业务混杂时不机械比较；高毛利不等于高股东回报。", ["buffett2007", "maotai2024"]),
    tracking("tax_policy", "外部约束", "税负、消费场景政策与食品安全", "核心", "事件触发 / 季度",
             "核对正式文件、生效日、适用主体和税金及附加/收入变化",
             "将政策通过销量、渠道成本和现金流传导到估值情景", "传闻或征求意见不能当作已经生效；税金及附加还含其他税种。", ["cada2026", "maotai2024"]),
]


def number(value):
    return value if not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) else None


def ratio(a, b):
    return a / b * 100 if number(a) is not None and number(b) is not None and b > 0 else None


def yoy(a, b):
    return (a - b) / abs(b) * 100 if number(a) is not None and number(b) is not None and b != 0 else None


def company_row(company, day):
    return next((r for r in company.get("annual", []) + company.get("quarterly", []) if r.get("report_date") == day), {})


def snapshot(companies, point, previous):
    day = point["report_date"]
    count = len(companies)
    rows = [company_row(c, day) for c in companies]

    def total(key):
        values = [number(r.get(key)) for r in rows]
        return sum(values) if count and all(v is not None for v in values) else None

    revenue = number(point.get("revenue"))
    growth_revenue = yoy(revenue, previous.get("revenue"))
    growth_profit = yoy(point.get("net_profit"), previous.get("net_profit"))
    growth_inventory = yoy(point.get("inventory"), previous.get("inventory"))
    growth_contract = yoy(point.get("contract_liabilities"), previous.get("contract_liabilities"))
    by_revenue = [number(r.get("revenue")) for r in rows]
    same_companies = bool(count and all(v is not None for v in by_revenue) and revenue is not None and math.isclose(sum(by_revenue), revenue, rel_tol=1e-9, abs_tol=0.01))
    fcf = [number(r.get("owner_fcf")) for r in rows]
    growth_pairs = [(r.get("revenue"), company_row(c, str(int(day[:4]) - 1) + day[4:]).get("revenue")) for c, r in zip(companies, rows)]
    growth_counts = sum(number(a) is not None and number(b) is not None and b > 0 for a, b in growth_pairs)
    positive_growth = sum(a > b for a, b in growth_pairs if number(a) is not None and number(b) is not None and b > 0)

    def metric(key, label, value, unit, formula, caution, coverage=None):
        return {"key": key, "label": label, "value": value, "unit": unit, "formula": formula,
                "caution": caution, "coverage": coverage if coverage is not None else count if value is not None else 0,
                "sample_count": count, "status": "available" if value is not None else "insufficient", "report_date": day}

    diagnostics = [
        metric("inventory_growth_gap", "厂商存货增速－营收增速", growth_inventory - growth_revenue if growth_inventory is not None and growth_revenue is not None else None, "百分点",
               "厂商存货同比 − 营业收入同比", "正差额仅是厂商占款提示；基酒陈化、成本计价与收入计价不同，不能解释为渠道积压月数。"),
        metric("contract_ratio", "合同负债 / 同期营收", ratio(point.get("contract_liabilities"), revenue), "%",
               "期末合同负债 / 本报告期累计营业收入 × 100", "余额/期间流量比，只和去年同报告期比较；非全年覆盖率，直销和打款节奏会改变比率。"),
        metric("cfo_ratio", "经营现金流 / 营收", ratio(point.get("cfo"), revenue), "%",
               "合计经营现金流 / 合计营业收入 × 100", "经营现金流含财务公司及税务节奏影响，改善不直接证明终端动销改善。"),
        metric("fcf_margin", "简化自由现金流率", ratio(total("owner_fcf"), revenue) if same_companies else None, "%",
               "合计（经营现金流 − 全部资本开支）/ 合计营业收入 × 100", "不是严格股权自由现金流；负值需区分扩产和经营流出，历史公司数据不足时留空。"),
        metric("sales_expense_ratio", "销售费用 / 营收", ratio(total("sales_expense"), revenue) if same_companies else None, "%",
               "合计销售费用 / 合计营业收入 × 100", "与动销、毛利率和返利同时看；费用增加不必然坏，费用下降也可能是收缩。"),
        metric("positive_growth", "营收正增长公司", positive_growth if count and growth_counts == count else None, "家",
               "同公司同期营业收入同比为正的数量", "观察多数公司还是少数龙头拉动；零/负基数和缺项不计为有效可比。", growth_counts),
        metric("negative_fcf", "自由现金流为负公司", sum(v < 0 for v in fcf) if count and all(v is not None for v in fcf) else None, "家",
               "经营现金流 − 全部资本开支 < 0 的公司数量", "全样本齐备才显示；扩产支出不等于经营恶化。", sum(v is not None for v in fcf)),
        metric("sample_cr6", "上市样本前六营收占比", ratio(sum(sorted(by_revenue, reverse=True)[:6]), revenue) if same_companies and all(v >= 0 for v in by_revenue) else None, "%",
               "按当前报告期营收排序的前六家收入 / 19 家样本收入 × 100", "不是全行业集中度，也不是分价格带市场份额；包含顺鑫农业非酒业务。"),
    ]
    facts = []
    if growth_revenue is not None:
        facts.append(f"营业收入同比 {growth_revenue:+.2f}%")
    if growth_profit is not None:
        facts.append(f"归母净利润同比 {growth_profit:+.2f}%")
    if growth_inventory is not None:
        facts.append(f"厂商存货同比 {growth_inventory:+.2f}%")
    if growth_contract is not None:
        facts.append(f"合同负债同比 {growth_contract:+.2f}%")
    pressured = growth_revenue is not None and growth_profit is not None and growth_revenue < 0 and growth_profit < 0
    return {"report_date": day, "sample_count": count, "diagnostics": diagnostics, "facts": facts,
            "status": "pressure" if pressured else "observe",
            "judgment": "上市厂商收入与利润承压；终端拐点未确认" if pressured else "上市厂商表现需结合终端证据核验",
            "boundary": "这是已披露上市样本的研究推断，不是全行业景气评级。批价、终端动销和经销商库存尚缺同口径量化证据，不输出行业见底结论。"}


def build_research(companies, trends, asof):
    by_day = {p["report_date"]: p for p in trends}
    result = {"version": VERSION, "reviewed_on": REVIEWED_ON, "financial_as_of": asof,
              "sources": deepcopy(SOURCES), "tracking": deepcopy(TRACKING), "snapshots": [],
              "admission": "数值必须有观测期、发布日期、来源、单位和样本；历史参考不当作最新行情，缺项不补零。",
              "rejected": [{"provider": "iFinD 宏观查询", "indicator": "白酒折65度商品量累计产量",
                            "reason": "2026-10-17 查询返回 2026-12-31 全年标签，但元数据截止 2026-08-31、频率由月改年；报告期冲突，数值未采纳。"}]}
    for day, point in sorted(by_day.items()):
        if day <= asof:
            result["snapshots"].append(snapshot(companies, point, by_day.get(str(int(day[:4]) - 1) + day[4:], {})))
    return result
