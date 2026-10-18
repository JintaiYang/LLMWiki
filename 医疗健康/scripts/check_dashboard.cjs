"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("/Users/yangjintai/.npm-global/lib/node_modules/@nocode/nocode-cli/node_modules/playwright"); }
const base = process.env.HEALTHCARE_URL || "http://127.0.0.1:8771/dashboard/";
const output = process.env.HEALTHCARE_SCREENSHOTS || "/tmp/healthcare-qa";
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Users/yangjintai/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const go = async file => { await page.goto(new URL(file, base).href); await page.waitForFunction(() => window.__healthcareReady); };
  async function check() {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Document overflows viewport");
    const pixels = await page.locator("canvas:visible").evaluateAll(nodes => nodes.map(canvas => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 80 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 35) colored++;
      return { id: canvas.id, width: canvas.clientWidth, height: canvas.clientHeight, colored };
    }));
    for (const p of pixels) { assert(p.width > 150 && p.height > 100, JSON.stringify(p)); assert(p.colored > 25, "Blank chart " + JSON.stringify(p)); }
    assert.equal(await page.evaluate(() => Object.keys(Chart.instances).length), await page.locator("canvas").count(), "Leaked chart instances");
    return pixels;
  }
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [name, file] of [["industry", "industry.html"], ["compare", "index.html"], ["stock", "stock.html?code=600276&compare=300760"], ["formula", "score-formula.html?code=600276"]]) {
        await go(file); await check();
        if (name === "industry") {
          assert.equal(await page.locator("canvas").count(), 2);
          assert.match(await page.locator(".kpi-strip").innerText(), /25\/25家/);
          await page.locator("[data-sector='医疗器械']").click(); await check();
          assert.match(await page.locator(".kpi-strip").innerText(), /3\/3家/);
          await page.selectOption("#period", "2026H1"); await check();
          assert.match(await page.locator(".chart-head").nth(1).innerText(), /2026中报/);
          await go(file);
        }
        if (name === "compare") {
          assert.equal(await page.locator("tbody tr").count(), 25);
          await page.fill("#search", "迈瑞"); assert.equal(await page.locator("tbody tr").count(), 1);
          assert.equal(await page.locator("#search").inputValue(), "迈瑞");
          await page.fill("#search", "无此公司"); assert.match(await page.locator("tbody").innerText(), /没有匹配/);
          await page.fill("#search", "");
          await page.selectOption("#status", "research_only"); assert.equal(await page.locator("tbody tr").count(), 2);
          assert.match(await page.locator("tbody").innerText(), /不参与排名/);
          await page.selectOption("#status", "all");
          for (const group of ["cash", "assets", "research", "core"]) {
            await page.locator(`[data-group='${group}']`).click(); await check();
            if (group === "research") {
              assert.match(await page.locator("tr[data-company='600276']").innerText(), /87\.2/);
              assert.match(await page.locator("tr[data-company='300760']").innerText(), /8\.9/);
              assert.match(await page.locator("tr[data-company='600998']").innerText(), /—/);
            }
          }
          await page.locator("[data-sort='revenue']").click();
          const first = await page.locator("tbody tr").first().getAttribute("data-company");
          assert.equal(first, "601607");
          await page.locator("[data-select='600276']").check(); await page.locator("[data-select='300760']").check();
          assert(await page.locator("#compare-selected").isEnabled());
          const download = page.waitForEvent("download"); await page.locator("#export").click();
          const item = await download; const filePath = path.join(output, `financial-${width}.csv`); await item.saveAs(filePath);
          const csv = fs.readFileSync(filePath, "utf8"); assert.match(csv, /恒瑞医药/); assert.match(csv, /2023-2025/);
          await page.locator("#compare-selected").click(); await page.waitForURL(/stock.html/); await page.waitForFunction(() => window.__healthcareReady);
          assert.match(page.url(), /code=600276&compare=300760/); await go(file);
        }
        if (name === "stock") {
          const text = await page.locator(".kpi-strip").innerText(); assert.match(text, /316\.29/); assert.match(text, /74\.13/);
          assert.equal(await page.locator(".dimension").count(), 5);
          assert.match(await page.locator("#footnotes").innerText(), /87\.24/);
          assert.match(await page.locator("#footnotes").innerText(), /第61页/);
          const pdfLink = await page.locator("#footnotes a").first().getAttribute("href");
          const response = await page.request.get(new URL(pdfLink.split("#")[0], page.url()).href);
          assert.equal(response.status(), 200); assert.match(response.headers()["content-type"], /application\/pdf/);
          await page.locator("[data-enlarge='stock-revenue']").click(); assert(await page.locator("dialog").isVisible()); await check();
          await page.locator("dialog button").click(); await page.waitForFunction(() => !document.querySelector("dialog"));
          await page.selectOption("#company", "688266"); await check();
          assert.match(await page.locator(".notice").first().innerText(), /研发观察池/);
          await go(file);
        }
        if (name === "formula") { assert.equal(await page.locator(".formula-table tbody tr").count(), 11); await page.selectOption("#company", "600998"); await check(); await go(file); }
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "passed", viewports: [1440, 390], pages: 4, errors, output }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
