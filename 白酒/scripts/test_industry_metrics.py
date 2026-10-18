import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import liquor_pipeline as p
from audit_industry_data import formatted_amount


class IndustryMetricsTests(unittest.TestCase):
    def test_historical_interims_require_full_coverage_and_disclosure(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(p, "RAW", Path(tmp)), patch.object(p, "COMPANIES", {"600519": "A", "000858": "B"}):
            for code in p.COMPANIES:
                path = Path(tmp) / "income" / (code + ".csv")
                path.parent.mkdir(exist_ok=True)
                with path.open("w", newline="") as stream:
                    writer = csv.DictWriter(stream, fieldnames=["REPORT_DATE", "NOTICE_DATE", "UPDATE_DATE", "OPERATE_INCOME", "PARENT_NETPROFIT"])
                    writer.writeheader()
                    writer.writerows([
                        {"REPORT_DATE": "2018-06-30", "NOTICE_DATE": "2018-08-01", "UPDATE_DATE": "2018-08-01", "OPERATE_INCOME": 100, "PARENT_NETPROFIT": 0 if code == "600519" else ""},
                        {"REPORT_DATE": "2019-06-30", "NOTICE_DATE": "2019-08-01", "UPDATE_DATE": "2019-08-01", "OPERATE_INCOME": 200, "PARENT_NETPROFIT": -10},
                    ])
            by_date = {row["report_date"]: row for row in p.sample_financial_trends("2019-07-01", {})}
            self.assertNotIn("2019-06-30", by_date)
            self.assertEqual(by_date["2018-06-30"]["revenue"], 200)
            self.assertEqual(by_date["2018-06-30"]["coverage"]["net_profit"], 1)
            self.assertIsNone(by_date["2018-06-30"]["net_profit"])
            full = p.sample_financial_trends("2019-09-01", {})[-1]
            self.assertEqual(full["net_profit"], -20)
            self.assertIsNone(full["inventory"])
            supplement = {("000858", "2018-06-30", "net_profit"): {"value": "0", "source": "iFind:verified", "source_date": "2018-08-01"}}
            self.assertEqual(p.sample_financial_trends("2019-09-01", supplement)[0]["net_profit"], 0)
            supplement[("000858", "2018-06-30", "revenue")] = {"value": "999", "source": "iFind:conflict", "source_date": "2018-08-01"}
            self.assertIsNone(p.sample_financial_trends("2019-09-01", supplement)[0]["revenue"])

    def test_ifind_amount_precision_does_not_imply_exact_yuan(self):
        value, tolerance = formatted_amount("104.7222亿")
        self.assertEqual(value, 10472220000)
        self.assertAlmostEqual(tolerance, 5000.02)
        self.assertEqual(formatted_amount("-2153568792.32")[0], -2153568792.32)
        self.assertEqual(formatted_amount("1231.9103万")[0], 12319103)
        with self.assertRaises(ValueError):
            formatted_amount("false")


if __name__ == "__main__":
    unittest.main()
