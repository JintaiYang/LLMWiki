# iFind 银行专项指标数据

> 来源：同花顺 iFind MCP（`ifind_get_stock_financials`），Workflow 编排 3 个 agent 批量采集
> 采集时间：2026-09-07 ~ 2026-09-08
> 覆盖：42家A股上市银行 × 20年全报告期（2006Q4 ~ 2026Q3/2026年报预披露行）

## 目录结构

```
05_iFind数据/
├── raw/                        原始返回（markdown表格文本，未加工）
│   ├── {code}_A.txt            A查询: 不良率/拨备覆盖率/CET1/资本充足率（含自动扩展列）
│   └── {code}_B.txt            B查询: NIM/关注类占比/活期存款/个人存款/计息负债成本率
└── 银行专项指标/
    └── {code}_{name}_indicators.csv    解析后标准CSV（42家，每家81期）
```

## 解析后CSV字段

| 字段 | 含义 | 单位 | 来源查询 |
|------|------|------|---------|
| report_date | 报告期（YYYY-MM-DD） | — | — |
| npl_ratio | 不良贷款率 | % | A |
| provision_coverage | 拨备覆盖率 | % | A |
| cet1_ratio | 核心一级资本充足率 | % | A |
| tier1_ratio | 一级资本充足率 | % | A |
| car_ratio | 资本充足率（总） | % | A |
| cet1_capital | 核心一级资本净额 | 元 | A |
| nim | 净息差 | % | B |
| special_mention_ratio | 关注类贷款占比 | % | B |
| demand_deposits | 活期存款 | 元 | B |
| personal_deposits | 个人存款 | 元 | B |
| interest_bearing_liab_cost | 计息负债成本率 | % | B |

## 数据质量说明

1. **验证锚点**（招行2025A）：NPL 0.94 / 拨备391.79 / CET1 14.16 / NIM 1.87 / 关注1.43 —— 与年报及公式文档一致。
2. **覆盖差异**：次新银行上市前数据来自招股书（不良率等披露不全，CSV中该期为空）；2026-12-31 行为预披露占位（多数为空）。
3. **解析脚本**：`scripts/parse_ifind_indicators.py`（markdown表格→CSV，含金额"万亿/亿/万"单位解析、CAR列排除更具体资本充足率列的优先级逻辑）。
4. **下游消费**：`scripts/generate_stock_score_data.py` 读取本目录CSV，填充打分项 B1/B2/B3/C1/A3/D1/D2/D3。

## 重新采集

iFind 查询为自然语言，需保持指标关键词稳定：
- 查询A：`{银行名}2006年至2026年各报告期的不良贷款率、拨备覆盖率、核心一级资本充足率`
- 查询B：`{银行名}2006年至2026年各报告期的净息差、关注类贷款比例、活期存款、个人存款、计息负债成本率`
