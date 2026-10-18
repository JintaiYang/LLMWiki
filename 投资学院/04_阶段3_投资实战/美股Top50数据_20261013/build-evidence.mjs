import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const financials = JSON.parse(await fs.readFile(path.join(dir, 'financials.json'), 'utf8'));
const selection = JSON.parse(await fs.readFile(path.join(dir, 'selection.json'), 'utf8'));
const map = new Map(financials.results.map(x => [x.ticker, x]));
const financialCompanies = new Set(['BRK-B', 'JPM', 'CB', 'PGR']);
const pct = x => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '待核验';
const amount = x => Number.isFinite(x) ? (x / 1e9).toFixed(2) : '待核验';
const rows = [];
for (const [i, selected] of selection.entries()) {
  const r = map.get(selected.ticker);
  if (!r || r.summary.years < 3) throw new Error(`Insufficient annual evidence: ${selected.ticker}`);
  const s = r.summary, last = r.periods.at(-1), fin = financialCompanies.has(r.ticker);
  rows.push(`| ${i + 1} | ${r.ticker} ${selected.name} | ${last.end} | ${pct(s.revenueCagr)} | ${fin ? '不适用' : pct(s.operatingMarginMedian)} | ${fin ? '不适用' : pct(s.fcfMarginMedian)} | ${fin ? '不适用' : `${s.fcfPositiveYears}/${s.fcfCoverageYears}`} | [SEC](${r.supplementalSource?.url ?? r.annualFilings.at(-1)}) |`);
}
let out = `---
title: 美股Top50财务证据与来源
note_type: financial_evidence
created: 2026-10-14
updated: 2026-10-14
data_cutoff: 2026-10-13
evidence_level: primary_financial_data_with_research_judgment
related:
  - "[[美股基本面Top50_不考虑估值_20261013]]"
---

# 美股 Top50 财务证据与来源

只使用截至 2026-10-13 已申报的数据。五年指每家公司最近五个完整财年，窗口不同；收入 CAGR 是五个年度端点之间约四年的复合增速，不是五年增速。金额使用公司原始报告币种、十亿元单位，不做跨币种金额排名。申报中的历史重述优先；缺失不是 0。

FCF = CFO - 报表现金资本开支；不扣并购支付、不自动补入融资租赁新增资产，也不等于可分配股东盈余。SBC 调整 FCF = FCF - 股票薪酬，为经济成本敏感性代理。股票薪酬本已扣减 GAAP 利润，但在 CFO 中加回；这里扣回一次，不再扣除抵消稀释所用的回购现金。五年 ROA/ROE 只展示，不用于跨行业机械排名。

## 横向总表

表内营业利润率、FCF 利润率为五年中位数。现金字段的不同标签范围仍可能不同，软件资本化、收购和客户资金等问题见各公司提示及主文档。金融企业的通用 FCF、营业利润率不参与质量判断。ADR 季度数据不在本次 10-Q 检查范围内。

| 排序 | 公司 | 最新完整财年截止 | 收入 CAGR | 营业利润率中位数 | FCF 利润率中位数 | FCF 为正 / 有效年 | 最新年度官方申报 |
|---:|---|---|---:|---:|---:|---|---|
${rows.join('\n')}

## 每家公司五年数据

非金融入选者的五年收入、净利润、CFO、资本开支和 FCF 已提供；营业利润有自定义标签时保留待核验。净利润以标准合并净利润为优先代理，BKNG 使用普通股可得净利润；未统一扣除非控股股东损益。它适合初筛，不应直接作为每股价值计算基数。

`;
for (const [i, selected] of selection.entries()) {
  const r = map.get(selected.ticker), fin = financialCompanies.has(r.ticker);
  const s = r.summary, last = r.periods.at(-1);
  out += `### ${i + 1}. ${selected.name} (${r.ticker})

- 原始币种：${r.unit}；来源：[SEC Company Facts](${r.source})${r.supplementalSource ? `，补充：[年度申报原文](${r.supplementalSource.url})` : ''}。
- 五年窗口：${r.periods[0].start} 至 ${last.end}；${fin ? '金融/多元企业，以下通用现金流不参与排序。' : `收入 CAGR ${pct(s.revenueCagr)}；净利润为正 ${s.profitPositiveYears}/${s.profitCoverageYears} 年；FCF 为正 ${s.fcfPositiveYears}/${s.fcfCoverageYears} 年。`}
- 最新年度 SBC / 收入：${pct(s.latestSbcToRevenue)}；同一次年度申报可比口径的稀释股数同比：${pct(s.dilutedSharesYoy)}。没有可比字段时保留缺失，避免将拆股当成稀释。
- 最新标准标签季度收入检查：${r.interim && r.interim.end > last.end ? `${r.interim.end}，同比 ${pct(r.interim.revenueYoy)}，申报日 ${r.interim.filed}；只检查收入，不能替代利润与现金流检查。` : '年度报告更新；或未覆盖 ADR 的季度公告。'}

金额单位：十亿元 ${r.unit}；金融公司的现金流只保留原值用于溯源。

| 财年截止 | 收入 | 净利润代理 | CFO | 现金资本开支 | FCF | FCF - SBC | 营业利润率 | 年度申报 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
`;
  for (const p of r.periods) {
    const accn = p.fields.revenue.accn;
    const url = p.fields.revenue.sourceUrl ?? `https://www.sec.gov/Archives/edgar/data/${r.cik}/${accn.replaceAll('-', '')}/${accn}-index.html`;
    out += `| ${p.end} | ${amount(p.revenue)} | ${amount(p.netIncome)} | ${amount(p.cfo)} | ${amount(p.capex)} | ${amount(p.fcf)} | ${amount(p.sbcFcf)} | ${fin ? '不适用' : pct(p.operatingMargin)} | [原文](${url}) |\n`;
  }
  out += `\n字段级的 concept、unit、start、end、filed、accn 和原始数值见 [financials.json](美股Top50数据_20261013/financials.json)。\n\n`;
}
out += `## 金融行业补充证据

- 摩根大通：2025 年 ROE 17%、ROTCE 20%、标准法 CET1 14.6%；2024 年分别为 18%、22%、15.7%。2025 年净核销率 0.74%，高于 2024 年 0.68%。本次以这些资本与信用指标辅助判断，未把存贷款现金流当作 FCF。[2025 年 10-K](${map.get('JPM').supplementalSource.url})。
- 安达：2025/2024/2023 年 P&C 综合成本率分别为 85.7% / 86.6% / 86.5%；2025 年当年事故年度剔除灾害损失后的综合成本率 81.9%。低于 100% 代表承保盈利，但必须继续检查灾害损失、准备金释放与再保险。[2025 年 10-K](${map.get('CB').supplementalSource.url})。
- Progressive：2025/2024/2023 年总承保业务综合成本率分别为 87.4% / 88.8% / 94.9%，来自 Exhibit 13 的承保利润率与综合成本率表（App.-A-39）。2025 年个人险和商业险分别为 87.5% 和 87.0%；10-K 正文设定长期承保目标为不高于 96%。这些是承保能力的支持证据，仍需检查灾害、赔付通胀和准备金，不能由通用 CFO/净利润得出优质保险的结论。[10-K](${map.get('PGR').supplementalSource.url})，[2025 年 Exhibit 13](${map.get('PGR').supplementalSource.url.replace(/[^/]+$/, 'pgr-20251231_d2.htm')})。
- 伯克希尔：合并净利润包含证券公允价值变动，2022 年 GAAP 亏损不直接触发持续经营否决。需要拆开保险承保、保险投资、铁路、能源和其他经营收益；合并 CFO - Capex 不等于可由母公司自由分配的现金。[2025 年 10-K](${map.get('BRK-B').supplementalSource.url})。

## 可复核文件

- [结构化财务与每个字段来源](美股Top50数据_20261013/financials.json)
- [95 家候选横向数据](美股Top50数据_20261013/comparison.csv)
- [入选 50 家与顺序](美股Top50数据_20261013/selection.json)
- [SEC 采集与指标计算脚本](美股Top50数据_20261013/collect-sec.mjs)
- [补充年报采集脚本](美股Top50数据_20261013/supplement-sec.mjs)
- [年报 Inline XBRL 解析脚本](美股Top50数据_20261013/parse-inline.py)

复核流程：运行 supplement-sec.mjs、parse-inline.py、collect-sec.mjs、build-evidence.mjs。脚本按 2026-10-13 截止过滤，缓存与原始申报快照在数据目录。对现金开支标签逐项复核后再用于正式评分或估值。
`;
await fs.writeFile(path.join(dir, '..', '美股Top50财务证据_20261013.md'), out);
console.log(`Built evidence for ${selection.length} selected companies from ${financials.results.length} candidates`);
