(function () {
  "use strict";

  const CODES = ["600519", "000858", "000568", "600809", "002304", "000596", "000799", "000860", "000995", "002646", "600197", "600199", "600559", "600702", "600779", "603198", "603369", "603589", "603919"];
  const ITEM_LABELS = {
    gross_margin: "毛利率",
    gross_sales_spread: "毛销差",
    operating_margin: "营业利润率",
    net_margin: "归母净利率",
    sales_expense_ratio: "销售费用率",
    roe: "净资产收益率",
    dividend_yield: "股息率",
    dividend_yield_year_end: "年末股息率",
    payout_pct: "分红率",
    roic: "投入资本回报率",
    return_on_capital: "投入资本回报率",
    return_median: "投入资本回报率中位数",
    operating_margin_median: "营业利润率中位数",
    gross_margin_median: "毛利率中位数",
    return_on_capital_median: "投入资本回报率中位数",
    net_margin_median: "净利率中位数",
    gross_sales_spread_median: "毛销差中位数",
    margin_stability: "营业利润率波动稳定性",
    cfo_to_revenue_median: "经营现金流/营收中位数",
    cash_to_current_liab_median: "现金/流动负债中位数",
    inventory_to_revenue_median: "存货/营收中位数",
    current_ratio_median: "流动比率中位数",
    quick_ratio_median: "速动比率中位数",
    cfo_to_current_liab_median: "现金流量比率中位数",
    cfo_profit: "净现比",
    cfo_profit_median: "净现比中位数",
    owner_fcf: "股东自由现金流",
    owner_fcf_to_profit: "股东自由现金流/净利润",
    owner_fcf_profit_median: "股东自由现金流/净利润中位数",
    cfo_to_revenue: "经营现金流/营收",
    nonrecurring_ratio: "非经常性损益占比",
    sales_cash_ratio: "销售收现比",
    sales_cash_ratio_median: "销售收现比中位数",
    fcf_to_revenue: "企业自由现金流/营收",
    other_receivables_to_asset: "其他应收/总资产",
    receivables_to_revenue: "应收/营收",
    inventory_receivables_to_revenue: "存货+应收/营收",
    inventory_receivables_ratio_median: "存货+应收/营收中位数",
    debt_to_asset: "资产负债率",
    debt_to_asset_median: "资产负债率中位数",
    cash_to_current_liab: "现金比率",
    liquidity_strength_median: "现金比率中位数",
    cfo_to_current_liab: "现金流动负债比",
    quick_ratio: "速动比率",
    fcff_conversion: "企业自由现金流转化率",
    revenue_cagr_3y: "营收三年复合",
    profit_cagr_3y: "净利三年复合",
    negative_year_ratio: "负利润/负股东自由现金流年份占比",
    payout_fcf_coverage_median: "股东自由现金流/现金分红中位数",
    dividend_consistency: "分红连续性",
    payout_pct_median: "派现率中位数",
    capex_to_cfo_median: "资本开支/经营现金流中位数",
    payout_fcf_coverage: "分红由自由现金流覆盖",
    cashflow_stability: "现金流稳定性",
    cycle_resilience: "抗周期",
    product_mix: "产品结构",
    channel_health: "渠道健康",
    capital_allocation: "资本配置",
    governance: "治理",
    revenue: "营业收入",
    net_profit: "归母净利润",
    cfo: "经营活动现金流",
    capex: "资本开支",
    fcff: "企业自由现金流",
    dividend_cash_CNY: "现金分红总额",
    cash: "货币资金",
    total_assets: "总资产",
    total_liabilities: "总负债",
    current_assets: "流动资产",
    current_liabilities: "流动负债",
    short_debt: "短期借款",
    long_debt: "长期借款",
    bonds: "应付债券",
    other_receivables: "其他应收",
    payables: "应付账款",
    contract_liabilities: "合同负债",
    inventory: "存货",
    receivables: "应收款项",
    sales_expense: "销售费用",
  };
  const AMOUNT_KEYS = ["revenue", "net_profit", "cfo", "capex", "fcff", "owner_fcf", "dividend_cash_CNY", "cash", "total_assets", "total_liabilities", "current_assets", "current_liabilities", "short_debt", "long_debt", "bonds", "contract_liabilities", "inventory", "receivables", "other_receivables", "payables", "sales_expense"];
  const PCT_KEYS = ["gross_margin", "gross_margin_median", "gross_sales_spread", "gross_sales_spread_median", "operating_margin", "net_margin", "net_margin_median", "sales_expense_ratio", "roe", "dividend_yield", "dividend_yield_year_end", "payout_pct", "payout_pct_median", "roic", "return_on_capital", "return_on_capital_median", "return_median", "operating_margin_median", "margin_stability", "cfo_to_revenue", "cfo_to_revenue_median", "cash_to_current_liab_median", "inventory_to_revenue_median", "contract_liab_to_revenue_median", "receivables_to_revenue", "inventory_receivables_to_revenue", "inventory_receivables_ratio_median", "sales_cash_ratio", "sales_cash_ratio_median", "fcf_to_revenue", "nonrecurring_ratio", "other_receivables_to_asset", "revenue_cagr_3y", "profit_cagr_3y", "negative_year_ratio", "debt_to_asset", "debt_to_asset_median", "cash_to_current_liab", "liquidity_strength_median", "cfo_to_current_liab", "cfo_to_current_liab_median", "quick_ratio", "dividend_consistency", "capex_to_cfo_median", "payout_fcf_coverage", "cashflow_stability"];
  const RATIO_KEYS = ["cfo_profit", "cfo_profit_median", "owner_fcf_to_profit", "owner_fcf_profit_median", "payout_fcf_coverage_median", "fcff_conversion", "current_ratio_median", "quick_ratio_median"];
  const DIM_LETTERS = ["A", "B", "C", "D", "E"];
  const DIM_QUESTIONS = [
    "利润厚不厚",
    "赚的是不是现金",
    "短期债能不能覆盖",
    "增长是否可持续",
    "现金如何回到股东",
  ];
  const DCF_STATUS = {
    insufficient_inputs: "估值不可用 · 输入不足",
    missing: "估值不可用 · 数据缺失",
    negative_owner_fcf: "估值不可用 · 三年 股东自由现金流 中位数为负",
    research_hypothesis: "研究假设 · 已有每股价值代理",
    net_cash_not_verified: "净现金未核验",
    available: "已有估值",
  };
  const STYLE_TAGS = [
    { id: "quality_cheap", label: "质优低估", order: 1, hint: "可排序且质量分不低于 60，基准 现金流折现 比现价至少高 20%" },
    { id: "quality_rich", label: "质优不便宜", order: 2, hint: "可排序且质量分不低于 60，基准 现金流折现 没有 20% 以上的空间" },
    { id: "cheap_weak", label: "低估质弱", order: 3, hint: "质量分低于 60，基准 现金流折现 比现价至少高 20%，增长维尚未低于满分一半" },
    { id: "value_trap", label: "价值陷阱风险", order: 4, hint: "质量分低于 60，基准 现金流折现 便宜，但增长维低于满分一半" },
    { id: "weak_fair", label: "质弱价格一般", order: 5, hint: "质量分低于 60，基准 现金流折现 也没有 20% 以上的空间" },
    { id: "uncomparable", label: "估值待核验", order: 6, hint: "现金流已有外推，但净现金或债务字段未核验，暂不比较安全边际" },
    { id: "unvalued", label: "估值不足", order: 7, hint: "质量未排序或现金流输入不足，暂不外推每股价值" },
  ];
  const STYLE_TAG_BY_ID = Object.fromEntries(STYLE_TAGS.map((tag) => [tag.id, tag]));

  function el(id) { return document.getElementById(id); }
  function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(v, digits) {
    const n = num(v);
    if (n === null) return "—";
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits == null ? 2 : digits, minimumFractionDigits: 0 }).format(n);
  }
  function yi(v) {
    const n = num(v);
    return n === null ? null : n / 1e8;
  }
  function fmtYi(v) {
    const n = yi(v);
    return n === null ? "—" : fmt(n, 1);
  }
  function fmtPct(v) {
    const n = num(v);
    return n === null ? "—" : fmt(n, 2) + "%";
  }
  function fmtRatio(v) {
    const n = num(v);
    return n === null ? "—" : fmt(n, 2) + "倍";
  }
  function fmtItemValue(key, v) {
    if (["margin_stability", "dividend_consistency", "negative_year_ratio"].includes(key)) return fmtPct(num(v) === null ? null : v * 100);
    if (AMOUNT_KEYS.includes(key)) return fmtYi(v);
    if (PCT_KEYS.includes(key)) return fmtPct(v);
    if (RATIO_KEYS.includes(key)) return fmtRatio(v);
    return num(v) === null ? "—" : fmt(v, 2);
  }
  function itemLabel(key) { return ITEM_LABELS[key] || "未命名指标"; }
  function financialText(value) {
    const terms = [
      [/\bowner FCF\b/gi, "股东自由现金流"],
      [/\bFCFF\b/g, "企业自由现金流"],
      [/\bFCFE\b/g, "股权自由现金流"],
      [/Buffett owner earnings/g, "巴菲特股东盈余"],
      [/\bDCF\b/g, "现金流折现"],
      [/\bCFO\b/g, "经营现金流"],
      [/\bEBIT\b/g, "息税前经营利润"],
      [/\bROIC\b/g, "投入资本回报率"],
      [/\bROE\b/g, "净资产收益率"],
      [/\bCAGR\b/g, "年均复合增长率"],
      [/\bYTD\b/g, "年内累计"],
      [/\bWACC\b/g, "加权平均资本成本"],
      [/成本权益率代理/g, "股权资本成本代理"],
      [/derived financial metric/g, "由财务报表计算"],
      [/\bderived\b/g, "由财务报表计算"],
    ];
    return terms.reduce((text, [pattern, label]) => text.replace(pattern, label), String(value || ""));
  }
  function dcfStatus(v) { return DCF_STATUS[v] || (v ? String(v) : "估值不可用 · 状态未提供"); }
  function baseScenario(company) {
    return ((company.dcf && company.dcf.scenarios) || []).find((s) => s.name === "基准") || null;
  }
  function classifyCompany(company, model) {
    const rules = (model && model.style) || {};
    const qualityMin = num(rules.quality_min) === null ? 60 : rules.quality_min;
    const cheapUpside = num(rules.cheap_upside) === null ? 0.20 : rules.cheap_upside;
    const weakLine = num(rules.growth_weak_below) === null ? 0.5 : rules.growth_weak_below;
    const score = company.score || {};
    const ranked = score.rankable === true && num(score.total) !== null;
    const quality = ranked && score.total >= qualityMin;
    const base = baseScenario(company);
    const price = num(company.price && company.price.close);
    const value = num(base && base.value_per_share);
    const upside = value !== null && price ? value / price - 1 : null;
    const undervalued = upside !== null && upside >= cheapUpside;
    const growth = dimensions(company).find((dim) => dim.name === rules.growth_dimension || String(dim.name || "").includes("增长"));
    const growthWeak = growth && growth.score !== null && growth.weight ? growth.score / growth.weight < weakLine : null;
    const priceComparable = company.dcf && company.dcf.price_comparable === true && upside !== null;
    let id = base && !priceComparable ? "uncomparable" : "unvalued";
    if (priceComparable && quality && undervalued) id = "quality_cheap";
    else if (priceComparable && quality) id = "quality_rich";
    else if (priceComparable && undervalued && growthWeak === true) id = "value_trap";
    else if (priceComparable && undervalued) id = "cheap_weak";
    else if (priceComparable) id = "weak_fair";
    const tag = STYLE_TAG_BY_ID[id];
    const bits = [];
    if (ranked) bits.push("质量分 " + fmt(score.total, 1));
    else bits.push("质量分未排序");
    const yieldPct = num(company.dividend && company.dividend.yield_pct);
    if (yieldPct !== null) bits.push("股息率 " + fmt(yieldPct, 2) + "%");
    if (value !== null) bits.push("基准价值 " + fmt(value, 2) + " 元");
    if (upside !== null) bits.push("相对现价 " + (upside >= 0 ? "+" : "") + fmt(upside * 100, 1) + "%");
    if (growthWeak === true) bits.push("增长维低于满分一半");
    if (!ranked) bits.push("质量未进入可比排名");
    if (company.dcf && company.dcf.price_comparable !== true) bits.push("净现金未核验，暂不比较安全边际");
    return { id: tag.id, label: tag.label, order: tag.order, hint: tag.hint, detail: bits.join(" · ") };
  }
  function installChartTools() {
    if (typeof Chart === "undefined" || installChartTools.done) return;
    installChartTools.done = true;
    Chart.register({
      id: "lqVerticalGuide",
      afterDatasetsDraw(chart) {
        const tooltip = chart.tooltip;
        const active = tooltip && tooltip.getActiveElements ? tooltip.getActiveElements() : [];
        if (!active.length || !tooltip.opacity) return;
        const x = active[0].element.x;
        const area = chart.chartArea;
        if (!area || x < area.left || x > area.right) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "rgba(31, 36, 48, 0.55)";
        ctx.stroke();
        ctx.restore();
      },
    });
  }
  function lineOptions(unit) {
    installChartTools();
    const suffix = unit === "%" ? "%" : unit === "倍" ? "倍" : "";
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          enabled: true,
          mode: "index",
          intersect: false,
          callbacks: {
            label(ctx) {
              const v = ctx.parsed ? ctx.parsed.y : null;
              const text = v == null || Number.isNaN(v) ? "—" : fmt(v, 2) + suffix + (unit === "亿元" ? " 亿元" : "");
              return " " + ctx.dataset.label + ": " + text;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { ticks: { font: { size: 10 }, callback: (v) => v + suffix } },
      },
    };
  }
  function clickHitsChartLegend(evt, chart) {
    if (!chart || !chart.legend || !chart.legend.legendHitBoxes) return false;
    const rect = chart.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const x = (evt.clientX - rect.left) * (chart.width / rect.width);
    const y = (evt.clientY - rect.top) * (chart.height / rect.height);
    return chart.legend.legendHitBoxes.some((box) => x >= box.left - 6 && x <= box.left + box.width + 6 && y >= box.top - 6 && y <= box.top + box.height + 6);
  }
  function resizeChartIn(card) {
    if (!card || typeof Chart === "undefined" || !Chart.getChart) return;
    const canvas = card.querySelector("canvas");
    const ch = canvas && Chart.getChart(canvas);
    if (ch) ch.resize();
  }
  function collapseChartZoom() {
    const cards = Array.prototype.slice.call(document.querySelectorAll(".chart-card.is-expanded"));
    cards.forEach((card) => card.classList.remove("is-expanded"));
    document.querySelectorAll(".chart-zoom-spacer").forEach((node) => node.remove());
    const backdrop = el("chart-zoom-backdrop");
    if (backdrop) backdrop.remove();
    document.body.classList.remove("chart-zoom-open");
    requestAnimationFrame(() => cards.forEach(resizeChartIn));
  }
  function bindChartZoom(card) {
    if (!card || card.dataset.zoomBound === "1") return;
    card.dataset.zoomBound = "1";
    card.addEventListener("click", (evt) => {
      const canvas = card.querySelector("canvas");
      const chart = canvas && typeof Chart !== "undefined" && Chart.getChart ? Chart.getChart(canvas) : null;
      if (chart && clickHitsChartLegend(evt, chart)) return;
      const willExpand = !card.classList.contains("is-expanded");
      if (!willExpand) {
        collapseChartZoom();
        return;
      }
      collapseChartZoom();
      const spacer = document.createElement("div");
      spacer.className = "chart-zoom-spacer";
      spacer.style.height = card.getBoundingClientRect().height + "px";
      card.parentNode.insertBefore(spacer, card);
      card.classList.add("is-expanded");
      const backdrop = document.createElement("div");
      backdrop.id = "chart-zoom-backdrop";
      backdrop.className = "chart-zoom-backdrop";
      backdrop.addEventListener("click", (e) => { e.stopPropagation(); collapseChartZoom(); });
      document.body.appendChild(backdrop);
      document.body.classList.add("chart-zoom-open");
      requestAnimationFrame(() => resizeChartIn(card));
    });
    if (!bindChartZoom.escBound) {
      bindChartZoom.escBound = true;
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") collapseChartZoom(); });
    }
  }
  function bindChartZoomAll(root) {
    if (!root) return;
    root.querySelectorAll(".chart-zoomable").forEach(bindChartZoom);
  }
  function annuals(company) {
    return (company.annual || []).filter((r) => r && r.period === "annual" && r.year != null)
      .slice().sort((a, b) => a.year - b.year);
  }
  function annualOf(company, year) {
    return annuals(company).find((r) => String(r.year) === String(year)) || null;
  }
  function latestAnnual(company) {
    const rows = annuals(company);
    return rows.length ? rows[rows.length - 1] : null;
  }
  function dimensions(company) {
    return ((company.score && company.score.dimensions) || []).map((dim, i) => ({
      letter: DIM_LETTERS[i] || String(i + 1),
      question: DIM_QUESTIONS[i] || "",
      name: dim.name,
      weight: num(dim.weight),
      score: num(dim.score),
      items: dim.items || [],
    }));
  }
  function itemOf(company, key) {
    for (const dim of dimensions(company)) {
      const hit = (dim.items || []).find((it) => it.name === key);
      if (hit) return hit;
    }
    return null;
  }
  function references(company) {
    return (company.score && company.score.references) || [];
  }
  function itemNumber(company, key, field) {
    const it = itemOf(company, key);
    return it ? num(it[field || "value"]) : null;
  }

  function hideColHelp() {
    const pop = el("col-help-pop");
    if (!pop) return;
    pop.classList.add("hidden");
    document.querySelectorAll(".col-help-btn[aria-expanded='true']").forEach((b) => {
      b.setAttribute("aria-expanded", "false");
    });
  }
  function showColHelp(btn) {
    const pop = el("col-help-pop");
    if (!pop) return;
    pop.querySelector(".col-help-title").textContent = btn.getAttribute("data-help-title") || "";
    pop.querySelector(".col-help-body").textContent = btn.getAttribute("data-help-body") || "";
    pop.classList.remove("hidden");
    document.querySelectorAll(".col-help-btn[aria-expanded='true']").forEach((b) => {
      b.setAttribute("aria-expanded", "false");
    });
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect();
    const pw = Math.min(320, window.innerWidth - 16);
    pop.style.width = pw + "px";
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    pop.style.left = left + "px";
    pop.style.top = (r.bottom + 8) + "px";
    const ph = pop.offsetHeight;
    if (r.bottom + 8 + ph > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - ph - 8) + "px";
  }
  function helpButton(help) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "col-help-btn";
    btn.setAttribute("aria-label", (help.title || "指标") + "的含义");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("data-help-title", help.title || "");
    btn.setAttribute("data-help-body", help.body || "");
    btn.textContent = "?";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = btn.getAttribute("aria-expanded") === "true";
      hideColHelp();
      if (!open) showColHelp(btn);
    });
    return btn;
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest(".col-help-pop") || e.target.closest(".col-help-btn")) return;
    hideColHelp();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideColHelp(); });
  window.addEventListener("resize", hideColHelp);
  document.addEventListener("scroll", hideColHelp, true);

  async function readJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  window.LQ = {
    CODES, ITEM_LABELS, AMOUNT_KEYS, PCT_KEYS, RATIO_KEYS, DIM_LETTERS,
    el, num, esc, fmt, yi, fmtYi, fmtPct, fmtRatio, fmtItemValue, itemLabel, financialText, dcfStatus,
    STYLE_TAGS, baseScenario, classifyCompany, lineOptions, collapseChartZoom, bindChartZoomAll,
    annuals, annualOf, latestAnnual, dimensions, references, itemOf, itemNumber, helpButton, readJson,
  };
})();
