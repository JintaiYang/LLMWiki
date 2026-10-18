import json
import re
from pathlib import Path
import numpy as np
import pandas as pd

ROOT=Path('/Users/yangjintai/Documents/LLM wiki/投资学院/04_阶段3_投资实战/基本面Top50数据_20261013')

def number(s):
    s=s.strip().replace(',', '').replace('%','')
    if s in ['', '-', '--', '\\t', 'NA', 'null', 'None']: return np.nan
    multiplier=1
    for suffix,m in [('万亿',1e12),('亿',1e8),('万',1e4)]:
        if s.endswith(suffix):
            s=s[:-len(suffix)];multiplier=m;break
    try: return float(s)*multiplier
    except ValueError: return np.nan

def get_rows(pattern):
    output=[]; errors=[]
    for file in sorted(ROOT.glob(pattern)):
        try:
            envelope=json.loads(file.read_text())
            result=envelope['response']['data']['result']['content']
            payload=json.loads(next(c['text'] for c in result if c['type']=='text'))
            answer=payload['data']['answer']
            lines=[line.strip() for line in answer.splitlines() if line.strip().startswith('|')]
            header=[]
            for line in lines:
                cells=[s.strip() for s in line.strip('|').split('|')]
                if cells[0]=='证券代码':
                    header=cells
                    continue
                if all(re.fullmatch(r':?-+:?',s) for s in cells): continue
                if len(cells)!=len(header): continue
                row=dict(zip(header,cells))
                row['_source']=file.name
                row['_params']=payload['data'].get('indicators_params',{})
                row['code']=row['证券代码'].split('.')[0]
                output.append(row)
        except Exception as exc: errors.append({'file':file.name,'error':str(exc)})
    return output, errors

def take(row,key):
    values=[number(v) for k,v in row.items() if k.startswith(key)]
    return values[0] if values else np.nan

annual,errors=get_rows('*annual_*.json')
annual=[r for r in annual if r.get('日期') in ['20231231','20241231','20251231']]
rows=[]
for r in annual:
    rows.append({'code':r['code'],'name':r['证券简称'],'period':r['日期'],'cfo':take(r,'经营活动产生的现金流量净额'),'capex':take(r,'购建固定资产'),'roic':take(r,'投入资本回报率ROIC'),'debt_ratio':take(r,'资产负债率'),'np_ifind':take(r,'归属于母公司所有者的净利润'),'source':r['_source']})
a=pd.DataFrame(rows).drop_duplicates(['code','period'])
a['fcf_proxy']=a.cfo-a.capex
a['cfo_np']=a.cfo/a.np_ifind
a['fcf_np']=a.fcf_proxy/a.np_ifind
a.to_csv(ROOT/'补充财务_年报长表.csv',index=False)
x=pd.read_csv(ROOT/'候选公司_三年年报.csv',dtype={'code':str})
reference=x.set_index('code')
a['snapshot_np']=a.apply(lambda r:reference.loc[r.code,'np_'+r.period[2:4]],axis=1)
a['np_source_relative_diff']=(a.np_ifind-a.snapshot_np).abs()/a.snapshot_np.abs()
a['np_source_conflict']=a.np_source_relative_diff>0.01
a.to_csv(ROOT/'补充财务_年报长表.csv',index=False)
x['np_source_conflict']=x.code.map(a.groupby('code').np_source_conflict.any())
for metric in ['cfo_np','fcf_np','roic','debt_ratio']:
    med=a.groupby('code')[metric].median()
    x[metric+'_median']=x.code.map(med)
    latest=a[a.period=='20251231'].set_index('code')[metric]
    x[metric+'_25']=x.code.map(latest)
x['fcf_negative_years']=x.code.map(a.assign(negative=a.fcf_proxy<0).groupby('code').negative.sum())
x['annual_rows']=x.code.map(a.groupby('code').size())
x['rev_cagr_23_25']=(x.rev_25/x.rev_23)**.5-1
x['np_cagr_23_25']=(x.np_25/x.np_23)**.5-1
x['roe_median']=x[['roe_23','roe_24','roe_25']].median(axis=1)
h,herrors=get_rows('*interim_*.json')
h=[r for r in h if r.get('日期')=='20260630']
for name,key in [('h1_rev_yoy','营业收入(同比增长率)'),('h1_np_yoy','归属母公司股东的净利润(同比增长率)'),('h1_core_np_yoy','归属母公司股东的净利润-扣除非经常损益(同比增长率)')]:
    mapping={r['code']:take(r,key) for r in h}
    x[name]=x.code.map(mapping)
g,gerrors=get_rows('*governance_*.json')
metadata={r['code']:r for r in g if '审计意见类型' in r}
dated={r['code']:r for r in g if r.get('日期')=='20251231'}
for col,key in [('dividend_25','年度累计分红总额'),('dividend_np_25','年度分红比例')]:
    x[col]=x.code.map({code:take(r,key) for code,r in metadata.items() if str(r['_params'].get('年度累计分红总额',{}).get('年度'))=='2025'})
x['audit_opinion_25']=x.code.map({code:r['审计意见类型'] for code,r in metadata.items() if str(r['_params'].get('审计意见类型',{}).get('报告期'))=='20251231'})
for col,key in [('goodwill_25','商誉'),('other_receivables_25','其他应收款')]:
    x[col]=x.code.map({code:take(r,key) for code,r in dated.items()})
latest_fcf=a[a.period=='20251231'].set_index('code').fcf_proxy
x['dividend_fcf_proxy_25']=x.dividend_25/x.code.map(latest_fcf)
reported=x.dividend_np_25/100
implied=x.dividend_25/x.np_25
x['dividend_scope_conflict']=reported.notna() & implied.notna() & ((reported-implied).abs()>0.05)
x.loc[x.dividend_scope_conflict,'dividend_fcf_proxy_25']=np.nan
b,berrors=get_rows('balance_*.json')
b=[r for r in b if r.get('日期')=='20251231']
for col,key in [('assets_25','资产总计'),('equity_25','归属于母公司所有者权益合计'),('cash_25','货币资金'),('interest_debt_25','带息债务'),('interest_cover_25','已获利息倍数')]:
    x[col]=x.code.map({r['code']:take(r,key) for r in b})
x['net_debt_proxy_25']=x.interest_debt_25-x.cash_25
x['goodwill_assets_25']=x.goodwill_25/x.assets_25
x['other_receivables_assets_25']=x.other_receivables_25/x.assets_25
x.loc[x.np_source_conflict,['roe_median','roic_median','cfo_np_median','fcf_np_median','np_cagr_23_25']]=np.nan
x.to_csv(ROOT/'候选公司_补充财务比较.csv',index=False)
print('annual:',len(a),'companies:',len(a.code.unique()),'errors:',errors,'interim:',len(h),'errors:',herrors,'governance:',len(metadata),'errors:',gerrors)
columns=['code','name_25','roe_median','roic_median','cfo_np_median','fcf_np_median','fcf_negative_years','debt_ratio_25','rev_cagr_23_25','np_yoy_25','h1_rev_yoy','h1_np_yoy']
print(x[columns].round(3).to_string(index=False))
