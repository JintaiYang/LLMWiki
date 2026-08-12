#!/usr/bin/env python3
"""Backfill 总资产 / 归母净资产 into the "2.3 核心财务摘要" table of each bank's
profile page (`05_知识库/03_银行库/<银行名>.md`), using locally cached AkShare
balance-sheet CSVs (`02_原始资料/04_AkShare数据/资产负债表/`).

范围与边界（重要）：
  - 仅回填 总资产 / 归母净资产 两个字段。这两个字段可以直接从东方财富银行专属
    资产负债表科目（TOTAL_ASSETS / TOTAL_PARENT_EQUITY）取得，口径明确、无需估算。
  - 不回填 NIM / 不良率 / 拨备覆盖率 / 核心一级资本充足率。这些是银行年报"经营
    情况讨论与分析"章节的监管专项披露指标，不在资产负债表/利润表科目范围内，
    AkShare 财务报表接口无法提供，必须由人工从正式年报/季报摘录，不得臆测或
    用报表科目拼凑替代。

数据来源（本地已采集文件，不联网）：
  02_原始资料/04_AkShare数据/资产负债表/<代码>_<名称>_balance_sheet.csv
    -> 取 REPORT_TYPE == "年报" 且 REPORT_DATE 最新的一行

写入规则（遵循 [[06_维护契约]] 证据等级与来源规则）：
  - 仅回填当前单元格为"待验证"占位符的行；已有真实数值的行不覆盖。
  - AkShare 数据默认 evidence_level = medium（而非年报直接支持的 high），
    因此回填时会把该行的证据等级列一并改为 medium，来源列改写为指向
    AkShare 快照来源（与"3. 第三方结构化数据"表格的来源标注方式一致），
    不假冒为年报正式核验的 high 等级事实。
  - 报告期列使用 AkShare 抓取到的实际报告期（如 2025A），与数值一同写入，
    避免报告期与数值不匹配。

Usage:
    python3 scripts/backfill_balance_sheet_metrics.py           # 预览（dry-run）
    python3 scripts/backfill_balance_sheet_metrics.py --apply   # 实际写入文件

Design reference: docs/superpowers/specs/2026-08-11-bank-dashboard-design.md
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import Dict, Optional

VAULT_ROOT = Path(__file__).resolve().parent.parent
DATA_BASE = VAULT_ROOT / "02_原始资料" / "04_AkShare数据"
BANK_LIB = VAULT_ROOT / "05_知识库" / "03_银行库"
UNIVERSE_CSV = DATA_BASE / "数据字典与运行记录" / "a_share_banks_universe.csv"
BALANCE_SHEET_DIR = DATA_BASE / "资产负债表"

PLACEHOLDER_VALUES = {"待验证", "待获取", "待评估", "待补入", "na", "n/a", "无", "-", "—", ""}


def load_all_banks() -> Dict[str, str]:
    """返回 {银行名: 代码}，覆盖全部 A 股银行（不限于 focus18）。"""
    banks = {}
    with UNIVERSE_CSV.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            banks[row["name"]] = row["code"]
    return banks


def find_balance_sheet_file(code: str, name: str) -> Optional[Path]:
    candidates = list(BALANCE_SHEET_DIR.glob(f"{code}_{name}_balance_sheet.csv"))
    return candidates[0] if candidates else None


def load_latest_annual_row(path: Path) -> Optional[Dict[str, str]]:
    """读取资产负债表 CSV，返回 REPORT_TYPE == 年报 且 REPORT_DATE 最新的一行。

    只用年报口径，避免和 profile 页面表头标注的 `2025A` 报告期含义不一致
    （若未来需要支持季度边际更新，应另起一节，不混入年度核心摘要表）。
    """
    latest_row = None
    latest_date = ""
    with path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("REPORT_TYPE") != "年报":
                continue
            date = row.get("REPORT_DATE", "")
            if date > latest_date:
                latest_date = date
                latest_row = row
    return latest_row


def format_yi(value_str: str) -> Optional[str]:
    """把金额（单位：元）转换为形如 '23628.06亿' 的字符串，与 profile 页面既有格式一致。"""
    try:
        value = float(value_str)
    except (TypeError, ValueError):
        return None
    yi = value / 1e8
    return f"{yi:,.2f}亿".replace(",", "")


def report_period_from_date(date_str: str) -> Optional[str]:
    """'2025-12-31 00:00:00' -> '2025A'（年报口径）。"""
    m = re.match(r"^(\d{4})-12-31", date_str)
    if not m:
        return None
    return f"{m.group(1)}A"


TABLE_ROW_RE = re.compile(r"^\|(.+)\|\s*,?\s*$")


def patch_core_summary_table(
    text: str,
    total_assets: Optional[str],
    net_assets: Optional[str],
    report_period: Optional[str],
    data_date: str,
    ak_source_link: str,
) -> tuple[str, list[str]]:
    """在 '### 2.3 核心财务摘要' 表格内，把"总资产"/"归母净资产"两行的
    "待验证"单元格替换为真实值，并同步更新报告期、证据等级与来源列。

    表格列结构：| 指标 | 数值 | 报告期 | 单位 | 信息类别 | 证据等级 | 来源 |

    返回 (更新后的全文, 变更说明列表)。
    """
    changes: list[str] = []
    lines = text.splitlines(keepends=True)

    in_section = False
    section_done = False
    out_lines = []

    field_map = {
        "总资产": total_assets,
        "归母净资产": net_assets,
    }

    for line in lines:
        stripped = line.rstrip("\n")

        if re.match(r"^###\s*2\.3\s*核心财务摘要", stripped):
            in_section = True
            out_lines.append(line)
            continue

        if in_section and re.match(r"^#{1,6}\s", stripped) and not re.match(r"^###\s*2\.3", stripped):
            in_section = False
            section_done = True

        if in_section and not section_done:
            m = TABLE_ROW_RE.match(stripped)
            if m:
                # 兼容部分行末尾多出一个逗号（已知历史格式瑕疵）
                trailing_comma = stripped.rstrip().endswith("|,")
                cells = [c.strip() for c in m.group(1).split("|")]
                if len(cells) >= 7 and cells[0] in field_map:
                    new_value = field_map[cells[0]]
                    old_value = cells[1]
                    if new_value is not None and old_value in PLACEHOLDER_VALUES:
                        cells[1] = new_value
                        if report_period:
                            cells[2] = report_period
                        cells[5] = "medium"
                        cells[6] = ak_source_link
                        new_line = "| " + " | ".join(cells) + " |" + (",\n" if trailing_comma else "\n")
                        changes.append(f"{cells[0]}: '{old_value}' -> '{new_value}'（报告期={report_period}, 证据等级=medium）")
                        out_lines.append(new_line)
                        continue
        out_lines.append(line)

    return "".join(out_lines), changes


def build_ak_source_link(name: str) -> str:
    """复用页面已有的 AkShare 基础快照来源链接命名规则。"""
    return f"[[05_知识库/10_来源/AkShare {name} 基础快照 2026-07-22]]"


OLD_TODO_LINE = (
    "- [ ] 总资产、归母净资产、NIM、不良率、拨备覆盖率、核心一级资本充足率等关键指标待从正式年报补入\n"
)
NEW_TODO_LINES = (
    "- [ ] 总资产、归母净资产已用 AkShare 资产负债表数据回填（medium），待与正式年报逐项核验后升级为 high\n"
    "- [ ] NIM、不良率、拨备覆盖率、核心一级资本充足率等监管指标不在财务报表科目范围内，AkShare 无法提供，仍待从正式年报补入\n"
)


def patch_pending_todo_line(text: str) -> tuple[str, bool]:
    """把已过时的"待从正式年报补入"待验证事项，替换为区分回填状态的两行。

    仅在总资产/归母净资产确实完成回填时才调用本函数，避免误改未变更银行的措辞。
    """
    if OLD_TODO_LINE not in text:
        return text, False
    return text.replace(OLD_TODO_LINE, NEW_TODO_LINES), True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="实际写入文件（默认仅预览 dry-run）")
    args = parser.parse_args()

    banks = load_all_banks()

    total_changed_banks = 0
    total_changes = 0
    skipped_no_profile = 0
    skipped_no_data = 0

    for name, code in sorted(banks.items()):
        profile_path = BANK_LIB / f"{name}.md"
        if not profile_path.exists():
            skipped_no_profile += 1
            continue

        bs_path = find_balance_sheet_file(code, name)
        latest_row = load_latest_annual_row(bs_path) if bs_path else None
        if not latest_row:
            skipped_no_data += 1
            print(f"[跳过] {name}: 未找到年报口径资产负债表数据")
            continue

        total_assets = format_yi(latest_row.get("总资产"))
        net_assets = format_yi(latest_row.get("归母净资产"))
        report_date = latest_row.get("REPORT_DATE", "")
        report_period = report_period_from_date(report_date)
        data_date = report_date.split(" ")[0] if report_date else ""

        text = profile_path.read_text(encoding="utf-8")
        new_text, changes = patch_core_summary_table(
            text,
            total_assets=total_assets,
            net_assets=net_assets,
            report_period=report_period,
            data_date=data_date,
            ak_source_link=build_ak_source_link(name),
        )

        todo_updated = False
        if changes:
            new_text, todo_updated = patch_pending_todo_line(new_text)

        if changes:
            total_changed_banks += 1
            total_changes += len(changes)
            print(f"\n[{name}] ({code}) 报告期={report_period}")
            for c in changes:
                print(f"  - {c}")
            if todo_updated:
                print("  - 待验证事项：已拆分为“已回填/仍待补入”两行")
            if args.apply:
                profile_path.write_text(new_text, encoding="utf-8")
        else:
            print(f"[{name}] 无需变更（无待验证占位符或未匹配到目标行）")

    print(
        f"\n{'已写入' if args.apply else '预览（未写入，加 --apply 执行）'}："
        f"{total_changed_banks} 家银行，共 {total_changes} 处字段变更。"
        f" 跳过（无基础档案页）：{skipped_no_profile}，跳过（无资产负债表数据）：{skipped_no_data}。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
