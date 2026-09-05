// 银行研究标的对比仪表盘 - 前端逻辑
// 数据来源：dashboard/data.json（由 scripts/generate_dashboard_data.py 生成）
// 包含 AkShare 深度采集指标（67项）和四维评价

(function () {
  "use strict";

  const OBSIDIAN_VAULT_NAME = "银行";

  const STATUS_LABELS = {
    open: "开放",
    strengthened: "加强",
    weakened: "削弱",
    falsified: "证伪/失效",
    confirmed: "证实",
    unknown: "未知",
  };

  // ---------- 指标列定义 ----------
  // 每组指标的 key 对应 deep_metrics.metrics 中的字段名
  // label 为表头显示文字，fmt 为格式化方式：'yi' 取 value_yi，'pct' 取 value_pct，'raw' 取 raw

  const METRIC_GROUPS = [
    {
      group: "profit",
      groupLabel: "盈利能力",
      cls: "group-profit",
      metrics: [
        { key: "营业收入", label: "营业收入", fmt: "yi" },
        { key: "净利息收入", label: "净利息收入", fmt: "yi" },
        { key: "利息收入", label: "利息收入", fmt: "yi" },
        { key: "利息支出", label: "利息支出", fmt: "yi" },
        { key: "手续费及佣金净收入", label: "中收", fmt: "yi" },
        { key: "投资收益", label: "投资收益", fmt: "yi" },
        { key: "公允价值变动收益", label: "公允价值变动", fmt: "yi" },
        { key: "非息收入", label: "非息收入", fmt: "yi" },
        { key: "业务及管理费", label: "业务管理费", fmt: "yi" },
        { key: "信用减值损失", label: "信用减值", fmt: "yi" },
        { key: "营业利润", label: "营业利润", fmt: "yi" },
        { key: "利润总额", label: "利润总额", fmt: "yi" },
        { key: "净利润", label: "净利润", fmt: "yi" },
        { key: "归母净利润", label: "归母净利润", fmt: "yi" },
        { key: "PPOP", label: "PPOP", fmt: "yi" },
      ],
    },
    {
      group: "growth",
      groupLabel: "增长速度",
      cls: "group-growth",
      metrics: [
        { key: "营业收入增速", label: "营收增速", fmt: "pct" },
        { key: "归母净利润增速", label: "归母净利润增速", fmt: "pct" },
        { key: "净利息收入增速", label: "净利息收入增速", fmt: "pct" },
        { key: "中收增速", label: "中收增速", fmt: "pct" },
        { key: "PPOP增速", label: "PPOP增速", fmt: "pct" },
        { key: "总资产增速", label: "总资产增速", fmt: "pct" },
        { key: "贷款增速", label: "贷款增速", fmt: "pct" },
        { key: "存款增速", label: "存款增速", fmt: "pct" },
        { key: "净资产增速", label: "净资产增速", fmt: "pct" },
      ],
    },
    {
      group: "balance",
      groupLabel: "规模与资产负债",
      cls: "group-balance",
      metrics: [
        { key: "总资产", label: "总资产", fmt: "yi" },
        { key: "贷款总额", label: "贷款总额", fmt: "yi" },
        { key: "贷款损失准备", label: "贷款损失准备", fmt: "yi" },
        { key: "客户存款", label: "客户存款", fmt: "yi" },
        { key: "同业负债", label: "同业负债", fmt: "yi" },
        { key: "应付债券", label: "应付债券", fmt: "yi" },
        { key: "归母净资产", label: "归母净资产", fmt: "yi" },
        { key: "股东权益合计", label: "股东权益合计", fmt: "yi" },
        { key: "负债合计", label: "负债合计", fmt: "yi" },
        { key: "股本", label: "股本", fmt: "yi" },
      ],
    },
    {
      group: "structure",
      groupLabel: "结构与效率",
      cls: "group-structure",
      metrics: [
        { key: "成本收入比(CIR)", label: "CIR", fmt: "pct" },
        { key: "非息收入占比", label: "非息占比", fmt: "pct" },
        { key: "中收占比", label: "中收占比", fmt: "pct" },
        { key: "贷款/总资产", label: "贷款/总资产", fmt: "pct" },
        { key: "存贷比", label: "存贷比", fmt: "pct" },
        { key: "拨贷比", label: "拨贷比", fmt: "pct" },
        { key: "同业负债占比(粗略)", label: "同业负债占比", fmt: "pct" },
        { key: "杠杆倍数", label: "杠杆倍数", fmt: "raw" },
        { key: "资产负债率", label: "资产负债率", fmt: "pct" },
        { key: "ROE(摊薄)", label: "ROE(摊薄)", fmt: "pct" },
        { key: "加权ROE", label: "加权ROE", fmt: "pct" },
        { key: "ROA", label: "ROA", fmt: "pct" },
        { key: "信用成本率", label: "信用成本率", fmt: "pct" },
      ],
    },
    {
      group: "pershare",
      groupLabel: "每股与估值",
      cls: "group-pershare",
      metrics: [
        { key: "EPS", label: "EPS", fmt: "raw" },
        { key: "每股净资产", label: "每股净资产", fmt: "raw" },
        { key: "收盘价", label: "收盘价", fmt: "raw" },
        { key: "总市值", label: "总市值", fmt: "yi" },
        { key: "PB", label: "PB", fmt: "raw" },
        { key: "PE(TTM)", label: "PE(TTM)", fmt: "raw" },
        { key: "PE(静)", label: "PE(静)", fmt: "raw" },
      ],
    },
  ];

  const EVALUATION_KEYS = [
    { key: "盈利能力评价", label: "盈利能力" },
    { key: "资产质量评价", label: "资产质量" },
    { key: "资产风险评价", label: "资产风险" },
    { key: "可持续性评价", label: "可持续性" },
  ];

  const CARD_CORE_METRICS = [
    { key: "加权ROE", label: "ROE" },
    { key: "ROA", label: "ROA" },
    { key: "营业收入增速", label: "营收增速" },
    { key: "归母净利润增速", label: "利润增速" },
  ];

  const CARD_EXTRA_METRICS = [
    { key: "成本收入比(CIR)", label: "CIR" },
    { key: "非息收入占比", label: "非息占比" },
    { key: "中收占比", label: "中收占比" },
    { key: "拨贷比", label: "拨贷比" },
    { key: "信用成本率", label: "信用成本率" },
    { key: "杠杆倍数", label: "杠杆倍数" },
    { key: "PB", label: "PB" },
    { key: "PE(TTM)", label: "PE" },
    { key: "贷款/总资产", label: "贷/资产" },
    { key: "存贷比", label: "存贷比" },
  ];

  const state = {
    banks: [],
    view: "table",
    sortKey: "name",
    sortDir: "asc",
    activeTypes: new Set(),
    activeStatuses: new Set(),
    allTypes: [],
    stockCodeByName: {},
    activeGroups: new Set(["basic", "profit", "growth", "balance", "structure", "pershare", "evaluation"]),
    expandedRows: new Set(),
  };

  function el(id) {
    return document.getElementById(id);
  }

  function isNA(value) {
    return value === null || value === undefined || value === "";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- 深度指标取值 ----------
  function getDeepMetric(bank, metricKey, fmt) {
    const dm = bank.deep_metrics;
    if (!dm || !dm.metrics || !dm.metrics[metricKey]) return null;
    const m = dm.metrics[metricKey];
    if (fmt === "yi") return m.value_yi || null;
    if (fmt === "pct") return m.value_pct || null;
    if (fmt === "raw") {
      if (isNA(m.raw)) return null;
      if (typeof m.raw === "number") {
        return m.raw.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
      }
      return String(m.raw);
    }
    return m.value_yi || m.value_pct || m.raw || null;
  }

  function parseSortableNumber(value) {
    if (isNA(value)) return null;
    const match = String(value).match(/-?[\d,]+(?:\.\d+)?/);
    if (!match) return null;
    return parseFloat(match[0].replace(/,/g, ""));
  }

  function parseSortableDate(value) {
    if (isNA(value)) return null;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }

  // ---------- 数据加载 ----------

  fetch("./data.json")
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((data) => {
      state.banks = data.banks || [];
      state.allTypes = Array.from(
        new Set(state.banks.map((b) => b.type).filter((t) => !isNA(t)))
      ).sort();

      el("generated-at").textContent =
        "数据生成时间：" + (data.generated_at || "未知");
      el("bank-count").textContent =
        "覆盖银行数：" + (data.bank_count ?? state.banks.length);

      el("load-error").classList.add("hidden");
      el("main-content").classList.remove("hidden");

      renderFilterChips();
      renderTableHead();
      renderAll();
    })
    .catch((err) => {
      console.error("加载 data.json 失败：", err);
      el("load-error").classList.remove("hidden");
      el("main-content").classList.add("hidden");
    });

  fetch("./stock_data/_index.json")
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((data) => {
      (data.banks || []).forEach((b) => {
        state.stockCodeByName[b.name] = b.code;
      });
    })
    .catch((err) => {
      console.warn("加载股票代码索引失败（跳转按钮将不可用）：", err);
    });

  // ---------- 筛选器 ----------

  function renderFilterChips() {
    const typeContainer = el("type-filters");
    typeContainer.innerHTML = "";
    state.allTypes.forEach((type) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = type;
      chip.dataset.type = type;
      chip.addEventListener("click", () => {
        toggleSetValue(state.activeTypes, type);
        chip.classList.toggle("active");
        renderAll();
      });
      typeContainer.appendChild(chip);
    });

    const statusContainer = el("status-filters");
    statusContainer.innerHTML = "";
    Object.keys(STATUS_LABELS).forEach((statusKey) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = STATUS_LABELS[statusKey];
      chip.dataset.status = statusKey;
      chip.addEventListener("click", () => {
        toggleSetValue(state.activeStatuses, statusKey);
        chip.classList.toggle("active");
        renderAll();
      });
      statusContainer.appendChild(chip);
    });

    el("reset-filters").addEventListener("click", () => {
      state.activeTypes.clear();
      state.activeStatuses.clear();
      document
        .querySelectorAll(".chip.active")
        .forEach((chip) => chip.classList.remove("active"));
      renderAll();
    });
  }

  function toggleSetValue(set, value) {
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
  }

  function getFilteredBanks() {
    return state.banks.filter((b) => {
      if (state.activeTypes.size > 0 && !state.activeTypes.has(b.type)) {
        return false;
      }
      if (
        state.activeStatuses.size > 0 &&
        !state.activeStatuses.has(b.thesis_status)
      ) {
        return false;
      }
      return true;
    });
  }

  // ---------- 列分组切换 ----------

  document.querySelectorAll(".col-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group;
      if (state.activeGroups.has(group)) {
        state.activeGroups.delete(group);
        btn.classList.remove("active");
      } else {
        state.activeGroups.add(group);
        btn.classList.add("active");
      }
      renderTableHead();
      renderAll();
    });
  });

  el("expand-all-rows").addEventListener("click", () => {
    state.banks.forEach((b) => state.expandedRows.add(b.name));
    renderAll();
  });

  el("collapse-all-rows").addEventListener("click", () => {
    state.expandedRows.clear();
    renderAll();
  });

  // ---------- 视图切换 ----------

  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".view-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.view = btn.dataset.view;
      el("table-view").classList.toggle("hidden", state.view !== "table");
      el("card-view").classList.toggle("hidden", state.view !== "card");
      renderAll();
    });
  });

  // ---------- 排序 ----------

  function getSortValue(bank, key) {
    if (key === "name") return bank.name;
    if (key === "type") return bank.type || "";
    if (key === "thesis_status") return bank.thesis_status || "";
    if (key === "updated") return parseSortableDate(bank.updated);
    // 先尝试 deep_metrics
    for (const grp of METRIC_GROUPS) {
      for (const m of grp.metrics) {
        if (m.key === key) {
          const val = getDeepMetric(bank, key, m.fmt);
          return parseSortableNumber(val);
        }
      }
    }
    // fallback to flat fields
    return parseSortableNumber(bank[key]);
  }

  function sortBanks(banks) {
    const key = state.sortKey;
    const dir = state.sortDir === "asc" ? 1 : -1;
    return [...banks].sort((a, b) => {
      const va = getSortValue(a, key);
      const vb = getSortValue(b, key);
      const aNull = va === null || va === undefined || va === "";
      const bNull = vb === null || vb === undefined || vb === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  // ---------- 渲染 ----------

  function renderAll() {
    const filtered = sortBanks(getFilteredBanks());
    if (state.view === "table") {
      renderTable(filtered);
    } else {
      renderCards(filtered);
    }
  }

  // ---------- 动态表头 ----------

  function renderTableHead() {
    const thead = el("table-head");
    thead.innerHTML = "";

    // Group row
    const groupTr = document.createElement("tr");
    groupTr.className = "group-row";

    if (state.activeGroups.has("basic")) {
      const nameTh = document.createElement("th");
      nameTh.rowSpan = 2;
      nameTh.className = "col-name";
      nameTh.dataset.sort = "name";
      nameTh.textContent = "银行";
      nameTh.addEventListener("click", () => handleSort("name"));
      groupTr.appendChild(nameTh);

      const typeTh = document.createElement("th");
      typeTh.rowSpan = 2;
      typeTh.className = "col-type";
      typeTh.dataset.sort = "type";
      typeTh.textContent = "类型";
      typeTh.addEventListener("click", () => handleSort("type"));
      groupTr.appendChild(typeTh);

      const statusTh = document.createElement("th");
      statusTh.rowSpan = 2;
      statusTh.className = "group-header group-status";
      statusTh.dataset.sort = "thesis_status";
      statusTh.textContent = "命题";
      statusTh.addEventListener("click", () => handleSort("thesis_status"));
      groupTr.appendChild(statusTh);
    }

    let hasMetricGroup = false;
    METRIC_GROUPS.forEach((grp) => {
      if (!state.activeGroups.has(grp.group)) return;
      hasMetricGroup = true;
      const th = document.createElement("th");
      th.colSpan = grp.metrics.length;
      th.className = "group-header " + grp.cls;
      th.textContent = grp.groupLabel;
      groupTr.appendChild(th);
    });

    if (state.activeGroups.has("evaluation")) {
      const evalTh = document.createElement("th");
      evalTh.rowSpan = 2;
      evalTh.className = "group-header group-evaluation";
      evalTh.textContent = "四维评价";
      groupTr.appendChild(evalTh);
    }

    thead.appendChild(groupTr);

    // Metric row
    const metricTr = document.createElement("tr");
    metricTr.className = "metric-row";

    METRIC_GROUPS.forEach((grp) => {
      if (!state.activeGroups.has(grp.group)) return;
      grp.metrics.forEach((m) => {
        const th = document.createElement("th");
        th.dataset.sort = m.key;
        th.textContent = m.label;
        th.addEventListener("click", () => handleSort(m.key));
        metricTr.appendChild(th);
      });
    });

    thead.appendChild(metricTr);
  }

  function handleSort(key) {
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = "asc";
    }
    renderAll();
  }

  function renderTable(banks) {
    const tbody = el("table-body");
    tbody.innerHTML = "";

    banks.forEach((bank) => {
      const tr = document.createElement("tr");

      if (state.activeGroups.has("basic")) {
        const nameTd = document.createElement("td");
        nameTd.className = "col-name";
        const nameLink = document.createElement("span");
        nameLink.className = "bank-name-link";
        nameLink.textContent = bank.name;
        nameLink.addEventListener("click", () => openDetail(bank));
        nameTd.appendChild(nameLink);
        tr.appendChild(nameTd);

        const typeTd = document.createElement("td");
        typeTd.innerHTML = isNA(bank.type)
          ? '<span class="na">NA</span>'
          : `<span class="type-badge">${escapeHtml(bank.type)}</span>`;
        tr.appendChild(typeTd);

        const statusTd = document.createElement("td");
        statusTd.innerHTML = renderStatusBadge(bank.thesis_status);
        tr.appendChild(statusTd);
      }

      // Deep metric columns
      METRIC_GROUPS.forEach((grp) => {
        if (!state.activeGroups.has(grp.group)) return;
        grp.metrics.forEach((m) => {
          const td = document.createElement("td");
          const val = getDeepMetric(bank, m.key, m.fmt);
          td.innerHTML = renderValueCell(val);
          if (m.fmt === "pct" && val) {
            const num = parseSortableNumber(val);
            if (num !== null) {
              if (num > 0) td.classList.add("value-up");
              else if (num < 0) td.classList.add("value-down");
            }
          }
          tr.appendChild(td);
        });
      });

      // Evaluation column
      if (state.activeGroups.has("evaluation")) {
        const evalTd = document.createElement("td");
        evalTd.className = "col-evaluation";
        const dm = bank.deep_metrics;
        if (dm && dm.evaluations) {
          const isExpanded = state.expandedRows.has(bank.name);
          const summaryText = dm.evaluations["盈利能力评价"] || "";
          const shortText = summaryText.length > 30 ? summaryText.substring(0, 30) + "…" : summaryText;

          if (isExpanded) {
            evalTd.innerHTML = EVALUATION_KEYS.map((e) => {
              const text = dm.evaluations[e.key] || "";
              return `<div class="eval-item"><span class="eval-label">${e.label}</span><span class="eval-text">${escapeHtml(text)}</span></div>`;
            }).join("");
            const collapseBtn = document.createElement("div");
            collapseBtn.className = "eval-toggle";
            collapseBtn.textContent = "收起 ▴";
            collapseBtn.addEventListener("click", () => {
              state.expandedRows.delete(bank.name);
              renderAll();
            });
            evalTd.appendChild(collapseBtn);
          } else {
            evalTd.innerHTML = `<span class="eval-summary">${escapeHtml(shortText)}</span>`;
            const expandBtn = document.createElement("div");
            expandBtn.className = "eval-toggle";
            expandBtn.textContent = "展开 ▾";
            expandBtn.addEventListener("click", () => {
              state.expandedRows.add(bank.name);
              renderAll();
            });
            evalTd.appendChild(expandBtn);
          }
        } else {
          evalTd.innerHTML = '<span class="na">NA</span>';
        }
        tr.appendChild(evalTd);
      }

      tbody.appendChild(tr);
    });

    if (banks.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 99;
      td.style.textAlign = "center";
      td.style.color = "#8a8f98";
      td.style.padding = "24px";
      td.textContent = "没有符合当前筛选条件的银行";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    updateSortIndicators();
  }

  function updateSortIndicators() {
    document.querySelectorAll("#bank-table th[data-sort]").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.sortKey) {
        th.classList.add(state.sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  function renderValueCell(value) {
    if (isNA(value)) {
      return '<span class="na">NA</span>';
    }
    return escapeHtml(String(value));
  }

  function renderStatusBadge(statusKey) {
    const label = STATUS_LABELS[statusKey] || STATUS_LABELS.unknown;
    const cls = "status-" + (statusKey || "unknown");
    return `<span class="status-badge ${cls}">${label}</span>`;
  }

  // ---------- 卡片视图 ----------

  function renderCards(banks) {
    const grid = el("card-grid");
    grid.innerHTML = "";
    banks.forEach((bank) => {
      const card = document.createElement("div");
      card.className = "bank-card";

      const header = document.createElement("div");
      header.className = "bank-card-header";
      header.innerHTML = `
        <span class="bank-card-name">${escapeHtml(bank.name)}</span>
        ${renderStatusBadge(bank.thesis_status)}
      `;
      header.querySelector(".bank-card-name").addEventListener("click", () => openDetail(bank));
      card.appendChild(header);

      if (!isNA(bank.type)) {
        const typeRow = document.createElement("div");
        typeRow.style.marginBottom = "10px";
        typeRow.innerHTML = `<span class="type-badge">${escapeHtml(bank.type)}</span>`;
        card.appendChild(typeRow);
      }

      // Core metrics from deep data
      const metricsGrid = document.createElement("div");
      metricsGrid.className = "bank-card-metrics";
      CARD_CORE_METRICS.forEach((m) => {
        const val = getDeepMetric(bank, m.key, "pct");
        metricsGrid.appendChild(buildMetricItem(m.label, val));
      });
      card.appendChild(metricsGrid);

      // Extra metrics
      const extraGrid = document.createElement("div");
      extraGrid.className = "card-extra";
      CARD_EXTRA_METRICS.forEach((m) => {
        const fmt = m.key === "杠杆倍数" || m.key === "PB" || m.key === "PE(TTM)" ? "raw" : "pct";
        const val = getDeepMetric(bank, m.key, fmt);
        extraGrid.appendChild(buildMetricItem(m.label, val));
      });
      card.appendChild(extraGrid);

      // Evaluation section
      const dm = bank.deep_metrics;
      if (dm && dm.evaluations) {
        const evalSection = document.createElement("div");
        evalSection.className = "card-eval";
        EVALUATION_KEYS.forEach((e) => {
          const text = dm.evaluations[e.key] || "";
          const item = document.createElement("div");
          item.className = "card-eval-item";
          item.innerHTML = `
            <span class="card-eval-label">${e.label}</span>
            <span class="card-eval-text">${escapeHtml(text)}</span>
          `;
          evalSection.appendChild(item);
        });
        card.appendChild(evalSection);
      }

      const toggle = document.createElement("div");
      toggle.className = "card-toggle";
      toggle.textContent = "展开更多 ▾";
      toggle.addEventListener("click", () => {
        card.classList.toggle("expanded");
        toggle.textContent = card.classList.contains("expanded")
          ? "收起 ▴"
          : "展开更多 ▾";
      });
      card.appendChild(toggle);

      grid.appendChild(card);
    });

    if (banks.length === 0) {
      const empty = document.createElement("p");
      empty.style.color = "#8a8f98";
      empty.style.padding = "24px";
      empty.textContent = "没有符合当前筛选条件的银行";
      grid.appendChild(empty);
    }
  }

  function buildMetricItem(label, value) {
    const item = document.createElement("div");
    item.className = "metric-item";
    item.innerHTML = `
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${renderValueCell(value)}</div>
    `;
    return item;
  }

  // ---------- 详情预览面板 ----------

  function simpleMarkdownToHtml(md) {
    if (!md) return "<p>暂无内容。</p>";
    const lines = md.split("\n");
    let html = "";
    let inList = false;
    let inTable = false;
    let tableRows = [];

    function flushList() {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    }

    function flushTable() {
      if (inTable) {
        html += renderSimpleTable(tableRows);
        tableRows = [];
        inTable = false;
      }
    }

    function renderSimpleTable(rows) {
      if (rows.length === 0) return "";
      let out = "<table>";
      rows.forEach((row, idx) => {
        if (idx === 1 && /^[\s|:-]+$/.test(row.join(""))) return;
        const tag = idx === 0 ? "th" : "td";
        out += "<tr>" + row.map((cell) => `<${tag}>${inlineMarkdown(cell)}</${tag}>`).join("") + "</tr>";
      });
      out += "</table>";
      return out;
    }

    lines.forEach((rawLine) => {
      const line = rawLine.trimEnd();

      if (/^\s*\|.+\|\s*$/.test(line)) {
        flushList();
        inTable = true;
        const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
        tableRows.push(cells);
        return;
      } else if (inTable) {
        flushTable();
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushList();
        const level = Math.min(headingMatch[1].length, 4);
        html += `<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`;
        return;
      }

      const listMatch = line.match(/^[-*]\s+(.*)$/);
      if (listMatch) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += `<li>${inlineMarkdown(listMatch[1])}</li>`;
        return;
      } else {
        flushList();
      }

      if (line.trim() === "") {
        return;
      }

      html += `<p>${inlineMarkdown(line.trim())}</p>`;
    });

    flushList();
    flushTable();
    return html || "<p>暂无内容。</p>";
  }

  function inlineMarkdown(text) {
    let out = escapeHtml(text);
    out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
      const label = alias || target.split("/").pop();
      return `<span title="${escapeHtml(target)}">${escapeHtml(label)}</span>`;
    });
    return out;
  }

  function buildObsidianUri(relativePath) {
    if (!relativePath) return null;
    const withoutExt = relativePath.replace(/\.md$/, "");
    const encodedFile = encodeURIComponent(withoutExt);
    const encodedVault = encodeURIComponent(OBSIDIAN_VAULT_NAME);
    return `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;
  }

  function openDetail(bank) {
    el("detail-title").textContent = bank.name;

    const metaParts = [];
    if (!isNA(bank.type)) metaParts.push(bank.type);
    metaParts.push("命题状态：" + (STATUS_LABELS[bank.thesis_status] || "未知"));
    if (!isNA(bank.updated)) metaParts.push("更新于 " + bank.updated);
    const dm = bank.deep_metrics;
    if (dm && dm.report_period) metaParts.push("深度数据期：" + dm.report_period);
    el("detail-meta").textContent = metaParts.join(" · ");

    // Build detail body: thesis summary + deep metrics table + evaluations
    let bodyHtml = simpleMarkdownToHtml(bank.thesis_summary);

    if (dm && dm.metrics) {
      bodyHtml += '<h3>AkShare 深度指标</h3>';
      bodyHtml += '<div class="detail-metrics-grid">';

      METRIC_GROUPS.forEach((grp) => {
        bodyHtml += `<div class="detail-metric-group"><h4>${escapeHtml(grp.groupLabel)}</h4><table>`;
        grp.metrics.forEach((m) => {
          const val = getDeepMetric(bank, m.key, m.fmt);
          bodyHtml += `<tr><td>${escapeHtml(m.label)}</td><td>${val ? escapeHtml(val) : '<span class="na">NA</span>'}</td></tr>`;
        });
        bodyHtml += '</table></div>';
      });

      bodyHtml += '</div>';
    }

    if (dm && dm.evaluations) {
      bodyHtml += '<h3>四维评价</h3>';
      EVALUATION_KEYS.forEach((e) => {
        const text = dm.evaluations[e.key] || "";
        bodyHtml += `<div class="detail-eval-card"><div class="detail-eval-title">${escapeHtml(e.label)}</div><div class="detail-eval-text">${escapeHtml(text)}</div></div>`;
      });
    }

    if (dm && dm.not_available_from_akshare && dm.not_available_from_akshare.length > 0) {
      bodyHtml += '<h3>AkShare 数据缺口</h3><ul>';
      dm.not_available_from_akshare.forEach((item) => {
        bodyHtml += `<li>${escapeHtml(item)}</li>`;
      });
      bodyHtml += '</ul>';
    }

    el("detail-body").innerHTML = bodyHtml;

    const obsidianLink = el("detail-obsidian-link");
    const targetPath = bank.links && (bank.links.thesis || bank.links.deep_research || bank.links.profile);
    const uri = buildObsidianUri(targetPath);
    if (uri) {
      obsidianLink.href = uri;
      obsidianLink.classList.remove("disabled");
      obsidianLink.textContent = "在 Obsidian 中打开";
    } else {
      obsidianLink.href = "#";
      obsidianLink.classList.add("disabled");
      obsidianLink.textContent = "未找到可跳转的页面";
    }

    const stockLink = el("detail-stock-link");
    const stockCode = state.stockCodeByName[bank.name];
    if (stockCode) {
      stockLink.href = `stock.html?code=${encodeURIComponent(stockCode)}`;
      stockLink.classList.remove("disabled");
      stockLink.textContent = "查看历史数据分析 →";
    } else {
      stockLink.href = "#";
      stockLink.classList.add("disabled");
      stockLink.textContent = "暂无历史数据";
    }

    el("detail-panel").classList.remove("hidden");
    el("detail-overlay").classList.remove("hidden");
  }

  function closeDetail() {
    el("detail-panel").classList.add("hidden");
    el("detail-overlay").classList.add("hidden");
  }

  el("detail-close").addEventListener("click", closeDetail);
  el("detail-overlay").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });
})();
