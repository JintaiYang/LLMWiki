(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const fmt = (v, d = 1) => num(v) === null ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: d }).format(v);
  const pct = (v) => num(v) === null ? "—" : fmt(v) + "%";
  const yi = (v) => num(v) === null ? null : v / 1e8;
  const colors = ["#087f70", "#3679cc", "#c18c35", "#aa6a91", "#7a8c53", "#be4c48"];
  const state = { data: null, industry: null, pnl: {}, pnlYear: "", companies: [], page: document.body.dataset.page, charts: [], period: "", styleFilters: new Set(), metricGroup: "profit", metricPeriod: "", metricQuery: "", sort: "score", dir: -1, selected: new Set(), compareMode: false, onlySelected: false, code: "", compare: "", range: 20, scale: "amount" };
  const root = $("workspace");
  root.addEventListener("toggle", (event) => {
    if (!event.target.matches?.(".score-dimension-card")) return;
    const dock = root.querySelector(".score-analysis-dock");
    if (!dock) return;
    for (const panel of Array.from(dock.children)) {
      root.querySelector(`[data-score-dimension="${panel.dataset.analysisOwner}"]`)?.append(panel);
    }
    const open = root.querySelector(".score-dimension-card[open]");
    const panel = open?.querySelector(".dimension-analysis");
    if (panel) dock.append(panel);
    dock.hidden = !panel;
  }, true);
  const valuationState = { data: null, error: "", source: "long", range: 10, cache: new Map() };
  let knowledgePack = null;
  const reportComponentMetrics = new Set(["current_ratio", "quick_ratio_multiple", "contract_liabilities"]);
  let helpCompany = "";
  const metricGlossary = {
    cfo: "CFO = 经营活动现金流量净额。卖货收款减去采购、工资和税费等经营支出后的现金净额。正数表示经营净流入，不能直接当作净利润。",
    cfi: "CFI = 投资活动现金流量净额。包括建厂买设备、股权投资、理财及资产处置等现金进出。负数可能是在扩产或投资，正数也可能来自卖资产，不能单看正负判断好坏。",
    cff: "CFF = 筹资活动现金流量净额。包括借款、发股、还债和现金分红等。负数可能是还债或分红，正数可能是新增融资，不代表经营赚钱。",
    cash_net_increase: "现金及现金等价物净增加额：本报告期现金余额净变化，包含汇率变动等影响，不一定等于CFO、CFI、CFF三项简单相加。",
    owner_fcf: "简化自由现金流：经营现金流减购建长期资产支付的全部现金。没有拆分维持与扩张投入，不等于可随意分红的钱，也不是严格的FCFF或FCFE。",
    capex_intensity: "资本开支强度 = 购建固定资产、无形资产和其他长期资产支付的现金 ÷ 同期营业收入 × 100%。例如2%表示每100元收入对应约2元购建长期资产的现金支出，不代表当期利润直接减少2元。高值可能来自扩产、技改或收入下降；低值可能是投入需求较小，也可能是暂缓投入，不能简单认为越低越好。这里不包含购买同业存单等金融投资，未区分维持性与扩张性资本开支；分子、分母须采用同一报告期间。",
    fcff: "FCFF = 企业自由现金流，近似表示经营和必要再投资后，可供债权人与股东的现金。这里使用简化外推，依赖税率、折旧和营运资金假设，不是目标股价。",
    roa: "ROA = 总资产收益率。用合并净利润除以期初、期末平均总资产，观察全部资产的盈利效率。与归母净利润口径的ROE不同。",
    roe: "ROE = 归母净资产收益率。用归母净利润除以平均归母权益。高ROE也可能由较高负债或较少权益造成，需要结合资产负债表。",
    roic: "ROIC = 投入资本回报率。观察经营投入的资本创造多少税后经营收益。缺少严格投入资本口径时留空，不用ROE代替。",
    current_ratio: "流动资产 / 流动负债；具体构成以所选公司、报告期原表为准。",
    quick_ratio_multiple: "（流动资产 − 存货）/ 流动负债；本页采用简式计算。",
    contract_liabilities: "具体项目以所选公司、报告期附注为准。",
    basic_eps: "EPS = 基本每股收益。采用财报披露的加权平均股数口径，不是简单用净利润除以年末股数。",
    current_pe: "静态PE = 当前快照收盘价 × 同日总股本 / 最新完整年归母净利润。表示以过去一年利润计算的价格倍数，非TTM；亏损时不适用。",
    cfo_conversion: "五年累计经营现金转化：五年CFO合计 / 同期合并净利润合计，观察账面利润有多少现金支撑。不是单年度净现比。",
    style_tag: "估值×基本面结合V5财务分与最新完整年报现金流计算的基准DCF。现价低于已核验可比的DCF每股价值时判为低估；净现金、股本或估值输入未核验时标记DCF估值待核验，不用PE或股息率替代。完整规则见评分方法。",
    pp: "pp = percentage points，百分点。利润率从20%升到22%，变化为+2 pp；相对增幅则是10%，两者不同。",
  };
  const explainedMetrics = new Set(["cfi", "cff", "fcff", "roic", "owner_fcf", "capex_intensity", "current_ratio", "quick_ratio_multiple", "contract_liabilities", "cfo_conversion", "fcf_conversion", "liquidity_constraint", "other_receivables_constraint", "receivables_constraint", "style_tag", "pp"]);
  const metricHelp = (key, label, formula = "") => explainedMetrics.has(key) ? `<button type="button" class="metric-help-button" data-metric-help="${esc(key)}" data-help-title="${esc(label)}" data-help-formula="${esc(formula)}" aria-label="${esc(label)}说明" title="${esc(label)}说明"><i data-lucide="circle-help"></i></button>` : "";
  let helpSource = null;
  let riskHelpTimer = null;
  function scheduleRiskHelpClose() {
    clearTimeout(riskHelpTimer);
    riskHelpTimer = setTimeout(() => {
      const panel = $("metric-explanation");
      if (helpSource?.dataset.riskCode && panel?.matches(":popover-open") &&
          !helpSource.matches(":hover, :focus") && !panel.matches(":hover, :focus-within")) panel.hidePopover();
    }, 180);
  }
  function riskExplanation(c) {
    const score = c.score;
    const list = (title, items) => items.length ? `<section class="risk-help-section"><h4>${esc(title)}</h4><ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>` : "";
    const missing = score.missing.map((key) => state.data.model.metric_definitions[key]?.label || key);
    const riskMissing = (score.risk_missing || []).map((key) => state.data.model.risk_rules.find((rule) => rule.key === key)?.label || key);
    const years = score.window_years || [];
    return `<p class="help-formula">${esc(years.length ? `${years[0]}–${years.at(-1)}` : score.annual_year)} 年财务评分</p>`
      + list("已触发风险", score.risk_gates.map((risk) => `${risk.label}；财务评分上限 ${risk.cap} 分`))
      + (score.risk_gates.length ? `<p>多项风险取最低上限 ${score.risk_cap} 分；最终分取原始分与该上限中的较小值。</p>` : "")
      + list("待复核事项", score.observations || [])
      + list("缺失评分指标", missing)
      + list("资料不足，尚未完成的风险核验", riskMissing)
      + (missing.length || riskMissing.length ? "<p>资料不足，完整评分暂留空，不参与排名。</p>" : "");
  }
  function positionMetricHelp() {
    const panel = $("metric-explanation");
    if (!panel?.matches(":popover-open")) return;
    if (!helpSource?.isConnected) { panel.hidePopover(); return; }
    const box = helpSource.getBoundingClientRect();
    panel.style.left = Math.max(12, Math.min(box.left - 12, innerWidth - panel.offsetWidth - 12)) + "px";
    const below = box.bottom + 8;
    panel.style.top = Math.max(12, Math.min(below + panel.offsetHeight <= innerHeight - 12 ? below : box.top - panel.offsetHeight - 8, innerHeight - panel.offsetHeight - 12)) + "px";
  }
  function reportComponentHelp(key) {
    const company = getCompany(state.page === "stock" ? state.code : helpCompany) || state.companies[0];
    const period = state.page === "stock" ? String(state.metricPeriod) : String(company.score.annual_year);
    const day = period.length === 4 ? period + "-12-31" : period;
    const entry = (knowledgePack?.entries || []).find((entry) => entry.id.endsWith("-components") && entry.kind === "report" && entry.status === "verified" && entry.company === company.code && entry.periods.includes(day) && entry.metrics.includes(key));
    const periodTitle = day.slice(0, 4) + ({ "12-31": "年报", "06-30": "中报", "03-31": "一季报", "09-30": "三季报" }[day.slice(5)] || day.slice(5));
    const picker = state.page === "compare" ? `<label class="report-help-company">公司<select id="report-help-company" aria-label="原报说明公司">${state.companies.map((c) => `<option value="${c.code}"${c.code === company.code ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : "";
    const context = `${picker}<p class="report-help-context">${esc(company.name)} · ${esc(periodTitle)} · 合并口径</p>`;
    if (!entry) return context + `<p>该公司本期原报构成尚未核对。</p><p class="help-formula">${esc(metricGlossary[key])}</p>`;
    const text = entry.answer.split(/\n\s*\n/).filter(Boolean).map((block) => `<p class="report-help-lines">${esc(block).replaceAll("\n", "<br>")}</p>`).join("");
    const evidence = entry.sources.map((reference) => {
      const source = knowledgePack.sources.find((s) => s.id === reference.source_id);
      return `<a href="/api/knowledge/source/${encodeURIComponent(reference.source_id)}" target="_blank" rel="noreferrer">${esc(source?.title || "原报告")} · 第${esc(reference.pages)}页</a>`;
    }).join("<br>");
    const url = "knowledge.html?" + new URLSearchParams({ company: company.code, metric: key, period: day }) + "#" + encodeURIComponent(entry.id);
    return context + text + (key === "contract_liabilities" ? "<p>年报未按经销商、直销、电商进一步拆分。</p>" : `<p class="help-formula">${esc(entry.summary)}</p>`)
      + `<p class="report-help-source">${evidence}<br><a href="${esc(url)}">查看原报构成与核验记录</a></p>`;
  }
  function showMetricHelp(button) {
    clearTimeout(riskHelpTimer);
    let panel = $("metric-explanation");
    if (button.dataset.riskCode && helpSource === button && panel?.matches(":popover-open")) return;
    if (!panel) {
      panel = document.createElement("div"); panel.id = "metric-explanation"; panel.className = "metric-explanation";
      panel.setAttribute("popover", "auto"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-labelledby", "metric-explanation-title");
      panel.addEventListener("toggle", positionMetricHelp);
      panel.addEventListener("beforetoggle", (event) => { if (event.newState === "closed") helpSource?.setAttribute("aria-expanded", "false"); });
      panel.addEventListener("pointerenter", () => clearTimeout(riskHelpTimer));
      panel.addEventListener("pointerleave", scheduleRiskHelpClose);
      panel.addEventListener("focusout", scheduleRiskHelpClose);
      document.body.append(panel);
    }
    helpSource?.setAttribute("aria-expanded", "false"); helpSource = button;
    const key = button.dataset.metricHelp, title = button.dataset.helpTitle, formula = button.dataset.helpFormula;
    const company = button.dataset.riskCode ? getCompany(button.dataset.riskCode) : null;
    const reportBased = reportComponentMetrics.has(key);
    const content = company ? riskExplanation(company) : reportBased ? reportComponentHelp(key) : `<p>${esc(metricGlossary[key] || formula || "缺少已核验口径，保持留空。")}</p>${metricGlossary[key] && formula ? `<p class="help-formula">${esc(formula)}</p>` : ""}`;
    const knowledge = !company && !reportBased && state.page === "stock" && window.LiquorKnowledge ? `<p><a href="${esc(window.LiquorKnowledge.href({ company: state.code, metric: key, period: state.metricPeriod }))}">查看对应报告期的知识与问答</a></p>` : "";
    panel.innerHTML = `<header><strong id="metric-explanation-title">${esc(title)}</strong><button class="icon-button" aria-label="关闭指标说明" title="关闭指标说明" popovertarget="metric-explanation" popovertargetaction="hide"><i data-lucide="x"></i></button></header>${content}${knowledge}`;
    const picker = panel.querySelector("#report-help-company");
    if (picker) picker.onchange = (event) => { helpCompany = event.target.value; showMetricHelp(helpSource); panel.querySelector("#report-help-company")?.focus({ preventScroll: true }); };
    window.lucide?.createIcons();
    if (!panel.matches(":popover-open")) panel.showPopover();
    button.setAttribute("aria-expanded", "true"); positionMetricHelp();
  }
  window.addEventListener("resize", positionMetricHelp);
  window.addEventListener("scroll", positionMetricHelp, { capture: true, passive: true });
  root.addEventListener("pointerover", (event) => {
    const button = event.target.closest("[data-risk-code]");
    if (button && event.pointerType !== "touch" && !button.contains(event.relatedTarget)) showMetricHelp(button);
  });
  root.addEventListener("pointerout", (event) => {
    const button = event.target.closest("[data-risk-code]");
    if (button && !button.contains(event.relatedTarget)) scheduleRiskHelpClose();
  });
  root.addEventListener("focusin", (event) => { if (event.target.matches("[data-risk-code]")) showMetricHelp(event.target); });
  root.addEventListener("focusout", (event) => { if (event.target.matches("[data-risk-code]")) scheduleRiskHelpClose(); });
  const annual = (c, year) => (c.annual || []).find((r) => String(r.year) === String(year)) || (String(c.annual_baseline?.year) === String(year) ? c.annual_baseline : {});
  const row = (c, period) => String(period).length === 4 || String(period).endsWith("-12-31") ? annual(c, String(period).slice(0, 4)) : (c.quarterly || []).find((r) => r.report_date === period) || {};
  const priorPeriod = (period) => String(Number(String(period).slice(0, 4)) - 1) + String(period).slice(4);
  const lastAnnualYear = () => Math.max(...state.companies.map((c) => c.score.annual_year || 0));
  const companyStyle = (c) => window.LiquorCompanyStyle.classify(c, lastAnnualYear());
  const styleBadge = (c) => { const tag = companyStyle(c); return `<span title="${esc(tag.reason)}">${badge(tag.label, tag.tone)}</span>`; };
  const modelVersion = () => String(state.data.model.version).split(".")[0];
  const scoreItem = (c, key) => (c.score.dimensions || []).flatMap((d) => d.items).find((i) => i.name === key) || {};
  const getCompany = (code) => state.companies.find((c) => c.code === code);
  const scoreLabel = (c) => c.score.total == null ? "评分待核验" : c.score.risk_cap < 100 ? "触发风险上限" : c.score.total >= 80 ? "财务表现较强" : c.score.total >= 60 ? "财务表现中等" : "财务表现偏弱";
  const tone = (c) => c.score.total == null ? "warn" : c.score.total >= 80 ? "good" : c.score.total < 60 || c.score.risk_cap < 100 ? "risk" : "blue";
  const badge = (label, kind = "") => `<span class="tag ${kind}">${esc(label)}</span>`;
  const scoreText = (c) => c.score.total == null ? "待核验" : fmt(c.score.total, 2);
  const change = (v, suffix = " 同比") => num(v) === null ? '<span class="change">同比不可比</span>' : `<span class="change ${v >= 0 ? "positive" : "negative"}">${v > 0 ? "+" : ""}${pct(v)}</span>${esc(suffix)}`;
  const safeRatio = (a, b, scale = 1) => num(a) !== null && num(b) !== null && b > 0 ? a / b * scale : null;
  const growth = (c, field, period) => {
    const a = row(c, period)[field], b = row(c, priorPeriod(period))[field];
    return periodChange(a, b).value;
  };
  function periodChange(current, previous, unit = "") {
    if (num(current) === null || num(previous) === null) return { value: null, unit: unit === "%" ? "pp" : "%", note: "相邻同期缺少可比值，YoY 缺失" };
    if (unit === "%") return { value: current - previous, unit: "pp", note: "" };
    if (previous === 0) return { value: null, unit: "%", note: "上年同期基数为零，YoY 不可比" };
    return { value: (current - previous) / Math.abs(previous) * 100, unit: "%", note: previous < 0 ? "上年同期基数为负，YoY 按差额 / |上年同期|计算" : "" };
  }
  function sum(field, period) {
    const date = String(period).length === 4 ? period + "-12-31" : String(period);
    const aggregate = state.industry?.financial_trends.find((point) => point.report_date === date);
    if (aggregate) return { value: num(aggregate[field]), count: aggregate.coverage[field] || 0 };
    const vals = state.companies.map((c) => num(row(c, period)[field]));
    return { value: vals.every((v) => v !== null) ? vals.reduce((a, b) => a + b, 0) : null, count: vals.filter((v) => v !== null).length };
  }
  function totalGrowth(field, period) {
    return periodChange(sum(field, period).value, sum(field, priorPeriod(period)).value).value;
  }
  function pageHead(title, detail, controls = "") {
    window.LiquorNavigation?.update({ code: state.code, version: modelVersion() });
    const dates = [...new Set(state.companies.map((c) => c.price?.price_date).filter(Boolean))];
    const dateLabel = dates.length === 1 ? dates[0] : dates.length ? dates.sort().at(0) + " 至 " + dates.at(-1) : "未核验";
    return `<header class="page-head"><div><h1>${esc(title)}${detail ? `<small>${esc(detail)}</small>` : ""}</h1><div class="meta"><span class="live-dot">${state.companies.length} 家上市样本</span><span>行情 ${esc(dateLabel)}</span><span>财务评分 ${lastAnnualYear()}A · ${esc(modelVersion())}</span><span>研究截至 ${esc(state.data.as_of)}</span></div></div><div class="head-controls">${controls}</div></header>`;
  }
  function kpi(label, value, unit, foot, tag = "") {
    return `<article class="kpi"><div class="kpi-label">${esc(label)}${tag}</div><div class="kpi-value">${value}<small>${esc(unit)}</small></div><div class="kpi-foot">${foot}</div></article>`;
  }
  function section(id, title, subtitle, content) {
    return `<section id="${id}" class="section"><div class="section-title"><h2>${esc(title)}</h2><small>${esc(subtitle)}</small></div>${content}</section>`;
  }
  function chartPanel(id, title, subtitle, unit = "", size = "", summary = "", helpKey = "") {
    return `<article class="chart-panel"><div class="chart-head"><div><h3>${esc(title)}${helpKey ? metricHelp(helpKey, title, subtitle) : ""}</h3>${helpKey ? "" : `<p>${esc(subtitle)}</p>`}</div><div class="chart-tools"><span class="chart-unit">${esc(unit)}</span><button class="icon-button" data-zoom="${id}" title="放大图表" aria-label="放大${esc(title)}"><i data-lucide="maximize-2"></i></button></div></div>${summary}<div class="chart-box ${size}"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div></article>`;
  }
  function nav(items) { return `<nav class="section-nav" aria-label="本页章节">${items.map(([id, name]) => `<a href="#${id}">${esc(name)}</a>`).join("")}</nav>`; }
  function footer() {
    return `<footer class="footer"><span>AKShare / 东方财富财报快照 · 缺项才使用已核验 iFinD 补充 · 上市样本不等于全行业</span><span>生成 ${esc(state.data.generated_at?.slice(0, 10) || "—")} · 研究假设，未经收益回测</span></footer>`;
  }
  function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }
  function mount(html) { destroyCharts(); root.innerHTML = html + footer(); root.setAttribute("aria-busy", "false"); window.lucide?.createIcons(); }
  root.addEventListener("click", (event) => {
    const help = event.target.closest("[data-metric-help]");
    if (help) { showMetricHelp(help); return; }
    const button = event.target.closest("[data-zoom]");
    if (!button) return;
    const canvas = $(button.dataset.zoom), original = canvas && Chart.getChart(canvas);
    if (!original) return;
    const panel = canvas.closest(".chart-panel");
    const dialog = document.createElement("dialog"); dialog.className = "chart-dialog";
    dialog.setAttribute("aria-label", panel.querySelector("h3").textContent + "放大视图");
    dialog.innerHTML = `<header><div><h2>${esc(panel.querySelector("h3").textContent)}</h2><span>${esc(panel.querySelector(".chart-unit").textContent)}${panel.querySelector(".chart-head p") ? " · " + esc(panel.querySelector(".chart-head p").textContent) : ""}</span></div><button class="icon-button" title="关闭放大视图" aria-label="关闭放大视图"><i data-lucide="x"></i></button></header><div class="chart-box"><canvas role="img" aria-label="${esc(panel.querySelector("h3").textContent)}放大图"></canvas></div>`;
    document.body.append(dialog); window.lucide?.createIcons(); dialog.showModal();
    const expanded = new Chart(dialog.querySelector("canvas"), { type: original.config.type, data: structuredClone(original.data), options: { ...original.config.options, onClick: undefined } });
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.addEventListener("close", () => { expanded.destroy(); dialog.remove(); });
    dialog.addEventListener("click", (e) => { if (e.target === dialog) { const box = dialog.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) dialog.close(); } });
  });
  function plot(id, type, labels, datasets, unit = "", extra = {}) {
    const canvas = $(id);
    if (!canvas) return;
    const hasPoint = (v) => num(v) !== null || Array.isArray(v) && v.every((n) => num(n) !== null) || v && typeof v === "object" && num(v.x) !== null && num(v.y) !== null;
    const hasData = datasets.some((d) => d.data.some(hasPoint));
    const zoom = root.querySelector(`[data-zoom="${CSS.escape(id)}"]`);
    if (zoom) zoom.disabled = !hasData;
    canvas.hidden = false;
    canvas.parentNode.querySelector(".chart-empty")?.remove();
    if (!hasData) {
      canvas.hidden = true;
      const empty = document.createElement("div"); empty.className = "chart-empty"; empty.textContent = extra.emptyLabel || "当前口径数据不足，未绘制序列"; canvas.parentNode.append(empty);
      return;
    }
    const horizontal = extra.indexAxis === "y";
    const options = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: type === "scatter" ? "nearest" : "index", intersect: type === "scatter" },
      layout: { padding: { top: 3, right: 6 } },
      plugins: {
        legend: { display: datasets.length > 1, position: "bottom", labels: {
          usePointStyle: true, pointStyleWidth: 18, boxWidth: 18, boxHeight: 8, padding: 15, font: { size: 12 }, color: "#6b746f",
          generateLabels: (chart) => Chart.defaults.plugins.legend.labels.generateLabels(chart).map((item) => {
            const seriesType = chart.getDatasetMeta(item.datasetIndex).type;
            return { ...item, pointStyle: seriesType === "bar" ? "rect" : seriesType === "scatter" ? "circle" : "line",
              lineWidth: seriesType === "line" ? Math.max(item.lineWidth, 2) : item.lineWidth,
              lineDash: seriesType === "line" ? chart.data.datasets[item.datasetIndex].borderDash || [] : item.lineDash };
          }),
        } },
        tooltip: { backgroundColor: "#253d33", padding: 11, titleFont: { size: 13 }, bodyFont: { size: 13 }, displayColors: true,
          callbacks: { label: (ctx) => `${ctx.dataset.label || ""}  ${fmt(horizontal ? ctx.parsed.x : ctx.parsed.y, 2)}${unit}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: "#7c8780", font: { size: 12 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
        y: { grid: { color: "#edf0ee", drawTicks: false }, border: { display: false }, ticks: { padding: 8, color: "#7c8780", font: { size: 12 }, maxTicksLimit: 5, callback: (v) => fmt(v, 1) }, beginAtZero: type === "bar" },
      },
    };
    if (horizontal) {
      options.scales.x = { ...options.scales.y, beginAtZero: true };
      options.scales.y = { grid: { display: false }, border: { display: false }, ticks: { color: "#637069", font: { size: 13 }, autoSkip: false } };
    }
    if (extra.scales) Object.entries(extra.scales).forEach(([key, val]) => { options.scales[key] = { ...(options.scales[key] || {}), ...val }; });
    if (extra.tooltip) options.plugins.tooltip.callbacks = extra.tooltip;
    if (extra.onClick) options.onClick = extra.onClick;
    if (extra.indexAxis) options.indexAxis = extra.indexAxis;
    if (extra.legend === false) options.plugins.legend.display = false;
    const ds = datasets.map((d, i) => ({ borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length] + "ba", borderWidth: type === "line" || d.type === "line" ? 2 : 0,
      pointRadius: type === "scatter" ? 5 : 2, pointHoverRadius: 5, pointHitRadius: 12, tension: .12, spanGaps: false, maxBarThickness: horizontal ? 15 : 28, borderRadius: type === "bar" ? 2 : 0, ...d }));
    state.charts.push(new Chart(canvas, { type, data: { labels, datasets: ds }, options }));
  }
  function dataset(label, data, color, extras = {}) { return { label, data, borderColor: color, backgroundColor: color + "b8", ...extras }; }
  function periodOptions() {
    const quarters = [...new Set(state.companies.flatMap((c) => (c.quarterly || []).map((r) => r.report_date)))].sort().reverse();
    return quarters.filter((p) => p.endsWith("06-30") || p.endsWith("09-30")).slice(0, 4).map((p) => [p, p.endsWith("06-30") ? p.slice(0, 4) + " 中报" : p.slice(0, 4) + " 三季报"])
      .concat([...new Set(state.companies.flatMap((c) => c.annual.map((r) => r.year)))].sort((a, b) => b - a).map((year) => [String(year), year + " 年报"]));
  }
  function options(items, value) { return items.map(([key, name]) => `<option value="${esc(key)}"${String(key) === String(value) ? " selected" : ""}>${esc(name)}</option>`).join(""); }
  function companyOptions(value, allowNone = false) { return options((allowNone ? [["", "不设对比"]] : []).concat(state.companies.filter((c) => !allowNone || c.code !== state.code).map((c) => [c.code, c.name])), value); }
  function industryEvidence() {
    const research = state.industry.research;
    if (!research) return section("industry-evidence", "行业研究证据", "", '<div class="banner warning">研究指标字典待接入，暂不推断终端景气。</div>');
    const day = state.period.length === 4 ? state.period + "-12-31" : state.period;
    const snapshot = research.snapshots.find((s) => s.report_date === day);
    const diagnostics = snapshot?.diagnostics || [];
    const rows = diagnostics.map((m) => `<tr data-diagnostic="${esc(m.key)}"><th>${esc(m.label)}</th><td class="research-number">${fmt(m.value, 2)}${m.value == null ? "" : " " + esc(m.unit === "百分点" ? "pp" : m.unit)}</td><td>${m.coverage}/${m.sample_count}</td><td>${esc(m.caution)}<details><summary>计算口径</summary><p>${esc(m.formula)}</p></details></td></tr>`).join("");
    return section("industry-evidence", "经营信号与证据边界", day + " · 仅上市厂商样本",
      `<div class="banner${snapshot?.status === "pressure" ? " warning" : ""}"><strong>${esc(snapshot?.judgment || "所选报告期研究证据不足")}</strong><p>${esc(snapshot?.facts.join("；") || "未取得连续同期数据。")}</p><p>${esc(snapshot?.boundary || "不据缺项推断行业状态。")}</p></div>`
      + `<div class="research-chain"><span>终端需求</span><span>成交价格</span><span>渠道库存</span><span>厂商回款</span><span>利润与现金</span><span>长期资本回报</span></div>`
      + `<div class="table-wrap"><table class="research-metrics"><thead><tr><th>验证指标</th><th>当前值</th><th>有效公司</th><th>解释与局限</th></tr></thead><tbody>${rows || '<tr><td colspan="4">所选报告期缺少诊断数据</td></tr>'}</tbody></table></div>`);
  }
  function industryTracking() {
    const research = state.industry.research;
    if (!research) return "";
    const sources = Object.fromEntries(research.sources.map((s) => [s.id, s]));
    const rows = research.tracking.map((m) => `<tr data-tracking="${esc(m.key)}"><th>${esc(m.label)}<small>${esc(m.group)} · ${esc(m.priority)}</small></th><td>${badge("待采集", "warn")}<small>暂无可用观测值</small></td><td>${esc(m.frequency)}</td><td>${esc(m.interpretation)}<details><summary>口径、误读与依据</summary><p>${esc(m.formula)}</p><p>${esc(m.caveat)}</p>${m.source_ids.map((id) => sources[id] ? `<a href="#source-${esc(id)}">${esc(sources[id].title)}</a>` : "").join("<br>")}</details></td></tr>`).join("");
    return section("industry-tracking", "需求、价格与渠道跟踪", `方法核对 ${research.reviewed_on} · 独立于财报选择器`,
      '<p class="note-line">尚无通过口径验收的终端连续序列。以下为需要采集的研究指标，不将旧报道、酒厂库存或单日网购报价填成当前渠道数据。</p>'
      + `<div class="table-wrap"><table class="research-metrics"><thead><tr><th>跟踪指标</th><th>当前观测</th><th>更新频率</th><th>价值判断</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }
  function industrySources() {
    const research = state.industry.research;
    if (!research) return "";
    return section("industry-sources", "研究来源与验收", `方法核对 ${research.reviewed_on} · 财报快照截至 ${research.financial_as_of}`,
      `<ul class="source-list">${research.sources.map((s) => `<li id="source-${esc(s.id)}"><strong>${s.url || s.file ? `<a href="${esc(s.url || s.file)}" target="_blank" rel="noreferrer">${esc(s.title)}</a>` : esc(s.title)}</strong> ${badge(s.kind)}<p>${esc(s.date)} · ${esc(s.location)}</p><p>${esc(s.finding)}</p></li>`).join("")}</ul>`
      + `<div class="banner warning"><strong>数据验收</strong><p>${esc(research.admission)}</p>${research.rejected.map((r) => `<p>${esc(r.indicator)}：${esc(r.reason)}</p>`).join("")}</div>`);
  }
  function renderIndustry() {
    const p = state.period;
    const suffix = String(p).length === 4 ? "12-31" : p.slice(5);
    const periodLabel = suffix === "12-31" ? p.slice(0, 4) + "年报" : p.slice(0, 4) + (suffix === "06-30" ? "中报" : "三季报");
    const periodType = suffix === "12-31" ? "完整年度" : suffix === "06-30" ? "上半年同期" : "前三季度同期";
    const dates = state.industry.financial_trends.map((point) => point.report_date).filter((day) => day >= `${state.data.history?.start_year || 2006}-01-01` && day.endsWith(suffix) && day.slice(0, 4) <= p.slice(0, 4)).slice(-20);
    const periods = dates.map((day) => suffix === "12-31" ? day.slice(0, 4) : day);
    const labels = dates.map((day) => day.slice(0, 4) + (suffix === "12-31" ? "A" : suffix === "06-30" ? "H1" : "9M"));
    const metrics = [["revenue", "营业收入"], ["net_profit", "归母净利润"], ["cfo", "经营现金流"], ["contract_liabilities", "合同负债"]];
    const cards = metrics.map(([key, title]) => {
      const s = sum(key, p);
      return kpi(periodLabel + " · " + title, fmt(yi(s.value), 2), "亿元", change(totalGrowth(key, p)) + ` <span>· ${s.count}/${state.companies.length} 家</span>`);
    }).join("");
    const charts = chartPanel("ind-revenue", "营业收入与增长", periodType + " · 营业收入，不含另列的利息收入", "亿元 / YoY %") + chartPanel("ind-cash", "利润与现金流", periodType + " · 归母净利与合并经营现金流", "亿元 / YoY %")
      + chartPanel("ind-margins", "盈利与现金创造", periodType + " · 合计分子 / 合计营收", "% / 同比pp") + chartPanel("ind-channel", "厂商存货与合同负债", "同一报告日余额 · 非经销商库存", "亿元 / YoY %");
    mount(pageHead("白酒行业", "行业研究与上市样本", `<label>财报口径<select id="industry-period">${options(periodOptions(), p)}</select></label>`)
      + `<div class="kpi-strip">${cards}</div><p class="note-line">${esc(p)}${String(p).length > 4 ? " 年初至今累计；同比为去年同报告期，合同负债为期末余额。" : " 完整年度；同比为上一完整年，合同负债为期末余额。"} 数据为19家上市公司合计，非全国行业总量；营业收入与营业总收入、归母净利与合并净利分别核算。</p>`
      + nav([["industry-evidence", "经营信号"], ["industry-tracking", "需求与渠道"], ["trends", "长期经营"], ["dispersion", "公司分化"], ["sample", "样本明细"], ["industry-sources", "来源与验收"]])
      + industryEvidence()
      + industryTracking()
      + section("trends", "长期经营趋势", `${dates[0]?.slice(0, 4) || "—"}–${p.slice(0, 4)} ${periodType} · 同样本覆盖才合计`, `<div class="chart-grid">${charts}</div>${historyCoverage(dates)}`)
      + section("dispersion", "公司分化", p + " · 同口径", `<div class="chart-grid">${chartPanel("ind-dispersion", "营业收入同比", "公司间分化 · 负增长向左", "%", "tall")}${chartPanel("ind-concentration", "样本营业收入结构", "前八家公司及其余样本", "亿元", "tall")}</div>`)
      + section("sample", "上市样本明细", "顺鑫农业含非酒业务；郎酒、剑南春等未上市品牌不在样本内", `<div id="industry-sample-table"></div>`)
      + industrySources());
    $("industry-period").onchange = (e) => { state.period = e.target.value; history.replaceState({}, "", location.pathname + "?period=" + state.period); renderIndustry(); };
    const amount = (key) => (period) => sum(key, period).value;
    plotIndustryTrend("ind-revenue", "bar", labels, periods, [["营业收入", amount("revenue"), colors[0]]], "亿元");
    plotIndustryTrend("ind-cash", "bar", labels, periods, [["归母净利润", amount("net_profit"), colors[1]], ["经营现金流", amount("cfo"), colors[0]]], "亿元");
    plotIndustryTrend("ind-margins", "line", labels, periods, [["归母净利率", (period) => safeRatio(sum("net_profit", period).value, sum("revenue", period).value, 100), colors[1]], ["经营现金流 / 营收", (period) => safeRatio(sum("cfo", period).value, sum("revenue", period).value, 100), colors[0]]], "%");
    plotIndustryTrend("ind-channel", "line", labels, periods, [["厂商存货", amount("inventory"), colors[2]], ["合同负债", amount("contract_liabilities"), colors[3]]], "亿元");
    const dispersion = state.companies.map((c) => ({ c, g: growth(c, "revenue", p) })).sort((a, b) => (b.g ?? -Infinity) - (a.g ?? -Infinity));
    plot("ind-dispersion", "bar", dispersion.map((x) => x.c.name), [{ label: "营收同比", data: dispersion.map((x) => x.g), backgroundColor: dispersion.map((x) => x.g >= 0 ? colors[0] + "be" : colors[5] + "be") }], "%", { indexAxis: "y", onClick: (_, hits) => { if (hits.length) location.href = "stock.html?code=" + dispersion[hits[0].index].c.code; } });
    const byRevenue = state.companies.map((c) => ({ c, v: num(row(c, p).revenue) })).filter((x) => x.v !== null).sort((a, b) => b.v - a.v);
    const top = byRevenue.slice(0, 8), remainder = byRevenue.slice(8).reduce((a, x) => a + x.v, 0);
    plot("ind-concentration", "bar", top.map((x) => x.c.name).concat(["其余 " + (byRevenue.length - top.length) + " 家"]), [{ label: "营业收入", data: top.map((x) => yi(x.v)).concat([yi(remainder)]), backgroundColor: top.map((_, i) => colors[i % colors.length] + "ba").concat(["#b7c3bb"]) }], "亿元", { indexAxis: "y" });
    const fields = [["revenue", "营业收入"], ["net_profit", "归母净利润"], ["cfo", "经营现金流"], ["inventory", "厂商存货"], ["contract_liabilities", "合同负债"]];
    $("industry-sample-table").innerHTML = `<div class="table-wrap"><table><thead><tr><th>公司</th>${fields.map(([, name]) => `<th>${name} / 亿元</th><th>同比</th>`).join("")}<th>财务质量 / 100</th></tr></thead><tbody>${state.companies.map((c) => `<tr data-code="${c.code}"><td><a href="stock.html?code=${c.code}">${esc(c.name)}</a></td>${fields.map(([field]) => `<td data-field="${field}">${fmt(yi(row(c, p)[field]), 2)}</td><td>${financialChangeText(periodChange(row(c, p)[field], row(c, priorPeriod(p))[field]))}</td>`).join("")}<td>${scoreText(c)}</td></tr>`).join("")}</tbody><tfoot><tr><th>19家上市样本合计</th>${fields.map(([field]) => `<td data-total="${field}"><strong>${fmt(yi(sum(field, p).value), 2)}</strong></td><td>${financialChangeText(periodChange(sum(field, p).value, sum(field, priorPeriod(p)).value))}</td>`).join("")}<td>—</td></tr></tfoot></table></div>`;
  }

  function historyCoverage(dates) {
    const fields = [["revenue", "营业收入"], ["net_profit", "归母净利"], ["cfo", "经营现金流"], ["inventory", "存货"], ["contract_liabilities", "合同负债"]];
    const points = dates.map((day) => state.industry.financial_trends.find((point) => point.report_date === day));
    return `<details class="disclosure history-coverage"><summary>历史样本覆盖 · ${dates.length} 期</summary><p class="score-caption">按当前 ${state.companies.length} 家成分回溯已披露报表，并非当年的行业成分。任何一家缺项，该指标的固定样本合计留空；早期披露年限、上市前记录与会计准则变化会影响覆盖。合同负债不以旧准则预收款项直接替代。</p><div class="table-wrap"><table><thead><tr><th>报告期</th>${fields.map(([, label]) => `<th>${label} / 家</th>`).join("")}</tr></thead><tbody>${points.map((point) => `<tr><td>${point.report_date}</td>${fields.map(([key]) => `<td>${point.coverage[key] || 0} / ${state.companies.length}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  }

  function plotIndustryTrend(id, type, labels, periods, specs, unit) {
    const datasets = specs.map(([name, getter, color]) => dataset(name, periods.map((p) => unit === "亿元" ? yi(getter(p)) : getter(p)), color, { yAxisID: "y", valueUnit: unit }));
    const changes = specs.map(([name, getter], index) => {
      const values = periods.map((p) => periodChange(getter(p), getter(priorPeriod(p)), unit));
      return dataset(name + (unit === "%" ? " · 同比变化" : " · YoY"), values.map((value) => value.value), colors[(index + 4) % colors.length], {
        type: "line", yAxisID: "y1", valueUnit: unit === "%" ? "pp" : "%", yoyNotes: values.map((value) => value.note), borderDash: [4, 3], pointStyle: "triangle", pointRadius: 3,
      });
    });
    plot(id, type, labels, [...datasets, ...changes], "", {
      scales: {
        y: { title: { display: true, text: unit, color: "#6b746f", font: { size: 12 } } },
        y1: { type: "linear", position: "right", beginAtZero: true, border: { display: false },
          title: { display: true, text: unit === "%" ? "同比变化 / pp" : "YoY / %", color: "#6b746f", font: { size: 12 } },
          grid: { color: (context) => context.tick.value === 0 ? "#c18c3550" : "transparent", drawTicks: false },
          ticks: { color: "#7c8780", font: { size: 12 }, maxTicksLimit: 5, callback: (value) => fmt(value) + (unit === "%" ? "" : "%") } },
      },
      tooltip: {
        label: (context) => `${context.dataset.label}  ${context.dataset.yAxisID === "y1" && context.parsed.y > 0 ? "+" : ""}${fmt(context.parsed.y, 2)} ${context.dataset.valueUnit}`,
        afterBody: (items) => items.length ? changes.flatMap((d) => d.yoyNotes[items[0].dataIndex] ? [d.label + "：" + d.yoyNotes[items[0].dataIndex]] : []) : [],
      },
    });
  }

  const comparisonColumn = (key, label, kind, help = "", unit = kind) => ({ key, label, kind, help, unit: unit === "x" ? "倍" : unit });
  function comparisonGroups() {
    const definitions = state.data.model.metric_definitions;
    const catalog = state.data.financial_metrics?.metrics || {};
    const financialColumn = (key) => {
      const spec = catalog[key] || definitions[key];
      return comparisonColumn(key, spec?.label || key, spec?.unit || "", spec?.formula || "");
    };
    const core = [financialColumn("operating_margin"), financialColumn("roa"), financialColumn("cfo_conversion"), financialColumn("owner_fcf"),
      comparisonColumn("yield", "现价股息率", "%", "已实施归属年度现金分红 / 行情快照收盘价"), comparisonColumn("current_pe", "现价静态PE", "x", "同日收盘价 × 总股本 / 最新完整年归母净利润；非TTM，亏损不适用")];
    const dimensions = state.data.model.dimensions.map(([name, maximum], index) => comparisonColumn("dimension:" + name, "ABCDE"[index] + " " + name, "points", "五年窗口内该维已知单项贡献的合计；维度缺项则留空", "分 / " + maximum));
    const items = state.data.model.dimensions.flatMap(([, , specs]) => specs.map(([key, maximum]) => comparisonColumn("points:" + key, definitions[key].label, "points", definitions[key].formula, "分 / " + maximum)));
    const changes = ["revenue", "net_profit", "cfo", "owner_fcf", "operating_margin", "roa", "inventory", "contract_liabilities"].map((key) => {
      const spec = catalog[key];
      return comparisonColumn("yoy:" + key, spec.label + (spec.unit === "%" ? "变化" : "同比"), spec.unit === "%" ? "pp" : "%",
        spec.unit === "%" ? "本年比率减上年比率，单位为pp" : "(本年−上年)/abs(上年)×100；零基数或缺项留空，负基数另标注");
    });
    const groups = [
      { key: "dimensions", label: "五维评分", columns: dimensions },
      { key: "core", label: "核心指标", columns: core },
      { key: "score_items", label: "单项评分", columns: items },
      { key: "growth", label: "同比变化", columns: changes },
      ...(state.data.financial_metrics?.groups || []).map((group) => ({ key: group.id === "balance" ? "risk" : group.id === "shareholder" ? "dividend" : group.id, label: group.label, columns: group.metrics.map(financialColumn) })),
    ];
    groups.find((g) => g.key === "profit")?.columns.push(comparisonColumn("gross_sales_spread", "毛销差", "%", "毛利率减销售费用率，非净利率"), comparisonColumn("roic", "ROIC", "%", "严格投入资本回报率；资料不足时不以 ROE 替代"));
    groups.find((g) => g.key === "cash")?.columns.push(...["cfo_conversion", "fcf_conversion", "cfo_positive_ratio"].map(financialColumn));
    groups.find((g) => g.key === "risk")?.columns.unshift(...["liquidity_constraint", "receivables_constraint", "other_receivables_constraint"].map(financialColumn));
    groups.find((g) => g.key === "risk")?.columns.push(comparisonColumn("risks", "风险 / 缺项", "text", "评分风险上限、资料缺项及复核观察", ""));
    groups.find((g) => g.key === "dividend")?.columns.push(...["payout_cumulative", "dividend_consistency"].map(financialColumn));
    const order = ["dimensions", "core", "profit", "returns", "expenses", "cash", "risk", "channel", "dividend", "growth", "score_items"];
    return groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  function selectedComparisonGroups() {
    const seen = new Set(["score", "style_tag"]);
    return comparisonGroups().map((group) => ({ ...group, columns: group.columns.filter((column) => {
      if (seen.has(column.key)) return false;
      seen.add(column.key); return true;
    }) })).filter((group) => group.columns.length);
  }
  function comparisonColumns() {
    return [comparisonColumn("score", "财务质量", "score", "V5 最终财务分；缺关键项时总分留空", "分 / 100"), comparisonColumn("style_tag", "估值×基本面", "style", "最新年报基准DCF结合V5财务分；净现金未核验时暂不判断低估，按分类序号排序", ""), ...selectedComparisonGroups().flatMap((group) => group.columns)];
  }
  function comparisonTagFilters() {
    const tags = Object.entries(window.LiquorCompanyStyle.tags).sort((a, b) => a[1][2] - b[1][2]);
    return `<div id="style-filters" class="style-filters" role="group" aria-label="估值与基本面标签筛选"><button data-style-filter="all" aria-pressed="${state.styleFilters.size === 0}">全部 <small>${state.companies.length}</small></button>${tags.map(([key, [label, tone]]) => `<button data-style-filter="${key}" class="style-filter ${tone}" aria-pressed="${state.styleFilters.has(key)}"><span class="style-dot"></span>${esc(label)}<small>${state.companies.filter((c) => companyStyle(c).id === key).length}</small></button>`).join("")}</div>`;
  }
  function bindComparisonNavigation() {
    root.querySelectorAll("[data-style-filter]").forEach((button) => { button.onclick = () => {
      const key = button.dataset.styleFilter;
      if (key === "all") state.styleFilters.clear();
      else state.styleFilters.has(key) ? state.styleFilters.delete(key) : state.styleFilters.add(key);
      root.querySelectorAll("[data-style-filter]").forEach((control) => control.setAttribute("aria-pressed", String(control.dataset.styleFilter === "all" ? state.styleFilters.size === 0 : state.styleFilters.has(control.dataset.styleFilter))));
      updateCompare();
    }; });
    root.querySelectorAll("[data-jump-group]").forEach((button) => { button.onclick = () => {
      const table = root.querySelector(".comparison-grid"), wrap = table?.closest(".table-wrap");
      const heading = table?.querySelector(`[data-column-group="${button.dataset.jumpGroup}"]`);
      if (!heading || !wrap) return;
      wrap.scrollLeft += heading.getBoundingClientRect().left - wrap.getBoundingClientRect().left - table.querySelector(".company-cell").offsetWidth;
      root.querySelectorAll("[data-jump-group]").forEach((control) => control.setAttribute("aria-pressed", String(control === button)));
    }; });
  }
  function syncComparisonUrl() {
    const params = new URLSearchParams();
    if (state.styleFilters.size) params.set("tags", [...state.styleFilters].sort().join(","));
    if (state.compareMode) {
      params.set("select", "1");
      if (state.selected.size) params.set("selected", [...state.selected].join(","));
      if (state.onlySelected) params.set("only", "1");
    }
    if (state.sort !== "score" || state.dir !== -1) { params.set("sort", state.sort); params.set("order", state.dir === 1 ? "asc" : "desc"); }
    history.replaceState({}, "", location.pathname + (params.size ? "?" + params : "") + location.hash);
  }
  function metric(c, key) {
    if (key === "score") return c.score.total;
    if (key === "style_tag") return companyStyle(c).order;
    if (key === "current_pe") return companyStyle(c).pe;
    if (key.startsWith("dimension:")) return num(c.score.dimensions.find((d) => d.name === key.slice(10))?.score);
    if (key.startsWith("points:")) return num(scoreItem(c, key.slice(7)).score);
    if (key.startsWith("yoy:")) {
      const field = key.slice(4), spec = state.data.financial_metrics.metrics[field];
      return financialChange(c, lastAnnualYear(), spec.unit, (r) => r[field]).value;
    }
    if (key === "yield") return num(c.dividend?.yield_pct);
    if (key === "dps") return num(c.dividend?.dps);
    if (key === "risks") return c.score.quality_flags.join("；") || "无已触发评分闸门";
    if (Object.hasOwn(state.data.model.metric_definitions, key)) return num(scoreItem(c, key).value);
    return num(annual(c, lastAnnualYear())[key]);
  }
  function visible() {
    return state.companies.filter((c) => (!state.styleFilters.size || state.styleFilters.has(companyStyle(c).id)) && (!state.onlySelected || state.selected.has(c.code)))
      .sort((a, b) => {
        const av = state.sort === "name" ? a.name : metric(a, state.sort), bv = state.sort === "name" ? b.name : metric(b, state.sort);
        if (av == null && bv == null) return a.code.localeCompare(b.code);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "zh-CN")) * state.dir || a.code.localeCompare(b.code);
      });
  }
  function formatCell(c, key, kind) {
    const value = metric(c, key);
    const bankNumber = (number) => number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (kind === "style") return styleBadge(c);
    if (key.startsWith("dimension:")) {
      if (value === null) return "—";
      const d = c.score.dimensions.find((entry) => entry.name === key.slice(10));
      const ratio = Math.max(0, Math.min(1, value / d.weight));
      const level = ratio >= .8 ? 5 : ratio >= .65 ? 4 : ratio >= .5 ? 3 : ratio >= .35 ? 2 : 1;
      return `<span class="dimension-cell lv${level}" title="${esc(d.name)}：${fmt(value, 2)} / ${d.weight} 分"><strong>${value.toFixed(1)}</strong><span class="mini-track" role="meter" aria-label="${esc(d.name)}" aria-valuemin="0" aria-valuemax="${d.weight}" aria-valuenow="${value}"><i style="width:${ratio * 100}%"></i></span></span>`;
    }
    if (kind === "score") {
      if (value == null) return `<span title="${esc(c.score.missing.map((k) => state.data.model.metric_definitions[k]?.label || k).join("、"))}">${badge("待核验", "warn")}<span class="status-note">可能 ${c.score.score_range?.map((v) => fmt(v, 0)).join("–") || "—"}</span></span>`;
      return `<span class="score-cell" title="${fmt(value, 2)} 分${c.score.risk_cap < 100 ? "；风险上限 " + c.score.risk_cap : ""}"><strong>${value.toFixed(1)}</strong></span>`;
    }
    if (kind === "points") return value === null ? "—" : `<strong>${fmt(value, 2)}</strong>`;
    if (key.startsWith("yoy:")) {
      const field = key.slice(4), spec = state.data.financial_metrics.metrics[field];
      return financialChangeText(financialChange(c, lastAnnualYear(), spec.unit, (r) => r[field]));
    }
    if (kind === "text") {
      const score = c.score;
      const label = score.risk_gates.length ? score.risk_gates.length + " 项风险" : score.missing.length ? score.missing.length + " 项缺失" : score.observations?.length ? score.observations.length + " 项复核" : score.risk_missing?.length ? "风险待核验" : "";
      return label ? `<button type="button" class="risk-help-trigger" data-metric-help="risks" data-risk-code="${esc(c.code)}" data-help-title="${esc(c.name)} · 风险 / 缺项" aria-label="${esc(c.name)}：${esc(label)}，查看详情" aria-haspopup="dialog" aria-controls="metric-explanation" aria-expanded="false">${badge(label, score.risk_gates.length ? "risk" : "warn")}</button>` : "—";
    }
    return kind === "亿元" ? value == null ? "—" : bankNumber(yi(value)) + "亿" : kind === "%" ? value == null ? "—" : bankNumber(value) + "%" : kind === "x" ? fmt(value, 2) + (value == null ? "" : " 倍") : fmt(value, 2);
  }
  function renderCompare() {
    mount(pageHead("公司对比", "长期财务质量", `<a href="score-formula.html">${esc(modelVersion())} 评分依据</a>`)
      + `<div class="toolbar comparison-toolbar">${comparisonTagFilters()}<div class="controls comparison-actions" role="group" aria-label="表格工具"><label id="selected-only-control" class="${state.compareMode ? "" : "hidden"}"><input id="only-selected" type="checkbox"${state.onlySelected ? " checked" : ""}>仅已选</label><button id="comparison-mode" class="comparison-mode icon-button" aria-pressed="${state.compareMode}" aria-label="${state.compareMode ? "退出对比" : "对比公司"}" title="${state.compareMode ? "退出对比" : "对比公司"}"><i data-lucide="columns-2"></i></button><button id="reset" class="icon-button" title="重置筛选与排序" aria-label="重置筛选与排序"><i data-lucide="rotate-ccw"></i></button><button id="download" class="icon-button" title="导出当前公司及全部指标" aria-label="导出CSV"><i data-lucide="download"></i></button></div></div>`
      + `<div class="comparison-context"><nav class="comparison-group-nav" aria-label="指标分组定位">${selectedComparisonGroups().map((group) => `<button data-jump-group="${group.key}" aria-pressed="false">${esc(group.label)}</button>`).join("")}</nav><span class="meta">${lastAnnualYear()}A · ${comparisonColumns().length} 列</span></div>`
      + '<div id="compare-tray" class="compare-tray"></div><div id="comparison-table"></div>'
      + section("compare-charts", "财务质量与股东回报", "散点仅展示两项独立指标；未完成评分者不进入散点", `<div class="chart-grid">${chartPanel("compare-scores", "财务质量分布", "固定绝对锚点 · 触发风险上限的公司以红色标记", "分 / 100", "tall")}${chartPanel("compare-scatter", "财务质量 × 股息率", "完整年已实施分红 / 当前快照收盘价", "%", "tall")}</div>`));
    $("only-selected").onchange = (e) => { state.onlySelected = e.target.checked; updateCompare(); };
    $("comparison-mode").onclick = () => {
      state.compareMode = !state.compareMode;
      if (state.compareMode && !state.selected.size && visible().length === 2) state.selected = new Set(visible().map((c) => c.code));
      if (!state.compareMode) { state.selected.clear(); state.onlySelected = false; $("only-selected").checked = false; }
      $("comparison-mode").setAttribute("aria-pressed", String(state.compareMode));
      $("comparison-mode").title = state.compareMode ? "退出对比" : "对比公司";
      $("comparison-mode").setAttribute("aria-label", $("comparison-mode").title);
      $("selected-only-control").classList.toggle("hidden", !state.compareMode);
      updateCompare();
    };
    $("reset").onclick = () => { Object.assign(state, { styleFilters: new Set(), sort: "score", dir: -1, compareMode: false, onlySelected: false }); state.selected.clear(); renderCompare(); };
    $("download").onclick = exportCsv;
    bindComparisonNavigation();
    updateCompare();
  }
  function updateCompare() {
    const companies = visible(), groups = selectedComparisonGroups(), cols = comparisonColumns();
    $("download").disabled = companies.length === 0;
    $("download").title = companies.length ? `导出当前 ${companies.length} 家公司的可见指标` : "当前没有可导出的公司";
    syncComparisonUrl();
    const previousScroll = $("comparison-table").querySelector(".table-wrap");
    const scroll = { left: previousScroll?.scrollLeft || 0, top: previousScroll?.scrollTop || 0 };
    const head = (column, rowspan = 1) => {
      const { key, label, unit, help } = column;
      const active = state.sort === key;
      const icon = active ? state.dir > 0 ? "arrow-up" : "arrow-down" : "chevrons-up-down";
      const nextDirection = active ? state.dir < 0 ? "升序" : "降序" : ["name", "style_tag"].includes(key) ? "升序" : "降序";
      return `<th scope="col" rowspan="${rowspan}" data-column-key="${esc(key)}"${key === "name" ? ' class="company-cell"' : ""} aria-sort="${active ? state.dir > 0 ? "ascending" : "descending" : "none"}"><div class="comparison-header-controls"><button data-sort="${esc(key)}" aria-label="按${esc(label)}${nextDirection}排序"><span class="comparison-heading"><span>${esc(label)}</span>${unit ? `<small${unit === "pp" ? ' class="unit-pp"' : ""}>${esc(unit)}</small>` : ""}</span><i data-lucide="${icon}"></i></button>${help ? metricHelp(key, label, help) : ""}</div></th>`;
    };
    const span = groups.length ? 2 : 1;
    const selectBox = (c) => state.compareMode ? `<input type="checkbox" data-select="${c.code}" aria-label="对比${esc(c.name)}"${state.selected.has(c.code) ? " checked" : state.selected.size >= 2 ? " disabled" : ""}>` : "";
    $("comparison-table").innerHTML = `<div class="table-wrap comparison-table-scroll" tabindex="0" aria-label="公司财务指标对比表"><table class="comparison-grid"><thead><tr class="comparison-group-row">${head(comparisonColumn("name", "公司", "text", "", ""), span)}${cols.slice(0, 2).map((column) => head(column, span)).join("")}${groups.map((group) => `<th scope="colgroup" colspan="${group.columns.length}" data-column-group="${group.key}">${esc(group.label)}</th>`).join("")}</tr>${groups.length ? `<tr class="comparison-metric-row">${groups.flatMap((group) => group.columns).map((column) => head(column)).join("")}</tr>` : ""}</thead><tbody>${companies.map((c) => `<tr data-code="${c.code}"><td class="company-cell">${selectBox(c)}<a class="company" href="stock.html?code=${c.code}">${esc(c.name)}</a><span class="code">${c.code}</span></td>${cols.map(({ key, kind }) => `<td data-column="${esc(key)}">${formatCell(c, key, kind)}</td>`).join("")}</tr>`).join("") || `<tr><td class="table-empty" colspan="${cols.length + 1}">没有匹配公司</td></tr>`}</tbody></table></div><div class="table-caption"><span>当前 ${companies.length} / ${state.companies.length} 家 · ${cols.length} 个指标列 · 同口径 ${lastAnnualYear()}A</span><span>评分采用五年窗口；<a href="score-formula.html#formula-style">估值×基本面为研究阈值分类</a>；缺项留空</span></div>`;
    const tableScroll = $("comparison-table").querySelector(".table-wrap");
    tableScroll.addEventListener("scroll", () => {
      const edge = tableScroll.getBoundingClientRect().left + tableScroll.querySelector(".company-cell").offsetWidth + 2;
      const active = [...tableScroll.querySelectorAll("[data-column-group]")].find((head) => head.getBoundingClientRect().right > edge)?.dataset.columnGroup;
      root.querySelectorAll("[data-jump-group]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.jumpGroup === active)));
    }, { passive: true });
    window.lucide?.createIcons();
    tableScroll.scrollLeft = scroll.left; tableScroll.scrollTop = scroll.top;
    root.querySelectorAll(`td[data-column="${CSS.escape(state.sort)}"]`).forEach((cell) => cell.classList.add("sorted-column"));
    root.querySelectorAll("[data-sort]").forEach((button) => { button.onclick = () => {
      state.dir = state.sort === button.dataset.sort ? -state.dir : ["name", "style_tag"].includes(button.dataset.sort) ? 1 : -1;
      state.sort = button.dataset.sort; updateCompare();
      root.querySelector(`[data-sort="${CSS.escape(state.sort)}"]`)?.focus({ preventScroll: true });
    }; });
    root.querySelectorAll("[data-select]").forEach((input) => { input.onchange = () => { const code = input.dataset.select; input.checked ? state.selected.add(code) : state.selected.delete(code); updateCompare(); root.querySelector(`[data-select="${code}"]`)?.focus({ preventScroll: true }); }; });
    const selected = [...state.selected].map(getCompany).filter(Boolean);
    $("compare-tray").innerHTML = state.compareMode ? `<span>深度对比 · 已选 ${selected.length} / 2 家</span>${selected.map((c) => `<button class="selected-company" data-remove="${c.code}" aria-label="移除对比${esc(c.name)}" title="移除${esc(c.name)}"><span>${esc(c.name)}</span><i data-lucide="x"></i></button>`).join("")}<button id="open-comparison" class="primary"${selected.length !== 2 ? ' disabled title="深度曲线对比需要两家公司"' : ""}>深度对比</button>` : "";
    window.lucide?.createIcons();
    root.querySelectorAll("[data-remove]").forEach((btn) => { btn.onclick = () => { state.selected.delete(btn.dataset.remove); updateCompare(); }; });
    if ($("open-comparison")) $("open-comparison").onclick = () => { location.href = `stock.html?code=${selected[0].code}&compare=${selected[1].code}`; };
    destroyCharts();
    const ranked = companies.filter((c) => c.score.rankable).sort((a, b) => b.score.total - a.score.total);
    plot("compare-scores", "bar", ranked.map((c) => c.name), [{ label: "财务质量", data: ranked.map((c) => c.score.total), backgroundColor: ranked.map((c) => (c.score.risk_cap < 100 ? colors[5] : colors[0]) + "ba") }], "分", { emptyLabel: "当前筛选中没有完整评分公司", indexAxis: "y", scales: { x: { min: 0, max: 100 } }, onClick: (_, hits) => { if (hits.length) location.href = "stock.html?code=" + ranked[hits[0].index].code; } });
    const scatter = ranked.filter((c) => num(c.dividend?.yield_pct) !== null);
    plot("compare-scatter", "scatter", [], [{ label: "公司", data: scatter.map((c) => ({ x: c.score.total, y: c.dividend.yield_pct, name: c.name })), pointRadius: 6, pointBackgroundColor: scatter.map((c) => c.score.risk_cap < 100 ? colors[5] : colors[0]), borderWidth: 1, borderColor: "#fff" }], "%", {
      emptyLabel: "当前筛选缺少完整评分或已核验股息率",
      scales: { x: { type: "linear", min: 0, max: 100, title: { display: true, text: "财务质量 / 100", color: "#7c8780", font: { size: 12 } } }, y: { beginAtZero: true, title: { display: true, text: "股息率 / %", color: "#7c8780", font: { size: 12 } } } },
      tooltip: { title: (items) => items[0]?.raw.name || "", label: (ctx) => `财务质量 ${fmt(ctx.raw.x)} · 股息率 ${pct(ctx.raw.y)}` },
      onClick: (_, hits) => { if (hits.length) location.href = "stock.html?code=" + scatter[hits[0].index].code; },
    });
  }
  function exportCsv() {
    const cols = comparisonColumns();
    const quote = (v) => '"' + String(v ?? "").replace(/^[=+@]/, "'$&").replace(/"/g, '""') + '"';
    const csv = [["公司", "代码", ...cols.map(({ label, unit }) => label + (unit ? " / " + unit : ""))], ...visible().map((c) => [c.name, c.code, ...cols.map(({ key, kind }) => kind === "style" ? companyStyle(c).label : kind === "亿元" ? yi(metric(c, key)) : metric(c, key))])].map((r) => r.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `白酒公司对比-${selectedComparisonGroups().map((group) => group.key).join("-") || "summary"}-${state.data.as_of}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Stock and methodology views share the exact Python-produced score detail.
  function scoreDetail(c, comparison = null) {
    const other = comparison ? Object.fromEntries(comparison.score.dimensions.flatMap((d) => d.items.map((i) => [i.name, i]))) : {};
    const itemFmt = (value, unit) => value == null ? "—" : fmt(value, 2) + (unit === "%" ? "%" : unit === "x" ? " 倍" : unit === "系数" ? " 系数" : "");
    const states = { scored: ["已评分", "good"], missing: ["资料不足", "warn"], economic_invalid: ["经济无效 · 计零", "risk"], observed_zero: ["已核验零值", "blue"] };
    return `<div class="table-wrap"><table class="wrap-table"><thead><tr><th>指标 / 权重</th><th>实际值</th><th>${esc(c.name)}</th>${comparison ? `<th>${esc(comparison.name)}</th>` : ""}<th>零分 → 满分</th><th>计算口径 / 状态</th></tr></thead><tbody>${c.score.dimensions.map((d, index) => `<tr class="dim-heading"><td colspan="${comparison ? 6 : 5}">${"ABCDE"[index]} ${esc(d.name)} · ${fmt(d.score, 1)} / ${d.weight}</td></tr>${d.items.map((i) => `<tr><td class="text-left">${esc(i.label)}<span class="status-note">满分 ${i.max} 分</span></td><td>${itemFmt(i.value, i.unit)}</td><td><strong>${fmt(i.score, 2)}</strong></td>${comparison ? `<td>${fmt(other[i.name]?.score, 2)}</td>` : ""}<td>${itemFmt(i.zero_line, i.unit)} → ${itemFmt(i.full_line, i.unit)}</td><td class="formula-cell">${esc(i.method)}<br>${badge(...(states[i.status] || states.missing))} <span class="status-note">有效年度 ${i.valid_years} / 5</span></td></tr>`).join("")}`).join("")}</tbody></table></div>`;
  }
  function dimensionBars(c, comparison = null) {
    const analyses = window.LiquorScoreAnalysis.analyze(c);
    const comparisonAnalyses = comparison ? window.LiquorScoreAnalysis.analyze(comparison) : [];
    return `<div class="compare-legend"><span><i class="legend-swatch"></i>${esc(c.name)}</span>${comparison ? `<span><i class="legend-swatch blue"></i>${esc(comparison.name)}</span>` : ""}</div><div class="dimension-list">${c.score.dimensions.map((d, i) => {
      const other = comparison?.score.dimensions.find((entry) => entry.name === d.name);
      const analysis = analyses[i];
      const compared = comparisonAnalyses.find((entry) => entry.name === d.name);
      const content = analysis.items.map((item) => {
        const otherItem = compared?.items.find((entry) => entry.key === item.key);
        return `<div class="score-item-analysis" data-score-item="${esc(item.key)}"><p><strong>${esc(item.label)}：</strong>${esc(item.observation)}</p>`
          + (otherItem ? `<p class="score-comparison">${esc(comparison.name)}：${esc(otherItem.value)}</p>` : "") + "</div>";
      }).join("");
      return `<details class="score-dimension-card" name="score-dimensions" data-score-dimension="${esc(analysis.letter)}"><summary aria-controls="score-analysis-${analysis.letter}"><div class="dimension-row"><span>${analysis.letter} ${esc(d.name)}</span><div><div class="dim-track"><i style="width:${d.score == null ? 0 : d.score / d.weight * 100}%;background:${colors[0]}"></i></div>${comparison ? `<div class="dim-track dim-secondary"><i style="width:${other?.score == null ? 0 : other.score / other.weight * 100}%;background:${colors[1]}"></i></div>` : ""}</div><span class="numeric dimension-values"><span title="${esc(c.name)}">${fmt(d.score, 2)}<small> / ${d.weight}</small></span>${comparison ? `<span class="comparison-dimension-value" title="${esc(comparison.name)}">${fmt(other?.score, 2)}<small> / ${other?.weight || d.weight}</small></span>` : ""}</span></div>`
        + `<div class="dimension-summary"><p>${esc(analysis.summary)}</p><i data-lucide="chevron-down" aria-hidden="true"></i></div></summary>`
        + `<div class="dimension-analysis" id="score-analysis-${analysis.letter}" data-analysis-owner="${analysis.letter}" role="region" aria-label="${esc(d.name)}分析">${content}`
        + `<div class="dimension-conclusion"><p><strong>判断：</strong>${esc(analysis.judgment)}</p>${compared ? `<p class="score-comparison">${esc(comparison.name)}：${esc(compared.summary)}</p>` : ""}${analysis.warnings.map((warning) => `<p class="score-analysis-warning">${esc(warning)}</p>`).join("")}</div></div></details>`;
    }).join("")}</div><div class="score-analysis-dock" hidden></div>`;
  }
  function liquidityDetail(c) {
    const rows = (c.score.liquidity_components || []).map((item, index) => `<tr><td>${c.score.window_years[index]}${index === 4 ? " · 最新年" : ""}</td><td>${item?.confirmed_no_current_liabilities ? "无流动负债" : pct(item?.cash_ratio_pct)}</td><td>${item?.confirmed_no_current_liabilities ? "不适用" : pct(item?.quick_ratio_pct)}</td><td>${fmt(item?.factor, 3)}</td></tr>`).join("");
    return `<div class="table-wrap"><table><thead><tr><th>年度</th><th>货币资金 / 流动负债</th><th>速动比率</th><th>年度瓶颈系数</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function safetyDetail(c) {
    return `<div class="table-wrap"><table class="wrap-table"><thead><tr><th>核验事项</th><th>状态</th></tr></thead><tbody>${(c.score.safety_pending || []).map((item) => `<tr><td class="text-left">${esc(item)}</td><td>${badge("待补证", "warn")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function renderStock() {
    const c = getCompany(state.code), cmp = getCompany(state.compare), year = c.score.annual_year, r = annual(c, year), latest = c.latest || {};
    const score = c.score;
    const share = c.shares || {}, dcf = c.dcf || {};
    const scoreRange = score.score_range ? score.score_range.map((v) => fmt(v)).join("–") : "—";
    const controls = `<label>主标的<select id="primary-select">${companyOptions(c.code)}</select></label><label>比较标的<select id="compare-select">${companyOptions(state.compare, true)}</select></label><label>年度范围<select id="range-select">${options([[5, "最近 5 年"], [10, "最近 10 年"], [20, "最近 20 年"]], state.range)}</select></label>`;
    const observations = score.risk_gates.map((x) => x.label + " · 上限 " + x.cap).concat(score.observations || []);
    const overview = `<div class="score-summary"><div class="score-overview-line"><div class="score-total"><div><h3>五年财务质量</h3><div class="score-main">${scoreText(c)}${score.total == null ? "" : "<small> / 100</small>"}</div></div><div>${badge(scoreLabel(c), tone(c))}<p class="score-caption">${year - 4}–${year} · 覆盖 ${pct(score.coverage * 100)}</p>${score.total == null ? `<p class="score-caption">可得分区间 ${scoreRange}</p>` : score.risk_cap < 100 ? `<p class="score-caption">原始分 ${fmt(score.raw_total, 2)} · 风险上限 ${score.risk_cap}</p>` : ""}</div></div><div class="score-aside"><dl><div><dt>收盘价</dt><dd>${fmt(c.price?.close, 2)} 元</dd></div><div><dt>年度股息率</dt><dd>${pct(c.dividend?.yield_pct)}</dd></div><div><dt>最新财报</dt><dd>${esc(latest.report_date || "—")}</dd></div><div><dt>安全核验</dt><dd>${badge("待补证", "warn")}</dd></div><div><dt>估值×基本面</dt><dd>${styleBadge(c)}</dd></div></dl></div></div>${dimensionBars(c, cmp)}${observations.length ? `<ul class="risk-list">${observations.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}</div>`;
    mount(pageHead(c.name, c.code, controls) + overview
      + `<div class="banner${score.total == null || score.risk_gates.length ? " warning" : ""}">${score.total == null ? "评分待核验：" + esc(score.missing.map((k) => state.data.model.metric_definitions[k]?.label || k).join("、")) : `财务质量 ${scoreText(c)} 分，${scoreLabel(c)}。`}${cmp ? ` 对比 ${esc(cmp.name)}：${scoreText(cmp)} 分。` : ""} 品牌、渠道、安全核验及估值另列。</div>`
      + nav([["stock-sankey", "利润桑基图"], ["stock-operating", "财务指标"], ["stock-bridges", "现金与利润桥"], ["stock-value", "估值研究"], ["stock-evidence", "评分与证据"]])
      + `<div class="kpi-strip">${kpi(year + "A 营业收入", fmt(yi(r.revenue), 2), "亿元", change(growth(c, "revenue", year)))}${kpi(year + "A 归母净利润", fmt(yi(r.net_profit), 2), "亿元", change(growth(c, "net_profit", year)))}${kpi(year + "A 自由现金流", fmt(yi(r.owner_fcf), 2), "亿元", "经营现金流 − 全部资本开支")}${kpi(latest.report_date?.endsWith("06-30") ? "最新中报营收同比" : "最新报告营收同比", pct(growth(c, "revenue", latest.report_date)), "", esc(latest.report_date || "—") + " · 同报告期")}</div>`
      + section("stock-sankey", "利润桑基图", "营业总收入 → 成本费用 → 营业利润 → 归母净利润 · 完整年报", '<div id="sankey-content"></div>')
      + section("stock-operating", "关键财务指标", `${Object.keys(state.data.financial_metrics?.metrics || {}).length} 项 · ${state.range} 个完整年度`, metricWorkbench())
      + section("stock-bridges", "现金与利润桥", "利润表与现金流量表分开对账", `<div class="chart-grid">${chartPanel("stock-cash-bridge", "经营现金流桥", year + "A · CFO → 资本开支 → 现金余量", "亿元")}${chartPanel("stock-profit-bridge", "收入到归母净利润", year + "A · 营业总收入含财务子公司收入，其他净支出为对账余项", "亿元")}</div>`)
      + section("stock-value", "估值研究", "历史 PE / PB 与独立现金流情景 · 不计入财务质量分", '<div id="valuation-history"></div>' + valuation(c))
      + section("stock-evidence", "评分与研究证据", "财务可复算；定性观察保留来源", `<div class="evidence-grid">${evidenceCards(c)}</div><details class="disclosure"><summary>五维评分明细 · ${score.dimensions.reduce((n, d) => n + d.items.length, 0)} 个指标${cmp ? " · 双公司对照" : ""}</summary>${scoreDetail(c, cmp)}</details><details class="disclosure"><summary>流动性缓冲年度输入</summary>${liquidityDetail(c)}</details><details class="disclosure"><summary>独立安全核验 · 待补证</summary>${safetyDetail(c)}</details><details class="disclosure"><summary>历年财报与回报指标</summary>${financialTable(c, cmp)}</details><details class="disclosure"><summary>字段来源与冲突记录</summary>${provenance(c)}</details>`));
    document.title = c.name + " · 白酒研究台";
    $("primary-select").onchange = (e) => { state.code = e.target.value; state.pnlYear = ""; if (state.compare === state.code) state.compare = ""; renderStock(); syncUrl(); };
    $("compare-select").onchange = (e) => { state.compare = e.target.value === state.code ? "" : e.target.value; renderStock(); syncUrl(); };
    $("range-select").onchange = (e) => { state.range = Number(e.target.value); renderStock(); syncUrl(); };
    root.querySelectorAll("[data-scale]").forEach((btn) => { btn.onclick = () => { state.scale = btn.dataset.scale; syncUrl(); renderStock(); }; });
    renderSankeys(c, cmp);
    renderMetricWorkbench();
    renderValuationHistory();
    const profitSets = [c, cmp].filter(Boolean).map((co, i) => {
      const p = state.pnl[co.code]?.years?.[year] || {};
      const valid = [p.total, p.cogs, p.tax_add, p.sale, p.parent].every((v) => num(v) !== null);
      const amounts = valid ? [p.total, p.cogs, p.tax_add, p.sale, p.total - p.cogs - p.tax_add - p.sale - p.parent, p.parent] : Array(6).fill(null);
      let remaining = p.total;
      const values = amounts.map((amount, index) => {
        if (!valid) return null;
        if (index === 0 || index === 5) return amount;
        const before = remaining; remaining -= amount; return [remaining, before];
      });
      return dataset(co.name, values, colors[i], { amounts });
    });
    plot("stock-profit-bridge", "bar", ["营业总收入", "营业成本", "税金附加", "销售费用", "其他净支出", "归母净利"], profitSets, "亿元", { tooltip: { label: (ctx) => ctx.dataset.label + " " + fmt(ctx.dataset.amounts[ctx.dataIndex]) + " 亿元" } });
    plot("stock-cash-bridge", "bar", ["经营现金流", "资本开支", "自由现金流"], [c, cmp].filter(Boolean).map((co, i) => {
      const a = annual(co, year);
      return dataset(co.name, [yi(a.cfo), num(a.cfo) !== null && num(a.capex) !== null ? [yi(a.cfo - a.capex), yi(a.cfo)] : null, yi(a.owner_fcf)], colors[i]);
    }), "亿元", { tooltip: { label: (ctx) => { const co = ctx.datasetIndex ? cmp : c, a = annual(co, year); return co.name + " " + fmt(yi([a.cfo, a.capex, a.owner_fcf][ctx.dataIndex]) ) + " 亿元"; } } });
  }
  function stockYears() {
    const suffix = state.metricPeriod.length === 4 ? "12-31" : state.metricPeriod.slice(5);
    return [...new Set([getCompany(state.code), getCompany(state.compare)].filter(Boolean).flatMap((c) => (suffix === "12-31" ? c.annual : c.quarterly || []).filter((r) => r.report_date.endsWith(suffix) && r.year <= Number(state.metricPeriod.slice(0, 4))).map((r) => r.year)))].sort().slice(-state.range);
  }
  const annualOnlyMetrics = new Set(["roa", "roe", "consolidated_roe", "equity_multiplier", "asset_turnover", "receivables_turnover", "receivables_days", "inventory_turnover", "inventory_days", "fixed_asset_turnover", "revenue_cagr_3y", "profit_cagr_3y", "cashflow_profit_3y", "dps", "dividend_cash_CNY", "payout_pct", "dividend_yield_year_end", "year_end_price", "year_end_pe"]);
  const metricPeriodForYear = (year) => String(year) + (state.metricPeriod.length === 4 ? "" : state.metricPeriod.slice(4));
  const metricPeriodLabel = (period) => String(period).slice(0, 4) + (String(period).length === 4 ? "A" : ({ "03-31": "Q1", "06-30": "H1", "09-30": "9M" }[String(period).slice(5)] || ""));
  function metricPeriodOptions() {
    const rows = [getCompany(state.code), getCompany(state.compare)].filter(Boolean).flatMap((c) => [...c.annual, ...(c.quarterly || [])]);
    return [...new Set(rows.map((r) => r.report_date.endsWith("12-31") ? String(r.year) : r.report_date))].sort().reverse().map((date) => [date, date.length === 4 ? date + " 年报" : date.slice(0, 4) + ({ "03-31": " 一季报", "06-30": " 中报", "09-30": " 三季报" }[date.slice(5)] || "")]);
  }
  function metricRecord(company, period) {
    const record = row(company, period);
    if (String(period).length === 4) return record;
    return { ...record, ...Object.fromEntries([...annualOnlyMetrics].map((key) => [key, null])) };
  }
  function metricChange(company, period, unit, getter) {
    return periodChange(getter(metricRecord(company, period)), getter(metricRecord(company, priorPeriod(period))), unit);
  }
  function metricId(key) {
    return ({ revenue: "stock-revenue", net_profit: "stock-profit", operating_margin: "stock-margin", roa: "stock-roa", cfo: "stock-cfo", owner_fcf: "stock-fcf", dps: "stock-dividend", inventory_to_revenue: "stock-inventory", contract_to_revenue: "stock-contract", gross_margin: "stock-gross-margin" })[key] || "stock-metric-" + key.replace(/_/g, "-");
  }
  function financialChange(company, year, unit, getter) {
    const current = num(getter(annual(company, year))), previous = num(getter(annual(company, year - 1)));
    return periodChange(current, previous, unit);
  }
  function financialValue(value, unit) {
    if (num(value) === null) return "—";
    return fmt(unit === "亿元" ? yi(value) : value, 2) + (unit === "%" ? "%" : " " + unit);
  }
  function financialChangeText(result) {
    if (result.value === null) return `<span class="metric-null" title="${esc(result.note)}">—</span>`;
    return `<span class="change ${result.value >= 0 ? "positive" : "negative"}" title="${esc(result.note)}">${result.value > 0 ? "+" : ""}${fmt(result.value, 2)}${result.unit === "%" ? "%" : " pp"}</span>`;
  }
  function metricWorkbench() {
    const catalog = state.data.financial_metrics;
    if (!catalog) return '<p class="score-caption">财务指标目录尚未生成。</p>';
    return `<div class="metrics-toolbar"><div class="metric-tabs" role="group" aria-label="财务指标分组">${catalog.groups.map((group) => `<button type="button" data-metric-group="${group.id}" aria-pressed="${state.metricGroup === group.id}" class="${state.metricGroup === group.id ? "active" : ""}">${esc(group.label)}<span>${group.metrics.length}</span></button>`).join("")}</div><input id="metric-search" type="search" placeholder="指标名称 / ROE / CFO" aria-label="搜索财务指标" value="${esc(state.metricQuery)}"></div><div class="metric-mode-bar"><div class="controls metric-period-controls"><label for="metric-period">财报口径</label><select id="metric-period" aria-label="关键财务指标报告期">${options(metricPeriodOptions(), state.metricPeriod)}</select><div class="segmented" role="group" aria-label="规模指标模式">${[["amount", "绝对金额"], ["indexed", "首年 = 100"]].map(([key, label]) => `<button data-scale="${key}" class="${state.scale === key ? "active" : ""}" aria-pressed="${state.scale === key}">${label}</button>`).join("")}</div></div><span id="metric-period-basis" class="meta"></span>${metricHelp("pp", "同比变化单位", "")}</div><div id="metric-content"></div><details class="disclosure"><summary>待补核验证据 · ${catalog.pending.length} 项</summary><div class="table-wrap"><table class="wrap-table"><thead><tr><th>指标</th><th>缺少的证据 / 口径</th></tr></thead><tbody>${catalog.pending.map((m) => `<tr><td class="text-left">${esc(m.label)}</td><td class="formula-cell">${esc(m.reason)}</td></tr>`).join("")}</tbody></table></div></details><p class="score-caption">${esc(catalog.source_note)}。金额 YoY =（本期 − 上年同期）/ |上年同期|；零基数或缺项留空。年末估值为事后年报口径，非历史时点可得的 TTM 估值。</p>`;
  }
  function renderMetricWorkbench() {
    const catalog = state.data.financial_metrics;
    if (!catalog || !$("metric-content")) return;
    const c = getCompany(state.code), cmp = getCompany(state.compare);
    if (!metricPeriodOptions().some(([period]) => period === state.metricPeriod)) state.metricPeriod = String(c.score.annual_year);
    const years = stockYears(), period = state.metricPeriod, previous = priorPeriod(period), label = metricPeriodLabel(period);
    const periodKind = ({ "03-31": "一季报", "06-30": "中报", "09-30": "三季报" })[period.slice(5)];
    $("stock-operating").querySelector(".section-title small").textContent = `${Object.keys(catalog.metrics).length} 项 · ${period.length === 4 ? years.length + " 个完整年度" : years.length ? years[0] + "–" + years.at(-1) + " " + periodKind : "暂无同期数据"}`;
    $("metric-period").value = period;
    $("metric-period").onchange = (event) => { state.metricPeriod = event.target.value; syncUrl(); renderMetricWorkbench(); };
    $("metric-period-basis").textContent = period.length === 4 ? "完整年度 · 同比为上一年报" : "损益/现金流为年初至今累计 · 余额为季末值 · 同比对上年同期";
    state.charts = state.charts.filter((chart) => {
      if (chart.canvas.closest("#metric-charts")) { chart.destroy(); return false; }
      return true;
    });
    const query = state.metricQuery.toLowerCase();
    const group = catalog.groups.find((g) => g.id === state.metricGroup) || catalog.groups[0];
    const specs = (query ? Object.values(catalog.metrics) : group.metrics.map((key) => catalog.metrics[key])).filter((spec) => !query || (spec.label + " " + spec.key).toLowerCase().includes(query));
    const hasSeries = (spec) => [c, cmp].filter(Boolean).some((co) => years.some((y) => num(metricRecord(co, metricPeriodForYear(y))[spec.key]) !== null));
    const chartSpecs = specs.filter(hasSeries);
    root.querySelectorAll("[data-metric-group]").forEach((button) => {
      const active = !query && button.dataset.metricGroup === state.metricGroup;
      button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
      button.onclick = () => { state.metricGroup = button.dataset.metricGroup; state.metricQuery = ""; $("metric-search").value = ""; syncUrl(); renderMetricWorkbench(); };
    });
    $("metric-search").oninput = (event) => { state.metricQuery = event.target.value.trim(); renderMetricWorkbench(); };
    const getter = (key) => (r) => r[key];
    const formula = (spec) => period.length === 4 || annualOnlyMetrics.has(spec.key) ? spec.formula : spec.formula.replaceAll("年度", "本报告期累计").replaceAll("当年", "本报告期").replaceAll("年末", "本报告期末");
    const tableRows = specs.map((spec) => {
      const available = years.filter((y) => num(metricRecord(c, metricPeriodForYear(y))[spec.key]) !== null).length;
      const onlyAnnual = period.length !== 4 && annualOnlyMetrics.has(spec.key);
      const name = (hasSeries(spec) ? `<a href="#${metricId(spec.key)}" data-metric-focus="${spec.key}">${esc(spec.label)}</a>` : `<span>${esc(spec.label)}</span>`) + metricHelp(spec.key, spec.label, formula(spec)) + (window.LiquorKnowledge ? window.LiquorKnowledge.metricLink(knowledgePack, c.code, spec.key, period) : "");
      return `<tr data-metric-row="${spec.key}"><td class="metric-name">${name}</td><td>${financialValue(metricRecord(c, period)[spec.key], spec.unit)}</td><td>${financialValue(metricRecord(c, previous)[spec.key], spec.unit)}</td><td>${financialChangeText(metricChange(c, period, spec.unit, getter(spec.key)))}</td><td>${available} / ${years.length}${onlyAnnual ? " " + badge("仅年报", "blue") : available === 0 ? " " + badge("暂无可比值", "warn") : ""}</td>${cmp ? `<td>${financialValue(metricRecord(cmp, period)[spec.key], spec.unit)}</td><td>${financialChangeText(metricChange(cmp, period, spec.unit, getter(spec.key)))}</td>` : ""}</tr>`;
    }).join("");
    const snapshot = (spec) => `<div class="metric-latest"><div><span>${label} · ${esc(c.name)}</span><strong>${financialValue(metricRecord(c, period)[spec.key], spec.unit)}</strong>${financialChangeText(metricChange(c, period, spec.unit, getter(spec.key)))}</div>${cmp ? `<div class="metric-comparison-value"><span>${esc(cmp.name)}</span><b>${financialValue(metricRecord(cmp, period)[spec.key], spec.unit)}</b></div>` : ""}</div>`;
    $("metric-content").innerHTML = `<div class="metric-group-heading"><h3>${query ? "搜索结果" : esc(group.label)}</h3><span>${specs.length} 项指标 · ${chartSpecs.length} 项有曲线数据</span></div><details class="metric-quick-reference" open><summary>关键指标速查 · ${label}${cmp ? " · 双公司对照" : ""}</summary><div class="table-wrap"><table><thead><tr><th class="metric-name">指标 / 口径</th><th>${esc(c.name)} ${label}</th><th>${metricPeriodLabel(previous)}</th><th>同比 / 变化</th><th>${years.length} 期覆盖</th>${cmp ? `<th>${esc(cmp.name)} ${label}</th><th>同比 / 变化</th>` : ""}</tr></thead><tbody>${tableRows || `<tr><td class="table-empty" colspan="${cmp ? 7 : 5}">没有匹配的财务指标</td></tr>`}</tbody></table></div></details><div id="metric-charts" class="chart-grid metric-grid">${chartSpecs.map((spec) => chartPanel(metricId(spec.key), spec.label, formula(spec), spec.unit, "", snapshot(spec), spec.key)).join("")}</div>${specs.length > chartSpecs.length ? '<p class="score-caption">整段窗口缺少数据的指标保留在速查表中，不绘制空图，也不补零。</p>' : ""}`;
    chartSpecs.forEach((spec) => plotStockTrend(metricId(spec.key), spec.key, spec.unit, undefined, ["revenue", "net_profit"].includes(spec.key)));
    root.querySelectorAll("[data-metric-focus]").forEach((link) => { link.onclick = (event) => {
      event.preventDefault(); const key = link.dataset.metricFocus;
      $(metricId(key)).closest(".chart-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState({}, "", location.pathname + location.search + "#" + metricId(key));
    }; });
    window.lucide?.createIcons();
  }
  function plotStockTrend(id, key, unit, getter = (r) => r[key], indexed = false) {
      const c = getCompany(state.code), cmp = getCompany(state.compare);
      const years = stockYears();
      const companies = [c, cmp].filter(Boolean);
      const indexedMode = indexed && state.scale === "indexed";
      const valueUnit = indexedMode ? "首年 = 100" : unit;
      const changeUnit = unit === "%" ? "pp" : "%";
      const sets = companies.map((co, i) => {
        let data = years.map((y) => num(getter(metricRecord(co, metricPeriodForYear(y)))));
        if (indexedMode) {
          const base = data[0];
          data = data.map((v) => num(v) !== null && base > 0 ? v / base * 100 : null);
        } else if (unit === "亿元") data = data.map(yi);
        return dataset(co.name + (indexedMode ? " · 指数" : " · 数值"), data, colors[i], { yAxisID: "y", valueUnit, ...(i ? { borderDash: [5, 3] } : {}) });
      });
      const changeSets = companies.map((co, i) => {
        const changes = years.map((y) => metricChange(co, metricPeriodForYear(y), unit, getter));
        return dataset(co.name + (unit === "%" ? " · 同比变化" : " · YoY"), changes.map((r) => r.value), colors[i + 2], {
          yAxisID: "y1", valueUnit: changeUnit, yoyNotes: changes.map((r) => r.note), borderDash: [3, 4], pointStyle: "triangle", pointRadius: 3,
        });
      });
      const panel = $(id).closest(".chart-panel");
      panel.querySelector(".chart-unit").textContent = `${valueUnit} / ${unit === "%" ? "同比pp" : "YoY %"}`;
      $(id).setAttribute("aria-label", panel.querySelector("h3").textContent + "数值与同比变化趋势");
      const labels = state.metricPeriod.length === 4 ? years : years.map((year) => metricPeriodLabel(metricPeriodForYear(year)));
      plot(id, "line", labels, [...sets, ...changeSets], "", {
        scales: {
          y: { title: { display: true, text: valueUnit, color: "#6b746f", font: { size: 12 } } },
          y1: { type: "linear", position: "right", beginAtZero: true, border: { display: false },
            title: { display: true, text: unit === "%" ? "同比变化 / pp" : "YoY / %", color: "#6b746f", font: { size: 12 } },
            grid: { color: (context) => context.tick.value === 0 ? "#c18c3550" : "transparent", drawTicks: false },
            ticks: { color: "#7c8780", font: { size: 12 }, maxTicksLimit: 5, callback: (value) => fmt(value) + (unit === "%" ? "" : "%") } },
        },
        tooltip: {
          label: (context) => `${context.dataset.label}  ${context.dataset.yAxisID === "y1" && context.parsed.y > 0 ? "+" : ""}${fmt(context.parsed.y, 2)}${context.dataset.valueUnit === "首年 = 100" ? "" : " " + context.dataset.valueUnit}`,
          afterBody: (items) => items.length ? changeSets.flatMap((d) => d.yoyNotes[items[0].dataIndex] ? [d.label + "：" + d.yoyNotes[items[0].dataIndex]] : []) : [],
        },
      });
      if (indexedMode) {
        const skipped = sets.filter((d) => d.data.every((v) => v === null)).map((d) => d.label);
        if (skipped.length) {
          const note = document.createElement("p"); note.className = "chart-foot"; note.textContent = skipped.join("、") + "首年基数非正或缺失，未计算指数；同比独立计算"; panel.append(note);
        }
      }
  }
  function syncUrl() {
    const params = new URLSearchParams({ code: state.code });
    if (valuationState.source !== "long") params.set("valuation_source", valuationState.source);
    if (valuationState.range !== 10) params.set("valuation_range", valuationState.range);
    if (state.compare) params.set("compare", state.compare);
    if (state.range !== 20) params.set("range", state.range);
    if (state.metricGroup !== "profit") params.set("metrics", state.metricGroup);
    if (state.scale === "indexed") params.set("scale", "indexed");
    if (state.pnlYear && state.pnlYear !== String(lastAnnualYear())) params.set("pnl", state.pnlYear);
    if (state.metricPeriod && state.metricPeriod !== String(getCompany(state.code).score.annual_year)) params.set("report", state.metricPeriod);
    history.replaceState({}, "", location.pathname + "?" + params + location.hash);
  }
  function renderSankeys(c, cmp) {
    const box = $("sankey-content"), pack = state.pnl[c.code];
    if (!pack || !window.LiquorSankey) {
      box.innerHTML = '<p class="score-caption">利润流向数据暂不可用。</p>';
      return;
    }
    const years = (pack.year_list || []).slice(-state.range);
    if (!years.includes(state.pnlYear)) { state.pnlYear = years.at(-1) || ""; syncUrl(); }
    const comparisonOpen = box.querySelector("details")?.open || false;
    box.innerHTML = `<div class="sankey-company"><h3>${esc(c.name)} <small>${esc(c.code)}</small></h3><div id="sankey-primary"></div></div>${cmp ? `<details class="disclosure sankey-comparison"${comparisonOpen ? " open" : ""}><summary>${esc(cmp.name)} · 同年度利润桑基图</summary><div id="sankey-comparison"></div></details>` : ""}`;
    [c, cmp].filter(Boolean).forEach((co, i) => {
      const companyPack = state.pnl[co.code];
      if (!companyPack) return;
      const previous = String(Number(state.pnlYear) - 1);
      window.LiquorSankey.render($(i ? "sankey-comparison" : "sankey-primary"), {
        pack: companyPack, name: co.name, year: state.pnlYear,
        prevYear: companyPack.years[previous] ? previous : "",
        yearList: years.filter((y) => companyPack.years[y]),
        onYearChange: (year) => { state.pnlYear = year; syncUrl(); renderSankeys(c, cmp); },
      });
    });
  }
  function evidenceCards(c) {
    const titles = { product_mix: "品牌与产品结构", channel_health: "渠道健康", cycle_resilience: "终端需求与周期", capital_allocation: "资本配置", governance: "公司治理" };
    return c.score.references.map((ref) => `<article class="evidence-item"><h3>${esc(titles[ref.name] || ref.name)}</h3>${badge(ref.evidence.length ? "有核验记录" : "待核验", ref.evidence.length ? "blue" : "warn")}${ref.evidence.length ? ref.evidence.map((ev) => `<p>${esc(ev.observation)}</p><p>${sourceLink(ev.source)} · ${esc(ev.source_date || "日期待核验")}</p>`).join("") : '<p>尚无可追溯的同口径证据</p>'}</article>`).join("");
  }
  function sourceLink(source) { return /^https?:\/\//.test(source || "") ? `<a target="_blank" rel="noreferrer" href="${esc(source)}">原始来源</a>` : esc(source || "来源待核验"); }
  function financialTable(c, cmp) {
    const rows = [c, cmp].filter(Boolean).flatMap((co) => co.annual.slice(-state.range).map((r) => `<tr><td>${esc(co.name)} · ${r.year}</td><td>${fmt(yi(r.revenue))}</td><td>${fmt(yi(r.net_profit))}</td><td>${pct(r.operating_margin)}</td><td>${pct(r.roa)}</td><td>${pct(r.roe)}</td><td>${pct(r.roic)}</td><td>${fmt(yi(r.owner_fcf))}</td><td>${pct(r.payout_pct)}</td></tr>`));
    return `<div class="table-wrap"><table><thead><tr><th>公司 / 年度</th><th>营收 / 亿元</th><th>归母净利 / 亿元</th><th>营业利润率</th><th>ROA</th><th>ROE</th><th>ROIC</th><th>FCF / 亿元</th><th>派现率</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }
  function provenance(c) {
    const rows = Object.entries(c.provenance?.fields || {}).filter(([key]) => key.startsWith(c.score.annual_year + "-") || key.startsWith(c.score.annual_year + "."));
    return `<p class="score-caption">${(c.provenance?.conflicts || []).length} 条来源冲突；冲突字段不参与计算。合并净利润用于匹配 CFO；归母净利润用于匹配股东分红。</p><div class="table-wrap"><table class="wrap-table"><thead><tr><th>报告期 / 字段</th><th>来源</th><th>文件 / 计算式</th></tr></thead><tbody>${rows.map(([key, src]) => `<tr><td class="text-left">${esc(key)}</td><td>${esc(src.provider || "—")}</td><td class="formula-cell">${esc(src.file || src.formula || src.column || "—")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function renderValuationHistory() {
    const host = $("valuation-history");
    if (!host) return;
    state.charts = state.charts.filter((chart) => {
      if (chart.canvas.closest("#valuation-history")) { chart.destroy(); return false; }
      return true;
    });
    const co = getCompany(state.code), source = valuationState.source;
    const pack = valuationState.data?.companies?.[co.code]?.[source];
    const rows = pack?.rows || [], spec = valuationState.data?.sources?.[source];
    const controls = `<div class="toolbar valuation-toolbar"><div class="segmented" role="group" aria-label="估值数据口径">${[["long", "长历史（月度抽样）"], ["daily", "日频"]].map(([id, label]) => `<button type="button" data-valuation-source="${id}" aria-pressed="${source === id}" class="${source === id ? "active" : ""}">${label}</button>`).join("")}</div><label>估值展示范围 <select id="valuation-range" aria-label="估值展示范围">${options([[5, "近5年"], [10, "近10年"], [20, "近20年"], [0, "全部历史"]], valuationState.range)}</select></label></div>`;
    if (!rows.length || !window.LiquorValuation) {
      host.innerHTML = controls + `<p class="banner warning" role="status">历史估值数据暂不可用：${esc(valuationState.error || pack?.error || "缺少当前标的历史序列")}。</p>`;
    } else {
      const key = co.code + ":" + source;
      if (!valuationState.cache.has(key)) valuationState.cache.set(key, Object.fromEntries(["pe", "pb"].map((metric) => [metric, window.LiquorValuation.calculate(window.LiquorValuation.observations(rows, metric, source), metric)])));
      const computed = valuationState.cache.get(key);
      const sourceUrl = source === "daily" ? `https://data.eastmoney.com/gzfx/detail/${co.code}.html` : `https://gushitong.baidu.com/stock/ab-${co.code}`;
      const stats = ["pe", "pb"].map((metric) => {
        const last = computed[metric].at(-1);
        if (!last) return "";
        return `<tr><th>${metric === "pe" ? "PE(TTM)" : "PB"}</th><td>${last.date}</td><td>${fmt(last.value, 2)}</td><td>${pct(last.percentile5)}</td><td>${pct(last.percentile10)}</td><td>${fmt(last.mean, 2)}</td><td>${fmt(last.std, 2)}</td><td>${last.mean === null ? "—" : `${fmt(last.mean - last.std, 2)} ~ ${fmt(last.mean + last.std, 2)}`}</td><td>${last.count5 || "—"} / ${last.count10 || "—"}</td></tr>`;
      }).join("");
      host.innerHTML = controls + `<p class="score-caption">${esc(co.name)} · <a href="${sourceUrl}" target="_blank" rel="noreferrer">${esc(spec?.provider?.split(" / ")[0] || source)}</a> · ${esc(spec?.frequency || "")}。${esc(spec?.pe_basis)} / ${esc(spec?.pb_basis)}。数据观察日 ${rows[0].date} 至 ${rows.at(-1).date}；采集 ${esc(pack.fetched_at?.slice(0, 10) || "—")}。</p>`
        + (pack.error ? '<p class="banner warning">本次更新失败，当前显示之前保留的历史快照。</p>' : "")
        + `<div class="table-wrap valuation-snapshot"><table><thead><tr><th>指标</th><th>源站观察日</th><th>当前 / 倍</th><th>5年百分位</th><th>10年百分位</th><th>5年均值 / 倍</th><th>标准差 / 倍</th><th>均值 ±1σ / 倍</th><th>有效点数 5年 / 10年</th></tr></thead><tbody>${stats}</tbody></table></div>`
        + `<div class="chart-grid">${["pe", "pb"].map((metric) => chartPanel("valuation-" + metric, metric.toUpperCase() + " · 五年均值与标准差通道", co.name + " · 滚动均值、±1σ、±2σ", "倍", "valuation-chart")).join("")}${["pe", "pb"].map((metric) => chartPanel("valuation-" + metric + "-percentile", metric.toUpperCase() + " · 历史百分位", "逐时点回看5年 / 10年 · 完整窗口", "%", "valuation-chart")).join("")}</div>`
        + `<details class="disclosure valuation-method"><summary>历史估值统计口径与覆盖</summary><p class="score-caption">滚动窗口为 (观察日 − 5/10个自然年, 观察日]，包含当前观察值，只使用当时及之前的数据。百分位 =（低于当前值的有效点数 + 相同值点数 × 0.5）/ 有效点数 × 100%。五年均值为有效点等权平均；σ为总体标准差（分母 N），通道为均值 ±1σ、±2σ，不裁剪负下界。PE/PB 非正值或缺项不参与统计，原始曲线断开；不对正值异常高估值截尾。</p><p class="score-caption">历史不足完整5/10年时对应统计留空，不用短窗口替代。长历史口径按月取源站最后一个可用抽样点，最新月份可能尚未结束，不视作月末收盘；日频口径按交易日等权。两种数据源分别统计，百分位可能不同。日频历史若从2018年开始，十年百分位尚不可计算。估值统计与上方财报期间、年度范围及指数化模式独立；标准差通道不代表置信区间或买卖信号。</p></details>`;
      for (const metric of ["pe", "pb"]) {
        const all = computed[metric], latest = all.at(-1)?.date;
        const cutoff = latest && valuationState.range ? window.LiquorValuation.yearsBefore(latest, valuationState.range) : "";
        const shown = all.filter((r) => r.date >= cutoff), labels = shown.map((r) => r.date);
        const xAxis = { ticks: { maxTicksLimit: 5, maxRotation: 0, autoSkip: true, callback: (_, index) => labels[index]?.slice(0, 7) } };
        const band = (multiple) => shown.map((r) => r.mean === null ? null : r.mean + multiple * r.std);
        const base = { pointRadius: 0, pointHitRadius: 4, tension: 0 };
        plot("valuation-" + metric, "line", labels, [
          dataset("均值 −2σ", band(-2), "#9ba8b8", { ...base, borderWidth: 1, borderDash: [3, 4] }),
          dataset("均值 +2σ", band(2), "#9ba8b8", { ...base, borderWidth: 1, borderDash: [3, 4], fill: { target: 0, above: "rgba(54,121,204,.05)" } }),
          dataset("均值 −1σ", band(-1), "#6195c2", { ...base, borderWidth: 1 }),
          dataset("均值 +1σ", band(1), "#6195c2", { ...base, borderWidth: 1, fill: { target: 2, above: "rgba(54,121,204,.12)" } }),
          dataset("5年均值", shown.map((r) => r.mean), "#c18c35", { ...base, borderDash: [6, 3] }),
          dataset(metric.toUpperCase(), shown.map((r) => r.value), "#087f70", { ...base, borderWidth: 2.2 }),
        ], "倍", { scales: { x: xAxis } });
        const has5 = shown.some((r) => r.percentile5 !== null), has10 = shown.some((r) => r.percentile10 !== null);
        plot("valuation-" + metric + "-percentile", "line", labels, [
          dataset("5年百分位", shown.map((r) => r.percentile5), "#087f70", base),
          dataset("10年百分位", shown.map((r) => r.percentile10), "#3679cc", { ...base, borderDash: [5, 3] }),
        ], "%", { scales: { x: xAxis, y: { min: 0, max: 100, ticks: { stepSize: 20, callback: (v) => v + "%" } } }, emptyLabel: "历史不足完整5年，百分位暂不可计算" });
        if (!has5 || !has10) $("valuation-" + metric + "-percentile").closest(".chart-panel").insertAdjacentHTML("beforeend", `<p class="chart-foot">${!has5 ? "5年、" : ""}10年窗口覆盖不足，对应百分位留空。</p>`);
      }
    }
    host.querySelectorAll("[data-valuation-source]").forEach((button) => { button.onclick = () => { valuationState.source = button.dataset.valuationSource; renderValuationHistory(); syncUrl(); }; });
    $("valuation-range").onchange = (event) => { valuationState.range = Number(event.target.value); renderValuationHistory(); syncUrl(); };
    window.lucide?.createIcons();
  }
  function valuation(c) {
    const d = c.dcf || {}, scenarios = d.scenarios || [];
    const label = d.price_comparable ? "情景每股价值" : "未计净现金的每股价值代理";
    const rows = scenarios.map((s) => `<tr><td>${esc(s.name)}</td><td>${pct(s.assumptions.growth * 100)}</td><td>${pct(s.assumptions.terminal_growth * 100)}</td><td>${pct(s.assumptions.discount_rate * 100)}</td><td>${fmt(s.value_per_share, 2)}</td><td>${d.price_comparable ? pct(num(s.margin_of_safety) === null ? null : s.margin_of_safety * 100) : "不可比"}</td></tr>`).join("");
    const bridge = (d.bridge || []).map((r) => `<tr><td>${r.year}</td><td>${fmt(yi(r.cfo))}</td><td>${fmt(yi(r.capex))}</td><td>${fmt(yi(r.owner_fcf))}</td><td>${fmt(yi(r.fcff))}</td></tr>`).join("");
    const sens = (d.sensitivity || []).filter((r) => r.cash_flow_multiplier === 1);
    const rates = [...new Set(sens.map((r) => r.effective_discount_rate ?? r.discount_rate))].sort((a,b) => a-b);
    const terms = [...new Set(sens.map((r) => r.terminal_growth))].sort((a,b) => a-b);
    const heatmap = rates.length ? `<div class="table-wrap"><table class="heatmap"><thead><tr><th>永续增长 / 折现率</th>${rates.map((r) => `<th>${pct(r * 100)}</th>`).join("")}</tr></thead><tbody>${terms.map((t) => `<tr><td>${pct(t * 100)}</td>${rates.map((r) => { const hit = sens.find((s) => s.terminal_growth === t && (s.effective_discount_rate ?? s.discount_rate) === r); return `<td style="background:rgba(8,127,112,${.03 + Math.max(0, Math.min(.14, (.13 - r) * 2 + t * 2))})">${fmt(hit?.value_per_share)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>` : "";
    return `<div class="banner warning">${!scenarios.length ? "最新年报现金流缺失、非正或股本不足，暂不外推价值。" : d.price_comparable ? "净现金已核验；估值仍为研究情景。" : "债务组成未核验，当前价值代理不能直接与股价比较，不显示低估或安全边际结论。"} 基数：${esc(d.base_label || "数据不足").replace("owner FCF", "简化自由现金流").replace("FCFF", "企业自由现金流")}，${fmt(yi(d.base_cash_flow_CNY))} 亿元。直接取最新完整年报，不作多年平均或中位数平滑。</div>`
      + `<div class="table-wrap"><table><thead><tr><th>情景</th><th>起始增长</th><th>永续增长</th><th>折现率</th><th>${label} / 元</th><th>安全边际</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="table-empty">最新年报现金流缺失、非正或缺少股本，不外推价值</td></tr>'}</tbody></table></div>`
      + (heatmap ? `<details class="disclosure"><summary>估值敏感性 · ${label} / 元</summary>${heatmap}<p class="score-caption">现金流基数固定为 100%；仅改变折现率与永续增长，其他假设不变。</p></details>` : "")
      + `<details class="disclosure"><summary>估值输入与边界</summary><p class="score-caption">下表历史年度仅供对照；基数只采用 ${d.base_year || "最新"} 年报。${esc(d.assumptions || "")}</p><div class="table-wrap"><table><thead><tr><th>年度</th><th>CFO / 亿元</th><th>资本开支 / 亿元</th><th>简化 FCF / 亿元</th><th>FCFF / 亿元</th></tr></thead><tbody>${bridge}</tbody></table></div><p class="score-caption">预测五年、增长逐步收敛。FCFF 按资本成本折现；简化 FCF 路径使用股权成本代理。全部资本开支尚未分成维持与扩张，营收增速仅作增长代理；永续增长与再投资尚未构建完整经营驱动联动，因此本模型属于简化外推。</p><p class="score-caption">严格成熟企业估值需约束：再投资率 = 永续增长率 / 稳态资本回报率。财报债务、超额现金及维持性投资未核验时，不应把外推值视为目标价。</p></details>`;
  }

  function renderFormula() {
    const c = getCompany(state.code), s = c.score;
    const missingRoc = state.companies.flatMap((co) => co.annual.slice(-5)).filter((r) => r.roic == null).length;
    mount(pageHead("评分方法", modelVersion() + " · 财报质量", `<label>实际案例<select id="formula-company">${companyOptions(c.code)}</select></label>`)
      + `<div class="formula-intro"><div><div class="section-title"><h2>长期财务质量</h2><small>五个完整年度 · 满分 100</small></div><div class="dimension-list">${state.data.model.dimensions.map(([name, weight], i) => `<div class="dimension-row"><span>${"ABCDE"[i]} ${esc(name)}</span><div class="dim-track"><i style="width:${weight / 30 * 100}%;background:${colors[i]}"></i></div><span>${weight} 分</span></div>`).join("")}</div></div><div class="formula-equation"><p>单项分 = 权重 × 截断线性得分</p><p>原始分 = A + B + C + D + E</p><p>最终分 = min（原始分，已触发风险上限）</p><p>固定绝对锚点；区间外截断至 0 或满分。品牌渠道证据、短期景气和估值独立展示。</p></div></div>`
      + nav([["formula-example", "公司案例"], ["formula-liquidity", "流动性输入"], ["formula-rules", "缺项与风险"], ["formula-safety", "安全核验"], ["formula-changes", "方法变化"], ["formula-sources", "调研依据"]])
      + section("formula-example", c.name + " · 得分拆解", `${s.window_years.join(" / ")} · 年报与已实施分红`, `<div class="formula-steps"><div class="formula-step"><span>01 · 原始财务分</span><strong>${fmt(s.raw_total)}</strong></div><div class="formula-step"><span>02 · 风险上限</span><strong>${s.risk_cap}</strong></div><div class="formula-step"><span>03 · 最终财务分</span><strong class="positive">${scoreText(c)}</strong></div></div>${s.total == null ? `<div class="banner warning">缺项不补零、不提高其他指标权重。已知贡献 ${fmt(s.known_points)}，可能区间 ${s.score_range?.map((v) => fmt(v)).join("–") || "—"}，暂不排名。</div>` : ""}${s.risk_gates.length ? `<div class="banner warning">${s.risk_gates.map((r) => `${esc(r.label)}：上限 ${r.cap}`).join("；")}</div>` : ""}${scoreDetail(c)}`)
      + section("formula-liquidity", c.name + " · 流动性复合约束", "C1 · 满分 10 · 最新年与五年中位系数取较小值", `<p class="score-caption">每年先取现金覆盖得分系数与速动比率得分系数的较小值。现金比率从 20% 至 100% 线性计分，速动比率从 50% 至 150% 线性计分，均截断至 0–1。两项不叠加奖励。</p>${liquidityDetail(c)}`)
      + section("formula-rules", "缺项、已知零值与风险闸门", "五个完整年度 · 固定绝对锚点", `<div class="method-grid"><div><h3>口径与最新年约束</h3><p>CFO 与合并净利匹配，分红与归母净利匹配。五年 CAGR 另取窗口首年前一年。非经常收益及两类应收取最新年与历史中较差者；流动性也约束最新年。</p></div><div><h3>零、亏损、缺失分开</h3><p>已核验零分红计零；累计净利非正的现金转化或派现率计零并标经济无效。缺项保留区间，不补零、不归一化。净值零也要核对账面余额和坏账准备。</p></div><div><h3>风险上限</h3><p>${state.data.model.risk_rules.map((r) => `${esc(r.label)} ≤ ${r.cap} 分`).join("；")}。多个闸门取最低上限。三年简化 FCF 合计非正保留复核提示，不自动压至 59 分。</p></div><div><h3>财务代理的边界</h3><p>ROIC 缺项 ${missingRoc} / ${state.companies.length * 5}，不使用 ROE 替代。货币资金未扣受限、流动负债含合同负债，流动性分不等于严格偿债安全。存货与合同负债不直接计分。</p></div></div>`)
      + section("formula-style", "估值×基本面", "最新年报基准DCF · 独立于100分财务评分", `<div class="method-grid"><div><h3>最新年报基数</h3><p>直接取最新完整年报的FCFF；缺失或非正时回退同年简化FCF，不取多年平均或中位数。同年回退值仍不可用时，不使用旧年度正现金流替代。</p></div><div><h3>低估与不便宜</h3><p>只使用已核验可比的基准DCF每股价值。安全边际 = 1 − 现价 / 基准每股价值；大于0时进入低估观察，否则归为不便宜。PE和股息率继续作为独立参考，不参与标签判断。DCF参数为研究假设，未经收益回测。</p></div><div><h3>五类交叉标签</h3><p>V5 ≥ 80分视作财务较强，结合DCF价格判断分为“质优低估”或“质优不便宜”；低于80分时分为“低估质弱”或“质弱价格一般”。DCF低估且经营韧性得分不足该维满分50%时，提示“价值陷阱风险”。</p></div><div><h3>缺项与边界</h3><p>亏损或零利润显示“亏损估值不适用”；最新年现金流非正且无可用回退值显示“现金流非正，DCF不适用”。净现金、同日股价/股本、最新年报DCF或财务分未核验时，显示“DCF估值待核验”。未加净现金的每股价值代理不与现价比较，不将空债务字段当作零。</p></div></div>`)
      + section("formula-safety", "独立安全核验", "财务观察分完整，不等于风险已核验通过", safetyDetail(c))
      + section("formula-changes", "从 V4 到 V5", "依据《手把手教你读财报》的三表交叉验证", `<div class="table-wrap"><table class="wrap-table"><thead><tr><th>V4 项目</th><th>V5 处理</th><th>依据</th></tr></thead><tbody>${[
        ["盈利 25：利润率低谷保持率", "ROA 8、营业利润率 10、非经常收益依赖 7", "补充收益来源验证，防止把报表营业利润当作纯主业盈利"],
        ["现金创造 25，另在分红中计 FCF 覆盖", "现金创造 30；取消分红 FCF 覆盖的重复加分", "收现与再投入后留存分别观察，经营造血年占比补充连续性"],
        ["财务缓冲 15，主要看历史中位数", "家底 25；现金与速动取瓶颈，加入正常应收约束", "最新年恶化不能被中位数掩盖，关注销售与非销售占款"],
        ["经营韧性 15", "营收 CAGR 5、最差同比 5", "增长封顶，降低周期和低基数对长期分数的影响"],
        ["股东回报 20", "派现 6、连续性 4，共 10", "保留实际现金回报，减少与现金创造的重复奖励"],
        ["三年 FCF 合计非正压至 59", "改为复核观察，保留亏损、负 CFO 与非正权益上限", "区分合理扩产、收款恶化和无效投资"],
      ].map((r) => `<tr>${r.map((v) => `<td class="formula-cell">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`)
      + section("formula-sources", "书籍与研究依据", "财报阅读框架与估值辅助资料", `<ul class="source-list">${state.data.model.research_sources.map((r) => `<li>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.name)}</a>` : `<strong>${esc(r.name)}</strong>`}<p>${esc(r.description)}</p></li>`).join("")}</ul><div class="banner warning">${state.data.model.dimensions.map(([, weight]) => weight).join(" / ")} 权重、零分线、满分线及风险上限为本研究台的研究假设，不是原书作者的官方评分，尚未做收益回测。品牌、渠道、治理和估值独立核验。</div>`));
    $("formula-company").onchange = (e) => { state.code = e.target.value; history.replaceState({}, "", location.pathname + "?code=" + state.code); renderFormula(); };
  }

  async function init() {
    try {
      const response = await fetch("data.json?v=5");
      if (!response.ok) throw new Error("数据文件 HTTP " + response.status);
      state.data = await response.json(); state.companies = state.data.companies || [];
      if (state.page === "industry") {
        const industryResponse = await fetch("industry.json?v=5.4", { cache: "no-store" });
        if (!industryResponse.ok) throw new Error("行业数据文件 HTTP " + industryResponse.status);
        state.industry = await industryResponse.json();
        if (!Array.isArray(state.industry.financial_trends) || state.industry.as_of !== state.data.as_of) throw new Error("行业趋势与公司数据的研究截止日不一致，请重建行业数据");
        if (state.industry.research && state.industry.research.financial_as_of !== state.data.as_of) throw new Error("行业研究与公司数据的截止日不一致，请重建研究数据");
      }
      if (["stock", "compare"].includes(state.page)) {
        try {
          let knowledgeResponse = await fetch("/api/knowledge", { cache: "no-store" });
          if (!knowledgeResponse.ok) knowledgeResponse = await fetch("knowledge.json?v=1", { cache: "no-store" });
          if (knowledgeResponse.ok) knowledgePack = await knowledgeResponse.json();
        } catch (_) { knowledgePack = null; }
      }
      if (state.page === "stock") {
        const pnlResponse = await fetch("pnl.json?v=4");
        if (pnlResponse.ok) state.pnl = await pnlResponse.json();
        try {
          const response = await fetch("valuation.json?v=1", { cache: "no-store" });
          if (!response.ok) throw new Error("历史文件 HTTP " + response.status);
          valuationState.data = await response.json();
        } catch (error) { valuationState.error = error.message; }
      }
      if (!state.companies.length || !String(state.data.model?.version).startsWith("V5")) throw new Error("需要 V5 财务数据快照");
      if (typeof Chart === "undefined") throw new Error("本地图表库未能加载");
      Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
      Chart.defaults.color = "#6b746f";
      const params = new URLSearchParams(location.search);
      valuationState.source = params.get("valuation_source") === "daily" ? "daily" : "long";
      valuationState.range = [0, 5, 10, 20].includes(Number(params.get("valuation_range"))) && params.has("valuation_range") ? Number(params.get("valuation_range")) : 10;
      state.code = getCompany(params.get("code")) ? params.get("code") : state.companies[0].code;
      if (state.page === "compare") {
        state.styleFilters = new Set((params.get("tags") || "").split(",").filter((tag) => Object.hasOwn(window.LiquorCompanyStyle.tags, tag)));
        state.compareMode = params.get("select") === "1";
        if (state.compareMode) {
          state.selected = new Set((params.get("selected") || "").split(",").filter((code) => getCompany(code)).slice(0, 2));
          state.onlySelected = params.get("only") === "1";
        }
        const sort = params.get("sort");
        if (sort === "name" || comparisonColumns().some((column) => column.key === sort)) state.sort = sort;
        state.dir = params.get("order") === "asc" ? 1 : -1;
      }
      state.compare = getCompany(params.get("compare")) && params.get("compare") !== state.code ? params.get("compare") : "";
      state.metricPeriod = metricPeriodOptions().some(([period]) => period === params.get("report")) ? params.get("report") : String(getCompany(state.code).score.annual_year);
      state.range = [5, 10, 20].includes(Number(params.get("range"))) ? Number(params.get("range")) : 20;
      state.scale = params.get("scale") === "indexed" ? "indexed" : "amount";
      state.pnlYear = state.pnl[state.code]?.years?.[params.get("pnl")] ? params.get("pnl") : "";
      const metricAliases = { "stock-cash": "cash", "stock-channel": "channel", "stock-profit-flow": "profit" };
      const hashMetric = Object.values(state.data.financial_metrics?.metrics || {}).find((m) => metricId(m.key) === location.hash.slice(1));
      const group = params.get("metrics") || metricAliases[location.hash.slice(1)] || hashMetric?.group;
      if (state.data.financial_metrics?.groups.some((g) => g.id === group)) state.metricGroup = group;
      state.period = periodOptions().some(([value]) => value === params.get("period")) ? params.get("period") : periodOptions()[0]?.[0] || String(lastAnnualYear());
      ({ industry: renderIndustry, compare: renderCompare, stock: renderStock, formula: renderFormula }[state.page] || renderIndustry)();
      if (location.hash) {
        const target = metricAliases[location.hash.slice(1)] ? $("stock-operating") : document.getElementById(location.hash.slice(1));
        (target?.closest(".chart-panel") || target)?.scrollIntoView({ behavior: "instant", block: "start" });
      }
      window.__liquorReady = true;
    } catch (error) {
      console.error(error);
      root.setAttribute("aria-busy", "false");
      root.innerHTML = `<header class="page-head"><h1>白酒研究台</h1></header><div class="banner error" role="alert">研究数据暂不可用：${esc(error.message)}。请通过本地研究服务访问，并确认数据快照与页面版本一致。</div><button id="retry">重新加载</button>`;
      $("retry").onclick = () => location.reload();
    }
  }
  init();
})();
