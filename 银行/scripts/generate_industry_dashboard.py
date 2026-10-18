#!/usr/bin/env python3
"""Build dashboard/industry.json for the banking-industry overview board.

Inputs (iFind):
  02_原始资料/05_iFind数据/行业看板/edb/*.json
  02_原始资料/05_iFind数据/行业看板/citic_bank_pe_pb_*.csv

Valuation bands:
  高估线 = 最近10年月末样本均值 + 1倍样本标准差
  低估线 = 最近10年月末样本均值 - 1倍样本标准差
  （实务口语中的「方差带」；不用 σ²，否则量纲错误）
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

VAULT = Path(__file__).resolve().parent.parent
RAW_DIR = VAULT / "02_原始资料" / "05_iFind数据" / "行业看板"
EDB_DIR = RAW_DIR / "edb"
OUT_PATH = VAULT / "dashboard" / "industry.json"

CHART_SPECS = [
    {
        "id": "nim",
        "file": "q00_nim.json",
        "title": "净息差 NIM",
        "group": "earn",
        "unit": "%",
        "note": "商业银行整体。2010Q4 起监管总局季度口径。",
    },
    {
        "id": "nim_big",
        "file": "q16.json",
        "title": "大型银行 NIM",
        "group": "earn",
        "unit": "%",
        "overlay": True,
    },
    {
        "id": "nim_joint",
        "file": "q17.json",
        "title": "股份行 NIM",
        "group": "earn",
        "unit": "%",
        "overlay": True,
    },
    {
        "id": "nim_city",
        "file": "q18.json",
        "title": "城商行 NIM",
        "group": "earn",
        "unit": "%",
        "overlay": True,
    },
    {
        "id": "nim_rural",
        "file": "q19.json",
        "title": "农商行 NIM",
        "group": "earn",
        "unit": "%",
        "overlay": True,
    },
    {
        "id": "roa",
        "file": "q07.json",
        "title": "资产利润率 ROA",
        "group": "earn",
        "unit": "%",
    },
    {
        "id": "roe",
        "file": "q08.json",
        "title": "资本利润率 ROE",
        "group": "earn",
        "unit": "%",
    },
    {
        "id": "cir",
        "file": "q13.json",
        "title": "成本收入比",
        "group": "earn",
        "unit": "%",
    },
    {
        "id": "npl",
        "file": "q01.json",
        "title": "不良贷款率",
        "group": "risk",
        "unit": "%",
        "note": "2008Q4 附近有口径/剥离跳跃，不宜把前后绝对值直接连成同一趋势。",
    },
    {
        "id": "special",
        "file": "q14.json",
        "title": "关注类贷款占比",
        "group": "risk",
        "unit": "%",
    },
    {
        "id": "coverage",
        "file": "q02.json",
        "title": "拨备覆盖率",
        "group": "risk",
        "unit": "%",
    },
    {
        "id": "llr",
        "file": "q03.json",
        "title": "贷款拨备率（拨贷比）",
        "group": "risk",
        "unit": "%",
    },
    {
        "id": "car",
        "file": "q04.json",
        "title": "资本充足率 CAR",
        "group": "capital",
        "unit": "%",
    },
    {
        "id": "cet1",
        "file": "q05.json",
        "title": "核心一级资本充足率 CET1",
        "group": "capital",
        "unit": "%",
    },
    {
        "id": "t1",
        "file": "q06.json",
        "title": "一级资本充足率",
        "group": "capital",
        "unit": "%",
    },
    {
        "id": "leverage",
        "file": "q15.json",
        "title": "杠杆率",
        "group": "capital",
        "unit": "%",
    },
    {
        "id": "liq_ratio",
        "file": "q09.json",
        "title": "流动性比例",
        "group": "capital",
        "unit": "%",
    },
    {
        "id": "ldr",
        "file": "q10.json",
        "title": "存贷比",
        "group": "capital",
        "unit": "%",
    },
    {
        "id": "lcr",
        "file": "q11.json",
        "title": "流动性覆盖率 LCR",
        "group": "capital",
        "unit": "%",
    },
]


def _round(v: Optional[float], n: int = 4) -> Optional[float]:
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return round(float(v), n)


def parse_edb_file(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    obj = json.loads(path.read_text(encoding="utf-8"))
    text = obj.get("text")
    if not text:
        return None
    outer = json.loads(text) if isinstance(text, str) else text
    data = outer.get("data") or {}
    datas = data.get("datas") or []
    if not datas:
        return None
    block = datas[0].get("data") or {}
    columns = block.get("columns") or []
    rows = block.get("data") or []
    attrs = block.get("attrs") or {}
    name = columns[1] if len(columns) > 1 else path.stem
    meta = {}
    if isinstance(attrs, dict) and attrs:
        meta = next(iter(attrs.values())) or {}
    points = []
    for row in rows:
        if not row or len(row) < 2:
            continue
        date = str(row[0])[:10]
        try:
            val = float(row[1]) if row[1] is not None else None
        except (TypeError, ValueError):
            val = None
        if val is None:
            continue
        points.append({"date": date, "value": _round(val, 4)})
    points.sort(key=lambda x: x["date"])
    return {
        "name": name,
        "unit": meta.get("unit") or "%",
        "source": meta.get("data_source") or "国家金融监督管理总局",
        "freq": meta.get("freq") or "Q",
        "points": points,
    }


def load_citic_pe() -> pd.DataFrame:
    frames = []
    for p in sorted(RAW_DIR.glob("citic_bank_pe_pb_*.csv")):
        df = pd.read_csv(p)
        df["date"] = pd.to_datetime(df["日期"].astype(str), format="%Y%m%d", errors="coerce")
        df["pb"] = pd.to_numeric(df["市净率(整体法)"], errors="coerce")
        df["pe"] = pd.to_numeric(df["市盈率(TTM,整体法)"], errors="coerce")
        frames.append(df[["date", "pe", "pb"]])
    if not frames:
        raise FileNotFoundError("missing citic_bank_pe_pb_*.csv")
    out = pd.concat(frames, ignore_index=True)
    out = out.dropna(subset=["date"]).drop_duplicates("date", keep="last").sort_values("date")
    out = out.dropna(subset=["pe", "pb"], how="all")
    return out


def month_end(df: pd.DataFrame) -> pd.DataFrame:
    tmp = df.dropna(subset=["date"]).sort_values("date").copy()
    tmp["ym"] = tmp["date"].dt.to_period("M")
    monthly = tmp.groupby("ym", as_index=False).tail(1)
    monthly = monthly.drop(columns=["ym"]).set_index("date")
    monthly = monthly.dropna(subset=["pe", "pb"], how="all")
    return monthly


def rolling_bands(series: pd.Series, window: int = 120) -> Tuple[List, List, List]:
    mean = series.rolling(window, min_periods=window).mean()
    std = series.rolling(window, min_periods=window).std(ddof=1)
    high = mean + std
    low = mean - std
    return (
        [_round(v) for v in mean.tolist()],
        [_round(v) for v in high.tolist()],
        [_round(v) for v in low.tolist()],
    )


def static_10y(series: pd.Series, end: pd.Timestamp) -> Dict[str, Any]:
    start = end - pd.DateOffset(years=10)
    win = series.loc[start:end].dropna()
    mean = float(win.mean())
    std = float(win.std(ddof=1))
    last = float(series.dropna().iloc[-1])
    z = (last - mean) / std if std else 0.0
    if last > mean + std:
        zone = "高估"
    elif last < mean - std:
        zone = "低估"
    else:
        zone = "中枢"
    return {
        "start": start.strftime("%Y-%m-%d"),
        "end": end.strftime("%Y-%m-%d"),
        "n": int(len(win)),
        "mean": _round(mean, 4),
        "std": _round(std, 4),
        "high": _round(mean + std, 4),
        "low": _round(mean - std, 4),
        "last": _round(last, 4),
        "z": _round(z, 3),
        "zone": zone,
    }


def last_delta(points: List[Dict[str, Any]]) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    if not points:
        return None, None, None
    last = points[-1]["value"]
    date = points[-1]["date"]
    prev = points[-2]["value"] if len(points) > 1 else None
    delta = _round(last - prev, 4) if prev is not None else None
    return last, delta, date


def build_valuation(monthly: pd.DataFrame) -> Dict[str, Any]:
    dates = [d.strftime("%Y-%m-%d") for d in monthly.index]
    pe = [_round(v) for v in monthly["pe"].tolist()]
    pb = [_round(v) for v in monthly["pb"].tolist()]
    pe_mean_r, pe_high_r, pe_low_r = rolling_bands(monthly["pe"])
    pb_mean_r, pb_high_r, pb_low_r = rolling_bands(monthly["pb"])
    end = monthly.index.max()
    pe_stat = static_10y(monthly["pe"], end)
    pb_stat = static_10y(monthly["pb"], end)
    n = len(dates)
    return {
        "method": "中信一级行业·银行，整体法（总市值/归母净利润TTM、总市值/归母净资产）",
        "freq": "month_end",
        "source": "同花顺 iFind sector_data",
        "dates": dates,
        "pe": pe,
        "pb": pb,
        "rolling": {
            "window_months": 120,
            "pe_mean": pe_mean_r,
            "pe_high": pe_high_r,
            "pe_low": pe_low_r,
            "pb_mean": pb_mean_r,
            "pb_high": pb_high_r,
            "pb_low": pb_low_r,
        },
        "static_10y": {
            "pe": pe_stat,
            "pb": pb_stat,
            "pe_mean_line": [pe_stat["mean"]] * n,
            "pe_high_line": [pe_stat["high"]] * n,
            "pe_low_line": [pe_stat["low"]] * n,
            "pb_mean_line": [pb_stat["mean"]] * n,
            "pb_high_line": [pb_stat["high"]] * n,
            "pb_low_line": [pb_stat["low"]] * n,
        },
    }


def main() -> None:
    charts: List[Dict[str, Any]] = []
    parsed: Dict[str, Dict[str, Any]] = {}
    overlay_nim: List[Dict[str, Any]] = []

    for spec in CHART_SPECS:
        series = parse_edb_file(EDB_DIR / spec["file"])
        if not series or not series["points"]:
            continue
        parsed[spec["id"]] = series
        item = {
            "id": spec["id"],
            "title": spec["title"],
            "group": spec["group"],
            "unit": spec.get("unit") or series["unit"],
            "source": series["source"],
            "note": spec.get("note"),
            "dates": [p["date"] for p in series["points"]],
            "values": [p["value"] for p in series["points"]],
        }
        if spec.get("overlay"):
            overlay_nim.append(
                {
                    "id": spec["id"],
                    "name": spec["title"],
                    "dates": item["dates"],
                    "values": item["values"],
                }
            )
        else:
            charts.append(item)

    if overlay_nim and any(c["id"] == "nim" for c in charts):
        for c in charts:
            if c["id"] == "nim":
                c["peers"] = overlay_nim
                break

    daily = load_citic_pe()
    monthly = month_end(daily)
    valuation = build_valuation(monthly)

    kpis = []
    kpi_ids = [
        ("nim", "行业 NIM", "%"),
        ("roe", "资本利润率", "%"),
        ("npl", "不良率", "%"),
        ("coverage", "拨备覆盖率", "%"),
        ("cet1", "CET1", "%"),
        ("lcr", "LCR", "%"),
    ]
    for cid, label, unit in kpi_ids:
        series = parsed.get(cid)
        if not series:
            continue
        last, delta, date = last_delta(series["points"])
        kpis.append(
            {
                "id": cid,
                "label": label,
                "value": last,
                "delta": delta,
                "date": date,
                "unit": unit,
            }
        )
    kpis.append(
        {
            "id": "pb",
            "label": "行业总 PB",
            "value": valuation["static_10y"]["pb"]["last"],
            "delta": None,
            "date": valuation["dates"][-1] if valuation["dates"] else None,
            "unit": "x",
            "zone": valuation["static_10y"]["pb"]["zone"],
        }
    )
    kpis.append(
        {
            "id": "pe",
            "label": "行业总 PE",
            "value": valuation["static_10y"]["pe"]["last"],
            "delta": None,
            "date": valuation["dates"][-1] if valuation["dates"] else None,
            "unit": "x",
            "zone": valuation["static_10y"]["pe"]["zone"],
        }
    )

    output = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "title": "银行行业总看板",
        "span": "约 2006–2026（能取到的监管序列按各自起始日）",
        "sources": [
            "盈利/质量/资本/流动性：同花顺 iFind EDB，原始发布为国家金融监督管理总局商业银行主要监管指标",
            "总 PB / 总 PE：同花顺 iFind 中信一级行业·银行，整体法月度（由日频取月末）",
        ],
        "band_note": "高估线 = 最近10年月末均值 + 1倍样本标准差；低估线 = 均值 − 1倍标准差。这里的「方差带」按投研习惯取 ±1σ，而不是方差 σ²。",
        "kpis": kpis,
        "valuation": valuation,
        "charts": charts,
    }

    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")
    pb = valuation["static_10y"]["pb"]
    pe = valuation["static_10y"]["pe"]
    print(f"wrote {OUT_PATH}")
    print(f"  charts: {len(charts)}  valuation months: {len(valuation['dates'])}")
    print(
        f"  PB last={pb['last']} mean10={pb['mean']} ±{pb['std']} "
        f"high={pb['high']} low={pb['low']} zone={pb['zone']}"
    )
    print(
        f"  PE last={pe['last']} mean10={pe['mean']} ±{pe['std']} "
        f"high={pe['high']} low={pe['low']} zone={pe['zone']}"
    )


if __name__ == "__main__":
    main()
