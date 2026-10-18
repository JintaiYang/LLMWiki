"""Reconcile industry metrics with raw statements and dated iFinD evidence."""
import csv
import io
import json
import math
import re
from pathlib import Path

import liquor_pipeline as pipeline

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "04_运维报告/白酒行业指标交叉核验_20261017.json"
FIELDS = {
    "revenue": "营业收入（单位：元）", "net_profit": "归属于母公司所有者的净利润（单位：元）",
    "cfo": "经营活动产生的现金流量净额（单位：元）", "inventory": "存货（单位：元）", "contract_liabilities": "合同负债（单位：元）",
}


def formatted_amount(text):
    match = re.fullmatch(r"(-?\d+(?:\.\d+)?)(亿|万)?", text.replace(",", ""))
    if not match:
        raise ValueError("Unrecognized iFinD amount: " + text)
    value, unit = match.groups()
    scale = {None: 1, "万": 1e4, "亿": 1e8}[unit]
    decimals = len(value.split(".")[1]) if "." in value else 0
    return float(value) * scale, .5 * 10 ** -decimals * scale + .02


def audit():
    data = json.loads((ROOT / "dashboard/data.json").read_text())
    industry = json.loads((ROOT / "dashboard/industry.json").read_text())
    companies = {company["code"]: company for company in data["companies"]}
    evidence = json.loads(EVIDENCE.read_text())
    mismatches, checks, tables = [], [], {}
    raw_count = 0
    for code, company in companies.items():
        statements = {kind: pipeline.report_rows(code, kind, data["as_of"]) for kind in pipeline.STATEMENTS}
        tables[code] = statements
        for row in company["annual"] + company["quarterly"]:
            for field in FIELDS:
                kind, columns = pipeline.FIELDS[field]
                raw = statements[kind].get(row["report_date"], {})
                expected = next((pipeline.number(raw.get(col)) for col in columns if pipeline.number(raw.get(col)) is not None), None)
                value = row.get(field)
                raw_count += 1
                if expected != value:
                    mismatches.append({"code": code, "period": row["report_date"], "field": field, "local": value, "raw": expected})
    for query in evidence["queries"]:
        lines = [line for line in query["answer"].splitlines() if line.startswith("|")]
        table = list(csv.reader(lines, delimiter="|"))
        headers = [cell.strip() for cell in table[0][1:-1]]
        for cells in table[2:]:
            row = dict(zip(headers, (cell.strip() for cell in cells[1:-1])))
            code = row["证券代码"].split(".")[0]
            day = row["日期"]
            day = f"{day[:4]}-{day[4:6]}-{day[6:8]}"
            company = companies[code]
            local = next((r for r in company["annual"] + company["quarterly"] if r["report_date"] == day), {})
            for field, label in FIELDS.items():
                expected, tolerance = formatted_amount(row[label])
                value = local.get(field)
                passed = value is not None and abs(value - expected) <= tolerance
                check = {"code": code, "name": company["name"], "period": day, "field": field,
                         "local_CNY": value, "ifind_reported": row[label], "tolerance_CNY": tolerance, "passed": passed}
                checks.append(check)
                if not passed:
                    mismatches.append(check)
    history = []
    for point in industry["financial_trends"]:
        for field in FIELDS:
            kind, columns = pipeline.FIELDS[field]
            values = []
            for code in companies:
                raw = tables[code][kind].get(point["report_date"], {})
                values.append(next((pipeline.number(raw.get(col)) for col in columns if pipeline.number(raw.get(col)) is not None), None))
            count = sum(value is not None for value in values)
            expected = sum(values) if count == len(companies) else None
            actual = point[field]
            passed = (actual is None and expected is None or actual is not None and expected is not None and math.isclose(actual, expected, abs_tol=.01)) and point["coverage"][field] == count
            check = {"period": point["report_date"], "field": field, "value_CNY": actual, "raw_sum_CNY": expected, "coverage": count, "passed": passed}
            history.append(check)
            if not passed:
                mismatches.append(check)
    aggregates = []
    for point in industry["financial_trends"]:
        if point["report_date"][:4] not in ("2024", "2025", "2026"):
            continue
        for field in FIELDS:
            rows = [next((r for r in c["annual"] + c["quarterly"] if r["report_date"] == point["report_date"]), {}) for c in companies.values()]
            if not any(rows):
                continue
            values = [r.get(field) for r in rows]
            expected = sum(values) if all(v is not None for v in values) else None
            actual = point[field]
            passed = actual is None and expected is None or actual is not None and expected is not None and math.isclose(actual, expected, abs_tol=.01)
            aggregates.append({"period": point["report_date"], "field": field, "value_CNY": actual, "passed": passed})
            if not passed:
                mismatches.append(aggregates[-1])
    return {"checked_at": "2026-10-17", "as_of": data["as_of"], "raw_checks": raw_count,
            "ifind_checks": len(checks), "aggregate_checks": len(aggregates), "historical_aggregate_checks": len(history), "mismatch_count": len(mismatches),
            "mismatches": mismatches, "ifind_results": checks, "aggregate_results": aggregates, "historical_aggregate_results": history,
            "limits": "iFinD对照按其格式化精度核验，不等于逐页审计年报；历史其他金额逐项与本地AKShare快照核对。"}


if __name__ == "__main__":
    report = audit()
    pipeline.dump(ROOT / "04_运维报告/白酒行业指标核验结果_20261017.json", report)
    print(json.dumps({key: report[key] for key in ("raw_checks", "ifind_checks", "aggregate_checks", "historical_aggregate_checks", "mismatch_count", "mismatches")}, ensure_ascii=False))
    raise SystemExit(bool(report["mismatch_count"]))
