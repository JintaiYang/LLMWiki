import json
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_vault.py"

REQUIRED_DIRS = [
    "01_收件箱",
    "02_原始资料",
    "02_原始资料/04_AkShare数据",
    "03_模板",
    "04_运维报告",
    "05_知识库",
]

REQUIRED_FILES = [
    "06_维护契约.md",
    "06A_银行业数据口径规范.md",
]

REQUIRED_TEMPLATES = [
    "银行基础档案模板.md",
    "重点银行深度研究模板.md",
    "投资命题模板.md",
    "财报更新模板.md",
    "季度复盘模板.md",
    "通用知识页面模板.md",
    "来源笔记模板.md",
]

FOCUS_18 = [
    "工商银行",
    "建设银行",
    "农业银行",
    "中国银行",
    "邮储银行",
    "交通银行",
    "招商银行",
    "兴业银行",
    "平安银行",
    "中信银行",
    "浦发银行",
    "民生银行",
    "宁波银行",
    "江苏银行",
    "成都银行",
    "杭州银行",
    "南京银行",
    "常熟银行",
]

OTHER_24 = [
    "兰州银行", "江阴银行", "张家港行", "郑州银行", "青岛银行", "青农商行",
    "苏州银行", "华夏银行", "无锡银行", "西安银行", "渝农商行", "北京银行",
    "厦门银行", "上海银行", "瑞丰银行", "长沙银行", "齐鲁银行", "光大银行",
    "沪农商行", "紫金银行", "浙商银行", "重庆银行", "贵阳银行", "苏农银行",
]

ALL_42 = FOCUS_18 + OTHER_24


class ValidateVaultTests(unittest.TestCase):
    def _write_text(self, base: Path, rel: str, content: str) -> None:
        target = base / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def _create_base_vault(self, tmp: Path) -> None:
        for directory in REQUIRED_DIRS:
            (tmp / directory).mkdir(parents=True, exist_ok=True)

        for file_name in REQUIRED_FILES:
            self._write_text(
                tmp,
                file_name,
                textwrap.dedent(
                    """\
                    ---
                    title: 治理文件
                    note_type: governance_contract
                    status: active
                    created: 2026-07-22
                    updated: 2026-07-22
                    data_cutoff: 2026-07-22
                    report_period: NA
                    evidence_level: high
                    evidence_class: internal_governance
                    source_priority: internal_governance
                    sources: []
                    related: []
                    tags: [治理]
                    ---
                    """
                ),
            )

        for template in REQUIRED_TEMPLATES:
            self._write_text(
                tmp,
                f"03_模板/{template}",
                textwrap.dedent(
                    """\
                    ---
                    title: 模板
                    note_type: template_bank
                    status: active
                    created: 2026-07-22
                    updated: 2026-07-22
                    data_cutoff: 2026-07-22
                    report_period: NA
                    evidence_level: mixed
                    evidence_class: mixed
                    source_priority: mixed
                    sources:
                      - "[[来源页1]]"
                    related:
                      - "[[相关页1]]"
                    tags:
                      - 模板
                    ---
                    [[来源页1]]
                    """
                ),
            )

        self._write_text(
            tmp,
            "05_知识库/10_来源/来源_招商银行年报.md",
            textwrap.dedent(
                """\
                ---
                title: 来源_招商银行年报
                note_type: source_note
                status: active
                created: 2026-07-22
                updated: 2026-07-22
                data_cutoff: 2026-07-22
                report_period: 2025A
                evidence_level: high
                evidence_class: official_fact
                source_priority: company_filing
                sources: []
                related: []
                tags:
                  - 来源
                ---
                """
            ),
        )

        self._write_text(
            tmp,
            "05_知识库/03_银行库/招商银行.md",
            textwrap.dedent(
                """\
                ---
                title: 招商银行
                note_type: bank_profile
                status: active
                created: 2026-07-22
                updated: 2026-07-22
                data_cutoff: 2026-07-22
                report_period: 2025A
                evidence_level: medium
                evidence_class: third_party_data
                source_priority: third_party_structured
                sources:
                  - "[[05_知识库/10_来源/来源_招商银行年报]]"
                related:
                  - "[[06A_银行业数据口径规范]]"
                tags:
                  - 银行
                ---
                见 [[05_知识库/10_来源/来源_招商银行年报]]
                """
            ),
        )

        universe = [
            {"code": f"{idx:06d}", "name": name, "focus18": name in FOCUS_18}
            for idx, name in enumerate(ALL_42, start=1)
        ]
        self._write_text(
            tmp,
            "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.json",
            json.dumps({"data_cutoff": "2026-07-22", "banks": universe}, ensure_ascii=False, indent=2),
        )

        codes = [item["code"] for item in universe]
        yjbb = "股票代码,股票简称\n" + "\n".join(
            f"{item['code']},{item['name']}" for item in universe
        ) + "\n"
        abstract = "银行代码,银行名称,报告期\n" + "\n".join(
            f"{item['code']},{item['name']},2025-12-31" for item in universe
        ) + "\n"
        valuation = "银行代码,银行名称,数据日期,市净率\n" + "\n".join(
            f"{item['code']},{item['name']},2026-07-22,1.0" for item in universe
        ) + "\n"
        dividend = "股票代码,股票简称\n" + "\n".join(
            f"{item['code']},{item['name']}" for item in universe[:10]
        ) + "\n"
        self._write_text(tmp, "02_原始资料/04_AkShare数据/财务报表/bank_yjbb_em_latest.csv", yjbb)
        self._write_text(tmp, "02_原始资料/04_AkShare数据/财务摘要/bank_financial_abstract_all_latest.csv", abstract)
        self._write_text(tmp, "02_原始资料/04_AkShare数据/历史估值/bank_valuation_history_all_latest.csv", valuation)
        self._write_text(tmp, "02_原始资料/04_AkShare数据/分红/bank_dividend_em_latest.csv", dividend)

        failure_rel = "02_原始资料/04_AkShare数据/数据字典与运行记录/spot_failure_details_real.json"
        self._write_text(
            tmp,
            failure_rel,
            json.dumps({"step": "spot", "coverage": {"expected": 42, "succeeded": 0}, "failures": [{"code": code, "error": "network"} for code in codes]}, ensure_ascii=False),
        )
        output_files = {
            "yjbb": ["02_原始资料/04_AkShare数据/财务报表/bank_yjbb_em_latest.csv"],
            "abstract": ["02_原始资料/04_AkShare数据/财务摘要/bank_financial_abstract_all_latest.csv"],
            "valuation": ["02_原始资料/04_AkShare数据/历史估值/bank_valuation_history_all_latest.csv"],
            "dividend": ["02_原始资料/04_AkShare数据/分红/bank_dividend_em_latest.csv"],
        }
        steps = {
            "spot": {"status": "failed", "records": 0, "output_files": [failure_rel], "error": "all sources failed"},
            **{
                step: {"status": "success", "records": 42 if step != "dividend" else 10, "output_files": files, "error": None}
                for step, files in output_files.items()
            },
        }
        self._write_text(
            tmp,
            "02_原始资料/04_AkShare数据/数据字典与运行记录/run_meta_latest.json",
            json.dumps({"status_index_version": 1, "steps": steps, "interfaces": {}, "capability_status": {"bank_universe": "implemented", "spot_and_market_cap": "implemented_with_fallback", "earnings_report": "implemented", "financial_abstract": "implemented", "historical_valuation": "implemented_with_fallback", "dividend": "implemented", "a_h_comparison": "deferred_to_later_task", "historical_market_data": "deferred_to_later_task"}}, ensure_ascii=False),
        )
        self._write_text(
            tmp,
            "02_原始资料/04_AkShare数据/数据字典与运行记录/last_success_dates.json",
            json.dumps({"stock_yjbb_em": "2026-07-22"}),
        )

    def _run_validator(self, vault: Path, phase: str = "data") -> subprocess.CompletedProcess:
        return subprocess.run(
            ["python3", str(VALIDATOR), "--vault", str(vault), "--phase", phase, "--json"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )

    def test_validator_script_exists(self):
        self.assertTrue(VALIDATOR.exists(), "scripts/validate_vault.py 应先实现")

    def test_validator_passes_on_valid_minimal_vault(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            result = self._run_validator(tmp)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["status"], "ok")
            self.assertGreaterEqual(payload["stats"]["markdown_files"], 3)
            self.assertEqual(payload["stats"]["bank_universe_count"], 42)
            self.assertEqual(payload["stats"]["focus_bank_count"], 18)
            self.assertEqual(payload["stats"]["yjbb_bank_count"], 42)
            self.assertEqual(payload["stats"]["abstract_bank_count"], 42)
            self.assertEqual(payload["stats"]["valuation_bank_count"], 42)
            self.assertEqual(payload["stats"]["dividend_bank_count"], 10)

    def test_validator_detects_broken_links_in_active_page(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            self._write_text(
                tmp,
                "05_知识库/03_银行库/坏链页面.md",
                textwrap.dedent(
                    """\
                    ---
                    title: 坏链页面
                    note_type: bank_profile
                    status: active
                    created: 2026-07-22
                    updated: 2026-07-22
                    data_cutoff: 2026-07-22
                    report_period: 2025A
                    evidence_level: medium
                    evidence_class: third_party_data
                    source_priority: third_party_structured
                    sources: []
                    related: []
                    tags: [测试]
                    ---
                    这里有坏链 [[不存在页面]]
                    """
                ),
            )
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("BROKEN_LINK", result.stdout)

    def test_validator_allows_broken_links_in_draft(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            self._write_text(
                tmp,
                "05_知识库/03_银行库/draft页面.md",
                textwrap.dedent(
                    """\
                    ---
                    title: draft页面
                    note_type: bank_profile
                    status: draft
                    created: 2026-07-22
                    updated: 2026-07-22
                    data_cutoff: 2026-07-22
                    report_period: 2025A
                    evidence_level: medium
                    evidence_class: third_party_data
                    source_priority: third_party_structured
                    sources: []
                    related: []
                    tags: [测试]
                    ---
                    允许坏链 [[未创建草稿链接]]
                    """
                ),
            )
            result = self._run_validator(tmp)
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_validator_detects_malformed_source_link(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            self._write_text(
                tmp,
                "05_知识库/03_银行库/来源链接错误页.md",
                textwrap.dedent(
                    """\
                    ---
                    title: 来源链接错误页
                    note_type: bank_profile
                    status: active
                    created: 2026-07-22
                    updated: 2026-07-22
                    data_cutoff: 2026-07-22
                    report_period: 2025A
                    evidence_level: medium
                    evidence_class: third_party_data
                    source_priority: third_party_structured
                    sources: []
                    related: []
                    tags: [测试]
                    ---
                    错误链接 [[来源/招商银行年报]]
                    """
                ),
            )
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("BAD_SOURCE_LINK", result.stdout)

    def test_validator_rejects_universe_with_fewer_than_42_banks(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            universe = json.loads(
                (tmp / "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.json").read_text(encoding="utf-8")
            )
            universe["banks"] = universe["banks"][:-1]
            self._write_text(
                tmp,
                "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.json",
                json.dumps(universe, ensure_ascii=False),
            )
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("BANK_UNIVERSE_COUNT", result.stdout)

    def test_validator_rejects_incorrect_focus18_flags(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            universe_path = tmp / "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.json"
            universe = json.loads(universe_path.read_text(encoding="utf-8"))
            universe["banks"][0]["focus18"] = False
            universe["banks"][-1]["focus18"] = True
            universe_path.write_text(json.dumps(universe, ensure_ascii=False), encoding="utf-8")
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("FOCUS_18_MISMATCH", result.stdout)

    def test_validator_rejects_duplicate_code_or_name(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            universe_path = tmp / "02_原始资料/04_AkShare数据/数据字典与运行记录/a_share_banks_universe.json"
            universe = json.loads(universe_path.read_text(encoding="utf-8"))
            universe["banks"][1]["code"] = universe["banks"][0]["code"]
            universe["banks"][2]["name"] = universe["banks"][0]["name"]
            universe_path.write_text(json.dumps(universe, ensure_ascii=False), encoding="utf-8")
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("BANK_UNIVERSE_DUPLICATE_CODE", result.stdout)
            self.assertIn("BANK_UNIVERSE_DUPLICATE_NAME", result.stdout)

    def test_data_phase_rejects_deleted_required_artifact(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            (tmp / "02_原始资料/04_AkShare数据/财务摘要/bank_financial_abstract_all_latest.csv").unlink()
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("DATA_ARTIFACT_MISSING", result.stdout)

    def test_data_phase_rejects_malformed_status_or_last_success_json(self):
        for rel in (
            "02_原始资料/04_AkShare数据/数据字典与运行记录/run_meta_latest.json",
            "02_原始资料/04_AkShare数据/数据字典与运行记录/last_success_dates.json",
        ):
            with self.subTest(rel=rel), tempfile.TemporaryDirectory() as tmp_dir:
                tmp = Path(tmp_dir)
                self._create_base_vault(tmp)
                self._write_text(tmp, rel, "{broken")
                result = self._run_validator(tmp)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("DATA_META_INVALID", result.stdout)

    def test_data_phase_rejects_missing_capability_status(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            path = tmp / "02_原始资料/04_AkShare数据/数据字典与运行记录/run_meta_latest.json"
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload.pop("capability_status")
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("CAPABILITY_STATUS_INVALID", result.stdout)

    def test_data_phase_requires_spot_failure_detail_when_snapshot_absent(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            detail = tmp / "02_原始资料/04_AkShare数据/数据字典与运行记录/spot_failure_details_real.json"
            detail.unlink()
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("SPOT_FAILURE_DETAIL_MISSING", result.stdout)

    def test_data_phase_rejects_missing_aggregated_output_reference(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            path = tmp / "02_原始资料/04_AkShare数据/数据字典与运行记录/run_meta_latest.json"
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["steps"]["dividend"]["output_files"].append("02_原始资料/04_AkShare数据/分红/missing.csv")
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = self._run_validator(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("OUTPUT_FILE_MISSING", result.stdout)

    def test_data_phase_allows_future_task7_links_but_final_rejects_them(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            self._create_base_vault(tmp)
            contract = tmp / "06_维护契约.md"
            contract.write_text(contract.read_text(encoding="utf-8") + "\n[[07_导航首页]] [[08_索引]] [[09_操作日志]]\n", encoding="utf-8")

            data_result = self._run_validator(tmp, phase="data")
            final_result = self._run_validator(tmp, phase="final")

            self.assertEqual(data_result.returncode, 0, msg=data_result.stdout + data_result.stderr)
            self.assertNotEqual(final_result.returncode, 0)
            self.assertIn("BROKEN_LINK", final_result.stdout)


if __name__ == "__main__":
    unittest.main()
