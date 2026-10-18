(function () {
  "use strict";
  const Q = window.LQ;
  const GROUPS = ["basic", "score", "profit", "growth", "cash", "risk", "channel", "valuation"];
  const STATUS_FILTERS = [
    { id: "all", label: "全部" },
    { id: "rankable", label: "可排序" },
    { id: "unranked", label: "未排序" },
  ];
  const METRICS = {
    profit: [
      { key: "gross_margin", label: "毛利率", kind: "pct" },
      { key: "gross_sales_spread", label: "毛销差", kind: "pct", help: { title: "毛销差", body: "毛利率减去销售费用率。白酒评级和卖方研究把它当作品牌盈利的核心，已进入质量打分。" } },
      { key: "operating_margin", label: "营业利润率", kind: "pct" },
      { key: "nonrecurring_ratio", label: "非经常性损益占比", kind: "pct", help: { title: "非经常性损益占比", body: "归母净利润减去扣非净利润，再除以归母净利润的绝对值。只把正差额当水分，越高越需复核，作为利润质量观测项。" } },
      { key: "roe", label: "净资产收益率", kind: "pct" },
      { key: "return_on_capital", label: "投入资本回报率", kind: "pct", help: { title: "投入资本回报率", body: "年度序列优先使用投入资本回报率；有息负债字段不完整时回退净资产收益率。质量评分使用最近五个完整年度中位数。" } },
      { key: "net_margin", label: "归母净利率", kind: "pct" },
      { key: "dividend_yield", label: "股息率", kind: "pct", help: { title: "股息率", body: "打分年已实施现金分红除以最新未复权收盘价。这一列是最新完整年的数值；股息率作为参考，不进入质量分。" } },
    ],
    growth: [
      { key: "revenue_cagr_3y", label: "营收年均复合增长率", kind: "score", help: { title: "营收三年年均复合增长率", body: "取评分项中的原始值，单位为百分点，不在页面端重新计算。" } },
      { key: "profit_cagr_3y", label: "净利润年均复合增长率", kind: "score" },
    ],
    cash: [
      { key: "sales_cash_ratio", label: "销售收现比", kind: "pct", help: { title: "销售收现比", body: "销售商品、提供劳务收到的现金除以营业收入。高于 110% 不再加分。已进入质量打分。" } },
      { key: "cfo_profit", label: "净现比", kind: "ratio", help: { title: "净现比", body: "经营现金流除以归母净利润。评分取最近五个完整年度中位数。" } },
      { key: "owner_fcf", label: "股东自由现金流", kind: "yi", help: { title: "股东自由现金流", body: "经营现金流减资本开支，作为股东可支配现金的简化观察项；现金流折现估值在企业自由现金流不足时使用其三年中位数。" } },
      { key: "owner_fcf_to_profit", label: "股东自由现金流/净利润", kind: "ratio" },
      { key: "fcf_to_revenue", label: "企业自由现金流/营收", kind: "pct", help: { title: "企业自由现金流/营收", body: "企业自由现金流除以营业收入。企业自由现金流 = 税后经营利润 + 折旧摊销 - 资本开支 - 营运资金变化。" } },
      { key: "cfo", label: "经营现金流", kind: "yi" },
    ],
    risk: [
      { key: "debt_to_asset", label: "资产负债率", kind: "pct", help: { title: "资产负债率", body: "总负债除以总资产，越低越好，已进入质量打分。合同负债也在总负债里，所以要和现金比率、现金流动负债比一起看。" } },
      { key: "cash_to_current_liab", label: "现金比率", kind: "pct", help: { title: "现金比率", body: "货币资金除以流动负债。衡量账上现金能不能覆盖短期义务，已进入质量打分。" } },
      { key: "cfo_to_current_liab", label: "现金流动负债比", kind: "pct", help: { title: "现金流动负债比", body: "经营现金流除以流动负债。衡量当年经营现金对短期义务的覆盖，已进入质量打分。" } },
      { key: "other_receivables_to_asset", label: "其他应收/总资产", kind: "pct", help: { title: "其他应收/总资产", body: "其他应收款合计除以总资产，作为财务风险观测项，不直接计分。" } },
      { key: "receivables_to_revenue", label: "应收/营收", kind: "pct", help: { title: "应收/营收", body: "应收账款除以营业收入，越低越好。先款后货的公司这一项应该很低。" } },
      { key: "inventory_receivables_to_revenue", label: "存货+应收/营收", kind: "pct" },
    ],
    channel: [
      { key: "contract_liabilities", label: "合同负债", kind: "yi", help: { title: "合同负债", body: "渠道观测项，不进质量总分。直销会压低预收，需求转弱时预收也可能堆积，高低没有单一方向。" } },
      { key: "inventory", label: "存货", kind: "yi" },
      { key: "receivables", label: "应收款项", kind: "yi" },
      { key: "sales_expense", label: "销售费用", kind: "yi" },
    ],
  };
  const GROUP_LABEL = {
    profit: "盈利回报", growth: "增长速度", cash: "现金流", risk: "家底排雷", channel: "渠道观测", valuation: "价格与估值",
  };

  const state = {
    data: null,
    companies: [],
    year: null,
    status: "all",
    style: "all",
    compare: new Set(),
    groups: new Set(GROUPS),
    sortKey: "name",
    sortDir: "asc",
    detailCode: null,
  };

  function metricValue(company, spec) {
    if (spec.kind === "score") return Q.itemNumber(company, spec.key, "value");
    const row = Q.annualOf(company, state.year);
    return row ? Q.num(row[spec.key]) : null;
  }
  function formatMetric(spec, value) {
    if (spec.kind === "yi") return Q.fmtYi(value);
    if (spec.kind === "ratio") return Q.fmtRatio(value);
    if (spec.kind === "pct" || spec.kind === "score") return Q.fmtPct(value);
    return Q.fmt(value, 2);
  }
  function dimScore(company, letter) {
    const dim = Q.dimensions(company).find((d) => d.letter === letter);
    return dim ? dim.score : null;
  }
  function sortValue(company, key) {
    if (key === "name") return company.name;
    if (key === "score_total") {
      const score = company.score || {};
      return score.rankable === true ? Q.num(score.total) : null;
    }
    if (key === "style_tag") return Q.classifyCompany(company, state.data && state.data.model).order;
    if (key === "dcf_value") {
      const base = Q.baseScenario(company);
      return company.dcf && company.dcf.price_comparable === true ? Q.num(base && base.value_per_share) : null;
    }
    if (key === "safety_margin") {
      const base = Q.baseScenario(company);
      return company.dcf && company.dcf.price_comparable === true ? Q.num(base && base.margin_of_safety) : null;
    }
    if (key === "data_quality") {
      const flags = (company.score && company.score.quality_flags || []).length;
      const conflicts = (company.provenance && company.provenance.conflicts || []).length;
      return flags + conflicts + (company.dcf && company.dcf.price_comparable === true ? 0 : 1);
    }
    if (key === "coverage") return Q.num(company.score && company.score.coverage);
    if (key === "price") return Q.num(company.price && company.price.close);
    if (key.indexOf("dim_") === 0) return dimScore(company, key.slice(4));
    const spec = Object.values(METRICS).flat().find((m) => m.key === key);
    return spec ? metricValue(company, spec) : null;
  }
  function visibleCompanies() {
    let rows = state.companies.slice();
    if (state.compare.size) rows = rows.filter((c) => state.compare.has(c.code));
    if (state.status === "rankable") rows = rows.filter((c) => c.score && c.score.rankable === true && Q.num(c.score.total) !== null);
    if (state.status === "unranked") rows = rows.filter((c) => !(c.score && c.score.rankable === true && Q.num(c.score.total) !== null));
    if (state.style !== "all") rows = rows.filter((c) => Q.classifyCompany(c, state.data && state.data.model).id === state.style);
    const dir = state.sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = sortValue(a, state.sortKey);
      const bv = sortValue(b, state.sortKey);
      if (typeof av === "string" || typeof bv === "string") return String(av || "").localeCompare(String(bv || ""), "zh-CN") * dir;
      if (av === null && bv === null) return a.name.localeCompare(b.name, "zh-CN");
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
    return rows;
  }

  function renderFilters() {
    const box = Q.el("type-filters");
    box.innerHTML = "";
    STATUS_FILTERS.forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (state.status === f.id ? " active" : "");
      btn.textContent = f.label;
      btn.addEventListener("click", () => { state.status = f.id; renderAll(); });
      box.appendChild(btn);
    });
    const styleBox = Q.el("style-filters");
    if (!styleBox) return;
    styleBox.innerHTML = "";
    [{ id: "all", label: "全部标签" }].concat(Q.STYLE_TAGS).forEach((tag) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (state.style === tag.id ? " active" : "");
      btn.textContent = tag.label;
      btn.title = tag.hint || "";
      btn.addEventListener("click", () => { state.style = tag.id; renderAll(); });
      styleBox.appendChild(btn);
    });
  }
  function renderChips() {
    const box = Q.el("compare-chips");
    box.innerHTML = "";
    state.compare.forEach((code) => {
      const company = state.companies.find((c) => c.code === code);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "compare-chip";
      chip.textContent = (company ? company.name : code) + " ×";
      chip.addEventListener("click", () => { state.compare.delete(code); renderAll(); });
      box.appendChild(chip);
    });
    Q.el("clear-compare").classList.toggle("hidden", state.compare.size === 0);
  }
  function renderSuggest(query) {
    const box = Q.el("compare-suggest");
    const q = query.trim().toLowerCase();
    const hits = state.companies.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.includes(q));
    box.innerHTML = "";
    hits.forEach((c) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "compare-suggest-item";
      row.setAttribute("role", "option");
      row.textContent = state.compare.has(c.code) ? "✓ " + c.name + "（" + c.code + "）" : c.name + "（" + c.code + "）";
      row.addEventListener("click", () => {
        if (state.compare.has(c.code)) state.compare.delete(c.code);
        else state.compare.add(c.code);
        Q.el("compare-search").value = "";
        box.classList.add("hidden");
        renderAll();
      });
      box.appendChild(row);
    });
    box.classList.toggle("hidden", hits.length === 0);
  }

  function addSortTh(tr, key, label, className, help) {
    const th = document.createElement("th");
    if (className) th.className = className;
    th.dataset.sort = key;
    const span = document.createElement("span");
    span.className = "th-label";
    span.textContent = label + (state.sortKey === key ? (state.sortDir === "asc" ? " ↑" : " ↓") : "");
    th.appendChild(span);
    if (help) th.appendChild(Q.helpButton(help));
    th.addEventListener("click", () => {
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = key === "name" ? "asc" : "desc"; }
      renderAll();
    });
    tr.appendChild(th);
    return th;
  }

  function renderHead() {
    const table = Q.el("bank-table");
    if (table) table.classList.toggle("no-name", !state.groups.has("basic"));
    const thead = Q.el("table-head");
    thead.innerHTML = "";
    const groupTr = document.createElement("tr");
    const metricTr = document.createElement("tr");
    metricTr.className = "metric-row";

    if (state.groups.has("basic")) {
      const th = document.createElement("th");
      th.rowSpan = 2;
      th.className = "col-name";
      th.textContent = "公司" + (state.sortKey === "name" ? (state.sortDir === "asc" ? " ↑" : " ↓") : "");
      th.addEventListener("click", () => {
        if (state.sortKey === "name") state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = "name"; state.sortDir = "asc"; }
        renderAll();
      });
      groupTr.appendChild(th);
    }
    const scoreMark = state.sortKey === "score_total" ? (state.sortDir === "asc" ? " ↑" : " ↓") : "";
    const scoreTh = document.createElement("th");
    scoreTh.rowSpan = 2;
    scoreTh.className = "col-score";
    scoreTh.textContent = "质量评分" + scoreMark;
    scoreTh.title = "点击按质量评分排序。未排序的公司排在最后。满分 100。合同负债/营收不进入质量分。";
    scoreTh.addEventListener("click", () => {
      if (state.sortKey === "score_total") state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = "score_total"; state.sortDir = "desc"; }
      renderAll();
    });
    groupTr.appendChild(scoreTh);
    const styleMark = state.sortKey === "style_tag" ? (state.sortDir === "asc" ? " ↑" : " ↓") : "";
    const styleTh = document.createElement("th");
    styleTh.rowSpan = 2;
    styleTh.className = "col-style-tag";
    styleTh.textContent = "估值×打分" + styleMark;
    styleTh.title = "点击按标签排序。质优看质量分是否达到 60，低估看基准 现金流折现 是否比现价高至少 20%。";
    styleTh.addEventListener("click", () => {
      if (state.sortKey === "style_tag") state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = "style_tag"; state.sortDir = "asc"; }
      renderAll();
    });
    groupTr.appendChild(styleTh);

    if (state.groups.has("score")) {
      const th = document.createElement("th");
      const dimCount = Q.dimensions(state.companies[0] || { score: { dimensions: [] } }).length;
      th.colSpan = 1 + dimCount;
      th.className = "group-header group-score";
      th.textContent = "质量打分（" + (state.year || "—") + " 完整年）";
      groupTr.appendChild(th);
      addSortTh(metricTr, "coverage", "覆盖度", "col-dim-score");
      const sample = state.companies[0];
      Q.dimensions(sample || { score: { dimensions: [] } }).forEach((dim) => {
        addSortTh(metricTr, "dim_" + dim.letter, dim.letter + " " + dim.name, "col-dim-score");
      });
    }
    ["profit", "growth", "cash", "risk", "channel"].forEach((group) => {
      if (!state.groups.has(group)) return;
      const th = document.createElement("th");
      th.colSpan = METRICS[group].length;
      th.className = "group-header";
      th.textContent = GROUP_LABEL[group];
      groupTr.appendChild(th);
      METRICS[group].forEach((spec) => addSortTh(metricTr, spec.key, spec.label, "", spec.help));
    });
    if (state.groups.has("valuation")) {
      const th = document.createElement("th");
      th.colSpan = 4;
      th.className = "group-header";
      th.textContent = "价格与估值";
      groupTr.appendChild(th);
      addSortTh(metricTr, "price", "收盘价", "", { title: "收盘价", body: "未复权收盘价，日期见页头行情截至。价格不进入质量评分。" });
      addSortTh(metricTr, "dcf_value", "基准折现价值", "", { title: "基准现金流折现价值", body: "优先用 2023–2025 年企业自由现金流中位数折现，不足或非正时回退同三年股东自由现金流中位数。净现金只有债务字段完整时才加入。现金流折现不进质量总分。" });
      addSortTh(metricTr, "safety_margin", "安全边际", "", { title: "安全边际", body: "1 - 现价 / 基准每股价值。只有净现金已核验且 现金流折现 可与现价比较时显示。" });
      addSortTh(metricTr, "data_quality", "数据质量", "", { title: "数据质量", body: "结合评分覆盖、异常/冲突记录以及净现金核验状态。缺项不补，不把未核验估值当成低估。" });
    }
    thead.appendChild(groupTr);
    thead.appendChild(metricTr);
  }

  function td(text, className) {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = text;
    return cell;
  }
  function renderBody(rows) {
    const tbody = Q.el("table-body");
    tbody.innerHTML = "";
    rows.forEach((company) => {
      const tr = document.createElement("tr");
      if (state.groups.has("basic")) {
        const cell = document.createElement("td");
        cell.className = "col-name";
        const link = document.createElement("a");
        link.className = "bank-name-link";
        link.href = "stock.html?code=" + encodeURIComponent(company.code);
        link.textContent = company.name;
        link.addEventListener("click", (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          openDetail(company.code);
        });
        const code = document.createElement("div");
        code.className = "subtitle";
        code.textContent = company.code;
        cell.appendChild(link);
        cell.appendChild(code);
        tr.appendChild(cell);
      }
      const scored = company.score && company.score.rankable === true && Q.num(company.score.total) !== null;
      const observed = Q.num(company.score && company.score.observed_total);
      const scoreCell = td(scored ? Q.fmt(company.score.total, 1) : observed !== null ? "观察 " + Q.fmt(observed, 1) : "未排序", "col-score" + (scored ? "" : " score-unranked"));
      if (!scored) scoreCell.title = "观察分保留经营信号，但缺项、风险或异常使公司不参与横向排序";
      tr.appendChild(scoreCell);
      const tag = Q.classifyCompany(company, state.data && state.data.model);
      const tagCell = document.createElement("td");
      tagCell.className = "col-style-tag";
      tagCell.innerHTML = `<span class="style-badge ${tag.id}" title="${Q.esc(tag.detail)}。${Q.esc(tag.hint)}">${Q.esc(tag.label)}</span>`;
      tr.appendChild(tagCell);
      if (state.groups.has("score")) {
        const cov = Q.num(company.score && company.score.coverage);
        tr.appendChild(td(cov === null ? "—" : Q.fmt(cov * 100, 0) + "%"));
        Q.dimensions(company).forEach((dim) => tr.appendChild(td(dim.score === null ? "—" : Q.fmt(dim.score, 1))));
      }
      ["profit", "growth", "cash", "risk", "channel"].forEach((group) => {
        if (!state.groups.has(group)) return;
        METRICS[group].forEach((spec) => tr.appendChild(td(formatMetric(spec, metricValue(company, spec)))));
      });
      if (state.groups.has("valuation")) {
        tr.appendChild(td(Q.fmt(company.price && company.price.close, 2)));
        const base = Q.baseScenario(company);
        const comparable = company.dcf && company.dcf.price_comparable === true;
        tr.appendChild(td(base ? (comparable ? Q.fmt(base.value_per_share, 1) : "价值代理") : Q.dcfStatus(company.dcf && company.dcf.status)));
        tr.appendChild(td(comparable && base ? Q.fmtPct(base.margin_of_safety * 100) : "—"));
        const flags = (company.score && company.score.quality_flags || []).slice();
        if ((company.provenance && company.provenance.conflicts || []).length) flags.push("财务冲突");
        if (!comparable) flags.push("净现金未核验");
        tr.appendChild(td(flags.length ? Q.financialText(flags.join("；")) : "已核验"));
      }
      tbody.appendChild(tr);
    });
    if (!rows.length) {
      const tr = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 20;
      cell.textContent = "当前筛选下没有公司。";
      tr.appendChild(cell);
      tbody.appendChild(tr);
    }
  }

  function openDetail(code) {
    const company = state.companies.find((c) => c.code === code);
    if (!company) return;
    state.detailCode = code;
    const row = Q.annualOf(company, state.year) || {};
    Q.el("detail-title").textContent = company.name;
    Q.el("detail-meta").textContent = company.code + " · 财务 " + state.year + " 完整年 · 行情 " + ((company.price && company.price.price_date) || "未标注");
    Q.el("detail-stock-link").href = "stock.html?code=" + encodeURIComponent(code);
    const dims = Q.dimensions(company).map((dim) => {
      const items = (dim.items || []).map((it) => `<li>${Q.esc(Q.itemLabel(it.name))}：${Q.esc(Q.fmtItemValue(it.name, it.value))} · ${it.score == null ? "未评分" : Q.fmt(it.score, 2) + " / " + Q.fmt(it.max, 0)}</li>`).join("");
      return `<section class="detail-section"><h3>${dim.letter} ${Q.esc(dim.name)}</h3><p>${dim.score == null ? "维度未评分" : Q.fmt(dim.score, 2) + " / " + Q.fmt(dim.weight, 0)}</p><ul>${items}</ul></section>`;
    }).join("");
    const missing = ((company.score && company.score.missing) || []).map(Q.itemLabel).join("、") || "无";
    const tag = Q.classifyCompany(company, state.data && state.data.model);
    const base = Q.baseScenario(company);
    Q.el("detail-body").innerHTML =
      `<section class="detail-section"><h3>${state.year} 完整年观测</h3><p>营收 ${Q.fmtYi(row.revenue)} 亿元 · 净利 ${Q.fmtYi(row.net_profit)} 亿元 · 毛利率 ${Q.fmtPct(row.gross_margin)} · 股息率 ${Q.fmtPct(company.dividend && company.dividend.yield_pct)}</p><p>收盘价 ${Q.fmt(company.price && company.price.close, 2)} 元 · ${company.dcf && company.dcf.price_comparable === true && base ? "基准 现金流折现 " + Q.fmt(base.value_per_share, 2) + " 元" : "现金流折现 每股价值代理未用于现价比较"} · <span class="style-badge ${tag.id}">${Q.esc(tag.label)}</span></p><p>缺项：${Q.esc(missing)}${(company.score && company.score.quality_flags || []).length ? " · 风险：" + Q.esc(Q.financialText(company.score.quality_flags.join("；"))) : ""}</p></section>` + dims;
    Q.el("detail-panel").classList.remove("hidden");
    Q.el("detail-overlay").classList.remove("hidden");
  }
  function closeDetail() {
    state.detailCode = null;
    Q.el("detail-panel").classList.add("hidden");
    Q.el("detail-overlay").classList.add("hidden");
  }

  function renderAll() {
    renderFilters();
    renderChips();
    renderHead();
    renderBody(visibleCompanies());
    Q.el("bank-count").textContent = state.companies.length + " 家研究样本";
  }

  function init() {
    Q.readJson("./data.json?v=15").then((data) => {
      state.data = data;
      state.companies = (data.companies || []).filter((c) => Q.CODES.includes(String(c.code)));
      const years = state.companies.map((c) => Q.latestAnnual(c)).filter(Boolean).map((r) => r.year);
      state.year = years.length ? Math.min(...years) : null;
      const priceDate = (state.companies[0] && state.companies[0].price && state.companies[0].price.price_date) || "未标注";
      const scoreYear = (state.companies[0] && state.companies[0].score && state.companies[0].score.annual_year) || "未标注";
      Q.el("research-price-date").textContent = "行情截至：" + priceDate;
      Q.el("research-report-date").textContent = "财务对比年：" + (state.year || "未标注") + " 完整年";
      Q.el("research-score-date").textContent = "打分基准年：" + scoreYear + " 完整年";
      Q.el("generated-at").textContent = "页面数据生成：" + (data.generated_at || "未标注");
      Q.el("research-date-summary").textContent = "· 行情截至：" + priceDate;
      Q.el("load-error").classList.add("hidden");
      Q.el("main-content").classList.remove("hidden");
      renderAll();
    }).catch((err) => {
      console.error(err);
      Q.el("load-error").classList.remove("hidden");
      Q.el("main-content").classList.add("hidden");
    });

    document.querySelectorAll(".col-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const group = btn.dataset.group;
        if (state.groups.has(group)) state.groups.delete(group);
        else state.groups.add(group);
        btn.classList.toggle("active", state.groups.has(group));
        renderAll();
      });
    });
    Q.el("reset-filters").addEventListener("click", () => {
      state.status = "all";
      state.style = "all";
      state.sortKey = "name";
      state.sortDir = "asc";
      state.compare.clear();
      state.groups = new Set(GROUPS);
      document.querySelectorAll(".col-toggle-btn").forEach((btn) => btn.classList.add("active"));
      renderAll();
    });
    Q.el("clear-compare").addEventListener("click", () => { state.compare.clear(); renderAll(); });
    Q.el("compare-search").addEventListener("input", (e) => renderSuggest(e.target.value));
    Q.el("compare-search").addEventListener("focus", (e) => renderSuggest(e.target.value));
    Q.el("detail-close").addEventListener("click", closeDetail);
    Q.el("detail-overlay").addEventListener("click", closeDetail);
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".compare-search-wrap")) Q.el("compare-suggest").classList.add("hidden");
    });
  }
  init();
})();
