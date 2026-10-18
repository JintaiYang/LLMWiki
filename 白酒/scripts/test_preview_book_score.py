import copy
import tempfile
import unittest
from pathlib import Path

from preview_book_score import DIMENSIONS, SCENARIOS, preview_score, run, scenario_total


def healthy_rows():
    return [{"year": y, "revenue": 100 * 1.1 ** (y - 2020), "net_profit": 20,
             "consolidated_net_profit": 22, "operating_margin": 35, "roa": 15,
             "nonrecurring_ratio": 0, "cfo": 25, "capex": 5,
             "cash": 150, "current_assets": 250, "inventory": 50, "current_liabilities": 100,
             "total_assets": 300, "total_liabilities": 100,
             "receivables_to_revenue": 0, "other_receivables_to_asset": .1,
             "dividend_cash_CNY": 12} for y in range(2020, 2026)]


def items(score):
    return {i['key']: i for d in score['dimensions'] for i in d['items']}


class BookScorePreviewTests(unittest.TestCase):
    def test_weights_and_scenarios_are_each_100(self):
        self.assertEqual(sum(d[1] for d in DIMENSIONS), 100)
        for _, maximum, specs in DIMENSIONS:
            self.assertEqual(sum(i[1] for i in specs), maximum)
        for weights in SCENARIOS.values():
            self.assertEqual(sum(weights), 100)

    def test_healthy_case_and_consolidated_profit_matching(self):
        out = preview_score(healthy_rows())
        self.assertTrue(out['rankable'])
        self.assertAlmostEqual(out['total'], 100)
        self.assertAlmostEqual(items(out)['cfo_conversion']['value'], 25 / 22)
        self.assertAlmostEqual(items(out)['payout']['value'], 60)
        self.assertEqual(out['strict_safety_status'], 'unverified')

    def test_missing_dividend_is_not_confirmed_zero_or_normalized(self):
        rows = healthy_rows()
        rows[-1]['dividend_cash_CNY'] = None
        out = preview_score(rows)
        self.assertIsNone(out['total'])
        self.assertEqual(out['coverage'], .9)
        self.assertEqual(out['missing'], ['payout', 'dividend_consistency'])
        self.assertAlmostEqual(out['score_range'][1] - out['score_range'][0], 10)
        self.assertIsNone(scenario_total(out, SCENARIOS['偏现金']))

    def test_confirmed_zero_dividends_score_zero(self):
        rows = healthy_rows()
        for r in rows:
            r['dividend_cash_CNY'] = 0
        out = preview_score(rows)
        self.assertTrue(out['rankable'])
        self.assertEqual(out['dimensions'][-1]['score'], 0)
        self.assertEqual(items(out)['payout']['status'], 'observed_zero')

    def test_latest_liquidity_deterioration_is_not_hidden_by_median(self):
        rows = healthy_rows()
        rows[-1]['cash'] = 20
        out = preview_score(rows)
        self.assertEqual(items(out)['liquidity']['score'], 0)

    def test_liquidity_uses_bottleneck_without_double_reward(self):
        rows = healthy_rows()
        rows[-1]['current_assets'] = 100
        out = preview_score(rows)
        self.assertEqual(items(out)['liquidity']['score'], 0)

    def test_confirmed_no_current_liabilities_differs_from_missing(self):
        rows = healthy_rows()
        rows[-1]['current_liabilities'] = 0
        self.assertEqual(items(preview_score(rows))['liquidity']['score'], 10)
        rows[-1]['current_liabilities'] = None
        self.assertIn('liquidity', preview_score(rows)['missing'])

    def test_latest_receivables_and_nonrecurring_deterioration(self):
        rows = healthy_rows()
        rows[-1].update(receivables_to_revenue=15, nonrecurring_ratio=30)
        out = items(preview_score(rows))
        self.assertEqual(out['receivables']['score'], 0)
        self.assertEqual(out['nonrecurring']['score'], 0)

    def test_cagr_and_yoy_require_real_previous_year(self):
        out = preview_score(healthy_rows()[1:])
        self.assertIn('revenue_cagr', out['missing'])
        self.assertIn('worst_revenue_yoy', out['missing'])
        rows = healthy_rows()
        del rows[-2]
        out = preview_score(rows)
        self.assertEqual(out['years'], [2021, 2022, 2023, 2024, 2025])
        self.assertIsNone(out['total'])

    def test_losses_and_nonpositive_profit_are_observed(self):
        rows = healthy_rows()
        for r in rows:
            r['net_profit'] = -1
            r['consolidated_net_profit'] = -1
            r['nonrecurring_ratio'] = None
        out = preview_score(rows)
        self.assertTrue(out['rankable'])
        self.assertLessEqual(out['total'], 49)
        for key in ('nonrecurring', 'cfo_conversion', 'fcf_conversion', 'payout'):
            self.assertEqual(items(out)[key]['status'], 'economic_invalid')
            self.assertEqual(items(out)[key]['score'], 0)

    def test_expansion_spending_does_not_automatically_cap_score(self):
        rows = healthy_rows()
        for r in rows:
            r['capex'] = 30
            r['owner_fcf'] = 999
        out = preview_score(rows)
        self.assertEqual(out['risk_cap'], 100)
        self.assertEqual(items(out)['fcf_conversion']['score'], 0)
        self.assertTrue(out['observations'])

    def test_missing_consolidated_profit_cannot_pair_with_other_year(self):
        rows = healthy_rows()
        rows[-2]['consolidated_net_profit'] = None
        out = preview_score(rows)
        self.assertEqual(items(out)['cfo_conversion']['valid_years'], 4)
        self.assertIn('cfo_conversion', out['missing'])

    def test_risk_gates_take_lowest_cap(self):
        rows = healthy_rows()
        for r in rows[-2:]:
            r['cfo'] = -1
        rows[-1]['net_profit'] = -1
        rows[-1]['total_liabilities'] = 301
        out = preview_score(rows)
        self.assertEqual(out['risk_cap'], 39)
        self.assertEqual(len(out['risk_gates']), 3)

    def test_input_is_not_mutated_and_scenarios_keep_same_risks(self):
        rows = healthy_rows()
        before = copy.deepcopy(rows)
        out = preview_score(rows)
        self.assertEqual(rows, before)
        self.assertAlmostEqual(scenario_total(out, SCENARIOS['基准']), out['total'])
        for weights in SCENARIOS.values():
            self.assertAlmostEqual(scenario_total(out, weights), 100)

    def test_preview_cannot_overwrite_input(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'snapshot.json'
            source.write_text('{}')
            with self.assertRaises(ValueError):
                run(source, source)
            self.assertEqual(source.read_text(), '{}')


if __name__ == '__main__':
    unittest.main()
