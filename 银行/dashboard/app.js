// 银行研究标的对比仪表盘 - 前端逻辑
// 数据来源：dashboard/data.json（由 scripts/generate_dashboard_data.py 生成）
// 设计文档：docs/superpowers/specs/2026-08-11-bank-dashboard-design.md

(function () {
  "use strict";

  // Obsidian vault 名称；如实际注册名称不同，请修改此处。
  const OBSIDIAN_VAULT_NAME = "银行";

  const STATUS_LABELS = {
    open: "开放",
    strengthened: "加强",
    weakened: "削弱",
    falsified: "证伪/失效",
    confirmed: "证实",
    unknown: "未知",
  };

  const TABLE_METRIC_COLUMNS = [
    "revenue",
    "net_profit",
    "eps",
    "bvps",
    "roe",
    "nim",
    "npl_ratio",
    "provision_coverage",
    "pb",
    "pe",
    "dividend_yield",
    "thesis_status",
    "updated",
  ];

  const CARD_CORE_METRICS = [
    { key: "roe", label: "ROE" },
    { key: "nim", label: "NIM" },
    { key: "npl_ratio", label: "不良率" },
    { key: "provision_coverage", label: "拨备覆盖率" },
  ];

  const CARD_EXTRA_METRICS = [
    { key: "total_assets", label: "总资产" },
    { key: "cet1", label: "CET1" },
    { key: "pb", label: "PB" },
    { key: "pe", label: "PE" },
    { key: "dividend_yield", label: "股息率" },
    { key: "updated", label: "更新日期" },
  ];

  const state = {
    banks: [],
    view: "table",
    sortKey: "name",
    sortDir: "asc",
    activeTypes: new Set(),
    activeStatuses: new Set(),
    allTypes: [],
    stockCodeByName: {}, // 银行名 -> 股票代码，用于跳转到 stock.html
  };

  function el(id) {
    return document.getElementById(id);
  }

  function isNA(value) {
    return value === null || value === undefined || value === "";
  }

  function renderValueCell(value) {
    if (isNA(value)) {
      return '<span class="na">NA</span>';
    }
    return escapeHtml(String(value));
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // 从字符串中解析出用于排序的数值（取第一个出现的数字，含负号和小数点）。
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
      renderAll();
    })
    .catch((err) => {
      console.error("加载 data.json 失败：", err);
      el("load-error").classList.remove("hidden");
      el("main-content").classList.add("hidden");
    });

  // 加载"银行名 -> 股票代码"索引，用于详情面板跳转到个股数据分析页面。
  // 该文件由 scripts/generate_stock_detail_data.py 生成，覆盖全市场银行（不限于18家重点覆盖）。
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

  document.querySelectorAll("#bank-table .metric-row th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = "asc";
      }
      renderAll();
    });
  });

  function getSortValue(bank, key) {
    if (key === "name") return bank.name;
    if (key === "updated") return parseSortableDate(bank.updated);
    if (key === "thesis_status") return bank.thesis_status || "";
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
      if (aNull) return 1; // null 永远排最后
      if (bNull) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  // ---------- 渲染 ----------

  function renderAll() {
    const filtered = sortBanks(getFilteredBanks());
    updateSortIndicators();
    if (state.view === "table") {
      renderTable(filtered);
    } else {
      renderCards(filtered);
    }
  }

  function updateSortIndicators() {
    document.querySelectorAll("#bank-table .metric-row th, #bank-table .col-name").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.sortKey) {
        th.classList.add(state.sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  function renderTable(banks) {
    const tbody = el("table-body");
    tbody.innerHTML = "";
    banks.forEach((bank) => {
      const tr = document.createElement("tr");

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

      TABLE_METRIC_COLUMNS.forEach((key) => {
        const td = document.createElement("td");
        if (key === "thesis_status") {
          td.innerHTML = renderStatusBadge(bank.thesis_status);
        } else {
          td.innerHTML = renderValueCell(bank[key]);
        }
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    if (banks.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 15;
      td.style.textAlign = "center";
      td.style.color = "#8a8f98";
      td.style.padding = "24px";
      td.textContent = "没有符合当前筛选条件的银行";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  function renderStatusBadge(statusKey) {
    const label = STATUS_LABELS[statusKey] || STATUS_LABELS.unknown;
    const cls = "status-" + (statusKey || "unknown");
    return `<span class="status-badge ${cls}">${label}</span>`;
  }

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

      const metricsGrid = document.createElement("div");
      metricsGrid.className = "bank-card-metrics";
      CARD_CORE_METRICS.forEach((m) => {
        metricsGrid.appendChild(buildMetricItem(m.label, bank[m.key]));
      });
      card.appendChild(metricsGrid);

      const extraGrid = document.createElement("div");
      extraGrid.className = "card-extra";
      CARD_EXTRA_METRICS.forEach((m) => {
        extraGrid.appendChild(buildMetricItem(m.label, bank[m.key]));
      });
      card.appendChild(extraGrid);

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

  // 极简 Markdown 转 HTML：仅覆盖标题、粗体、列表、表格、双链这几种常见语法。
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
        html += renderTable(tableRows);
        tableRows = [];
        inTable = false;
      }
    }

    function renderTable(rows) {
      if (rows.length === 0) return "";
      let out = "<table>";
      rows.forEach((row, idx) => {
        if (idx === 1 && /^[\s|:-]+$/.test(row.join(""))) return; // 跳过分隔行
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
    // 粗体 **text**
    out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // 行内代码 `text`
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    // 双链 [[路径/页面名]] 或 [[页面名]] -> 纯文本展示（网页内无法真正跳转 Obsidian 双链目标）
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
    el("detail-meta").textContent = metaParts.join(" · ");

    el("detail-body").innerHTML = simpleMarkdownToHtml(bank.thesis_summary);

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
