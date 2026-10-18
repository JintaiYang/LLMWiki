#!/usr/bin/env python3
"""一键数据更新脚本：拉取 AkShare + iFind 数据，回填到跟踪器页和基础档案页。

用法:
    python3 scripts/update_all_data.py                # 全量更新
    python3 scripts/update_all_data.py --tracker-only  # 只更新跟踪器
    python3 scripts/update_all_data.py --bank-only     # 只更新银行基础档案
    python3 scripts/update_all_data.py --dry-run       # 预览模式，不写文件

数据源:
  - AkShare: 宏观利率(LPR/MLF)、行业监管指标(NIM/不良率)、个股财务数据
  - iFind:   银行专项监管指标(NIM/不良率/拨备/CET1)，需 iFind 终端在线
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

warnings.filterwarnings("ignore")

try:
    import akshare as ak
except Exception as exc:
    print(f"⚠️  AkShare 导入失败: {exc}", file=sys.stderr)
    print("   请确认已安装: pip install akshare", file=sys.stderr)
    ak = None

VAULT_ROOT = Path(__file__).resolve().parent.parent
TRACKER_DIR = VAULT_ROOT / "05_知识库" / "12_跟踪器"
BANK_DIR = VAULT_ROOT / "05_知识库" / "03_银行库"
IFIND_DIR = VAULT_ROOT / "02_原始资料" / "05_iFind数据" / "银行专项指标"
DEEP_JSON_DIR = VAULT_ROOT / "02_原始资料" / "04_AkShare数据" / "深度采集"

TODAY = datetime.now().strftime("%Y-%m-%d")

# ── 18 家重点银行 ──────────────────────────────────────────────

FOCUS_18 = [
    {"code": "600036", "name": "招商银行", "type": "股份行"},
    {"code": "601398", "name": "工商银行", "type": "国有大行"},
    {"code": "601939", "name": "建设银行", "type": "4大行"},
    {"code": "601288", "name": "农业银行", "type": "国有大行"},
    {"code": "601988", "name": "中国银行", "type": "国有大行"},
    {"code": "601328", "name": "交通银行", "type": "国有大行"},
    {"code": "601658", "name": "邮储银行", "type": "国有大行"},
    {"code": "600000", "name": "浦发银行", "type": "股份行"},
    {"code": "600016", "name": "民生银行", "type": "股份行"},
    {"code": "601166", "name": "兴业银行", "type": "股份行"},
    {"code": "601998", "name": "中信银行", "type": "股份行"},
    {"code": "000001", "name": "平安银行", "type": "股份行"},
    {"code": "002142", "name": "宁波银行", "type": "城商行"},
    {"code": "600919", "name": "江苏银行", "type": "城商行"},
    {"code": "600926", "name": "杭州银行", "type": "城商行"},
    {"code": "601009", "name": "南京银行", "type": "城商行"},
    {"code": "601838", "name": "成都银行", "type": "城商行"},
    {"code": "601128", "name": "常熟银行", "type": "农商行"},
]


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ═══════════════════════════════════════════════════════════════
# 1. 宏观数据拉取 (AkShare)
# ═══════════════════════════════════════════════════════════════

def fetch_macro_rates() -> Dict[str, Any]:
    """拉取 LPR、MLF 等利率数据"""
    result = {"fetch_time": now_iso(), "data": {}}
    if ak is None:
        return result

    # LPR
    try:
        df = ak.macro_china_lpr()
        if df is not None and not df.empty:
            latest = df.iloc[-1]
            result["data"]["LPR_1Y"] = str(latest.get("LPR1Y", "—"))
            result["data"]["LPR_5Y"] = str(latest.get("LPR5Y", "—"))
            result["data"]["LPR_date"] = str(latest.name) if hasattr(latest, 'name') else "—"
            # 上期
            if len(df) > 1:
                prev = df.iloc[-2]
                result["data"]["LPR_1Y_prev"] = str(prev.get("LPR1Y", "—"))
                result["data"]["LPR_5Y_prev"] = str(prev.get("LPR5Y", "—"))
    except Exception as e:
        print(f"  �<ctrl63> LPR 拉取失败: {e}")

    # MLF
    try:
        df = ak.macro_china_central_bank_balance()
        if df is not None and not df.empty:
            latest = df.iloc[-1]
            result["data"]["MLF_info"] = "已获取"
    except Exception:
        pass

    return result


def fetch_industry_nim() -> Dict[str, Any]:
    """拉取商业银行整体监管指标"""
    result = {"fetch_time": now_iso(), "data": {}}
    if ak is None:
        return result

    try:
        # 商业银行主要监管指标
        df = ak.macro_china_bank_financing()
        if df is not None and not df.empty:
            latest = df.iloc[-1]
            # 尝试提取关键字段
            for col in df.columns:
                result["data"][col] = str(latest[col])
    except Exception as e:
        print(f"  行业监管指标拉取失败: {e}")

    return result


def fetch_bank_metrics() -> Dict[str, Any]:
    """从已采集的深度数据 JSON 中提取 18 家银行最新指标"""
    result = {}
    for bank in FOCUS_18:
        name = bank["name"]
        json_path = DEEP_JSON_DIR / f"{bank['code']}_{name}_deep.json"
        if json_path.exists():
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                result[name] = data.get("metrics", {})
            except Exception:
                pass

        # 尝试 iFind 专项指标
        ifind_path = IFIND_DIR / f"{bank['code']}_{name}_indicators.csv"
        if ifind_path.exists():
            try:
                df = pd.read_csv(ifind_path)
                annual = df[df["report_date"].astype(str).str.endswith("12-31")]
                if not annual.empty:
                    latest = annual.iloc[-1]
                    if name not in result:
                        result[name] = {}
                    result[name]["ifind_nim"] = latest.get("nim")
                    result[name]["ifind_npl"] = latest.get("npl_ratio")
                    result[name]["ifind_provision"] = latest.get("provision_coverage")
                    result[name]["ifind_cet1"] = latest.get("cet1_ratio")
            except Exception:
                pass

    return result


# ═══════════════════════════════════════════════════════════════
# 2. 跟踪器页面回填
# ═══════════════════════════════════════════════════════════════

def replace_field_in_table(content: str, row_prefix: str, col_idx: int, new_value: str) -> str:
    """在 markdown 表格中替换指定行、指定列的值。
    
    row_prefix: 该行"指标"列的文本前缀（用于定位行）
    col_idx: 要替换的列索引（0-based）
    new_value: 新值
    """
    lines = content.split("\n")
    new_lines = []
    for line in lines:
        if not line.startswith("|"):
            new_lines.append(line)
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]  # 去掉首尾空串
        if not cells:
            new_lines.append(line)
            continue
        # 检查第一列是否匹配
        if cells[0].startswith(row_prefix) and col_idx < len(cells):
            cells[col_idx] = new_value
            line = "| " + " | ".join(cells) + " |"
        new_lines.append(line)
    return "\n".join(new_lines)


def update_macro_tracker(macro_data: Dict, dry_run: bool = False) -> None:
    """更新宏观与政策跟踪器"""
    path = TRACKER_DIR / "宏观与政策跟踪器.md"
    if not path.exists():
        print(f"  ⚠️  {path.name} 不存在，跳过")
        return

    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    data = macro_data.get("data", {})

    # LPR 1Y
    if "LPR_1Y" in data and data["LPR_1Y"] != "—":
        content = replace_field_in_table(content, "LPR 1年期", 1, str(data["LPR_1Y"]) + "%")
    if "LPR_1Y_prev" in data and data["LPR_1Y_prev"] != "—":
        content = replace_field_in_table(content, "LPR 1年期", 2, str(data["LPR_1Y_prev"]) + "%")
    if "LPR_5Y" in data and data["LPR_5Y"] != "—":
        content = replace_field_in_table(content, "LPR 5年期", 1, str(data["LPR_5Y"]) + "%")
    if "LPR_5Y_prev" in data and data["LPR_5Y_prev"] != "—":
        content = replace_field_in_table(content, "LPR 5年期", 2, str(data["LPR_5Y_prev"]) + "%")

    # Update data_cutoff and status
    content = re.sub(r"data_cutoff: \d{4}-\d{2}-\d{2}", f"data_cutoff: {TODAY}", content, count=1)
    content = content.replace("status: draft", "status: active", 1)

    if not dry_run:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    print(f"  ✅ 宏观与政策跟踪器 已更新")


def update_nim_tracker(industry_data: Dict, bank_metrics: Dict, dry_run: bool = False) -> None:
    """更新息差与收入跟踪器"""
    path = TRACKER_DIR / "息差与收入跟踪器.md"
    if not path.exists():
        print(f"  ⚠️  {path.name} 不存在，跳过")
        return

    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Update from industry data
    data = industry_data.get("data", {})
    # Try to find NIM-related fields
    for key, val in data.items():
        if "净息差" in key or "NIM" in key.upper():
            content = replace_field_in_table(content, "商业银行整体NIM", 1, str(val))

    # Update individual bank NIM from iFind data
    for bank in FOCUS_18:
        name = bank["name"]
        metrics = bank_metrics.get(name, {})
        ifind_nim = metrics.get("ifind_nim")
        if ifind_nim is not None and pd.notna(ifind_nim):
            content = replace_field_in_table(content, name, 1, f"{float(ifind_nim):.2f}%")

    content = re.sub(r"data_cutoff: \d{4}-\d{2}-\d{2}", f"data_cutoff: {TODAY}", content, count=1)
    content = content.replace("status: draft", "status: active", 1)

    if not dry_run:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    print(f"  ✅ 息差与收入跟踪器 已更新")


def update_quality_tracker(bank_metrics: Dict, dry_run: bool = False) -> None:
    """更新资产质量跟踪器"""
    path = TRACKER_DIR / "资产质量跟踪器.md"
    if not path.exists():
        return

    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    for bank in FOCUS_18:
        name = bank["name"]
        metrics = bank_metrics.get(name, {})
        ifind_npl = metrics.get("ifind_npl")
        ifind_provision = metrics.get("ifind_provision")
        if ifind_npl is not None and pd.notna(ifind_npl):
            content = replace_field_in_table(content, name, 1, f"{float(ifind_npl):.2f}%")
        if ifind_provision is not None and pd.notna(ifind_provision):
            content = replace_field_in_table(content, name, 4, f"{float(ifind_provision):.1f}%")

    content = re.sub(r"data_cutoff: \d{4}-\d{2}-\d{2}", f"data_cutoff: {TODAY}", content, count=1)
    content = content.replace("status: draft", "status: active", 1)

    if not dry_run:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    print(f"  ✅ 资产质量跟踪器 已更新")


def update_core_comparison_table(bank_metrics: Dict, dry_run: bool = False) -> None:
    """更新全量银行核心指标比较表"""
    path = TRACKER_DIR / "全量银行核心指标比较表.md"
    if not path.exists():
        return

    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Update each bank row with available data
    for bank in FOCUS_18:
        name = bank["name"]
        metrics = bank_metrics.get(name, {})

        # Try to get from deep JSON
        json_path = DEEP_JSON_DIR / f"{bank['code']}_{name}_deep.json"
        if json_path.exists():
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                m = data.get("metrics", {})
                # ROE
                roe = m.get("加权ROE", {}).get("value_pct")
                if roe:
                    content = replace_field_in_table(content, name, 2, str(roe))
                # NIM from iFind
                ifind_nim = metrics.get("ifind_nim")
                if ifind_nim and pd.notna(ifind_nim):
                    content = replace_field_in_table(content, name, 3, f"{float(ifind_nim):.2f}%")
                # 不良率 from iFind
                ifind_npl = metrics.get("ifind_npl")
                if ifind_npl and pd.notna(ifind_npl):
                    content = replace_field_in_table(content, name, 4, f"{float(ifind_npl):.2f}%")
                # 拨备 from iFind
                ifind_prov = metrics.get("ifind_provision")
                if ifind_prov and pd.notna(ifind_prov):
                    content = replace_field_in_table(content, name, 5, f"{float(ifind_prov):.1f}%")
                # CET1 from iFind
                ifind_cet1 = metrics.get("ifind_cet1")
                if ifind_cet1 and pd.notna(ifind_cet1):
                    content = replace_field_in_table(content, name, 6, f"{float(ifind_cet1):.2f}%")
            except Exception:
                pass

    content = re.sub(r"data_cutoff: \d{4}-\d{2}-\d{2}", f"data_cutoff: {TODAY}", content, count=1)
    content = content.replace("status: draft", "status: active", 1)

    if not dry_run:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    print(f"  ✅ 全量银行核心指标比较表 已更新")


# ═══════════════════════════════════════════════════════════════
# 3. 银行基础档案回填
# ═══════════════════════════════════════════════════════════════

def update_bank_profiles(bank_metrics: Dict, dry_run: bool = False) -> None:
    """用深度数据和 iFind 数据回填基础档案的"待验证"字段"""
    updated = 0
    for bank in FOCUS_18:
        name = bank["name"]
        path = BANK_DIR / f"{name}.md"
        if not path.exists():
            continue

        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        metrics = bank_metrics.get(name, {})
        changed = False

        # iFind 监管指标 → 替换 "待验证"
        ifind_nim = metrics.get("ifind_nim")
        if ifind_nim is not None and pd.notna(ifind_nim):
            content = re.sub(
                r'\| NIM \| 待验证 \|',
                f'| NIM | {float(ifind_nim):.2f}% |',
                content
            )
            changed = True

        ifind_npl = metrics.get("ifind_npl")
        if ifind_npl is not None and pd.notna(ifind_npl):
            content = re.sub(
                r'\| 不良率 \| 待验证 \|',
                f'| 不良率 | {float(ifind_npl):.2f}% |',
                content
            )
            changed = True

        ifind_prov = metrics.get("ifind_provision")
        if ifind_prov is not None and pd.notna(ifind_prov):
            content = re.sub(
                r'\| 拨备覆盖率 \| 待验证 \|',
                f'| 拨备覆盖率 | {float(ifind_prov):.1f}% |',
                content
            )
            changed = True

        ifind_cet1 = metrics.get("ifind_cet1")
        if ifind_cet1 is not None and pd.notna(ifind_cet1):
            content = re.sub(
                r'\| 核心一级资本充足率 \| 待验证 \|',
                f'| 核心一级资本充足率 | {float(ifind_cet1):.2f}% |',
                content
            )
            changed = True

        # Also fill from deep JSON (ROE, 营收, 净利润 etc.)
        json_path = DEEP_JSON_DIR / f"{bank['code']}_{name}_deep.json"
        if json_path.exists():
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                m = data.get("metrics", {})
                # ROE
                roe = m.get("加权ROE", {}).get("value_pct")
                if roe:
                    content = re.sub(r'\| ROE \| 待验证 \|', f'| ROE | {roe} |', content)
                    changed = True
            except Exception:
                pass

        if changed:
            # Update data_cutoff
            content = re.sub(r"data_cutoff: \d{4}-\d{2}-\d{2}", f"data_cutoff: {TODAY}", content, count=1)
            if not dry_run:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
            updated += 1

    print(f"  ✅ 已更新 {updated} 家银行基础档案")


# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="一键数据更新")
    parser.add_argument("--tracker-only", action="store_true", help="只更新跟踪器")
    parser.add_argument("--bank-only", action="store_true", help="只更新银行基础档案")
    parser.add_argument("--dry-run", action="store_true", help="预览模式，不写文件")
    args = parser.parse_args()

    print("🔄 银行 Wiki 一键数据更新")
    print(f"   时间: {now_iso()}")
    print(f"   模式: {'预览' if args.dry_run else '写入'}")
    print()

    # Step 1: Fetch data
    print("📡 Step 1: 拉取宏观数据 (AkShare)...")
    macro_data = fetch_macro_rates()
    print(f"   LPR 1Y: {macro_data.get('data', {}).get('LPR_1Y', '—')}")
    print(f"   LPR 5Y: {macro_data.get('data', {}).get('LPR_5Y', '—')}")

    print("\n📡 Step 2: 拉取行业监管指标 (AkShare)...")
    industry_data = fetch_industry_nim()
    print(f"   获取到 {len(industry_data.get('data', {}))} 个指标")

    print("\n📡 Step 3: 读取 18 家银行已采集数据 (AkShare JSON + iFind CSV)...")
    bank_metrics = fetch_bank_metrics()
    print(f"   覆盖 {len(bank_metrics)} 家银行")

    # Step 2: Update trackers
    if not args.bank_only:
        print("\n📝 Step 4: 回填跟踪器页面...")
        update_macro_tracker(macro_data, args.dry_run)
        update_nim_tracker(industry_data, bank_metrics, args.dry_run)
        update_quality_tracker(bank_metrics, args.dry_run)
        update_core_comparison_table(bank_metrics, args.dry_run)

    # Step 3: Update bank profiles
    if not args.tracker_only:
        print("\n📝 Step 5:1 回填银行基础档案...")
        update_bank_profiles(bank_metrics, args.dry_run)

    print("\n✅ 更新完成！")
    if args.dry_run:
        print("   (预览模式，未写入文件)")


if __name__ == "__main__":
    main()
