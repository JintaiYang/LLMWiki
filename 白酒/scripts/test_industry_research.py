import copy
import unittest

from industry_research import build_research, snapshot


class IndustryResearchTests(unittest.TestCase):
    def fixtures(self):
        companies = []
        for code, values in [("A", (60, 70)), ("B", (40, 30))]:
            companies.append({"code": code, "annual": [], "quarterly": [
                {"report_date": "2025-06-30", "revenue": values[0]},
                {"report_date": "2026-06-30", "revenue": values[1], "owner_fcf": -2, "sales_expense": 5},
            ]})
        previous = {"report_date": "2025-06-30", "revenue": 120, "net_profit": 20, "cfo": 5,
                    "inventory": 50, "contract_liabilities": 20}
        point = {"report_date": "2026-06-30", "revenue": 100, "net_profit": 15, "cfo": 30,
                 "inventory": 60, "contract_liabilities": 10}
        return companies, point, previous

    def test_signal_is_not_terminal_recovery_or_buy_rating(self):
        companies, point, previous = self.fixtures()
        result = snapshot(companies, point, previous)
        self.assertEqual(result["status"], "pressure")
        self.assertIn("终端拐点未确认", result["judgment"])
        values = {m["key"]: m for m in result["diagnostics"]}
        self.assertAlmostEqual(values["inventory_growth_gap"]["value"], 20 - (100 / 120 - 1) * 100)
        self.assertEqual(values["contract_ratio"]["value"], 10)
        self.assertEqual(values["fcf_margin"]["value"], -4)
        self.assertEqual(values["sales_expense_ratio"]["value"], 10)
        self.assertEqual(values["positive_growth"]["value"], 1)
        self.assertEqual(values["negative_fcf"]["value"], 2)
        self.assertEqual(values["sample_cr6"]["value"], 100)

    def test_missing_is_not_partial_total_or_zero(self):
        companies, point, previous = self.fixtures()
        companies[0]["quarterly"][-1]["owner_fcf"] = None
        companies[0]["quarterly"][0]["revenue"] = 0
        values = {m["key"]: m for m in snapshot(companies, point, previous)["diagnostics"]}
        self.assertIsNone(values["fcf_margin"]["value"])
        self.assertIsNone(values["negative_fcf"]["value"])
        self.assertIsNone(values["positive_growth"]["value"])
        self.assertEqual(values["negative_fcf"]["coverage"], 1)
        previous["inventory"] = 0
        values = {m["key"]: m for m in snapshot(companies, point, previous)["diagnostics"]}
        self.assertIsNone(values["inventory_growth_gap"]["value"])

    def test_mismatched_population_cannot_mix_numerators(self):
        companies, point, previous = self.fixtures()
        point["revenue"] = 120
        values = {m["key"]: m for m in snapshot(companies, point, previous)["diagnostics"]}
        for key in ["fcf_margin", "sales_expense_ratio", "sample_cr6"]:
            self.assertIsNone(values[key]["value"])

    def test_sources_and_pending_observations_are_explicit(self):
        companies, point, previous = self.fixtures()
        original = copy.deepcopy(companies)
        result = build_research(companies, [previous, point, {**point, "report_date": "2026-12-31"}], "2026-10-10")
        self.assertEqual(companies, original)
        self.assertEqual(len(result["snapshots"]), 2)
        self.assertTrue(result["rejected"])
        self.assertEqual(len(result["tracking"]), 12)
        ids = {source["id"] for source in result["sources"]}
        for metric in result["tracking"]:
            self.assertIsNone(metric["value"])
            self.assertIsNone(metric["observation_date"])
            self.assertEqual(metric["status"], "pending")
            self.assertTrue(set(metric["source_ids"]).issubset(ids))
        self.assertEqual(result["financial_as_of"], "2026-10-10")


if __name__ == "__main__":
    unittest.main()
