#!/usr/bin/env python3
"""Append missing historical statements and unadjusted year-end prices."""
import argparse
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import time

import requests

import liquor_pipeline as pipeline


BASE = "https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/"
ENDPOINTS = {"income": "lrb", "balance": "zcfzb", "cashflow": "xjllb"}
PRICE_URL = "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get"


def get_json(session, url, params):
    for attempt in range(3):
        try:
            response = session.get(url, params=params, timeout=15)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def append_csv(path, new_rows):
    if not new_rows:
        return
    existing = pipeline.load_csv(path)
    columns = list(dict.fromkeys(key for row in existing + new_rows for key in row))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".csv.tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        writer.writerows(existing + new_rows)
    temporary.replace(path)


def accepted_rows(rows, code, dates, snapshot):
    result = []
    for row in rows:
        day = pipeline.clean_date(row.get("REPORT_DATE"))
        notice = pipeline.clean_date(row.get("NOTICE_DATE"))
        updated = pipeline.clean_date(row.get("UPDATE_DATE"))
        if day not in dates or row.get("SECURITY_CODE") != code:
            raise ValueError("历史报表的公司或报告期与请求不符")
        if not notice or notice > snapshot or (row.get("UPDATE_DATE") and (not updated or updated > snapshot)):
            continue
        if row.get("CURRENCY") not in ("CNY", "RMB", "人民币", "1"):
            raise ValueError("历史报表不是人民币口径")
        result.append({**row, "REPORT_DATE": day})
    return result


def year_end_price(rows, year):
    valid = [(row[0], pipeline.number(row[2])) for row in rows if len(row) >= 3 and pipeline.clean_date(row[0]) and str(row[0]).startswith(str(year) + "-") and row[0] <= f"{year}-12-31" and pipeline.number(row[2]) is not None and pipeline.number(row[2]) > 0]
    return max(valid) if valid else None


def backfill_company(code, snapshot, include_prices=True):
    symbol = ("SH" if code.startswith("6") else "SZ") + code
    report = {"code": code, "name": pipeline.COMPANIES[code], "statements": {}, "errors": []}
    with requests.Session() as session:
        for kind, endpoint in ENDPOINTS.items():
            path = pipeline.RAW / kind / f"{code}.csv"
            existing = {pipeline.clean_date(row.get("REPORT_DATE")) for row in pipeline.load_csv(path)}
            try:
                listing = get_json(session, BASE + endpoint + "DateAjaxNew", {"companyType": "4", "reportDateType": "0", "code": symbol})
                available = sorted({pipeline.clean_date(row.get("REPORT_DATE")) for row in listing.get("data", [])} - {None})
                if not available:
                    raise ValueError("历史报告期列表为空")
                target = [day for day in available if pipeline.BASELINE_DATE <= day <= snapshot and int(day[:4]) <= pipeline.YEARS[-1] and day not in existing]
                new_rows = []
                for index in range(0, len(target), 5):
                    batch = target[index:index + 5]
                    response = get_json(session, BASE + endpoint + "AjaxNew", {"companyType": "4", "reportDateType": "0", "reportType": "1", "code": symbol, "dates": ",".join(batch)})
                    if not isinstance(response.get("data"), list):
                        raise ValueError("历史报表接口未返回数据列表")
                    rows = accepted_rows(response["data"], code, batch, snapshot)
                    retrieved = datetime.now(timezone.utc).isoformat()
                    new_rows.extend({**row, "HISTORY_SOURCE_URL": BASE + endpoint + "AjaxNew", "HISTORY_RETRIEVED_AT": retrieved} for row in rows)
                append_csv(path, new_rows)
                received = {row["REPORT_DATE"] for row in new_rows}
                report["statements"][kind] = {"added": len(new_rows), "earliest_available": available[0] if available else None, "unavailable_years": [year for year in pipeline.YEARS if f"{year}-12-31" not in available], "requested_but_missing": sorted(set(target) - received), "source": BASE + endpoint + "AjaxNew"}
            except (requests.RequestException, ValueError, OSError) as exc:
                report["errors"].append(f"{kind}: {type(exc).__name__}: {str(exc)[:180]}")
        if include_prices:
            path = pipeline.RAW / "price_year_end" / f"{code}.csv"
            existing_years = {str(row.get("日期", ""))[:4] for row in pipeline.load_csv(path)}
            prices, unavailable = [], []
            for year in pipeline.YEARS:
                if str(year) in existing_years or f"{year}-12-31" > snapshot:
                    continue
                try:
                    response = get_json(session, PRICE_URL, {"param": f"{symbol.lower()},day,{year}-01-01,{year}-12-31,40,"})
                    if response.get("code") != 0:
                        raise ValueError("腾讯历史行情接口返回错误")
                    rows = response.get("data", {}).get(symbol.lower(), {}).get("day", [])
                    price = year_end_price(rows, year)
                    if price:
                        prices.append({"日期": price[0], "收盘": price[1], "source": "Tencent newfqkline day unadjusted", "source_url": PRICE_URL, "retrieved_at": datetime.now(timezone.utc).isoformat()})
                    else:
                        unavailable.append(year)
                except (requests.RequestException, ValueError) as exc:
                    report["errors"].append(f"price/{year}: {type(exc).__name__}: {str(exc)[:120]}")
            append_csv(path, prices)
            report["prices"] = {"added": len(prices), "unavailable_years": unavailable, "source": PRICE_URL}
    print(code, report["name"], {key: value["added"] for key, value in report["statements"].items()}, "prices", report.get("prices", {}).get("added"), "errors", len(report["errors"]), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", default="2026-10-10")
    parser.add_argument("--reports-only", action="store_true")
    args = parser.parse_args()
    if pipeline.clean_date(args.as_of) != args.as_of:
        parser.error("--as-of 必须为有效日期")
    reports = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(backfill_company, code, args.as_of, not args.reports_only) for code in pipeline.COMPANIES]
        for future in as_completed(futures):
            reports.append(future.result())
    report = {"retrieved_at": datetime.now(timezone.utc).isoformat(), "as_of": args.as_of, "years": list(pipeline.YEARS), "baseline": pipeline.BASELINE_DATE, "scope": "current_constituents_historical_disclosures_not_historical_industry_membership", "companies": sorted(reports, key=lambda item: item["code"])}
    pipeline.dump(pipeline.ROOT / "04_运维报告" / "history_backfill.json", report)
    return int(any(item["errors"] or any(statement["requested_but_missing"] for statement in item["statements"].values()) for item in reports))


if __name__ == "__main__":
    raise SystemExit(main())
