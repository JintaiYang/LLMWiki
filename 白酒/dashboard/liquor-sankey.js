(function (global) {
  "use strict";

  const COLORS = {
    blue: "#2f6fed",
    cyan: "#0ea5e9",
    purple: "#8b5cf6",
    orange: "#f59e0b",
    yellow: "#ca8a04",
    red: "#d1453b",
    gray: "#6b7280",
    green: "#1a9e5c",
  };

  function nz(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function fmtYi(n) {
    return Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "亿";
  }
  function pct(n, d) {
    if (!d) return "—";
    return ((n / d) * 100).toFixed(1) + "%";
  }
  function fmtYoy(cur, prev) {
    if (prev == null || !Number.isFinite(prev)) return "同比 —（上年无此流向）";
    if (prev === 0) return "同比 —";
    const r = ((cur - prev) / Math.abs(prev)) * 100;
    return "同比 " + (r > 0 ? "+" : "") + r.toFixed(1) + "%";
  }
  function ribbon(x0, y0, x1, y1, w) {
    const mid = (x0 + x1) / 2;
    const t = Math.max(w / 2, 0.6);
    return "M " + x0 + " " + (y0 - t) + " C " + mid + " " + (y0 - t) + " " + mid + " " + (y1 - t) + " " + x1 + " " + (y1 - t)
      + " L " + x1 + " " + (y1 + t) + " C " + mid + " " + (y1 + t) + " " + mid + " " + (y0 + t) + " " + x0 + " " + (y0 + t) + " Z";
  }

  function buildFlow(d) {
    const MIN = Math.min(0.5, Math.max(Math.abs(nz(d.total) || nz(d.revenue)) * 0.0005, 0.005));
    const revenue = nz(d.revenue);
    const interest = Math.max(nz(d.interest), 0);
    const otherIn = Math.max(nz(d.total) - revenue - interest, 0);
    const gross = revenue + interest + otherIn;
    const financeGain = nz(d.finance) < -MIN ? -nz(d.finance) : 0;
    const financeCost = nz(d.finance) > MIN ? nz(d.finance) : 0;
    const costs = [
      ["cogs", "营业成本", "orange", nz(d.cogs)],
      ["taxAdd", "税金及附加", "yellow", nz(d.tax_add)],
      ["sale", "销售费用", "orange", nz(d.sale)],
      ["manage", "管理费用", "yellow", nz(d.manage)],
      ["research", "研发费用", "gray", nz(d.research)],
      ["impair", "减值损失", "red", Math.max(nz(d.impair_asset), 0) + Math.max(nz(d.impair_credit), 0)],
      ["financeCost", "财务费用", "gray", financeCost],
    ].filter((row) => row[3] >= MIN);
    const named = costs.reduce((sum, row) => sum + row[3], 0);
    const op = nz(d.operate_profit);
    const residual = +(gross + financeGain - named - op).toFixed(2);
    const extraCost = residual > MIN ? residual : 0;
    const extraGain = residual < -MIN ? -residual : 0;
    const opFromGross = Math.max(op - financeGain - extraGain, 0);

    const nodes = [{ id: "revenue", label: "营业收入", col: 0, color: "blue" }];
    if (interest >= MIN) nodes.push({ id: "interest", label: "利息收入", col: 0, color: "cyan" });
    if (otherIn >= MIN) nodes.push({ id: "otherIn", label: "其他经营收入", col: 0, color: "purple" });
    nodes.push({ id: "gross", label: "营业总收入", col: 1, color: "cyan" });
    if (financeGain >= MIN) nodes.push({ id: "financeGain", label: "财务收益", col: 1, color: "green" });
    if (extraGain >= MIN) nodes.push({ id: "extraGain", label: "其他收益", col: 1, color: "purple" });
    costs.forEach((row) => nodes.push({ id: row[0], label: row[1], col: 2, color: row[2] }));
    if (extraCost >= MIN) nodes.push({ id: "extraCost", label: "其他支出", col: 2, color: "gray" });
    nodes.push({ id: "op", label: "营业利润", col: 2, color: op < 0 ? "red" : "green", reported: op });

    const pretax = nz(d.total_profit);
    const nonop = +(pretax - op).toFixed(2);
    nodes.push({ id: "pretax", label: "利润总额", col: 3, color: pretax < 0 ? "red" : "green", reported: pretax });
    if (nonop < -MIN) nodes.push({ id: "nonop", label: "营业外净支出", col: 3, color: "gray" });
    if (nonop > MIN) nodes.push({ id: "nonopIn", label: "营业外净收益", col: 2, color: "purple" });
    if (nz(d.tax) >= MIN) nodes.push({ id: "tax", label: "所得税", col: 4, color: "gray" });
    nodes.push({ id: "parent", label: "归母净利润", col: 4, color: nz(d.parent) < 0 ? "red" : "green", reported: nz(d.parent) });
    if (nz(d.minority) >= MIN) nodes.push({ id: "minority", label: "少数股东", col: 4, color: "gray" });

    const links = [];
    if (revenue > 0) links.push({ source: "revenue", target: "gross", value: revenue });
    if (interest >= MIN) links.push({ source: "interest", target: "gross", value: interest });
    if (otherIn >= MIN) links.push({ source: "otherIn", target: "gross", value: otherIn });
    costs.forEach((row) => links.push({ source: "gross", target: row[0], value: row[3] }));
    if (extraCost >= MIN) links.push({ source: "gross", target: "extraCost", value: extraCost });
    if (opFromGross > 0.05) links.push({ source: "gross", target: "op", value: +opFromGross.toFixed(2) });
    if (financeGain >= MIN) links.push({ source: "financeGain", target: "op", value: financeGain });
    if (extraGain >= MIN) links.push({ source: "extraGain", target: "op", value: extraGain });

    const opToPretax = nonop < -MIN ? pretax : Math.min(op, pretax);
    if (opToPretax > 0.05) links.push({ source: "op", target: "pretax", value: +opToPretax.toFixed(2) });
    if (nonop < -MIN) links.push({ source: "op", target: "nonop", value: +(-nonop).toFixed(2) });
    if (nonop > MIN) links.push({ source: "nonopIn", target: "pretax", value: +nonop.toFixed(2) });

    const tax = Math.max(nz(d.tax), 0);
    const parent = Math.max(nz(d.parent), 0);
    const minority = Math.max(nz(d.minority), 0);
    if (tax >= MIN) links.push({ source: "pretax", target: "tax", value: tax });
    links.push({ source: "pretax", target: "parent", value: parent });
    if (minority >= MIN) links.push({ source: "pretax", target: "minority", value: minority });
    return { nodes, links, gross, parent: nz(d.parent), op };
  }

  function mapsOf(flow) {
    const nodeValue = {};
    const linkValue = {};
    flow.nodes.forEach((n) => { nodeValue[n.id] = 0; });
    flow.links.forEach((l) => {
      linkValue[l.source + "|" + l.target] = l.value;
      nodeValue[l.source] = Math.max(nodeValue[l.source] || 0, 0);
    });
    const inn = {};
    const out = {};
    flow.links.forEach((l) => {
      out[l.source] = (out[l.source] || 0) + l.value;
      inn[l.target] = (inn[l.target] || 0) + l.value;
    });
    flow.nodes.forEach((n) => { nodeValue[n.id] = n.reported ?? Math.max(inn[n.id] || 0, out[n.id] || 0); });
    return { nodeValue, linkValue };
  }

  function layout(nodes, links) {
    const W = 1180;
    const H = 640;
    const left = 148;
    const right = 150;
    const top = 24;
    const nodeW = 14;
    const gap = 10;
    const colCount = 5;
    const inner = W - left - right - nodeW;
    const colX = (c) => left + (c * inner) / (colCount - 1);
    const inn = {};
    const out = {};
    const valueOf = {};
    nodes.forEach((n) => { inn[n.id] = 0; out[n.id] = 0; });
    links.forEach((l) => {
      out[l.source] = (out[l.source] || 0) + l.value;
      inn[l.target] = (inn[l.target] || 0) + l.value;
    });
    nodes.forEach((n) => { valueOf[n.id] = Math.max(inn[n.id] || 0, out[n.id] || 0, Math.abs(n.reported || 0)); });
    const byCol = [[], [], [], [], []];
    nodes.forEach((n) => byCol[n.col].push(n));
    let maxCol = 1;
    byCol.forEach((col) => {
      const sum = col.reduce((a, n) => a + (valueOf[n.id] || 0), 0);
      const gaps = Math.max(col.length - 1, 0);
      maxCol = Math.max(maxCol, sum);
      col._gaps = gaps;
    });
    const maxGaps = Math.max(...byCol.map((col) => col._gaps || 0), 2);
    const scale = (H - top - 16 - gap * maxGaps) / maxCol;
    const pos = {};
    const laid = [];
    byCol.forEach((col) => {
      let y = top;
      let lastLabel = -999;
      col.forEach((n) => {
        const h = Math.max((valueOf[n.id] || 0) * scale, 2);
        let labelY = y + Math.min(h * 0.35, 16) + 4;
        if (labelY - lastLabel < 13) labelY = lastLabel + 13;
        lastLabel = labelY;
        const node = { ...n, value: valueOf[n.id] || 0, x: colX(n.col), y, w: nodeW, h, labelY };
        laid.push(node);
        pos[n.id] = node;
        y += h + gap;
      });
    });
    const srcOff = {};
    const tgtOff = {};
    const laidLinks = [];
    links.forEach((l) => {
      const s = pos[l.source];
      const t = pos[l.target];
      if (!s || !t || l.value < 0.05) return;
      const w = Math.max(l.value * scale, 1.2);
      srcOff[s.id] = srcOff[s.id] || 0;
      tgtOff[t.id] = tgtOff[t.id] || 0;
      const y0 = s.y + srcOff[s.id] + w / 2;
      const y1 = t.y + tgtOff[t.id] + w / 2;
      srcOff[s.id] += w;
      tgtOff[t.id] += w;
      laidLinks.push({
        ...l,
        width: w,
        color: s.color,
        cx: (s.x + s.w + t.x) / 2,
        cy: (y0 + y1) / 2,
        path: ribbon(s.x + s.w, y0, t.x, y1, w),
        hitPath: ribbon(s.x + s.w, y0, t.x, y1, Math.max(w, 12)),
      });
    });
    return { W, H, laidNodes: laid, laidLinks };
  }

  function labelOf(nodes, id) {
    const n = nodes.find((x) => x.id === id);
    return n ? n.label : id;
  }

  function render(container, opts) {
    const pack = opts.pack;
    const d = pack && pack.years ? pack.years[opts.year] : null;
    if (!d) {
      container.innerHTML = '<p class="placeholder">该年份暂无利润流向。</p>';
      return;
    }
    if (["revenue", "total", "operate_profit", "total_profit", "parent"].some((key) => d[key] == null || !Number.isFinite(Number(d[key])))) {
      container.innerHTML = '<p class="score-caption">该年度核心利润数据不完整，暂不绘制桑基图。</p>';
      return;
    }
    const flow = buildFlow(d);
    const prev = opts.prevYear && pack.years[opts.prevYear] ? buildFlow(pack.years[opts.prevYear]) : null;
    const curMaps = mapsOf(flow);
    const prevMaps = prev ? mapsOf(prev) : { nodeValue: {}, linkValue: {} };
    const laid = layout(flow.nodes, flow.links);
    const years = [...new Set([...(opts.yearList || []), opts.year])].map(String).sort();
    const currentIndex = years.indexOf(String(opts.year));
    const yearOptions = years.slice().reverse().map((y) => '<option value="' + y + '"' + (y === String(opts.year) ? ' selected' : '') + '>' + y + '年报</option>').join('');
    const revenueParts = ['<span>营业收入 <b>' + fmtYi(d.revenue) + '</b></span>'];
    const interest = d.interest == null ? 0 : Number(d.interest);
    const otherIncome = Math.round((d.total - d.revenue - interest) * 100) / 100;
    for (const [label, value] of [["利息收入", interest], ["其他经营收入", otherIncome]]) {
      if (Math.abs(value) >= 0.01) revenueParts.push('<span>' + (value < 0 ? ' − ' : ' + ') + label + ' <b>' + fmtYi(Math.abs(value)) + '</b></span>');
    }
    const reconciliation = revenueParts.length === 1
      ? '<span>营业收入与营业总收入均为 <b>' + fmtYi(d.revenue) + '</b></span>'
      : revenueParts.join('') + '<span> = 营业总收入 <b>' + fmtYi(d.total) + '</b></span>';
    container.innerHTML = ''
      + '<div class="pnl-toolbar"><label class="pnl-year-control">财报年度<select class="pnl-year-select" aria-label="桑基图财报年度">' + yearOptions + '</select></label><div class="pnl-year-navigation"><button type="button" class="icon-button" data-year-step="-1" title="上一年" aria-label="上一年"' + (currentIndex <= 0 ? ' disabled' : '') + '><i data-lucide="chevron-left"></i></button><button type="button" class="icon-button" data-year-step="1" title="下一年" aria-label="下一年"' + (currentIndex >= years.length - 1 ? ' disabled' : '') + '><i data-lucide="chevron-right"></i></button></div></div>'
      + '<div class="pnl-reconciliation"><span class="pnl-reconciliation-year">' + opts.year + '年报口径</span>' + reconciliation + '</div>'
      + '<div class="pnl-chart-head"><span>' + opts.year + '年报利润流向</span><span class="pnl-chart-head-note">悬停色带：金额、占上一节点、同比</span></div>'
      + '<div class="pnl-chart-wrap"><svg viewBox="0 0 ' + laid.W + " " + laid.H + '" width="100%" role="img" aria-label="' + (opts.name || "") + '利润流向桑基图" class="pnl-svg"></svg><div class="pnl-tip hidden"></div></div>'
      + '<p class="pnl-caption">来自利润表年报，单位亿元。负的财务费用列为财务收益；小额及未单列项目归入其他净额。</p>'
      + (flow.parent < 0 || flow.op < 0 ? '<p class="pnl-loss-note">亏损节点以红色及报表负值标注；色带仅展示正向收入和支出，不将亏损绘制为正向利润流入。</p>' : "");

    const svg = container.querySelector(".pnl-svg");
    const tipEl = container.querySelector(".pnl-tip");
    const ns = "http://www.w3.org/2000/svg";

    function setTip(h) {
      laid.laidLinks.forEach((l) => {
        const on = !h || (h.kind === "link" ? l.source === h.source && l.target === h.target : l.source === h.id || l.target === h.id);
        l.el.setAttribute("fill-opacity", h ? (on ? "0.55" : "0.08") : "0.28");
      });
      laid.laidNodes.forEach((n) => {
        const on = !h || (h.kind === "node" ? n.id === h.id : h.source === n.id || h.target === n.id);
        n.el.setAttribute("opacity", on ? "1" : "0.25");
      });
      if (!h) {
        tipEl.classList.add("hidden");
        return;
      }
      const title = h.kind === "link"
        ? labelOf(flow.nodes, h.source) + " → " + labelOf(flow.nodes, h.target)
        : h.label;
      const amount = fmtYi(h.value);
      const share = h.kind === "link"
        ? "占" + labelOf(flow.nodes, h.source) + " " + pct(h.value, curMaps.nodeValue[h.source])
        : "";
      const yoy = h.kind === "link"
        ? fmtYoy(h.value, prevMaps.linkValue[h.source + "|" + h.target])
        : fmtYoy(h.value, prevMaps.nodeValue[h.id]);
      tipEl.innerHTML = '<div class="pnl-tip-title">' + title + "</div><div>金额 " + amount + "</div>"
        + (share ? "<div>" + share + "</div>" : "") + "<div>" + yoy + "</div>";
      tipEl.classList.remove("hidden");
      const item = h.kind === "link"
        ? laid.laidLinks.find((l) => l.source === h.source && l.target === h.target)
        : laid.laidNodes.find((n) => n.id === h.id);
      const wrap = container.querySelector(".pnl-chart-wrap");
      const rect = wrap.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const sx = svgRect.width / laid.W;
      const sy = svgRect.height / laid.H;
      const cx = item && item.cx != null ? item.cx : item ? item.x : laid.W / 2;
      const cy = item && item.cy != null ? item.cy : item ? item.y : 24;
      tipEl.style.left = Math.max(wrap.scrollLeft + 8, Math.min(svgRect.left - rect.left + wrap.scrollLeft + cx * sx - 110, wrap.scrollLeft + wrap.clientWidth - 240)) + "px";
      tipEl.style.top = Math.max(8, Math.min(svgRect.top - rect.top + cy * sy - 90, rect.height - 110)) + "px";
    }

    laid.laidLinks.forEach((l) => {
      const g = document.createElementNS(ns, "g");
      const hit = document.createElementNS(ns, "path");
      hit.setAttribute("d", l.hitPath);
      hit.setAttribute("fill", "#fff");
      hit.setAttribute("fill-opacity", "0");
      const vis = document.createElementNS(ns, "path");
      vis.setAttribute("d", l.path);
      vis.setAttribute("fill", COLORS[l.color] || COLORS.gray);
      vis.setAttribute("fill-opacity", "0.28");
      vis.style.pointerEvents = "none";
      l.el = vis;
      g.appendChild(hit);
      g.appendChild(vis);
      g.addEventListener("mouseenter", () => setTip({ kind: "link", source: l.source, target: l.target, value: l.value }));
      g.addEventListener("mouseleave", () => setTip(null));
      svg.appendChild(g);
    });
    laid.laidNodes.forEach((n) => {
      const g = document.createElementNS(ns, "g");
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", n.x);
      rect.setAttribute("y", n.y);
      rect.setAttribute("width", n.w);
      rect.setAttribute("height", n.h);
      rect.setAttribute("rx", "2");
      rect.setAttribute("fill", COLORS[n.color] || COLORS.gray);
      n.el = rect;
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", n.col === 0 ? n.x - 8 : n.x + n.w + 8);
      text.setAttribute("y", n.labelY);
      text.setAttribute("text-anchor", n.col === 0 ? "end" : "start");
      text.setAttribute("fill", "#1f2430");
      text.setAttribute("font-size", "12");
      text.setAttribute("font-weight", n.id === "parent" ? "700" : "400");
      text.style.pointerEvents = "none";
      text.textContent = n.label + " " + fmtYi(n.reported ?? n.value);
      rect.addEventListener("mouseenter", () => setTip({ kind: "node", id: n.id, label: n.label, value: n.reported ?? n.value }));
      rect.addEventListener("mouseleave", () => setTip(null));
      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);
    });
    const chooseYear = (year, selector) => {
      if (!year || !opts.onYearChange) return;
      opts.onYearChange(year);
      const updated = container.id ? document.getElementById(container.id) : container;
      const control = updated?.querySelector(selector);
      (control && !control.disabled ? control : updated?.querySelector(".pnl-year-select"))?.focus({ preventScroll: true });
    };
    container.querySelector(".pnl-year-select").onchange = (event) => chooseYear(event.target.value, ".pnl-year-select");
    container.querySelectorAll("[data-year-step]").forEach((button) => {
      button.onclick = () => chooseYear(years[currentIndex + Number(button.dataset.yearStep)], '[data-year-step="' + button.dataset.yearStep + '"]');
    });
    global.lucide?.createIcons();
  }

  global.LiquorSankey = { render };
})(window);
