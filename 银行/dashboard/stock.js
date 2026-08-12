// 个股数据分析对比页面 - 前端逻辑
// 数据来源：dashboard/stock_data/_index.json + dashboard/stock_data/<code>.json
// （由 scripts/generate_stock_detail_data.py 生成）

(function () {
  "use strict";

  const COLOR_PRIMARY = "#2f6fed";
  const COLOR_COMPARE = "#d1453b";
  const COLOR_PRIMARY_SOFT = "rgba(47, 111, 237, 0.15)";
  const COLOR_COMPARE_SOFT = "rgba(209, 69, 59, 0.15)";

  const state = {
    index: [],
    primaryCode: null,
    compareCode: null,
    primaryData: null,
    compareData: null,
    granularity: "quarter", // 'quarter' | 'year'
    range: "20", // '20' | '40' | 'all'
    charts: {},
  };

  function el(id) {
    return document.getElementById(id);
  }

  function isNA(v) {
    return v === null || v === undefined || v === "" || Number.isNaN(v);
  }

  function fmtNumber(v, digits) {
    if (isNA(v)) return null;
    return Number(v).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
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

  // ---------- URL 参数 ----------

  function getQueryParams() {
    return new URLSearchParams(window.location.search);
  }

  function updateQueryParams() {
    const params = new URLSearchParams();
    if (state.primaryCode) params.set("code", state.primaryCode);
    if (state.compareCode) params.set("compare", state.compareCode);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }

  // ---------- 数据加载 ----------

  function loadIndex() {
    return fetch("./stock_data/_index.json")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        state.index = data.banks || [];
        el("generated-at").textContent =
          "数据生成时间：" + (data.generated_at || "未知");
      });
  }

  function loadBankData(code) {
    if (!code) return Promise.resolve(null);
    return fetch(`./stock_data/${code}.json`).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  // ---------- 选择器 ----------

  function populateSelectors() {
    const primarySelect = el("primary-select");
    const compareSelect = el("compare-select");

    primarySelect.innerHTML = "";
    state.index.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.code;
      opt.textContent = `${b.name}（${b.code}）`;
      primarySelect.appendChild(opt);
    });

    compareSelect.innerHTML = '<option value="">无对比</option>';
    state.index.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.code;
      opt.textContent = `${b.name}（${b.code}）`;
      compareSelect.appendChild(opt);
    });

    primarySelect.value = state.primaryCode || "";
    compareSelect.value = state.compareCode || "";

    primarySelect.addEventListener("change", () => {
      state.primaryCode = primarySelect.value || null;
      updateQueryParams();
      refreshPrimary();
    });

    compareSelect.addEventListener("change", () => {
      state.compareCode = compareSelect.value || null;
      updateQueryParams();
      refreshCompare();
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

  function refreshPrimary() {
    return loadBankData(state.primaryCode)
      .then((data) => {
        state.primaryData = data;
        el("page-title").textContent = data
          ? `${data.name}（${data.code}） 数据分析`
          : "个股数据分析对比";
        renderAll();
      })
      .catch((err) => {
        console.error("加载主标的数据失败：", err);
      });
  }

  function refreshCompare() {
    if (!state.compareCode) {
      state.compareData = null;
      renderAll();
      return Promise.resolve();
    }
    return loadBankData(state.compareCode)
      .then((data) => {
        state.compareData = data;
        renderAll();
      })
      .catch((err) => {
        console.error("加载对比标的数据失败：", err);
      });
  }

  // ---------- 分组导航（锚点高亮 + 平滑滚动） ----------

  function setupGroupNav() {
    document.querySelectorAll(".group-nav-item").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        document
          .querySelectorAll(".group-nav-item")
          .forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        const target = document.getElementById(link.dataset.group);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  // ---------- 记录筛选：按粒度 + 时间范围 ----------

  function filterRecords(records) {
    if (!records) return [];
    let filtered = records;
    if (state.granularity === "year") {
      filtered = filtered.filter((r) => r.quarter === 4);
    }
    if (state.range !== "all") {
      const n = parseInt(state.range, 10);
      filtered = filtered.slice(-n);
    }
    return filtered;
  }

  // 把主标的和对比标的的报告期对齐成一个统一的时间轴（并集，按日期升序）
  function unionReportDates(primaryRecords, compareRecords) {
    const set = new Set();
    primaryRecords.forEach((r) => set.add(r.report_date));
    (compareRecords || []).forEach((r) => set.add(r.report_date));
    return Array.from(set).sort();
  }

  function recordByDate(records) {
    const map = {};
    (records || []).forEach((r) => {
      map[r.report_date] = r;
    });
    return map;
  }

  function formatReportLabel(date) {
    // '2025-12-31' -> '25Q4'；季度未知时原样返回
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return date;
    const year = m[1].slice(2);
    const monthDay = `${m[2]}-${m[3]}`;
    const quarterMap = {
      "03-31": "Q1",
      "06-30": "Q2",
      "09-30": "Q3",
      "12-31": "Q4",
    };
    const q = quarterMap[monthDay];
    return q ? `${year}${q}` : date;
  }

  // ---------- 表格渲染 ----------

  const TABLE_DEFS = {
    "table-profit": [
      { key: "revenue_q", label: "营业总收入（单季度，亿）", digits: 2, yoyKey: "revenue_q_yoy" },
      { key: "net_profit_q", label: "归母净利润（单季度，亿）", digits: 2, yoyKey: "net_profit_q_yoy" },
      { key: "revenue_cum", label: "营业总收入（累计，亿）", digits: 2, yoyKey: "revenue_cum_yoy" },
      { key: "net_profit_cum", label: "归母净利润（累计，亿）", digits: 2, yoyKey: "net_profit_cum_yoy" },
      { key: "roe", label: "ROE（加权，%）", digits: 2, isPercent: true },
      { key: "net_margin", label: "销售净利率（%）", digits: 2, isPercent: true },
    ],
    "table-balance": [
      { key: "total_assets", label: "总资产（亿）", digits: 2, yoyKey: "total_assets_yoy" },
      { key: "loans", label: "发放贷款及垫款（亿）", digits: 2, yoyKey: "loans_yoy" },
      { key: "deposits", label: "吸收存款（亿）", digits: 2, yoyKey: "deposits_yoy" },
      { key: "net_assets_attr", label: "归母净资产（亿）", digits: 2, yoyKey: "net_assets_attr_yoy" },
    ],
    "table-pershare": [
      { key: "eps", label: "基本每股收益（元）", digits: 4, yoyKey: "eps_yoy" },
      { key: "bvps", label: "每股净资产（元）", digits: 2, yoyKey: "bvps_yoy" },
      { key: "capital_reserve_ps", label: "每股资本公积金（元）", digits: 4 },
      { key: "retained_earnings_ps", label: "每股未分配利润（元）", digits: 2 },
      { key: "operating_cf_ps", label: "每股经营现金流（元）", digits: 2 },
    ],
    "table-valuation": [
      { key: "close", label: "收盘价（元）", digits: 2 },
      { key: "market_cap_yi", label: "总市值（亿）", digits: 2 },
      { key: "pe_ttm", label: "PE(TTM)", digits: 2 },
      { key: "pb", label: "市净率 PB", digits: 2 },
      { key: "peg", label: "PEG", digits: 2 },
      { key: "ps", label: "市销率 PS", digits: 2 },
    ],
  };

  function renderTable(tableId, defs, dates, primaryMap, compareMap) {
    const table = el(tableId);
    table.innerHTML = "";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const cornerTh = document.createElement("th");
    cornerTh.textContent = "指标";
    headRow.appendChild(cornerTh);
    dates.forEach((date) => {
      const th = document.createElement("th");
      th.textContent = formatReportLabel(date);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    function buildEntityRows(map, entityLabel, rowClass, badgeClass) {
      if (!map) return;
      defs.forEach((def, idx) => {
        const tr = document.createElement("tr");
        tr.className = rowClass;
        if (idx === defs.length - 1) tr.classList.add("row-separator");

        const labelTd = document.createElement("td");
        labelTd.innerHTML = `${escapeHtml(def.label)}<span class="entity-badge ${badgeClass}">${escapeHtml(
          entityLabel
        )}</span>`;
        tr.appendChild(labelTd);

        dates.forEach((date) => {
          const record = map[date];
          const td = document.createElement("td");
          const rawValue = record ? record[def.key] : null;
          if (isNA(rawValue)) {
            td.className = "na";
            td.textContent = "NA";
          } else {
            const displayValue = def.isPercent ? fmtNumber(rawValue, def.digits) + "%" : fmtNumber(rawValue, def.digits);
            td.textContent = displayValue;
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);

        // 同比行（若定义了 yoyKey）
        if (def.yoyKey) {
          const yoyTr = document.createElement("tr");
          yoyTr.className = "row-yoy";
          if (idx === defs.length - 1) yoyTr.classList.add("row-separator");
          const yoyLabelTd = document.createElement("td");
          yoyLabelTd.textContent = "　同比";
          yoyTr.appendChild(yoyLabelTd);
          dates.forEach((date) => {
            const record = map[date];
            const td = document.createElement("td");
            const yoyValue = record ? record[def.yoyKey] : null;
            if (isNA(yoyValue)) {
              td.className = "na";
              td.textContent = "NA";
            } else {
              td.textContent = fmtPercent(yoyValue);
              td.className = yoyValue >= 0 ? "value-up" : "value-down";
            }
            yoyTr.appendChild(td);
          });
          tbody.appendChild(yoyTr);
        }
      });
    }

    const primaryName = state.primaryData ? state.primaryData.name : "主标的";
    const compareName = state.compareData ? state.compareData.name : "对比标的";

    buildEntityRows(primaryMap, primaryName, "row-primary", "primary");
    if (compareMap) {
      buildEntityRows(compareMap, compareName, "row-compare", "compare");
    }

    table.appendChild(tbody);
  }

  // ---------- 图表渲染 ----------

  function destroyChart(id) {
    if (state.charts[id]) {
      state.charts[id].destroy();
      delete state.charts[id];
    }
  }

  function buildLineDataset(label, dates, map, key, color, dashed) {
    return {
      label,
      data: dates.map((d) => (map[d] ? nullToUndefined(map[d][key]) : undefined)),
      borderColor: color,
      backgroundColor: color,
      borderDash: dashed ? [5, 4] : undefined,
      spanGaps: true,
      tension: 0.25,
      pointRadius: 2,
    };
  }

  function buildBarDataset(label, dates, map, key, color) {
    return {
      label,
      type: "bar",
      data: dates.map((d) => (map[d] ? nullToUndefined(map[d][key]) : undefined)),
      backgroundColor: color,
      borderRadius: 3,
      yAxisID: "y",
    };
  }

  function nullToUndefined(v) {
    return isNA(v) ? undefined : v;
  }

  function baseChartOptions(extra) {
    return Object.assign(
      {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { enabled: true },
        },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { ticks: { font: { size: 10 } } },
        },
      },
      extra || {}
    );
  }

  function renderBarLineChart(canvasId, dates, barConfigs, lineConfigs, yAxisLabel) {
    destroyChart(canvasId);
    const ctx = el(canvasId).getContext("2d");
    const datasets = [];
    barConfigs.forEach((c) => datasets.push(buildBarDataset(c.label, dates, c.map, c.key, c.color)));
    lineConfigs.forEach((c) =>
      datasets.push(
        Object.assign(
          buildLineDataset(c.label, dates, c.map, c.key, c.color, c.dashed),
          { yAxisID: "y1", type: "line" }
        )
      )
    );

    const labels = dates.map(formatReportLabel);
    state.charts[canvasId] = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      options: baseChartOptions({
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { position: "left", title: { display: !!yAxisLabel, text: yAxisLabel, font: { size: 10 } } },
          y1: {
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "同比 %", font: { size: 10 } },
          },
        },
      }),
    });
  }

  function renderLineChart(canvasId, dates, lineConfigs) {
    destroyChart(canvasId);
    const ctx = el(canvasId).getContext("2d");
    const datasets = lineConfigs.map((c) =>
      buildLineDataset(c.label, dates, c.map, c.key, c.color, c.dashed)
    );
    const labels = dates.map(formatReportLabel);
    state.charts[canvasId] = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: baseChartOptions(),
    });
  }

  function renderCharts(dates, primaryMap, compareMap) {
    const primaryName = state.primaryData ? state.primaryData.name : "主标的";
    const compareName = state.compareData ? state.compareData.name : "对比标的";
    const hasCompare = !!compareMap;

    // 营收：单季度柱状图 + 同比折线
    const revenueBars = [{ label: primaryName, map: primaryMap, key: "revenue_q", color: COLOR_PRIMARY_SOFT }];
    const revenueLines = [{ label: `${primaryName} 同比`, map: primaryMap, key: "revenue_q_yoy", color: COLOR_PRIMARY }];
    if (hasCompare) {
      revenueBars.push({ label: compareName, map: compareMap, key: "revenue_q", color: COLOR_COMPARE_SOFT });
      revenueLines.push({ label: `${compareName} 同比`, map: compareMap, key: "revenue_q_yoy", color: COLOR_COMPARE, dashed: true });
    }
    renderBarLineChart("chart-revenue", dates, revenueBars, revenueLines, "亿元");

    // 净利润：单季度柱状图 + 同比折线
    const profitBars = [{ label: primaryName, map: primaryMap, key: "net_profit_q", color: COLOR_PRIMARY_SOFT }];
    const profitLines = [{ label: `${primaryName} 同比`, map: primaryMap, key: "net_profit_q_yoy", color: COLOR_PRIMARY }];
    if (hasCompare) {
      profitBars.push({ label: compareName, map: compareMap, key: "net_profit_q", color: COLOR_COMPARE_SOFT });
      profitLines.push({ label: `${compareName} 同比`, map: compareMap, key: "net_profit_q_yoy", color: COLOR_COMPARE, dashed: true });
    }
    renderBarLineChart("chart-net-profit", dates, profitBars, profitLines, "亿元");

    // ROE 折线
    const roeLines = [{ label: primaryName, map: primaryMap, key: "roe", color: COLOR_PRIMARY }];
    if (hasCompare) roeLines.push({ label: compareName, map: compareMap, key: "roe", color: COLOR_COMPARE, dashed: true });
    renderLineChart("chart-roe", dates, roeLines);

    // 总资产：柱状图 + 同比折线
    const assetBars = [{ label: primaryName, map: primaryMap, key: "total_assets", color: COLOR_PRIMARY_SOFT }];
    const assetLines = [{ label: `${primaryName} 同比`, map: primaryMap, key: "total_assets_yoy", color: COLOR_PRIMARY }];
    if (hasCompare) {
      assetBars.push({ label: compareName, map: compareMap, key: "total_assets", color: COLOR_COMPARE_SOFT });
      assetLines.push({ label: `${compareName} 同比`, map: compareMap, key: "total_assets_yoy", color: COLOR_COMPARE, dashed: true });
    }
    renderBarLineChart("chart-total-assets", dates, assetBars, assetLines, "亿元");

    // 贷款/存款：折线
    const loanDepositLines = [
      { label: `${primaryName} 贷款`, map: primaryMap, key: "loans", color: COLOR_PRIMARY },
      { label: `${primaryName} 存款`, map: primaryMap, key: "deposits", color: COLOR_PRIMARY, dashed: true },
    ];
    if (hasCompare) {
      loanDepositLines.push({ label: `${compareName} 贷款`, map: compareMap, key: "loans", color: COLOR_COMPARE });
      loanDepositLines.push({ label: `${compareName} 存款`, map: compareMap, key: "deposits", color: COLOR_COMPARE, dashed: true });
    }
    renderLineChart("chart-loans-deposits", dates, loanDepositLines);

    // 归母净资产
    const netAssetBars = [{ label: primaryName, map: primaryMap, key: "net_assets_attr", color: COLOR_PRIMARY_SOFT }];
    const netAssetLines = [{ label: `${primaryName} 同比`, map: primaryMap, key: "net_assets_attr_yoy", color: COLOR_PRIMARY }];
    if (hasCompare) {
      netAssetBars.push({ label: compareName, map: compareMap, key: "net_assets_attr", color: COLOR_COMPARE_SOFT });
      netAssetLines.push({ label: `${compareName} 同比`, map: compareMap, key: "net_assets_attr_yoy", color: COLOR_COMPARE, dashed: true });
    }
    renderBarLineChart("chart-net-assets", dates, netAssetBars, netAssetLines, "亿元");

    // 每股指标
    const epsLines = [{ label: primaryName, map: primaryMap, key: "eps", color: COLOR_PRIMARY }];
    if (hasCompare) epsLines.push({ label: compareName, map: compareMap, key: "eps", color: COLOR_COMPARE, dashed: true });
    renderLineChart("chart-eps", dates, epsLines);

    const bvpsLines = [{ label: primaryName, map: primaryMap, key: "bvps", color: COLOR_PRIMARY }];
    if (hasCompare) bvpsLines.push({ label: compareName, map: compareMap, key: "bvps", color: COLOR_COMPARE, dashed: true });
    renderLineChart("chart-bvps", dates, bvpsLines);

    const ocfpsLines = [{ label: primaryName, map: primaryMap, key: "operating_cf_ps", color: COLOR_PRIMARY }];
    if (hasCompare) ocfpsLines.push({ label: compareName, map: compareMap, key: "operating_cf_ps", color: COLOR_COMPARE, dashed: true });
    renderLineChart("chart-ocfps", dates, ocfpsLines);

    // 估值
    const closeLines = [{ label: primaryName, map: primaryMap, key: "close", color: COLOR_PRIMARY }];
    if (hasCompare) closeLines.push({ label: compareName, map: compareMap, key: "close", color: COLOR_COMPARE, dashed: true });
    renderLineChart("chart-close", dates, closeLines);

    const pePbLines = [
      { label: `${primaryName} PE(TTM)`, map: primaryMap, key: "pe_ttm", color: COLOR_PRIMARY },
      { label: `${primaryName} PB`, map: primaryMap, key: "pb", color: COLOR_PRIMARY, dashed: true },
    ];
    if (hasCompare) {
      pePbLines.push({ label: `${compareName} PE(TTM)`, map: compareMap, key: "pe_ttm", color: COLOR_COMPARE });
      pePbLines.push({ label: `${compareName} PB`, map: compareMap, key: "pb", color: COLOR_COMPARE, dashed: true });
    }
    renderLineChart("chart-pe-pb", dates, pePbLines);

    const marketCapLines = [{ label: primaryName, map: primaryMap, key: "market_cap_yi", color: COLOR_PRIMARY }];
    if (hasCompare) marketCapLines.push({ label: compareName, map: compareMap, key: "market_cap_yi", color: COLOR_COMPARE, dashed: true });
    renderLineChart("chart-market-cap", dates, marketCapLines);
  }

  // ---------- 总渲染入口 ----------

  function renderAll() {
    if (!state.primaryData) return;

    const primaryRecords = filterRecords(state.primaryData.records);
    const compareRecords = state.compareData ? filterRecords(state.compareData.records) : null;

    const dates = unionReportDates(primaryRecords, compareRecords);
    const primaryMap = recordByDate(primaryRecords);
    const compareMap = compareRecords ? recordByDate(compareRecords) : null;

    Object.keys(TABLE_DEFS).forEach((tableId) => {
      renderTable(tableId, TABLE_DEFS[tableId], dates, primaryMap, compareMap);
    });

    renderCharts(dates, primaryMap, compareMap);
  }

  // ---------- 初始化 ----------

  function init() {
    const params = getQueryParams();
    state.primaryCode = params.get("code") || null;
    state.compareCode = params.get("compare") || null;

    loadIndex()
      .then(() => {
        if (!state.primaryCode && state.index.length > 0) {
          state.primaryCode = state.index[0].code;
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
