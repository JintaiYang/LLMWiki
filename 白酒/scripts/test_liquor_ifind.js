"use strict";
const assert = require("node:assert/strict");
const {parseResponse, validRequest, collect} = require("./liquor_ifind.js");

const request = {code: "600519", name: "贵州茅台", report_date: "2025-12-31", field: "cash"};
const payload = (changes = {}) => ({
  answer: "|证券代码|证券简称|报告期|公告日期|指标|单位|数值|\n|---|---|---|---|---|---|---|\n|600519.SH|贵州茅台|20251231|2026-04-01|货币资金|元|1,234.56|",
  indicators_params: {"货币资金": {"报告期": "20251231", "单位": "元"}},
  ...changes,
});
const wrap = (data) => ({ok: true, data: {result: {content: [{text: JSON.stringify({data: JSON.stringify(data)})}]}}});

async function main() {
  assert.ok(validRequest(request));
  assert.ok(!validRequest({...request, code: "000858"}));
  const good = parseResponse(wrap(payload()), request);
  assert.equal(good.value, "1234.56");
  assert.equal(good.source_date, "2026-04-01");
  assert.equal(parseResponse(wrap(payload({indicators_params: {"货币资金": {"报告期": "20241231", "单位": "元"}}})), request), null);
  assert.equal(parseResponse(wrap(payload({indicators_params: {"货币资金": {"报告期": "20251231", "单位": "万元"}}})), request), null);
  for (const wrong of ["000858.SZ", "20241231", "万元", "2024-01-01", "abc", "1亿", "token=abc"]) {
    assert.equal(parseResponse(wrap(payload({answer: payload().answer.replace(wrong === "000858.SZ" ? "600519.SH" : wrong === "20241231" ? "20251231" : wrong === "2024-01-01" ? "2026-04-01" : wrong === "万元" ? "|元|" : "1,234.56", wrong === "万元" ? "|万元|" : wrong)})), request), null);
  }
  assert.equal(parseResponse(wrap(payload({answer: "证券代码 600519 货币资金 1234.56"})), request), null);
  assert.equal(parseResponse(wrap(payload({answer: payload().answer + "\n|000858.SZ|五粮液|20251231|2026-04-01|货币资金|元|1|"})), request), null);
  assert.equal(parseResponse({ok: false, data: {result: {content: [{text: "secret"}]}}}, request), null);
  let count = 0;
  const collected = await collect([request], async (scope, method, arg) => {
    count++;
    assert.equal(scope, "stock");
    assert.equal(method, "get_stock_financials");
    assert.match(arg.query, /600519.SH.*2025-12-31.*货币资金/);
    return wrap(payload());
  });
  assert.equal(count, 1);
  assert.deepEqual(collected, [good]);
  process.stdout.write("iFind 适配器离线测试通过\n");
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
