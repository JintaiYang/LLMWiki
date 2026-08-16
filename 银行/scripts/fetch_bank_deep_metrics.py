#!/usr/bin/env python3
"""Fetch comprehensive bank metrics via AkShare for deep research docs.

This script retrieves income statements, balance sheets, financial analysis
indicators, and valuation data for 18 deep-research banks. It then computes
all derivable metrics from the 银行核心指标词典 and outputs a structured
JSON file per bank plus a combined summary.

Data sources (all via AkShare):
  - stock_financial_report_sina: 利润表 + 资产负债表 (Sina finance)
  - stock_financial_analysis_indicator: ROE/ROA/EPS etc. (Sina finance)
  - stock_value_em: PB/PE/market cap (East Money)
  - stock_fhps_em: dividend data (East Money)

NOTE: NIM, 不良率, 拨备覆盖率, CET1, LCR/NSFR, 活期/零售存款占比 etc.
are NOT available from AkShare interfaces. They must come from annual reports.
The script explicitly marks these as "not_available_from_akshare".
"""

from __future__ import annotations

import json
import os
import sys
import time
import warnings
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

warnings.filterwarnings("ignore")

try:
    import akshare as ak
except Exception as exc:
    print(f"AkShare import failed: {exc}", file=sys.stderr)
    sys.exit(1)

# ── 18 deep-research banks ──────────────────────────────────────────────

DEEP_BANKS: List[Dict[str, str]] = [
    {"code": "600036", "name": "招商银行", "market": "SH", "type": "股份行"},
    {"code": "601398", "name": "工商银行", "market": "SH", "type": "国有大行"},
    {"code": "601939", "name": "建设银行", "market": "SH", "type": "国有大行"},
    {"code": "601288", "name": "农业银行", "market": "SH", "type": "国有大行"},
    {"code": "601988", "name": "中国银行", "market": "SH", "type": "国有大行"},
    {"code": "601328", "name": "交通银行", "market": "SH", "type": "国有大行"},
    {"code": "601658", "name": "邮储银行", "market": "SH", "type": "国有大行"},
    {"code": "600000", "name": "浦发银行", "market": "SH", "type": "股份行"},
    {"code": "600016", "name": "民生银行", "market": "SH", "type": "股份行"},
    {"code": "601166", "name": "兴业银行", "market": "SH", "type": "股份行"},
    {"code": "601998", "name": "中信银行", "market": "SH", "type": "股份行"},
    {"code": "000001", "name": "平安银行", "market": "SZ", "type": "股份行"},
    {"code": "002142", "name": "宁波银行", "market": "SZ", "type": "城商行"},
    {"code": "600919", "name": "江苏银行", "market": "SH", "type": "城商行"},
    {"code": "600926", "name": "杭州银行", "market": "SH", "type": "城商行"},
    {"code": "601009", "name": "南京银行", "market": "SH", "type": "城商行"},
    {"code": "601838", "name": "成都银行", "market": "SH", "type": "城商行"},
    {"code": "601128", "name": "常熟银行", "market": "SH", "type": "农商行"},
]


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def safe_float(val: Any) -> Optional[float]:
    """Convert to float, return None on failure."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        f = float(val)
        if pd.isna(f):
            return None
        return f
    except (ValueError, TypeError):
        return None


def fmt_yi(val: Optional[float]) -> str:
    """Format raw RMB amount (元) to 亿元 string."""
    if val is None:
        return "—"
    yi = val / 1e8
    if abs(yi) >= 10000:
        return f"{yi/10000:.2f}万亿"
    return f"{yi:,.2f}亿"


def fmt_pct(val: Optional[float], decimals: int = 2) -> str:
    if val is None:
        return "—"
    return f"{val:.{decimals}f}%"


def fmt_ratio(val: Optional[float], decimals: int = 2) -> str:
    if val is None:
        return "—"
    return f"{val:.{decimals}f}"


# ── Sina report helper ──────────────────────────────────────────────────

def fetch_sina_report(code: str, market: str, symbol: str) -> Tuple[Optional[pd.DataFrame], Optional[pd.DataFrame]]:
    """Fetch income statement and balance sheet from Sina.
    
    Returns (income_df, balance_df) or (None, None) on failure.
    """
    sina_stock = f"{market.lower()}{code}"
    
    income_df = None
    balance_df = None
    
    for attempt in range(3):
        try:
            if income_df is None:
                income_df = ak.stock_financial_report_sina(stock=sina_stock, symbol="利润表")
                time.sleep(0.8)
            if balance_df is None:
                balance_df = ak.stock_financial_report_sina(stock=sina_stock, symbol="资产负债表")
                time.sleep(0.8)
            break
        except Exception as e:
            print(f"  [retry {attempt+1}/3] Sina report error for {code}: {e}", file=sys.stderr)
            time.sleep(2)
    
    return income_df, balance_df


def fetch_analysis_indicator(code: str) -> Optional[pd.DataFrame]:
    """Fetch financial analysis indicators from Sina."""
    for attempt in range(3):
        try:
            df = ak.stock_financial_analysis_indicator(symbol=code, start_year="2023")
            time.sleep(0.8)
            return df
        except Exception as e:
            print(f"  [retry {attempt+1}/3] Analysis indicator error for {code}: {e}", file=sys.stderr)
            time.sleep(2)
    return None


def fetch_valuation(code: str) -> Optional[pd.DataFrame]:
    """Fetch latest valuation (PB/PE/market cap) from East Money."""
    for attempt in range(3):
        try:
            df = ak.stock_value_em(symbol=code)
            time.sleep(0.8)
            return df
        except Exception as e:
            print(f"  [retry {attempt+1}/3] Valuation error for {code}: {e}", file=sys.stderr)
            time.sleep(2)
    return None


# ── Metric extraction ───────────────────────────────────────────────────

def extract_row_by_date(df: pd.DataFrame, target_date: str, date_col: str = "报告日") -> Optional[pd.Series]:
    """Find the row matching target_date (e.g. '20251231')."""
    if df is None or df.empty:
        return None
    date_str = str(target_date).replace("-", "")
    mask = df[date_col].astype(str).str.replace("-", "").str.startswith(date_str[:6])
    matches = df[mask]
    if matches.empty:
        return None
    return matches.iloc[0]


def extract_indicator_row(df: pd.DataFrame, target_date: str) -> Optional[pd.Series]:
    """Find indicator row matching target_date."""
    if df is None or df.empty:
        return None
    date_str = str(target_date).replace("-", "")
    mask = df["日期"].astype(str).str.replace("-", "").str.startswith(date_str[:6])
    matches = df[mask]
    if matches.empty:
        return None
    return matches.iloc[0]


def get_latest_valuation(df: pd.DataFrame) -> Optional[pd.Series]:
    """Get the latest row from valuation DataFrame."""
    if df is None or df.empty:
        return None
    return df.iloc[-1]


# ── Core metric builder ─────────────────────────────────────────────────

def build_bank_metrics(
    bank: Dict[str, str],
    income_df: Optional[pd.DataFrame],
    balance_df: Optional[pd.DataFrame],
    indicator_df: Optional[pd.DataFrame],
    valuation_df: Optional[pd.DataFrame],
    report_date: str = "20251231",
    prev_report_date: str = "20241231",
) -> Dict[str, Any]:
    """Build a comprehensive metrics dict for one bank."""
    
    code = bank["code"]
    name = bank["name"]
    
    result: Dict[str, Any] = {
        "bank_name": name,
        "bank_code": code,
        "bank_type": bank["type"],
        "report_period": "2025A",
        "data_source": "AkShare",
        "fetch_time": now_iso(),
        "report_date": report_date,
        "prev_report_date": prev_report_date,
        "metrics": {},
        "not_available_from_akshare": [],
        "errors": [],
    }
    
    metrics = result["metrics"]
    
    # ── Income Statement ──
    income_row = extract_row_by_date(income_df, report_date) if income_df is not None else None
    income_prev = extract_row_by_date(income_df, prev_report_date) if income_df is not None else None
    
    if income_row is not None:
        revenue = safe_float(income_row.get("营业收入"))
        net_int_income = safe_float(income_row.get("净利息收入"))
        int_income = safe_float(income_row.get("利息收入"))
        int_expense = safe_float(income_row.get("利息支出"))
        fee_income = safe_float(income_row.get("手续费及佣金净收入"))
        invest_income = safe_float(income_row.get("投资收益"))
        fv_change = safe_float(income_row.get("公允价值变动收益/(损失)"))
        biz_mgmt_fee = safe_float(income_row.get("业务及管理费用"))
        credit_impair = safe_float(income_row.get("信用减值损失"))
        asset_impair = safe_float(income_row.get("资产减值损失"))
        op_profit = safe_float(income_row.get("营业利润"))
        total_profit = safe_float(income_row.get("利润总额"))
        net_profit = safe_float(income_row.get("净利润"))
        parent_net_profit = safe_float(income_row.get("归属于母公司的净利润"))
        
        metrics["营业收入"] = {"value_yi": fmt_yi(revenue), "raw": revenue}
        metrics["净利息收入"] = {"value_yi": fmt_yi(net_int_income), "raw": net_int_income}
        metrics["利息收入"] = {"value_yi": fmt_yi(int_income), "raw": int_income}
        metrics["利息支出"] = {"value_yi": fmt_yi(int_expense), "raw": int_expense}
        metrics["手续费及佣金净收入"] = {"value_yi": fmt_yi(fee_income), "raw": fee_income}
        metrics["投资收益"] = {"value_yi": fmt_yi(invest_income), "raw": invest_income}
        metrics["公允价值变动收益"] = {"value_yi": fmt_yi(fv_change), "raw": fv_change}
        metrics["业务及管理费"] = {"value_yi": fmt_yi(biz_mgmt_fee), "raw": biz_mgmt_fee}
        metrics["信用减值损失"] = {"value_yi": fmt_yi(credit_impair), "raw": credit_impair}
        metrics["营业利润"] = {"value_yi": fmt_yi(op_profit), "raw": op_profit}
        metrics["利润总额"] = {"value_yi": fmt_yi(total_profit), "raw": total_profit}
        metrics["净利润"] = {"value_yi": fmt_yi(net_profit), "raw": net_profit}
        metrics["归母净利润"] = {"value_yi": fmt_yi(parent_net_profit), "raw": parent_net_profit}
        
        # Derived: 非息收入 = 营业收入 - 净利息收入
        if revenue is not None and net_int_income is not None:
            non_int_income = revenue - net_int_income
            metrics["非息收入"] = {"value_yi": fmt_yi(non_int_income), "raw": non_int_income}
        
        # Derived: PPOP = 营业收入 - 业务及管理费
        if revenue is not None and biz_mgmt_fee is not None:
            ppop = revenue - biz_mgmt_fee
            metrics["PPOP"] = {"value_yi": fmt_yi(ppop), "raw": ppop}
        
        # Derived: CIR (成本收入比)
        if revenue is not None and biz_mgmt_fee is not None and revenue > 0:
            cir = biz_mgmt_fee / revenue * 100
            metrics["成本收入比(CIR)"] = {"value_pct": fmt_pct(cir), "raw": cir}
        
        # Derived: 非息收入占比
        if revenue is not None and revenue > 0 and net_int_income is not None:
            non_int_ratio = (revenue - net_int_income) / revenue * 100
            metrics["非息收入占比"] = {"value_pct": fmt_pct(non_int_ratio), "raw": non_int_ratio}
        
        # Derived: 中收占比
        if revenue is not None and revenue > 0 and fee_income is not None:
            fee_ratio = fee_income / revenue * 100
            metrics["中收占比"] = {"value_pct": fmt_pct(fee_ratio), "raw": fee_ratio}
    else:
        result["errors"].append("利润表未获取到目标报告期数据")
    
    # Previous period income for YoY
    if income_prev is not None:
        prev_revenue = safe_float(income_prev.get("营业收入"))
        prev_net_profit = safe_float(income_prev.get("归属于母公司的净利润"))
        prev_net_int_income = safe_float(income_prev.get("净利息收入"))
        prev_fee_income = safe_float(income_prev.get("手续费及佣金净收入"))
        prev_biz_mgmt_fee = safe_float(income_prev.get("业务及管理费用"))
        prev_credit_impair = safe_float(income_prev.get("信用减值损失"))
        
        if prev_revenue is not None:
            metrics["营业收入_上年"] = {"value_yi": fmt_yi(prev_revenue), "raw": prev_revenue}
        if prev_net_profit is not None:
            metrics["归母净利润_上年"] = {"value_yi": fmt_yi(prev_net_profit), "raw": prev_net_profit}
        if prev_net_int_income is not None:
            metrics["净利息收入_上年"] = {"value_yi": fmt_yi(prev_net_int_income), "raw": prev_net_int_income}
        if prev_fee_income is not None:
            metrics["手续费及佣金净收入_上年"] = {"value_yi": fmt_yi(prev_fee_income), "raw": prev_fee_income}
        if prev_biz_mgmt_fee is not None:
            metrics["业务及管理费_上年"] = {"value_yi": fmt_yi(prev_biz_mgmt_fee), "raw": prev_biz_mgmt_fee}
        if prev_credit_impair is not None:
            metrics["信用减值损失_上年"] = {"value_yi": fmt_yi(prev_credit_impair), "raw": prev_credit_impair}
        
        # YoY growth rates
        cur_revenue = metrics.get("营业收入", {}).get("raw")
        cur_net_profit = metrics.get("归母净利润", {}).get("raw")
        cur_net_int = metrics.get("净利息收入", {}).get("raw")
        cur_fee = metrics.get("手续费及佣金净收入", {}).get("raw")
        
        if cur_revenue and prev_revenue and prev_revenue > 0:
            metrics["营业收入增速"] = {"value_pct": fmt_pct((cur_revenue/prev_revenue - 1)*100), "raw": (cur_revenue/prev_revenue - 1)*100}
        if cur_net_profit and prev_net_profit and prev_net_profit > 0:
            metrics["归母净利润增速"] = {"value_pct": fmt_pct((cur_net_profit/prev_net_profit - 1)*100), "raw": (cur_net_profit/prev_net_profit - 1)*100}
        if cur_net_int and prev_net_int_income and prev_net_int_income > 0:
            metrics["净利息收入增速"] = {"value_pct": fmt_pct((cur_net_int/prev_net_int_income - 1)*100), "raw": (cur_net_int/prev_net_int_income - 1)*100}
        if cur_fee and prev_fee_income and prev_fee_income > 0:
            metrics["中收增速"] = {"value_pct": fmt_pct((cur_fee/prev_fee_income - 1)*100), "raw": (cur_fee/prev_fee_income - 1)*100}
        
        # PPOP增速
        cur_ppop = metrics.get("PPOP", {}).get("raw")
        if cur_ppop and prev_revenue and prev_biz_mgmt_fee:
            prev_ppop = prev_revenue - prev_biz_mgmt_fee
            if prev_ppop > 0:
                metrics["PPOP增速"] = {"value_pct": fmt_pct((cur_ppop/prev_ppop - 1)*100), "raw": (cur_ppop/prev_ppop - 1)*100}
    
    # ── Balance Sheet ──
    balance_row = extract_row_by_date(balance_df, report_date) if balance_df is not None else None
    balance_prev = extract_row_by_date(balance_df, prev_report_date) if balance_df is not None else None
    
    if balance_row is not None:
        total_assets = safe_float(balance_row.get("资产总计"))
        total_loans = safe_float(balance_row.get("发放贷款及垫款"))
        loan_loss_reserve = safe_float(balance_row.get("减:贷款损失准备"))
        customer_deposits = safe_float(balance_row.get("客户存款(吸收存款)"))
        interbank_liab = safe_float(balance_row.get("同业存入及拆入"))
        bonds_payable = safe_float(balance_row.get("应付债券"))
        parent_equity = safe_float(balance_row.get("归属于母公司股东的权益"))
        total_equity = safe_float(balance_row.get("股东权益"))
        total_liab = safe_float(balance_row.get("负债合计"))
        share_capital = safe_float(balance_row.get("股本"))
        
        metrics["总资产"] = {"value_yi": fmt_yi(total_assets), "raw": total_assets}
        metrics["贷款总额"] = {"value_yi": fmt_yi(total_loans), "raw": total_loans}
        metrics["贷款损失准备"] = {"value_yi": fmt_yi(loan_loss_reserve), "raw": loan_loss_reserve}
        metrics["客户存款"] = {"value_yi": fmt_yi(customer_deposits), "raw": customer_deposits}
        metrics["同业负债"] = {"value_yi": fmt_yi(interbank_liab), "raw": interbank_liab}
        metrics["应付债券"] = {"value_yi": fmt_yi(bonds_payable), "raw": bonds_payable}
        metrics["归母净资产"] = {"value_yi": fmt_yi(parent_equity), "raw": parent_equity}
        metrics["股东权益合计"] = {"value_yi": fmt_yi(total_equity), "raw": total_equity}
        metrics["负债合计"] = {"value_yi": fmt_yi(total_liab), "raw": total_liab}
        metrics["股本"] = {"value_yi": fmt_yi(share_capital), "raw": share_capital}
        
        # Derived: 贷款/总资产
        if total_assets and total_assets > 0 and total_loans:
            metrics["贷款/总资产"] = {"value_pct": fmt_pct(total_loans/total_assets*100), "raw": total_loans/total_assets*100}
        
        # Derived: 存贷比
        if customer_deposits and customer_deposits > 0 and total_loans:
            metrics["存贷比"] = {"value_pct": fmt_pct(total_loans/customer_deposits*100), "raw": total_loans/customer_deposits*100}
        
        # Derived: 拨贷比 = 贷款损失准备 / 贷款总额
        if total_loans and total_loans > 0 and loan_loss_reserve:
            metrics["拨贷比"] = {"value_pct": fmt_pct(loan_loss_reserve/total_loans*100), "raw": loan_loss_reserve/total_loans*100}
        
        # Derived: 同业负债占比 (粗略，仅含同业存入及拆入，不含NCD)
        if total_liab and total_liab > 0 and interbank_liab:
            metrics["同业负债占比(粗略)"] = {"value_pct": fmt_pct(interbank_liab/total_liab*100), "raw": interbank_liab/total_liab*100}
        
        # Derived: 杠杆倍数 = 总资产 / 归母净资产
        if parent_equity and parent_equity > 0 and total_assets:
            metrics["杠杆倍数"] = {"value": fmt_ratio(total_assets/parent_equity), "raw": total_assets/parent_equity}
        
        # Derived: 资产负债率
        if total_assets and total_assets > 0 and total_liab:
            metrics["资产负债率"] = {"value_pct": fmt_pct(total_liab/total_assets*100), "raw": total_liab/total_assets*100}
    else:
        result["errors"].append("资产负债表未获取到目标报告期数据")
    
    # Previous balance sheet for YoY
    if balance_prev is not None:
        prev_total_assets = safe_float(balance_prev.get("资产总计"))
        prev_total_loans = safe_float(balance_prev.get("发放贷款及垫款"))
        prev_customer_deposits = safe_float(balance_prev.get("客户存款(吸收存款)"))
        prev_parent_equity = safe_float(balance_prev.get("归属于母公司股东的权益"))
        prev_loan_loss_reserve = safe_float(balance_prev.get("减:贷款损失准备"))
        
        if prev_total_assets:
            metrics["总资产_上年"] = {"value_yi": fmt_yi(prev_total_assets), "raw": prev_total_assets}
        if prev_total_loans:
            metrics["贷款总额_上年"] = {"value_yi": fmt_yi(prev_total_loans), "raw": prev_total_loans}
        if prev_customer_deposits:
            metrics["客户存款_上年"] = {"value_yi": fmt_yi(prev_customer_deposits), "raw": prev_customer_deposits}
        if prev_parent_equity:
            metrics["归母净资产_上年"] = {"value_yi": fmt_yi(prev_parent_equity), "raw": prev_parent_equity}
        if prev_loan_loss_reserve:
            metrics["贷款损失准备_上年"] = {"value_yi": fmt_yi(prev_loan_loss_reserve), "raw": prev_loan_loss_reserve}
        
        # Growth rates
        cur_assets = metrics.get("总资产", {}).get("raw")
        cur_loans = metrics.get("贷款总额", {}).get("raw")
        cur_deposits = metrics.get("客户存款", {}).get("raw")
        cur_equity = metrics.get("归母净资产", {}).get("raw")
        
        if cur_assets and prev_total_assets and prev_total_assets > 0:
            metrics["总资产增速"] = {"value_pct": fmt_pct((cur_assets/prev_total_assets - 1)*100), "raw": (cur_assets/prev_total_assets - 1)*100}
        if cur_loans and prev_total_loans and prev_total_loans > 0:
            metrics["贷款增速"] = {"value_pct": fmt_pct((cur_loans/prev_total_loans - 1)*100), "raw": (cur_loans/prev_total_loans - 1)*100}
        if cur_deposits and prev_customer_deposits and prev_customer_deposits > 0:
            metrics["存款增速"] = {"value_pct": fmt_pct((cur_deposits/prev_customer_deposits - 1)*100), "raw": (cur_deposits/prev_customer_deposits - 1)*100}
        if cur_equity and prev_parent_equity and prev_parent_equity > 0:
            metrics["净资产增速"] = {"value_pct": fmt_pct((cur_equity/prev_parent_equity - 1)*100), "raw": (cur_equity/prev_parent_equity - 1)*100}
    
    # ── Financial Analysis Indicators ──
    indicator_row = extract_indicator_row(indicator_df, report_date) if indicator_df is not None else None
    
    if indicator_row is not None:
        roe = safe_float(indicator_row.get("净资产收益率(%)"))
        weighted_roe = safe_float(indicator_row.get("加权净资产收益率(%)"))
        roa = safe_float(indicator_row.get("总资产净利润率(%)"))
        eps = safe_float(indicator_row.get("摊薄每股收益(元)"))
        bvps = safe_float(indicator_row.get("每股净资产_调整前(元)"))
        div_payout = safe_float(indicator_row.get("股息发放率(%)"))
        
        metrics["ROE(摊薄)"] = {"value_pct": fmt_pct(roe), "raw": roe}
        metrics["加权ROE"] = {"value_pct": fmt_pct(weighted_roe), "raw": weighted_roe}
        metrics["ROA"] = {"value_pct": fmt_pct(roa), "raw": roa}
        metrics["EPS"] = {"value": fmt_ratio(eps), "raw": eps}
        metrics["每股净资产"] = {"value": fmt_ratio(bvps), "raw": bvps}
        if div_payout is not None:
            metrics["股息发放率"] = {"value_pct": fmt_pct(div_payout), "raw": div_payout}
    else:
        result["errors"].append("财务分析指标未获取到目标报告期数据")
    
    # ── Valuation ──
    val_row = get_latest_valuation(valuation_df) if valuation_df is not None else None
    
    if val_row is not None:
        close_price = safe_float(val_row.get("当日收盘价"))
        total_mkt_cap = safe_float(val_row.get("总市值"))
        pb = safe_float(val_row.get("市净率"))
        pe_ttm = safe_float(val_row.get("PE(TTM)"))
        pe_static = safe_float(val_row.get("PE(静)"))
        val_date = str(val_row.get("数据日期", ""))
        
        metrics["收盘价"] = {"value": fmt_ratio(close_price), "raw": close_price, "date": val_date}
        metrics["总市值"] = {"value_yi": fmt_yi(total_mkt_cap), "raw": total_mkt_cap}
        metrics["PB"] = {"value": fmt_ratio(pb), "raw": pb}
        metrics["PE(TTM)"] = {"value": fmt_ratio(pe_ttm), "raw": pe_ttm}
        metrics["PE(静)"] = {"value": fmt_ratio(pe_static), "raw": pe_static}
        
        # Derived: 股息率 (approximate using latest dividend yield from stock_fhps_em if available)
        # Will be filled separately if dividend data exists
    else:
        result["errors"].append("估值数据未获取到")
    
    # ── Derived: 信用成本率 = 信用减值损失 / 平均贷款余额 ──
    credit_impair = metrics.get("信用减值损失", {}).get("raw")
    prev_loans = metrics.get("贷款总额_上年", {}).get("raw")
    cur_loans = metrics.get("贷款总额", {}).get("raw")
    if credit_impair and prev_loans and cur_loans:
        avg_loans = (prev_loans + cur_loans) / 2
        if avg_loans > 0:
            credit_cost = credit_impair / avg_loans * 100
            metrics["信用成本率"] = {"value_pct": fmt_pct(credit_cost), "raw": credit_cost}
    
    # ── Derived: 内生增长率 = ROE × (1 - 分红率) ──
    roe_val = metrics.get("加权ROE", {}).get("raw") or metrics.get("ROE(摊薄)", {}).get("raw")
    div_rate = metrics.get("股息发放率", {}).get("raw")
    if roe_val and div_rate is not None:
        internal_growth = roe_val * (1 - div_rate / 100)
        metrics["内生增长率(机械计算)"] = {"value_pct": fmt_pct(internal_growth), "raw": internal_growth}
    
    # ── Indicators NOT available from AkShare ──
    not_available = [
        "NIM（净息差）", "净利差",
        "不良贷款率", "关注类贷款比例", "逾期90天以上比例",
        "不良/逾期90天剪刀差", "新生成不良率",
        "拨备覆盖率",
        "CET1（核心一级资本充足率）", "一级资本充足率", "资本充足率(CAR)",
        "杠杆率（监管口径）", "RWA增速",
        "LCR（流动性覆盖率）", "NSFR（净稳定资金比例）",
        "流动性比例", "核心负债依存度",
        "活期存款占比", "零售存款占比", "零售贷款占比",
        "存款成本率", "资产收益率(生息资产)", "负债成本率(计息负债)",
        "金融投资三分类占比(AC/FVTPL/FVOCI)",
    ]
    result["not_available_from_akshare"] = not_available
    
    return result


# ── Evaluation generator ────────────────────────────────────────────────

def generate_evaluation(metrics: Dict[str, Any]) -> Dict[str, str]:
    """Generate qualitative evaluations based on AkShare data only.
    
    IMPORTANT: Only uses data available from AkShare. Does NOT speculate
    about NIM, NPL, provisioning coverage, CET1 etc. which are not available.
    """
    m = metrics["metrics"]
    
    # ── 盈利能力评价 ──
    roe = m.get("加权ROE", {}).get("raw") or m.get("ROE(摊薄)", {}).get("raw")
    roa = m.get("ROA", {}).get("raw")
    revenue_growth = m.get("营业收入增速", {}).get("raw")
    profit_growth = m.get("归母净利润增速", {}).get("raw")
    cir = m.get("成本收入比(CIR)", {}).get("raw")
    non_int_ratio = m.get("非息收入占比", {}).get("raw")
    fee_ratio = m.get("中收占比", {}).get("raw")
    nim_growth = m.get("净利息收入增速", {}).get("raw")
    
    profit_parts = []
    if roe is not None:
        if roe >= 13:
            profit_parts.append(f"加权ROE {roe:.2f}%，在行业属优秀水平（>12%为优秀线）")
        elif roe >= 10:
            profit_parts.append(f"加权ROE {roe:.2f}%，处于行业及格线以上（>10%为及格）")
        elif roe >= 8:
            profit_parts.append(f"加权ROE {roe:.2f}%，低于行业及格线但尚可维持")
        else:
            profit_parts.append(f"加权ROE {roe:.2f}%，盈利能力偏弱（<8%）")
    else:
        profit_parts.append("加权ROE 数据缺失，无法评价盈利能力核心指标")
    
    if roa is not None:
        if roa >= 1.0:
            profit_parts.append(f"ROA {roa:.2f}%，资产赚钱效率优秀（>0.8%为优秀）")
        elif roa >= 0.6:
            profit_parts.append(f"ROA {roa:.2f}%，资产赚钱效率及格")
        else:
            profit_parts.append(f"ROA {roa:.2f}%，资产赚钱效率偏低")
    
    if revenue_growth is not None:
        if revenue_growth > 5:
            profit_parts.append(f"营业收入增速 +{revenue_growth:.2f}%，收入端正增长")
        elif revenue_growth > 0:
            profit_parts.append(f"营业收入增速 +{revenue_growth:.2f}%，收入微增")
        elif revenue_growth > -5:
            profit_parts.append(f"营业收入增速 {revenue_growth:.2f}%，收入承压")
        else:
            profit_parts.append(f"营业收入增速 {revenue_growth:.2f}%，收入明显下滑")
    
    if profit_growth is not None:
        if profit_growth > 5:
            profit_parts.append(f"归母净利润增速 +{profit_growth:.2f}%")
        elif profit_growth > 0:
            profit_parts.append(f"归母净利润增速 +{profit_growth:.2f}%（微增）")
        else:
            profit_parts.append(f"归母净利润增速 {profit_growth:.2f}%（负增长）")
    
    if cir is not None:
        if cir < 30:
            profit_parts.append(f"成本收入比 {cir:.2f}%，成本控制优秀（<30%为优秀）")
        elif cir < 35:
            profit_parts.append(f"成本收入比 {cir:.2f}%，成本控制及格")
        else:
            profit_parts.append(f"成本收入比 {cir:.2f}%，成本偏高（>35%）")
    
    if non_int_ratio is not None:
        if non_int_ratio > 30:
            profit_parts.append(f"非息收入占比 {non_int_ratio:.2f}%，收入结构多元（>30%为优秀）")
        elif non_int_ratio > 20:
            profit_parts.append(f"非息收入占比 {non_int_ratio:.2f}%，非息收入及格")
        else:
            profit_parts.append(f"非息收入占比 {non_int_ratio:.2f}%，收入依赖利差")
    
    # PPOP vs net profit growth quality
    ppop_growth = m.get("PPOP增速", {}).get("raw")
    if ppop_growth is not None and profit_growth is not None:
        if ppop_growth > profit_growth + 2:
            profit_parts.append(f"PPOP增速({ppop_growth:.2f}%)高于净利润增速({profit_growth:.2f}%)，拨备在消耗利润")
        elif ppop_growth < profit_growth - 2:
            profit_parts.append(f"PPOP增速({ppop_growth:.2f}%)低于净利润增速({profit_growth:.2f}%)，可能存在拨备释放")
        else:
            profit_parts.append(f"PPOP增速({ppop_growth:.2f}%)与净利润增速({profit_growth:.2f}%)方向一致，盈利质量相对真实")
    
    profit_eval = "；".join(profit_parts) + "。" if profit_parts else "数据不足，无法评价。"
    
    # ── 资产质量评价 ──
    asset_parts = []
    
    credit_cost = m.get("信用成本率", {}).get("raw")
    credit_impair = m.get("信用减值损失", {}).get("raw")
    prev_credit_impair = m.get("信用减值损失_上年", {}).get("raw")
    loan_loss_reserve = m.get("贷款损失准备", {}).get("raw")
    total_loans = m.get("贷款总额", {}).get("raw")
    prov_loan_ratio = m.get("拨贷比", {}).get("raw")
    
    if prov_loan_ratio is not None:
        if prov_loan_ratio >= 3.0:
            asset_parts.append(f"拨贷比 {prov_loan_ratio:.2f}%，拨备厚度充足（>3.0%为充足）")
        elif prov_loan_ratio >= 2.5:
            asset_parts.append(f"拨贷比 {prov_loan_ratio:.2f}%，拨备处于监管上限附近")
        else:
            asset_parts.append(f"拨贷比 {prov_loan_ratio:.2f}%，拨备偏薄")
    
    if credit_cost is not None:
        if credit_cost < 0.8:
            asset_parts.append(f"信用成本率 {credit_cost:.2f}%，当期风险定价良好（<0.8%为优秀）")
        elif credit_cost < 1.0:
            asset_parts.append(f"信用成本率 {credit_cost:.2f}%，信用成本及格")
        else:
            asset_parts.append(f"信用成本率 {credit_cost:.2f}%，信用成本偏高")
    
    if credit_impair is not None and prev_credit_impair is not None:
        impair_change = (credit_impair / prev_credit_impair - 1) * 100 if prev_credit_impair > 0 else None
        if impair_change is not None:
            if impair_change > 10:
                asset_parts.append(f"信用减值损失同比增长 {impair_change:.1f}%，减值计提增加")
            elif impair_change < -10:
                asset_parts.append(f"信用减值损失同比下降 {abs(impair_change):.1f}%，减值计提减少（需关注是否少提拨备）")
            else:
                asset_parts.append(f"信用减值损失同比基本持平（{impair_change:+.1f}%）")
    
    # Not available from AkShare
    asset_parts.append("不良率、关注类比例、逾期90天以上比例、拨备覆盖率、新生成不良率等核心资产质量指标需从年报附注获取，AkShare财务报表接口无法提供")
    
    asset_eval = "；".join(asset_parts) + "。" if asset_parts else "数据不足，无法评价。"
    
    # ── 资产风险评价 ──
    risk_parts = []
    
    loan_ratio = m.get("贷款/总资产", {}).get("raw")
    if loan_ratio is not None:
        if 50 <= loan_ratio <= 65:
            risk_parts.append(f"贷款/总资产 {loan_ratio:.2f}%，处于合理区间（50%-65%），资产结构回归本源")
        elif loan_ratio > 65:
            risk_parts.append(f"贷款/总资产 {loan_ratio:.2f}%，贷款占比偏高，信用风险暴露集中")
        elif loan_ratio < 50:
            risk_parts.append(f"贷款/总资产 {loan_ratio:.2f}%，贷款占比偏低，非信贷资产（债券/同业）占比高")
    
    ldr = m.get("存贷比", {}).get("raw")
    if ldr is not None:
        if ldr > 90:
            risk_parts.append(f"存贷比 {ldr:.2f}%偏高，依赖主动负债")
        elif ldr < 70:
            risk_parts.append(f"存贷比 {ldr:.2f}%偏低，可能存在资产荒")
        else:
            risk_parts.append(f"存贷比 {ldr:.2f}%处于合理区间（70%-85%）")
    
    interbank_ratio = m.get("同业负债占比(粗略)", {}).get("raw")
    if interbank_ratio is not None:
        if interbank_ratio > 25:
            risk_parts.append(f"同业负债占比(粗略，不含NCD) {interbank_ratio:.2f}%偏高，负债稳定性需关注")
        elif interbank_ratio < 15:
            risk_parts.append(f"同业负债占比(粗略) {interbank_ratio:.2f}%，负债结构以存款为主")
        else:
            risk_parts.append(f"同业负债占比(粗略) {interbank_ratio:.2f}%，适中")
    
    leverage = m.get("杠杆倍数", {}).get("raw")
    if leverage is not None:
        if leverage > 16:
            risk_parts.append(f"杠杆倍数 {leverage:.2f}倍，杠杆偏高")
        elif leverage < 12:
            risk_parts.append(f"杠杆倍数 {leverage:.2f}倍，杠杆偏低")
        else:
            risk_parts.append(f"杠杆倍数 {leverage:.2f}倍，行业正常区间（12-16倍）")
    
    asset_growth = m.get("总资产增速", {}).get("raw")
    loan_growth = m.get("贷款增速", {}).get("raw")
    if asset_growth is not None and loan_growth is not None:
        if asset_growth > loan_growth + 3:
            risk_parts.append(f"总资产增速({asset_growth:.2f}%)快于贷款增速({loan_growth:.2f}%)，非信贷资产扩张更快")
        elif loan_growth > asset_growth + 3:
            risk_parts.append(f"贷款增速({loan_growth:.2f}%)快于总资产增速({asset_growth:.2f}%)，信贷投放积极")
    
    risk_parts.append("不良率、逾期、CET1、LCR/NSFR等核心风险指标需从年报获取")
    
    risk_eval = "；".join(risk_parts) + "。" if risk_parts else "数据不足，无法评价。"
    
    # ── 可持续性评价 ──
    sustain_parts = []
    
    div_rate = m.get("股息发放率", {}).get("raw")
    if roe is not None and div_rate is not None:
        internal_growth = roe * (1 - div_rate / 100)
        if internal_growth >= 8:
            sustain_parts.append(f"内生增长率(机械计算) {internal_growth:.2f}%，资本内生能力强（>8%可支撑中等增速扩张）")
        elif internal_growth >= 5:
            sustain_parts.append(f"内生增长率(机械计算) {internal_growth:.2f}%，可支撑低速扩张")
        else:
            sustain_parts.append(f"内生增长率(机械计算) {internal_growth:.2f}%，资本内生能力偏弱，扩张可能需外部融资")
    
    equity_growth = m.get("净资产增速", {}).get("raw")
    asset_growth_val = m.get("总资产增速", {}).get("raw")
    if equity_growth is not None and asset_growth_val is not None:
        if asset_growth_val > equity_growth + 3:
            sustain_parts.append(f"扩表增速({asset_growth_val:.2f}%)快于净资产增速({equity_growth:.2f}%)，资本在消耗")
        elif equity_growth >= asset_growth_val:
            sustain_parts.append(f"净资产增速({equity_growth:.2f}%)跟得上扩表增速({asset_growth_val:.2f}%)，资本积累稳健")
    
    pb = m.get("PB", {}).get("raw")
    if pb is not None and roe is not None:
        implied_return = roe / pb if pb > 0 else None
        if implied_return is not None:
            sustain_parts.append(f"当前PB {pb:.2f}倍，对应隐含回报率约 {implied_return:.1f}%")
            if pb < 0.6:
                sustain_parts.append("PB显著低于1倍，市场定价偏悲观")
            elif pb < 1.0:
                sustain_parts.append("PB低于1倍，估值折价")
            elif pb > 1.5:
                sustain_parts.append("PB高于1.5倍，市场给予溢价")
    
    sustain_parts.append("CET1、RWA增速、LCR/NSFR等可持续性核心指标需从年报获取")
    
    sustain_eval = "；".join(sustain_parts) + "。" if sustain_parts else "数据不足，无法评价。"
    
    return {
        "盈利能力评价": profit_eval,
        "资产质量评价": asset_eval,
        "资产风险评价": risk_eval,
        "可持续性评价": sustain_eval,
    }


# ── Main ────────────────────────────────────────────────────────────────

def main():
    vault = Path("/Users/yangjintai/Documents/LLM wiki/银行")
    output_dir = vault / "02_原始资料" / "04_AkShare数据" / "深度采集"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    all_results: List[Dict[str, Any]] = []
    
    print(f"=== 银行深度指标采集开始 {now_iso()} ===")
    print(f"共 {len(DEEP_BANKS)} 家银行\n")
    
    for i, bank in enumerate(DEEP_BANKS, 1):
        code = bank["code"]
        name = bank["name"]
        print(f"[{i}/{len(DEEP_BANKS)}] {name} ({code})")
        
        # Fetch data
        income_df, balance_df = fetch_sina_report(code, bank["market"], "利润表")
        indicator_df = fetch_analysis_indicator(code)
        valuation_df = fetch_valuation(code)
        
        # Build metrics
        result = build_bank_metrics(
            bank=bank,
            income_df=income_df,
            balance_df=balance_df,
            indicator_df=indicator_df,
            valuation_df=valuation_df,
        )
        
        # Generate evaluations
        evaluations = generate_evaluation(result)
        result["evaluations"] = evaluations
        
        # Print summary
        m = result["metrics"]
        print(f"  营收: {m.get('营业收入', {}).get('value_yi', '—')}")
        print(f"  归母净利润: {m.get('归母净利润', {}).get('value_yi', '—')}")
        print(f"  加权ROE: {m.get('加权ROE', {}).get('value_pct', '—')}")
        print(f"  总资产: {m.get('总资产', {}).get('value_yi', '—')}")
        print(f"  PB: {m.get('PB', {}).get('value', '—')}")
        if result["errors"]:
            print(f"  ⚠ 错误: {'; '.join(result['errors'])}")
        print()
        
        # Save individual file
        bank_file = output_dir / f"{code}_{name}_deep_metrics.json"
        with open(bank_file, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        
        all_results.append(result)
    
    # Save combined file
    combined_file = output_dir / "all_banks_deep_metrics.json"
    combined = {
        "generated_at": now_iso(),
        "bank_count": len(all_results),
        "data_source": "AkShare",
        "banks": all_results,
    }
    with open(combined_file, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)
    
    print(f"\n=== 采集完成 {now_iso()} ===")
    print(f"共 {len(all_results)} 家银行")
    print(f"输出目录: {output_dir}")
    print(f"合并文件: {combined_file}")


if __name__ == "__main__":
    main()
