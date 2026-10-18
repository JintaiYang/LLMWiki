#!/usr/bin/env python3
"""采集A股全部上市银行三大报表近20年全报告期数据（东方财富-按报告期）.

数据源（AkShare，API参考 https://akshare.akfamily.xyz/tutorial.html）:
- ak.stock_profit_sheet_by_report_em(symbol="SH600036")    利润表（按报告期）
- ak.stock_balance_sheet_by_report_em(symbol="SH600036")   资产负债表（按报告期）
- ak.stock_cash_flow_sheet_by_report_em(symbol="SH600036") 现金流量表（按报告期）

每次调用返回该股自上市以来全部报告期（一季报/中报/三季报/年报），
本脚本按 REPORT_DATE >= 2006-01-01 裁剪为近20年，并按报告日期升序保存。

输出目录: 02_原始资料/04_AkShare数据/三大报表/
- 利润表/{code}_{name}_income.csv
- 资产负债表/{code}_{name}_balance.csv
- 现金流量表/{code}_{name}_cashflow.csv
- 合并_利润表_all_banks.csv / 合并_资产负债表_all_banks.csv / 合并_现金流量表_all_banks.csv
- README.md（数据字典与口径说明）
- _银行清单.csv（本次实际采集清单）

运行元数据: 02_原始资料/04_AkShare数据/数据字典与运行记录/run_meta_<ts>.json

用法:
    python3 scripts/fetch_bank_statements_full.py               # 断点续传（已存在且非空则跳过）
    python3 scripts/fetch_bank_statements_full.py --force       # 全量重采
    python3 scripts/fetch_bank_statements_full.py --banks 600036,000001
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

os.environ.setdefault("TQDM_DISABLE", "1")  # 关闭akshare内部tqdm进度条，避免污染日志

import pandas as pd  # noqa: E402

try:
    import akshare as ak  # type: ignore
except Exception as exc:  # noqa: BLE001
    print(f"[fatal] 无法导入akshare: {exc}")
    sys.exit(1)

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "02_原始资料" / "04_AkShare数据" / "三大报表"
META_DIR = BASE_DIR / "02_原始资料" / "04_AkShare数据" / "数据字典与运行记录"
UNIVERSE_CSV = META_DIR / "a_share_banks_universe.csv"

START_DATE = "2006-01-01"  # 近20年报告期下限
REQUEST_INTERVAL_SEC = 1.0
RETRIES = 3

# (文件key, 中文表名, akshare接口名)
STATEMENTS: List[Dict[str, str]] = [
    {"key": "income", "cn": "利润表", "api": "stock_profit_sheet_by_report_em"},
    {"key": "balance", "cn": "资产负债表", "api": "stock_balance_sheet_by_report_em"},
    {"key": "cashflow", "cn": "现金流量表", "api": "stock_cash_flow_sheet_by_report_em"},
]


def load_banks() -> List[Dict[str, str]]:
    """加载银行清单：本地universe为主，并与东财银行板块成份股对账补新。"""
    df = pd.read_csv(UNIVERSE_CSV, dtype={"code": str})
    banks = df[["code", "name", "market"]].dropna().to_dict("records")
    known = {b["code"] for b in banks}
    try:
        cons = ak.stock_board_industry_cons_em(symbol="银行")
        cons["代码"] = cons["代码"].astype(str).str.zfill(6)
        for _, row in cons.iterrows():
            code = row["代码"]
            if code not in known:
                market = "SH" if code.startswith(("6", "9")) else ("SZ" if code.startswith(("0", "3")) else "BJ")
                banks.append({"code": code, "name": row["名称"], "market": market})
                print(f"[info] 新增东财银行板块成份股: {code} {row['名称']}")
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] 动态获取银行板块成份股失败，仅使用本地清单: {exc}")
    banks.sort(key=lambda b: b["code"])
    return banks


def fetch_with_retry(func: Callable[..., pd.DataFrame], symbol: str) -> pd.DataFrame:
    last_exc: Optional[Exception] = None
    for attempt in range(1, RETRIES + 1):
        try:
            return func(symbol=symbol)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < RETRIES:
                wait = 2 ** attempt
                print(f"[retry] {symbol} 第{attempt}/{RETRIES}次失败: {exc}，{wait}s后重试")
                time.sleep(wait)
    raise RuntimeError(f"{symbol} 连续{RETRIES}次失败: {last_exc}")


def norm_report_date(v: Any) -> str:
    """'1999-12-31 00:00:00' -> '1999-12-31'。"""
    s = str(v)
    return s[:10]


def main() -> int:
    parser = argparse.ArgumentParser(description="采集A股银行三大报表近20年全报告期数据")
    parser.add_argument("--force", action="store_true", help="忽略本地已有文件，全量重采")
    parser.add_argument("--banks", default="", help="仅采集指定代码，逗号分隔，如 600036,000001")
    args = parser.parse_args()

    run_ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    banks = load_banks()
    if args.banks:
        wanted = {c.strip().zfill(6) for c in args.banks.split(",") if c.strip()}
        banks = [b for b in banks if b["code"] in wanted]
    print(f"[start] 本次采集 {len(banks)} 家银行 × {len(STATEMENTS)} 张报表，报告期下限 {START_DATE}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(banks)[["code", "name", "market"]].to_csv(DATA_DIR / "_银行清单.csv", index=False)

    results: List[Dict[str, Any]] = []
    total_calls = len(banks) * len(STATEMENTS)
    done_calls = 0

    for stmt in STATEMENTS:
        out_dir = DATA_DIR / stmt["cn"]
        out_dir.mkdir(parents=True, exist_ok=True)
        api = getattr(ak, stmt["api"])

        for b in banks:
            code, name, market = b["code"], b["name"], b["market"]
            symbol = f"{market}{code}"
            out_path = out_dir / f"{code}_{name}_{stmt['key']}.csv"
            rec: Dict[str, Any] = {
                "code": code, "name": name, "statement": stmt["cn"], "file": str(out_path.relative_to(BASE_DIR)),
            }

            if out_path.exists() and not args.force:
                try:
                    existing = pd.read_csv(out_path)
                    if len(existing) > 0:
                        done_calls += 1
                        rec.update(status="skip", rows=len(existing),
                                   date_min=existing["REPORT_DATE"].min(), date_max=existing["REPORT_DATE"].max())
                        results.append(rec)
                        print(f"[skip] {code} {name} {stmt['cn']}（已有 {len(existing)} 期）")
                        continue
                except Exception:  # noqa: BLE001
                    print(f"[warn] {out_path} 已存在但读取失败，将重新采集")

            try:
                df = fetch_with_retry(api, symbol)
                df = df.copy()
                df["REPORT_DATE"] = df["REPORT_DATE"].map(norm_report_date)
                df = df[df["REPORT_DATE"] >= START_DATE]
                df = df.sort_values("REPORT_DATE").reset_index(drop=True)
                # 同一报告日期保留最后一条（更新的披露）
                df = df.drop_duplicates(subset=["REPORT_DATE"], keep="last").reset_index(drop=True)
                df.insert(0, "银行代码", code)
                df.insert(1, "银行名称", name)
                df.to_csv(out_path, index=False, encoding="utf-8-sig")
                rec.update(status="ok", rows=len(df), cols=len(df.columns),
                           date_min=df["REPORT_DATE"].min(), date_max=df["REPORT_DATE"].max())
                print(f"[ok] {code} {name} {stmt['cn']}: {len(df)}期 × {len(df.columns)}列 "
                      f"({df['REPORT_DATE'].min()} ~ {df['REPORT_DATE'].max()})")
            except Exception as exc:  # noqa: BLE001
                rec.update(status="fail", error=str(exc))
                print(f"[fail] {code} {name} {stmt['cn']}: {exc}")
                traceback.print_exc()

            results.append(rec)
            done_calls += 1
            print(f"[progress] {done_calls}/{total_calls}")
            time.sleep(REQUEST_INTERVAL_SEC)

    # ---- 合并表（跨银行，便于对比分析） ----
    for stmt in STATEMENTS:
        out_dir = DATA_DIR / stmt["cn"]
        files = sorted(out_dir.glob(f"*_{stmt['key']}.csv"))
        frames = []
        for f in files:
            try:
                frames.append(pd.read_csv(f, dtype={"银行代码": str}))
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] 合并时读取失败 {f}: {exc}")
        if frames:
            combined = pd.concat(frames, ignore_index=True)
            combined = combined.sort_values(["银行代码", "REPORT_DATE"]).reset_index(drop=True)
            combined_path = DATA_DIR / f"合并_{stmt['cn']}_all_banks.csv"
            combined.to_csv(combined_path, index=False, encoding="utf-8-sig")
            print(f"[combine] {stmt['cn']}: {len(frames)}家 × 合计{len(combined)}行 -> {combined_path.name}")

    # ---- 运行元数据 ----
    ok = sum(1 for r in results if r["status"] == "ok")
    skip = sum(1 for r in results if r["status"] == "skip")
    fail = sum(1 for r in results if r["status"] == "fail")
    meta = {
        "script": "fetch_bank_statements_full.py",
        "purpose": "A股全部银行三大报表（利润表/资产负债表/现金流量表）近20年全报告期采集",
        "data_source": "AkShare 东方财富 按报告期接口（stock_*_sheet_by_report_em）",
        "tutorial": "https://akshare.akfamily.xyz/tutorial.html",
        "start_date_filter": START_DATE,
        "akshare_version": getattr(ak, "__version__", "unknown"),
        "bank_count": len(banks),
        "summary": {"ok": ok, "skip": skip, "fail": fail, "total": len(results)},
        "ran_at": run_ts,
        "results": results,
    }
    meta_path = META_DIR / f"run_meta_statements_full_{run_ts}.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (META_DIR / "run_meta_statements_full_latest.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] ok={ok} skip={skip} fail={fail}，元数据 -> {meta_path.name}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
