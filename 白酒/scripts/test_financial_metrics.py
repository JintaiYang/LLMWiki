import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import liquor_pipeline as pipeline
from financial_metrics import CATALOG, enrich, valuation_history


def balance_fixture():
    previous = {"total_assets": 100, "total_equity": 40, "receivables": 10,
                "inventory": 10, "fixed_assets": 20, "cfo": 15, "consolidated_net_profit": 10}
    current = {"year": 2024, "revenue": 200, "net_profit": 10, "consolidated_net_profit": 25,
               "cost": 80, "total_assets": 200, "total_equity": 60, "receivables": 30,
               "inventory": 30, "fixed_assets": 60, "construction_in_progress": 10,
               "current_assets": 120, "current_liabilities": 60, "cfo": 50,
               "capex": 10, "owner_fcf": 40, "finance_expense": -4,
               "management_expense": 6, "research_expense": None}
    records = {"2021-12-31": {"revenue": 100, "net_profit": 10},
               "2022-12-31": {"cfo": 10, "consolidated_net_profit": 5}, "2023-12-31": previous}
    return current, previous, records


class FinancialMetricsTests(unittest.TestCase):
    def calculate(self):
        current, previous, records = balance_fixture()
        enrich(current, previous, records, {}, "2024-12-31")
        return current

    def test_catalog_has_unique_keys_and_seven_groups(self):
        keys = [key for group in CATALOG["groups"] for key in group["metrics"]]
        self.assertEqual(len(keys), 67)
        self.assertEqual(len(set(keys)), 67)
        self.assertEqual(set(keys), set(CATALOG["metrics"]))
        self.assertEqual(len(CATALOG["groups"]), 7)

    def test_dupont_components_use_the_same_consolidated_scope(self):
        row = self.calculate()
        self.assertEqual(row["consolidated_net_margin"], 12.5)
        self.assertEqual(row["consolidated_roe"], 50)
        self.assertEqual(row["equity_multiplier"], 3)
        self.assertAlmostEqual(row["asset_turnover"], 4 / 3)
        self.assertAlmostEqual(row["consolidated_net_margin"] * row["asset_turnover"] * row["equity_multiplier"], row["consolidated_roe"])

    def test_turnover_uses_average_balances_and_inventory_cost(self):
        row = self.calculate()
        self.assertEqual(row["inventory_turnover"], 4)
        self.assertEqual(row["receivables_turnover"], 10)
        self.assertEqual(row["fixed_asset_turnover"], 5)

    def test_leap_year_days_are_matched_to_the_year(self):
        row = self.calculate()
        self.assertEqual(row["inventory_days"], 91.5)
        self.assertEqual(row["receivables_days"], 36.6)

    def test_liquidity_ratios_are_multiples_not_percentage_points(self):
        row = self.calculate()
        self.assertEqual(row["current_ratio"], 2)
        self.assertEqual(row["quick_ratio_multiple"], 1.5)

    def test_cash_profit_scope_is_consolidated_and_not_parent_profit(self):
        row = self.calculate()
        self.assertEqual(row["cashflow_profit"], 2)
        self.assertEqual(row["free_cashflow_profit"], 1.6)
        self.assertEqual(row["cashflow_profit_3y"], 75 / 40)

    def test_cagr_uses_year_intervals_not_observation_count(self):
        row = self.calculate()
        self.assertAlmostEqual(row["revenue_cagr_3y"], (2 ** (1 / 3) - 1) * 100)
        self.assertEqual(row["profit_cagr_3y"], 0)

    def test_negative_net_finance_expense_and_missing_research_survive(self):
        row = self.calculate()
        self.assertEqual(row["finance_expense_ratio"], -2)
        self.assertIsNone(row["research_expense_ratio"])
        self.assertEqual(row["capex_intensity"], 5)
        self.assertEqual(row["fixed_construction_ratio"], 35)

    def test_zero_denominators_do_not_produce_infinity(self):
        row, previous, records = balance_fixture()
        row.update(current_liabilities=0, consolidated_net_profit=0, cfo=0, inventory=0, receivables=0)
        previous.update(inventory=0, receivables=0)
        enrich(row, previous, records, {}, "2024-12-31")
        for key in ("current_ratio", "quick_ratio_multiple", "cashflow_profit", "free_cashflow_profit", "capex_to_cfo", "receivables_days", "inventory_days"):
            self.assertIsNone(row[key], key)

    def test_negative_equity_does_not_create_a_roe_or_multiplier(self):
        row, previous, records = balance_fixture()
        previous["total_equity"] = -1
        enrich(row, previous, records, {}, "2024-12-31")
        self.assertIsNone(row["consolidated_roe"])
        self.assertIsNone(row["equity_multiplier"])

    def test_missing_year_cannot_be_skipped_in_cumulative_cash_ratio(self):
        row, previous, records = balance_fixture()
        del records["2022-12-31"]
        enrich(row, previous, records, {}, "2024-12-31")
        self.assertIsNone(row["cashflow_profit_3y"])

    def test_quarterly_flows_are_not_mixed_with_full_year_turnover(self):
        row, previous, records = balance_fixture()
        enrich(row, previous, records, {}, "2024-06-30")
        self.assertEqual(row["consolidated_net_margin"], 12.5)
        self.assertIsNone(row["inventory_turnover"])
        self.assertIsNone(row["cashflow_profit_3y"])
        self.assertIsNone(row["revenue_cagr_3y"])

    def test_prior_balance_is_not_mutated_and_derived_fields_are_traceable(self):
        row, previous, records = balance_fixture()
        before = copy.deepcopy(previous)
        sources = {}
        enrich(row, previous, records, sources, "2024-12-31")
        self.assertEqual(previous, before)
        self.assertEqual(sources["2024-12-31.inventory_days"]["unit"], "days")
        self.assertIn("平均存货", sources["2024-12-31.inventory_turnover"]["formula"])

    def test_valuation_needs_same_year_price_and_positive_reported_eps(self):
        annual = [{"year": 2024, "report_date": "2024-12-31", "basic_eps": 2},
                  {"year": 2023, "report_date": "2023-12-31", "basic_eps": -1}]
        history = {"history": [{"year": 2024, "year_end_price": 40, "year_end_price_date": "2024-12-31"},
                                {"year": 2023, "year_end_price": 30, "year_end_price_date": "2023-12-29"}]}
        valuation_history(annual, history, {})
        self.assertEqual(annual[0]["year_end_pe"], 20)
        self.assertIsNone(annual[1]["year_end_pe"])
        history["history"][0]["year_end_price_date"] = "2023-12-29"
        valuation_history(annual, history, {})
        self.assertIsNone(annual[0]["year_end_price"])
        self.assertIsNone(annual[0]["year_end_pe"])

    def test_presentation_metrics_do_not_change_production_scores(self):
        full, _ = pipeline.build("2026-10-10")
        with patch.object(pipeline, "enrich", return_value=None), patch.object(pipeline, "valuation_history", return_value=None):
            baseline, _ = pipeline.build("2026-10-10")
        for current, old in zip(full["companies"], baseline["companies"]):
            for key in ("total", "raw_total", "dimensions", "coverage", "risk_gates", "missing", "rank"):
                self.assertEqual(current["score"][key], old["score"][key], (current["code"], key))

    def test_eps_supplement_requires_a_per_share_unit(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(pipeline, "SUPPLEMENT", Path(directory) / "supplement.csv"):
            header = "code,report_date,field,value,unit,source,source_date\n"
            record = "600519,2025-12-31,basic_eps,5,{unit},iFind:basic_eps,2026-04-01\n"
            pipeline.SUPPLEMENT.write_text(header + record.format(unit="CNY"))
            with self.assertRaises(ValueError):
                pipeline.supplement_rows()
            pipeline.SUPPLEMENT.write_text(header + record.format(unit="CNY/share"))
            self.assertEqual(pipeline.supplement_rows()[("600519", "2025-12-31", "basic_eps")]["value"], "5")


if __name__ == "__main__":
    unittest.main()
