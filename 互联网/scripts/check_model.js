"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const M=require("../dashboard/model.js");
const data=require("../dashboard/data.json");
const root=path.resolve(__dirname,"..");
assert.equal(data.companies.length,11);
assert.equal(M.dimensions.reduce((s,d)=>s+d.weight,0),100);
assert.equal(M.rules.reduce((s,d)=>s+d.weight,0),100);
assert.equal(M.score(null).total,null);
assert.equal(M.score({values:{}}).coverage,0);
assert.equal(M.score({values:{cfo:-10,profit:-2,capex:3}}).items.find(x=>x.id==="cashConversion").score,0);
assert.equal(M.score({values:{cfo:10,profit:-2}}).items.find(x=>x.id==="cashConversion").score,40);
assert.equal(M.score({values:{cfo:-10,capex:3}}).items.find(x=>x.id==="capexCfo").score,0);
assert.equal(M.score({values:{cfo:20,dividends:0,buybacks:0}}).items.find(x=>x.id==="returnCoverage").score,0);
assert.equal(M.score({values:{cfo:20,dividends:0}}).items.find(x=>x.id==="returnCoverage").score,null);
assert.equal(M.interpolate(0,M.rules.find(r=>r.id==="fcfMargin").stops),25);
assert.equal(M.interpolate(-50,M.rules[0].stops),0);
assert.equal(M.interpolate(100,M.rules[0].stops),100);
for(const c of data.companies){
  assert(c.annuals.length>=3,c.name+" needs three annuals");
  const p=c.annuals.at(-1);
  assert(p.start && p.date<=data.asOf,c.name+" fiscal dates");
  assert.equal(c.currency,"CNY");
  assert.equal(c.price.provider,"AKShare");
  assert.equal(c.price.date,"2026-10-16");
  assert(c.price.value>0);
  for(const period of [...c.annuals,...c.recent]){
    const v=period.values;
    for(const [metric,value] of Object.entries(v)){
      assert(Number.isFinite(value),c.name+" nonfinite "+metric);
      assert(period.evidence[metric],c.name+" missing evidence "+metric);
      const e=period.evidence[metric];
      if(e.file)assert(fs.existsSync(path.resolve(root,"dashboard",e.file.split("#")[0])),e.file+" evidence missing");
    }
    if(v.fcf!=null)assert(Math.abs(v.fcf-(v.cfo-v.capex))<1,c.name+" FCF calculation");
    if(v.fcfMargin!=null)assert(Math.abs(v.fcfMargin-v.fcf/v.revenue*100)<1e-7);
    if(period.annual)assert((new Date(period.date)-new Date(period.start))/86400000>=330);
  }
  const score=M.score(p);
  assert(score.total>=0&&score.total<=100,c.name+" score");
  assert.equal(M.score(p,Object.fromEntries(M.dimensions.map(d=>[d.id,0]))).total,null);
}
const ali=data.companies.find(c=>c.id==="alibaba");
assert.equal(ali.annuals.at(-1).date,"2026-03-31");
assert.equal(ali.annuals.at(-1).start,"2025-04-01");
assert.equal(M.period(ali,"2025"),null,"Natural-year selection must not silently select a different fiscal period");
const kuaishou=data.companies.find(c=>c.id==="kuaishou").annuals.at(-1);
assert.equal(kuaishou.evidence.capex.provider,"iFinD");
assert(kuaishou.evidence.capex.reason.includes("AKShare"));
const tencent=data.companies.find(c=>c.id==="tencent");
assert.equal(tencent.annuals.at(-1).evidence.revenue.provider,"AKShare");
assert.equal(tencent.recent.at(-1).evidence.sbc.provider,"官方财报PDF");
console.log("PASS: fiscal periods, provenance, 11 company datasets, FCF calculations, missing/zero/loss scoring and weights");
