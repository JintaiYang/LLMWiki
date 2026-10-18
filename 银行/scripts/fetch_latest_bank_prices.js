/**
 * 取 42 家 A 股银行最新未复权收盘价（同花顺 iFind）。
 * 用法：node scripts/fetch_latest_bank_prices.js
 */
const fs = require("fs");
const path = require("path");
const { call } = require("/Users/yangjintai/.claude/skills/ifind-finance-data/call-node.js");

const ROOT = path.resolve(__dirname, "..");
const UNIVERSE = path.join(
  ROOT,
  "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.json"
);
const OUT = path.join(ROOT, "02_原始资料/05_iFind数据/latest_prices.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractAnswer(res) {
  const text = res?.data?.result?.content?.[0]?.text;
  if (!text) throw new Error("empty ifind content");
  const outer = JSON.parse(text);
  let data = outer.data;
  if (typeof data === "string") data = JSON.parse(data);
  return data;
}

function parseTable(answer) {
  const rows = [];
  for (const line of String(answer || "").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    if (!cells.length || cells[0] === "证券代码" || cells.every((c) => /^-+$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

function parseDay(value) {
  const raw = String(value || "").replace(/[-/]/g, "");
  if (!/^20\d{6}$/.test(raw)) return null;
  const day = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  return !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day ? day : null;
}

function latestTradingDay(answer, code) {
  const row = parseTable(answer).find((cells) => String(cells[0] || "").replace(/\.(SH|SZ)$/i, "") === code);
  return row ? parseDay(row[2]) : null;
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const allBanks = JSON.parse(fs.readFileSync(UNIVERSE, "utf8")).banks;
  const codesArg = process.argv.indexOf("--codes");
  const subset = codesArg !== -1;
  const requested = subset ? new Set(String(process.argv[codesArg + 1] || "").split(",")) : null;
  const universe = subset ? allBanks.filter((b) => requested.has(b.code)) : allBanks;
  if (!universe.length || (subset && universe.length !== requested.size)) throw new Error("iFind 回退代码列表无效");
  if (subset) console.error("iFind 仅补缺", universe.map((b) => b.code).join(","));
  const anchor = universe[0];
  const dayResult = await call("stock", "get_stock_performance", {
    query: `${anchor.name} 最近交易日日期，不要收盘价`,
  });
  if (!dayResult?.ok) throw new Error("iFind 最近交易日查询失败");
  const priceDate = latestTradingDay(extractAnswer(dayResult).answer, anchor.code);
  if (!priceDate) throw new Error("iFind 未返回可核验的最近交易日期，拒绝无日期报价");
  const stamp = priceDate.replace(/-/g, "");
  const byCode = {};
  const groups = chunks(universe.map((b) => b.name), 5);
  for (const names of groups) {
    const query = `${names.join(",")} ${priceDate} 未复权收盘价`;
    console.error("fetch", names.join("、"), "as of", priceDate);
    const res = await call("stock", "get_stock_performance", { query });
    if (!res?.ok) throw new Error(`iFind 报价查询失败：${names.join("、")}`);
    const data = extractAnswer(res);
    const params = data.indicators_params?.["收盘价"];
    if (parseDay(params?.["交易日期"]) !== priceDate || params?.["复权方式"] !== "不复权") {
      throw new Error(`iFind 报价的交易日期或复权口径无法核验：${names.join("、")}，期望 ${stamp}`);
    }
    for (const cells of parseTable(data.answer)) {
      const code = String(cells[0] || "").replace(/\.(SH|SZ)$/i, "");
      const bank = universe.find((b) => b.code === code);
      const close = Number(String(cells[2] || "").replace(/,/g, ""));
      if (!bank || !Number.isFinite(close) || close <= 0) continue;
      byCode[code] = { code, name: bank.name, close, price_date: priceDate, source: "iFind" };
    }
    await sleep(700);
  }

  const missing = universe.filter((b) => !byCode[b.code]);
  if (missing.length) throw new Error(`iFind 报价不完整：${universe.length - missing.length}/${universe.length}，缺失 ${missing.map((b) => b.code).join(",")}`);
  const payload = {
    generated_at: new Date().toISOString(),
    price_date: priceDate,
    source: "iFind get_stock_performance 最近一个交易日收盘价（未复权）",
    banks: universe.map((b) => byCode[b.code]),
    missing: missing.map((b) => b.name),
  };
  if (subset) {
    process.stdout.write(JSON.stringify(payload) + "\n");
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.error("wrote", OUT, "got", Object.keys(byCode).length, "/", universe.length);
  if (missing.length) console.error("missing", missing.map((b) => b.name).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
