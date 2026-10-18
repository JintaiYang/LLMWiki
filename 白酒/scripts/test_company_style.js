"use strict";
const assert = require("node:assert/strict");
const { classify } = require("../dashboard/company-style.js");
const company = {
  price: { close: 15, price_date: "2026-10-09", unit: "CNY/share" },
  shares: { shares: 100, source_date: "2026-10-09", unit: "shares" },
  annual: [{ year: 2025, net_profit: 100 }],
  dividend: { year: 2025, price_date: "2026-10-09", yield_pct: 4.5, payout_pct: 80 },
  score: { total: 80, dimensions: [{ name: "经营韧性", score: 5, weight: 10 }] },
  dcf: { base_year: 2025, base_years: [2025], base_method: "latest_annual_fcff", base_cash_flow_CNY: 100,
    net_cash_CNY: 0, net_cash_status: "verified", price_comparable: true, status: "research_hypothesis",
    scenarios: [{ name: "基准", value_per_share: 20 }] },
};
const check = (mutate, expected) => { const c = structuredClone(company); mutate(c); assert.equal(classify(c, 2025).id, expected); };
check(() => {}, "quality_cheap");
check((c) => { c.price.close = 30; }, "quality_rich");
check((c) => { c.price.close = 20; }, "quality_rich");
check((c) => { c.dcf.scenarios[0].value_per_share = 10; }, "quality_rich");
check((c) => { c.annual[0].net_profit = 1; }, "quality_cheap");
check((c) => { c.dividend.yield_pct = 0; c.dividend.payout_pct = null; }, "quality_cheap");
check((c) => { c.price.close = 30; c.dividend.yield_pct = 20; }, "quality_rich");
check((c) => { c.score.total = 79.99; }, "cheap_weak");
check((c) => { c.score.total = 79; c.score.dimensions[0].score = 4.99; }, "value_trap");
check((c) => { c.score.total = 79; c.price.close = 30; }, "weak_fair");
check((c) => { c.score.total = null; }, "missing");
check((c) => { c.shares.source_date = "2026-10-08"; }, "missing");
check((c) => { c.shares.unit = "万股"; }, "missing");
check((c) => { c.dcf.price_comparable = false; }, "missing");
check((c) => { c.dcf.net_cash_status = "not_verified"; }, "missing");
check((c) => { c.dcf.net_cash_CNY = null; }, "missing");
check((c) => { c.dcf.base_year = 2024; }, "missing");
check((c) => { c.dcf.base_method = "median_3y_fcff"; }, "missing");
check((c) => { c.dcf.scenarios = []; }, "missing");
check((c) => { c.annual[0].net_profit = null; }, "missing");
check((c) => { c.dcf.status = "negative_owner_fcf"; c.dcf.scenarios = []; }, "cashflow_invalid");
check((c) => { c.score.total = 79; c.score.dimensions[0].score = null; }, "missing");
check((c) => { c.annual[0].net_profit = -1; }, "loss");
check((c) => { c.annual[0].net_profit = 0; }, "loss");
assert.equal(classify(company, 2025).pe, 15);
assert.equal(classify(company, 2025).margin_of_safety, .25);
assert.match(classify(company, 2025).reason, /基准20.00元/);
console.log("Company classification: latest annual DCF, fair-value boundary, verified net cash, PE/yield independence, missing inputs, loss and growth boundaries OK");
