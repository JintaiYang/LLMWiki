import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import backfill_history as history
import liquor_pipeline as pipeline


class HistoryTests(unittest.TestCase):
    def test_appending_history_preserves_existing_values_and_expands_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "income.csv"
            history.append_csv(path, [{"REPORT_DATE": "2025-12-31", "OPERATE_INCOME": "100.1234"}])
            history.append_csv(path, [{"REPORT_DATE": "2006-12-31", "OPERATE_INCOME": 50, "HISTORY_SOURCE_URL": "public-source"}])
            rows = pipeline.load_csv(path)
            self.assertEqual(rows[0]["OPERATE_INCOME"], "100.1234")
            self.assertEqual(rows[1]["HISTORY_SOURCE_URL"], "public-source")

    def test_acceptance_requires_company_currency_and_known_disclosure_dates(self):
        row = {"REPORT_DATE": "2006-12-31 00:00:00", "SECURITY_CODE": "600519", "NOTICE_DATE": "2007-04-30", "UPDATE_DATE": "2008-03-13", "CURRENCY": "CNY"}
        args = ("600519", ["2006-12-31"], "2026-10-10")
        self.assertEqual(history.accepted_rows([row], *args)[0]["REPORT_DATE"], "2006-12-31")
        self.assertEqual(history.accepted_rows([{**row, "NOTICE_DATE": None}], *args), [])
        self.assertEqual(history.accepted_rows([{**row, "UPDATE_DATE": "2026-10-11"}], *args), [])
        for changes in [{"SECURITY_CODE": "000858"}, {"CURRENCY": "USD"}, {"REPORT_DATE": "2007-12-31"}]:
            with self.assertRaises(ValueError):
                history.accepted_rows([{**row, **changes}], *args)

    def test_price_selection_never_borrows_another_calendar_year(self):
        rows = [["2005-12-30", "1", "10"], ["2006-12-28", "1", "20"], ["2006-12-29", "1", "21"], ["2007-01-04", "1", "22"]]
        self.assertEqual(history.year_end_price(rows, 2006), ("2006-12-29", 21))
        self.assertIsNone(history.year_end_price(rows, 2008))
        self.assertIsNone(history.year_end_price([["2006-12-29", "1", "0"]], 2006))

    def test_2006_returns_use_2005_average_balances(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(pipeline, "RAW", Path(tmp)):
            common = {"SECURITY_CODE": "600519", "NOTICE_DATE": "2007-04-30", "CURRENCY": "CNY"}
            history.append_csv(Path(tmp) / "balance/600519.csv", [
                {**common, "REPORT_DATE": "2005-12-31", "TOTAL_ASSETS": 100, "TOTAL_PARENT_EQUITY": 40},
                {**common, "REPORT_DATE": "2006-12-31", "TOTAL_ASSETS": 200, "TOTAL_PARENT_EQUITY": 60}])
            history.append_csv(Path(tmp) / "income/600519.csv", [{**common, "REPORT_DATE": "2006-12-31", "PARENT_NETPROFIT": 12, "NETPROFIT": 15, "OPERATE_INCOME": 100}])
            records, annual, _, sources, _ = pipeline.metrics_for("600519", {}, "2026-10-10")
            self.assertEqual(annual[0]["year"], 2006)
            self.assertEqual(len(annual), 20)
            self.assertEqual(annual[0]["roe"], 24)
            self.assertEqual(annual[0]["roa"], 10)
            self.assertIn("2005-12-31", records)
            self.assertIn("2005-12-31.total_assets", sources)


if __name__ == "__main__":
    unittest.main()
