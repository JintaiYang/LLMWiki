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
      const chart = Chart.getChart(canvas);
      const legendMarkers = chart.options.plugins.legend.display ? chart.legend.legendHitBoxes.map((box, index) => {
        const ratio = chart.currentDevicePixelRatio;
        const x = Math.max(0, Math.floor(box.left * ratio)), y = Math.max(0, Math.floor(box.top * ratio));
        const width = Math.min(Math.ceil(24 * ratio), canvas.width - x), height = Math.min(Math.ceil(box.height * ratio), canvas.height - y);
        const marker = ctx.getImageData(x, y, width, height).data;
        let coloredPixels = 0;
        for (let i = 0; i < marker.length; i += 4) if (marker[i + 3] > 80 && Math.max(marker[i], marker[i + 1], marker[i + 2]) - Math.min(marker[i], marker[i + 1], marker[i + 2]) > 35) coloredPixels++;
        return { label: chart.legend.legendItems[index].text, coloredPixels };
      }) : [];
      return { id: canvas.id, width: canvas.clientWidth, height: canvas.clientHeight, colored, legendMarkers };
    }));
    for (const r of results) {
      assert(r.width > 150 && r.height > 100, "Chart has invalid dimensions: " + JSON.stringify(r));
      assert(r.colored > 25, "Chart has no colored data pixels: " + JSON.stringify(r));
      for (const marker of r.legendMarkers) assert(marker.coloredPixels > 2, "Legend color marker is missing: " + r.id + " " + JSON.stringify(marker));
    }
    return results.length;
  }
  async function checkLayout() {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Page has horizontal overflow");
    const overlaps = await page.locator(".kpi,.head-controls,.dimension-row,.research-nav-inner").evaluateAll((nodes) => nodes.filter((n) => n.scrollWidth > n.clientWidth + 2).map((n) => n.className));
    assert.deepEqual(overlaps, [], "Controls overflow: " + overlaps.join(","));
  }
  async function trendData(id) {
    return page.locator("#" + id).evaluate((canvas) => {
      const chart = Chart.getChart(canvas);
      return { labels: chart.data.labels, datasets: chart.data.datasets.map((d) => ({ label: d.label, data: d.data, axis: d.yAxisID, unit: d.valueUnit, notes: d.yoyNotes })),
        leftAxis: chart.options.scales.y.title.text, rightAxis: chart.options.scales.y1.title.text };
    });
  }
  async function selectMetricGroup(group) {
    await page.locator(`[data-metric-group="${group}"]`).click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const [name, file] of [["industry", "industry.html"], ["compare", "index.html"], ["stock", "stock.html?code=600519&compare=000858"], ["formula", "score-formula.html"]]) {
        await go(file);
        assert.match(await page.locator('.page-head .meta').innerText(), /V5/, 'All views must use the V5 snapshot');
        await checkLayout();
        const chartCount = await checkCanvas();
        if (name === "stock") {
          const snapshot = await page.locator('.kpi-strip').innerText();
          assert.match(snapshot, /2025A 营业收入\s+1,688\.38/);
          assert.match(snapshot, /2025A 归母净利润\s+823\.2/);
          assert.equal(await page.locator('.pnl-hero,.pnl-callout').count(), 0, 'Sankey must not repeat the overview summary');
          assert.match(await page.locator('#sankey-primary .pnl-reconciliation').innerText(), /2025年报口径\s+营业收入 1,688\.38亿\s+\+ 利息收入 32\.16亿\s+= 营业总收入 1,720\.54亿/);
          assert.match(await page.locator('#sankey-comparison .pnl-reconciliation').textContent(), /营业收入与营业总收入均为 405\.29亿/);
          assert.match(await page.locator('#sankey-primary .pnl-svg').textContent(), /归母净利润 823\.2亿/);
          assert.match(await page.locator('.score-main').innerText(), /95\.45/);
          assert.equal(await page.locator('.score-summary .dimension-row').count(), 5);
          const dimensionLabels = await page.locator('.score-summary .dimension-row > span:first-child').allTextContents();
          assert.deepEqual(dimensionLabels, ['A 盈利质量', 'B 现金创造', 'C 家底质量', 'D 经营韧性', 'E 股东回报']);
          const revenue = await trendData("stock-revenue");
          assert.equal(await page.locator('#range-select').inputValue(), '20');
          assert.deepEqual(revenue.labels, Array.from({ length: 20 }, (_, index) => 2006 + index));
          assert.equal(revenue.datasets[0].data[0], 4903375765.41 / 1e8);
          assert(Math.abs(revenue.datasets[2].data[0] - (4903375765.41 - 3930515237.61) / 3930515237.61 * 100) < 1e-8, '2006 YoY must use the disclosed 2005 baseline');
          assert.equal(await page.locator('#sankey-primary .pnl-year-select option[value="2006"]').count(), 1);
          assert.equal(await page.locator('#sankey-primary .pnl-year-select option[value="2005"]').count(), 0);
          assert.equal(revenue.datasets.filter((d) => d.axis === "y").length, 2);
          assert.equal(revenue.datasets.filter((d) => d.axis === "y1").length, 2);
          assert.equal(revenue.leftAxis, "亿元");
          assert.equal(revenue.rightAxis, "YoY / %");
          assert.equal((await trendData("stock-margin")).rightAxis, "同比变化 / pp");
          const groups = await page.locator("[data-metric-group]").evaluateAll((nodes) => nodes.map((node) => node.dataset.metricGroup));
          assert.equal(groups.length, 7);
          let metricCount = 0;
          for (const group of groups) {
            await selectMetricGroup(group);
            await checkLayout();
            await checkCanvas();
            const count = await page.locator("[data-metric-row]").count();
            metricCount += count;
            assert(count >= 6);
            assert.equal(await page.evaluate(() => Object.keys(Chart.instances).length), await page.locator("canvas").count(), "Old metric charts must be destroyed when switching groups");
            await page.screenshot({ path: path.join(output, `metrics-${group}-${viewport.width}.png`), fullPage: true });
          }
          assert.equal(metricCount, 67);
          await page.locator("#metric-search").fill("ROE");
          await page.waitForFunction(() => document.querySelectorAll("[data-metric-row]").length === 2);
          assert.equal(await page.locator("#metric-search").inputValue(), "ROE");
          assert.equal(await page.evaluate(() => document.activeElement.id), "metric-search");
          await page.locator("#metric-search").fill("不存在的财务指标");
          assert.match(await page.locator("#metric-content").innerText(), /没有匹配的财务指标/);
          assert.equal(await page.locator("#metric-charts canvas").count(), 0);
          await selectMetricGroup("profit");
        }
        if (name === 'formula') {
          assert.match(await page.locator('#formula-example').innerText(), /95\.45/);
          assert.equal(await page.locator('#formula-liquidity tbody tr').count(), 5);
          assert.equal(await page.locator('#formula-safety tbody tr').count(), 4);
          assert.match(await page.locator('#formula-example').innerText(), /非经常收益依赖/);
          assert.match(await page.locator('#formula-example').innerText(), /销售占款约束/);
          assert.match(await page.locator('#formula-changes h2').innerText(), /V4 到 V5/);
          assert.match(await page.locator('#formula-sources').innerText(), /25 \/ 30 \/ 25 \/ 10 \/ 10/);
        }
        await page.screenshot({ path: path.join(output, `${name}-${viewport.width}.png`), fullPage: true });
        console.log(`${name} ${viewport.width}: ${chartCount} populated charts, layout OK`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("industry.html");
    await page.locator("#industry-period").selectOption("2025");
    assert.deepEqual((await trendData('ind-revenue')).labels, Array.from({ length: 20 }, (_, index) => (2006 + index) + 'A'));
    assert.equal(await page.locator('#industry-period option').filter({ hasText: '2006 年报' }).count(), 1);
    assert.equal(await page.locator('.history-coverage tbody tr').count(), 20);
    assert.match(await page.locator('.history-coverage tbody tr').first().textContent(), /2006-12-3114 \/ 19/);
    assert.equal((await trendData('ind-revenue')).datasets[0].data[0], null, 'A partial historical sample must not be shown as a complete 19-company aggregate');
    assert.match(await page.locator("#workspace > .note-line").innerText(), /完整年度/);
    assert.equal(await page.locator("#industry-sample-table tbody tr").count(), 19);
    await page.locator("#ind-cash").scrollIntoViewIfNeeded();
    const legendPoint = await page.locator("#ind-cash").evaluate((canvas) => {
      const chart = Chart.getChart(canvas), box = chart.legend.legendHitBoxes[0];
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.locator("#ind-cash").click({ position: legendPoint });
    await page.waitForFunction(() => Chart.getChart(document.getElementById("ind-cash")).isDatasetVisible(0) === false);
    await page.locator("#ind-cash").click({ position: legendPoint });
    await page.waitForFunction(() => Chart.getChart(document.getElementById("ind-cash")).isDatasetVisible(0) === true);
    await go("index.html");
    await page.locator('[data-style-filter="missing"]').click();
    assert.equal(await page.locator("#comparison-table tbody tr").count(), 1);
    await page.locator('[data-style-filter="all"]').click();
    await page.locator('#comparison-mode').click();
    await page.locator('[data-select="600519"]').check();
    await page.locator('[data-select="000858"]').check();
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
    await page.locator('#sankey-primary .pnl-year-select').selectOption('2024');
    assert.match(await page.locator("#sankey-primary .pnl-chart-head").innerText(), /2024年报/);
    assert.match(await page.locator("#sankey-comparison .pnl-chart-head").innerText(), /2024年报/);
    assert.match(await page.locator('#sankey-primary .pnl-reconciliation').innerText(), /2024年报口径\s+营业收入 1,708\.99亿\s+\+ 利息收入 32\.45亿\s+= 营业总收入 1,741\.44亿/);
    assert.match(await page.locator('.kpi-strip').innerText(), /2025A 营业收入\s+1,688\.38/);
    await page.locator("#sankey-primary .pnl-svg rect").first().hover();
    assert.match(await page.locator("#sankey-primary .pnl-tip").innerText(), /金额.*亿/);
    await page.locator("#range-select").selectOption("10");
    assert.equal(await page.evaluate(() => Chart.getChart(document.getElementById("stock-revenue")).data.labels.length), 10);
    await page.locator('#range-select').selectOption('20');
    assert.equal((await trendData('stock-revenue')).labels.length, 20);
    await page.locator('#sankey-primary .pnl-year-select').selectOption('2006');
    assert.match(await page.locator('#sankey-primary .pnl-reconciliation').textContent(), /2006年报口径/);
    assert.match(await page.locator('#sankey-primary .pnl-svg').textContent(), /营业收入 49\.03亿/);
    assert.equal(await page.locator('#sankey-primary .pnl-svg path').count() > 0, true);
    await page.locator('#range-select').selectOption('10');
    await page.locator('[data-zoom="stock-revenue"]').click();
    assert.equal(await page.locator("dialog[open]").count(), 1);
    assert.equal(await page.locator("dialog canvas").count(), 1);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await checkCanvas();
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
    await go("stock.html?code=600519&metrics=cash");
    assert.equal(await page.locator('[data-metric-group="cash"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#stock-cfo").count(), 1);
    await go("stock.html?code=600519#stock-channel");
    assert.equal(await page.locator('[data-metric-group="channel"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#stock-inventory").count(), 1);
    await go("index.html");
    await page.locator('[data-style-filter="loss"]').click();
    assert.equal(await page.locator("#comparison-table tbody tr").count(), 3);
    await page.locator("#reset").click();
    await page.locator('[data-sort="roic"]').click();
    assert.equal(await page.locator("#comparison-table tbody tr").count(), 19);
    assert.match(await page.locator('#comparison-table thead').innerText(), /流动性缓冲约束/);
    assert.match(await page.locator('#comparison-table thead').innerText(), /销售占款约束/);
    assert.match(await page.locator('#comparison-table thead').innerText(), /经营造血正值年占比/);
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

    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../dashboard/data.json"), "utf8"));
    const primary = fixture.companies.find((c) => c.code === "600519");
    const revenueValues = [100, 200, 400, null, 800, 1000];
    const cashValues = [100, -20, -10, 0, 100, -50];
    const marginValues = [30, 25, 20, 23, 21, 22];
    for (let index = 0; index < 6; index++) {
      const row = primary.annual.find((r) => r.year === 2020 + index);
      row.revenue = revenueValues[index]; row.cfo = cashValues[index]; row.operating_margin = marginValues[index];
    }
    const comparison = fixture.companies.find((c) => c.code === "000858");
    comparison.annual = comparison.annual.filter((r) => r.year !== 2022);
    for (const company of [primary, comparison]) for (const row of company.annual) row.research_expense_ratio = null;
    await page.route("**/data.json?v=5", (route) => route.fulfill({ json: fixture }));
    await go("stock.html?code=600519&compare=000858&range=5");
    const revenue = await trendData("stock-revenue");
    assert.deepEqual(revenue.labels, [2021, 2022, 2023, 2024, 2025]);
    const primaryYoy = revenue.datasets[2].data;
    assert.deepEqual(primaryYoy, [100, 100, null, null, 25]);
    assert.equal(revenue.datasets[1].data[1], null);
    assert.equal(revenue.datasets[3].data[2], null, "A missing previous year must not be replaced by an older observation");
    if (await page.locator('[data-metric-group="cash"]').count()) await page.locator('[data-metric-group="cash"]').click();
    assert.deepEqual((await trendData("stock-cfo")).datasets[2].data, [-120, 50, 100, null, -150]);
    assert.match((await trendData("stock-cfo")).datasets[2].notes[3], /基数为零/);
    if (await page.locator('[data-metric-group="profit"]').count()) await page.locator('[data-metric-group="profit"]').click();
    assert.deepEqual((await trendData("stock-margin")).datasets[2].data, [-5, -5, 3, -2, 1]);
    await selectMetricGroup("expenses");
    assert.equal(await page.locator('[data-metric-row="research_expense_ratio"]').count(), 1);
    assert.match(await page.locator('[data-metric-row="research_expense_ratio"]').innerText(), /暂无可比值/);
    assert.equal(await page.locator("#stock-metric-research-expense-ratio").count(), 0);
    await selectMetricGroup("profit");
    await page.locator('[data-scale="indexed"]').click();
    const indexed = await trendData("stock-revenue");
    assert.equal(indexed.datasets[0].data[0], 100);
    assert.deepEqual(indexed.datasets[2].data, primaryYoy, "YoY must not change with the amount/index presentation");
    await page.locator("#compare-select").selectOption("");
    assert.equal((await trendData("stock-revenue")).datasets.length, 2);
    await page.unroute("**/data.json?v=5");
    console.log("Trend overlays: shared years, dual units, lookback, missing/zero/negative bases, percentage-point changes and index invariance OK");
    console.log("67 reference metrics: seven groups, live search, values and coverage, chart lifecycle, comparison and deep links OK");
    assert.deepEqual(errors, []);
    console.log("Filters, missing states, sorting, company comparison, URL state, period changes, formula detail and CSV export OK");
    console.log("Screenshots: " + output);
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
