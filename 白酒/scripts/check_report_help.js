"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panel = page.locator("#metric-explanation");
  async function go(url) {
    await page.goto(new URL(url, base).href);
    await page.waitForFunction(() => window.__liquorReady === true);
  }
  try {
    await go("index.html");
    for (const [key, words] of [
      ["contract_liabilities", ["预收货款：80.0674", "95.9245", "经销商保证金20.5617", "待转销项税额9.9496", "102"]],
      ["current_ratio", ["货币资金：516.9061", "拆出资金：990.9619", "吸收存款及同业存放：180.3838", "2,525.1866", "496.1048", "5.09倍"]],
      ["quick_ratio_multiple", ["原材料：37.3845", "在产品：256.6337", "库存商品：45.0677", "自制半成品：275.1883", "3.85倍"]],
    ]) {
      const sort = await page.locator('th[aria-sort="ascending"],th[aria-sort="descending"]').getAttribute("data-column-key");
      await page.locator(`#comparison-table [data-metric-help="${key}"]`).click();
      await page.locator("#report-help-company").selectOption("600519");
      const text = await panel.innerText();
      for (const word of words) assert(text.includes(word), key + " " + word);
      assert.match(text, /贵州茅台 · 2025年报 · 合并口径/);
      assert(!text.includes("比如2倍") && !text.includes("直销、商超、电商客户"));
      const source = await panel.locator('a[href^="/api/knowledge/source/"]').first().getAttribute("href");
      assert.equal((await page.request.get(new URL(source, base).href)).status(), 200);
      await page.locator("#report-help-company").selectOption("000858");
      assert.match(await panel.innerText(), /本期原报构成尚未核对/);
      assert(!(await panel.innerText()).includes("80.0674"));
      assert.equal(await page.locator('th[aria-sort="ascending"],th[aria-sort="descending"]').getAttribute("data-column-key"), sort);
      await page.keyboard.press("Escape");
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [key, group] of [["contract_liabilities", "channel"], ["current_ratio", "balance"], ["quick_ratio_multiple", "balance"]]) {
        await go(`stock.html?code=600519&metrics=${group}&report=2025`);
        await page.locator(`[data-metric-row="${key}"] [data-metric-help="${key}"]`).click();
        assert.match(await panel.innerText(), /贵州茅台 · 2025年报 · 合并口径/);
        assert.equal(await page.locator("#report-help-company").count(), 0);
        const box = await panel.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 845);
        await page.screenshot({ path: `/tmp/liquor-original-${key}-${width}.png` });
        await page.keyboard.press("Escape");
        await page.locator("#metric-period").selectOption("2026-06-30");
        await page.locator(`[data-metric-row="${key}"] [data-metric-help="${key}"]`).click();
        assert.match(await panel.innerText(), /2026中报/);
        assert.match(await panel.innerText(), /本期原报构成尚未核对/);
        assert(!(await panel.innerText()).includes("80.0674"));
        await page.keyboard.press("Escape");
      }
    }
    await go("stock.html?code=600519&metrics=channel&report=2025");
    await page.locator('[data-metric-row="contract_liabilities"] [data-metric-help="contract_liabilities"]').click();
    await panel.getByRole("link", { name: "查看原报构成与核验记录" }).click();
    await page.waitForFunction(() => window.__knowledgeReady === true);
    assert.match(await page.locator("#knowledge-article h2").innerText(), /合同负债具体包括哪些项目/);
    assert.match(await page.locator("#knowledge-article").innerText(), /原报告没有.*按经销商/);
    assert.deepEqual(errors, []);
    console.log("Original-report help: exact components, source PDFs, company/period isolation, no speculative channels, stock/compare controls, knowledge link, desktop/mobile boundaries OK");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
