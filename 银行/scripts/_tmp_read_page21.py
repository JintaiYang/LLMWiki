#!/usr/bin/env python3
"""读取2025年年报第21页完整内容"""
import pdfplumber

pdf_path = "/Users/yangjintai/Documents/LLM wiki/银行/02_原始资料/03_公司披露/招商银行2025年年度报告.pdf"

with pdfplumber.open(pdf_path) as pdf:
    # 读第21页（索引20）
    page = pdf.pages[20]
    text = page.extract_text() or ""
    print("=== Page 21 ===")
    print(text)
