(function (root) {
  "use strict";
  const rules = Object.freeze({ quality: 80, cheapPE: 15, richPE: 30, yield: 4.5, weakGrowth: .5 });
  const tags = {
    quality_cheap: ["质优低估", "good", 1], quality_rich: ["质优不便宜", "blue", 2],
    cheap_weak: ["低估质弱", "warn", 3], value_trap: ["价值陷阱风险", "risk", 4],
    weak_fair: ["质弱价格一般", "", 5], loss: ["亏损估值不适用", "risk", 6],
    missing: ["分类资料不足", "warn", 7],
  };
  const number = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
  function classify(company, year) {
    const price = company.price || {}, shares = company.shares || {}, dividend = company.dividend || {};
    const profit = number(company.annual?.find((row) => String(row.year) === String(year))?.net_profit);
    const matched = price.price_date && price.price_date === shares.source_date
      && price.unit === "CNY/share" && shares.unit === "shares";
    const pe = matched && number(price.close) > 0 && number(shares.shares) > 0 && profit > 0
      ? price.close * shares.shares / profit : null;
    const total = number(company.score?.total);
    const dimension = company.score?.dimensions?.find((d) => d.name === "经营韧性");
    const growth = number(dimension?.score) !== null && number(dimension?.weight) > 0 ? dimension.score / dimension.weight : null;
    const yieldValue = dividend.price_date === price.price_date && String(dividend.year) === String(year)
      ? number(dividend.yield_pct) : null;
    const payout = number(dividend.payout_pct);
    const yieldCheap = yieldValue !== null && yieldValue >= rules.yield && payout !== null && payout >= 0 && payout <= 100;
    const cheap = pe !== null && pe < rules.richPE && (pe <= rules.cheapPE || yieldCheap);
    let id;
    if (profit !== null && profit <= 0) id = "loss";
    else if (total === null || pe === null) id = "missing";
    else if (total >= rules.quality) id = cheap ? "quality_cheap" : "quality_rich";
    else if (!cheap) id = "weak_fair";
    else if (growth === null) id = "missing";
    else id = growth < rules.weakGrowth ? "value_trap" : "cheap_weak";
    const [label, tone, order] = tags[id];
    const reason = `${year}A 静态PE ${pe === null ? "不适用/缺项" : pe.toFixed(2) + "倍"}；已实施股息率 ${yieldValue === null ? "缺项" : yieldValue.toFixed(2) + "%"}；年度派现率 ${payout === null ? "缺项" : payout.toFixed(2) + "%"}；V5财务分 ${total ?? "缺项"}；经营韧性得分率 ${growth === null ? "缺项" : (growth * 100).toFixed(1) + "%"}。研究阈值分类，非DCF内在价值结论。`;
    return { id, label, tone, order, pe, reason };
  }
  const api = { rules, classify, tags };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LiquorCompanyStyle = api;
})(typeof window === "object" ? window : globalThis);
