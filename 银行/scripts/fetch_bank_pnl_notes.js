/**
 * 采集银行年报附注：利息收入/利息支出拆项、存款四分结构（iFind MCP）。
 * 输出: 02_原始资料/05_iFind数据/利息与非息附注/{code}_{name}_notes.csv
 */
const fs = require("fs");
const path = require("path");
const { call } = require("/Users/yangjintai/.claude/skills/ifind-finance-data/call-node.js");

const ROOT = path.resolve(__dirname, "..");
const UNIVERSE = path.join(ROOT, "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.csv");
const OUT_DIR = path.join(ROOT, "02_原始资料/05_iFind数据/利息与非息附注");
const RAW_DIR = path.join(OUT_DIR, "raw");

const QUERY_TYPES = [
  {
    key: "int_inc",
    indicators: "发放贷款及垫款利息收入、金融投资利息收入、存放中央银行款项利息收入、存拆放同业和其他金融机构款项利息收入",
  },
  {
    key: "int_exp_dep",
    indicators: "企业活期存款利息支出、企业定期存款利息支出、储蓄活期存款利息支出、储蓄定期存款利息支出",
  },
  {
    key: "int_exp_other",
    indicators: "吸收存款利息支出、同业和其他金融机构存拆放款项利息支出、应付债券利息支出、向中央银行借款利息支出",
  },
  {
    key: "dep_bal",
    indicators: "公司活期存款、公司定期存款、个人活期存款、个人定期存款",
  },
];

const WINDOWS = ["2021年至2025年", "2016年至2020年"];
const BATCH = 4;
const SLEEP_MS = 700;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseUniverse() {
  const lines = fs.readFileSync(UNIVERSE, "utf8").trim().split(/\r?\n/).slice(1);
  return lines.map((ln) => {
    const [code, name] = ln.split(",");
    return { code: String(code).padStart(6, "0"), name };
  });
}

function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/,/g, "").replace(/\\t/g, "").replace(/\t/g, "");
  if (!s || s === "-" || s === "—" || s === "None" || s === "nan") return null;
  let m = 1;
  if (s.endsWith("万亿")) {
    m = 1e12;
    s = s.slice(0, -2);
  } else if (s.endsWith("亿")) {
    m = 1e8;
    s = s.slice(0, -1);
  } else if (s.endsWith("万")) {
    m = 1e4;
    s = s.slice(0, -1);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n * m : null;
}

function normDate(raw) {
  const s = String(raw || "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function extractAnswer(result) {
  const text = result && result.data && result.data.result && result.data.result.content
    && result.data.result.content[0] && result.data.result.content[0].text;
  if (!text) return "";
  try {
    const o1 = JSON.parse(text);
    const o2 = typeof o1.data === "string" ? JSON.parse(o1.data) : o1.data;
    return o2.answer || "";
  } catch (e) {
    return "";
  }
}

function parseMarkdownTable(answer) {
  const rows = [];
  let header = null;
  for (const line of String(answer).split(/\n/)) {
    const s = line.trim();
    if (!s.startsWith("|")) continue;
    const cells = s.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")))) continue;
    if (!header && cells.some((c) => c.includes("证券代码"))) {
      header = cells;
      continue;
    }
    if (header && cells.length >= header.length && /^\d{6}\./.test(cells[0] || "")) {
      const obj = {};
      header.forEach((h, i) => { obj[h] = cells[i]; });
      rows.push(obj);
    }
  }
  return rows;
}

function mapRow(row) {
  const code = String(row["证券代码"] || "").replace(/\.(SH|SZ)$/i, "");
  const date = normDate(row["日期"]);
  const out = { code, name: row["证券简称"] || "", report_date: date };
  const put = (key, pred) => {
    for (const [col, cell] of Object.entries(row)) {
      if (pred(col)) {
        const v = parseAmount(cell);
        if (v != null) out[key] = v;
      }
    }
  };
  put("int_inc_pbc", (c) => c.includes("存放中央银行") && c.includes("利息收入"));
  put("int_inc_invest", (c) => c.includes("金融投资") && c.includes("利息收入"));
  put("int_inc_interbank", (c) => (c.includes("存拆放同业") || c.includes("同业和其他金融机构款项")) && c.includes("利息收入"));
  put("int_inc_loan", (c) => c.includes("发放贷款") && c.includes("利息收入"));
  put("int_exp_corp_time", (c) => (c.includes("企业定期") || c.includes("公司定期")) && c.includes("利息支出"));
  put("int_exp_corp_demand", (c) => (c.includes("企业活期") || c.includes("公司活期")) && c.includes("利息支出"));
  put("int_exp_retail_demand", (c) => (c.includes("储蓄活期") || c.includes("个人活期") || c.includes("零售活期")) && c.includes("利息支出"));
  put("int_exp_retail_time", (c) => (c.includes("储蓄定期") || c.includes("个人定期") || c.includes("零售定期")) && c.includes("利息支出"));
  put("int_exp_bond", (c) => c.includes("应付债券") && c.includes("利息支出"));
  put("int_exp_deposit", (c) => (c.includes("吸收存款") || c.includes("客户存款")) && c.includes("利息支出") && !c.includes("企业") && !c.includes("储蓄") && !c.includes("公司") && !c.includes("个人") && !c.includes("零售"));
  put("int_exp_interbank", (c) => (c.includes("同业") && c.includes("利息支出") && !c.includes("收入")));
  put("int_exp_pbc", (c) => c.includes("向中央银行借款") && c.includes("利息支出"));
  put("dep_corp_time", (c) => (c.includes("公司定期") || c.includes("企业定期")) && !c.includes("利息"));
  put("dep_corp_demand", (c) => (c.includes("公司活期") || c.includes("企业活期")) && !c.includes("利息"));
  put("dep_retail_demand", (c) => (c.includes("个人活期") || c.includes("零售活期") || c.includes("储蓄活期")) && !c.includes("利息"));
  put("dep_retail_time", (c) => (c.includes("个人定期") || c.includes("零售定期") || c.includes("储蓄定期")) && !c.includes("利息"));
  return out;
}

const COLS = [
  "report_date", "code", "name",
  "int_inc_loan", "int_inc_invest", "int_inc_pbc", "int_inc_interbank",
  "int_exp_corp_demand", "int_exp_corp_time", "int_exp_retail_demand", "int_exp_retail_time",
  "int_exp_deposit", "int_exp_interbank", "int_exp_bond", "int_exp_pbc",
  "dep_corp_demand", "dep_corp_time", "dep_retail_demand", "dep_retail_time",
];

function merge(store, row) {
  if (!row.code || !row.report_date) return;
  const k = `${row.code}|${row.report_date}`;
  if (!store[k]) store[k] = { ...row };
  else {
    for (const [key, val] of Object.entries(row)) {
      if (val != null && val !== "" && store[k][key] == null) store[k][key] = val;
      else if (typeof val === "number" && store[k][key] == null) store[k][key] = val;
    }
  }
}

function toCsv(rows) {
  const lines = [COLS.join(",")];
  for (const r of rows) {
    lines.push(COLS.map((c) => (r[c] == null || r[c] === "" ? "" : r[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

async function queryOnce(names, window, indicators) {
  const q = `${names}${window}各年年报的${indicators}`;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const result = await call("stock", "get_stock_financials", { query: q });
      if (!result.ok) throw new Error(JSON.stringify(result.error || result));
      return { query: q, answer: extractAnswer(result), raw: result };
    } catch (e) {
      lastErr = e;
      await sleep(1200 * (i + 1));
    }
  }
  throw lastErr;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const banks = parseUniverse();
  const store = {};
  let nOk = 0;
  let nFail = 0;
  for (let i = 0; i < banks.length; i += BATCH) {
    const batch = banks.slice(i, i + BATCH);
    const names = batch.map((b) => b.name).join("、");
    for (const win of WINDOWS) {
      for (const qt of QUERY_TYPES) {
        process.stdout.write(`[fetch] ${names} | ${win} | ${qt.key} ... `);
        try {
          const { query, answer } = await queryOnce(names, win, qt.indicators);
          const fname = `${batch[0].code}_${win}_${qt.key}.md`.replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
          fs.writeFileSync(path.join(RAW_DIR, fname), `# ${query}\n\n${answer}\n`, "utf8");
          const parsed = parseMarkdownTable(answer).map(mapRow);
          parsed.forEach((r) => merge(store, r));
          nOk += 1;
          console.log(`ok rows=${parsed.length}`);
        } catch (e) {
          nFail += 1;
          console.log(`FAIL ${e.message || e}`);
        }
        await sleep(SLEEP_MS);
      }
    }
  }
  const rows = Object.values(store).sort((a, b) => (a.code + a.report_date).localeCompare(b.code + b.report_date));
  const mergedPath = path.join(OUT_DIR, "merged_all_banks.csv");
  fs.writeFileSync(mergedPath, toCsv(rows), "utf8");
  const byCode = {};
  for (const r of rows) {
    if (!byCode[r.code]) byCode[r.code] = [];
    byCode[r.code].push(r);
  }
  for (const b of banks) {
    const rs = byCode[b.code] || [];
    fs.writeFileSync(path.join(OUT_DIR, `${b.code}_${b.name}_notes.csv`), toCsv(rs), "utf8");
  }
  const annual = rows.filter((r) => String(r.report_date).endsWith("-12-31"));
  const withLoan = annual.filter((r) => r.int_inc_loan != null).length;
  const withExp4 = annual.filter((r) => r.int_exp_corp_demand != null).length;
  const withDep4 = annual.filter((r) => r.dep_corp_demand != null).length;
  console.log(`[done] queries ok=${nOk} fail=${nFail} rows=${rows.length} annual=${annual.length}`);
  console.log(`[done] annual with 贷款利息收入=${withLoan} 存款利息四分=${withExp4} 存款余额四分=${withDep4}`);
  console.log(`[done] wrote ${mergedPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
