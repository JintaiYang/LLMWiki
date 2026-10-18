"use strict";
// 仅接受 iFind get_stock_financials 的机器可核验单指标表格；不输出原始响应或认证材料。
const fs = require("fs");
const path = require("path");

const INDICATORS = Object.freeze({
  revenue: "营业收入", net_profit: "归属于母公司所有者的净利润", cost: "营业成本",
  operating_profit: "营业利润", sales_expense: "销售费用", income_tax: "所得税费用",
  total_profit: "利润总额", cfo: "经营活动产生的现金流量净额",
  capex: "购建固定资产、无形资产和其他长期资产支付的现金",
  depreciation: "固定资产及投资性房地产折旧", amortization: "无形资产和长期待摊费用摊销",
  contract_liabilities: "合同负债", inventory: "存货", receivables: "应收账款",
  payables: "应付账款", parent_equity: "归属于母公司所有者权益合计",
  cash: "货币资金", short_debt: "短期借款", long_debt: "长期借款", bonds: "应付债券",
  consolidated_net_profit: "净利润", deduct_profit: "扣除非经常性损益后的归母净利润",
  finance_expense: "财务费用", other_receivables: "其他应收款合计",
  total_assets: "资产总计", total_liabilities: "负债合计", current_assets: "流动资产合计", current_liabilities: "流动负债合计",
  management_expense: "管理费用", research_expense: "研发费用", cfi: "投资活动产生的现金流量净额",
  cff: "筹资活动产生的现金流量净额", cash_net_increase: "现金及现金等价物净增加额",
  cash_equivalents: "期末现金及现金等价物余额", fixed_assets: "固定资产", construction_in_progress: "在建工程", total_equity: "所有者权益合计",
});
const CODES = Object.freeze({"600519": "贵州茅台", "000858": "五粮液", "000568": "泸州老窖", "600809": "山西汾酒", "002304": "洋河股份", "000596": "古井贡酒", "000799": "酒鬼酒", "000860": "顺鑫农业", "000995": "皇台酒业", "002646": "天佑德酒", "600197": "伊力特", "600199": "金种子酒", "600559": "老白干酒", "600702": "舍得酒业", "600779": "水井坊", "603198": "迎驾贡酒", "603369": "今世缘", "603589": "口子窖", "603919": "金徽酒"});
const COLUMNS = ["证券代码", "证券简称", "报告期", "公告日期", "指标", "单位", "数值"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isoDay(value) {
  const text = String(value ?? "").trim();
  const digits = /^20\d{6}$/.test(text) ? text : /^20\d{2}-\d{2}-\d{2}$/.test(text) ? text.replace(/-/g, "") : "";
  if (!digits) return null;
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function parseResponse(result, request) {
  if (result?.ok !== true) return null;
  const content = result?.data?.result?.content;
  if (!Array.isArray(content) || content.length !== 1 || typeof content[0]?.text !== "string") return null;
  let outer, data;
  try {
    outer = JSON.parse(content[0].text);
    data = typeof outer?.data === "string" ? JSON.parse(outer.data) : outer?.data;
  } catch (_) { return null; }
  if (!data || typeof data.answer !== "string" || !data.indicators_params || Array.isArray(data.indicators_params)) return null;
  const indicator = INDICATORS[request.field];
  if (!indicator || Object.keys(data.indicators_params).length !== 1) return null;
  const params = data.indicators_params[indicator];
  if (!params || typeof params !== "object" || Array.isArray(params) ||
      isoDay(params["报告期"]) !== request.report_date || params["单位"] !== "元") return null;
  const lines = data.answer.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 3 || lines.some((line) => !line.startsWith("|") || !line.endsWith("|"))) return null;
  const split = (line) => line.slice(1, -1).split("|").map((cell) => cell.trim());
  if (JSON.stringify(split(lines[0])) !== JSON.stringify(COLUMNS)) return null;
  if (!split(lines[1]).every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const cells = split(lines[2]);
  if (cells.length !== COLUMNS.length) return null;
  const [security, name, period, notice, label, unit, rawValue] = cells;
  const suffix = request.code.startsWith("6") ? "SH" : "SZ";
  if (security !== `${request.code}.${suffix}` || name !== request.name ||
      isoDay(period) !== request.report_date || label !== indicator || unit !== "元") return null;
  const sourceDate = isoDay(notice);
  const valueText = rawValue.replace(/,/g, "");
  if (!sourceDate || sourceDate < request.report_date || sourceDate > new Date().toISOString().slice(0, 10) ||
      !/^-?(?:\d+)(?:\.\d+)?$/.test(valueText)) return null;
  const value = Number(valueText);
  if (!Number.isFinite(value)) return null;
  return {code: request.code, report_date: request.report_date, field: request.field,
    value: String(value), unit: "CNY", source: `iFind:get_stock_financials:${request.field}`, source_date: sourceDate};
}

function validRequest(request) {
  return request && Object.keys(request).sort().join(",") === "code,field,name,report_date" &&
    CODES[request.code] === request.name && Object.hasOwn(INDICATORS, request.field) &&
    isoDay(request.report_date) === request.report_date && request.report_date <= new Date().toISOString().slice(0, 10);
}

async function collect(requests, call) {
  const rows = [];
  for (const request of requests) {
    const label = INDICATORS[request.field];
    const query = `${request.code}.${request.code.startsWith("6") ? "SH" : "SZ"} ${request.name} ${request.report_date} 报告期 ${label}（元）；只返回证券代码、证券简称、报告期、公告日期、指标、单位、数值的表格；指标参数必须标报告期和单位，无法确认请留空`;
    try {
      const answer = await call("stock", "get_stock_financials", {query});
      const verified = parseResponse(answer, request);
      if (verified) rows.push(verified);
      else process.stderr.write(`[iFind] 拒绝未核验结果 ${request.code} ${request.report_date} ${request.field}\n`);
    } catch (_) {
      process.stderr.write(`[iFind] 请求失败 ${request.code} ${request.report_date} ${request.field}\n`);
    }
    if (requests.length > 1) await sleep(350);
  }
  return rows;
}

async function main() {
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  if (!Array.isArray(request?.requests) || !request.requests.every(validRequest)) throw new Error("请求清单不合法");
  const connector = path.join(process.env.HOME || "", ".claude", "skills", "ifind-finance-data", "call-node.js");
  if (!fs.existsSync(connector)) throw new Error("iFind call-node.js 不存在；不尝试认证");
  const {call} = require(connector);
  if (typeof call !== "function") throw new Error("iFind 调用接口不存在");
  const rows = await collect(request.requests, call);
  process.stdout.write(JSON.stringify({rows}) + "\n");
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`[iFind] ${error.message.replace(/[^\w .\u4e00-\u9fff-]/g, " ").slice(0, 100)}\n`);
  process.exitCode = 1;
});
module.exports = {parseResponse, validRequest, collect};
