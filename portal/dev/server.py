"""Local stand-in for Cloudflare, so the portal can be run and tested on this Mac.

    python3 portal/dev/server.py            # then open http://127.0.0.1:8872/portal/

It does the three things Cloudflare does for the live site:
  * serves dist/ the way Cloudflare serves static assets (extensionless URLs,
    the _headers file — including the portal's Content-Security-Policy)
  * runs portal/worker.js for anything under /api/portal/ (via run_worker.js,
    on macOS's built-in JavaScriptCore, because there is no Node here)
  * plays the part of the D1 database, backed by a local SQLite file

Nothing in here is deployed. The /__dev/ and /__bridge/ routes and the X-Test-*
headers exist only in this file.
"""
import argparse, hashlib, json, os, re, secrets, sqlite3, subprocess, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DIST = os.path.join(ROOT, "dist")
WORKER = os.path.join(ROOT, "portal", "worker.js")
RUNNER = os.path.join(HERE, "run_worker.js")

SETUP_CODE = "ridgewood-local-setup-code"          # local testing only
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
         ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
         ".json": "application/json"}

state = {"db": None, "db_path": "", "lock": threading.RLock(), "mail_mode": "off", "outbox": [], "port": 8872}


def open_db(fresh=False):
    with state["lock"]:
        if state["db"] is not None:
            state["db"].close()
        if fresh:
            for suffix in ("", "-wal", "-shm", "-journal"):
                if os.path.exists(state["db_path"] + suffix):
                    os.remove(state["db_path"] + suffix)
        state["db"] = sqlite3.connect(state["db_path"], check_same_thread=False, isolation_level=None)


def d1(sql, params):
    cur = state["db"].execute(sql, params)
    cols = [c[0] for c in cur.description] if cur.description else []
    rows = [dict(zip(cols, row)) for row in cur.fetchall()] if cols else []
    return {"rows": rows, "meta": {"last_row_id": cur.lastrowid, "changes": max(cur.rowcount, 0)}}


def header_rules():
    """dist/_headers, parsed the way Cloudflare reads it."""
    rules, current = [], None
    path = os.path.join(DIST, "_headers")
    if not os.path.isfile(path):
        return rules
    for line in open(path, encoding="utf-8"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[0] not in " \t":
            current = (re.compile("^" + re.escape(line.strip()).replace(r"\*", ".*") + "$"), [])
            rules.append(current)
        elif current and ":" in line:
            name, value = line.strip().split(":", 1)
            current[1].append((name.strip(), value.strip()))
    return rules


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def reply(self, status, body, headers=()):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def reply_json(self, data, status=200):
        self.reply(status, json.dumps(data), [("Content-Type", "application/json")])

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def do_HEAD(self):
        self.route()

    def do_GET(self):
        self.route()

    def do_POST(self):
        self.route()

    def route(self):
        path = urlsplit(self.path).path
        try:
            if path.startswith("/__bridge/"):
                return self.bridge(path[len("/__bridge/"):])
            if path.startswith("/__dev/"):
                return self.dev(path[len("/__dev/"):])
            if path == "/api/portal" or path.startswith("/api/portal/"):
                return self.worker()
            # Like wrangler.jsonc's run_worker_first: on the real site every request
            # but the photos goes through the Worker (which redirects http and www.).
            # Local addresses skip it here, so browsing the dev server stays fast.
            host = (self.headers.get("Host") or "").split(":")[0]
            if host not in ("127.0.0.1", "localhost", "") and not path.startswith("/assets/"):
                return self.worker()
            return self.static(path)
        except Exception as e:                                   # keep the server up, show the cause
            return self.reply_json({"error": "%s: %s" % (type(e).__name__, e)}, 500)

    # --- what run_worker.js calls back for -------------------------------
    def bridge(self, kind):
        p = json.loads(self.body() or b"{}")
        with state["lock"]:
            if kind == "d1":
                return self.reply_json(d1(p["sql"], p.get("params") or []))
            if kind == "d1batch":
                db, out = state["db"], []
                db.execute("BEGIN")
                try:
                    for s in p["stmts"]:
                        out.append(d1(s["sql"], s.get("params") or []))
                    db.execute("COMMIT")
                except Exception:
                    db.execute("ROLLBACK")
                    raise
                return self.reply_json({"results": out})
        if kind == "sha256":
            return self.reply_json({"hex": hashlib.sha256(bytes.fromhex(p["hex"])).hexdigest()})
        if kind == "pbkdf2":
            return self.reply_json({"hex": hashlib.pbkdf2_hmac(
                "sha256", bytes.fromhex(p["password"]), bytes.fromhex(p["salt"]), p["iterations"], p["bits"] // 8).hex()})
        if kind == "random":
            return self.reply_json({"hex": secrets.token_hex(p["n"])})
        if kind == "fetch":
            state["outbox"].append(p)
            mode = state["mail_mode"]
            if mode == "throw":
                return self.reply_json({"throw": True})
            return self.reply_json({"status": 200 if mode == "ok" else 422, "body": "{}"})
        return self.reply_json({"error": "unknown bridge call " + kind}, 404)

    # --- switches for the tests -------------------------------------------
    def dev(self, what):
        p = json.loads(self.body() or b"{}")
        if what == "reset":
            open_db(fresh=True)
            state["outbox"], state["mail_mode"] = [], "off"
            return self.reply_json({"ok": True})
        if what == "mail-mode":
            state["mail_mode"] = p.get("mode", "off")
            return self.reply_json({"ok": True})
        if what == "outbox":
            return self.reply_json({"outbox": state["outbox"]})
        if what == "sql":                                         # lets a test look straight at the tables
            with state["lock"]:
                return self.reply_json(d1(p["sql"], p.get("params") or []))
        return self.reply_json({"error": "unknown"}, 404)

    # --- the Worker ---------------------------------------------------------
    def worker(self):
        h = self.headers
        headers = {"CF-Connecting-IP": h.get("X-Test-IP") or self.client_address[0]}
        for name in ("Cookie", "Origin", "Content-Type", "X-RW-Portal", "X-Setup-Code"):
            if h.get(name) is not None:
                headers[name] = h.get(name)
        env = {"SETUP_CODE_SHA256": hashlib.sha256(SETUP_CODE.encode()).hexdigest()}
        if h.get("X-Test-No-Setup-Code"):
            env = {}
        if state["mail_mode"] != "off":
            env["RESEND_API_KEY"] = "local-test-key"
        scheme = "https" if h.get("X-Test-Proto") == "https" else "http"
        req = {"method": self.command, "url": "%s://%s%s" % (scheme, h.get("Host") or "127.0.0.1", self.path),
               "headers": headers, "body": self.body().decode("utf-8", "replace"), "env": env,
               "clockOffsetMs": int(h.get("X-Test-Clock-Offset-Ms") or 0), "noDb": bool(h.get("X-Test-No-Db"))}
        with tempfile.TemporaryDirectory() as tmp:
            req_path, res_path = os.path.join(tmp, "req.json"), os.path.join(tmp, "res.json")
            json.dump(req, open(req_path, "w"))
            run = subprocess.run(["osascript", "-l", "JavaScript", RUNNER, req_path, res_path,
                                  "http://127.0.0.1:%d" % state["port"], WORKER],
                                 capture_output=True, text=True, timeout=120)
            if not os.path.isfile(res_path):
                return self.reply(599, "runner failed:\n" + run.stderr, [("Content-Type", "text/plain")])
            res = json.load(open(res_path))
        if run.stderr.strip():
            print("[worker]", run.stderr.strip(), flush=True)
        self.reply(res["status"], res["body"], [(k, v) for k, v in res["headers"]])

    # --- static files, served the way Cloudflare serves dist/ ----------------
    def static(self, path):
        if ".." in path:
            return self.reply(400, "bad path")
        fs = os.path.join(DIST, path.lstrip("/"))
        if path.endswith("/index.html"):
            return self.reply(307, "", [("Location", path[:-len("index.html")])])
        if path.endswith(".html"):
            return self.reply(307, "", [("Location", path[:-5])])
        if os.path.isdir(fs):
            if not path.endswith("/"):
                return self.reply(307, "", [("Location", path + "/")])
            fs = os.path.join(fs, "index.html")
        elif not os.path.isfile(fs) and os.path.isfile(fs + ".html"):
            fs += ".html"
        if not os.path.isfile(fs) or os.path.basename(fs) == "_headers":
            return self.reply(404, "Not found", [("Content-Type", "text/plain")])
        headers = [("Content-Type", TYPES.get(os.path.splitext(fs)[1], "application/octet-stream")),
                   ("Cache-Control", "no-store")]
        for pattern, pairs in header_rules():
            if pattern.match(path):
                headers += pairs
        self.reply(200, open(fs, "rb").read(), headers)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8872)
    ap.add_argument("--db", default=os.path.join(HERE, "dev.sqlite3"))
    ap.add_argument("--fresh", action="store_true", help="start from an empty database")
    a = ap.parse_args()
    state["port"], state["db_path"] = a.port, a.db
    open_db(fresh=a.fresh)
    print("portal dev server on http://127.0.0.1:%d/portal/  (setup code: %s)" % (a.port, SETUP_CODE), flush=True)
    ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
