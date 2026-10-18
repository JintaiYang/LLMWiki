import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.dirname(root);
const originalDir = path.join(workspace, '投资学院/04_阶段3_投资实战');
const originalData = path.join(originalDir, '美股Top50数据_20261013');
const dataDir = path.join(root, '02_原始资料/01_SEC数据');
const cutoff = '2026-10-13';
const date = '2026-10-14';
const financialCompanies = new Set(['BRK-B', 'JPM', 'CB', 'PGR']);
const out = async (name, content) => {
  const dest = path.join(root, name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content, 'utf8');
};
const copyOnce = async (source, name) => {
  const dest = path.join(root, name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try { await fs.access(dest); }
  catch { await fs.copyFile(source, dest); }
};
const quote = value => JSON.stringify(value);
const link = (name, label) => `[[${name}${label ? `|${label}` : ''}]]`;
const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '待验证';
const money = value => Number.isFinite(value) ? (value / 1e9).toFixed(2) : '待验证';
const body = text => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
const page = (title, type, content, { status = 'active', sources = [], related = [], evidence = 'mixed', extra = {} } = {}) => {
  const fields = { title, note_type: type, status, vault: '美股50', created: date, updated: date, data_cutoff: cutoff, report_period: '各公司最近五个完整财年', evidence_level: evidence, evidence_class: evidence === 'high' ? 'primary_source' : 'facts_and_research_judgment', source_priority: 'SEC', sources, related, tags: ['美股50', '基本面', '不考虑估值'], ...extra };
  const yaml = Object.entries(fields).map(([key, value]) => Array.isArray(value) ? `${key}:\n${value.length ? value.map(x => `  - ${quote(x)}`).join('\n') : '  []'}` : `${key}: ${quote(value)}`).join('\n');
  return `---\n${yaml}\n---\n\n# ${title}\n\n${content.trim()}\n`;
};

await copyOnce(path.join(originalData, 'financials.json'), '02_原始资料/01_SEC数据/financials.json');
await copyOnce(path.join(originalData, 'selection.json'), '02_原始资料/01_SEC数据/selection.json');
await copyOnce(path.join(originalData, 'comparison.csv'), '02_原始资料/01_SEC数据/95家候选比较快照.csv');
await copyOnce(path.join(originalDir, '美股基本面Top50_不考虑估值_20261013.md'), '02_原始资料/筛选报告快照.txt');
await copyOnce(path.join(originalDir, '美股Top50财务证据_20261013.md'), '02_原始资料/财务证据快照.txt');
await copyOnce(path.join(originalDir, 'A股价值投资选股与基本面分析方法论.md'), '02_原始资料/A股方法论参考快照.txt');
const report = await fs.readFile(path.join(root, '02_原始资料/筛选报告快照.txt'), 'utf8');
const evidence = await fs.readFile(path.join(root, '02_原始资料/财务证据快照.txt'), 'utf8');
const selection = JSON.parse(await fs.readFile(path.join(dataDir, 'selection.json'), 'utf8'));
const financials = JSON.parse(await fs.readFile(path.join(dataDir, 'financials.json'), 'utf8'));
const data = new Map(financials.results.map(x => [x.ticker, x]));
const reportRows = [...report.matchAll(/^\| (\d+) \| ([A-Z.]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)];
if (selection.length !== 50 || reportRows.length !== 50 || new Set(selection.map(x => x.ticker)).size !== 50) throw new Error('Expected exactly 50 unique companies and 50 report judgments');
const companies = selection.map((selected, i) => {
  const row = reportRows[i], r = data.get(selected.ticker);
  if (Number(row[1]) !== i + 1 || row[2].replace('BRK.B', 'BRK-B') !== selected.ticker || r?.periods.length !== 5) throw new Error(`Selection mismatch: ${selected.ticker}`);
  const slug = `${selected.name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '')}_${selected.ticker}`;
  return { ...selected, rank: i + 1, slug, r, thesis: row[4].trim(), risk: row[5].trim(), sourceId: `SEC-${selected.ticker}`, source: `05_知识库/10_来源/资料节点/SEC-${selected.ticker}_年度资料`, company: `05_知识库/03_公司库/${slug}`, tier: i < 10 ? '核心研究' : i < 30 ? '高质量候选' : '风险假设敏感' };
});
try {
  const existing = JSON.parse(await fs.readFile(path.join(dataDir, '研究判断快照.json'), 'utf8'));
  const judgments = new Map(existing.map(x => [x.ticker, x]));
  for (const company of companies) {
    const judgment = judgments.get(company.ticker);
    if (typeof judgment?.thesis === 'string') company.thesis = judgment.thesis;
    if (typeof judgment?.risk === 'string') company.risk = judgment.risk;
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await out('02_原始资料/01_SEC数据/研究判断快照.json', JSON.stringify(companies.map(({ r, ...judgment }) => judgment), null, 2) + '\n');

for (const c of companies) {
  for (const extension of ['json.gz', 'json']) {
    try { await copyOnce(path.join(originalData, 'raw', `${c.ticker}.${extension}`), `02_原始资料/01_SEC数据/raw/${c.ticker}.${extension}`); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (c.r.supplementalSource) {
    for (const extension of ['html.gz', 'html']) {
      try { await copyOnce(path.join(originalData, 'filings', `${c.ticker}.${extension}`), `02_原始资料/01_SEC数据/filings/${c.ticker}.${extension}`); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

const roster = '05_知识库/03_公司库/美股50名册';
const comparison = '05_知识库/12_跟踪器/美股50比较表';
const rules = '05_知识库/01_选股逻辑/本次筛选规则';
const risks = '05_知识库/14_风险/未入选与证伪';
const sourceIndex = '05_知识库/10_来源/来源索引';
const fullReport = '05_知识库/01_选股逻辑/完整筛选报告';
const fullEvidence = '05_知识库/12_跟踪器/五年财务证据';
const methodSource = '05_知识库/10_来源/资料节点/方法论参考';
const reportSource = '05_知识库/10_来源/资料节点/本次筛选与数据批次';

for (const c of companies) {
  const r = c.r, s = r.summary, latest = r.periods.at(-1), fin = financialCompanies.has(c.ticker);
  const marked = value => value === '待验证' ? value : `${value} (${c.sourceId})`;
  const row = p => `| ${p.end} | ${marked(money(p.revenue))} | ${marked(money(p.netIncome))} | ${marked(money(p.cfo))} | ${marked(money(p.capex))} | ${marked(money(p.fcf))} | ${marked(money(p.sbcFcf))} |`;
  let userNotes = '尚未追加个股深度研究。';
  try { const old = await fs.readFile(path.join(root, `${c.company}.md`), 'utf8'); userNotes = old.match(/<!-- user-notes:start -->\n([\s\S]*?)\n<!-- user-notes:end -->/)?.[1] ?? userNotes; } catch {}
  const quarterly = r.interim && r.interim.end > latest.end ? `${r.interim.end} 标准标签季度收入同比 ${pct(r.interim.revenueYoy)}（${c.sourceId}），只检查收入，未完成季度利润与现金流归一化。` : '当前以完整财年为基础；最新季度或 ADR 经营公告需要单独核验。';
  const financialNotice = fin ? '**金融/多元企业：以下 CFO 与 FCF 原值仅供溯源，不参与通用现金质量排名。** 银行看 ROTCE、CET1、信用损失；保险看综合成本率和准备金；伯克希尔拆经营盈利与证券公允价值变动。' : `五年净利润代理与 FCF 均为正；收入 CAGR ${marked(pct(s.revenueCagr))}，FCF 利润率中位数 ${marked(pct(s.fcfMarginMedian))}。这些是初筛证据，未代替完整 ROIC、债务与治理核查。`;
  await out(`${c.company}.md`, page(`${c.name}（${c.ticker === 'BRK-B' ? 'BRK.B' : c.ticker}）`, 'company_profile', `## 一句话判断（推断）\n\n${c.thesis}\n\n## 入选位置\n\n- 本次候选池研究序号：${c.rank}；分组：${c.tier}；行业：${c.sector}。\n- 这是 95 家候选池中的研究排序，没有估值和买入结论。\n- 原始财务币种：${r.unit}；最新完整财年截止：${latest.end}（${c.sourceId}）。\n\n## 事实\n\n来源：${link(c.source, c.sourceId)}。金额单位为十亿元 ${r.unit}，不与其他币种直接比较金额。净利润为合并标准字段代理，BKNG 使用普通股可得净利润；未统一扣除非控股股东损益。\n\n${financialNotice}\n\n| 财年截止 | 收入 | 净利润代理 | CFO | 现金资本开支 | FCF | FCF - SBC |\n|---|---:|---:|---:|---:|---:|---:|\n${r.periods.map(row).join('\n')}\n\nFCF = CFO - 现金资本开支；FCF - SBC 是经济成本敏感性代理。未扣并购支付或融资租赁新增资产，不等于股东可自由分配现金。缺失字段保留“待验证”。\n\n${quarterly}\n\n## 推断\n\n${c.thesis}。该判断沿用原筛选报告，不能由五年正 FCF 单独推出。\n\n## 风险与证伪\n\n${c.risk}。这是跟踪条件，不表示风险已经发生。\n\n## 待验证\n\n- 含商誉、租赁的 ROIC 与增量回报，有机增长与并购增长。\n- 最新季度的利润、营运资本和现金；现金开支、软件资本化和客户资金口径。\n- 净负债、利息覆盖、审计意见、管理层及资本配置。\n${fin ? '- 行业专用指标的最新季度变动与长期风险敞口。\n' : ''}\n## 下一步\n\n按 ${link('05_知识库/11_研究框架/研究框架')} 补齐原始附注证据；对上述证伪条件给出观测指标，再决定是否调整研究顺序。\n\n## 补充研究\n\n<!-- user-notes:start -->\n${userNotes}\n<!-- user-notes:end -->\n\n## 关联\n\n- ${link(roster)}\n- ${link(comparison)}\n- ${link(rules)}\n- ${link(risks)}\n- ${link(c.source, `${c.sourceId} 官方资料与字段来源`)}`, { status: 'growing', sources: [link(c.source)], related: [link(roster), link(comparison), link(risks)], extra: { ticker: c.ticker, industry: c.sector, research_rank: c.rank, research_group: c.tier } }));
  const filingLinks = [...new Set(r.annualFilings)].map((url, i) => `- [年度申报资料 ${i + 1}](${url})`).join('\n');
  await out(`${c.source}.md`, page(`${c.sourceId}：${c.name} SEC 年度资料`, 'source_note', `## 来源\n\n- 发布机构：美国 SEC；类型：监管申报及结构化 XBRL。\n- 来源编号：${c.sourceId}；截止：${cutoff}；报告窗口：${r.periods[0].start} 至 ${latest.end}。\n- 状态：年度标准字段已导入；完整治理、ROIC 和最新季报仍待核验。\n- [SEC Company Facts](${r.source})\n${r.supplementalSource ? `- [补充年度申报原文](${r.supplementalSource.url})\n` : ''}\n${filingLinks}\n\n## 本地材料\n\n- [字段、单位、起止日、申报日和 accession](../../../02_原始资料/01_SEC数据/financials.json)\n- [Company Facts 压缩快照](../../../02_原始资料/01_SEC数据/raw/${c.ticker}.json.gz)\n${r.supplementalSource ? `- [补充年报压缩快照](../../../02_原始资料/01_SEC数据/filings/${c.ticker}.html.gz)\n` : ''}\n\n## 已提取事实\n\n最近五个完整年度的收入、净利润代理、CFO、现金资本开支与 SBC。缺失值保留待验证，金融企业不以通用 FCF 评分。每个字段的具体概念、来源与币种记录在结构化数据中。\n\n## 推断与待验证\n\nSEC 财务来源本身不能证明护城河；原报告中的竞争优势与风险是研究判断。现金资本开支标签范围、非控股股东损益、并购与客户资金等仍需附注核验。\n\n## 关联\n\n- ${link(c.company, `${c.name} 公司档案`)}\n- ${link(sourceIndex)}\n- ${link('02_原始资料/原始资料目录')}\n- ${link(fullEvidence)}`, { evidence: 'high', sources: [r.source], related: [link(c.company), link(sourceIndex)] }));
}

const grouped = ['核心研究', '高质量候选', '风险假设敏感'].map(group => `## ${group}\n\n| 研究序号 | 公司 | 代码 | 行业 | 入选判断（推断） |\n|---:|---|---|---|---|\n${companies.filter(c => c.tier === group).map(c => `| ${c.rank} | ${link(c.company, c.name)} | ${c.ticker} | ${c.sector} | ${c.thesis} |`).join('\n')}`).join('\n\n');
await out(`${roster}.md`, page('美股50名册', 'company_roster', `50 家公司沿用 2026-10-13 研究名单。分组便于阅读，不是仓位配置；第 20--50 名对风险假设尤其敏感。\n\n${grouped}\n\n${link(comparison)} · ${link(rules)} · ${link(risks)}`, { sources: [link(reportSource)], related: [link('07_导航首页'), link(comparison)] }));
await out(`${comparison}.md`, page('美股50比较表', 'financial_tracker', `五年为每家最近五个完整财年，窗口错位；CAGR 为五个端点间约四年的增长。下列指标均由 SEC 字段计算，具体来源在每行的资料节点。中位数不能代替行业归一化。\n\n| 序号 | 公司 | 最新完整财年 | 原币种 | 收入 CAGR | FCF 利润率中位数 | FCF 为正 / 有效年 | 来源 |\n|---:|---|---|---|---:|---:|---|---|\n${companies.map(c => `| ${c.rank} | ${link(c.company, c.name)} | ${c.r.periods.at(-1).end} | ${c.r.unit} | ${pct(c.r.summary.revenueCagr)} (${c.sourceId}) | ${financialCompanies.has(c.ticker) ? '不适用' : `${pct(c.r.summary.fcfMarginMedian)} (${c.sourceId})`} | ${financialCompanies.has(c.ticker) ? '不适用' : `${c.r.summary.fcfPositiveYears}/${c.r.summary.fcfCoverageYears} (${c.sourceId})`} | ${link(c.source, c.sourceId)} |`).join('\n')}\n\n## 完整证据\n\n- ${link(fullEvidence, '五年财务总表与逐公司来源')}\n- ${link('02_原始资料/原始资料目录')}\n- ${link('05_知识库/06_关键概念/财务指标口径')}`, { sources: [link(sourceIndex)], related: [link(roster), link(fullEvidence)] }));

const adapted = body(report).replace(/^# .*\n+/, '')
  .replaceAll('[[美股Top50财务证据_20261013]]', link(fullEvidence))
  .replaceAll('[[美股基本面Top50_不考虑估值_20261013]]', link(fullReport))
  .replaceAll('[[A股价值投资选股与基本面分析方法论]]', link(methodSource))
  .replaceAll('美股Top50数据_20261013/', '../../02_原始资料/01_SEC数据/');
await out(`${fullReport}.md`, page('完整筛选报告', 'stock_research', `${adapted}\n\n## Wiki 入口\n\n${link('07_导航首页')} · ${link(roster)} · ${link(sourceIndex)}`, { sources: [link(reportSource), link(methodSource), link(sourceIndex)], related: [link(roster), link(comparison)] }));
const adaptedEvidence = body(evidence).replace(/^# .*\n+/, '')
  .replaceAll('[[美股基本面Top50_不考虑估值_20261013]]', link(fullReport))
  .replaceAll('美股Top50数据_20261013/financials.json', '../../02_原始资料/01_SEC数据/financials.json')
  .replaceAll('美股Top50数据_20261013/comparison.csv', '../../02_原始资料/01_SEC数据/95家候选比较快照.csv')
  .replaceAll('美股Top50数据_20261013/selection.json', '../../02_原始资料/01_SEC数据/selection.json')
  .replace(/\n- \[(SEC 采集与指标计算脚本|补充年报采集脚本|年报 Inline XBRL 解析脚本)\][^\n]*/g, '')
  .replace(/复核流程：[\s\S]*$/, `本 Wiki 从已冻结的 SEC 快照生成。页面重建脚本为 scripts/build-wiki.mjs；原始采集脚本仍保留在投资学院的美股Top50数据_20261013目录。\n\n${link(roster)} · ${link(sourceIndex)}\n`);
await out(`${fullEvidence}.md`, page('五年财务证据', 'financial_evidence', adaptedEvidence, { sources: [link(sourceIndex)], related: [link(comparison), link(roster)] }));
await out(`${rules}.md`, page('本次筛选规则', 'screening_framework', `## 范围\n\n从 95 家预选公司形成 50 家美股质量研究名单，包含美国上市普通股与 ADR；同一发行人只计一次。未穷举全市场，不能声称客观全市场前 50。资料截止 ${cutoff}，估值不参与。\n\n## 沿用的框架\n\n商业模式与护城河 20、盈利与回报 20、现金创造 20、资产负债表及盈余质量 15、增长与再投资 15、资本配置及治理 10。此次用六个维度组织研究判断，未把未完成的 ROIC、债务和治理核查伪装成百分制评分。\n\n## 美股适配\n\n- 弱化回购压缩权益导致的 ROE；负权益不自动排除。\n- 同看 FCF 与 FCF - SBC；使用同一申报中的可比股数，避免把拆股当稀释。\n- 按行业看回报；会员零售与软件不共享毛利率门槛，银行保险不用通用 FCF。\n- 区分有机与并购增长；关注商誉、租赁、客户资金和产能回报。\n- 周期、单品、客户集中与监管风险不能由当年增长抵消。\n\n## 数据与判断\n\n入选 50 家都有五年完整年度收入记录；46 家非金融企业有五年正净利润代理与正现金 FCF。四家金融或多元企业采用独立口径，伯克希尔投资损益不能直接替代经营盈利。审计意见、完整 ROIC 和部分最新季度仍待验证。\n\n研究序号表达本次判断，不是精确的质量差距。名单与顺序均沿用原报告，Wiki 导入未重排。\n\n## 继续阅读\n\n- ${link(fullReport)}\n- ${link(roster)}\n- ${link('05_知识库/06_关键概念/财务指标口径')}\n- ${link(methodSource, '原 A 股方法论参考')}`, { sources: [link(reportSource), link(methodSource)], related: [link(roster), link(fullReport)] }));
await out('05_知识库/06_关键概念/财务指标口径.md', page('财务指标口径', 'metric_definitions', `- FCF = CFO - 报表现金资本开支；不扣收购、不自动加入融资租赁，不等于可分配股东盈余。\n- FCF - SBC 是股票薪酬经济成本代理；SBC 在利润中已扣、CFO 中加回，这里只扣回一次。\n- 五年收入 CAGR 为五个年度端点间实际时间计算，通常约四年；报告增长不等于有机增长。\n- 比率使用五年中位数；货币金额用公司原币种十亿元，不直接跨币种排序。\n- ROIC 需要正常化 NOPAT、平均投入资本、商誉与租赁；本次未完整计算。负/薄权益时停用 ROE 排名。\n- 金融公司用 ROTCE、CET1、信用损失、综合成本率与准备金，不以通用 FCF 判经营质量。\n- 未获取或口径不统一的字段标为待验证，不能填零；利润代理尚未统一扣除非控股股东损益。\n\n${link(fullEvidence)} · ${link(comparison)} · ${link(rules)}`, { sources: [link(reportSource)], related: [link(fullEvidence), link(rules)] }));
const excluded = report.match(/## 4\.[\s\S]*?(?=\n## 5\.)/)?.[0].replace(/^## 4[^\n]*\n/, '') ?? '';
await out(`${risks}.md`, page('未入选与证伪', 'risk_register', `## 入选公司的证伪条件（推断）\n\n以下是跟踪假设，不表示事件已发生。股价波动和估值变化不单独改变经营质量档案。\n\n| 公司 | 当前首要证伪条件 |\n|---|---|\n${companies.map(c => `| ${link(c.company, c.name)} | ${c.risk} |`).join('\n')}\n\n## 原报告中的未入选与备选\n\n${excluded.trim()}\n\n## 证据不足项\n\n完整 ROIC、租赁与负债附注、管理层与审计意见、部分最新季度的利润及现金流尚未完成。出现来源冲突先登记，不直接改历史快照。\n\n${link(fullReport)} · ${link(sourceIndex)}`, { sources: [link(reportSource)], related: [link(roster), link('05_知识库/11_研究框架/研究框架')] }));
await out('05_知识库/11_研究框架/研究框架.md', page('研究框架', 'research_framework', `1. 读公司档案，先用三句话解释卖什么、向谁收费、为何优势能持续。\n2. 核对来源节点与年报，检查五年事实及现金开支范围。\n3. 按行业重算 ROIC 或金融专用回报；把有机增长、并购和一次性事项分开。\n4. 补最新季度利润与现金，检查债务、租赁、SBC、管理层、审计意见。\n5. 写三条支持与三条证伪条件，将新增事实、推断和待验证分别记录。\n6. 更改名单或判断时先记入风险页，再追加操作日志。估值另行研究，不回填质量事实。\n\n公司页“补充研究”区域在重建时保留；结构化选择与财务快照维持原始截止日。\n\n${link(roster)} · ${link(risks)} · ${link('09_操作日志')} · ${link('03_模板/公司研究补充模板')}`, { related: [link(roster), link(rules)] }));
await out('05_知识库/00_新手入口/阅读路线.md', page('阅读路线', 'reading_route', `1. ${link(rules)}：了解不考虑估值时到底保留了哪些判断。\n2. ${link(roster)}：进入前十或感兴趣的行业公司档案。\n3. ${link(comparison)} 与 ${link(fullEvidence)}：对照五年数据，注意财年与币种。\n4. ${link(risks)}：检查证伪点、备选公司和未完成事项。\n5. ${link(sourceIndex)}：从来源节点进入 SEC 原文与原始快照。\n\n需要完整论证时读 ${link(fullReport)}；后续个股研究按 ${link('05_知识库/11_研究框架/研究框架')} 更新。`, { related: [link('07_导航首页'), link(roster)] }));

await out(`${methodSource}.md`, page('方法论参考', 'source_note', `- 来源：投资学院的《A股价值投资选股与基本面分析方法论》。\n- 用途：六维质量框架及风险证伪流程；本次调整财年、回购、SBC 和金融口径。\n- [原始参考快照](../../../02_原始资料/A股方法论参考快照.txt)\n- 该文是方法论，不是美股公司事实证据。\n\n${link(rules)} · ${link(sourceIndex)} · ${link('02_原始资料/原始资料目录')}`, { related: [link(rules), link(sourceIndex)] }));
await out(`${reportSource}.md`, page('本次筛选与数据批次', 'source_note', `- 来源：本次 95 家候选的 SEC 财务采集与人工判断。\n- 数据截止：${cutoff}；写入日期：${date}。\n- [原筛选报告快照](../../../02_原始资料/筛选报告快照.txt)\n- [原财务证据快照](../../../02_原始资料/财务证据快照.txt)\n- [结构化财务与逐字段来源](../../../02_原始资料/01_SEC数据/financials.json)\n- [50 家选择顺序](../../../02_原始资料/01_SEC数据/selection.json)\n- [研究判断快照](../../../02_原始资料/01_SEC数据/研究判断快照.json)\n- [95 家候选比较](../../../02_原始资料/01_SEC数据/95家候选比较快照.csv)\n\n财务事实以官方申报为来源；名单、护城河和证伪点属于研究判断。完整 ROIC、审计与部分最新季度核查待补。\n\n${link(fullReport)} · ${link(fullEvidence)} · ${link(sourceIndex)}`, { related: [link(fullReport), link(fullEvidence), link(sourceIndex)] }));
await out(`${sourceIndex}.md`, page('来源索引', 'source_index', `## 框架与研究批次\n\n- ${link(methodSource)}\n- ${link(reportSource)}\n- ${link('02_原始资料/原始资料目录')}\n\n## SEC 公司年度资料\n\n每个资料节点将公司档案、结构化字段、原始快照及官方年度申报连接起来。来源可信不等于护城河判断已被证明。\n\n| 来源编号 | 公司 | 最新完整财年 | 类型 | 导入与限制 |\n|---|---|---|---|---|\n${companies.map(c => `| ${link(c.source, c.sourceId)} | ${link(c.company, c.name)} | ${c.r.periods.at(-1).end} | 监管 / SEC | 五年标准字段；附注、季度和治理待核验 |`).join('\n')}\n\n${link('09_操作日志')} · ${link('08_索引')}`, { evidence: 'high', related: [link('02_原始资料/原始资料目录'), link('08_索引')] }));
await out('02_原始资料/原始资料目录.md', page('原始资料目录', 'raw_index', `## 冻结快照\n\n- [原筛选报告](筛选报告快照.txt)\n- [原财务证据](财务证据快照.txt)\n- [A 股方法论参考](A股方法论参考快照.txt)\n- [SEC 字段与申报元数据](01_SEC数据/financials.json)\n- [50 家选择顺序](01_SEC数据/selection.json)\n- [95 家候选比较](01_SEC数据/95家候选比较快照.csv)\n- [判断快照](01_SEC数据/研究判断快照.json)\n\n` + `原始 JSON 和补充年报已按入选公司复制到 01_SEC数据/raw 与 filings，压缩为 gzip；不依赖投资学院目录即可读取公司档案与来源。未入选候选保留结构化比较，没有声称复制全部外部原文。\n\n## 图谱与资料节点\n\n${link(sourceIndex)} · ${link(reportSource)} · ${link(methodSource)}\n\n${companies.map(c => `- ${link(c.source, `${c.sourceId} ${c.name}`)}`).join('\n')}`, { evidence: 'high', related: [link(sourceIndex), link('07_导航首页')] }));
await out('03_模板/公司研究补充模板.md', page('公司研究补充模板', 'research_template', `将下面内容填入公司档案的“补充研究”区域。没有查到的事实写待验证；日期使用资料发布日期和实际财年。\n\n## 新增事实\n\n记录来源编号、报告期、字段口径和原文链接。\n\n## 新增推断\n\n说明事实如何支持或削弱经营判断。\n\n## 证伪条件\n\n给出可观测指标与触发条件。\n\n## 待验证与下一步\n\n列出需补的附注、经营数据或季度资料。\n\n## 更新记录\n\n记录日期、旧判断、新判断与证据，并追加到 ${link('09_操作日志')}。`, { related: [link('05_知识库/11_研究框架/研究框架')] }));
await out('06_维护契约.md', page('维护契约', 'governance_contract', `## 范围\n\n本库与护城河50、白酒、银行同级，收录本次选出的 50 家美股上市企业及证据。包含普通股和 ADR，不讨论估值、目标价或买入仓位。当前只完成质量候选研究，不声称完整市场排名或财务审计。\n\n## 目录\n\n- 02_原始资料：只读快照和来源入口。\n- 03_模板：公司研究补充模板。\n- 04_运维报告：链接与数据一致性检查。\n- 05_知识库：阅读路线、规则、公司、指标、来源、框架、比较表和风险。\n- 06_维护契约、07_导航首页、08_索引、09_操作日志。\n\n## 证据纪律\n\n事实必须带 SEC 来源编号与实际报告期；推断和待验证独立写。未取到的数据不填零。金融公司、币种、财年及资本开支口径分开；ROIC、管理层、审计与部分季度核查仍未完成。\n\n## 更新纪律\n\n新的财报使用新的日期快照，不能覆盖 2026-10-13 的原始材料。名单变化先登记风险及理由，再更新索引并追加日志。Wiki 导入没有改动原研究名单。\n\n运行 node scripts/build-wiki.mjs 会按本库冻结材料重建公司页和导航；公司页 user-notes 标记内的“补充研究”会保留，其他自动生成区域的长期修改应放入结构化判断文件或另立来源。操作日志只追加；原始 TXT/JSON 快照不由重建修改。\n\n${link('07_导航首页')} · ${link('09_操作日志')} · ${link(sourceIndex)}`, { evidence: 'high', related: [link('07_导航首页'), link('08_索引')] }));
await out('07_导航首页.md', page('美股50 LLM Wiki', 'navigation', `**50 家美股公司的基本面研究库，暂不考虑估值。** 当前名单沿用 2026-10-13 的研究结果，资料窗口为每家公司最近五个完整财年，部分季度仍待补核。\n\n## 从这里开始\n\n1. ${link('05_知识库/00_新手入口/阅读路线')}\n2. ${link(rules)}\n3. ${link(roster)}\n4. ${link(comparison)}\n\n## 核心研究十家\n\n${companies.slice(0, 10).map(c => `- ${link(c.company, `${c.rank}. ${c.name} (${c.ticker})`)}`).join('\n')}\n\n## 导航\n\n| 模块 | 入口 | 内容 |\n|---|---|---|\n| 名册 | ${link(roster)} | 50 家公司档案及研究顺序 |\n| 筛选 | ${link(rules)} | A 股方法论的美股适配及边界 |\n| 完整报告 | ${link(fullReport)} | 排序理由、备选与风险解释 |\n| 比较表 | ${link(comparison)} | 五年收入与现金指标 |\n| 财务证据 | ${link(fullEvidence)} | 五年表、币种、公式及申报来源 |\n| 口径 | ${link('05_知识库/06_关键概念/财务指标口径')} | ROE、SBC、FCF 与金融差异 |\n| 风险 | ${link(risks)} | 证伪条件与未入选原因 |\n| 来源 | ${link(sourceIndex)} | 50 份公司资料节点与研究批次 |\n| 研究 | ${link('05_知识库/11_研究框架/研究框架')} | 个股后续核验顺序 |\n| 原始材料 | ${link('02_原始资料/原始资料目录')} | 冻结快照 |\n| 索引 | ${link('08_索引')} | 全部页面 |\n| 维护 | ${link('06_维护契约')} | 更新与证据纪律 |\n| 日志 | ${link('09_操作日志')} | 操作记录 |\n| 检查 | ${link('04_运维报告/2026-10-14_初建检查')} | 链接和数据一致性 |\n\n## 使用边界\n\n这是 95 家预选候选内的质量研究名单。估值、完整 ROIC、治理审计和全部最新季度核查未完成；序号不是买入顺序。\n\n## 跨库入口\n\n- [投资学院](../投资学院/00_导航首页.md)\n- [原始美股 Top50 报告](../投资学院/04_阶段3_投资实战/美股基本面Top50_不考虑估值_20261013.md)\n- [A 股护城河50](../护城河50/07_导航首页.md)`, { related: [link(roster), link(rules), link(sourceIndex)] }));
await out('08_索引.md', page('美股50索引', 'index', `最后写入：${date}；数据截止：${cutoff}。\n\n## 全局\n\n- ${link('07_导航首页')}\n- ${link('06_维护契约')}\n- ${link('09_操作日志')}\n- ${link('04_运维报告/2026-10-14_初建检查')}\n- ${link('03_模板/公司研究补充模板')}\n\n## 规则、数据与风险\n\n${['05_知识库/00_新手入口/阅读路线', rules, fullReport, comparison, fullEvidence, '05_知识库/06_关键概念/财务指标口径', '05_知识库/11_研究框架/研究框架', risks, sourceIndex, '02_原始资料/原始资料目录', methodSource, reportSource].map(x => `- ${link(x)}`).join('\n')}\n\n## 公司档案\n\n${companies.map(c => `- ${link(c.company, `${c.rank}. ${c.name} (${c.ticker})`)} · ${link(c.source, c.sourceId)}`).join('\n')}\n\n${link(roster)}`, { related: [link('07_导航首页'), link(roster)] }));
try { await fs.access(path.join(root, '09_操作日志.md')); }
catch { await out('09_操作日志.md', page('操作日志', 'operation_log', `只追加，不改旧记录。\n\n## [${date}] create | 美股50 Wiki 初建\n\n- 按用户要求将已有美股 Top50 研究写入同级独立 Wiki。\n- 沿用原 50 家与排序；复制五年结构化证据、入选公司原始快照及补充年报。\n- 建立 50 家公司档案、50 个 SEC 资料节点、方法论与数据批次节点。\n- 补齐导航、名册、比较表、财务证据、风险、来源、研究框架、模板和维护契约。\n- 事实、推断、待验证分别记录；不新增估值判断。\n- 来源：${link(reportSource)}、${link(sourceIndex)}。\n- 数据截止 ${cutoff}，不是导入日的新财报更新。\n- 后续：完整 ROIC、治理、附注和部分最新季度资料仍待核验。\n\n${link('04_运维报告/2026-10-14_初建检查')}`, { evidence: 'high', related: [link('07_导航首页'), link(sourceIndex)] })); }

const healthPath = '04_运维报告/2026-10-14_初建检查.md';
await out(healthPath, page('2026-10-14 初建检查', 'health_check', '链接检查结果待生成。', { related: [link('08_索引'), link('09_操作日志')] }));
async function markdownFiles(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(file));
    else if (entry.name.endsWith('.md')) files.push(file);
  }
  return files;
}
const files = await markdownFiles(root);
const targets = new Map();
for (const file of files) {
  const rel = path.relative(root, file).replaceAll(path.sep, '/').replace(/\.md$/, '');
  targets.set(rel, file);
  const base = path.basename(rel);
  if (!targets.has(base)) targets.set(base, file);
}
const incoming = new Set(), unresolved = [], missingAttachments = [];
let links = 0;
for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = match[1].split('|')[0].split('#')[0].replace(/\.md$/, '');
    links++;
    const resolved = targets.get(target);
    if (!resolved) unresolved.push({ page: path.relative(root, file), target });
    else if (resolved !== file) incoming.add(resolved);
  }
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!href || /^(https?:|mailto:)/.test(href)) continue;
    try { await fs.access(path.resolve(path.dirname(file), decodeURI(href))); }
    catch { missingAttachments.push({ page: path.relative(root, file), href }); }
  }
}
const orphans = files.filter(file => !incoming.has(file)).map(file => path.relative(root, file));
const check = { date, dataCutoff: cutoff, companies: companies.length, companySourceNodes: companies.length, markdownPages: files.length, wikilinks: links, unresolved, orphans, missingAttachments, selectedTickersMatchReport: true, allSelectedHaveFiveAnnualPeriods: true };
await out('04_运维报告/2026-10-14_链接检查.json', JSON.stringify(check, null, 2) + '\n');
await out(healthPath, page('2026-10-14 初建检查', 'health_check', `## 结果\n\n- 公司档案：${companies.length}；SEC 公司来源节点：${companies.length}；另有方法论与数据批次节点。\n- Markdown 页面：${files.length}；Wiki 链接：${links}。\n- 未解析 Wiki 链接：${unresolved.length}；孤立页面：${orphans.length}；缺失本地附件：${missingAttachments.length}。\n- 50 家名单与原报告逐项匹配，均有五个完整年度；未修改名次、数据或投资判断。\n- 本次为资料组织与导入，没有重新拉取财报、执行完整 ROIC 或季度审计。\n- [结构化检查结果](2026-10-14_链接检查.json)\n\n${unresolved.length ? JSON.stringify(unresolved, null, 2) : '本库 Wiki 链接全部可解析。'}\n\n${link('08_索引')} · ${link('09_操作日志')}`, { evidence: 'high', related: [link('08_索引'), link('09_操作日志')] }));
console.log(JSON.stringify(check, null, 2));
if (unresolved.length || missingAttachments.length || orphans.length) process.exitCode = 1;
