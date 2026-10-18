/**
 * 刷新银行行业总看板原始数据（iFind EDB + 中信银行行业整体法 PE/PB），
 * 然后调用 generate_industry_dashboard.py 写出 dashboard/industry.json。
 *
 * 用法：node scripts/fetch_industry_dashboard.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const { call } = require("/Users/yangjintai/.claude/skills/ifind-finance-data/call-node.js");

const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "02_原始资料/05_iFind数据/行业看板");
const EDB_DIR = path.join(RAW, "edb");

const EDB_QUERIES = [
  ["q00_nim.json", "商业银行净息差 2006年至2026年季度值"],
  ["q01.json", "商业银行不良贷款率 2006年至2026年季度值"],
  ["q02.json", "商业银行拨备覆盖率 2006年至2026年季度值"],
  ["q03.json", "商业银行贷款拨备率 2006年至2026年季度值"],
  ["q04.json", "商业银行资本充足率 2006年至2026年季度值"],
  ["q05.json", "商业银行核心一级资本充足率 2013年至2026年季度值"],
  ["q06.json", "商业银行一级资本充足率 2013年至2026年季度值"],
  ["q07.json", "商业银行资产利润率 2006年至2026年季度值"],
  ["q08.json", "商业银行资本利润率 2006年至2026年季度值"],
  ["q09.json", "商业银行流动性比例 2006年至2026年季度值"],
  ["q10.json", "商业银行存贷比 2006年至2026年季度值"],
  ["q11.json", "商业银行流动性覆盖率 2015年至2026年季度值"],
  ["q13.json", "商业银行成本收入比 2006年至2026年季度值"],
  ["q14.json", "商业银行关注类贷款占比 2006年至2026年季度值"],
  ["q15.json", "商业银行杠杆率 2013年至2026年季度值"],
  ["q16.json", "大型商业银行净息差 2010年至2026年季度值"],
  ["q17.json", "股份制商业银行净息差 2010年至2026年季度值"],
  ["q18.json", "城市商业银行净息差 2010年至2026年季度值"],
  ["q19.json", "农村商业银行净息差 2010年至2026年季度值"],
];

const PE_QUERIES = [
  ["citic_bank_pe_pb_2006_2014.csv", "中信一级行业银行 2006年至2014年每个交易日市盈率(TTM,整体法)和市净率(整体法)"],
  ["citic_bank_pe_pb_2015_2026.csv", "中信一级行业银行 2015年1月至2026年12月每个交易日市盈率(TTM,整体法)和市净率(整体法)"],
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractText(res) {
  const content = res?.data?.result?.content;
  if (Array.isArray(content)) return content.map((c) => c.text || JSON.stringify(c)).join("\n");
  return JSON.stringify(res);
}

function csvUrl(text) {
  const m = String(text).match(/https?:\/\/o\.thsi\.cn\/[^"'\\\s]+csv/);
  return m ? m[0] : null;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error("download " + res.statusCode));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(EDB_DIR, { recursive: true });

  for (const [file, query] of EDB_QUERIES) {
    console.error("EDB", query);
    const res = await call("edb", "get_edb_data", { query });
    if (!res.ok) throw new Error(`EDB 采集失败：${query}，保留旧行业看板`);
    fs.writeFileSync(
      path.join(EDB_DIR, file),
      JSON.stringify({ query, ok: res.ok, text: extractText(res) }, null, 2),
    );
    await sleep(800);
  }

  for (const [file, query] of PE_QUERIES) {
    console.error("PE", query);
    const res = await call("index", "sector_data", { query });
    const text = extractText(res);
    const url = csvUrl(text);
    if (!url) throw new Error("no csv url for " + query);
    await download(url, path.join(RAW, file));
    await sleep(800);
  }

  const py = spawnSync("python3", [path.join(ROOT, "scripts/generate_industry_dashboard.py")], {
    stdio: "inherit",
  });
  if (py.status !== 0) process.exit(py.status || 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
