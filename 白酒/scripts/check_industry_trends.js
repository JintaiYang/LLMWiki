"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const data = require("../dashboard/data.json");
const industry = require("../dashboard/industry.json");
const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";
const output = process.env.LIQUOR_SCREENSHOTS || "/tmp/liquor-industry-yoy-qa";
const fields = ["revenue", "net_profit", "cfo", "inventory", "contract_liabilities"];
const point = (day, source = industry) => source.financial_trends.find((r) => r.report_date === day) || {};
const prior = (day) => String(Number(day.slice(0, 4)) - 1) + day.slice(4);
const change = (a, b, ratio = false) => a == null || b == null ? null : ratio ? a - b : b === 0 ? null : (a - b) / Math.abs(b) * 100;
const equal = (a, b, label) => a == null || b == null ? assert.equal(a, b, label) : assert(Math.abs(a - b) < 1e-7, label + ": " + a + " != " + b);

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const chart = (id) => page.locator("#" + id).evaluate((canvas) => {
    const c = Chart.getChart(canvas);
    return { labels: c.data.labels, datasets: c.data.datasets.map((d) => ({ label: d.label, data: d.data, axis: d.yAxisID, unit: d.valueUnit, notes: d.yoyNotes })), left: c.options.scales.y.title.text, right: c.options.scales.y1.title.text };
  });
  async function go(period) {
    await page.goto(new URL("industry.html?period=" + period, base).href);
    await page.waitForFunction(() => window.__liquorReady === true);
  }
  async function validate(period, source = industry) {
    assert.equal(await page.locator("#industry-period").inputValue(), period);
    const date = period.length === 4 ? period + "-12-31" : period;
    const suffix = date.slice(5);
    const dates = source.financial_trends.map((r) => r.report_date).filter((d) => d >= `${data.history?.start_year || 2006}-01-01` && d.endsWith(suffix) && d.slice(0, 4) <= date.slice(0, 4)).slice(-20);
    const labels = dates.map((d) => d.slice(0, 4) + (suffix === "12-31" ? "A" : suffix === "06-30" ? "H1" : "9M"));
    const charts = { "ind-revenue": ["revenue"], "ind-cash": ["net_profit", "cfo"], "ind-channel": ["inventory", "contract_liabilities"] };
    for (const [id, keys] of Object.entries(charts)) {
      const c = await chart(id);
      assert.deepEqual(c.labels, labels);
      assert.equal(c.left, "亿元"); assert.equal(c.right, "YoY / %");
      for (let n = 0; n < keys.length; n++) {
        const key = keys[n];
        assert.equal(c.datasets[n].axis, "y");
        assert.equal(c.datasets[n + keys.length].axis, "y1");
        for (let i = 0; i < dates.length; i++) {
          const current = point(dates[i], source)[key], previous = point(prior(dates[i]), source)[key];
          equal(c.datasets[n].data[i], current == null ? null : current / 1e8, id + " value " + dates[i]);
          equal(c.datasets[n + keys.length].data[i], change(current, previous), id + " YoY " + dates[i]);
        }
      }
    }
    const margins = await chart("ind-margins");
    assert.equal(margins.right, "同比变化 / pp");
    const ratio = (day, key) => {
      const r = point(day, source); return r[key] == null || !(r.revenue > 0) ? null : r[key] / r.revenue * 100;
    };
    for (let n = 0; n < 2; n++) for (let i = 0; i < dates.length; i++) {
      const key = n ? "cfo" : "net_profit", current = ratio(dates[i], key), previous = ratio(prior(dates[i]), key);
      equal(margins.datasets[n].data[i], current, "Aggregate ratio");
      equal(margins.datasets[n + 2].data[i], change(current, previous, true), "Ratio change in percentage points");
    }
    for (const field of fields) {
      const total = point(date, source)[field];
      const displayed = await page.locator(`[data-total="${field}"]`).innerText();
      assert.equal(displayed, total == null ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(total / 1e8));
    }
    assert.equal(await page.locator("#industry-sample-table tbody tr").count(), 19);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  try {
    for (const period of ["2026-06-30", "2025-06-30", "2025-09-30", "2025", "2024"]) {
      await go(period); await validate(period);
      await page.locator("#industry-period").selectOption("2026-06-30");
      await validate("2026-06-30");
      assert.match(page.url(), /period=2026-06-30/);
    }
    const cards = await page.locator(".kpi-strip").innerText();
    assert.match(cards, /2026中报 · 营业收入\s+1,963\.19/);
    assert.match(cards, /2026中报 · 归母净利润\s+731/);
    await page.screenshot({ path: path.join(output, "industry-h1-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await validate("2026-06-30");
    await page.screenshot({ path: path.join(output, "industry-h1-mobile.png"), fullPage: true });
    const fixture = structuredClone(industry);
    point("2025-06-30", fixture).cfo = -100;
    point("2026-06-30", fixture).cfo = -50;
    point("2025-06-30", fixture).net_profit = 0;
    point("2024-06-30", fixture).inventory = null;
    await page.route("**/industry.json?v=5.4", (route) => route.fulfill({ json: fixture }));
    await go("2026-06-30"); await validate("2026-06-30", fixture);
    const cash = await chart("ind-cash");
    assert.equal(cash.datasets[3].data.at(-1), 50, "Negative base must use its absolute magnitude");
    assert.equal(cash.datasets[2].data.at(-1), null, "Zero base must not produce a fake percentage");
    assert.match(cash.datasets[3].notes.at(-1), /基数为负/);
    const channel = await chart("ind-channel");
    assert.equal(channel.datasets[2].data.at(-2), null, "Missing prior must leave YoY empty");
    assert.deepEqual(errors, []);
    console.log("Industry annual/H1/9M periods, 19-company totals, paired axes, all YoYs, percentage points, missing/zero/negative bases and desktop/mobile layout OK");
    console.log("Snapshot verified: 2026H1 revenue 1963.19 / parent profit 731.00 / CFO 807.78 / inventory 1891.88 / contract liabilities 323.84 CNY 100m");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
