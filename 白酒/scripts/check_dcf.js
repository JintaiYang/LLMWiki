"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { classify, tags } = require("../dashboard/company-style.js");
const data = require("../dashboard/data.json");
const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8767/";
const output = process.env.LIQUOR_SCREENSHOTS || "/tmp/liquor-dcf-latest-qa";

async function main() {
  const counts = Object.fromEntries(Object.keys(tags).map((id) => [id, 0]));
  for (const company of data.companies) {
    const latest = company.annual.filter((r) => r.period !== "quarterly_ytd").sort((a, b) => a.year - b.year).at(-1);
    const dcf = company.dcf;
    const fcff = latest.fcff, owner = latest.owner_fcf ?? (latest.cfo !== null && latest.capex !== null ? latest.cfo - latest.capex : null);
    assert.deepEqual(dcf.base_years, [latest.year]);
    assert.equal(dcf.base_year, latest.year);
    assert.equal(dcf.base_cash_flow_CNY, fcff !== null && fcff > 0 ? fcff : owner, company.code + " single year cash flow");
    assert.match(dcf.base_method, /^latest_annual_/);
    assert(!dcf.base_label.includes("中位数"));
    if (dcf.base_cash_flow_CNY === null || dcf.base_cash_flow_CNY <= 0) {
      assert.deepEqual(dcf.scenarios, []); assert.deepEqual(dcf.sensitivity, []);
    } else {
      assert.equal(dcf.scenarios.length, 3); assert.equal(dcf.sensitivity.length, 45);
      for (const scenario of dcf.scenarios) {
        assert.equal(scenario.assumptions.base_cash_flow_CNY, dcf.base_cash_flow_CNY);
        assert.equal(scenario.breakdown.cashflows[0].year, latest.year + 1);
      }
    }
    const style = classify(company, data.classification.year);
    assert.deepEqual(company.style, style, company.code + " persisted labels match browser rules");
    counts[style.id]++;
    const stock = JSON.parse(fs.readFileSync(path.join(__dirname, "../dashboard/stock_data", company.code + ".json")));
    assert.deepEqual(stock, company, company.code + " detail snapshot synchronized");
  }
  assert.deepEqual(counts, data.classification.counts);
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const go = async (url) => { await page.goto(new URL(url, base).href); await page.waitForFunction(() => window.__liquorReady === true); };
  try {
    await go("index.html");
    for (const [id, count] of Object.entries(counts)) {
      const button = page.locator(`[data-style-filter="${id}"]`);
      assert.equal(Number(await button.locator("small").innerText()), count);
      await page.locator('[data-style-filter="all"]').click(); await button.click();
      assert.equal(await page.locator("#comparison-table tbody tr[data-code]").count(), count);
    }
    await page.locator('[data-style-filter="all"]').click();
    await page.screenshot({ path: output + "/labels-desktop.png" });
    for (const code of ["600519", "000858", "002304", "600779"]) {
      await go(`stock.html?code=${code}#stock-value`);
      const company = data.companies.find((c) => c.code === code);
      assert((await page.locator(".score-aside").innerText()).includes(company.style.label));
      assert.match(await page.locator("#stock-value").innerText(), /直接取最新完整年报/);
      assert(!/连续三年现金流不足/.test(await page.locator("#stock-value").innerText()));
      await page.locator("#stock-value").scrollIntoViewIfNeeded();
      await page.screenshot({ path: output + `/${code}-desktop.png` });
    }
    await go("score-formula.html#formula-style");
    assert.match(await page.locator("#formula-style").innerText(), /最新年报基准DCF/);
    assert.match(await page.locator("#formula-style").innerText(), /PE和股息率继续作为独立参考/);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await go("index.html");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: output + `/labels-${width}.png` });
      await go("stock.html?code=000858#stock-value");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.locator("#stock-value").scrollIntoViewIfNeeded();
      await page.screenshot({ path: output + `/value-${width}.png` });
    }
    const fixture = structuredClone(data), company = fixture.companies.find((c) => c.code === "600519");
    Object.assign(company.dcf, { net_cash_status: "verified", net_cash_CNY: 0, price_comparable: true });
    const baseline = company.dcf.scenarios.find((s) => s.name === "基准");
    baseline.value_per_share = company.price.close * 2;
    await page.route("**/data.json?v=5", (route) => route.fulfill({ json: fixture }));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("index.html?tags=quality_cheap");
    assert.equal(await page.locator('#comparison-table tbody tr[data-code="600519"]').count(), 1, "Verified cheap DCF overrides the old static-PE tag");
    await go("stock.html?code=600519");
    assert.match(await page.locator(".score-aside").innerText(), /质优低估/);
    baseline.value_per_share = company.price.close / 2;
    await go("index.html?tags=quality_rich");
    assert.equal(await page.locator('#comparison-table tbody tr[data-code="600519"]').count(), 1);
    await go("stock.html?code=600519");
    assert.match(await page.locator(".score-aside").innerText(), /质优不便宜/);
    company.dcf.net_cash_status = "not_verified";
    await go("stock.html?code=600519");
    assert.match(await page.locator(".score-aside").innerText(), /DCF估值待核验/);
    assert.deepEqual(errors, []);
    console.log("19 latest-year DCFs, scenario/sensitivity bases, all persisted labels/detail snapshots, filters/counts, valid DCF label changes, missing net cash, and desktop/mobile pages OK");
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
