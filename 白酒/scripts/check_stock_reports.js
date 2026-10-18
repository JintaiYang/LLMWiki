"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const data = require("../dashboard/data.json");
const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";
const output = process.env.LIQUOR_SCREENSHOTS || "/tmp/liquor-stock-reports-qa";
const annualOnly = new Set(["roa", "roe", "consolidated_roe", "equity_multiplier", "asset_turnover", "receivables_turnover", "receivables_days", "inventory_turnover", "inventory_days", "fixed_asset_turnover", "revenue_cagr_3y", "profit_cagr_3y", "cashflow_profit_3y", "dps", "dividend_cash_CNY", "payout_pct", "dividend_yield_year_end", "year_end_price", "year_end_pe"]);
const company = (code) => data.companies.find((c) => c.code === code);
const record = (co, period) => period.length === 4 ? co.annual.find((r) => String(r.year) === period) || {} : co.quarterly.find((r) => r.report_date === period) || {};
const previous = (period) => String(Number(period.slice(0, 4)) - 1) + period.slice(4);
const value = (co, period, key) => period.length > 4 && annualOnly.has(key) ? null : record(co, period)[key] ?? null;
const formatted = (number, unit) => number === null ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(unit === "亿元" ? number / 1e8 : number) + (unit === "%" ? "%" : " " + unit);

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function go(query = "") { await page.goto(new URL("stock.html?code=600519&compare=000858" + query, base).href); await page.waitForFunction(() => window.__liquorReady === true); }
  async function tableValues(period, group) {
    for (const key of data.financial_metrics.groups.find((g) => g.id === group).metrics) {
      const cells = page.locator(`[data-metric-row="${key}"] td`), spec = data.financial_metrics.metrics[key];
      assert.equal(await cells.nth(1).innerText(), formatted(value(company("600519"), period, key), spec.unit), key + " primary report");
      assert.equal(await cells.nth(2).innerText(), formatted(value(company("600519"), previous(period), key), spec.unit), key + " prior comparable report");
      assert.equal(await cells.nth(5).innerText(), formatted(value(company("000858"), period, key), spec.unit), key + " comparison company report");
      if (period.length > 4 && annualOnly.has(key)) assert.match(await cells.nth(4).innerText(), /仅年报/);
    }
    assert.match(await page.locator('.score-main').innerText(), /95\.45/, 'Switching report must not change the five-year score');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  async function charts(period) {
    const result = await page.locator('#metric-charts canvas').evaluateAll((nodes) => nodes.map((node) => {
      const chart = Chart.getChart(node); return { id: node.id, labels: chart.data.labels, data: chart.data.datasets.map((d) => ({ data: d.data, axis: d.yAxisID })) };
    }));
    for (const chart of result) {
      const aliases = { "stock-revenue": "revenue", "stock-profit": "net_profit", "stock-margin": "operating_margin", "stock-gross-margin": "gross_margin", "stock-cfo": "cfo", "stock-fcf": "owner_fcf", "stock-inventory": "inventory_to_revenue", "stock-contract": "contract_to_revenue" };
      const key = aliases[chart.id] || chart.id.replace("stock-metric-", "").replace(/-/g, "_");
      const unit = data.financial_metrics.metrics[key].unit;
      assert.equal(chart.data.length, 4, 'Both companies keep value and YoY series');
      for (const [index, code] of ["600519", "000858"].entries()) {
        const current = value(company(code), period, key), prior = value(company(code), previous(period), key);
        const expected = current === null ? null : unit === "亿元" ? current / 1e8 : current;
        assert.equal(chart.data[index].data.at(-1), expected, chart.id + " current value must use selected report");
        const yoy = current === null || prior === null ? null : unit === "%" ? current - prior : prior === 0 ? null : (current - prior) / Math.abs(prior) * 100;
        assert.equal(chart.data[index + 2].data.at(-1), yoy, chart.id + " YoY must use the same period last year");
      }
      if (period.length > 4) {
        const suffix = { "03-31": "Q1", "06-30": "H1", "09-30": "9M" }[period.slice(5)];
        assert(chart.labels.every((label) => label.endsWith(suffix)));
        assert.equal(chart.labels.at(-1), period.slice(0, 4) + suffix);
      }
    }
  }
  try {
    await go();
    assert.equal(await page.locator('#sankey-primary .pnl-year-btn').count(), 0);
    assert.equal(await page.locator('#sankey-primary .pnl-year-select').inputValue(), '2025');
    assert(await page.locator('#sankey-primary [data-year-step="1"]').isDisabled());
    await page.locator('#sankey-primary [data-year-step="-1"]').click();
    assert.equal(await page.locator('#sankey-primary .pnl-year-select').inputValue(), '2024');
    assert.equal(await page.locator('#sankey-comparison .pnl-year-select').inputValue(), '2024');
    await page.locator('#sankey-primary .pnl-year-select').selectOption('2006');
    assert(await page.locator('#sankey-primary [data-year-step="-1"]').isDisabled());
    await page.locator('#sankey-primary [data-year-step="1"]').click();
    assert.equal(await page.locator('#sankey-primary .pnl-year-select').inputValue(), '2007');
    await page.locator('#sankey-primary .pnl-year-select').selectOption('2025');
    await page.locator('#sankey-primary .pnl-toolbar').screenshot({ path: path.join(output, 'year-dropdown.png') });
    for (const period of ['2026-03-31', '2026-06-30', '2025-09-30', '2025-06-30', '2024']) {
      await page.locator('#metric-period').selectOption(period);
      await tableValues(period, 'profit'); await charts(period);
      assert.equal(await page.locator('#sankey-primary .pnl-year-select').inputValue(), '2025', 'Metric report selection is independent from the annual Sankey');
    }
    await page.locator('#metric-period').selectOption('2026-06-30');
    for (const group of data.financial_metrics.groups) {
      await page.locator(`[data-metric-group="${group.id}"]`).click();
      await tableValues('2026-06-30', group.id); await charts('2026-06-30');
    }
    await page.locator('[data-metric-group="profit"]').click();
    assert.equal(await page.locator('[data-metric-row="roa"]').count(), 0);
    await page.locator('[data-metric-group="returns"]').click();
    assert.match(await page.locator('[data-metric-row="roa"]').innerText(), /仅年报/);
    assert.equal(await page.locator('#stock-roa').count(), 0);
    await page.locator('[data-metric-group="cash"]').click();
    await page.screenshot({ path: path.join(output, 'quarterly-desktop.png'), fullPage: true });
    await page.reload(); await page.waitForFunction(() => window.__liquorReady === true);
    assert.equal(await page.locator('#metric-period').inputValue(), '2026-06-30', 'Reload retains the report in the URL');
    assert.equal(await page.locator('[data-metric-group="cash"]').getAttribute('aria-pressed'), 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await tableValues('2026-06-30', 'cash');
    await page.locator('#metric-period').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'quarterly-mobile.png') });
    await page.locator('#metric-period').selectOption('2025');
    assert.equal(await page.evaluate(() => Chart.getChart(document.getElementById('stock-cfo')).data.labels.length), 20);
    await go('&report=not-a-period');
    assert.equal(await page.locator('#metric-period').inputValue(), '2025');
    const fixture = structuredClone(data);
    const primary = fixture.companies.find((c) => c.code === '600519');
    const comparison = fixture.companies.find((c) => c.code === '000858');
    primary.quarterly.find((r) => r.report_date === '2025-06-30').cfo = 0;
    comparison.quarterly = comparison.quarterly.filter((r) => r.report_date !== '2026-06-30');
    await page.route('**/data.json?v=5', (route) => route.fulfill({ json: fixture }));
    await go('&report=2026-06-30&metrics=cash');
    const missing = await page.locator('#stock-cfo').evaluate((canvas) => Chart.getChart(canvas).data.datasets.map((d) => d.data));
    assert.equal(missing[2].at(-1), null, 'A zero prior-quarter base must leave YoY blank');
    assert.equal(missing[1].at(-1), null, 'A missing comparison report must not reuse another report date');
    assert.equal(await page.locator('[data-metric-row="cfo"] td').nth(5).innerText(), '—');
    primary.quarterly.find((r) => r.report_date === '2025-06-30').cfo = -100;
    primary.quarterly.find((r) => r.report_date === '2026-06-30').cfo = -50;
    await page.reload(); await page.waitForFunction(() => window.__liquorReady === true);
    assert.equal(await page.locator('#stock-cfo').evaluate((canvas) => Chart.getChart(canvas).data.datasets[2].data.at(-1)), 50, 'Negative base uses its absolute value');
    assert.deepEqual(errors, []);
    console.log('Sankey dropdown, year navigation boundaries, synchronized companies, quarterly/annual values and matching YoYs, annual-only metrics, independent score, URL reload and mobile layout OK');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
