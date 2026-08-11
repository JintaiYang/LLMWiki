#!/usr/bin/env python3
"""Fetch deep research data for 杭州银行 (600926) from AkShare."""
import akshare as ak
import pandas as pd
import json
import warnings
import os
warnings.filterwarnings('ignore')

BANK = "杭州银行"
CODE = "600926"
OUT = "02_原始资料/04_AkShare数据/深度采集"
os.makedirs(OUT, exist_ok=True)

def save_csv(df, name):
    path = os.path.join(OUT, f"{CODE}_{name}.csv")
    df.to_csv(path, index=False, encoding='utf-8-sig')
    print(f"  ✓ Saved {path} ({len(df)} rows)")
    return df

# 1. 利润表 (东方财富按报告期)
print("--- 1. Profit Sheet ---")
try:
    df = ak.stock_profit_sheet_by_report_em(symbol=CODE)
    if df is not None and len(df) > 0:
        save_csv(df, "profit_sheet")
    else:
        print("  No data returned")
except Exception as e:
    print(f"  ✗ profit_sheet: {e}")

# 2. 资产负债表 (东方财富按报告期)
print("--- 2. Balance Sheet ---")
try:
    df = ak.stock_balance_sheet_by_report_em(symbol=CODE)
    if df is not None and len(df) > 0:
        save_csv(df, "balance_sheet")
    else:
        print("  No data returned")
except Exception as e:
    print(f"  ✗ balance_sheet: {e}")

# 3. 现金流量表 (东方财富按报告期)
print("--- 3. Cash Flow ---")
try:
    df = ak.stock_cash_flow_sheet_by_report_em(symbol=CODE)
    if df is not None and len(df) > 0:
        save_csv(df, "cash_flow")
    else:
        print("  No data returned")
except Exception as e:
    print(f"  ✗ cash_flow: {e}")

# 4. 主要财务指标
print("--- 4. Financial Analysis Indicators ---")
try:
    df = ak.stock_financial_analysis_indicator(symbol=CODE)
    if df is not None and len(df) > 0:
        save_csv(df, "financial_analysis")
    else:
        print("  No data returned")
except Exception as e:
    print(f"  ✗ financial_analysis: {e}")

# 5. 十大股东
print("--- 5. Top 10 Shareholders ---")
try:
    df = ak.stock_gdfx_free_holding_detail_em(symbol=CODE)
    if df is not None and len(df) > 0:
        save_csv(df, "top10_shareholders")
    else:
        print("  No data returned")
except Exception as e:
    print(f"  ✗ top10_shareholders: {e}")

# 6. 个股信息
print("--- 6. Stock Individual Info ---")
try:
    df = ak.stock_individual_info_em(symbol=CODE)
    if df is not None and len(df) > 0:
        save_csv(df, "individual_info")
        print(f"  Info:\n{df.to_string()}")
    else:
        print("  No data returned")
except Exception as e:
    print(f"  ✗ individual_info: {e}")

# 7. 杜邦分析
print("--- 7. DuPont Analysis ---")
try:
    df = ak.stock_dupont_analysis(symbol=CODE)
    if df is not None and len(df) > 0:
        save_csv(df, "dupont")
    else:
        print("  No data returned")
except Exception as e:
    print(f"  ✗ dupont: {e}")

print("\n=== All done ===")
