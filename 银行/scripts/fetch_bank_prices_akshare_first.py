#!/usr/bin/env python3
"""按银行逐项采集未复权收盘价：AkShare 有值即用，缺项再用 iFind。"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.json"
OUT = ROOT / "02_原始资料/05_iFind数据/latest_prices.json"
FALLBACK = ROOT / "scripts/fetch_latest_bank_prices.js"


def valid_price(value):
    try:
        price = float(value)
        return price if math.isfinite(price) and price > 0 else None
    except (TypeError, ValueError):
        return None


def latest_close(frame, date_column, close_column):
    if frame is None or frame.empty or date_column not in frame or close_column not in frame:
        raise ValueError("无日线收盘数据")
    for _, row in frame.sort_values(date_column).iloc[::-1].iterrows():
        close = valid_price(row[close_column])
        day = str(row[date_column])[:10]
        try:
            parsed = date.fromisoformat(day)
        except ValueError:
            continue
        if close and parsed <= date.today():
            return close, day
    raise ValueError("无可用的未复权收盘价和日期")


def collect_akshare(banks, start, end, fetch, fetch_tx=None):
    found = {}
    missing = {}
    eastmoney_failures = 0
    for bank in banks:
        code = bank["code"]
        errors = []
        if eastmoney_failures < 3:
            try:
                frame = fetch(symbol=code, period="daily", start_date=start, end_date=end, adjust="", timeout=10)
                close, day = latest_close(frame, "日期", "收盘")
                found[code] = {"code": code, "name": bank["name"], "close": close,
                               "price_date": day, "source": "AkShare stock_zh_a_hist 未复权日线"}
                eastmoney_failures = 0
            except Exception as exc:
                errors.append(f"东方财富: {exc}")
                if isinstance(exc, (ConnectionError, TimeoutError)) or any(term in str(exc) for term in ("Connection aborted", "RemoteDisconnected", "timed out")):
                    eastmoney_failures += 1
                else:
                    eastmoney_failures = 0
        else:
            errors.append("东方财富连接连续中断，跳过该端点")
        if code not in found and fetch_tx is not None:
            try:
                market = "sh" if code.startswith("6") else "sz"
                frame = fetch_tx(symbol=market + code, start_date=start, end_date=end, adjust="", timeout=10)
                close, day = latest_close(frame, "date", "close")
                found[code] = {"code": code, "name": bank["name"], "close": close,
                               "price_date": day, "source": "AkShare stock_zh_a_hist_tx 未复权日线"}
            except Exception as exc:
                errors.append(f"腾讯: {exc}")
        if code in found:
            print(f"[AkShare] {code} {bank['name']}: {found[code]['price_date']} {found[code]['close']} ({found[code]['source']})", flush=True)
        else:
            missing[code] = "; ".join(errors)
            print(f"[AkShare 缺项] {code} {bank['name']}: {missing[code]}", flush=True)
    return found, missing


def collect_ifind(codes, runner=subprocess.run):
    if not codes:
        return {}
    command = ["node", str(FALLBACK), "--codes", ",".join(codes)]
    result = runner(command, cwd=ROOT, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError("iFind 回退失败：" + (result.stderr or result.stdout)[-1200:])
    payload = json.loads(result.stdout)
    expected = set(codes)
    entries = payload.get("banks") or []
    if set(row.get("code") for row in entries) != expected:
        raise ValueError("iFind 回退返回的银行代码与请求不一致")
    found = {}
    for row in entries:
        close = valid_price(row.get("close"))
        if not close or not row.get("price_date"):
            raise ValueError(f"iFind 回退未提供有效收盘价/日期：{row.get('code')}")
        found[row["code"]] = {"code": row["code"], "name": row["name"], "close": close,
                              "price_date": row["price_date"], "source": "iFind get_stock_performance 未复权收盘价"}
    return found


def build_payload(banks, found, missing):
    rows = [found[bank["code"]] for bank in banks if bank["code"] in found]
    dates = {row["price_date"] for row in rows}
    sources = {row["source"] for row in rows}
    latest = max(dates) if dates else None
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "price_date": next(iter(dates)) if len(dates) == 1 else None,
        "latest_price_date": latest,
        "source": next(iter(sources)) if len(sources) == 1 else "AkShare 优先，iFind 逐项补缺",
        "banks": rows,
        "missing": [bank["name"] for bank in banks if bank["code"] not in found],
        "fallback_reasons": {code: reason for code, reason in missing.items() if code in found},
        "price_date_note": "各银行观测日不同；统一日期为空时请查看逐银行价格日" if len(dates) != 1 else "",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="验证参数，不访问数据源或写文件")
    args = parser.parse_args()
    banks = json.loads(UNIVERSE.read_text(encoding="utf-8"))["banks"]
    if args.dry_run:
        print(f"准备采集 {len(banks)} 家；AkShare 东方财富→腾讯日线优先、iFind 按代码补缺；不会因日期较旧而改选 iFind")
        return 0
    try:
        import akshare as ak
        today = date.today()
        found, missing = collect_akshare(banks, (today - timedelta(days=45)).strftime("%Y%m%d"),
                                         today.strftime("%Y%m%d"), ak.stock_zh_a_hist, ak.stock_zh_a_hist_tx)
    except Exception as exc:
        print(f"[AkShare 不可用] {exc}；对全部银行尝试 iFind", flush=True)
        found, missing = {}, {bank["code"]: str(exc) for bank in banks}
    codes = list(missing)
    if codes:
        try:
            found.update(collect_ifind(codes))
        except Exception as exc:
            print(f"[iFind 回退失败] {exc}", file=sys.stderr)
    unresolved = [code for code in missing if code not in found]
    if unresolved:
        print(f"[未更新] {len(unresolved)} 家缺报价；旧行情文件保持不变：{','.join(unresolved)}", file=sys.stderr)
        return 1
    payload = build_payload(banks, found, missing)
    if len(payload["banks"]) != len(banks):
        print("[未更新] 银行覆盖不完整；旧行情文件保持不变", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ak_count = sum(row["source"].startswith("AkShare") for row in payload["banks"])
    print(f"[完成] AkShare {ak_count} 家，iFind 补缺 {len(banks) - ak_count} 家；来源/日期逐行记录", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
