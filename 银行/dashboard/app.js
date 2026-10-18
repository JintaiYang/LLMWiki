// 银行研究标的对比仪表盘 - 前端逻辑
// 数据来源：dashboard/data.json（由 scripts/generate_dashboard_data.py 生成）
// 包含 AkShare 深度采集指标（67项）和四维评价

(function () {
  "use strict";

  const OBSIDIAN_VAULT_NAME = "银行";

  // ---------- 指标列定义 ----------
  // 每组指标的 key 对应 deep_metrics.metrics 中的字段名
  // label 为表头显示文字，fmt 为格式化方式：
  //   'yi'  统一按亿元显示/排序（raw 元÷1e8；兼容 value_yi 的「万亿」「亿」混用）
  //   'pct' 取 value_pct，'raw' 取 raw

  const METRIC_GROUPS = [
    {
      group: "profit",
      groupLabel: "盈利能力",
      cls: "group-profit",
      metrics: [
        { key: "净息差", label: "NIM", fmt: "pct", signed: false },
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
        { key: "信用成本率", label: "信用成本率", fmt: "pct",
          help: { title: "信用成本率", body: "当年为贷款计提的信用减值损失÷平均贷款。每放100元贷款，利润表里要拿出多少去覆盖可能的坏账。越低越好。覆盖率是已经提好的存量缓冲；信用成本是这一年新提了多少。信用成本下降但不良还在生成，可能是少提拨备在虚增利润。" } },
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
        { key: "现价PB", label: "现价PB", fmt: "raw",
          help: { title: "现价PB", body: "最新价 ÷ 年报每股净资产。和年报那天的 PB 不是同一个数。用来和右边的合理PB对照。" } },
        { key: "合理PB", label: "合理PB", fmt: "raw",
          help: { title: "合理PB（PB-ROE）", body: "1元净资产按这套长期假设该卖几元。公式：(ROE−3%)/(COE−3%)。ROE高于COE才大于1倍。和稳态PB是同一公式，不是目标价。" } },
        { key: "RIM值", label: "RIM值", fmt: "raw",
          help: { title: "RIM值", body: "剩余收益模型的每股价值 = 合理PB × 每股净资产。也等于稳态DDM：今天的账面本金 + 未来超额利润折现。不是现价，也不是投资建议。" } },
        { key: "PE(TTM)", label: "PE(TTM)", fmt: "raw" },
        { key: "PE(静)", label: "PE(静)", fmt: "raw" },
      ],
    },
    {
      group: "ddm",
      groupLabel: "DDM估值（假设）",
      cls: "group-ddm",
      metrics: [
        { key: "全年DPS", label: "全年DPS", fmt: "raw",
          help: { title: "全年DPS", body: "这一年每股现金分红合计（中期+末期）。例如每10股派3.10元，DPS就是0.31元。" } },
        { key: "现金分红率", label: "分红率", fmt: "pct", signed: false,
          help: { title: "分红率", body: "净利润里拿出多大比例发给股东。30%表示赚1元分0.3元，留下0.7元补充资本。" } },
        { key: "最新价", label: "最新价", fmt: "raw",
          help: { title: "最新价", body: "iFind 最新未复权收盘价。日期写在本组表头。股息率、现行/现价、稳态/现价都用这个价格，不再用年报那天的收盘价。" } },
        { key: "股息率", label: "股息率", fmt: "pct", signed: false,
          help: { title: "股息率", body: "全年DPS ÷ 最新收盘价。按现在的股价，一年分红大约能拿回百分之几。" } },
        { key: "COE", label: "COE", fmt: "pct", signed: false,
          help: { title: "COE（股权成本）", body: "股东要求的年化回报，不是贷款利率。本表按类型分档：大行9%、股份行10%、城商行10.5%、农商行11%。用来把未来分红折成今天的钱。" } },
        { key: "DDM现行价", label: "现行DDM", fmt: "raw",
          help: { title: "现行DDM", body: "按现在这个分红水平一直分下去，折到今天每股值多少钱。公式：明年分红 ≈ 全年DPS×(1+3%)，再除以（COE−3%）。这是模型价，不是行情现价，也不是投资建议。" } },
        { key: "DDM现行/现价", label: "现行/现价", fmt: "pct",
          help: { title: "现行/现价", body: "现行DDM相对最新收盘价高或低了多少。正数=模型价高于现价；负数=模型价更低。对照的是最新价，不是年报那天的收盘价。不是上涨空间。" } },
        { key: "DDM稳态PB", label: "稳态PB", fmt: "raw",
          help: { title: "稳态PB", body: "和「每股与估值」里的合理PB是同一个数。公式：(ROE−3%)/(COE−3%)。以后分红率提到刚好支撑3%增长时，1元净资产该卖几元。" } },
        { key: "DDM稳态价", label: "稳态DDM", fmt: "raw",
          help: { title: "稳态DDM", body: "和「每股与估值」里的RIM值是同一个数。稳态PB × 每股净资产。留存囤完资本、分红提到可持续水平之后的每股价值。" } },
        { key: "DDM稳态/现价", label: "稳态/现价", fmt: "pct",
          help: { title: "稳态/现价", body: "稳态DDM相对最新收盘价高或低了多少。正数不代表“会涨这么多”，只说明按这套长期假设，现价低于模型价。" } },
        { key: "DDM角色", label: "DDM角色", fmt: "raw",
          help: { title: "DDM角色", body: "分红率≥30%标「主交叉」，可和股息贴现一起看；25%–30%标「辅助交叉」；更低则「仅辅助」，应主要看PB-ROE/剩余收益，不要只看现金股息。" } },
      ],
    },
  ];

  // 六维打分列（公司打分公式V2.0，来自 stock_data/_index.json 的 score_summary.dims）
  const SCORE_DIMS = [
    { key: "A", name: "收入效率", full: 15 },
    { key: "B", name: "收入增长", full: 10 },
    { key: "C", name: "盈利质量", full: 30 },
    { key: "D", name: "资产质量", full: 15 },
    { key: "E", name: "成本控制", full: 15 },
    { key: "F", name: "资本内生", full: 15 },
  ];

  // 估值×模型打分：质地用公式 §3.5 等级，贵贱用 G 维 cheap/expensive 阈值（不另起一套打分）
  const STYLE_TAGS = [
    {
      id: "quality_cheap",
      label: "质优低估",
      order: 1,
      hint: "综合等级 A/B，且价格不贵（ROE/PB≥16% 或股息率≥4.5%）",
    },
    {
      id: "quality_rich",
      label: "质优不便宜",
      order: 2,
      hint: "综合等级 A/B，估值未到低估线",
    },
    {
      id: "cheap_weak",
      label: "低估质弱",
      order: 3,
      hint: "综合等级 C/D，价格便宜，但收入增长尚未塌（B≥50%）",
    },
    {
      id: "value_trap",
      label: "价值陷阱风险",
      order: 4,
      hint: "综合等级 C/D，价格便宜，且收入增长偏弱（B<50%）",
    },
    {
      id: "weak_fair",
      label: "质弱价格一般",
      order: 5,
      hint: "综合等级 C/D，估值也谈不上错杀",
    },
  ];
  const STYLE_TAG_BY_ID = Object.fromEntries(STYLE_TAGS.map((t) => [t.id, t]));

  const EVALUATION_KEYS = [
    { key: "盈利能力评价", label: "盈利能力" },
    { key: "资产质量评价", label: "资产质量" },
    { key: "资产风险评价", label: "资产风险" },
    { key: "可持续性评价", label: "可持续性" },
  ];

  const state = {
    banks: [],
    sortKey: "净息差",
    sortDir: "desc",
    activeTypes: new Set(),
    activeStyleTags: new Set(),
    allTypes: [],
    stockCodeByName: {},
    scoreByName: {},  // name -> {total, grade, period, dims}（综合价值打分V1.0最新年报）
    activeGroups: new Set(["basic", "score", "profit", "growth", "balance", "structure", "pershare", "ddm", "evaluation"]),
    expandedRows: new Set(),
    pickedNames: new Set(),
    suggestIndex: 0,
    ddmMeta: {},
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
    const pw = Math.min(300, window.innerWidth - 16);
    pop.style.width = pw + "px";
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    pop.style.left = left + "px";
    pop.style.top = r.bottom + 8 + "px";
    const ph = pop.offsetHeight;
    if (r.bottom + 8 + ph > window.innerHeight - 8) {
      pop.style.top = Math.max(8, r.top - ph - 8) + "px";
    }
  }

  function appendHelpBtn(parent, help) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "col-help-btn";
    btn.setAttribute("aria-label", (help.title || "指标") + "的含义");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("data-help-title", help.title || "");
    btn.setAttribute("data-help-body", help.body || "");
    btn.textContent = "?";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = btn.getAttribute("aria-expanded") === "true";
      hideColHelp();
      if (!open) showColHelp(btn);
    });
    parent.appendChild(btn);
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest(".col-help-pop") || e.target.closest(".col-help-btn")) return;
    hideColHelp();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (hideCompareSuggest()) return;
    hideColHelp();
    closeDetail();
  });
  window.addEventListener("resize", hideColHelp);
  document.addEventListener("scroll", hideColHelp, true);

  // ---------- 金额单位 ----------
  // data.json 里同一列会混用「53.48万亿」和「71653.19亿」；只抽数字会把大行排到后面。
  function parseAmountToYi(value) {
    if (isNA(value)) return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    const s = String(value).replace(/,/g, "").replace(/\s/g, "");
    if (!s || s === "—" || s === "-" || /^NA$/i.test(s)) return null;
    let m = s.match(/(-?\d+(?:\.\d+)?)万亿/);
    if (m) return parseFloat(m[1]) * 10000;
    m = s.match(/(-?\d+(?:\.\d+)?)亿元?/);
    if (m) return parseFloat(m[1]);
    return parseSortableNumber(s);
  }

  function formatYi(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return null;
    return (
      n.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + "亿"
    );
  }

  function getYiNumber(bank, metricKey) {
    const dm = bank.deep_metrics;
    const m = dm && dm.metrics ? dm.metrics[metricKey] : null;
    if (m && typeof m.raw === "number" && Number.isFinite(m.raw)) {
      return m.raw / 1e8;
    }
    if (m && !isNA(m.value_yi)) {
      const parsed = parseAmountToYi(m.value_yi);
      if (parsed !== null) return parsed;
    }
    const field = FLAT_METRIC_MAP[metricKey];
    if (field && !isNA(bank[field])) {
      return parseAmountToYi(bank[field]);
    }
    return null;
  }

  // ---------- 深度指标取值 ----------
  function getDeepMetric(bank, metricKey, fmt) {
    // NIM 来自 iFind 监管指标（bank.nim），不在 AkShare deep_metrics 中
    if (metricKey === "净息差") {
      return getFlatMetric(bank, metricKey, fmt);
    }
    if (fmt === "yi") {
      const n = getYiNumber(bank, metricKey);
      return n === null ? null : formatYi(n);
    }
    const dm = bank.deep_metrics;
    const m = dm && dm.metrics ? dm.metrics[metricKey] : null;
    if (!m) {
      const fromDdm = getDdmMetric(bank, metricKey, fmt);
      if (fromDdm !== null) return fromDdm;
      // 无深度数据（非重点覆盖银行）：回退到档案页浅层字段
      return getFlatMetric(bank, metricKey, fmt);
    }
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

  // 深度指标键 -> data.json 浅层字段（档案页提取，42家全覆盖）
  const FLAT_METRIC_MAP = {
    "营业收入": "revenue",
    "净利润": "net_profit",
    "归母净利润": "net_profit",
    "EPS": "eps",
    "每股净资产": "bvps",
    "加权ROE": "roe",
    "ROE(摊薄)": "roe",
    "总资产": "total_assets",
    "归母净资产": "net_assets",
    "净息差": "nim",
    "不良率": "npl_ratio",
    "拨备覆盖率": "provision_coverage",
    "核心一级资本充足率": "cet1",
    "CET1": "cet1",
    "PB": "pb",
    "PE(TTM)": "pe",
    "总市值": null, // 浅层无
    "全年DPS": null,
    "现金分红率": null,
    "最新价": null,
    "现价PB": null,
    "合理PB": null,
    "RIM值": null,
    "股息率": null,
    "COE": null,
    "DDM现行价": null,
    "DDM现行/现价": null,
    "DDM稳态PB": null,
    "DDM稳态价": null,
    "DDM稳态/现价": null,
    "DDM角色": null,
  };

  const DDM_FIELD_MAP = {
    "全年DPS": "dps",
    "现金分红率": "payout",
    "最新价": "close",
    "现价PB": "pb",
    "合理PB": "pb_steady",
    "RIM值": "ddm_steady",
    "股息率": "div_yield",
    "COE": "coe_pct",
    "DDM现行价": "ddm_policy",
    "DDM现行/现价": "policy_vs_price",
    "DDM稳态PB": "pb_steady",
    "DDM稳态价": "ddm_steady",
    "DDM稳态/现价": "steady_vs_price",
    "DDM角色": "role",
  };

  function getDdmMetric(bank, metricKey, fmt) {
    const ddm = bank.ddm;
    if (!ddm) return null;
    const field = DDM_FIELD_MAP[metricKey];
    if (!field) return null;
    let v = ddm[field];
    if (field === "coe_pct") v = ddm.coe != null ? ddm.coe * 100 : null;
    if (isNA(v)) return null;
    if (fmt === "pct") {
      const n = typeof v === "number" ? v : parseSortableNumber(v);
      if (n === null) return String(v);
      return n.toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
    }
    if (fmt === "raw" && typeof v === "number") {
      return v.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
    }
    return String(v);
  }

  function getFlatMetric(bank, metricKey, fmt) {
    const field = FLAT_METRIC_MAP[metricKey];
    if (!field) return null;
    const v = bank[field];
    if (isNA(v)) return null;
    if (fmt === "pct") {
      const n = typeof v === "number" ? v : parseSortableNumber(v);
      if (n === null) return String(v);
      return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
    }
    if (fmt === "yi") {
      const n = parseAmountToYi(v);
      return n === null ? String(v) : formatYi(n);
    }
    return String(v);
  }

  function parseSortableNumber(value) {
    if (isNA(value)) return null;
    const match = String(value).match(/-?[\d,]+(?:\.\d+)?/);
    if (!match) return null;
    return parseFloat(match[0].replace(/,/g, ""));
  }

  function getMetricNumber(bank, key) {
    const dm = bank.deep_metrics;
    const m = dm && dm.metrics ? dm.metrics[key] : null;
    if (m) {
      if (typeof m.raw === "number" && Number.isFinite(m.raw)) return m.raw;
      const fromPct = parseSortableNumber(m.value_pct);
      if (fromPct !== null) return fromPct;
    }
    if (key === "股息率" || key === "年报股息率") {
      const ddm = bank.ddm;
      if (ddm && !isNA(ddm.div_yield)) {
        const n = Number(ddm.div_yield);
        if (Number.isFinite(n)) return n > 0 && n < 0.3 ? n * 100 : n;
      }
    }
    const field = FLAT_METRIC_MAP[key];
    if (field && !isNA(bank[field])) return parseSortableNumber(bank[field]);
    return null;
  }

  function getYearEndPb(bank) {
    const n = parseSortableNumber(bank.pb);
    if (n !== null) return n;
    return getMetricNumber(bank, "PB");
  }

  function getG1(bank, sc) {
    if (sc && !isNA(sc.f1)) return Number(sc.f1);
    const roe = getMetricNumber(bank, "加权ROE");
    const pb = getYearEndPb(bank);
    if (roe !== null && pb) return roe / pb;
    return null;
  }

  function getG2(bank, sc) {
    if (sc && !isNA(sc.f2)) return Number(sc.f2);
    return getMetricNumber(bank, "股息率");
  }

  function classifyBank(bank) {
    const sc = state.scoreByName[bank.name];
    if (!sc || isNA(sc.total) || isNA(sc.grade)) return null;
    const f1 = getG1(bank, sc);
    const f2 = getG2(bank, sc);
    const pb = getYearEndPb(bank);
    const j = sc.dims && !isNA(sc.dims.B) ? Number(sc.dims.B) : 0;
    const cheap = (f1 !== null && f1 >= 16) || (f2 !== null && f2 >= 4.5);
    const expensive = (f1 !== null && f1 < 12) || (pb !== null && pb >= 1.2);
    const undervalued = cheap && !expensive;
    const quality = sc.grade === "A+" || sc.grade === "A" || sc.grade === "B";
    const growthWeak = j / 10 < 0.5;
    let id;
    if (quality && undervalued) id = "quality_cheap";
    else if (quality) id = "quality_rich";
    else if (undervalued && growthWeak) id = "value_trap";
    else if (undervalued) id = "cheap_weak";
    else id = "weak_fair";
    const tag = STYLE_TAG_BY_ID[id];
    const bits = [`等级${sc.grade} ${Number(sc.total).toFixed(1)}分`];
    if (f1 !== null) bits.push(`ROE/PB ${f1.toFixed(1)}%`);
    if (f2 !== null) bits.push(`股息率 ${f2.toFixed(2)}%`);
    if (growthWeak) bits.push("收入增长偏弱（B<50%）");
    return {
      id: tag.id,
      label: tag.label,
      order: tag.order,
      hint: tag.hint,
      detail: bits.join(" · "),
    };
  }

  function renderStyleBadge(tag) {
    if (!tag) return '<span class="na">NA</span>';
    return (
      `<span class="style-badge ${tag.id}" title="${escapeHtml(tag.detail + "。 " + tag.hint)}">` +
      escapeHtml(tag.label) +
      "</span>"
    );
  }

  function parseSortableDate(value) {
    if (isNA(value)) return null;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }

  // ---------- 数据加载 ----------

  fetch("./data.json", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((data) => {
      state.banks = data.banks || [];
      state.ddmMeta = data.ddm_meta || {};
      state.allTypes = Array.from(
        new Set(state.banks.map((b) => b.type).filter((t) => !isNA(t)))
      ).sort();

      el("generated-at").textContent = "页面数据生成：" + (data.generated_at || "未知");
      const ddmPriceDates = state.banks.map(b => b.ddm?.price_date).filter(Boolean).sort();
      const priceDates = [...new Set(ddmPriceDates)];
      el("research-price-date").textContent = priceDates.length > 1
        ? `行情截至：各银行不同（${priceDates[0]} 至 ${priceDates.at(-1)}，以个股估值明细为准）`
        : "行情截至：" + (priceDates[0] || state.ddmMeta.price_date || "未知，勿视作实时行情");
      el("research-date-summary").textContent = priceDates.length > 1
        ? `· 行情日期不一致（${priceDates[0]} 至 ${priceDates.at(-1)}）`
        : "· 行情截至：" + (priceDates[0] || state.ddmMeta.price_date || "未知");
      el("bank-count").textContent = "覆盖银行数：" + (data.bank_count ?? state.banks.length);
      const reportDates = state.banks.map(b => b.deep_metrics?.report_date).filter(x => /^\d{8}$|^\d{4}-\d{2}-\d{2}$/.test(String(x || ""))).map(x => String(x).replace(/-/g, "")).sort();
      const lastReport = reportDates.at(-1);
      el("research-report-date").textContent = lastReport ? `深度指标年报期：${lastReport.slice(0, 4)}-${lastReport.slice(4, 6)}-${lastReport.slice(6)}（各银行可能不同）` : "深度指标年报期：未知";

      el("load-error").classList.add("hidden");
      el("main-content").classList.remove("hidden");

      readPicksFromUrl();
      bindComparePicker();
      renderCompareChips();
      renderFilterChips();
      renderTableHead();
      renderAll();
    })
    .catch((err) => {
      console.error("加载 data.json 失败：", err);
      el("load-error").classList.remove("hidden");
      el("main-content").classList.add("hidden");
    });

  fetch("./stock_data/_index.json", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((data) => {
      (data.banks || []).forEach((b) => {
        state.stockCodeByName[b.name] = b.code;
        if (b.score_summary) state.scoreByName[b.name] = b.score_summary;
      });
      const scoreDates = (data.banks || []).map(b => b.score_summary?.period).filter(Boolean).sort();
      const seriesDates = (data.banks || []).map(b => b.latest_report_date).filter(Boolean).sort();
      el("research-stock-date").textContent = "个股序列最晚报告期：" + (seriesDates.at(-1) || "暂无") + "（各银行可能不同）";
      el("research-score-date").textContent = "打分最晚报告期：" + (scoreDates.at(-1) || "暂无") + "（可能滞后于财报）";
      // 个股索引晚于主表到达时重渲染（打分与直达入口）
      if (!el("main-content").classList.contains("hidden")) {
        renderAll();
      }
    })
    .catch((err) => {
      console.warn("加载股票代码索引失败（跳转按钮将不可用）：", err);
      el("research-stock-date").textContent = "个股序列报告期：无法读取";
      el("research-score-date").textContent = "打分报告期：无法读取";
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

    const styleContainer = el("style-filters");
    styleContainer.innerHTML = "";
    STYLE_TAGS.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "chip style-chip";
      chip.dataset.style = tag.id;
      chip.title = tag.hint;
      chip.innerHTML =
        `<span class="style-chip-dot ${tag.id}"></span>` + escapeHtml(tag.label);
      chip.addEventListener("click", () => {
        toggleSetValue(state.activeStyleTags, tag.id);
        chip.classList.toggle("active");
        renderAll();
      });
      styleContainer.appendChild(chip);
    });

    el("reset-filters").addEventListener("click", () => {
      state.activeTypes.clear();
      state.activeStyleTags.clear();
      document
        .querySelectorAll(".chip.active")
        .forEach((chip) => chip.classList.remove("active"));
      clearPickedBanks();
      renderAll();
    });
  }

  function updateStyleChipCounts() {
    const counts = {};
    STYLE_TAGS.forEach((t) => {
      counts[t.id] = 0;
    });
    state.banks.forEach((b) => {
      const tag = classifyBank(b);
      if (tag) counts[tag.id] += 1;
    });
    document.querySelectorAll("#style-filters .style-chip").forEach((chip) => {
      const id = chip.dataset.style;
      const tag = STYLE_TAG_BY_ID[id];
      const n = counts[id] || 0;
      const suffix = Object.keys(state.scoreByName).length ? ` ${n}` : "";
      chip.innerHTML =
        `<span class="style-chip-dot ${id}"></span>` +
        escapeHtml(tag.label) +
        (suffix ? `<span class="style-chip-count">${suffix}</span>` : "");
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
      if (state.pickedNames.size > 0) {
        return state.pickedNames.has(b.name);
      }
      if (state.activeTypes.size > 0 && !state.activeTypes.has(b.type)) {
        return false;
      }
      if (state.activeStyleTags.size > 0) {
        const tag = classifyBank(b);
        if (!tag || !state.activeStyleTags.has(tag.id)) return false;
      }
      return true;
    });
  }

  function readPicksFromUrl() {
    const raw = new URLSearchParams(location.search).get("banks");
    if (!raw) return;
    const known = new Set(state.banks.map((b) => b.name));
    raw.split(",").forEach((part) => {
      const name = part.trim();
      if (name && known.has(name)) state.pickedNames.add(name);
    });
  }

  function writePicksToUrl() {
    const url = new URL(location.href);
    if (state.pickedNames.size === 0) {
      url.searchParams.delete("banks");
    } else {
      url.searchParams.set("banks", Array.from(state.pickedNames).join(","));
    }
    history.replaceState(null, "", url);
  }

  function hideCompareSuggest() {
    const box = el("compare-suggest");
    if (!box || box.classList.contains("hidden")) return false;
    box.classList.add("hidden");
    return true;
  }

  function bankMatchesQuery(bank, q) {
    if (!q) return true;
    return String(bank.name).toLowerCase().indexOf(q) !== -1
      || String(bank.type || "").toLowerCase().indexOf(q) !== -1;
  }

  function suggestBanks() {
    const q = (el("compare-search").value || "").trim().toLowerCase();
    const typeOrder = {};
    state.allTypes.forEach((t, i) => {
      typeOrder[t] = i;
    });
    return state.banks
      .filter((b) => bankMatchesQuery(b, q))
      .sort((a, b) => {
        const ta = typeOrder[a.type] ?? 99;
        const tb = typeOrder[b.type] ?? 99;
        if (ta !== tb) return ta - tb;
        return a.name.localeCompare(b.name, "zh-CN");
      });
  }

  function renderCompareChips() {
    const host = el("compare-chips");
    const clearBtn = el("clear-compare");
    host.innerHTML = "";
    Array.from(state.pickedNames).forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "compare-chip";
      chip.innerHTML = `${escapeHtml(name)}<span class="compare-chip-x" aria-hidden="true">×</span>`;
      chip.addEventListener("click", () => togglePickedBank(name));
      host.appendChild(chip);
    });
    clearBtn.classList.toggle("hidden", state.pickedNames.size === 0);
  }

  function renderCompareSuggest() {
    const box = el("compare-suggest");
    const list = suggestBanks();
    const scrollTop = box.scrollTop;
    box.innerHTML = "";
    if (list.length === 0) {
      box.innerHTML = '<div class="compare-suggest-empty">没有匹配的银行</div>';
      box.classList.remove("hidden");
      return;
    }
    if (state.suggestIndex >= list.length) state.suggestIndex = 0;
    let lastType = null;
    list.forEach((bank, i) => {
      if (bank.type && bank.type !== lastType) {
        lastType = bank.type;
        const head = document.createElement("div");
        head.className = "compare-suggest-group";
        head.textContent = bank.type;
        box.appendChild(head);
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "compare-suggest-item"
        + (state.pickedNames.has(bank.name) ? " picked" : "")
        + (i === state.suggestIndex ? " active" : "");
      item.setAttribute("role", "option");
      item.innerHTML =
        `<span class="compare-check">${state.pickedNames.has(bank.name) ? "✓" : ""}</span>` +
        `<span>${escapeHtml(bank.name)}</span>`;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePickedBank(bank.name);
      });
      box.appendChild(item);
    });
    box.classList.remove("hidden");
    box.scrollTop = scrollTop;
  }

  function togglePickedBank(name) {
    if (state.pickedNames.has(name)) state.pickedNames.delete(name);
    else state.pickedNames.add(name);
    writePicksToUrl();
    renderCompareChips();
    if (!el("compare-suggest").classList.contains("hidden")) {
      renderCompareSuggest();
    }
    renderAll();
  }

  function clearPickedBanks() {
    if (state.pickedNames.size === 0) return;
    state.pickedNames.clear();
    writePicksToUrl();
    renderCompareChips();
    hideCompareSuggest();
    el("compare-search").value = "";
  }

  function bindComparePicker() {
    const input = el("compare-search");
    const box = el("compare-suggest");
    input.addEventListener("focus", () => {
      state.suggestIndex = 0;
      renderCompareSuggest();
    });
    input.addEventListener("input", () => {
      state.suggestIndex = 0;
      renderCompareSuggest();
    });
    input.addEventListener("keydown", (e) => {
      const list = suggestBanks();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.length) {
          state.suggestIndex = (state.suggestIndex + 1) % list.length;
          renderCompareSuggest();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (list.length) {
          state.suggestIndex = (state.suggestIndex - 1 + list.length) % list.length;
          renderCompareSuggest();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (list.length) togglePickedBank(list[state.suggestIndex].name);
      } else if (e.key === "Escape") {
        hideCompareSuggest();
        input.blur();
        e.stopPropagation();
      }
    });
    el("clear-compare").addEventListener("click", () => {
      clearPickedBanks();
      renderAll();
    });
    document.addEventListener("mousedown", (e) => {
      if (e.target.closest(".compare-picker")) return;
      hideCompareSuggest();
    });
    box.addEventListener("mousedown", (e) => e.preventDefault());
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

  // ---------- 排序 ----------

  function getSortValue(bank, key) {
    if (key === "name") return bank.name;
    if (key === "type") return bank.type || "";
    if (key === "updated") return parseSortableDate(bank.updated);
    if (key === "净息差" || key === "nim") {
      return typeof bank.nim === "number" ? bank.nim : parseSortableNumber(bank.nim);
    }
    if (key === "score_total") {
      const sc = state.scoreByName[bank.name];
      if (!sc || isNA(sc.total) || sc.rankable === false) return null;
      return Number(sc.total);
    }
    if (key === "style_tag") {
      const tag = classifyBank(bank);
      return tag ? tag.order : null;
    }
    if (key.startsWith("score_")) {
      const dimKey = key.slice(6); // "A"~"G"
      const sc = state.scoreByName[bank.name];
      return sc && sc.dims && !isNA(sc.dims[dimKey]) ? Number(sc.dims[dimKey]) : null;
    }
    // 先尝试 deep_metrics
    for (const grp of METRIC_GROUPS) {
      for (const m of grp.metrics) {
        if (m.key === key) {
          if (m.fmt === "yi") return getYiNumber(bank, key);
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
    updateStyleChipCounts();
    const filtered = sortBanks(getFilteredBanks());
    const shown = filtered.length;
    const total = state.banks.length;
    if (state.pickedNames.size > 0) {
      el("bank-count").textContent =
        `对比 ${state.pickedNames.size} 家，当前显示 ${shown} / ${total}`;
    } else if (shown !== total) {
      el("bank-count").textContent = `当前显示 ${shown} / ${total}`;
    } else {
      el("bank-count").textContent = `覆盖银行数：${total}`;
    }
    renderTable(filtered);
  }

  // ---------- 动态表头 ----------

  function renderTableHead() {
    hideColHelp();
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

      const scoreTh = document.createElement("th");
      scoreTh.rowSpan = 2;
      scoreTh.className = "col-score";
      scoreTh.dataset.sort = "score_total";
      scoreTh.title = "公式V2.0公司打分（收入效率/收入增长/盈利质量/资产质量/成本控制/资本内生；估值与定性不进总分；缺关键项不参与排序）";
      scoreTh.textContent = "综合打分";
      scoreTh.addEventListener("click", () => handleSort("score_total"));
      groupTr.appendChild(scoreTh);

      const styleTh = document.createElement("th");
      styleTh.rowSpan = 2;
      styleTh.className = "col-style-tag";
      styleTh.dataset.sort = "style_tag";
      styleTh.title = "按模型等级（A/B vs C/D）× 估值（ROE/PB、股息率）二维分类，规则同打分公式 F 维";
      styleTh.textContent = "估值×打分";
      styleTh.addEventListener("click", () => handleSort("style_tag"));
      groupTr.appendChild(styleTh);
    }

    // 六维打分组（紧跟综合打分，可按维度排序）
    if (state.activeGroups.has("score")) {
      const dimGroupTh = document.createElement("th");
      dimGroupTh.colSpan = SCORE_DIMS.length;
      dimGroupTh.className = "group-header group-score";
      dimGroupTh.textContent = "六维打分";
      groupTr.appendChild(dimGroupTh);
    }

    let hasMetricGroup = false;
    METRIC_GROUPS.forEach((grp) => {
      if (!state.activeGroups.has(grp.group)) return;
      hasMetricGroup = true;
      const th = document.createElement("th");
      th.colSpan = grp.metrics.length;
      th.className = "group-header " + grp.cls;
      if (grp.group === "ddm") {
        const label = document.createElement("span");
        label.textContent = grp.groupLabel;
        th.appendChild(label);
        const pxDate = (state.ddmMeta && state.ddmMeta.price_date) || "";
        appendHelpBtn(th, {
          title: "DDM估值（假设）",
          body: "股息贴现模型：把未来现金分红折成今天的每股价值。现行=按现在派息一直分；稳态=以后把分红率提到能支撑3%增长。价格为最新收盘价"
            + (pxDate ? "（" + pxDate + "）" : "")
            + "。股息率=全年DPS÷该价格。不是目标价。",
        });
      } else {
        th.textContent = grp.groupLabel;
      }
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

    if (state.activeGroups.has("score")) {
      SCORE_DIMS.forEach((sd) => {
        const th = document.createElement("th");
        th.dataset.sort = "score_" + sd.key;
        th.className = "col-dim-score";
        th.title = `${sd.name}（满分${sd.full}）— 打分公式V2.0`;
        th.textContent = `${sd.key} ${sd.name}`;
        th.addEventListener("click", () => handleSort("score_" + sd.key));
        metricTr.appendChild(th);
      });
    }

    METRIC_GROUPS.forEach((grp) => {
      if (!state.activeGroups.has(grp.group)) return;
      grp.metrics.forEach((m) => {
        const th = document.createElement("th");
        th.dataset.sort = m.key;
        const label = document.createElement("span");
        label.className = "th-label";
        label.textContent = m.label;
        th.appendChild(label);
        if (m.help) appendHelpBtn(th, m.help);
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
        const nameLink = document.createElement("a");
        nameLink.className = "bank-name-link";
        nameLink.textContent = bank.name;
        const stockCode = state.stockCodeByName[bank.name];
        nameLink.href = stockCode ? `stock.html?code=${encodeURIComponent(stockCode)}` : "#";
        nameLink.title = stockCode ? "点击查看速览；按住 Control 点击直接查看深度数据分析" : "点击查看速览";
        nameLink.addEventListener("click", (event) => {
          if (stockCode && event.ctrlKey) return;
          if (event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openDetail(bank);
        });
        // macOS 的 Control+点击通常触发右键菜单；让这个组合仍可直达深度页。
        nameLink.addEventListener("contextmenu", (event) => {
          if (!stockCode || !event.ctrlKey) return;
          event.preventDefault();
          window.location.assign(nameLink.href);
        });
        nameTd.appendChild(nameLink);
        tr.appendChild(nameTd);

        const typeTd = document.createElement("td");
        typeTd.className = "col-type";
        typeTd.innerHTML = isNA(bank.type)
          ? '<span class="na">NA</span>'
          : `<span class="type-badge">${escapeHtml(bank.type)}</span>`;
        tr.appendChild(typeTd);

        // 综合打分列（最新年报定量总分+等级）
        const scoreTd = document.createElement("td");
        scoreTd.className = "col-score";
        const sc = state.scoreByName[bank.name];
        if (sc && !isNA(sc.total)) {
          const gradeClass = { "A+": "g-ap", "A": "g-a", "B": "g-b", "F": "g-c", "D": "g-d" }[sc.grade] || "g-b";
          const rankNote = sc.rankable === false ? " · 不参与排序" : "";
          const gNote = sc.g ? ` · G${Number(sc.g) > 0 ? "+" : ""}${Number(sc.g).toFixed(1)}` : "";
          scoreTd.innerHTML =
            `<span class="score-total">${Number(sc.total).toFixed(1)}</span>` +
            `<span class="score-grade-badge ${gradeClass}">${escapeHtml(sc.grade || "")}</span>`;
          scoreTd.title = `${sc.period} V2.0公司打分${gNote ? gNote + "（观测）" : ""}${rankNote}`;
          if (sc.rankable === false) scoreTd.classList.add("score-unranked");
        } else {
          scoreTd.innerHTML = '<span class="na">NA</span>';
        }
        tr.appendChild(scoreTd);

        const styleTd = document.createElement("td");
        styleTd.className = "col-style-tag";
        const tag = classifyBank(bank);
        styleTd.innerHTML = renderStyleBadge(tag);
        tr.appendChild(styleTd);
      }

      // 六维打分列（A/B/C/D/E/F，可按维度排序）
      if (state.activeGroups.has("score")) {
        const sc = state.scoreByName[bank.name];
        SCORE_DIMS.forEach((sd) => {
          const td = document.createElement("td");
          td.className = "col-dim-score";
          const v = sc && sc.dims ? sc.dims[sd.key] : null;
          if (!isNA(v)) {
            const ratio = Number(v) / sd.full;
            const lvl = ratio >= 0.8 ? "lv5" : ratio >= 0.65 ? "lv4" : ratio >= 0.5 ? "lv3" : ratio >= 0.35 ? "lv2" : "lv1";
            td.innerHTML =
              `<span class="dim-score-val ${lvl}">${Number(v).toFixed(1)}</span>` +
              `<span class="dim-score-bar"><span class="dim-score-fill ${lvl}" style="width:${Math.round(ratio * 100)}%"></span></span>`;
            td.title = `${sd.name} ${Number(v).toFixed(2)}/${sd.full}（${sc.period}）`;
          } else {
            td.innerHTML = '<span class="na">NA</span>';
          }
          tr.appendChild(td);
        });
      }

      // Deep metric columns
      METRIC_GROUPS.forEach((grp) => {
        if (!state.activeGroups.has(grp.group)) return;
        grp.metrics.forEach((m) => {
          const td = document.createElement("td");
          const val = getDeepMetric(bank, m.key, m.fmt);
          td.innerHTML = renderValueCell(val);
          if (m.fmt === "pct" && m.signed !== false && val) {
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
    const tag = classifyBank(bank);
    if (tag) metaParts.push(tag.label);
    if (!isNA(bank.updated)) metaParts.push("更新于 " + bank.updated);
    const dm = bank.deep_metrics;
    if (dm && dm.report_period) metaParts.push("深度数据期：" + dm.report_period);
    el("detail-meta").textContent = metaParts.join(" · ");

    // Build detail body: thesis summary + deep metrics table + evaluations
    let bodyHtml = "";
    if (tag) {
      bodyHtml +=
        `<div class="detail-style-card">` +
        renderStyleBadge(tag) +
        `<div class="detail-style-text">${escapeHtml(tag.detail)}</div>` +
        `<div class="detail-style-hint">${escapeHtml(tag.hint)}</div>` +
        `</div>`;
    }
    bodyHtml += simpleMarkdownToHtml(bank.thesis_summary);

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
      stockLink.textContent = "查看深度数据分析 →";
    } else {
      stockLink.href = "#";
      stockLink.classList.add("disabled");
      stockLink.textContent = "暂无深度数据";
    }

    el("detail-panel").classList.remove("hidden");
    el("detail-panel").scrollTop = 0;
    el("detail-overlay").classList.remove("hidden");
  }

  function closeDetail() {
    el("detail-panel").classList.add("hidden");
    el("detail-overlay").classList.add("hidden");
  }

  el("detail-close").addEventListener("click", closeDetail);
  el("detail-overlay").addEventListener("click", closeDetail);
})();
