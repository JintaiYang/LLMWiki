(function (root) {
  "use strict";
  const rules = Object.freeze({ basis: "latest_annual_dcf", quality: 80, cheapMarginOfSafety: 0, weakGrowth: .5 });
  const tags = {
    quality_cheap: ["质优低估", "good", 1], quality_rich: ["质优不便宜", "blue", 2],
    cheap_weak: ["低估质弱", "warn", 3], value_trap: ["价值陷阱风险", "risk", 4],
    weak_fair: ["质弱价格一般", "", 5], loss: ["亏损估值不适用", "risk", 6],
    cashflow_invalid: ["现金流非正", "warn", 7],
    missing: ["DCF估值待核验", "warn", 8],
  };
  const number = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
  function classify(company, year) {
    const price = company.price || {}, shares = company.shares || {};
    const profit = number(company.annual?.find((row) => String(row.year) === String(year))?.net_profit);
    const matched = price.price_date && price.price_date === shares.source_date
      && price.unit === "CNY/share" && shares.unit === "shares";
    const pe = matched && number(price.close) > 0 && number(shares.shares) > 0 && profit > 0
      ? price.close * shares.shares / profit : null;
    const total = number(company.score?.total);
    const dimension = company.score?.dimensions?.find((d) => d.name === "经营韧性");
    const growth = number(dimension?.score) !== null && number(dimension?.weight) > 0 ? dimension.score / dimension.weight : null;
    const dcf = company.dcf || {};
    const base = dcf.scenarios?.find((s) => s.name === "基准");
    const fair = number(base?.value_per_share);
    const comparable = matched && number(price.close) > 0 && number(shares.shares) > 0
      && dcf.price_comparable === true && dcf.net_cash_status === "verified"
      && number(dcf.net_cash_CNY) !== null && dcf.base_year === Number(year)
      && ["latest_annual_fcff", "latest_annual_owner_fcf"].includes(dcf.base_method)
      && number(dcf.base_cash_flow_CNY) > 0 && fair > 0;
    const marginOfSafety = comparable ? 1 - price.close / fair : null;
    const upside = comparable ? fair / price.close - 1 : null;
    const cheap = comparable && marginOfSafety > rules.cheapMarginOfSafety;
    let id;
    if (profit !== null && profit <= 0) id = "loss";
    else if (dcf.status === "negative_owner_fcf") id = "cashflow_invalid";
    else if (total === null || profit === null || !comparable) id = "missing";
    else if (total >= rules.quality) id = cheap ? "quality_cheap" : "quality_rich";
    else if (!cheap) id = "weak_fair";
    else if (growth === null) id = "missing";
    else id = growth < rules.weakGrowth ? "value_trap" : "cheap_weak";
    const [label, tone, order] = tags[id];
    const reason = `${year}A 单年现金流DCF；基准${fair > 0 ? fair.toFixed(2) + "元" : "不可用"}${comparable ? "" : "（未核验为可比股权价值）"}；现价 ${number(price.close) > 0 ? price.close.toFixed(2) + "元" : "缺项"}；安全边际 ${marginOfSafety === null ? "不可比" : (marginOfSafety * 100).toFixed(2) + "%"}；净现金 ${dcf.net_cash_status === "verified" ? "已核验" : "未核验"}；V5财务分 ${total ?? "缺项"}；经营韧性得分率 ${growth === null ? "缺项" : (growth * 100).toFixed(1) + "%"}。仅以可比的基准DCF判断价格，不使用PE或股息率替代。`;
    return { id, label, tone, order, pe, reason, basis: rules.basis, base_year: dcf.base_year ?? null,
      value_per_share: comparable ? fair : null, margin_of_safety: marginOfSafety, upside,
      price_date: price.price_date || null };
  }
  const api = { rules, classify, tags };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    if (require.main === module) {
      const input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const classified = input.companies.map((c) => ({ code: c.code, style: classify(c, input.year) }));
      const counts = Object.fromEntries(Object.keys(tags).map((id) => [id, classified.filter((c) => c.style.id === id).length]));
      process.stdout.write(JSON.stringify({ classified, counts, rules }) + "\n");
    }
  }
  else root.LiquorCompanyStyle = api;
})(typeof window === "object" ? window : globalThis);
