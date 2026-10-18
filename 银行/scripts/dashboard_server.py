#!/usr/bin/env python3
"""仅本机使用的银行看板与手动数据更新服务。"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"
PY = sys.executable

# 按顺序执行；不接受前端传入命令或文件路径。
TASKS = {
    "high": (
        ("AkShare 收盘价优先，iFind 按银行补缺", PY, "scripts/fetch_bank_prices_akshare_first.py"),
        ("重建银行比较数据", PY, "scripts/generate_dashboard_data.py"),
        ("更新估值与知识库估值页", PY, "scripts/compute_bank_ddm.py"),
        ("回填监管指标", PY, "scripts/backfill_dashboard_regulatory.py"),
        ("回填深度指标", PY, "scripts/backfill_dashboard_deep_metrics.py"),
    ),
    "mid": (
        ("AkShare 三大报表", PY, "scripts/fetch_bank_statements_full.py", "--force"),
        ("AkShare 分红历史", PY, "scripts/fetch_bank_dividend_history.py", "--force"),
        ("AkShare 银行深度指标", PY, "scripts/fetch_bank_deep_metrics.py"),
        ("生成个股时序", PY, "scripts/generate_stock_detail_data.py"),
        ("计算六维打分", PY, "scripts/generate_stock_score_data.py"),
        ("iFind 利息附注", "node", "scripts/fetch_bank_pnl_notes.js"),
        ("生成利润流向", PY, "scripts/generate_pnl_sankey_data.py"),
        ("更新知识库深度研究", PY, "scripts/update_deep_research_docs.py"),
        ("更新跟踪器和银行档案", PY, "scripts/update_all_data.py"),
        ("重建银行比较数据", PY, "scripts/generate_dashboard_data.py"),
        ("更新估值与知识库估值页", PY, "scripts/compute_bank_ddm.py"),
        ("回填监管指标", PY, "scripts/backfill_dashboard_regulatory.py"),
        ("回填深度指标", PY, "scripts/backfill_dashboard_deep_metrics.py"),
    ),
    "low": (
        ("iFind 行业监管与整体估值", "node", "scripts/fetch_industry_dashboard.js"),
        ("更新宏观跟踪器与银行档案", PY, "scripts/update_all_data.py"),
    ),
}

NOTES = {
    "high": "行情逐银行先用 AkShare 未复权日线；缺价才访问 iFind。记录每家真实来源和日期，不因 AkShare 日期较旧而切换来源。",
    "mid": "三大报表、分红和深度基础指标由 AkShare 获取；年报附注缺同口径 AkShare 结构化接口时使用 iFind。iFind 个股专项指标无在线批采，沿用既有 CSV。",
    "low": "宏观跟踪器使用 AkShare；监管总量季度序列与中信整体法 PE/PB 未找到同口径 AkShare 接口，使用 iFind。NIM 历史专题不在线刷新。",
}

state_lock = threading.Lock()
state = {"status": "idle", "group": None, "step": 0, "total": 0, "current": "", "lines": [], "error": "", "started_at": "", "finished_at": "", "warnings": [], "dates_before": {}, "dates_after": {}}
token = secrets.token_urlsafe(24)


def snapshot():
    with state_lock:
        return dict(state, lines=list(state["lines"]), warnings=list(state["warnings"]))


def note(line):
    with state_lock:
        state["lines"].append(line.rstrip())
        state["lines"] = state["lines"][-250:]


def observed_dates():
    """仅从已保存的数据记录读取观测日；文件生成时间不等于数据日期。"""
    result = {}
    sources = {
        "行情": (ROOT / "02_原始资料/05_iFind数据/latest_prices.json", lambda d: d.get("price_date") or max((b.get("price_date") or "" for b in d.get("banks", [])), default="")),
        "个股估值": (DASHBOARD / "ddm.json", lambda d: d.get("price_date")),
        "个股财报": (DASHBOARD / "stock_data/_index.json", lambda d: max((b.get("latest_report_date") or "" for b in d.get("banks", [])), default="")),
        "个股打分": (DASHBOARD / "stock_data/_index.json", lambda d: max(((b.get("score_summary") or {}).get("period") or "" for b in d.get("banks", [])), default="")),
        "行业监管": (DASHBOARD / "industry.json", lambda d: max((k.get("date") or "" for k in d.get("kpis", []) if k.get("id") not in ("pb", "pe")), default="")),
        "行业估值": (DASHBOARD / "industry.json", lambda d: max((k.get("date") or "" for k in d.get("kpis", []) if k.get("id") in ("pb", "pe")), default="")),
    }
    for name, (path, extract) in sources.items():
        try:
            result[name] = extract(json.loads(path.read_text(encoding="utf-8"))) or None
        except (OSError, ValueError, TypeError, KeyError):
            result[name] = None
    return result


def run_group(group):
    steps = TASKS[group]
    try:
        for index, (label, *command) in enumerate(steps, 1):
            with state_lock:
                state.update(step=index, current=label)
            note(f"[{index}/{len(steps)}] {label}: {' '.join(command)}")
            proc = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, bufsize=1, env={**os.environ, "PYTHONUNBUFFERED": "1"})
            for line in proc.stdout:
                note(line)
            code = proc.wait()
            if code:
                raise RuntimeError(f"{label} 失败（退出码 {code}）；此前步骤可能已写入文件，请查看日志，不要把部分更新当作完成。")
    except Exception as exc:
        note(str(exc))
        with state_lock:
            state.update(status="failed", error=str(exc))
    finally:
        after = observed_dates()
        with state_lock:
            before = state["dates_before"]
            state["dates_after"] = after
            state["finished_at"] = datetime.now().isoformat(timespec="seconds")
            relevant = {"high": ("行情", "个股估值"), "mid": ("个股财报", "个股打分"), "low": ("行业监管", "行业估值")}[group]
            for name in relevant:
                old, new = before.get(name), after.get(name)
                change = "有新日期" if new and new != old else "日期未变化；请核对是否有新数据"
                state["warnings"].append(f"{name}数据截至日：{new or '未知'}（更新前：{old or '未知'}；{change}）")
            if state["status"] == "failed":
                state["warnings"].append("更新未完成，以上仅为当前文件中的日期，不代表该组数据已全部刷新。")
            else:
                state.update(status="success", current="全部步骤完成")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DASHBOARD), **kwargs)

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = urlsplit(self.path).path
        if route == "/api/update":
            self.send_json(200, snapshot())
        elif route == "/api/update-token":
            allowed = (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")
            if self.headers.get("Host") not in allowed or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin"):
                self.send_json(403, {"error": "仅允许本机同源操作"})
            else:
                self.send_json(200, {"token": token})
        else:
            super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/update":
            self.send_json(404, {"error": "未知接口"})
            return
        allowed = (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")
        if self.headers.get("Host") not in allowed or self.headers.get("Origin") not in tuple("http://" + host for host in allowed) or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin"):
            self.send_json(403, {"error": "仅允许本机同源操作"})
            return
        if self.headers.get("X-Update-Token") != token or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.send_json(403, {"error": "更新授权无效"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 1024:
                raise ValueError("请求大小非法")
            group = json.loads(self.rfile.read(size))["group"]
            if not isinstance(group, str):
                raise ValueError("未知更新任务")
            if group not in TASKS:
                raise ValueError("未知更新任务")
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
            return
        with state_lock:
            busy = state["status"] == "running"
            if not busy:
                state.update(status="running", group=group, step=0, total=len(TASKS[group]), current="准备中",
                             lines=[], error="", started_at=datetime.now().isoformat(timespec="seconds"), finished_at="", warnings=[NOTES[group]], dates_before=observed_dates(), dates_after={})
        if busy:
            self.send_json(409, {"error": "已有更新任务正在运行"})
            return
        threading.Thread(target=run_group, args=(group,), daemon=True).start()
        self.send_json(202, snapshot())

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".json"):
            return "application/json; charset=utf-8"
        return super().guess_type(path)


def main():
    parser = argparse.ArgumentParser(description="本机银行研究看板（仅手动触发更新）")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    # 随机令牌通过同源接口取得；与绑定 localhost 一起避免跨站触发本机脚本。
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"银行看板：http://127.0.0.1:{server.server_port}/index.html（打开不自动采集）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
