"""Local development server for PV Predesign: serves the project root with caching disabled,
so edited JavaScript modules are always reloaded. Usage: py -3 scripts/serve.py [port]"""
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    # Windows takes the types from the registry, which may lack them (WebAssembly needs application/wasm)
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json'}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter console
        pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8140
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
