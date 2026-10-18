"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";
const output = process.env.LIQUOR_WORKFLOW_SCREENSHOTS || "/tmp/liquor-workflow-qa";

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = structuredClone(require("../dashboard/data.json"));
  for (const company of fixture.companies.filter((c) => ["600519", "000858"].includes(c.code))) {
    Object.assign(company.dcf, { price_comparable: true, net_cash_status: "verified", net_cash_CNY: 0 });
    company.dcf.scenarios.find((s) => s.name === "基准").value_per_share = company.price.close / 2;
  }
  await page.route("**/data.json?v=5", (route) => route.fulfill({ json: fixture }));
  const codes = () => page.locator("#comparison-table tbody tr[data-code]").evaluateAll((rows) => rows.map((row) => row.dataset.code).sort());
  async function ready() { await page.waitForFunction(() => window.__liquorReady === true); }
  async function go(url) { await page.goto(new URL(url, base).href); await ready(); }
  async function layout() {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await page.locator("#company-filter,#status-filter,#column-picker-trigger").count(), 0);
  }
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await go("index.html"); await layout();
      await page.locator('[data-style-filter="quality_rich"]').click();
      assert.deepEqual(await codes(), ["000858", "600519"]);
      await page.reload(); await ready();
      assert.deepEqual(await codes(), ["000858", "600519"]);
      const labels = await page.locator("#compare-scores").evaluate((canvas) => Chart.getChart(canvas).data.labels.slice().sort());
      assert.deepEqual(labels, ["五粮液", "贵州茅台"].sort(), "Charts share the tag filter");
      await page.locator('[data-style-filter="all"]').click();
      await page.locator('[data-style-filter="cheap_weak"]').click();
      assert.equal((await codes()).length, 0);
      assert(await page.locator("#download").isDisabled());
      assert(await page.locator('[data-zoom="compare-scores"]').isDisabled());
      await page.locator('[data-style-filter="all"]').click();
      await page.locator('[data-style-filter="quality_rich"]').click();
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#download").click();
      const csv = fs.readFileSync(await (await downloadPromise).path(), "utf8");
      assert.equal(csv.trim().split("\r\n").length, 3);
      assert(csv.includes('"600519"') && csv.includes('"000858"'));
      await page.locator("#comparison-mode").click();
      assert.equal(await page.locator("[data-select]:checked").count(), 2, "A two-company tag filter is ready for comparison");
      await page.locator('[data-select="000858"]').uncheck();
      assert.equal(await page.evaluate(() => document.activeElement.dataset.select), "000858");
      assert(await page.locator("#open-comparison").isDisabled());
      await page.locator('[data-select="000858"]').check();
      await page.locator("#only-selected").check();
      await page.reload(); await ready();
      assert.equal(await page.locator("[data-select]:checked").count(), 2);
      assert(await page.locator("#only-selected").isChecked());
      await layout();
      await page.screenshot({ path: path.join(output, `comparison-${viewport.width}.png`), fullPage: true });
      await page.locator("#open-comparison").click(); await ready();
      assert.match(page.url(), /compare=/);
      await page.goBack(); await ready();
      assert.deepEqual(await codes(), ["000858", "600519"]);
      await page.locator("#reset").click();
      assert.equal((await codes()).length, 19);
      assert.equal(new URL(page.url()).search, "");
      console.log(`${viewport.width}: tags, all columns, CSV, empty state, comparison, reload and back navigation OK`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("stock.html?code=000858&range=20#stock-operating");
    assert.equal(await page.locator('#compare-select option[value="000858"]').count(), 0, "A company cannot compare with itself");
    assert.equal(await page.locator("#nav-model-version").innerText(), "V5");
    await page.locator('.research-links a[href^="score-formula.html"]').click(); await ready();
    assert.equal(await page.locator("#formula-company").inputValue(), "000858");
    await page.locator('.research-links a[href^="stock.html"]').click(); await ready();
    assert.equal(await page.locator("#primary-select").inputValue(), "000858");
    await page.locator('.section-nav a[href="#stock-operating"]').click();
    await page.locator('[data-scale="indexed"]').click();
    await page.locator("#sankey-primary .pnl-year-select").selectOption("2006");
    await page.reload(); await ready();
    assert.equal(await page.locator('[data-scale="indexed"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#sankey-primary .pnl-year-select").inputValue(), "2006");
    await page.locator("#range-select").selectOption("5");
    assert.equal(await page.locator("#sankey-primary .pnl-year-select").inputValue(), "2025");
    assert(!new URL(page.url()).searchParams.has("pnl"), "URL must reflect a historical year reset outside the range");
    assert.equal(new URL(page.url()).hash, "#stock-operating");
    assert.deepEqual(errors, []);
    console.log("Company context across pages, model version, self-comparison prevention, scale/year/range persistence and anchor retention OK");
    console.log("Screenshots: " + output);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
