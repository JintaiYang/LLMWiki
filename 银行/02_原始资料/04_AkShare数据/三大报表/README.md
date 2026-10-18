# A股银行三大报表（近20年全报告期）

> 数据源：AkShare 东方财富「按报告期」接口（参考 [AkShare 教程](https://akshare.akfamily.xyz/tutorial.html)）
> 采集脚本：`scripts/fetch_bank_statements_full.py`（断点续传，可 `--force` 全量重采）
> 覆盖范围：A股全部 42 家上市银行 × 三张报表 × 近20年全部报告期（2006-01-01 起，含一季报/中报/三季报/年报）
> 金额单位：**元**（人民币）；`_YOY` 后缀列 = 同比增速（%）

## 目录结构

```
三大报表/
├── 利润表/          {code}_{name}_income.csv     每家银行一份（~170列）
├── 资产负债表/      {code}_{name}_balance.csv    每家银行一份（~220列）
├── 现金流量表/      {code}_{name}_cashflow.csv   每家银行一份（~310列）
├── 合并_利润表_all_banks.csv        42家银行拼接（跨行对比用）
├── 合并_资产负债表_all_banks.csv
├── 合并_现金流量表_all_banks.csv
├── _银行清单.csv                    本次采集清单
└── README.md                        本文件（数据字典）
```

每份文件按 `REPORT_DATE` 升序；脚本自动添加 `银行代码`、`银行名称` 两列前缀；
同一报告日期重复时保留最后一条（最新披露口径）。

## 通用字段

| 字段 | 含义 |
|------|------|
| 银行代码 / 银行名称 | 脚本添加的银行标识 |
| SECUCODE / SECURITY_CODE / SECURITY_NAME_ABBR | 证券代码（带后缀）/ 代码 / 简称 |
| REPORT_DATE | 报告期期末日（YYYY-MM-DD）：03-31 一季报、06-30 中报、09-30 三季报、12-31 年报 |
| REPORT_TYPE | 报告类型：一季报 / 中报 / 三季报 / 年报 |
| NOTICE_DATE / UPDATE_DATE | 公告日期 / 数据更新日期 |
| CURRENCY | 币种（CNY） |
| OPINION_TYPE / OSOPINION_TYPE | 审计意见类型 |

**重要口径提示**：一季报/中报/三季报的利润表与现金流量表为**年初至报告期末累计值**（非单季值）；资产负债表为期末时点值。早年部分银行一季报不单独披露现金流量表，属正常缺失。

## 利润表关键科目（stock_profit_sheet_by_report_em）

| 字段 | 含义 |
|------|------|
| OPERATE_INCOME | 营业收入（银行口径 = 利息净收入 + 手续费及佣金净收入 + 其他） |
| INTEREST_NI | 利息净收入（银行核心科目） |
| INTEREST_INCOME / INTEREST_EXPENSE | 利息收入 / 利息支出 |
| FEE_COMMISSION_NI | 手续费及佣金净收入 |
| FEE_COMMISSION_INCOME / FEE_COMMISSION_EXPENSE | 手续费及佣金收入 / 支出 |
| INVEST_INCOME | 投资收益 |
| FAIRVALUE_CHANGE_INCOME | 公允价值变动收益 |
| EXCHANGE_INCOME | 汇兑收益 |
| OPERATE_EXPENSE | 营业支出 |
| OPERATE_TAX_ADD | 税金及附加 |
| BUSINESS_MANAGE_EXPENSE | 业务及管理费 |
| CREDIT_IMPAIRMENT_LOSS | 信用减值损失（拨备计提，银行核心科目） |
| ASSET_IMPAIRMENT_LOSS | 资产减值损失 |
| OPERATE_PROFIT | 营业利润 |
| TOTAL_PROFIT | 利润总额 |
| INCOME_TAX | 所得税费用 |
| NETPROFIT | 净利润（含少数股东） |
| PARENT_NETPROFIT | 归属于母公司股东的净利润 |
| DEDUCT_PARENT_NETPROFIT | 扣非归母净利润 |
| MINORITY_INTEREST | 少数股东损益 |
| BASIC_EPS / DILUTED_EPS | 基本 / 稀释每股收益 |
| TOTAL_COMPRE_INCOME / PARENT_TCI | 综合收益总额 / 归母综合收益总额 |

## 资产负债表关键科目（stock_balance_sheet_by_report_em）

| 字段 | 含义 |
|------|------|
| CASH_DEPOSIT_PBC | 存放中央银行款项 |
| DEPOSIT_INTERBANK | 存放同业款项 |
| LEND_FUND | 拆出资金 |
| FVTPL_FINASSET | 以公允价值计量且变动计入当期损益的金融资产 |
| TRADE_FINASSET | 交易性金融资产（部分银行并入 FVTPL） |
| DERIVE_FINASSET | 衍生金融资产 |
| BUY_RESALE_FINASSET | 买入返售金融资产 |
| LOAN_ADVANCE | **发放贷款及垫款**（对公+零售贷款总额，含贴现） |
| CREDITOR_INVEST / OTHER_CREDITOR_INVEST | 债权投资 / 其他债权投资（新金融工具准则） |
| AMORTIZE_COST_FINASSET | 以摊余成本计量的金融资产（AC） |
| FVTOCI_FINASSET | 以公允价值计量且变动计入其他综合收益的金融资产（FVOCI） |
| AVAILABLE_SALE_FINASSET | 可供出售金融资产（旧准则，2019年前） |
| HOLD_MATURITY_INVEST | 持有至到期投资（旧准则） |
| INVEST_RECE | 应收款项类投资（旧准则） |
| FIXED_ASSET / USERIGHT_ASSET / INTANGIBLE_ASSET / GOODWILL | 固定资产 / 使用权资产 / 无形资产 / 商誉 |
| DEFER_TAX_ASSET | 递延所得税资产 |
| TOTAL_ASSETS | **资产总计** |
| LOAN_PBC | 向中央银行借款 |
| IOFI_DEPOSIT | 同业及其他金融机构存放款项 |
| ACCEPT_DEPOSIT | **吸收存款（客户存款）** |
| SELL_REPO_FINASSET | 卖出回购金融资产款 |
| DEPOSIT_CERTIFICATE / CD_NOTE_PAYABLE | 存款凭证（大额存单等）/ 应付票据 |
| INTEREST_PAYABLE | 应付利息 |
| BOND_PAYABLE / SUBBOND_PAYABLE | 应付债券 / 应付次级债券 |
| TOTAL_LIABILITIES | 负债合计 |
| SHARE_CAPITAL | 实收资本（股本） |
| OTHER_EQUITY_TOOL / PREFERRED_SHARES / PERPETUAL_BOND | 其他权益工具 / 优先股 / 永续债 |
| CAPITAL_RESERVE / SURPLUS_RESERVE / GENERAL_RISK_RESERVE | 资本公积 / 盈余公积 / 一般风险准备 |
| UNASSIGN_RPOFIT | 未分配利润 |
| TOTAL_PARENT_EQUITY | 归属于母公司股东权益 |
| MINORITY_EQUITY / TOTAL_EQUITY | 少数股东权益 / 所有者权益合计 |
| TOTAL_LIAB_EQUITY | 负债和所有者权益总计 |
| AGENT_BUSINESS_ASSET / AGENT_BUSINESS_LIAB | 代理资产 / 代理负债（表外，银行） |

## 现金流量表关键科目（stock_cash_flow_sheet_by_report_em）

| 字段 | 含义 |
|------|------|
| CUSTOMER_DEPOSIT_ADD | 客户存款和同业存放款项净增加额 |
| IOFI_ADD / DEPOSIT_IOFI_ADD | 同业存放 / 拆入款项净增加额 |
| LOAN_ADVANCE_ADD | 客户贷款及垫款净增加额 |
| RECEIVE_INTEREST_COMMISSION | 收到的利息、手续费及佣金的现金 |
| PAY_INTEREST_COMMISSION | 支付的利息、手续费及佣金的现金 |
| TOTAL_OPERATE_INFLOW / TOTAL_OPERATE_OUTFLOW | 经营活动现金流入 / 流出小计 |
| NETCASH_OPERATE | **经营活动产生的现金流量净额** |
| WITHDRAW_INVEST | 收回投资收到的现金 |
| TOTAL_INVEST_INFLOW / TOTAL_INVEST_OUTFLOW | 投资活动现金流入 / 流出小计 |
| NETCASH_INVEST | **投资活动产生的现金流量净额** |
| ISSUE_BOND / ISSUE_CD | 发行债券 / 发行存款凭证收到的现金 |
| ASSIGN_DIVIDEND_PORFIT | 分配股利、利润或偿付利息支付的现金 |
| NETCASH_FINANCE | **筹资活动产生的现金流量净额** |
| CCE_ADD | 现金及现金等价物净增加额 |
| END_CCE / BEGIN_CCE | 期末 / 期初现金及现金等价物余额 |
| PROVISION_LOAN_IMPAIRMENT | 贷款减值准备（间接法调节项） |
| FIXED_ASSET_DEPR | 固定资产折旧（间接法调节项） |

## 已知边界

1. **监管指标不在三大报表内**：不良率、拨备覆盖率、拨贷比、净息差 NIM、核心一级资本充足率等属年报「经营情况讨论与分析」专项披露，本数据不含（见 `深度采集/` 的专项数据）。
2. **准则切换**：2019年起 A 股执行新金融工具准则（I9），金融资产科目由四分类（贷款及应收款/持有至到期/可供出售/交易性）变为三分类（AC/FVOCI/FVTPL），跨期对比需注意口径衔接；2021年起执行新租赁准则（使用权资产/租赁负债）。
3. **银行 vs 一般企业模板**：东方财富采用统一模板，一般企业科目（存货、应收账款等）在银行数据中为空值属正常；银行专项科目（利息净收入、吸收存款等）已在上表列出。
4. **次新银行**：上市不足20年的银行（如兰州银行 2022 年上市）仅有上市后报告期数据；A股银行多数于 2006-2010 年间上市，2006 年前仅有招行、浦发、民生、华夏、深发展（现平安）等少数标的。注：东方财富对部分银行补充了**上市前招股书报告期数据**（如江苏银行 2006 年起、邮储银行 2010 年起）。
5. **一季报现金流量表**：早年（约2006-2010）部分银行一季报未单独披露现金流量表，该期缺失属正常。
6. **个别早期数据口径瑕疵**（全量2579行资产负债表中仅1行）：中国银行 2006-09-30 三季报 `TOTAL_ASSETS` 与负债+权益差 7%（该期为中行 A 股上市后首份季报，披露口径问题）。使用该行数据时建议以负债+权益倒推核对。
7. **上市前数据跨源差异**：江苏银行 2007-12-31（招股书期）归母净利润，东方财富口径 8.38 亿 vs 新浪（财务摘要源）14.77 亿，属第三方对招股书历史数据整理口径不一致；上市后（2016 起）两源完全一致。

## 数据质量验证记录（2026-09-07 采集时点）

| 验证项 | 结果 |
|------|------|
| 文件完整性 | 3 × 42 份个股报表 + 3 份合并表，全部生成，0 失败 |
| 报告期覆盖 | 2006-03-31 ~ 2026-06-30；42/42 家均含最新 2026 中报 |
| 报告类型分布（利润表） | 年报 810 / 中报 667 / 一季报 590 / 三季报 583 |
| 会计恒等式：资产=负债+权益 | 98.4% 行误差 < 0.1%（唯一例外见已知边界第 6 条） |
| 净利润=归母+少数股东 | 100% 成立 |
| 与财务摘要（新浪源）交叉验证 | 招行/工行/农行 20 个年报偏差 0.00%；宁波 0.03%；常熟 0.10%；江苏银行仅 2007 上市前期异常（见已知边界第 7 条） |
| 关键值抽查 | 招行 2025 归母净利润 1501.8 亿、工行 3685.6 亿、招行 2025 末总资产 13.07 万亿 / 客户存款 9.92 万亿，均与年报一致 |

## 运行记录

采集元数据（逐银行逐报表的行数、报告期范围、状态）见：
`../数据字典与运行记录/run_meta_statements_full_latest.json`
