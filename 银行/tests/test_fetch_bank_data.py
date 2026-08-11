import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "fetch_bank_data.py"
SPEC = importlib.util.spec_from_file_location("fetch_bank_data", SCRIPT)
fetch = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = fetch
SPEC.loader.exec_module(fetch)


class FetchBankDataTests(unittest.TestCase):
    def _fetcher(self, vault: Path, steps=None):
        return fetch.BankDataFetcher(
            vault=vault,
            steps=steps or ["spot"],
            report_date="20251231",
            data_cutoff="2026-07-22",
            retries=1,
            retry_wait=0,
            throttle=0,
            request_timeout=1,
            dry_run=False,
        )

    def test_detect_code_column_never_treats_name_as_code(self):
        frame = pd.DataFrame({"股票简称": ["招商银行"], "最新价": [40.0]})
        self.assertIsNone(fetch.detect_code_column(frame))

    def test_filter_bank_rows_keeps_only_known_bank_codes(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fetcher = self._fetcher(Path(tmp_dir))
            frame = pd.DataFrame(
                {"股票代码": ["000001", "600036", "600519"], "最新价": [10, 20, 30]}
            )
            filtered, code_col = fetcher._filter_bank_rows(frame)
            self.assertEqual(code_col, "股票代码")
            self.assertEqual(filtered["股票代码"].tolist(), ["000001", "600036"])

    def test_spot_schema_without_code_column_fails_and_writes_no_csv(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            vault = Path(tmp_dir)
            fetcher = self._fetcher(vault)
            with patch.object(
                fetcher,
                "_call_interface",
                return_value=(pd.DataFrame({"股票简称": ["招商银行"], "最新价": [40]}), None),
            ):
                result = fetcher._fetch_spot()
            self.assertEqual(result.status, "failed")
            self.assertFalse(list(vault.rglob("*.csv")))

    def test_failed_spot_does_not_generate_fake_csv_and_writes_failure_details(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            vault = Path(tmp_dir)
            fetcher = self._fetcher(vault)
            with patch.object(fetcher, "_call_interface", return_value=(None, "primary failed")):
                result = fetcher._fetch_spot()
            self.assertEqual(result.status, "failed")
            self.assertFalse(list((vault / "02_原始资料/04_AkShare数据/行情与市值").glob("*.csv")))
            self.assertTrue(result.error)

    def test_status_index_merges_steps_and_preserves_success(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            vault = Path(tmp_dir)
            fetcher = self._fetcher(vault)
            status_file = fetcher.dir_meta / "run_meta_latest.json"
            fetch.atomic_write_json(
                status_file,
                {
                    "steps": {
                        "yjbb": {"status": "success", "run_id": "old-success"},
                    },
                    "interfaces": {
                        "stock_yjbb_em": {"status": "success", "last_success_date": "2026-07-22"}
                    },
                },
            )
            fetcher.run_id = "new-run"
            fetcher._merge_status_index(
                {"spot": {"status": "failed", "error": "network"}},
                [{"interface": "stock_zh_a_spot_em", "status": "failed", "last_success_date": None}],
            )
            payload = json.loads(status_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["steps"]["yjbb"]["status"], "success")
            self.assertEqual(payload["steps"]["spot"]["status"], "failed")
            self.assertEqual(payload["interfaces"]["stock_yjbb_em"]["last_success_date"], "2026-07-22")

    def test_empty_status_index_remains_empty_after_dry_run(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fetcher = self._fetcher(Path(tmp_dir))
            fetcher.dry_run = True
            fetcher._merge_status_index(
                {"spot": {"status": "dry_run", "records": 0}},
                [{"interface": "stock_zh_a_spot_em", "status": "dry_run", "records": 0}],
            )
            payload = json.loads((fetcher.dir_meta / "run_meta_latest.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["steps"], {})
            self.assertEqual(payload["interfaces"], {})

    def test_legacy_dry_run_entries_are_removed_during_migration(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fetcher = self._fetcher(Path(tmp_dir))
            status_file = fetcher.dir_meta / "run_meta_latest.json"
            fetch.atomic_write_json(status_file, {
                "steps": {"spot": {"status": "dry_run"}, "valuation": {"status": "success", "records": 42}},
                "interfaces": {"stock_zh_a_spot_em": {"status": "dry_run"}, "stock_value_em": {"status": "success"}},
            })
            fetcher._merge_status_index({}, [])
            payload = json.loads(status_file.read_text(encoding="utf-8"))
            self.assertNotIn("spot", payload["steps"])
            self.assertNotIn("stock_zh_a_spot_em", payload["interfaces"])
            self.assertEqual(payload["steps"]["valuation"]["status"], "success")

    def test_status_index_dry_run_does_not_overwrite_real_success(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            vault = Path(tmp_dir)
            fetcher = self._fetcher(vault)
            status_file = fetcher.dir_meta / "run_meta_latest.json"
            fetch.atomic_write_json(
                status_file,
                {
                    "steps": {"yjbb": {"status": "success", "records": 42}},
                    "interfaces": {},
                    "legacy_field": "must be removed",
                },
            )
            fetcher._merge_status_index(
                {"yjbb": {"status": "dry_run", "records": 0}},
                [{"interface": "stock_yjbb_em", "status": "dry_run", "last_success_date": None}],
            )
            payload = json.loads(status_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["steps"]["yjbb"]["status"], "success")
            self.assertNotIn("legacy_field", payload)

    def test_status_index_dry_run_does_not_overwrite_real_interface_state(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fetcher = self._fetcher(Path(tmp_dir))
            status_file = fetcher.dir_meta / "run_meta_latest.json"
            fetch.atomic_write_json(
                status_file,
                {
                    "steps": {},
                    "interfaces": {
                        "stock_yjbb_em": {"status": "success", "records": 42, "last_success_date": "2026-07-22"}
                    },
                },
            )
            fetcher._merge_status_index(
                {},
                [{"interface": "stock_yjbb_em", "status": "dry_run", "records": 0, "last_success_date": None}],
            )
            payload = json.loads(status_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["interfaces"]["stock_yjbb_em"]["status"], "success")
            self.assertEqual(payload["interfaces"]["stock_yjbb_em"]["records"], 42)

    def test_partial_real_status_is_preserved_from_dry_run(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fetcher = self._fetcher(Path(tmp_dir))
            status_file = fetcher.dir_meta / "run_meta_latest.json"
            fetch.atomic_write_json(status_file, {
                "steps": {"spot": {"status": "partial", "records": 20, "error": "部分覆盖 20/42"}},
                "interfaces": {"stock_individual_info_em": {"status": "partial", "records": 20}},
            })
            fetcher._merge_status_index(
                {"spot": {"status": "dry_run", "records": 0}},
                [{"interface": "stock_individual_info_em", "status": "dry_run", "records": 0}],
            )
            payload = json.loads(status_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["steps"]["spot"]["status"], "partial")
            self.assertEqual(payload["interfaces"]["stock_individual_info_em"]["status"], "partial")

    def test_timeout_fallback_runs_without_sigalrm(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fetcher = self._fetcher(Path(tmp_dir))
            with patch.object(fetch, "SIGNAL_TIMEOUT_AVAILABLE", False):
                result = fetcher._invoke_with_timeout(lambda value: value + 1, {"value": 1}, "demo")
            self.assertEqual(result, 2)

    def test_capability_status_marks_deferred_capabilities(self):
        status = fetch.capability_status()
        self.assertEqual(status["a_h_comparison"], "deferred_to_later_task")
        self.assertEqual(status["historical_market_data"], "deferred_to_later_task")


if __name__ == "__main__":
    unittest.main()
