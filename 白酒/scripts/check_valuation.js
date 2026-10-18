"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { calculate, observations } = require("../dashboard/valuation.js");
const data = require("../dashboard/valuation.json");
const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";
const out = process.env.LIQUOR_SCREENSHOTS || "/tmp/liquor-valuation-qa";
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const chart = (id) => page.locator("#" + id).evaluate((canvas) => {
    const c = Chart.getChart(canvas);
    return c ? { labels: c.data.labels, datasets: c.data.datasets.map((s) => ({ label: s.label, data: s.data })), min: c.options.scales.y.min, max: c.options.scales.y.max, width: c.chartArea.width, height: c.chartArea.height } : null;
  });
  try {
    await page.goto(base + "stock.html?code=600519#stock-value");
    await page.waitForFunction(() => window.__liquorReady === true);
    for (const code of Object.keys(data.companies)) {
      await page.locator("#primary-select").selectOption(code);
      for (const key of ["pe", "pb"]) {
        const raw = await chart("valuation-" + key), percentile = await chart("valuation-" + key + "-percentile");
        assert(raw?.width > 0 && raw.height > 100, code + " nonblank raw chart area");
        assert(percentile?.height > 100, code + " percentile chart area");
        const expected = calculate(observations(data.companies[code].long.rows, key, "long"), key).at(-1);
        assert.equal(raw.datasets[5].data.at(-1), expected.value, code + " raw latest value");
        assert.equal(raw.datasets[4].data.at(-1), expected.mean, code + " latest rolling mean");
        assert.equal(percentile.datasets[1].data.at(-1), expected.percentile10, code + " 10 year percentile");
        assert.equal(percentile.min, 0); assert.equal(percentile.max, 100);
      }
    }
    await page.locator("#primary-select").selectOption("600519");
    const full = await chart("valuation-pe");
    await page.locator("#valuation-range").selectOption("5");
    const shortened = await chart("valuation-pe");
    assert(shortened.labels.length < full.labels.length);
    assert.equal(shortened.datasets[4].data.at(-1), full.datasets[4].data.at(-1), "Display range must not change rolling history");
    await page.locator("#valuation-range").selectOption("10");
    await page.locator("#stock-value").scrollIntoViewIfNeeded();
    await page.screenshot({ path: out + "/desktop.png" });
    await page.locator('[data-zoom="valuation-pe"]').click();
    assert.equal(await page.locator("dialog canvas").count(), 1);
    await page.locator("dialog button").click();
    await page.locator('[data-valuation-source="daily"]').click();
    const daily = await chart("valuation-pe-percentile");
    assert(daily.datasets[0].data.some((v) => v !== null));
    assert(daily.datasets[1].data.every((v) => v === null), "2018 onwards is not a full 10 year window");
    assert.match(await page.locator("#valuation-history").innerText(), /10年窗口覆盖不足/);
    await page.reload(); await page.waitForFunction(() => window.__liquorReady === true);
    assert.equal(await page.locator('[data-valuation-source="daily"]').getAttribute("aria-pressed"), "true");
    await page.locator('[data-valuation-source="long"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#stock-value").scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile must not overflow");
    const mobile = await chart("valuation-pe");
    assert(mobile.height > 100, "Mobile legend must leave room for curves");
    const colored = await page.locator("#valuation-pe").evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 50 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) count++;
      return count;
    });
    assert(colored > 500, "Canvas must contain colored curves");
    await page.screenshot({ path: out + "/mobile.png" });
    await page.locator("#valuation-pe").screenshot({ path: out + "/mobile-chart.png" });
    await page.route("**/valuation.json?v=1", (route) => route.fulfill({ status: 503, body: "unavailable" }));
    await page.reload(); await page.waitForFunction(() => window.__liquorReady === true);
    assert.match(await page.locator("#valuation-history").innerText(), /历史估值数据暂不可用/);
    assert(await page.locator("#metric-period").isVisible().catch(() => false) || await page.locator("#metric-period").count() === 1);
    assert.deepEqual(errors, []);
    console.log("19 companies, raw curves, 5/10 year percentiles, stable range statistics, source switch, zoom, URL reload, desktop/mobile canvas and missing source fallback OK");
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
