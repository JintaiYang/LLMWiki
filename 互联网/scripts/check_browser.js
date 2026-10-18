"use strict";
const assert=require("node:assert/strict");
const path=require("node:path");
const fs=require("node:fs");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const base=process.env.INTERNET_DASHBOARD_URL||"http://127.0.0.1:8781/dashboard/";
const output=process.env.INTERNET_QA_OUTPUT||"/tmp/internet-dashboard-qa";
async function main(){
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{if(r.status()>=400)errors.push(r.status()+" "+r.url());});
  async function go(hash){await page.goto(base+"#"+hash);await page.locator("h1").waitFor();}
  async function layout(label){
    const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert(size.scroll<=size.width+1,label+" page overflow "+JSON.stringify(size));
    const overflow=await page.locator(".stat,.plot,.compare-company,.research-item,.weight").evaluateAll(ns=>ns.filter(n=>n.clientWidth&&n.scrollWidth>n.clientWidth+2).map(n=>n.className));
    assert.deepEqual(overflow,[],label+" internal overflow");
  }
  async function canvases(){
    const pixels=await page.locator("canvas").evaluateAll(nodes=>nodes.map(c=>{const p=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let colored=0;for(let i=0;i<p.length;i+=4)if(p[i+3]>50&&Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])>25)colored++;return {width:c.width,height:c.height,colored};}));
    for(const p of pixels)assert(p.width>100&&p.height>100&&p.colored>50,"blank canvas "+JSON.stringify(p));
  }
  try{
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===1440?1000:844});
      for(const view of ["overview","compare","company","method","sources"]){
        await go("view="+view+"&company=tencent");
        await layout(view+"-"+width);await canvases();
        await page.screenshot({path:path.join(output,view+"-"+width+".png")});
      }
    }
    await page.setViewportSize({width:1440,height:1000});
    await go("view=compare");
    await page.locator("#search").fill("PDD");
    assert.equal(await page.locator("#table-region tbody tr").count(),1);
    assert.match(await page.locator("#table-region tbody").innerText(),/拼多多/);
    await page.locator("#search").fill("nothing-matches");
    assert.match(await page.locator("#table-region tbody").innerText(),/没有符合/);
    await page.locator("#search").fill("");
    await page.locator('[data-group="电商零售"]').click();
    assert.equal(await page.locator("#table-region tbody tr").count(),3);
    await page.locator('[data-group="全部"]').click();
    await page.locator('[data-sort="revenue"]').click();
    assert.match(await page.locator("#table-region tbody tr").first().innerText(),/京东/);
    for(const id of ["tencent","alibaba","pdd","jd"])await page.locator(`[data-compare="${id}"]`).check();
    await page.locator('[data-compare="meituan"]').click();
    assert.equal(await page.locator('[data-compare="meituan"]').isChecked(),false);
    await page.locator("#compare-selected").click();
    assert.equal(await page.locator(".compare-company").count(),4);
    await page.locator("#clear-selected").click();
    assert.equal(await page.locator("[data-compare]:checked").count(),0);
    assert.equal(await page.locator(".compare-company").count(),0);
    await page.locator('[data-watch="tencent"]').click();
    await page.locator("#watch-only").check();
    assert.equal(await page.locator("#table-region tbody tr").count(),1);
    await page.reload();await page.locator("h1").waitFor();
    assert(await page.locator('[data-watch="tencent"]').getAttribute("class").then(c=>c.includes("active")));
    const download=page.waitForEvent("download");await page.locator("#export").click();
    assert.match((await download).suggestedFilename(),/\.csv$/);
    await go("view=company&company=alibaba");
    assert.match(await page.locator("main").innerText(),/2025-04-01 至 2026-03-31/);
    await page.locator("#company-switch").selectOption("pdd");
    await page.waitForFunction(()=>location.hash.includes("pdd"));
    assert.match(await page.locator("h1").innerText(),/拼多多/);
    await go("view=method");
    await page.locator('[data-weight="growth"]').fill("25");
    await go("view=compare");
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("internet-weights")).growth),25);
    await go("view=method");await page.locator("#reset-weights").click();
    assert.equal(await page.evaluate(()=>localStorage.getItem("internet-weights")),null);
    await go("view=sources");
    assert.match(await page.locator("main").innerText(),/Access Denied/);
    const dataDownload=page.waitForEvent("download");await page.locator("#download-json").click();
    assert.match((await dataDownload).suggestedFilename(),/\.json$/);
    assert.deepEqual(errors,[]);
    console.log("PASS: desktop/mobile views, chart pixels, search, sort, filters, comparison, watch persistence, fiscal route, weights and downloads");
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
