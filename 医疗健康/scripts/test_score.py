"""Protect monetary units, report boundaries and missing/negative economic states."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from score import derive, score

DATA = Path(__file__).resolve().parents[1] / "dashboard" / "data.json"


class ScoreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(DATA.read_text())
        cls.sample = next(c for c in cls.data["companies"] if c["code"] == "600276")

    def test_real_annual_units_and_period(self):
        c = self.sample
        row = next(r for r in c["annual"] if r["period"] == "20251231")
        self.assertAlmostEqual(row["revenue"] / 1e8, 316.2942, places=3)
        self.assertAlmostEqual(row["adjusted_profit"] / 1e8, 74.1341, places=3)
        self.assertTrue(all(r["period"].endswith("1231") for r in c["annual"]))
        self.assertTrue(all(r["period"].endswith("0630") for r in c["interim"]))

    def test_missing_is_not_zero_or_normalized(self):
        c = deepcopy(self.sample)
        next(r for r in c["annual"] if r["period"] == "20241231")["cfo"] = None
        result = score(c)
        self.assertIsNone(result["total"])
        self.assertEqual(result["coverage"], 90)
        self.assertIn("连续两年经营现金流为负", result["risk_missing"])
        self.assertGreaterEqual(result["range"][1], result["range"][0])

    def test_nonpositive_accumulated_profit_is_economic_state(self):
        c = deepcopy(self.sample)
        for row in c["annual"]:
            if row["period"][:4] in ("2023", "2024", "2025"):
                row["consolidated_profit"] = -1e8
        result = score(c)
        detail = next(d for d in result["details"] if d["key"] == "cash_conversion")
        self.assertEqual(detail["status"], "economic_invalid")
        self.assertEqual(detail["points"], 0)
        self.assertEqual(result["coverage"], 100)

    def test_negative_equity_caps_score(self):
        c = deepcopy(self.sample)
        next(r for r in c["annual"] if r["period"] == "20251231")["equity"] = -1
        result = score(c)
        self.assertEqual(result["cap"], 39)
        self.assertLessEqual(result["total"], 39)

    def test_cash_risk_cannot_be_overridden_by_good_profit(self):
        c = deepcopy(self.sample)
        for row in c["annual"]:
            if row["period"][:4] in ("2024", "2025"):
                row["cfo"] = -1
        result = score(c)
        self.assertEqual(result["cap"], 49)
        self.assertLessEqual(result["total"], 49)

    def test_biotech_does_not_receive_operating_company_rank(self):
        c = deepcopy(self.sample)
        c["stage"] = "biotech"
        result = score(c)
        self.assertIsNone(result["total"])
        self.assertIsNone(result["raw"])
        self.assertEqual(result["status"], "research_only")

    def test_source_missing_goodwill_never_becomes_zero(self):
        row = {"revenue": 100, "cost": 50, "net_profit": 20, "equity": 100, "goodwill": None, "cfo": 30, "capex": 10}
        derive(row, {"equity": 100})
        self.assertIsNone(row["goodwill_equity"])
        self.assertEqual(row["fcf"], 20)

    def test_peer_or_interim_data_cannot_change_annual_score(self):
        c = deepcopy(self.sample)
        expected = score(c)
        c["interim"] = [{"period": "20260630", "net_profit": -1e15}]
        self.assertEqual(score(c), expected)

    def test_zero_cash_is_observed_not_missing(self):
        c = deepcopy(self.sample)
        for row in c["annual"]:
            if row["period"][:4] in ("2023", "2024", "2025"):
                row["liquidity"] = 0
        d = next(d for d in score(c)["details"] if d["key"] == "liquidity")
        self.assertEqual(d["status"], "observed")
        self.assertEqual(d["points"], 0)

    def test_all_scores_have_exactly_100_available_points(self):
        for c in self.data["companies"]:
            self.assertEqual(sum(d["weight"] for d in c["score"]["details"]), 100)
            if c["score"]["total"] is not None:
                self.assertTrue(0 <= c["score"]["total"] <= c["score"]["cap"])

    def test_pdf_supplements_keep_unit_and_period_provenance(self):
        c = next(c for c in self.data["companies"] if c["code"] == "300760")
        values = {(r["period"], r["field"]): r for r in c["supplements"]}
        self.assertEqual(values[("20251231", "rd_total")]["value"], 3928860837)
        self.assertAlmostEqual(values[("20251231", "overseas_revenue")]["value"] / 1e8, 176.503752)
        self.assertEqual(values[("20251231", "rd_total")]["pdf_page"], 112)
        self.assertEqual(self.data["meta"]["financial_source_cells"]["iFinD"], 0)
        self.assertTrue(all(r["provider"] == "PDF" for r in c["supplements"]))


if __name__ == "__main__":
    unittest.main()
