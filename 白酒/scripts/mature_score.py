"""Production metadata and dashboard contract for the shared V5 book rubric."""
from book_score import DIMENSIONS as BOOK_DIMENSIONS, score_book, finite


NAMES = {
    'operating_margin': 'operating_margin_median', 'roa': 'roa_median',
    'nonrecurring': 'nonrecurring_dependency', 'cfo_conversion': 'cfo_conversion',
    'fcf_conversion': 'fcf_conversion', 'cfo_positive': 'cfo_positive_ratio',
    'liquidity': 'liquidity_constraint', 'other_receivables': 'other_receivables_constraint',
    'receivables': 'receivables_constraint', 'revenue_cagr': 'revenue_cagr_5y',
    'worst_revenue_yoy': 'revenue_worst_yoy', 'payout': 'payout_cumulative',
    'dividend_consistency': 'dividend_consistency',
}
DETAILS = {
    'operating_margin': ('营业利润率中位数', '%', '会计营业利润 / 营业收入 × 100；五年中位数，不等于严格主业利润率'),
    'roa': ('总资产收益率中位数', '%', '合并净利润 / 期初期末平均总资产 × 100；五年中位数'),
    'nonrecurring': ('非经常收益依赖', '%', 'max(五年中位数, 最新年)；年度值=max(0,(归母净利−扣非归母净利)/abs(归母净利))×100；最新年亏损或累计归母净利非正计零'),
    'cfo_conversion': ('累计经营现金转化', 'x', '五年 CFO 合计 / 同期合并净利润合计；累计合并净利非正计零'),
    'fcf_conversion': ('再投入后现金留存', 'x', '五年(CFO−全部资本开支)合计 / 同期合并净利润合计；不是严格 FCFF/FCFE'),
    'cfo_positive': ('经营造血正值年占比', '%', '五年 CFO 严格为正的年度数 / 5 × 100'),
    'liquidity': ('流动性缓冲约束', '系数', 'U(x;a,b)=clamp((x−a)/(b−a),0,1)；每年取 min(U(现金/流动负债%;20,100),U(速动比率%;50,150))；再取五年中位系数与最新年系数的较小值'),
    'other_receivables': ('非销售占款约束', '%', '其他应收款合计 / 总资产 × 100；取五年中位数与最新年较高值，不直接等同于资金占用'),
    'receivables': ('销售占款约束', '%', '应收账款账面净额 / 营业收入 × 100；取五年中位数与最新年较高值，票据与合同资产另查'),
    'revenue_cagr': ('五年营收复合增速', '%', '(最新年营收 / 窗口首年前一年营收)^(1/5)−1；×100，要求真实连续年度'),
    'worst_revenue_yoy': ('最差年度营收同比', '%', '五年中最差相邻年度营收同比，窗口首年须另取上年作为比较'),
    'payout': ('累计派现率', '%', '五年按利润归属年汇总的已实施现金分红 / 同期归母净利润合计 × 100；累计归母净利非正计零'),
    'dividend_consistency': ('分红连续性', '%', '五年有已实施现金分红的年度数 / 5 × 100；已核验零分红记零，缺记录留缺项'),
}
DIMENSIONS = [(name, maximum, [(NAMES[key], weight) for key, weight, _, _ in specs])
              for name, maximum, specs in BOOK_DIMENSIONS]
METRICS = {NAMES[key]: (DETAILS[key][0], DETAILS[key][1], zero, full, DETAILS[key][2])
           for _, _, specs in BOOK_DIMENSIONS for key, _, zero, full in specs}
REFERENCES = ['product_mix', 'channel_health', 'cycle_resilience', 'capital_allocation', 'governance']
SCORING_PARAMETERS = {
    'version': 'V5.0-book-financial-quality', 'dimensions': DIMENSIONS,
    'score_anchors': {key: [spec[2], spec[3]] for key, spec in METRICS.items()},
    'metric_definitions': {key: {'label': spec[0], 'unit': spec[1], 'formula': spec[4]} for key, spec in METRICS.items()},
    'lower_is_better': ['nonrecurring_dependency', 'other_receivables_constraint', 'receivables_constraint'],
    'qualitative_indicators': REFERENCES, 'window_years': 5, 'method': 'absolute_anchors_no_peer_bonus',
    'risk_rules': [
        {'key': 'latest_loss', 'label': '最新完整年归母亏损', 'cap': 49},
        {'key': 'two_negative_cfo', 'label': '连续两年经营现金流为负', 'cap': 49},
        {'key': 'negative_equity', 'label': '最新完整年全部净资产非正', 'cap': 39},
    ],
    'style': {'quality_min': 80, 'cheap_upside': .20, 'growth_dimension': '经营韧性', 'growth_weak_below': .5},
    'research_sources': [
        {'name': '唐朝《手把手教你读财报》', 'description': '2015 年版，ISBN 978-7-5136-3612-4。依据第二章资产质量、第三章利润来源、第四章现金流、第五章综合指标、第八章排雷；权重和锚点由本研究台设计。'},
        {'name': 'Damodaran：增长、再投资与资本回报', 'url': 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/a7.htm', 'description': '增长需要相应再投资，资产回报、ROE 与资本回报不能混用。'},
        {'name': 'Damodaran：永续增长与再投资的一致性', 'url': 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/a11.htm', 'description': '永续增长须与再投资匹配，不直接用提高增长率创造终值。'},
        {'name': 'Coca-Cola 2025 Form 10-K', 'url': 'https://investors.coca-colacompany.com/filings-reports/all-sec-filings/content/0001628280-26-010047/ko-20251231.htm', 'description': '终端销量、出货和渠道库存分开观察；现金留存须考虑长期资产投资。'},
    ],
}


def score_mature(annual, sources=None, evidence=None):
    result = score_book(annual)
    years = result['years']
    dimensions = []
    for dimension in result['dimensions']:
        items = []
        for entry in dimension['items']:
            key = entry['key']
            label, unit, zero, full, formula = METRICS[NAMES[key]]
            items.append({
                'name': NAMES[key], 'label': label, 'unit': unit, 'value': entry['value'],
                'score': entry['score'], 'absolute_score': entry['score'], 'relative_percentile': None,
                'max': entry['max'], 'zero_line': zero, 'full_line': full,
                'status': entry['status'], 'method': formula, 'valid_years': entry['valid_years'],
                'window': years, 'source': f'{years[0]}–{years[-1]} 同口径年度资料；{formula}' if years else None,
            })
        dimensions.append({'name': dimension['name'], 'weight': dimension['max'],
                           'score': round(dimension['score'], 6) if dimension['score'] is not None else None, 'items': items})
    rules = {rule['key']: rule for rule in SCORING_PARAMETERS['risk_rules']}
    risks = [rules[risk['key']] for risk in result['risk_gates']]
    missing = [NAMES[key] for key in result['missing']]
    flags = [f"{r['label']}，总分上限 {r['cap']}" for r in risks] + result['observations']
    if missing:
        flags.append(f'{len(missing)} 个评分项缺失，不进入排名')
    if result['risk_missing']:
        flags.append('风险闸门资料不足')
    window = [r for r in annual if r.get('year') in years]
    latest = next((r for r in window if r.get('year') == years[-1]), {}) if years else {}
    return {
        'version': SCORING_PARAMETERS['version'], 'annual_year': years[-1] if years else None,
        'window_years': years, 'dimensions': dimensions,
        **{key: result[key] for key in ('total', 'raw_total', 'known_points', 'coverage', 'score_range',
                                      'risk_cap', 'risk_missing', 'rankable', 'observations', 'strict_safety_status', 'safety_pending', 'liquidity_components')},
        'observed_total': result['raw_total'], 'max_total': 100, 'risk_gates': risks, 'missing': missing,
        'quality_flags': flags,
        'negative_years': [r for r in window if finite(r.get('net_profit')) and r['net_profit'] < 0],
        'references': [{'name': key, 'evidence': (evidence or {}).get(key, []), 'status': 'reference'} for key in REFERENCES],
        'financial_proxies_unscored': {key: latest.get(key) / latest['revenue'] if finite(latest.get(key)) and finite(latest.get('revenue')) and latest['revenue'] > 0 else None for key in ('contract_liabilities', 'inventory', 'receivables', 'sales_expense')},
        'universe_stats': {'method': 'absolute_anchors_no_peer_bonus', 'peer_count': 0},
        'assumptions': 'V5 五年财报质量观察分，25/30/25/10/10。固定绝对锚点；流动性取现金与速动瓶颈，应收与非经常收益取最新年和历史中较差者。CFO 与合并净利匹配，分红与归母净利匹配。缺项不补零、不归一化，经济无效计零并标注。三年简化 FCF 非正只触发复核，不自动限分。严格安全核验与估值独立，权重及锚点未经收益回测。',
    }
