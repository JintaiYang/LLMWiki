(function () {
  "use strict";
  const K = window.LiquorKnowledge, esc = K.esc;
  const $ = (id) => document.getElementById(id);
  const root = $("workspace"), params = new URLSearchParams(location.search);
  const state = { pack: null, financial: null, api: false, selected: decodeURIComponent(location.hash.slice(1)), filters: { company: params.get("company") || params.get("code") || "", metric: params.get("metric") || "", period: params.get("period") || "", kind: params.get("kind") || "", query: params.get("q") || "" } };
  const statuses = { verified: "已核对原文", method: "通用方法", pending: "待核验" };
  const companyName = (code) => state.financial.companies.find((c) => c.code === code)?.name || "全部公司";
  const metricName = (key) => state.financial.financial_metrics.metrics[key]?.label || key;
  const options = (list, value) => list.map(([id, label]) => `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(label)}</option>`).join("");
  const paragraphs = (text) => String(text || "").split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p).replaceAll("\n", "<br>")}</p>`).join("");
  const periodList = () => [...new Set([...state.financial.companies.flatMap((c) => [...(c.annual || []).map((r) => r.report_date), ...(c.quarterly || []).map((r) => r.report_date)]), ...state.pack.entries.flatMap((e) => [...e.periods, ...e.reference_periods])].filter(Boolean))].sort().reverse();
  const filtered = () => state.pack.entries.filter((e) => K.matches(e, state.filters)).sort((a, b) => Number(b.kind === "report") - Number(a.kind === "report") || b.updated_at.localeCompare(a.updated_at) || a.title.localeCompare(b.title, "zh"));
  function updateUrl() {
    const url = new URL(location.href); url.search = "";
    for (const [key, value] of Object.entries(state.filters)) if (value) url.searchParams.set(key === "query" ? "q" : key, value);
    url.hash = state.selected;
    history.replaceState({}, "", url);
  }
  function renderShell() {
    const metrics = Object.values(state.financial.financial_metrics.metrics);
    root.innerHTML = `<header class="page-head"><div><h1>财务知识库</h1><div class="meta"><span>${state.pack.entries.length} 条知识</span><span>更新 ${esc(state.pack.updated_at.slice(0, 10))}</span></div></div><div class="knowledge-actions"><button id="knowledge-new" class="primary"><i data-lucide="plus"></i>新增条目</button><button id="knowledge-export" class="icon-button" aria-label="导出知识库" title="导出知识库"><i data-lucide="download"></i></button></div></header>
      <div class="knowledge-filters"><label>搜索<input id="knowledge-query" type="search" placeholder="问题、术语、解读" value="${esc(state.filters.query)}"></label><label>公司<select id="knowledge-company">${options([["", "全部公司"], ...state.financial.companies.map((c) => [c.code, c.name])], state.filters.company)}</select></label><label>财务指标<select id="knowledge-metric">${options([["", "全部指标"], ...metrics.map((m) => [m.key, m.label])], state.filters.metric)}</select></label><label>适用报告期<select id="knowledge-period">${options([["", "全部报告期"], ...periodList().map((p) => [p, K.periodLabel(p)])], state.filters.period)}</select></label><label>条目类型<select id="knowledge-kind">${options([["", "全部类型"], ["report", "报告期解读"], ["general", "通用口径"]], state.filters.kind)}</select></label></div>
      <p id="knowledge-status" class="knowledge-status" role="status">${state.api ? "" : "当前为只读快照，新增及编辑需使用本地研究服务。"}</p>
      <div class="knowledge-layout"><aside class="knowledge-index" aria-label="知识条目"><div class="knowledge-index-heading"><h2>问题与指标解读</h2><span id="knowledge-count"></span><button id="knowledge-reset" class="icon-button" title="清除筛选" aria-label="清除筛选"><i data-lucide="filter-x"></i></button></div><div id="knowledge-list"></div></aside><article id="knowledge-article" class="knowledge-article"></article></div>`;
    root.setAttribute("aria-busy", "false");
    $("knowledge-new").disabled = !state.api;
    $("knowledge-new").onclick = () => editEntry(null);
    $("knowledge-export").onclick = () => {
      const blob = new Blob([JSON.stringify(state.pack, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "财务知识库-" + state.pack.updated_at.slice(0, 10) + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $("knowledge-query").oninput = (event) => { state.filters.query = event.target.value; renderResults(); };
    for (const key of ["company", "metric", "period", "kind"]) $("knowledge-" + key).onchange = (event) => { state.filters[key] = event.target.value; renderResults(); };
    $("knowledge-reset").onclick = () => { for (const key in state.filters) state.filters[key] = ""; state.selected = ""; renderShell(); };
    renderResults();
  }
  function renderResults() {
    const entries = filtered();
    if (!entries.some((e) => e.id === state.selected)) state.selected = entries[0]?.id || "";
    $("knowledge-count").textContent = entries.length + " / " + state.pack.entries.length;
    $("knowledge-list").innerHTML = entries.map((e) => `<a class="knowledge-item${e.id === state.selected ? " active" : ""}" href="#${esc(e.id)}" data-entry-id="${esc(e.id)}"${e.id === state.selected ? ' aria-current="true"' : ""}><strong>${esc(e.title)}</strong><small>${esc(companyName(e.company))} · ${e.kind === "general" ? "通用口径" : e.periods.map(K.periodLabel).join("、")}</small></a>`).join("") || '<p class="knowledge-empty">没有匹配的条目</p>';
    $("knowledge-list").querySelectorAll("[data-entry-id]").forEach((a) => { a.onclick = (event) => {
      event.preventDefault(); state.selected = a.dataset.entryId; renderResults();
      if (matchMedia("(max-width:700px)").matches) $("knowledge-article").scrollIntoView({ behavior: "smooth", block: "start" });
    }; });
    renderArticle(entries.find((e) => e.id === state.selected));
    updateUrl(); window.lucide?.createIcons();
    window.LiquorNavigation?.update({ code: state.filters.company || "600519", version: "V5" });
  }
  function renderArticle(entry) {
    const host = $("knowledge-article");
    if (!entry) { host.innerHTML = '<div class="knowledge-empty"><p>当前筛选下暂无财务知识。</p></div>'; return; }
    const sourceLinks = entry.sources.map((ref) => {
      const source = state.pack.sources.find((s) => s.id === ref.source_id);
      const page = ref.pages.match(/\d+/)?.[0];
      return `<li><a href="/api/knowledge/source/${encodeURIComponent(ref.source_id)}${page ? "#page=" + page : ""}" target="_blank" rel="noreferrer">${esc(source?.title || ref.source_id)}<i data-lucide="external-link" width="13" height="13"></i></a><small>核对页码：${esc(ref.pages || "全文")}</small></li>`;
    }).join("");
    const relatedPeriods = entry.kind === "report" ? entry.periods : state.filters.period ? [state.filters.period] : [];
    const backLinks = entry.company ? relatedPeriods.map((period) => `<a href="stock.html?${new URLSearchParams({ code: entry.company, report: period.endsWith("12-31") ? period.slice(0, 4) : period, metrics: state.financial.financial_metrics.metrics[entry.metrics[0]]?.group || "cash" })}#stock-operating">${esc(companyName(entry.company))} · ${esc(K.periodLabel(period))}<i data-lucide="arrow-up-right" width="13" height="13"></i></a>`).join("") : "";
    host.innerHTML = `<div class="knowledge-tags"><span class="tag ${entry.kind === "report" ? "blue" : ""}">${entry.kind === "report" ? "报告期解读" : "通用口径"}</span><span class="tag ${entry.status === "pending" ? "warn" : "good"}">${statuses[entry.status]}</span>${entry.metrics.map((key) => `<a class="tag" href="${esc(K.href({ ...state.filters, query: "", metric: key }, entry.id))}">${esc(metricName(key))}</a>`).join("")}</div>
      <h2>${esc(entry.title)}</h2><div class="meta"><span>版本 ${entry.version}</span><span>建立 ${esc(entry.created_at.slice(0, 10))}</span><span>更新 ${esc(entry.updated_at.slice(0, 10))}</span></div>
      <dl class="knowledge-context"><dt>适用公司</dt><dd>${esc(companyName(entry.company))}</dd><dt>适用报告期</dt><dd>${entry.kind === "general" ? "通用口径 · 不绑定报告期" : entry.periods.map(K.periodLabel).map(esc).join("、")}</dd><dt>历史对照期</dt><dd>${entry.reference_periods.map(K.periodLabel).map(esc).join("、") || "无"}</dd></dl>
      <div class="knowledge-summary">${paragraphs(entry.summary)}</div><h3>${entry.kind === "report" ? "报告事实与拆解" : "指标口径与解读"}</h3>${paragraphs(entry.answer)}
      ${entry.inference ? `<h3>分析推断</h3>${paragraphs(entry.inference)}` : ""}${entry.caveats ? `<h3>边界与待跟踪</h3>${paragraphs(entry.caveats)}` : ""}
      <h3>证据来源</h3><ul class="knowledge-evidence">${sourceLinks || `<li>${entry.kind === "general" ? "通用研究口径，具体公司原因需以当期披露核验。" : "尚未登记来源，此条不作已核验事实。"}</li>`}</ul>
      ${backLinks ? `<h3>对应财报</h3><div class="knowledge-inline-links">${backLinks}</div>` : ""}
      <details class="disclosure"><summary>更新记录 · ${entry.history.length + 1} 个版本</summary><ul class="knowledge-evidence"><li>v${entry.version} · ${esc(entry.updated_at.slice(0, 10))} · 当前版本</li>${[...entry.history].reverse().map((h) => `<li><details><summary>v${h.version} · ${esc(h.updated_at.slice(0, 10))} · ${esc(h.title)}</summary>${paragraphs(h.summary)}${paragraphs(h.answer)}</details></li>`).join("")}</ul></details>
      <div class="knowledge-actions"><button id="knowledge-edit"${state.api ? "" : " disabled"}><i data-lucide="pencil"></i>编辑条目</button><button id="knowledge-copy" class="icon-button" title="复制条目链接" aria-label="复制条目链接"><i data-lucide="link"></i></button></div>`;
    $("knowledge-edit").onclick = () => editEntry(entry);
    $("knowledge-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); $("knowledge-status").textContent = "条目链接已复制。"; }
      catch (_) { $("knowledge-status").textContent = "当前浏览器无法复制，条目链接已保留在地址栏。"; }
    };
  }
  function editEntry(entry) {
    const fresh = !entry;
    const initial = entry || { id: "", company: state.filters.company, metrics: state.filters.metric ? [state.filters.metric] : [], kind: state.filters.period ? "report" : "general", periods: state.filters.period ? [state.filters.period] : [], reference_periods: [], title: "", summary: "", answer: "", inference: "", caveats: "", status: "pending", sources: [] };
    const expectedRevision = state.pack.revision;
    const dialog = document.createElement("dialog"); dialog.className = "knowledge-dialog";
    dialog.setAttribute("aria-labelledby", "knowledge-editor-title");
    const periodOptions = [["", "选择报告期"], ...periodList().map((p) => [p, K.periodLabel(p)])];
    const periodPicker = (name, values) => `<div id="editor-${name}" class="knowledge-checks">${values.map((p) => `<label><input type="checkbox" name="${name}" value="${p}" checked>${K.periodLabel(p)}</label>`).join("")}</div><select aria-label="添加${name === "periods" ? "适用报告期" : "历史对照期"}" data-add-period="${name}">${options(periodOptions, "")}</select>`;
    dialog.innerHTML = `<form id="knowledge-form"><header><h2 id="knowledge-editor-title">${fresh ? "新增知识" : "编辑知识"}</h2><button type="button" class="icon-button" data-close title="关闭" aria-label="关闭编辑"><i data-lucide="x"></i></button></header><div class="knowledge-form-body"><div class="knowledge-form-grid">
      <label class="wide">问题 / 标题<input name="title" required maxlength="200" value="${esc(initial.title)}"></label>
      <label>适用公司<select name="company">${options([["", "全部公司"], ...state.financial.companies.map((c) => [c.code, c.name])], initial.company)}</select></label><label>条目类型<select name="kind">${options([["report", "报告期解读"], ["general", "通用口径"]], initial.kind)}</select></label>
      <div class="wide"><label>对应财务指标</label><div class="knowledge-checks">${Object.values(state.financial.financial_metrics.metrics).map((m) => `<label><input type="checkbox" name="metrics" value="${m.key}"${initial.metrics.includes(m.key) ? " checked" : ""}>${esc(m.label)}</label>`).join("")}</div></div>
      <div id="editor-report-periods"><label>适用报告期</label>${periodPicker("periods", initial.periods)}</div><div><label>历史对照期</label>${periodPicker("reference_periods", initial.reference_periods)}</div>
      <label class="wide">核心结论<textarea name="summary" required maxlength="2000">${esc(initial.summary)}</textarea></label><label class="wide">报告事实与指标解读<textarea name="answer" required maxlength="30000">${esc(initial.answer)}</textarea></label><label class="wide">分析推断<textarea name="inference" maxlength="10000">${esc(initial.inference)}</textarea></label><label class="wide">边界与待跟踪<textarea name="caveats" maxlength="10000">${esc(initial.caveats)}</textarea></label>
      <label>核验状态<select name="status">${options(Object.entries(statuses), initial.status)}</select></label>
      <div class="wide"><label>证据来源与页码</label>${state.pack.sources.map((s) => `<div class="knowledge-source-editor"><label><input type="checkbox" name="sources" value="${s.id}"${initial.sources.some((r) => r.source_id === s.id) ? " checked" : ""}>${esc(s.title)}</label><input aria-label="${esc(s.title)}页码" data-source-pages="${s.id}" placeholder="页码" maxlength="100" value="${esc(initial.sources.find((r) => r.source_id === s.id)?.pages || "")}"></div>`).join("")}</div></div><p id="knowledge-save-status" class="knowledge-status" role="alert"></p></div><footer><button type="button" data-close>取消</button><button class="primary" type="submit" id="knowledge-save">保存</button></footer></form>`;
    document.body.append(dialog); window.lucide?.createIcons(); dialog.showModal();
    const form = $("knowledge-form");
    let dirty = false, saving = false;
    form.addEventListener("input", () => { dirty = true; });
    form.addEventListener("change", () => { dirty = true; });
    const close = () => { if (saving) return; if (dirty && !confirm("放弃尚未保存的修改？")) return; dialog.close(); };
    dialog.querySelectorAll("[data-close]").forEach((b) => { b.onclick = close; });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("close", () => dialog.remove());
    const togglePeriod = () => { const general = form.elements.kind.value === "general"; $("editor-report-periods").hidden = general; $("editor-report-periods").querySelectorAll("input,select").forEach((node) => { node.disabled = general; }); };
    form.elements.kind.onchange = togglePeriod; togglePeriod();
    form.querySelectorAll("[data-add-period]").forEach((select) => { select.onchange = () => {
      if (!select.value) return;
      const name = select.dataset.addPeriod, box = $("editor-" + name);
      const existing = box.querySelector(`input[value="${select.value}"]`);
      if (existing) existing.checked = true;
      else box.insertAdjacentHTML("beforeend", `<label><input type="checkbox" name="${name}" value="${select.value}" checked>${K.periodLabel(select.value)}</label>`);
      dirty = true; select.value = "";
    }; });
    form.onsubmit = async (event) => {
      event.preventDefault(); if (saving) return;
      const data = new FormData(form), status = $("knowledge-save-status");
      const saved = Object.fromEntries(["company", "kind", "title", "summary", "answer", "inference", "caveats", "status"].map((k) => [k, String(data.get(k) || "").trim()]));
      saved.id = initial.id || crypto.randomUUID(); saved.metrics = data.getAll("metrics"); saved.periods = saved.kind === "general" ? [] : data.getAll("periods"); saved.reference_periods = data.getAll("reference_periods");
      saved.sources = data.getAll("sources").map((id) => ({ source_id: id, pages: form.querySelector(`[data-source-pages="${id}"]`).value.trim() }));
      if (!saved.metrics.length) { status.textContent = "至少选择一个财务指标。"; return; }
      if (saved.kind === "report" && !saved.periods.length) { status.textContent = "报告期解读必须选择适用报告期。"; return; }
      saving = true; $("knowledge-save").disabled = true; status.textContent = "正在保存…";
      try {
        const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: expectedRevision, entry: saved }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "保存失败");
        state.pack = body; state.selected = saved.id;
        if (!K.matches(saved, state.filters)) state.filters = { company: saved.company, metric: "", period: "", kind: "", query: "" };
        dirty = false; dialog.close(); renderShell(); $("knowledge-status").textContent = "已保存，版本记录已更新。";
      } catch (error) { status.textContent = error.message + " 当前修改仍保留在编辑框中。"; }
      finally { saving = false; if ($("knowledge-save")) $("knowledge-save").disabled = false; }
    };
  }
  window.addEventListener("hashchange", () => { state.selected = decodeURIComponent(location.hash.slice(1)); renderResults(); });
  async function init() {
    try {
      const financialResponse = await fetch("data.json?v=5"); if (!financialResponse.ok) throw new Error("公司数据不可用"); state.financial = await financialResponse.json();
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) { state.pack = await response.json(); state.api = true; }
      else { const snapshot = await fetch("knowledge.json?v=1", { cache: "no-store" }); if (!snapshot.ok) throw new Error("知识库数据不可用"); state.pack = await snapshot.json(); }
      if (state.filters.company && !state.financial.companies.some((c) => c.code === state.filters.company)) state.filters.company = "";
      if (state.filters.metric && !state.financial.financial_metrics.metrics[state.filters.metric]) state.filters.metric = "";
      if (state.filters.period && !periodList().includes(state.filters.period)) state.filters.period = "";
      if (!["", "general", "report"].includes(state.filters.kind)) state.filters.kind = "";
      renderShell(); window.__knowledgeReady = true;
    } catch (error) {
      root.setAttribute("aria-busy", "false"); root.innerHTML = `<h1>财务知识库</h1><p class="banner error" role="alert">${esc(error.message)}</p><button id="knowledge-retry">重新加载</button>`; $("knowledge-retry").onclick = () => location.reload();
    }
  }
  init();
})();
