"""Serve the healthcare dashboard and its source evidence locally."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/dashboard/industry.html")
            self.end_headers()
            return
        super().do_GET()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8771)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(directory)))
    print(f"医疗健康研究台：http://127.0.0.1:{server.server_port}/dashboard/industry.html", flush=True)
    server.serve_forever()
