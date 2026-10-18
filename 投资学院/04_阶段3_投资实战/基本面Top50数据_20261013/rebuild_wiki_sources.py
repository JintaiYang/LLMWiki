import json
from pathlib import Path
import pandas as pd

ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent
INDEX='A股Top50财务证据_20261014'
REPORT='A股基本面Top50_20261014'
NODES=ROOT/'资料节点'
NODES.mkdir(exist_ok=True)

groups=[
    ('S01','全市场三年业绩快照','东方财富（既有本地快照）','第三方结构化数据','2023A–2025A','全市场5377家公司；本次没有重新全量下载。','样本遗漏、历史重述和财报原文尚需核对。',['全市场_三年年报.csv']),
    ('S02','候选池与筛选底稿','本地筛选','研究推断','2023A–2025A','148家机械初筛及30家行业/模式例外，共178家。','阈值是本次研究设定，不是原方法论的硬要求。',['候选公司_三年年报.csv','candidates.json','extra_candidates.json']),
    ('S03','iFinD三年年报补充','iFinD','第三方结构化数据','2023A–2025A','178家共534条年度记录，包含现金流、资本开支、归母利润与供应商ROIC。','合并现金流与归母利润范围不完全相同；ROIC未独立重算；历史重述冲突保留缺失。',[*sorted(p.name for p in ROOT.glob('annual_*.json')),*sorted(p.name for p in ROOT.glob('extra_annual_*.json')),'补充财务_年报长表.csv']),
    ('S04','iFinD最新中报趋势','iFinD','第三方结构化数据','2026H1','178家收入、归母及扣非利润同比。','最新同比不等于正常化主业增长，扣非也可能包含投资收益。',[*sorted(p.name for p in ROOT.glob('interim_*.json')),*sorted(p.name for p in ROOT.glob('extra_interim_*.json'))]),
    ('S05','iFinD审计分红与盈余质量','iFinD','第三方结构化数据','2025A','178家审计意见、分红、商誉和其他应收字段，保留报告期与口径。','分红总额与派现比例冲突未全部解决；审计标准意见不代表完整治理验证。',[*sorted(p.name for p in ROOT.glob('governance_*.json')),*sorted(p.name for p in ROOT.glob('extra_governance_*.json'))]),
    ('S06','iFinD入选公司资产负债','iFinD','第三方结构化数据','2025A','最终50家资产、归母权益、带息债务、货币资金及部分利息覆盖。','两家银行该货币资金口径缺失；债务定义和受限资金未核对。',[*sorted(p.name for p in ROOT.glob('balance_*.json'))]),
    ('S07','iFinD银行行业适配','iFinD','第三方结构化数据','2025A及2026H1','招商银行、宁波银行不良率、拨备覆盖、净息差和核心一级资本。','不是完整的全体银行信用成本研究。',['银行适配器.json']),
    ('S08','异常公告检索核验','iFinD公告语义检索','公告片段或摘要','2025A及2026H1','六组核验：茅台、安克、金山、珀莱雅、美的、中国神华。','未逐页读取原始公告；语义检索含摘要，不能提升为独立审计事实。',[*sorted(p.name for p in ROOT.glob('公告核验_*.json'))]),
    ('S09','Top50选择判断与指标导出','本地研究判断','研究推断','2026-10-14','50家入选理由、风险、研究优先级和三档划分。','不是完整100分模型、全市场严格排名或买入顺序。',['最终Top50_选择依据.json','最终Top50_完整指标与判断.csv','候选公司_补充财务比较.csv','rebuild_analysis.py','rebuild_report.py'])
]

intro=f'''---
title: A股Top50财务证据与来源
note_type: financial_evidence
created: 2026-10-14
updated: 2026-10-14
financial_window: 2023A-2025A
latest_check: 2026H1
evidence_level: third_party_data_with_research_judgment
related:
  - "[[{REPORT}]]"
  - "[[A股价值投资选股与基本面分析方法论]]"
---

# A股 Top50 财务证据与来源

[[{REPORT}|返回50家公司名单]] · [[阶段3概览|返回阶段3]] · [[A股价值投资选股与基本面分析方法论|研究方法论]]

本页登记已保存的证据与研究判断，未重新获取行情或改变选股结论。完整年度为2023–2025，最新边际检查为2026H1。金额显示亿元，百分比使用百分数；银行现金流只作溯源，不参与跨行业排名。

## 来源登记

每个资料节点对应一种材料或取数批次。JSON/CSV附件通过节点中的普通Markdown链接访问，避免把数据附件当作独立研究结论。

| 来源ID | 材料节点 | 机构与类型 | 报告期 | 用途与入库状态 |
|---|---|---|---|---|
'''
pieces=[intro]
for sid,title,publisher,kind,period,facts,gap,files in groups:
    name=f'A股Top50_{sid}_{title}'
    pieces.append(f'| {sid} | [[{name}\\|{title}]] | {publisher}；{kind} | {period} | {facts} 已登记；待核验见资料节点 |\n')
    body=f'''---
title: "{sid} {title}"
note_type: source_note
created: 2026-10-14
report_period: "{period}"
source_institution: "{publisher}"
evidence_class: "{kind}"
related:
  - "[[{INDEX}]]"
  - "[[{REPORT}]]"
---

# {sid} {title}

[[{INDEX}|返回来源登记]] · [[{REPORT}|相关分析]]

## 材料记录

- 机构：{publisher}
- 信息类别：{kind}
- 报告期：{period}
- 登记日：2026-10-14；采集跨2026-10-13至14日，单次采集时间按原始响应为准。
- 内容与范围：{facts}
- 待核验：{gap}

## 附件与底稿

'''
    for file in files:
        assert (ROOT/file).exists(),file
        body+=f'- [{file}](../{file})\n'
    (NODES/(name+'.md')).write_text(body,encoding='utf8')

pieces.append('''
## 证据与推断的边界

- S01、S03–S07是第三方财务底稿，没有独立复算供应商ROIC、带息债务及所有历史重述。
- S02、S09是筛选规则和研究判断，不是公司事实，也不构成完整百分制排名。
- S08是公告检索片段或摘要，不能当作已阅读整份官方年报。
- 中国神华2024重述前后口径未全部统一，三年综合指标缺失；保留原始数值供追溯。
- 分红、缺失、银行适配、现金流范围等口径详见 [[数据说明|原始数据说明]]；不将未知值填零。

## 50家公司三年财务底稿

收入、ROE、毛利率来自S01；现金流、资本开支、利润及ROIC来自S03。两种归母利润并列，避免隐藏重述差异。保守FCF包含增长资本开支，不等于可分配股东现金流。ROIC仅为供应商口径；空白保留“待核验”。

''')
snapshot=pd.read_csv(ROOT/'候选公司_三年年报.csv',dtype={'code':str}).set_index('code')
annual=pd.read_csv(ROOT/'补充财务_年报长表.csv',dtype={'code':str,'period':str}).set_index(['code','period'])
choices=json.loads((ROOT/'最终Top50_选择依据.json').read_text())

def fmt(value,scale=1):
    return '待核验' if pd.isna(value) else f'{float(value)/scale:.2f}'

for rank,choice in enumerate(choices,1):
    code=choice['code']
    s=snapshot.loc[code]
    pieces.append(f"### {rank}. {s.name_25}（{code}）\n\n")
    pieces.append('| 年度 | 收入 | 归母利润（快照） | 归母利润（iFinD） | CFO | 全资本开支 | 保守FCF | ROE% | ROIC% | 取数底稿 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n')
    for year in ['2023','2024','2025']:
        a=annual.loc[(code,year+'1231')]
        suffix=year[2:]
        values=[fmt(s['rev_'+suffix],1e8),fmt(s['np_'+suffix],1e8),fmt(a.np_ifind,1e8),fmt(a.cfo,1e8),fmt(a.capex,1e8),fmt(a.fcf_proxy,1e8),fmt(s['roe_'+suffix]),fmt(a.roic)]
        source=f"[{a.source}](./基本面Top50数据_20261013/{a.source})"
        pieces.append(f"| {year} | {' | '.join(values)} | {source} |\n")
    pieces.append(f"\n研究判断（S09）：{choice['reason']}。待验证：{choice['risk']}。\n\n")
pieces.append('## 维护记录\n\n[[09_操作日志|投资学院操作日志]] · [[A股Top50_Wiki链接检查_20261014|本次链接检查]]\n')
(BASE/(INDEX+'.md')).write_text(''.join(pieces),encoding='utf8')
print('Created evidence index and',len(groups),'source nodes; company tables:',len(choices))
