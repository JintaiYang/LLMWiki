---
type: glossary
status: growing
company: 长鑫科技/长鑫存储（CXMT）
stock_code: 未上市
market: 科创板（拟上市，辅导备案中）
tags: [长鑫科技, CXMT, DRAM, 半导体, 术语表]
source_url: "www.cxmt.com"
evidence_level: low
updated: 2026-07-25
related: [长鑫业务地图, DRAM竞争格局, 长鑫护城河, DRAM先行指标, 长鑫来源索引]
next_action: "持续补充半导体工艺、设备与材料术语；为新增术语登记 Sxx"
---

# DRAM 与半导体术语表

## 一句话判断

> 本表收录 DRAM 与半导体研究中的常见术语及其定义，作为全库术语统一入口；定义基于行业通行用法，不涉及 CXMT 具体事实，证据等级为行业框架。

## 术语定义

### 产品与规格

| 术语 | 英文 | 定义 | 注意事项 |
|------|------|------|----------|
| DRAM | Dynamic Random Access Memory | 动态随机存取存储器，需定期刷新以保持数据 | 与 SRAM、NAND Flash 区分 |
| DDR | Double Data Rate SDRAM | 双倍数据速率同步 DRAM，按代际演进（DDR→DDR2→DDR3→DDR4→DDR5） | 代际间不兼容 |
| LPDDR | Low Power DDR | 低功耗版 DDR，面向移动终端与低功耗场景 | 与标准 DDR 用途与规格不同 |
| HBM | High Bandwidth Memory | 高带宽存储，通过 TSV 三维堆叠实现高带宽低功耗 | 主要用于 AI/高性能计算 |
| Bit | — | 存储容量的基本单位；1 GB = 8 Gbit | 区分 Byte 与 Bit |
| 密度 / 容量 | Density / Capacity | 单颗芯片或模组的存储容量 | 不同代际与规格密度不同 |

### 制造与工艺

| 术语 | 英文 | 定义 | 注意事项 |
|------|------|------|----------|
| 晶圆 | Wafer | 用于制造集成电路的圆形硅片，常用 12 英寸（300mm） | 区分晶圆尺寸 |
| wafer starts | Wafer Starts | 每月投片量，折合 12 英寸等效晶圆 | 区分建成产能与实际投片 |
| 制程节点 | Process Node | 工艺代号（如 1x/1y/1z/1α/1β、17nm 等） | 节点命名 ≠ 实际物理尺寸 |
| 良率 | Yield | 合格品 / 投片数 | 区分 wafer 良率、die 良率、最终测试良率 |
| Bit 产出 | Bit Output | wafer starts × die 数 × 良率 | 与产能、良率强相关 |
| 利用率 | Utilization Rate | 实际投片 / 最大投片 | 不单独决定产出 |
| 光刻 | Lithography | 将电路图形转移到晶圆的关键工艺步骤 | EUV vs DUV 影响制程能力 |
| 刻蚀 | Etching | 去除指定区域材料的工艺 | 干法刻蚀为主流 |
| 沉积 | Deposition | 在晶圆表面沉积薄膜材料的工艺 | CVD / PVD / ALD 等 |
| 离子注入 | Ion Implantation | 向晶圆注入掺杂离子以改变电学特性 | — |
| 清洗 | Cleaning | 去除晶圆表面污染物的工艺 | — |
| 量测 | Metrology / Inspection | 检测晶圆与器件尺寸、缺陷的工艺 | — |

### 封装与测试

| 术语 | 英文 | 定义 | 注意事项 |
|------|------|------|----------|
| 封装 | Packaging | 将晶圆切割后的 die 封装为可使用芯片的过程 | 不同封装形式影响性能与成本 |
| 成品测试 | Final Test | 封装后对芯片进行功能与性能测试 | — |
| TSV | Through Silicon Via | 硅通孔，用于 HBM 等三维堆叠 | — |

### 财务与经营

| 术语 | 英文 | 定义 | 注意事项 |
|------|------|------|----------|
| CapEx | Capital Expenditure | 资本开支，设备 + 厂房 + 其他长期资产 | 区分维持性 vs 增量；区分人民币/美元口径 |
| 折旧 | Depreciation | 晶圆厂与设备按期摊销 | 折旧周期与产能爬坡可能错配 |
| OCF | Operating Cash Flow | 经营活动现金流 | — |
| FCF | Free Cash Flow | OCF − CapEx | 半导体行业 FCF 常为负（扩产期） |
| Bit 需求增速 | Bit Demand Growth | 全行业 DRAM Bit 消耗同比增速 | 不同终端增速差异大 |
| Bit 供给增速 | Bit Supply Growth | 全行业 DRAM Bit 产出同比增速 | 受产能、良率、制程迁移共同影响 |

### 客户与市场

| 术语 | 英文 | 定义 | 注意事项 |
|------|------|------|----------|
| 客户认证 | Customer Qualification | 客户验证产品符合其规格要求的过程 | 区分送样、测试/认证、量产导入三阶段 |
| OEM | Original Equipment Manufacturer | 原始设备制造商（如服务器厂商、手机厂商） | — |
| 模组厂 | Module Maker | 将 DRAM 芯片组装为内存模组的厂商 | — |
| 合约价 | Contract Price | OEM / 大客户按季度或月度锁定的采购价格 | 不反映现货波动 |
| 现货价 | Spot Price | 渠道市场即时交易价格 | 波动大，不等于公司实际售价 |

### 政策与出口管制

| 术语 | 英文 | 定义 | 注意事项 |
|------|------|------|----------|
| BIS | Bureau of Industry and Security | 美国商务部工业与安全局，负责出口管制 | 实体清单与规则更新需原文追踪 |
| 实体清单 | Entity List | BIS 发布的限制出口对象清单 | 被列入后获取美国原产技术/产品受限 |
| ASML | — | 荷兰光刻设备制造商 | 出口许可受荷兰政府与美国管制影响 |
| METI | Ministry of Economy, Trade and Industry | 日本经济产业省，负责日本出口管制 | — |

## 推断

| 推断 | 依据 | 证据等级 | 失效条件 |
|------|------|----------|----------|
| 统一术语口径是后续研究页面可比性的前提 | 知识库方法论 | low | 无（方法论推断） |

## 关联页面

- [[长鑫业务地图]]
- [[DRAM竞争格局]]
- [[长鑫护城河]]
- [[DRAM先行指标]]
- [[长鑫来源索引]]
- [[长鑫跟踪器]]
- [[长鑫风险地图]]

## 待验证

- [ ] 补充 CXMT 官方使用的节点命名定义（若有）。
- [ ] 补充 CXMT 特有或内部使用的工艺代号（若有公开资料）。
- [ ] 持续追踪出口管制相关术语与清单变化。

## 下一步

1. 随研究深入持续补充术语（如 HBM4、EUV、GAA 等新技术术语）。
2. 若 CXMT 官方资料中出现特有命名，登记为 `Sxx` 并在本表注明出处。
3. 与 [[DRAM先行指标]] 和 [[长鑫跟踪器]] 的口径保持同步。
