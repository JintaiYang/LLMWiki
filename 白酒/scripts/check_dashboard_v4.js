"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";
const output = process.env.LIQUOR_SCREENSHOTS || "/tmp/liquor-v4-qa";

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const launch = { headless: true };
  if (process.env.LIQUOR_CHROME_PATH) launch.executablePath = process.env.LIQUOR_CHROME_PATH;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(response.status() + " " + response.url()); });
  async function go(file) {
    await page.goto(new URL(file, base).href);
    await page.waitForFunction(() => window.__liquorReady === true);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function checkCanvas() {
    const results = await page.locator("canvas:visible").evaluateAll((canvases) => canvases.map((canvas) => {
      const ctx = canvas.getContext("2d"), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 80 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 35) colored++;
      return { id: canvas.id, width: canvas.clientWidth, height: canvas.clientHeight, colored };
    }));
    for (const r of results) {
      assert(r.width > 150 && r.height > 100, "Chart has invalid dimensions: " + JSON.stringify(r));
      assert(r.colored > 25, "Chart has no colored data pixels: " + JSON.stringify(r));
    }
    return results.length;
  }
  async function checkLayout() {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Page has horizontal overflow");
    const overlaps = await page.locator(".kpi,.head-controls,.dimension-row,.research-nav-inner").evaluateAll((nodes) => nodes.filter((n) => n.scrollWidth > n.clientWidth + 2).map((n) => n.className));
    assert.deepEqual(overlaps, [], "Controls overflow: " + overlaps.join(","));
  }
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const [name, file] of [["industry", "industry.html"], ["compare", "index.html"], ["stock", "stock.html?code=600519&compare=000858"], ["formula", "score-formula.html"]]) {
        await go(file);
        await checkLayout();
        const chartCount = await checkCanvas();
        await page.screenshot({ path: path.join(output, `${name}-${viewport.width}.png`), fullPage: true });
        console.log(`${name} ${viewport.width}: ${chartCount} populated charts, layout OK`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("industry.html");
    await page.locator("#industry-period").selectOption("2025");
    assert.match(await page.locator(".note-line").innerText(), /完整年度/);
    assert.equal(await page.locator("#industry-sample-table tbody tr").count(), 19);
    await go("index.html");
    await page.locator("#company-search").fill("不存在的公司");
    assert.match(await page.locator("#comparison-table").innerText(), /没有匹配公司/);
    await page.locator("#company-search").fill("600519");
    assert.equal(await page.locator("#comparison-table tbody tr").count(), 1);
    await page.locator('[data-select="600519"]').check();
    await page.locator("#company-search").fill("五粮液");
    await page.locator('[data-select="000858"]').check();
    await page.locator("#company-search").fill("");
    await page.locator("#only-selected").check();
    assert.equal(await page.locator("#comparison-table tbody tr").count(), 2);
    await page.locator("#open-comparison").click();
    await page.waitForFunction(() => window.__liquorReady === true && document.body.dataset.page === "stock");
    assert.equal(await page.locator("#compare-select").inputValue(), "000858");
    await page.locator("#compare-select").selectOption("600809");
    assert.match(page.url(), /compare=600809/);
    assert.equal(await page.locator("#sankey-primary .pnl-svg").count(), 1);
    assert.equal(await page.locator("#sankey-comparison .pnl-svg").count(), 1);
    await page.locator(".sankey-comparison summary").click();
    await page.locator('#sankey-primary [data-year="2024"]').click();
    assert.match(await page.locator("#sankey-primary .pnl-chart-head").innerText(), /2024年报/);
    assert.match(await page.locator("#sankey-comparison .pnl-chart-head").innerText(), /2024年报/);
    await page.locator("#sankey-primary .pnl-svg rect").first().hover();
    assert.match(await page.locator("#sankey-primary .pnl-tip").innerText(), /金额.*亿/);
    await page.locator("#range-select").selectOption("10");
    assert.equal(await page.evaluate(() => Chart.getChart(document.getElementById("stock-revenue")).data.labels.length), 10);
    await page.locator('[data-zoom="stock-revenue"]').click();
    assert.equal(await page.locator("dialog[open]").count(), 1);
    assert.equal(await page.locator("dialog canvas").count(), 1);
    await page.getByRole("button", { name: "关闭放大视图" }).click();
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(await page.locator("dialog").count(), 0);
    await page.locator('[data-scale="indexed"]').click();
    assert.equal(await page.evaluate(() => Chart.getChart(document.getElementById("stock-revenue")).data.datasets[0].data[0]), 100);
    await page.locator("#primary-select").selectOption("600199");
    assert.match(await page.locator(".score-summary").innerText(), /待核验/);
    await page.locator('[data-scale="amount"]').click();
    const companyOptions = await page.locator("#primary-select option").evaluateAll((nodes) => nodes.map((n) => ({ code: n.value, name: n.textContent })));
    for (const company of companyOptions) {
      await page.locator("#primary-select").selectOption(company.code);
      assert.equal(await page.locator("#sankey-primary .pnl-svg").count(), 1, company.name + " has no Sankey");
      assert(await page.locator("#sankey-primary .pnl-svg path").count() > 0, company.name + " has no flow ribbons");
      assert.match(await page.locator("#sankey-primary .pnl-svg").getAttribute("aria-label"), new RegExp(company.name + "利润流向桑基图"));
      assert(!/NaN|Infinity/.test(await page.locator("#sankey-primary .pnl-svg").innerHTML()), company.name + " has invalid flow geometry");
    }
    await page.locator("#primary-select").selectOption("000799");
    assert.match(await page.locator("#sankey-primary .pnl-svg").textContent(), /归母净利润 -0.34亿/);
    await page.locator("#primary-select").selectOption("000995");
    assert.match(await page.locator("#sankey-primary .pnl-svg").textContent(), /归母净利润 0.14亿/);
    console.log("19 company Sankeys, synchronized years, comparison chart, hover details and signed profit labels OK");
    await go("index.html");
    await page.locator("#status-filter").selectOption("missing");
    assert.equal(await page.locator("#comparison-table tbody tr").count(), 3);
    await page.locator("#reset").click();
    await page.locator('[data-group="profit"]').click();
    await page.locator('[data-sort="roic"]').click();
    assert.equal(await page.locator("#comparison-table tbody tr").count(), 19);
    await page.locator('[data-group="core"]').click();
    await page.locator('[data-sort="score"]').click();
    const scoreRows = await page.locator("#comparison-table tbody tr").allTextContents();
    assert(scoreRows.slice(-3).every((text) => text.includes("待核验")), "Missing scores must stay last in either sort direction");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#download").click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, "filtered.csv"));
    assert.equal(fs.readFileSync(path.join(output, "filtered.csv"), "utf8").split("\r\n").length, 20);
    await go("score-formula.html");
    await page.locator("#formula-company").selectOption("000799");
    assert.match(await page.locator("#formula-example").innerText(), /最新完整年归母亏损/);
    await page.locator("#formula-company").selectOption("000995");
    assert.match(await page.locator("#formula-example").innerText(), /可能区间/);
    assert.equal(await page.locator("#formula-example tbody tr:not(.dim-heading)").count(), 13);
    assert.deepEqual(errors, []);
    console.log("Filters, missing states, sorting, company comparison, URL state, period changes, formula detail and CSV export OK");
    console.log("Screenshots: " + output);
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
