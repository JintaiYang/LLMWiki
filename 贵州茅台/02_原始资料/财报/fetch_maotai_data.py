#!/usr/bin/env python3
"""通过 akshare 获取贵州茅台(SH600519)财务数据，保存为CSV"""
import akshare as ak
import pandas as pd
import os

symbol = "SH600519"
code = "600519"
output_dir = os.path.dirname(os.path.abspath(__file__))

print("=" * 60)
print(f"开始获取贵州茅台({symbol})财务数据")
print("=" * 60)

# 1. 利润表
print("\n[1/5] 获取利润表...")
try:
    df_profit = ak.stock_profit_sheet_by_report_em(symbol=symbol)
    df_profit.to_csv(os.path.join(output_dir, 'maotai_profit.csv'), index=False)
    print(f"  利润表: {len(df_profit)} 条记录")
    print(f"  列名: {list(df_profit.columns[:10])}...")
except Exception as e:
    print(f"  错误: {e}")

# 2. 资产负债表
print("\n[2/5] 获取资产负债表...")
try:
    df_balance = ak.stock_balance_sheet_by_report_em(symbol=symbol)
    df_balance.to_csv(os.path.join(output_dir, 'maotai_balance.csv'), index=False)
    print(f"  资产负债表: {len(df_balance)} 条记录")
except Exception as e:
    print(f"  错误: {e}")

# 3. 现金流量表
print("\n[3/5] 获取现金流量表...")
try:
    df_cashflow = ak.stock_cash_flow_sheet_by_report_em(symbol=symbol)
    df_cashflow.to_csv(os.path.join(output_dir, 'maotai_cashflow.csv'), index=False)
    print(f"  现金流量表: {len(df_cashflow)} 条记录")
except Exception as e:
    print(f"  错误: {e}")

# 4. 分红数据
print("\n[4/5] 获取分红数据...")
try:
    df_dividend = ak.stock_dividend_cninfo(symbol=code, start_date="20100101", end_date="20261231")
    df_dividend.to_csv(os.path.join(output_dir, 'maotai_dividend.csv'), index=False)
    print(f"  分红数据: {len(df_dividend)} 条记录")
except Exception as e:
    print(f"  错误: {e}")

# 5. 实时行情
print("\n[5/5] 获取实时行情...")
try:
    df_spot = ak.stock_zh_a_spot_em()
    target = df_spot[df_spot['代码'] == code]
    target.to_csv(os.path.join(output_dir, 'maotai_spot.csv'), index=False)
    print(f"  实时行情: {len(target)} 条记录")
    if len(target) > 0:
        print(f"  当前股价: {target.iloc[0].get('最新价', 'N/A')}")
        print(f"  总市值: {target.iloc[0].get('总市值', 'N/A')}")
except Exception as e:
    print(f"  错误: {e}")

print("\n" + "=" * 60)
print("数据获取完成！")
print(f"输出目录: {output_dir}")
print("=" * 60)
