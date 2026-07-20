#!/usr/bin/env python3
"""修复分红和行情数据获取"""
import akshare as ak
import pandas as pd
import os

code = "600519"
output_dir = os.path.dirname(os.path.abspath(__file__))

# 4. 分红数据 - 修复参数
print("[4/5] 获取分红数据(重试)...")
try:
    # 查看函数签名
    import inspect
    sig = inspect.signature(ak.stock_dividend_cninfo)
    print(f"  函数签名: {sig}")
    df_dividend = ak.stock_dividend_cninfo(symbol=code)
    df_dividend.to_csv(os.path.join(output_dir, 'maotai_dividend.csv'), index=False)
    print(f"  分红数据: {len(df_dividend)} 条记录")
    if len(df_dividend) > 0:
        print(f"  列名: {list(df_dividend.columns)}")
        print(df_dividend.head(3).to_string())
except Exception as e:
    print(f"  错误: {e}")
    # 尝试备用接口
    try:
        print("  尝试备用接口 stock_history_dividend_detail...")
        df_div = ak.stock_history_dividend_detail(symbol=code, indicator="分红")
        df_div.to_csv(os.path.join(output_dir, 'maotai_dividend.csv'), index=False)
        print(f"  分红数据(备用): {len(df_div)} 条记录")
        print(f"  列名: {list(df_div.columns)}")
        print(df_div.head(3).to_string())
    except Exception as e2:
        print(f"  备用接口也失败: {e2}")

# 5. 实时行情 - 重试
print("\n[5/5] 获取实时行情(重试)...")
import time
for attempt in range(3):
    try:
        df_spot = ak.stock_zh_a_spot_em()
        target = df_spot[df_spot['代码'] == code]
        target.to_csv(os.path.join(output_dir, 'maotai_spot.csv'), index=False)
        print(f"  实时行情: {len(target)} 条记录")
        if len(target) > 0:
            row = target.iloc[0]
            print(f"  当前股价: {row.get('最新价', 'N/A')}")
            print(f"  总市值: {row.get('总市值', 'N/A')}")
            print(f"  总股本: {row.get('总股本', 'N/A')}")
        break
    except Exception as e:
        print(f"  尝试 {attempt+1} 失败: {e}")
        time.sleep(2)

print("\n完成！")
