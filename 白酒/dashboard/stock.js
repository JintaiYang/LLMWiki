(function () {
  "use strict";
  const Q = window.LQ;
  const COLOR = "#2f6fed";
  const COLOR2 = "#d1453b";
  const DIM_COLORS = ["#2f6fed", "#0ea5e9", "#f59e0b", "#10b981", "#d1453b"];
  const CHARTS = {
    scale: [["revenue", "营业收入"], ["net_profit", "归母净利润"]],
    profit: [["gross_margin", "毛利率"], ["gross_sales_spread", "毛销差"], ["operating_margin", "营业利润率"], ["roe", "净资产收益率"], ["dividend_yield_year_end", "年末股息率"]],
    cash: [["sales_cash_ratio", "销售收现比"], ["cfo_profit", "净现比"], ["owner_fcf_to_profit", "股东自由现金流/净利润"], ["fcf_to_revenue", "企业自由现金流/营收"], ["owner_fcf", "股东自由现金流"]],
    risk: [["debt_to_asset", "资产负债率"], ["cash_to_current_liab", "现金比率"], ["cfo_to_current_liab", "现金流动负债比"], ["inventory_receivables_to_revenue", "存货+应收/营收"], ["other_receivables_to_asset", "其他应收/总资产"]],
    channel: [["contract_liabilities", "合同负债"], ["inventory", "存货"], ["receivables", "应收款项"], ["sales_expense", "销售费用"]],
  };
  const state = { companies: [], model: {}, pnl: {}, code: null, compare: "", range: "all", pnlYear: "", generatedAt: "", charts: {}, expanded: new Set() };
  const STATUS_LABEL = { scored: "已评分", missing: "缺项", unscored_no_approved_rubric: "定性未获准" };
  const STATUS_CLASS = { scored: "basis-statement", missing: "basis-unavailable", unscored_no_approved_rubric: "basis-excluded" };

  function company(code) { return state.companies.find((c) => c.code === code) || null; }
  function rowsOf(code) {
    const list = Q.annuals(company(code) || {});
    return state.range === "5" ? list.slice(-5) : list;
  }
  function destroyCharts() {
    Object.keys(state.charts).forEach((id) => { state.charts[id].destroy(); delete state.charts[id]; });
  }
  function lineChart(canvasId, labels, datasets, unit) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return;
    const options = Q.lineOptions(unit);
    options.plugins.legend.display = datasets.length > 1;
    state.charts[canvasId] = new Chart(canvas, { type: "line", data: { labels, datasets }, options });
  }
  function series(code, key) {
    const amount = Q.AMOUNT_KEYS.includes(key);
    return rowsOf(code).map((r) => {
      const n = Q.num(r[key]);
      if (n === null) return null;
      return amount ? +(n / 1e8).toFixed(2) : +n.toFixed(2);
    });
  }
  function chartBlock(group) {
    return `<div class="chart-row">${CHARTS[group].map(([key, name]) => {
      const unit = Q.AMOUNT_KEYS.includes(key) ? "亿元" : (Q.RATIO_KEYS.includes(key) ? "倍" : "%");
      return `<article class="chart-card chart-zoomable" title="点击放大或还原。指针悬停时，竖线对应当年的数值。"><h3>${Q.esc(name)}（${unit}）</h3><div class="chart-canvas-box" style="height:240px"><canvas id="chart-${group}-${key}"></canvas></div></article>`;
    }).join("")}</div>`;
  }
  function drawGroup(group) {
    const labels = rowsOf(state.code).map((r) => String(r.year));
    const compare = state.compare ? company(state.compare) : null;
    CHARTS[group].forEach(([key]) => {
      const unit = Q.AMOUNT_KEYS.includes(key) ? "亿元" : (Q.RATIO_KEYS.includes(key) ? "倍" : "%");
      const datasets = [{
        label: company(state.code).name,
        data: series(state.code, key),
        borderColor: COLOR,
        backgroundColor: "rgba(47,111,237,0.12)",
        spanGaps: false,
        tension: 0.25,
        pointRadius: 2,
      }];
      if (compare) {
        const map = {};
        rowsOf(state.compare).forEach((r, i) => { map[String(r.year)] = series(state.compare, key)[i]; });
        datasets.push({
          label: compare.name,
          data: labels.map((y) => (y in map ? map[y] : null)),
          borderColor: COLOR2,
          borderDash: [5, 4],
          spanGaps: false,
          tension: 0.25,
          pointRadius: 2,
        });
      }
      lineChart("chart-" + group + "-" + key, labels, datasets, unit);
    });
  }
  function renderOverview() {
    const c = company(state.code);
    const dims = Q.dimensions(c);
    const score = c.score || {};
    const annual = Q.annualOf(c, score.annual_year) || Q.latestAnnual(c) || {};
    const latest = c.latest || {};
    const ranked = score.rankable === true && Q.num(score.total) !== null;
    const missing = (score.missing || []).map(Q.itemLabel).join("、") || "无";
    const tag = Q.classifyCompany(c, state.model);
    const observedScore = Q.num(score.observed_total);
    let html = `<div class="overall-bar"><div class="overall-title">总评</div><div class="overall-text">${score.annual_year || "—"} 完整年质量评分${ranked ? " " + Q.fmt(score.total, 1) : observedScore !== null ? "观察分 " + Q.fmt(observedScore, 1) : "未排序"}。覆盖度 ${Q.num(score.coverage) === null ? "—" : Q.fmt(score.coverage * 100, 0) + "%"}。标签 <span class="style-badge ${tag.id}">${Q.esc(tag.label)}</span>。缺项：${Q.esc(missing)}。最新报告期 ${Q.esc(latest.report_date || "—")}${latest.period === "quarterly_ytd" ? " 为年初至今累计，不与完整年混比" : ""}。收盘价 ${Q.fmt(c.price && c.price.close, 2)} 元（${Q.esc((c.price && c.price.price_date) || "日期未标注")}）。股息率 ${Q.fmtPct(c.dividend && c.dividend.yield_pct)}。${Q.esc(Q.dcfStatus(c.dcf && c.dcf.status))}。</div></div>`;
    html += '<div class="overview-grid"><div class="radar-card"><div class="radar-head">';
    html += `<div class="score-big">${ranked ? Q.fmt(score.total, 2) : "未排序"}</div>`;
    html += '</div><div class="radar-wrap"><canvas id="chart-radar"></canvas></div></div><div class="dim-cards">';
    dims.forEach((dim, i) => {
      const open = state.expanded.has(dim.letter);
      const pct = dim.weight && dim.score !== null ? Math.max(0, Math.min(100, dim.score / dim.weight * 100)) : 0;
      html += `<div class="dim-card${open ? " expanded" : ""}">`;
      html += `<div class="dim-card-toggle" data-dim="${dim.letter}" role="button" tabindex="0">`;
      html += `<span class="dim-badge" style="background:${DIM_COLORS[i]}">${dim.letter}</span>`;
      html += `<div class="dim-card-headtext"><div class="dim-card-q">${Q.esc(dim.question)}<span class="dim-card-name"> · ${Q.esc(dim.name)}</span></div></div>`;
      html += `<div class="dim-card-score">${dim.score === null ? "—" : Q.fmt(dim.score, 1)}<span class="dim-card-full">/${Q.fmt(dim.weight, 0)}</span></div>`;
      html += `<span class="dim-card-caret">${open ? "▴" : "▾"}</span></div>`;
      html += `<div class="dim-bar"><div class="dim-bar-fill" style="width:${pct}%;background:${DIM_COLORS[i]}"></div></div>`;
      if (open) {
        html += '<div class="dim-card-eval">';
        (dim.items || []).forEach((it) => {
          html += `<div class="eval-line"><strong class="eval-title">${Q.esc(Q.itemLabel(it.name))}：</strong><span class="eval-item">${Q.esc(Q.fmtItemValue(it.name, it.value))} · ${it.score == null ? "未评分 / " + Q.fmt(it.max, 0) : Q.fmt(it.score, 2) + " / " + Q.fmt(it.max, 0)}</span></div>`;
        });
        html += `<div class="eval-line"><strong class="eval-title">判断：</strong><span class="eval-item">${dim.score === null ? "这一维还有未评分项，不给维度分。" : "这一维已有分数 " + Q.fmt(dim.score, 2) + " / " + Q.fmt(dim.weight, 0) + "。"}</span></div>`;
        html += "</div>";
      }
      html += "</div>";
    });
    html += "</div></div>";
    html += scoreTable(c, state.compare ? company(state.compare) : null);
    const latestRows = [annual, latest].filter((row, index, list) => row && row.report_date && list.findIndex((x) => x.report_date === row.report_date) === index);
    const snapshotRows = latestRows.map((row) => `<tr><th>${Q.esc(row.report_date || row.year)}</th><td>${row.period === "quarterly_ytd" ? "年内累计" : "完整年"}</td><td>${Q.fmtYi(row.revenue)}</td><td>${Q.fmtYi(row.net_profit)}</td><td>${Q.fmtYi(row.cfo)}</td><td>${Q.fmtYi(row.owner_fcf)}</td><td>${Q.fmtPct(row.operating_margin)}</td><td>${Q.fmtYi(row.inventory)}</td><td>${Q.fmtYi(row.contract_liabilities)}</td></tr>`).join("");
    html += `<p class="note">雷达只画已有维度分的比例。明细分来自数据文件，页面不重算。${Q.esc(String(annual.year || score.annual_year || ""))} 完整年营收 ${Q.fmtYi(annual.revenue)} 亿元，净利 ${Q.fmtYi(annual.net_profit)} 亿元。</p>`;
    html += `<h3>财报快照</h3><div class="table-scroll"><table class="metric-table"><thead><tr><th>报告期</th><th>口径</th><th>营收（亿元）</th><th>归母净利（亿元）</th><th>经营现金流（亿元）</th><th>股东自由现金流（亿元）</th><th>营业利润率</th><th>存货（亿元）</th><th>合同负债（亿元）</th></tr></thead><tbody>${snapshotRows || "<tr><td colspan=\"9\">暂无财报</td></tr>"}</tbody></table></div>`;
    Q.el("overview-content").innerHTML = html;
    Q.el("overview-content").querySelectorAll("[data-dim]").forEach((node) => {
      node.addEventListener("click", () => {
        const key = node.getAttribute("data-dim");
        if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
        render();
      });
    });
    const labels = dims.map((d) => d.letter + " " + d.name);
    const data = dims.map((d) => (d.weight && d.score !== null ? +(d.score / d.weight * 100).toFixed(1) : null));
    lineWaitRadar(labels, data);
  }
  function scoreTable(c, cmp) {
    const anchors = state.model.score_anchors || {};
    const cmpItems = {};
    if (cmp) Q.dimensions(cmp).forEach((dim) => (dim.items || []).forEach((it) => { cmpItems[it.name] = it; }));
    const cols = cmp ? 8 : 7;
    let html = `<div class="table-scroll"><table class="metric-table score-table"><thead><tr><th>编号</th><th>打分项</th><th>数值</th><th>${Q.esc(c.name)}</th>`;
    if (cmp) html += `<th>${Q.esc(cmp.name)}</th>`;
    html += "<th>满分线</th><th>零分线</th><th>依据</th></tr></thead><tbody>";
    Q.dimensions(c).forEach((dim) => {
      const sub = dim.score === null ? "—" : Q.fmt(dim.score, 1);
      html += `<tr class="dim-row"><td colspan="${cols}">${dim.letter} ${Q.esc(dim.name)} — 小计 ${sub}/${Q.fmt(dim.weight, 0)} 分</td></tr>`;
      (dim.items || []).forEach((it, i) => {
        const anchor = anchors[it.name];
        const other = cmpItems[it.name];
        const scoreText = it.score == null ? "—" : Q.fmt(it.score, 2);
        html += `<tr class="row-primary"><td>${dim.letter}${i + 1}</td><td>${Q.esc(Q.itemLabel(it.name))}</td>`;
        html += `<td>${Q.esc(Q.fmtItemValue(it.name, it.value))}</td>`;
        html += `<td><strong>${scoreText}</strong> / ${Q.fmt(it.max, 0)}</td>`;
        if (cmp) html += `<td>${other && other.score != null ? Q.fmt(other.score, 2) + " / " + Q.fmt(other.max, 0) : "—"}</td>`;
        html += `<td>${anchor ? Q.esc(Q.fmtItemValue(it.name, anchor[1])) : "—"}</td>`;
        html += `<td>${anchor ? Q.esc(Q.fmtItemValue(it.name, anchor[0])) : "—"}</td>`;
        html += `<td><span class="basis-tag ${STATUS_CLASS[it.status] || "basis-unavailable"}" title="${Q.esc(Q.financialText(it.source))}">${Q.esc(STATUS_LABEL[it.status] || "未标注")}</span></td></tr>`;
      });
    });
    html += "</tbody></table></div>";
    return html;
  }
  function lineWaitRadar(labels, data) {
    const canvas = Q.el("chart-radar");
    if (!canvas) return;
    state.charts["chart-radar"] = new Chart(canvas, {
      type: "radar",
      data: { labels, datasets: [{ label: company(state.code).name, data, borderColor: COLOR, backgroundColor: "rgba(47,111,237,0.15)", spanGaps: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, backdropColor: "transparent" }, pointLabels: { font: { size: 11 } } } },
      },
    });
  }
  function renderTables() {
    ["scale", "profit", "cash", "risk", "channel"].forEach((group) => {
      Q.el(group + "-content").innerHTML = chartBlock(group);
      drawGroup(group);
    });
  }
  function renderDcf() {
    const c = company(state.code);
    const dcf = c.dcf || {};
    const div = c.dividend || {};
    const shares = c.shares || {};
    const base = Q.baseScenario(c);
    const bridge = dcf.bridge || [];
    const bridgeRows = bridge.map((row) => `<tr><td>${row.year}</td><td>${Q.fmtYi(row.cfo)}</td><td>${Q.fmtYi(row.capex)}</td><td>${Q.fmtYi(row.owner_fcf)}</td><td>${Q.fmtYi(row.fcff)}</td></tr>`).join("");
    const scenarioRows = (dcf.scenarios || []).map((s) => {
      const up = Q.num(s.upside);
      const a = s.assumptions || {};
      const discountRate = Q.num(a.discount_rate) === null ? a.wacc : a.discount_rate;
      const mos = Q.num(s.margin_of_safety);
      return `<tr><td>${Q.esc(s.name)}</td><td>${Q.fmt(a.growth * 100, 1)}%</td><td>${Q.fmt(a.terminal_growth * 100, 1)}%</td><td>${Q.fmt(discountRate * 100, 1)}%</td><td>${Q.fmt(s.value_per_share, 2)}</td><td>${up === null ? "—" : (up >= 0 ? "+" : "") + Q.fmt(up * 100, 1) + "%"}</td><td>${mos === null ? "—" : Q.fmt(mos * 100, 1) + "%"}</td></tr>`;
    }).join("");
    const sens = dcf.sensitivity || [];
    const baseSens = sens.filter((r) => Q.num(r.cash_flow_multiplier) === null || r.cash_flow_multiplier === 1);
    const sensRate = (r) => Q.num(r.effective_discount_rate) === null ? (Q.num(r.discount_rate) === null ? r.wacc : r.discount_rate) : r.effective_discount_rate;
    const waccs = Array.from(new Set(baseSens.map(sensRate))).sort((a, b) => a - b);
    const terms = Array.from(new Set(sens.map((r) => r.terminal_growth))).sort((a, b) => a - b);
    const rawRateKind = sens[0] && sens[0].rate_kind ? sens[0].rate_kind : "WACC";
    const rateKind = Q.financialText(rawRateKind);
    const sensHead = `<tr><th>永续增长 \\ ${Q.esc(rateKind)}</th>` + waccs.map((w) => `<th>${Q.fmt(w * 100, 1)}%</th>`).join("") + "</tr>";
    const sensBody = terms.map((t) => {
      const cells = waccs.map((w) => {
        const hit = baseSens.find((r) => sensRate(r) === w && r.terminal_growth === t);
        const mark = hit && hit.cash_flow_multiplier === 1 && t === 0.02 ? " style=\"font-weight:700\"" : "";
        return `<td${mark}>${hit ? Q.fmt(hit.value_per_share, 1) : "—"}</td>`;
      }).join("");
      return `<tr><th>${Q.fmt(t * 100, 0)}%</th>${cells}</tr>`;
    }).join("");
    const events = div.events || [];
    const eventRows = events.map((ev) => `<tr><td>${Q.esc(ev.report_date || "—")}</td><td>${Q.fmt(ev.cash_per_10_shares, 2)}</td><td>${ev.shares ? Q.fmt(ev.shares / 1e8, 4) : "—"}</td><td>${Q.esc(ev.ex_date || "—")}</td><td>${Q.esc(ev.description || ev.status || "—")}</td></tr>`).join("");
    const history = (div.history || []).filter((h) => h.year >= 2018);
    const histRows = history.map((h) => `<tr><td>${h.year}</td><td>${Q.fmt(h.cash_per_10, 2)}</td><td>${Q.fmt(h.dps, 2)}</td><td>${Q.fmt(h.year_end_price, 2)}</td><td>${Q.fmtPct(h.yield_pct)}</td><td>${Q.fmtPct(h.payout_pct)}</td></tr>`).join("");
    const multipliers = Array.from(new Set(sens.map((r) => r.cash_flow_multiplier).filter((v) => Q.num(v) !== null))).sort((a, b) => a - b);
    const targetRate = 0.1 + (rawRateKind === "成本权益率代理" ? 0.015 : 0);
    const multiplierRows = multipliers.map((m) => {
      const hit = sens.find((r) => r.cash_flow_multiplier === m && Math.abs(sensRate(r) - targetRate) < 1e-9 && r.terminal_growth === 0.02);
      return `<tr><th>${Q.fmt(m * 100, 0)}%</th><td>${hit ? Q.fmt(hit.value_per_share, 1) : "—"}</td></tr>`;
    }).join("");
    Q.el("dcf-content").innerHTML =
      `<div class="overall-bar"><div class="overall-title">估值</div><div class="overall-text">${Q.esc(Q.dcfStatus(dcf.status))}。收盘价 ${Q.fmt(c.price && c.price.close, 2)} 元（${Q.esc((c.price && c.price.price_date) || "未标注")}）。${dcf.price_comparable === true ? "基准每股价值 " + (base ? Q.fmt(base.value_per_share, 2) + " 元" : "未生成") : "当前每股值为未加净现金的企业价值代理，不和现价比较"}。总股本 ${shares.shares ? Q.fmt(shares.shares / 1e8, 4) + " 亿股" : "未取得"}，来源 ${Q.esc(shares.source || "未标注")}，日期 ${Q.esc(shares.source_date || "—")}。净现金 ${dcf.net_cash_status === "verified" ? "已核验" : "未计入（债务字段不完整）"}。${Q.esc(Q.financialText((dcf.missing || []).join("；")))}</div></div>` +
      `<p class="note">${Q.esc(Q.financialText(dcf.assumptions))}${dcf.cash_flow_uneven ? " 历史 企业自由现金流 波动较大，基数采用三年中位数。" : ""}</p>` +
      `<h3>现金流对照（亿元）</h3><div class="table-scroll"><table class="metric-table"><thead><tr><th>年份</th><th>经营现金流</th><th>资本开支</th><th>股东自由现金流</th><th>企业自由现金流</th></tr></thead><tbody>${bridgeRows || "<tr><td colspan=\"5\">无现金流</td></tr>"}</tbody></table></div>` +
      `<p class="note">股东自由现金流 = 经营现金流 - 资本开支；企业自由现金流 = 调整后息税前经营利润 × (1 - 税率) + 折旧摊销 - 资本开支 - 营运资金变化。现金流折现估值只取 2023A–2025A 连续三年中位数；企业自由现金流缺失或非正时回退股东自由现金流，并用股权资本成本代理。净现金只有四个资产负债表字段均已核验才加入。</p>` +
      `<p class="note">折现基数是 ${Q.esc(Q.financialText(dcf.base_label || "2023-2025 现金流中位数"))} ${Q.fmtYi(dcf.base_cash_flow_CNY)} 亿元（${Q.esc((dcf.base_years || [2023, 2024, 2025]).join("、"))}）。预测期 5 年，增长率逐年收敛到永续增长；第一张敏感度表固定现金流基数，第二张检验现金流基数 ±10%。</p>` +
      `<h3>三种情景</h3><div class="table-scroll"><table class="metric-table"><thead><tr><th>情景</th><th>增长率</th><th>永续增长</th><th>折现率</th><th>每股价值</th><th>相对现价</th><th>安全边际</th></tr></thead><tbody>${scenarioRows || "<tr><td colspan=\"7\">中位数不为正，或缺少股本，不外推每股价值。</td></tr>"}</tbody></table></div>` +
      (sens.length ? `<h3>敏感度：每股价值（元）</h3><div class="table-scroll"><table class="metric-table"><thead>${sensHead}</thead><tbody>${sensBody}</tbody></table></div><div class="table-scroll"><table class="metric-table"><thead><tr><th>现金流基数</th><th>${Q.esc(rateKind)} ${Q.fmt(targetRate * 100, 1)}% / 2%永续增长</th></tr></thead><tbody>${multiplierRows}</tbody></table></div>` : "") +
      `<h3>${div.year || "—"} 年股息</h3><p class="note">${Q.esc(div.method || "")} 股息率 ${Q.fmtPct(div.yield_pct)}，作为参考展示，不进入质量分。每股分红 ${Q.fmt(div.dps, 2)} 元，年度合计 ${Q.fmt(div.cash_per_10, 2)} 元/10 股，分红率 ${Q.fmtPct(div.payout_pct)}。${Q.esc(div.share_note || "")}</p>` +
      `<div class="table-scroll"><table class="metric-table"><thead><tr><th>报告期</th><th>元/10股</th><th>总股本（亿股）</th><th>除权日</th><th>方案</th></tr></thead><tbody>${eventRows || "<tr><td colspan=\"5\">该年没有已实施的现金分红，股息率记 0。</td></tr>"}</tbody></table></div>` +
      `<h3>历年股息（年末收盘价）</h3><div class="table-scroll"><table class="metric-table"><thead><tr><th>年份</th><th>元/10股合计</th><th>每股分红</th><th>年末收盘价</th><th>年末股息率</th><th>分红率</th></tr></thead><tbody>${histRows}</tbody></table></div>`;
  }
  function renderQual() {
    const c = company(state.code);
    const year = c.score && c.score.annual_year;
    const fields = (c.provenance && c.provenance.fields) || {};
    const keys = ["revenue", "net_profit", "gross_margin", "gross_sales_spread", "operating_margin", "nonrecurring_ratio", "net_margin", "roe", "roic", "return_on_capital", "sales_cash_ratio", "cfo_profit", "owner_fcf", "owner_fcf_to_profit", "fcf_to_revenue", "cfo", "debt_to_asset", "cash_to_current_liab", "cfo_to_current_liab", "inventory_receivables_to_revenue", "other_receivables_to_asset", "receivables_to_revenue", "capex", "fcff", "cash", "short_debt", "long_debt", "bonds", "contract_liabilities", "inventory", "receivables", "sales_expense"];
    const rows = keys.map((key) => {
      const rec = fields[year + "-12-31." + key] || fields[year + "." + key];
      return `<tr><td>${Q.esc(Q.itemLabel(key))}</td><td>${rec ? Q.esc(Q.financialText(rec.provider || "已标注")) : "无字段证据"}</td><td>${rec ? Q.esc(rec.file || rec.column || "—") : "—"}</td></tr>`;
    }).join("");
    const refs = Q.references(c).map((item) => {
      const evidence = item.evidence || [];
      const text = evidence.map((ev) => ev.observation).join("；") || "暂无核验证据";
      const source = evidence.map((ev) => (ev.source || "") + (ev.source_date ? " " + ev.source_date : "")).join("；") || "—";
      return `<tr><td>${Q.esc(Q.itemLabel(item.name))}</td><td>参考</td><td>${Q.esc(text)}</td><td>${Q.esc(source)}</td></tr>`;
    }).join("");
    Q.el("qual-content").innerHTML =
      `<div class="qual-note"><p>抗周期、产品结构、渠道健康、资本配置、治理不进入质量打分，放在这里作参考。有核验证据才写观察，没有就留空。</p><p>打分假设：${Q.esc(Q.financialText((c.score && c.score.assumptions) || "未标注"))}</p></div>` +
      `<div class="table-scroll"><table class="metric-table"><thead><tr><th>参考项</th><th>角色</th><th>观察</th><th>来源</th></tr></thead><tbody>${refs}</tbody></table></div>` +
      `<div class="table-scroll"><table class="metric-table"><thead><tr><th>财务字段</th><th>${Q.esc(year || "基准年")} 证据</th><th>来源</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function renderDates() {
    const c = company(state.code);
    const latest = c.latest || {};
    Q.el("page-title").textContent = c.name + "（" + c.code + "）深度分析";
    Q.el("stock-data-dates").textContent = "最新报告期：" + (latest.report_date || "未标注") + (latest.period === "quarterly_ytd" ? "（年内累计）" : "");
    Q.el("stock-score-date").textContent = "打分基准年：" + ((c.score && c.score.annual_year) || "未标注") + " 完整年";
    Q.el("generated-at").textContent = "页面数据生成：" + state.generatedAt;
    Q.el("stock-date-summary").textContent = "· 打分基准年：" + ((c.score && c.score.annual_year) || "未标注");
  }
  function renderPnl() {
    const box = Q.el("pnl-content");
    const pack = state.pnl[state.code];
    if (!pack || !window.LiquorSankey) {
      box.innerHTML = '<p class="placeholder">暂无利润流向数据。</p>';
      return;
    }
    const years = pack.year_list || [];
    if (!years.includes(state.pnlYear)) state.pnlYear = years[years.length - 1] || "";
    const shown = years.slice(-4);
    const prev = years[years.indexOf(state.pnlYear) - 1] || "";
    window.LiquorSankey.render(box, {
      pack,
      year: state.pnlYear,
      prevYear: prev,
      yearList: shown,
      name: company(state.code).name,
      onYearChange: (year) => { state.pnlYear = year; renderPnl(); },
    });
  }
  function render() {
    if (Q.collapseChartZoom) Q.collapseChartZoom();
    destroyCharts();
    renderDates();
    renderOverview();
    renderPnl();
    renderTables();
    renderDcf();
    renderQual();
    if (Q.bindChartZoomAll) Q.bindChartZoomAll(Q.el("main-content"));
  }
  function fillSelects() {
    const primary = Q.el("primary-select");
    const compare = Q.el("compare-select");
    primary.innerHTML = "";
    compare.innerHTML = '<option value="">无对比</option>';
    state.companies.forEach((c) => {
      primary.appendChild(new Option(c.name + "（" + c.code + "）", c.code));
      compare.appendChild(new Option(c.name + "（" + c.code + "）", c.code));
    });
    primary.value = state.code;
    compare.value = state.compare;
  }
  function syncUrl() {
    const params = new URLSearchParams();
    if (state.code) params.set("code", state.code);
    if (state.compare) params.set("compare", state.compare);
    history.replaceState({}, "", location.pathname + "?" + params.toString());
  }
  Promise.all([Q.readJson("./data.json?v=15"), Q.readJson("./pnl.json?v=3")]).then(([data, pnl]) => {
    state.pnl = pnl || {};
    state.generatedAt = data.generated_at || "未标注";
    state.model = data.model || {};
    state.companies = (data.companies || []).filter((c) => Q.CODES.includes(String(c.code)));
    const params = new URLSearchParams(location.search);
    state.code = Q.CODES.includes(params.get("code")) ? params.get("code") : state.companies[0].code;
    state.compare = Q.CODES.includes(params.get("compare")) ? params.get("compare") : "";
    if (state.compare === state.code) state.compare = "";
    Q.el("load-error").classList.add("hidden");
    Q.el("main-content").classList.remove("hidden");
    fillSelects();
    Q.el("primary-select").addEventListener("change", (e) => {
      state.code = e.target.value;
      state.pnlYear = "";
      if (state.compare === state.code) state.compare = "";
      fillSelects();
      syncUrl();
      render();
    });
    Q.el("compare-select").addEventListener("change", (e) => {
      state.compare = e.target.value === state.code ? "" : e.target.value;
      fillSelects();
      syncUrl();
      render();
    });
    Q.el("range-select").addEventListener("change", (e) => { state.range = e.target.value; render(); });
    document.querySelectorAll(".group-nav-item").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".group-nav-item").forEach((n) => n.classList.remove("active"));
        link.classList.add("active");
        const target = document.querySelector(link.getAttribute("href"));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    render();
  }).catch((err) => {
    console.error(err);
    Q.el("load-error").classList.remove("hidden");
  });
})();
