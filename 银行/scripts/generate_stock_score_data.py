#!/usr/bin/env python3
"""银行公司打分引擎 —— 按《银行综合价值打分公式 V2.0》计算42家银行全部历史报告期得分.

公司总分 100 = A 收入效率15 + B 收入增长10 + C 盈利质量30
             + D 资产质量15 + E 成本控制15 + F 资本内生15
估值 G、定性 H 只评价/观测，不计入总分。缺项不填 50%，维度按可得满分重标。

数据源（均为本地已采集数据）:
  1. 02_原始资料/04_AkShare数据/三大报表/           利润表/资产负债表/现金流量表
  2. 02_原始资料/05_iFind数据/银行专项指标/          不良率/拨备覆盖率/CET1/NIM/关注类/活期/个人存款/计息负债成本率
  3. 02_原始资料/04_AkShare数据/分红/分红历史/        每10股派现记录（F3/G2）
  4. dashboard/stock_data/<code>.json                估值历史（PB/收盘价，G 评价）
  5. scripts/g_qualitative_scores.json               H 定性观测（不进总分）

V2.0 相对 V1.2:
  - 只对公司打分；估值、定性退出总分
  - 六维：收入效率 / 收入增长 / 盈利质量 / 资产质量 / 成本控制 / 资本内生
  - 资产质量存量 6 + 前瞻 9；前瞻三项无真值时用代理并标 proxy
  - 拨备充足按 1.67% 规则盯拨贷比或覆盖率；营收增速相对当年中位数

用法: python3 scripts/generate_stock_score_data.py [--banks 600036] [--check] [--eval-only] [--scale-only]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

warnings.filterwarnings("ignore")

VAULT_ROOT = Path(__file__).resolve().parents[1]
AK_DIR = VAULT_ROOT / "02_原始资料" / "04_AkShare数据"
STMT_DIR = AK_DIR / "三大报表"
IFIND_DIR = VAULT_ROOT / "02_原始资料" / "05_iFind数据" / "银行专项指标"
NOTES_DIR = VAULT_ROOT / "02_原始资料" / "05_iFind数据" / "利息与非息附注"
DIV_DIR = AK_DIR / "分红" / "分红历史"
STOCK_DATA_DIR = VAULT_ROOT / "dashboard" / "stock_data"
UNIVERSE_CSV = AK_DIR / "数据字典与运行记录" / "a_share_banks_universe.csv"

YI = 1e8  # 亿

# ============ 打分公式 V2.0 阈值 ============
# (满分, 满分线x1, 零分线x0, 方向)  方向 True=正向(越大越好)
ITEMS: Dict[str, Dict[str, Any]] = {
    # A 收入效率 15
    "A1": {"name": "NIM净息差", "full": 10, "x1": 1.90, "x0": 1.15, "up": True, "unit": "%"},
    "A2": {"name": "非息收入占比", "full": 5, "x1": 35.0, "x0": 10.0, "up": True, "unit": "%"},
    # B 收入增长 10
    "B1": {"name": "营收增速(相对中位数)", "full": 7, "x1": 10.0, "x0": -5.0, "up": True, "unit": "%",
           "relative_median": "rev_cagr3", "band": 8.0},
    "B2": {"name": "归母净利润增速", "full": 3, "x1": 10.0, "x0": -5.0, "up": True, "unit": "%"},
    # C 盈利质量 30
    "C1": {"name": "加权ROE", "full": 7, "x1": 15.0, "x0": 6.0, "up": True, "unit": "%"},
    "C2": {"name": "ROA", "full": 3, "x1": 1.15, "x0": 0.40, "up": True, "unit": "%"},
    "C3": {"name": "净利/PPOP", "full": 2, "x1": 0.55, "x0": 1.05, "up": False, "unit": "x"},
    "C4": {"name": "拨备充足", "full": 10, "x1": 3.50, "x0": 2.00, "up": True, "unit": "%",
           "special": "prov_adequacy"},
    "C5": {"name": "拨备变动趋势", "full": 8, "x1": 15.0, "x0": -40.0, "up": True, "unit": "bp",
           "special": "prov_trend"},
    # D 资产质量 15（存量 6 + 前瞻 9）
    "D1": {"name": "不良贷款率", "full": 4, "x1": 0.70, "x0": 1.80, "up": False, "unit": "%"},
    "D2": {"name": "关注类贷款比例", "full": 2, "x1": 1.00, "x0": 3.50, "up": False, "unit": "%"},
    "D3": {"name": "关注类迁徙(代理:关注同比)", "full": 4, "x1": -20.0, "x0": 50.0, "up": False, "unit": "bp",
           "proxy": True},
    "D4": {"name": "不良偏离(代理:关注/不良)", "full": 3, "x1": 1.20, "x0": 3.50, "up": False, "unit": "x",
           "proxy": True},
    "D5": {"name": "不良生成(代理:不良余额同比)", "full": 2, "x1": -5.0, "x0": 20.0, "up": False, "unit": "%",
           "proxy": True},
    # E 成本控制 15
    "E1": {"name": "成本收入比CIR", "full": 5, "x1": 24.0, "x0": 40.0, "up": False, "unit": "%"},
    "E2": {"name": "存款成本率", "full": 5, "x1": 1.20, "x0": 1.95, "up": False, "unit": "%"},
    "E3": {"name": "信用成本率", "full": 5, "x1": 0.50, "x0": 1.50, "up": False, "unit": "%"},
    # F 资本内生 15
    "F1": {"name": "CET1核心一级资本充足率", "full": 6, "x1": 12.0, "x0": 7.5, "up": True, "unit": "%"},
    "F2": {"name": "RWA/总资产(风险密度)", "full": 4, "x1": 55.0, "x0": 75.0, "up": False, "unit": "%"},
    "F3": {"name": "现金分红率", "full": 3, "x1": 33.0, "x0": 20.0, "up": True, "unit": "%"},
    "F4": {"name": "近5年摊薄性再融资", "full": 2, "x1": 0.0, "x0": 1.0, "up": False, "unit": "bool"},
    # G 估值评价（不进总分）
    "G1": {"name": "隐含回报ROE/PB", "full": 5, "x1": 20.0, "x0": 10.0, "up": True, "unit": "%",
           "in_total": False},
    "G2": {"name": "股息率", "full": 5, "x1": 5.5, "x0": 2.8, "up": True, "unit": "%",
           "in_total": False},
}

DIMENSIONS: Dict[str, Dict[str, Any]] = {
    "A": {"name": "收入效率", "full": 15, "items": ["A1", "A2"],
          "question": "定价权与收入结构", "in_total": True},
    "B": {"name": "收入增长", "full": 10, "items": ["B1", "B2"],
          "question": "相对同业是否在长", "in_total": True},
    "C": {"name": "盈利质量", "full": 30, "items": ["C1", "C2", "C3", "C4", "C5"],
          "question": "回报真不真、拨备有没有水分", "in_total": True},
    "D": {"name": "资产质量", "full": 15, "items": ["D1", "D2", "D3", "D4", "D5"],
          "question": "存量干净吗、未来还会烂吗", "in_total": True},
    "E": {"name": "成本控制", "full": 15, "items": ["E1", "E2", "E3"],
          "question": "运营、负债与风险定价", "in_total": True},
    "F": {"name": "资本内生", "full": 15, "items": ["F1", "F2", "F3", "F4"],
          "question": "增长的天花板在哪", "in_total": True},
    "G": {"name": "估值评价", "full": 10, "items": ["G1", "G2"],
          "question": "好银行是不是好股票", "in_total": False},
}

DIMS_IN_TOTAL = [k for k, v in DIMENSIONS.items() if v.get("in_total", True)]
FORMULA_VERSION = "V2.0-2026-09-15"

SKIP_ITEMS = {k for k, v in ITEMS.items() if v.get("skip")}

# F1 零分线 = 7.5% + 附加资本（G-SIB/D-SIB，百分点）
CET1_ADDON: Dict[str, float] = {
    "601398": 1.5, "601288": 1.5, "601988": 1.5, "601939": 1.5,  # 工农中建 G-SIB
    "601328": 1.0,   # 交通
    "601658": 0.75,  # 邮储
    "600036": 0.75,  # 招行
    "601166": 0.50, "600000": 0.50, "601998": 0.50, "600016": 0.50,
    "601818": 0.50, "000001": 0.50, "601169": 0.50, "600015": 0.50,
    "601229": 0.50,
    "002142": 0.25, "600919": 0.25, "600926": 0.25,
}

WHOLESALE_SPREAD_PCT = 0.80
C4_NO_DOUBLE_CET1 = 10.5
G_APPLY_FROM_YEAR = 2022
ANCHOR_YEAR = 2025
NPL_WATCH_CUTOFF = 1.67  # 唐朝 1.67% 规则：低于盯拨贷比，否则盯覆盖率
CYCLE_ITEMS = {"A1": "nim", "D1": "npl", "E2": "dep_cost"}
GROWTH_MEDIAN_COL = "rev_cagr3"
KEY_ITEMS_FOR_RANK = ("A1", "D1", "F1")  # NIM/不良/CET1 缺失则不参与排序


def load_g_scores() -> Dict[str, Dict[str, Any]]:
    p = Path(__file__).resolve().parent / "g_qualitative_scores.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    return data.get("scores") or {}


def cet1_x0(code: str) -> float:
    return 7.5 + CET1_ADDON.get(code, 0.0)


def clip(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def linear_score(x: float, x1: float, x0: float, up: bool) -> float:
    """公式 §3.2 线性插值（0-1）。"""
    if up:
        return clip((x - x0) / (x1 - x0))
    return clip((x0 - x) / (x0 - x1))


def grade_of(total: float) -> str:
    """公式 §3.5 等级划分（仅六维公司分；估值与定性不进总分）。"""
    if total >= 85:
        return "A+"
    if total >= 75:
        return "A"
    if total >= 60:
        return "B"
    if total >= 45:
        return "C"
    return "D"


# ============ 数据加载 ============

class BankData:
    """单家银行的全部历史数据（三大报表 + iFind指标 + 分红 + 估值）。"""

    def __init__(self, code: str, name: str):
        self.code, self.name = code, name
        self.income: Optional[pd.DataFrame] = None      # 利润表（元）
        self.balance: Optional[pd.DataFrame] = None     # 资产负债表（元）
        self.cashflow: Optional[pd.DataFrame] = None    # 现金流量表（元）
        self.ifind: Optional[pd.DataFrame] = None       # iFind 专项指标
        self.notes: Optional[pd.DataFrame] = None       # 年报附注：利息拆项 / 存款四分
        self.dividend: Optional[pd.DataFrame] = None    # 分红历史
        self.stock_json: Optional[dict] = None          # 估值历史（stock_data）

    def load(self) -> "BankData":
        for attr, sub, key in (("income", "利润表", "income"), ("balance", "资产负债表", "balance"),
                               ("cashflow", "现金流量表", "cashflow")):
            p = STMT_DIR / sub / f"{self.code}_{self.name}_{key}.csv"
            if p.exists():
                setattr(self, attr, pd.read_csv(p, dtype={"银行代码": str}))
        p = IFIND_DIR / f"{self.code}_{self.name}_indicators.csv"
        if p.exists():
            self.ifind = pd.read_csv(p)
        p = NOTES_DIR / f"{self.code}_{self.name}_notes.csv"
        if p.exists():
            self.notes = pd.read_csv(p, dtype={"code": str})
        p = DIV_DIR / f"{self.code}_{self.name}_dividend_history.csv"
        if p.exists():
            self.dividend = pd.read_csv(p)
        p = STOCK_DATA_DIR / f"{self.code}.json"
        if p.exists():
            self.stock_json = json.loads(p.read_text(encoding="utf-8"))
        return self

    # ---- 报告期序列工具 ----

    def report_dates(self, source: str = "income") -> List[str]:
        df = getattr(self, source)
        return [] if df is None else [str(x) for x in df["REPORT_DATE"].tolist()]

    def row_by_date(self, source: str, report_date: str) -> Optional[pd.Series]:
        df = getattr(self, source)
        if df is None:
            return None
        hit = df[df["REPORT_DATE"] == report_date]
        return hit.iloc[0] if len(hit) else None

    def num(self, source: str, report_date: str, col: str) -> Optional[float]:
        row = self.row_by_date(source, report_date)
        if row is None or col not in row.index:
            return None
        v = row[col]
        if pd.isna(v):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None


# ============ 指标计算 ============

def calc_metrics(bd: BankData) -> pd.DataFrame:
    """对每个报告期计算全部打分项原始值 -> DataFrame(index=report_date)。"""
    dates = bd.report_dates("balance") or bd.report_dates("income")
    rows = []
    last_annual: Dict[str, Optional[float]] = {}  # 上一个"年报期"的快照

    for rd in dates:
        year = int(rd[:4])
        r: Dict[str, Optional[float]] = {"report_date": rd, "year": year}

        # ---- 利润表（累计口径；单位: 元）----
        inc = lambda col: bd.num("income", rd, col)  # noqa: E731
        r["revenue"] = inc("OPERATE_INCOME")
        r["net_profit"] = inc("PARENT_NETPROFIT") or inc("NETPROFIT")
        r["int_ni"] = inc("INTEREST_NI")
        r["fee_ni"] = inc("FEE_COMMISSION_NI")
        r["opex_mgmt"] = inc("BUSINESS_MANAGE_EXPENSE")
        r["credit_impair"] = inc("CREDIT_IMPAIRMENT_LOSS") or inc("ASSET_IMPAIRMENT_LOSS")

        # ---- 资产负债表（时点；单位: 元）----
        bal = lambda col: bd.num("balance", rd, col)  # noqa: E731
        r["total_assets"] = bal("TOTAL_ASSETS")
        r["loans"] = bal("LOAN_ADVANCE")
        r["deposits"] = bal("ACCEPT_DEPOSIT")
        r["parent_equity"] = bal("TOTAL_PARENT_EQUITY") or bal("TOTAL_EQUITY")
        r["total_equity"] = bal("TOTAL_EQUITY")
        r["total_liab"] = bal("TOTAL_LIABILITIES")
        r["interbank_liab"] = None
        for col in ("IOFI_DEPOSIT", "BORROW_FUND", "SELL_REPO_FINASSET"):
            v = bal(col)
            if v is not None:
                r["interbank_liab"] = (r["interbank_liab"] or 0) + v
        ncd = bal("CD_NOTE_PAYABLE")
        if ncd is None:
            ncd = bal("DEPOSIT_CERTIFICATE")
        r["ncd"] = ncd
        r["bond_payable"] = bal("BOND_PAYABLE")
        r["loan_pbc"] = bal("LOAN_PBC")
        # 金融投资 / 同业 / 现金（对齐招行年报 §3.3.1）
        r["fin_invest_ac"] = bal("AMORTIZE_COST_FINASSET")
        if r["fin_invest_ac"] is None:
            acc = None
            for col in ("HOLD_MATURITY_INVEST", "INVEST_RECE", "CREDITOR_INVEST"):
                v = bal(col)
                if v is not None:
                    acc = (acc or 0) + v
            r["fin_invest_ac"] = acc
        r["fin_invest_fvtpl"] = bal("FVTPL_FINASSET") or bal("TRADE_FINASSET")
        r["fin_invest_fvoci"] = bal("FVTOCI_FINASSET") or bal("AVAILABLE_SALE_FINASSET") or bal("OTHER_CREDITOR_INVEST")
        r["derive_asset"] = bal("DERIVE_FINASSET")
        r["long_equity"] = bal("LONG_EQUITY_INVEST")
        r["other_equity"] = bal("OTHER_EQUITY_INVEST")
        r["precious_metal"] = bal("PRECIOUS_METAL")
        r["cash_pbc"] = bal("CASH_DEPOSIT_PBC")
        r["deposit_interbank"] = bal("DEPOSIT_INTERBANK")
        r["lend_fund"] = bal("LEND_FUND")
        r["buy_resale"] = bal("BUY_RESALE_FINASSET")
        r["interbank_assets"] = None
        for col in ("DEPOSIT_INTERBANK", "LEND_FUND", "BUY_RESALE_FINASSET"):
            v = bal(col)
            if v is not None:
                r["interbank_assets"] = (r["interbank_assets"] or 0) + v
        r["goodwill"] = bal("GOODWILL")
        r["fixed_asset"] = bal("FIXED_ASSET")
        r["cip"] = bal("CIP")
        r["useright_asset"] = bal("USERIGHT_ASSET")
        r["intangible"] = bal("INTANGIBLE_ASSET")
        r["invest_realestate"] = bal("INVEST_REALESTATE")
        r["defer_tax_asset"] = bal("DEFER_TAX_ASSET")
        r["other_asset"] = bal("OTHER_ASSET")
        r["iofi_deposit"] = bal("IOFI_DEPOSIT")
        r["borrow_fund"] = bal("BORROW_FUND")
        r["sell_repo"] = bal("SELL_REPO_FINASSET")
        r["fvtpl_liab"] = bal("FVTPL_FINLIAB") or bal("TRADE_FINLIAB")
        r["derive_liab"] = bal("DERIVE_FINLIAB")
        r["staff_payable"] = bal("STAFF_SALARY_PAYABLE")
        r["tax_payable"] = bal("TAX_PAYABLE")
        r["predict_liab"] = bal("PREDICT_LIAB")
        r["defer_tax_liab"] = bal("DEFER_TAX_LIAB")
        r["lease_liab"] = bal("LEASE_LIAB")
        r["other_liab_item"] = bal("OTHER_LIAB")

        # ---- 利息收入/支出及非息拆项（利润表累计）----
        r["int_income"] = inc("INTEREST_INCOME")
        r["int_expense"] = inc("INTEREST_EXPENSE")
        r["fee_income"] = inc("FEE_COMMISSION_INCOME")
        r["fee_expense"] = inc("FEE_COMMISSION_EXPENSE")
        r["invest_income"] = inc("INVEST_INCOME")
        r["fv_income"] = inc("FAIRVALUE_CHANGE_INCOME")
        r["fx_income"] = inc("EXCHANGE_INCOME")
        r["other_biz_income"] = inc("OTHER_BUSINESS_INCOME")
        r["other_income"] = inc("OTHER_INCOME")
        r["asset_disposal"] = inc("ASSET_DISPOSAL_INCOME")

        NOTE_COLS = (
            "int_inc_loan", "int_inc_invest", "int_inc_pbc", "int_inc_interbank",
            "int_exp_corp_demand", "int_exp_corp_time", "int_exp_retail_demand", "int_exp_retail_time",
            "int_exp_deposit", "int_exp_interbank", "int_exp_bond", "int_exp_pbc",
            "dep_corp_demand", "dep_corp_time", "dep_retail_demand", "dep_retail_time",
        )
        for c in NOTE_COLS:
            r[c] = None
        if bd.notes is not None and "report_date" in bd.notes.columns:
            hit = bd.notes[bd.notes["report_date"].astype(str) == rd]
            if len(hit):
                h = hit.iloc[0]
                for c in NOTE_COLS:
                    v = h.get(c)
                    r[c] = float(v) if v is not None and pd.notna(v) else None

        # ---- iFind 专项 ----
        if bd.ifind is not None:
            hit = bd.ifind[bd.ifind["report_date"] == rd]
            if len(hit):
                h = hit.iloc[0]
                for src_col, dst_col in (("npl_ratio", "npl"), ("provision_coverage", "prov_cov"),
                                         ("cet1_ratio", "cet1"), ("nim", "nim"),
                                         ("special_mention_ratio", "special_mention"),
                                         ("interest_bearing_liab_cost", "ib_liab_cost"),
                                         ("cet1_capital", "cet1_capital")):
                    v = h.get(src_col)
                    r[dst_col] = float(v) if pd.notna(v) else None
                for src_col, dst_col in (("demand_deposits", "demand_dep"), ("personal_deposits", "personal_dep")):
                    v = h.get(src_col)
                    r[dst_col] = float(v) if pd.notna(v) else None  # 单位: 元

        # ---- 估值（stock_data json）----
        if bd.stock_json:
            rec = next((x for x in bd.stock_json.get("records", []) if x.get("report_date") == rd), None)
            if rec:
                r["roe_weighted"] = rec.get("roe")
                r["pb"] = rec.get("pb")
                r["close"] = rec.get("close")
                r["revenue_yoy"] = rec.get("revenue_cum_yoy")
                r["net_profit_yoy"] = rec.get("net_profit_cum_yoy")

        # ---- 派生指标 ----
        is_annual = rd[5:7] == "12"
        # ROA（年报期）：净利 / 平均总资产（用上一年报的期末值）
        if is_annual and r["net_profit"] and r["total_assets"] and last_annual.get("total_assets"):
            r["roa"] = r["net_profit"] / ((r["total_assets"] + last_annual["total_assets"]) / 2) * 100
        # 非息占比 = (营收 - 利息净收入) / 营收
        if r["revenue"] and r["int_ni"] is not None:
            r["nonint_ratio"] = (r["revenue"] - r["int_ni"]) / r["revenue"] * 100
        # CIR = 业务及管理费 / 营收
        if r["revenue"] and r["opex_mgmt"]:
            r["cir"] = r["opex_mgmt"] / r["revenue"] * 100
        # PPOP ≈ 营收 − 业务及管理费（E2 拨备反哺检验）
        if r["revenue"] is not None and r["opex_mgmt"] is not None:
            r["ppop"] = r["revenue"] - r["opex_mgmt"]
            if is_annual and last_annual.get("ppop") and last_annual["ppop"] != 0:
                r["ppop_yoy"] = (r["ppop"] / last_annual["ppop"] - 1) * 100
        # 信用成本率 = 信用减值 / 平均贷款（年报期，用上一年报期末值）
        if is_annual and r["credit_impair"] and r["loans"] and last_annual.get("loans"):
            r["credit_cost"] = r["credit_impair"] / ((r["loans"] + last_annual["loans"]) / 2) * 100
        # 活期/个人存款占比（iFind 金额 ÷ 资产负债表吸收存款）
        for k_dep, k_out in (("demand_dep", "demand_ratio"), ("personal_dep", "personal_ratio")):
            if r.get(k_dep) and r["deposits"]:
                r[k_out] = r[k_dep] / r["deposits"] * 100
        # 同业负债依赖度 = (同业存放+拆入+回购 + NCD) / 总负债
        wholesale = r["interbank_liab"] or 0
        if r.get("ncd"):
            wholesale += r["ncd"]
        if wholesale and r["total_liab"]:
            r["interbank_dep"] = wholesale / r["total_liab"] * 100
        elif r["interbank_liab"] and r["total_liab"]:
            r["interbank_dep"] = r["interbank_liab"] / r["total_liab"] * 100
        # D1 存款成本：计息负债成本 − 批发负债占比 × 利差
        if r.get("ib_liab_cost") is not None:
            dep = r["deposits"] or 0
            bonds = r["bond_payable"] or 0
            ncd_v = r.get("ncd") or 0
            ib_bal = dep + (r["interbank_liab"] or 0) + ncd_v + bonds
            wshare = 0.0
            if ib_bal > 0:
                wshare = ((r["interbank_liab"] or 0) + ncd_v + bonds) / ib_bal
            r["dep_cost"] = r["ib_liab_cost"] - wshare * WHOLESALE_SPREAD_PCT
            r["dep_cost"] = max(0.3, min(r["ib_liab_cost"], r["dep_cost"]))
        # F2 风险密度 = (CET1资本 / CET1比率) / 总资产
        if r.get("cet1_capital") and r.get("cet1") and r["cet1"] > 0 and r["total_assets"]:
            rwa = r["cet1_capital"] / (r["cet1"] / 100.0)
            r["rwa_density"] = rwa / r["total_assets"] * 100
        # E1: 营收增速 3年CAGR 在 compute_cagr3 第二遍统一计算；此处仅记录单年YoY作fallback
        if is_annual and r.get("revenue_yoy") is not None:
            r["rev_yoy_fallback"] = r["revenue_yoy"]
        # G1: ROE/PB
        if r.get("roe_weighted") and r.get("pb") and r["pb"] > 0 and is_annual:
            r["roe_over_pb"] = r["roe_weighted"] / r["pb"]

        # ---- F3 分红率 / G2 股息率（分红历史归并到年度）----
        share_cap = bd.num("balance", rd, "SHARE_CAPITAL")
        if is_annual and bd.dividend is not None and "现金分红-现金分红比例" in bd.dividend.columns:
            year_str = rd[:4]
            dv = bd.dividend[bd.dividend["报告期"].astype(str).str.startswith(year_str)]
            dv = dv[dv["现金分红-现金分红比例"].notna()]
            if len(dv) and r["net_profit"] and share_cap:
                total_div = float(dv["现金分红-现金分红比例"].astype(float).sum()) * 0.1 * share_cap
                if r["net_profit"] > 0:
                    r["div_payout"] = total_div / r["net_profit"] * 100
                # G2 股息率 = 每股分红 / 股价（用 stock_data 的收盘价）
                if r.get("close"):
                    dps = float(dv["现金分红-现金分红比例"].astype(float).sum()) * 0.1
                    r["div_yield"] = dps / r["close"] * 100

        # ---- 年报期结束后更新 last_annual 快照（供下一年的平均口径使用）----
        if is_annual:
            last_annual = {
                "total_assets": r["total_assets"], "loans": r["loans"],
                "revenue": r["revenue"], "share_capital": share_cap,
                "net_profit": r["net_profit"], "ppop": r.get("ppop"),
            }

        rows.append(r)

    df = pd.DataFrame(rows)
    # 第二遍：营收3年CAGR需要完整历史，重算（第一遍只保留了3年前值，链表断）
    return df


def compute_quality_metrics(metrics: pd.DataFrame) -> None:
    """拨贷比、净利/PPOP、关注/不良、以及年报期同比（C4/C5/D3-D5）。"""
    if metrics.empty:
        return
    for idx, row in metrics.iterrows():
        npl = row.get("npl")
        cov = row.get("prov_cov")
        if _finite(npl) and _finite(cov):
            metrics.at[idx, "prov_loan"] = float(npl) * float(cov) / 100.0
        sm = row.get("special_mention")
        if _finite(sm) and _finite(npl) and float(npl) > 0:
            metrics.at[idx, "sm_over_npl"] = float(sm) / float(npl)
        np_ = row.get("net_profit")
        ppop = row.get("ppop")
        if _finite(np_) and _finite(ppop) and abs(float(ppop)) > 1:
            metrics.at[idx, "ni_ppop"] = float(np_) / float(ppop)
        loans = row.get("loans")
        if _finite(npl) and _finite(loans):
            metrics.at[idx, "npl_bal"] = float(loans) * float(npl) / 100.0

    annual = metrics[metrics["report_date"].astype(str).str[5:7] == "12"]
    by_year: Dict[int, pd.Series] = {int(r["year"]): r for _, r in annual.iterrows()}
    for idx, row in metrics.iterrows():
        if str(row["report_date"])[5:7] != "12":
            continue
        prev = by_year.get(int(row["year"]) - 1)
        if prev is None:
            continue
        cur_pl, prev_pl = row.get("prov_loan"), prev.get("prov_loan")
        if _finite(cur_pl) and _finite(prev_pl):
            metrics.at[idx, "d_prov_loan_bp"] = (float(cur_pl) - float(prev_pl)) * 100.0
        cur_sm, prev_sm = row.get("special_mention"), prev.get("special_mention")
        if _finite(cur_sm) and _finite(prev_sm):
            metrics.at[idx, "sm_yoy_bp"] = (float(cur_sm) - float(prev_sm)) * 100.0
        cur_nb, prev_nb = row.get("npl_bal"), prev.get("npl_bal")
        if _finite(cur_nb) and _finite(prev_nb) and float(prev_nb) != 0:
            metrics.at[idx, "npl_bal_yoy"] = (float(cur_nb) / float(prev_nb) - 1.0) * 100.0


def compute_cagr3(bd: BankData, metrics: pd.DataFrame) -> None:
    """在 metrics 上补全 rev_cagr3（用年度营收序列直接计算）。"""
    annual = metrics[(metrics["report_date"].str[5:7] == "12") & metrics["revenue"].notna()]
    rev_by_year = dict(zip(annual["year"], annual["revenue"]))
    for idx, row in metrics.iterrows():
        if row["report_date"][5:7] != "12":
            continue
        y = int(row["year"])
        base = rev_by_year.get(y - 3)
        cur = rev_by_year.get(y)
        if base and cur and base > 0:
            metrics.at[idx, "rev_cagr3"] = ((cur / base) ** (1 / 3) - 1) * 100
        elif pd.notna(row.get("rev_yoy_fallback")):
            metrics.at[idx, "rev_cagr3"] = row["rev_yoy_fallback"]


def compute_refi(bd: BankData, metrics: pd.DataFrame) -> None:
    """F4: 近5年是否发生普通股摊薄（定增/配股/可转债转股）。
    AT1/永续债（吸收投资现金主要进入其他权益工具、股本几乎不动）不计入。
    送转股剔除。剔除送转后净股本增幅 >5% 且非 AT1 → 记 1。
    """
    share_by_year: Dict[int, float] = {}
    oet_by_year: Dict[int, float] = {}
    acc_by_year: Dict[int, float] = {}
    for _, row in metrics.iterrows():
        if str(row["report_date"])[5:7] != "12":
            continue
        y = int(row["year"])
        rd = row["report_date"]
        sc = bd.num("balance", rd, "SHARE_CAPITAL")
        if sc:
            share_by_year[y] = sc
        oet = bd.num("balance", rd, "OTHER_EQUITY_TOOL")
        oet_by_year[y] = oet or 0.0
        acc = bd.num("cashflow", rd, "ACCEPT_INVEST_CASH")
        acc_by_year[y] = acc or 0.0

    sz_by_year: Dict[int, float] = {}
    if bd.dividend is not None and "送转股份-送转总比例" in bd.dividend.columns:
        for _, d in bd.dividend.iterrows():
            v = d["送转股份-送转总比例"]
            if pd.notna(v) and float(v) > 0:
                y = int(str(d["报告期"])[:4])
                sz_by_year[y] = sz_by_year.get(y, 0) + float(v) * 10

    for idx, row in metrics.iterrows():
        if row["report_date"][5:7] != "12":
            continue
        y = int(row["year"])
        diluted = 0.0
        for yy in range(y - 4, y + 1):
            if yy not in share_by_year or yy - 1 not in share_by_year:
                continue
            prev = share_by_year[yy - 1]
            if not prev:
                continue
            growth = share_by_year[yy] / prev - 1
            net_growth = growth - sz_by_year.get(yy, 0) / 100
            acc = acc_by_year.get(yy, 0.0)
            doe = oet_by_year.get(yy, 0.0) - oet_by_year.get(yy - 1, 0.0)
            at1_like = acc > 1e9 and doe > 0.6 * acc and net_growth < 0.03
            if net_growth > 0.05 and not at1_like:
                diluted = 1.0
                break
        metrics.at[idx, "refi_diluted"] = diluted


ITEM_TO_METRIC = {
    "A1": ("nim", "percent"), "A2": ("nonint_ratio", "percent"),
    "B1": ("rev_cagr3", "percent"), "B2": ("net_profit_yoy", "percent"),
    "C1": ("roe_weighted", "percent"), "C2": ("roa", "percent"),
    "C3": ("ni_ppop", "ratio"), "C4": ("prov_loan", "percent"),
    "C5": ("d_prov_loan_bp", "bp"),
    "D1": ("npl", "percent"), "D2": ("special_mention", "percent"),
    "D3": ("sm_yoy_bp", "bp"), "D4": ("sm_over_npl", "ratio"),
    "D5": ("npl_bal_yoy", "percent"),
    "E1": ("cir", "percent"), "E2": ("dep_cost", "percent"),
    "E3": ("credit_cost", "percent"),
    "F1": ("cet1", "percent"), "F2": ("rwa_density", "percent"),
    "F3": ("div_payout", "percent"), "F4": ("refi_diluted", "bool"),
    "G1": ("roe_over_pb", "percent"), "G2": ("div_yield", "percent"),
}

IFIND_METRIC_COLS = {"npl", "prov_cov", "cet1", "nim", "special_mention",
                     "demand_ratio", "personal_ratio", "prov_loan"}
DIVIDEND_METRIC_COLS = {"div_payout", "div_yield"}
PROXY_METRIC_COLS = {"sm_yoy_bp", "sm_over_npl", "npl_bal_yoy"}


def _finite(v: Any) -> bool:
    return v is not None and not (isinstance(v, float) and (math.isnan(v) or math.isinf(v)))


def collect_year_medians(metrics_list: List[pd.DataFrame]) -> Tuple[Dict[int, Dict[str, float]], Dict[str, float]]:
    """各年行业中位数（年报），及 2025 锚点年中位数。样本 <8 的年份不校准。"""
    buckets: Dict[int, Dict[str, List[float]]] = {}
    growth: Dict[int, List[float]] = {}
    for metrics in metrics_list:
        annual = metrics[metrics["report_date"].astype(str).str[5:7] == "12"]
        for _, row in annual.iterrows():
            y = int(row["year"])
            buckets.setdefault(y, {col: [] for col in CYCLE_ITEMS.values()})
            for col in CYCLE_ITEMS.values():
                val = row.get(col)
                if _finite(val):
                    buckets[y][col].append(float(val))
            gv = row.get(GROWTH_MEDIAN_COL)
            if _finite(gv):
                growth.setdefault(y, []).append(float(gv))
    year_medians: Dict[int, Dict[str, float]] = {}
    for y, cols in buckets.items():
        if min(len(v) for v in cols.values()) < 8:
            continue
        year_medians[y] = {c: float(pd.Series(vs).median()) for c, vs in cols.items() if vs}
        gs = growth.get(y) or []
        if len(gs) >= 8:
            year_medians[y][GROWTH_MEDIAN_COL] = float(pd.Series(gs).median())
    anchor = year_medians.get(ANCHOR_YEAR, {})
    return year_medians, anchor


def _cycle_shift(item_id: str, year: int, year_medians: Dict[int, Dict[str, float]],
                 anchor: Dict[str, float]) -> float:
    col = CYCLE_ITEMS.get(item_id)
    if not col:
        return 0.0
    ym = year_medians.get(year, {}).get(col)
    am = anchor.get(col)
    if ym is None or am is None:
        return 0.0
    return ym - am


def _item_basis(item_id: str, spec: Dict[str, Any], metric_col: Optional[str]) -> str:
    if spec.get("proxy"):
        return "proxy"
    if spec.get("special"):
        return "derived"
    if metric_col in ("dep_cost", "rwa_density", "ni_ppop", "prov_loan", "d_prov_loan_bp"):
        return "derived"
    if metric_col in IFIND_METRIC_COLS:
        return "ifind"
    if metric_col in DIVIDEND_METRIC_COLS:
        return "dividend"
    return "statement"


def score_k4(row: pd.Series, spec: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """1.67% 规则：不良<1.67% 盯拨贷比，否则盯覆盖率。"""
    npl = row.get("npl")
    cov = row.get("prov_cov")
    pl = row.get("prov_loan")
    if not _finite(npl) or not _finite(cov):
        return None
    npl_f, cov_f = float(npl), float(cov)
    if npl_f < NPL_WATCH_CUTOFF:
        if not _finite(pl):
            return None
        x1, x0 = spec["x1"], spec["x0"]
        v = float(pl)
        s = linear_score(v, x1, x0, True) * spec["full"]
        return {
            "value": round(v, 4), "score": round(s, 2), "full": spec["full"],
            "x1": x1, "x0": x0, "unit": "%", "name": spec["name"],
            "basis": "derived",
            "note": f"不良 {npl_f:.2f}%<{NPL_WATCH_CUTOFF}%，盯拨贷比 {v:.2f}%",
        }
    x1, x0 = 400.0, 150.0
    s = linear_score(cov_f, x1, x0, True) * spec["full"]
    return {
        "value": round(cov_f, 4), "score": round(s, 2), "full": spec["full"],
        "x1": x1, "x0": x0, "unit": "%", "name": spec["name"],
        "basis": "ifind",
        "note": f"不良 {npl_f:.2f}%≥{NPL_WATCH_CUTOFF}%，盯覆盖率 {cov_f:.0f}%",
    }


def score_k5(row: pd.Series, spec: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Δ拨贷比（bp）。覆盖率>350% 且变动 ≥ −20bp 时保底 5/8。"""
    dpl = row.get("d_prov_loan_bp")
    if not _finite(dpl):
        return None
    v = float(dpl)
    x1, x0 = spec["x1"], spec["x0"]
    s = linear_score(v, x1, x0, True) * spec["full"]
    note = None
    cov = row.get("prov_cov")
    if _finite(cov) and float(cov) > 350 and v >= -20:
        s = max(s, 5.0)
        note = f"覆盖率 {float(cov):.0f}%>350% 且拨贷比变动 {v:+.0f}bp，保底 5/8"
    out = {
        "value": round(v, 2), "score": round(s, 2), "full": spec["full"],
        "x1": x1, "x0": x0, "unit": "bp", "name": spec["name"],
        "basis": "derived",
    }
    if note:
        out["note"] = note
    return out


def score_period(row: pd.Series, *, code: str,
                 year_medians: Dict[int, Dict[str, float]],
                 anchor_medians: Dict[str, float],
                 g_val: float,
                 prev_rev_yoy: Optional[float]) -> Dict[str, Any]:
    """对一个年报期计算公司分（A/B/C/D/E/F）+ 估值评价 G + H 观测。"""
    is_annual = row["report_date"][5:7] == "12"
    year = int(row["year"])
    items_out: Dict[str, Any] = {}
    c1_floor = cet1_x0(code)

    for item_id, spec in ITEMS.items():
        metric_col, kind = ITEM_TO_METRIC[item_id]
        value = row.get(metric_col) if metric_col else None
        has_val = _finite(value)
        x1, x0 = spec["x1"], spec["x0"]
        if item_id == "F1":
            x0 = c1_floor
        if spec.get("relative_median") and is_annual:
            med = year_medians.get(year, {}).get(spec["relative_median"])
            band = float(spec.get("band") or 8.0)
            if med is not None:
                x1, x0 = med + band, med - band
        shift = _cycle_shift(item_id, year, year_medians, anchor_medians) if is_annual else 0.0
        if shift:
            x1, x0 = x1 + shift, x0 + shift
        meta = {"name": spec["name"], "x1": x1, "x0": x0, "unit": spec["unit"]}

        if not is_annual:
            items_out[item_id] = {"value": round(float(value), 4) if has_val else None, "score": None,
                                  "full": spec["full"], "basis": "raw" if has_val else "na", **meta}
            continue
        if item_id in SKIP_ITEMS:
            items_out[item_id] = {"value": None, "score": None, "full": spec["full"],
                                  "basis": "unavailable", **meta}
            continue

        if spec.get("special") == "prov_adequacy":
            k4 = score_k4(row, spec)
            items_out[item_id] = k4 if k4 else {
                "value": None, "score": None, "full": spec["full"], "basis": "excluded", **meta,
            }
            continue
        if spec.get("special") == "prov_trend":
            k5 = score_k5(row, spec)
            items_out[item_id] = k5 if k5 else {
                "value": None, "score": None, "full": spec["full"], "basis": "excluded", **meta,
            }
            continue

        if not has_val:
            items_out[item_id] = {"value": None, "score": None, "full": spec["full"],
                                  "basis": "excluded", **meta}
            continue
        if kind == "bool":
            diluted = float(value) == 1.0
            cet1 = row.get("cet1")
            if not diluted:
                s = spec["full"]
                note = "近5年无普通股摊薄（AT1/永续债不计入）"
            elif _finite(cet1) and float(cet1) < C4_NO_DOUBLE_CET1:
                s = spec["full"]
                note = f"有普通股摊薄，但 CET1 {float(cet1):.2f}%<{C4_NO_DOUBLE_CET1}%，F1 已扣、F4 不二次扣"
            else:
                s = 0.0
                note = "近5年有普通股定增/配股/转股，且 CET1 并不薄"
            items_out[item_id] = {"value": float(value), "score": s, "full": spec["full"],
                                  "basis": "derived", "note": note, **meta}
            continue

        v = float(value)
        s = linear_score(v, x1, x0, spec["up"]) * spec["full"]
        basis = _item_basis(item_id, spec, metric_col)
        note = None
        if spec.get("relative_median") and year_medians.get(year, {}).get(spec["relative_median"]) is not None:
            med = year_medians[year][spec["relative_median"]]
            note = f"当年营收CAGR3中位数 {med:+.1f}%，满分线 {x1:+.1f}% / 零分线 {x0:+.1f}%"
        if item_id == "B2":
            rev_yoy = row.get("revenue_yoy") if _finite(row.get("revenue_yoy")) else row.get("rev_yoy_fallback")
            ppop_yoy = row.get("ppop_yoy")
            if v > 0 and _finite(rev_yoy) and v > float(rev_yoy) + 3:
                s *= 0.8
                note = f"净利增速快于营收 YoY {float(rev_yoy):+.1f}% 超 3pct，B2×0.8（拨备反哺检验）"
            elif v > 0 and _finite(ppop_yoy) and v > float(ppop_yoy) + 3:
                s *= 0.8
                note = f"净利增速快于 PPOP YoY {float(ppop_yoy):+.1f}% 超 3pct，B2×0.8"
        if spec.get("proxy"):
            note = (note + "；" if note else "") + "前瞻代理，待逾期90+/迁徙矩阵/核销替换"
        out = {"value": round(v, 4), "score": round(s, 2), "full": spec["full"],
               "basis": basis, **meta}
        if note:
            out["note"] = note
        items_out[item_id] = out

    dims: Dict[str, Any] = {}
    total = 0.0
    vetos: List[str] = []
    if is_annual:
        for dim_id, dim in DIMENSIONS.items():
            scored = [i for i in dim["items"]
                      if items_out[i]["score"] is not None]
            payload = {"name": dim["name"], "full": dim["full"],
                       "question": dim["question"], "in_total": dim.get("in_total", True)}
            if not scored:
                dims[dim_id] = {**payload, "score": 0.0, "available_full": 0, "rescaled": True}
                continue
            raw = sum(items_out[i]["score"] for i in scored)
            avail = sum(items_out[i]["full"] for i in scored)
            ds = raw / avail * dim["full"] if avail else 0.0
            dims[dim_id] = {**payload, "score": round(ds, 2), "available_full": avail,
                            "rescaled": avail < dim["full"]}

        rev_yoy = row.get("revenue_yoy") if _finite(row.get("revenue_yoy")) else row.get("rev_yoy_fallback")
        if _finite(prev_rev_yoy) and _finite(rev_yoy) and prev_rev_yoy < 0 and float(rev_yoy) < 0:
            dims["B"]["score"] = 0.0
            dims["B"]["veto"] = "连续两年营收负增长"
            vetos.append("连续两年营收负增长，B 维记 0")

        g_obs = 0.0
        if year >= G_APPLY_FROM_YEAR and g_val:
            g_obs = max(-5.0, min(5.0, float(g_val)))

        total = sum(dims[k]["score"] for k in DIMS_IN_TOTAL)

        cov = row.get("prov_cov")
        cet1 = items_out["F1"]["value"]
        if _finite(cov) and float(cov) < 150:
            if total > 60:
                total = 60.0
            vetos.append(f"拨备覆盖率 {float(cov):.0f}%<150%，总分封顶 60")
        if _finite(cet1) and float(cet1) < c1_floor + 0.5:
            if total > 60:
                total = 60.0
            vetos.append(f"CET1 {float(cet1):.2f}% 贴近红线 {c1_floor:.2f}%，总分封顶 60")

        rankable = all(items_out[k]["score"] is not None for k in KEY_ITEMS_FOR_RANK)
        if not rankable:
            vetos.append("NIM/不良/CET1 关键项缺失，不参与排序")

        return {
            "report_date": row["report_date"], "year": year,
            "quarter": 4,
            "report_type": "年报",
            "total": round(total, 2),
            "grade": grade_of(total),
            "g": round(g_obs, 2),
            "g_in_total": False,
            "rankable": rankable,
            "vetos": vetos,
            "dimensions": dims,
            "items": items_out,
        }

    qmap = {"03": 1, "06": 2, "09": 3, "12": 4}
    q = qmap.get(row["report_date"][5:7], 0)
    rtype = {1: "一季报", 2: "中报", 3: "三季报", 4: "年报"}.get(q, "")
    return {
        "report_date": row["report_date"], "year": year, "quarter": q,
        "report_type": rtype, "total": None, "grade": None,
        "dimensions": {}, "items": items_out,
    }


# ============ 六维详细评价文本生成（模块①用） ============

def _fmt_amount_yi(v: Optional[float]) -> str:
    """金额格式化：万亿级显示万亿，否则亿。"""
    if v is None:
        return ""
    if abs(v) >= 1e12:
        return f"{v / 1e12:.2f}万亿"
    return f"{v / YI:.0f}亿"


def _finite_num(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v):
        return None
    return v


def _item_val(items: Dict[str, Any], key: str) -> Optional[float]:
    it = items.get(key) or {}
    return _finite_num(it.get("value"))


def _eval_blocks(*pairs: Tuple[str, List[str]]) -> List[Dict[str, Any]]:
    """卡片评述：每段一个加粗标题 + 若干独立行。"""
    out: List[Dict[str, Any]] = []
    for title, items in pairs:
        cleaned = [str(x).strip().rstrip("。；") for x in (items or []) if x]
        if not cleaned:
            continue
        out.append({"title": title or "", "items": cleaned})
    return out


def build_evaluations(metrics: pd.DataFrame, period: Dict[str, Any]) -> Dict[str, Any]:
    """六维评述（A/B/C/D/E/F）+ 估值评价 G（不进总分）。"""
    year = period["year"]
    annual = metrics[metrics["report_date"].str[5:7] == "12"]
    by_year = {int(r["year"]): r for _, r in annual.iterrows()}
    items = period["items"]
    dims = period["dimensions"]

    def v(col: str, y: Optional[int] = None) -> Optional[float]:
        row = by_year.get(y if y is not None else year)
        if row is None:
            return None
        return _finite_num(row.get(col))

    def trend(col: str, n: int = 5) -> Optional[float]:
        cur = v(col)
        if cur is None:
            return None
        y0 = year - n
        while y0 < year and v(col, y0) is None:
            y0 += 1
        old = v(col, y0)
        if old is None or y0 >= year:
            return None
        return cur - old

    def rate(dim_key: str) -> float:
        dv = dims.get(dim_key) or {}
        full = dv.get("full") or 0
        sc = dv.get("score")
        if not full or sc is None:
            return 0.0
        return float(sc) / float(full)

    evals: Dict[str, Any] = {}

    nim = _item_val(items, "A1")
    nonint = _item_val(items, "A2")
    d_nim = trend("nim")
    i_items: List[str] = []
    if nim is not None:
        if nim >= 1.70:
            i_items.append(f"息差仍厚（NIM {nim:.2f}%），定价权在同业前列")
        elif nim >= 1.45:
            i_items.append(f"息差中等（NIM {nim:.2f}%），利差还能贡献一块")
        elif nim <= 1.22:
            i_items.append(f"息差几乎没有贡献（NIM {nim:.2f}%，已贴近行业底部）")
        else:
            i_items.append(f"息差偏薄（NIM {nim:.2f}%），利差贡献有限")
        if d_nim is not None:
            bp = abs(d_nim) * 100
            if d_nim <= -0.20:
                i_items.append(f"NIM 五年收窄约 {bp:.0f}bp，利差能力在退坡")
            elif d_nim >= 0.15:
                i_items.append(f"NIM 五年走阔约 {bp:.0f}bp，息差质量在改善")
    if nonint is not None:
        if nonint >= 30:
            i_items.append(f"非息占比 {nonint:.1f}%，收入不全靠放贷")
        elif nonint < 18:
            i_items.append(f"非息只有 {nonint:.1f}%，利润高度绑在利差上")
        else:
            i_items.append(f"非息占比 {nonint:.1f}%，结构中性")
    if rate("A") >= 0.75:
        i_title = "定价和结构都站得住"
        if nonint is not None and nonint >= 30:
            i_concl = ["定价权还在，收入也不全靠息差"]
        elif d_nim is not None and d_nim <= -0.20:
            i_concl = ["现在息差仍厚，但五年在退坡，定价权要盯着"]
        else:
            i_concl = ["定价和结构都站得住"]
    elif rate("A") >= 0.45:
        i_title = "收入效率中等"
        if d_nim is not None and d_nim <= -0.20:
            i_concl = ["收入效率中等，而且息差还在退坡"]
        else:
            i_concl = ["收入效率中等，没有明显护城河"]
    else:
        i_title = "定价权偏弱"
        if nim is not None and nim <= 1.22:
            i_concl = ["定价权偏弱，利差几乎贡献不了超额"]
        else:
            i_concl = ["收入效率偏弱"]
    evals["A"] = _eval_blocks((i_title, i_items), ("判断", i_concl)) or _eval_blocks(("", ["收入效率数据不足"]))

    j1 = _item_val(items, "B1")
    j2 = _item_val(items, "B2")
    j_items: List[str] = []
    if dims.get("B", {}).get("veto"):
        j_items.append(str(dims["B"]["veto"]))
    if j1 is not None:
        j_items.append(f"营收三年复合 {j1:+.1f}%（相对当年行业中位数计分）")
    if j2 is not None:
        j_items.append(f"归母净利润 {j2:+.1f}%")
    if (j1 is not None and j1 >= 8) or (j2 is not None and j2 >= 8):
        j_title = "相对同业在长"
    elif (j1 is not None and j1 >= 0) or (j2 is not None and j2 >= 0):
        j_title = "还能长一点，但不多"
    else:
        j_title = "增长偏弱"
    j_q: List[str] = []
    if j1 is not None and j2 is not None and j2 > 0 and (j2 - j1) >= 4:
        j_q.append("利润明显快于营收，增长更像来自费用或拨备释放")
    if dims.get("B", {}).get("veto"):
        j_concl = ["连续两年营收负增长，增长维直接记零"]
    elif j_q:
        j_concl = ["账面上在长，但利润快于营收，增长含金量要打折"]
    elif rate("B") >= 0.75:
        j_concl = ["相对同业确实在长"]
    elif rate("B") >= 0.45:
        j_concl = ["还能长一点，弹性不大"]
    else:
        j_concl = ["增长是短板"]
    evals["B"] = _eval_blocks((j_title, j_items), ("增长质量", j_q), ("判断", j_concl)) or _eval_blocks(("", ["增长数据不足"]))

    roe = _item_val(items, "C1")
    roa = _item_val(items, "C2")
    nipp = _item_val(items, "C3")
    k5 = items.get("C5") or {}
    d_roe = trend("roe_weighted")
    how_items: List[str] = []
    if roe is not None:
        how_items.append(f"加权ROE {roe:.2f}%")
    if roa is not None:
        how_items.append(f"ROA {roa:.2f}%")
    if (roe is not None and roe >= 13) or (roa is not None and roa >= 1.0):
        how_title = "回报落在行业第一档"
    elif (roe is not None and roe >= 11) or (roa is not None and roa >= 0.85):
        how_title = "回报在行业中上游"
    elif (roe is not None and roe >= 8):
        how_title = "回报只在行业中游"
    else:
        how_title = "资本回报偏弱"
    truth: List[str] = []
    if d_roe is not None:
        if d_roe <= -1.0:
            truth.append(f"近五年ROE掉了 {abs(d_roe):.1f} 个百分点")
        elif d_roe >= 1.0:
            truth.append(f"近五年ROE抬了 {d_roe:.1f} 个百分点")
    if nipp is not None:
        eaten = max(0.0, 100.0 - nipp * 100.0)
        if nipp >= 1.00:
            truth.append(
                f"净利/PPOP {nipp:.2f}，净利赶上甚至超过拨备前利润，账面利润很大概率被回拨拨备托起来"
            )
        elif nipp >= 0.95:
            truth.append(
                f"净利/PPOP {nipp:.2f}，经营利润几乎原数落袋，要防少提或回拨拨备在灌利润"
            )
        elif nipp <= 0.60:
            truth.append(
                f"净利/PPOP {nipp:.2f}，拨备和税吃掉约 {eaten:.0f}% 经营利润，当期计提偏实，账面利润更可信"
            )
        else:
            truth.append(
                f"净利/PPOP {nipp:.2f}，落袋比例中性——大约 {eaten:.0f}% 的经营利润被拨备和税吃掉，"
                f"看不出明显反哺，也不算过度藏利润"
            )
    npl_k = v("npl")
    pl_k = v("prov_loan")
    cov_k = v("prov_cov")
    if npl_k is not None and (pl_k is not None or cov_k is not None):
        if npl_k < NPL_WATCH_CUTOFF and pl_k is not None:
            if pl_k >= 3.50:
                thick = "拨备相对贷款很厚，利润后面垫子够"
            elif pl_k >= 2.75:
                thick = "拨备厚度中等偏上"
            elif pl_k >= 2.00:
                thick = "拨备厚度一般，缓冲谈不上宽裕"
            else:
                thick = "拨备相对贷款偏薄，利润经不起一波不良"
            truth.append(
                f"不良 {npl_k:.2f}% 低于 1.67%，低不良时覆盖率容易虚高，改看拨贷比 {pl_k:.2f}%——{thick}"
            )
        elif cov_k is not None:
            if cov_k >= 400:
                thick = "覆盖很厚"
            elif cov_k >= 250:
                thick = "覆盖中等"
            else:
                thick = "覆盖偏薄，坏账缓冲不够"
            truth.append(
                f"不良已到 {npl_k:.2f}%，改看覆盖率 {cov_k:.0f}%——{thick}"
            )
    dpl = k5.get("value")
    dpl_f = float(dpl) if dpl is not None else None
    floor_on = (
        dpl_f is not None and cov_k is not None and cov_k > 350 and dpl_f >= -20
    )
    if dpl_f is not None:
        if dpl_f >= 15:
            truth.append(f"拨贷比升了 {dpl_f:+.0f}bp，在加厚拨备，利润更扎实")
        elif dpl_f > 0:
            truth.append(f"拨贷比微升 {dpl_f:+.0f}bp，拨备没有回吐")
        elif floor_on:
            truth.append(
                f"拨贷比回吐 {dpl_f:+.0f}bp，但覆盖率仍有 {cov_k:.0f}%，只是厚垫子上的轻微松动，"
                f"不像在用拨备养利润（因此 C5 保底 5/8，不按掏空拨备处理）"
            )
        elif dpl_f >= -20:
            truth.append(f"拨贷比小幅回吐 {dpl_f:+.0f}bp，幅度还可控，暂不像明显注水")
        elif cov_k is not None and cov_k > 350:
            truth.append(
                f"拨贷比明显回吐 {dpl_f:+.0f}bp，覆盖率虽有 {cov_k:.0f}% 仍厚，"
                f"但回吐已超过 −20bp，利润里可能掺了一部分拨备释放，规则不给保底"
            )
        else:
            truth.append(f"拨贷比明显回吐 {dpl_f:+.0f}bp，利润里可能掺了拨备释放")
    k_water = (nipp is not None and nipp >= 0.95) or (
        dpl_f is not None and dpl_f < -20 and not floor_on
    )
    k_solid = (nipp is None or nipp <= 0.70) and (
        dpl_f is None or dpl_f >= -20 or floor_on
    )
    if k_water and rate("C") >= 0.70:
        k_concl = ["回报不低，但利润里有拨备释放的成分，盈利质量要打折"]
    elif k_water:
        k_concl = ["利润真伪有问题，账面回报不能全信"]
    elif rate("C") >= 0.75 and k_solid:
        k_concl = ["回报真、拨备也厚，盈利质量过硬"]
    elif floor_on:
        k_concl = ["利润大体可信，拨备略有回吐但垫子还厚"]
    elif rate("C") >= 0.55:
        k_concl = ["盈利质量过得去，没有明显注水"]
    else:
        k_concl = ["盈利质量偏弱"]
    evals["C"] = _eval_blocks((how_title, how_items), ("利润真伪", truth), ("判断", k_concl)) or _eval_blocks(("", ["盈利质量数据不足"]))

    npl = _item_val(items, "D1")
    sm = _item_val(items, "D2")
    l3 = _item_val(items, "D3")
    l4 = _item_val(items, "D4")
    l5 = _item_val(items, "D5")
    d_npl = trend("npl")
    stock_items: List[str] = []
    if npl is not None:
        if npl <= 0.95:
            stock_items.append(f"账面不良很少（{npl:.2f}%）")
        elif npl <= 1.25:
            stock_items.append(f"账面不良 {npl:.2f}%，存量中等")
        else:
            stock_items.append(f"账面不良 {npl:.2f}%，贷款已经烂了一块")
        if d_npl is not None:
            if d_npl <= -0.15:
                stock_items.append(f"近五年下降 {abs(d_npl):.2f} 个百分点，在出清")
            elif d_npl >= 0.15:
                stock_items.append(f"近五年上升 {d_npl:.2f} 个百分点，还在变差")
    if sm is not None:
        if sm < 1.0:
            stock_items.append(f"关注类 {sm:.2f}%，蓄水池不高")
        elif sm > 2.0:
            stock_items.append(f"关注类 {sm:.2f}% 偏高")
        else:
            stock_items.append(f"关注类 {sm:.2f}%，蓄水池中性")
    fwd: List[str] = []
    if l3 is not None:
        fwd.append(f"关注同比 {l3:+.0f}bp（迁徙代理）")
    if l4 is not None:
        fwd.append(f"关注/不良 {l4:.2f}x（偏离代理）")
    if l5 is not None:
        fwd.append(f"不良余额同比 {l5:+.1f}%（生成代理）")
    if rate("D") >= 0.75:
        l_concl = ["存量干净，前瞻也没有明显恶化"]
    elif rate("D") >= 0.50:
        l_concl = ["资产质量过得去，短板在存量或前瞻之一"]
    else:
        l_concl = ["资产质量偏弱"]
    evals["D"] = _eval_blocks(
        ("存量", stock_items), ("前瞻", fwd), ("判断", l_concl),
    ) or _eval_blocks(("", ["资产质量数据不足"]))

    cir = _item_val(items, "E1")
    dep = _item_val(items, "E2")
    cc = _item_val(items, "E3")
    d_dep = trend("dep_cost")
    m_items: List[str] = []
    if cir is not None:
        if cir <= 28:
            m_items.append(f"成本收入比 {cir:.1f}%，费用抠得紧")
        elif cir >= 36:
            m_items.append(f"成本收入比 {cir:.1f}%，运营效率是短板")
        else:
            m_items.append(f"成本收入比 {cir:.1f}%，效率中等")
    if dep is not None:
        if dep <= 1.25:
            m_items.append(f"存款成本约 {dep:.2f}%，负债便宜")
        elif dep <= 1.55:
            m_items.append(f"存款成本约 {dep:.2f}%，比优秀行贵一截")
        else:
            m_items.append(f"存款成本约 {dep:.2f}%，负债端在侵蚀息差")
        if d_dep is not None:
            bp = abs(d_dep) * 100
            if d_dep <= -0.20:
                m_items.append(f"近五年存款成本下降约 {bp:.0f}bp")
            elif d_dep >= 0.15:
                m_items.append(f"近五年存款成本升了约 {bp:.0f}bp")
    if cc is not None:
        if cc < 0.60:
            m_items.append(f"信用成本 {cc:.2f}%，当期风险定价不重")
        elif cc > 1.00:
            m_items.append(f"信用成本 {cc:.2f}%，正在用利润填窟窿")
        else:
            m_items.append(f"信用成本 {cc:.2f}%，计提压力中等")
    if cc is not None and cc > 1.00 and rate("E") < 0.70:
        m_concl = ["信用成本在吃利润，成本端是拖累"]
    elif dep is not None and dep <= 1.25 and (cir is None or cir <= 30):
        m_concl = ["负债便宜，成本是护城河"]
    elif rate("E") >= 0.75:
        m_concl = ["运营、负债和风险定价都过关"]
    elif rate("E") >= 0.50:
        m_concl = ["成本控制中等"]
    else:
        m_concl = ["成本端是短板"]
    evals["E"] = _eval_blocks(("成本与定价", m_items), ("判断", m_concl)) or _eval_blocks(("", ["成本数据不足"]))

    cet1 = _item_val(items, "F1")
    rwa = _item_val(items, "F2")
    payout = _item_val(items, "F3")
    refi = _item_val(items, "F4")
    c1_it = items.get("F1") or {}
    c1_floor = _finite_num(c1_it.get("x0")) or 7.5
    ig = None
    if roe is not None and payout is not None:
        ig = roe * (1 - payout / 100)
    ceil_title, ceil_items = "增长天花板", []
    if ig is not None:
        if ig >= 8:
            ceil_title = "还能支撑中速扩张"
            ceil_items.append(f"内生增长大约 {ig:.1f}%（ROE×留存）")
        elif ig >= 5.5:
            ceil_title = "增长天花板大约在内生增速"
            ceil_items.append(f"内生增长约 {ig:.1f}%，只能支撑温和扩张")
        else:
            ceil_title = "增长天花板偏低"
            ceil_items.append(f"内生增长大约 {ig:.1f}%，再快就要吃资本或找股东要钱")
        if payout is not None:
            ceil_items.append(f"现金分红 {payout:.0f}%")
    cap_items: List[str] = []
    if cet1 is not None:
        buf = cet1 - c1_floor
        if cet1 >= 12:
            cap_items.append(f"CET1 {cet1:.2f}%，离监管底（约 {c1_floor:.1f}%）还有 {buf:.1f} 个百分点")
        elif cet1 >= c1_floor + 1.5:
            cap_items.append(f"CET1 {cet1:.2f}%，高于监管底约 {buf:.1f} 个百分点，扩表要精打细算")
        else:
            cap_items.append(f"CET1 {cet1:.2f}%，已经贴近监管底（约 {c1_floor:.1f}%）")
    rwa_items: List[str] = []
    if rwa is not None:
        if rwa <= 58:
            rwa_items.append(f"风险密度 {rwa:.1f}% 偏低，同样一块资本能撑更多资产")
        elif rwa >= 70:
            rwa_items.append(f"风险密度 {rwa:.1f}% 偏高，资本消耗快")
        else:
            rwa_items.append(f"风险密度 {rwa:.1f}%，资本消耗效率中性")
    refi_items: List[str] = []
    if refi is not None:
        if refi >= 0.5:
            refi_items.append("近五年有过普通股摊薄")
        else:
            refi_items.append("近五年没有普通股摊薄")
    if rate("F") >= 0.80:
        c_concl = ["资本还能同时支撑增长和分红"]
    elif rate("F") >= 0.55:
        c_concl = ["还能长，但必须在增长和分红之间做取舍"]
    else:
        c_concl = ["资本约束已经拧紧"]
    evals["F"] = _eval_blocks(
        (ceil_title, ceil_items), ("资本缓冲", cap_items),
        ("风险密度", rwa_items), ("再融资", refi_items), ("判断", c_concl),
    ) or _eval_blocks(("", ["资本数据不足"]))

    f1 = _item_val(items, "G1")
    f2 = _item_val(items, "G2")
    pb = v("pb")
    price_items: List[str] = []
    if pb is not None and pb > 0:
        price_items.append(f"年报期 PB {pb:.2f} 倍")
    if f1 is not None:
        price_items.append(f"ROE/PB 隐含回报 {f1:.1f}%")
    if f2 is not None:
        price_items.append(f"股息率 {f2:.2f}%")
    cheap = (f1 is not None and f1 >= 16) or (f2 is not None and f2 >= 4.5)
    expensive = (f1 is not None and f1 < 12) or (pb is not None and pb >= 1.2)
    good_bank = rate("C") >= 0.70 and rate("D") >= 0.60
    weak_bank = rate("C") < 0.50 or rate("D") < 0.45
    if cheap and not expensive:
        price_title = "价格不贵"
    elif expensive and not cheap:
        price_title = "价格不便宜"
    else:
        price_title = "价格中性"
    match_items: List[str] = []
    if good_bank and cheap:
        match_items.append("质地过硬，价格也没贵")
    elif good_bank and expensive:
        match_items.append("质地没问题，但价格已经透支了优势")
    elif weak_bank and cheap:
        match_items.append("便宜主要是因为银行本身一般")
    else:
        match_items.append("估值谈不上错杀，买入要靠质地本身")
    evals["G"] = _eval_blocks(
        (price_title, price_items),
        ("好银行是不是好股票", match_items),
        ("说明", ["估值评价不计入六维总分"]),
    ) or _eval_blocks(("", ["估值数据不足"]))
    return evals


def build_overall_eval(metrics: pd.DataFrame, period: Dict[str, Any]) -> str:
    """总评：规模底数 + 六维总分 + 最强/最弱维度 + 等级含义。"""
    year = period["year"]
    annual = metrics[metrics["report_date"].str[5:7] == "12"]
    row = annual[annual["year"] == year]
    row = row.iloc[0] if len(row) else None

    scale_parts = []
    if row is not None:
        if v := row.get("total_assets"):
            scale_parts.append(f"总资产{_fmt_amount_yi(float(v))}")
        if v := row.get("loans"):
            scale_parts.append(f"贷款{_fmt_amount_yi(float(v))}")
        if v := row.get("deposits"):
            scale_parts.append(f"存款{_fmt_amount_yi(float(v))}")
        if v := row.get("revenue"):
            scale_parts.append(f"营收{_fmt_amount_yi(float(v))}")
        if v := row.get("net_profit"):
            scale_parts.append(f"归母净利润{_fmt_amount_yi(float(v))}")

    dims = period["dimensions"]
    ranked = sorted(
        [(k, dv) for k, dv in dims.items() if dv.get("in_total", True) and dv.get("full")],
        key=lambda kv: kv[1]["score"] / kv[1]["full"], reverse=True,
    )
    _, best = ranked[0]
    _, worst = ranked[-1]
    total = period["total"]
    grade = period["grade"]

    tier = {
        "A+": "综合质地全面优秀，核心持仓候选", "A": "综合质地优良，值得重点研究",
        "B": "中等水平，观察", "C": "较弱，回避", "D": "高风险",
    }.get(grade, "")

    s = f"{year}年报六维得分 {total}（{grade}级）。"
    g = period.get("g") or 0
    if g:
        s += f"H 观测 {g:+.1f}，不计入总分。"
    if period.get("vetos"):
        s += "否决/调整：" + "；".join(period["vetos"]) + "。"
    if not period.get("rankable", True):
        s += "关键指标缺失，不参与横向排序。"
    if scale_parts:
        s += "规模底数：" + "、".join(scale_parts) + "。"
    s += (f"六维中最强的是{best['name']}（{best['score'] / best['full'] * 100:.0f}%），"
          f"最弱的是{worst['name']}（{worst['score'] / worst['full'] * 100:.0f}%）。{tier}。")
    return s



def _to_yi(v: Any) -> Optional[float]:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        return round(float(v) / YI, 2)
    except (TypeError, ValueError):
        return None


def _yuan(v: Any) -> Optional[float]:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _breakdown(pairs: List[Tuple[str, Any]], total: Optional[float] = None,
               pie_positive_only: bool = True) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """pairs: (label, 元). 返回 items（含零/负值）与 pie（默认只放正值）。"""
    rows: List[Tuple[str, float]] = []
    for label, raw in pairs:
        v = _yuan(raw)
        if v is None:
            continue
        rows.append((label, v))
    if total is None:
        total = sum(v for _, v in rows) or None
    items: List[Dict[str, Any]] = []
    pie: List[Dict[str, Any]] = []
    for label, v in rows:
        yi = round(v / YI, 2)
        share = round(v / total * 100, 1) if total else None
        items.append({"label": label, "value": yi, "share": share})
        if (not pie_positive_only) or v > 0:
            pie.append({"label": label, "value": yi})
    return items, pie


def build_scale_section(bd: BankData, metrics: pd.DataFrame) -> Dict[str, Any]:
    """模块2: 盈利/资产/负债规模及构成（20年序列，年报口径 + 最新一期构成）。

    盈利拆项对齐招行年报 MD&A：3.2.3 利息收入、3.2.4 利息支出（公司/零售×活期/定期）、
    3.2.6 非利息净收入。附注缺失时退回利润表合计或存款余额二分结构，不编造利息金额。
    """
    annual = metrics[metrics["report_date"].str[5:7] == "12"].copy().sort_values("report_date")

    def stack(cols_labels):
        dates = [r["report_date"] for _, r in annual.iterrows()]
        out: Dict[str, Any] = {}
        for col, label in cols_labels:
            vals = []
            for _, r in annual.iterrows():
                v = r.get(col)
                vals.append(round(v / YI, 2) if v is not None and pd.notna(v) else None)
            out[label] = vals
        return {"dates": dates, **out}

    for idx, r in annual.iterrows():
        if pd.notna(r.get("revenue")) and pd.notna(r.get("int_ni")):
            annual.at[idx, "nonint"] = r["revenue"] - r["int_ni"]
        elif pd.notna(r.get("revenue")):
            annual.at[idx, "nonint"] = 0.0

        known_nonint = 0.0
        for c in ("fee_ni", "invest_income", "fv_income", "fx_income", "other_biz_income",
                  "other_income", "asset_disposal"):
            v = _yuan(r.get(c))
            if v is not None:
                known_nonint += v
        nonint = _yuan(annual.at[idx, "nonint"]) if "nonint" in annual.columns else None
        if nonint is None:
            nonint = _yuan(r.get("nonint"))
        residual = (nonint - known_nonint) if nonint is not None else None
        annual.at[idx, "nonint_other"] = residual if residual is not None and abs(residual) >= 5e6 else None

        four_bal = [
            _yuan(r.get("dep_corp_demand")), _yuan(r.get("dep_corp_time")),
            _yuan(r.get("dep_retail_demand")), _yuan(r.get("dep_retail_time")),
        ]
        if sum(v is not None for v in four_bal) >= 3:
            annual.at[idx, "dep_corp"] = (four_bal[0] or 0) + (four_bal[1] or 0)
            annual.at[idx, "dep_retail"] = (four_bal[2] or 0) + (four_bal[3] or 0)
            annual.at[idx, "dep_demand"] = (four_bal[0] or 0) + (four_bal[2] or 0)
            annual.at[idx, "dep_time"] = (four_bal[1] or 0) + (four_bal[3] or 0)
        else:
            dep = _yuan(r.get("deposits"))
            dem = _yuan(r.get("demand_dep"))
            per = _yuan(r.get("personal_dep"))
            annual.at[idx, "dep_demand"] = dem
            annual.at[idx, "dep_time"] = (dep - dem) if dep is not None and dem is not None else None
            annual.at[idx, "dep_retail"] = per
            annual.at[idx, "dep_corp"] = (dep - per) if dep is not None and per is not None else None

        four_exp = [
            _yuan(r.get("int_exp_corp_demand")), _yuan(r.get("int_exp_corp_time")),
            _yuan(r.get("int_exp_retail_demand")), _yuan(r.get("int_exp_retail_time")),
        ]
        has_dep_int = any(v is not None for v in four_exp) or _yuan(r.get("int_exp_deposit")) is not None
        dep_int = sum(v for v in four_exp if v is not None)
        if dep_int == 0:
            dep_int = _yuan(r.get("int_exp_deposit")) or 0.0
        bond_int = _yuan(r.get("int_exp_bond")) or 0.0
        pbc_int = _yuan(r.get("int_exp_pbc")) or 0.0
        ib_int = _yuan(r.get("int_exp_interbank"))
        total_exp = _yuan(r.get("int_expense"))
        used = dep_int + bond_int + pbc_int + (ib_int or 0.0)
        residual_exp = (total_exp - used) if total_exp is not None else None
        if ib_int is None and has_dep_int and residual_exp is not None and abs(residual_exp) >= 5e6:
            annual.at[idx, "int_exp_ib_other"] = residual_exp
        else:
            annual.at[idx, "int_exp_ib_other"] = ib_int
        four_inc = [
            _yuan(r.get("int_inc_loan")), _yuan(r.get("int_inc_invest")),
            _yuan(r.get("int_inc_interbank")), _yuan(r.get("int_inc_pbc")),
        ]
        inc_known = sum(v for v in four_inc if v is not None)
        total_inc = _yuan(r.get("int_income"))
        residual_inc = (total_inc - inc_known) if total_inc is not None and inc_known else None
        annual.at[idx, "int_inc_other"] = residual_inc if residual_inc is not None and abs(residual_inc) >= 5e6 else None

        inv_keys = ("fin_invest_ac", "fin_invest_fvoci", "fin_invest_fvtpl",
                    "derive_asset", "long_equity", "other_equity")
        inv = sum(v for v in (_yuan(r.get(k)) for k in inv_keys) if v is not None)
        cash_all = sum(v for v in (_yuan(r.get("cash_pbc")), _yuan(r.get("precious_metal"))) if v is not None)
        ib_a = _yuan(r.get("interbank_assets")) or 0
        gw = _yuan(r.get("goodwill")) or 0
        ta = _yuan(r.get("total_assets"))
        known_a = (_yuan(r.get("loans")) or 0) + inv + ib_a + cash_all + gw
        annual.at[idx, "fin_invest_all"] = inv or None
        annual.at[idx, "cash_precious_pbc"] = cash_all or None
        annual.at[idx, "asset_other"] = max(ta - known_a, 0) if ta is not None else None

        fv_liab = sum(v for v in (_yuan(r.get("fvtpl_liab")), _yuan(r.get("derive_liab"))) if v is not None)
        ib_l = _yuan(r.get("interbank_liab")) or 0
        tl = _yuan(r.get("total_liab"))
        known_l = ((_yuan(r.get("deposits")) or 0) + ib_l + (_yuan(r.get("bond_payable")) or 0)
                   + (_yuan(r.get("loan_pbc")) or 0) + fv_liab)
        annual.at[idx, "fv_derive_liab"] = fv_liab or None
        annual.at[idx, "liab_other"] = max(tl - known_l, 0) if tl is not None else None

    profit_stack = stack([("int_ni", "利息净收入"), ("nonint", "非息收入")])
    asset_stack = stack([
        ("loans", "发放贷款及垫款"),
        ("fin_invest_all", "投资证券及其他金融资产"),
        ("cash_precious_pbc", "现金、贵金属及存放央行"),
        ("interbank_assets", "同业往来"),
        ("goodwill", "商誉"),
        ("asset_other", "其他资产"),
    ])
    liab_stack = stack([
        ("deposits", "客户存款"),
        ("interbank_liab", "同业往来"),
        ("loan_pbc", "向中央银行借款"),
        ("fv_derive_liab", "交易性金融负债及衍生金融负债"),
        ("bond_payable", "应付债券"),
        ("liab_other", "其他负债"),
    ])

    latest = annual.iloc[-1] if len(annual) else None

    def latest_pie(cols_labels):
        if latest is None:
            return []
        out = []
        for col, label in cols_labels:
            v = latest.get(col)
            if v is not None and pd.notna(v) and v > 0:
                out.append({"label": label, "value": round(v / YI, 2)})
        return out

    pie_date = str(latest["report_date"]) if latest is not None else None

    # ---- 利息收入（招行年报 3.2.3 / 3.2.5）----
    int_inc_pairs = [
        ("发放贷款及垫款", latest.get("int_inc_loan") if latest is not None else None),
        ("金融投资", latest.get("int_inc_invest") if latest is not None else None),
        ("存拆放同业", latest.get("int_inc_interbank") if latest is not None else None),
        ("存放中央银行", latest.get("int_inc_pbc") if latest is not None else None),
        ("其他利息收入", latest.get("int_inc_other") if latest is not None else None),
    ]
    int_inc_items, int_inc_pie = _breakdown(
        int_inc_pairs, total=_yuan(latest.get("int_income")) if latest is not None else None)
    int_inc_source = "notes" if int_inc_pie else "none"
    if not int_inc_items and latest is not None and _to_yi(latest.get("int_income")) is not None:
        int_inc_items = [{"label": "利息收入合计", "value": _to_yi(latest.get("int_income")), "share": 100.0}]

    # ---- 利息支出：公司/零售 × 活期/定期 + 同业/债券/央行（招行年报 3.2.4）----
    int_exp_pairs = [
        ("公司客户活期", latest.get("int_exp_corp_demand") if latest is not None else None),
        ("公司客户定期", latest.get("int_exp_corp_time") if latest is not None else None),
        ("零售客户活期", latest.get("int_exp_retail_demand") if latest is not None else None),
        ("零售客户定期", latest.get("int_exp_retail_time") if latest is not None else None),
        ("同业存拆放及其他", latest.get("int_exp_ib_other") if latest is not None else None),
        ("应付债券", latest.get("int_exp_bond") if latest is not None else None),
        ("向中央银行借款", latest.get("int_exp_pbc") if latest is not None else None),
    ]
    int_exp_items, int_exp_pie = _breakdown(
        int_exp_pairs, total=_yuan(latest.get("int_expense")) if latest is not None else None)
    has_four_exp = latest is not None and _yuan(latest.get("int_exp_corp_demand")) is not None
    int_exp_source = "notes" if has_four_exp else ("partial" if int_exp_pie else "none")
    if not int_exp_items and latest is not None and _to_yi(latest.get("int_expense")) is not None:
        int_exp_items = [{"label": "利息支出合计", "value": _to_yi(latest.get("int_expense")), "share": 100.0}]

    # ---- 存款余额：四分优先，否则活期/定期 + 公司/零售二分 ----
    four_bal_pairs = [
        ("公司活期", latest.get("dep_corp_demand") if latest is not None else None),
        ("公司定期", latest.get("dep_corp_time") if latest is not None else None),
        ("零售活期", latest.get("dep_retail_demand") if latest is not None else None),
        ("零售定期", latest.get("dep_retail_time") if latest is not None else None),
    ]
    dep4_items, dep4_pie = _breakdown(four_bal_pairs)
    dep_cust_items, dep_cust_pie = _breakdown([
        ("公司客户", latest.get("dep_corp") if latest is not None else None),
        ("零售客户", latest.get("dep_retail") if latest is not None else None),
    ])
    dep_tenor_items, dep_tenor_pie = _breakdown([
        ("活期", latest.get("dep_demand") if latest is not None else None),
        ("定期", latest.get("dep_time") if latest is not None else None),
    ])
    dep_bal_source = "notes4" if len(dep4_pie) >= 4 else ("ifind2" if (dep_cust_pie or dep_tenor_pie) else "none")

    # 合并表：四分存款余额 + 对应利息支出
    exp_by_label = {
        "公司活期": _to_yi(latest.get("int_exp_corp_demand") if latest is not None else None),
        "公司定期": _to_yi(latest.get("int_exp_corp_time") if latest is not None else None),
        "零售活期": _to_yi(latest.get("int_exp_retail_demand") if latest is not None else None),
        "零售定期": _to_yi(latest.get("int_exp_retail_time") if latest is not None else None),
    }
    dep_detail = []
    if dep4_items:
        exp_total = _yuan(latest.get("int_expense")) if latest is not None else None
        for it in dep4_items:
            ev = exp_by_label.get(it["label"])
            dep_detail.append({
                "label": it["label"],
                "balance": it["value"],
                "balance_share": it["share"],
                "interest": ev,
                "interest_share": round(ev / (exp_total / YI) * 100, 1) if ev is not None and exp_total else None,
            })
    elif dep_cust_items or dep_tenor_items:
        for it in dep_cust_items:
            dep_detail.append({"label": it["label"], "balance": it["value"], "balance_share": it["share"],
                               "interest": None, "interest_share": None})
        for it in dep_tenor_items:
            dep_detail.append({"label": it["label"], "balance": it["value"], "balance_share": it["share"],
                               "interest": None, "interest_share": None})

    # ---- 非利息净收入（招行年报 3.2.6）----
    nonint_pairs = [
        ("净手续费及佣金", latest.get("fee_ni") if latest is not None else None),
        ("投资收益", latest.get("invest_income") if latest is not None else None),
        ("公允价值变动", latest.get("fv_income") if latest is not None else None),
        ("汇兑净收益", latest.get("fx_income") if latest is not None else None),
        ("其他业务收入", latest.get("other_biz_income") if latest is not None else None),
        ("其他收益", latest.get("other_income") if latest is not None else None),
        ("资产处置收益", latest.get("asset_disposal") if latest is not None else None),
        ("其他非息", latest.get("nonint_other") if latest is not None else None),
    ]
    nonint_items, nonint_pie = _breakdown(
        nonint_pairs, total=_yuan(latest.get("nonint")) if latest is not None else None,
        pie_positive_only=True)
    if latest is not None:
        fee_in, fee_ex = _to_yi(latest.get("fee_income")), _to_yi(latest.get("fee_expense"))
        if fee_in is not None or fee_ex is not None:
            nonint_items.append({"label": "其中：手续费及佣金收入", "value": fee_in, "share": None, "note": True})
            nonint_items.append({"label": "其中：手续费及佣金支出", "value": fee_ex, "share": None, "note": True})

    int_inc_stack = stack([
        ("int_inc_loan", "发放贷款及垫款"), ("int_inc_invest", "金融投资"),
        ("int_inc_interbank", "存拆放同业"), ("int_inc_pbc", "存放中央银行"),
    ])
    int_exp_stack = stack([
        ("int_exp_corp_demand", "公司活期"), ("int_exp_corp_time", "公司定期"),
        ("int_exp_retail_demand", "零售活期"), ("int_exp_retail_time", "零售定期"),
        ("int_exp_ib_other", "同业存拆放及其他"), ("int_exp_bond", "应付债券"),
        ("int_exp_pbc", "向中央银行借款"),
    ])
    nonint_stack = stack([
        ("fee_ni", "净手续费及佣金"), ("invest_income", "投资收益"),
        ("fv_income", "公允价值变动"), ("fx_income", "汇兑净收益"),
        ("other_biz_income", "其他业务收入"), ("nonint_other", "其他非息"),
    ])
    dep4_stack = stack([
        ("dep_corp_demand", "公司活期"), ("dep_corp_time", "公司定期"),
        ("dep_retail_demand", "零售活期"), ("dep_retail_time", "零售定期"),
    ])
    invest_stack = stack([
        ("derive_asset", "衍生金融资产"),
        ("fin_invest_fvtpl", "交易性金融投资"),
        ("fin_invest_ac", "摊余成本投资"),
        ("fin_invest_fvoci", "其他综合收益投资"),
        ("long_equity", "长期股权投资"),
    ])
    ib_asset_stack = stack([
        ("deposit_interbank", "存放同业"),
        ("lend_fund", "拆出资金"),
        ("buy_resale", "买入返售金融资产"),
    ])
    cash_stack = stack([
        ("cash_pbc", "现金及存放中央银行款项"),
        ("precious_metal", "贵金属"),
    ])
    ib_liab_stack = stack([
        ("iofi_deposit", "同业及其他金融机构存放"),
        ("borrow_fund", "拆入资金"),
        ("sell_repo", "卖出回购金融资产"),
    ])

    def _stack_has_data(st: Dict[str, Any]) -> bool:
        for k, vals in st.items():
            if k == "dates":
                continue
            if any(v is not None for v in vals):
                return True
        return False

    L = latest
    asset_items, asset_pie = _breakdown([
        ("发放贷款及垫款", L.get("loans") if L is not None else None),
        ("投资证券及其他金融资产", L.get("fin_invest_all") if L is not None else None),
        ("现金、贵金属及存放央行", L.get("cash_precious_pbc") if L is not None else None),
        ("同业往来", L.get("interbank_assets") if L is not None else None),
        ("商誉", L.get("goodwill") if L is not None else None),
        ("其他资产", L.get("asset_other") if L is not None else None),
    ], total=_yuan(L.get("total_assets")) if L is not None else None)
    invest_items, invest_pie = _breakdown([
        ("衍生金融资产", L.get("derive_asset") if L is not None else None),
        ("以公允价值计量且其变动计入当期损益的金融投资", L.get("fin_invest_fvtpl") if L is not None else None),
        ("以摊余成本计量的债务工具投资", L.get("fin_invest_ac") if L is not None else None),
        ("以公允价值计量且其变动计入其他综合收益的金融资产", L.get("fin_invest_fvoci") if L is not None else None),
        ("长期股权投资", L.get("long_equity") if L is not None else None),
        ("其他权益工具投资", L.get("other_equity") if L is not None else None),
    ], total=_yuan(L.get("fin_invest_all")) if L is not None else None)
    ib_asset_items, ib_asset_pie = _breakdown([
        ("存放同业", L.get("deposit_interbank") if L is not None else None),
        ("拆出资金", L.get("lend_fund") if L is not None else None),
        ("买入返售金融资产", L.get("buy_resale") if L is not None else None),
    ])
    cash_items, cash_pie = _breakdown([
        ("现金及存放中央银行款项", L.get("cash_pbc") if L is not None else None),
        ("贵金属", L.get("precious_metal") if L is not None else None),
    ])
    other_asset_items, other_asset_pie = _breakdown([
        ("固定资产", L.get("fixed_asset") if L is not None else None),
        ("在建工程", L.get("cip") if L is not None else None),
        ("使用权资产", L.get("useright_asset") if L is not None else None),
        ("无形资产", L.get("intangible") if L is not None else None),
        ("投资性房地产", L.get("invest_realestate") if L is not None else None),
        ("递延所得税资产", L.get("defer_tax_asset") if L is not None else None),
        ("其他资产", L.get("other_asset") if L is not None else None),
    ])
    liab_items, liab_pie = _breakdown([
        ("客户存款", L.get("deposits") if L is not None else None),
        ("同业往来", L.get("interbank_liab") if L is not None else None),
        ("向中央银行借款", L.get("loan_pbc") if L is not None else None),
        ("交易性金融负债及衍生金融负债", L.get("fv_derive_liab") if L is not None else None),
        ("应付债券", L.get("bond_payable") if L is not None else None),
        ("其他负债", L.get("liab_other") if L is not None else None),
    ], total=_yuan(L.get("total_liab")) if L is not None else None)
    ib_liab_items, ib_liab_pie = _breakdown([
        ("同业及其他金融机构存放", L.get("iofi_deposit") if L is not None else None),
        ("拆入资金", L.get("borrow_fund") if L is not None else None),
        ("卖出回购金融资产", L.get("sell_repo") if L is not None else None),
    ])
    fv_liab_items, fv_liab_pie = _breakdown([
        ("交易性金融负债", L.get("fvtpl_liab") if L is not None else None),
        ("衍生金融负债", L.get("derive_liab") if L is not None else None),
    ])
    other_liab_items, _other_liab_pie = _breakdown([
        ("应付职工薪酬", L.get("staff_payable") if L is not None else None),
        ("应交税费", L.get("tax_payable") if L is not None else None),
        ("预计负债", L.get("predict_liab") if L is not None else None),
        ("租赁负债", L.get("lease_liab") if L is not None else None),
        ("递延所得税负债", L.get("defer_tax_liab") if L is not None else None),
        ("其他负债", L.get("other_liab_item") if L is not None else None),
    ])

    return {
        "dates": [r["report_date"] for _, r in annual.iterrows()],
        "profit": {
            "trend": {"dates": [r["report_date"] for _, r in annual.iterrows()],
                      "revenue": [_to_yi(r.get("revenue")) for _, r in annual.iterrows()],
                      "net_profit": [_to_yi(r.get("net_profit")) for _, r in annual.iterrows()],
                      "int_income": [_to_yi(r.get("int_income")) for _, r in annual.iterrows()],
                      "int_expense": [_to_yi(r.get("int_expense")) for _, r in annual.iterrows()]},
            "stack": profit_stack,
            "pie": latest_pie([("int_ni", "利息净收入"), ("nonint", "非息收入")]),
            "pie_date": pie_date,
            "int_income": {
                "source": int_inc_source,
                "note": ("科目对齐招行年报§3.2.3：贷款和垫款、投资、存拆放同业、存放央行"
                         if int_inc_source == "notes"
                         else "年报附注未披露利息收入拆项，仅有利润表利息收入合计"),
                "stack": int_inc_stack if _stack_has_data(int_inc_stack) else None,
                "pie": int_inc_pie,
                "items": int_inc_items,
                "total": _to_yi(latest.get("int_income")) if latest is not None else None,
            },
            "int_expense": {
                "source": int_exp_source,
                "note": ("科目对齐招行年报§3.2.4：公司/零售客户×活期/定期存款利息，以及同业、应付债券、向央行借款"
                         if has_four_exp
                         else "年报附注未披露存款利息四分拆项；下表为客户存款余额的公司/零售与活期/定期结构"),
                "stack": int_exp_stack if _stack_has_data(int_exp_stack) else None,
                "pie": int_exp_pie,
                "items": int_exp_items,
                "total": _to_yi(latest.get("int_expense")) if latest is not None else None,
                "deposit": {
                    "source": dep_bal_source,
                    "pie_four": dep4_pie,
                    "pie_customer": dep_cust_pie,
                    "pie_tenor": dep_tenor_pie,
                    "items": dep_detail,
                    "stack_four": dep4_stack if _stack_has_data(dep4_stack) else None,
                },
            },
            "nonint": {
                "source": "income",
                "note": "利润表口径，对应招行年报§3.2.6：净手续费及佣金 + 其他净收入（投资/公允/汇兑/其他业务）",
                "stack": nonint_stack if _stack_has_data(nonint_stack) else None,
                "pie": nonint_pie,
                "items": nonint_items,
                "total": _to_yi(latest.get("nonint")) if latest is not None else None,
            },
        },
        "assets": {
            "trend": {"dates": [r["report_date"] for _, r in annual.iterrows()],
                      "total_assets": [_to_yi(r.get("total_assets")) for _, r in annual.iterrows()],
                      "loans": [_to_yi(r.get("loans")) for _, r in annual.iterrows()],
                      "fin_invest_all": [_to_yi(r.get("fin_invest_all")) for _, r in annual.iterrows()]},
            "stack": asset_stack,
            "pie": asset_pie,
            "items": asset_items,
            "pie_date": pie_date,
            "note": "科目对齐招行年报§3.3.1。金额取合并资产负债表；与年报附注尾差多为应计利息或减值口径。",
            "invest": {
                "note": "对齐招行年报§3.3.1.2 投资证券及其他金融资产",
                "stack": invest_stack if _stack_has_data(invest_stack) else None,
                "pie": invest_pie,
                "items": invest_items,
                "total": _to_yi(L.get("fin_invest_all")) if L is not None else None,
            },
            "interbank": {
                "note": "同业往来 = 存放同业 + 拆出资金 + 买入返售",
                "stack": ib_asset_stack if _stack_has_data(ib_asset_stack) else None,
                "pie": ib_asset_pie,
                "items": ib_asset_items,
            },
            "cash": {
                "note": "对齐招行年报「现金、贵金属及存放中央银行款项」",
                "stack": cash_stack if _stack_has_data(cash_stack) else None,
                "pie": cash_pie,
                "items": cash_items,
            },
            "other": {
                "note": "年报「其他」主要包括固定资产、在建工程、使用权资产、无形资产、投资性房地产、递延所得税资产和其他资产",
                "pie": other_asset_pie,
                "items": other_asset_items,
            },
        },
        "liabilities": {
            "trend": {"dates": [r["report_date"] for _, r in annual.iterrows()],
                      "total_liab": [_to_yi(r.get("total_liab")) for _, r in annual.iterrows()],
                      "deposits": [_to_yi(r.get("deposits")) for _, r in annual.iterrows()],
                      "interbank_liab": [_to_yi(r.get("interbank_liab")) for _, r in annual.iterrows()]},
            "stack": liab_stack,
            "pie": liab_pie,
            "items": liab_items,
            "pie_date": pie_date,
            "note": "科目对齐招行年报§3.3.2。吸收存款含应计利息，年报客户存款多为不含息口径。",
            "deposit": {
                "source": dep_bal_source,
                "note": "对齐招行年报客户存款：公司/零售 × 活期/定期",
                "pie_four": dep4_pie,
                "pie_customer": dep_cust_pie,
                "pie_tenor": dep_tenor_pie,
                "items": [{"label": x["label"], "value": x.get("balance"), "share": x.get("balance_share")}
                          for x in dep_detail] if dep_detail else dep4_items,
                "stack_four": dep4_stack if _stack_has_data(dep4_stack) else None,
            },
            "interbank": {
                "note": "同业往来 = 同业存放 + 拆入资金 + 卖出回购",
                "stack": ib_liab_stack if _stack_has_data(ib_liab_stack) else None,
                "pie": ib_liab_pie,
                "items": ib_liab_items,
            },
            "trading": {
                "note": "以公允价值计量且其变动计入当期损益的金融负债及衍生金融负债",
                "pie": fv_liab_pie,
                "items": fv_liab_items,
            },
            "other": {
                "note": "年报「其他」包括应付职工薪酬、应交税费、租赁负债、预计负债、递延所得税负债和其他负债",
                "items": other_liab_items,
            },
        },
    }


INDICATOR_META = [
    ("A1", "nim", "NIM净息差", "%", 2), ("A2", "nonint_ratio", "非息收入占比", "%", 2),
    ("B1", "rev_cagr3", "营收增速(3年CAGR)", "%", 2), ("B2", "net_profit_yoy", "归母净利润增速", "%", 2),
    ("C1", "roe_weighted", "加权ROE", "%", 2), ("C2", "roa", "ROA", "%", 2),
    ("C3", "ni_ppop", "净利/PPOP", "x", 2), ("C4", "prov_loan", "拨贷比", "%", 2),
    ("C5", "d_prov_loan_bp", "拨贷比变动", "bp", 0),
    ("D1", "npl", "不良贷款率", "%", 2), ("D2", "special_mention", "关注类贷款比例", "%", 2),
    ("D3", "sm_yoy_bp", "关注类同比", "bp", 0), ("D4", "sm_over_npl", "关注/不良", "x", 2),
    ("D5", "npl_bal_yoy", "不良余额同比", "%", 2),
    ("E1", "cir", "成本收入比", "%", 2), ("E2", "dep_cost", "存款成本率(还原)", "%", 2),
    ("E3", "credit_cost", "信用成本率", "%", 2),
    ("F1", "cet1", "核心一级资本充足率", "%", 2), ("F2", "rwa_density", "RWA/总资产(风险密度)", "%", 2),
    ("F3", "div_payout", "现金分红率", "%", 2), ("F4", "refi_diluted", "近5年普通股摊薄(1=有)", "", 0),
    ("G1", "roe_over_pb", "ROE/PB隐含回报", "%", 2), ("G2", "div_yield", "股息率", "%", 2),
]


def build_indicators_section(metrics: pd.DataFrame) -> Dict[str, Any]:
    """模块3-8: 各打分项原始值全报告期序列（升序）。"""
    out_items = []
    for item_id, col, label, unit, digits in INDICATOR_META:
        series = []
        for _, r in metrics.iterrows():
            v = r.get(col) if col else None
            if v is None or (isinstance(v, float) and math.isnan(v)):
                series.append({"d": r["report_date"], "v": None})
            else:
                series.append({"d": r["report_date"], "v": round(float(v), digits + 2)})
        spec = ITEMS[item_id]
        out_items.append({
            "id": item_id, "label": label, "unit": unit, "digits": digits,
            "full": spec["full"], "x1": spec["x1"], "x0": spec["x0"], "up": spec["up"],
            "skip": bool(spec.get("skip")),
            "series": series,
        })
    return {"items": out_items}


def load_bank_metrics(code: str, name: str) -> Optional[Tuple[BankData, pd.DataFrame]]:
    bd = BankData(code, name).load()
    if bd.balance is None and bd.income is None:
        print(f"[skip] {code} {name}: 无三大报表数据")
        return None
    metrics = calc_metrics(bd)
    compute_cagr3(bd, metrics)
    compute_refi(bd, metrics)
    compute_quality_metrics(metrics)
    return bd, metrics


def score_metrics(bd: BankData, metrics: pd.DataFrame, *,
                  year_medians: Dict[int, Dict[str, float]],
                  anchor_medians: Dict[str, float],
                  g_val: float) -> dict:
    """对已算好的 metrics 打分并组装 score/scale/indicators。"""
    prev_yoy: Dict[int, Optional[float]] = {}
    annual = metrics[metrics["report_date"].astype(str).str[5:7] == "12"]
    for _, r in annual.iterrows():
        y = int(r["year"])
        yoy = r.get("revenue_yoy") if _finite(r.get("revenue_yoy")) else r.get("rev_yoy_fallback")
        prev_yoy[y] = float(yoy) if _finite(yoy) else None

    periods = []
    for _, r in metrics.iterrows():
        y = int(r["year"])
        periods.append(score_period(
            r, code=bd.code,
            year_medians=year_medians, anchor_medians=anchor_medians,
            g_val=g_val, prev_rev_yoy=prev_yoy.get(y - 1),
        ))
    annual_periods = [p for p in periods if p["total"] is not None]
    latest_annual = annual_periods[-1] if annual_periods else None

    for p in annual_periods:
        p["evaluations"] = build_evaluations(metrics, p)
        p["overall"] = build_overall_eval(metrics, p)

    score_section = {
        "formula_version": FORMULA_VERSION,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "note": "V2.0：六维公司打分（收入效率/收入增长/盈利质量/资产质量/成本控制/资本内生）；估值与定性不进总分",
        "periods": periods,
        "latest": latest_annual["report_date"] if latest_annual else None,
    }
    return {
        "score": score_section,
        "scale": build_scale_section(bd, metrics),
        "indicators": build_indicators_section(metrics),
    }


def process_bank(code: str, name: str, *,
                 year_medians: Optional[Dict[int, Dict[str, float]]] = None,
                 anchor_medians: Optional[Dict[str, float]] = None,
                 g_val: float = 0.0) -> Optional[dict]:
    loaded = load_bank_metrics(code, name)
    if loaded is None:
        return None
    bd, metrics = loaded
    return score_metrics(
        bd, metrics,
        year_medians=year_medians or {},
        anchor_medians=anchor_medians or {},
        g_val=g_val,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--banks", default="", help="仅处理指定代码（逗号分隔）")
    parser.add_argument("--check", action="store_true", help="只验证招行2025A锚点，不写文件")
    parser.add_argument("--eval-only", action="store_true",
                        help="只重写六维评述，不重算分数")
    parser.add_argument("--scale-only", action="store_true",
                        help="只重写 scale 规模构成，不重算分数")
    args = parser.parse_args()

    universe = pd.read_csv(UNIVERSE_CSV, dtype={"code": str})
    if args.banks:
        wanted = {c.strip().zfill(6) for c in args.banks.split(",") if c.strip()}
        universe = universe[universe["code"].isin(wanted)]

    g_table = load_g_scores()
    loaded_banks: List[Tuple[str, str, BankData, pd.DataFrame]] = []
    metrics_list: List[pd.DataFrame] = []
    for _, bank in universe.iterrows():
        code, name = str(bank["code"]).zfill(6), bank["name"]
        packed = load_bank_metrics(code, name)
        if packed is None:
            continue
        bd, metrics = packed
        loaded_banks.append((code, name, bd, metrics))
        metrics_list.append(metrics)

    year_medians, anchor_medians = collect_year_medians(metrics_list)
    score_summary: Dict[str, Any] = {}

    if args.eval_only:
        n_ok = 0
        for code, name, bd, metrics in loaded_banks:
            path = STOCK_DATA_DIR / f"{code}.json"
            if not path.exists():
                print(f"[skip] {code} {name}: 无 stock json")
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            n_eval = 0
            for p in (data.get("score") or {}).get("periods") or []:
                if not p.get("items") or not p.get("dimensions"):
                    continue
                if p.get("total") is None:
                    continue
                p["evaluations"] = build_evaluations(metrics, p)
                n_eval += 1
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            n_ok += 1
            print(f"[eval] {code} {name}: 重写 {n_eval} 个年报期评述")
        print(f"[eval] 完成 {n_ok} 家")
        return 0

    if args.scale_only:
        n_ok = 0
        for code, name, bd, metrics in loaded_banks:
            path = STOCK_DATA_DIR / f"{code}.json"
            if not path.exists():
                print(f"[skip] {code} {name}: 无 stock json")
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            data["scale"] = build_scale_section(bd, metrics)
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            n_ok += 1
            print(f"[scale] {code} {name}: 已更新盈利/资产负债构成")
        print(f"[scale] 完成 {n_ok} 家")
        return 0

    for code, name, bd, metrics in loaded_banks:
        g_val = float((g_table.get(code) or {}).get("g") or 0)
        result = score_metrics(
            bd, metrics,
            year_medians=year_medians, anchor_medians=anchor_medians, g_val=g_val,
        )
        if args.check:
            p = next((x for x in result["score"]["periods"] if x["report_date"] == "2025-12-31"), None)
            if p:
                print(f"\n=== {name} 2025A 打分明细（V2.0）===")
                for it, v in p["items"].items():
                    extra = f" {v.get('note')}" if v.get("note") else ""
                    print(f"  {it} {ITEMS[it]['name']}: value={v['value']} "
                          f"score={v['score']}/{v['full']} [{v['basis']}]{extra}")
                for d, dv in p["dimensions"].items():
                    tag = "" if dv.get("in_total", True) else "  [不进总分]"
                    print(f"  维度{d} {dv['name']}: {dv['score']}/{dv['full']}{tag}")
                print(f"  H观测={p.get('g')}（不进总分） 总分={p['total']} 等级={p['grade']} "
                      f"rankable={p.get('rankable')} vetos={p.get('vetos')}")
            continue
        path = STOCK_DATA_DIR / f"{code}.json"
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
        else:
            data = {"code": code, "name": name, "records": []}
        data.update(result)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        latest = result["score"]["latest"]
        p = next((x for x in result["score"]["periods"] if x["report_date"] == latest), None)
        if p and p["total"] is not None:
            items = p.get("items") or {}
            score_summary[code] = {
                "total": p["total"], "grade": p["grade"], "period": latest,
                "g": p.get("g") or 0, "rankable": p.get("rankable", True),
                "f1": (items.get("G1") or {}).get("value"),
                "f2": (items.get("G2") or {}).get("value"),
                "dims": {k: dv["score"] for k, dv in p["dimensions"].items()
                         if dv.get("in_total", True)},
            }
        print(f"[ok] {code} {name}: score写入，最新年报 {latest} 总分 {p['total'] if p else None} "
              f"{p['grade'] if p else ''}")

    if score_summary and not args.banks and not args.check:
        index_path = STOCK_DATA_DIR / "_index.json"
        if index_path.exists():
            index = json.loads(index_path.read_text(encoding="utf-8"))
            for entry in index.get("banks", []):
                s = score_summary.get(entry.get("code"))
                if s:
                    entry["score_summary"] = s
            index["score_note"] = (
                "综合打分=公式V2.0六维（收入效率/收入增长/盈利质量/资产质量/成本控制/资本内生；"
                "估值与定性不进总分；缺项重标；否决；rankable=false 不参与排序）"
            )
            index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[index] 打分摘要已写入 {index_path.name}（{len(score_summary)}家）")

    return 0


if __name__ == "__main__":
    sys.exit(main())
