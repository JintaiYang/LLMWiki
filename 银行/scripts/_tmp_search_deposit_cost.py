#!/usr/bin/env python3
"""从招商银行2025年年报中搜索存款成本率相关内容"""
import pdfplumber

pdf_path = "/Users/yangjintai/Documents/LLM wiki/银行/02_原始资料/03_公司披露/招商银行2025年年度报告.pdf"

keywords = ["存款成本率", "存款平均成本", "计息负债成本", "客户存款成本", "存款付息"]

with pdfplumber.open(pdf_path) as pdf:
    print(f"Total pages: {len(pdf.pages)}")
    for i, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        for kw in keywords:
            if kw in text:
                print(f"\n=== Page {i+1}: found '{kw}' ===")
                lines = text.split("\n")
                for j, line in enumerate(lines):
                    if kw in line:
                        start = max(0, j - 5)
                        end = min(len(lines), j + 10)
                        for k in range(start, end):
                            print(f"  {lines[k]}")
                        print("  ...")
