"""Download annual report PDFs for footnotes absent from AKShare statements."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "pdf"
COMPANIES = {"600276": "恒瑞医药", "300760": "迈瑞医疗", "603259": "药明康德", "300015": "爱尔眼科"}


def download(code, name):
    path = OUT / f"{code}_2025.pdf"
    meta_path = path.with_suffix(".json")
    if path.exists() and meta_path.exists() and json.loads(meta_path.read_text())["title"].endswith("2025年年度报告"):
        return {"code": code, "cached": True}
    response = requests.get("https://np-anotice-stock.eastmoney.com/api/security/ann", params={"sr": "-1", "page_size": 100, "page_index": 1, "ann_type": "A", "client_source": "web", "stock_list": code, "f_node": "0", "s_node": "0", "begin_time": "2026-03-01", "end_time": "2026-04-30"}, timeout=20)
    response.raise_for_status()
    items = response.json()["data"]["list"]
    candidates = [item for item in items if item["title"].endswith("2025年年度报告")]
    if not candidates:
        raise ValueError(f"No annual PDF found for {name}")
    item = candidates[0]
    url = "https://pdf.dfcfw.com/pdf/H2_" + item["art_code"] + "_1.pdf"
    response = requests.get(url, timeout=45)
    response.raise_for_status()
    if not response.content.startswith(b"%PDF"):
        raise ValueError("Not a PDF response")
    path.write_bytes(response.content)
    meta = {"code": code, "name": name, "title": item["title"], "date": item["notice_date"][:10], "url": url, "file": f"../data/pdf/{path.name}", "retrieved": datetime.now(timezone.utc).isoformat(), "priority": "AKShare附注缺项后查PDF"}
    path.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    return meta


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = [pool.submit(download, code, name) for code, name in COMPANIES.items()]
        for job in as_completed(jobs):
            try:
                print(json.dumps(job.result(), ensure_ascii=False), flush=True)
            except Exception as error:
                print(type(error).__name__, str(error), flush=True)
