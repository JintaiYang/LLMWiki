"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const base = process.env.BANK_DASHBOARD_URL || "http://127.0.0.1:8765/";
const output = process.env.BANK_SCREENSHOTS || "/tmp/bank-layout-qa";
const source = require("../dashboard/stock_data/600036.json");

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BANK_CHROME_PATH ? { executablePath: process.env.BANK_CHROME_PATH } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(response.status() + " " + response.url()); });

  async function go(file) {
    await page.goto(new URL(file, base).href);
    await page.locator(".research-nav").waitFor();
    if (await page.locator("#main-content").count()) await page.locator("#main-content").waitFor({ state: "visible" });
    if (file.startsWith("stock")) await page.locator(".summary-score .score-big").waitFor();
    if (file === "index.html") await page.locator("#table-body tr").first().waitFor();
    await page.waitForTimeout(300);
  }

  async function layout(label) {
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
    assert(overflow.width <= overflow.viewport + 1, label + ": page overflow " + JSON.stringify(overflow));
    const controls = await page.locator(".summary-grid,.dim-card,.control-group,.stock-kpi,.metric-tabs").evaluateAll((nodes) =>
      nodes.filter((n) => n.clientWidth && n.scrollWidth > n.clientWidth + 2).map((n) => n.className));
    assert.deepEqual(controls, [], label + ": control overflow");
    const nav = await page.locator(".research-nav").boundingBox();
    if (await page.locator("#group-nav").isVisible()) {
      await page.locator("#group-nav").scrollIntoViewIfNeeded();
      const rect = await page.locator("#group-nav").boundingBox();
      assert(rect.y >= nav.height - 1, label + ": sticky navigation overlaps");
    }
  }

  async function canvas(id, expected) {
    const node = page.locator("#" + id);
    await node.scrollIntoViewIfNeeded();
    await page.waitForFunction((canvasId) => {
      const element = document.getElementById(canvasId);
      return !!element && !!Chart.getChart(element) && element.width > 0;
    }, id);
    await page.waitForTimeout(350);
    const result = await node.evaluate((element) => {
      const pixels = element.getContext("2d").getImageData(0, 0, element.width, element.height).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 80 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) colored++;
      }
      const chart = Chart.getChart(element);
      return { width: element.clientWidth, height: element.clientHeight, colored,
        datasets: chart.data.datasets.map((d) => ({ label: d.label, data: d.data })) };
    });
    assert(result.width > 180 && result.height > 100, id + ": invalid chart dimensions");
    assert(result.colored > 20, id + ": blank chart");
    if (expected) assert.deepEqual(result.datasets[0].data, expected, id + ": source values changed");
    return result;
  }

  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const file of ["industry.html", "index.html", "stock.html?code=600036&compare=601939", "score-formula.html", "nim_etf_chart.html"]) {
        await go(file);
        await layout(file);
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, file.split(".")[0] + "-" + viewport.width + ".png") });
        if (file === "industry.html") {
          await canvas("chart-pb");
          await page.locator('[data-mode="rolling"]').click();
          await canvas("chart-pb");
        }
        if (file === "index.html") {
          assert.equal(await page.locator(".col-toggle-btn.active").count(), 9);
          assert.equal(await page.locator('[href^="research-layout.css"]').count(), 0);
          assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim()), "#2f6fed");
          const count = await page.locator("#table-head th").count();
          await page.locator('.col-toggle-btn[data-group="profit"]').click();
          assert(await page.locator("#table-head th").count() < count);
          await layout("all comparison columns");
          await page.locator('.col-toggle-btn[data-group="profit"]').click();
          assert.equal(await page.locator("#table-head th").count(), count);
        }
        if (file.startsWith("stock")) {
          const period = source.score.periods.find((p) => p.report_date === "2025-12-31");
          assert.match(await page.locator(".summary-score .score-big").innerText(), new RegExp(String(period.total)));
          assert.equal(await page.locator(".stock-summary .dim-card").count(), 6);
          assert.equal(await page.locator(".dim-comparison").count(), 6);
          assert.equal(await page.locator(".indicator-item").count(), source.indicators.items.length);
          assert.equal(await page.locator(".indicator-history[open]").count(), 0);
          const graph = await canvas("chart-score-trend");
          assert(graph.datasets.some((d) => d.label.includes("建设银行")));
          const radar = page.locator("details").filter({ has: page.locator("#chart-radar") });
          await radar.locator("summary").click();
          await canvas("chart-radar");
          await radar.locator("summary").click();
          await page.locator('[data-dim-toggle="A"]').click();
          assert.equal(await page.locator('[data-dim-toggle="A"]').getAttribute("aria-expanded"), "true");
          await page.locator('[data-dim-toggle="A"]').press("Enter");
          assert.equal(await page.locator('[data-dim-toggle="A"]').getAttribute("aria-expanded"), "false");
          await page.locator('[data-group="group-metrics"]').click();
          assert(await page.locator("#group-metrics").isVisible());
          assert(!await page.locator("#group-overview").isVisible());
          for (const dim of "ABCDEF") {
            await page.locator(`[data-dimension="${dim}"]`).click();
            await page.locator("#group-nav").scrollIntoViewIfNeeded();
            for (const item of source.indicators.items.filter((i) => i.id.startsWith(dim))) {
              const values = item.series.filter((p) => p.d.slice(5, 7) === "12").slice(-20).map((p) => p.v);
              await canvas("chart-ind-" + item.id, values);
            }
            await layout("dimension " + dim);
          }
          await page.locator('[data-dimension="C"]').click();
          await page.locator("#group-nav").scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(output, "metrics-" + viewport.width + ".png") });
          const history = page.locator("#ind-C1 .indicator-history");
          await history.locator("summary").click();
          assert(await history.locator("table").isVisible());
          await page.locator("#granularity-select").selectOption("quarter");
          await page.locator("#range-select").selectOption("40");
          assert(new URL(page.url()).hash === "#group-dimC", "Metric selection must survive report/control changes");
          const c1 = source.indicators.items.find((item) => item.id === "C1");
          await canvas("chart-ind-C1", c1.series.slice(-40).map((p) => p.v));
          await page.locator('[data-group="group-dimG"]').click();
          assert(await page.locator(".ddm-panel").isVisible());
          await canvas("chart-ind-G2");
          await layout("valuation");
          await page.locator('[data-group="group-pnl"]').click();
          assert(await page.locator(".pnl-svg").isVisible());
          await layout("sankey");
          await page.screenshot({ path: path.join(output, "sankey-" + viewport.width + ".png") });
          await page.locator('[data-group="group-scale"]').click();
          await canvas("chart-scale-trend-profit");
          await layout("scale");
          await page.locator('[data-group="group-qual"]').click();
          await layout("qualitative");
          await page.locator("#score-period-select").selectOption("2024-12-31");
          assert.match(await page.locator(".summary-score").innerText(), /2024A/);
          await page.locator("#compare-select").selectOption("");
          await page.waitForFunction(() => !document.querySelector(".dim-comparison"));
          await page.locator("#primary-select").selectOption("601939");
          await page.waitForFunction(() => document.getElementById("page-title").textContent.includes("建设银行"));
          await layout("company switch");
        }
      }
      await go("stock.html?code=600036#group-dimD");
      assert(await page.locator("#group-dimD").isVisible());
      await page.locator('[data-dimension="E"]').click();
      await page.goBack();
      assert(await page.locator("#group-dimD").isVisible());
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const code of ["001227", "600015", "601398"]) {
      await go("stock.html?code=" + code);
      await page.locator('[data-group="group-metrics"]').click();
      await layout("additional bank " + code);
    }
    assert.deepEqual(errors, []);
    console.log("PASS: five pages at desktop/mobile, all 23 source metric series unchanged, original comparison palette/layout, score periods, annual/quarterly ranges, disclosures, theme links, history and chart pixels. Screenshots: " + output);
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
