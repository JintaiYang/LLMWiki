"""Serve the static research dashboard without stale HTML or JSON caches."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class ResearchHandler(SimpleHTTPRequestHandler):
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
        print(f"白酒研究台：http://127.0.0.1:{args.port}/industry.html", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
