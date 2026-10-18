"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { classify } = require("../dashboard/company-style.js");

const base = process.env.LIQUOR_DASHBOARD_URL || "http://127.0.0.1:8766/";
const output = process.env.LIQUOR_SCREENSHOTS || "/tmp/liquor-company-columns-qa";
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../dashboard/data.json"), "utf8"));
const byCode = new Map(data.companies.map((company) => [company.code, company]));
const year = Math.max(...data.companies.map((company) => company.score.annual_year));
const row = (company, y) => company.annual.find((entry) => entry.year === y) || {};
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;

function expectedValue(company, key) {
  if (key === "score") return company.score.total;
  if (key === "style_tag") return classify(company, year).order;
  if (key === "current_pe") return classify(company, year).pe;
  if (key.startsWith("dimension:")) return company.score.dimensions.find((entry) => entry.name === key.slice(10)).score;
  const item = (name) => company.score.dimensions.flatMap((dimension) => dimension.items).find((entry) => entry.name === name);
  if (key.startsWith("points:")) return item(key.slice(7)).score;
  if (key.startsWith("yoy:")) {
    const field = key.slice(4), current = number(row(company, year)[field]), previous = number(row(company, year - 1)[field]);
    if (current === null || previous === null) return null;
    if (data.financial_metrics.metrics[field].unit === "%") return current - previous;
    return previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;
  }
  if (key === "yield") return number(company.dividend?.yield_pct);
  if (key === "dps") return number(company.dividend?.dps);
  if (Object.hasOwn(data.model.metric_definitions, key)) return item(key).value;
  return number(row(company, year)[key]);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LIQUOR_CHROME_PATH ? { executablePath: process.env.LIQUOR_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const codes = () => page.locator("#comparison-table tbody tr[data-code]").evaluateAll((rows) => rows.map((row) => row.dataset.code));
  const header = (key) => page.locator(`[data-sort="${key}"]`);
  const all = () => page.locator('[data-style-filter="all"]').click();
  async function go(query = "") { await page.goto(new URL("index.html" + query, base).href); await page.waitForFunction(() => window.__liquorReady === true); }
  async function sorted(key) {
    const direction = await header(key).evaluate((button) => button.closest("th").getAttribute("aria-sort"));
    const values = (await codes()).map((code) => key === "name" ? byCode.get(code).name : key === "risks" ? byCode.get(code).score.quality_flags.join("；") || "无已触发评分闸门" : expectedValue(byCode.get(code), key));
    let seenMissing = false, previous = null;
    for (const value of values) {
      if (value == null) { seenMissing = true; continue; }
      assert(!seenMissing, key + ": missing values must stay last");
      if (previous !== null) {
        const delta = typeof value === "number" ? value - previous : String(value).localeCompare(String(previous), "zh-CN");
        assert(direction === "ascending" ? delta >= 0 : delta <= 0, key + ": incorrect sort");
      }
      previous = value;
    }
    assert.equal(await page.locator('#comparison-table th[aria-sort="ascending"], #comparison-table th[aria-sort="descending"]').count(), 1);
  }
  async function layout() {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const overflow = await page.locator('.style-filters button, .comparison-context, .comparison-toolbar').evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.className));
    assert.deepEqual(overflow, []);
  }
  try {
    await go();
    assert.equal(await page.locator('#status-filter, #company-filter, #column-picker-trigger, #company-picker, #column-picker, [data-group]').count(), 0);
    assert.equal(await page.locator('#comparison-table [data-select]').count(), 0);
    assert.equal(await page.locator('#comparison-table [data-metric-help="revenue"], #comparison-table [data-metric-help="net_profit"], #comparison-table [data-metric-help="inventory"]').count(), 0, 'Common metrics do not need question marks');
    for (const key of ['current_ratio', 'quick_ratio_multiple', 'contract_liabilities']) assert.equal(await page.locator(`#comparison-table [data-metric-help="${key}"]`).count(), 1, 'Explicitly requested metric explanations');
    assert(await page.locator('#comparison-table thead [data-metric-help]').count() <= 15, 'Keep header annotations limited to requested and project-specific metrics');
    assert.equal((await codes()).length, 19);
    const bankStyle = await page.locator('.comparison-grid').evaluate((table) => {
      const cell = getComputedStyle(table.tBodies[0].rows[0].cells[4]);
      const dimension = getComputedStyle(table.querySelector('.dimension-cell strong'));
      return { font: getComputedStyle(table).fontSize, padding: [cell.paddingTop, cell.paddingRight], dimension: [dimension.fontSize, dimension.fontWeight], name: getComputedStyle(table.querySelector('.company-cell .company')).color };
    });
    assert.deepEqual(bankStyle, { font: '12px', padding: ['6px', '8px'], dimension: ['13px', '700'], name: 'rgb(8, 127, 112)' }, 'Bank typography and spacing with the liquor palette');
    const keys = await page.locator('#comparison-table [data-sort]').evaluateAll((buttons) => buttons.map((b) => b.dataset.sort));
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(keys.filter((key) => key.startsWith("dimension:")).length, 5);
    assert.equal(keys.filter((key) => key.startsWith("points:")).length, 13);
    for (const key of Object.keys(data.financial_metrics.metrics)) assert(keys.includes(key), "Missing financial column: " + key);
    const shape = await page.locator('.comparison-grid').evaluate((table) => ({ columns: [...table.tHead.rows[0].cells].reduce((sum, cell) => sum + cell.colSpan, 0), rows: [...table.tBodies[0].rows].map((row) => row.cells.length) }));
    assert.equal(shape.columns, keys.length); assert(shape.rows.every((n) => n === keys.length));
    await layout();
    await page.screenshot({ path: path.join(output, 'comparison-desktop.png'), fullPage: true });
    for (const key of keys) { await header(key).click(); await sorted(key); await header(key).click(); await sorted(key); }
    console.log((keys.length - 1) + " permanent indicator columns: all sorts, unique keys and missing placement OK");

    for (const tag of Object.keys(require('../dashboard/company-style.js').tags)) {
      await all(); await page.locator(`[data-style-filter="${tag}"]`).click();
      const expected = data.companies.filter((c) => classify(c, year).id === tag).map((c) => c.code).sort();
      assert.deepEqual((await codes()).sort(), expected);
      assert.equal(await page.locator('[data-sort]').count(), keys.length, 'Tag filtering must retain all columns');
      if (!expected.length) { assert(await page.locator('#download').isDisabled()); assert.equal(await page.locator('.chart-empty').count(), 2); }
    }
    await all();
    await page.locator('[data-style-filter="quality_cheap"]').click();
    await page.locator('[data-style-filter="quality_rich"]').click();
    const expectedQuality = data.companies.filter((c) => ['quality_cheap', 'quality_rich'].includes(classify(c, year).id)).map((c) => c.code).sort();
    assert.deepEqual((await codes()).sort(), expectedQuality, 'Multiple tags use OR semantics');
    await page.reload(); await page.waitForFunction(() => window.__liquorReady === true);
    assert.deepEqual((await codes()).sort(), expectedQuality);
    await all();
    assert.equal(await page.locator('.chart-empty').count(), 0, 'Restoring all companies removes empty chart states');
    await page.locator('[data-jump-group="cash"]').click();
    assert(await page.locator('.comparison-table-scroll').evaluate((node) => node.scrollLeft > 500));
    const sortBeforeHelp = await page.locator('th[aria-sort="ascending"], th[aria-sort="descending"]').getAttribute('data-column-key');
    await page.locator('#comparison-table [data-metric-help="cfi"]').click();
    assert.match(await page.locator('#metric-explanation').innerText(), /CFI = 投资活动现金流量净额/);
    assert.match(await page.locator('#metric-explanation').innerText(), /负数可能是在扩产或投资/);
    assert.equal(await page.locator('th[aria-sort="ascending"], th[aria-sort="descending"]').getAttribute('data-column-key'), sortBeforeHelp, 'Help must not trigger sorting');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#metric-explanation').isVisible(), false);
    await page.locator('#comparison-table [data-metric-help="cff"]').focus(); await page.keyboard.press('Enter');
    assert.match(await page.locator('#metric-explanation').innerText(), /CFF = 筹资活动现金流量净额/);
    await page.locator('#metric-explanation [aria-label="关闭指标说明"]').click();
    await page.locator('[data-jump-group="growth"]').click();
    assert.equal(await header('yoy:operating_margin').locator('small').innerText(), 'pp');
    assert((await page.locator('[data-column="yoy:operating_margin"]').allTextContents()).filter((t) => t !== '—').every((t) => t.includes(' pp')));

    const scroll = page.locator('.comparison-table-scroll');
    await scroll.evaluate((node) => { node.scrollLeft = node.scrollWidth - node.clientWidth; node.scrollTop = 180; });
    const before = await scroll.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
    await header('points:dividend_consistency').click();
    const after = await scroll.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
    assert(Math.abs(before.left - after.left) <= 1 && Math.abs(before.top - after.top) <= 1, 'Sort preserves both scroll positions');
    await page.locator('#comparison-mode').click();
    await page.locator('[data-select="600519"]').check(); await page.locator('[data-select="000995"]').check();
    assert(await page.locator('[data-select="000858"]').isDisabled(), 'Depth comparison is limited to two companies');
    await page.locator('#only-selected').check();
    assert.equal((await codes()).length, 2);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloadPromise;
    const filename = path.join(output, 'all-columns.csv'); await download.saveAs(filename);
    const parsed = JSON.parse(execFileSync('python3', ['-c', "import csv,json,sys,io;print(json.dumps(list(csv.reader(io.TextIOWrapper(sys.stdin.buffer,encoding='utf-8-sig',newline='')))))"], { input: fs.readFileSync(filename), encoding: 'utf8' }));
    assert.equal(parsed[0].length, keys.length + 1);
    assert(parsed.every((r) => r.length === parsed[0].length));
    assert.deepEqual(parsed.slice(1).map((r) => r[1]), await codes());
    assert.equal(parsed.find((r) => r[1] === '000995')[2], '', 'Missing score remains blank in CSV');
    assert.equal(parsed.find((r) => r[1] === '000995')[3], classify(byCode.get('000995'), year).label);
    assert(parsed[0].some((label) => label.includes('pp')));
    await page.locator('#comparison-mode').click();
    assert.equal((await codes()).length, 19);
    assert.equal(await page.locator('[data-select]').count(), 0);

    await go('?companies=000858&status=missing&columns=none');
    assert.equal((await codes()).length, 19, 'Obsolete selector URL params must not silently hide companies');
    assert.equal(await page.locator('[data-sort]').count(), keys.length);
    await page.setViewportSize({ width: 390, height: 844 }); await layout();
    await page.screenshot({ path: path.join(output, 'comparison-mobile.png'), fullPage: true });
    await page.locator('[data-jump-group="cash"]').click();
    await page.locator('#comparison-table [data-metric-help="cfi"]').click();
    const bounds = await page.locator('#metric-explanation').boundingBox();
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844);
    await page.screenshot({ path: path.join(output, 'metric-help-mobile.png') });
    await page.keyboard.press('Escape');
    await header('cfi').click(); await sorted('cfi');
    await page.locator('.comparison-table-scroll').screenshot({ path: path.join(output, 'cash-columns-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('Tags, OR filtering, URL, group navigation, independent circle help, pp, depth selection, CSV, scrolling and desktop/mobile layout OK');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
