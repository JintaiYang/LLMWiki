(function () {
  "use strict";
  if (window.Chart) {
    Chart.defaults.animation.duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
  }
  const pages = [
    ["industry.html", "行业总览"], ["index.html", "银行对比"],
    ["stock.html", "个股深度"], ["score-formula.html", "打分方法"],
    ["nim_etf_chart.html", "NIM 专题"]
  ];
  const groups = [
    ["high", "行情与估值", "按需更新最新报价与相关估值"],
    ["mid", "财报与打分", "财报期更新个股、打分与知识库"],
    ["low", "行业与宏观", "按需更新监管与宏观数据"]
  ];
  const page = location.pathname.split("/").pop() || "index.html";
  const nav = document.createElement("nav");
  nav.className = "research-nav";
  nav.setAttribute("aria-label", "研究页面导航");
  const brand = page === "index.html"
    ? '<a class="research-brand" href="index.html">BANK / 研究台</a>'
    : '<a class="research-brand" href="industry.html"><img src="favicon.svg" width="26" height="26" alt="">银行研究台</a>';
  nav.innerHTML = '<div class="research-nav-inner">' + brand + '<div class="research-links"></div><button type="button" class="research-update-toggle" aria-haspopup="dialog">手动更新数据</button></div>';
  const links = nav.querySelector(".research-links");
  pages.forEach(([href, label]) => {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    if (href === page) { a.className = "active"; a.setAttribute("aria-current", "page"); }
    links.appendChild(a);
  });
  document.body.prepend(nav);

  const panel = document.createElement("div");
  panel.className = "research-update-panel hidden";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "手动数据更新");
  panel.innerHTML = '<div class="research-update-card"><div class="research-update-heading"><div><h2>手动数据更新</h2><p>打开页面不会采集。仅在本机服务运行时点击任务，可能同步修改知识库。</p></div><button type="button" class="research-update-close" aria-label="关闭">×</button></div><div class="research-update-groups"></div><p class="research-update-status" role="status"></p><div class="research-update-warnings"></div><pre class="research-update-log" aria-label="执行日志"></pre><button type="button" class="research-update-reload hidden">刷新页面查看新数据</button></div>';
  const groupBox = panel.querySelector(".research-update-groups");
  groups.forEach(([id, label, desc]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.group = id;
    button.innerHTML = `<strong>${label}</strong><small>${desc}</small>`;
    groupBox.appendChild(button);
  });
  document.body.appendChild(panel);
  const toggle = nav.querySelector(".research-update-toggle");
  const status = panel.querySelector(".research-update-status");
  const log = panel.querySelector(".research-update-log");
  const warnings = panel.querySelector(".research-update-warnings");
  const reload = panel.querySelector(".research-update-reload");
  let timer = null;
  let token = null;
  let previousFocus = null;
  const local = ["localhost", "127.0.0.1"].includes(location.hostname) && location.protocol === "http:";
  let available = false;
  const close = () => {
    panel.classList.add("hidden");
    if (previousFocus) previousFocus.focus();
  };
  const serviceHint = "当前地址未运行更新服务（可能是 python -m http.server）。请在项目根目录运行 python3 scripts/dashboard_server.py --port 8765，并打开 http://127.0.0.1:8765/index.html；原有 8000 端口无需关闭。";
  const api = async (url, options) => {
    let response;
    try {
      response = await fetch(url, { cache: "no-store", ...options });
    } catch (error) {
      throw new Error("无法连接本机更新服务。" + serviceHint);
    }
    if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      throw new Error(serviceHint);
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error("更新接口返回的数据无法解析。请重启本机更新服务。");
    }
    if (!response.ok) throw new Error(data.error || `更新接口返回 HTTP ${response.status}`);
    if (url === "/api/update" && !data.status) throw new Error("更新服务返回的状态不完整，请重启服务。");
    return data;
  };
  const poll = async () => {
    try {
      const job = await api("/api/update");
      available = true;
      const names = { idle: "未开始", running: "正在更新", success: "更新完成", failed: "更新失败" };
      status.textContent = `${names[job.status] || job.status}${job.total ? ` · ${job.step}/${job.total} ${job.current}` : ""}${job.error ? " · " + job.error : ""}`;
      log.textContent = (job.lines || []).join("\n");
      log.scrollTop = log.scrollHeight;
      warnings.textContent = (job.warnings || []).join("；");
      if (job.status === "success") {
        status.textContent += "。请刷新页面查看各数据源实际截至日；日期未变化表示该报告期没有新数据。";
      } else if (job.status === "failed") {
        status.textContent += "。可能存在部分文件已更新，页面日期仍以各文件实际记录为准。";
      }
      groupBox.querySelectorAll("button").forEach(b => { b.disabled = job.status === "running"; });
      reload.classList.toggle("hidden", job.status !== "success" && job.status !== "failed");
      if (job.status === "running") timer = setTimeout(poll, 1200);
    } catch (err) {
      available = false;
      groupBox.querySelectorAll("button").forEach(b => { b.disabled = true; });
      status.textContent = `无法读取更新状态：${err.message}`;
    }
  };
  toggle.addEventListener("click", async () => {
    previousFocus = document.activeElement;
    panel.classList.remove("hidden");
    panel.querySelector(".research-update-close").focus();
    if (!local) {
      status.textContent = `当前页面不是通过本机 HTTP 地址打开的。${serviceHint}`;
      groupBox.querySelectorAll("button").forEach(b => { b.disabled = true; });
      return;
    }
    clearTimeout(timer);
    poll();
  });
  groupBox.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-group]");
    if (!btn || btn.disabled || !available) return;
    btn.disabled = true;
    const label = groups.find(g => g[0] === btn.dataset.group)[1];
    if (!confirm(`开始「${label}」？会访问外部数据源、改写本地 JSON 和部分 Obsidian 笔记；执行中请勿关闭本机服务。`)) { btn.disabled = false; return; }
    try {
      if (!token) token = (await api("/api/update-token")).token;
      await api("/api/update", { method: "POST", headers: { "Content-Type": "application/json", "X-Update-Token": token }, body: JSON.stringify({ group: btn.dataset.group }) });
      clearTimeout(timer);
      poll();
    } catch (err) { status.textContent = `启动失败：${err.message}`; clearTimeout(timer); poll(); }
  });
  panel.querySelector(".research-update-close").addEventListener("click", close);
  panel.addEventListener("click", e => { if (e.target === panel) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.classList.contains("hidden")) close(); });
  reload.addEventListener("click", () => location.reload());
})();
