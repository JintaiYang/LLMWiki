// 个股深度分析页面 - 前端逻辑
// 数据来源：dashboard/stock_data/_index.json + dashboard/stock_data/<code>.json
// （records/scale/indicators/score 段由 scripts/generate_stock_detail_data.py 与
//   scripts/generate_stock_score_data.py 生成）

(function () {
  "use strict";

  const COLOR_PRIMARY = "#087f70";
  const COLOR_COMPARE = "#3679cc";
  const COLOR_PRIMARY_SOFT = "rgba(8, 127, 112, 0.15)";
  const COLOR_COMPARE_SOFT = "rgba(54, 121, 204, 0.15)";
  // 六维雷达配色
  const DIM_COLORS = ["#2f6fed", "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#d1453b"];

  const state = {
    index: [],
    primaryCode: null,
    compareCode: null,
    primaryData: null,
    compareData: null,
    scorePeriod: null,     // 打分报告期（年报）
    granularity: "year",   // 'year' | 'quarter'（六维指标模块）
    range: "20",           // '20' | '40' | 'all'
    expandedDimCards: new Set(),  // 已展开评述的六维卡（A/B/C/D/E/F）
    charts: {},
    lazyObservers: new Map(),
    activeGroup: "group-overview",
    activeDimension: "A",
    pnlYear: null,
    bankNameByCode: {},
  };

  function renderDimEval(ev) {
    const blocks = normalizeEval(ev);
    if (!blocks.length) return "";
    let html = '<div class="dim-card-eval">';
    blocks.forEach((b) => {
      const body = (b.items || []).join("；");
      html += '<div class="eval-line">';
      if (b.title) html += `<strong class="eval-title">${escapeHtml(b.title)}：</strong>`;
      if (body) html += `<span class="eval-item">${escapeHtml(body)}</span>`;
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  function normalizeEval(ev) {
    if (!ev) return [];
    if (Array.isArray(ev)) {
      return ev.filter((b) => b && (b.title || (b.items && b.items.length)));
    }
    if (typeof ev === "string") {
      return [{ title: "", items: [ev] }];
    }
    return [];
  }

  function el(id) { return document.getElementById(id); }

  function isNA(v) { return v === null || v === undefined || v === "" || Number.isNaN(v); }

  function fmtNumber(v, digits) {
    if (isNA(v)) return null;
    return Number(v).toLocaleString("zh-CN", {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
  }

  function fmtPercent(v) {
    if (isNA(v)) return null;
    return `${v > 0 ? "+" : ""}${fmtNumber(v, 2)}%`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function helpBtnHtml(title, body) {
    if (!title || !body) return "";
    return `<button type="button" class="col-help-btn" aria-expanded="false" aria-label="${escapeHtml(title)}的含义" data-help-title="${escapeHtml(title)}" data-help-body="${escapeHtml(body)}">?</button>`;
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
    const pw = Math.min(300, window.innerWidth - 16);
    pop.style.width = pw + "px";
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    pop.style.left = left + "px";
    pop.style.top = r.bottom + 8 + "px";
    const ph = pop.offsetHeight;
    if (r.bottom + 8 + ph > window.innerHeight - 8) {
      pop.style.top = Math.max(8, r.top - ph - 8) + "px";
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".col-help-btn");
    if (btn) {
      e.preventDefault();
      const open = btn.getAttribute("aria-expanded") === "true";
      hideColHelp();
      if (!open) showColHelp(btn);
      return;
    }
    if (!e.target.closest(".col-help-pop")) hideColHelp();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideColHelp();
  });
  window.addEventListener("resize", hideColHelp);
  document.addEventListener("scroll", hideColHelp, true);

  // ---------- 深度数据定义（⑨ 定性分析用） ----------
  const DEEP_EVAL_KEYS = [
    { key: "盈利能力评价", label: "盈利能力" },
    { key: "资产质量评价", label: "资产质量" },
    { key: "资产风险评价", label: "资产风险" },
    { key: "可持续性评价", label: "可持续性" },
  ];

  // H 定性六子项框架（展示用；实际加减见 period.g / g_qualitative_scores.json）
  const H_FRAMEWORK = [
    { id: "H1", name: "战略定力与商业模式", range: "0 ~ +3", points: "主战略延续≥10年+2；5-10年+1；<5年或频繁换赛道0；资源投放与战略一致+0.5；模式可复制+0.5" },
    { id: "H2", name: "管理层与治理稳定性", range: "-3 ~ +2", points: "高管落马近5年-2~-3；5年换2任以上行长-1；董事会动荡-1~-2；平稳交接+1；薪酬挂钩增持+0.5~+1" },
    { id: "H3", name: "信息披露质量", range: "0 ~ +2", points: "主动披露显著多于同业+1；业绩指引兑现良好+0.5~+1；回避关键问题-0.5" },
    { id: "H4", name: "股东与关联交易", range: "-3 ~ 0", points: "大股东高比例质押-1~-2；股东占款违规担保-2~-3；关联交易异常-0.5~-1" },
    { id: "H5", name: "合规与风险事件", range: "-3 ~ 0", points: "近3年千万级罚单每次-0.5封顶-1.5；重大案件-1~-2；接管/重组-3" },
    { id: "H6", name: "区域与外部支持", range: "-1 ~ +3", points: "江浙/成渝区域+1~+2或疲弱区域-1；汇金/财政部控股+1（仅风险折价）" },
  ];

  const BASIS_LABELS = {
    ifind: "iFind核验", statement: "三大报表", dividend: "分红记录",
    derived: "推导", excluded: "缺项不计入", unavailable: "无数据源",
    proxy: "前瞻代理", basis50: "基准50%(已废止)", raw: "原始", na: "无数据",
  };

  // 打分项静态元数据（与后端 generate_stock_score_data.py ITEMS 保持同步）
  const ITEM_META = {
    A1: { name: "NIM净息差", x1: 1.90, x0: 1.15, unit: "%" },
    A2: { name: "非息收入占比", x1: 35.0, x0: 10.0, unit: "%" },
    B1: { name: "营收增速(相对中位数)", x1: 10.0, x0: -5.0, unit: "%" },
    B2: { name: "归母净利润增速", x1: 10.0, x0: -5.0, unit: "%" },
    C1: { name: "加权ROE", x1: 15.0, x0: 6.0, unit: "%" },
    C2: { name: "ROA", x1: 1.15, x0: 0.40, unit: "%" },
    C3: { name: "净利/PPOP", x1: 0.55, x0: 1.05, unit: "x" },
    C4: { name: "拨备充足", x1: 3.50, x0: 2.00, unit: "%" },
    C5: { name: "拨备变动趋势", x1: 15.0, x0: -40.0, unit: "bp" },
    D1: { name: "不良贷款率", x1: 0.70, x0: 1.80, unit: "%" },
    D2: { name: "关注类贷款比例", x1: 1.00, x0: 3.50, unit: "%" },
    D3: { name: "关注类迁徙(代理)", x1: -20.0, x0: 50.0, unit: "bp" },
    D4: { name: "不良偏离(代理)", x1: 1.20, x0: 3.50, unit: "x" },
    D5: { name: "不良生成(代理)", x1: -5.0, x0: 20.0, unit: "%" },
    E1: { name: "成本收入比CIR", x1: 24.0, x0: 40.0, unit: "%" },
    E2: { name: "存款成本率", x1: 1.20, x0: 1.95, unit: "%",
      help: { title: "存款成本率", body: "客户存款一年要付多少利息，不是整张负债表的计息成本。引擎用计息负债成本扣掉同业、存单、债券这些更贵的批发负债（按批发占比×0.80个百分点还原），更接近真正的存款成本。越低越好：1.20%满分，1.95%零分。阈值随当年行业中位数相对2025平移。" } },
    E3: { name: "信用成本率", x1: 0.50, x0: 1.50, unit: "%",
      help: { title: "信用成本率", body: "当年为贷款计提的信用减值损失÷平均贷款。每放100元贷款，利润表里要拿出多少去覆盖可能的坏账。越低越好：0.50%满分，1.50%零分。覆盖率是已经提好的存量缓冲；信用成本是这一年新提了多少。信用成本下降但不良还在生成，可能是少提拨备在虚增利润。" } },
    F1: { name: "CET1核心一级资本充足率", x1: 12.0, x0: 7.5, unit: "%" },
    F2: { name: "RWA/总资产(风险密度)", x1: 55.0, x0: 75.0, unit: "%" },
    F3: { name: "现金分红率", x1: 33.0, x0: 20.0, unit: "%" },
    F4: { name: "近5年摊薄性再融资", x1: 0, x0: 1, unit: "" },
    G1: { name: "隐含回报ROE/PB", x1: 20.0, x0: 10.0, unit: "%" },
    G2: { name: "股息率", x1: 5.5, x0: 2.8, unit: "%" },
  };

  const SCORE_DIM_ORDER = ["A", "B", "C", "D", "E", "F"];
  const DIM_NAME = {
    A: "收入效率", B: "收入增长", C: "盈利质量", D: "资产质量",
    E: "成本控制", F: "资本内生", G: "估值评价",
  };
  const DIM_OF_ITEM = {
    A: ["A1", "A2"], B: ["B1", "B2"],
    C: ["C1", "C2", "C3", "C4", "C5"],
    D: ["D1", "D2", "D3", "D4", "D5"],
    E: ["E1", "E2", "E3"],
    F: ["F1", "F2", "F3", "F4"],
    G: ["G1", "G2"],
  };
  const ITEM_ORDER = SCORE_DIM_ORDER.flatMap((d) => DIM_OF_ITEM[d]).concat(DIM_OF_ITEM.G);

  function fmtScoreValue(val, unit, itemId) {
    if (isNA(val)) return "—";
    if (itemId === "F4") return Number(val) === 0 ? "无" : "有";
    if (unit === "%") return fmtNumber(val, 2) + "%";
    if (unit === "bp") return fmtNumber(val, 0) + "bp";
    if (unit === "x") return fmtNumber(val, 2) + "x";
    return fmtNumber(val, 2);
  }

  // ---------- URL 参数 ----------
  function getQueryParams() { return new URLSearchParams(window.location.search); }

  function updateQueryParams() {
    const params = new URLSearchParams();
    if (state.primaryCode) params.set("code", state.primaryCode);
    if (state.compareCode) params.set("compare", state.compareCode);
    if (state.scorePeriod) params.set("period", state.scorePeriod);
    el("stock-score-date").textContent = "打分报告期：" + (state.scorePeriod || "暂无");
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }

  // ---------- 数据加载 ----------
  function loadIndex() {
    return fetch("./stock_data/_index.json", { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then((data) => {
      state.index = data.banks || [];
      el("generated-at").textContent = "个股索引生成：" + (data.generated_at || "未知");
    });
  }

  function loadDashboardData() {
    return fetch("./data.json", { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then((data) => {
      state.dashboardData = data;
      (data.banks || []).forEach((b) => {
        if (b.name) state.bankNameByCode[b.name] = b;
      });
    }).catch((err) => {
      console.warn("加载 data.json 失败（深度数据模块将不可用）：", err);
    });
  }

  function loadBankData(code) {
    if (!code) return Promise.resolve(null);
    return fetch(`./stock_data/${code}.json`, { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  // ---------- 选择器 ----------
  function populateSelectors() {
    const primarySelect = el("primary-select");
    const compareSelect = el("compare-select");
    const periodSelect = el("score-period-select");

    primarySelect.innerHTML = "";
    compareSelect.innerHTML = '<option value="">无对比</option>';
    state.index.forEach((b) => {
      const opt1 = document.createElement("option");
      opt1.value = b.code;
      opt1.textContent = `${b.name}（${b.code}）`;
      primarySelect.appendChild(opt1);
      const opt2 = document.createElement("option");
      opt2.value = b.code;
      opt2.textContent = `${b.name}（${b.code}）`;
      compareSelect.appendChild(opt2);
    });

    // 打分报告期（年报期，倒序）
    periodSelect.innerHTML = "";
    const annualPeriods = listAnnualPeriods();
    annualPeriods.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.date;
      opt.textContent = p.label;
      periodSelect.appendChild(opt);
    });

    primarySelect.value = state.primaryCode || "";
    compareSelect.value = state.compareCode || "";

    primarySelect.addEventListener("change", () => {
      state.primaryCode = primarySelect.value || null;
      state.scorePeriod = null; // 换标的后重置打分期
      updateQueryParams();
      refreshPrimary();
    });
    compareSelect.addEventListener("change", () => {
      state.compareCode = compareSelect.value || null;
      updateQueryParams();
      refreshCompare();
    });
    periodSelect.addEventListener("change", (e) => {
      state.scorePeriod = e.target.value || null;
      updateQueryParams();
      renderAll();
    });
    el("granularity-select").addEventListener("change", (e) => {
      state.granularity = e.target.value;
      renderAll();
    });
    el("range-select").addEventListener("change", (e) => {
      state.range = e.target.value;
      renderAll();
    });
  }

  function listAnnualPeriods() {
    // 取主标的的年报期（score.periods 中 total 非 null 的期）
    const out = [];
    if (state.primaryData && state.primaryData.score && state.primaryData.score.periods) {
      state.primaryData.score.periods.forEach((p) => {
        if (p.total !== null && p.total !== undefined) {
          out.push({ date: p.report_date, label: `${p.year}A` });
        }
      });
    }
    return out.reverse(); // 倒序（最新在前）
  }

  function refreshPrimary() {
    return loadBankData(state.primaryCode).then((data) => {
      state.primaryData = data;
      state.pnlYear = null;
      el("page-title").textContent = data ? `${data.name}（${data.code}）深度分析` : "个股深度分析";
      const reportDate = data?.records?.at(-1)?.report_date || "未知";
      el("stock-data-dates").textContent = "财报报告期：" + reportDate + "（当前银行）";
      el("stock-date-summary").textContent = "· 当前银行财报期：" + reportDate;
      // 重填打分期选择器
      const periodSelect = el("score-period-select");
      periodSelect.innerHTML = "";
      const annualPeriods = listAnnualPeriods();
      const params = getQueryParams();
      const requested = state.scorePeriod || params.get("period");
      annualPeriods.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.date;
        opt.textContent = p.label;
        periodSelect.appendChild(opt);
      });
      if (requested && annualPeriods.some((p) => p.date === requested)) {
        state.scorePeriod = requested;
      } else {
        state.scorePeriod = annualPeriods.length ? annualPeriods[0].date : null;
      }
      periodSelect.value = state.scorePeriod || "";
      el("stock-score-date").textContent = "打分报告期：" + (state.scorePeriod || "暂无");
      renderAll();
    }).catch((err) => {
      console.error("加载主标的数据失败：", err);
    });
  }

  function refreshCompare() {
    if (!state.compareCode) {
      state.compareData = null;
      renderAll();
      return Promise.resolve();
    }
    return loadBankData(state.compareCode).then((data) => {
      state.compareData = data;
      renderAll();
    }).catch((err) => {
      console.error("加载对比标的数据失败：", err);
    });
  }

  // ---------- 分组导航 ----------
  function setupGroupNav() {
    function activateFromHash() {
      const hash = location.hash.slice(1);
      const dimension = /^group-dim([A-F])$/.exec(hash);
      if (dimension) {
        state.activeDimension = dimension[1];
        state.activeGroup = "group-metrics";
      } else if (document.querySelector(`[data-group="${CSS.escape(hash)}"]`)) {
        state.activeGroup = hash;
      } else {
        state.activeGroup = "group-overview";
      }
      applyGroupLayout();
    }
    document.querySelectorAll(".group-nav-item").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        collapseChartZoom();
        state.activeGroup = link.dataset.group;
        history.pushState(null, "", link.hash);
        applyGroupLayout();
        el("group-nav").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    document.querySelectorAll("[data-dimension]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeDimension = button.dataset.dimension;
        history.pushState(null, "", "#group-dim" + state.activeDimension);
        applyGroupLayout();
      });
    });
    window.addEventListener("popstate", activateFromHash);
    window.addEventListener("hashchange", activateFromHash);
    activateFromHash();
  }

  function applyGroupLayout() {
    document.querySelectorAll("#main-content > .metric-group").forEach((section) => {
      section.hidden = section.id !== state.activeGroup;
    });
    document.querySelectorAll("#group-nav [data-group]").forEach((link) => {
      const active = link.dataset.group === state.activeGroup;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    document.querySelectorAll("[data-dimension]").forEach((button) => {
      const active = button.dataset.dimension === state.activeDimension;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      el("group-dim" + button.dataset.dimension).hidden = !active;
    });
    requestAnimationFrame(() => Object.values(state.charts).forEach((chart) => chart.resize()));
  }

  // ---------- 通用图表工具 ----------
  function destroyChart(id) {
    if (state.charts[id]) {
      state.charts[id].destroy();
      delete state.charts[id];
    }
  }

  function destroyAllCharts() {
    state.lazyObservers.forEach((observer) => observer.disconnect());
    state.lazyObservers.clear();
    Object.keys(state.charts).forEach(destroyChart);
  }

  function resizeChartIn(card) {
    if (!card || typeof Chart === "undefined" || !Chart.getChart) return;
    const canvas = card.querySelector("canvas");
    if (!canvas) return;
    const ch = Chart.getChart(canvas);
    if (!ch) return;
    const box = canvas.parentElement || card;
    const w = Math.max(0, Math.round(box.clientWidth));
    const h = Math.max(0, Math.round(box.clientHeight));
    if (w > 0 && h > 0) ch.resize(w, h);
    else ch.resize();
  }

  function collapseChartZoom() {
    const cards = Array.prototype.slice.call(document.querySelectorAll(".chart-card.is-expanded"));
    cards.forEach((card) => {
      card.classList.remove("is-expanded");
    });
    document.querySelectorAll(".chart-zoom-spacer").forEach((n) => n.remove());
    const backdrop = el("chart-zoom-backdrop");
    if (backdrop) backdrop.remove();
    document.body.classList.remove("chart-zoom-open");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cards.forEach(resizeChartIn);
      });
    });
  }

  function clickHitsChartLegend(evt, chart) {
    if (!chart || !chart.legend) return false;
    const boxes = chart.legend.legendHitBoxes;
    if (!boxes || !boxes.length) return false;
    let x;
    let y;
    const helpers = Chart.helpers || {};
    const getPos = helpers.getRelativePosition || (helpers.dom && helpers.dom.getRelativePosition);
    if (typeof getPos === "function") {
      const pos = getPos(evt, chart);
      x = pos.x;
      y = pos.y;
    } else {
      const canvas = chart.canvas;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      x = (evt.clientX - rect.left) * (chart.width / rect.width);
      y = (evt.clientY - rect.top) * (chart.height / rect.height);
    }
    const pad = 6;
    return boxes.some((box) => (
      x >= box.left - pad && x <= box.left + box.width + pad &&
      y >= box.top - pad && y <= box.top + box.height + pad
    ));
  }

  function bindChartZoomAll(root) {
    if (!root) return;
    root.querySelectorAll(".chart-zoomable").forEach(bindChartZoom);
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
      backdrop.addEventListener("click", (e) => {
        e.stopPropagation();
        collapseChartZoom();
      });
      document.body.appendChild(backdrop);
      document.body.classList.add("chart-zoom-open");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resizeChartIn(card));
      });
    });
    if (!bindChartZoom.escBound) {
      bindChartZoom.escBound = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") collapseChartZoom();
      });
    }
  }

  function hexToRgba(hex, alpha) {
    const n = String(hex).replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function computeDatedYoy(values, dates) {
    const n = values ? values.length : 0;
    const out = new Array(n).fill(null);
    if (!n) return out;
    if (dates && dates.length === n) {
      const idx = {};
      dates.forEach((d, i) => { if (d) idx[d] = i; });
      for (let i = 0; i < n; i++) {
        const d = dates[i];
        if (!d || d.length < 10) continue;
        const prevD = String(parseInt(d.slice(0, 4), 10) - 1) + d.slice(4);
        if (!(prevD in idx)) continue;
        const v = values[i];
        const p = values[idx[prevD]];
        if (isNA(v) || isNA(p) || p === 0) continue;
        out[i] = (v / p - 1) * 100;
      }
      if (out.some((v) => !isNA(v))) return out;
    }
    for (let i = 1; i < n; i++) {
      const v = values[i];
      const p = values[i - 1];
      if (isNA(v) || isNA(p) || p === 0) continue;
      out[i] = (v / p - 1) * 100;
    }
    return out;
  }

  function yoyBarDataset(label, yoy, color) {
    return {
      type: "bar",
      label: label + "同比",
      data: yoy,
      backgroundColor: hexToRgba(color, 0.35),
      hoverBackgroundColor: hexToRgba(color, 0.55),
      borderWidth: 0,
      yAxisID: "yoy",
      order: 2,
      barPercentage: 0.85,
      categoryPercentage: 0.72,
      maxBarThickness: 22,
      skipNull: true,
    };
  }

  function yoyFromSeries(fullSeries, dates) {
    if (!fullSeries || !fullSeries.length) return dates.map(() => null);
    const fds = fullSeries.map((x) => x.d);
    const fvs = fullSeries.map((x) => x.v);
    const all = computeDatedYoy(fvs, fds);
    const idx = {};
    fds.forEach((d, i) => { if (d) idx[d] = i; });
    return dates.map((d) => (d in idx ? all[idx[d]] : null));
  }

  function yoyTooltipLabel(ctx) {
    const v = ctx.parsed && ctx.parsed.y;
    if (v === null || v === undefined) return;
    if (ctx.dataset.yAxisID === "yoy") {
      const sign = v > 0 ? "+" : "";
      return ` ${ctx.dataset.label}: ${sign}${Number(v).toFixed(1)}%`;
    }
    return ` ${ctx.dataset.label}: ${fmtNumber(v, 2)}`;
  }

  function withYoyScales(extra) {
    const merged = baseChartOptions(extra);
    merged.scales = Object.assign({}, merged.scales, {
      y: Object.assign({
        position: "left",
        ticks: { font: { size: 10 } },
      }, (extra && extra.scales && extra.scales.y) || {}, {
        position: "left",
      }),
      x: Object.assign({
        offset: true,
        ticks: { font: { size: 10 }, maxRotation: 60, autoSkip: true, maxTicksLimit: 24 },
      }, (extra && extra.scales && extra.scales.x) || {}, {
        offset: true,
      }),
      yoy: {
        position: "right",
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        ticks: {
          font: { size: 10 },
          callback: (v) => `${v}%`,
        },
        title: { display: true, text: "同比", font: { size: 10 } },
      },
    });
    merged.plugins = Object.assign({}, merged.plugins, {
      tooltip: Object.assign({ enabled: true }, (merged.plugins && merged.plugins.tooltip) || {}, {
        callbacks: Object.assign(
          ((merged.plugins && merged.plugins.tooltip && merged.plugins.tooltip.callbacks) || {}),
          { label: yoyTooltipLabel }
        ),
      }),
    });
    return merged;
  }

  function baseChartOptions(extra) {
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: { enabled: true },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 60, autoSkip: true, maxTicksLimit: 24 } },
        y: { ticks: { font: { size: 10 } } },
      },
    }, extra || {});
  }

  function canvasFor(id) {
    let c = el(id);
    if (!c) {
      c = document.createElement("canvas");
      c.id = id;
    }
    return c;
  }

  function lazyChart(canvasId, buildFn) {
    // 懒加载：canvas 进入视口后才渲染图表
    const c = el(canvasId);
    if (!c) return;
    state.lazyObservers.get(canvasId)?.disconnect();
    if (c.dataset.rendered === "1") { buildFn(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          io.disconnect();
          state.lazyObservers.delete(canvasId);
          if (!c.isConnected) return;
          c.dataset.rendered = "1";
          buildFn();
        }
      });
    }, { rootMargin: "200px" });
    state.lazyObservers.set(canvasId, io);
    io.observe(c);
    // 兜底：渲染全部时直接构建
    if (state.forceRender) { io.disconnect(); c.dataset.rendered = "1"; buildFn(); }
  }

  // ---------- ② 利润流向 ----------
  function renderPnl() {
    const container = el("pnl-content");
    if (!container) return;
    const d = state.primaryData;
    const pnl = d && d.pnl_sankey;
    if (!pnl || !pnl.years || !pnl.year_list || !pnl.year_list.length) {
      container.innerHTML = '<p class="placeholder">该银行暂无利润流向数据。</p>';
      return;
    }
    if (typeof window.PnlSankey === "undefined") {
      container.innerHTML = '<p class="placeholder">利润流向模块未加载。</p>';
      return;
    }
    const yearList = pnl.year_list.filter((y) => pnl.years[y]);
    const latest = yearList[yearList.length - 1];
    if (!state.pnlYear || !pnl.years[state.pnlYear]) state.pnlYear = latest;
    const idx = yearList.indexOf(state.pnlYear);
    const prevYear = idx > 0 ? yearList[idx - 1] : null;
    window.PnlSankey.render(container, {
      name: d.name,
      years: pnl.years,
      year: state.pnlYear,
      prevYear,
      yearList: yearList.slice(-4),
      onYearChange: (y) => {
        state.pnlYear = y;
        renderPnl();
      },
    });
  }

  // ---------- ① 综合评价 ----------
  function renderOverview() {
    collapseChartZoom();
    const container = el("overview-content");
    const d = state.primaryData;
    if (!d || !d.score || !d.score.periods || !d.score.periods.length) {
      el("summary-content").innerHTML = "";
      container.innerHTML = '<p class="placeholder">该银行暂无打分数据。</p>';
      return;
    }
    const period = d.score.periods.find((p) => p.report_date === state.scorePeriod) || d.score.periods[0];
    const cmp = state.compareData;
    const cmpPeriod = cmp && cmp.score ? (cmp.score.periods.find((p) => p.report_date === state.scorePeriod) || null) : null;

    let html = "";

    let overallHtml = "";
    if (period.overall) {
      overallHtml += `<div class="overall-bar"><div class="overall-title">${escapeHtml(d.name)}</div><div class="overall-text">${escapeHtml(period.overall)}</div></div>`;
      if (cmpPeriod && cmpPeriod.overall) {
        overallHtml += `<div class="overall-bar compare"><div class="overall-title">${escapeHtml(cmp.name)}</div><div class="overall-text">${escapeHtml(cmpPeriod.overall)}</div></div>`;
      }
    }

    html += '<div class="summary-grid"><div class="summary-score">';
    html += `<div class="summary-label">六维公司打分 / 100</div><div class="score-big">${isNA(period.total) ? "—" : fmtNumber(period.total, 2)}<span class="score-grade">${escapeHtml(period.grade || "")}</span></div>`;
    html += `<p>${period.year}A · <a href="score-formula.html">公式 V2.0</a></p><p>估值与定性独立观测</p>`;
    if (cmp) html += `<p class="summary-compare">${escapeHtml(cmp.name)} ${cmpPeriod ? fmtNumber(cmpPeriod.total, 2) ?? "—" : "—"} / 100</p>`;
    html += '</div>';

    // 六维评价卡：默认折叠，点击展开能力判断
    html += '<div class="dim-cards">';
    const DIM_ORDER = SCORE_DIM_ORDER;
    DIM_ORDER.forEach((k, i) => {
      const dv = period.dimensions && period.dimensions[k];
      if (!dv) return;
      const pct = dv.full ? (dv.score / dv.full * 100) : 0;
      const barColor = DIM_COLORS[i % DIM_COLORS.length];
      const evalBody = period.evaluations && period.evaluations[k] ? renderDimEval(period.evaluations[k]) : "";
      const expanded = state.expandedDimCards.has(k);
      html += `<div class="dim-card${expanded ? " expanded" : ""}" data-dim="${k}">`;
      html += `<div class="dim-card-toggle" data-dim-toggle="${k}" role="button" tabindex="0" aria-expanded="${expanded}">`;
      html += `<span class="dim-badge" style="background:${barColor}">${k}</span>`;
      html += `<div class="dim-card-headtext"><div class="dim-card-q">${escapeHtml(dv.question || dv.name)}<span class="dim-card-name"> · ${escapeHtml(dv.name)}</span></div></div>`;
      html += `<div class="dim-card-score">${fmtNumber(dv.score, 1)}<span class="dim-card-full">/${dv.full}</span></div>`;
      html += `<span class="dim-card-caret">${expanded ? "▴" : "▾"}</span>`;
      html += '</div>';
      html += `<div class="dim-bar"><div class="dim-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
      const cv = cmpPeriod?.dimensions?.[k];
      if (cmp) html += `<div class="dim-comparison"><span>${escapeHtml(cmp.name)}</span><span class="dim-compare-track"><i style="width:${cv?.full && !isNA(cv.score) ? cv.score / cv.full * 100 : 0}%"></i></span><span>${cv && !isNA(cv.score) ? fmtNumber(cv.score, 1) + " / " + cv.full : "—"}</span></div>`;
      if (expanded && evalBody) html += evalBody;
      html += '</div>';
    });
    html += '</div>';
    const ddm = ddmByName(d.name);
    const bank = state.bankNameByCode[d.name];
    const facts = [
      ["财报报告期", d.records?.at(-1)?.report_date || "—"],
      ["打分报告期", period.report_date],
      ["收盘价", ddm ? fmtDdm(ddm.close, 2, " 元") : "—"],
      ["现价 PB", ddm ? fmtDdm(ddm.pb, 2, "x") : "—"],
      ["股息率", ddm ? fmtDdm(ddm.div_yield, 2, "%") : "—"],
      ["定性 H", isNA(period.g) ? "—" : fmtNumber(period.g, 1)],
    ];
    html += `<dl class="summary-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}<div class="summary-price-date">行情截至 ${escapeHtml(ddm?.price_date || state.dashboardData?.ddm_meta?.price_date || bank?.price_date || "未知")}</div></dl></div>`;
    const record = d.records?.find((row) => row.report_date === period.report_date);
    const snapshots = [["营业收入", "revenue_cum", "revenue_cum_yoy"], ["归母净利润", "net_profit_cum", "net_profit_cum_yoy"], ["总资产", "total_assets", "total_assets_yoy"], ["存款", "deposits", "deposits_yoy"]];
    html += `<div class="stock-kpi-strip">${snapshots.map(([label, key, yoy]) => `<div class="stock-kpi"><div class="summary-label">${period.year}A ${label}</div><div class="stock-kpi-value">${record && !isNA(record[key]) ? fmtNumber(record[key], 2) : "—"}<small>亿元</small></div><div class="stock-kpi-foot">${record && !isNA(record[yoy]) ? fmtPercent(record[yoy]) + " 同比" : "同比 —"}</div></div>`).join("")}</div>`;
    const summary = el("summary-content");
    summary.innerHTML = html;
    html = overallHtml;
    html += '<div class="chart-card wide chart-zoomable"><h3>定量总分趋势 <small>年报 · 右轴同比</small></h3><div class="chart-canvas-box"><canvas id="chart-score-trend"></canvas></div></div>';
    html += '<details class="research-disclosure"><summary>六维雷达对照</summary><div class="radar-wrap"><canvas id="chart-radar"></canvas></div></details>';

    // 打分明细表
    html += `<details class="research-disclosure"><summary>逐项打分明细 · 数值、满分线与来源</summary><div class="table-scroll"><table class="metric-table score-table"><thead><tr><th>编号</th><th>打分项</th><th>数值</th>`;
    html += `<th>${escapeHtml(d.name)}</th>`;
    if (cmpPeriod) html += `<th>${escapeHtml(cmp.name)}</th>`;
    html += `<th>满分线</th><th>零分线</th><th>依据</th></tr></thead><tbody>`;
    let lastDim = null;
    ITEM_ORDER.forEach((it) => {
      const v = period.items && period.items[it];
      const dim = Object.keys(DIM_OF_ITEM).find((dk) => DIM_OF_ITEM[dk].includes(it));
      if (dim !== lastDim) {
        lastDim = dim;
        const dv = period.dimensions && period.dimensions[dim];
        const extra = dim === "G" ? "（不计入总分）" : "";
        html += `<tr class="dim-row"><td colspan="${cmpPeriod ? 8 : 7}">${dim} ${escapeHtml(DIM_NAME[dim] || "")} — 小计 ${dv ? fmtNumber(dv.score, 1) : "—"}/${dv ? dv.full : "?"} 分${extra}</td></tr>`;
      }
      if (!v) return;
      const cv = cmpPeriod && cmpPeriod.items ? cmpPeriod.items[it] : null;
      const meta = ITEM_META[it] || { name: it, x1: null, x0: null, unit: "%" };
      const x1 = v.x1 != null ? v.x1 : meta.x1;
      const x0 = v.x0 != null ? v.x0 : meta.x0;
      const valueText = fmtScoreValue(v.value, meta.unit, it);
      const x1Text = fmtScoreValue(x1, meta.unit, it === "F4" ? "" : it);
      const x0Text = it === "F4" ? "有普通股摊薄" : fmtScoreValue(x0, meta.unit, it);
      const scoreText = isNA(v.score) ? "—" : fmtNumber(v.score, 2);
      html += '<tr class="row-primary">';
      html += `<td>${it}</td><td>${escapeHtml(meta.name)}${meta.help ? helpBtnHtml(meta.help.title, meta.help.body) : ""}</td>`;
      html += `<td>${valueText}</td>`;
      html += `<td><strong>${scoreText}</strong> / ${v.full}</td>`;
      if (cmpPeriod) html += `<td>${cv && !isNA(cv.score) ? fmtNumber(cv.score, 2) + " / " + cv.full : "—"}</td>`;
      html += `<td>${x1Text}</td><td>${x0Text}</td>`;
      const basisTitle = v.note ? ` title="${escapeHtml(v.note)}"` : "";
      html += `<td><span class="basis-tag basis-${v.basis}"${basisTitle}>${BASIS_LABELS[v.basis] || v.basis}</span></td>`;
      html += '</tr>';
    });
    html += '</tbody></table></div></details>';

    container.innerHTML = html;
    bindChartZoomAll(container);

    summary.querySelectorAll(".dim-card-toggle").forEach((toggle) => {
      const k = toggle.dataset.dimToggle;
      const handler = () => {
        if (state.expandedDimCards.has(k)) state.expandedDimCards.delete(k);
        else state.expandedDimCards.add(k);
        renderOverview();
      };
      toggle.addEventListener("click", handler);
      toggle.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
      });
    });

    // 渲染雷达图（支持对比叠加）
    lazyChart("chart-radar", () => {
      destroyChart("chart-radar");
      const ctx = el("chart-radar").getContext("2d");
      const labels = DIM_ORDER.map((k) => {
        const name = period.dimensions[k] ? period.dimensions[k].name : k;
        return `${k} ${name}`;
      });
      const datasets = [{
        label: `${d.name} ${period.year}A`,
        data: DIM_ORDER.map((k) => {
          const dv = period.dimensions[k];
          return dv && dv.full ? +(dv.score / dv.full * 100).toFixed(1) : 0;
        }),
        borderColor: COLOR_PRIMARY,
        backgroundColor: COLOR_PRIMARY_SOFT,
        pointBackgroundColor: COLOR_PRIMARY,
      }];
      if (cmpPeriod && cmpPeriod.dimensions) {
        datasets.push({
          label: `${cmp.name} ${cmpPeriod.year}A`,
          data: DIM_ORDER.map((k) => {
            const dv = cmpPeriod.dimensions[k];
            return dv && dv.full ? +(dv.score / dv.full * 100).toFixed(1) : 0;
          }),
          borderColor: COLOR_COMPARE,
          backgroundColor: COLOR_COMPARE_SOFT,
          pointBackgroundColor: COLOR_COMPARE,
        });
      }
      state.charts["chart-radar"] = new Chart(ctx, {
        type: "radar",
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: !!cmpPeriod, labels: { boxWidth: 10, font: { size: 10 } } } },
          scales: {
            r: {
              min: 0, max: 100,
              ticks: { stepSize: 20, font: { size: 9 }, backdropColor: "transparent" },
              pointLabels: { font: { size: 11 } },
              grid: { color: "rgba(0,0,0,0.08)" },
            },
          },
        },
      });
    });

    // 总分趋势图
    lazyChart("chart-score-trend", () => {
      destroyChart("chart-score-trend");
      const ctx = el("chart-score-trend").getContext("2d");
      const annual = d.score.periods.filter((p) => p.total !== null && p.total !== undefined);
      const dates = annual.map((p) => p.report_date);
      const values = annual.map((p) => p.total);
      const datasets = [{
        type: "line",
        label: d.name + " 定量总分",
        data: values,
        borderColor: COLOR_PRIMARY,
        backgroundColor: COLOR_PRIMARY,
        fill: false, tension: 0.25, pointRadius: 2,
        yAxisID: "y",
        order: 0,
      }];
      const yoy = computeDatedYoy(values, dates);
      if (yoy.some((v) => !isNA(v))) {
        datasets.push(yoyBarDataset(d.name + " 定量总分", yoy, COLOR_PRIMARY));
      }
      if (cmp && cmp.score) {
        const cmpAnnual = cmp.score.periods.filter((p) => p.total !== null && p.total !== undefined);
        const cmpMap = {};
        cmpAnnual.forEach((p) => { cmpMap[p.report_date] = p.total; });
        const cmpValues = dates.map((dd) => (cmpMap[dd] !== undefined ? cmpMap[dd] : null));
        datasets.push({
          type: "line",
          label: cmp.name + " 定量总分",
          data: cmpValues,
          borderColor: COLOR_COMPARE,
          borderDash: [5, 4],
          tension: 0.25, pointRadius: 2, spanGaps: true,
          fill: false,
          yAxisID: "y",
          order: 0,
        });
        const cmpDatesFull = cmpAnnual.map((p) => p.report_date);
        const cmpValsFull = cmpAnnual.map((p) => p.total);
        const cmpYoyAll = computeDatedYoy(cmpValsFull, cmpDatesFull);
        const cmpIdx = {};
        cmpDatesFull.forEach((dd, i) => { cmpIdx[dd] = i; });
        const cmpYoy = dates.map((dd) => (dd in cmpIdx ? cmpYoyAll[cmpIdx[dd]] : null));
        if (cmpYoy.some((v) => !isNA(v))) {
          datasets.push(yoyBarDataset(cmp.name + " 定量总分", cmpYoy, COLOR_COMPARE));
        }
      }
      state.charts["chart-score-trend"] = new Chart(ctx, {
        type: "line",
        data: { labels: annual.map((p) => String(p.year)), datasets },
        options: withYoyScales({
          scales: {
            x: { ticks: { font: { size: 10 } } },
            y: { min: 0, max: 100, ticks: { font: { size: 10 } } },
          },
        }),
      });
    });
  }

  const SCALE_TREND_LABELS = {
    revenue: "营收",
    net_profit: "归母净利润",
    int_income: "利息收入",
    int_expense: "利息支出",
    total_assets: "总资产",
    loans: "贷款",
    fin_invest_all: "投资证券",
    deposits: "客户存款",
    total_liab: "总负债",
    interbank_liab: "同业往来",
  };
  const STACK_COLORS = ["#2f6fed", "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#d1453b", "#94a3b8", "#ec4899"];

  function scaleSeriesLabel(key) {
    return SCALE_TREND_LABELS[key] || key;
  }

  function scaleChartCard(title, canvasId) {
    return `<div class="chart-card chart-zoomable"><h4>${title}</h4><div class="chart-canvas-box"><canvas id="${canvasId}"></canvas></div></div>`;
  }

  function scaleCaption(text) {
    return text ? `<p class="scale-caption">${escapeHtml(text)}</p>` : "";
  }

  function scaleTable(headers, rows) {
    if (!rows || !rows.length) return "";
    let html = '<div class="scale-table-wrap"><table class="scale-table"><thead><tr>';
    headers.forEach((h) => { html += `<th>${escapeHtml(h)}</th>`; });
    html += "</tr></thead><tbody>";
    rows.forEach((row) => {
      html += "<tr>";
      row.forEach((cell, i) => {
        const text = cell == null ? "—" : String(cell);
        const cls = (typeof cell === "number" && cell < 0) || (typeof cell === "string" && /^-\d/.test(cell))
          ? ' class="neg"' : "";
        const isHead = i === 0;
        html += isHead ? `<th>${escapeHtml(text)}</th>` : `<td${cls}>${escapeHtml(text)}</td>`;
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }

  function fmtYi(v) {
    if (isNA(v)) return "—";
    return fmtNumber(v, 1);
  }

  function fmtShare(v) {
    if (isNA(v)) return "—";
    return `${fmtNumber(v, 1)}%`;
  }

  function bindLineChart(canvasId, trend) {
    if (!trend || !el(canvasId)) return;
    lazyChart(canvasId, () => {
      destroyChart(canvasId);
      const keys = Object.keys(trend).filter((k) => k !== "dates");
      const dates = trend.dates || [];
      const datasets = [];
      keys.forEach((k, i) => {
        const color = STACK_COLORS[i % STACK_COLORS.length];
        datasets.push({
          type: "line",
          label: scaleSeriesLabel(k),
          data: trend[k],
          borderColor: color,
          backgroundColor: color,
          tension: 0.25, pointRadius: 2, spanGaps: true,
          yAxisID: "y",
          order: 0,
        });
        const yoy = computeDatedYoy(trend[k], dates);
        if (yoy.some((v) => !isNA(v))) {
          datasets.push(yoyBarDataset(scaleSeriesLabel(k), yoy, color));
        }
      });
      state.charts[canvasId] = new Chart(
        el(canvasId).getContext("2d"),
        {
          type: "line",
          data: { labels: dates.map((x) => String(x).slice(0, 4)), datasets },
          options: withYoyScales({
            scales: {
              x: {
                ticks: { font: { size: 10 }, maxRotation: 0, minRotation: 0, autoSkip: true, maxTicksLimit: 12 },
              },
            },
          }),
        }
      );
    });
  }

  function bindStackChart(canvasId, st) {
    if (!st || !el(canvasId)) return;
    lazyChart(canvasId, () => {
      destroyChart(canvasId);
      const keys = Object.keys(st).filter((k) => k !== "dates");
      const datasets = keys.map((k, i) => ({
        label: k, data: st[k],
        backgroundColor: STACK_COLORS[i % STACK_COLORS.length] + "cc",
        borderColor: STACK_COLORS[i % STACK_COLORS.length],
        fill: true, tension: 0.25, pointRadius: 0, spanGaps: true,
      }));
      state.charts[canvasId] = new Chart(
        el(canvasId).getContext("2d"),
        {
          type: "line",
          data: { labels: st.dates.map((x) => x.slice(0, 4)), datasets },
          options: baseChartOptions({
            scales: {
              x: {
                stacked: true,
                ticks: { font: { size: 10 }, maxRotation: 0, minRotation: 0, autoSkip: true, maxTicksLimit: 12 },
              },
              y: { stacked: true, ticks: { font: { size: 10 } } },
            },
          }),
        }
      );
    });
  }

  function bindPieChart(canvasId, pie) {
    if (!pie || !pie.length || !el(canvasId)) return;
    lazyChart(canvasId, () => {
      destroyChart(canvasId);
      state.charts[canvasId] = new Chart(
        el(canvasId).getContext("2d"),
        {
          type: "doughnut",
          data: {
            labels: pie.map((x) => x.label),
            datasets: [{
              data: pie.map((x) => x.value),
              backgroundColor: STACK_COLORS,
              borderWidth: 1,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            layout: { padding: { top: 6, bottom: 6, left: 4, right: 4 } },
            plugins: {
              legend: {
                position: pie.length > 5 ? "bottom" : "right",
                labels: { boxWidth: 12, font: { size: 11 }, padding: 10 },
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                    const pct = total ? (ctx.parsed / total * 100).toFixed(1) : 0;
                    return ` ${ctx.label}: ${fmtNumber(ctx.parsed, 1)}亿 (${pct}%)`;
                  },
                },
              },
            },
          },
        }
      );
    });
  }

  function renderScale() {
    collapseChartZoom();
    const container = el("scale-content");
    const d = state.primaryData;
    if (!d || !d.scale) {
      container.innerHTML = '<p class="placeholder">该银行暂无规模数据。</p>';
      return;
    }
    const s = d.scale;
    const profit = s.profit || {};
    const dateLabel = profit.pie_date || "—";
    let html = "";

    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">盈利规模及构成</h3>';
    html += '<div class="scale-grid">';
    html += scaleChartCard("20年趋势（亿元，右轴同比）", "chart-scale-trend-profit");
    html += scaleChartCard("营收构成（堆叠，亿元）", "chart-scale-stack-profit");
    html += scaleChartCard(`最新年报构成（${dateLabel}）`, "chart-scale-pie-profit");
    html += "</div></div>";

    const inc = profit.int_income || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">利息收入构成</h3>';
    html += scaleCaption(inc.note);
    html += '<div class="scale-grid">';
    if (inc.stack) html += scaleChartCard("利息收入拆项（堆叠，亿元）", "chart-scale-stack-intinc");
    if (inc.pie && inc.pie.length) html += scaleChartCard(`最新年报利息收入（${dateLabel}）`, "chart-scale-pie-intinc");
    html += "</div>";
    if (inc.items && inc.items.length) {
      html += scaleTable(
        ["项目", "金额（亿元）", "占利息收入"],
        inc.items.filter((x) => !x.note).map((x) => [x.label, fmtYi(x.value), fmtShare(x.share)])
      );
    }
    html += "</div>";

    const exp = profit.int_expense || {};
    const dep = (exp.deposit) || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">利息支出与存款结构</h3>';
    html += scaleCaption(exp.note);
    html += '<div class="scale-grid">';
    if (exp.stack) html += scaleChartCard("利息支出拆项（堆叠，亿元）", "chart-scale-stack-intexp");
    if (exp.pie && exp.pie.length) html += scaleChartCard(`最新年报利息支出（${dateLabel}）`, "chart-scale-pie-intexp");
    if (dep.pie_four && dep.pie_four.length >= 3) {
      html += scaleChartCard(`客户存款余额四分（${dateLabel}）`, "chart-scale-pie-dep4");
    } else {
      if (dep.pie_customer && dep.pie_customer.length) {
        html += scaleChartCard(`公司 / 零售存款（${dateLabel}）`, "chart-scale-pie-depcust");
      }
      if (dep.pie_tenor && dep.pie_tenor.length) {
        html += scaleChartCard(`活期 / 定期存款（${dateLabel}）`, "chart-scale-pie-deptenor");
      }
    }
    html += "</div>";
    if (dep.items && dep.items.length) {
      const hasInt = dep.items.some((x) => x.interest != null);
      const headers = hasInt
        ? ["项目", "存款余额（亿元）", "占客户存款", "利息支出（亿元）", "占利息支出"]
        : ["项目", "存款余额（亿元）", "占比"];
      html += scaleTable(headers, dep.items.map((x) => {
        const row = [x.label, fmtYi(x.balance), fmtShare(x.balance_share)];
        if (hasInt) {
          row.push(fmtYi(x.interest), fmtShare(x.interest_share));
        }
        return row;
      }));
    }
    if (exp.items && exp.items.length) {
      if (exp.items.length > 1) {
        html += '<p class="scale-caption">利息支出全部分项（含同业、债券、向央行借款）</p>';
      }
      html += scaleTable(
        ["项目", "利息支出（亿元）", "占利息支出"],
        exp.items.map((x) => [x.label, fmtYi(x.value), fmtShare(x.share)])
      );
    }
    html += "</div>";

    const ni = profit.nonint || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">非利息净收入构成</h3>';
    html += scaleCaption(ni.note);
    html += '<div class="scale-grid">';
    if (ni.stack) html += scaleChartCard("非息净收入拆项（堆叠，亿元）", "chart-scale-stack-nonint");
    if (ni.pie && ni.pie.length) html += scaleChartCard(`最新年报非息净收入（${dateLabel}）`, "chart-scale-pie-nonint");
    html += "</div>";
    if (ni.items && ni.items.length) {
      html += scaleTable(
        ["项目", "金额（亿元）", "占非息净收入"],
        ni.items.map((x) => [x.label, fmtYi(x.value), x.note ? "—" : fmtShare(x.share)])
      );
    }
    html += "</div>";

    function itemsTable(items, amt, share) {
      if (!items || !items.length) return "";
      return scaleTable(
        ["项目", amt, share],
        items.map((x) => [x.label, fmtYi(x.value), fmtShare(x.share)])
      );
    }

    const assets = s.assets || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">资产规模及构成</h3>';
    html += scaleCaption(assets.note);
    html += '<div class="scale-grid">';
    html += scaleChartCard("20年趋势（亿元，右轴同比）", "chart-scale-trend-assets");
    html += scaleChartCard("资产构成（堆叠，亿元）", "chart-scale-stack-assets");
    html += scaleChartCard(`最新年报资产构成（${assets.pie_date || "—"}）`, "chart-scale-pie-assets");
    html += "</div>";
    html += itemsTable(assets.items, "金额（亿元）", "占总资产");
    html += "</div>";

    const inv = assets.invest || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">投资证券及其他金融资产</h3>';
    html += scaleCaption(inv.note);
    html += '<div class="scale-grid">';
    if (inv.stack) html += scaleChartCard("投资构成（堆叠，亿元）", "chart-scale-stack-invest");
    if (inv.pie && inv.pie.length) html += scaleChartCard(`最新年报投资构成（${assets.pie_date || "—"}）`, "chart-scale-pie-invest");
    html += "</div>";
    html += itemsTable(inv.items, "金额（亿元）", "占投资证券");
    html += "</div>";

    const iba = assets.interbank || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">资产端同业往来</h3>';
    html += scaleCaption(iba.note);
    html += '<div class="scale-grid">';
    if (iba.stack) html += scaleChartCard("同业资产（堆叠，亿元）", "chart-scale-stack-ibas");
    if (iba.pie && iba.pie.length) html += scaleChartCard(`最新年报同业资产（${assets.pie_date || "—"}）`, "chart-scale-pie-ibas");
    html += "</div>";
    html += itemsTable(iba.items, "金额（亿元）", "占同业往来");
    html += "</div>";

    const cash = assets.cash || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">现金、贵金属及存放央行</h3>';
    html += scaleCaption(cash.note);
    html += '<div class="scale-grid">';
    if (cash.stack) html += scaleChartCard("现金及存放央行（堆叠，亿元）", "chart-scale-stack-cash");
    if (cash.pie && cash.pie.length) html += scaleChartCard(`最新年报（${assets.pie_date || "—"}）`, "chart-scale-pie-cash");
    html += "</div>";
    html += itemsTable(cash.items, "金额（亿元）", "占比");
    html += "</div>";

    const aoth = assets.other || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">其他资产主要科目</h3>';
    html += scaleCaption(aoth.note);
    html += '<div class="scale-grid">';
    if (aoth.pie && aoth.pie.length) html += scaleChartCard(`最新年报（${assets.pie_date || "—"}）`, "chart-scale-pie-asother");
    html += "</div>";
    html += itemsTable(aoth.items, "金额（亿元）", "占比");
    html += "</div>";

    const liab = s.liabilities || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">负债规模及构成</h3>';
    html += scaleCaption(liab.note);
    html += '<div class="scale-grid">';
    html += scaleChartCard("20年趋势（亿元，右轴同比）", "chart-scale-trend-liabilities");
    html += scaleChartCard("负债构成（堆叠，亿元）", "chart-scale-stack-liabilities");
    html += scaleChartCard(`最新年报负债构成（${liab.pie_date || "—"}）`, "chart-scale-pie-liabilities");
    html += "</div>";
    html += itemsTable(liab.items, "金额（亿元）", "占总负债");
    html += "</div>";

    const ldep = liab.deposit || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">客户存款结构</h3>';
    html += scaleCaption(ldep.note);
    html += '<div class="scale-grid">';
    if (ldep.stack_four) html += scaleChartCard("存款四分（堆叠，亿元）", "chart-scale-stack-ldep4");
    if (ldep.pie_four && ldep.pie_four.length >= 3) {
      html += scaleChartCard(`公司/零售 × 活期/定期（${liab.pie_date || "—"}）`, "chart-scale-pie-ldep4");
    } else {
      if (ldep.pie_customer && ldep.pie_customer.length) {
        html += scaleChartCard(`公司 / 零售（${liab.pie_date || "—"}）`, "chart-scale-pie-ldepcust");
      }
      if (ldep.pie_tenor && ldep.pie_tenor.length) {
        html += scaleChartCard(`活期 / 定期（${liab.pie_date || "—"}）`, "chart-scale-pie-ldeptenor");
      }
    }
    html += "</div>";
    html += itemsTable(ldep.items, "金额（亿元）", "占客户存款");
    html += "</div>";

    const ibl = liab.interbank || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">负债端同业往来</h3>';
    html += scaleCaption(ibl.note);
    html += '<div class="scale-grid">';
    if (ibl.stack) html += scaleChartCard("同业负债（堆叠，亿元）", "chart-scale-stack-ibl");
    if (ibl.pie && ibl.pie.length) html += scaleChartCard(`最新年报同业负债（${liab.pie_date || "—"}）`, "chart-scale-pie-ibl");
    html += "</div>";
    html += itemsTable(ibl.items, "金额（亿元）", "占同业往来");
    html += "</div>";

    const trd = liab.trading || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">交易性金融负债及衍生金融负债</h3>';
    html += scaleCaption(trd.note);
    html += '<div class="scale-grid">';
    if (trd.pie && trd.pie.length) html += scaleChartCard(`最新年报（${liab.pie_date || "—"}）`, "chart-scale-pie-trading");
    html += "</div>";
    html += itemsTable(trd.items, "金额（亿元）", "占比");
    html += "</div>";

    const loth = liab.other || {};
    html += '<div class="scale-block">';
    html += '<h3 class="scale-title">其他负债主要科目</h3>';
    html += scaleCaption(loth.note);
    html += itemsTable(loth.items, "金额（亿元）", "占比");
    html += "</div>";

    container.innerHTML = html;

    bindChartZoomAll(container);

    bindLineChart("chart-scale-trend-profit", profit.trend);
    bindStackChart("chart-scale-stack-profit", profit.stack);
    bindPieChart("chart-scale-pie-profit", profit.pie);
    bindStackChart("chart-scale-stack-intinc", inc.stack);
    bindPieChart("chart-scale-pie-intinc", inc.pie);
    bindStackChart("chart-scale-stack-intexp", exp.stack);
    bindPieChart("chart-scale-pie-intexp", exp.pie);
    bindPieChart("chart-scale-pie-dep4", dep.pie_four);
    bindPieChart("chart-scale-pie-depcust", dep.pie_customer);
    bindPieChart("chart-scale-pie-deptenor", dep.pie_tenor);
    bindStackChart("chart-scale-stack-nonint", ni.stack);
    bindPieChart("chart-scale-pie-nonint", ni.pie);

    bindLineChart("chart-scale-trend-assets", assets.trend);
    bindStackChart("chart-scale-stack-assets", assets.stack);
    bindPieChart("chart-scale-pie-assets", assets.pie);
    bindStackChart("chart-scale-stack-invest", inv.stack);
    bindPieChart("chart-scale-pie-invest", inv.pie);
    bindStackChart("chart-scale-stack-ibas", iba.stack);
    bindPieChart("chart-scale-pie-ibas", iba.pie);
    bindStackChart("chart-scale-stack-cash", cash.stack);
    bindPieChart("chart-scale-pie-cash", cash.pie);
    bindPieChart("chart-scale-pie-asother", aoth.pie);

    bindLineChart("chart-scale-trend-liabilities", liab.trend);
    bindStackChart("chart-scale-stack-liabilities", liab.stack);
    bindPieChart("chart-scale-pie-liabilities", liab.pie);
    bindStackChart("chart-scale-stack-ldep4", ldep.stack_four);
    bindPieChart("chart-scale-pie-ldep4", ldep.pie_four);
    bindPieChart("chart-scale-pie-ldepcust", ldep.pie_customer);
    bindPieChart("chart-scale-pie-ldeptenor", ldep.pie_tenor);
    bindStackChart("chart-scale-stack-ibl", ibl.stack);
    bindPieChart("chart-scale-pie-ibl", ibl.pie);
    bindPieChart("chart-scale-pie-trading", trd.pie);
  }

  // ---------- ③-⑧ 六维指标模块 ----------
  const DIM_META = {
    A: { items: ["A1", "A2"] },
    B: { items: ["B1", "B2"] },
    C: { items: ["C1", "C2", "C3", "C4", "C5"] },
    D: { items: ["D1", "D2", "D3", "D4", "D5"] },
    E: { items: ["E1", "E2", "E3"] },
    F: { items: ["F1", "F2", "F3", "F4"] },
    G: { items: ["G1", "G2"] },
  };

  function filterIndicatorSeries(series) {
    // 按粒度过滤 + 时间范围（series 升序，取尾部）
    let out = series;
    if (state.granularity === "year") {
      out = out.filter((x) => x.d.slice(5, 7) === "12");
    }
    if (state.range !== "all") {
      const n = parseInt(state.range, 10);
      out = out.slice(-n);
    }
    return out;
  }

  function renderDimModules() {
    const d = state.primaryData;
    if (!d || !d.indicators || !d.indicators.items) return;
    const cmp = state.compareData;
    const cmpItemById = {};
    if (cmp && cmp.indicators && cmp.indicators.items) {
      cmp.indicators.items.forEach((it) => { cmpItemById[it.id] = it; });
    }

    Object.keys(DIM_META).forEach((dim) => {
      const noteEl = el(`dim-note-${dim}`);
      const container = el(`dim-content-${dim}`);
      if (noteEl && d.score) {
        const period = d.score.periods.find((p) => p.report_date === state.scorePeriod);
        if (period && period.dimensions && period.dimensions[dim]) {
          const dv = period.dimensions[dim];
          const extra = dim === "G" ? " · 不计入总分" : "";
          noteEl.textContent = `${dv.score}/${dv.full}分（${state.scorePeriod ? state.scorePeriod.slice(0, 4) + "A" : ""}）${extra}`;
        }
      }
      if (!container) return;

      let html = '<div class="indicator-list">';
      DIM_META[dim].items.forEach((itemId) => {
        const it = d.indicators.items.find((x) => x.id === itemId);
        if (!it) return;
        const help = (ITEM_META[itemId] && ITEM_META[itemId].help) || null;
        html += `<div class="indicator-item" id="ind-${itemId}">`;
        html += `<div class="indicator-head"><span class="ind-id">${itemId}</span><span class="ind-name">${escapeHtml(it.label)}${help ? helpBtnHtml(help.title, help.body) : ""}</span>`;
        html += `<span class="ind-full">${it.full}分制</span></div>`;
        html += `<div class="chart-card ind-chart"><canvas id="chart-ind-${itemId}"></canvas></div>`;
        html += `<details class="research-disclosure indicator-history"><summary>历史数据 · ${state.granularity === "year" ? "年度" : "季度"}</summary><div class="table-scroll ind-table"><table class="metric-table" id="table-ind-${itemId}"></table></div></details>`;
        html += '</div>';
      });
      html += '</div>';
      container.innerHTML = html;
      if (dim === "G") {
        container.insertAdjacentHTML("afterbegin", renderDdmPanelHtml());
      }

      // 渲染每项的图表+表格
      DIM_META[dim].items.forEach((itemId) => {
        const it = d.indicators.items.find((x) => x.id === itemId);
        if (!it) return;
        renderIndicatorItem(it, cmpItemById[itemId]);
      });
    });
  }

  function fmtDdm(v, digits, suffix) {
    if (isNA(v)) return "NA";
    if (typeof v === "string") return escapeHtml(v);
    return Number(v).toLocaleString("zh-CN", {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }) + (suffix || "");
  }

  function ddmByName(name) {
    if (!name || !state.dashboardData) return null;
    const b = (state.dashboardData.banks || []).find((x) => x.name === name);
    return b && b.ddm ? b.ddm : null;
  }

  function renderDdmPanelHtml() {
    const p = ddmByName(state.primaryData && state.primaryData.name);
    const c = ddmByName(state.compareData && state.compareData.name);
    if (!p) return "";
    const meta = state.dashboardData.ddm_meta || {};
    const rows = [
      ["报告期", p.report_period, c && c.report_period, "数据对应的年报。"],
      ["COE / g", `${fmtDdm(p.coe * 100, 1, "%")} / ${fmtDdm(p.g * 100, 0, "%")}`, c ? `${fmtDdm(c.coe * 100, 1, "%")} / ${fmtDdm(c.g * 100, 0, "%")}` : null, "COE是股东要求回报（不是贷款利率）；g是终值增长率，本表统一3%。"],
      ["全年DPS", fmtDdm(p.dps, 3, " 元"), c ? fmtDdm(c.dps, 3, " 元") : null, "这一年每股现金分红合计（中期+末期）。"],
      ["分红率", fmtDdm(p.payout, 1, "%"), c ? fmtDdm(c.payout, 1, "%") : null, "净利润里拿出来分红的比例。30%表示赚1元分0.3元。"],
      ["最新价", fmtDdm(p.close, 2, " 元"), c ? fmtDdm(c.close, 2, " 元") : null, "iFind 最新未复权收盘价，日期见下方备注。"],
      ["现价PB", fmtDdm(p.pb, 2, "x"), c ? fmtDdm(c.pb, 2, "x") : null, "最新价 ÷ 年报每股净资产。"],
      ["合理PB（PB-ROE）", fmtDdm(p.pb_steady, 2, "x"), c ? fmtDdm(c.pb_steady, 2, "x") : null, "公式：(ROE−3%)/(COE−3%)。1元净资产按这套长期假设该卖几元。不是目标价。"],
      ["RIM值", fmtDdm(p.ddm_steady, 2, " 元"), c ? fmtDdm(c.ddm_steady, 2, " 元") : null, "合理PB × 每股净资产。等于稳态DDM：账面本金加未来超额利润折现。"],
      ["股息率", fmtDdm(p.div_yield, 2, "%"), c ? fmtDdm(c.div_yield, 2, "%") : null, "全年DPS ÷ 最新价。按现在的股价，一年分红大约能拿回百分之几。"],
      ["现行 DDM", fmtDdm(p.ddm_policy, 2, " 元"), c ? fmtDdm(c.ddm_policy, 2, " 元") : null, "按现在这个分红水平一直分下去，折到今天每股值多少钱。不是现价，也不是投资建议。"],
      ["现行 / 现价", fmtDdm(p.policy_vs_price, 1, "%"), c ? fmtDdm(c.policy_vs_price, 1, "%") : null, "现行DDM相对最新价高或低了多少。正数=模型价更高，负数=模型价更低。不是上涨空间。"],
      ["稳态 PB / 价", `${fmtDdm(p.pb_steady, 2)}x / ${fmtDdm(p.ddm_steady, 2)} 元`, c ? `${fmtDdm(c.pb_steady, 2)}x / ${fmtDdm(c.ddm_steady, 2)} 元` : null, "以后分红率提高到刚好支撑3%增长后，1元净资产该卖几元，以及对应每股价值。"],
      ["稳态 / 现价", fmtDdm(p.steady_vs_price, 1, "%"), c ? fmtDdm(c.steady_vs_price, 1, "%") : null, "稳态DDM相对最新价高或低了多少。不代表一定会涨这么多。"],
      ["角色", p.role, c && c.role, "主交叉=分红够稳，可和DDM一起看；仅辅助=分红偏低，应主看PB-ROE。"],
    ];
    let html = '<div class="ddm-panel">';
    html += '<div class="ddm-panel-title">Gordon DDM（统一假设，不是实时目标价）</div>';
    const pxDate = p.price_date || meta.price_date || "";
    html += `<div class="ddm-panel-note">终值 g=${meta.g != null ? (meta.g * 100) : 3}%；COE 按银行类型分档；价格为最新收盘价（${escapeHtml(pxDate)}）。股息率=全年DPS÷该价格。现行=按现在分红一直分；稳态=与合理 PB 同一公式。</div>`;
    html += '<div class="table-scroll"><table class="metric-table ddm-table"><thead><tr><th>项目</th><th>主标的</th>';
    if (c) html += "<th>对比标的</th>";
    html += "</tr></thead><tbody>";
    rows.forEach((row) => {
      const help = row[3]
        ? `<button type="button" class="col-help-btn" aria-expanded="false" aria-label="${escapeHtml(row[0])}的含义" data-help-title="${escapeHtml(row[0])}" data-help-body="${escapeHtml(row[3])}">?</button>`
        : "";
      html += `<tr><td>${escapeHtml(row[0])}${help}</td><td>${row[1] || "NA"}</td>`;
      if (c) html += `<td>${row[2] || "NA"}</td>`;
      html += "</tr>";
    });
    html += "</tbody></table></div></div>";
    return html;
  }

  function renderIndicatorItem(it, cmpIt) {
    const series = filterIndicatorSeries(it.series);
    const cmpSeries = cmpIt ? filterIndicatorSeries(cmpIt.series) : null;
    const dates = series.map((x) => x.d);
    const labels = dates.map((x) => {
      const y = x.slice(2, 4);
      const md = x.slice(5, 7);
      const q = { "03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4" }[md] || md;
      return `${y}${q}`;
    });
    const primaryName = state.primaryData ? state.primaryData.name : "主标的";
    const compareName = state.compareData ? state.compareData.name : "对比标的";

    // ---- 曲线图（左轴水平，右轴同比柱）----
    lazyChart(`chart-ind-${it.id}`, () => {
      destroyChart(`chart-ind-${it.id}`);
      const ctx = el(`chart-ind-${it.id}`).getContext("2d");
      const skipYoy = it.id === "F4" || it.unit === "bool";
      const values = series.map((x) => x.v);
      const datasets = [{
        type: "line",
        label: `${primaryName} ${it.label}`,
        data: values,
        borderColor: COLOR_PRIMARY,
        backgroundColor: COLOR_PRIMARY,
        fill: false, tension: 0.25, pointRadius: 2, spanGaps: true,
        yAxisID: "y",
        order: 0,
      }];
      if (!skipYoy) {
        const yoy = yoyFromSeries(it.series, dates);
        if (yoy.some((v) => !isNA(v))) {
          datasets.push(yoyBarDataset(`${primaryName} ${it.label}`, yoy, COLOR_PRIMARY));
        }
      }
      if (cmpSeries) {
        const cmpMap = {};
        cmpSeries.forEach((x) => { cmpMap[x.d] = x.v; });
        const cmpValues = dates.map((dd) => (cmpMap[dd] !== undefined ? cmpMap[dd] : null));
        datasets.push({
          type: "line",
          label: `${compareName} ${it.label}`,
          data: cmpValues,
          borderColor: COLOR_COMPARE,
          borderDash: [5, 4],
          tension: 0.25, pointRadius: 2, spanGaps: true,
          fill: false,
          yAxisID: "y",
          order: 0,
        });
        if (!skipYoy && cmpIt && cmpIt.series) {
          const cmpYoy = yoyFromSeries(cmpIt.series, dates);
          if (cmpYoy.some((v) => !isNA(v))) {
            datasets.push(yoyBarDataset(`${compareName} ${it.label}`, cmpYoy, COLOR_COMPARE));
          }
        }
      }
      // 参考线（满分线/零分线）——排除bool项
      const refLines = [];
      if (it.unit === "%" && it.x1 !== null && it.x1 !== undefined && !it.id.startsWith("F4")) {
        refLines.push({ y: it.x1, label: `满分线 ${it.x1}%`, color: "rgba(16, 185, 129, 0.5)" });
        refLines.push({ y: it.x0, label: `零分线 ${it.x0}%`, color: "rgba(209, 69, 59, 0.5)" });
      }
      const hasRef = refLines.length > 0;
      const chartOpts = skipYoy
        ? baseChartOptions({
            scales: {
              x: { ticks: { font: { size: 9 }, maxRotation: 60, maxTicksLimit: 20 } },
              y: { ticks: { font: { size: 10 } } },
            },
          })
        : withYoyScales({
            scales: {
              x: { ticks: { font: { size: 9 }, maxRotation: 60, maxTicksLimit: 20 } },
              y: { ticks: { font: { size: 10 } } },
            },
          });
      state.charts[`chart-ind-${it.id}`] = new Chart(ctx, {
        type: "line",
        data: { labels, datasets },
        options: chartOpts,
      });
      // 参考线用 annotation 不可用（无插件），改为在数据里追加两个虚线dataset
      if (hasRef) {
        const chart = state.charts[`chart-ind-${it.id}`];
        refLines.forEach((rl) => {
          chart.data.datasets.push({
            type: "line",
            label: rl.label, data: labels.map(() => rl.y),
            borderColor: rl.color, borderWidth: 1, borderDash: [4, 4],
            pointRadius: 0, fill: false,
            yAxisID: "y",
            order: 3,
          });
        });
        chart.update();
      }
    });

    // ---- 数值表（横向：时间列在顶部、倒序最新在左；每行一个银行）----
    const table = el(`table-ind-${it.id}`);
    if (!table) return;
    // 倒序的日期轴（最新在左）
    const datesDesc = series.map((x) => x.d).reverse();
    const cmpMap = {};
    if (cmpSeries) cmpSeries.forEach((x) => { cmpMap[x.d] = x.v; });
    const primaryMap = {};
    series.forEach((x) => { primaryMap[x.d] = x.v; });

    let html = "<thead><tr><th>报告期 →</th>";
    datesDesc.forEach((dd) => {
      const y = dd.slice(2, 4);
      const md = dd.slice(5, 7);
      const q = { "03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4" }[md] || md;
      html += `<th>${y}${q}</th>`;
    });
    html += "</tr></thead><tbody>";

    function bankRow(name, map, rowClass) {
      let r = `<tr class="${rowClass}"><td>${escapeHtml(name)}</td>`;
      datesDesc.forEach((dd) => {
        const v = map[dd];
        r += `<td>${v === undefined || isNA(v) ? '<span class="na">NA</span>' : fmtNumber(v, it.digits)}</td>`;
      });
      return r + "</tr>";
    }

    html += bankRow(primaryName, primaryMap, "row-primary");
    if (cmpSeries) html += bankRow(compareName, cmpMap, "row-compare");
    html += "</tbody>";
    table.innerHTML = html;
  }

  // ---------- ⑨ 定性分析 ----------
  function renderQual() {
    const container = el("qual-content");
    const d = state.primaryData;
    let html = "";

    html += '<div class="qual-note"><p><strong>H 定性观测（-5 ~ +5）</strong>：对标监管评级中权重最高的公司治理与管理质量。有书面证据的银行给出观测值（2022A 起），<strong>不计入六维总分</strong>。每 ±1 分须挂书面证据，子项加总截断至 [-5, +5]。</p>';
    if (d && d.score) {
      const gp = (d.score.periods || []).find((p) => p.report_date === state.scorePeriod) || (d.score.periods || []).filter((p) => p.total != null).slice(-1)[0];
      if (gp && gp.g != null) {
        html += `<p>本期 H 观测 = <strong>${Number(gp.g) > 0 ? "+" : ""}${fmtNumber(gp.g, 1)}</strong>（不计入总分）。</p>`;
      }
    }
    html += "</div>";

    // H 框架表
    html += '<div class="table-scroll"><table class="metric-table"><thead><tr><th>子项</th><th>名称</th><th>区间</th><th>观察点与评分规则</th></tr></thead><tbody>';
    H_FRAMEWORK.forEach((g) => {
      html += `<tr><td>${g.id}</td><td>${escapeHtml(g.name)}</td><td>${g.range}</td><td class="qual-points">${escapeHtml(g.points)}</td></tr>`;
    });
    html += '</tbody></table></div>';

    // 四维评价（来自深度采集）
    if (d && state.bankNameByCode[d.name] && state.bankNameByCode[d.name].deep_metrics) {
      const dm = state.bankNameByCode[d.name].deep_metrics;
      html += '<h3 class="qual-sub">四维评价（AkShare深度采集，' + escapeHtml(dm.report_period || "") + '）</h3>';
      html += '<div class="deep-eval-grid">';
      DEEP_EVAL_KEYS.forEach((e) => {
        const text = dm.evaluations ? (dm.evaluations[e.key] || "") : "";
        html += '<div class="deep-eval-card">';
        html += `<div class="deep-eval-title">${escapeHtml(e.label)}</div>`;
        html += `<div class="deep-eval-item primary"><span class="deep-eval-text">${escapeHtml(text)}</span></div>`;
        html += '</div>';
      });
      html += '</div>';
      if (dm.not_available_from_akshare && dm.not_available_from_akshare.length) {
        html += '<div class="deep-gaps"><div class="deep-gaps-title">AkShare 数据缺口（需从年报附注获取）：</div><ul>';
        dm.not_available_from_akshare.forEach((item) => { html += '<li>' + escapeHtml(item) + '</li>'; });
        html += '</ul></div>';
      }
    }

    // 深度研究文档指引
    if (d) {
      html += `<div class="qual-doc"><p>深度研究文档：<code>05_知识库/03_银行库/${escapeHtml(d.name)} 深度研究.md</code>（H项打分卡存于该文档，修订记入判断变更日志）</p></div>`;
    }

    container.innerHTML = html;
  }

  // ---------- 总渲染入口 ----------
  function renderAll() {
    destroyAllCharts();
    if (!state.primaryData) return;
    renderPnl();
    renderOverview();
    renderScale();
    renderDimModules();
    renderQual();
    applyGroupLayout();
    el("stock-score-date").textContent = "打分报告期：" + (state.scorePeriod || "暂无");
  }

  // ---------- 初始化 ----------
  function init() {
    const params = getQueryParams();
    state.primaryCode = params.get("code") || null;
    state.compareCode = params.get("compare") || null;
    state.scorePeriod = params.get("period") || null;

    loadIndex()
      .then(() => loadDashboardData())
      .then(() => {
        if (!state.index.some(b => b.code === state.primaryCode)) {
          state.primaryCode = state.index[0]?.code || null;
        }
        populateSelectors();
        setupGroupNav();

        el("load-error").classList.add("hidden");
        el("main-content").classList.remove("hidden");

        const tasks = [refreshPrimary()];
        if (state.compareCode) tasks.push(refreshCompare());
        return Promise.all(tasks);
      })
      .catch((err) => {
        console.error("加载索引失败：", err);
        el("load-error").classList.remove("hidden");
        el("main-content").classList.add("hidden");
      });
  }

  init();
})();
