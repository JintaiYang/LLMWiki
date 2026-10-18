import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
const dir = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(await fs.readFile(path.join(dir, 'company-tickers.json'), 'utf8'));
const index = new Map(Object.values(registry).map(x => [x.ticker, x]));
const headers = { 'User-Agent': 'IndependentFundamentalResearch research@example.com' };
const tickers = 'TSM MA ADP LLY ROP ZTS KLAC TJX ETN BKNG AJG BRO CB PGR JPM BRK-B NVO XOM'.split(' ');
await fs.mkdir(path.join(dir, 'filings'), { recursive: true });
const manifest = [];
for (const ticker of tickers) {
  const cik = index.get(ticker).cik_str;
  const submissions = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, { headers, signal: AbortSignal.timeout(45000) }).then(r => r.json());
  const recent = submissions.filings.recent;
  const i = recent.form.findIndex((form, j) => ['10-K', '20-F'].includes(form) && recent.filingDate[j] <= '2026-10-13');
  if (i < 0) { console.log(ticker, 'annual filing missing'); continue; }
  const accession = recent.accessionNumber[i];
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll('-', '')}/${recent.primaryDocument[i]}`;
  const file = path.join(dir, 'filings', `${ticker}.html`);
  let content;
  try { content = await fs.readFile(file, 'utf8'); }
  catch {
    try { content = gunzipSync(await fs.readFile(`${file}.gz`)).toString('utf8'); }
    catch {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`${ticker} HTTP ${response.status}`);
      content = await response.text();
      await fs.writeFile(file, content);
    }
  }
  manifest.push({ ticker, cik, accession, url, form: recent.form[i], filed: recent.filingDate[i], reportDate: recent.reportDate[i] });
  console.log(ticker, recent.reportDate[i], content.length);
}
await fs.writeFile(path.join(dir, 'filings', 'manifest.json'), JSON.stringify(manifest, null, 2));
