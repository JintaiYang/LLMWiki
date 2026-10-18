# 医疗健康研究台 V1

独立于白酒和银行目录，沿用白酒的四页结构与浅色研究界面。覆盖25家A股研究样本、8个子行业，包含2021–2025年报趋势和2026中报跟踪。23家可完整评分，百济神州与泽璟制药另列研发商业化观察池。股票池为主动研究选择，不代表完整行业或指数。

## 启动

```bash
python3 医疗健康/scripts/dashboard_server.py --port 8771
```

入口：http://127.0.0.1:8771/dashboard/industry.html

四页分别为 `industry.html`、`index.html`、`stock.html`、`score-formula.html`。静态资源全部本地，启动后无需访问外部服务即可浏览；PDF和原始JSON同样通过本地服务读取。

## 数据更新

优先级：AKShare → 财报PDF → iFinD补缺。当前100个AKShare原始快照、4份完整2025年报PDF、14条PDF附注/经营数据，财务数据未使用iFinD。机构观点用iFinD搜索过新闻摘要，标注为二手转述，不等同原版研报。

```bash
python3 医疗健康/scripts/fetch_akshare.py
python3 医疗健康/scripts/fetch_reports.py
python3 医疗健康/scripts/extract_report_evidence.py
python3 医疗健康/scripts/build_dashboard.py
```

AKShare和PDF下载默认使用缓存；AKShare加 `--refresh` 重取。下载脚本依赖 `akshare`、`requests`，PDF提取依赖 `pymupdf`。本地已有缓存，构建看板与评分仅需Python标准库。

PDF补充记录在 `data/verified_supplements.json`，手工核验后保留代码、期间、数值、单位、PDF文件、页码和说明。不能将PDF未经核验的自动文本命中直接当成结构化财务数据。已有AKShare字段不被附注覆盖；资料不足留空，只有AKShare与PDF均无法取得时才使用iFinD。

`build_dashboard.py` 固定研究日为2026-10-18、评分窗口2023–2025、最新跟踪2026H1，供本次V1快照复现。未来切换报告期需同步调整构建与评分窗口，并核验新报告公告日期，不能仅重跑采集就宣称已升级至新报告期。

## 评分

五维100分：盈利25、现金25、缓冲20、韧性20、真实性10。盈利、自由现金流率和应收占款使用子行业固定锚点。源码 `scripts/score.py` 是唯一评分入口，前端不重算。评分方法页展示11项完整公式、阈值、数值及贡献。

三年年度数据任一评分项缺失，总分留空，不补零、不按已知分归一化。风险必要字段缺失也不排名。亏损、累计利润非正与缺失分别处理。风险上限：最新年归母/扣非亏损49；连续两年CFO负49；三年累计FCF非正59；归母权益非正39。

商誉、研发资本化、订单、许可收入、门诊量独立观察；没有未经核验的目标价、PE或“质优低估”标签。所有阈值是V1研究假设，尚未做收益回测。机构观点不能替代临床管线、支付价格、客户订单、审计及治理核验。

## 验证

```bash
python3 -m unittest discover -s 医疗健康/scripts -p 'test_*.py' -v
node 医疗健康/scripts/check_dashboard.cjs
```

浏览器验证依赖Playwright与Chromium，可用 `CHROME_PATH`、`HEALTHCARE_URL`、`HEALTHCARE_SCREENSHOTS` 配置。检查桌面1440×1000及手机390×844四页、图表非空像素、文档溢出、搜索筛选、排序、缺失状态、两公司对照、CSV及图表弹窗。

后续优先迭代：补齐其余公司附注、成熟医院/门店与订单数据；扩充五年财务评分；完善租赁现金支出口径；建立统一交易日估值快照；再做评分锚点校准与历史检验。
