/* Healthcare research views share one immutable financial snapshot. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const root = $("workspace");
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const valid = v => typeof v === "number" && Number.isFinite(v);
  const fmt = (v, digits = 1) => valid(v) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(v) : "—";
  const percent = v => valid(v) ? fmt(v) + "%" : "—";
  const yi = v => valid(v) ? v / 1e8 : null;
  const colors = ["#087f70", "#3679cc", "#c18c35", "#aa6a91", "#7a8c53", "#be4c48", "#668b9b", "#7c779c"];
  const params = new URLSearchParams(location.search);
  const state = { page: document.body.dataset.page, data: null, sector: params.get("sector") || "全部", period: "2025", group: "core", search: "", status: "all", sort: "score", direction: -1, selected: new Set(), code: params.get("code") || "600276", compare: params.get("compare") || "", charts: [], configs: {} };
  const sectors = () => [...new Set(state.data.companies.map(c => c.sector))];
  const annual = (c, year = 2025) => c.annual.find(r => r.period === year + "1231") || {};
  const report = c => state.period === "2026H1" ? c.interim.find(r => r.period === "20260630") || {} : annual(c);
  const previousReport = c => state.period === "2026H1" ? c.interim.find(r => r.period === "20250630") || {} : annual(c, 2024);
  const company = code => state.data.companies.find(c => c.code === code);
  const included = () => state.data.companies.filter(c => state.sector === "全部" || c.sector === state.sector);
  const tag = (label, kind = "") => `<span class="tag ${kind}">${esc(label)}</span>`;
  const sum = (cs, key, get = report) => { const values = cs.map(c => get(c)[key]); return { value: values.every(valid) && values.length ? values.reduce((a, b) => a + b, 0) : null, count: values.filter(valid).length }; };
  const change = (now, before) => valid(now) && valid(before) && before > 0 ? (now / before - 1) * 100 : null;
  const delta = v => valid(v) ? `<span class="${v >= 0 ? "positive" : "negative"}">${v >= 0 ? "+" : ""}${fmt(v)}%</span>` : "—";
  const icon = name => `<i data-lucide="${name}"></i>`;
  const companyOptions = code => state.data.companies.map(c => `<option value="${c.code}" ${code === c.code ? "selected" : ""}>${esc(c.name)} · ${esc(c.sector)}</option>`).join("");
  const sectorButtons = () => `<div class="sector-strip" aria-label="子行业">${["全部", ...sectors()].map(s => `<button data-sector="${esc(s)}" class="${state.sector === s ? "active" : ""}" aria-pressed="${state.sector === s}">${esc(s)}</button>`).join("")}</div>`;
  const periodControl = () => `<label>财报期 <select id="period"><option value="2025" ${state.period === "2025" ? "selected" : ""}>2025 年报</option><option value="2026H1" ${state.period === "2026H1" ? "selected" : ""}>2026 中报</option></select></label>`;
  const header = (title, control = "") => `<div class="page-head"><div><h1>${title}</h1><div class="meta"><span class="live">AKShare 财报快照</span><span>研究日 ${state.data.meta.as_of}</span><span>财务评分 V1 · 2023–2025</span></div></div><div class="controls">${control}</div></div>`;
  const section = (id, title, note, html) => `<section id="${id}" class="section"><div class="section-title"><h2>${title}</h2>${note ? `<small>${note}</small>` : ""}</div>${html}</section>`;
  const kpi = (label, value, unit, foot) => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}<small>${unit}</small></div><div class="kpi-foot">${foot}</div></div>`;
  const panel = (id, title, note, foot = "", tall = false) => `<div class="chart-panel"><div class="chart-head"><div><h3>${title}</h3><p>${note}</p></div><button class="icon-button" data-enlarge="${id}" title="放大图表" aria-label="放大${title}">${icon("maximize-2")}</button></div><div class="chart-box ${tall ? "tall" : ""}"><canvas id="${id}" aria-label="${title}" role="img"></canvas></div>${foot ? `<div class="chart-foot">${foot}</div>` : ""}</div>`;
  const scoreLabel = c => c.score.status === "research_only" ? tag("研发观察池", "blue") : c.score.total === null ? tag("资料不全", "warn") : `<span class="score-cell"><span class="track"><i style="width:${c.score.total}%"></i></span><strong>${fmt(c.score.total)}</strong></span>`;
  function navigation() {
    const pages = [["industry", "industry.html", "行业总览"], ["compare", "index.html", "公司对比"], ["stock", "stock.html", "个股深度"], ["formula", "score-formula.html", "评分方法"]];
    $("navigation").innerHTML = `<div class="nav-inner"><a class="brand" href="industry.html"><img src="favicon.svg" alt="">医疗健康研究台</a><nav class="nav-links" aria-label="主导航">${pages.map(([key, url, label]) => `<a class="${state.page === key ? "active" : ""}" href="${url}" ${state.page === key ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav><span class="version">V1 <span class="muted">· 25家 / 8个子行业</span></span></div>`;
  }
  function plot(id, labels, datasets, unit = "亿元", options = {}) {
    const canvas = $(id);
    if (!canvas) return;
    if (!datasets.some(d => d.data.some(valid))) { canvas.parentElement.innerHTML = '<div class="empty">本期数据不足，未绘制趋势</div>'; return; }
    const config = { type: "line", data: { labels, datasets: datasets.map((d, i) => ({ borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length], pointRadius: 2.5, borderWidth: 2, tension: 0.16, spanGaps: false, ...d })) }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: "index" }, plugins: { legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 8, font: { size: 11 }, padding: 16 } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}：${fmt(ctx.parsed[options.horizontal ? "x" : "y"], 2)} ${unit}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { title: { display: true, text: unit, color: "#6b746f", font: { size: 11 } }, grid: { color: "#edf1ee" }, ticks: { font: { size: 11 } }, beginAtZero: true } }, ...options } };
    if (options.horizontal) {
      delete config.options.horizontal;
      config.options.indexAxis = "y";
      config.options.scales = { x: { beginAtZero: true, grid: { color: "#edf1ee" }, title: { display: true, text: unit }, ticks: { font: { size: 11 } } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } };
    }
    state.configs[id] = config;
    state.charts.push(new Chart(canvas, config));
  }
  function sourceSummary() {
    const s = state.data.meta.financial_source_cells;
    return `<div class="context-line"><span>${esc(state.data.meta.universe)}</span><span>财务与经营字段：AKShare ${fmt(s.AKShare, 0)} / PDF ${s.PDF} / iFinD ${s.iFinD}</span></div>`;
  }
  function evidence() {
    const sources = state.data.research.sources || [];
    return `<div class="source-list">${sources.map(s => `<article class="source-row"><div>${tag(s.type, s.type === "政策原文" ? "good" : "blue")}<br><small>${esc(s.date)}</small></div><div><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ${icon("arrow-up-right")}</a><p>${esc(s.finding)}</p><small>落地：${esc(s.application)}</small></div><small>${esc(s.verification)}</small></article>`).join("") || '<p class="muted">研究证据正在整理。</p>'}</div>`;
  }
  function researchGrid() {
    return `<div class="research-grid">${(state.data.research.sectors || []).filter(s => state.sector === "全部" || s.name === state.sector).map(s => `<article class="research-item"><h3>${esc(s.name)} ${tag(s.valuation, "blue")}</h3><p>${esc(s.focus)}</p><div>${tag("附注指标逐项核验", "warn")}</div></article>`).join("")}</div>`;
  }
  function industry() {
    const cs = included();
    const metrics = [["revenue", "样本营业收入"], ["net_profit", "样本归母净利润"], ["cfo", "样本经营现金流"], ["fcf", "样本自由现金流"]];
    root.innerHTML = header("医疗健康行业总览", periodControl()) + sectorButtons() + `<div class="kpi-strip">${metrics.map(([key, label]) => { const a = sum(cs, key), b = sum(cs, key, previousReport); return kpi(label, fmt(yi(a.value), 2), "亿元", `同口径同比 ${delta(change(a.value, b.value))} · ${a.count}/${cs.length}家`); }).join("")}</div>` + sourceSummary()
      + section("trends", "经营趋势与子行业分化", `${state.period === "2025" ? "2025年报" : "2026中报"} · 金额合计，利润率按收入加权`, `<div class="chart-grid">${panel("industry-trend", "收入、利润与现金", "2021–2025完整年度 · 亿元", "固定公司池；缺项断线，研发观察池仍计入样本合计")}${panel("sector-margin", "子行业扣非净利率", `${state.period === "2025" ? "2025年报" : "2026中报"} · %`, "按子行业分别汇总扣非归母净利与收入；不将毛利率用于跨行业评分")}</div>`)
      + section("sector-table", "子行业财务快照", "25家研究样本；研发商业化药企不参与财务评分排名", `<div class="table-wrap"><table><thead><tr><th>子行业</th><th>样本</th><th>营收 / 亿</th><th>营收同比</th><th>扣非净利润 / 亿</th><th>CFO / 亿</th><th>FCF / 亿</th><th>可评分</th></tr></thead><tbody>${sectors().filter(s => state.sector === "全部" || s === state.sector).map(s => { const items = cs.filter(c => c.sector === s); return `<tr><td><a href="index.html?sector=${encodeURIComponent(s)}">${esc(s)}</a></td><td>${items.length}</td><td>${fmt(yi(sum(items, "revenue").value))}</td><td>${delta(change(sum(items, "revenue").value, sum(items, "revenue", previousReport).value))}</td><td>${fmt(yi(sum(items, "adjusted_profit").value))}</td><td>${fmt(yi(sum(items, "cfo").value))}</td><td>${fmt(yi(sum(items, "fcf").value))}</td><td>${items.filter(c => c.score.total !== null).length}/${items.length}</td></tr>`; }).join("")}</tbody></table></div>`)
      + section("research", "八个子行业研究框架", "定量财务 + 独立产业证据", researchGrid())
      + section("evidence", "政策与研究依据", "证据等级与检索日期单独保留", evidence());
    const years = [2021, 2022, 2023, 2024, 2025];
    plot("industry-trend", years, [["revenue", "营业收入"], ["net_profit", "归母净利润"], ["cfo", "经营现金流"]].map(([key, label]) => ({ label, data: years.map(y => yi(sum(cs, key, c => annual(c, y)).value)) })));
    const ss = sectors().filter(s => state.sector === "全部" || s === state.sector);
    plot("sector-margin", ss, [{ type: "bar", label: "扣非归母净利率", data: ss.map(s => { const items = cs.filter(c => c.sector === s), revenue = sum(items, "revenue").value, profit = sum(items, "adjusted_profit").value; return valid(revenue) && revenue > 0 && valid(profit) ? profit / revenue * 100 : null; }), backgroundColor: ss.map((_, i) => colors[i]), borderWidth: 0 }], "%", { horizontal: true });
  }
  const columnGroups = {
    core: [["revenue", "营业收入", "亿"], ["revenue_yoy", "营收同比", "%"], ["adjusted_profit", "扣非归母净利", "亿"], ["roe", "ROE", "%"], ["cash_conversion", "CFO/合并净利", "倍"]],
    cash: [["cfo", "经营现金流", "亿"], ["capex", "全部资本开支", "亿"], ["fcf", "自由现金流", "亿"], ["liquidity", "现金/流动负债", "倍"], ["cash", "货币资金", "亿"]],
    assets: [["receivables_ratio", "应收/营收", "%"], ["inventory", "存货", "亿"], ["goodwill_equity", "商誉/归母权益", "%"], ["leverage", "资产负债率", "%"], ["development", "开发支出余额", "亿"]],
    research: [["rd_expense", "研发费用", "亿"], ["rd_ratio", "研发费用率", "%"], ["rd_total", "研发总投入", "亿"], ["rd_capitalization", "研发资本化率", "%"], ["gross_margin", "毛利率", "%"], ["sales_ratio", "销售费用率", "%"]],
  };
  function fieldValue(c, key) {
    if (key === "score") return c.score.total;
    if (key === "name") return c.name;
    if (key === "revenue_yoy") return change(report(c).revenue, previousReport(c).revenue);
    const row = report(c);
    if (valid(row[key])) return row[key];
    const supplements = (c.supplements || []).filter(r => r.period === row.period);
    if (key === "rd_capitalization") { const total = supplements.find(r => r.field === "rd_total")?.value, capitalized = supplements.find(r => r.field === "rd_capitalized")?.value; return valid(total) && total > 0 && valid(capitalized) ? capitalized / total * 100 : null; }
    return supplements.find(r => r.field === key)?.value ?? null;
  }
  function filtered() {
    return included().filter(c => (!state.search || (c.name + c.code).toLowerCase().includes(state.search.toLowerCase())) && (state.status === "all" || c.score.status === state.status)).sort((a, b) => {
      const x = fieldValue(a, state.sort), y = fieldValue(b, state.sort);
      if (x == null && y == null) return a.code.localeCompare(b.code);
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "zh") : x - y) * state.direction;
    });
  }
  function comparison() {
    root.innerHTML = header("医疗健康公司对比", periodControl()) + sectorButtons() + `<div class="toolbar"><div class="controls"><input id="search" class="search" type="search" aria-label="搜索公司或代码" placeholder="搜索公司 / 证券代码" value="${esc(state.search)}"><select id="status" aria-label="评分状态"><option value="all">全部评分状态</option><option value="complete" ${state.status === "complete" ? "selected" : ""}>可完整评分</option><option value="partial" ${state.status === "partial" ? "selected" : ""}>资料待补充</option><option value="research_only" ${state.status === "research_only" ? "selected" : ""}>研发观察池</option></select></div><div class="controls"><button id="reset" class="icon-button" title="重置筛选" aria-label="重置筛选">${icon("rotate-ccw")}</button><button id="export" title="导出当前筛选CSV">${icon("download")} 导出</button><button id="compare-selected" class="primary" ${state.selected.size !== 2 ? "disabled" : ""}>对照研究 <span id="selection-count">${state.selected.size}/2</span></button></div></div><div class="segmented" aria-label="财务主题">${[["core", "核心财务"], ["cash", "现金与投入"], ["assets", "资产与占款"], ["research", "研发与盈利"]].map(([key, title]) => `<button data-group="${key}" class="${state.group === key ? "active" : ""}" aria-pressed="${state.group === key}">${title}</button>`).join("")}</div><div class="table-note">财报列：<span id="report-note">${state.period === "2025" ? "2025年报" : "2026中报"}</span> · 财务评分固定使用2023–2025完整年度 · 同子行业优先比较</div><div id="selection-tray" class="tray"></div><div id="comparison-table"></div><p class="table-note">ROE采用归母净利润/平均归母权益；中报ROE未年化。商誉空值保留缺失；开发支出余额不等于当年资本化研发投入。</p>` + sourceSummary();
    updateComparison();
  }
  function updateComparison() {
    const cs = filtered(), columns = columnGroups[state.group];
    const heading = (key, label, unit = "") => `<th ${key === "name" ? 'class="company-cell"' : ""}><button data-sort="${key}">${label}${unit ? ` / ${unit}` : ""} ${state.sort === key ? state.direction < 0 ? "↓" : "↑" : ""}</button></th>`;
    $("comparison-table").innerHTML = `<div class="table-wrap"><table><thead><tr>${heading("name", "公司 / 代码")}${heading("score", "财务分")}<th>子行业</th>${columns.map(([key, label, unit]) => heading(key, label, unit)).join("")}<th>评分状态</th></tr></thead><tbody>${cs.map(c => `<tr data-company="${c.code}"><td class="company-cell"><label><input type="checkbox" data-select="${c.code}" aria-label="选择${esc(c.name)}" ${state.selected.has(c.code) ? "checked" : ""}><span><a href="stock.html?code=${c.code}">${esc(c.name)}</a><span class="code">${c.code}</span></span></label></td><td>${scoreLabel(c)}</td><td>${esc(c.sector)}</td>${columns.map(([key, , unit]) => { const value = fieldValue(c, key); return `<td>${key === "revenue_yoy" ? delta(value) : fmt(unit === "亿" ? yi(value) : value, unit === "倍" ? 2 : 1)}</td>`; }).join("")}<td>${c.score.status === "research_only" ? tag("不参与排名", "blue") : c.score.risks.length ? tag(`风险上限 ${c.score.cap}`, "risk") : c.score.total === null ? tag(`覆盖 ${c.score.coverage}%`, "warn") : tag("完整", "good")}</td></tr>`).join("") || '<tr><td colspan="10" class="empty">没有匹配的公司</td></tr>'}</tbody></table></div><div class="table-note">当前 ${cs.length} / ${state.data.companies.length} 家 · 缺失值排序置后</div>`;
    updateSelection();
  }
  function updateSelection() {
    $("selection-tray").innerHTML = [...state.selected].map(code => `<span class="tag blue">${esc(company(code).name)}<button class="icon-button" data-remove="${code}" title="移除${esc(company(code).name)}" aria-label="移除${esc(company(code).name)}">${icon("x")}</button></span>`).join("");
    $("compare-selected").disabled = state.selected.size !== 2;
    $("selection-count").textContent = `${state.selected.size}/2`;
    window.lucide?.createIcons();
  }
  function dimensionStrip(c) { return `<div class="dimension-strip">${c.score.dimensions.map((d, i) => `<div class="dimension"><small>${d.key} ${d.label}</small><strong style="color:${colors[i]}">${c.score.applicable ? fmt(d.points) : "—"}</strong> <small style="display:inline">/ ${d.weight}</small><div class="track"><i style="width:${c.score.applicable ? d.points / d.weight * 100 : 0}%;background:${colors[i]}"></i></div>${d.missing ? `<small>待补 ${d.missing} 分</small>` : ""}</div>`).join("")}</div>`; }
  function scoreEvidence(c) {
    const s = c.score;
    return `<div class="score-summary"><div>${scoreLabel(c)}<p class="muted">${s.applicable ? "财务质量分 / 100" : "研发商业化阶段，成熟企业评分不适用"}</p></div><div class="score-evidence"><span>原始分 <b>${fmt(s.raw)}</b></span><span>风险上限 <b>${s.applicable ? s.cap : "—"}</b></span><span>指标覆盖 <b>${s.coverage}%</b></span></div></div>${s.risks.length && s.applicable ? `<div class="notice">${s.risks.map(r => `${esc(r.label)}：上限${r.cap}分`).join("；")}</div>` : ""}${!s.applicable ? '<div class="notice">该公司单列研发观察池，重点跟踪现金消耗、融资、产品商业化与管线。下方为已披露财务事实，未计算可比总分或目标价。</div>' : ""}`;
  }
  function metricDetails(c) {
    return `<div class="table-wrap"><table class="formula-table"><thead><tr><th>评分指标</th><th>公式与口径</th><th>实际值</th><th>零分线</th><th>满分线</th><th>贡献 / 满分</th><th>数据状态</th></tr></thead><tbody>${c.score.details.map(d => `<tr><td>${d.dimension} · ${esc(d.label)}</td><td>${esc(d.formula)}</td><td>${fmt(d.value, 2)} ${esc(d.unit)}</td><td>${d.zero} ${esc(d.unit)}</td><td>${d.full} ${esc(d.unit)}</td><td>${c.score.applicable ? fmt(d.points, 2) : "—"} / ${d.weight}</td><td>${tag(d.status === "missing" ? "待补资料" : d.status === "economic_invalid" ? "分母经济无效" : "已取得", d.status === "observed" ? "good" : "warn")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function stock() {
    const c = company(state.code) || state.data.companies[0], peer = company(state.compare);
    state.code = c.code;
    const row = annual(c), previous = annual(c, 2024), interim = c.interim.find(r => r.period === "20260630") || {};
    root.innerHTML = header(`${esc(c.name)} <small style="font-size:15px;font-weight:400;color:var(--muted)">${c.code}</small>`, `<label>主标的 <select id="company">${companyOptions(c.code)}</select></label><label>对照 <select id="peer"><option value="">无</option>${companyOptions(state.compare)}</select></label>`)
      + `<div class="context-line">${tag(c.sector)} ${tag(c.stage === "biotech" ? "研发商业化观察" : "持续经营研究", "blue")} ${peer && peer.profile !== c.profile ? tag("跨子行业：评分锚点不同", "warn") : ""}<span>年报 2025-12-31 · 最新中报 2026-06-30 · 金额单位：人民币</span></div>`
      + `<div class="kpi-strip">${kpi("2025A 营业收入", fmt(yi(row.revenue), 2), "亿元", `同比 ${delta(change(row.revenue, previous.revenue))}`)}${kpi("2025A 扣非归母净利润", fmt(yi(row.adjusted_profit), 2), "亿元", `扣非净利率 ${percent(row.adjusted_margin)}`)}${kpi("2025A 经营现金流", fmt(yi(row.cfo), 2), "亿元", `扣除资本开支后 ${fmt(yi(row.fcf), 2)} 亿`)}${kpi("2026H1 营业收入", fmt(yi(interim.revenue), 2), "亿元", "中报仅作跟踪，不并入年度评分")}</div>`
      + scoreEvidence(c) + dimensionStrip(c)
      + `<nav class="section-tabs" aria-label="公司研究章节"><a href="#financial">盈利与现金</a><a href="#operating">研发与资产</a><a href="#evidence">评分证据</a><a href="#valuation">估值与产业</a><a href="#sources">数据来源</a></nav>`
      + section("financial", "盈利与现金", peer ? `主标的：${esc(c.name)} / 对照：${esc(peer.name)}` : "2021–2025年报 · 缺失年份不插值", `<div class="chart-grid">${panel("stock-revenue", "营业收入", "完整年度 · 亿元")}${panel("stock-margin", "扣非归母净利率", "完整年度 · %")}${panel("stock-cash", "现金流与再投资", "主标的 · 亿元", "自由现金流 = CFO − 全部资本开支；未扣融资租赁本金，不是严格FCFF")}${panel("stock-score", "五维财务贡献对照", "固定2023–2025窗口 · 分", "子行业满分锚点可能不同；研发观察池不绘制贡献")}</div>`)
      + section("operating", "研发与资产质量", "研发费用不等于总研发投入；开发支出是资产存量", `<div class="chart-grid">${panel("stock-rd", "研发与销售费用率", "主标的 · %", "研发资本化率与授权收入需年报附注核验；未取得时保留缺失")}${panel("stock-assets", "营运资金与商誉", "主标的 · 亿元", "期末应收与存货反映公司报表占用，不等于终端或渠道库存")}</div>`)
      + section("footnotes", "年报附注与经营证据", "AKShare缺少的附注指标优先核对PDF；独立观察，不加财务分", supplementTable(c))
      + section("evidence", "财务评分证据", `${esc(c.profile)}子行业锚点 · 每项保留计算依据`, metricDetails(c))
      + section("valuation", "估值与产业研究", "财务质量与价格分别判断", `<div class="detail-grid"><div>${researchGridForCompany(c)}<p class="muted">V1未采集同一交易日股价与股本，不输出PE、低估标签或买入排序。</p></div><div><h3>待核验事项</h3><ul class="rules"><li>集采、医保谈判与DRG/DIP对产品结构及价格的影响</li><li>商誉减值、审计意见、关联交易与重大处罚</li><li>授权首付款、里程碑与销售提成分开核验</li><li>医院及药店租赁负债、门店/医院成熟度与扩张现金支出</li></ul></div></div>`)
      + section("sources", "数据来源与口径", "AKShare → 财报PDF → iFinD补缺", `<div class="source-list">${c.sources.map(s => `<div class="source-row"><div>${tag("AKShare", "good")}<small>${esc(s.kind)}</small></div><div><a href="${esc(s.file)}" target="_blank" rel="noopener">${esc(s.function)} · ${esc(s.upstream)}</a><p>合并人民币报表，保留原始字段、公告日期与空值。</p></div><small>采集 ${esc(s.retrieved.slice(0, 10))}<br>${s.rows} 个报告期</small></div>`).join("")}</div><details><summary>原始财务字段映射（2025年报）</summary><div class="table-wrap"><table><thead><tr><th>字段</th><th>原始列名</th><th>来源</th></tr></thead><tbody>${Object.entries(row.field_sources || {}).map(([key, source]) => `<tr><td>${esc(key)}</td><td>${esc(source.column)}</td><td>${source.provider} / ${source.kind}</td></tr>`).join("")}</tbody></table></div></details>`);
    const years = [2021, 2022, 2023, 2024, 2025], cs = [c, peer].filter(Boolean);
    const trend = key => cs.map((item, i) => ({ label: item.name, borderColor: colors[i], backgroundColor: colors[i], data: years.map(y => key.includes("margin") ? annual(item, y)[key] ?? null : yi(annual(item, y)[key])) }));
    plot("stock-revenue", years, trend("revenue")); plot("stock-margin", years, trend("adjusted_margin"), "%");
    plot("stock-cash", years, [["cfo", "经营现金流"], ["capex", "全部资本开支"], ["fcf", "自由现金流"]].map(([key, label]) => ({ label, data: years.map(y => yi(annual(c, y)[key])) })));
    plot("stock-score", state.data.model.dimensions.map(d => d.label), cs.filter(item => item.score.applicable).map(item => ({ type: "bar", label: item.name, data: item.score.dimensions.map(d => d.missing ? null : d.points), borderWidth: 0 })), "分");
    plot("stock-rd", years, [["rd_ratio", "研发费用率"], ["sales_ratio", "销售费用率"]].map(([key, label]) => ({ label, data: years.map(y => annual(c, y)[key] ?? null) })), "%");
    plot("stock-assets", years, [["receivables", "应收账款"], ["inventory", "存货"], ["goodwill", "商誉"]].map(([key, label]) => ({ label, data: years.map(y => yi(annual(c, y)[key])) })));
  }
  function supplementTable(c) {
    const records = c.supplements || [];
    if (!records.length) return `<div class="notice">该公司的附注项目尚待PDF核验，未用同业数据或开发支出余额补齐。${esc(c.sector)}研究项见下方产业模块。</div>`;
    return `<div class="table-wrap"><table class="formula-table"><thead><tr><th>附注指标</th><th>报告口径</th><th>报告期</th><th>已核验值</th><th>来源</th></tr></thead><tbody>${records.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.note)}</td><td>${r.period.slice(0, 4)}年报</td><td>${r.unit === "元" ? fmt(r.value / 1e8, 2) + " 亿元" : fmt(r.value / 1e4, 2) + " 万" + esc(r.unit)}</td><td><a href="${esc(r.file)}#page=${r.pdf_page}" target="_blank" rel="noopener">PDF · 第${r.pdf_page}页 ${icon("arrow-up-right")}</a></td></tr>`).join("")}</tbody></table></div>`;
  }
  function researchGridForCompany(c) {
    const r = state.data.research.sectors?.find(s => s.name === c.sector);
    return r ? `<h3>${esc(r.name)} · ${esc(r.valuation)}</h3><p>${esc(r.focus)}</p><p class="muted">${esc(r.indicators)}</p>` : `<h3>${esc(c.sector)}</h3><p class="muted">产业证据待补充。</p>`;
  }
  function formula() {
    const c = company(state.code) || state.data.companies[0];
    root.innerHTML = header("医疗健康评分方法", `<label>计算示例 <select id="company">${companyOptions(c.code)}</select></label>`) + `<div class="notice">V1为本项目的财务研究模型，权重和阈值是可调整假设，尚未做历史收益回测。总分不代表估值、药品临床成功率或投资建议。</div>`
      + section("weights", "五维财务质量 · 100分", "完整年报窗口：2023–2025；营收CAGR以2022为基期", `<div class="method-band">${state.data.model.dimensions.map((d, i) => `<span style="width:${d.weight}%;background:${colors[i]}">${d.label} ${d.weight}</span>`).join("")}</div><div class="prose"><p>采用共同财务维度与子行业绝对锚点。单项贡献 = 权重 × clamp((实际值 − 零分线) / (满分线 − 零分线), 0, 1)。反向指标通过倒置锚点处理。同行样本增加不改变本公司的得分。</p><p>成熟经营样本可按本模型筛查，仍优先比较同子行业。百济神州、泽璟制药单列研发商业化观察池，避免将研发亏损机械解释为企业价值差。</p></div>`)
      + section("example", `${esc(c.name)} · 逐项复算`, `数据状态：${c.score.status === "complete" ? "完整" : c.score.status === "research_only" ? "研究观察池" : "部分缺失"}`, scoreEvidence(c) + dimensionStrip(c) + metricDetails(c))
      + section("anchors", "子行业满分锚点", "应收收入比为反向指标：下表是零分线，满分线统一5%", `<div class="table-wrap"><table><thead><tr><th>模型分类</th><th>ROE满分线</th><th>扣非净利率满分线</th><th>累计FCF率满分线</th><th>应收收入比零分线</th></tr></thead><tbody>${Object.entries(state.data.model.profiles).map(([name, p]) => `<tr><td>${esc(name)}</td><td>${p.roe}%</td><td>${p.margin}%</td><td>${p.fcf}%</td><td>${p.receivables}%</td></tr>`).join("")}</tbody></table></div>`)
      + section("risk", "风险上限与缺失处理", "原始分 → 风险约束 → 最终分", `<div class="detail-grid"><div><h3>已纳入的风险闸门</h3><ul class="rules"><li>最新完整年归母或扣非亏损：上限49分</li><li>连续两年经营现金流为负：上限49分</li><li>三年自由现金流合计非正：上限59分</li><li>归母净资产非正：上限39分</li><li>多项触发时取最低上限；风险必要数据缺失则不排名</li></ul></div><div><h3>缺数据与经营差分开</h3><ul class="rules"><li>任何评分缺项：总分留空，展示已知分与可能范围；不补零、不归一化</li><li>累计利润非正且输入完整：现金转化/扣非占比计零，标记经济无效</li><li>ROE使用期初期末平均归母权益，不冒充ROIC</li><li>货币资金未扣受限资金，仅作流动性粗代理</li><li>商誉、租赁负债、处罚与审计意见独立核验；未核验不等于无风险</li></ul></div></div>`)
      + section("limits", "医疗行业的额外判断", "财务指标之外的独立研究模块", `<div class="prose"><p>研发投入不采用“越高越好”的线性加分：需看产品阶段、临床价值、商业化与资本化口径。研发费用率来自利润表，资本化研发需年报附注；开发支出资产余额不能替代当年资本化投入。对外授权收入可能属经常性业务，不能假设扣非利润已经剔除全部授权收益。</p><p>现金流统一使用合并CFO对应合并净利润。简化FCF扣全部长期资产购建现金，尚未拆分维持与扩张投入，未扣融资活动中的租赁本金。医疗服务与药店的租赁现金支出分类影响可比性。资产负债率含租赁负债，不等于有息债务率。</p><p>估值框架分开：成熟药企/器械参考PE与DCF，CXO看正常化盈利和订单，研发型药企看管线rNPV与融资持续性，流通和零售看低利润率下的周转及资本回报。V1没有充分项目参数，不输出rNPV结果、目标股价或质量与估值混合的买入分。</p></div>`)
      + section("sources", "研究依据与版本记录", "2026-10-18 · 首版研究框架", evidence());
  }
  function render() {
    state.charts.forEach(c => c.destroy()); state.charts = []; state.configs = {};
    ({ industry, compare: comparison, stock, formula })[state.page]();
    root.setAttribute("aria-busy", "false"); window.lucide?.createIcons(); window.__healthcareReady = true;
  }
  function updateURL() {
    const url = new URL(location.href); url.searchParams.set("code", state.code);
    if (state.compare) url.searchParams.set("compare", state.compare); else url.searchParams.delete("compare");
    history.replaceState(null, "", url);
  }
  function exportCSV() {
    const columns = columnGroups[state.group];
    const quote = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["公司", "代码", "子行业", "财报期", "财务分(2023-2025)", ...columns.map(([, label, unit]) => `${label}(${unit})`)], ...filtered().map(c => [c.name, c.code, c.sector, state.period, c.score.total ?? "", ...columns.map(([key, , unit]) => { const v = fieldValue(c, key); return valid(v) ? unit === "亿" ? v / 1e8 : v : ""; })])];
    const blob = new Blob(["\uFEFF" + lines.map(row => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `医疗健康_${state.period}_${state.group}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function enlarge(id) {
    const config = state.configs[id]; if (!config) return;
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<header><h3>${esc($(id).getAttribute("aria-label"))}</h3><button class="icon-button" title="关闭图表" aria-label="关闭图表">${icon("x")}</button></header><div class="chart-box"><canvas></canvas></div>`;
    document.body.append(dialog); dialog.showModal();
    const copy = JSON.parse(JSON.stringify(config)); const chart = new Chart(dialog.querySelector("canvas"), copy);
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.addEventListener("click", event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener("close", () => { chart.destroy(); dialog.remove(); }); window.lucide?.createIcons();
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.sector) { state.sector = button.dataset.sector; render(); }
    if (button.dataset.group) { state.group = button.dataset.group; render(); }
    if (button.dataset.sort) { const key = button.dataset.sort; state.direction = state.sort === key ? -state.direction : key === "name" ? 1 : -1; state.sort = key; updateComparison(); }
    if (button.dataset.remove) { state.selected.delete(button.dataset.remove); updateComparison(); }
    if (button.dataset.enlarge) enlarge(button.dataset.enlarge);
    if (button.id === "reset") { Object.assign(state, { sector: "全部", search: "", status: "all", sort: "score", direction: -1 }); state.selected.clear(); render(); }
    if (button.id === "export") exportCSV();
    if (button.id === "compare-selected" && state.selected.size === 2) { const [a, b] = state.selected; location.href = `stock.html?code=${a}&compare=${b}`; }
  });
  root.addEventListener("change", event => {
    const target = event.target;
    if (target.id === "period") { state.period = target.value; render(); }
    if (target.id === "status") { state.status = target.value; updateComparison(); }
    if (target.id === "company") { state.code = target.value; if (state.compare === state.code) state.compare = ""; updateURL(); render(); }
    if (target.id === "peer") { state.compare = target.value === state.code ? "" : target.value; updateURL(); render(); }
    if (target.dataset.select) { const code = target.dataset.select; if (target.checked && state.selected.size < 2) state.selected.add(code); else { state.selected.delete(code); target.checked = false; } updateSelection(); }
  });
  root.addEventListener("input", event => { if (event.target.id === "search") { state.search = event.target.value; updateComparison(); } });
  fetch("data.json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(`数据读取失败 (${r.status})`); return r.json(); }).then(data => { state.data = data; if (!sectors().includes(state.sector)) state.sector = "全部"; navigation(); render(); }).catch(error => { root.setAttribute("aria-busy", "false"); root.innerHTML = `<div class="error"><h2>研究数据暂不可用</h2><p>${esc(error.message)}</p><button id="reload">重新加载</button></div>`; $("reload").onclick = () => location.reload(); });
})();
