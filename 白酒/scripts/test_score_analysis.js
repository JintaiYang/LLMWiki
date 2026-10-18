"use strict";
const assert = require("node:assert/strict");
const { analyze } = require("../dashboard/score-analysis.js");
const data = require("../dashboard/data.json");

const original = JSON.stringify(data);
for (const company of data.companies) {
  const cards = analyze(company);
  assert.equal(cards.length, 5, company.name);
  assert.equal(cards.flatMap((card) => card.items).length, 13);
  for (const [index, card] of cards.entries()) {
    assert.equal(card.score, company.score.dimensions[index].score);
    assert(card.summary && card.judgment);
    assert(card.summary.length <= 22, company.name + " collapsed comment is too long");
    for (const item of card.items) {
      assert(item.observation);
      assert(!/得分原因|零分线|满分线|现有锚点|解释现有评分/.test(item.observation));
      assert(!/undefined|NaN|Infinity/.test(JSON.stringify(item)), company.name + " " + item.key);
    }
  }
}
assert.equal(JSON.stringify(data), original, "Analysis must not mutate scores or financial data");

const maotai = data.companies.find((c) => c.code === "600519");
const wuliangye = data.companies.find((c) => c.code === "000858");
const cards = analyze(maotai);
assert.match(cards[0].items[0].observation, /同比下降/);
assert.equal(cards[0].summary, "盈利较强，近期利润率回落");
assert.match(cards[2].judgment, /受限现金、债务及担保/);
assert.match(analyze(wuliangye)[3].summary, /最新年营收下滑/);
assert.match(analyze(wuliangye)[3].items[0].observation, /五年营收复合增速/);

const fixture = structuredClone(maotai);
const item = fixture.score.dimensions[4].items[0];
item.value = 120;
assert.match(analyze(fixture)[4].summary, /累计分红超过同期利润/);
item.status = "economic_invalid"; item.value = 0; item.score = 0;
assert.match(analyze(fixture)[4].items[0].observation, /不能把计分零值当成实际比率/);
assert.equal(analyze(fixture)[4].items[0].value, "不适用");
assert.match(analyze(fixture)[4].summary, /利润基础异常/);
item.status = "missing"; item.value = null; item.score = null; item.valid_years = 4;
fixture.score.dimensions[4].score = null;
const incomplete = analyze(fixture)[4];
assert.match(incomplete.summary, /资料不足/);
assert.match(incomplete.items[0].observation, /4\/5年数据/);
item.status = "observed_zero"; item.value = 0; item.score = 0;
assert.match(analyze(fixture)[4].items[0].observation, /已核验无现金分红/);
fixture.annual.find((r) => r.year === fixture.score.annual_year).cfo = -1;
assert.match(analyze(fixture)[1].summary, /最新年经营现金净流出/);
fixture.score.risk_gates = [{ key: "two_negative_cfo", label: "连续两年经营现金流为负", cap: 49 }];
assert.match(analyze(fixture)[1].warnings[0], /上限49分/);
fixture.score.risk_missing = ["negative_equity"];
assert(analyze(fixture).every((card) => card.warnings.some((text) => text.includes("资料不足"))));
assert.deepEqual(analyze({}), []);
console.log("19 companies / five dimensions / 13 items: summaries, trends, missing/invalid/confirmed zero, excess payout, cash-flow risk and score immutability OK");
