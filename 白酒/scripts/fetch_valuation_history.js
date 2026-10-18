"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const rawDir = path.join(root, "02_原始资料", "04_AkShare数据", "valuation");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const urlFor = (base, params) => base + "?" + new URLSearchParams(params).toString();
function request(url) {
  return JSON.parse(execFileSync("curl", ["-fLsS", "--retry", "2", "--max-time", "25", url], { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 }));
}
function number(value) {
  if (value === null || value === undefined || String(value).trim() === "" || value === "--") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function normalize(rows) {
  const byDate = new Map();
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date > today || new Date(r.date + "T00:00:00Z").toISOString().slice(0, 10) !== r.date) throw new Error("历史日期不合法");
    if (byDate.has(r.date)) throw new Error("历史日期重复");
    byDate.set(r.date, { date: r.date, pe: number(r.pe), pb: number(r.pb) });
  }
  const result = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (result.length < 20) throw new Error("历史序列过短");
  return result;
}
function daily(code) {
  const params = { reportName: "RPT_VALUEANALYSIS_DET", columns: "SECURITY_CODE,TRADE_DATE,PE_TTM,PB_MRQ", filter: `(SECURITY_CODE="${code}")`, sortColumns: "TRADE_DATE", sortTypes: "1", pageSize: "5000", pageNumber: "1", source: "WEB", client: "WEB" };
  const all = [];
  let pages = 1, expected;
  for (let page = 1; page <= pages; page++) {
    const data = request(urlFor("https://datacenter-web.eastmoney.com/api/data/v1/get", { ...params, pageNumber: String(page) }));
    if (!data.success || !Array.isArray(data.result?.data)) throw new Error("东方财富返回格式不符");
    pages = data.result.pages;
    expected = data.result.count;
    for (const r of data.result.data) {
      if (r.SECURITY_CODE !== code) throw new Error("公司代码不符");
      all.push({ date: r.TRADE_DATE.slice(0, 10), pe: r.PE_TTM, pb: r.PB_MRQ });
    }
  }
  if (all.length !== expected) throw new Error("东方财富历史数据未完整返回");
  return normalize(all);
}
function sampled(code) {
  const byDate = new Map();
  for (const [key, indicator] of [["pe", "市盈率(TTM)"], ["pb", "市净率"]]) {
    const data = request(urlFor("https://gushitong.baidu.com/opendata", { openapi: "1", dspName: "iphone", tn: "tangram", client: "app", query: indicator, code, resource_id: "51171", market: "ab", tag: indicator, chart_select: "全部", skip_industry: "1", finClientType: "pc" }));
    const result = data.Result?.[0]?.DisplayData?.resultData?.tplData?.result;
    const chart = result?.chartInfo?.[0];
    if (result?.code !== code || chart?.header?.[0] !== indicator || chart.type !== "全部" || !Array.isArray(chart.body)) throw new Error("百度估值序列口径不符");
    const seen = new Set();
    for (const point of chart.body) {
      if (!Array.isArray(point) || point.length !== 2 || seen.has(point[0])) throw new Error("百度估值点格式不符");
      seen.add(point[0]);
      const row = byDate.get(point[0]) || { date: point[0], pe: null, pb: null };
      row[key] = point[1];
      byDate.set(point[0], row);
    }
  }
  return normalize([...byDate.values()]);
}
function main() {
  const companies = JSON.parse(fs.readFileSync(path.join(root, "dashboard/data.json"))).companies;
  const file = path.join(root, "dashboard/valuation.json");
  const pack = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { companies: {} };
  pack.generated_at = new Date().toISOString();
  pack.as_of = today;
  pack.sources = {
    long: { label: "长历史（月度抽样）", provider: "百度股市通 / AKShare stock_zh_valuation_baidu", frequency: "每月取源站最后一个可用抽样点，非月末收盘；源站观察日期可能为非交易日", pe_basis: "PE(TTM)", pb_basis: "市净率（源站未明确MRQ标签）" },
    daily: { label: "日频", provider: "东方财富 / AKShare stock_value_em", frequency: "日度交易日序列", pe_basis: "PE(TTM)", pb_basis: "PB(MRQ)" },
  };
  fs.mkdirSync(rawDir, { recursive: true });
  let failures = 0;
  for (const co of companies) {
    pack.companies[co.code] ||= {};
    for (const [source, fetcher] of [["long", sampled], ["daily", daily]]) {
      try {
        const rows = fetcher(co.code);
        fs.writeFileSync(path.join(rawDir, `${co.code}_${source}.csv`), "date,pe,pb\n" + rows.map((r) => [r.date, r.pe ?? "", r.pb ?? ""].join(",")).join("\n") + "\n");
        pack.companies[co.code][source] = { rows, fetched_at: new Date().toISOString(), error: null };
        console.log(`${co.code} ${source}: ${rows.length} observations ${rows[0].date}..${rows.at(-1).date}`);
      } catch (error) {
        failures++;
        const previous = pack.companies[co.code][source] || { rows: [] };
        pack.companies[co.code][source] = { ...previous, error: error.message };
        console.error(`${co.code} ${source}: ${error.message}`);
      }
    }
  }
  fs.writeFileSync(file + ".tmp", JSON.stringify(pack) + "\n");
  fs.renameSync(file + ".tmp", file);
  if (failures) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { normalize, number };
