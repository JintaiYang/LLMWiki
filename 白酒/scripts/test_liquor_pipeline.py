"""离线契约与财务模型回归测试。"""
import csv
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import liquor_pipeline as p


class PipelineTests(unittest.TestCase):
    def test_peer_percentile_handles_outliers_ties_and_direction(self):
        values = [0, 1, 2, 3, 1000]
        stat = {"values": values, "peer_count": len(values), "p05": p._percentile(values, 0.05), "p95": p._percentile(values, 0.95)}
        self.assertEqual(p._relative_percentile(2, stat), 0.5)
        self.assertEqual(p._relative_percentile(3, stat), 0.75)
        self.assertEqual(p._relative_percentile(3, stat, True), 0.25)
        tied = {"values": [0, 2, 2, 2, 1000], "peer_count": 5, "p05": 0.4, "p95": 800.4}
        self.assertEqual(p._relative_percentile(2, tied), 0.5)
        self.assertIsNone(p._relative_percentile(2, {**stat, "peer_count": 4}))

    def test_no_data_is_not_zero_or_ranked(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "RAW", Path(tmp)), patch.object(p, "SUPPLEMENT", Path(tmp) / "absent.csv"), patch.object(p, "SHARES", Path(tmp) / "absent-shares.csv"), patch.object(p, "QUALITATIVE", Path(tmp) / "absent-evidence.csv"):
            data, industry = p.build("2026-09-28")
        self.assertEqual(len(data["companies"]), len(p.COMPANIES))
        self.assertEqual(len(data["companies"][0]["annual"]), 20)
        self.assertEqual([row["year"] for row in data["companies"][0]["annual"]], list(range(2006, 2026)))
        self.assertEqual(data["history"]["baseline_year"], 2005)
        self.assertIsNone(data["companies"][0]["annual"][0]["revenue"])
        self.assertIsNone(data["companies"][0]["score"]["total"])
        self.assertFalse(data["companies"][0]["score"]["rankable"])
        self.assertEqual(data["companies"][0]["dcf"]["status"], "insufficient_inputs")
        self.assertEqual(industry["series"], [])
        self.assertFalse(industry["sample"]["representative"])
        self.assertEqual(len(industry["sample_series"]), 3)
        self.assertTrue(all(point["value"] is None for series in industry["sample_series"] for point in series["points"]))

    def test_fcff_requires_inputs_and_uses_prior_balance(self):
        previous = {k: 10.0 for k in p.FIELDS}
        previous.update(inventory=20, receivables=10, other_receivables=5, payables=10, contract_liabilities=10, finance_expense=0)
        current = dict(previous)
        current.update(revenue=100, cost=40, operating_profit=30, total_profit=25,
                       income_tax=5, depreciation=3, amortization=2, capex=8,
                       interest_expense=4, interest_income=1, lease_amortization=1,
                       inventory=30, receivables=10, other_receivables=5, payables=10, contract_liabilities=10)
        out = dict(current)
        p.derive(out, previous, {}, "2025-12-31")
        self.assertAlmostEqual(out["gross_margin"], 60)
        # operating_profit * 0.8 + 3 + 2 + 1 - 8 - (NWC_current - NWC_prior)
        self.assertAlmostEqual(out["fcff"], 12.0)
        self.assertEqual(out["fcff_adjustment"]["missing"], [])
        current["capex"] = None
        p.derive(current, previous, {}, "2025-12-31")
        self.assertIsNone(current["fcff"])
        self.assertIn("capex", current["fcff_adjustment"]["missing"])

    def test_conflict_blocks_value_and_traces_both(self):
        statements = {k: {} for k in p.STATEMENTS}
        statements["income"] = {"2025-12-31": {"OPERATE_INCOME": "100", "NOTICE_DATE": "2026-03-01"}}
        extra = {("600519", "2025-12-31", "revenue"): {"value": "110", "source": "iFind: revenue", "source_date": "2026-03-02"}}
        prov, conflicts = {}, []
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "RAW", Path(tmp)):
            path = Path(tmp) / "income" / "600519.csv"
            path.parent.mkdir(parents=True)
            path.write_text("REPORT_DATE\n2025-12-31\n")
            self.assertIsNone(p.resolve("600519", "2025-12-31", "revenue", statements, extra, prov, conflicts, "2026-03-03"))
            self.assertEqual(p.resolve("600519", "2025-12-31", "revenue", statements, extra, {}, [], "2026-03-01"), 100)
        self.assertEqual(conflicts[0]["ifind_value"], 110)
        self.assertEqual(prov["2025-12-31.revenue"]["status"], "unresolved_conflict")

    def test_verified_net_zero_fills_blank_without_general_null_to_zero(self):
        statements = {kind: {} for kind in p.STATEMENTS}
        statements['balance']['2021-12-31'] = {'ACCOUNTS_RECE': ''}
        supplement = {('600519', '2021-12-31', 'receivables'): {
            'value': '0', 'source': 'iFind:search_notice:2021年报合并应收余额减坏账准备',
            'source_date': '2022-03-31', 'unit': 'CNY'}}
        provenance, conflicts = {}, []
        self.assertIsNone(p.resolve('600519', '2021-12-31', 'receivables', statements, {}, {}, [], '2026-10-10'))
        self.assertIsNone(p.resolve('600519', '2021-12-31', 'receivables', statements, supplement, {}, [], '2022-03-30'))
        value = p.resolve('600519', '2021-12-31', 'receivables', statements, supplement, provenance, conflicts, '2026-10-10')
        self.assertEqual(value, 3097678.25 - 3097678.25)
        self.assertEqual(provenance['2021-12-31.receivables']['source_date'], '2022-03-31')
        self.assertIn('iFind', provenance['2021-12-31.receivables']['provider'])
        self.assertEqual(conflicts, [])

    def test_dcf_scenarios_and_missing_inputs(self):
        annual = [{"year": year, "fcff": value, "cfo": value + 20, "capex": 20, "owner_fcf": value} for year, value in ((2023, 80), (2024, 100), (2025, 120))]
        records = {"2025-12-31": {"cash": 25, "short_debt": 5, "long_debt": 5, "bonds": 5}}
        self.assertEqual(p.dcf(records, annual, None)["status"], "insufficient_inputs")
        result = p.dcf(records, annual, {"close": 5}, 100)
        self.assertEqual(result["status"], "research_hypothesis")
        self.assertEqual(result["base_method"], "latest_annual_fcff")
        self.assertEqual(result["base_cash_flow_CNY"], 120)
        self.assertEqual(result["base_years"], [2025])
        self.assertEqual([r["name"] for r in result["scenarios"]], ["悲观", "基准", "乐观"])
        self.assertEqual(len(result["sensitivity"]), 45)
        self.assertLess(result["scenarios"][0]["value_per_share"], result["scenarios"][2]["value_per_share"])
        detail = result["scenarios"][1]["breakdown"]
        self.assertEqual([x["year"] for x in detail["cashflows"]], list(range(2026, 2031)))
        self.assertAlmostEqual(detail["projected_fcff_pv_CNY"], sum(x["present_value_CNY"] for x in detail["cashflows"]))
        self.assertAlmostEqual(detail["equity_value_CNY"], detail["projected_fcff_pv_CNY"] + detail["terminal_value_pv_CNY"] + detail["net_cash_CNY"])
        self.assertAlmostEqual(detail["value_per_share"], detail["equity_value_CNY"] / detail["shares"])

    def test_dcf_does_not_require_three_year_cashflow_history(self):
        annual = [
            {"year": 2021, "fcff": 80, "cfo": 90, "capex": 10, "owner_fcf": 80},
            {"year": 2022, "fcff": 90, "cfo": 100, "capex": 10, "owner_fcf": 90},
            {"year": 2023, "fcff": 100, "cfo": 110, "capex": 10, "owner_fcf": 100},
            {"year": 2025, "fcff": 120, "cfo": 130, "capex": 10, "owner_fcf": 120},
        ]
        result = p.dcf({}, annual, {"close": 5}, 100)
        self.assertEqual(result["status"], "research_hypothesis")
        self.assertEqual(result["base_cash_flow_CNY"], 120)
        self.assertEqual(result["base_years"], [2025])
        self.assertTrue(result["scenarios"])

    def test_dcf_never_reuses_old_positive_cashflow_for_latest_missing_or_negative(self):
        old = [{"year": y, "fcff": 100, "owner_fcf": 80} for y in (2023, 2024)]
        missing = p.dcf({}, old + [{"year": 2025, "fcff": None}], {"close": 5}, 100)
        self.assertEqual(missing["status"], "insufficient_inputs")
        self.assertIsNone(missing["base_cash_flow_CNY"])
        self.assertEqual(missing["scenarios"], [])
        negative = p.dcf({}, old + [{"year": 2025, "fcff": -20, "owner_fcf": -10}], {"close": 5}, 100)
        self.assertEqual(negative["status"], "negative_owner_fcf")
        self.assertEqual(negative["base_cash_flow_CNY"], -10)
        self.assertEqual(negative["sensitivity"], [])
        fallback = p.dcf({}, old + [{"year": 2025, "fcff": -20, "owner_fcf": 10}], {"close": 5}, 100)
        self.assertEqual(fallback["base_method"], "latest_annual_owner_fcf")
        self.assertEqual(fallback["base_cash_flow_CNY"], 10)

    def test_dcf_uses_newest_complete_year_for_base_balance_and_forecast(self):
        annual = [{"year": 2025, "fcff": 100}, {"year": 2026, "fcff": 50},
                  {"year": 2027, "report_date": "2027-06-30", "period": "quarterly_ytd", "fcff": 999}]
        records = {"2025-12-31": {"cash": 100, "short_debt": 0, "long_debt": 0, "bonds": 0},
                   "2026-12-31": {"cash": 30, "short_debt": 2, "long_debt": 3, "bonds": 4}}
        result = p.dcf(records, annual, {"close": 5}, 100)
        self.assertEqual(result["base_cash_flow_CNY"], 50)
        self.assertEqual(result["base_years"], [2026])
        self.assertEqual(result["net_cash_CNY"], 21)
        self.assertEqual(result["growth_basis"]["years"], [2023, 2026])
        self.assertEqual([r["year"] for r in result["scenarios"][0]["breakdown"]["cashflows"]], list(range(2027, 2032)))

    def test_dcf_uses_company_trend_and_sensitivity_matches_baseline(self):
        annual = [{"year": year, "revenue": 100 * 1.04 ** (year - 2022), "fcff": 100, "owner_fcf": 100, "cfo": 110, "capex": 10} for year in range(2022, 2026)]
        records = {"2025-12-31": {"cash": 25, "short_debt": 5, "long_debt": 5, "bonds": 5}}
        result = p.dcf(records, annual, {"close": 10}, 100)
        base = next(item for item in result["scenarios"] if item["name"] == "基准")
        self.assertAlmostEqual(base["assumptions"]["growth"], 0.04)
        self.assertAlmostEqual(result["growth_basis"]["revenue_cagr_3y"], 0.04)
        self.assertTrue(all(abs(item["growth"] - 0.04) < 1e-9 for item in result["sensitivity"]))
        settings = p.PARAMETERS["dcf"]
        with patch.dict(settings, {"sensitivity_discount_rate": [0.095], "sensitivity_terminal_growth": [0.02]}):
            matching = p.dcf(records, annual, {"close": 10}, 100)
        hit = next(item for item in matching["sensitivity"] if item["cash_flow_multiplier"] == 1)
        self.assertEqual(hit["value_per_share"], base["value_per_share"])
        annual[-1]["revenue"] = 1000
        self.assertEqual(p.dcf_growth_anchor(annual)["anchor"], 0.06)
        annual[-1]["revenue"] = 1
        self.assertEqual(p.dcf_growth_anchor(annual)["anchor"], -0.05)
        self.assertEqual(p.dcf_growth_anchor([])["status"], "default_research_assumption")

    def test_dividend_coverage_uses_cash_amount_against_owner_fcf(self):
        annual = [{"year": year, "revenue": 100, "net_profit": 20, "gross_sales_spread": 55,
                   "operating_margin": 30, "roe": 20, "sales_cash_ratio": 105, "cfo_profit": 0.9,
                   "cfo": 25, "capex": 5, "owner_fcf": 20, "debt_to_asset": 20,
                   "cash_to_current_liab": 80, "inventory": 50, "receivables": 10,
                   "dps": 1, "dividend_cash_CNY": 25, "payout_pct": 50,
                   "contract_liabilities": 20, "sales_expense": 10} for year in range(2021, 2026)]
        result = p.score_inputs(annual)[0]
        self.assertNotIn("contract_liab_to_revenue_median", result)

    def test_approved_dimensions_and_qualitative_evidence_not_scored(self):
        self.assertEqual([(name, weight) for name, weight, _ in p.PARAMETERS["dimensions"]], [
            ("盈利质量", 25), ("现金创造", 30), ("家底质量", 25), ("经营韧性", 10), ("股东回报", 10)])
        self.assertEqual(sum(weight for _, weight, _ in p.PARAMETERS["dimensions"]), 100)
        annual = [{"year": year, "revenue": 100 + year - 2021, "net_profit": 20 + year - 2021,
                   "gross_margin": 90, "net_margin": 40, "gross_sales_spread": 80,
                   "operating_margin": 30, "roe": 20, "roic": 22, "return_on_capital": 22, "sales_cash_ratio": 110,
                   "cfo_to_revenue": 30, "cfo_profit": 1, "cfo_to_current_liab": 40,
                   "cfo": 25, "capex": 5, "owner_fcf": 20, "owner_fcf_to_profit": 1, "debt_to_asset": 15,
                   "cash_to_current_liab": 80, "current_assets": 300, "current_liabilities": 100,
                   "quick_ratio": 150, "inventory": 50, "receivables": 10,
                   "dps": 1, "dividend_cash_CNY": 10, "dividend_yield": 5, "payout_pct": 50,
                   "contract_liabilities": 20, "sales_expense": 10} for year in range(2021, 2026)]
        for row in annual:
            row.update(roa=20, consolidated_net_profit=row["net_profit"], total_assets=300, total_liabilities=40,
                       other_receivables_to_asset=0.1, cash=80, nonrecurring_ratio=0, receivables_to_revenue=10)
        annual.insert(0, {**annual[0], "year": 2020, "revenue": 99})
        result = p.score(annual, {}, {"product_mix": [{"observation": "verified", "source": "report", "source_date": "2026-01-01"}]})
        stats = p.build_universe_stats([(str(i), annual) for i in range(6)])
        peer_result = p.score(annual, {}, universe_stats=stats)
        self.assertIsNotNone(peer_result["total"])
        self.assertTrue(result["rankable"])
        self.assertEqual(result["max_total"], 100)
        self.assertEqual(result["total"], round(sum(d["score"] for d in result["dimensions"]), 2))
        self.assertEqual(result["coverage"], 1)
        names = [item["name"] for dim in result["dimensions"] for item in dim["items"]]
        self.assertIn("roa_median", names)
        self.assertIn("cfo_conversion", names)
        self.assertIn("nonrecurring_dependency", names)
        self.assertIn("liquidity_constraint", names)
        self.assertNotIn("dividend_fcf_coverage", names)
        self.assertNotIn("gross_margin_median", names)
        self.assertNotIn("return_on_capital_median", names)
        self.assertNotIn("dividend_yield", names)
        self.assertNotIn("contract_liab_to_revenue_median", names)
        self.assertNotIn("product_mix", names)
        roa = next(item for dim in result["dimensions"] for item in dim["items"] if item["name"] == "roa_median")
        self.assertEqual(roa["score"], 8)
        self.assertEqual(peer_result["total"], result["total"])
        mix = next(item for item in result["references"] if item["name"] == "product_mix")
        self.assertEqual(mix["status"], "reference")
        self.assertNotIn("score", mix)
        self.assertEqual(len(mix["evidence"]), 1)
        self.assertIn("inventory", result["financial_proxies_unscored"])

    def test_asof_notice_update_and_supplement(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "RAW", Path(tmp)):
            path = Path(tmp) / "income" / "600519.csv"
            path.parent.mkdir()
            with path.open("w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=["REPORT_DATE", "NOTICE_DATE", "UPDATE_DATE", "OPERATE_INCOME"])
                writer.writeheader()
                writer.writerows([
                    {"REPORT_DATE": "2025-12-31", "NOTICE_DATE": "2026-04-01", "UPDATE_DATE": "2026-08-01", "OPERATE_INCOME": "100"},
                    {"REPORT_DATE": "2024-12-31", "NOTICE_DATE": "2025-04-01", "UPDATE_DATE": "2025-04-01", "OPERATE_INCOME": "80"},
                    {"REPORT_DATE": "2023-12-31", "NOTICE_DATE": "", "UPDATE_DATE": "", "OPERATE_INCOME": "60"},
                ])
            rows = p.report_rows("600519", "income", "2026-05-01")
            self.assertEqual(list(rows), ["2024-12-31"])
            self.assertIn("2025-12-31", p.report_rows("600519", "income", "2026-09-01"))
        statements = {k: {} for k in p.STATEMENTS}
        extra = {("600519", "2025-12-31", "revenue"): {"value": "110", "source": "iFind: revenue", "source_date": "2026-06-01"}}
        self.assertIsNone(p.resolve("600519", "2025-12-31", "revenue", statements, extra, {}, [], "2026-05-01"))
        self.assertEqual(p.resolve("600519", "2025-12-31", "revenue", statements, extra, {}, [], "2026-06-01"), 110)

    def test_dividend_requires_announcements_before_asof(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "RAW", Path(tmp)):
            path = Path(tmp) / "dividend" / "600519.csv"
            path.parent.mkdir()
            with path.open("w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=["报告期", "现金分红-现金分红比例", "预案公告日", "最新公告日期"])
                writer.writeheader()
                writer.writerows([
                    {"报告期": "2025-12-31", "现金分红-现金分红比例": "10", "预案公告日": "2026-04-01", "最新公告日期": "2026-07-01"},
                    {"报告期": "2024-12-31", "现金分红-现金分红比例": "9", "预案公告日": "2025-04-01", "最新公告日期": "2025-07-01"},
                    {"报告期": "2023-12-31", "现金分红-现金分红比例": "8", "预案公告日": "", "最新公告日期": ""},
                ])
            self.assertEqual([x["report_date"] for x in p.dividend_observations("600519", "2026-05-01")], ["2024-12-31"])
            self.assertEqual(len(p.dividend_observations("600519", "2026-08-01")), 2)

    def test_fcff_uses_component_amortization_and_does_not_add_investment_property_again(self):
        base = {k: 10.0 for k in p.FIELDS}
        base.update(revenue=100, cost=50, operating_profit=30, total_profit=25, income_tax=5,
                    depreciation=3, amortization=99, capex=8, investment_property_depreciation=4,
                    intangible_amortization=1, prepaid_amortization=1, lease_amortization=0,
                    interest_expense=None, interest_income=None,
                    inventory=10, receivables=10, other_receivables=10, payables=10, contract_liabilities=10,
                    finance_expense=0)
        out = dict(base)
        p.derive(out, base, {}, "2025-12-31")
        # 有分项摊销时不用合计 99，投资性房地产折旧 4 不另加。流动资金变动为 0。
        self.assertAlmostEqual(out["fcff"], 30 * 0.8 + 3 + 1 + 1 - 8)
        self.assertEqual(out["fcff_adjustment"]["missing"], [])

    def test_qualitative_asof_and_schema(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "QUALITATIVE", Path(tmp) / "evidence.csv"):
            p.QUALITATIVE.write_text("code,indicator,observation,source,source_date\n600519,product_mix,verified,annual report,2026-04-01\n600519,governance,later,annual report,2026-09-27\n")
            result = p.qualitative_evidence("600519", "2026-09-01")
            self.assertEqual(len(result["600519"]["product_mix"]), 1)
            self.assertNotIn("governance", result["600519"])
            p.QUALITATIVE.write_text("code,indicator,observation,source,source_date,token\n")
            with self.assertRaises(ValueError):
                p.qualitative_evidence("600519", "2026-09-28")

    def test_ifind_missing_only_confirmed_periods_and_akshare_gaps(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "RAW", Path(tmp)), patch.object(p, "COMPANIES", {"600519": "贵州茅台"}), patch.object(p, "FIELDS", {"revenue": ("income", ("OPERATE_INCOME",)), "cash": ("balance", ("MONETARYFUNDS",))}):
            path = Path(tmp) / "income" / "600519.csv"
            path.parent.mkdir()
            path.write_text("REPORT_DATE,NOTICE_DATE,UPDATE_DATE,OPERATE_INCOME\n2025-12-31,2026-04-01,2026-04-01,100\n2026-06-30,2026-08-01,2026-08-01,\n")
            requests = p.ifind_missing("2026-09-28", {})
        self.assertEqual([(r["report_date"], r["field"]) for r in requests], [("2025-12-31", "cash"), ("2026-06-30", "revenue"), ("2026-06-30", "cash")])

    def test_ifind_fill_mock_validates_before_exclusive_write(self):
        request = {"code": "600519", "name": "贵州茅台", "report_date": "2025-12-31", "field": "cash"}
        row = {"code": "600519", "report_date": "2025-12-31", "field": "cash", "value": "123.45", "unit": "CNY", "source": "iFind:get_stock_financials:cash", "source_date": "2026-04-01"}
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "SUPPLEMENT", Path(tmp) / "supplement.csv"), patch.object(p, "ifind_missing", return_value=[request]), patch.object(p.shutil, "which", return_value="node"):
            def runner(*args, **kwargs):
                self.assertEqual(json.loads(kwargs["input"]), {"requests": [request]})
                return subprocess.CompletedProcess(args, 0, json.dumps({"rows": [row]}), "")
            p.ifind_fill("2026-09-28", runner=runner)
            self.assertEqual(p.supplement_rows()[("600519", "2025-12-31", "cash")]["value"], "123.45")
            before = p.SUPPLEMENT.read_bytes()
            p.ifind_fill("2026-09-28", runner=lambda *a, **k: self.fail("不得覆盖已有文件或再次调用"))
            self.assertEqual(before, p.SUPPLEMENT.read_bytes())

    def test_ifind_fill_rejects_incorrect_metadata_without_residue(self):
        request = {"code": "600519", "name": "贵州茅台", "report_date": "2025-12-31", "field": "cash"}
        valid = {"code": "600519", "report_date": "2025-12-31", "field": "cash", "value": "12", "unit": "CNY", "source": "iFind:get_stock_financials:cash", "source_date": "2026-04-01"}
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "SUPPLEMENT", Path(tmp) / "supplement.csv"), patch.object(p, "ifind_missing", return_value=[request]), patch.object(p.shutil, "which", return_value="node"):
            for bad in ({**valid, "unit": "亿元"}, {**valid, "source_date": "2025-01-01"}, {**valid, "source": "iFind:get_stock_financials:cash token=abc"}, {**valid, "code": "000858"}):
                def runner(*args, **kwargs):
                    return subprocess.CompletedProcess(args, 0, json.dumps({"rows": [bad]}), "")
                p.ifind_fill("2026-09-28", runner=runner)
                self.assertFalse(p.SUPPLEMENT.exists())
            p.ifind_fill("2026-09-28", runner=lambda *a, **k: subprocess.CompletedProcess(a, 1, "", "secret output"))
            self.assertFalse(p.SUPPLEMENT.exists())

    def test_dividend_yield_sums_same_fiscal_year_and_skips_future_ex_date(self):
        events = [
            {"year": 2025, "status": "实施分配", "cash_per_10_shares": 239.57, "ex_date": "2025-12-19", "latest_notice_date": "2025-12-11", "shares": 100},
            {"year": 2025, "status": "实施分配", "cash_per_10_shares": 280.2423, "ex_date": "2026-06-26", "latest_notice_date": "2026-06-22", "shares": 100},
            {"year": 2025, "status": "预披露", "cash_per_10_shares": 99, "ex_date": None, "latest_notice_date": "2026-04-01", "shares": 100},
            {"year": 2026, "status": "实施分配", "cash_per_10_shares": 20, "ex_date": "2026-10-13", "latest_notice_date": "2026-10-01", "shares": 100},
        ]
        picked = p.select_cash_dividends(events, 2025, "2026-10-09")
        self.assertEqual(len(picked), 2)
        dps = sum(ev["cash_per_10_shares"] for ev in picked) / 10
        self.assertAlmostEqual(dps / 1263 * 100, 4.1157, places=3)
        self.assertEqual(p.select_cash_dividends(events, 2026, "2026-10-09"), [])

    def test_owner_fcf_dcf_does_not_treat_blank_debt_as_zero(self):
        annual = [
            {"year": 2023, "cfo": 30, "capex": 10},
            {"year": 2024, "cfo": 40, "capex": 10},
            {"year": 2025, "cfo": 50, "capex": 10},
        ]
        records = {"2025-12-31": {"cash": 100, "short_debt": None, "long_debt": None, "bonds": None}}
        result = p.dcf(records, annual, {"close": 10}, 10)
        self.assertEqual(result["status"], "research_hypothesis")
        self.assertEqual(result["base_method"], "latest_annual_owner_fcf")
        self.assertAlmostEqual(result["base_cash_flow_CNY"], 40)
        self.assertTrue(all(s["assumptions"]["rate_kind"] == "成本权益率代理" for s in result["scenarios"]))
        self.assertTrue(all(s["rate_kind"] == "成本权益率代理" for s in result["sensitivity"]))
        detail = result["scenarios"][1]["breakdown"]
        self.assertIsNone(detail["net_cash_CNY"])
        self.assertAlmostEqual(detail["equity_value_CNY"], detail["projected_fcff_pv_CNY"] + detail["terminal_value_pv_CNY"])
        self.assertEqual(sorted({r["cash_flow_multiplier"] for r in result["sensitivity"]}), [0.9, 1.0, 1.1])
        self.assertNotIn("2025 short_debt", result["missing"])
        negative = p.dcf(records, [{"year": y, "cfo": -1, "capex": 5} for y in (2023, 2024, 2025)], {"close": 10}, 10)
        self.assertEqual(negative["status"], "negative_owner_fcf")
        self.assertEqual(negative["scenarios"], [])

    def test_json_strict(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.json"
            p.dump(path, {"value": None})
            self.assertEqual(json.loads(path.read_text())["value"], None)
            with self.assertRaises(ValueError):
                p.dump(path, {"value": float("nan")})


if __name__ == "__main__":
    unittest.main()
