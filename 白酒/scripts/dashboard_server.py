"""Serve the static research dashboard without stale HTML or JSON caches."""
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from knowledge_store import ConflictError, read_store, save_entry, source_path


class ResearchHandler(SimpleHTTPRequestHandler):
    def json_response(self, status, data):
        content = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/knowledge":
            try:
                self.json_response(200, read_store())
            except (OSError, ValueError):
                self.json_response(503, {"error": "知识库文件暂不可用"})
            return
        if path.startswith("/api/knowledge/source/"):
            try:
                file = source_path(path.removeprefix("/api/knowledge/source/"))
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Length", str(file.stat().st_size))
                self.end_headers()
                with file.open("rb") as stream:
                    while chunk := stream.read(1024 * 128):
                        self.wfile.write(chunk)
            except FileNotFoundError:
                self.send_error(404, "Source not found")
            return
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/knowledge":
            self.json_response(404, {"error": "接口不存在"})
            return
        allowed_hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        if host not in allowed_hosts or origin is not None and origin != f"http://{host}":
            self.json_response(403, {"error": "只接受本地同源保存"})
            return
        if self.headers.get_content_type() != "application/json":
            self.json_response(415, {"error": "保存内容格式不正确"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024 * 1024:
                raise ValueError("保存内容为空或过大")
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError("保存内容必须是对象")
            store = save_entry(request.get("entry"), request.get("expected_revision"))
            self.json_response(200, store)
        except ConflictError as error:
            self.json_response(409, {"error": str(error)})
        except (ValueError, TypeError) as error:
            self.json_response(400, {"error": str(error)})
        except OSError:
            self.json_response(500, {"error": "写入知识库失败，原文件未替换，请检查本地目录权限"})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[1] / "dashboard"
    handler = partial(ResearchHandler, directory=str(directory))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"白酒研究台：http://127.0.0.1:{server.server_port}/industry.html", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
