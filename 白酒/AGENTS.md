# 财务知识库维护

当用户在本项目询问某公司的财务指标、异常波动、报表口径或相关历史操作，并形成有依据的解答时，把解答同步归档到 `dashboard/knowledge.json`。用户已经要求持续维护此知识库，不需要逐条再次确认。

- 先读取现有条目，优先更新同一问题，避免重复建立。
- 每条记录明确 `company`、`metrics`、`kind`、`periods` 和 `reference_periods`。财务指标使用 `dashboard/data.json` 的 `financial_metrics.metrics` 键。
- `periods` 只表示结论适用的报告期，使用季度末 ISO 日期。年报例为 `2025-12-31`；半年累计例为 `2026-06-30`。历史比较年份放在 `reference_periods`，不能把旧年度事实改名成最新年度事实。
- 通用概念使用 `kind=general`、`periods=[]`；某公司某期的事实使用 `kind=report`。适用全部公司时 `company=""`。
- 分别填写原文事实与拆解 `answer`、分析推断 `inference`、边界与待跟踪 `caveats`。不得把推断写成公告已确认的事实。
- `status=verified` 必须有已登记的来源及具体核对页码。来源未核实时保留 `pending`，不得补造数据。新的 PDF 来源加入 `sources`，`path` 相对于整个工作区，必须在工作区内。
- 更新条目时保留旧版本到 `history`，递增条目 `version` 以及文件 `revision`，更新时间使用亚洲上海时区。优先通过 `scripts/knowledge_store.py` 中的 `save_entry` 完成验证和版本保存；新增来源可使用正常文件编辑。
- 页面为 `dashboard/knowledge.html`；个股页面按所选公司、指标、适用报告期关联知识。非本期条目不作为本期解读展示，通用口径保留。
- 不记录隐藏推理、认证凭证或未经用户授权的其他聊天内容。知识库是可核对的财务解释，不是逐字聊天日志。
