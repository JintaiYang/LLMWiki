"""Reprice the existing financial snapshot and refresh every company label."""
from copy import deepcopy
from datetime import datetime, timezone
import json

import liquor_pipeline as pipeline


def refresh():
    path = pipeline.OUT / "data.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    changes = []
    for company in payload["companies"]:
        old = deepcopy(company["dcf"])
        old_style = deepcopy(company.get("style"))
        annual = company["annual"]
        records = {r["report_date"]: r for r in annual if r.get("report_date")}
        company["dcf"] = pipeline.dcf(records, annual, company.get("price"), (company.get("shares") or {}).get("shares"))
        changes.append({"code": company["code"], "name": company["name"],
                        "old_method": old.get("base_method"), "new_method": company["dcf"]["base_method"],
                        "old_base_CNY": old.get("base_cash_flow_CNY"), "new_base_CNY": company["dcf"]["base_cash_flow_CNY"],
                        "old_baseline": next((s["value_per_share"] for s in old.get("scenarios", []) if s["name"] == "基准"), None),
                        "new_baseline": next((s["value_per_share"] for s in company["dcf"]["scenarios"] if s["name"] == "基准"), None),
                        "old_style": old_style})
    classification = pipeline.stamp_company_styles(payload["companies"])
    stamp = datetime.now(timezone.utc).isoformat()
    payload["generated_at"] = stamp
    payload["valuation_updated_at"] = stamp
    payload["model"]["dcf"] = pipeline.PARAMETERS["dcf"]
    payload["model"]["style"] = classification["rules"]
    payload["classification"] = {**classification, "generated_at": stamp}
    for change, company in zip(changes, payload["companies"]):
        change["new_style"] = company["style"]
    pipeline.dump(path, payload)
    for company in payload["companies"]:
        pipeline.dump(pipeline.OUT / "stock_data" / (company["code"] + ".json"), company)
    report = {"generated_at": stamp, "financial_as_of": payload["as_of"], "classification": classification, "changes": changes}
    pipeline.dump(pipeline.ROOT / "04_运维报告" / "dcf_latest_annual_refresh.json", report)
    print(json.dumps({"companies": len(changes), "classification": classification}, ensure_ascii=False))


if __name__ == "__main__":
    refresh()
