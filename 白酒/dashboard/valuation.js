(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LiquorValuation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const valid = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
  function yearsBefore(day, years) {
    const date = new Date(day + "T00:00:00Z");
    const month = date.getUTCMonth();
    date.setUTCFullYear(date.getUTCFullYear() - years);
    if (date.getUTCMonth() !== month) date.setUTCDate(0);
    return date.toISOString().slice(0, 10);
  }
  function calculate(rows, key) {
    const first = rows.find((r) => valid(r[key]))?.date;
    return rows.map((row, index) => {
      const value = valid(row[key]) ? row[key] : null;
      const result = { date: row.date, value, percentile5: null, percentile10: null, mean: null, std: null, count5: 0, count10: 0 };
      for (const years of [5, 10]) {
        const cutoff = yearsBefore(row.date, years);
        if (!first || first > cutoff) continue;
        const values = rows.slice(0, index + 1).filter((r) => r.date > cutoff && valid(r[key])).map((r) => r[key]);
        const n = values.length;
        result["count" + years] = n;
        if (n < 2) continue;
        if (value !== null) result["percentile" + years] = 100 * (values.filter((v) => v < value).length + .5 * values.filter((v) => v === value).length) / n;
        if (years === 5) {
          result.mean = values.reduce((a, b) => a + b, 0) / n;
          result.std = Math.sqrt(values.reduce((sum, v) => sum + (v - result.mean) ** 2, 0) / n);
        }
      }
      return result;
    });
  }
  function observations(rows, key, source) {
    const own = rows.filter((r) => typeof r[key] === "number");
    if (source === "daily") return rows;
    const months = new Map();
    own.forEach((r) => months.set(r.date.slice(0, 7), r));
    return [...months.values()];
  }
  return { calculate, yearsBefore, observations };
});
