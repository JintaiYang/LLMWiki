(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LiquorKnowledge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normalizePeriod = (period) => /^\d{4}$/.test(String(period)) ? period + "-12-31" : period;
  const periodLabel = (p) => p.slice(0, 4) + "年" + ({ "12-31": "年报", "03-31": "一季报", "06-30": "中报", "09-30": "三季报" }[p.slice(5)] || p);
  function matches(entry, filters = {}) {
    if (filters.company && entry.company && entry.company !== filters.company) return false;
    if (filters.metric && !entry.metrics.includes(filters.metric)) return false;
    if (filters.kind && entry.kind !== filters.kind) return false;
    if (filters.status && entry.status !== filters.status) return false;
    if (filters.period && entry.kind !== "general" && !entry.periods.includes(normalizePeriod(filters.period))) return false;
    const q = String(filters.query || "").trim().toLowerCase();
    return !q || [entry.title, entry.summary, entry.answer, entry.inference, entry.caveats, ...(entry.metrics || [])].join(" ").toLowerCase().includes(q);
  }
  function href(filters = {}, id = "") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, k === "period" ? normalizePeriod(v) : v);
    return "knowledge.html" + (params.size ? "?" + params : "") + (id ? "#" + encodeURIComponent(id) : "");
  }
  function related(pack, company, metric, period) {
    return (pack?.entries || []).filter((e) => matches(e, { company, metric, period })).sort((a, b) => Number(b.kind === "report") - Number(a.kind === "report"));
  }
  function metricLink(pack, company, metric, period) {
    const count = related(pack, company, metric, period).length;
    return `<a class="metric-knowledge-link" href="${esc(href({ company, metric, period }))}" title="${esc(periodLabel(normalizePeriod(period)))} · ${count} 条适用知识" aria-label="查看${esc(metric)}财务知识，${count}条"><i data-lucide="book-open"></i><span>${count || ""}</span></a>`;
  }
  return { esc, normalizePeriod, periodLabel, matches, href, related, metricLink };
});
