"""Keep PDF page evidence for healthcare footnotes, without guessing missing values."""
import json
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parents[1]
TERMS = {"600276": ["研发投入", "资本化研发", "许可收入", "创新药销售"], "300760": ["研发投入", "资本化研发", "国际业务收入", "流水型"], "603259": ["在手订单", "持续经营业务", "资本开支"], "300015": ["门诊量", "手术量", "租赁负债", "商誉"]}


if __name__ == "__main__":
    for code, terms in TERMS.items():
        path = ROOT / "data" / "pdf" / f"{code}_2025.pdf"
        if not path.exists():
            continue
        doc = fitz.open(path)
        evidence, text_pages = [], []
        for index, page in enumerate(doc):
            text = page.get_text(sort=True)
            text_pages.append(f"\n--- PDF page {index + 1} ---\n{text}")
            for term in terms:
                cursor = 0
                while True:
                    at = text.find(term, cursor)
                    if at < 0:
                        break
                    evidence.append({"term": term, "pdf_page": index + 1, "excerpt": text[max(0, at - 180):at + 650]})
                    cursor = at + len(term)
        path.with_suffix(".txt").write_text("\n".join(text_pages), encoding="utf-8")
        path.with_name(f"{code}_2025_evidence.json").write_text(json.dumps({"code": code, "pdf_pages": len(doc), "evidence": evidence}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(code, len(doc), "pages", len(evidence), "evidence excerpts", flush=True)
