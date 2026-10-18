"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const industry = require("../dashboard/industry.json");
const data = require("../dashboard/data.json");
const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";
const output = process.env.LIQUOR_SCREENSHOTS || "/tmp/liquor-industry-research-qa";

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(new URL("industry.html?period=2026-06-30", base).href);
      await page.waitForFunction(() => window.__liquorReady === true);
      assert.equal(await page.locator("[data-tracking]").count(), 12);
      assert.equal(await page.locator("[data-diagnostic]").count(), 8);
      assert.match(await page.locator("#industry-evidence").innerText(), /承压；终端拐点未确认/);
      assert.match(await page.locator('[data-diagnostic="positive_growth"]').innerText(), /4 家/);
      assert.match(await page.locator('[data-diagnostic="negative_fcf"]').innerText(), /9 家/);
      assert.match(await page.locator('[data-diagnostic="inventory_growth_gap"]').innerText(), /19\.14 pp/);
      assert.match(await page.locator('[data-diagnostic="sample_cr6"]').innerText(), /87\.26 %/);
      for (const row of await page.locator("[data-tracking]").all()) {
        assert.match(await row.innerText(), /待采集/);
        assert(!await row.locator("details").getAttribute("open"));
      }
      await page.locator('[data-tracking="channel_inventory"] summary').click();
      assert.match(await page.locator('[data-tracking="channel_inventory"]').innerText(), /不得用厂商报表库存/);
      assert.equal(await page.locator('#source-cada2026 a').getAttribute('href'), 'https://www.cada.cc/Item/1555.aspx');
      const pdfHref = await page.locator('#source-maotai2024 a').getAttribute('href');
      const pdf = await page.request.get(new URL(pdfHref, page.url()).href);
      assert(pdf.ok(), "Local annual report source must be accessible");
      assert.match(await page.locator("#industry-sources").innerText(), /2026-12-31.*2026-08-31/);
      const text = (await page.locator("#industry-evidence").innerText()) + (await page.locator("#industry-tracking").innerText());
      assert(!/\b(?:cash_to_current|owner_fcf|inventory_growth_gap)\b/.test(text));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const blank = await page.locator("canvas:visible").evaluateAll((nodes) => nodes.filter((c) => {
        const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let colored = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 80 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 35) colored++;
        return colored < 25;
      }).map((c) => c.id));
      assert.deepEqual(blank, []);
      await page.screenshot({ path: path.join(output, "industry-research-" + viewport.width + ".png"), fullPage: true });
      for (const period of ["2025", "2025-09-30", "2026-06-30"]) {
        await page.locator("#industry-period").selectOption(period);
        const day = period.length === 4 ? period + "-12-31" : period;
        const snapshot = industry.research.snapshots.find((s) => s.report_date === day);
        for (const metric of snapshot.diagnostics) {
          const cell = page.locator(`[data-diagnostic="${metric.key}"] td`).first();
          assert.equal(await cell.innerText(), metric.value == null ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(metric.value) + " " + (metric.unit === "百分点" ? "pp" : metric.unit));
        }
        assert.equal(await page.locator('[data-tracking="wholesale_price"] .tag').innerText(), "待采集");
      }
      await page.locator("#industry-period").selectOption("2006");
      assert.match(await page.locator('[data-diagnostic="sample_cr6"] td').first().innerText(), /—/);
    }
    assert.equal(industry.research.financial_as_of, data.as_of);
    assert.deepEqual(errors, []);
    console.log("Industry research: 12 pending observations, 8 diagnostics, source links, date boundaries, report switching, missing coverage, desktop/mobile layout and canvas pixels OK");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
