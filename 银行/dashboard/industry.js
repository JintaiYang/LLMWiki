(function () {
  const COLORS = {
    line: "#2f6fed",
    mean: "#6b7280",
    high: "#d1453b",
    low: "#1a9e5c",
    band: "rgba(47, 111, 237, 0.10)",
    peers: ["#2f6fed", "#d1453b", "#1a9e5c", "#b45309", "#7c3aed"],
  };

  const GROUP_HOST = {
    earn: "charts-earn",
    risk: "charts-risk",
    capital: "charts-capital",
  };

  const METRIC_HELP = {
    roe: {
      title: "资本利润率（ROE）",
      body: "监管口径里的「资本利润率」就是常说的 ROE：净利润 ÷ 平均所有者权益。意思是股东投进去的本金，这一年赚了百分之几。本页是全国商业银行整体，不是某一家上市银行的年报 ROE。它和「资产利润率 ROA」不同：ROA 是利润 ÷ 全部资产，资本利润率只看股东这一层。",
    },
    lcr: {
      title: "LCR（流动性覆盖率）",
      body: "英文 Liquidity Coverage Ratio。问的是：假如未来 30 天出现挤兑、市场冻结，银行手里立刻能变现的「活钱」（现金、国债等高流动性资产）够不够覆盖这段时间的净现金流出。监管一般要求不低于 100%。本页是商业银行整体，完整序列从 2017 年一季度起。LCR 高只说明短期能撑住，不代表负债结构长期稳定（那要另看 NSFR，本页暂无完整序列）。",
    },
  };

  const charts = {};
  let data = null;
  let bandMode = "static";

  Chart.defaults.font.family =
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  Chart.defaults.color = "#6b7280";
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
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
    const pw = Math.min(280, window.innerWidth - 16);
    pop.style.width = pw + "px";
    const ph = pop.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    if (top + ph > window.innerHeight - 8) {
      top = Math.max(8, r.top - ph - 6);
    }
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function helpBtnHtml(id) {
    const help = METRIC_HELP[id];
    if (!help) return "";
    return (
      `<button type="button" class="col-help-btn" aria-expanded="false" ` +
      `aria-label="${escapeHtml(help.title)}的含义" ` +
      `data-help-title="${escapeHtml(help.title)}" ` +
      `data-help-body="${escapeHtml(help.body)}">?</button>`
    );
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

  function fmt(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return Number(v).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtDate(s) {
    return String(s || "").slice(0, 7);
  }

  function zoneClass(zone) {
    if (zone === "高估") return "zone-high";
    if (zone === "低估") return "zone-low";
    return "zone-mid";
  }

  function destroy(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function lineOpts() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            title: (items) => (items[0] ? fmtDate(items[0].label) : ""),
          },
        },
      },
      scales: {
        x: {
          ticks: {
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
            callback: function (val) {
              const label = this.getLabelForValue(val);
              return fmtDate(label);
            },
          },
          grid: { color: "#eef0f3" },
        },
        y: {
          ticks: { font: { size: 10 } },
          grid: { color: "#eef0f3" },
        },
      },
    };
  }

  function renderKpis() {
    const host = el("kpi-row");
    const items = Array.isArray(data.kpis) ? data.kpis : [];
    if (!items.length) {
      host.innerHTML = '<p class="data-note">当前无可展示的行业 KPI，请检查行业采集结果；不会用旧值或推算值补齐。</p>';
      return;
    }
    host.innerHTML = items
      .map((k) => {
        const digits = k.unit === "x" ? 2 : k.id === "coverage" || k.id === "lcr" ? 1 : 2;
        let delta = "";
        if (k.delta !== null && k.delta !== undefined) {
          const sign = k.delta > 0 ? "+" : "";
          const cls = k.delta > 0 ? "delta-up" : k.delta < 0 ? "delta-down" : "";
          delta = `<span class="${cls}">${sign}${fmt(k.delta, digits)}${k.unit}</span> 较上期`;
        }
        const zone = k.zone
          ? `<span class="zone ${zoneClass(k.zone)}">${k.zone}</span>`
          : "";
        return `<article class="kpi-card">
          <div class="label">${escapeHtml(k.label)}${helpBtnHtml(k.id)}</div>
          <div class="value">${fmt(k.value, digits)}${k.unit === "x" ? "x" : k.unit}${zone}</div>
          <div class="meta">${k.date || ""} ${delta}</div>
        </article>`;
      })
      .join("");
  }

  function bandSets(kind) {
    const v = data.valuation;
    const src = bandMode === "rolling" ? v.rolling : v.static_10y;
    if (bandMode === "rolling") {
      return {
        mean: src[`${kind}_mean`],
        high: src[`${kind}_high`],
        low: src[`${kind}_low`],
      };
    }
    return {
      mean: src[`${kind}_mean_line`],
      high: src[`${kind}_high_line`],
      low: src[`${kind}_low_line`],
    };
  }

  function renderValuationCharts() {
    const v = data.valuation;
    const labels = v.dates;
    [
      ["pb", "总 PB", "chart-pb"],
      ["pe", "总 PE", "chart-pe"],
    ].forEach(([kind, label, canvasId]) => {
      destroy(canvasId);
      const bands = bandSets(kind);
      const useFill = bandMode === "static";
      const ctx = el(canvasId).getContext("2d");
      charts[canvasId] = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label,
              data: v[kind],
              borderColor: COLORS.line,
              backgroundColor: COLORS.line,
              borderWidth: 2.2,
              pointRadius: 0,
              spanGaps: true,
              fill: false,
              order: 0,
            },
            {
              label: "10年均值",
              data: bands.mean,
              borderColor: COLORS.mean,
              borderDash: [2, 3],
              borderWidth: 1.5,
              pointRadius: 0,
              spanGaps: true,
              fill: false,
              order: 1,
            },
            {
              label: "高估线（均值+1σ）",
              data: bands.high,
              borderColor: COLORS.high,
              borderDash: [6, 4],
              borderWidth: 1.5,
              pointRadius: 0,
              spanGaps: true,
              fill: useFill ? "+1" : false,
              backgroundColor: COLORS.band,
              order: 2,
            },
            {
              label: "低估线（均值-1σ）",
              data: bands.low,
              borderColor: COLORS.low,
              borderDash: [6, 4],
              borderWidth: 1.5,
              pointRadius: 0,
              spanGaps: true,
              fill: false,
              order: 2,
            },
          ],
        },
        options: lineOpts(),
      });
    });
  }

  function renderBandTable() {
    const pb = data.valuation.static_10y.pb;
    const pe = data.valuation.static_10y.pe;
    el("band-table").innerHTML = `
      <thead>
        <tr>
          <th>指标</th><th>最新</th><th>10年均值</th><th>10年标准差</th>
          <th>高估线</th><th>低估线</th><th>偏离</th><th>位置</th>
        </tr>
      </thead>
      <tbody>
        ${[ ["总 PB", pb, 2], ["总 PE", pe, 2] ]
          .map(([name, s, d]) => {
            const z = s.z > 0 ? `+${fmt(s.z, 2)}σ` : `${fmt(s.z, 2)}σ`;
            return `<tr>
              <td>${name}</td>
              <td>${fmt(s.last, d)}</td>
              <td>${fmt(s.mean, d)}</td>
              <td>${fmt(s.std, d)}</td>
              <td>${fmt(s.high, d)}</td>
              <td>${fmt(s.low, d)}</td>
              <td>${z}</td>
              <td><span class="zone ${zoneClass(s.zone)}">${s.zone}</span></td>
            </tr>`;
          })
          .join("")}
      </tbody>`;
  }

  function renderZoneBanner() {
    const pb = data.valuation.static_10y.pb;
    const pe = data.valuation.static_10y.pe;
    const mode =
      bandMode === "rolling"
        ? "图中阴影为过去10年滚动均值 ± 1σ。"
        : `图中水平线按 ${pb.start.slice(0, 7)} 至 ${pb.end.slice(0, 7)} 的月末样本计算。`;
    el("zone-banner").innerHTML =
      `当前总 PB <strong>${fmt(pb.last, 2)}x</strong> 位于<strong>${pb.zone}</strong>；` +
      `总 PE <strong>${fmt(pe.last, 2)}x</strong> 位于<strong>${pe.zone}</strong>。` +
      `PE 高于 10 年中枢，多半是盈利（分母）被压低，而不是价格单独变贵——需与 PB、NIM、ROE 对照。${mode}`;
    el("valuation-desc").textContent =
      data.valuation.method + "。月末取样，约 2006-01 至最新。";
  }

  function renderGroupCharts() {
    Object.values(GROUP_HOST).forEach((id) => {
      el(id).innerHTML = "";
    });
    data.charts.forEach((c) => {
      const host = el(GROUP_HOST[c.group]);
      if (!host) return;
      const span = c.id === "nim" ? " span-2" : "";
      const card = document.createElement("article");
      card.className = "chart-card" + span;
      const canvasId = "chart-" + c.id;
      card.innerHTML = `<h3>${escapeHtml(c.title)}${c.unit ? "（" + escapeHtml(c.unit) + "）" : ""}${helpBtnHtml(c.id)}</h3>
        <div class="chart-canvas-box"><canvas id="${canvasId}"></canvas></div>`;
      host.appendChild(card);

      const datasets = [];
      if (c.peers && c.peers.length) {
        datasets.push({
          label: "商业银行整体",
          data: c.values,
          borderColor: COLORS.peers[0],
          borderWidth: 2.2,
          pointRadius: 0,
          spanGaps: true,
        });
        c.peers.forEach((p, i) => {
          const aligned = alignTo(c.dates, p.dates, p.values);
          datasets.push({
            label: p.name.replace(" NIM", ""),
            data: aligned,
            borderColor: COLORS.peers[(i + 1) % COLORS.peers.length],
            borderWidth: 1.4,
            pointRadius: 0,
            spanGaps: true,
          });
        });
      } else {
        datasets.push({
          label: c.title,
          data: c.values,
          borderColor: COLORS.line,
          borderWidth: 2,
          pointRadius: 0,
          spanGaps: true,
        });
      }

      destroy(canvasId);
      charts[canvasId] = new Chart(el(canvasId).getContext("2d"), {
        type: "line",
        data: { labels: c.dates, datasets },
        options: lineOpts(),
      });
    });
  }

  function alignTo(masterDates, dates, values) {
    const map = {};
    dates.forEach((d, i) => {
      map[d] = values[i];
    });
    return masterDates.map((d) => (d in map ? map[d] : null));
  }

  function bindNav() {
    const items = Array.from(document.querySelectorAll(".group-nav-item"));
    const sections = items
      .map((a) => document.querySelector(a.getAttribute("href")))
      .filter(Boolean);
    const onScroll = () => {
      let current = sections[0];
      sections.forEach((sec) => {
        if (sec.getBoundingClientRect().top <= 80) current = sec;
      });
      items.forEach((a) => {
        a.classList.toggle("active", a.getAttribute("href") === "#" + current.id);
      });
    };
    document.addEventListener("scroll", onScroll, { passive: true });
  }

  function bindBandToggle() {
    el("band-toggle").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".band-btn");
      if (!btn) return;
      bandMode = btn.getAttribute("data-mode");
      Array.from(el("band-toggle").querySelectorAll(".band-btn")).forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      renderZoneBanner();
      renderValuationCharts();
    });
  }

  function boot(payload) {
    data = payload;
    el("generated-at").textContent = "页面数据生成：" + (data.generated_at || "未知");
    const regulatorDates = (data.kpis || []).filter(k => k.id !== "pb" && k.id !== "pe").map(k => k.date).filter(Boolean).sort();
    const valuationDates = (data.kpis || []).filter(k => k.id === "pb" || k.id === "pe").map(k => k.date).filter(Boolean).sort();
    el("industry-reg-date").textContent = "监管指标截至：" + (regulatorDates.at(-1) || "未知，各指标以卡片日期为准");
    el("industry-date-summary").textContent = "· 监管指标截至：" + (regulatorDates.at(-1) || "未知");
    el("industry-val-date").textContent = "行业估值截至：" + (valuationDates.at(-1) || "未知");
    el("data-note").innerHTML =
      (data.sources || []).map((s) => escapeHtml(s)).join("<br>") +
      "<br>" +
      escapeHtml(data.band_note || "");
    renderKpis();
    renderZoneBanner();
    renderValuationCharts();
    renderBandTable();
    renderGroupCharts();
    bindNav();
    bindBandToggle();
    el("main-content").classList.remove("hidden");
  }

  fetch("industry.json", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    })
    .then(boot)
    .catch((err) => {
      console.error(err);
      el("load-error").classList.remove("hidden");
    });
})();
