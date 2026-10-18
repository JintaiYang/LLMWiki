# 中概互联网研究台 V1

首批研究腾讯、阿里、拼多多、京东、美团、网易、携程、百度、快手、哔哩哔哩、腾讯音乐。对齐白酒与银行看板的行业总览、公司对比、个股深度、评分方法，并增加数据来源审计。

## 启动

在本目录运行 `python3 scripts/serve.py --port 8781`，打开 <http://127.0.0.1:8781/dashboard/>。服务器只监听本机。图表和图标使用本地 Chart.js、Lucide；无需外部 CDN。

## 数据更新

```bash
python3 scripts/collect_akshare.py
python3 scripts/collect_akshare.py --codes PDD --kinds indicators,income,balance,cashflow --us-interim
python3 scripts/build_data.py
node scripts/check_model.js
```

采集依赖本机 `akshare`、`pandas`、`requests`。当前采集快照截至2026-10-18，价格截止2026-10-16，采集脚本日期参数目前固定于该快照。升级日期前需同时修改期间上限和行情日期，并重新核验发布日。采集失败保留旧缓存，在 `data/akshare/run.json` 追加尝试记录，不静默改用iFinD。

逐项顺序：AKShare → 官方财报PDF → iFinD。补充项在 `data/supplements.json` 保存数值、单位、来源、回退原因。构建时仅填原始缺项，不覆盖AKShare已有字段。原始JSON在 `data/akshare/`，官方PDF在 `data/pdf/`，此前iFinD查询在 `data/reference/`，未使用的查询仅作核对底稿。

## 评分与口径

六维100分：增长20、盈利质量20、现金创造25、投入纪律15、财务韧性10、股东回报10。实际规则见 `dashboard/model.js` 与网页“评分方法”。公开逐项权重、阈值和线性插值，支持本机自定义权重并恢复默认。缺项不填零，指标覆盖率低于80%不生成总分。分数为自建研究假设，尚未做历史回测；不能作为投资评级。

完整FY评分与最新中期分开。阿里FY按实际4月至次年3月结算；自然年筛选不自动替换成另一期间。统一代理FCF=CFO−现金购建资产，不等于公司披露FCF或企业价值口径FCFF；缺少现金购建资产明细时不强行计算。各指标保留证据和计算依赖。ROIC采用供应商年化字段，SBC与摊薄股数缺项保留。

当前11家公司均有至少三个完整年度、2026中期及AKShare行情。首版快手2024/2025资本开支通过iFinD补缺，其余可用基础财务来自AKShare；腾讯2026中期SBC及摊薄股数来自官方PDF。仍缺部分SBC、摊薄、分部UE、实际回购注销、业务经营量价与公司披露FCF桥接。财务人民币与行情港元/美元分开，首版估值页提供PE、DCF、SOTP框架，暂不计算目标价和FCF收益率。

## 验证

`node scripts/check_model.js` 验证财年、来源文件、FCF公式、有效零值/亏损/缺项和自定义权重。浏览器检查使用Playwright：

```bash
node scripts/check_browser.js
```

Playwright不在默认Node模块目录时可设置 `PLAYWRIGHT_MODULE` 为包路径；浏览器可通过 `CHROME_PATH` 指定。检查1440px/390px全部视图、图表像素、筛选排序、四家公司对比、观察名单持久化、路由、权重和下载。截图默认输出到 `/tmp/internet-dashboard-qa/`。

研究依据与设计见网页“数据与来源”、`data/research.json` 及仓库 `docs/superpowers/specs/2026-10-18-china-internet-dashboard-design.md`。
