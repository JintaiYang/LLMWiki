"""Cache AKShare financial statements before considering PDF or iFinD supplements."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import warnings

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")
import akshare as ak
import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "akshare"
KINDS = {"income": "利润表", "balance": "资产负债表", "cashflow": "现金流量表", "abstract": "关键指标"}
original_request = requests.sessions.Session.request


def bounded_request(self, method, url, **kwargs):
    kwargs.setdefault("timeout", (10, 30))
    return original_request(self, method, url, **kwargs)


requests.sessions.Session.request = bounded_request


def fetch(company, kind, refresh):
    code = company["code"]
    target = RAW / f"{code}_{kind}.json"
    if target.exists() and not refresh:
        return f"cached {code} {kind}"
    symbol = ("sh" if code.startswith("6") else "sz") + code
    error = None
    for attempt in range(2):
        try:
            if kind == "abstract":
                frame = ak.stock_financial_abstract(symbol=code)
                frame = frame.drop_duplicates(subset=["指标"]).set_index("指标").drop(columns=["选项"]).T
                frame.index.name = "报告日"
                frame = frame.reset_index()
            else:
                frame = ak.stock_financial_report_sina(stock=symbol, symbol=KINDS[kind])
            if frame.empty or "报告日" not in frame:
                raise ValueError("No financial statement rows")
            frame = frame[(frame["报告日"].astype(str) >= "20201231") & (frame["报告日"].astype(str) <= "20260630")]
            rows = json.loads(frame.to_json(orient="records", force_ascii=False))
            payload = {"provider": "AKShare", "akshare_version": ak.__version__, "function": "stock_financial_abstract" if kind == "abstract" else "stock_financial_report_sina", "upstream": "新浪财经", "unit": "CNY", "code": code, "statement": kind, "retrieved": datetime.now(timezone.utc).isoformat(), "rows": rows}
            target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
            return f"fetched {code} {kind} {len(rows)}"
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
    return f"FAILED {code} {kind}: {error}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--code")
    parser.add_argument("--only", choices=list(KINDS))
    args = parser.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    companies = json.loads((ROOT / "data" / "companies.json").read_text())
    if args.code:
        companies = [c for c in companies if c["code"] == args.code]
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = [pool.submit(fetch, company, kind, args.refresh) for company in companies for kind in KINDS if not args.only or args.only == kind]
        for job in as_completed(jobs):
            result = job.result()
            results.append(result)
            print(result, flush=True)
    (RAW / "fetch_log.json").write_text(json.dumps({"retrieved": datetime.now(timezone.utc).isoformat(), "results": results}, ensure_ascii=False, indent=2) + "\n")
    if any(item.startswith("FAILED") for item in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
