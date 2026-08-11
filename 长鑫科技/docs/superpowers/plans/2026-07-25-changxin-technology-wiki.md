# 长鑫科技 LLM Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在严格证据模式下，按照已批准的半导体定制设计，完成长鑫科技/长鑫存储（CXMT）的研究版 Obsidian LLM Wiki。

**Architecture:** 复用贵州茅台 Wiki 的顶层目录与维护契约，将内容模块改造成适用于 DRAM 和晶圆制造的研究页面。资料先进入原始资料与来源索引，再沉淀为业务、财务、竞争、护城河、估值、风险和跟踪页面；所有不具备一手或权威来源的数字标记为 `待确认`、`待补充` 或 `待验证`。

**Tech Stack:** Obsidian Markdown、YAML frontmatter、WikiLinks、公开监管/官方/权威行业资料；不新增运行时依赖，不创建虚构财务数据。

## Global Constraints

- 研究对象固定为长鑫科技股份有限公司/长鑫存储（CXMT），重点为 DRAM 存储芯片与晶圆制造。
- 正文事实仅采用监管披露、公司官方材料或可核验权威行业资料，并附来源编号。
- 券商观点、媒体报道、行业估算和未交叉核实信息不得写成公司事实。
- 不擅自填写证券代码、上市状态、上市日期、营收、利润、产能、资本开支、客户结构、市值或目标价。
- 无法核验的内容必须标记为 `待确认`、`待补充` 或 `待验证`。
- 每次创建或修改 Wiki 页面必须同步更新 `/Users/yangjintai/Documents/LLM wiki/长鑫科技/09_操作日志.md`。
- 不提交 Git commit，除非用户明确要求。

---

### Task 1: 建立目录骨架与半导体页面清单

**Files:**
- Create directories under `/Users/yangjintai/Documents/LLM wiki/长鑫科技/`: `01_收件箱/`, `02_原始资料/公告/`, `02_原始资料/新闻事件/`, `02_原始资料/研报/`, `02_原始资料/调研纪要/`, `02_原始资料/财报/`, `03_模板/`, `04_运维报告/`, and all 15 directories under `05_知识库/`.

**Interfaces:**
- Produces: stable paths used by every later task.
- Consumes: approved design document at `docs/superpowers/specs/2026-07-25-changxin-technology-wiki-design.md`.

- [ ] **Step 1: Create the empty directory structure**

Use the IDE file operation to create the directories listed above. Keep the existing design document under `docs/superpowers/specs/` unchanged.

- [ ] **Step 2: Verify the structure**

Check that the five raw-material subdirectories and all 15 knowledge-base subdirectories exist. The expected knowledge-base directories are `01_公司主页`, `02_业务地图`, `03_财务分析`, `04_护城河`, `05_管理层与治理`, `06_竞争格局`, `07_先行指标`, `08_估值假设`, `09_风险地图`, `10_事件时间线`, `11_决策记录`, `12_验证日志`, `13_跟踪器`, `14_术语表`, `15_来源`.

---

### Task 2: 登记可核验资料与资料缺口

**Files:**
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/02_原始资料/原始资料索引.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/02_原始资料/公告/资料节点-S01-监管与交易所入口.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/02_原始资料/新闻事件/资料节点-S02-行业公开资料.md`

**Interfaces:**
- Produces: source IDs `S01` and `S02`, their credibility labels, URLs, usage restrictions, and verification gaps.
- Consumes: public search results already obtained; the Shanghai Stock Exchange page previously queried for `688981` must be recorded only as an unrelated/incorrect code check, not as CXMT evidence.

- [ ] **Step 1: Record source status**

Create an index table with columns `ID`, `类型`, `标题`, `机构`, `日期`, `链接/路径`, `可信度`, `用途`, `状态`, `缺口`. Record that the currently accessible SSE URL with `COMPANY_CODE=688981` corresponds to a code-check attempt and does not establish CXMT identity. Record the KM industry snippet as a lead only, with credibility `新闻媒体/待验证` if retained.

- [ ] **Step 2: Create lightweight source nodes**

Each source node must state what was actually accessible, what it can support, and what it cannot support. Do not present search snippets as audited financial facts. Link any raw attachment as a normal Markdown link, not as a direct PDF WikiLink.

- [ ] **Step 3: Verify evidence labels**

Confirm every source has one of `监管`, `官方`, `行业机构`, `新闻媒体`, or `待验证`, and that no inaccessible source is labeled `high` evidence.

---

### Task 3: 编写维护契约、模板和全局日志

**Files:**
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/06_维护契约.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/03_模板/公司研究页面模板.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/03_模板/来源记录模板.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/03_模板/半导体跟踪器模板.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/09_操作日志.md`

**Interfaces:**
- Produces: common frontmatter, evidence rules, semiconductor-specific update workflow, reusable templates, and an initial log entry covering Tasks 1–3.
- Consumes: structure from `/Users/yangjintai/Documents/LLM wiki/贵州茅台/06_维护契约.md`.

- [ ] **Step 1: Adapt the maintenance contract**

Retain the five-layer workflow and mandatory logging from the Maotai contract. Replace Baijiu-specific examples with DRAM-specific examples, add rules for capacity, wafer starts, yield, node, bit output, CapEx, depreciation, customer qualification, and cycle indicators, and preserve the fact/inference/to-verify distinction.

- [ ] **Step 2: Create focused templates**

The company template must contain frontmatter fields `type`, `status`, `company`, `stock_code`, `market`, `tags`, `evidence_level`, `updated`, `related`, and `next_action`, followed by sections `一句话判断`, `事实`, `推断`, `关联页面`, `待验证`, `下一步`. The source template must include source ID, credibility, date, URL/path, supported claims, limitations, and verification status. The tracker template must include metric, definition, source, period, threshold, status, and next update.

- [ ] **Step 3: Initialize the log**

Add a reverse-chronological entry dated `2026-07-25` covering the directory, design, source registration, contract, and template creation. Include `Changed`, `Why`, `Data Source`, and `Next` fields. Do not rewrite the historical design decisions.

---

### Task 4: 创建业务、竞争、护城河与术语页面

**Files:**
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/02_业务地图/长鑫业务地图.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/04_护城河/长鑫护城河.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/06_竞争格局/DRAM竞争格局.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/07_先行指标/DRAM先行指标.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/14_术语表/DRAM与半导体术语表.md`

**Interfaces:**
- Produces: interconnected qualitative research nodes with explicit evidence levels.
- Consumes: source IDs from Task 2 and common frontmatter from Task 3.

- [ ] **Step 1: Write the business map**

Cover DRAM product families, wafer manufacturing flow, process and packaging boundaries, possible manufacturing footprint, customer qualification, upstream equipment/materials, downstream devices, and the distinction between confirmed facts and industry framework. Any CXMT-specific item without a source must be `待验证`.

- [ ] **Step 2: Write the moat and competitive landscape**

Separate technical/process learning, scale and yield, customer qualification, supply chain, talent, capital intensity, and policy support. Compare Samsung, SK hynix, Micron, CXMT, and relevant domestic companies by product, process, scale, customer access, and evidence status. Do not claim parity or specific market share without a source.

- [ ] **Step 3: Write leading indicators and glossary**

Define DRAM contract/spot pricing, bit supply, wafer starts, node, yield, utilization, CapEx, depreciation, DDR/LPDDR, HBM, and customer qualification. For each indicator include interpretation and limitation; do not insert unverified current values.

- [ ] **Step 4: Link and log**

Add WikiLinks among the five pages, update `08_索引.md` if it already exists, and add the page changes to `09_操作日志.md`.

---

### Task 5: 创建财务、估值、风险与跟踪页面

**Files:**
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/03_财务分析/关键指标汇总.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/03_财务分析/盈利能力.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/03_财务分析/资本开支与产能.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/03_财务分析/现金流质量.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/03_财务分析/研发投入.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/08_估值假设/半导体估值方法论.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/08_估值假设/长鑫估值假设.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/09_风险地图/长鑫风险地图.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/05_知识库/13_跟踪器/长鑫跟踪器.md`

**Interfaces:**
- Produces: strict-evidence financial and investment framework pages. Numeric tables may contain `待补充`, but never invented values.
- Consumes: Task 2 source index, Task 4 industry definitions, and Maotai valuation structure as a formatting reference only.

- [ ] **Step 1: Create the financial pages**

Use tables with columns `指标`, `期间`, `数值`, `单位`, `来源`, `证据等级`, `备注`. Include revenue, gross profit/margin, net income/margin, R&D, CapEx, depreciation, operating cash flow, free cash flow, cash/debt, wafer capacity, utilization, and yield only where source-backed; otherwise put `待补充`.

- [ ] **Step 2: Create the valuation method page**

Explain cycle-adjusted earnings, EV/Sales, DCF, capacity/profit scenarios, and peer comparison. State why peak/trough semiconductor earnings can distort PE, and separate enterprise value from equity value. Include formulas as methodology, not as a company valuation result.

- [ ] **Step 3: Create the CXMT assumptions page**

Create a variable register for price, bit growth, wafer starts, utilization, yield, gross margin, CapEx, depreciation, tax, WACC, terminal growth, share count, and net cash/debt. Set each current value to `待补充` or `待验证`, with a source/validation field and bull/base/bear impact direction. Explicitly state no target price is produced in this version.

- [ ] **Step 4: Create risk map and tracker**

Risk map must cover memory cycle, technology roadmap, yield/ramp, customer concentration, equipment/materials, export controls, CapEx financing, depreciation burden, competition, and governance. Tracker must define periodic updates for DRAM pricing, supply/demand, capacity, utilization, yield, node, customer qualification, CapEx, cash flow, and policy events.

- [ ] **Step 5: Link and log**

Connect financial pages to valuation, risk, tracker, glossary, and sources. Add all changes to `09_操作日志.md`.

---

### Task 6: 创建公司主页、全库索引与结构补充页

**Files:**
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/07_公司主页.md`
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/08_索引.md`
- Create: placeholder pages only where navigation requires them: `05_知识库/01_公司主页/`, `05_知识库/05_管理层与治理/`, `05_知识库/10_事件时间线/`, `05_知识库/11_决策记录/`, `05_知识库/12_验证日志/`, `05_知识库/15_来源/`.

**Interfaces:**
- Produces: the human-facing entry point and complete navigation graph.
- Consumes: every page created by Tasks 2–5.

- [ ] **Step 1: Write the home page**

Use frontmatter with `company: 长鑫科技/长鑫存储（CXMT）`, `stock_code: 待确认`, `market: 待确认`, `status: growing`, `evidence_level: medium`, and `updated: 2026-07-25`. State the research scope, one-sentence provisional judgment, confirmed facts, unknowns, navigation, and system status. Do not imply a confirmed listing.

- [ ] **Step 2: Write the index**

List global files and all 15 knowledge modules. Each link must target an existing page or explicitly say `待填充`; do not leave accidental unresolved company links.

- [ ] **Step 3: Log navigation completion**

Record creation of the home page, index, and any intentional placeholder navigation in `09_操作日志.md`.

---

### Task 7: 全库一致性验证与运维报告

**Files:**
- Create: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/04_运维报告/2026-07-25 首版健康检查.md`
- Modify: `/Users/yangjintai/Documents/LLM wiki/长鑫科技/09_操作日志.md`.

**Interfaces:**
- Produces: a reproducible first-release health check and final log entry.
- Consumes: all files from Tasks 1–6.

- [ ] **Step 1: Verify files and directories**

Check that all required directories and planned Markdown pages exist. Report missing pages explicitly instead of silently creating unrelated content.

- [ ] **Step 2: Verify evidence discipline**

Search pages for unqualified numeric claims, unsupported stock codes, unsupported listing dates, and language that converts news/industry estimates into facts. Every key numeric value must have a source ID or be marked `待补充`/`待验证`.

- [ ] **Step 3: Verify WikiLinks**

Check every `[[...]]` target used by the new Wiki. Repair target-company links that do not resolve, while leaving intentional `待填充` statements as plain text.

- [ ] **Step 4: Write the health report and final log**

Record page count, directory coverage, source coverage, unresolved links, evidence gaps, and next research actions. Add a final `verify` entry to `09_操作日志.md` covering the health check.

- [ ] **Step 5: Run final read-back**

Read the home page, index, source index, valuation assumptions, risk map, tracker, and operation log to confirm they agree on company identity, evidence mode, date, and missing-data policy.
