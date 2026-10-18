"""Validate and version locally maintained financial explanations."""
from copy import deepcopy
from datetime import date, datetime
import json
import os
from pathlib import Path
import re
from threading import Lock
from zoneinfo import ZoneInfo

VAULT = Path(__file__).resolve().parents[1]
WORKSPACE = VAULT.parent
STORE_PATH = Path(os.environ.get("LIQUOR_KNOWLEDGE_FILE", VAULT / "dashboard" / "knowledge.json"))
LOCK = Lock()


class ConflictError(ValueError):
    pass


def read_store():
    return json.loads(STORE_PATH.read_text(encoding="utf-8"))


def validate_entry(entry, store):
    if not isinstance(entry, dict):
        raise ValueError("条目必须是对象")
    limits = {"id": 100, "company": 6, "kind": 20, "title": 200, "summary": 2000,
              "answer": 30000, "inference": 10000, "caveats": 10000, "status": 20}
    for key, limit in limits.items():
        if not isinstance(entry.get(key), str) or len(entry[key]) > limit:
            raise ValueError(f"字段 {key} 缺失或过长")
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", entry["id"]):
        raise ValueError("条目编号格式不合法")
    if any(not entry[k].strip() for k in ("title", "summary", "answer")):
        raise ValueError("标题、结论和正文不能为空")
    financial = json.loads((VAULT / "dashboard" / "data.json").read_text(encoding="utf-8"))
    companies = {c["code"] for c in financial["companies"]}
    metrics = set(financial["financial_metrics"]["metrics"])
    if entry["company"] and entry["company"] not in companies:
        raise ValueError("公司代码不存在")
    if entry["kind"] not in ("general", "report") or entry["status"] not in ("verified", "method", "pending"):
        raise ValueError("条目类型或核验状态不合法")
    for field in ("metrics", "periods", "reference_periods"):
        values = entry.get(field)
        if not isinstance(values, list) or len(values) > 100 or not all(isinstance(v, str) for v in values) or len(values) != len(set(values)):
            raise ValueError(f"{field} 必须是无重复的文本列表")
    if not entry["metrics"] or not set(entry["metrics"]) <= metrics:
        raise ValueError("至少选择一个有效财务指标")
    for period in entry["periods"] + entry["reference_periods"]:
        try:
            parsed = date.fromisoformat(period)
        except ValueError as error:
            raise ValueError("报告日期格式不正确") from error
        if parsed.isoformat() != period or period[5:] not in ("03-31", "06-30", "09-30", "12-31") or parsed > datetime.now(ZoneInfo("Asia/Shanghai")).date():
            raise ValueError("报告期必须是已结束的季度末或年末")
    if entry["kind"] == "report" and not entry["periods"]:
        raise ValueError("报告期解读必须指定适用报告期")
    if entry["kind"] == "general" and entry["periods"]:
        raise ValueError("通用口径不能绑定适用报告期")
    if set(entry["periods"]) & set(entry["reference_periods"]):
        raise ValueError("适用报告期和历史对照期应分别记录，不能重复")
    sources = entry.get("sources")
    if not isinstance(sources, list) or len(sources) > 30:
        raise ValueError("来源格式不合法")
    registered = {source["id"] for source in store["sources"]}
    seen = set()
    for source in sources:
        if not isinstance(source, dict) or source.get("source_id") not in registered or source.get("source_id") in seen or not isinstance(source.get("pages"), str) or len(source["pages"]) > 100:
            raise ValueError("来源未登记、重复或页码格式不正确")
        seen.add(source["source_id"])
    if entry["status"] == "verified" and not sources:
        raise ValueError("已核对原文的条目必须登记证据来源")
    return {key: deepcopy(entry[key]) for key in [*limits, "metrics", "periods", "reference_periods", "sources"]}


def save_entry(entry, expected_revision):
    with LOCK:
        store = read_store()
        if type(expected_revision) is not int or expected_revision != store["revision"]:
            raise ConflictError("知识库已被其他窗口更新，请重新加载后核对修改，避免覆盖新版本。")
        clean = validate_entry(entry, store)
        previous = next((e for e in store["entries"] if e["id"] == clean["id"]), None)
        now = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
        clean.update(created_at=previous["created_at"] if previous else now, updated_at=now,
                     version=previous["version"] + 1 if previous else 1,
                     history=deepcopy(previous["history"]) if previous else [])
        if previous:
            clean["history"].append({k: deepcopy(v) for k, v in previous.items() if k != "history"})
            store["entries"][store["entries"].index(previous)] = clean
        else:
            store["entries"].append(clean)
        store["revision"] += 1
        store["updated_at"] = now
        temporary = STORE_PATH.with_suffix(".json.tmp")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(store, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(STORE_PATH)
        return store


def source_path(source_id):
    source = next((s for s in read_store()["sources"] if s["id"] == source_id), None)
    if not source:
        raise FileNotFoundError("来源未登记")
    candidate = (WORKSPACE / source["path"]).resolve()
    if not candidate.is_relative_to(WORKSPACE.resolve()) or candidate.suffix.lower() != ".pdf" or not candidate.is_file():
        raise FileNotFoundError("来源文件不存在")
    return candidate
