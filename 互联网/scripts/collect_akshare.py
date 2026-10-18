"""Collect auditable HK/US financial statements before considering PDF/iFinD fallbacks."""
import argparse
import json
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import akshare as ak
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "akshare"
STOCKS = ["00700", "09988", "03690", "09618", "09999", "09961", "09888", "01024", "09626", "01698", "PDD"]
original_request = requests.sessions.Session.request


def bounded_request(self, method, url, **kwargs):
    kwargs.setdefault("timeout", (6, 16))
    return original_request(self, method, url, **kwargs)


requests.sessions.Session.request = bounded_request
socket.setdefaulttimeout(18)


def collect(code, kind, us_interim=False):
    file = OUT / f"{code}-{kind}.json"
    try:
        if kind == "indicators":
            frame = (ak.stock_financial_us_analysis_indicator_em(symbol="PDD", indicator="累计季报" if us_interim else "年报") if code == "PDD"
                     else ak.stock_financial_hk_analysis_indicator_em(symbol=code, indicator="报告期"))
        elif kind == "prices":
            try:
                frame = (ak.stock_us_hist(symbol="105.PDD", start_date="20260901", end_date="20261016", adjust="") if code == "PDD"
                         else ak.stock_hk_hist(symbol=code, start_date="20260901", end_date="20261016", adjust=""))
            except Exception:
                frame = ak.stock_us_daily(symbol="PDD", adjust="") if code == "PDD" else ak.stock_hk_daily(symbol=code, adjust="")
                frame = frame.rename(columns={"date": "日期", "close": "收盘", "open": "开盘", "high": "最高", "low": "最低"})
            frame = frame[(frame["日期"].astype(str) >= "2026-09-01") & (frame["日期"].astype(str) <= "2026-10-16")]
        else:
            label = {"income": "利润表", "balance": "资产负债表", "cashflow": "现金流量表"}[kind]
            frame = (ak.stock_financial_us_report_em(stock="PDD", symbol="综合损益表" if kind == "income" else label, indicator="累计季报" if us_interim else "年报") if code == "PDD"
                     else ak.stock_financial_hk_report_em(stock=code, symbol=label, indicator="报告期"))
        if frame.empty:
            raise ValueError("empty response")
        if code == "PDD" and us_interim and file.exists():
            previous_records = json.loads(file.read_text(encoding="utf-8"))["records"]
            frame = pd.concat([pd.DataFrame(previous_records), frame], ignore_index=True)
            frame = frame.drop_duplicates(subset=["REPORT_DATE"] + (["STD_ITEM_CODE"] if "STD_ITEM_CODE" in frame.columns else []), keep="last")
        if "REPORT_DATE" in frame.columns:
            frame = frame[frame["REPORT_DATE"].astype(str) >= "2020-01-01"]
        records = json.loads(frame.to_json(orient="records", date_format="iso", force_ascii=False))
        file.write_text(json.dumps({"provider": "AKShare", "akshare_version": ak.__version__, "code": code, "kind": kind,
                                   "collected_at": datetime.now().isoformat(), "records": records}, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"code": code, "kind": kind, "status": "ok", "rows": len(records), "file": str(file.relative_to(ROOT))}
    except Exception as error:
        return {"code": code, "kind": kind, "status": "failed", "error": str(error)[:400]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codes", default=",".join(STOCKS))
    parser.add_argument("--kinds", default="indicators,income,balance,cashflow,prices")
    parser.add_argument("--us-interim", action="store_true", help="Merge cumulative US interim periods into cached annual data")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    result = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(collect, code, kind, args.us_interim) for code in args.codes.split(",") for kind in args.kinds.split(",")]
        for future in as_completed(futures):
            row = future.result()
            result.append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
    log = OUT / "run.json"
    previous = json.loads(log.read_text(encoding="utf-8")).get("attempts", []) if log.exists() else []
    for row in result:
        row["attempted_at"] = datetime.now().isoformat()
    log.write_text(json.dumps({"as_of": "2026-10-18", "priority": ["AKShare", "official PDF", "iFinD"], "attempts": previous + result}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
