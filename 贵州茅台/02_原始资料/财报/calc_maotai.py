#!/usr/bin/env python3
"""计算贵州茅台关键财务指标，输出为结构化数据"""
import pandas as pd
import numpy as np
import json
import os

data_dir = os.path.dirname(os.path.abspath(__file__))
output_file = os.path.join(data_dir, 'maotai_analysis.json')

# ============ 1. 读取数据 ============
print("=" * 60)
print("读取原始数据...")

df_profit = pd.read_csv(os.path.join(data_dir, 'maotai_profit.csv'))
df_balance = pd.read_csv(os.path.join(data_dir, 'maotai_balance.csv'))
df_cashflow = pd.read_csv(os.path.join(data_dir, 'maotai_cashflow.csv'))
df_dividend = pd.read_csv(os.path.join(data_dir, 'maotai_dividend.csv'))

# 筛选年报
df_profit_annual = df_profit[df_profit['REPORT_TYPE'].str.endswith('年报', na=False)].copy()
df_balance_annual = df_balance[df_balance['REPORT_TYPE'].str.endswith('年报', na=False)].copy()
df_cashflow_annual = df_cashflow[df_cashflow['REPORT_TYPE'].str.endswith('年报', na=False)].copy()

# 按报告日期排序（降序，最新在前）
df_profit_annual = df_profit_annual.sort_values('REPORT_DATE', ascending=False)
df_balance_annual = df_balance_annual.sort_values('REPORT_DATE', ascending=False)
df_cashflow_annual = df_cashflow_annual.sort_values('REPORT_DATE', ascending=False)

print(f"年报数量 - 利润表: {len(df_profit_annual)}, 资产负债表: {len(df_balance_annual)}, 现金流量表: {len(df_cashflow_annual)}")

# 取三张报表共同覆盖的最近10个年报，按报告期显式对齐，避免缺报时静默错位
n_years = 10
common_reports = (
    set(df_profit_annual['REPORT_DATE_NAME'])
    & set(df_balance_annual['REPORT_DATE_NAME'])
    & set(df_cashflow_annual['REPORT_DATE_NAME'])
)
report_dates = sorted(common_reports, reverse=True)[:n_years]

def align_reports(df):
    return (
        df[df['REPORT_DATE_NAME'].isin(report_dates)]
        .drop_duplicates('REPORT_DATE_NAME', keep='first')
        .set_index('REPORT_DATE_NAME')
        .loc[report_dates]
        .reset_index()
    )

df_p = align_reports(df_profit_annual)
df_b = align_reports(df_balance_annual)
df_c = align_reports(df_cashflow_annual)
print(f"报告期: {report_dates}")

# ============ 2. 辅助函数 ============
def safe_get(df, col, idx=0):
    """安全获取某列某行的值"""
    try:
        if col in df.columns:
            val = df.iloc[idx][col]
            if pd.isna(val):
                return None
            return float(val)
    except:
        pass
    return None

def to_yi(val):
    """转换为亿元（原始数据为元）"""
    if val is None:
        return None
    return round(val / 1e8, 2)

# ============ 3. 提取关键财务数据 ============
print("\n提取关键财务数据...")

results = {"report_dates": report_dates, "years": []}

for i in range(len(df_p)):
    year_data = {}
    report_name = df_p.iloc[i].get('REPORT_DATE_NAME', '')
    year_data['报告期'] = report_name

    # --- 利润表 ---
    year_data['营业总收入'] = to_yi(safe_get(df_p, 'TOTAL_OPERATE_INCOME', i))
    year_data['营业收入'] = to_yi(safe_get(df_p, 'OPERATE_INCOME', i))
    year_data['营业总成本'] = to_yi(safe_get(df_p, 'TOTAL_OPERATE_COST', i))
    year_data['营业成本'] = to_yi(safe_get(df_p, 'OPERATE_COST', i))
    year_data['销售费用'] = to_yi(safe_get(df_p, 'SALE_EXPENSE', i))
    year_data['管理费用'] = to_yi(safe_get(df_p, 'MANAGE_EXPENSE', i))
    year_data['研发费用'] = to_yi(safe_get(df_p, 'RESEARCH_EXPENSE', i))
    year_data['财务费用'] = to_yi(safe_get(df_p, 'FINANCE_EXPENSE', i))
    year_data['营业税金及附加'] = to_yi(safe_get(df_p, 'OPERATE_TAX_ADD', i))
    year_data['营业利润'] = to_yi(safe_get(df_p, 'OPERATE_PROFIT', i))
    year_data['利润总额'] = to_yi(safe_get(df_p, 'TOTAL_PROFIT', i))
    year_data['净利润'] = to_yi(safe_get(df_p, 'NETPROFIT', i))
    year_data['归母净利润'] = to_yi(safe_get(df_p, 'PARENT_NETPROFIT', i))
    year_data['所得税'] = to_yi(safe_get(df_p, 'INCOME_TAX', i))

    # --- 资产负债表 ---
    year_data['总资产'] = to_yi(safe_get(df_b, 'TOTAL_ASSETS', i))
    year_data['总负债'] = to_yi(safe_get(df_b, 'TOTAL_LIABILITIES', i))
    year_data['所有者权益合计'] = to_yi(safe_get(df_b, 'TOTAL_EQUITY', i))
    year_data['归母所有者权益'] = to_yi(safe_get(df_b, 'TOTAL_PARENT_EQUITY', i))
    year_data['流动资产合计'] = to_yi(safe_get(df_b, 'TOTAL_CURRENT_ASSETS', i))
    year_data['非流动资产合计'] = to_yi(safe_get(df_b, 'TOTAL_NONCURRENT_ASSETS', i))
    year_data['流动负债合计'] = to_yi(safe_get(df_b, 'TOTAL_CURRENT_LIAB', i))
    year_data['非流动负债合计'] = to_yi(safe_get(df_b, 'TOTAL_NONCURRENT_LIAB', i))
    year_data['货币资金'] = to_yi(safe_get(df_b, 'MONETARYFUNDS', i))
    year_data['存货'] = to_yi(safe_get(df_b, 'INVENTORY', i))
    year_data['应收账款'] = to_yi(safe_get(df_b, 'ACCOUNTS_RECE', i))
    year_data['预付款项'] = to_yi(safe_get(df_b, 'PREPAYMENT', i))
    year_data['合同负债'] = to_yi(safe_get(df_b, 'CONTRACT_LIAB', i))
    year_data['短期借款'] = to_yi(safe_get(df_b, 'SHORT_LOAN', i))
    year_data['长期借款'] = to_yi(safe_get(df_b, 'LONG_LOAN', i))
    year_data['应付账款'] = to_yi(safe_get(df_b, 'ACCOUNTS_PAYABLE', i))
    year_data['固定资产'] = to_yi(safe_get(df_b, 'FIXED_ASSET', i))
    year_data['在建工程'] = to_yi(safe_get(df_b, 'CIP', i))

    # --- 现金流量表 ---
    year_data['经营活动现金流净额'] = to_yi(safe_get(df_c, 'NETCASH_OPERATE', i))
    year_data['投资活动现金流净额'] = to_yi(safe_get(df_c, 'NETCASH_INVEST', i))
    year_data['筹资活动现金流净额'] = to_yi(safe_get(df_c, 'NETCASH_FINANCE', i))
    year_data['现金流净增加额'] = to_yi(safe_get(df_c, 'CCE_ADD', i))
    year_data['购建固定资产无形资产支付'] = to_yi(safe_get(df_c, 'CONSTRUCT_LONG_ASSET', i))

    results['years'].append(year_data)

# ============ 4. 计算财务指标 ============
print("计算财务指标...")

for i, yd in enumerate(results['years']):
    rev = yd.get('营业收入')
    net_profit = yd.get('归母净利润')
    total_profit = yd.get('利润总额')
    income_tax = yd.get('所得税')
    total_assets = yd.get('总资产')
    total_equity = yd.get('归母所有者权益')
    total_liab = yd.get('总负债')
    current_assets = yd.get('流动资产合计')
    current_liab = yd.get('流动负债合计')
    inventory = yd.get('存货')
    ocf = yd.get('经营活动现金流净额')
    capex = yd.get('购建固定资产无形资产支付')
    oper_cost = yd.get('营业成本')
    sell_exp = yd.get('销售费用')
    mgmt_exp = yd.get('管理费用')
    rd_exp = yd.get('研发费用')
    fin_exp = yd.get('财务费用')
    monetary = yd.get('货币资金')
    ar = yd.get('应收账款')
    ap = yd.get('应付账款')
    prepay = yd.get('预付款项')

    # 盈利能力
    yd['毛利率'] = round((rev - oper_cost) / rev * 100, 2) if (rev and oper_cost is not None) else None
    yd['净利率'] = round(net_profit / rev * 100, 2) if (rev and net_profit) else None
    yd['实际税率'] = round(income_tax / total_profit * 100, 2) if (total_profit and income_tax is not None and total_profit != 0) else None
    prev = results['years'][i + 1] if i < len(results['years']) - 1 else None
    avg_equity = (total_equity + prev.get('归母所有者权益')) / 2 if prev and total_equity and prev.get('归母所有者权益') else total_equity
    avg_assets = (total_assets + prev.get('总资产')) / 2 if prev and total_assets and prev.get('总资产') else total_assets
    yd['平均归母权益'] = round(avg_equity, 2) if avg_equity else None
    yd['平均总资产'] = round(avg_assets, 2) if avg_assets else None
    yd['ROE'] = round(net_profit / avg_equity * 100, 2) if (net_profit and avg_equity) else None
    yd['ROA'] = round(net_profit / avg_assets * 100, 2) if (net_profit and avg_assets) else None

    # 偿债安全
    yd['资产负债率'] = round(total_liab / total_assets * 100, 2) if (total_liab is not None and total_assets) else None
    yd['流动比率'] = round(current_assets / current_liab, 2) if (current_assets and current_liab) else None
    yd['速动比率'] = round((current_assets - (inventory or 0)) / current_liab, 2) if (current_assets and current_liab) else None
    yd['货币资金/流动负债'] = round(monetary / current_liab, 2) if (monetary and current_liab) else None

    # 运营效率
    yd['销售费用率'] = round(sell_exp / rev * 100, 2) if (sell_exp is not None and rev) else None
    yd['管理费用率'] = round(mgmt_exp / rev * 100, 2) if (mgmt_exp is not None and rev) else None
    yd['研发费用率'] = round(rd_exp / rev * 100, 2) if (rd_exp is not None and rev) else None
    yd['财务费用率'] = round(fin_exp / rev * 100, 2) if (fin_exp is not None and rev) else None

    # 现金流质量
    yd['净现比'] = round(ocf / net_profit, 2) if (ocf and net_profit and net_profit != 0) else None
    yd['自由现金流'] = round(ocf - (capex or 0), 2) if (ocf is not None) else None
    yd['FCF/营收'] = round((ocf - (capex or 0)) / rev * 100, 2) if (ocf is not None and rev) else None
    yd['资本开支'] = capex

    # 增长率（与下一年比较，因为数据降序排列）
    if i < len(results['years']) - 1:
        prev = results['years'][i + 1]
        prev_rev = prev.get('营业收入')
        prev_np = prev.get('归母净利润')
        prev_ocf = prev.get('经营活动现金流净额')
        yd['营收增速'] = round((rev - prev_rev) / prev_rev * 100, 2) if (rev and prev_rev and prev_rev != 0) else None
        yd['净利增速'] = round((net_profit - prev_np) / prev_np * 100, 2) if (net_profit and prev_np and prev_np != 0) else None
        yd['经营现金流增速'] = round((ocf - prev_ocf) / abs(prev_ocf) * 100, 2) if (ocf is not None and prev_ocf and prev_ocf != 0) else None
    else:
        yd['营收增速'] = None
        yd['净利增速'] = None
        yd['经营现金流增速'] = None

    # 杜邦分解
    yd['总资产周转率'] = round(rev / avg_assets, 2) if (rev and avg_assets) else None
    yd['权益乘数'] = round(avg_assets / avg_equity, 2) if (avg_assets and avg_equity) else None

# ============ 5. 计算Sloan应计比率 ============
print("计算Sloan应计比率...")
for i, yd in enumerate(results['years']):
    net_profit = yd.get('净利润')
    ocf = yd.get('经营活动现金流净额')
    total_assets = yd.get('总资产')
    if i < len(results['years']) - 1:
        prev_ta = results['years'][i + 1].get('总资产')
        if total_assets and prev_ta and net_profit is not None and ocf is not None:
            avg_ta = (total_assets + prev_ta) / 2
            yd['Sloan应计比率'] = round((net_profit - ocf) / avg_ta * 100, 2)
        else:
            yd['Sloan应计比率'] = None
    else:
        yd['Sloan应计比率'] = None

# ============ 6. 分红数据处理 ============
print("处理分红数据...")
dividend_list = []
for _, row in df_dividend.iterrows():
    div = {
        '公告日期': str(row.get('公告日期', '')),
        '送股': float(row.get('送股', 0)) if pd.notna(row.get('送股')) else 0,
        '转增': float(row.get('转增', 0)) if pd.notna(row.get('转增')) else 0,
        '派息': float(row.get('派息', 0)) if pd.notna(row.get('派息')) else 0,
        '进度': str(row.get('进度', '')),
        '除权除息日': str(row.get('除权除息日', '')),
    }
    dividend_list.append(div)

results['dividends'] = dividend_list

# ============ 7. 计算DCF敏感性矩阵 ============
print("计算DCF敏感性矩阵...")

# 用最近一个完整年报的归母净利润作为基期
latest = results['years'][0]
base_np = latest.get('归母净利润')
if base_np:
    # 参数假设（白酒行业：高增长5-8%, WACC=9%, g=3%）
    wacc_range = [0.08, 0.085, 0.09, 0.095, 0.10]
    g_range = [0.02, 0.025, 0.03, 0.035, 0.04]
    high_growth = 0.06  # 高增长阶段假设6%
    high_years = 5  # 高增长5年
    transition_years = 5  # 过渡5年线性降至g

    dcf_matrix = []
    for wacc in wacc_range:
        row = []
        for g in g_range:
            # 两阶段DCF
            pv = 0
            # 高增长阶段
            cf = base_np
            for yr in range(1, high_years + 1):
                cf = cf * (1 + high_growth)
                pv += cf / ((1 + wacc) ** yr)
            # 过渡阶段（线性从high_growth降到g）
            for yr in range(1, transition_years + 1):
                growth = high_growth - (high_growth - g) * yr / transition_years
                cf = cf * (1 + growth)
                pv += cf / ((1 + wacc) ** (high_years + yr))
            # 永续阶段
            terminal_cf = cf * (1 + g)
            terminal_value = terminal_cf / (wacc - g)
            pv += terminal_value / ((1 + wacc) ** (high_years + transition_years))
            row.append(round(pv, 2))
        dcf_matrix.append(row)

    results['dcf_matrix'] = {
        'wacc_range': wacc_range,
        'g_range': g_range,
        'matrix': dcf_matrix,
        'base_np': base_np,
        'high_growth': high_growth,
        'high_years': high_years,
        'transition_years': transition_years,
        'unit': '亿元'
    }
    print(f"  DCF基期净利润: {base_np}亿元")
    print(f"  估值范围: {min(min(r) for r in dcf_matrix):.0f} ~ {max(max(r) for r in dcf_matrix):.0f}亿元")

# ============ 8. 输出 ============
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"\n计算结果已保存到: {output_file}")

# 打印摘要
print("\n" + "=" * 60)
print("关键指标摘要（最近年报）")
print("=" * 60)
latest = results['years'][0]
print(f"报告期: {latest['报告期']}")
print(f"营业收入: {latest['营业收入']}亿元")
print(f"归母净利润: {latest['归母净利润']}亿元")
print(f"毛利率: {latest['毛利率']}%")
print(f"净利率: {latest['净利率']}%")
print(f"ROE: {latest['ROE']}%")
print(f"资产负债率: {latest['资产负债率']}%")
print(f"净现比: {latest['净现比']}")
print(f"自由现金流: {latest['自由现金流']}亿元")

print("\n近5年趋势:")
for yd in results['years'][:5]:
    print(f"  {yd['报告期']}: 营收={yd.get('营业收入')}亿, 净利={yd.get('归母净利润')}亿, ROE={yd.get('ROE')}%, 毛利率={yd.get('毛利率')}%")

print(f"\n分红记录: {len(dividend_list)}条")
for d in dividend_list[:5]:
    print(f"  {d['公告日期']}: 派息{d['派息']}元/10股 ({d['进度']})")
