(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const fmt = (v, d = 1) => num(v) === null ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: d }).format(v);
  const pct = (v) => num(v) === null ? "—" : fmt(v) + "%";
  const yi = (v) => num(v) === null ? null : v / 1e8;
  const colors = ["#087f70", "#3679cc", "#c18c35", "#aa6a91", "#7a8c53", "#be4c48"];
  const state = { data: null, pnl: {}, pnlYear: "", companies: [], page: document.body.dataset.page, charts: [], period: "", query: "", status: "all", group: "core", sort: "score", dir: -1, selected: new Set(), onlySelected: false, code: "", compare: "", range: 5, scale: "amount" };
  const root = $("workspace");
  const annual = (c, year) => (c.annual || []).find((r) => String(r.year) === String(year)) || {};
  const row = (c, period) => String(period).length === 4 || String(period).endsWith("-12-31") ? annual(c, String(period).slice(0, 4)) : (c.quarterly || []).find((r) => r.report_date === period) || {};
  const priorPeriod = (period) => String(Number(String(period).slice(0, 4)) - 1) + String(period).slice(4);
  const lastAnnualYear = () => Math.max(...state.companies.map((c) => c.score.annual_year || 0));
  const scoreItem = (c, key) => (c.score.dimensions || []).flatMap((d) => d.items).find((i) => i.name === key) || {};
  const getCompany = (code) => state.companies.find((c) => c.code === code);
  const scoreLabel = (c) => c.score.total == null ? "评分待核验" : c.score.risk_cap < 100 ? "触发风险上限" : c.score.total >= 80 ? "财务表现较强" : c.score.total >= 60 ? "财务表现中等" : "财务表现偏弱";
  const tone = (c) => c.score.total == null ? "warn" : c.score.total >= 80 ? "good" : c.score.total < 60 || c.score.risk_cap < 100 ? "risk" : "blue";
  const badge = (label, kind = "") => `<span class="tag ${kind}">${esc(label)}</span>`;
  const scoreText = (c) => c.score.total == null ? "待核验" : fmt(c.score.total, 1);
  const change = (v, suffix = " 同比") => num(v) === null ? '<span class="change">同比不可比</span>' : `<span class="change ${v >= 0 ? "positive" : "negative"}">${v > 0 ? "+" : ""}${pct(v)}</span>${esc(suffix)}`;
  const safeRatio = (a, b, scale = 1) => num(a) !== null && num(b) !== null && b > 0 ? a / b * scale : null;
  const growth = (c, field, period) => {
    const a = row(c, period)[field], b = row(c, priorPeriod(period))[field];
    return num(a) !== null && num(b) !== null && b > 0 ? (a / b - 1) * 100 : null;
  };
  function sum(field, period) {
    const vals = state.companies.map((c) => num(row(c, period)[field]));
    return { value: vals.every((v) => v !== null) ? vals.reduce((a, b) => a + b, 0) : null, count: vals.filter((v) => v !== null).length };
  }
  function totalGrowth(field, period) {
    return safeRatio(sum(field, period).value, sum(field, priorPeriod(period)).value, 100) == null ? null : sum(field, period).value / sum(field, priorPeriod(period)).value * 100 - 100;
  }
  function pageHead(title, detail, controls = "") {
    const dates = [...new Set(state.companies.map((c) => c.price?.price_date).filter(Boolean))];
    const dateLabel = dates.length === 1 ? dates[0] : dates.length ? dates.sort().at(0) + " 至 " + dates.at(-1) : "未核验";
    return `<header class="page-head"><div><h1>${esc(title)}${detail ? `<small>${esc(detail)}</small>` : ""}</h1><div class="meta"><span class="live-dot">${state.companies.length} 家上市样本</span><span>行情 ${esc(dateLabel)}</span><span>财务评分 ${lastAnnualYear()}A · V4</span><span>研究截至 ${esc(state.data.as_of)}</span></div></div><div class="head-controls">${controls}</div></header>`;
  }
  function kpi(label, value, unit, foot, tag = "") {
    return `<article class="kpi"><div class="kpi-label">${esc(label)}${tag}</div><div class="kpi-value">${value}<small>${esc(unit)}</small></div><div class="kpi-foot">${foot}</div></article>`;
  }
  function section(id, title, subtitle, content) {
    return `<section id="${id}" class="section"><div class="section-title"><h2>${esc(title)}</h2><small>${esc(subtitle)}</small></div>${content}</section>`;
  }
  function chartPanel(id, title, subtitle, unit = "", size = "") {
    return `<article class="chart-panel"><div class="chart-head"><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><div class="chart-tools"><span class="chart-unit">${esc(unit)}</span><button class="icon-button" data-zoom="${id}" title="放大图表" aria-label="放大${esc(title)}"><i data-lucide="maximize-2"></i></button></div></div><div class="chart-box ${size}"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div></article>`;
  }
  function nav(items) { return `<nav class="section-nav" aria-label="本页章节">${items.map(([id, name]) => `<a href="#${id}">${esc(name)}</a>`).join("")}</nav>`; }
  function footer() {
    return `<footer class="footer"><span>AKShare / 东方财富财报快照 · 缺项才使用已核验 iFinD 补充 · 上市样本不等于全行业</span><span>生成 ${esc(state.data.generated_at?.slice(0, 10) || "—")} · 研究假设，未经收益回测</span></footer>`;
  }
  function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }
  function mount(html) { destroyCharts(); root.innerHTML = html + footer(); root.setAttribute("aria-busy", "false"); window.lucide?.createIcons(); }
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-zoom]");
    if (!button) return;
    const canvas = $(button.dataset.zoom), original = canvas && Chart.getChart(canvas);
    if (!original) return;
    const panel = canvas.closest(".chart-panel");
    const dialog = document.createElement("dialog"); dialog.className = "chart-dialog";
    dialog.setAttribute("aria-label", panel.querySelector("h3").textContent + "放大视图");
    dialog.innerHTML = `<header><div><h2>${esc(panel.querySelector("h3").textContent)}</h2><span>${esc(panel.querySelector(".chart-unit").textContent)} · ${esc(panel.querySelector(".chart-head p").textContent)}</span></div><button class="icon-button" title="关闭放大视图" aria-label="关闭放大视图"><i data-lucide="x"></i></button></header><div class="chart-box"><canvas role="img" aria-label="${esc(panel.querySelector("h3").textContent)}放大图"></canvas></div>`;
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
    if (!datasets.some((d) => d.data.some(hasPoint))) {
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
        legend: { display: datasets.length > 1, position: "bottom", labels: { usePointStyle: true, pointStyle: "line", boxWidth: 18, boxHeight: 5, padding: 15, font: { size: 10 }, color: "#6b746f" } },
        tooltip: { backgroundColor: "#253d33", padding: 11, titleFont: { size: 11 }, bodyFont: { size: 11 }, displayColors: true,
          callbacks: { label: (ctx) => `${ctx.dataset.label || ""}  ${fmt(horizontal ? ctx.parsed.x : ctx.parsed.y, 2)}${unit}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: "#7c8780", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
        y: { grid: { color: "#edf0ee", drawTicks: false }, border: { display: false }, ticks: { padding: 8, color: "#7c8780", font: { size: 10 }, maxTicksLimit: 5, callback: (v) => fmt(v, 1) }, beginAtZero: type === "bar" },
      },
    };
    if (horizontal) {
      options.scales.x = { ...options.scales.y, beginAtZero: true };
      options.scales.y = { grid: { display: false }, border: { display: false }, ticks: { color: "#637069", font: { size: 11 }, autoSkip: false } };
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
    return quarters.filter((p) => p.endsWith("06-30") || p.endsWith("09-30")).slice(0, 2).map((p) => [p, p.endsWith("06-30") ? p.slice(0, 4) + " 中报" : p.slice(0, 4) + " 三季报"])
      .concat([[String(lastAnnualYear()), lastAnnualYear() + " 年报"], [String(lastAnnualYear() - 1), (lastAnnualYear() - 1) + " 年报"]]);
  }
  function options(items, value) { return items.map(([key, name]) => `<option value="${esc(key)}"${String(key) === String(value) ? " selected" : ""}>${esc(name)}</option>`).join(""); }
  function companyOptions(value, allowNone = false) { return options((allowNone ? [["", "不设对比"]] : []).concat(state.companies.map((c) => [c.code, c.name])), value); }
  function renderIndustry() {
    const p = state.period;
    const metrics = [["revenue", "营业收入"], ["net_profit", "归母净利润"], ["cfo", "经营现金流"], ["contract_liabilities", "合同负债"]];
    const cards = metrics.map(([key, title]) => {
      const s = sum(key, p);
      return kpi(title, fmt(yi(s.value)), "亿元", change(totalGrowth(key, p)) + ` <span>· ${s.count}/${state.companies.length} 家</span>`);
    }).join("");
    const charts = chartPanel("ind-revenue", "营业收入与增长", "同一上市样本 · 完整年度", "亿元 / %") + chartPanel("ind-cash", "利润与现金流", "归母净利润与经营现金流对照", "亿元")
      + chartPanel("ind-margins", "盈利与现金创造", "样本合计比率 · 按营收加权", "%") + chartPanel("ind-channel", "厂商存货与合同负债", "资产负债表余额 · 非经销商库存", "亿元");
    mount(pageHead("白酒行业", "上市样本观察", `<label>财报口径<select id="industry-period">${options(periodOptions(), p)}</select></label>`)
      + `<div class="kpi-strip">${cards}</div><p class="note-line">${esc(p)}${String(p).length > 4 ? " 年初至今累计；同比为去年同报告期，合同负债为期末余额。" : " 完整年度；同比为上一完整年，合同负债为期末余额。"} 全国行业规模及批价序列尚未接入。</p>`
      + nav([["trends", "长期经营"], ["dispersion", "公司分化"], ["sample", "样本明细"]])
      + section("trends", "长期经营趋势", "2016–2025 完整年度 · 同样本覆盖才合计", `<div class="chart-grid">${charts}</div>`)
      + section("dispersion", "公司分化", p + " · 同口径", `<div class="chart-grid">${chartPanel("ind-dispersion", "营业收入同比", "公司间分化 · 负增长向左", "%", "tall")}${chartPanel("ind-concentration", "样本营业收入结构", "前八家公司及其余样本", "亿元", "tall")}</div>`)
      + section("sample", "上市样本明细", "顺鑫农业含非酒业务；郎酒、剑南春等未上市品牌不在样本内", `<div id="industry-sample-table"></div>`));
    $("industry-period").onchange = (e) => { state.period = e.target.value; renderIndustry(); };
    const years = [...new Set(state.companies.flatMap((c) => c.annual.map((r) => r.year)))].sort();
    const series = (field) => years.map((y) => yi(sum(field, y).value));
    plot("ind-revenue", "bar", years, [dataset("营业收入", series("revenue"), colors[0]), dataset("营收同比", years.map((y) => totalGrowth("revenue", y)), colors[2], { type: "line", yAxisID: "y1", backgroundColor: colors[2] })], "", {
      scales: { y: { title: { display: true, text: "亿元", color: "#7c8780", font: { size: 10 } } }, y1: { position: "right", grid: { display: false }, border: { display: false }, ticks: { color: colors[2], font: { size: 10 }, callback: (v) => v + "%" } } },
      tooltip: { label: (ctx) => ctx.dataset.label + "  " + fmt(ctx.parsed.y) + (ctx.dataset.yAxisID === "y1" ? "%" : " 亿元") },
    });
    plot("ind-cash", "bar", years, [dataset("归母净利润", series("net_profit"), colors[1]), dataset("经营现金流", series("cfo"), colors[0])], "亿元");
    plot("ind-margins", "line", years, [dataset("归母净利率", years.map((y) => safeRatio(sum("net_profit", y).value, sum("revenue", y).value, 100)), colors[1]), dataset("经营现金流 / 营收", years.map((y) => safeRatio(sum("cfo", y).value, sum("revenue", y).value, 100)), colors[0])], "%");
    plot("ind-channel", "line", years, [dataset("厂商存货", series("inventory"), colors[2]), dataset("合同负债", series("contract_liabilities"), colors[3])], "亿元");
    const dispersion = state.companies.map((c) => ({ c, g: growth(c, "revenue", p) })).sort((a, b) => (b.g ?? -Infinity) - (a.g ?? -Infinity));
    plot("ind-dispersion", "bar", dispersion.map((x) => x.c.name), [{ label: "营收同比", data: dispersion.map((x) => x.g), backgroundColor: dispersion.map((x) => x.g >= 0 ? colors[0] + "be" : colors[5] + "be") }], "%", { indexAxis: "y", onClick: (_, hits) => { if (hits.length) location.href = "stock.html?code=" + dispersion[hits[0].index].c.code; } });
    const byRevenue = state.companies.map((c) => ({ c, v: num(row(c, p).revenue) })).filter((x) => x.v !== null).sort((a, b) => b.v - a.v);
    const top = byRevenue.slice(0, 8), remainder = byRevenue.slice(8).reduce((a, x) => a + x.v, 0);
    plot("ind-concentration", "bar", top.map((x) => x.c.name).concat(["其余 " + (byRevenue.length - top.length) + " 家"]), [{ label: "营业收入", data: top.map((x) => yi(x.v)).concat([yi(remainder)]), backgroundColor: top.map((_, i) => colors[i % colors.length] + "ba").concat(["#b7c3bb"]) }], "亿元", { indexAxis: "y" });
    $("industry-sample-table").innerHTML = `<div class="table-wrap"><table><thead><tr><th>公司</th><th>营收 / 亿元</th><th>营收同比</th><th>净利 / 亿元</th><th>经营现金流 / 亿元</th><th>财务质量 / 100</th></tr></thead><tbody>${state.companies.map((c) => `<tr><td><a href="stock.html?code=${c.code}">${esc(c.name)}</a></td><td>${fmt(yi(row(c, p).revenue))}</td><td>${change(growth(c, "revenue", p), "")}</td><td>${fmt(yi(row(c, p).net_profit))}</td><td>${fmt(yi(row(c, p).cfo))}</td><td>${scoreText(c)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  const columns = {
    core: [["score", "财务质量", "score"], ["operating_margin", "营业利润率", "%"], ["roa", "ROA", "%"], ["cfo_conversion", "五年现金转化", "x"], ["owner_fcf", "自由现金流", "亿元"], ["yield", "股息率", "%"], ["valuation", "估值状态", "text"]],
    profit: [["score", "财务质量", "score"], ["gross_margin", "毛利率", "%"], ["gross_sales_spread", "毛销差", "%"], ["operating_margin", "营业利润率", "%"], ["roa", "ROA", "%"], ["roe", "ROE", "%"], ["roic", "ROIC", "%"]],
    cash: [["score", "财务质量", "score"], ["cfo", "经营现金流", "亿元"], ["capex", "资本开支", "亿元"], ["owner_fcf", "自由现金流", "亿元"], ["cfo_conversion", "五年现金转化", "x"], ["fcf_conversion", "五年自由现金转化", "x"], ["fcf_positive_ratio", "FCF 正值年占比", "%"]],
    dividend: [["score", "财务质量", "score"], ["yield", "股息率", "%"], ["dps", "年度每股分红", "元"], ["payout_cumulative", "五年累计派现率", "%"], ["dividend_fcf_coverage", "分红现金覆盖", "x"], ["dividend_consistency", "分红连续性", "%"]],
    risk: [["score", "财务质量", "score"], ["cash_to_current_liab", "现金覆盖", "%"], ["debt_to_asset", "资产负债率", "%"], ["other_receivables_to_asset", "其他应收 / 资产", "%"], ["inventory", "厂商存货", "亿元"], ["contract_liabilities", "合同负债", "亿元"], ["risks", "风险 / 缺项", "text"]],
  };
  function metric(c, key) {
    if (key === "score") return c.score.total;
    if (key === "yield") return num(c.dividend?.yield_pct);
    if (key === "dps") return num(c.dividend?.dps);
    if (key === "valuation") return c.dcf?.price_comparable ? "情景可比" : "净现金待核验";
    if (key === "risks") return c.score.quality_flags.join("；") || "无已触发评分闸门";
    if (Object.hasOwn(state.data.model.metric_definitions, key)) return num(scoreItem(c, key).value);
    return num(annual(c, lastAnnualYear())[key]);
  }
  function visible() {
    return state.companies.filter((c) => (!state.query || (c.name + c.code).includes(state.query)) && (!state.onlySelected || state.selected.has(c.code))
      && (state.status === "all" || state.status === "ranked" && c.score.rankable || state.status === "missing" && !c.score.rankable || state.status === "risk" && c.score.risk_gates.length))
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
    if (kind === "score") {
      if (value == null) return `<span title="${esc(c.score.missing.map((k) => state.data.model.metric_definitions[k]?.label || k).join("、"))}">${badge("待核验", "warn")}<span class="status-note">可能 ${c.score.score_range?.map((v) => fmt(v, 0)).join("–") || "—"}</span></span>`;
      return `<span class="score-cell"><span class="mini-track"><i style="width:${value}%;background:${c.score.risk_cap < 100 ? colors[5] : colors[0]}"></i></span><strong>${fmt(value)}</strong></span>${c.score.risk_cap < 100 ? `<span class="status-note negative">上限 ${c.score.risk_cap}</span>` : ""}`;
    }
    if (kind === "text") return key === "valuation" ? badge(value, c.dcf?.price_comparable ? "blue" : "warn") : `<span class="metric-help" title="${esc(value)}">${c.score.risk_gates.length ? badge(c.score.risk_gates.length + " 项风险", "risk") : c.score.missing.length ? badge(c.score.missing.length + " 项缺失", "warn") : "—"}</span>`;
    return kind === "亿元" ? fmt(yi(value)) : kind === "%" ? pct(value) : kind === "x" ? fmt(value, 2) + (value == null ? "" : " 倍") : fmt(value, 2);
  }
  function renderCompare() {
    const ranked = state.companies.filter((c) => c.score.rankable);
    mount(pageHead("公司对比", "长期财务质量", `<a href="score-formula.html">V4 评分依据</a>`)
      + `<div class="kpi-strip">${kpi("研究覆盖", String(state.companies.length), "家", "申万白酒Ⅲ上市样本")}${kpi("可比财务评分", String(ranked.length), "家", `${state.companies.length - ranked.length} 家保留缺项`)}${kpi("触发评分风险上限", String(state.companies.filter((c) => c.score.risk_gates.length).length), "家", "亏损、现金流与净资产闸门")}${kpi("可与现价比较的 DCF", String(state.companies.filter((c) => c.dcf?.price_comparable).length), "家", "债务缺项不视作零")}</div>`
      + `<div class="toolbar"><div class="controls"><input id="company-search" class="search-input" type="search" placeholder="公司名称或代码" aria-label="搜索公司"><select id="status-filter" aria-label="评分状态">${options([["all", "全部公司"], ["ranked", "评分完整"], ["missing", "资料待核验"], ["risk", "已触发风险闸门"]], state.status)}</select><label><input id="only-selected" type="checkbox"${state.onlySelected ? " checked" : ""}>仅已选</label></div><div class="controls"><button id="reset">重置</button><button id="download">导出 CSV</button></div></div>`
      + `<div class="toolbar"><div class="segmented" role="group" aria-label="指标主题">${Object.entries({ core: "核心指标", profit: "盈利回报", cash: "现金创造", dividend: "股东回报", risk: "财务风险" }).map(([key, title]) => `<button data-group="${key}" class="${state.group === key ? "active" : ""}" aria-pressed="${state.group === key}">${title}</button>`).join("")}</div><span class="meta">${lastAnnualYear()}A · 评分窗口 ${lastAnnualYear() - 4}–${lastAnnualYear()}</span></div>`
      + '<div id="compare-tray" class="compare-tray"></div><div id="comparison-table"></div>'
      + section("compare-charts", "财务质量与股东回报", "散点仅展示两项独立指标；未完成评分者不进入散点", `<div class="chart-grid">${chartPanel("compare-scores", "财务质量分布", "固定绝对锚点 · 触发风险上限的公司以红色标记", "分 / 100", "tall")}${chartPanel("compare-scatter", "财务质量 × 股息率", "完整年已实施分红 / 当前快照收盘价", "%", "tall")}</div>`));
    $("company-search").value = state.query;
    $("company-search").oninput = (e) => { state.query = e.target.value.trim(); updateCompare(); };
    $("status-filter").onchange = (e) => { state.status = e.target.value; updateCompare(); };
    $("only-selected").onchange = (e) => { state.onlySelected = e.target.checked; updateCompare(); };
    $("reset").onclick = () => { Object.assign(state, { query: "", status: "all", group: "core", sort: "score", dir: -1, onlySelected: false }); state.selected.clear(); renderCompare(); };
    $("download").onclick = exportCsv;
    root.querySelectorAll("[data-group]").forEach((btn) => { btn.onclick = () => { state.group = btn.dataset.group; if (!columns[state.group].some(([key]) => key === state.sort)) { state.sort = "score"; state.dir = -1; } renderCompare(); }; });
    updateCompare();
  }
  function updateCompare() {
    const companies = visible(), cols = columns[state.group];
    const head = (key, label) => `<th${key === "name" ? ' class="company-cell"' : ""} aria-sort="${state.sort === key ? state.dir > 0 ? "ascending" : "descending" : "none"}"><button data-sort="${key}" title="按${esc(label)}排序">${esc(label)}${state.sort === key ? state.dir > 0 ? " ↑" : " ↓" : ""}</button></th>`;
    $("comparison-table").innerHTML = `<div class="table-wrap"><table><thead><tr>${head("name", "公司")}${cols.map(([key, label]) => head(key, label)).join("")}</tr></thead><tbody>${companies.map((c) => `<tr><td class="company-cell"><input type="checkbox" data-select="${c.code}" aria-label="对比${esc(c.name)}"${state.selected.has(c.code) ? " checked" : ""}><a class="company" href="stock.html?code=${c.code}">${esc(c.name)}</a><span class="code">${c.code}</span></td>${cols.map(([key, , kind]) => `<td>${formatCell(c, key, kind)}</td>`).join("")}</tr>`).join("") || `<tr><td class="table-empty" colspan="${cols.length + 1}">没有匹配公司</td></tr>`}</tbody></table></div><div class="table-caption"><span>当前 ${companies.length} / ${state.companies.length} 家 · 金额单位：亿元 · 比率按列标注</span><span>ROA 为合并净利润 / 平均总资产；ROIC 资料不足时保持缺失</span></div>`;
    root.querySelectorAll("[data-sort]").forEach((btn) => { btn.onclick = () => { state.dir = state.sort === btn.dataset.sort ? -state.dir : btn.dataset.sort === "name" ? 1 : -1; state.sort = btn.dataset.sort; updateCompare(); }; });
    root.querySelectorAll("[data-select]").forEach((input) => { input.onchange = () => { input.checked ? state.selected.add(input.dataset.select) : state.selected.delete(input.dataset.select); updateCompare(); }; });
    const selected = [...state.selected].map(getCompany).filter(Boolean);
    $("compare-tray").innerHTML = selected.length ? `<span>已选 ${selected.length} 家</span>${selected.map((c) => `<button class="selected-company" data-remove="${c.code}" title="移除${esc(c.name)}">${esc(c.name)} ×</button>`).join("")}<button id="open-comparison" class="primary"${selected.length !== 2 ? " disabled" : ""}>深度对比</button>` : "";
    root.querySelectorAll("[data-remove]").forEach((btn) => { btn.onclick = () => { state.selected.delete(btn.dataset.remove); updateCompare(); }; });
    if ($("open-comparison")) $("open-comparison").onclick = () => { location.href = `stock.html?code=${selected[0].code}&compare=${selected[1].code}`; };
    destroyCharts();
    const ranked = companies.filter((c) => c.score.rankable).sort((a, b) => b.score.total - a.score.total);
    if (!ranked.length) {
      ["compare-scores", "compare-scatter"].forEach((id) => { const el = $(id); el.hidden = true; let empty = el.parentNode.querySelector(".chart-empty"); if (!empty) { empty = document.createElement("p"); empty.className = "chart-empty"; empty.textContent = "当前筛选中没有完整评分公司"; el.parentNode.append(empty); } });
      return;
    }
    ["compare-scores", "compare-scatter"].forEach((id) => { $(id).hidden = false; $(id).parentNode.querySelector(".chart-empty")?.remove(); });
    plot("compare-scores", "bar", ranked.map((c) => c.name), [{ label: "财务质量", data: ranked.map((c) => c.score.total), backgroundColor: ranked.map((c) => (c.score.risk_cap < 100 ? colors[5] : colors[0]) + "ba") }], "分", { indexAxis: "y", scales: { x: { min: 0, max: 100 } }, onClick: (_, hits) => { if (hits.length) location.href = "stock.html?code=" + ranked[hits[0].index].code; } });
    const scatter = ranked.filter((c) => num(c.dividend?.yield_pct) !== null);
    plot("compare-scatter", "scatter", [], [{ label: "公司", data: scatter.map((c) => ({ x: c.score.total, y: c.dividend.yield_pct, name: c.name })), pointRadius: 6, pointBackgroundColor: scatter.map((c) => c.score.risk_cap < 100 ? colors[5] : colors[0]), borderWidth: 1, borderColor: "#fff" }], "%", {
      scales: { x: { type: "linear", min: 0, max: 100, title: { display: true, text: "财务质量 / 100", color: "#7c8780", font: { size: 10 } } }, y: { beginAtZero: true, title: { display: true, text: "股息率 / %", color: "#7c8780", font: { size: 10 } } } },
      tooltip: { title: (items) => items[0]?.raw.name || "", label: (ctx) => `财务质量 ${fmt(ctx.raw.x)} · 股息率 ${pct(ctx.raw.y)}` },
      onClick: (_, hits) => { if (hits.length) location.href = "stock.html?code=" + scatter[hits[0].index].code; },
    });
  }
  function exportCsv() {
    const cols = columns[state.group];
    const quote = (v) => '"' + String(v ?? "").replace(/^[=+@]/, "'$&").replace(/"/g, '""') + '"';
    const csv = [["公司", "代码", ...cols.map(([, label, unit]) => label + (unit === "score" ? " / 100" : unit === "text" ? "" : " / " + unit))], ...visible().map((c) => [c.name, c.code, ...cols.map(([key, , kind]) => kind === "亿元" ? yi(metric(c, key)) : metric(c, key))])].map((r) => r.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `白酒公司对比-${state.group}-${state.data.as_of}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Stock and methodology views share the exact Python-produced score detail.
  function scoreDetail(c, comparison = null) {
    const other = comparison ? Object.fromEntries(comparison.score.dimensions.flatMap((d) => d.items.map((i) => [i.name, i]))) : {};
    const itemFmt = (value, unit) => value == null ? "—" : fmt(value, 2) + (unit === "%" ? "%" : unit === "x" ? " 倍" : "");
    const states = { scored: ["已评分", "good"], missing: ["资料不足", "warn"], economic_invalid: ["经济无效 · 计零", "risk"], observed_zero: ["已核验零值", "blue"] };
    return `<div class="table-wrap"><table class="wrap-table"><thead><tr><th>指标 / 权重</th><th>实际值</th><th>${esc(c.name)}</th>${comparison ? `<th>${esc(comparison.name)}</th>` : ""}<th>零分 → 满分</th><th>计算口径 / 状态</th></tr></thead><tbody>${c.score.dimensions.map((d, index) => `<tr class="dim-heading"><td colspan="${comparison ? 6 : 5}">${"ABCDE"[index]} ${esc(d.name)} · ${fmt(d.score, 1)} / ${d.weight}</td></tr>${d.items.map((i) => `<tr><td class="text-left">${esc(i.label)}<span class="status-note">满分 ${i.max} 分</span></td><td>${itemFmt(i.value, i.unit)}</td><td><strong>${fmt(i.score, 2)}</strong></td>${comparison ? `<td>${fmt(other[i.name]?.score, 2)}</td>` : ""}<td>${itemFmt(i.zero_line, i.unit)} → ${itemFmt(i.full_line, i.unit)}</td><td class="formula-cell">${esc(i.method)}<br>${badge(...(states[i.status] || states.missing))} <span class="status-note">有效年度 ${i.valid_years} / 5</span></td></tr>`).join("")}`).join("")}</tbody></table></div>`;
  }
  function dimensionBars(c, comparison = null) {
    return `<div class="compare-legend"><span><i class="legend-swatch"></i>${esc(c.name)}</span>${comparison ? `<span><i class="legend-swatch blue"></i>${esc(comparison.name)}</span>` : ""}</div><div class="dimension-list">${c.score.dimensions.map((d, i) => {
      const other = comparison?.score.dimensions[i];
      return `<div class="dimension-row"><span>${"ABCDE"[i]} ${esc(d.name)}</span><div><div class="dim-track"><i style="width:${d.score == null ? 0 : d.score / d.weight * 100}%;background:${colors[0]}"></i></div>${comparison ? `<div class="dim-track dim-secondary"><i style="width:${other?.score == null ? 0 : other.score / other.weight * 100}%;background:${colors[1]}"></i></div>` : ""}</div><span class="numeric">${fmt(d.score)}<small> / ${d.weight}</small></span></div>`;
    }).join("")}</div>`;
  }
  function renderStock() {
    const c = getCompany(state.code), cmp = getCompany(state.compare), year = c.score.annual_year, r = annual(c, year), latest = c.latest || {};
    const score = c.score;
    const share = c.shares || {}, dcf = c.dcf || {};
    const scoreRange = score.score_range ? score.score_range.map((v) => fmt(v)).join("–") : "—";
    const controls = `<label>主标的<select id="primary-select">${companyOptions(c.code)}</select></label><label>比较标的<select id="compare-select">${companyOptions(state.compare, true)}</select></label><label>年度范围<select id="range-select">${options([[5, "最近 5 年"], [10, "最近 10 年"]], state.range)}</select></label>`;
    const overview = `<div class="score-summary"><div><h3>五年财务质量 / 100</h3><div class="score-main">${score.total == null ? "待核验" : fmt(score.total)}${score.total == null ? "" : "<small> / 100</small>"}</div>${badge(scoreLabel(c), tone(c))}<p class="score-caption">${year - 4}–${year} · 覆盖 ${pct(score.coverage * 100)}</p>${score.total == null ? `<p class="score-caption">可得分区间 ${scoreRange}</p>` : `<p class="score-caption">原始分 ${fmt(score.raw_total)} · 风险上限 ${score.risk_cap}</p>`}</div><div>${dimensionBars(c, cmp)}</div><div class="score-aside"><dl><dt>收盘价</dt><dd>${fmt(c.price?.close, 2)} 元</dd><dt>已实施年度股息率</dt><dd>${pct(c.dividend?.yield_pct)}</dd><dt>最新财报</dt><dd>${esc(latest.report_date || "—")}</dd><dt>估值状态</dt><dd>${badge(dcf.price_comparable ? "情景可比" : "净现金待核验", "warn")}</dd></dl>${score.risk_gates.length ? `<ul class="risk-list">${score.risk_gates.map((x) => `<li>${esc(x.label)} · 上限 ${x.cap}</li>`).join("")}</ul>` : ""}</div></div>`;
    mount(pageHead(c.name, c.code, controls) + overview
      + `<div class="banner${score.total == null || score.risk_gates.length ? " warning" : ""}">${score.total == null ? "评分待核验：" + esc(score.missing.map((k) => state.data.model.metric_definitions[k]?.label || k).join("、")) : `财务质量 ${fmt(score.total)} 分，${scoreLabel(c)}。`}${cmp ? ` 对比 ${esc(cmp.name)}：${scoreText(cmp)} 分。` : ""} 品牌、渠道及估值另列，不由财务分推定。</div>`
      + nav([["stock-sankey", "利润桑基图"], ["stock-operating", "经营趋势"], ["stock-cash", "现金与回报"], ["stock-channel", "库存与渠道"], ["stock-value", "估值情景"], ["stock-evidence", "评分与证据"]])
      + `<div class="kpi-strip">${kpi(year + "A 营业收入", fmt(yi(r.revenue)), "亿元", change(growth(c, "revenue", year)))}${kpi(year + "A 归母净利润", fmt(yi(r.net_profit)), "亿元", change(growth(c, "net_profit", year)))}${kpi(year + "A 自由现金流", fmt(yi(r.owner_fcf)), "亿元", "经营现金流 − 全部资本开支")}${kpi(latest.report_date?.endsWith("06-30") ? "最新中报营收同比" : "最新报告营收同比", pct(growth(c, "revenue", latest.report_date)), "", esc(latest.report_date || "—") + " · 同报告期")}</div>`
      + section("stock-sankey", "利润桑基图", "营业收入 → 成本费用 → 营业利润 → 归母净利润 · 完整年报", '<div id="sankey-content"></div>')
      + section("stock-operating", "经营趋势", `${state.range} 个完整年度 · ${cmp ? "青绿为主标的，蓝色为比较标的" : "年报口径"}`, `<div class="toolbar"><div class="segmented" role="group" aria-label="规模指标模式">${[["amount", "绝对金额"], ["indexed", "首年 = 100"]].map(([key, label]) => `<button data-scale="${key}" class="${state.scale === key ? "active" : ""}" aria-pressed="${state.scale === key}">${label}</button>`).join("")}</div><span class="meta">指数模式仅作用于营收与净利</span></div><div class="chart-grid">${chartPanel("stock-revenue", "营业收入", "完整年，比较序列按年份对齐", state.scale === "indexed" ? "首年 = 100" : "亿元")}${chartPanel("stock-profit", "归母净利润", "亏损保留原值", state.scale === "indexed" ? "首年 = 100" : "亿元")}${chartPanel("stock-margin", "营业利润率", "会计营业利润率，不等于品牌护城河", "%")}${chartPanel("stock-roa", "总资产收益率 ROA", "合并净利润 / 平均总资产", "%")}</div>`)
      + section("stock-cash", "现金与股东回报", "自由现金流为 CFO − 全部资本开支的简化代理", `<div class="chart-grid">${chartPanel("stock-cfo", "经营现金流", "合并现金流量表", "亿元")}${chartPanel("stock-fcf", "自由现金流", "保留扩产及维持性开支的共同影响", "亿元")}${chartPanel("stock-cash-bridge", "经营现金流桥", year + "A · CFO → 资本开支 → 自由现金流", "亿元")}${chartPanel("stock-dividend", "每股现金分红", "按利润归属年度 · 仅已实施记录", "元 / 股")}</div>`)
      + section("stock-channel", "厂商库存与渠道观察", "厂家报表不能代替终端动销或经销商库存", `<div class="chart-grid">${chartPanel("stock-inventory", "厂商存货 / 营业收入", "长储基酒与成品酒未拆分，不直接评分", "%")}${chartPanel("stock-contract", "合同负债 / 营业收入", "受直销占比、预收政策及需求共同影响", "%")}</div>`)
      + section("stock-profit-flow", "利润结构", "营业总收入包含财务子公司利息等收入；其他净支出为对账余项", `<div class="chart-grid">${chartPanel("stock-profit-bridge", "收入到归母净利润", year + "A · 金额对账瀑布图", "亿元")}${chartPanel("stock-gross-margin", "毛利率", "财务盈利观察，不直接证明品牌护城河", "%")}</div>`)
      + section("stock-value", "独立估值情景", "简化现金流外推 · 不计入财务质量分", valuation(c))
      + section("stock-evidence", "评分与研究证据", "财务可复算；定性观察保留来源", `<div class="evidence-grid">${evidenceCards(c)}</div><details class="disclosure"><summary>五维评分明细 · ${score.dimensions.reduce((n, d) => n + d.items.length, 0)} 个指标${cmp ? " · 双公司对照" : ""}</summary>${scoreDetail(c, cmp)}</details><details class="disclosure"><summary>历年财报与回报指标</summary>${financialTable(c, cmp)}</details><details class="disclosure"><summary>字段来源与冲突记录</summary>${provenance(c)}</details>`));
    document.title = c.name + " · 白酒研究台";
    $("primary-select").onchange = (e) => { state.code = e.target.value; state.pnlYear = ""; if (state.compare === state.code) state.compare = ""; syncUrl(); renderStock(); };
    $("compare-select").onchange = (e) => { state.compare = e.target.value === state.code ? "" : e.target.value; syncUrl(); renderStock(); };
    $("range-select").onchange = (e) => { state.range = Number(e.target.value); syncUrl(); renderStock(); };
    root.querySelectorAll("[data-scale]").forEach((btn) => { btn.onclick = () => { state.scale = btn.dataset.scale; renderStock(); }; });
    renderSankeys(c, cmp);
    const years = [...new Set([c, cmp].filter(Boolean).flatMap((co) => co.annual.map((x) => x.year)))].sort().slice(-state.range);
    const trend = (id, key, unit, getter = (r) => r[key], indexed = false) => {
      const sets = [c, cmp].filter(Boolean).map((co, i) => {
        let data = years.map((y) => num(getter(annual(co, y))));
        if (indexed && state.scale === "indexed") {
          const base = data[0];
          data = data.map((v) => num(v) !== null && base > 0 ? v / base * 100 : null);
        } else if (unit === "亿元") data = data.map(yi);
        return dataset(co.name, data, colors[i], i ? { borderDash: [5, 3] } : {});
      });
      plot(id, "line", years, sets, indexed && state.scale === "indexed" ? "" : unit, { emptyLabel: indexed && state.scale === "indexed" ? "首年基数非正或缺失，无法计算指数" : "当前口径数据不足，未绘制序列" });
      if (indexed && state.scale === "indexed") {
        const skipped = sets.filter((d) => d.data.every((v) => v === null)).map((d) => d.label);
        if (skipped.length && sets.some((d) => d.data.some((v) => v !== null))) {
          const note = document.createElement("p"); note.className = "chart-foot"; note.textContent = skipped.join("、") + "首年基数非正或缺失，未计算指数"; $(id).closest(".chart-panel").append(note);
        }
      }
    };
    trend("stock-revenue", "revenue", "亿元", undefined, true);
    trend("stock-profit", "net_profit", "亿元", undefined, true);
    trend("stock-margin", "operating_margin", "%"); trend("stock-roa", "roa", "%");
    trend("stock-cfo", "cfo", "亿元"); trend("stock-fcf", "owner_fcf", "亿元"); trend("stock-dividend", "dps", "元 / 股");
    trend("stock-inventory", "inventory", "%", (r) => safeRatio(r.inventory, r.revenue, 100));
    trend("stock-contract", "contract_liabilities", "%", (r) => safeRatio(r.contract_liabilities, r.revenue, 100));
    trend("stock-gross-margin", "gross_margin", "%");
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
    }), "亿元", { tooltip: { label: (ctx) => { const co = ctx.datasetIndex ? cmp : c, a = annual(co, year); return co.name + " " + fmt(yi([a.cfo, a.capex, a.owner_fcf][ctx.dataIndex])) + " 亿元"; } } });
  }
  function syncUrl() {
    const params = new URLSearchParams({ code: state.code });
    if (state.compare) params.set("compare", state.compare);
    if (state.range !== 5) params.set("range", state.range);
    history.replaceState({}, "", location.pathname + "?" + params);
  }
  function renderSankeys(c, cmp) {
    const box = $("sankey-content"), pack = state.pnl[c.code];
    if (!pack || !window.LiquorSankey) {
      box.innerHTML = '<p class="score-caption">利润流向数据暂不可用。</p>';
      return;
    }
    const years = (pack.year_list || []).slice(-state.range);
    if (!years.includes(state.pnlYear)) state.pnlYear = years.at(-1) || "";
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
        onYearChange: (year) => { state.pnlYear = year; renderSankeys(c, cmp); },
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
  function valuation(c) {
    const d = c.dcf || {}, scenarios = d.scenarios || [];
    const label = d.price_comparable ? "情景每股价值" : "未计净现金的每股价值代理";
    const rows = scenarios.map((s) => `<tr><td>${esc(s.name)}</td><td>${pct(s.assumptions.growth * 100)}</td><td>${pct(s.assumptions.terminal_growth * 100)}</td><td>${pct(s.assumptions.discount_rate * 100)}</td><td>${fmt(s.value_per_share, 2)}</td><td>${d.price_comparable ? pct(num(s.margin_of_safety) === null ? null : s.margin_of_safety * 100) : "不可比"}</td></tr>`).join("");
    const bridge = (d.bridge || []).map((r) => `<tr><td>${r.year}</td><td>${fmt(yi(r.cfo))}</td><td>${fmt(yi(r.capex))}</td><td>${fmt(yi(r.owner_fcf))}</td><td>${fmt(yi(r.fcff))}</td></tr>`).join("");
    const sens = (d.sensitivity || []).filter((r) => r.cash_flow_multiplier === 1);
    const rates = [...new Set(sens.map((r) => r.effective_discount_rate ?? r.discount_rate))].sort((a,b) => a-b);
    const terms = [...new Set(sens.map((r) => r.terminal_growth))].sort((a,b) => a-b);
    const heatmap = rates.length ? `<div class="table-wrap"><table class="heatmap"><thead><tr><th>永续增长 / 折现率</th>${rates.map((r) => `<th>${pct(r * 100)}</th>`).join("")}</tr></thead><tbody>${terms.map((t) => `<tr><td>${pct(t * 100)}</td>${rates.map((r) => { const hit = sens.find((s) => s.terminal_growth === t && (s.effective_discount_rate ?? s.discount_rate) === r); return `<td style="background:rgba(8,127,112,${.03 + Math.max(0, Math.min(.14, (.13 - r) * 2 + t * 2))})">${fmt(hit?.value_per_share)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>` : "";
    return `<div class="banner warning">${d.price_comparable ? "净现金已核验；估值仍为研究情景。" : "债务组成未核验，当前价值代理不能直接与股价比较，不显示低估或安全边际结论。"} 基数：${esc(d.base_label || "数据不足").replace("owner FCF", "简化自由现金流").replace("FCFF", "企业自由现金流")}，${fmt(yi(d.base_cash_flow_CNY))} 亿元。</div>`
      + `<div class="table-wrap"><table><thead><tr><th>情景</th><th>起始增长</th><th>永续增长</th><th>折现率</th><th>${label} / 元</th><th>安全边际</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="table-empty">连续三年现金流不足、非正或缺少股本，不外推价值</td></tr>'}</tbody></table></div>`
      + (heatmap ? `<details class="disclosure"><summary>估值敏感性 · ${label} / 元</summary>${heatmap}<p class="score-caption">现金流基数固定为 100%；仅改变折现率与永续增长，其他假设不变。</p></details>` : "")
      + `<details class="disclosure"><summary>估值输入与边界</summary><div class="table-wrap"><table><thead><tr><th>年度</th><th>CFO / 亿元</th><th>资本开支 / 亿元</th><th>简化 FCF / 亿元</th><th>FCFF / 亿元</th></tr></thead><tbody>${bridge}</tbody></table></div><p class="score-caption">预测五年、增长逐步收敛。FCFF 按资本成本折现；简化 FCF 路径使用股权成本代理。全部资本开支尚未分成维持与扩张，营收增速仅作增长代理；永续增长与再投资尚未构建完整经营驱动联动，因此本模型属于简化外推。</p><p class="score-caption">严格成熟企业估值需约束：再投资率 = 永续增长率 / 稳态资本回报率。财报债务、超额现金及维持性投资未核验时，不应把外推值视为目标价。</p></details>`;
  }

  function renderFormula() {
    const c = getCompany(state.code), s = c.score;
    const missingRoc = state.companies.flatMap((co) => co.annual.slice(-5)).filter((r) => r.roic == null).length;
    mount(pageHead("评分方法", "V4 · 成熟消费行业", `<label>实际案例<select id="formula-company">${companyOptions(c.code)}</select></label>`)
      + `<div class="formula-intro"><div><div class="section-title"><h2>长期财务质量</h2><small>五个完整年度 · 满分 100</small></div><div class="dimension-list">${state.data.model.dimensions.map(([name, weight], i) => `<div class="dimension-row"><span>${"ABCDE"[i]} ${esc(name)}</span><div class="dim-track"><i style="width:${weight / 30 * 100}%;background:${colors[i]}"></i></div><span>${weight} 分</span></div>`).join("")}</div></div><div class="formula-equation"><p>单项分 = 权重 × 截断线性得分</p><p>原始分 = A + B + C + D + E</p><p>最终分 = min（原始分，已触发风险上限）</p><p>固定绝对锚点；区间外截断至 0 或满分。品牌渠道证据、短期景气和估值独立展示。</p></div></div>`
      + nav([["formula-example", "公司案例"], ["formula-rules", "缺项与风险"], ["formula-changes", "方法变化"], ["formula-sources", "调研依据"]])
      + section("formula-example", c.name + " · 得分拆解", `${s.window_years.join(" / ")} · 年报与已实施分红`, `<div class="formula-steps"><div class="formula-step"><span>01 · 原始财务分</span><strong>${fmt(s.raw_total)}</strong></div><div class="formula-step"><span>02 · 风险上限</span><strong>${s.risk_cap}</strong></div><div class="formula-step"><span>03 · 最终财务分</span><strong class="positive">${scoreText(c)}</strong></div></div>${s.total == null ? `<div class="banner warning">缺项不补零、不提高其他指标权重。已知贡献 ${fmt(s.known_points)}，可能区间 ${s.score_range?.map((v) => fmt(v)).join("–") || "—"}，暂不排名。</div>` : ""}${s.risk_gates.length ? `<div class="banner warning">${s.risk_gates.map((r) => `${esc(r.label)}：上限 ${r.cap}`).join("；")}</div>` : ""}${scoreDetail(c)}`)
      + section("formula-rules", "缺项、已知零值与风险闸门", "完整报表可以低分，资料不全不伪装为低分", `<div class="method-grid"><div><h3>同口径五年窗口</h3><p>年度中位数与占比均需五个年度；累计转化率要求分子分母覆盖相同的五年。ROA 需期初期末资产；营收同比需真实相邻年。不将中报年化或与年报混算。</p></div><div><h3>零、亏损、缺失分开</h3><p>已核验零分红计零分；累计利润非正时，现金转换或派现率标记经济无效并计零；空单元格、来源冲突和分红记录不足保留缺失。缺项显示可能区间，不按已覆盖权重归一化。</p></div><div><h3>风险上限</h3><p>${state.data.model.risk_rules.map((r) => `${esc(r.label)} ≤ ${r.cap} 分`).join("；")}。多个闸门同时触发时取最低上限，原始分始终保留。</p></div><div><h3>财务代理的边界</h3><p>当前五年 ROIC 缺项 ${missingRoc} / ${state.companies.length * 5}。ROE 不再代替 ROIC。ROA 受现金持有与合并范围影响；现金覆盖未扣受限资金、且包含合同负债，不等于严格偿债评估。</p></div></div>`)
      + section("formula-changes", "从 V3 到 V4", "由增长打分转向现金回报与经营韧性", `<div class="table-wrap"><table class="wrap-table"><thead><tr><th>问题</th><th>V4 处理</th><th>原因</th></tr></thead><tbody>${[
        ["70% 绝对 + 30% 同行百分位", "固定绝对锚点", "避免同行整体变差时仍被动加分"],
        ["ROIC 缺失时回退 ROE", "ROA 单独计分，ROE / ROIC 分开展示", "三者分子分母不同，不能混用同一阈值"],
        ["毛利率、毛销差重复奖励", "使用回报、营业利润率及低谷保持率", "财务盈利指标不能直接证明品牌价值"],
        ["低库存、低资本开支加分", "移出直接计分，改看现金转化与证据", "基酒储存和有回报的扩产不应被机械惩罚"],
        ["利润 CAGR 非正则缺失", "改看盈利年占比、最差营收同比和风险上限", "真实经营恶化应是低分，不是未知"],
        ["高派现与高增长并列奖励", "五年派现、FCF 覆盖及分红连续性", "成熟企业需有持续可分配的现金"],
      ].map((r) => `<tr>${r.map((v) => `<td class="formula-cell">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`)
      + section("formula-sources", "成熟企业评估的调研依据", "资料于 2026-10-17 核查", `<ul class="source-list">${state.data.model.research_sources.map((r, i) => `<li><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.name)}</a><p>${["增长只有在资本回报超过资本成本时才创造价值；ROE 与资本回报需要匹配不同的再投资定义。", "提高稳定增长率必须同时考虑维持该增长的再投资，不能只提高终值分子。", "成熟饮料公司分别观察终端销量与出货；渠道库存和价格调整会造成差异。现金流需扣除固定资产投入。"][i]}</p></li>`).join("")}</ul><div class="banner warning">本研究台的 25 / 25 / 15 / 20 / 15 权重、零分线、满分线及风险上限为研究假设，不是以上作者或公司的官方评级。尚未做历史收益回测，不代表预测收益或买入建议。财务得分也不替代品牌、渠道和治理尽调。</div>`));
    $("formula-company").onchange = (e) => { state.code = e.target.value; history.replaceState({}, "", location.pathname + "?code=" + state.code); renderFormula(); };
  }

  async function init() {
    try {
      const response = await fetch("data.json?v=4");
      if (!response.ok) throw new Error("数据文件 HTTP " + response.status);
      state.data = await response.json(); state.companies = state.data.companies || [];
      if (state.page === "stock") {
        const pnlResponse = await fetch("pnl.json?v=4");
        if (pnlResponse.ok) state.pnl = await pnlResponse.json();
      }
      if (!state.companies.length || !String(state.data.model?.version).startsWith("V4")) throw new Error("需要 V4 财务数据快照");
      if (typeof Chart === "undefined") throw new Error("本地图表库未能加载");
      Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
      Chart.defaults.color = "#6b746f";
      const params = new URLSearchParams(location.search);
      state.code = getCompany(params.get("code")) ? params.get("code") : state.companies[0].code;
      state.compare = getCompany(params.get("compare")) && params.get("compare") !== state.code ? params.get("compare") : "";
      state.range = params.get("range") === "10" ? 10 : 5;
      state.period = periodOptions()[0]?.[0] || String(lastAnnualYear());
      ({ industry: renderIndustry, compare: renderCompare, stock: renderStock, formula: renderFormula }[state.page] || renderIndustry)();
      if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "instant", block: "start" });
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
