#!/usr/bin/env python3
"""Generate per-bank time-series JSON files for the "个股数据分析对比" (stock detail) page.

Merges three AkShare-sourced CSV datasets for every A-share bank covered in
`02_原始资料/04_AkShare数据/`:

  - 财务摘要/<code>_<name>_financial_abstract.csv   -> profit & per-share metrics
  - 资产负债表/<code>_<name>_balance_sheet.csv        -> scale / balance-sheet metrics
  - 历史估值/<code>_<name>_valuation_history.csv      -> daily valuation & market data

For every reporting period (report_date) it produces one aligned record containing:
  - raw values for profit, balance-sheet and valuation metrics
  - YoY (same period last year) growth for flow/stock metrics where meaningful
  - single-quarter (unsmoothed) profit/revenue values derived from cumulative
    (YTD) figures, plus their YoY growth

Output:
  dashboard/stock_data/<code>.json   (one file per bank)
  dashboard/stock_data/_index.json   (code/name/file listing for the stock picker)

Usage:
    python3 scripts/generate_stock_detail_data.py

Design reference: docs/superpowers/specs/2026-08-12-stock-detail-dashboard-design.md
"""

from __future__ import annotations

import csv
import json
import re
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

VAULT_ROOT = Path(__file__).resolve().parent.parent
AKSHARE_DIR = VAULT_ROOT / "02_原始资料" / "04_AkShare数据"
ABSTRACT_DIR = AKSHARE_DIR / "财务摘要"
BALANCE_DIR = AKSHARE_DIR / "资产负债表"
VALUATION_DIR = AKSHARE_DIR / "历史估值"
DASHBOARD_DIR = VAULT_ROOT / "dashboard"
OUTPUT_DIR = DASHBOARD_DIR / "stock_data"

# 报告期 -> 季度序号 (1..4)，用于单季度拆分与同比匹配
QUARTER_END_SUFFIXES = {
    "-03-31": 1,
    "-06-30": 2,
    "-09-30": 3,
    "-12-31": 4,
}

# 需要做"单季度拆分"（因为原始值是年初至今累计口径）的流量指标
CUMULATIVE_FLOW_FIELDS = ["net_profit", "revenue"]


def warn(msg: str) -> None:
    warnings.warn(msg)


def parse_amount_yi(raw: str) -> Optional[float]:
    """解析形如 '12.77亿' 的字符串为浮点数（单位：亿元）。"""
    if raw is None:
        return None
    s = raw.strip()
    if s in ("", "False", "None", "-", "—"):
        return None
    m = re.match(r"^-?\d+(?:\.\d+)?", s.replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def parse_percent(raw: str) -> Optional[float]:
    """解析形如 '17.37%' 的字符串为浮点数百分比数值（保留百分比刻度，如 17.37）。"""
    if raw is None:
        return None
    s = raw.strip()
    if s in ("", "False", "None", "-", "—"):
        return None
    s = s.rstrip("%")
    try:
        return float(s)
    except ValueError:
        return None


def parse_float(raw: str) -> Optional[float]:
    if raw is None:
        return None
    s = raw.strip()
    if s in ("", "False", "None", "-", "—"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_date(raw: str) -> Optional[str]:
    """把 '2026-03-31' 或 '2026-03-31 00:00:00' 统一成 'YYYY-MM-DD'。"""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    return s.split(" ")[0]


def quarter_of(report_date: str) -> Optional[int]:
    for suffix, q in QUARTER_END_SUFFIXES.items():
        if report_date.endswith(suffix):
            return q
    return None


def year_of(report_date: str) -> Optional[int]:
    try:
        return int(report_date[:4])
    except (ValueError, TypeError):
        return None


def yoy_growth(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) / abs(previous) * 100, 2)


def discover_banks() -> List[Tuple[str, str]]:
    """以历史估值目录为准枚举 (code, name)，因为该目录覆盖面最广且命名最规范。"""
    banks: List[Tuple[str, str]] = []
    pattern = re.compile(r"^(\d{6})_(.+)_valuation_history\.csv$")
    for path in sorted(VALUATION_DIR.glob("*_valuation_history.csv")):
        m = pattern.match(path.name)
        if not m:
            continue
        code, name = m.group(1), m.group(2)
        banks.append((code, name))
    return banks


def read_csv_rows(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return [row for row in reader]


def load_financial_abstract(code: str, name: str) -> Dict[str, Dict[str, object]]:
    """返回 {report_date: {字段: 值}}，字段已解析为数值。"""
    path = ABSTRACT_DIR / f"{code}_{name}_financial_abstract.csv"
    rows = read_csv_rows(path)
    result: Dict[str, Dict[str, object]] = {}
    for row in rows:
        report_date = parse_date(row.get("报告期", ""))
        if not report_date:
            continue
        result[report_date] = {
            "net_profit_cum": parse_amount_yi(row.get("净利润", "")),
            "net_profit_cum_yoy_raw": parse_percent(row.get("净利润同比增长率", "")),
            "net_profit_nonrecurring_cum": parse_amount_yi(row.get("扣非净利润", "")),
            "revenue_cum": parse_amount_yi(row.get("营业总收入", "")),
            "revenue_cum_yoy_raw": parse_percent(row.get("营业总收入同比增长率", "")),
            "eps": parse_float(row.get("基本每股收益", "")),
            "bvps": parse_float(row.get("每股净资产", "")),
            "capital_reserve_ps": parse_float(row.get("每股资本公积金", "")),
            "retained_earnings_ps": parse_float(row.get("每股未分配利润", "")),
            "operating_cf_ps": parse_float(row.get("每股经营现金流", "")),
            "net_margin": parse_percent(row.get("销售净利率", "")),
            "roe": parse_percent(row.get("净资产收益率", "")),
            "roe_diluted": parse_percent(row.get("净资产收益率-摊薄", "")),
        }
    return result


def load_balance_sheet(code: str, name: str) -> Dict[str, Dict[str, object]]:
    path = BALANCE_DIR / f"{code}_{name}_balance_sheet.csv"
    rows = read_csv_rows(path)
    result: Dict[str, Dict[str, object]] = {}
    for row in rows:
        report_date = parse_date(row.get("REPORT_DATE", ""))
        if not report_date:
            continue
        report_type = row.get("REPORT_TYPE", "").strip() or None

        def to_yi(value: str) -> Optional[float]:
            v = parse_float(value)
            if v is None:
                return None
            return round(v / 1e8, 2)

        result[report_date] = {
            "report_type": report_type,
            "total_assets": to_yi(row.get("总资产", "")),
            "loans": to_yi(row.get("发放贷款及垫款", "")),
            "deposits": to_yi(row.get("吸收存款", "")),
            "net_assets_attr": to_yi(row.get("归母净资产", "")),
            "equity_total": to_yi(row.get("股东权益合计", "")),
        }
    return result


def load_valuation_history(code: str, name: str) -> List[Dict[str, object]]:
    path = VALUATION_DIR / f"{code}_{name}_valuation_history.csv"
    rows = read_csv_rows(path)
    result: List[Dict[str, object]] = []
    for row in rows:
        date = parse_date(row.get("数据日期", ""))
        if not date:
            continue
        result.append({
            "date": date,
            "close": parse_float(row.get("当日收盘价", "")),
            "market_cap": parse_float(row.get("总市值", "")),
            "float_market_cap": parse_float(row.get("流通市值", "")),
            "pe_ttm": parse_float(row.get("PE(TTM)", "")),
            "pe_static": parse_float(row.get("PE(静)", "")),
            "pb": parse_float(row.get("市净率", "")),
            "peg": parse_float(row.get("PEG值", "")),
            "pcf": parse_float(row.get("市现率", "")),
            "ps": parse_float(row.get("市销率", "")),
        })
    result.sort(key=lambda r: r["date"])
    return result


def nearest_valuation_snapshot(
    valuation_rows: List[Dict[str, object]], report_date: str
) -> Optional[Dict[str, object]]:
    """取报告期当天或其后最近一个交易日的估值快照；若之后没有数据，退化为报告期前最近一个交易日。"""
    if not valuation_rows:
        return None
    after = [r for r in valuation_rows if r["date"] >= report_date]
    if after:
        return after[0]
    before = [r for r in valuation_rows if r["date"] < report_date]
    if before:
        return before[-1]
    return None


def convert_market_cap_to_yi(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return round(value / 1e8, 2)


def build_bank_series(code: str, name: str) -> Optional[Dict[str, object]]:
    abstract_map = load_financial_abstract(code, name)
    balance_map = load_balance_sheet(code, name)
    valuation_rows = load_valuation_history(code, name)

    if not abstract_map and not balance_map and not valuation_rows:
        return None

    all_report_dates = sorted(set(abstract_map.keys()) | set(balance_map.keys()))
    if not all_report_dates:
        return None

    records: List[Dict[str, object]] = []
    for report_date in all_report_dates:
        fin = abstract_map.get(report_date, {})
        bal = balance_map.get(report_date, {})
        val_snapshot = nearest_valuation_snapshot(valuation_rows, report_date)

        record: Dict[str, object] = {
            "report_date": report_date,
            "year": year_of(report_date),
            "quarter": quarter_of(report_date),
            # 盈利能力（累计口径，原始）
            "net_profit_cum": fin.get("net_profit_cum"),
            "net_profit_nonrecurring_cum": fin.get("net_profit_nonrecurring_cum"),
            "revenue_cum": fin.get("revenue_cum"),
            "eps": fin.get("eps"),
            "roe": fin.get("roe"),
            "roe_diluted": fin.get("roe_diluted"),
            "net_margin": fin.get("net_margin"),
            # 每股指标
            "bvps": fin.get("bvps"),
            "capital_reserve_ps": fin.get("capital_reserve_ps"),
            "retained_earnings_ps": fin.get("retained_earnings_ps"),
            "operating_cf_ps": fin.get("operating_cf_ps"),
            # 规模与资产负债
            "total_assets": bal.get("total_assets"),
            "loans": bal.get("loans"),
            "deposits": bal.get("deposits"),
            "net_assets_attr": bal.get("net_assets_attr"),
            "report_type": bal.get("report_type"),
            # 估值与市场表现（报告期末快照）
            "valuation_date": val_snapshot.get("date") if val_snapshot else None,
            "close": val_snapshot.get("close") if val_snapshot else None,
            "market_cap_yi": convert_market_cap_to_yi(val_snapshot.get("market_cap")) if val_snapshot else None,
            "pe_ttm": val_snapshot.get("pe_ttm") if val_snapshot else None,
            "pb": val_snapshot.get("pb") if val_snapshot else None,
            "peg": val_snapshot.get("peg") if val_snapshot else None,
            "pcf": val_snapshot.get("pcf") if val_snapshot else None,
            "ps": val_snapshot.get("ps") if val_snapshot else None,
        }
        records.append(record)

    # 按 report_date 建索引，便于同比/单季度拆分查找
    by_date = {r["report_date"]: r for r in records}

    def find_same_quarter_last_year(record: Dict[str, object]) -> Optional[Dict[str, object]]:
        year = record.get("year")
        quarter = record.get("quarter")
        if year is None or quarter is None:
            return None
        target_date = None
        for suffix, q in QUARTER_END_SUFFIXES.items():
            if q == quarter:
                target_date = f"{year - 1}{suffix}"
                break
        if target_date is None:
            return None
        return by_date.get(target_date)

    def find_previous_quarter_same_year(record: Dict[str, object]) -> Optional[Dict[str, object]]:
        """同一年内上一个季度的记录（用于单季度拆分），Q1 没有上一季度返回 None。"""
        year = record.get("year")
        quarter = record.get("quarter")
        if year is None or quarter is None or quarter == 1:
            return None
        prev_quarter = quarter - 1
        for suffix, q in QUARTER_END_SUFFIXES.items():
            if q == prev_quarter:
                return by_date.get(f"{year}{suffix}")
        return None

    for record in records:
        prev_year_record = find_same_quarter_last_year(record)

        # YoY：累计净利润 / 累计营收 / 总资产 / 贷款 / 存款 / 归母净资产 / EPS / BVPS
        for field in [
            "net_profit_cum", "revenue_cum", "total_assets", "loans",
            "deposits", "net_assets_attr", "eps", "bvps",
        ]:
            record[f"{field}_yoy"] = yoy_growth(
                record.get(field), prev_year_record.get(field) if prev_year_record else None
            )

        # 单季度拆分（仅对季末报告期生效；年报也是Q4的累计值，同样可拆分）
        prev_q_record = find_previous_quarter_same_year(record)
        for field in CUMULATIVE_FLOW_FIELDS:
            cum_value = record.get(f"{field}_cum")
            if record.get("quarter") == 1:
                single_q = cum_value
            elif cum_value is not None and prev_q_record is not None and prev_q_record.get(f"{field}_cum") is not None:
                single_q = round(cum_value - prev_q_record[f"{field}_cum"], 4)
            else:
                single_q = None
            record[f"{field}_q"] = single_q

        # 单季度同比
        for field in CUMULATIVE_FLOW_FIELDS:
            prev_year_single_q = None
            if prev_year_record is not None:
                # 需要在 prev_year_record 所在年份也做单季度拆分；为避免重复计算，
                # 这里直接复用同样逻辑现算一次（数据量小，性能可接受）。
                py_prev_q_record = find_previous_quarter_same_year(prev_year_record)
                py_cum = prev_year_record.get(f"{field}_cum")
                if prev_year_record.get("quarter") == 1:
                    prev_year_single_q = py_cum
                elif py_cum is not None and py_prev_q_record is not None and py_prev_q_record.get(f"{field}_cum") is not None:
                    prev_year_single_q = round(py_cum - py_prev_q_record[f"{field}_cum"], 4)
            record[f"{field}_q_yoy"] = yoy_growth(record.get(f"{field}_q"), prev_year_single_q)

    records.sort(key=lambda r: r["report_date"])
    return {
        "code": code,
        "name": name,
        "records": records,
    }


def main() -> int:
    if not VALUATION_DIR.exists():
        print(f"错误：找不到历史估值目录 {VALUATION_DIR}", file=sys.stderr)
        return 1

    banks = discover_banks()
    if not banks:
        print("错误：未发现任何银行的历史估值 CSV 文件", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    index_entries: List[Dict[str, str]] = []
    ok_count = 0
    for code, name in banks:
        try:
            series = build_bank_series(code, name)
        except Exception as exc:  # noqa: BLE001
            warn(f"{code} {name}: 解析失败 {exc}")
            continue
        if series is None:
            warn(f"{code} {name}: 三个数据源均为空，跳过")
            continue

        output_path = OUTPUT_DIR / f"{code}.json"
        output_path.write_text(
            json.dumps(series, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        index_entries.append({
            "code": code,
            "name": name,
            "file": f"{code}.json",
            "record_count": len(series["records"]),
            "latest_report_date": series["records"][-1]["report_date"] if series["records"] else None,
        })
        ok_count += 1

    index_entries.sort(key=lambda e: e["code"])
    index_output = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "bank_count": len(index_entries),
        "banks": index_entries,
    }
    (OUTPUT_DIR / "_index.json").write_text(
        json.dumps(index_output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"已生成 {ok_count}/{len(banks)} 家银行的时间序列 JSON，输出目录：{OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
