#!/usr/bin/env python3
"""Compute Gordon DDM for all A-share banks and write wiki + dashboard outputs.

Two Gordon paths (see 05_知识库/18_估值/股息贴现模型.md):

  现行分红  D1 = 全年DPS × (1+g),  P = D1 / (COE − g)
  稳态一致  p* = 1 − g/ROE,        P = BV0 × (ROE − g) / (COE − g)

COE is a valuation_assumption by bank type. g is a uniform 3% terminal cap.
Not a live target price.

Usage:
    python3 scripts/compute_bank_ddm.py
    python3 scripts/compute_bank_ddm.py --no-pages   # skip valuation-page patch
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
DIV_DIR = ROOT / "02_原始资料" / "04_AkShare数据" / "分红" / "分红历史"
STOCK_DIR = ROOT / "dashboard" / "stock_data"
DASHBOARD_JSON = ROOT / "dashboard" / "data.json"
UNIVERSE = ROOT / "02_原始资料" / "04_AkShare数据" / "数据字典与运行记录" / "a_share_banks_universe.json"
LATEST_PRICES = ROOT / "02_原始资料" / "05_iFind数据" / "latest_prices.json"
OUT_JSON = ROOT / "dashboard" / "ddm.json"
OUT_MD = ROOT / "05_知识库" / "18_估值" / "A股银行DDM估值表.md"
VAL_DIR = ROOT / "05_知识库" / "18_估值"

G = 0.03
COE_BY_TYPE = {
    "国有大行": 0.090,
    "股份行": 0.100,
    "城商行": 0.105,
    "农商行": 0.110,
}
TYPE_OVERRIDE = {
    "华夏银行": "股份行",
    "郑州银行": "城商行",
}
FOCUS18 = {
    "平安银行", "宁波银行", "浦发银行", "民生银行", "招商银行", "江苏银行",
    "杭州银行", "南京银行", "常熟银行", "兴业银行", "农业银行", "交通银行",
    "工商银行", "邮储银行", "成都银行", "建设银行", "中国银行", "中信银行",
}

TZ = timezone(timedelta(hours=8))


def _f(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return x


def _round(v: Optional[float], n: int) -> Optional[float]:
    if v is None:
        return None
    return round(v, n)


def load_universe() -> List[Dict[str, Any]]:
    data = json.loads(UNIVERSE.read_text(encoding="utf-8"))
    return data["banks"]


def load_latest_prices() -> Tuple[Dict[str, Dict[str, Any]], Optional[str], Optional[str]]:
    if not LATEST_PRICES.exists():
        return {}, None, None
    data = json.loads(LATEST_PRICES.read_text(encoding="utf-8"))
    by_code: Dict[str, Dict[str, Any]] = {}
    for b in data.get("banks") or []:
        close = _f(b.get("close"))
        if close is None or not b.get("code"):
            continue
        by_code[str(b["code"])] = {
            "close": close,
            "price_date": b.get("price_date") or data.get("price_date"),
            "source": b.get("source") or data.get("source"),
            "name": b.get("name"),
        }
    dates = {item.get("price_date") for item in by_code.values() if item.get("price_date")}
    sources = {item.get("source") for item in by_code.values() if item.get("source")}
    price_date = next(iter(dates)) if len(dates) == 1 else None
    source = next(iter(sources)) if len(sources) == 1 else "AkShare 优先，iFind 逐项补缺（各银行日期可能不同）"
    return by_code, price_date, source


def load_dashboard_types() -> Dict[str, str]:
    dash = json.loads(DASHBOARD_JSON.read_text(encoding="utf-8"))
    out = {}
    for b in dash["banks"]:
        t = TYPE_OVERRIDE.get(b["name"]) or b.get("type") or "城商行"
        if t == "其他":
            t = TYPE_OVERRIDE.get(b["name"], "城商行")
        out[b["name"]] = t
    return out


def fy_dps(code: str, name: str, year: int) -> Tuple[Optional[float], List[str]]:
    """Sum 每10股派现 for calendar year that has a 12-31 row. Returns DPS (yuan)."""
    path = DIV_DIR / f"{code}_{name}_dividend_history.csv"
    notes: List[str] = []
    if not path.exists():
        return None, [f"无分红历史文件 {path.name}"]
    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    year_rows = []
    has_year_end = False
    for r in rows:
        rd = str(r.get("报告期") or "")
        if not rd.startswith(str(year)):
            continue
        ratio = _f(r.get("现金分红-现金分红比例"))
        if ratio is None:
            continue
        year_rows.append((rd, ratio))
        if rd[5:7] == "12":
            has_year_end = True
    if not year_rows:
        return None, [f"{year} 无派现记录"]
    if not has_year_end:
        return None, [f"{year} 仅有中期派现，未计入全年"]
    total_per10 = sum(x[1] for x in year_rows)
    dps = total_per10 * 0.1
    parts = "+".join(f"{rd[5:7]}月{ratio:.3f}" for rd, ratio in year_rows)
    notes.append(f"{year}每10股派现合计 {total_per10:.3f} 元（{parts}）")
    return dps, notes


def latest_annual(code: str) -> Optional[Dict[str, Any]]:
    p = STOCK_DIR / f"{code}.json"
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    recs = [
        r for r in data.get("records") or []
        if str(r.get("report_date") or "").endswith("-12-31")
        and _f(r.get("bvps")) is not None
        and _f(r.get("roe")) is not None
    ]
    if not recs:
        return None
    recs.sort(key=lambda r: str(r["report_date"]))
    rec = recs[-1]
    rec["_score_c3"] = None
    rec["_score_f2"] = None
    for per in data.get("score", {}).get("periods") or []:
        if per.get("report_date") == rec["report_date"]:
            items = per.get("items") or {}
            if isinstance(items, dict):
                rec["_score_c3"] = _f((items.get("F3") or {}).get("value"))
                rec["_score_f2"] = _f((items.get("G2") or {}).get("value"))
            break
    rec["_name"] = data.get("name")
    rec["_code"] = data.get("code") or code
    return rec


def compute_one(
    code: str,
    name: str,
    bank_type: str,
    latest: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    rec = latest_annual(code)
    coe = COE_BY_TYPE.get(bank_type, 0.105)
    out: Dict[str, Any] = {
        "code": code,
        "name": name,
        "type": bank_type,
        "focus18": name in FOCUS18,
        "coe": coe,
        "g": G,
        "notes": [],
        "ok": False,
    }
    if rec is None:
        out["notes"].append("无年报 ROE/BVPS")
        return out

    year = int(str(rec["report_date"])[:4])
    bvps = _f(rec.get("bvps"))
    roe = _f(rec.get("roe"))
    eps = _f(rec.get("eps"))
    close = None
    price_date = rec.get("valuation_date") or rec["report_date"]
    price_source = "年报估值收盘价（回退）"
    if latest and _f(latest.get("close")) is not None:
        close = _f(latest.get("close"))
        price_date = latest.get("price_date") or price_date
        price_source = latest.get("source") or "行情来源未标注"
    else:
        close = _f(rec.get("close"))
        out["notes"].append("缺最新收盘价，暂用年报收盘价")
    pb = close / bvps if close and bvps else None
    dps, dnotes = fy_dps(code, name, year)
    out["notes"].extend(dnotes)

    payout = rec.get("_score_c3")
    if payout is None and dps and eps and eps > 0:
        payout = dps / eps * 100
        out["notes"].append("分红率由 DPS/EPS 估算（无打分 F3）")

    d1_policy = dps * (1 + G) if dps is not None else None
    ddm_policy = d1_policy / (coe - G) if d1_policy is not None and coe > G else None

    p_star = None
    ddm_steady = None
    pb_steady = None
    if roe is not None and roe / 100 > G:
        p_star = (1 - G / (roe / 100)) * 100
        pb_steady = (roe / 100 - G) / (coe - G)
        ddm_steady = pb_steady * bvps if bvps else None
    elif roe is not None:
        out["notes"].append(f"ROE {roe:.2f}% ≤ g {G*100:.0f}%，稳态 DDM 无解")

    g_internal = None
    if roe is not None and payout is not None:
        g_internal = roe * (1 - payout / 100)

    role = "仅辅助"
    if payout is not None and payout >= 30:
        role = "主交叉"
    elif payout is not None and payout >= 25:
        role = "辅助交叉"

    policy_vs = None
    steady_vs = None
    if ddm_policy is not None and close:
        policy_vs = (ddm_policy / close - 1) * 100
    if ddm_steady is not None and close:
        steady_vs = (ddm_steady / close - 1) * 100

    yield_fy = None
    if dps is not None and close:
        yield_fy = dps / close * 100

    if g_internal is not None and g_internal / 100 > coe - 0.01:
        out["notes"].append(
            f"机械内生增速 {g_internal:.1f}% 接近或高于 COE，不能把内生增速当作 Gordon 的 g"
        )

    out.update({
        "ok": ddm_policy is not None or ddm_steady is not None,
        "report_date": rec["report_date"],
        "report_period": f"{year}A",
        "price_date": price_date,
        "price_source": price_source,
        "bvps": _round(bvps, 4),
        "roe": _round(roe, 4),
        "eps": _round(eps, 4),
        "dps": _round(dps, 4),
        "payout": _round(payout, 2),
        "close": _round(close, 4),
        "pb": _round(pb, 4),
        "d1_policy": _round(d1_policy, 4),
        "ddm_policy": _round(ddm_policy, 4),
        "policy_vs_price": _round(policy_vs, 1),
        "p_star": _round(p_star, 2),
        "ddm_steady": _round(ddm_steady, 4),
        "pb_steady": _round(pb_steady, 4),
        "steady_vs_price": _round(steady_vs, 1),
        "g_internal": _round(g_internal, 2),
        "div_yield": _round(yield_fy, 2),
        "role": role,
        "cet1": None,
    })
    return out


def pct_metric(v: Optional[float]) -> Optional[Dict[str, Any]]:
    if v is None:
        return None
    return {"raw": v, "value_pct": f"{v:.2f}%"}


def raw_metric(v: Optional[float], digits: int = 2) -> Optional[Dict[str, Any]]:
    if v is None:
        return None
    return {"raw": round(v, digits)}


def patch_dashboard(
    rows: List[Dict[str, Any]],
    price_date: Optional[str],
    price_source: Optional[str],
) -> None:
    dash = json.loads(DASHBOARD_JSON.read_text(encoding="utf-8"))
    by_name = {r["name"]: r for r in rows}
    for b in dash["banks"]:
        r = by_name.get(b["name"])
        if not r:
            continue
        b["ddm"] = r
        b["type"] = r["type"]
        dm = b.setdefault("deep_metrics", {})
        m = dm.setdefault("metrics", {})
        m.pop("年报股息率", None)
        m["全年DPS"] = raw_metric(r.get("dps"), 4)
        m["现金分红率"] = pct_metric(r.get("payout"))
        m["最新价"] = raw_metric(r.get("close"), 2)
        m["现价PB"] = raw_metric(r.get("pb"), 2)
        m["合理PB"] = raw_metric(r.get("pb_steady"), 2)
        m["RIM值"] = raw_metric(r.get("ddm_steady"), 2)
        m["股息率"] = pct_metric(r.get("div_yield"))
        m["COE"] = pct_metric(r["coe"] * 100)
        m["DDM终值g"] = pct_metric(r["g"] * 100)
        m["DDM现行价"] = raw_metric(r.get("ddm_policy"), 2)
        m["DDM现行/现价"] = pct_metric(r.get("policy_vs_price"))
        m["DDM稳态价"] = raw_metric(r.get("ddm_steady"), 2)
        m["DDM稳态PB"] = raw_metric(r.get("pb_steady"), 2)
        m["DDM稳态/现价"] = pct_metric(r.get("steady_vs_price"))
        m["DDM角色"] = {"raw": r.get("role")}
        if r.get("cet1") is None and _f(b.get("cet1")) is not None:
            r["cet1"] = _f(b.get("cet1"))
            b["ddm"]["cet1"] = r["cet1"]
    dash["ddm_meta"] = {
        "g": G,
        "coe_by_type": {k: v * 100 for k, v in COE_BY_TYPE.items()},
        "price_basis": "最新未复权收盘价",
        "price_date": price_date,
        "price_source": price_source or "行情来源未标注",
        "generated_at": datetime.now(TZ).strftime("%Y-%m-%dT%H:%M:%S"),
    }
    DASHBOARD_JSON.write_text(json.dumps(dash, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fmt(v: Optional[float], n: int = 2, suffix: str = "") -> str:
    if v is None:
        return "NA"
    return f"{v:.{n}f}{suffix}"


def write_markdown(rows: List[Dict[str, Any]], price_date: Optional[str]) -> None:
    today = datetime.now(TZ).strftime("%Y-%m-%d")
    px_label = price_date or today
    rows_sorted = sorted(rows, key=lambda r: (r["type"], -(r.get("steady_vs_price") or -999), r["name"]))
    lines = [
        "---",
        "title: A股银行DDM估值表",
        "aliases:",
        "  - DDM估值表",
        "note_type: tracker",
        "status: active",
        "created: 2026-09-12",
        f"updated: {today}",
        f"data_cutoff: {px_label}",
        "report_period: 2025A",
        "evidence_level: mixed",
        "evidence_class: mixed",
        "source_priority: mixed",
        "sources:",
        "  - \"[[05_知识库/18_估值/股息贴现模型]]\"",
        "  - \"[[05_知识库/06_关键概念/股权成本COE]]\"",
        "  - \"[[06A_银行业数据口径规范]]\"",
        "related:",
        "  - \"[[05_知识库/18_估值/银行估值方法体系]]\"",
        "  - \"[[05_知识库/18_估值/剩余收益模型]]\"",
        "  - \"[[05_知识库/00_新手入口/估值公式小白释义]]\"",
        "tags:",
        "  - 估值",
        "  - DDM",
        "  - 跟踪器",
        "---",
        "",
        "# A股银行 DDM 估值表",
        "",
        f"> 全部 42 家 A 股银行的 Gordon 贴现。**参数是假设，不是目标价。** 价格为最新未复权收盘价（**{px_label}**，iFind）。股息率 = 全年DPS ÷ 该价格。ROE / BVPS / DPS 仍用年报。",
        ">",
        "> 小白先读：[[估值公式小白释义]] · [[股权成本COE]] · [[股息贴现模型]]",
        "",
        "## 1. 统一假设（valuation_assumption）",
        "",
        f"- 终值增长率 `g` = **{G*100:.0f}%**（审慎名义增长上限，不是各行贷款增速）",
        "- 股权成本 `COE` 按类型分档：",
        "",
        "| 类型 | COE | 白话 |",
        "| --- | ---: | --- |",
        "| 国有大行 | 9.0% | 波动相对小，股东要求低一些 |",
        "| 股份行 | 10.0% | 全国经营，风险溢价高于大行 |",
        "| 城商行 | 10.5% | 区域与流动性溢价 |",
        "| 农商行 | 11.0% | 规模与流动性折价更高 |",
        "",
        "华夏银行按股份行、郑州银行按城商行分档（仪表盘类型曾标为「其他」）。",
        "",
        "两套价格：",
        "",
        "```text",
        "现行分红 DDM  = 全年DPS × (1+g) / (COE − g)",
        "稳态 DDM      = 每股净资产 × (ROE − g) / (COE − g)   ← 与合理 PB 同一公式",
        "```",
        "",
        "现行分红问的是「按现在这个派息水平一直分下去值多少」；稳态问的是「终值分红率提高到刚好支撑 3% 增长之后值多少」。两者差得大，说明现在分得少、资本还在囤，不能只用现金股息给银行定价。",
        "",
        "## 2. 全量表",
        "",
        "| 银行 | 类型 | 角色 | ROE | 分红率 | DPS | 最新价 | 股息率 | 现价PB | COE | 现行DDM | 现行/现价 | 稳态PB | 稳态DDM | 稳态/现价 |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in rows_sorted:
        lines.append(
            "| {name} | {type} | {role} | {roe} | {payout} | {dps} | {close} | {yld} | {pb} | {coe} | {pol} | {pvs} | {spb} | {st} | {svs} |".format(
                name=r["name"],
                type=r["type"],
                role=r.get("role") or "",
                roe=fmt(r.get("roe"), 2, "%"),
                payout=fmt(r.get("payout"), 1, "%"),
                dps=fmt(r.get("dps"), 3),
                close=fmt(r.get("close"), 2),
                yld=fmt(r.get("div_yield"), 2, "%"),
                pb=fmt(r.get("pb"), 2),
                coe=f"{r['coe']*100:.1f}%",
                pol=fmt(r.get("ddm_policy"), 2),
                pvs=fmt(r.get("policy_vs_price"), 1, "%"),
                spb=fmt(r.get("pb_steady"), 2),
                st=fmt(r.get("ddm_steady"), 2),
                svs=fmt(r.get("steady_vs_price"), 1, "%"),
            )
        )
    lines += [
        "",
        f"相对现价（{px_label}）的百分数是模型输出对照，**不是上涨空间或投资建议**。",
        "",
        "## 3. 重点 18 家（按稳态相对现价）",
        "",
        "| 银行 | 角色 | 现行DDM | 稳态DDM | 最新价 | 怎么读 |",
        "| --- | --- | ---: | ---: | ---: | --- |",
    ]
    focus = [r for r in rows if r["focus18"]]
    focus.sort(key=lambda r: -(r.get("steady_vs_price") or -999))
    for r in focus:
        read = []
        if r.get("role") == "仅辅助":
            read.append("分红偏低，主看 PB-ROE/RIM")
        elif r.get("role") == "辅助交叉":
            read.append("分红中等，DDM 作交叉")
        else:
            read.append("分红稳定，可与 DDM 交叉")
        if r.get("ddm_policy") and r.get("ddm_steady") and r["ddm_steady"] > r["ddm_policy"] * 1.3:
            read.append("稳态远高于现行，留存还在囤资本")
        if (r.get("pb_steady") or 0) > 1 and (r.get("pb") or 0) < 1:
            read.append("合理 PB>1 但市价折价")
        if (r.get("roe") or 0) < r["coe"] * 100:
            read.append("ROE 低于 COE，稳态应折价")
        lines.append(
            "| {name} | {role} | {pol} | {st} | {close} | {read} |".format(
                name=r["name"],
                role=r.get("role") or "",
                pol=fmt(r.get("ddm_policy"), 2),
                st=fmt(r.get("ddm_steady"), 2),
                close=fmt(r.get("close"), 2),
                read="；".join(read) if read else "—",
            )
        )
    lines += [
        "",
        "## 4. 口径与限制",
        "",
        "- DPS 为该年中期+末期每10股派现合计÷10，来自 `02_原始资料/04_AkShare数据/分红/分红历史/`。",
        "- ROE / BVPS 来自 `dashboard/stock_data/` 对应年报；价格与股息率、现价 PB 用 iFind 最新未复权收盘价。",
        f"- 价格日期 **{px_label}**；现价 PB = 最新价 / 年报 BVPS。",
        "- 分红率优先用打分引擎 F3（股本×派现/归母净利），否则 DPS/EPS。",
        "- 未做 BV0 不良拨备调整；资产质量差的银行稳态价格偏高，应回 [[剩余收益模型]] 先调账面。",
        "- A/H 未分市场；本表只覆盖 A 股。",
        "",
        "## 5. 只追加更新日志",
        "",
        "- 2026-09-12 | 类型: 创建 | 变更: 按类型分档 COE、g=3% 计算 42 家现行/稳态 DDM | 依据: [[股息贴现模型]] | 影响: 仪表盘 DDM 列与 18 家估值页同源",
        f"- {today} | 类型: 更新 | 变更: 股息率与 DDM/现价改用最新收盘价（{px_label}），去掉年报价/年报股息率 | 依据: iFind 最新未复权收盘价 | 影响: 仪表盘、本表、18 家估值页",
        "",
    ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


def page_ddm_section(r: Dict[str, Any]) -> str:
    notes = r.get("notes") or []
    note_txt = "；".join(notes) if notes else "—"
    vs_pol = fmt(r.get("policy_vs_price"), 1, "%")
    vs_st = fmt(r.get("steady_vs_price"), 1, "%")
    plain = (
        f"白话：{r['report_period']} 全年每股大约分 {fmt(r.get('dps'), 3)} 元。"
        f"若这笔分红以后每年增长 {G*100:.0f}%、股东要求 {r['coe']*100:.1f}%（{r['type']}分档），"
        f"现行分红 DDM 约为 {fmt(r.get('ddm_policy'), 2)} 元。"
        f"若终值把分红率提高到 {fmt(r.get('p_star'), 1)}% 以刚好支撑 {G*100:.0f}% 增长，"
        f"稳态价值 {fmt(r.get('ddm_steady'), 2)} 元，合理 PB {fmt(r.get('pb_steady'), 2)} 倍——"
        f"与 PB-ROE 公式相同。"
        f"对照最新价 {fmt(r.get('close'), 2)} 元（{r.get('price_date')}），"
        f"股息率 {fmt(r.get('div_yield'), 2)}%，现行 {vs_pol}、稳态 {vs_st}。这不是目标价。"
    )
    if r.get("role") == "仅辅助":
        plain += " 本案分红率偏低，DDM 只作辅助，主模型仍是 PB-ROE / RIM。"
    return f"""## 4. DDM 与股息率

> 本节为 `valuation_assumption`。横向口径与 42 家同一套：见 [[A股银行DDM估值表]]、[[股息贴现模型]]。价格为最新收盘价（{r.get('price_date')}），股息率 = 全年DPS ÷ 该价格。

| 参数 | 数值 | 信息类别 | 来源 |
| --- | --- | --- | --- |
| 报告期 | {r.get('report_period')} | official_fact | 年报 |
| 每股净资产 BV0 | {fmt(r.get('bvps'), 2)} 元 | official_fact / third_party_data | stock_data {r.get('report_date')} |
| 加权 ROE | {fmt(r.get('roe'), 2)}% | official_fact / third_party_data | 同年报 |
| 全年每股分红 D0 | {fmt(r.get('dps'), 3)} 元 | official_fact | 中期+末期合计 |
| 分红率 | {fmt(r.get('payout'), 1)}% | official_fact / third_party_data | 打分 F3 或 DPS/EPS |
| 最新价 / 现价PB | {fmt(r.get('close'), 2)} 元 / {fmt(r.get('pb'), 2)}x | third_party_data | {r.get('price_source') or '来源未标注'} {r.get('price_date')} |
| 股息率 | {fmt(r.get('div_yield'), 2)}% | third_party_data | 全年DPS / 最新价 |
| COE | {r['coe']*100:.1f}%（{r['type']}分档） | valuation_assumption | [[股权成本COE]] |
| 终值 g | {G*100:.0f}% | valuation_assumption | 全市场统一审慎上限 |
| D1 = D0×(1+g) | {fmt(r.get('d1_policy'), 3)} 元 | valuation_assumption | 现行分红外推 |
| DDM 现行分红 | {fmt(r.get('ddm_policy'), 2)} 元（相对现价 {vs_pol}） | valuation_assumption | D1/(COE−g) |
| 稳态分红率 p* | {fmt(r.get('p_star'), 1)}% | valuation_assumption | 1−g/ROE |
| DDM 稳态 / 合理 PB | {fmt(r.get('ddm_steady'), 2)} 元 / {fmt(r.get('pb_steady'), 2)}x（相对现价 {vs_st}） | valuation_assumption | 与 PB-ROE 等价 |
| 内生增速 | {fmt(r.get('g_internal'), 1)}% | research_inference | ROE×(1−分红率) |
| 模型角色 | {r.get('role')} | research_inference | 分红率≥30% 作主交叉，否则辅助 |

{plain}

派现拆解：{note_txt}
"""


SECTION4_RE = re.compile(
    r"## 4\. DDM 与股息率\n.*?(?=\n## 5\. )",
    re.S,
)


def patch_valuation_pages(rows: List[Dict[str, Any]]) -> List[str]:
    changed = []
    by_name = {r["name"]: r for r in rows if r["focus18"]}
    today = datetime.now(TZ).strftime("%Y-%m-%d")
    for name, r in by_name.items():
        path = VAL_DIR / f"{name} 估值.md"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        section = page_ddm_section(r).rstrip() + "\n\n"
        if name == "杭州银行":
            if "## 3.1 DDM" in text or "DDM（辅助" in text:
                text = re.sub(
                    r"## 3\.1 DDM.*?(?=\n## 4\. )",
                    section.replace("## 4. DDM 与股息率", "## 3.1 DDM（辅助）", 1) + "\n",
                    text,
                    count=1,
                    flags=re.S,
                )
            else:
                text = text.replace(
                    "## 4. 正常化 ROE 的核心变量",
                    section.replace("## 4. DDM 与股息率", "## 3.1 DDM（辅助）", 1)
                    + "\n## 4. 正常化 ROE 的核心变量",
                    1,
                )
            text = text.replace(
                "4. **分红不是本案主要估值锚**：2025A 分红率 26.43%，更适合使用 PB-ROE/RIM 思路；DDM仅作辅助。",
                "4. **分红不是本案主要估值锚**：横向 DDM 角色为「"
                + (r.get("role") or "仅辅助")
                + "」，与本页 PB-ROE 主框架一致；DDM 只作交叉。横向表用 g=3%、报告期 ROE，与本页情景 g=2.5%/正常化 ROE 不同。",
            )
        else:
            if not SECTION4_RE.search(text):
                continue
            text = SECTION4_RE.sub(section, text, count=1)
        log_line = (
            f"- {today} | 类型: 更新 | 变更: DDM 对照最新价 {r.get('price_date')}，股息率=全年DPS/最新价"
            f"（COE {r['coe']*100:.1f}%，g=3%） | 依据: [[A股银行DDM估值表]] | 影响: 去掉年报价/年报股息率"
        )
        if "只追加更新日志" in text and today + " | 类型: 更新 | 变更: DDM 对照最新价" not in text:
            text = text.rstrip() + "\n" + log_line + "\n"
        # related link
        if "A股银行DDM估值表" not in text:
            text = text.replace(
                '  - "[[05_知识库/18_估值/银行估值方法体系]]"',
                '  - "[[05_知识库/18_估值/银行估值方法体系]]"\n'
                '  - "[[05_知识库/18_估值/A股银行DDM估值表]]"\n'
                '  - "[[05_知识库/18_估值/股息贴现模型]]"',
                1,
            )
        path.write_text(text, encoding="utf-8")
        changed.append(name)
    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-pages", action="store_true")
    args = parser.parse_args()

    types = load_dashboard_types()
    universe = load_universe()
    latest_map, price_date, price_source = load_latest_prices()
    rows = []
    for b in universe:
        name = b["name"]
        code = b["code"]
        bank_type = types.get(name) or TYPE_OVERRIDE.get(name) or "城商行"
        rows.append(compute_one(code, name, bank_type, latest_map.get(code)))

    OUT_JSON.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(TZ).strftime("%Y-%m-%dT%H:%M:%S"),
                "g": G,
                "coe_by_type": {k: v * 100 for k, v in COE_BY_TYPE.items()},
                "price_date": price_date,
                "price_source": price_source,
                "banks": rows,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    patch_dashboard(rows, price_date, price_source)
    write_markdown(rows, price_date)
    changed = []
    if not args.no_pages:
        changed = patch_valuation_pages(rows)

    ok = sum(1 for r in rows if r.get("ok"))
    print(f"computed {ok}/{len(rows)} banks")
    print(f"wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"wrote {OUT_MD.relative_to(ROOT)}")
    print(f"patched dashboard/data.json")
    print(f"price_date {price_date} ({len(latest_map)} latest closes)")
    if changed:
        print("valuation pages:", ", ".join(changed))
    missing = [r["name"] for r in rows if not r.get("ok")]
    if missing:
        print("incomplete:", ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
