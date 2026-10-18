"use strict";
const assert = require("node:assert/strict");
const { classify } = require("../dashboard/company-style.js");
const company = {
  price: { close: 15, price_date: "2026-10-09", unit: "CNY/share" },
  shares: { shares: 100, source_date: "2026-10-09", unit: "shares" },
  annual: [{ year: 2025, net_profit: 100 }],
  dividend: { year: 2025, price_date: "2026-10-09", yield_pct: 4.5, payout_pct: 80 },
  score: { total: 80, dimensions: [{ name: "经营韧性", score: 5, weight: 10 }] },
};
const check = (mutate, expected) => { const c = structuredClone(company); mutate(c); assert.equal(classify(c, 2025).id, expected); };
check(() => {}, "quality_cheap");
check((c) => { c.price.close = 30; }, "quality_rich");
check((c) => { c.price.close = 20; c.dividend.payout_pct = 101; }, "quality_rich");
check((c) => { c.price.close = 20; c.dividend.payout_pct = null; }, "quality_rich");
check((c) => { c.price.close = 20; c.dividend.year = 2024; }, "quality_rich");
check((c) => { c.price.close = 20; c.dividend.price_date = "2026-10-08"; }, "quality_rich");
check((c) => { c.score.total = 79.99; }, "cheap_weak");
check((c) => { c.score.total = 79; c.score.dimensions[0].score = 4.99; }, "value_trap");
check((c) => { c.score.total = 79; c.price.close = 30; }, "weak_fair");
check((c) => { c.score.total = null; }, "missing");
check((c) => { c.shares.source_date = "2026-10-08"; }, "missing");
check((c) => { c.shares.unit = "万股"; }, "missing");
check((c) => { c.annual[0].net_profit = null; }, "missing");
check((c) => { c.score.total = 79; c.score.dimensions[0].score = null; }, "missing");
check((c) => { c.annual[0].net_profit = -1; }, "loss");
check((c) => { c.annual[0].net_profit = 0; }, "loss");
assert.equal(classify(company, 2025).pe, 15);
console.log("Company classification: PE/yield thresholds, payout, dates, units, missing inputs, loss and growth boundaries OK");
