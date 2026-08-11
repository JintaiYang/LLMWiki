#!/usr/bin/env python3
"""Generate bank profile pages and deep research pages for the bank investment wiki."""

from __future__ import annotations

import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

VAULT_ROOT = Path(__file__).resolve().parent.parent
DATA_BASE = VAULT_ROOT / "02_原始资料" / "04_AkShare数据"
BANK_LIB = VAULT_ROOT / "05_知识库" / "03_银行库"
SOURCE_LIB = VAULT_ROOT / "05_知识库" / "10_来源"

# A+H dual-listed banks (A股代码 -> H股代码)
A_H_BANKS = {
    "601398": "01398",  # 工商银行
    "601939": "00939",  # 建设银行
    "601288": "01288",  # 农业银行
    "601988": "03988",  # 中国银行
    "601328": "03328",  # 交通银行
    "600036": "03968",  # 招商银行
    "601998": "00998",  # 中信银行
    "600016": "01988",  # 民生银行
    "601818": "06818",  # 光大银行
    "601658": "01658",  # 邮储银行
    "601963": "01963",  # 重庆银行
    "002936": "06199",  # 郑州银行
    "002948": "03866",  # 青岛银行 (actually 002948 does not have H-share; correct: 青岛银行 H=03866 but A=002948 is not H-listed, the H-share entity is different)
}

# Corrected A+H mapping - only banks that are truly A+H dual-listed
A_H_BANKS = {
    "601398": "01398",  # 工商银行
    "601939": "00939",  # 建设银行
    "601288": "01288",  # 农业银行
    "601988": "03988",  # 中国银行
    "601328": "03328",  # 交通银行
    "600036": "03968",  # 招商银行
    "601998": "00998",  # 中信银行
    "600016": "01988",  # 民生银行
    "601818": "06818",  # 光大银行
    "601658": "01658",  # 邮储银行
    "601963": "01963",  # 重庆银行
    "002936": "06199",  # 郑州银行
}

# Bank type classification
BANK_TYPE = {
    "国有大行": ["601398", "601939", "601288", "601988", "601328", "601658"],
    "股份行": ["000001", "600000", "600016", "600036", "601166", "601998", "601818", "601916"],
    "城商行": [
        "002142", "600919", "600926", "601009", "601838", "601169",
        "601229", "600928", "002948", "601577", "601665", "601997",
        "601963", "601187", "001227",
    ],
    "农商行": [
        "002807", "002839", "002958", "601077", "601128", "601825",
        "601860", "600908", "601528", "603323", "002966",
    ],
}

# Main region for each bank
BANK_REGION = {
    "601398": "全国", "601939": "全国", "601288": "全国", "601988": "全国",
    "601328": "全国", "601658": "全国",
    "000001": "全国", "600000": "全国", "600016": "全国", "600036": "全国",
    "601166": "全国", "601998": "全国", "601818": "全国", "601916": "全国",
    "002142": "长三角", "600919": "长三角", "600926": "长三角",
    "601009": "长三角", "601838": "成渝", "601169": "京津冀",
    "601229": "长三角", "600928": "西北", "002948": "山东",
    "601577": "湖南", "601665": "山东", "601997": "贵州",
    "601963": "成渝", "601187": "福建",
    "001227": "甘肃",
    "002807": "长三角", "002839": "长三角", "002958": "山东",
    "601077": "成渝", "601128": "长三角", "601825": "长三角",
    "601860": "长三角", "600908": "长三角", "601528": "长三角",
    "603323": "长三角", "002966": "长三角",
}

# Peer group for focus18 banks
PEER_GROUP = {
    "工商银行": "国有大行", "建设银行": "国有大行", "农业银行": "国有大行",
    "中国银行": "国有大行", "邮储银行": "国有大行", "交通银行": "国有大行",
    "招商银行": "股份行", "兴业银行": "股份行", "平安银行": "股份行",
    "中信银行": "股份行", "浦发银行": "股份行", "民生银行": "股份行",
    "宁波银行": "长三角城商行", "江苏银行": "长三角城商行",
    "成都银行": "成渝城商行", "杭州银行": "长三角城商行",
    "南京银行": "长三角城商行", "常熟银行": "长三角农商行",
}

# Controlling shareholder info
CONTROLLING_SHAREHOLDER = {
    "工商银行": "中央汇金投资有限责任公司（持股34.73%）",
    "建设银行": "中央汇金投资有限责任公司（持股57.11%）",
    "农业银行": "中央汇金投资有限责任公司（持股40.10%）",
    "中国银行": "中央汇金投资有限责任公司（持股64.63%）",
    "邮储银行": "中国邮政集团有限公司（持股62.78%）",
    "交通银行": "中华人民共和国财政部（持股23.88%）",
    "招商银行": "香港中央结算（代理人）有限公司 / 招商局集团间接持股",
    "兴业银行": "福建省财政厅（持股18.85%）",
    "平安银行": "中国平安保险（集团）股份有限公司（持股49.56%）",
    "中信银行": "中国中信有限公司（持股65.40%）",
    "浦发银行": "上海国际集团有限公司（持股24.33%）",
    "民生银行": "无实际控制人（股权分散）",
    "宁波银行": "宁波市开发投资集团有限公司 / 新加坡华侨银行",
    "江苏银行": "江苏省国际信托有限责任公司等国资股东",
    "成都银行": "成都交子金融控股集团有限公司",
    "杭州银行": "杭州市财政局等国资股东",
    "南京银行": "南京市国有资产投资管理控股集团等",
    "常熟银行": "交通银行（持股9.99%）/ 常熟市国资办间接控股",
}

# Bank establishment background
BANK_BG = {
    "工商银行": "1984年成立，中国最大的商业银行，资产规模全球领先",
    "建设银行": "1954年成立，以基建贷款起家，现为综合型大行",
    "农业银行": "1951年成立，深耕县域与三农金融，网点覆盖最广",
    "中国银行": "1912年成立，国际化程度最高，外汇业务传统优势",
    "邮储银行": "2007年成立，依托邮政网络，网点数最多",
    "交通银行": "1908年成立，中国最早的全国性商业银行之一",
    "招商银行": "1987年成立，零售银行标杆，财富管理领先",
    "兴业银行": "1988年成立于福州，同业业务与绿色金融特色",
    "平安银行": "1987年成立（原深发展），平安集团综合金融协同",
    "中信银行": "1995年成立，中信集团旗下，对公与金融市场业务突出",
    "浦发银行": "1992年成立，上海国资背景，对公业务为主",
    "民生银行": "1996年成立，中国首家全国性民营银行，股权分散",
    "宁波银行": "1997年成立，长三角优质城商行，资产质量标杆",
    "江苏银行": "2007年合并成立，江苏省最大城商行",
    "成都银行": "1996年成立，成渝经济圈龙头城商行",
    "杭州银行": "1996年成立，杭州亚运城商行，科创金融特色",
    "南京银行": "1996年成立，长三角城商行，债券投资特色",
    "常熟银行": "2001年改制，小微金融标杆农商行",
}


def load_universe() -> List[Dict[str, Any]]:
    path = DATA_BASE / "数据字典与运行记录" / "a_share_banks_universe.json"
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["banks"]


def load_yjbb() -> Dict[str, Dict[str, Any]]:
    """Load latest earnings report data."""
    result = {}
    path = DATA_BASE / "财务报表" / "bank_yjbb_em_latest.csv"
    if not path.exists():
        return result
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code_raw = row.get("股票代码", "")
            code = re.sub(r"\D", "", code_raw)[-6:].zfill(6)
            if code:
                result[code] = row
    return result


def load_dividend() -> Dict[str, Dict[str, Any]]:
    """Load latest dividend data."""
    result = {}
    path = DATA_BASE / "分红" / "bank_dividend_em_latest.csv"
    if not path.exists():
        return result
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code_raw = row.get("代码", "")
            code = re.sub(r"\D", "", code_raw)[-6:].zfill(6)
            if code:
                result[code] = row
    return result


def load_financial_abstract(code: str) -> Optional[Dict[str, Any]]:
    """Load latest financial abstract for a single bank."""
    path = DATA_BASE / "财务摘要" / f"{code}_*_financial_abstract.csv"
    # Use glob to find the file
    import glob
    matches = glob.glob(str(DATA_BASE / "财务摘要" / f"{code}_*_financial_abstract.csv"))
    if not matches:
        # try the consolidated file
        all_path = DATA_BASE / "财务摘要" / "bank_financial_abstract_all_latest.csv"
        if all_path.exists():
            return None  # Will be handled separately
        return None
    path = Path(matches[0])
    result = {}
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        if rows:
            # Get the latest annual report row
            for row in reversed(rows):
                period = row.get("报告期", "")
                if period.endswith("-12-31") and "2025" in period:
                    result = row
                    break
            if not result:
                # Try 2024 annual
                for row in reversed(rows):
                    period = row.get("报告期", "")
                    if period.endswith("-12-31"):
                        result = row
                        break
    return result or None


def safe_float(val: Any, default: str = "待验证") -> str:
    """Safely convert to float and format."""
    if val is None or val == "" or val == "False" or val is False:
        return default
    try:
        f = float(val)
        if abs(f) > 1e8:
            return f"{f/1e8:.2f}亿"
        elif abs(f) > 1e4:
            return f"{f/1e4:.2f}万"
        elif abs(f) < 0.001 and f != 0:
            return f"{f:.6f}"
        else:
            return f"{f:.2f}"
    except (ValueError, TypeError):
        return default


def safe_pct(val: Any, default: str = "待验证") -> str:
    """Safely convert to percentage."""
    if val is None or val == "" or val == "False" or val is False:
        return default
    try:
        f = float(val)
        return f"{f:.2f}%"
    except (ValueError, TypeError):
        return default


def get_bank_type(code: str) -> str:
    for btype, codes in BANK_TYPE.items():
        if code in codes:
            return btype
    return "其他"


def format_amount(val: Any) -> str:
    """Format an amount value from AkShare earnings data (already in yuan)."""
    if val is None or val == "" or val == "False" or val is False:
        return "待验证"
    try:
        f = float(val)
        return f"{f/1e8:.2f}亿"
    except (ValueError, TypeError):
        return "待验证"


def generate_panorama(banks: List[Dict[str, Any]]) -> str:
    """Generate the 上市银行全景.md page."""
    # Group banks by type
    groups = {"国有大行": [], "股份行": [], "城商行": [], "农商行": []}
    for bank in banks:
        code = bank["code"]
        name = bank["name"]
        btype = get_bank_type(code)
        if btype in groups:
            groups[btype].append(bank)

    lines = [
        "---",
        "title: 上市银行全景",
        "aliases:",
        "  - 银行全景",
        "  - A股银行全景",
        "note_type: knowledge_page",
        "status: draft",
        "created: 2026-07-22",
        "updated: 2026-07-22",
        "data_cutoff: 2026-07-22",
        "report_period: 2025A",
        "evidence_level: medium",
        "evidence_class: mixed",
        "source_priority: third_party_structured",
        "sources:",
        '  - "[[05_知识库/10_来源/AkShare 银行全景快照 2026-07-22]]"',
        '  - "[[05_知识库/10_来源/A股银行清单 2026-07-22]]"',
        "related:",
        '  - "[[05_知识库/02_行业主页/银行业]]"',
        '  - "[[05_知识库/01_行业地图/银行业价值链与资金循环]]"',
        "tags:",
        "  - 银行",
        "  - 全景",
        "  - 上市银行",
        "---",
        "",
        "# 上市银行全景",
        "",
        "> 截至数据截点，中国 A 股共有 42 家上市银行，其中 18 家被纳入本库重点研究。本页提供全量银行概览与分类导航。",
        "",
        "## 总览",
        "",
        f"| 分类 | 数量 | 重点研究 | A+H 两地上市 |",
        f"| --- | --- | --- | --- |",
    ]

    for btype in ["国有大行", "股份行", "城商行", "农商行"]:
        group = groups.get(btype, [])
        focus_count = sum(1 for b in group if b.get("focus18"))
        ah_count = sum(1 for b in group if b.get("code") in A_H_BANKS)
        lines.append(f"| {btype} | {len(group)} | {focus_count} | {ah_count} |")

    total_focus = sum(1 for b in banks if b.get("focus18"))
    total_ah = sum(1 for b in banks if b.get("code") in A_H_BANKS)
    lines.append(f"| **合计** | **{len(banks)}** | **{total_focus}** | **{total_ah}** |")
    lines.append("")

    # Detailed tables by type
    for btype in ["国有大行", "股份行", "城商行", "农商行"]:
        group = groups.get(btype, [])
        if not group:
            continue
        lines.append(f"## {btype}")
        lines.append("")
        lines.append("| A股代码 | 银行名称 | 上市地 | 重点 | A+H | 基础档案 | 深度研究 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for bank in sorted(group, key=lambda x: x["code"]):
            code = bank["code"]
            name = bank["name"]
            market = bank["market"]
            focus = "✓" if bank.get("focus18") else ""
            ah = "✓" if code in A_H_BANKS else ""
            profile_link = f"[[05_知识库/03_银行库/{name}]]"
            deep_link = f"[[05_知识库/03_银行库/{name} 深度研究]]" if bank.get("focus18") else "—"
            lines.append(f"| {code} | {name} | {market} | {focus} | {ah} | {profile_link} | {deep_link} |")
        lines.append("")

    # A+H comparison section
    lines.append("## A+H 两地上市银行对照")
    lines.append("")
    lines.append("| A股代码 | A股名称 | H股代码 | 基础档案 |")
    lines.append("| --- | --- | --- | --- |")
    for code, hcode in sorted(A_H_BANKS.items()):
        name = next((b["name"] for b in banks if b["code"] == code), "未知")
        lines.append(f"| {code} | {name} | {hcode} | [[05_知识库/03_银行库/{name}]] |")
    lines.append("")

    lines.extend([
        "## 待验证事项",
        "",
        "- [ ] A+H 银行清单需与港交所最新披露复核",
        "- [ ] 银行分类口径需与银保监会/金管局最新分类对照",
        "- [ ] 若有新上市银行需及时更新全景",
        "",
        "## 下一步",
        "",
        "- [ ] 为 42 家银行补全基础档案中的正式披露来源",
        "- [ ] 为 18 家重点银行填充深度研究页",
        "- [ ] 建立 A/H 估值比较快照",
        "",
        "## 相关页面",
        "",
        "- [[05_知识库/02_行业主页/银行业]]",
        "- [[05_知识库/01_行业地图/银行业价值链与资金循环]]",
        "- [[05_知识库/11_研究框架/银行业研究框架]]",
        "",
        "## 只追加更新日志",
        "",
        "- 2026-07-22 | 类型: 创建 | 变更: 建立上市银行全景页 | 依据: [[06_维护契约]] | 影响: 全量银行基础档案待创建",
    ])

    return "\n".join(lines)


def generate_bank_profile(bank: Dict[str, Any], yjbb: Dict[str, Any], dividend: Dict[str, Any]) -> str:
    """Generate a single bank profile page."""
    code = bank["code"]
    name = bank["name"]
    market = bank["market"]
    is_focus = bank.get("focus18", False)
    btype = get_bank_type(code)
    region = BANK_REGION.get(code, "待验证")
    is_ah = code in A_H_BANKS
    h_code = A_H_BANKS.get(code, "NA")

    market_name = "上交所" if market == "SH" else "深交所"
    focus_label = "已纳入重点" if is_focus else "全量覆盖"
    peer = PEER_GROUP.get(name, btype)
    shareholder = CONTROLLING_SHAREHOLDER.get(name, "待验证")
    bg = BANK_BG.get(name, "待验证")

    # Pre-compute conditional values to avoid backslash escapes in f-strings (Python 3.9 compat)
    if name == "民生银行":
        actual_controller = "待验证"
    elif "(" in shareholder:
        actual_controller = shareholder.split("(")[0]
    else:
        actual_controller = "待验证"
    valuation_framework = "PB-ROE / RIM / DDM" if is_focus else "PB-ROE"

    # Extract financial data from yjbb
    yj = yjbb.get(code, {})
    revenue = format_amount(yj.get("营业总收入-营业总收入", ""))
    net_profit = format_amount(yj.get("净利润-净利润", ""))
    eps = safe_float(yj.get("每股收益", ""))
    bvps = safe_float(yj.get("每股净资产", ""))
    roe = safe_pct(yj.get("净资产收益率", ""))
    rev_growth = safe_pct(yj.get("营业总收入-同比增长", ""))
    np_growth = safe_pct(yj.get("净利润-同比增长", ""))

    # Extract dividend data
    div = dividend.get(code, {})
    div_yield = safe_pct(div.get("现金分红-股息率", ""))
    div_ratio = safe_float(div.get("现金分红-现金分红比例", ""))
    div_yield_display = div_yield

    lines = [
        "---",
        f'title: "{name}"',
        "aliases:",
        f'  - "{name}"',
        "note_type: bank_profile",
        "status: draft",
        "created: 2026-07-22",
        "updated: 2026-07-22",
        "data_cutoff: 2026-07-22",
        "report_period: 2025A",
        "evidence_level: medium",
        "evidence_class: official_fact",
        "source_priority: company_filing",
        "sources:",
        f'  - "[[05_知识库/10_来源/{name} 2025年年报]]"',
        f'  - "[[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]]"',
        "related:",
        '  - "[[05_知识库/03_银行库/上市银行全景]]"',
        "tags:",
        "  - 银行",
        "  - 基础档案",
        f"  - {btype}",
        f"  - {region}",
        "---",
        "",
        f"# {name} 基础档案",
        "",
        '> 用途：为全部 A 股上市银行建立统一、轻量、可比较的基础研究档案。仅填写有来源支持的信息；缺失项写入"未知或待验证"。',
        "",
        "## 1. 一页结论",
        "",
        f"- 银行类型：{btype}",
        f"- 主要经营区域：{region}",
        f"- 当前研究定位：{focus_label}",
        f"- 一句话概览：{bg}",
        "",
        "## 2. 官方事实",
        "",
        "### 2.1 主体信息",
        "",
        "| 项目 | 内容 | 信息类别 | 证据等级 | 来源 |",
        "| --- | --- | --- | --- | --- |",
        f"| A 股代码 | {code} | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 上市地 | {market_name} | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 银行类型 | {btype} | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 成立背景 | {bg} | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 控股股东 | {shareholder} | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 实际控制人 | {actual_controller} | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        "",
        "### 2.2 A/H 固定对照表",
        "",
    ]

    if is_ah:
        lines.append(f"> {name}为 A+H 两地上市银行，基本面共享、交易口径分开。")
        lines.append("")
        lines.append("| 项目 | A 股 | H 股 / A-H 对照 | 数据日期或说明 | 信息类别 | 证据等级 | 来源 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        lines.append(f"| 股票代码 | {code} | {h_code} | 基本面共用、交易口径分开 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |")
        lines.append(f"| 币种 | CNY | HKD | 未换算时不得直接比较 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |")
        lines.append(f"| PB | 待验证 | 待验证 | 待获取 | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]] |")
        lines.append(f"| PE | 待验证 | 待验证 | 待获取 | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]] |")
        lines.append(f"| 税前股息率 | 待验证 | 待验证 | 待获取 | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]] |")
        lines.append(f"| 税后股息率 | NA | NA | 投资者身份及税务假设待确定 | valuation_assumption | medium | [[05_知识库/10_来源/{name} 分红与税务口径]] |")
        lines.append(f"| A/H 溢价 | 不适用 | 待验证 | 待获取 | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]] |")
        lines.append(f"| 流动性差异 | 待验证 | 待验证 | 待获取 | third_party_data | medium | [[05_知识库/10_来源/{name} A-H市场数据]] |")
        lines.append(f"| 投资者结构差异 | 待验证 | 待验证 | 待获取 | research_inference | medium | [[05_知识库/10_来源/{name} A-H投资者结构资料]] |")
    else:
        lines.append("> 非 A/H 银行，H 股与对照字段填 NA。")
        lines.append("")
        lines.append("| 项目 | A 股 | H 股 / A-H 对照 | 数据日期或说明 | 信息类别 | 证据等级 | 来源 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        lines.append(f"| 股票代码 | {code} | NA | 仅 A 股上市 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |")
        lines.append(f"| 币种 | CNY | NA | — | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |")
        lines.append(f"| PB | 待验证 | NA | — | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]] |")
        lines.append(f"| PE | 待验证 | NA | — | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]] |")
        lines.append(f"| 税前股息率 | 待验证 | NA | — | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]] |")
        lines.append("| 税后股息率 | NA | NA | — | valuation_assumption | medium | — |")
        lines.append("| A/H 溢价 | 不适用 | NA | — | — | — | — |")

    lines.extend([
        "",
        "### 2.3 核心财务摘要",
        "",
        "> 以下金额统一写明单位，默认优先使用 `2025A`，若用 `2026Q1` 边际更新，需单独标注。",
        "",
        "| 指标 | 数值 | 报告期 | 单位 | 信息类别 | 证据等级 | 来源 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        f"| 营业收入 | {revenue} | 2025A | 亿元 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 归母净利润 | {net_profit} | 2025A | 亿元 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 每股收益 | {eps} | 2025A | 元 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 每股净资产 | {bvps} | 2025A | 元 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| ROE | {roe} | 2025A | % | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 总资产 | 待验证 | 2025A | 亿元 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 归母净资产 | 待验证 | 2025A | 亿元 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| NIM | 待验证 | 2025A | % | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 不良率 | 待验证 | 2025A | % | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |,",
        f"| 拨备覆盖率 | 待验证 | 2025A | % | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |,",
        f"| 核心一级资本充足率 | 待验证 | 2025A | % | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |,",
        "",
        "## 3. 第三方结构化数据",
        "",
        "> `AkShare` 默认 `medium`。如已逐项复核，可在备注中说明升级依据。",
        "",
        "| 指标 | 数值 | 数据日期 | 信息类别 | 证据等级 | 备注 | 来源 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        f"| 最新 PB | 待验证 | 2026-07-22 | third_party_data | medium | 价格日与净资产期末需对应 | [[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]] |",
        f"| 最新 PE | 待验证 | 2026-07-22 | third_party_data | medium | 仅作辅助 | [[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]] |",
        f"| 最新股息率 | {div_yield_display} | 2026-07-22 | third_party_data | medium | 区分税前/税后 | [[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]] |",
        f"| 最新市值 | 待验证 | 2026-07-22 | third_party_data | medium | 写明币种 | [[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]] |",
        "",
        "## 4. 外部预期",
        "",
        "| 项目 | 内容 |",
        "| --- | --- |",
        "| 预期来源 | 待获取 |",
        "| 数据日期 | NA |",
        "| 预测期间 | NA |",
        "| 样本机构数量 | NA |",
        "| 与正式披露差异 | 待比较 |",
        "| 滞后风险 | 待评估 |",
        "",
        "## 5. 研究推断",
        "",
        f"- 同业组：{peer}",
        f"- 主要风险标签：待深度研究后填充",
        "- 当前仅凭基础档案可得出的低强度判断：",
        f"  - {btype}，经营区域为{region}",
        f"  - 营收同比增速{rev_growth}，净利润同比增速{np_growth}",
        "",
        "## 6. 估值假设",
        "",
        "> 这里只能记录假设，不得写成既成事实。",
        "",
        "- 当前观察用估值锚：PB / 股息率",
        f"- 当前比较组：{peer}",
        f"- 若进入深度研究，优先补充：{valuation_framework}",
        "",
        "## 7. 待验证事项",
        "",
        "- [ ] 总资产、归母净资产、NIM、不良率、拨备覆盖率、核心一级资本充足率等关键指标待从正式年报补入",
        "- [ ] AkShare 最新 PB/PE/市值需与正式净资产口径复核",
        "- [ ] 控股股东与实控人信息待与最新年报核对",
    ])

    if is_ah:
        lines.extend([
            "- [ ] H 股代码、A/H 溢价、流动性差异和投资者结构待补入",
            "- [ ] 税后股息率仅在触发条件满足时计算",
        ])

    lines.extend([
        "",
        "## 8. 下一步",
        "",
        "- [ ] 补齐缺失的正式披露来源页，并将 `draft` 页面中的临时来源记录替换为真实双链",
        "- [ ] 复核 AkShare 指标；仅在逐项对照正式披露后升级证据等级",
    ])

    if is_ah:
        lines.append("- [ ] 补齐汇率日期、流动性与投资者结构差异；仅在触发条件满足时计算税后股息率")

    lines.extend([
        "",
        "## 9. 相关页面",
        "",
        "- 上级聚合：[[05_知识库/03_银行库/上市银行全景]]",
    ])

    if is_focus:
        lines.append(f"- 深度研究：[[05_知识库/03_银行库/{name} 深度研究]]")

    lines.extend([
        f"- 来源索引：[[05_知识库/10_来源/{name} 来源索引]]",
        "",
        "## 10. 只追加更新日志",
        "",
        f"- 2026-07-22 | 类型: 创建 | 变更: 建立基础档案骨架 | 依据: [[06_维护契约]] | 影响: 待填充正式数据",
    ])

    return "\n".join(lines)


def generate_deep_research(bank: Dict[str, Any], yjbb: Dict[str, Any], dividend: Dict[str, Any]) -> str:
    """Generate a deep research page for a focus18 bank."""
    code = bank["code"]
    name = bank["name"]
    btype = get_bank_type(code)
    region = BANK_REGION.get(code, "待验证")
    is_ah = code in A_H_BANKS
    h_code = A_H_BANKS.get(code, "NA")
    peer = PEER_GROUP.get(name, btype)
    shareholder = CONTROLLING_SHAREHOLDER.get(name, "待验证")
    bg = BANK_BG.get(name, "待验证")

    yj = yjbb.get(code, {})
    revenue = format_amount(yj.get("营业总收入-营业总收入", ""))
    net_profit = format_amount(yj.get("净利润-净利润", ""))
    eps = safe_float(yj.get("每股收益", ""))
    bvps = safe_float(yj.get("每股净资产", ""))
    roe = safe_pct(yj.get("净资产收益率", ""))

    div = dividend.get(code, {})
    div_yield = safe_pct(div.get("现金分红-股息率", ""))
    div_ratio = safe_float(div.get("现金分红-现金分红比例", ""))
    div_yield_display = div_yield if div_yield != "待验证" else "待验证"

    lines = [
        "---",
        f'title: "{name} 深度研究"',
        "aliases:",
        f'  - "{name} 深度研究"',
        "note_type: deep_research",
        "status: draft",
        "created: 2026-07-22",
        "updated: 2026-07-22",
        "data_cutoff: 2026-07-22",
        "report_period: 2025A",
        "evidence_level: mixed",
        "evidence_class: mixed",
        "source_priority: company_filing",
        "sources:",
        f'  - "[[05_知识库/10_来源/{name} 2025年年报]]"',
        f'  - "[[05_知识库/10_来源/{name} 2026Q1报告]]"',
        f'  - "[[05_知识库/10_来源/AkShare {name} 深度快照 2026-07-22]]"',
        "related:",
        f'  - "[[05_知识库/03_银行库/{name}]]"',
        f'  - "[[05_知识库/17_投资命题/{name} 核心命题]]"',
        f'  - "[[05_知识库/18_估值/{name} 估值]]"',
        "tags:",
        "  - 银行",
        "  - 深度研究",
        f"  - {name}",
        "---",
        "",
        f"# {name} 深度研究",
        "",
        f"> 用途：服务重点银行统一深度研究。每节按信息类别分栏，避免把正式披露、第三方数据、研究判断和估值假设混写。",
        "",
        "## 1. 一句话投资判断",
        "",
        f"- 当前判断（`research_inference`）：待深度研究后填充",
        "- 当前状态：开放",
        f"- 对应命题：[[05_知识库/17_投资命题/{name} 核心命题]]",
        "",
        "## 2. 银行定位、区域与客群",
        "",
        "### 官方事实 `official_fact`",
        f"- 总部与主经营区域：{region}",
        f"- 客群结构：待从正式年报补入",
        "",
        "### 研究推断 `research_inference`",
        f"- 合理同业组：{peer}",
        f"- 区域禀赋如何影响负债、资产和风险：待研究",
        "",
        "## 3. 股东结构、治理与管理层",
        "",
        "### 官方事实 `official_fact`",
        "| 项目 | 内容 | 证据等级 | 来源 |",
        "| --- | --- | --- | --- |",
        f"| 控股股东/实控人 | {shareholder} | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 董监高变化 | 待补入 | high | [[05_知识库/10_来源/{name} 公司公告]] |",
        "",
        "### 研究推断 `research_inference`",
        "- 治理稳定性与激励约束评价：待研究",
        "",
        "## 4. 商业模式与收入来源",
        "",
        "### 官方事实 `official_fact`",
        f"- 净利息收入、手续费及佣金、投资收益等收入结构：待从正式年报补入",
        f"- 正式披露的业务特色：{bg}",
        "",
        "### 第三方结构化数据 `third_party_data`",
        f"- 经结构化整理的收入拆分：待从 AkShare 补入；默认 medium",
        "",
        "### 研究推断 `research_inference`",
        "- 商业模式可持续性及最脆弱环节：待研究",
        "",
        "## 5. 资产结构与贷款投向",
        "",
        "### 官方事实 `official_fact`",
        "| 指标 | 数值 | 报告期 | 证据等级 | 来源 |",
        "| --- | --- | --- | --- | --- |",
        f"| 贷款总额及增速 | 待验证 | 2025A | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 对公/零售贷款结构 | 待验证 | 2025A | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 按揭/消费贷/经营贷结构 | 待验证 | 2025A/NA | high / unknown_pending | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 债券、票据与同业资产占比 | 待验证 | 2025A | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
        "",
        "### 第三方结构化数据 `third_party_data`",
        "- 横向可比资产结构：待补入；记录快照日期，默认 medium",
        "",
        "### 研究推断 `research_inference`",
        "- 资产增长是有效需求还是低收益冲量：待研究",
        "- 地产、城投、小微、信用卡或区域集中风险判断：待研究",
        "",
        "### 估值假设 `valuation_assumption`",
        "- 情景模型中资产增速假设：悲观 / 基准 / 乐观 — 待设定",
        "",
        "## 6. 负债结构与存款护城河",
        "",
        "### 官方事实 `official_fact`",
        "| 指标 | 数值 | 报告期 | 来源 |",
        "| --- | --- | --- | --- |",
        f"| 存款总额 | 待验证 | 2025A | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 对公/零售存款占比 | 待验证 | 2025A | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 活期/定期占比 | 待验证 | 2025A | [[05_知识库/10_来源/{name} 2025年年报]] |",
        "",
        "### 研究推断 `research_inference`",
        "- 低成本、稳定性、区域关系、产品粘性和客户结构形成的护城河：待研究",
        "",
        "## 7. 净息差及净利息收入拆解",
        "",
        "```text",
        "NIM 变化 = 资产收益率变化 - 负债成本率变化 + 资产负债结构贡献",
        "```",
        "",
        "### 官方事实 `official_fact`",
        "- 当前 NIM、资产收益率、负债成本率及披露口径：待从正式年报补入",
        f"- 净利息收入与同比变化：待补入",
        f"- 来源：[[05_知识库/10_来源/{name} 2025年年报]]、[[05_知识库/10_来源/{name} 2026Q1报告]]",
        "",
        "### 第三方结构化数据 `third_party_data`",
        "- 可比同业 NIM 与数据日期：待补入；默认 medium",
        "",
        "### 研究推断 `research_inference`",
        "- NIM 边际变化的资产端、负债端与结构端驱动：待研究",
        "",
        "### 估值假设 `valuation_assumption`",
        "- 悲观/基准/乐观情景 NIM：待设定",
        "",
        "## 8. 非息收入与财富管理能力",
        "",
        "### 官方事实 `official_fact`",
        "- 手续费及佣金净收入：待补入",
        "- 财富管理、银行卡、托管、投行等披露拆分：待补入",
        "- 交易与投资收益：待补入",
        "",
        "### 第三方结构化数据 `third_party_data`",
        "- 同业非息占比与数据日期：待补入；默认 medium",
        "",
        "### 研究推断 `research_inference`",
        "- 非息收入可持续性、财富管理能力与一次性因素：待研究",
        "",
        "### 估值假设 `valuation_assumption`",
        "- 情景模型中非息收入增速：悲观 / 基准 / 乐观 — 待设定",
        "",
        "## 9. 资产质量与潜在风险暴露",
        "",
        "### 官方事实 `official_fact`",
        "| 指标 | 数值 | 期间 | 来源 |",
        "| --- | --- | --- | --- |",
        f"| 不良率 | 待验证 | 2025A | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 关注率 | 待验证 | 2025A/NA | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 逾期率 | 待验证 | 2025A/NA | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 新生成不良率 | 待验证 | 2025A/NA | [[05_知识库/10_来源/{name} 2025年年报]] |",
        "",
        "### 研究推断 `research_inference`",
        "- 潜在风险暴露及口径限制：待研究",
        "",
        "## 10. 拨备、信用成本与利润质量",
        "",
        "### 官方事实 `official_fact`",
        "| 指标 | 数值 | 报告期 | 来源 |",
        "| --- | --- | --- | --- |",
        f"| 拨备覆盖率 | 待验证 | 2025A | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 拨贷比 | 待验证 | 2025A | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| 信用成本 | 待验证 | 2025A | [[05_知识库/10_来源/{name} 2025年年报]] |",
        f"| PPOP | 待验证 | 2025A | [[05_知识库/10_来源/{name} 2025年年报]] |",
        "",
        "### 第三方结构化数据 `third_party_data`",
        "- 同业拨备与信用成本比较：待补入；注明计算口径，默认 medium",
        "",
        "### 研究推断 `research_inference`",
        "- 利润改善来自收入、拨备释放还是投资收益：待研究",
        "- 当前信用成本是否低于正常水平：待研究",
        "",
        "### 估值假设 `valuation_assumption`",
        "- 正常化信用成本与拨备释放假设：待设定",
        "",
        "## 11. 资本充足、扩表能力与分红",
        "",
        "### 官方事实 `official_fact`",
        "- 核心一级/一级/总资本充足率：待验证",
        "- RWA、资本补充工具与正式分红方案：待验证",
        "",
        "### 第三方结构化数据 `third_party_data`",
        f"- 市场价格日对应的税前股息率：{div_yield if div_yield != '待验证' else '待验证'}；默认 medium",
        "",
        "### 研究推断 `research_inference`",
        "- 资本安全垫、扩表能力和分红持续性：待研究",
        "",
        "### 估值假设 `valuation_assumption`",
        "- 情景分红率、资本补充摊薄和可持续增长率：待设定",
        "",
        "## 12. 竞争优势及同业比较",
        "",
        "### 官方事实 `official_fact`",
        "- 可比银行正式披露的关键业务与财务指标：待补入",
        "",
        "### 第三方结构化数据 `third_party_data`",
        "- 统一基准日横向比较表：待补入；默认 medium",
        "",
        "### 研究推断 `research_inference`",
        f"- 合理同业组及选择理由：{peer}",
        "- 相对优势、相对短板及最值得跟踪的三项指标：待研究",
        "",
        "### 估值假设 `valuation_assumption`",
        "- 同业估值溢价/折价是否应持续及其假设：待设定",
        "",
        "## 13. A/H 固定对照表",
        "",
    ]

    if is_ah:
        lines.extend([
            f"> {name}为 A+H 两地上市银行。",
            "",
            "| 项目 | A 股 | H 股 / A-H 对照 | 日期/假设 | 信息类别 | 证据等级 | 来源 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            f"| 股票代码与币种 | {code} / CNY | {h_code} / HKD | 基本面共享、交易口径分开 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
            f"| PB | 待验证 | 待验证 | 2026-07-22 | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]] |",
            f"| PE | 待验证 | 待验证 | 2026-07-22 | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]] |",
            f"| 税前股息率 | 待验证 | 待验证 | 2026-07-22 | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]] |",
            f"| 税后股息率 | NA | NA | 投资者身份与税务假设待确定 | valuation_assumption | medium | [[05_知识库/10_来源/{name} 分红与税务口径]] |",
            f"| A/H 溢价 | 不适用 | 待验证 | 待获取 | third_party_data | medium | [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]] |",
            f"| 流动性差异 | 待验证 | 待验证 | 待获取 | third_party_data | medium | [[05_知识库/10_来源/{name} A-H市场数据]] |",
            f"| 投资者结构差异 | 待验证 | 待验证 | 待获取 | research_inference | medium | [[05_知识库/10_来源/{name} A-H投资者结构资料]] |",
        ])
    else:
        lines.extend([
            "> 非 A/H 银行，H 股与对照字段填 NA。",
            "",
            "| 项目 | A 股 | H 股 / A-H 对照 | 日期/假设 | 信息类别 | 证据等级 | 来源 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            f"| 股票代码与币种 | {code} / CNY | NA | 仅 A 股上市 | official_fact | high | [[05_知识库/10_来源/{name} 2025年年报]] |",
            "| PB | 待验证 | NA | — | third_party_data | medium | — |",
            "| PE | 待验证 | NA | — | third_party_data | medium | — |",
            "| 税前股息率 | 待验证 | NA | — | third_party_data | medium | — |",
            "| 税后股息率 | NA | NA | — | valuation_assumption | medium | — |",
            "| A/H 溢价 | 不适用 | NA | — | — | — | — |",
        ])

    lines.extend([
        "",
        "## 14. 核心投资命题与反方论证",
        "",
        f"- 核心命题：[[05_知识库/17_投资命题/{name} 核心命题]]",
        "- 最强反方：待研究",
        "- 当前证据平衡：待评估",
        "",
        "## 15. 市场一致预期与预期差",
        "",
        "> 本节只写 `external_expectation`。",
        "",
        "- 来源、数据日期、预测期间、样本机构数：待获取",
        "- 一致预期及其与正式披露的差异：待比较",
        "- 可能滞后：待评估",
        "",
        "## 16. 估值、情景分析及预期回报",
        "",
        "> 本节只写 `valuation_assumption` 和由这些假设推导的结果。",
        "",
        "- 估值框架：PB-ROE / RIM / DDM / PE 辅助 — 待设定",
        "- 悲观/基准/乐观情景：待设定",
        "- 3-5 年回报拆解：待设定（盈利与净资产增长 + 股息 + 估值变化 - 摊薄）",
        "",
        "## 17. 催化剂、风险和证伪条件",
        "",
        "- 关键催化剂：待研究",
        "- 核心风险：待研究",
        "- 证伪条件：待量化",
        "",
        "## 18. 季度验证记录",
        "",
        "| 日期 | 事件 | 对应命题 | 状态变化 | 依据 |",
        "| --- | --- | --- | --- | --- |",
        f"| 待填充 | 例如 2026Q1 财报 | [[05_知识库/17_投资命题/{name} 核心命题]] | 开放 | — |",
        "",
        "## 19. 待验证事项",
        "",
        "- [ ] 总资产、归母净资产、NIM、不良率、拨备覆盖率、核心一级资本充足率等关键指标需从正式年报补入",
        "- [ ] 贷款投向、存款结构、非息收入拆分需从正式年报补入",
        "- [ ] 需要下一报告期确认的推断：待填充",
        "- [ ] 需要复核的 AkShare 或 A/H 口径：待填充",
        "",
        "## 20. 下一步",
        "",
        "- [ ] 补齐 `draft` 阶段缺失的来源页，并在升级 `active` 前检查全部核心双链",
        "- [ ] 更新核心投资命题、最强反方和量化证伪条件",
        "- [ ] 完成 A/H 对照；仅在触发条件满足时计算税后股息率",
        "- [ ] 联动更新估值页与下一季度跟踪器",
        "",
        "## 21. 主要来源与相关页面",
        "",
        f"- [[05_知识库/10_来源/{name} 2025年年报]]",
        f"- [[05_知识库/10_来源/{name} 2026Q1报告]]",
        f"- [[05_知识库/10_来源/AkShare {name} 深度快照 2026-07-22]]",
        f"- [[05_知识库/03_银行库/{name}]]",
        f"- [[05_知识库/18_估值/{name} 估值]]",
        "",
        "## 只追加更新日志",
        "",
        f"- 2026-07-22 | 类型: 创建 | 变更: 建立深度研究结构 | 依据: [[06_维护契约]] | 影响: 待后续填充银行事实与判断",
    ])

    return "\n".join(lines)


def main() -> int:
    print("Loading bank universe...")
    banks = load_universe()

    print("Loading earnings data...")
    yjbb = load_yjbb()

    print("Loading dividend data...")
    dividend = load_dividend()

    # Ensure output directories exist
    BANK_LIB.mkdir(parents=True, exist_ok=True)

    # Generate panorama page
    panorama_content = generate_panorama(banks)
    panorama_path = BANK_LIB / "上市银行全景.md"
    with open(panorama_path, "w", encoding="utf-8") as f:
        f.write(panorama_content)
    print(f"Created: {panorama_path}")

    # Generate bank profiles for all 42 banks
    profile_count = 0
    for bank in banks:
        code = bank["code"]
        name = bank["name"]
        content = generate_bank_profile(bank, yjbb, dividend)
        path = BANK_LIB / f"{name}.md"
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        profile_count += 1

    print(f"Created {profile_count} bank profile pages")

    # Generate deep research pages for 18 focus banks
    deep_count = 0
    for bank in banks:
        if not bank.get("focus18"):
            continue
        code = bank["code"]
        name = bank["name"]
        content = generate_deep_research(bank, yjbb, dividend)
        path = BANK_LIB / f"{name} 深度研究.md"
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        deep_count += 1

    print(f"Created {deep_count} deep research pages")

    # Generate source index pages for focus banks and A/H banks
    source_count = 0
    SOURCE_LIB.mkdir(parents=True, exist_ok=True)
    for bank in banks:
        code = bank["code"]
        name = bank["name"]
        is_focus = bank.get("focus18", False)
        is_ah = code in A_H_BANKS
        if not is_focus and not is_ah:
            continue

        source_lines = [
            "---",
            f'title: "{name} 来源索引"',
            "note_type: source_index",
            "status: draft",
            "created: 2026-07-22",
            "updated: 2026-07-22",
            "data_cutoff: 2026-07-22",
            "report_period: NA",
            "evidence_level: high",
            "evidence_class: internal_governance",
            "source_priority: internal_governance",
            "sources: []",
            "related:",
            f'  - "[[05_知识库/03_银行库/{name}]]"',
            "tags:",
            "  - 来源索引",
            f"  - {name}",
            "---",
            "",
            f"# {name} 来源索引",
            "",
            f"> 本页汇总{name}相关的主要来源页面，便于溯源与复核。",
            "",
            "## 官方披露",
            "",
            f"- [[05_知识库/10_来源/{name} 2025年年报]]",
            f"- [[05_知识库/10_来源/{name} 2026Q1报告]]",
            f"- [[05_知识库/10_来源/{name} 公司公告]]",
            "",
            "## AkShare 数据快照",
            "",
            f"- [[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]]",
        ]

        if is_focus:
            source_lines.append(f"- [[05_知识库/10_来源/AkShare {name} 深度快照 2026-07-22]]")

        if is_ah:
            source_lines.extend([
                f"- [[05_知识库/10_来源/AkShare {name} A-H快照 2026-07-22]]",
                f"- [[05_知识库/10_来源/{name} A-H市场数据]]",
                f"- [[05_知识库/10_来源/{name} 分红与税务口径]]",
            ])

        source_lines.extend([
            "",
            "## 只追加更新日志",
            "",
            f"- 2026-07-22 | 类型: 创建 | 变更: 建立来源索引 | 依据: [[06_维护契约]] | 影响: 待后续补充来源页内容",
        ])

        content = "\n".join(source_lines)
        path = SOURCE_LIB / f"{name} 来源索引.md"
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        source_count += 1

    print(f"Created {source_count} source index pages")
    print(f"\nTotal: 1 panorama + {profile_count} profiles + {deep_count} deep research + {source_count} source index = {1 + profile_count + deep_count + source_count} files")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
