#!/usr/bin/env python3
"""Fetch A-share bank data snapshots with AkShare and persist run metadata."""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import pandas as pd

AK_IMPORT_ERROR: Optional[str] = None
try:
    import akshare as ak  # type: ignore
except Exception as exc:  # noqa: BLE001
    ak = None
    AK_IMPORT_ERROR = str(exc)


A_SHARE_BANKS: List[Dict[str, Any]] = [
    {"code": "000001", "name": "平安银行", "market": "SZ", "focus18": True},
    {"code": "001227", "name": "兰州银行", "market": "SZ", "focus18": False},
    {"code": "002142", "name": "宁波银行", "market": "SZ", "focus18": True},
    {"code": "002807", "name": "江阴银行", "market": "SZ", "focus18": False},
    {"code": "002839", "name": "张家港行", "market": "SZ", "focus18": False},
    {"code": "002936", "name": "郑州银行", "market": "SZ", "focus18": False},
    {"code": "002948", "name": "青岛银行", "market": "SZ", "focus18": False},
    {"code": "002958", "name": "青农商行", "market": "SZ", "focus18": False},
    {"code": "002966", "name": "苏州银行", "market": "SZ", "focus18": False},
    {"code": "600000", "name": "浦发银行", "market": "SH", "focus18": True},
    {"code": "600015", "name": "华夏银行", "market": "SH", "focus18": False},
    {"code": "600016", "name": "民生银行", "market": "SH", "focus18": True},
    {"code": "600036", "name": "招商银行", "market": "SH", "focus18": True},
    {"code": "600908", "name": "无锡银行", "market": "SH", "focus18": False},
    {"code": "600919", "name": "江苏银行", "market": "SH", "focus18": True},
    {"code": "600926", "name": "杭州银行", "market": "SH", "focus18": True},
    {"code": "600928", "name": "西安银行", "market": "SH", "focus18": False},
    {"code": "601009", "name": "南京银行", "market": "SH", "focus18": True},
    {"code": "601077", "name": "渝农商行", "market": "SH", "focus18": False},
    {"code": "601128", "name": "常熟银行", "market": "SH", "focus18": True},
    {"code": "601166", "name": "兴业银行", "market": "SH", "focus18": True},
    {"code": "601169", "name": "北京银行", "market": "SH", "focus18": False},
    {"code": "601187", "name": "厦门银行", "market": "SH", "focus18": False},
    {"code": "601229", "name": "上海银行", "market": "SH", "focus18": False},
    {"code": "601288", "name": "农业银行", "market": "SH", "focus18": True},
    {"code": "601328", "name": "交通银行", "market": "SH", "focus18": True},
    {"code": "601398", "name": "工商银行", "market": "SH", "focus18": True},
    {"code": "601528", "name": "瑞丰银行", "market": "SH", "focus18": False},
    {"code": "601577", "name": "长沙银行", "market": "SH", "focus18": False},
    {"code": "601658", "name": "邮储银行", "market": "SH", "focus18": True},
    {"code": "601665", "name": "齐鲁银行", "market": "SH", "focus18": False},
    {"code": "601818", "name": "光大银行", "market": "SH", "focus18": False},
    {"code": "601825", "name": "沪农商行", "market": "SH", "focus18": False},
    {"code": "601838", "name": "成都银行", "market": "SH", "focus18": True},
    {"code": "601860", "name": "紫金银行", "market": "SH", "focus18": False},
    {"code": "601916", "name": "浙商银行", "market": "SH", "focus18": False},
    {"code": "601939", "name": "建设银行", "market": "SH", "focus18": True},
    {"code": "601963", "name": "重庆银行", "market": "SH", "focus18": False},
    {"code": "601988", "name": "中国银行", "market": "SH", "focus18": True},
    {"code": "601997", "name": "贵阳银行", "market": "SH", "focus18": False},
    {"code": "601998", "name": "中信银行", "market": "SH", "focus18": True},
    {"code": "603323", "name": "苏农银行", "market": "SH", "focus18": False},
]

STEP_CHOICES = ["spot", "yjbb", "abstract", "valuation", "dividend", "balance_sheet"]

# 银行专属资产负债表（东方财富 stock_balance_sheet_by_report_em）中，
# 可直接映射为"核心财务摘要"字段、且不需要额外估算的科目。
# 注意：不良率/拨备覆盖率/拨贷比/NIM/核心一级资本充足率等监管指标不在
# 三大报表科目范围内（属于银行年报"经营情况讨论与分析"专项披露），
# AkShare 财务报表接口无法提供，因此不在此列。
BALANCE_SHEET_FIELD_MAP: Dict[str, str] = {
    "TOTAL_ASSETS": "总资产",
    "LOAN_ADVANCE": "发放贷款及垫款",
    "ACCEPT_DEPOSIT": "吸收存款",
    "TOTAL_PARENT_EQUITY": "归母净资产",
    "TOTAL_EQUITY": "股东权益合计",
}
SIGNAL_TIMEOUT_AVAILABLE = all(
    hasattr(signal, name) for name in ("SIGALRM", "ITIMER_REAL", "setitimer")
)


def capability_status() -> Dict[str, str]:
    return {
        "bank_universe": "implemented",
        "spot_and_market_cap": "implemented_with_fallback",
        "earnings_report": "implemented",
        "financial_abstract": "implemented",
        "historical_valuation": "implemented_with_fallback",
        "dividend": "implemented",
        "balance_sheet": "implemented",
        "a_h_comparison": "deferred_to_later_task",
        "historical_market_data": "deferred_to_later_task",
    }


@dataclass
class FetchResult:
    status: str
    records: int
    output_files: List[str]
    error: Optional[str] = None


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def date_tag() -> str:
    return datetime.now().strftime("%Y%m%d")


def datetime_tag() -> str:
    return datetime.now().strftime("%Y%m%dT%H%M%S")


def normalize_code(value: Any) -> str:
    if value is None:
        return ""
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return digits[-6:].zfill(6) if digits else ""


def detect_code_column(df: pd.DataFrame) -> Optional[str]:
    candidates = ["代码", "股票代码", "证券代码", "symbol"]
    for col in candidates:
        if col in df.columns:
            return col
    for col in df.columns:
        if "代码" in str(col):
            return col
    return None


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    ensure_dir(path.parent)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    atomic_write_json(path, payload)


def write_csv(path: Path, df: pd.DataFrame) -> None:
    ensure_dir(path.parent)
    df.to_csv(path, index=False, encoding="utf-8-sig")


class BankDataFetcher:
    def __init__(
        self,
        vault: Path,
        steps: Sequence[str],
        report_date: str,
        data_cutoff: str,
        retries: int,
        retry_wait: float,
        throttle: float,
        request_timeout: float,
        dry_run: bool,
    ) -> None:
        self.vault = vault
        self.steps = list(steps)
        self.report_date = report_date
        self.data_cutoff = data_cutoff
        self.retries = retries
        self.retry_wait = retry_wait
        self.throttle = throttle
        self.request_timeout = request_timeout
        self.dry_run = dry_run

        self.akshare_base = self.vault / "02_原始资料" / "04_AkShare数据"
        self.dir_spot = self.akshare_base / "行情与市值"
        self.dir_report = self.akshare_base / "财务报表"
        self.dir_abstract = self.akshare_base / "财务摘要"
        self.dir_valuation = self.akshare_base / "历史估值"
        self.dir_dividend = self.akshare_base / "分红"
        self.dir_balance_sheet = self.akshare_base / "资产负债表"
        self.dir_meta = self.akshare_base / "数据字典与运行记录"

        self.run_id = datetime_tag()
        self.last_success_file = self.dir_meta / "last_success_dates.json"
        self.last_success: Dict[str, str] = self._load_last_success()
        self.bank_code_set = {item["code"] for item in A_SHARE_BANKS}

        self.interface_runs: List[Dict[str, Any]] = []

    def _load_last_success(self) -> Dict[str, str]:
        if not self.last_success_file.exists():
            return {}
        try:
            return json.loads(self.last_success_file.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return {}

    def _save_last_success(self) -> None:
        existing = self._read_json(self.last_success_file)
        merged = existing if isinstance(existing, dict) else {}
        merged.update(self.last_success)
        atomic_write_json(self.last_success_file, merged)
        self.last_success = merged

    @staticmethod
    def _read_json(path: Path) -> Dict[str, Any]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}

    def _merge_status_index(
        self,
        step_results: Dict[str, Dict[str, Any]],
        interface_runs: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        status_file = self.dir_meta / "run_meta_latest.json"
        previous_index = self._read_json(status_file)
        raw_steps = previous_index.get("steps") if isinstance(previous_index.get("steps"), dict) else {}
        raw_interfaces = previous_index.get("interfaces") if isinstance(previous_index.get("interfaces"), dict) else {}
        existing_steps = {
            key: value for key, value in raw_steps.items()
            if isinstance(value, dict) and value.get("status") != "dry_run"
        }
        existing_interfaces = {
            key: value for key, value in raw_interfaces.items()
            if isinstance(value, dict) and value.get("status") != "dry_run"
        }

        for step, result in step_results.items():
            if result.get("status") == "dry_run":
                continue
            existing_steps[step] = {**result, "run_id": self.run_id, "updated_at": now_iso()}

        for item in interface_runs:
            interface = item.get("interface")
            if not isinstance(interface, str) or item.get("status") == "dry_run":
                continue
            previous = existing_interfaces.get(interface, {})
            merged = {**previous, **item, "run_id": self.run_id}
            if not merged.get("last_success_date") and previous.get("last_success_date"):
                merged["last_success_date"] = previous["last_success_date"]
            existing_interfaces[interface] = merged

        index = {
            "status_index_version": 1,
            "updated_at": now_iso(),
            "steps": existing_steps,
            "interfaces": existing_interfaces,
            "capability_status": capability_status(),
        }
        atomic_write_json(status_file, index)
        return index

    def _interface_key(self, interface: str) -> str:
        return interface

    def _record_interface(
        self,
        *,
        step: str,
        interface: str,
        params: Dict[str, Any],
        started_at: str,
        ended_at: str,
        status: str,
        error: Optional[str],
        records: int,
        output_files: Optional[List[str]] = None,
    ) -> None:
        key = self._interface_key(interface)
        if status == "success":
            self.last_success[key] = datetime.now().strftime("%Y-%m-%d")

        item = {
            "step": step,
            "interface": interface,
            "params": params,
            "started_at": started_at,
            "ended_at": ended_at,
            "status": status,
            "error": error,
            "records": records,
            "output_files": output_files or [],
            "last_success_date": self.last_success.get(key),
        }
        self.interface_runs.append(item)

    def _filter_bank_rows(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, Optional[str]]:
        code_col = detect_code_column(df)
        if code_col is None:
            return pd.DataFrame(), None
        normalized = df[code_col].map(normalize_code)
        mask = normalized.isin(self.bank_code_set)
        return df.loc[mask].copy(), code_col

    def _invoke_with_timeout(self, func: Callable[..., Any], params: Dict[str, Any], interface: str) -> Any:
        if self.request_timeout <= 0:
            return func(**params)

        can_use_signal = SIGNAL_TIMEOUT_AVAILABLE and threading.current_thread() is threading.main_thread()
        if can_use_signal:
            def timeout_handler(signum: int, frame: Any) -> None:
                raise TimeoutError(f"{interface} exceeded timeout={self.request_timeout}s")

            old_handler = signal.signal(signal.SIGALRM, timeout_handler)
            signal.setitimer(signal.ITIMER_REAL, self.request_timeout)
            try:
                return func(**params)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, old_handler)

        executor = ThreadPoolExecutor(max_workers=1)
        future = executor.submit(func, **params)
        try:
            return future.result(timeout=self.request_timeout)
        except FutureTimeoutError as exc:
            future.cancel()
            raise TimeoutError(f"{interface} exceeded timeout={self.request_timeout}s") from exc
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def _call_interface(
        self,
        *,
        step: str,
        interface: str,
        func: Callable[..., Any],
        params: Dict[str, Any],
    ) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
        started_at = now_iso()

        if self.dry_run:
            ended_at = now_iso()
            self._record_interface(
                step=step,
                interface=interface,
                params=params,
                started_at=started_at,
                ended_at=ended_at,
                status="dry_run",
                error=None,
                records=0,
            )
            return None, None

        if ak is None:
            ended_at = now_iso()
            error = "AkShare unavailable"
            if AK_IMPORT_ERROR:
                error = f"AkShare unavailable: {AK_IMPORT_ERROR}"
            self._record_interface(
                step=step,
                interface=interface,
                params=params,
                started_at=started_at,
                ended_at=ended_at,
                status="failed",
                error=error,
                records=0,
            )
            return None, error

        last_error: Optional[str] = None
        for attempt in range(1, self.retries + 1):
            try:
                data = self._invoke_with_timeout(func=func, params=params, interface=interface)
                if not isinstance(data, pd.DataFrame):
                    raise TypeError(f"{interface} 返回类型不是 DataFrame")

                ended_at = now_iso()
                self._record_interface(
                    step=step,
                    interface=interface,
                    params=params,
                    started_at=started_at,
                    ended_at=ended_at,
                    status="success",
                    error=None,
                    records=len(data),
                )
                if self.throttle > 0:
                    time.sleep(self.throttle)
                return data, None
            except Exception as exc:  # noqa: BLE001
                last_error = f"attempt={attempt}/{self.retries}: {exc}"
                if attempt < self.retries:
                    time.sleep(self.retry_wait)

        ended_at = now_iso()
        self._record_interface(
            step=step,
            interface=interface,
            params=params,
            started_at=started_at,
            ended_at=ended_at,
            status="failed",
            error=last_error,
            records=0,
        )
        return None, last_error

    def _write_universe(self) -> List[str]:
        ensure_dir(self.dir_meta)
        universe_json = self.dir_meta / "a_share_banks_universe.json"
        universe_csv = self.dir_meta / "a_share_banks_universe.csv"

        payload = {
            "data_cutoff": self.data_cutoff,
            "total_banks": len(A_SHARE_BANKS),
            "focus18_count": sum(1 for x in A_SHARE_BANKS if x["focus18"]),
            "banks": A_SHARE_BANKS,
        }
        write_json(universe_json, payload)
        write_csv(universe_csv, pd.DataFrame(A_SHARE_BANKS))

        return [
            universe_json.relative_to(self.vault).as_posix(),
            universe_csv.relative_to(self.vault).as_posix(),
        ]

    @staticmethod
    def _individual_info_row(df: pd.DataFrame, bank: Dict[str, Any]) -> Dict[str, Any]:
        row: Dict[str, Any] = {"代码": bank["code"], "名称": bank["name"]}
        if {"item", "value"}.issubset(df.columns):
            for _, item in df.iterrows():
                row[str(item["item"])] = item["value"]
        elif len(df) == 1:
            row.update(df.iloc[0].to_dict())
        else:
            raise ValueError("stock_individual_info_em 返回结构缺少 item/value")
        return row

    def _write_failure_details(self, step: str, failures: List[Dict[str, Any]], coverage: Dict[str, Any]) -> str:
        path = self.dir_meta / f"{step}_failure_details_{self.run_id}.json"
        atomic_write_json(
            path,
            {
                "run_id": self.run_id,
                "step": step,
                "generated_at": now_iso(),
                "coverage": coverage,
                "failures": failures,
            },
        )
        return path.relative_to(self.vault).as_posix()

    def _fetch_spot(self) -> FetchResult:
        df, err = self._call_interface(
            step="spot",
            interface="stock_zh_a_spot_em",
            func=ak.stock_zh_a_spot_em if ak else (lambda **_: None),
            params={},
        )
        if df is None and not err:
            return FetchResult(status="dry_run", records=0, output_files=[])

        if df is not None:
            bank_df, code_col = self._filter_bank_rows(df)
            if code_col is None:
                return FetchResult(status="failed", records=0, output_files=[], error="未识别代码列")
            source = "stock_zh_a_spot_em"
            failures: List[Dict[str, Any]] = []
        else:
            rows: List[Dict[str, Any]] = []
            failures = []
            for bank in A_SHARE_BANKS:
                info_df, info_err = self._call_interface(
                    step="spot",
                    interface="stock_individual_info_em",
                    func=ak.stock_individual_info_em if ak else (lambda **_: None),
                    params={"symbol": bank["code"], "timeout": self.request_timeout},
                )
                if info_df is None or info_err:
                    failures.append({"code": bank["code"], "name": bank["name"], "error": info_err})
                    continue
                try:
                    rows.append(self._individual_info_row(info_df, bank))
                except ValueError as exc:
                    failures.append({"code": bank["code"], "name": bank["name"], "error": str(exc)})
            bank_df = pd.DataFrame(rows)
            source = "stock_individual_info_em"

        coverage = {
            "expected": len(A_SHARE_BANKS),
            "succeeded": len(bank_df),
            "failed": len(failures),
            "coverage_ratio": round(len(bank_df) / len(A_SHARE_BANKS), 4),
            "source": source,
        }
        files: List[str] = []
        if failures:
            files.append(self._write_failure_details("spot", failures, coverage))
        if bank_df.empty:
            return FetchResult(status="failed", records=0, output_files=files, error=f"spot 全部接口失败: {err}")

        ts = date_tag()
        file_daily = self.dir_spot / f"a_share_bank_spot_{ts}.csv"
        file_latest = self.dir_spot / "a_share_bank_spot_latest.csv"
        write_csv(file_daily, bank_df)
        write_csv(file_latest, bank_df)
        files.extend([file_daily.relative_to(self.vault).as_posix(), file_latest.relative_to(self.vault).as_posix()])
        status = "success" if len(bank_df) == len(A_SHARE_BANKS) else "partial"
        return FetchResult(status=status, records=len(bank_df), output_files=files, error=None if status == "success" else f"部分覆盖 {len(bank_df)}/42")

    def _fetch_yjbb(self) -> FetchResult:
        df, err = self._call_interface(
            step="yjbb",
            interface="stock_yjbb_em",
            func=ak.stock_yjbb_em if ak else (lambda **_: None),
            params={"date": self.report_date},
        )
        if err:
            return FetchResult(status="failed", records=0, output_files=[], error=err)
        if df is None:
            return FetchResult(status="dry_run", records=0, output_files=[])

        bank_df, code_col = self._filter_bank_rows(df)
        if code_col is None:
            return FetchResult(status="failed", records=0, output_files=[], error="未识别代码列")

        file_date = self.dir_report / f"bank_yjbb_em_{self.report_date}.csv"
        file_latest = self.dir_report / "bank_yjbb_em_latest.csv"
        write_csv(file_date, bank_df)
        write_csv(file_latest, bank_df)

        files = [
            file_date.relative_to(self.vault).as_posix(),
            file_latest.relative_to(self.vault).as_posix(),
        ]
        self.interface_runs[-1]["output_files"] = files
        return FetchResult(status="success", records=len(bank_df), output_files=files)

    def _fetch_financial_abstract(self) -> FetchResult:
        merged: List[pd.DataFrame] = []
        output_files: List[str] = []
        errors: List[str] = []

        for bank in A_SHARE_BANKS:
            params = {"symbol": bank["code"], "indicator": "按报告期"}
            df, err = self._call_interface(
                step="abstract",
                interface="stock_financial_abstract_ths",
                func=ak.stock_financial_abstract_ths if ak else (lambda **_: None),
                params=params,
            )

            if err and ak:
                fallback_df, fallback_err = self._call_interface(
                    step="abstract",
                    interface="stock_financial_abstract_new_ths",
                    func=ak.stock_financial_abstract_new_ths,
                    params=params,
                )
                df = fallback_df
                err = fallback_err

            if err:
                errors.append(f"{bank['code']} {bank['name']}: {err}")
                continue

            if df is None:
                continue

            out = df.copy()
            out.insert(0, "银行代码", bank["code"])
            out.insert(1, "银行名称", bank["name"])
            merged.append(out)

            file_bank = self.dir_abstract / f"{bank['code']}_{bank['name']}_financial_abstract.csv"
            write_csv(file_bank, out)
            output_files.append(file_bank.relative_to(self.vault).as_posix())

            if self.interface_runs:
                self.interface_runs[-1]["output_files"] = [file_bank.relative_to(self.vault).as_posix()]

        if self.dry_run:
            return FetchResult(status="dry_run", records=0, output_files=[])

        if merged:
            merged_df = pd.concat(merged, ignore_index=True)
            file_all = self.dir_abstract / "bank_financial_abstract_all_latest.csv"
            write_csv(file_all, merged_df)
            output_files.insert(0, file_all.relative_to(self.vault).as_posix())

        status = "success" if merged else "failed"
        err_msg = None if not errors else "; ".join(errors)
        return FetchResult(status=status, records=len(merged), output_files=output_files, error=err_msg)

    def _fetch_valuation(self) -> FetchResult:
        merged: List[pd.DataFrame] = []
        output_files: List[str] = []
        failures: List[Dict[str, Any]] = []
        source_counts: Dict[str, int] = {}

        for bank in A_SHARE_BANKS:
            success_df: Optional[pd.DataFrame] = None
            used_interface: Optional[str] = None
            attempts: List[Dict[str, Any]] = []
            candidates = [
                ("stock_a_indicator_lg", {"symbol": bank["code"]}),
                ("stock_value_em", {"symbol": bank["code"]}),
                ("stock_zh_valuation_baidu", {"symbol": bank["code"], "indicator": "市净率", "period": "近一年"}),
            ]
            for interface, params in candidates:
                func = getattr(ak, interface, None) if ak else None
                if func is None:
                    attempts.append({"interface": interface, "error": "interface unavailable"})
                    continue
                candidate_df, candidate_err = self._call_interface(
                    step="valuation", interface=interface, func=func, params=params
                )
                if candidate_df is not None and not candidate_df.empty and not candidate_err:
                    success_df = candidate_df
                    used_interface = interface
                    break
                attempts.append({"interface": interface, "error": candidate_err or "empty result"})

            if success_df is None:
                failures.append({"code": bank["code"], "name": bank["name"], "attempts": attempts})
                continue

            out = success_df.copy()
            out.insert(0, "银行代码", bank["code"])
            out.insert(1, "银行名称", bank["name"])
            out.insert(2, "数据接口", used_interface)
            merged.append(out)
            source_counts[used_interface or "unknown"] = source_counts.get(used_interface or "unknown", 0) + 1

            file_bank = self.dir_valuation / f"{bank['code']}_{bank['name']}_valuation_history.csv"
            write_csv(file_bank, out)
            output_files.append(file_bank.relative_to(self.vault).as_posix())

        if self.dry_run:
            return FetchResult(status="dry_run", records=0, output_files=[])

        coverage = {
            "expected": len(A_SHARE_BANKS),
            "succeeded": len(merged),
            "failed": len(failures),
            "coverage_ratio": round(len(merged) / len(A_SHARE_BANKS), 4),
            "source_counts": source_counts,
        }
        if failures:
            output_files.append(self._write_failure_details("valuation", failures, coverage))
        if merged:
            merged_df = pd.concat(merged, ignore_index=True)
            file_all = self.dir_valuation / "bank_valuation_history_all_latest.csv"
            write_csv(file_all, merged_df)
            output_files.insert(0, file_all.relative_to(self.vault).as_posix())

        if not merged:
            return FetchResult(status="failed", records=0, output_files=output_files, error="valuation 全部接口失败")
        status = "success" if len(merged) == len(A_SHARE_BANKS) else "partial"
        return FetchResult(status=status, records=len(merged), output_files=output_files, error=None if status == "success" else f"部分覆盖 {len(merged)}/42")

    def _fetch_dividend(self) -> FetchResult:
        df, err = self._call_interface(
            step="dividend",
            interface="stock_fhps_em",
            func=ak.stock_fhps_em if ak else (lambda **_: None),
            params={"date": self.report_date},
        )
        if err:
            return FetchResult(status="failed", records=0, output_files=[], error=err)
        if df is None:
            return FetchResult(status="dry_run", records=0, output_files=[])

        bank_df, code_col = self._filter_bank_rows(df)
        if code_col is None:
            return FetchResult(status="failed", records=0, output_files=[], error="未识别代码列")

        file_date = self.dir_dividend / f"bank_dividend_em_{self.report_date}.csv"
        file_latest = self.dir_dividend / "bank_dividend_em_latest.csv"
        write_csv(file_date, bank_df)
        write_csv(file_latest, bank_df)

        files = [
            file_date.relative_to(self.vault).as_posix(),
            file_latest.relative_to(self.vault).as_posix(),
        ]
        self.interface_runs[-1]["output_files"] = files
        return FetchResult(status="success", records=len(bank_df), output_files=files)

    def _fetch_balance_sheet(self) -> FetchResult:
        """采集18/42家银行的资产负债表（按报告期），仅用于回填总资产/贷款/存款/
        归母净资产等可直接从报表科目取得的字段。不良率/拨备覆盖率/NIM/CET1 等
        监管指标不在三大报表范围内，AkShare 无法提供，需人工从年报补入。"""
        merged: List[pd.DataFrame] = []
        output_files: List[str] = []
        failures: List[Dict[str, Any]] = []

        keep_cols = ["SECURITY_CODE", "SECURITY_NAME_ABBR", "REPORT_DATE", "REPORT_TYPE"] + list(
            BALANCE_SHEET_FIELD_MAP.keys()
        )

        for bank in A_SHARE_BANKS:
            symbol = f"{bank['market']}{bank['code']}"
            df, err = self._call_interface(
                step="balance_sheet",
                interface="stock_balance_sheet_by_report_em",
                func=ak.stock_balance_sheet_by_report_em if ak else (lambda **_: None),
                params={"symbol": symbol},
            )
            if err:
                failures.append({"code": bank["code"], "name": bank["name"], "error": err})
                continue
            if df is None:
                continue
            if df.empty:
                failures.append({"code": bank["code"], "name": bank["name"], "error": "empty result"})
                continue

            available_cols = [c for c in keep_cols if c in df.columns]
            out = df[available_cols].copy()
            out = out.sort_values("REPORT_DATE", ascending=False).reset_index(drop=True)
            out.insert(0, "银行代码", bank["code"])
            out.insert(1, "银行名称", bank["name"])
            out = out.rename(columns=BALANCE_SHEET_FIELD_MAP)
            merged.append(out)

            file_bank = self.dir_balance_sheet / f"{bank['code']}_{bank['name']}_balance_sheet.csv"
            write_csv(file_bank, out)
            output_files.append(file_bank.relative_to(self.vault).as_posix())

            if self.interface_runs:
                self.interface_runs[-1]["output_files"] = [file_bank.relative_to(self.vault).as_posix()]

        if self.dry_run:
            return FetchResult(status="dry_run", records=0, output_files=[])

        coverage = {
            "expected": len(A_SHARE_BANKS),
            "succeeded": len(merged),
            "failed": len(failures),
            "coverage_ratio": round(len(merged) / len(A_SHARE_BANKS), 4),
        }
        if failures:
            output_files.append(self._write_failure_details("balance_sheet", failures, coverage))
        if merged:
            merged_df = pd.concat(merged, ignore_index=True)
            file_all = self.dir_balance_sheet / "bank_balance_sheet_all_latest.csv"
            write_csv(file_all, merged_df)
            output_files.insert(0, file_all.relative_to(self.vault).as_posix())

        if not merged:
            return FetchResult(status="failed", records=0, output_files=output_files, error="balance_sheet 全部接口失败")
        status = "success" if len(merged) == len(A_SHARE_BANKS) else "partial"
        return FetchResult(
            status=status,
            records=len(merged),
            output_files=output_files,
            error=None if status == "success" else f"部分覆盖 {len(merged)}/{len(A_SHARE_BANKS)}",
        )

    def run(self) -> Tuple[int, Dict[str, Any]]:
        started_at = now_iso()
        universe_files = self._write_universe()

        step_results: Dict[str, Dict[str, Any]] = {}
        failures = 0

        runner_map = {
            "spot": self._fetch_spot,
            "yjbb": self._fetch_yjbb,
            "abstract": self._fetch_financial_abstract,
            "valuation": self._fetch_valuation,
            "dividend": self._fetch_dividend,
            "balance_sheet": self._fetch_balance_sheet,
        }

        for step in self.steps:
            result = runner_map[step]()
            step_results[step] = {
                "status": result.status,
                "records": result.records,
                "output_files": result.output_files,
                "error": result.error,
            }
            if result.status == "failed":
                failures += 1

        ended_at = now_iso()
        summary = {
            "run_id": self.run_id,
            "started_at": started_at,
            "ended_at": ended_at,
            "vault": str(self.vault),
            "data_cutoff": self.data_cutoff,
            "report_date": self.report_date,
            "dry_run": self.dry_run,
            "python_version": sys.version.split()[0],
            "akshare_version": getattr(ak, "__version__", None),
            "akshare_import_error": AK_IMPORT_ERROR,
            "steps": self.steps,
            "capability_status": capability_status(),
            "universe_files": universe_files,
            "step_results": step_results,
            "interface_runs": self.interface_runs,
            "failure_count": failures,
        }

        ensure_dir(self.dir_meta)
        run_meta_file = self.dir_meta / f"run_meta_{self.run_id}.json"
        atomic_write_json(run_meta_file, summary)
        self._save_last_success()
        self._merge_status_index(step_results, self.interface_runs)

        exit_code = 0 if failures == 0 else 1
        return exit_code, summary


def parse_steps(raw: str) -> List[str]:
    if raw.strip().lower() == "all":
        return STEP_CHOICES.copy()
    steps = [x.strip().lower() for x in raw.split(",") if x.strip()]
    unknown = [x for x in steps if x not in STEP_CHOICES]
    if unknown:
        raise ValueError(f"unknown steps: {', '.join(unknown)}")
    if not steps:
        raise ValueError("steps cannot be empty")
    return steps


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fetch A-share bank data from AkShare")
    parser.add_argument(
        "--vault",
        default=".",
        help="Vault root path, default current directory",
    )
    parser.add_argument(
        "--steps",
        default="all",
        help="Comma-separated steps: spot,yjbb,abstract,valuation,dividend,balance_sheet or all",
    )
    parser.add_argument(
        "--report-date",
        default="20251231",
        help="Financial report date for yjbb/dividend interfaces, format YYYYMMDD",
    )
    parser.add_argument(
        "--data-cutoff",
        default="2026-07-22",
        help="Data cutoff date written into metadata, format YYYY-MM-DD",
    )
    parser.add_argument("--retries", type=int, default=3, help="Retry times per interface")
    parser.add_argument("--retry-wait", type=float, default=1.5, help="Retry sleep seconds")
    parser.add_argument("--throttle", type=float, default=0.6, help="Throttle seconds between calls")
    parser.add_argument("--request-timeout", type=float, default=12.0, help="Per-interface timeout seconds, <=0 means no timeout")
    parser.add_argument("--dry-run", action="store_true", help="Do not call network interfaces")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        steps = parse_steps(args.steps)
    except ValueError as exc:
        print(f"Invalid --steps: {exc}", file=sys.stderr)
        return 2

    vault = Path(args.vault).resolve()
    if not vault.exists() or not vault.is_dir():
        print(f"Vault path does not exist or is not a directory: {vault}", file=sys.stderr)
        return 2

    fetcher = BankDataFetcher(
        vault=vault,
        steps=steps,
        report_date=args.report_date,
        data_cutoff=args.data_cutoff,
        retries=args.retries,
        retry_wait=args.retry_wait,
        throttle=args.throttle,
        request_timeout=args.request_timeout,
        dry_run=args.dry_run,
    )
    code, summary = fetcher.run()

    print(json.dumps({"run_id": summary["run_id"], "failure_count": summary["failure_count"], "steps": summary["steps"]}, ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
