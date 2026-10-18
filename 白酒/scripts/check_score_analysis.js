"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const data = require("../dashboard/data.json");
const { analyze } = require("../dashboard/score-analysis.js");
const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";
const output = process.env.LIQUOR_SCREENSHOTS || "/tmp/liquor-score-analysis-qa";

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(response.status() + " " + response.url()); });
  async function layout() {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const overflow = await page.locator(".score-dimension-card,.dimension-row,.dimension-analysis").evaluateAll((nodes) => nodes.filter((node) => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 2).map((node) => node.className));
    assert.deepEqual(overflow, []);
  }
  try {
    await page.goto(new URL("stock.html?code=600519&compare=000858", base).href);
    await page.waitForFunction(() => window.__liquorReady === true);
    for (const company of data.companies) {
      await page.locator("#primary-select").selectOption(company.code);
      const cards = analyze(company);
      assert.equal(await page.locator(".score-dimension-card").count(), 5);
      assert.equal(await page.locator(".score-dimension-card[open]").count(), 0);
      assert.equal(await page.locator("[data-score-item]").count(), 13);
      for (const card of cards) {
        const element = page.locator(`[data-score-dimension="${card.letter}"]`);
        assert.equal(await element.locator(".dimension-summary p").innerText(), card.summary);
        assert(card.summary.length <= 22);
        await element.locator("summary").click();
        assert(await element.evaluate((node) => node.open));
        const panel = page.locator(`.score-analysis-dock [data-analysis-owner="${card.letter}"]`);
        await panel.waitFor({ state: "visible" });
        assert.match(await panel.locator(".dimension-conclusion").innerText(), /判断：/);
        assert(!/得分原因|解释现有评分|现有锚点|主要扣分|零分线|满分线/.test(await panel.innerText()));
        assert.equal(await element.locator(".score-analysis-scope").count(), 0);
        for (const item of card.items) {
          const text = await panel.locator(`[data-score-item="${item.key}"]`).innerText();
          assert(text.includes(item.observation));
          assert(!/undefined|NaN/.test(text));
        }
        await element.locator("summary").click();
      }
    }
    await page.locator("#primary-select").selectOption("600519");
    await page.locator("#compare-select").selectOption("000858");
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
      await page.setViewportSize(viewport);
      await layout();
      if (viewport.width >= 1200) {
        const boxes = await page.locator(".score-dimension-card").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
        assert(boxes.every((box) => Math.abs(box.y - boxes[0].y) < 1), "Five cards must share a row");
        assert(boxes.every((box) => box.width < 320 && box.height < 115), "Cards must remain compact");
        assert((await page.locator(".score-summary").boundingBox()).height < 240, "No tall empty columns");
      }
      const card = page.locator('[data-score-dimension="B"]');
      await card.locator("summary").click();
      const dock = page.locator(".score-analysis-dock");
      await dock.waitFor({ state: "visible" });
      assert.match(await dock.innerText(), /五粮液/);
      assert.equal(await dock.locator(".score-item-analysis .score-comparison").count(), 3);
      assert((await dock.boundingBox()).width > (await card.boundingBox()).width * (viewport.width >= 1200 ? 4 : .95));
      await layout();
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, "cash-card-" + viewport.width + ".png") });
      await card.locator("summary").click();
      await card.locator("summary").focus();
      await page.keyboard.press("Enter");
      assert(await card.evaluate((node) => node.open), "Keyboard Enter expands analysis");
      await page.keyboard.press("Space");
      assert(!await card.evaluate((node) => node.open), "Keyboard Space collapses analysis");
      await page.locator('[data-score-dimension="A"] summary').click();
      await page.locator('[data-score-dimension="C"] summary').click();
      assert.equal(await page.locator(".score-dimension-card[open]").count(), 1);
      await page.locator('.score-analysis-dock [data-analysis-owner="C"]').waitFor({ state: "visible" });
      await page.locator('[data-score-dimension="C"] summary').click();
      await page.waitForFunction(() => document.querySelector('.score-analysis-dock').hidden);
      await page.screenshot({ path: path.join(output, "summary-" + viewport.width + ".png"), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log("19-company score cards: 5 dimensions / 13 item analyses, summaries, expand/collapse, keyboard, company switch, comparison and desktop/mobile layout OK");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
