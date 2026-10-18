import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import liquor_pipeline as p
from mature_score import score_mature


def healthy_rows():
    return [{"year": y, "revenue": 100 + y - 2020, "net_profit": 20,
             "consolidated_net_profit": 22, "roa": 20, "operating_margin": 35,
             "cfo": 25, "capex": 5, "owner_fcf": 20, "cash_to_current_liab": 150,
             "other_receivables_to_asset": .1, "dividend_cash_CNY": 12,
             "cash": 150, "current_assets": 250, "inventory": 50, "current_liabilities": 100,
             "nonrecurring_ratio": 0, "receivables_to_revenue": 0,
             "total_assets": 400, "total_liabilities": 100} for y in range(2020, 2026)]


def items(result):
    return {i["name"]: i for d in result["dimensions"] for i in d["items"]}


class MatureScoreTests(unittest.TestCase):
    def test_absolute_scores_do_not_change_when_peer_stats_change(self):
        rows = healthy_rows()
        self.assertEqual(p.score(rows, {}, universe_stats={"arbitrary": {"values": [-1e6, 1e6]}}), p.score(rows, {}))

    def test_missing_data_is_not_zero_and_is_not_normalized(self):
        rows = healthy_rows()
        full = score_mature(rows)
        rows[-1]["dividend_cash_CNY"] = None
        out = score_mature(rows)
        self.assertIsNone(out["total"])
        self.assertFalse(out["rankable"])
        self.assertEqual(out["coverage"], .9)
        self.assertEqual(len(out["missing"]), 2)
        self.assertAlmostEqual(out["score_range"][1] - out["score_range"][0], 10)
        self.assertLess(out["known_points"], full["raw_total"])

    def test_confirmed_zero_dividends_receive_zero_points(self):
        rows = healthy_rows()
        for row in rows:
            row["dividend_cash_CNY"] = 0
        result = score_mature(rows)
        self.assertTrue(result["rankable"])
        self.assertEqual(result["dimensions"][4]["score"], 0)
        self.assertEqual(items(result)["payout_cumulative"]["status"], "observed_zero")

    def test_loss_is_an_observed_risk_instead_of_a_missing_cagr(self):
        rows = healthy_rows()
        rows[-1]["net_profit"] = -1
        result = score_mature(rows)
        self.assertTrue(result["rankable"])
        self.assertEqual(result["risk_cap"], 49)
        self.assertLessEqual(result["total"], 49)
        self.assertGreater(result["raw_total"], result["total"])

    def test_nonpositive_cumulative_profit_is_economic_invalid(self):
        rows = healthy_rows()
        for row in rows:
            row["consolidated_net_profit"] = -1
            row["net_profit"] = -1
        out = score_mature(rows)
        self.assertTrue(out["rankable"])
        for key in ("cfo_conversion", "fcf_conversion", "payout_cumulative"):
            self.assertEqual(items(out)[key]["status"], "economic_invalid")
            self.assertEqual(items(out)[key]["score"], 0)

    def test_cashflow_uses_consolidated_profit_not_parent_profit(self):
        out = score_mature(healthy_rows())
        self.assertAlmostEqual(items(out)["cfo_conversion"]["value"], 25 / 22)
        self.assertEqual(items(out)["payout_cumulative"]["value"], 60)

    def test_multiple_risk_gates_take_the_lowest_cap(self):
        rows = healthy_rows()
        for row in rows[-2:]:
            row["cfo"] = -10
            row["owner_fcf"] = -15
        rows[-1]["total_liabilities"] = 425
        out = score_mature(rows)
        self.assertEqual(out["risk_cap"], 39)
        self.assertEqual(len(out["risk_gates"]), 2)
        self.assertLessEqual(out["total"], 39)

    def test_missing_year_cannot_be_replaced_with_an_older_observation(self):
        rows = healthy_rows()
        del rows[-2]
        out = score_mature(rows)
        self.assertEqual(out["window_years"], [2021, 2022, 2023, 2024, 2025])
        self.assertFalse(out["rankable"])
        self.assertIsNone(out["total"])

    def test_first_window_yoy_requires_the_actual_previous_year(self):
        out = score_mature(healthy_rows()[1:])
        self.assertIn("revenue_worst_yoy", out["missing"])

    def test_production_scores_match_all_approved_v5_previews(self):
        root = Path(__file__).resolve().parents[1]
        data = json.loads((root / 'dashboard/data.json').read_text())
        baseline = json.loads((root / '04_运维报告/白酒评分V4切换前基线_20261017.json').read_text())
        expected = {c['code']: c for c in baseline['companies']}
        for company in data['companies']:
            with self.subTest(code=company['code']):
                result = score_mature(company['annual'])
                reference = expected[company['code']]
                self.assertEqual(result['version'], 'V5.0-book-financial-quality')
                self.assertEqual(result['total'], reference['approved_v5_total'])
                self.assertEqual(result['coverage'], reference['approved_v5_coverage'])
                self.assertEqual(result['risk_cap'], reference['approved_v5_risk_cap'])
                self.assertEqual(sum(d['weight'] for d in result['dimensions']), 100)
                self.assertEqual(sum(len(d['items']) for d in result['dimensions']), 13)
                self.assertFalse(set(result['missing']) - set(p.PARAMETERS['metric_definitions']))

    def test_roe_never_fills_roic_and_roa_has_its_own_denominator(self):
        current = {k: 10.0 for k in p.FIELDS}
        current.update(parent_equity=100, total_assets=200, consolidated_net_profit=30,
                       net_profit=20, short_debt=None, long_debt=None, bonds=None)
        previous = copy.deepcopy(current)
        previous["total_assets"] = 100
        p.derive(current, previous, {}, "2025-12-31")
        self.assertEqual(current["roe"], 20)
        self.assertEqual(current["roa"], 20)
        self.assertIsNone(current["roic"])
        self.assertIsNone(current["return_on_capital"])

    def test_dividend_amount_survives_a_loss_but_unknown_year_is_not_zero(self):
        event = {"year": 2025, "report_date": "2025-12-31", "cash_per_10_shares": 3,
                 "shares": 100, "status": "实施分配", "notice_date": "2026-06-01",
                 "latest_notice_date": "2026-06-01", "ex_date": "2026-06-02", "description": "现金分红"}
        with patch.object(p, "read_dividend_events", return_value=[event]), patch.object(p, "price_closes", return_value=[]):
            result = p.dividend_package("600519", "2026-10-10", {"close": 10}, [{"year": 2025, "revenue": 100, "net_profit": -1}])
        latest = result["history"][-1]
        self.assertEqual(latest["cash_total_CNY"], 30)
        self.assertIsNone(latest["payout_pct"])
        self.assertIsNone(result["history"][-2]["cash_total_CNY"])
        self.assertIsNone(result["history"][-2]["dps"])
        self.assertIsNone(result["history"][-2]["yield_pct"])

    def test_undistributed_draft_cannot_confirm_zero_dividends(self):
        event = {"year": 2025, "report_date": "2025-12-31", "cash_per_10_shares": 0,
                 "shares": 100, "status": "董事会预案", "notice_date": "2026-06-01",
                 "latest_notice_date": "2026-06-01", "ex_date": None, "description": "尚未实施"}
        with patch.object(p, "read_dividend_events", return_value=[event]), patch.object(p, "price_closes", return_value=[]):
            result = p.dividend_package("600519", "2026-10-10", {"close": 10}, [{"year": 2025, "revenue": 100, "net_profit": 1}])
        self.assertIsNone(result["dps"])
        self.assertIsNone(result["yield_pct"])
        self.assertIsNone(result["history"][-1]["cash_total_CNY"])

    def test_implemented_zero_dividend_needs_no_inferred_share_count(self):
        event = {"year": 2025, "report_date": "2025-12-31", "cash_per_10_shares": 0,
                 "shares": None, "status": "实施分配", "notice_date": "2026-06-01",
                 "latest_notice_date": "2026-06-01", "ex_date": "2026-06-02", "description": "已核验零分红"}
        with patch.object(p, "read_dividend_events", return_value=[event]), patch.object(p, "price_closes", return_value=[]):
            result = p.dividend_package("600519", "2026-10-10", {"close": 10}, [{"year": 2025, "revenue": 100, "net_profit": 1}])
        self.assertEqual(result["dps"], 0)
        self.assertEqual(result["yield_pct"], 0)
        self.assertEqual(result["history"][-1]["cash_total_CNY"], 0)


if __name__ == "__main__":
    unittest.main()
