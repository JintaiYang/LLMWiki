(function () {
  "use strict";
  const Q = window.LQ;
  const charts = [];

  function drawLine(canvas, labels, data, label, unit) {
    const options = Q.lineOptions(unit || "");
    options.plugins.legend.display = false;
    charts.push(new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: "#2f6fed",
          backgroundColor: "rgba(47,111,237,0.12)",
          spanGaps: false,
          tension: 0.25,
          pointRadius: 2,
        }],
      },
      options,
    }));
  }

  Promise.all([Q.readJson("./data.json?v=15"), Q.readJson("./industry.json?v=4")]).then(([data, industry]) => {
    const companies = (data.companies || []).filter((c) => Q.CODES.includes(String(c.code)));
    const series = Array.isArray(industry.series) ? industry.series : [];
    const sampleMeta = industry.sample || {};
    const sampleCount = Q.num(sampleMeta.count) || companies.length;
    const samples = (industry.sample_series || []).filter((s) => s && s.scope === "listed_sample_not_industry");
    const ranked = companies.filter((c) => c.score && c.score.rankable === true && Q.num(c.score.total) !== null).length;
    const priceDate = (companies[0] && companies[0].price && companies[0].price.price_date) || "未标注";
    Q.el("kpi-row").innerHTML = [
      ["研究覆盖", companies.length + " / " + sampleCount, "申万白酒Ⅲ已接入"],
      ["可排序", ranked + " / " + companies.length, "满足评分覆盖与排名条件"],
      ["行业序列", String(series.length), "已核验的全行业口径"],
      ["样本序列", String(samples.length), "上市公司样本，不是行业总体"],
    ].map(([label, value, meta]) => `<article class="kpi-card"><div class="label">${label}</div><div class="value">${value}</div><div class="meta">${meta}</div></article>`).join("");
    Q.el("industry-reg-date").textContent = "行业序列：" + (series.length ? series.length + " 条" : "暂无全口径序列");
    Q.el("industry-val-date").textContent = "行情截至：" + priceDate;
    Q.el("generated-at").textContent = "页面数据生成：" + (data.generated_at || industry.generated_at || "未标注");
    Q.el("industry-date-summary").textContent = "· 行情截至：" + priceDate;

    const monitoring = industry.monitoring || {};
    const latest = monitoring.latest_ytd || {};
    const signals = monitoring.signals || [];
    const signalByKey = Object.fromEntries(signals.map((item) => [item.key, item]));
    const monitorCards = [
      ["最新同口径", latest.period || "暂无", latest.rows_with_data != null ? latest.rows_with_data + " / " + (latest.sample_count || sampleCount) + " 家有行" : "", "text"],
      ["样本营收同比", signalByKey.revenue_CNY && signalByKey.revenue_CNY.value, "同报告期 年内累计；覆盖匹配 " + ((signalByKey.revenue_CNY && signalByKey.revenue_CNY.matched_coverage) ? "是" : "否"), "pct"],
      ["样本净利同比", signalByKey.net_profit_CNY && signalByKey.net_profit_CNY.value, "同报告期 年内累计；覆盖匹配 " + ((signalByKey.net_profit_CNY && signalByKey.net_profit_CNY.matched_coverage) ? "是" : "否"), "pct"],
      ["样本经营现金流同比", signalByKey.cfo_CNY && signalByKey.cfo_CNY.value, "同报告期 年内累计；覆盖匹配 " + ((signalByKey.cfo_CNY && signalByKey.cfo_CNY.matched_coverage) ? "是" : "否"), "pct"],
      ["样本存货同比", signalByKey.inventory_CNY && signalByKey.inventory_CNY.value, "同报告期 年内累计", "pct"],
      ["样本合同负债同比", signalByKey.contract_liabilities_CNY && signalByKey.contract_liabilities_CNY.value, "同报告期 年内累计", "pct"],
      ["中位营业利润率", latest.median_operating_margin_pct, "当前样本期", "pct"],
      ["股东自由现金流为负", latest.negative_owner_fcf_count, "家 / 有效样本", "count"],
    ];
    Q.el("monitoring-cards").innerHTML = monitorCards.map(([label, value, meta, kind]) => {
      const shown = value == null || value === "" ? "—" : kind === "text" ? String(value) : kind === "pct" ? Q.fmt(value, 2) + "%" : Q.fmt(value, 0);
      return `<article class="monitor-card"><h3 class="label">${Q.esc(label)}</h3><p class="value">${shown}</p><p class="meta">${Q.esc(meta || "")}</p></article>`;
    }).join("");
    const fullYear = monitoring.full_year || {};
    const monitorRows = Object.values(fullYear).filter(Boolean).map((snapshot) => {
      const coverage = snapshot.coverage || {};
      return `<tr><td>${Q.esc(snapshot.period || "—")}</td><td>${Q.fmtYi(snapshot.revenue_CNY)}</td><td>${Q.fmtYi(snapshot.net_profit_CNY)}</td><td>${Q.fmtYi(snapshot.cfo_CNY)}</td><td>${Q.fmtYi(snapshot.owner_fcf_CNY)}</td><td>${Q.fmt(snapshot.negative_owner_fcf_count, 0)}</td><td>${Q.fmt(coverage.revenue, 0)} / ${Q.fmt(snapshot.sample_count, 0)}</td></tr>`;
    }).join("");
    Q.el("monitoring-table").innerHTML = `<tr><th>报告期</th><th>营收合计（亿元）</th><th>净利合计（亿元）</th><th>经营现金流（亿元）</th><th>股东自由现金流（亿元）</th><th>股东自由现金流为负</th><th>营收覆盖</th></tr>${monitorRows || "<tr><td colspan=\"7\">暂无同口径样本监控数据</td></tr>"}`;

    const industryBox = Q.el("industry-charts");
    if (!series.length) {
      industryBox.innerHTML = '<article class="chart-card"><h3>行业整体数据待补充</h3><p>尚未取得可核验的全行业序列，上市公司样本不能替代行业全口径。</p></article>';
    } else {
      industryBox.innerHTML = series.map((s, i) => `<article class="chart-card chart-zoomable" title="点击放大或还原。指针悬停时，竖线对应当年的数值。"><h3>${Q.esc(s.name || s.key || ("序列" + (i + 1)))}</h3><div class="chart-canvas-box tall"><canvas id="ind-${i}"></canvas></div></article>`).join("");
      series.forEach((s, i) => {
        const points = s.points || s.data || [];
        drawLine(Q.el("ind-" + i), points.map((p) => String(p.year || p.period || p.label || "")), points.map((p) => Q.num(p.value)), s.name || "行业", "");
      });
    }

    const sampleBox = Q.el("sample-charts");
    sampleBox.innerHTML = samples.map((s) => `<article class="chart-card chart-zoomable" title="点击放大或还原。指针悬停时，竖线对应当年的数值。"><h3>${Q.esc(s.name || s.key)}（亿元）</h3><div class="chart-canvas-box tall"><canvas id="sample-${Q.esc(s.key)}"></canvas></div></article>`).join("") || '<article class="chart-card"><h3>样本数据待补充</h3><p>暂未取得可比较的完整年度财报。</p></article>';
    samples.forEach((s) => {
      const labels = [];
      const values = [];
      (s.points || []).forEach((p) => {
        labels.push(String(p.year));
        const ok = Q.num(p.coverage) === sampleCount && String(p.report_date) === String(p.year) + "-12-31";
        values.push(ok ? +(p.value / 1e8).toFixed(2) : null);
      });
      drawLine(Q.el("sample-" + s.key), labels, values, s.name || s.key, "亿元");
    });

    const head = "<tr><th>公司</th><th>最新完整年</th><th>营业收入（亿元）</th><th>净利润（亿元）</th><th>毛利率</th><th>合同负债（亿元）</th><th>质量评分</th></tr>";
    const body = companies.map((c) => {
      const row = Q.latestAnnual(c) || {};
      const rankedRow = c.score && c.score.rankable === true && Q.num(c.score.total) !== null;
      return `<tr><td><a href="stock.html?code=${encodeURIComponent(c.code)}">${Q.esc(c.name)}</a></td><td>${Q.esc(row.year || "—")}</td><td>${Q.fmtYi(row.revenue)}</td><td>${Q.fmtYi(row.net_profit)}</td><td>${Q.fmtPct(row.gross_margin)}</td><td>${Q.fmtYi(row.contract_liabilities)}</td><td>${rankedRow ? Q.fmt(c.score.total, 1) : "未排序"}</td></tr>`;
    }).join("");
    Q.el("name-table").innerHTML = head + body;
    const sample = industry.sample || {};
    Q.el("data-note").textContent = sample.note || "上市公司样本并非白酒行业总体。";
    Q.bindChartZoomAll(Q.el("main-content"));
    Q.el("load-error").classList.add("hidden");
    Q.el("main-content").classList.remove("hidden");
    document.querySelectorAll(".group-nav-item").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".group-nav-item").forEach((n) => n.classList.remove("active"));
        link.classList.add("active");
        const target = document.querySelector(link.getAttribute("href"));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }).catch((err) => {
    console.error(err);
    Q.el("load-error").classList.remove("hidden");
  });
})();
