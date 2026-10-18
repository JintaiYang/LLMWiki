#!/usr/bin/env python3
"""采集A股42家银行分红送配历史（东方财富 stock_fhps_detail_em）.

用于打分公式 F3（现金分红率）与 G2（股息率）的历史序列。
"现金分红-现金分红比例" = 每10股派现（元），需 ×0.1×股本 ÷ 归母净利润 得分红率。

输出: 02_原始资料/04_AkShare数据/分红/分红历史/{code}_{name}_dividend_history.csv

用法: python3 scripts/fetch_bank_dividend_history.py
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("TQDM_DISABLE", "1")

import pandas as pd  # noqa: E402

try:
    import akshare as ak  # type: ignore
except Exception as exc:  # noqa: BLE001
    print(f"[fatal] 无法导入akshare: {exc}")
    sys.exit(1)

VAULT_ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_CSV = VAULT_ROOT / "02_原始资料" / "04_AkShare数据" / "数据字典与运行记录" / "a_share_banks_universe.csv"
OUT_DIR = VAULT_ROOT / "02_原始资料" / "04_AkShare数据" / "分红" / "分红历史"

KEEP_COLS = [
    "报告期", "送转股份-送转总比例", "现金分红-现金分红比例", "现金分红-股息率",
    "每股收益", "每股净资产", "总股本", "除权除息日", "方案进度",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="重新采集已有文件")
    args = parser.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    universe = pd.read_csv(UNIVERSE_CSV, dtype={"code": str})
    ok, fail = 0, []
    for _, bank in universe.iterrows():
        code, name = bank["code"], bank["name"]
        out_path = OUT_DIR / f"{code}_{name}_dividend_history.csv"
        if out_path.exists() and out_path.stat().st_size > 0 and not args.force:
            ok += 1
            continue
        try:
            df = ak.stock_fhps_detail_em(symbol=code)
            if df is None or df.empty:
                raise RuntimeError("empty result")
            keep = [c for c in KEEP_COLS if c in df.columns]
            df = df[keep].copy()
            df.insert(0, "银行代码", code)
            df.insert(1, "银行名称", name)
            df.to_csv(out_path, index=False, encoding="utf-8-sig")
            ok += 1
            print(f"[ok] {code} {name}: {len(df)}条分红记录")
        except Exception as exc:  # noqa: BLE001
            fail.append(f"{code}{name}: {exc}")
            print(f"[fail] {code} {name}: {exc}")
        time.sleep(0.8)
    print(f"\n[done] ok={ok}/{len(universe)}" + (f"，失败: {fail}" if fail else ""))
    return 0 if not fail else 1


if __name__ == "__main__":
    sys.exit(main())
