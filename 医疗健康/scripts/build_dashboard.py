"""Build an auditable dashboard snapshot from cached AKShare statements."""
import json
from datetime import datetime, timezone
from pathlib import Path
from score import DIMENSIONS, PROFILES, derive, finite, score

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "akshare"
OUT = ROOT / "dashboard"
FIELDS = {
    "income": {"revenue": "营业收入", "net_profit": "归属于母公司所有者的净利润", "consolidated_profit": "净利润", "cost": "营业成本", "rd_expense": "研发费用", "sales_expense": "销售费用", "operating_profit": "营业利润"},
    "balance": {"assets": "资产总计", "liabilities": "负债合计", "equity": "归属于母公司股东权益合计", "cash": "货币资金", "current_liabilities": "流动负债合计", "receivables": "应收账款", "inventory": "存货", "goodwill": "商誉", "development": "开发支出", "lease_liabilities": "租赁负债", "short_debt": "短期借款", "long_debt": "长期借款"},
    "cashflow": {"cfo": "经营活动产生的现金流量净额", "capex": "购建固定资产、无形资产和其他长期资产所支付的现金", "sales_cash": "销售商品、提供劳务收到的现金"},
    "abstract": {"adjusted_profit": "扣非净利润", "goodwill": "商誉"},
}


def build():
    companies = json.loads((ROOT / "data" / "companies.json").read_text())
    supplements_path = ROOT / "data" / "verified_supplements.json"
    supplements = json.loads(supplements_path.read_text())["records"] if supplements_path.exists() else []
    files, source_cells = [], 0
    for company in companies:
        periods, sources = {}, []
        for kind, fields in FIELDS.items():
            file = RAW / f"{company['code']}_{kind}.json"
            if not file.exists():
                continue
            payload = json.loads(file.read_text())
            files.append(str(file.relative_to(ROOT)))
            sources.append({"kind": kind, "provider": "AKShare", "upstream": "新浪财经", "function": payload["function"], "retrieved": payload["retrieved"], "file": f"../data/akshare/{file.name}", "rows": len(payload["rows"])})
            for raw in payload["rows"]:
                period = str(raw.get("报告日", ""))
                notice = str(raw.get("公告日期", ""))
                if len(period) != 8 or not "20201231" <= period <= "20260630" or notice > "20261018":
                    continue
                if kind != "abstract" and (raw.get("币种") != "CNY" or raw.get("类型") not in ("合并期末", "合并")):
                    continue
                row = periods.setdefault(period, {"period": period, "field_sources": {}})
                for key, column in fields.items():
                    value = raw.get(column)
                    if finite(row.get(key)):
                        continue
                    row[key] = value if finite(value) else None
                    if finite(value):
                        source_cells += 1
                        row["field_sources"][key] = {"provider": "AKShare", "kind": kind, "column": column}
                if notice:
                    row.setdefault("notice_dates", {})[kind] = notice
        for period, row in periods.items():
            previous = periods.get(str(int(period[:4]) - 1) + "1231")
            derive(row, previous)
        company["annual"] = [row for period, row in sorted(periods.items()) if period.endswith("1231")]
        company["interim"] = [row for period, row in sorted(periods.items()) if period.endswith("0630")]
        company["sources"] = sources
        company["supplements"] = [{**r, "provider": "PDF", "file": "../data/pdf/" + r["file"]} for r in supplements if r["code"] == company["code"]]
        company["score"] = score(company)
    research_file = ROOT / "data" / "research.json"
    research = json.loads(research_file.read_text()) if research_file.exists() else {"sources": [], "sectors": []}
    result = {
        "meta": {"version": "V1", "as_of": "2026-10-18", "generated": datetime.now(timezone.utc).isoformat(), "annual_year": 2025, "score_years": [2023, 2024, 2025], "latest_period": "20260630", "source_priority": ["AKShare", "财报PDF", "iFinD补缺"], "financial_source_cells": {"AKShare": source_cells, "PDF": len(supplements), "iFinD": 0}, "source_files": len(set(files)), "universe": "25家代表性A股公司；主动研究样本，不代表全行业或指数成分"},
        "model": {"dimensions": [{"key": k, "label": l, "weight": w} for k, l, w in DIMENSIONS], "profiles": PROFILES},
        "companies": companies, "research": research,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "data.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"companies": len(companies), "complete": sum(c["score"]["status"] == "complete" for c in companies), "sources": result["meta"]["financial_source_cells"], "missing": {c["name"]: [d["key"] for d in c["score"]["details"] if d["status"] == "missing"] for c in companies if c["score"]["status"] == "partial"}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    build()
