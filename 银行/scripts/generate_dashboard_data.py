#!/usr/bin/env python3
"""Generate dashboard/data.json by extracting core metrics from the 18 key-coverage
bank pages (bank_profile + investment_thesis + deep_research existence check).

Usage:
    python3 scripts/generate_dashboard_data.py

Design reference: docs/superpowers/specs/2026-08-11-bank-dashboard-design.md
"""

from __future__ import annotations

import json
import re
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

VAULT_ROOT = Path(__file__).resolve().parent.parent
BANK_LIB = VAULT_ROOT / "05_知识库" / "03_银行库"
THESIS_LIB = VAULT_ROOT / "05_知识库" / "17_投资命题"
DASHBOARD_DIR = VAULT_ROOT / "dashboard"

PLACEHOLDER_VALUES = {"待验证", "待获取", "待评估", "待补入", "na", "n/a", "无", "-", "—", ""}

# 指标名 -> 匹配该指标所在表格行"指标"列的关键字模式（正则，忽略大小写，需整格精确/半精确匹配，
# 避免在自由格式段落或混合单元格中误抓无关数值）。
# 仅在下列两个受控区块内生效：
#   1) "### 2.3 核心财务摘要" 表格（03_银行库/<银行名>.md）
#   2) "## 3. 第三方结构化数据" 表格（同上，作为 PB/PE/股息率兜底来源）
CORE_SUMMARY_METRIC_PATTERNS: Dict[str, str] = {
    "revenue": r"^营业收入$",
    "net_profit": r"^归母净利润$",
    "eps": r"^每股收益$",
    "bvps": r"^每股净资产$",
    "roe": r"^ROE$",
    "total_assets": r"^总资产$",
    "net_assets": r"^归母净资产$",
    "nim": r"^NIM$",
    "npl_ratio": r"^不良率$",
    "provision_coverage": r"^拨备覆盖率$",
    "cet1": r"^核心一级资本充足率$",
}

THIRD_PARTY_METRIC_PATTERNS: Dict[str, str] = {
    "pb": r"^最新\s*PB$",
    "pe": r"^最新\s*PE$",
    "dividend_yield": r"^最新股息率$",
}

# 部分银行（如已深度更新的杭州银行）的基础档案页未使用 "2.3 核心财务摘要" 标准结构，
# 而是在 "2. 主体与关键事实" / "2. 官方事实" 表格中用单指标一行的方式呈现。
# 仅提取指标名单独成行（不含"/"合并多个指标）的行，避免拆分合并单元格猜测出错。
PROFILE_FACTS_METRIC_PATTERNS: Dict[str, str] = {
    "total_assets": r"^总资产$",
    "nim": r"^NIM$",
    "cet1": r"^CET1$",
    "npl_ratio": r"^不良率$",
    "provision_coverage": r"^拨备覆盖率$",
}

# 部分银行页面把多个指标合并写在同一行（形如
# "| 营业收入 / 归母净利润 | 387.99 / 190.29 亿元（2025A，+1.09% / +12.05%） |"）。
# 这里按 "/" 拆分标签与数值两侧，要求段数一致才提取，避免误拆自由文本。
# 指标名 -> (标签段完整匹配模式, 该指标在拆分后取第几段, 从该段提取的数值类型)
PROFILE_FACTS_COMBINED_PATTERNS: Dict[str, tuple] = {
    "revenue": (r"^营业收入$", "amount"),
    "net_profit": (r"^归母净利润$", "amount"),
    "npl_ratio": (r"^不良率$", "percent"),
    "provision_coverage": (r"^拨备覆盖率$", "percent"),
}

THESIS_STATUS_MAP = [
    (r"证伪|失效", "falsified"),
    (r"证实", "confirmed"),
    (r"加强", "strengthened"),
    (r"削弱", "weakened"),
    (r"开放", "open"),
]

TABLE_ROW_RE = re.compile(r"^\|(.+)\|\s*$")
FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def read_text(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        warnings.warn(f"读取失败 {path}: {exc}")
        return None


def parse_frontmatter(text: str) -> Dict[str, str]:
    """极简 frontmatter 解析，只取顶层简单 key: value 字段（不处理嵌套列表）。"""
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}
    fm: Dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line or line.startswith(" ") or line.startswith("-"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value:
            fm[key] = value
    return fm


def clean_value(raw: str) -> Optional[str]:
    value = raw.strip()
    # 去掉 wikilink/反引号等修饰
    value = re.sub(r"`", "", value)
    if value.lower() in PLACEHOLDER_VALUES:
        return None
    return value


def extract_section(text: str, heading_pattern: str) -> Optional[str]:
    """提取从匹配 heading_pattern 的标题行开始、到下一个同级或更高级标题为止的区块正文。

    heading_pattern 应匹配形如 '### 2.3 核心财务摘要' 或 '## 3. 第三方结构化数据' 的整行。
    """
    m = re.search(heading_pattern + r"\s*\n(.*?)(?=\n#{1,6}\s|\Z)", text, re.DOTALL)
    if not m:
        return None
    return m.group(1)


def extract_metrics_from_section(section_text: Optional[str], patterns: Dict[str, str]) -> Dict[str, Optional[str]]:
    """仅在给定区块文本内，逐行匹配 Markdown 表格行，按精确指标名模式提取数值列。

    每个指标名模式要求与单元格整体（去除首尾空白后）完全/半精确匹配，避免在
    自由格式段落或混合单元格中误抓无关数值。
    """
    result: Dict[str, Optional[str]] = {key: None for key in patterns}
    if not section_text:
        return result
    compiled = {key: re.compile(pattern, re.IGNORECASE) for key, pattern in patterns.items()}

    for line in section_text.splitlines():
        m = TABLE_ROW_RE.match(line)
        if not m:
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if len(cells) < 2:
            continue
        label, value_cell = cells[0], cells[1]
        if re.fullmatch(r"-+", label):
            continue
        for key, pattern in compiled.items():
            if result[key] is not None:
                continue
            if pattern.match(label):
                cleaned = clean_value(value_cell)
                if cleaned is not None:
                    result[key] = cleaned
    return result


PAREN_SUFFIX_RE = re.compile(r"[（(][^（）()]*[）)]\s*$")


def strip_trailing_paren(value: str) -> str:
    """去掉字符串末尾的一个括号备注段，如 '387.99 亿元（2025A，+1.09%）' -> '387.99 亿元'。"""
    return PAREN_SUFFIX_RE.sub("", value).strip()


def extract_number_as_amount(segment: str) -> Optional[str]:
    """从形如 '387.99' 的段落（外部已按 / 拆分、已去除单位后缀 '亿元'）中提取金额字符串，
    统一为与其他银行一致的 'XX亿' 格式。"""
    m = re.search(r"-?\d+(?:\.\d+)?", segment)
    if not m:
        return None
    return f"{m.group(0)}亿"


def extract_number_as_percent(segment: str) -> Optional[str]:
    """从形如 '0.76%' 的段落中提取百分比字符串，原样保留（含 %）。"""
    m = re.search(r"-?\d+(?:\.\d+)?%", segment)
    if m:
        return m.group(0)
    m = re.search(r"-?\d+(?:\.\d+)?", segment)
    if m:
        return f"{m.group(0)}%"
    return None


def extract_combined_metrics_from_section(
    section_text: Optional[str], patterns: Dict[str, tuple]
) -> Dict[str, Optional[str]]:
    """提取"多个指标合并写在同一个表格行"的情形，如：

        | 营业收入 / 归母净利润 | 387.99 / 190.29 亿元（2025A，+1.09% / +12.05%） | ... |
        | 不良率 / 拨备覆盖率 | 0.76% / 502.24%（2025A） | ... |

    做法：
    1. 标签列按 "/" 拆分为若干段，逐段 strip；
    2. 数值列先去掉末尾一个括号备注段，再按 "/" 拆分；
    3. 仅当标签段数与数值段数一致时才按位置对应提取，避免误拆自由文本；
    4. 每个标签段与 patterns 中的整格匹配模式比较，命中则从对应数值段按声明的数值类型提取。
    """
    result: Dict[str, Optional[str]] = {key: None for key in patterns}
    if not section_text:
        return result
    compiled = {key: (re.compile(pat, re.IGNORECASE), kind) for key, (pat, kind) in patterns.items()}

    for line in section_text.splitlines():
        m = TABLE_ROW_RE.match(line)
        if not m:
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if len(cells) < 2:
            continue
        label_cell, value_cell = cells[0], cells[1]
        if re.fullmatch(r"-+", label_cell):
            continue
        if "/" not in label_cell:
            continue

        label_parts = [p.strip() for p in label_cell.split("/")]
        value_cell_clean = strip_trailing_paren(value_cell)
        value_parts = [p.strip() for p in value_cell_clean.split("/")]
        if len(label_parts) != len(value_parts):
            continue

        for key, (pattern, kind) in compiled.items():
            if result[key] is not None:
                continue
            for idx, label_part in enumerate(label_parts):
                if pattern.match(label_part):
                    segment = value_parts[idx]
                    extracted = (
                        extract_number_as_amount(segment)
                        if kind == "amount"
                        else extract_number_as_percent(segment)
                    )
                    if extracted is not None:
                        result[key] = extracted
                    break
    return result


def extract_bank_type(profile_text: str, frontmatter: Dict[str, str]) -> Optional[str]:
    m = re.search(r"银行类型[：:\|]\s*([^\|\n、；;]+)", profile_text)
    if m:
        cleaned = clean_value(m.group(1))
        if cleaned:
            return cleaned
    return None


THESIS_STATUS_LINE_RE = re.compile(r"^-\s*(?:\*\*)?命题状态(?:\*\*)?[：:]\s*(.+)$", re.MULTILINE)


def extract_thesis_status(thesis_text: Optional[str]) -> str:
    """仅在明确的"命题状态："这一行内判断状态，不对全文做关键字扫描，
    避免命中"证伪条件"等标题词导致误判。"""
    if not thesis_text:
        return "unknown"
    m = THESIS_STATUS_LINE_RE.search(thesis_text)
    if not m:
        return "unknown"
    status_text = m.group(1)
    for pattern, code in THESIS_STATUS_MAP:
        if re.search(pattern, status_text):
            return code
    return "unknown"


def extract_thesis_summary(thesis_text: Optional[str]) -> Optional[str]:
    if not thesis_text:
        return None
    m = re.search(r"##\s*1\.\s*命题定义\s*\n(.*?)(?=\n##\s|\Z)", thesis_text, re.DOTALL)
    if not m:
        return None
    summary = m.group(1).strip()
    return summary if summary else None


def relative_path(path: Path) -> str:
    return str(path.relative_to(VAULT_ROOT))


def build_bank_record(deep_research_path: Path) -> Optional[Dict[str, object]]:
    bank_name = deep_research_path.stem.replace(" 深度研究", "")
    profile_path = BANK_LIB / f"{bank_name}.md"
    thesis_path = THESIS_LIB / f"{bank_name} 核心命题.md"

    profile_text = read_text(profile_path)
    if profile_text is None:
        warnings.warn(f"{bank_name}: 未找到基础档案页 {profile_path}，跳过")
        return None

    thesis_text = read_text(thesis_path)

    frontmatter = parse_frontmatter(profile_text)

    core_section = extract_section(profile_text, r"###\s*2\.3\s*核心财务摘要")
    third_party_section = extract_section(profile_text, r"##\s*3\.\s*第三方结构化数据")
    # 非标准结构页面（如已深度更新的杭州银行）使用 "2. 主体与关键事实" / "2. 官方事实" 表格
    profile_facts_section = extract_section(profile_text, r"##\s*2\.\s*(?:主体与关键事实|官方事实)[^\n]*")

    metrics = extract_metrics_from_section(core_section, CORE_SUMMARY_METRIC_PATTERNS)
    third_party_metrics = extract_metrics_from_section(third_party_section, THIRD_PARTY_METRIC_PATTERNS)
    for key, value in third_party_metrics.items():
        if value is not None:
            metrics[key] = value

    fallback_metrics = extract_metrics_from_section(profile_facts_section, PROFILE_FACTS_METRIC_PATTERNS)
    for key, value in fallback_metrics.items():
        if metrics.get(key) is None and value is not None:
            metrics[key] = value

    # 兜底：部分银行页面把指标合并写在同一行（如"营业收入 / 归母净利润"），
    # 仅在标准区块与单指标兜底区块都未取到值时，才尝试从合并单元格解析。
    combined_metrics = extract_combined_metrics_from_section(
        profile_facts_section, PROFILE_FACTS_COMBINED_PATTERNS
    )
    for key, value in combined_metrics.items():
        if metrics.get(key) is None and value is not None:
            metrics[key] = value

    bank_type = extract_bank_type(profile_text, frontmatter)

    record: Dict[str, object] = {
        "name": bank_name,
        "type": bank_type,
        **metrics,
        "thesis_status": extract_thesis_status(thesis_text),
        "thesis_summary": extract_thesis_summary(thesis_text),
        "updated": frontmatter.get("updated"),
        "links": {
            "profile": relative_path(profile_path) if profile_path.exists() else None,
            "deep_research": relative_path(deep_research_path),
            "thesis": relative_path(thesis_path) if thesis_path.exists() else None,
        },
    }
    return record


def main() -> int:
    if not BANK_LIB.exists():
        print(f"错误：找不到银行库目录 {BANK_LIB}", file=sys.stderr)
        return 1

    deep_research_files = sorted(BANK_LIB.glob("* 深度研究.md"))
    if not deep_research_files:
        print("错误：未找到任何 '* 深度研究.md' 文件，仪表盘数据为空", file=sys.stderr)
        return 1

    banks: List[Dict[str, object]] = []
    for path in deep_research_files:
        try:
            record = build_bank_record(path)
        except Exception as exc:  # noqa: BLE001
            warnings.warn(f"解析 {path.name} 时出错：{exc}")
            continue
        if record is not None:
            banks.append(record)

    banks.sort(key=lambda item: item["name"])

    output = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "vault_name": VAULT_ROOT.name,
        "bank_count": len(banks),
        "banks": banks,
    }

    DASHBOARD_DIR.mkdir(exist_ok=True)
    output_path = DASHBOARD_DIR / "data.json"
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"已生成 {output_path}，共 {len(banks)} 家银行。")
    missing_fields_summary(banks)
    return 0


def missing_fields_summary(banks: List[Dict[str, object]]) -> None:
    field_keys = list(CORE_SUMMARY_METRIC_PATTERNS.keys()) + list(THIRD_PARTY_METRIC_PATTERNS.keys())
    print("\n字段完整度（非空 / 总数）：")
    for key in field_keys:
        non_null = sum(1 for b in banks if b.get(key))
        print(f"  {key}: {non_null}/{len(banks)}")


if __name__ == "__main__":
    raise SystemExit(main())
