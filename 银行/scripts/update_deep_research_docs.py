#!/usr/bin/env python3
"""Update deep research markdown docs with AkShare-fetched metrics.

Reads the JSON files produced by fetch_bank_deep_metrics.py and injects:
1. A data overview table at the top of the document (after the intro section)
2. Fills in third_party_data sections with actual values
3. Adds four-dimensional evaluations (盈利能力/资产质量/资产风险/可持续性)

Only writes values that exist in the JSON. Does NOT fabricate or speculate.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


VAULT = Path("/Users/yangjintai/Documents/LLM wiki/银行")
BANK_DIR = VAULT / "05_知识库" / "03_银行库"
JSON_DIR = VAULT / "02_原始资料" / "04_AkShare数据" / "深度采集"

DEEP_BANKS = [
    {"code": "600036", "name": "招商银行"},
    {"code": "601398", "name": "工商银行"},
    {"code": "601939", "name": "建设银行"},
    {"code": "601288", "name": "农业银行"},
    {"code": "601988", "name": "中国银行"},
    {"code": "601328", "name": "交通银行"},
    {"code": "601658", "name": "邮储银行"},
    {"code": "600000", "name": "浦发银行"},
    {"code": "600016", "name": "民生银行"},
    {"code": "601166", "name": "兴业银行"},
    {"code": "601998", "name": "中信银行"},
    {"code": "000001", "name": "平安银行"},
    {"code": "002142", "name": "宁波银行"},
    {"code": "600919", "name": "江苏银行"},
    {"code": "600926", "name": "杭州银行"},
    {"code": "601009", "name": "南京银行"},
    {"code": "601838", "name": "成都银行"},
    {"code": "601128", "name": "常熟银行"},
]


def get_val(m: Dict, key: str, field: str = "value_yi") -> str:
    """Get formatted value from metrics dict."""
    entry = m.get(key, {})
    if not entry:
        return "—"
    # Try value_yi, value_pct, value in order
    for f in ["value_yi", "value_pct", "value"]:
        if f in entry and entry[f] and entry[f] != "—":
            return entry[f]
    return "—"


def build_overview_table(data: Dict) -> str:
    """Build the AkShare data overview markdown table."""
    m = data["metrics"]
    bank_name = data["bank_name"]
    fetch_time = data.get("fetch_time", "")
    
    rows = []
    rows.append(f"> **AkShare 数据总览** | 采集时间: {fetch_time} | 报告期: {data.get('report_period', '2025A')} | 数据源: AkShare（新浪财经+东方财富）")
    rows.append(">")
    rows.append("> 以下数据均来自 AkShare 接口自动采集，未经过手工修正。`—` 表示该字段未获取到或 AkShare 不提供。NIM、不良率、拨备覆盖率、CET1 等监管指标需从年报附注获取。")
    rows.append("")
    rows.append("| 模块 | 指标 | 2025A | 上年同期 | 同比增速 | 数据来源 |")
    rows.append("| --- | --- | ---: | ---: | ---: | --- |")
    
    # 盈利模块
    rows.append(f"| **盈利能力** | 营业收入 | {get_val(m, '营业收入')} | {get_val(m, '营业收入_上年')} | {get_val(m, '营业收入增速')} | AkShare-利润表 |")
    rows.append(f"| 盈利能力 | 净利息收入 | {get_val(m, '净利息收入')} | {get_val(m, '净利息收入_上年')} | {get_val(m, '净利息收入增速')} | AkShare-利润表 |")
    rows.append(f"| 盈利能力 | 手续费及佣金净收入 | {get_val(m, '手续费及佣金净收入')} | {get_val(m, '手续费及佣金净收入_上年')} | {get_val(m, '中收增速')} | AkShare-利润表 |")
    rows.append(f"| 盈利能力 | 投资收益 | {get_val(m, '投资收益')} | — | — | AkShare-利润表 |")
    rows.append(f"| 盈利能力 | 非息收入 | {get_val(m, '非息收入')} | — | — | 计算: 营收-净利息收入 |")
    rows.append(f"| 盈利能力 | 归母净利润 | {get_val(m, '归母净利润')} | {get_val(m, '归母净利润_上年')} | {get_val(m, '归母净利润增速')} | AkShare-利润表 |")
    rows.append(f"| 盈利能力 | PPOP(拨备前利润) | {get_val(m, 'PPOP')} | — | {get_val(m, 'PPOP增速')} | 计算: 营收-业务及管理费 |")
    rows.append(f"| 盈利能力 | 加权ROE | {get_val(m, '加权ROE')} | — | — | AkShare-财务分析指标 |")
    rows.append(f"| 盈利能力 | ROE(摊薄) | {get_val(m, 'ROE(摊薄)')} | — | — | AkShare-财务分析指标 |")
    rows.append(f"| 盈利能力 | ROA | {get_val(m, 'ROA')} | — | — | AkShare-财务分析指标 |")
    rows.append(f"| 盈利能力 | 成本收入比(CIR) | {get_val(m, '成本收入比(CIR)')} | — | — | 计算: 业务及管理费/营收 |")
    rows.append(f"| 盈利能力 | 非息收入占比 | {get_val(m, '非息收入占比')} | — | — | 计算 |")
    rows.append(f"| 盈利能力 | 中收占比 | {get_val(m, '中收占比')} | — | — | 计算 |")
    rows.append(f"| 盈利能力 | 信用减值损失 | {get_val(m, '信用减值损失')} | {get_val(m, '信用减值损失_上年')} | — | AkShare-利润表 |")
    rows.append(f"| 盈利能力 | 信用成本率 | {get_val(m, '信用成本率')} | — | — | 计算: 减值/平均贷款 |")
    
    # 资产负债模块
    rows.append(f"| **资产与负债** | 总资产 | {get_val(m, '总资产')} | {get_val(m, '总资产_上年')} | {get_val(m, '总资产增速')} | AkShare-资产负债表 |")
    rows.append(f"| 资产与负债 | 贷款总额 | {get_val(m, '贷款总额')} | {get_val(m, '贷款总额_上年')} | {get_val(m, '贷款增速')} | AkShare-资产负债表 |")
    rows.append(f"| 资产与负债 | 贷款/总资产 | {get_val(m, '贷款/总资产')} | — | — | 计算 |")
    rows.append(f"| 资产与负债 | 贷款损失准备 | {get_val(m, '贷款损失准备')} | {get_val(m, '贷款损失准备_上年')} | — | AkShare-资产负债表 |")
    rows.append(f"| 资产与负债 | 拨贷比 | {get_val(m, '拨贷比')} | — | — | 计算: 损失准备/贷款 |")
    rows.append(f"| 资产与负债 | 客户存款 | {get_val(m, '客户存款')} | {get_val(m, '客户存款_上年')} | {get_val(m, '存款增速')} | AkShare-资产负债表 |")
    rows.append(f"| 资产与负债 | 存贷比 | {get_val(m, '存贷比')} | — | — | 计算 |")
    rows.append(f"| 资产与负债 | 同业负债 | {get_val(m, '同业负债')} | — | — | AkShare-资产负债表 |")
    rows.append(f"| 资产与负债 | 同业负债占比(粗略) | {get_val(m, '同业负债占比(粗略)')} | — | — | 计算(不含NCD) |")
    rows.append(f"| 资产与负债 | 应付债券 | {get_val(m, '应付债券')} | — | — | AkShare-资产负债表 |")
    rows.append(f"| 资产与负债 | 负债合计 | {get_val(m, '负债合计')} | — | — | AkShare-资产负债表 |")
    rows.append(f"| 资产与负债 | 资产负债率 | {get_val(m, '资产负债率')} | — | — | 计算 |")
    rows.append(f"| 资产与负债 | 归母净资产 | {get_val(m, '归母净资产')} | {get_val(m, '归母净资产_上年')} | {get_val(m, '净资产增速')} | AkShare-资产负债表 |")
    rows.append(f"| 资产与负债 | 杠杆倍数 | {get_val(m, '杠杆倍数')} | — | — | 计算: 总资产/归母净资产 |")
    rows.append(f"| 资产与负债 | 股本 | {get_val(m, '股本')} | — | — | AkShare-资产负债表 |")
    
    # 每股指标
    rows.append(f"| **每股指标** | EPS | {get_val(m, 'EPS')} | — | — | AkShare-财务分析指标 |")
    rows.append(f"| 每股指标 | 每股净资产 | {get_val(m, '每股净资产')} | — | — | AkShare-财务分析指标 |")
    rows.append(f"| 每股指标 | 股息发放率 | {get_val(m, '股息发放率')} | — | — | AkShare-财务分析指标 |")
    rows.append(f"| 每股指标 | 内生增长率(机械计算) | {get_val(m, '内生增长率(机械计算)')} | — | — | 计算: ROE×(1-分红率) |")
    
    # 估值
    val_date = m.get("收盘价", {}).get("date", "")
    rows.append(f"| **估值** | 收盘价 | {get_val(m, '收盘价')} | — | — | AkShare-东方财富({val_date}) |")
    rows.append(f"| 估值 | 总市值 | {get_val(m, '总市值')} | — | — | AkShare-东方财富 |")
    rows.append(f"| 估值 | PB | {get_val(m, 'PB')} | — | — | AkShare-东方财富 |")
    rows.append(f"| 估值 | PE(TTM) | {get_val(m, 'PE(TTM)')} | — | — | AkShare-东方财富 |")
    rows.append(f"| 估值 | PE(静) | {get_val(m, 'PE(静)')} | — | — | AkShare-东方财富 |")
    
    # 不可获取指标
    rows.append("")
    rows.append("> **以下指标 AkShare 无法获取，需从年报附注补入：**")
    na_list = data.get("not_available_from_akshare", [])
    if na_list:
        # Group them
        rows.append(f"> NIM、净利差、不良率、关注类比例、逾期90天以上比例、拨备覆盖率、CET1、一级资本充足率、CAR、杠杆率(监管口径)、RWA增速、LCR、NSFR、流动性比例、核心负债依存度、活期存款占比、零售存款占比、零售贷款占比、存款成本率、生息资产收益率、计息负债成本率、金融投资三分类占比")
    
    return "\n".join(rows)


def build_evaluation_section(data: Dict) -> str:
    """Build the four-dimensional evaluation section."""
    evals = data.get("evaluations", {})
    bank_name = data["bank_name"]
    
    lines = []
    lines.append(f"## AkShare 数据评价（基于自动采集数据）")
    lines.append("")
    lines.append(f"> 以下评价完全基于 AkShare 接口获取的结构化数据自动生成，不包含主观推测。NIM、不良率、拨备覆盖率、CET1 等核心监管指标因 AkShare 无法获取，评价中已标注缺口。")
    lines.append("")
    
    for title, key in [
        ("盈利能力评价", "盈利能力评价"),
        ("资产质量评价", "资产质量评价"),
        ("资产风险评价", "资产风险评价"),
        ("可持续性评价", "可持续性评价"),
    ]:
        content = evals.get(key, "数据不足，无法评价。")
        lines.append(f"### {title}")
        lines.append("")
        lines.append(content)
        lines.append("")
    
    return "\n".join(lines)


def update_doc(bank_name: str, code: str, data: Dict) -> bool:
    """Update a single bank's deep research markdown doc.
    
    Strategy: Insert AkShare data overview table and evaluation section
    after the first major section (## 1. ...), before the next section.
    Also update the frontmatter 'updated' date.
    """
    doc_path = BANK_DIR / f"{bank_name} 深度研究.md"
    
    if not doc_path.exists():
        print(f"  ⚠ 文档不存在: {doc_path}")
        return False
    
    content = doc_path.read_text(encoding="utf-8")
    
    # Check if already has AkShare overview - remove old version including trailing ---
    if "AkShare 数据总览" in content:
        print(f"  ℹ 已包含AkShare数据总览，将更新...")
        # Remove old section including any trailing --- separator
        content = re.sub(
            r'\n## AkShare 数据总览.*?(?:\n---)?(?=\n## |\Z)',
            '',
            content,
            flags=re.DOTALL
        )
    
    if "AkShare 数据评价" in content:
        # Remove old evaluation section
        content = re.sub(
            r'\n## AkShare 数据评价（基于自动采集数据）.*?(?=\n## |\Z)',
            '',
            content,
            flags=re.DOTALL
        )
    
    # Update frontmatter 'updated' date
    content = re.sub(
        r'^updated: \d{4}-\d{2}-\d{2}',
        'updated: 2026-08-16',
        content,
        flags=re.MULTILINE
    )
    
    # Build new sections
    overview_table = build_overview_table(data)
    evaluation_section = build_evaluation_section(data)
    
    # Find the insertion point: after the first ## section
    # Strategy: find "## 2." or the first "## " after "## 1."
    # Insert overview table right before "## 2." 
    # Insert evaluation section right before "## 19." or at the end
    
    # Insert overview table as a new section before "## 2."
    # This adds AkShare-sourced data as a supplement to the existing manually verified table
    section2_match = re.search(r'\n## 2\.', content)
    if section2_match:
        insert_pos = section2_match.start()
        new_content = content[:insert_pos] + "\n## AkShare 数据总览\n\n" + overview_table + "\n\n---\n" + content[insert_pos:]
        content = new_content
    else:
        # Fallback: insert after the first ## section
        first_section = re.search(r'\n## 1\.', content)
        if first_section:
            # Find next ## after section 1
            next_section = re.search(r'\n## ', content[first_section.end():])
            if next_section:
                insert_pos = first_section.end() + next_section.start()
                content = content[:insert_pos] + "\n\n## AkShare 数据总览\n\n" + overview_table + "\n\n---\n" + content[insert_pos:]
    
    # Now insert evaluation section before "## 19." or "## 18." or at end
    eval_section = "\n" + evaluation_section + "\n"
    
    # Try to find a suitable insertion point near the end
    for marker in ["## 19. 待验证事项", "## 19.", "## 18. 季度验证", "## 18.", "## 17. 催化剂", "## 17."]:
        match = re.search(re.escape(marker), content)
        if match:
            content = content[:match.start()] + eval_section + content[match.start():]
            break
    else:
        # Append at end
        content = content.rstrip() + "\n" + eval_section
    
    # Clean up any triple+ newlines
    content = re.sub(r'\n{4,}', '\n\n\n', content)
    
    doc_path.write_text(content, encoding="utf-8")
    return True


def evaluation_table_separator() -> str:
    return ""


def main():
    print("=== 更新深度研究文档 ===\n")
    
    success_count = 0
    for bank in DEEP_BANKS:
        code = bank["code"]
        name = bank["name"]
        
        json_file = JSON_DIR / f"{code}_{name}_deep_metrics.json"
        if not json_file.exists():
            print(f"  ⚠ JSON文件不存在: {json_file}")
            continue
        
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        print(f"[{name}] 更新中...")
        if update_doc(name, code, data):
            print(f"  ✓ 完成")
            success_count += 1
        else:
            print(f"  ✗ 失败")
    
    print(f"\n=== 完成: {success_count}/{len(DEEP_BANKS)} 文档已更新 ===")


if __name__ == "__main__":
    main()
