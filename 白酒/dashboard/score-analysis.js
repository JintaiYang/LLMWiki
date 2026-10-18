(function (root) {
  "use strict";
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const format = (v) => finite(v) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(v) : "—";
  const amount = (v) => finite(v) ? format(v / 1e8) + "亿元" : "待核验";
  const percent = (v) => finite(v) ? format(v) + "%" : "待核验";
  const valueText = (v, unit) => finite(v) ? format(v) + ({ "%": "%", x: "倍", "系数": "系数" }[unit] || "") : "待核验";
  const change = (a, b) => finite(a) && finite(b) && b > 0 ? (a / b - 1) * 100 : null;

  function analyze(company) {
    const score = company.score || {};
    const years = score.window_years || [];
    const byYear = new Map((company.annual || []).map((row) => [row.year, row]));
    const rows = years.map((year) => byYear.get(year) || {});
    const year = score.annual_year;
    const latest = byYear.get(year) || {};
    const prior = byYear.get(year - 1) || {};
    const revenueGrowth = change(latest.revenue, prior.revenue);
    const fcfComplete = rows.length === 5 && rows.every((row) => finite(row.cfo) && finite(row.capex));
    const negativeFcfYears = rows.filter((row) => finite(row.cfo) && finite(row.capex) && row.cfo < row.capex).map((row) => row.year);
    const cashYears = rows.filter((row) => finite(row.cfo) && row.cfo > 0).length;
    const dividendYears = rows.filter((row) => finite(row.dividend_cash_CNY) && row.dividend_cash_CNY > 0).length;
    const growths = rows.map((row, index) => {
      const previousYear = years[index] - 1;
      const previous = byYear.get(previousYear) || (company.annual_baseline?.year === previousYear ? company.annual_baseline : {});
      return { year: years[index], value: change(row.revenue, previous.revenue) };
    }).filter((entry) => finite(entry.value));
    const worst = growths.sort((a, b) => a.value - b.value)[0];
    const liquidity = (score.liquidity_components || []).find((entry) => entry?.year === year);

    function recent(field) {
      const a = latest[field], b = prior[field];
      return finite(a) ? `${year}年${percent(a)}${finite(b) ? `，同比${a >= b ? "上升" : "下降"}${format(Math.abs(a - b))}个百分点` : "，上年缺项"}` : `${year}年数据待核验`;
    }

    function comment(item) {
      if (item.status === "missing" || !finite(item.value) || !finite(item.score)) return `已取得${item.valid_years || 0}/5年数据，暂不判断。`;
      if (item.status === "economic_invalid") return "亏损或累计利润非正，比率不适用；不能把计分零值当成实际比率。";
      if (item.status === "observed_zero") return "五年已核验无现金分红。";
      const v = item.value;
      switch (item.name) {
        case "operating_margin_median": return `五年中位数${percent(v)}；${recent("operating_margin")}。`;
        case "roa_median": return `五年中位数${percent(v)}；${recent("roa")}。`;
        case "nonrecurring_dependency": return `正向非经常收益依赖${percent(v)}；最新年归母净利${amount(latest.net_profit)}、扣非净利${amount(latest.deduct_profit)}。${finite(latest.net_profit) && latest.net_profit > 0 && finite(latest.deduct_profit) && latest.deduct_profit < 0 ? "扣非仍亏损，需核查收益来源。" : ""}`;
        case "cfo_conversion": return `五年经营现金流为合并净利润的${valueText(v, "x")}，${v >= 1 ? "累计利润有现金覆盖" : v >= 0 ? "现金转化未完全覆盖账面利润" : "累计经营现金净流出"}；最新年${amount(latest.cfo)}。`;
        case "fcf_conversion": return `扣除全部资本开支后，五年现金留存为合并净利润的${valueText(v, "x")}。${negativeFcfYears.length ? `${negativeFcfYears.join("、")}年现金余量为负，需区分扩产与经营流出。` : fcfComplete ? "五年现金余量均未为负。" : "部分年度现金余量待核验。"}`;
        case "cfo_positive_ratio": return cashYears === 5 ? "五年经营现金流均为正，经营造血连续。" : `五年中${cashYears}年经营现金流为正，现金流连续性不足。`;
        case "liquidity_constraint": return liquidity?.confirmed_no_current_liabilities ? "最新年已核验无流动负债。" : liquidity ? `最新年现金/流动负债${percent(liquidity.cash_ratio_pct)}，速动比率${percent(liquidity.quick_ratio_pct)}；${v >= .8 ? "账面缓冲较充足" : v >= .5 ? "账面缓冲中等" : "账面缓冲偏弱"}。` : "最新年流动性明细待核验。";
        case "other_receivables_constraint": return `较差观察值${percent(v)}；最新年${percent(latest.other_receivables_to_asset)}。${item.score / item.max >= .8 ? "非销售往来占资产较少。" : "需追查往来方、账龄和回收情况。"}`;
        case "receivables_constraint": return `较差观察值${percent(v)}；最新年${percent(latest.receivables_to_revenue)}。${item.score / item.max >= .8 ? "应收账款占收入较少，票据仍需另查。" : "销售占款偏高，需核查信用政策与账龄。"}`;
        case "revenue_cagr_5y": return `五年营收复合增速${percent(v)}；最新一年同比${percent(revenueGrowth)}。`;
        case "revenue_worst_yoy": return worst ? `${worst.year}年营收同比${percent(worst.value)}，为五年最差表现；需结合重述和业务变化判断。` : "最差年度及其比较基数待核验。";
        case "payout_cumulative": return `五年累计派现占归母利润${percent(v)}。${v > 100 ? "分红超过同期利润，需核查资金来源及延续性。" : "反映已实施现金回报，不代表未来分红承诺。"}`;
        case "dividend_consistency": return dividendYears === 5 ? "连续五年已实施现金分红。" : `五年中${dividendYears}年已实施现金分红，分红连续性有限。`;
        default: return "该项分析待补证。";
      }
    }

    return (score.dimensions || []).map((dimension, index) => {
      const items = (dimension.items || []).map((item) => ({ key: item.name, label: item.label,
        value: item.status === "economic_invalid" ? "不适用" : valueText(item.value, item.unit),
        score: item.score, max: item.max, status: item.status, observation: comment(item) }));
      const missing = items.some((item) => item.status === "missing" || !finite(item.score));
      const invalid = items.some((item) => item.status === "economic_invalid");
      const fraction = finite(dimension.score) && dimension.weight > 0 ? dimension.score / dimension.weight : null;
      const strong = fraction !== null && fraction >= .8;
      const fallingMargin = finite(latest.operating_margin) && finite(prior.operating_margin) && latest.operating_margin < prior.operating_margin;
      const payout = dimension.items.find((item) => item.name === "payout_cumulative");
      const summary = missing ? "资料不足，暂不判断" : invalid ? "利润基础异常，需先核查" : [
        fallingMargin ? strong ? "盈利较强，近期利润率回落" : "利润率回落，盈利承压" : strong ? "盈利能力较强" : "盈利质量仍需改善",
        finite(latest.cfo) && latest.cfo < 0 ? "最新年经营现金净流出" : strong ? "现金创造较强" : "现金转化偏弱",
        strong ? "账面缓冲较好，占款较少" : "流动性或占款仍有短板",
        finite(revenueGrowth) && revenueGrowth < 0 ? "最新年营收下滑，韧性承压" : strong ? "营收增长较稳" : "增长与抗波动能力偏弱",
        payout?.status === "scored" && payout.value > 100 ? "累计分红超过同期利润" : strong ? "历史现金回报较好" : "派现或分红连续性偏弱",
      ][index];
      const judgment = missing ? "先补齐缺项，再判断该维表现。" : invalid ? "亏损或累计利润非正，相关比率不能直接比较。" : [
        fallingMargin ? "利润率已有回落，继续看产品结构、费用及扣非收益。" : "结合产品结构和主营收益，验证盈利能否延续。",
        "结合回款、税费及财务公司影响，判断现金转化能否持续。",
        "账面缓冲不等于资金安全；受限现金、债务及担保仍需核验。",
        finite(revenueGrowth) && revenueGrowth < 0 ? "最新年收入收缩，历史增长不能替代动销验证。" : "仍需用终端动销和渠道库存验证增长质量。",
        "分红可持续性还要看经营现金和后续资本开支。",
      ][index];
      const relevant = [["latest_loss"], ["two_negative_cfo"], ["negative_equity"], ["latest_loss"], ["latest_loss"]][index] || [];
      const warnings = (score.risk_gates || []).filter((risk) => relevant.includes(risk.key)).map((risk) => `${risk.label}，总分上限${risk.cap}分。`);
      if (score.risk_missing?.length) warnings.push("风险资料不足，不能据此判断安全。");
      return { name: dimension.name, letter: "ABCDE"[index], score: dimension.score, max: dimension.weight,
        summary, judgment, warnings, items };
    });
  }
  const api = { analyze, valueText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LiquorScoreAnalysis = api;
})(typeof window !== "undefined" ? window : globalThis);
