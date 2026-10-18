---
title: "SEC-BRK-B：伯克希尔 B 股 SEC 年度资料"
note_type: "source_note"
status: "active"
vault: "美股50"
created: "2026-10-14"
updated: "2026-10-14"
data_cutoff: "2026-10-13"
report_period: "各公司最近五个完整财年"
evidence_level: "high"
evidence_class: "primary_source"
source_priority: "SEC"
sources:
  - "https://data.sec.gov/api/xbrl/companyfacts/CIK0001067983.json"
related:
  - "[[05_知识库/03_公司库/伯克希尔B股_BRK-B]]"
  - "[[05_知识库/10_来源/来源索引]]"
tags:
  - "美股50"
  - "基本面"
  - "不考虑估值"
---

# SEC-BRK-B：伯克希尔 B 股 SEC 年度资料

## 来源

- 发布机构：美国 SEC；类型：监管申报及结构化 XBRL。
- 来源编号：SEC-BRK-B；截止：2026-10-13；报告窗口：2021-01-01 至 2025-12-31。
- 状态：年度标准字段已导入；完整治理、ROIC 和最新季报仍待核验。
- [SEC Company Facts](https://data.sec.gov/api/xbrl/companyfacts/CIK0001067983.json)
- [补充年度申报原文](https://www.sec.gov/Archives/edgar/data/1067983/000119312526083899/brka-20251231.htm)

- [年度申报资料 1](https://www.sec.gov/Archives/edgar/data/1067983/000095017024019719/0000950170-24-019719-index.html)
- [年度申报资料 2](https://www.sec.gov/Archives/edgar/data/1067983/000095017025025210/0000950170-25-025210-index.html)
- [年度申报资料 3](https://www.sec.gov/Archives/edgar/data/1067983/000119312526083899/0001193125-26-083899-index.html)

## 本地材料

- [字段、单位、起止日、申报日和 accession](../../../02_原始资料/01_SEC数据/financials.json)
- [Company Facts 压缩快照](../../../02_原始资料/01_SEC数据/raw/BRK-B.json.gz)
- [补充年报压缩快照](../../../02_原始资料/01_SEC数据/filings/BRK-B.html.gz)


## 已提取事实

最近五个完整年度的收入、净利润代理、CFO、现金资本开支与 SBC。缺失值保留待验证，金融企业不以通用 FCF 评分。每个字段的具体概念、来源与币种记录在结构化数据中。

## 推断与待验证

SEC 财务来源本身不能证明护城河；原报告中的竞争优势与风险是研究判断。现金资本开支标签范围、非控股股东损益、并购与客户资金等仍需附注核验。

## 关联

- [[05_知识库/03_公司库/伯克希尔B股_BRK-B|伯克希尔 B 股 公司档案]]
- [[05_知识库/10_来源/来源索引]]
- [[02_原始资料/原始资料目录]]
- [[05_知识库/12_跟踪器/五年财务证据]]
