#!/usr/bin/env python3
"""Vault structure and markdown governance validator."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

RE_WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

REQUIRED_DIRS = [
    "01_收件箱",
    "02_原始资料",
    "02_原始资料/04_AkShare数据",
    "03_模板",
    "04_运维报告",
    "05_知识库",
]

REQUIRED_FILES = [
    "06_维护契约.md",
    "06A_银行业数据口径规范.md",
]

REQUIRED_TEMPLATES = [
    "银行基础档案模板.md",
    "重点银行深度研究模板.md",
    "投资命题模板.md",
    "财报更新模板.md",
    "季度复盘模板.md",
    "通用知识页面模板.md",
    "来源笔记模板.md",
]

REQUIRED_FM_FIELDS = [
    "title",
    "note_type",
    "status",
    "created",
    "updated",
    "data_cutoff",
    "evidence_level",
    "evidence_class",
    "source_priority",
    "sources",
    "tags",
]

ALLOWED_STATUS = {"draft", "active", "reviewed", "archived"}
ALLOWED_EVIDENCE_LEVEL = {"high", "medium", "low", "mixed"}
ALLOWED_EVIDENCE_CLASS = {
    "official_fact",
    "third_party_data",
    "external_expectation",
    "research_inference",
    "valuation_assumption",
    "unknown_pending",
    "internal_governance",
    "mixed",
}
ALLOWED_SOURCE_PRIORITY = {
    "regulator",
    "company_filing",
    "third_party_structured",
    "market_expectation",
    "research_inference",
    "internal_governance",
    "mixed",
}

MIXED_NOTE_TYPE_ALLOWLIST = {
    "deep_research",
    "earnings_update",
    "quarterly_review",
    "knowledge_page",
    "navigation",
    "index",
    "dashboard",
    "tracker",
    "risk_page",
    "verification_log",
    "judgment_log",
    "research_memo",
    "operation_log",
    "operation_report",
    "source_index",
    "source_note",
    "thesis",
    "valuation",
    "expectation",
    "investment_thesis",
    "valuation_page",
    "expectation_page",
    "bank_profile",
}

EXPECTED_BANK_COUNT = 42
EXPECTED_CAPABILITY_STATUS = {
    "bank_universe": "implemented",
    "spot_and_market_cap": "implemented_with_fallback",
    "earnings_report": "implemented",
    "financial_abstract": "implemented",
    "historical_valuation": "implemented_with_fallback",
    "dividend": "implemented",
    "a_h_comparison": "deferred_to_later_task",
    "historical_market_data": "deferred_to_later_task",
}
DATA_BASE = "02_原始资料/04_AkShare数据"
META_BASE = f"{DATA_BASE}/数据字典与运行记录"
DATA_ARTIFACTS = {
    "yjbb": f"{DATA_BASE}/财务报表/bank_yjbb_em_latest.csv",
    "abstract": f"{DATA_BASE}/财务摘要/bank_financial_abstract_all_latest.csv",
    "valuation": f"{DATA_BASE}/历史估值/bank_valuation_history_all_latest.csv",
    "dividend": f"{DATA_BASE}/分红/bank_dividend_em_latest.csv",
}

FOCUS_18 = {
    "工商银行",
    "建设银行",
    "农业银行",
    "中国银行",
    "邮储银行",
    "交通银行",
    "招商银行",
    "兴业银行",
    "平安银行",
    "中信银行",
    "浦发银行",
    "民生银行",
    "宁波银行",
    "江苏银行",
    "成都银行",
    "杭州银行",
    "南京银行",
    "常熟银行",
}

SCOPE_PREFIXES = (
    "02_原始资料",
    "03_模板",
    "04_运维报告",
    "05_知识库",
)

ROOT_SCOPE_FILES = {
    "06_维护契约.md",
    "06A_银行业数据口径规范.md",
    "07_导航首页.md",
    "08_索引.md",
    "09_操作日志.md",
}

PLACEHOLDER_LINK_PATTERNS = (
    "来源页",
    "相关页",
    "页面名",
    "待补",
    "示例",
    "财报更新页",
)


@dataclass
class ValidationIssue:
    code: str
    path: str
    message: str

    def to_dict(self) -> Dict[str, str]:
        return {"code": self.code, "path": self.path, "message": self.message}


def parse_frontmatter(md_text: str) -> Tuple[Optional[Dict[str, object]], str]:
    if not md_text.startswith("---\n"):
        return None, md_text

    lines = md_text.splitlines()
    end_index = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end_index = idx
            break

    if end_index is None:
        return None, md_text

    fm_lines = lines[1:end_index]
    body = "\n".join(lines[end_index + 1 :])
    fm: Dict[str, object] = {}
    key_in_list: Optional[str] = None

    for raw in fm_lines:
        line = raw.rstrip()
        if not line:
            continue

        if line.startswith("  - ") and key_in_list:
            fm.setdefault(key_in_list, [])
            assert isinstance(fm[key_in_list], list)
            fm[key_in_list].append(line[4:].strip().strip('"').strip("'"))
            continue

        if line.startswith("- ") and key_in_list:
            fm.setdefault(key_in_list, [])
            assert isinstance(fm[key_in_list], list)
            fm[key_in_list].append(line[2:].strip().strip('"').strip("'"))
            continue

        if ":" not in line:
            key_in_list = None
            continue

        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()

        if not value:
            fm[key] = []
            key_in_list = key
            continue

        key_in_list = None
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            fm[key] = [item.strip().strip('"').strip("'") for item in inner.split(",") if item.strip()]
        else:
            fm[key] = value.strip('"').strip("'")

    return fm, body


def should_validate_markdown(rel_path: str) -> bool:
    if rel_path.startswith("docs/superpowers/"):
        return False
    if rel_path.startswith("tests/"):
        return False
    if rel_path.startswith("scripts/"):
        return False
    if rel_path == "README.md":
        return False

    if rel_path in ROOT_SCOPE_FILES:
        return True
    return rel_path.startswith(SCOPE_PREFIXES)


def gather_markdown_files(vault: Path) -> List[Path]:
    files: List[Path] = []
    for md in vault.rglob("*.md"):
        rel = md.relative_to(vault).as_posix()
        if should_validate_markdown(rel):
            files.append(md)
    return sorted(files)


def page_identifiers(md_files: Iterable[Path], vault: Path) -> Tuple[Set[str], Set[str], Dict[str, int]]:
    full_set: Set[str] = set()
    basename_set: Set[str] = set()
    basename_count: Dict[str, int] = {}

    for path in md_files:
        rel_no_ext = path.relative_to(vault).as_posix()[:-3]
        basename = path.stem
        full_set.add(rel_no_ext)
        basename_set.add(basename)
        basename_count[basename] = basename_count.get(basename, 0) + 1

    return full_set, basename_set, basename_count


def is_placeholder_link(target: str) -> bool:
    stripped = target.strip()
    if not stripped:
        return True
    if any(token in stripped for token in ("<", ">", "{", "}")):
        return True
    return any(pattern in stripped for pattern in PLACEHOLDER_LINK_PATTERNS)


def is_source_link_malformed(target: str) -> bool:
    return target.startswith("来源/") or target.startswith("[[来源/")


def link_exists(target: str, full_set: Set[str], basename_set: Set[str], vault: Path) -> bool:
    normalized = target.strip().strip("/")
    if not normalized:
        return True

    normalized_no_ext = normalized[:-3] if normalized.endswith(".md") else normalized

    if normalized_no_ext in full_set:
        return True

    if normalized_no_ext in basename_set:
        return True

    candidate_paths = [vault / normalized, vault / f"{normalized_no_ext}.md"]
    return any(path.exists() for path in candidate_paths)


def parse_status(frontmatter: Dict[str, object]) -> str:
    status = frontmatter.get("status")
    return status if isinstance(status, str) else ""


def validate_frontmatter(
    rel_path: str,
    frontmatter: Optional[Dict[str, object]],
    issues: List[ValidationIssue],
) -> None:
    if frontmatter is None:
        issues.append(ValidationIssue("MISSING_FRONTMATTER", rel_path, "缺少 YAML frontmatter"))
        return

    for field in REQUIRED_FM_FIELDS:
        if field not in frontmatter:
            issues.append(ValidationIssue("MISSING_FIELD", rel_path, f"frontmatter 缺少字段: {field}"))

    status = frontmatter.get("status")
    if status is not None and status not in ALLOWED_STATUS:
        issues.append(ValidationIssue("INVALID_STATUS", rel_path, f"status 非法: {status}"))

    for key in ("created", "updated", "data_cutoff"):
        value = frontmatter.get(key)
        if isinstance(value, str) and not RE_DATE.match(value):
            issues.append(ValidationIssue("INVALID_DATE", rel_path, f"{key} 日期格式应为 YYYY-MM-DD"))

    evidence_level = frontmatter.get("evidence_level")
    if evidence_level is not None and evidence_level not in ALLOWED_EVIDENCE_LEVEL:
        issues.append(ValidationIssue("INVALID_ENUM", rel_path, f"evidence_level 非法: {evidence_level}"))

    evidence_class = frontmatter.get("evidence_class")
    if evidence_class is not None and evidence_class not in ALLOWED_EVIDENCE_CLASS:
        issues.append(ValidationIssue("INVALID_ENUM", rel_path, f"evidence_class 非法: {evidence_class}"))

    source_priority = frontmatter.get("source_priority")
    if source_priority is not None and source_priority not in ALLOWED_SOURCE_PRIORITY:
        issues.append(ValidationIssue("INVALID_ENUM", rel_path, f"source_priority 非法: {source_priority}"))

    note_type = frontmatter.get("note_type")
    note_type_str = note_type if isinstance(note_type, str) else ""
    allows_mixed = note_type_str.startswith("template_") or note_type_str in MIXED_NOTE_TYPE_ALLOWLIST

    if evidence_class == "mixed" and not allows_mixed:
        issues.append(
            ValidationIssue("MIXED_NOT_ALLOWED", rel_path, "evidence_class=mixed 仅允许模板或复合页类型")
        )

    if source_priority == "mixed" and not allows_mixed:
        issues.append(
            ValidationIssue("MIXED_NOT_ALLOWED", rel_path, "source_priority=mixed 仅允许模板或复合页类型")
        )


def validate_required_structure(vault: Path, issues: List[ValidationIssue]) -> None:
    for directory in REQUIRED_DIRS:
        if not (vault / directory).is_dir():
            issues.append(ValidationIssue("MISSING_REQUIRED_DIR", directory, "必需目录缺失"))

    for file_name in REQUIRED_FILES:
        if not (vault / file_name).is_file():
            issues.append(ValidationIssue("MISSING_REQUIRED_FILE", file_name, "必需治理文件缺失"))

    for template_name in REQUIRED_TEMPLATES:
        template_path = vault / "03_模板" / template_name
        if not template_path.is_file():
            issues.append(ValidationIssue("MISSING_TEMPLATE", f"03_模板/{template_name}", "模板缺失"))


def validate_bank_universe(vault: Path, issues: List[ValidationIssue], stats: Dict[str, object]) -> None:
    universe_file = vault / "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.json"
    if not universe_file.exists():
        issues.append(
            ValidationIssue(
                "FOCUS_18_FILE_MISSING",
                universe_file.relative_to(vault).as_posix(),
                "缺少 A 股银行清单文件，无法校验 18 家重点银行覆盖",
            )
        )
        return

    try:
        payload = json.loads(universe_file.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        issues.append(
            ValidationIssue(
                "FOCUS_18_FILE_INVALID",
                universe_file.relative_to(vault).as_posix(),
                f"银行清单 JSON 解析失败: {exc}",
            )
        )
        return

    banks = payload.get("banks")
    if not isinstance(banks, list):
        issues.append(
            ValidationIssue(
                "FOCUS_18_FILE_INVALID",
                universe_file.relative_to(vault).as_posix(),
                "banks 字段必须为数组",
            )
        )
        return

    rel_path = universe_file.relative_to(vault).as_posix()
    stats["bank_universe_count"] = len(banks)
    if len(banks) != EXPECTED_BANK_COUNT:
        issues.append(
            ValidationIssue(
                "BANK_UNIVERSE_COUNT",
                rel_path,
                f"A 股银行清单必须恰好 {EXPECTED_BANK_COUNT} 家，实际 {len(banks)} 家",
            )
        )

    codes = [item.get("code") for item in banks if isinstance(item, dict)]
    names = [item.get("name") for item in banks if isinstance(item, dict)]
    if len(codes) != len(set(codes)):
        issues.append(ValidationIssue("BANK_UNIVERSE_DUPLICATE_CODE", rel_path, "银行代码存在重复"))
    if len(names) != len(set(names)):
        issues.append(ValidationIssue("BANK_UNIVERSE_DUPLICATE_NAME", rel_path, "银行名称存在重复"))

    invalid_rows = [
        index
        for index, item in enumerate(banks)
        if not isinstance(item, dict)
        or not isinstance(item.get("code"), str)
        or not re.fullmatch(r"\d{6}", item.get("code", ""))
        or not isinstance(item.get("name"), str)
        or not isinstance(item.get("focus18"), bool)
    ]
    if invalid_rows:
        issues.append(
            ValidationIssue(
                "BANK_UNIVERSE_SCHEMA",
                rel_path,
                f"银行行缺少合法 code/name/focus18，索引: {invalid_rows}",
            )
        )

    marked_focus = {
        item.get("name")
        for item in banks
        if isinstance(item, dict) and item.get("focus18") is True and isinstance(item.get("name"), str)
    }
    stats["focus_bank_count"] = len(marked_focus)
    if marked_focus != FOCUS_18:
        missing = sorted(FOCUS_18 - marked_focus)
        extra = sorted(marked_focus - FOCUS_18)
        issues.append(
            ValidationIssue(
                "FOCUS_18_MISMATCH",
                rel_path,
                f"focus18 标记必须精确匹配设计名单；缺失: {missing}；多余: {extra}",
            )
        )


def load_json_object(vault: Path, rel_path: str, issues: List[ValidationIssue]) -> Optional[Dict[str, object]]:
    path = vault / rel_path
    if not path.is_file():
        issues.append(ValidationIssue("DATA_META_MISSING", rel_path, "数据阶段元数据文件缺失"))
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeError) as exc:
        issues.append(ValidationIssue("DATA_META_INVALID", rel_path, f"JSON 解析失败: {exc}"))
        return None
    if not isinstance(payload, dict):
        issues.append(ValidationIssue("DATA_META_INVALID", rel_path, "JSON 顶层必须为对象"))
        return None
    return payload


def read_csv_bank_codes(
    vault: Path,
    rel_path: str,
    issues: List[ValidationIssue],
    *,
    required: bool,
) -> Optional[Set[str]]:
    path = vault / rel_path
    if not path.is_file():
        if required:
            issues.append(ValidationIssue("DATA_ARTIFACT_MISSING", rel_path, "数据阶段必需汇总产物缺失"))
        return None
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            code_col = next(
                (candidate for candidate in ("银行代码", "股票代码", "证券代码", "代码", "symbol") if candidate in (reader.fieldnames or [])),
                None,
            )
            if code_col is None:
                issues.append(ValidationIssue("DATA_ARTIFACT_SCHEMA", rel_path, "CSV 缺少银行代码列"))
                return set()
            return {
                re.sub(r"\D", "", row.get(code_col, ""))[-6:].zfill(6)
                for row in reader
                if re.sub(r"\D", "", row.get(code_col, ""))
            }
    except (OSError, UnicodeError, csv.Error) as exc:
        issues.append(ValidationIssue("DATA_ARTIFACT_INVALID", rel_path, f"CSV 读取失败: {exc}"))
        return set()


def validate_data_artifacts(vault: Path, issues: List[ValidationIssue], stats: Dict[str, object]) -> None:
    status_rel = f"{META_BASE}/run_meta_latest.json"
    success_rel = f"{META_BASE}/last_success_dates.json"
    status_index = load_json_object(vault, status_rel, issues)
    last_success = load_json_object(vault, success_rel, issues)
    if last_success is not None:
        invalid_dates = [key for key, value in last_success.items() if not isinstance(value, str) or not RE_DATE.match(value)]
        if invalid_dates:
            issues.append(ValidationIssue("LAST_SUCCESS_INVALID", success_rel, f"成功日期格式无效: {invalid_dates}"))

    for step, rel_path in DATA_ARTIFACTS.items():
        codes = read_csv_bank_codes(vault, rel_path, issues, required=True)
        count = len(codes) if codes is not None else 0
        stats[f"{step}_bank_count"] = count
        if step in {"yjbb", "abstract", "valuation"} and codes is not None and count != EXPECTED_BANK_COUNT:
            issues.append(
                ValidationIssue(
                    "DATA_ARTIFACT_COVERAGE",
                    rel_path,
                    f"{step} 汇总必须覆盖 {EXPECTED_BANK_COUNT} 家银行，实际 {count} 家",
                )
            )

    spot_rel = f"{DATA_BASE}/行情与市值/a_share_bank_spot_latest.csv"
    spot_codes = read_csv_bank_codes(vault, spot_rel, issues, required=False)
    stats["spot_bank_count"] = len(spot_codes) if spot_codes is not None else 0
    if status_index is None:
        return

    capabilities = status_index.get("capability_status")
    if not isinstance(capabilities, dict) or any(capabilities.get(key) != value for key, value in EXPECTED_CAPABILITY_STATUS.items()):
        issues.append(
            ValidationIssue(
                "CAPABILITY_STATUS_INVALID",
                status_rel,
                "capability_status 缺失或未完整标注已实现/延期能力",
            )
        )

    steps = status_index.get("steps")
    interfaces = status_index.get("interfaces")
    if not isinstance(steps, dict) or not isinstance(interfaces, dict):
        issues.append(ValidationIssue("DATA_META_SCHEMA", status_rel, "steps/interfaces 必须为对象"))
        return

    for group_name, group in (("steps", steps), ("interfaces", interfaces)):
        for item_name, item in group.items():
            if not isinstance(item, dict):
                issues.append(ValidationIssue("DATA_META_SCHEMA", status_rel, f"{group_name}.{item_name} 必须为对象"))
                continue
            for output_file in item.get("output_files", []):
                if isinstance(output_file, str) and not (vault / output_file).is_file():
                    issues.append(ValidationIssue("OUTPUT_FILE_MISSING", output_file, f"聚合状态 {group_name}.{item_name} 引用文件不存在"))

    if spot_codes is None:
        spot = steps.get("spot")
        if not isinstance(spot, dict) or spot.get("status") != "failed" or not spot.get("error"):
            issues.append(ValidationIssue("SPOT_STATUS_INVALID", status_rel, "无 spot CSV 时，聚合 spot 状态必须为 failed 且 error 非空"))
            return
        detail_files = [
            rel for rel in spot.get("output_files", [])
            if isinstance(rel, str) and Path(rel).name.startswith("spot_failure_details_")
        ]
        valid_detail = False
        for detail_rel in detail_files:
            detail = load_json_object(vault, detail_rel, issues)
            if detail is not None and isinstance(detail.get("failures"), list) and detail["failures"]:
                valid_detail = True
        if not valid_detail:
            issues.append(ValidationIssue("SPOT_FAILURE_DETAIL_MISSING", status_rel, "无 spot CSV 时必须引用存在且含失败记录的明细 JSON"))


def validate_links(
    rel_path: str,
    body: str,
    frontmatter: Optional[Dict[str, object]],
    full_set: Set[str],
    basename_set: Set[str],
    vault: Path,
    phase: str,
    issues: List[ValidationIssue],
    stats: Dict[str, object],
) -> None:
    links = [match.group(1).strip() for match in RE_WIKILINK.finditer(body)]
    stats["total_wikilinks"] += len(links)

    if not links:
        return

    status = ""
    if frontmatter:
        status = parse_status(frontmatter)

    skip_broken_link_check = status == "draft" or rel_path.startswith("03_模板/")
    future_final_links = {"07_导航首页", "08_索引", "09_操作日志"}

    for target in links:
        if is_source_link_malformed(target):
            issues.append(ValidationIssue("BAD_SOURCE_LINK", rel_path, f"来源链接格式错误: [[{target}]]"))
            continue

        if is_placeholder_link(target):
            continue

        if skip_broken_link_check:
            continue

        if phase != "final" and target in future_final_links:
            continue

        if not link_exists(target, full_set, basename_set, vault):
            issues.append(ValidationIssue("BROKEN_LINK", rel_path, f"断链: [[{target}]]"))


def validate_vault(vault: Path, phase: str = "final") -> Dict[str, object]:
    issues: List[ValidationIssue] = []
    warnings: List[ValidationIssue] = []
    stats: Dict[str, object] = {
        "markdown_files": 0,
        "frontmatter_ok": 0,
        "total_wikilinks": 0,
        "errors": 0,
    }

    validate_required_structure(vault, issues)

    md_files = gather_markdown_files(vault)
    full_set, basename_set, basename_count = page_identifiers(md_files, vault)

    stats["markdown_files"] = len(md_files)
    stats["duplicate_basename_count"] = sum(1 for _, count in basename_count.items() if count > 1)

    for md in md_files:
        rel_path = md.relative_to(vault).as_posix()
        text = md.read_text(encoding="utf-8")
        frontmatter, body = parse_frontmatter(text)

        before_errors = len(issues)
        validate_frontmatter(rel_path, frontmatter, issues)
        if len(issues) == before_errors and frontmatter is not None:
            stats["frontmatter_ok"] += 1

        validate_links(rel_path, body, frontmatter, full_set, basename_set, vault, phase, issues, stats)

    if phase in {"data", "final"}:
        validate_bank_universe(vault, issues, stats)
        validate_data_artifacts(vault, issues, stats)

    stats["errors"] = len(issues)

    return {
        "status": "ok" if not issues else "error",
        "vault": str(vault),
        "phase": phase,
        "stats": stats,
        "errors": [item.to_dict() for item in issues],
        "warnings": [item.to_dict() for item in warnings],
    }


def format_report(report: Dict[str, object]) -> str:
    lines: List[str] = []
    lines.append(f"Vault: {report['vault']}")
    lines.append(f"Status: {report['status']}")
    stats = report["stats"]
    lines.append(
        "Stats: markdown_files={markdown_files}, frontmatter_ok={frontmatter_ok}, "
        "total_wikilinks={total_wikilinks}, errors={errors}".format(**stats)
    )

    errors = report["errors"]
    if errors:
        lines.append("Errors:")
        for err in errors:
            lines.append(f"- [{err['code']}] {err['path']}: {err['message']}")
    else:
        lines.append("Errors: none")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate bank vault structure and markdown governance")
    parser.add_argument("--vault", default=".", help="Vault root path")
    parser.add_argument("--phase", choices=["foundation", "data", "final"], default="final", help="Validation phase")
    parser.add_argument("--json", action="store_true", help="Print report as JSON")

    args = parser.parse_args()
    vault = Path(args.vault).resolve()

    if not vault.exists() or not vault.is_dir():
        print(f"Vault path does not exist or is not a directory: {vault}", file=sys.stderr)
        return 2

    report = validate_vault(vault, phase=args.phase)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_report(report))

    return 0 if report["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
