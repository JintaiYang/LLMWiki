import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cutoff = '2026-10-13';
const tickers = 'MSFT V MA GOOGL AAPL META AMZN NVDA AVGO TSM ASML ADBE INTU CDNS SNPS ROP MSCI FICO SPGI MCO ICE CME VRSK VRSN ADP PAYX COST WMT PG KO PEP PM CL MCD HD LOW ORLY AZO TJX CTAS FAST WM RSG ROL LIN SHW ITW ETN ODFL WSO HEI TDG UNP CSX CAT XOM CVX ISRG IDXX SYK DHR TMO ZTS VRTX REGN LLY ABT BSX NVO UNH NKE BKNG MAR AJG AON BRO CB PGR JPM BRK-B AFL BLK SCHW TXN KLAC LRCX AMAT WAT EFX UPS DE EL MDT JNJ CPRT'.split(' ');
let supplemental = {};
try { supplemental = JSON.parse(await fs.readFile(path.join(dir, 'inline-facts.json'), 'utf8')); } catch {}
const annualForms = new Set(['10-K', '10-K/A', '20-F', '20-F/A']);
const headers = { 'User-Agent': 'IndependentFundamentalResearch research@example.com', Accept: 'application/json' };

async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

const defs = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenueFromContractsWithCustomers', 'Revenue'],
  operatingIncome: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'CashFlowsFromUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'PaymentsToAcquireProductiveAssets', 'PaymentsToAcquireOtherPropertyPlantAndEquipment', 'PaymentsToAcquireOtherProductiveAssets', 'PaymentsForCapitalImprovements'],
  sbc: ['ShareBasedCompensation', 'SharebasedPaymentExpense', 'AdjustmentsForSharebasedPayments', 'AllocatedShareBasedCompensationExpense'],
  assets: ['Assets'],
  equity: ['StockholdersEquity', 'EquityAttributableToOwnersOfParent', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'Equity'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents'],
  currentLiabilities: ['LiabilitiesCurrent', 'CurrentLiabilities'],
  liabilities: ['Liabilities'],
  shares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'DilutedWeightedAverageShares'],
};

function observations(data, names, unit, duration) {
  const result = [];
  for (const [priority, name] of names.entries()) {
    for (const namespace of ['us-gaap', 'ifrs-full']) {
      const concept = data.facts?.[namespace]?.[name];
      for (const item of concept?.units?.[unit] ?? []) {
        if (item.filed > cutoff || !annualForms.has(item.form)) continue;
        const days = item.start ? (Date.parse(item.end) - Date.parse(item.start)) / 86400000 : null;
        if (duration && !(days >= 330 && days <= 380)) continue;
        if (!duration && item.start) continue;
        result.push({ ...item, concept: `${namespace}:${name}`, unit, priority });
      }
    }
  }
  return result;
}

function choose(items, end, start) {
  const matches = items.filter(x => x.end === end && (!start || x.start === start));
  matches.sort((a, b) => a.priority - b.priority || b.filed.localeCompare(a.filed));
  return matches[0] ?? null;
}

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : null;
};
const ratio = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;

function summarize(data, ticker, cik) {
  const supplement = supplemental[ticker];
  for (const item of supplement?.facts ?? []) {
    const [namespace, concept] = item.concept.split(':');
    if (!['us-gaap', 'ifrs-full'].includes(namespace) || !/^(iso4217:[A-Z]{3}|xbrli:shares)$/.test(item.unit ?? '')) continue;
    const unit = item.unit.split(':')[1];
    data.facts[namespace] ??= {};
    data.facts[namespace][concept] ??= { units: {} };
    data.facts[namespace][concept].units[unit] ??= [];
    data.facts[namespace][concept].units[unit].push({ start: item.startdate, end: item.enddate ?? item.instant, val: item.val, accn: supplement.source.accession, filed: supplement.source.filed, form: supplement.source.form, fp: 'FY', sourceUrl: supplement.source.url });
  }
  const currencies = [...new Set(Object.values(data.facts ?? {}).flatMap(ns => Object.values(ns).flatMap(f => Object.keys(f.units ?? {}))))].filter(x => /^[A-Z]{3}$/.test(x));
  const unit = currencies.map(currency => ({ currency, count: observations(data, defs.revenue, currency, true).length })).sort((a, b) => b.count - a.count)[0]?.currency ?? 'USD';
  const companyDefs = { ...defs, revenue: ['MA', 'BRK-B'].includes(ticker) ? ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'] : ticker === 'JPM' ? ['RevenuesNetOfInterestExpense', 'Revenues'] : defs.revenue };
  const all = Object.fromEntries(Object.entries(companyDefs).map(([key, names]) => [key, observations(data, names, key === 'shares' ? 'shares' : unit, !['assets', 'equity', 'cash', 'currentLiabilities', 'liabilities'].includes(key))]));
  const ends = [...new Set(all.revenue.map(x => x.end))].sort().slice(-6);
  const periods = ends.map(end => {
    const revenue = choose(all.revenue, end);
    const fields = Object.fromEntries(Object.keys(defs).map(key => [key, choose(all[key], end, ['assets', 'equity', 'cash', 'currentLiabilities', 'liabilities'].includes(key) ? null : revenue.start)]));
    const value = Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, item?.val ?? null]));
    const fcf = value.cfo !== null && value.capex !== null ? value.cfo - value.capex : null;
    const sbcFcf = fcf !== null && value.sbc !== null ? fcf - value.sbc : null;
    return { start: revenue.start, end, ...value, fcf, sbcFcf, operatingMargin: ratio(value.operatingIncome, value.revenue), fcfMargin: ratio(fcf, value.revenue), cfoToIncome: ratio(value.cfo, value.netIncome), sbcToRevenue: ratio(value.sbc, value.revenue), fields };
  });
  for (let i = 1; i < periods.length; i++) {
    const p = periods[i];
    const prev = periods[i - 1];
    p.roa = ratio(p.netIncome, p.assets !== null && prev.assets !== null ? (p.assets + prev.assets) / 2 : null);
    p.roe = ratio(p.netIncome, p.equity !== null && prev.equity !== null ? (p.equity + prev.equity) / 2 : null);
  }
  const years = periods.slice(-5);
  const first = years[0], last = years.at(-1);
  const elapsed = first && last ? (Date.parse(last.end) - Date.parse(first.end)) / (365.25 * 86400000) : 0;
  const summary = {
    years: years.length,
    revenueCagr: elapsed > 0 && first.revenue > 0 && last.revenue > 0 ? (last.revenue / first.revenue) ** (1 / elapsed) - 1 : null,
    operatingMarginMedian: median(years.map(x => x.operatingMargin)),
    fcfMarginMedian: median(years.map(x => x.fcfMargin)),
    cfoToIncomeMedian: median(years.map(x => x.cfoToIncome)),
    roaMedian: median(years.map(x => x.roa)),
    roeMedian: median(years.map(x => x.roe)),
    profitPositiveYears: years.filter(x => x.netIncome !== null && x.netIncome > 0).length,
    profitCoverageYears: years.filter(x => x.netIncome !== null).length,
    fcfPositiveYears: years.filter(x => x.fcf !== null && x.fcf > 0).length,
    fcfCoverageYears: years.filter(x => x.fcf !== null).length,
    latestFcf: last?.fcf ?? null,
    latestSbcFcf: last?.sbcFcf ?? null,
    latestSbcToRevenue: last?.sbcToRevenue ?? null,
    dilutedSharesYoy: null,
  };
  if (years.length >= 2 && last.fields.shares) {
    const prev = years.at(-2);
    const comparable = all.shares.find(x => x.end === prev.end && x.start === prev.start && x.accn === last.fields.shares.accn);
    summary.dilutedSharesYoy = comparable?.val > 0 ? last.shares / comparable.val - 1 : null;
  }
  const interimCandidates = companyDefs.revenue.flatMap((concept, priority) => ['us-gaap', 'ifrs-full'].flatMap(namespace => (data.facts?.[namespace]?.[concept]?.units?.[unit] ?? []).filter(x => ['10-Q', '10-Q/A'].includes(x.form) && x.filed <= cutoff && x.start && (Date.parse(x.end) - Date.parse(x.start)) / 86400000 >= 70 && (Date.parse(x.end) - Date.parse(x.start)) / 86400000 <= 110).map(x => ({ ...x, priority }))));
  interimCandidates.sort((a, b) => b.end.localeCompare(a.end) || a.priority - b.priority || b.filed.localeCompare(a.filed));
  const latestInterim = interimCandidates[0];
  let interim = null;
  if (latestInterim) {
    const prev = interimCandidates.find(x => x.accn === latestInterim.accn && Math.abs((Date.parse(latestInterim.end) - Date.parse(x.end)) / 86400000 - 365) <= 8);
    interim = { start: latestInterim.start, end: latestInterim.end, filed: latestInterim.filed, accn: latestInterim.accn, revenue: latestInterim.val, revenueYoy: prev?.val > 0 ? latestInterim.val / prev.val - 1 : null };
  }
  return { ticker, cik, name: data.entityName, unit, source: `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, supplementalSource: supplement?.source ?? null, annualFilings: [...new Set(years.map(x => x.fields.revenue?.accn).filter(Boolean))].map(accn => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replaceAll('-', '')}/${accn}-index.html`), periods: years, interim, summary };
}

await fs.mkdir(path.join(dir, 'raw'), { recursive: true });
const registry = await get('https://www.sec.gov/files/company_tickers.json');
await fs.writeFile(path.join(dir, 'company-tickers.json'), JSON.stringify(registry));
const index = new Map(Object.values(registry).map(x => [x.ticker, x]));
const results = [], failures = [];
for (let offset = 0; offset < tickers.length; offset += 2) {
  const batch = await Promise.all(tickers.slice(offset, offset + 2).map(async ticker => {
    const entry = index.get(ticker);
    if (!entry) return { ticker, error: 'Ticker not in SEC registry' };
    const file = path.join(dir, 'raw', `${ticker}.json`);
    try {
      let data;
      try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch {
        try { data = JSON.parse(gunzipSync(await fs.readFile(`${file}.gz`)).toString('utf8')); }
        catch { data = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(entry.cik_str).padStart(10, '0')}.json`); await fs.writeFile(file, JSON.stringify(data)); }
      }
      return summarize(data, ticker, entry.cik_str);
    } catch (error) { return { ticker, error: error.message }; }
  }));
  for (const result of batch) {
    if (result.error) failures.push(result);
    else results.push(result);
    console.log(result.ticker, result.error ?? `${result.periods.at(-1)?.end} ${result.summary.years} years ${result.unit}`);
  }
}
await fs.writeFile(path.join(dir, 'financials.json'), JSON.stringify({ cutoff, collectedAt: new Date().toISOString(), methodology: 'Annual consolidated standard XBRL facts; actual start/end; 330-380 day duration; latest restatement available by cutoff; null is missing, never zero.', results, failures }, null, 2));
const columns = ['ticker', 'name', 'unit', 'latestEnd', 'years', 'revenueCagr', 'operatingMarginMedian', 'fcfMarginMedian', 'cfoToIncomeMedian', 'roaMedian', 'roeMedian', 'profitPositiveYears', 'fcfPositiveYears', 'fcfCoverageYears', 'latestFcf', 'latestSbcFcf', 'latestSbcToRevenue', 'dilutedSharesYoy', 'source'];
const csv = [columns, ...results.map(r => { const row = { ...r, ...r.summary, latestEnd: r.periods.at(-1)?.end }; return columns.map(c => row[c] ?? ''); })].map(row => row.map(x => `"${String(x).replaceAll('"', '""')}"`).join(',')).join('\n');
await fs.writeFile(path.join(dir, 'comparison.csv'), '\ufeff' + csv + '\n');
console.log(`Saved ${results.length} companies; failures ${failures.length}`);
