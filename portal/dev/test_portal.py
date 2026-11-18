"""End-to-end tests for the portal API.

    python3 portal/dev/test_portal.py

Starts its own copy of the dev server on a spare port with an empty throwaway
database, then drives the Worker over HTTP the way the two portal pages do.
"""
import itertools, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8879
BASE = "http://127.0.0.1:%d" % PORT
CODE = "ridgewood-local-setup-code"
MIN, HOUR = 60 * 1000, 3600 * 1000

passed, failed = 0, []
ip_counter = itertools.count(1)


def check(cond, label, detail=""):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(label + ("  ->  " + str(detail)[:300] if detail != "" else ""))
        print("  FAIL", label, str(detail)[:300])


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Hand back a redirect as it is. Following one would leave the test server
    (the redirects under test point at the real site)."""
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def raw(method, path, body=None, headers=None):
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    try:
        res = _opener.open(req, timeout=180)
    except urllib.error.HTTPError as e:
        res = e
    return res.status, res.headers, res.read()


def dev(what, body=None):
    return json.loads(raw("POST", "/__dev/" + what, body or {})[2])


def sql(q, *params):
    return dev("sql", {"sql": q, "params": list(params)})["rows"]


class Client:
    """A browser: keeps cookies, sends the header the pages send."""

    def __init__(self):
        self.cookies, self.ip, self.offset = {}, "10.0.0.%d" % next(ip_counter), 0
        self.last_headers = None

    def call(self, method, path, body=None, headers=None, portal_header=True):
        h = {"X-Test-IP": self.ip}
        if self.offset:
            h["X-Test-Clock-Offset-Ms"] = str(self.offset)
        if self.cookies:
            h["Cookie"] = "; ".join("%s=%s" % kv for kv in self.cookies.items())
        if method == "POST":
            h["Content-Type"] = "application/json"
            if portal_header:
                h["X-RW-Portal"] = "1"
            if body is None:
                body = {}
        h.update(headers or {})
        status, rh, text = raw(method, "/api/portal" + path, body, h)
        self.last_headers = rh
        for sc in rh.get_all("Set-Cookie") or []:
            name, value = sc.split(";")[0].split("=", 1)
            if "Max-Age=0" in sc or not value:
                self.cookies.pop(name, None)
            else:
                self.cookies[name] = value
        try:
            return status, json.loads(text)
        except ValueError:
            return status, text.decode("utf-8", "replace")

    def get(self, path, **kw):
        return self.call("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.call("POST", path, body, **kw)


def tenant_login(c, email, phone, unit, password=None):
    return c.post("/login", {"email": email, "phone": phone, "unit": unit, "password": unit if password is None else password})


def new_request(c, **over):
    body = {"category": "Plumbing", "location": "Kitchen", "description": "The kitchen tap drips constantly.",
            "urgency": "routine", "permission_to_enter": True, "entry_notes": ""}
    body.update(over)
    return c.post("/requests", body)


def main():
    tmp = tempfile.mkdtemp()
    server = subprocess.Popen([sys.executable, os.path.join(HERE, "server.py"), "--port", str(PORT),
                               "--db", os.path.join(tmp, "test.sqlite3"), "--fresh"],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        # wait for the server with a plain file, not the Worker: the first Worker
        # request builds the database, and the upgrade test needs to get there first
        for _ in range(50):
            try:
                raw("GET", "/robots.txt")
                break
            except Exception:
                time.sleep(0.1)
        run()
    finally:
        server.terminate()
        out = server.communicate(timeout=10)[0]
        noise = [l for l in out.splitlines() if l.startswith("[worker]")]
        if noise:
            print("\nworker console output:")
            print("\n".join(noise[:40]))
    print("\n%d passed, %d failed" % (passed, len(failed)))
    for f in failed:
        print("  FAILED:", f)
    sys.exit(1 if failed else 0)


def run():
    t0 = time.time()

    # ------------------------------------------- upgrading a database in use
    # The live database was created before residents could choose a password.
    # Recreate that shape, with someone in it, and let the Worker upgrade it.
    print("upgrade")
    made = dev("sql", {"sql": """CREATE TABLE tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unit TEXT NOT NULL, unit_key TEXT NOT NULL, building TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, phone_key TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"""})
    filled = dev("sql", {"sql": "INSERT INTO tenants (unit, unit_key, building, name, email, phone, phone_key, active, created_at, updated_at) "
                       "VALUES ('501','501','1871','Old Timer','old@example.com','651-555-0900','6515550900',1,'2026-11-16T00:00:00.000Z','2026-11-16T00:00:00.000Z')"})
    check("error" not in made and "error" not in filled and len(sql("PRAGMA table_info(tenants)")) == 11,
          "(the test starts from the original residents table, with a resident in it)", (made, filled))
    check(Client().get("/health")[0] == 200, "the Worker starts against the older database")
    row = sql("SELECT name, pw_hash, pending, source FROM tenants WHERE email = 'old@example.com'")[0]
    check(row == {"name": "Old Timer", "pw_hash": None, "pending": 0, "source": "staff"}, "existing residents are kept and given the new fields", row)
    check(sql("SELECT value FROM settings WHERE name = 'schema_version'")[0]["value"] == "4", "the upgrades are recorded")
    row = sql("SELECT alt_phone, emergency_name, emergency_phone, contact_updated_at, contact_updated_by FROM tenants WHERE email = 'old@example.com'")[0]
    check(row == {"alt_phone": "", "emergency_name": "", "emergency_phone": "", "contact_updated_at": None, "contact_updated_by": ""},
          "existing residents get the new contact fields, empty", row)
    check(Client().get("/health")[0] == 200 and len(sql("SELECT id FROM tenants")) == 1, "starting again does not repeat it")
    old = Client()
    check(tenant_login(old, "old@example.com", "651-555-0900", "501")[0] == 200, "a resident from before the upgrade still signs in with their apartment number")
    check(old.get("/me")[1]["resident"]["has_password"] is False, "…and is shown as not having chosen a password yet")
    dev("sql", {"sql": "DELETE FROM tenants"}); dev("sql", {"sql": "DELETE FROM sessions"})
    dev("sql", {"sql": "DELETE FROM activity_log"}); dev("sql", {"sql": "DELETE FROM login_attempts"})

    # ------------------------------------------------- one secure address only
    print("https")
    def visit(method, path, host, proto="http", body=None):
        h = {"Host": host}
        if proto == "https":
            h["X-Test-Proto"] = "https"
        if body is not None:
            h.update({"Content-Type": "application/json", "X-RW-Portal": "1"})
        return raw(method, path, body, h)
    s, hd, _ = visit("GET", "/api/portal/health?x=1", "ridgewoodapartments.org")
    check(s == 301 and hd.get("Location") == "https://ridgewoodapartments.org/api/portal/health?x=1",
          "a plain-http visit is sent to the same address over https", (s, hd.get("Location")))
    s, hd, _ = visit("GET", "/api/portal/me", "www.ridgewoodapartments.org", "https")
    check(s == 301 and hd.get("Location") == "https://ridgewoodapartments.org/api/portal/me", "the www. address is sent to the main one", hd.get("Location"))
    s, hd, _ = visit("GET", "/api/portal/me", "www.ridgewoodapartments.org")
    check(s == 301 and hd.get("Location") == "https://ridgewoodapartments.org/api/portal/me", "…in one step from plain http too", hd.get("Location"))
    s, hd, _ = visit("POST", "/api/portal/login", "ridgewoodapartments.org", body={})
    check(s == 308 and hd.get("Location") == "https://ridgewoodapartments.org/api/portal/login",
          "a sign-in sent over plain http is redirected, not processed", (s, hd.get("Location")))
    check(len(sql("SELECT id FROM login_attempts")) == 0, "…so nothing was checked or recorded")
    s, hd, body = visit("GET", "/api/portal/health", "ridgewoodapartments.org", "https")
    check(s == 200 and hd.get("Strict-Transport-Security") == "max-age=31536000", "over https it is served, telling browsers to stay on https", hd.get("Strict-Transport-Security"))
    s, hd, _ = visit("GET", "/portal/", "ridgewoodapartments.org")
    check(s == 301 and hd.get("Location") == "https://ridgewoodapartments.org/portal/", "pages are redirected too", (s, hd.get("Location")))
    s, hd, _ = visit("GET", "/api/portal/health", "ridgewood-apartments.akeacher.workers.dev", "https")
    check(s == 200, "Cloudflare's own preview address is left alone")

    # ------------------------------------------------------------ before setup
    print("before setup")
    a = Client()
    s, j = a.get("/health")
    check(s == 200 and j == {"ok": True, "db": True, "activated": False}, "health", j)
    check(a.last_headers.get("Cache-Control") == "no-store", "api responses are never cached")
    check(a.get("/nope")[0] == 404, "unknown route is 404")
    check(a.post("/nope")[0] == 404, "unknown POST route is 404")
    check(a.get("/login")[0] == 404, "GET on a POST route is 404")

    s, j = a.post("/login", {"email": "x@y.com"}, portal_header=False)
    check(s == 403, "POST without the portal header is refused", j)
    s, j = a.post("/login", {}, headers={"Origin": "https://evil.example"})
    check(s == 403, "POST from another site's origin is refused", j)
    s, j = a.post("/login", {}, headers={"Origin": BASE})
    check(s == 400, "POST from our own origin gets through to validation", j)

    check(a.get("/me")[0] == 401, "resident data needs a session")
    check(a.get("/staff/workorders")[0] == 401, "staff data needs a session")
    check(a.get("/staff/export.csv")[0] == 401, "export needs a session")
    s, j = a.get("/staff/state")
    check(j == {"activated": False, "setup_available": True, "signed_in": False, "me": None}, "staff state before setup", j)

    s, j = a.get("/health", headers={"X-Test-No-Db": "1"})
    check(s == 503 and j.get("code") == "no_db", "says so plainly when the database is not connected", j)
    s, j = a.post("/staff/setup", {"code": CODE, "name": "A B", "email": "a@b.com", "password": "long enough pw"},
                  headers={"X-Test-No-Setup-Code": "1"})
    check(s == 404, "setup does not exist without a setup code configured", j)

    # setup code guessing is rate limited per visitor
    g = Client()
    codes = [g.post("/staff/setup", {"code": "guess%d" % i, "name": "X Y", "email": "x@y.com", "password": "1234567890"})[0]
             for i in range(11)]
    check(codes == [401] * 10 + [429], "setup code guessing locks after ten tries", codes)
    s, j = g.post("/staff/setup", {"code": CODE, "name": "X Y", "email": "x@y.com", "password": "1234567890"})
    check(s == 429, "…even with the right code, from that visitor", j)

    # the real setup
    m = Client()
    ok = {"code": CODE, "name": "Andrew Manager", "email": "Manager@Ridgewood.test", "password": "correct horse 42"}
    check(m.post("/staff/setup", dict(ok, code="wrong"))[0] == 401, "setup rejects a wrong code")
    check(m.post("/staff/setup", dict(ok, password="short"))[0] == 400, "setup rejects a short password")
    check(m.post("/staff/setup", dict(ok, email="nope"))[0] == 400, "setup rejects a bad email")
    check(m.post("/staff/setup", dict(ok, name=""))[0] == 400, "setup needs a name")
    s, j = m.post("/staff/setup", ok)
    check(s == 200 and "rw_staff" in m.cookies, "setup creates the first manager and signs them in", j)
    check("HttpOnly" in (m.last_headers.get("Set-Cookie") or "") and "SameSite=Lax" in m.last_headers.get("Set-Cookie"),
          "session cookie is HttpOnly and SameSite", m.last_headers.get("Set-Cookie"))
    s, j = m.get("/staff/state")
    check(j["activated"] and j["signed_in"] and j["me"]["role"] == "manager" and j["me"]["email"] == "manager@ridgewood.test",
          "state after setup", j)
    check(m.post("/staff/setup", dict(ok, email="second@x.com"))[0] == 409, "setup cannot be run twice")
    check(Client().post("/staff/setup", dict(ok, code="wrong", email="third@x.com"))[0] == 409, "…whatever code is offered")
    row = sql("SELECT pw_hash FROM staff")[0]["pw_hash"]
    check(re.match(r"^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$", row) is not None, "staff password is stored as a salted hash", row)
    check("correct horse" not in json.dumps(sql("SELECT * FROM staff") + sql("SELECT * FROM activity_log")),
          "the password itself is stored nowhere")
    tok = sql("SELECT token_hash FROM sessions")[0]["token_hash"]
    check(tok != m.cookies["rw_staff"] and len(tok) == 64, "only a hash of the session token is stored")

    # ---------------------------------------------------------------- residents
    print("residents")
    maria = {"unit": "204", "building": "1871", "name": "Maria Lopez", "email": "Maria@Example.com", "phone": "(651) 555-0101"}
    for bad, why in ((dict(maria, email="not-an-email"), "email"), (dict(maria, phone="555-0101"), "phone"),
                     (dict(maria, name=""), "name"), (dict(maria, unit=""), "unit"), (dict(maria, building="1999"), "building")):
        check(m.post("/staff/residents", bad)[0] == 400, "resident needs a valid " + why)
    check(m.post("/staff/residents", maria)[0] == 200, "add a resident")
    check(m.post("/staff/residents", maria)[0] == 409, "the same resident twice is refused")
    bulk = "\n".join([
        "310, James Okafor, james@example.com, 651-555-0102, 1871",
        "112\tPriya Shah\tpriya@example.com\t651.555.0103\t1885",
        "204, Dee Carter, dee@example.com, 6515550104, 1885",
        "",
        "204, Maria Lopez, maria@example.com, 651-555-0101, 1871",      # already there
        "999, No Email, , 651-555-0199",                                 # invalid
        "305, Lock Test, lock@example.com, 651-555-0105, 1871",
        "306, Day Cap, daycap@example.com, 651-555-0106, 1871",
        "307, Ip Cap, ipcap@example.com, 651-555-0107, 1871",
        "308, Busy Bee, busy@example.com, 651-555-0108, 1871",
        "310, James Okafor, james@example.com, 651-555-0102, 1871",     # repeated inside the paste
    ])
    s, j = m.post("/staff/residents/bulk", {"text": bulk})
    check(s == 200 and j["added"] == 7 and [p["line"] for p in j["problems"]] == [4, 5, 10], "bulk add reports each bad line", j)
    check(m.post("/staff/residents/bulk", {"text": ""})[0] == 400, "empty bulk paste is refused")
    s, j = m.get("/staff/residents")
    check(len(j["residents"]) == 8, "roster lists everyone", len(j["residents"]))
    ids = {r["email"]: r["id"] for r in j["residents"]}

    # ------------------------------------------------------------ resident login
    print("resident sign-in")
    t = Client()
    check(tenant_login(t, "maria@example.com", "", "204")[0] == 400, "sign-in needs all four fields")
    s, j = tenant_login(t, "maria@example.com", "651-555-0101", "204", "205")
    check(s == 401, "wrong password is refused", j)
    generic = j.get("error")
    s, j = tenant_login(t, "maria@example.com", "651-555-9999", "204")
    check(s == 401 and j.get("error") == generic, "wrong phone number is refused with the same message", j)
    s, j = tenant_login(t, "nobody@example.com", "651-555-0101", "204")
    check(s == 401 and j.get("error") == generic, "unknown email is refused with the same message", j)
    s, j = tenant_login(t, "maria@example.com", "651-555-0101", "310", "310")
    check(s == 401, "someone else's apartment number is refused", j)
    check(t.get("/me")[0] == 401, "no session after failed attempts")
    s, j = tenant_login(t, "  MARIA@example.COM ", "+1 651.555.0101", "Apt #204", " 204 ")
    check(s == 200 and "rw_tenant" in t.cookies, "sign-in tolerates formatting differences", j)
    s, me = t.get("/me")
    check(s == 200 and me["resident"] == {"name": "Maria Lopez", "unit": "204", "building": "1871",
                                          "email": "maria@example.com", "phone": "651-555-0101", "alt_phone": "", "emergency_name": "", "emergency_phone": "", "contact_updated_at": None, "has_password": False},
          "resident sees their own details", me)
    check(me["requests"] == [] and "Plumbing" in me["categories"], "new resident has no requests")
    check(t.get("/staff/workorders")[0] == 401, "a resident session does not open the staff side")

    # lockout: ten misses, then even the right details wait fifteen minutes
    lk = Client()
    codes = [tenant_login(lk, "lock@example.com", "651-555-0105", "305", "000")[0] for _ in range(10)]
    s, j = tenant_login(lk, "lock@example.com", "651-555-0105", "305")
    check(codes == [401] * 10 and s == 429 and j.get("code") == "locked", "ten wrong tries lock the address", (codes, s, j))
    other = Client()
    check(tenant_login(other, "lock@example.com", "651-555-0105", "305")[0] == 429, "the lock follows the email, not the device")
    check(tenant_login(other, "james@example.com", "651-555-0102", "310")[0] == 200, "other residents are unaffected")
    lk.offset = 16 * MIN
    check(tenant_login(lk, "lock@example.com", "651-555-0105", "305")[0] == 200, "the lock lifts after fifteen minutes")

    # daily cap: thirty misses in a day and the office has to unlock it
    dc = Client()
    codes = []
    for window in range(3):
        dc.offset = window * 16 * MIN
        codes += [tenant_login(dc, "daycap@example.com", "651-555-0106", "306", "111")[0] for _ in range(10)]
    dc.offset = 3 * 16 * MIN
    s, j = tenant_login(dc, "daycap@example.com", "651-555-0106", "306")
    check(codes == [401] * 30 and s == 429 and "leasing office" in j.get("error", ""), "thirty misses in a day lock it until the office steps in", (codes, s, j))
    check(m.post("/staff/residents/%d/unlock" % ids["daycap@example.com"])[0] == 200, "staff can unlock a resident")
    check(tenant_login(dc, "daycap@example.com", "651-555-0106", "306")[0] == 200, "unlocked resident can sign in")

    # one device hammering many addresses
    ipc = Client()
    for n in range(5):
        for _ in range(8):
            tenant_login(ipc, "ghost%d@example.com" % n, "651-555-0000", "1")
    check(tenant_login(ipc, "ipcap@example.com", "651-555-0107", "307")[0] == 429, "a device guessing across many addresses is cut off")
    ipc2 = Client()
    check(tenant_login(ipc2, "ipcap@example.com", "651-555-0107", "307")[0] == 200, "…without locking out the real resident elsewhere")

    # --------------------------------------------------------- resident sign-up
    print("resident sign-up")
    check(Client().get("/signup")[1] == {"mode": "approval"}, "sign-up is offered, with approval, unless the office says otherwise")
    su = Client()
    new = {"name": "Nora Quinn", "email": "Nora@Example.com", "phone": "651 555 0110", "unit": "118", "building": "1885",
           "password": "nora-chosen-pass"}
    for bad, why in ((dict(new, password="short"), "a real password"), (dict(new, email="x"), "a valid email"),
                     (dict(new, phone="123"), "a phone number"), (dict(new, name=""), "a name"),
                     (dict(new, unit=""), "an apartment number"), (dict(new, building=""), "a building")):
        check(su.post("/signup", bad)[0] == 400, "sign-up needs " + why)
    check(su.post("/signup", dict(new, email="maria@example.com"))[0] == 409, "sign-up refuses an email that already has an account")
    s, j = su.post("/signup", new)
    check(s == 200 and j == {"ok": True, "pending": True} and "rw_tenant" not in su.cookies, "sign-up creates an account that waits for approval", j)
    check(su.post("/signup", new)[0] == 409, "the same sign-up twice is refused")
    row = sql("SELECT * FROM tenants WHERE email = 'nora@example.com'")[0]
    check(row["pending"] == 1 and row["source"] == "self" and row["pw_hash"].startswith("pbkdf2") and row["phone"] == "651-555-0110"
          and "nora-chosen" not in json.dumps(row), "the chosen password is stored only as a salted hash", row)
    s, j = tenant_login(su, "nora@example.com", "651-555-0110", "118", "nora-chosen-pass")
    check(s == 403 and j.get("code") == "pending" and "rw_tenant" not in su.cookies, "a waiting account cannot sign in yet", j)
    check(tenant_login(su, "nora@example.com", "651-555-0110", "118", "wrong-password")[0] == 401, "…and a wrong password is told nothing about it")
    check(tenant_login(su, "nora@example.com", "651-555-0110", "118", "118")[0] == 401, "the apartment number is not the password for a self-made account")
    kinds = [x["kind"] for x in sql("SELECT kind FROM email_log ORDER BY id DESC LIMIT 2")]
    check(sorted(kinds) == ["office_new_signup", "resident_signup"], "the office and the resident are both told (and it is logged)", kinds)
    check(m.get("/staff/me")[1]["pending_residents"] == 1 and m.get("/staff/workorders")[1]["pending_residents"] == 1, "staff are shown that someone is waiting")
    first = m.get("/staff/residents")[1]["residents"][0]
    check(first["email"] == "nora@example.com" and first["pending"] is True and first["source"] == "self" and first["has_password"] is True,
          "waiting accounts head the roster", first)
    maria_row = [r for r in m.get("/staff/residents")[1]["residents"] if r["email"] == "maria@example.com"][0]
    check(maria_row["pending"] is False and maria_row["source"] == "staff" and maria_row["has_password"] is False, "office-added residents are marked as such", maria_row)
    check(m.post("/staff/residents/%d/approve" % ids["maria@example.com"])[0] == 404, "only a waiting account can be approved")
    check(m.post("/staff/residents/%d/approve" % first["id"])[0] == 200, "a manager approves the account")
    check(m.post("/staff/residents/%d/approve" % first["id"])[0] == 404, "…once")
    check(sql("SELECT kind, to_addr FROM email_log ORDER BY id DESC LIMIT 1")[0] == {"kind": "resident_welcome", "to_addr": "nora@example.com"},
          "the resident is told their account is ready")
    check(tenant_login(su, "nora@example.com", "651 555 0110", "apt 118", "nora-chosen-pass")[0] == 200, "an approved resident signs in with the password they chose")
    check(su.get("/me")[1]["resident"] == {"name": "Nora Quinn", "unit": "118", "building": "1885", "email": "nora@example.com",
                                           "phone": "651-555-0110", "alt_phone": "", "emergency_name": "", "emergency_phone": "", "contact_updated_at": None, "has_password": True}, "…and sees their own account")
    check(new_request(su, description="Bedroom window will not latch.", category="Doors, locks & windows")[0] == 200, "…and can send a request")
    check(m.get("/staff/me")[1]["pending_residents"] == 0, "nobody is left waiting")

    stranger = Client()
    stranger.post("/signup", dict(new, email="stranger@example.com", name="Not A Resident", unit="999"))
    sid = sql("SELECT id FROM tenants WHERE email = 'stranger@example.com'")[0]["id"]
    check(m.post("/staff/residents/%d/decline" % ids["maria@example.com"])[0] == 404, "only a waiting account can be declined")
    check(m.post("/staff/residents/%d/decline" % sid)[0] == 200, "a manager declines a sign-up")
    check(sql("SELECT COUNT(*) AS n FROM tenants WHERE email = 'stranger@example.com'")[0]["n"] == 0, "…which removes it")
    check(tenant_login(stranger, "stranger@example.com", "651-555-0110", "999", "nora-chosen-pass")[0] == 401, "…so it can never sign in")

    # residents changing their password
    check(su.post("/password", {"current": "wrong-one", "next": "nora-second-pass"})[0] == 401, "changing a password needs the current one")
    check(su.post("/password", {"current": "nora-chosen-pass", "next": "short"})[0] == 400, "a new password must be long enough")
    check(su.post("/password", {"current": "nora-chosen-pass", "next": "nora-chosen-pass"})[0] == 400, "a new password must differ")
    su2 = Client()
    tenant_login(su2, "nora@example.com", "651-555-0110", "118", "nora-chosen-pass")
    check(su.post("/password", {"current": "nora-chosen-pass", "next": "nora-second-pass"})[0] == 200, "a resident changes their password")
    check(su.get("/me")[0] == 200 and su2.get("/me")[0] == 401, "…which signs out their other devices only")
    check(tenant_login(Client(), "nora@example.com", "651-555-0110", "118", "nora-chosen-pass")[0] == 401, "…and retires the old password")
    check(tenant_login(Client(), "nora@example.com", "651-555-0110", "118", "nora-second-pass")[0] == 200, "…in favour of the new one")
    check(Client().post("/password", {"current": "x", "next": "whatever-long"})[0] == 401, "changing a password needs a session")

    # a resident the office added swaps the apartment-number password for their own
    check(ipc2.post("/password", {"current": "307", "next": "my-own-pass-307"})[0] == 200, "an office-added resident chooses their own password")
    check(tenant_login(Client(), "ipcap@example.com", "651-555-0107", "307")[0] == 401, "…after which the apartment number no longer works")
    check(tenant_login(Client(), "ipcap@example.com", "651-555-0107", "307", "my-own-pass-307")[0] == 200, "…and their own password does")
    check(m.post("/staff/residents/%d/reset-password" % ids["ipcap@example.com"])[0] == 200, "a manager resets a forgotten password")
    check(ipc2.get("/me")[0] == 401, "…which signs the resident out")
    check(tenant_login(Client(), "ipcap@example.com", "651-555-0107", "307", "my-own-pass-307")[0] == 401, "…retires the forgotten password")
    check(tenant_login(Client(), "ipcap@example.com", "651-555-0107", "307")[0] == 200, "…and puts the apartment number back until they choose again")
    check(m.post("/staff/residents/99999/reset-password")[0] == 404, "missing resident is 404")

    # the office decides how accounts are created
    check(m.post("/staff/settings", {"signup_mode": "anything"})[0] == 400, "the sign-up setting is validated")
    check(m.post("/staff/settings", {"signup_mode": "open"})[0] == 200 and m.get("/staff/settings")[1]["signup_mode"] == "open", "approval can be switched off")
    op = Client()
    s, j = op.post("/signup", dict(new, email="open@example.com", name="Olu Open", unit="119"))
    check(s == 200 and j["pending"] is False and op.get("/me")[0] == 200, "…and then a new account works at once", j)
    check(m.post("/staff/settings", {"signup_mode": "off"})[0] == 200 and Client().get("/signup")[1] == {"mode": "off"}, "sign-up can be switched off")
    s, j = Client().post("/signup", dict(new, email="late@example.com"))
    check(s == 403 and "leasing office" in j.get("error", ""), "…and then only the office creates accounts", j)
    check(m.post("/staff/settings", {"signup_mode": "approval"})[0] == 200, "back to approval")

    # one connection cannot mass-produce accounts
    rl = Client()
    codes = [rl.post("/signup", dict(new, email="rl%d@example.com" % i, unit="12%d" % i))[0] for i in range(6)]
    check(codes == [200] * 5 + [429], "five sign-ups an hour from one connection", codes)
    rl.offset = 61 * MIN
    check(rl.post("/signup", dict(new, email="rl9@example.com", unit="129"))[0] == 200, "…and more after the hour")
    waiting = [r for r in m.get("/staff/residents")[1]["residents"] if r["pending"]]
    check(len(waiting) == 6 and all(m.post("/staff/residents/%d/decline" % r["id"])[0] == 200 for r in waiting), "the manager clears them out", len(waiting))
    check(m.get("/staff/me")[1]["pending_residents"] == 0, "…leaving nobody waiting")

    # ------------------------------------------------------- resident requests
    print("resident requests")
    check(new_request(t, category="Nonsense")[0] == 400, "request needs a real category")
    check(new_request(t, description="hi")[0] == 400, "request needs a description")
    check(new_request(t, urgency="yesterday")[0] == 400, "request needs a real urgency")
    s, j = new_request(t, urgency="urgent", entry_notes="Dog-free, ring first")
    check(s == 200 and re.match(r"^RW-\d{4,}$", j.get("ref", "")), "resident files a request", j)
    r1 = j["id"]
    s, me = t.get("/me")
    q = me["requests"][0]
    check(q["status"] == "new" and q["status_label"] == "Received" and q["open"] and q["urgency"] == "urgent"
          and q["permission_to_enter"] is True and q["entry_notes"] == "Dog-free, ring first", "request shows up with its details", q)
    row = sql("SELECT * FROM work_orders WHERE id = ?", r1)[0]
    check((row["contact_email"], row["contact_phone"], row["unit"], row["building"], row["source"]) ==
          ("maria@example.com", "651-555-0101", "204", "1871", "tenant"), "the work order records email, phone and apartment", row)
    mail = sql("SELECT kind, to_addr, status, detail FROM email_log WHERE work_order_id = ? ORDER BY id", r1)
    check([x["kind"] for x in mail] == ["office_new_request", "resident_received"] and all(x["status"] == "not_sent" for x in mail),
          "both notifications are logged even though delivery is off", mail)
    check(mail[1]["to_addr"] == "maria@example.com", "the resident's copy is addressed to them", mail)

    check(t.post("/requests/%d/note" % r1, {"body": "x"})[0] == 400, "a note needs some text")
    check(t.post("/requests/%d/note" % r1, {"body": "It is getting worse."})[0] == 200, "resident adds a note")
    j2 = Client()
    tenant_login(j2, "james@example.com", "651-555-0102", "310")
    check(j2.get("/me")[1]["requests"] == [], "another resident does not see it")
    check(j2.post("/requests/%d/note" % r1, {"body": "hello there"})[0] == 404, "another resident cannot add to it")
    check(j2.post("/requests/%d/cancel" % r1)[0] == 404, "another resident cannot cancel it")
    s, j = new_request(j2, category="Electrical", location="Hall", description="Hall light flickers.")
    r2 = j["id"]
    s, j = new_request(j2, description="Please ignore, opened by mistake.")
    r2b = j["id"]
    check(j2.post("/requests/%d/cancel" % r2b)[0] == 200, "resident cancels their own request")
    check(j2.post("/requests/%d/cancel" % r2b)[0] == 409, "…but not twice")
    check(j2.post("/requests/%d/note" % r2b, {"body": "one more thing"})[0] == 409, "no notes on a closed request")

    busy = Client()
    tenant_login(busy, "busy@example.com", "651-555-0108", "308")
    codes = [new_request(busy, description="Request number %d today." % i)[0] for i in range(11)]
    check(codes == [200] * 10 + [429], "a resident is capped at ten requests a day", codes)

    nasty = "Robert'); DROP TABLE work_orders;-- <script>alert(1)</script> é中"
    s, j = new_request(j2, description=nasty, location="<b>x</b>")
    r_nasty = j["id"]
    back = [x for x in j2.get("/me")[1]["requests"] if x["id"] == r_nasty][0]
    check(back["description"] == nasty and back["location"] == "<b>x</b>", "awkward text is stored and returned untouched", back)

    # ------------------------------------------------------------- staff side
    print("staff work orders")
    s, j = m.get("/staff/me")
    check(s == 200 and j["me"]["name"] == "Andrew Manager" and [x["name"] for x in j["team"]] == ["Andrew Manager"], "staff profile", j)
    my_id = j["me"]["id"]
    s, j = m.get("/staff/workorders?view=open")
    check(j["orders"][0]["id"] == r1 and j["orders"][0]["urgency"] == "urgent", "open list puts urgent work first", [o["id"] for o in j["orders"]])
    check(j["counts"].get("new") == len(j["orders"]) and j["counts"].get("cancelled") == 1, "counts by status", j["counts"])
    check(all(o["status"] != "cancelled" for o in j["orders"]), "cancelled requests are not in the open list")
    check([o["id"] for o in m.get("/staff/workorders?view=open&q=204")[1]["orders"]] == [r1], "search by apartment")
    check([o["id"] for o in m.get("/staff/workorders?view=open&q=flickers")[1]["orders"]] == [r2], "search by words in the problem")
    check([o["id"] for o in m.get("/staff/workorders?view=open&q=okafor")[1]["orders"]].count(r2) == 1, "search by resident name")
    check(m.get("/staff/workorders?view=open&q=%25")[0] == 200, "a stray % in the search is harmless")
    check(len(m.get("/staff/workorders?view=all")[1]["orders"]) == len(sql("SELECT id FROM work_orders")), "the full list has everything")

    s, d = m.get("/staff/workorders/%d" % r1)
    o = d["order"]
    check(s == 200 and o["contact_name"] == "Maria Lopez" and o["contact_phone"] == "651-555-0101"
          and o["contact_email"] == "maria@example.com" and o["permission_to_enter"] is True, "detail shows who to contact", o)
    check([n["body"] for n in d["notes"]] == ["It is getting worse."] and d["unit"]["handoff"] == [], "detail shows the resident's note", d["notes"])
    check(m.get("/staff/workorders/99999")[0] == 404, "missing work order is 404")

    check(m.post("/staff/workorders/%d" % r1, {"status": "bogus"})[0] == 400, "unknown status refused")
    check(m.post("/staff/workorders/%d" % r1, {"status": "completed"})[0] == 400, "completing must go through the write-up")
    check(m.post("/staff/workorders/%d" % r1, {"urgency": "bogus"})[0] == 400, "unknown urgency refused")
    check(m.post("/staff/workorders/%d" % r1, {"assigned_to": 9999})[0] == 400, "cannot assign to a stranger")
    check(m.post("/staff/workorders/%d" % r1, {"status": "scheduled", "assigned_to": str(my_id)})[0] == 200, "schedule and assign")
    check(m.post("/staff/workorders/%d" % r1, {"assigned_to": my_id})[0] == 200, "re-sending the same assignee is a no-op")
    s, d = m.get("/staff/workorders/%d" % r1)
    check(d["order"]["status"] == "scheduled" and d["order"]["assigned_name"] == "Andrew Manager", "status and assignee saved", d["order"])
    check([n["body"] for n in d["notes"] if n["kind"] == "status"] == ["Status changed to Scheduled.", "Assigned to Andrew Manager."],
          "each change is on the timeline once", [n["body"] for n in d["notes"]])
    check([o["id"] for o in m.get("/staff/workorders?view=mine")[1]["orders"]] == [r1], "my work shows what is assigned to me")

    check(m.post("/staff/workorders/%d/notes" % r1, {"body": ""})[0] == 400, "empty staff note refused")
    check(m.post("/staff/workorders/%d/notes" % r1, {"body": "INTERNAL: tenant is a night-shift worker, knock loud."})[0] == 200, "internal note")
    check(m.post("/staff/workorders/%d/notes" % r1, {"body": "We will be there Tuesday morning.", "visible_to_tenant": True})[0] == 200, "message to the resident")
    check(m.post("/staff/workorders/%d/notes" % r1, {"body": "HANDOFF: shut-off valve is behind the access panel in the hall closet.", "kind": "handoff"})[0] == 200,
          "note for the next technician")
    s, me = t.get("/me")
    q = [x for x in me["requests"] if x["id"] == r1][0]
    seen = json.dumps(me)
    check(q["status_label"] == "Scheduled", "resident sees the new status", q["status_label"])
    check([u["body"] for u in q["updates"]] == ["It is getting worse.", "Status changed to Scheduled.", "We will be there Tuesday morning."],
          "resident sees their note, the status change and the message", q["updates"])
    check("INTERNAL" not in seen and "HANDOFF" not in seen, "resident never sees internal or handoff notes")
    check("Andrew" not in seen and "Assigned" not in seen, "resident does not see staff names or assignments")
    check([u["from"] for u in q["updates"]] == ["You", "Ridgewood maintenance", "Ridgewood maintenance"], "updates say who they are from", q["updates"])
    check(sql("SELECT COUNT(*) AS n FROM email_log WHERE kind = 'resident_update' AND work_order_id = ?", r1)[0]["n"] == 1,
          "a message to the resident is logged as an email")

    check(m.post("/staff/workorders/%d/complete" % r1, {"work_done": ""})[0] == 400, "completing needs a write-up")
    done = {"work_done": "Replaced the cartridge in the kitchen tap. Tested for leaks.",
            "handoff_note": "HANDOFF: tap is a Moen 1225 cartridge; spare is in the shop, shelf B.",
            "resident_message": "All fixed. Let us know if the drip returns."}
    check(m.post("/staff/workorders/%d/complete" % r1, done)[0] == 200, "complete a work order")
    check(m.post("/staff/workorders/%d/complete" % r1, done)[0] == 409, "…once")
    s, j = m.get("/staff/workorders?view=completed")
    c1 = j["orders"][0]
    check(c1["id"] == r1 and c1["completed_by_name"] == "Andrew Manager" and c1["work_done"] == done["work_done"] and c1["completed_at"],
          "completed records show who did what and when", c1)
    check(all(o["id"] != r1 for o in m.get("/staff/workorders?view=open")[1]["orders"]), "completed work leaves the open list")
    check([o["id"] for o in m.get("/staff/workorders?view=completed&q=cartridge")[1]["orders"]] == [r1], "completed records search the write-up")
    s, me = t.get("/me")
    q = [x for x in me["requests"] if x["id"] == r1][0]
    check(q["status"] == "completed" and not q["open"] and q["resident_message"] == done["resident_message"], "resident sees it completed", q)
    check("Moen" not in json.dumps(me) and "cartridge" not in json.dumps(me), "resident sees the message, not the technician's write-up")
    check(sql("SELECT COUNT(*) AS n FROM email_log WHERE kind = 'resident_completed' AND work_order_id = ?", r1)[0]["n"] == 1,
          "completion is logged as an email")

    # the point of it all: the next person at that apartment sees the notes
    s, j = new_request(t, category="Plumbing", location="Bathroom", description="Bathroom sink drains slowly.")
    r3 = j["id"]
    s, d = m.get("/staff/workorders/%d" % r3)
    hand = d["unit"]["handoff"]
    check(len(hand) == 2 and "Moen 1225" in hand[0]["body"] and "shut-off valve" in hand[1]["body"]
          and hand[0]["author_name"] == "Andrew Manager" and hand[0]["ref"].startswith("RW-"),
          "a new job at the same apartment shows the notes left for the next technician", hand)
    prev = d["unit"]["previous"]
    check(len(prev) == 1 and prev[0]["id"] == r1 and prev[0]["work_done"] == done["work_done"], "…and the earlier work done there", prev)
    check(m.get("/staff/workorders/%d" % r2)[1]["unit"]["handoff"] == [], "other apartments do not get those notes")
    dee = Client()
    tenant_login(dee, "dee@example.com", "651-555-0104", "204")
    s, j = new_request(dee, description="Closet door is off its track.", category="Doors, locks & windows")
    check(m.get("/staff/workorders/%d" % j["id"])[1]["unit"]["handoff"] == [], "apartment 204 in the other building is kept separate")
    s, j = m.get("/staff/unit?unit=204&building=1871")
    check(s == 200 and len(j["handoff"]) == 2 and len(j["previous"]) == 2 and [r["name"] for r in j["residents"]] == ["Maria Lopez"],
          "look up an apartment's whole history", j)
    s, j = m.get("/staff/unit?unit=apt%20204")
    check(len(j["handoff"]) == 2 and len(j["previous"]) == 3 and sorted(r["name"] for r in j["residents"]) == ["Dee Carter", "Maria Lopez"],
          "looking up a number without a building shows both buildings", j)
    check(m.get("/staff/unit?unit=")[0] == 400, "apartment lookup needs a number")

    # reopen, then close again
    check(m.post("/staff/workorders/%d" % r1, {"status": "in_progress"})[0] == 200, "a completed order can be reopened")
    check(m.post("/staff/workorders/%d/complete" % r1, dict(done, handoff_note=""))[0] == 200, "…and completed again")
    check(len(m.get("/staff/unit?unit=204&building=1871")[1]["handoff"]) == 2, "an empty handoff note adds nothing")

    # a request taken over the phone
    phone_in = {"unit": "112", "building": "1885", "contact_name": "Priya Shah", "contact_email": "priya@example.com",
                "contact_phone": "651-555-0103", "category": "Appliance", "location": "Kitchen",
                "description": "=HYPERLINK(\"http://x\") Fridge is not cooling.", "urgency": "soon", "permission_to_enter": False}
    check(m.post("/staff/workorders", dict(phone_in, unit=""))[0] == 400, "phone-in order needs an apartment")
    check(m.post("/staff/workorders", dict(phone_in, contact_name=""))[0] == 400, "phone-in order needs a name")
    s, j = m.post("/staff/workorders", phone_in)
    check(s == 200, "staff log a request for a resident", j)
    r4 = j["id"]
    row = sql("SELECT source, tenant_id FROM work_orders WHERE id = ?", r4)[0]
    check(row["source"] == "staff" and row["tenant_id"] == ids["priya@example.com"], "…and it is tied to that resident's account", row)
    pr = Client()
    tenant_login(pr, "priya@example.com", "651.555.0103", "112")
    check([x["id"] for x in pr.get("/me")[1]["requests"]] == [r4], "…so the resident can follow it")

    # export
    s, headers, text = raw("GET", "/api/portal/staff/export.csv", headers={"Cookie": "rw_staff=" + m.cookies["rw_staff"]})
    csv_text = text.decode()
    check(s == 200 and headers.get("Content-Type", "").startswith("text/csv") and "attachment" in headers.get("Content-Disposition", ""),
          "export downloads as a CSV file", headers.get("Content-Type"))
    check(csv_text.startswith('"Reference","Apartment"') and "Replaced the cartridge" in csv_text, "export has the records")
    check('"\'=HYPERLINK' in csv_text, "export defuses spreadsheet formulas")
    check(csv_text.count("\r\n") == len(sql("SELECT id FROM work_orders")) + 1, "one line per work order")

    # ------------------------------------------------------------------ email
    print("email")
    s, j = m.get("/staff/settings")
    check(j == {"office_email": "", "mail_from": "", "signup_mode": "approval", "delivery_on": False, "provider_key_set": False},
          "settings start empty", j)
    check(m.post("/staff/settings", {"office_email": "not an email"})[0] == 400, "office address is validated")
    check(m.post("/staff/settings", {"office_email": "Office@Ridgewood.test", "mail_from": "Ridgewood <portal@ridgewood.test>"})[0] == 200, "save settings")
    dev("mail-mode", {"mode": "ok"})
    check(m.get("/staff/settings")[1]["delivery_on"] is True, "delivery shows as on once a key and from-address exist")
    check(m.post("/staff/settings", {"signup_mode": "open"})[0] == 200 and m.get("/staff/settings")[1]["office_email"] == "office@ridgewood.test",
          "saving one setting leaves the others alone")
    m.post("/staff/settings", {"signup_mode": "approval"})
    s, j = new_request(pr, description="Oven light is out.", category="Appliance")
    box = dev("outbox")["outbox"]
    sent = [json.loads(x["body"]) for x in box]
    check(len(box) == 2 and all(x["auth"] and x["url"] == "https://api.resend.com/emails" for x in box), "two emails go to the provider", box)
    check(sent[0]["to"] == ["office@ridgewood.test"] and sent[1]["to"] == ["priya@example.com"]
          and sent[0]["from"] == "Ridgewood <portal@ridgewood.test>" and "Apt 112" in sent[0]["subject"]
          and "651-555-0103" in sent[0]["text"], "office and resident each get the right message", sent)
    rows = sql("SELECT status FROM email_log WHERE work_order_id = ?", j["id"])
    check([x["status"] for x in rows] == ["sent", "sent"], "…and are logged as sent", rows)
    dev("mail-mode", {"mode": "fail"})
    s, j = new_request(pr, description="Second oven light is out.", category="Appliance")
    check(s == 200 and [x["status"] for x in sql("SELECT status FROM email_log WHERE work_order_id = ?", j["id"])] == ["failed", "failed"],
          "a provider error is logged and does not break the request")
    dev("mail-mode", {"mode": "throw"})
    s, j = new_request(pr, description="Third oven light is out.", category="Appliance")
    check(s == 200 and sql("SELECT detail FROM email_log WHERE work_order_id = ?", j["id"])[0]["detail"] == "Could not reach the email provider",
          "an unreachable provider is logged and does not break the request")
    dev("mail-mode", {"mode": "off"})
    s, j = m.get("/staff/emails")
    kinds = set(e["kind"] for e in j["emails"])
    check(s == 200 and kinds == {"office_new_request", "resident_received", "resident_update", "resident_completed",
                                 "office_new_signup", "resident_signup", "resident_welcome"}, "email log lists every kind", kinds)
    check(j["emails"][0]["id"] > j["emails"][-1]["id"], "email log is newest first")

    # ------------------------------------------------ residents' contact details
    print("contact details")
    check(Client().post("/me/contact", {"email": "x@y.com"})[0] == 401, "updating contact details needs a session")
    t2 = Client()
    check(tenant_login(t2, "maria@example.com", "651-555-0101", "204")[0] == 200, "(Maria signed in on a second device)")
    newc = {"email": " Maria.Lopez@Example.org ", "phone": "(651) 555-0199", "alt_phone": "651.555.0177",
            "emergency_name": "Ana Lopez (sister)", "emergency_phone": "6515550188", "password": "204"}
    s, j = t.post("/me/contact", dict(newc, password="999"))
    check(s == 401 and t.get("/me")[1]["resident"]["email"] == "maria@example.com", "a wrong current password changes nothing", j)
    check(t.post("/me/contact", dict(newc, password=""))[0] == 401, "the current password is required")
    for bad, why in ((dict(newc, email="nope"), "a valid email"), (dict(newc, phone="555-0199"), "a full phone number"),
                     (dict(newc, alt_phone="12"), "a full second phone, if any"), (dict(newc, emergency_phone="12"), "a full emergency phone, if any")):
        check(t.post("/me/contact", bad)[0] == 400, "contact details need " + why)
    check(t.post("/me/contact", dict(newc, email="james@example.com"))[0] == 409, "an email already on another account is refused")
    done_before = sql("SELECT contact_email, contact_phone FROM work_orders WHERE id = ?", r1)[0]
    s, j = t.post("/me/contact", newc)
    check(s == 200 and j == {"ok": True, "changed": 5, "sign_in_changed": True}, "a resident updates their contact details", j)
    me = t.get("/me")[1]["resident"]
    check((me["email"], me["phone"], me["alt_phone"], me["emergency_name"], me["emergency_phone"]) ==
          ("maria.lopez@example.org", "651-555-0199", "651-555-0177", "Ana Lopez (sister)", "651-555-0188") and me["contact_updated_at"],
          "…and sees them back, tidied up", me)
    check(t.get("/me")[0] == 200 and t2.get("/me")[0] == 401, "…staying signed in here while other devices are signed out")
    check(tenant_login(Client(), "maria@example.com", "651-555-0101", "204")[0] == 401, "the old email and phone no longer sign in")
    check(tenant_login(Client(), "maria.lopez@example.org", "651-555-0199", "204")[0] == 200, "the new ones do")
    check(sql("SELECT contact_email, contact_phone FROM work_orders WHERE id = ?", r3)[0] ==
          {"contact_email": "maria.lopez@example.org", "contact_phone": "651-555-0199"}, "her open work orders carry the new details")
    check(sql("SELECT contact_email, contact_phone FROM work_orders WHERE id = ?", r1)[0] == done_before,
          "completed ones keep the details they were done under")
    act = [e for e in m.get("/staff/activity")[1]["activity"] if e["event"] == "contact_updated"]
    check(len(act) == 1 and "email: maria@example.com → maria.lopez@example.org" in act[0]["detail"]
          and "phone: 651-555-0101 → 651-555-0199" in act[0]["detail"] and "emergency contact: (none) → Ana Lopez (sister)" in act[0]["detail"],
          "the change is in the activity log, old and new", act)
    mails = sql("SELECT kind, to_addr FROM email_log WHERE kind IN ('office_contact_update', 'resident_email_changed') ORDER BY id")
    check([x["kind"] for x in mails] == ["office_contact_update", "resident_email_changed"] and mails[1]["to_addr"] == "maria@example.com",
          "the office is told, and so is the old email address", mails)
    s, j = t.post("/me/contact", newc)
    check(s == 200 and j["changed"] == 0, "saving the same details again is not a change", j)
    s, j = t.post("/me/contact", {"email": "maria.lopez@example.org", "phone": "651-555-0199", "password": "204"})
    check(s == 200 and j["changed"] == 0, "details that are not sent are kept", j)
    s, j = t.post("/me/contact", dict(newc, alt_phone="", emergency_name="", emergency_phone=""))
    check(s == 200 and j == {"ok": True, "changed": 3, "sign_in_changed": False} and t.get("/me")[0] == 200,
          "clearing the optional details leaves sign-in alone", j)
    codes = [dee.post("/me/contact", {"email": "dee@example.com", "phone": "651-555-0104", "password": "guess%d" % i})[0] for i in range(11)]
    check(codes == [401] * 10 + [429], "guessing the current password is cut off after ten tries", codes)

    # the office sees it, and can fill in what the resident has not
    row = [r for r in m.get("/staff/residents")[1]["residents"] if r["id"] == ids["maria@example.com"]][0]
    check(row["email"] == "maria.lopez@example.org" and row["contact_updated_by"] == "resident" and row["contact_updated_at"]
          and row["alt_phone"] == "" and "emergency_name" in row, "staff see the new details and that the resident made the change", row)
    check(m.post("/staff/residents/%d" % ids["maria@example.com"], {"alt_phone": "12"})[0] == 400, "staff edits are validated too")
    check(m.post("/staff/residents/%d" % ids["maria@example.com"], {"emergency_name": "Ana Lopez", "emergency_phone": "651 555 0188"})[0] == 200,
          "staff add an emergency contact")
    row = [r for r in m.get("/staff/residents")[1]["residents"] if r["id"] == ids["maria@example.com"]][0]
    check((row["emergency_name"], row["emergency_phone"], row["contact_updated_by"]) == ("Ana Lopez", "651-555-0188", "Andrew Manager"),
          "…recorded under their name", row)
    check(t.get("/me")[0] == 200, "…without signing the resident out")
    check(any("emergency contact: (none) → Ana Lopez" in e["detail"] for e in m.get("/staff/activity")[1]["activity"] if e["event"] == "resident_edited"),
          "staff edits to contact details are in the activity log too")
    s, j = t.post("/me/contact", {"email": "maria@example.com", "phone": "651-555-0101", "password": "204"})
    check(s == 200 and j["sign_in_changed"] is True, "(Maria back to her original sign-in details)", j)

    # the contact sheet as a spreadsheet
    check(Client().get("/staff/contacts.csv")[0] == 401, "the contact sheet download needs a staff session")
    s, headers, text = raw("GET", "/api/portal/staff/contacts.csv", headers={"Cookie": "rw_staff=" + m.cookies["rw_staff"]})
    csvt = text.decode()
    check(s == 200 and headers.get("Content-Type", "").startswith("text/csv")
          and 'filename="ridgewood-resident-contacts-' in headers.get("Content-Disposition", ""), "a manager downloads the contact sheet", headers.get("Content-Disposition"))
    check(csvt.startswith('"Building","Apartment","Resident","Email","Phone","Second phone","Emergency contact","Emergency phone","Account"'),
          "with a column for every contact detail", csvt[:200])
    check('"1871","204","Maria Lopez","maria@example.com","651-555-0101","","Ana Lopez","651-555-0188","Active","Added by the office"' in csvt,
          "each resident is one row", csvt[:600])
    check(csvt.index('"1871","204"') < csvt.index('"1871","305"') < csvt.index('"1871","310"') < csvt.index('"1885","112"'),
          "rows run building by building, apartments in number order")
    check(csvt.count("\r\n") == len(sql("SELECT id FROM tenants")) + 1, "every resident account is in it, removed ones included")
    check(any(e["event"] == "contacts_exported" for e in m.get("/staff/activity")[1]["activity"]), "downloading it is in the activity log")

    # ------------------------------------------------- rents on the main site
    print("site pricing")
    blank = {"rent": None, "from": False, "note": "", "available": None}
    s, j = Client().get("/pricing")
    check(s == 200 and j == {"plans": {"wilson": blank, "battlecreek": blank, "wakefield": blank}, "specials": [], "updated_at": None},
          "the site is given no prices until staff enter some", j)
    check(Client().get("/staff/pricing")[0] == 401 and Client().post("/staff/pricing", {})[0] == 401, "editing prices needs a staff session")
    s, j = m.get("/staff/pricing")
    check(s == 200 and j["plans"]["wilson"] == {"name": "The Wilson", "beds": "1 bedroom", "rent": None, "from": False, "note": "", "available": None},
          "staff see each plan", j)
    for bad in ("abc", "12.50", "-5", "0", "99999", "1150 a month"):
        s, j = m.post("/staff/pricing", {"plans": {"wilson": {"rent": bad}}})
        check(s == 400 and "The Wilson" in j.get("error", ""), "a rent of %r is refused" % bad, j)
    check(Client().get("/pricing")[1]["plans"]["wilson"] == blank, "a refused edit changes nothing")
    s, j = m.post("/staff/pricing", {"plans": {"wilson": {"rent": "$1,150", "from": True, "note": " Available December 1 "},
                                               "battlecreek": {"rent": 1395, "from": False, "note": ""},
                                               "wakefield": {"rent": "", "from": True, "note": ""}}})
    check(s == 200 and j["changed"] == 2, "a manager posts rents", j)
    s, j = Client().get("/pricing")
    check(j["plans"] == {"wilson": {"rent": 1150, "from": True, "note": "Available December 1", "available": None},
                         "battlecreek": {"rent": 1395, "from": False, "note": "", "available": None}, "wakefield": blank} and j["updated_at"],
          "the site is given exactly what was posted", j)
    check("updated_by" not in j and "name" not in j["plans"]["wilson"], "…and nothing about who posted it")
    s, j = m.get("/staff/pricing")
    check(j["updated_by"] == "Andrew Manager" and j["plans"]["battlecreek"]["rent"] == 1395, "staff see who last changed them", j)
    check(m.post("/staff/pricing", {"plans": {"battlecreek": {"rent": 1425, "from": False, "note": ""}}})[1]["changed"] == 1,
          "one plan can be changed on its own")
    j = Client().get("/pricing")[1]["plans"]
    check(j["battlecreek"]["rent"] == 1425 and j["wilson"]["rent"] == 1150, "…leaving the others as they were", j)
    check(m.post("/staff/pricing", {"plans": {"battlecreek": {"rent": "1425", "from": False, "note": ""}}})[1]["changed"] == 0,
          "saving the same figure again is not a change")
    check(m.post("/staff/pricing", {"plans": {"wakefield": {"rent": "", "note": "<b>Waitlist</b> only"}}})[0] == 200
          and Client().get("/pricing")[1]["plans"]["wakefield"] == {"rent": None, "from": False, "note": "<b>Waitlist</b> only", "available": None},
          "a note can stand without a price, and is stored as plain text")
    check(m.post("/staff/pricing", {"plans": {"wilson": {"rent": "", "from": True, "note": ""}}})[0] == 200
          and Client().get("/pricing")[1]["plans"]["wilson"] == blank, "clearing a rent takes the price off the site")
    log = [e["detail"] for e in m.get("/staff/activity")[1]["activity"] if e["event"] == "pricing_changed"]
    check(len(log) == 4 and "The Battle Creek: $1,395 → $1,425" in log[2] and "The Wilson: no price → from $1,150 (Available December 1)" in log[3],
          "every price change is in the activity log, old figure and new", log)
    m.post("/staff/pricing", {"plans": {"wilson": {"rent": 1150, "from": True, "note": ""}}})

    # availability, toggled plan by plan
    pub = lambda: Client().get("/pricing")[1]["plans"]
    check(all(v["available"] is None for v in pub().values()), "no plan shows as available or unavailable until staff choose")
    check(m.post("/staff/pricing", {"plans": {"wilson": {"available": "yes"}}})[0] == 400, "availability must be available or unavailable")
    s, j = m.post("/staff/pricing", {"plans": {"wilson": {"available": True}}})
    check(s == 200 and j["changed"] == 1, "a manager marks a plan available", j)
    s, j = m.post("/staff/pricing", {"plans": {"battlecreek": {"available": False}}})
    check(s == 200 and j["changed"] == 1, "…and another unavailable", j)
    v = pub()
    check((v["wilson"]["available"], v["battlecreek"]["available"], v["wakefield"]["available"]) == (True, False, None),
          "the site is told which plans are available", v)
    check((v["wilson"]["rent"], v["wilson"]["from"], v["battlecreek"]["rent"], v["wakefield"]["note"]) == (1150, True, 1425, "<b>Waitlist</b> only"),
          "flipping availability leaves the rents and notes alone", v)
    check(m.post("/staff/pricing", {"plans": {"wilson": {"rent": "1175", "from": True, "note": ""}}})[1]["changed"] == 1
          and pub()["wilson"]["available"] is True, "saving a rent leaves availability alone")
    m.post("/staff/pricing", {"plans": {"wilson": {"rent": 1150}}})
    check(m.post("/staff/pricing", {"plans": {"wilson": {"available": True}}})[1]["changed"] == 0, "toggling to the same state is not a change")
    check(m.get("/staff/pricing")[1]["plans"]["battlecreek"]["available"] is False, "staff see the current state")
    s, j = m.post("/staff/pricing", {"plans": {"battlecreek": {"available": None}}})
    check(s == 200 and j["changed"] == 1 and pub()["battlecreek"]["available"] is None, "a plan can go back to showing no availability")
    m.post("/staff/pricing", {"plans": {"battlecreek": {"available": False}}})
    log = [e["detail"] for e in m.get("/staff/activity")[1]["activity"] if e["event"] == "pricing_changed"]
    check("The Wilson availability: not shown → available" in log and "The Battle Creek availability: unavailable → not shown" in log,
          "availability changes are in the activity log", log[:4])

    # ------------------------------------------- specials and promotions on the site
    print("specials")
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    today = datetime.now(ZoneInfo("America/Chicago")).date()
    feed = lambda: Client().get("/pricing")[1]["specials"]
    check(feed() == [], "the site is given no specials until staff add one")
    check(Client().get("/staff/specials")[0] == 401 and Client().post("/staff/specials", {})[0] == 401, "managing specials needs a staff session")
    s, j = m.get("/staff/specials")
    check(s == 200 and j["specials"] == [] and [p["id"] for p in j["plans"]] == ["wilson", "battlecreek", "wakefield"] and j["today"] == today.isoformat(),
          "staff start with no specials, and the date in Saint Paul", j)
    good = {"title": "First month free", "details": "Sign a 12-month lease by December 31 and your first full month is free.",
            "fine_print": "New residents only. One per household.", "plans": ["wakefield"], "ends_on": "2099-12-31", "active": True}
    for bad, why in ((dict(good, title="x"), "a headline"), (dict(good, plans=[]), "at least one floor plan"),
                     (dict(good, plans=["penthouse"]), "real floor plans"), (dict(good, ends_on="tomorrow"), "a real end date"),
                     (dict(good, ends_on="2026-02-30"), "a date that exists"), (dict(good, active="yes"), "on or off")):
        check(m.post("/staff/specials", bad)[0] == 400, "a special needs " + why)
    check(feed() == [], "a refused special adds nothing")
    s, j = m.post("/staff/specials", good)
    check(s == 200 and j["status"] == "on" and len(j["id"]) == 8, "a manager adds a special that shows straight away", j)
    first = j["id"]
    f = feed()
    check(f == [{"id": first, "title": "First month free", "details": good["details"], "fine_print": good["fine_print"],
                 "plans": ["wakefield"], "ends_on": "2099-12-31"}], "the site is given the special, and nothing about who made it", f)
    s, j = m.post("/staff/specials", {"title": "<b>$250 off</b> move-in", "plans": ["wilson", "battlecreek", "wakefield"], "active": False})
    check(s == 200 and j["status"] == "off" and len(feed()) == 1, "a special can be added switched off")
    second = j["id"]
    s, j = m.post("/staff/specials/" + second, {"active": True})
    check(s == 200 and j == {"ok": True, "changed": 1, "status": "on"}, "…and switched on with the toggle", j)
    f = feed()
    check([x["title"] for x in f] == ["First month free", "<b>$250 off</b> move-in"] and f[1]["details"] == "" and f[1]["ends_on"] == "",
          "both show, in the order they were added, text kept as text", f)
    check(m.post("/staff/specials/" + second, {"active": True})[1]["changed"] == 0, "switching on what is already on is not a change")
    check(m.post("/staff/specials/" + second, {"active": False})[1]["status"] == "off" and len(feed()) == 1, "switching it off takes it off the site")
    s, j = m.post("/staff/specials/" + first, {"title": "First month FREE", "plans": ["wakefield", "wilson"]})
    check(s == 200 and j["changed"] == 2, "a special can be edited", j)
    f = feed()[0]
    check((f["title"], f["plans"], f["details"], f["ends_on"]) == ("First month FREE", ["wilson", "wakefield"], good["details"], "2099-12-31"),
          "…and only what was sent changes; plans keep the site's order", f)
    check(m.post("/staff/specials/" + first, {"plans": []})[0] == 400, "an edit still needs a floor plan")
    yesterday, tomorrow = (today - timedelta(days=1)).isoformat(), (today + timedelta(days=1)).isoformat()
    check(m.post("/staff/specials/" + first, {"ends_on": today.isoformat()})[1]["status"] == "on" and len(feed()) == 1,
          "a special ending today still shows today")
    s, j = m.post("/staff/specials/" + first, {"ends_on": yesterday})
    check(j["status"] == "ended" and feed() == [], "once its end date has passed it comes off the site by itself", j)
    check([x["status"] for x in m.get("/staff/specials")[1]["specials"]] == ["ended", "off"], "staff see which have ended and which are off")
    check(m.post("/staff/specials/" + first, {"ends_on": tomorrow})[1]["status"] == "on" and len(feed()) == 1, "moving the end date brings it back")
    check(m.post("/staff/specials/" + first, {"ends_on": ""})[1]["status"] == "on", "an end date is optional")
    for i in range(6):
        m.post("/staff/specials", {"title": "Filler special %d" % i, "active": False})
    s, j = m.post("/staff/specials", {"title": "One too many"})
    check(s == 400 and "up to 8" in j.get("error", ""), "there can be up to eight specials", j)
    for x in m.get("/staff/specials")[1]["specials"]:
        if x["title"].startswith("Filler"):
            m.post("/staff/specials/%s/delete" % x["id"])
    check(m.post("/staff/specials/%s/delete" % second)[0] == 200 and len(m.get("/staff/specials")[1]["specials"]) == 1, "a special can be deleted")
    check(m.post("/staff/specials/%s/delete" % second)[0] == 404 and m.post("/staff/specials/ffffffff", {"active": True})[0] == 404,
          "a deleted or unknown special is 404")
    events = [e["event"] for e in m.get("/staff/activity")[1]["activity"]]
    for ev in ("special_created", "special_turned_on", "special_turned_off", "special_changed", "special_deleted"):
        check(ev in events, "the activity log records " + ev)
    changed = [e["detail"] for e in m.get("/staff/activity")[1]["activity"] if e["event"] == "special_changed"]
    check(any('changed headline, floor plans (was "First month free")' in x for x in changed), "edits say what changed", changed[:3])

    # ------------------------------------------------------------- turnovers
    print("turnovers")
    check(Client().get("/staff/turnovers")[0] == 401 and Client().post("/staff/turnovers", {"unit": "1"})[0] == 401,
          "turnovers need a staff session")
    s, j = m.get("/staff/turnovers")
    check(s == 200 and j["turnovers"] == [] and j["mine_open"] == 0 and j["checklist_size"] >= 80, "no turnovers to start with", j)
    for bad, why in (({"unit": ""}, "an apartment"), ({"unit": "310", "building": "1999"}, "a real building"),
                     ({"unit": "310", "ready_by": "soon"}, "a real ready-by date"), ({"unit": "310", "move_out_on": "2026-02-30"}, "a real move-out date")):
        check(m.post("/staff/turnovers", bad)[0] == 400, "a turnover needs " + why)
    s, j = m.post("/staff/turnovers", {"unit": "Apt 310", "building": "1871", "move_out_on": "2026-11-30", "ready_by": "2026-12-10",
                                       "notes": "Long-term resident: plan on a full paint."})
    check(s == 200 and j["id"], "a manager starts a turnover", j)
    tid = j["id"]
    s, j = m.post("/staff/turnovers", {"unit": "310", "building": "1871"})
    check(s == 409 and j.get("id") == tid, "an apartment can only have one turnover in progress", j)
    s, d = m.get("/staff/turnovers/%d" % tid)
    tasks = d["tasks"]
    cats = list(dict.fromkeys(x["category"] for x in tasks))
    check(len(tasks) == m.get("/staff/turnovers")[1]["checklist_size"] >= 80, "it comes with the full checklist", len(tasks))
    check(cats[0] == "Move-out & walk-through" and cats[-1] == "Final inspection" and "Walls, ceilings & paint" in cats
          and cats.index("Walls, ceilings & paint") < cats.index("Cleaning"), "…in the order the work is done", cats)
    check(all(x["status"] == "todo" and x["assignee"] is None for x in tasks), "every task starts to do and unassigned")
    tv = d["turnover"]
    check((tv["unit"], tv["building"], tv["move_out_on"], tv["ready_by"], tv["status"], tv["created_by"]) ==
          ("310", "1871", "2026-11-30", "2026-12-10", "open", "Andrew Manager"), "the details are kept, apartment number tidied", tv)
    check([x["name"] for x in d["team"]] == ["Andrew Manager"], "the page lists the team to assign from", d["team"])

    paint = [x for x in tasks if x["category"] == "Walls, ceilings & paint"]
    s, j = m.post("/staff/turnovers/%d/assign" % tid, {"category": "Walls, ceilings & paint", "assigned_name": "Twin Cities Painting"})
    check(s == 200 and j["changed"] == len(paint), "a manager hands a whole section to an outside painter", j)
    k1, k2, k3 = tasks[0]["id"], tasks[1]["id"], tasks[2]["id"]
    s, j = m.post("/staff/turnover-tasks/%d" % k1, {"assigned_to": my_id})
    check(s == 200 and j["task"]["assignee"] == "Andrew Manager" and j["task"]["assigned_to"] == my_id, "…and one task to a team member", j)
    check(m.post("/staff/turnover-tasks/%d" % k1, {"assigned_to": 9999})[0] == 400, "tasks go only to people on the team, or a named outsider")
    check(m.post("/staff/turnover-tasks/%d" % k1, {"status": "bogus"})[0] == 400, "a task is to do, done or not needed")
    s, j = m.post("/staff/turnover-tasks/%d" % k1, {"status": "done"})
    check(j["task"]["status"] == "done" and j["task"]["done_by"] == "Andrew Manager" and j["task"]["done_at"], "ticking a task off records who and when", j)
    s, j = m.post("/staff/turnover-tasks/%d" % k2, {"status": "skipped", "note": "Resident never had a garage."})
    check((j["task"]["status"], j["task"]["note"], j["task"]["done_by"]) == ("skipped", "Resident never had a garage.", "Andrew Manager"),
          "a task can be marked not needed, with a note", j)
    s, j = m.post("/staff/turnover-tasks/%d" % k1, {"status": "todo"})
    check(j["task"]["status"] == "todo" and j["task"]["done_at"] is None and j["task"]["done_by"] == "", "unticking puts it back to do", j)
    m.post("/staff/turnover-tasks/%d" % k1, {"status": "done"})
    m.post("/staff/turnover-tasks/%d" % k3, {"assigned_to": my_id})
    row = m.get("/staff/turnovers")[1]
    r0 = row["turnovers"][0]
    check((r0["total"], r0["finished"], r0["mine_open"]) == (len(tasks), 2, 1) and row["mine_open"] == 1,
          "the list shows progress and what is waiting on you", r0)
    check(sorted(r0["crew"]) == ["Andrew Manager", "Twin Cities Painting"] and r0["unassigned_open"] == len(tasks) - len(paint) - 3,
          "…who is on the crew, and how much is still unassigned", r0)
    s, j = m.get("/staff/turnovers/mine")
    check([x["id"] for x in j["tasks"]] == [k1, k3] and j["turnovers"][0]["unit"] == "310", "my tasks lists what is assigned to me", j)
    check(m.get("/staff/me")[1]["turnover_tasks"] == 1, "…and the menu can show how many are still to do")

    s, j = m.post("/staff/turnovers/%d/tasks" % tid, {"category": "Walls, ceilings & paint", "title": "Paint the <b>bedroom accent wall</b> back to white"})
    check(s == 200 and j["task"]["category"] == "Walls, ceilings & paint", "a manager adds a task to a section", j)
    custom = j["task"]["id"]
    order = [x["id"] for x in m.get("/staff/turnovers/%d" % tid)[1]["tasks"]]
    check(order.index(custom) == order.index(paint[-1]["id"]) + 1, "…and it lands at the end of that section")
    s, j = m.post("/staff/turnovers/%d/tasks" % tid, {"category": "Garage", "title": "Repaint the garage door number"})
    check(s == 200 and m.get("/staff/turnovers/%d" % tid)[1]["tasks"][-1]["title"] == "Repaint the garage door number",
          "a task in a new section goes at the end")
    check(m.post("/staff/turnovers/%d/tasks" % tid, {"category": "Garage", "title": ""})[0] == 400, "a task needs a description")
    check(m.post("/staff/turnover-tasks/%d/delete" % j["task"]["id"])[0] == 200 and len(m.get("/staff/turnovers/%d" % tid)[1]["tasks"]) == len(tasks) + 1,
          "a manager removes a task")
    check(m.post("/staff/turnover-tasks/%d/delete" % j["task"]["id"])[0] == 404, "…once")

    check(m.post("/staff/turnovers/%d" % tid, {"ready_by": "2026-12-12", "notes": "Full paint confirmed."})[0] == 200
          and m.get("/staff/turnovers/%d" % tid)[1]["turnover"]["ready_by"] == "2026-12-12", "a manager changes the details")
    check(m.post("/staff/turnovers/%d" % tid, {"status": "done"})[0] == 400, "a turnover is either in progress or ready")
    check(m.post("/staff/turnovers/%d" % tid, {"status": "ready"})[0] == 200, "a manager marks the apartment ready")
    tv = m.get("/staff/turnovers/%d" % tid)[1]["turnover"]
    check(tv["status"] == "ready" and tv["completed_by"] == "Andrew Manager" and tv["completed_at"], "…recorded with who and when", tv)
    check(m.get("/staff/turnovers")[1]["turnovers"] == [] and [x["id"] for x in m.get("/staff/turnovers?view=ready")[1]["turnovers"]] == [tid],
          "it moves from in progress to completed")
    check(m.get("/staff/turnovers/mine")[1]["tasks"] == [] and m.get("/staff/me")[1]["turnover_tasks"] == 0,
          "tasks in a finished turnover leave my list")
    check(m.post("/staff/turnovers", {"unit": "310", "building": "1871"})[0] == 200, "once it is ready, the apartment can start a new turnover")
    second = m.get("/staff/turnovers")[1]["turnovers"][0]["id"]
    check(m.post("/staff/turnovers/%d" % tid, {"status": "open"})[0] == 409, "…and the old one cannot be reopened beside it")
    check(m.post("/staff/turnovers/%d/delete" % second)[0] == 200, "a manager deletes a turnover")
    check(sql("SELECT COUNT(*) AS n FROM turnover_tasks WHERE turnover_id = ?", second)[0]["n"] == 0, "…and its tasks go with it")
    check(m.post("/staff/turnovers/%d" % tid, {"status": "open"})[0] == 200
          and m.get("/staff/turnovers/%d" % tid)[1]["turnover"]["completed_at"] is None, "a ready turnover can be reopened")

    s, j = m.post("/staff/turnovers", {"unit": "204", "building": "1871"})
    d = m.get("/staff/turnovers/%d" % j["id"])[1]
    check(len(d["handoff"]) == 2 and any("Moen 1225" in n["body"] for n in d["handoff"]),
          "a turnover shows the notes earlier technicians left for that apartment", d["handoff"])
    check(m.post("/staff/turnovers/%d" % j["id"], {"unit": "310", "building": "1871"})[0] == 409,
          "a turnover cannot be moved onto an apartment that already has one going")
    m.post("/staff/turnovers/%d/delete" % j["id"])
    s, j = m.post("/staff/turnovers/%d/assign" % tid, {"assigned_name": ""})
    check(s == 200 and j["changed"] == len(tasks) + 1, "a whole checklist can be unassigned at once", j)
    m.post("/staff/turnovers/%d/assign" % tid, {"category": "Walls, ceilings & paint", "assigned_name": "Twin Cities Painting"})
    events = [e["event"] for e in m.get("/staff/activity")[1]["activity"]]
    for ev in ("turnover_started", "turnover_assigned", "turnover_changed", "turnover_ready", "turnover_reopened", "turnover_deleted"):
        check(ev in events, "the activity log records " + ev)
    tk = [x for x in m.get("/staff/turnovers/%d" % tid)[1]["tasks"] if x["category"] == "Cleaning"][0]["id"]

    # --------------------------------------------------------------- the team
    print("team")
    tech_new = {"name": "Sam Tech", "email": "sam@ridgewood.test", "password": "temporary pass 1", "role": "tech"}
    check(m.post("/staff/team", dict(tech_new, password="short"))[0] == 400, "team member needs a real password")
    check(m.post("/staff/team", tech_new)[0] == 200, "add a technician")
    check(m.post("/staff/team", tech_new)[0] == 409, "same email twice is refused")
    tech_id = [x for x in m.get("/staff/team")[1]["team"] if x["email"] == "sam@ridgewood.test"][0]["id"]
    k = Client()
    s, j = k.post("/staff/login", {"email": "SAM@ridgewood.test", "password": "temporary pass 1"})
    check(s == 200 and j["must_change"] is True, "technician signs in with the temporary password", j)
    s, j = k.get("/staff/workorders")
    check(s == 403 and j.get("code") == "must_change", "…and must choose their own before doing anything", j)
    check(k.get("/staff/me")[0] == 200, "…though they can load their profile")
    check(k.post("/staff/password", {"current": "wrong", "next": "my own password 9"})[0] == 401, "password change needs the current one")
    check(k.post("/staff/password", {"current": "temporary pass 1", "next": "temporary pass 1"})[0] == 400, "new password must differ")
    check(k.post("/staff/password", {"current": "temporary pass 1", "next": "short"})[0] == 400, "new password must be long enough")
    check(k.post("/staff/password", {"current": "temporary pass 1", "next": "my own password 9"})[0] == 200, "technician sets their own password")
    check(k.get("/staff/workorders")[0] == 200, "…and is let in")
    for path in ("/staff/team", "/staff/activity", "/staff/settings"):
        check(k.get(path)[0] == 403, "technician cannot open " + path)
    check(k.post("/staff/residents", maria)[0] == 403, "technician cannot edit the roster")
    check(k.post("/staff/team", tech_new)[0] == 403, "technician cannot add staff")
    check(k.post("/staff/settings", {"office_email": ""})[0] == 403, "technician cannot change settings")
    check(k.get("/staff/pricing")[0] == 200, "technician can see the posted rents")
    check(k.get("/staff/residents")[1]["residents"][0].get("emergency_phone") is not None, "technician can see residents' contact details")
    check(k.get("/staff/contacts.csv")[0] == 403, "…but only a manager can download the contact sheet")
    check(k.post("/staff/pricing", {"plans": {"wilson": {"rent": 1}}})[0] == 403 and Client().get("/pricing")[1]["plans"]["wilson"]["rent"] == 1150,
          "technician cannot change them")
    check(k.post("/staff/pricing", {"plans": {"wakefield": {"available": True}}})[0] == 403 and Client().get("/pricing")[1]["plans"]["wakefield"]["available"] is None,
          "…or availability")
    check(k.get("/staff/specials")[0] == 403 and k.post("/staff/specials", {"title": "Tech special"})[0] == 403, "…or specials")
    check(m.post("/staff/turnover-tasks/%d" % tk, {"assigned_to": tech_id})[0] == 200, "a manager assigns a turnover task to a technician")
    s, j = k.get("/staff/turnovers/mine")
    check([x["id"] for x in j["tasks"]] == [tk] and k.get("/staff/me")[1]["turnover_tasks"] == 1, "the technician sees it in their tasks", j)
    check(k.get("/staff/turnovers/%d" % tid)[0] == 200, "…and can open the whole checklist")
    s, j = k.post("/staff/turnover-tasks/%d" % tk, {"status": "done", "note": "Degreased the hood too."})
    check(s == 200 and (j["task"]["done_by"], j["task"]["note"]) == ("Sam Tech", "Degreased the hood too."), "…ticks it off with a note", j)
    check(k.post("/staff/turnover-tasks/%d" % tk, {"assigned_name": "Someone"})[0] == 403, "a technician cannot assign tasks")
    check(k.post("/staff/turnovers", {"unit": "999"})[0] == 403 and k.post("/staff/turnovers/%d" % tid, {"status": "ready"})[0] == 403
          and k.post("/staff/turnovers/%d/assign" % tid, {"assigned_name": "x"})[0] == 403
          and k.post("/staff/turnovers/%d/tasks" % tid, {"category": "Garage", "title": "Something"})[0] == 403
          and k.post("/staff/turnover-tasks/%d/delete" % tk)[0] == 403 and k.post("/staff/turnovers/%d/delete" % tid)[0] == 403,
          "a technician cannot start, finish, assign, add to or delete from a turnover")
    Client().post("/signup", dict(new, email="wait@example.com", name="Wendy Waits", unit="130"))
    wid = sql("SELECT id FROM tenants WHERE email = 'wait@example.com'")[0]["id"]
    for action in ("approve", "decline", "reset-password"):
        check(k.post("/staff/residents/%d/%s" % (wid, action))[0] == 403, "technician cannot " + action + " a resident account")
    check(m.post("/staff/residents/%d/decline" % wid)[0] == 200, "(manager declines it)")
    check(k.get("/staff/residents")[0] == 200 and k.get("/staff/emails")[0] == 200, "technician can read the roster and email log")
    check(k.post("/staff/workorders/%d/complete" % r2, {"work_done": "Replaced the hall light ballast."})[0] == 200, "technician completes a job")
    check(m.get("/staff/workorders/%d" % r2)[1]["order"]["completed_by_name"] == "Sam Tech", "…and it is recorded under their name")
    check(m.post("/staff/workorders/%d" % r3, {"assigned_to": tech_id})[0] == 200, "manager assigns work to the technician")
    check([o["id"] for o in k.get("/staff/workorders?view=mine")[1]["orders"]] == [r3], "…and it appears under their work")

    check(m.post("/staff/team/%d" % my_id, {"role": "tech"})[0] == 400, "a manager cannot demote themselves")
    check(m.post("/staff/team/%d" % my_id, {"active": False})[0] == 400, "a manager cannot remove themselves")
    check(m.post("/staff/team/%d" % tech_id, {"password": "reset by manager 3"})[0] == 200, "manager resets a password")
    check(k.get("/staff/workorders")[0] == 401, "…which signs that person out")
    check(k.post("/staff/login", {"email": "sam@ridgewood.test", "password": "my own password 9"})[0] == 401, "…and retires the old password")
    s, j = k.post("/staff/login", {"email": "sam@ridgewood.test", "password": "reset by manager 3"})
    check(s == 200 and j["must_change"] is True, "…and the new one must be changed at first sign-in", j)
    check(m.post("/staff/team/%d" % tech_id, {"active": False})[0] == 200, "manager removes a team member")
    check(k.get("/staff/me")[0] == 401, "…who is signed out at once")
    check(k.post("/staff/login", {"email": "sam@ridgewood.test", "password": "reset by manager 3"})[0] == 401, "…and cannot sign back in")
    check(m.get("/staff/workorders/%d" % r2)[1]["order"]["completed_by_name"] == "Sam Tech", "their completed work keeps their name")
    check(m.post("/staff/team/%d" % tech_id, {"active": True, "role": "manager"})[0] == 200, "restore and promote")
    check(k.post("/staff/login", {"email": "sam@ridgewood.test", "password": "reset by manager 3"})[0] == 200, "restored member signs in")

    m2 = Client()
    check(m2.post("/staff/login", {"email": "manager@ridgewood.test", "password": "correct horse 42"})[0] == 200, "manager signs in on a second device")
    check(m.post("/staff/password", {"current": "correct horse 42", "next": "a brand new password"})[0] == 200, "manager changes password")
    check(m.get("/staff/me")[0] == 200 and m2.get("/staff/me")[0] == 401, "…which signs out their other devices only")
    s, j = Client().post("/staff/login", {"email": "nobody@ridgewood.test", "password": "whatever it is"})
    s2, j2b = Client().post("/staff/login", {"email": "sam@ridgewood.test", "password": "whatever it is"})
    check(s == 401 and s2 == 401 and j == j2b, "unknown staff email and wrong password look identical", (j, j2b))
    bf = Client()
    codes = [bf.post("/staff/login", {"email": "manager@ridgewood.test", "password": "guess %d" % i})[0] for i in range(11)]
    check(codes == [401] * 10 + [429], "staff sign-in locks after ten wrong passwords", codes)
    bf.offset = 16 * MIN
    check(bf.post("/staff/login", {"email": "manager@ridgewood.test", "password": "a brand new password"})[0] == 200, "…and reopens after fifteen minutes")

    # ---------------------------------------------------- sessions and the log
    print("sessions and logs")
    m.offset = 11 * HOUR
    check(m.get("/staff/me")[0] == 200, "staff session lasts the working day")
    m.offset = 13 * HOUR
    check(m.get("/staff/me")[0] == 401, "staff session ends after twelve hours")
    m.offset = 0
    check(m.get("/staff/me")[0] == 200, "(clock back)")
    t.offset = 6 * 24 * HOUR
    check(t.get("/me")[0] == 200, "resident session lasts the week")
    t.offset = 8 * 24 * HOUR
    check(t.get("/me")[0] == 401, "resident session ends after seven days")
    t.offset = 0

    check(m.post("/staff/residents/%d" % ids["james@example.com"], {"active": False})[0] == 200, "manager removes a resident")
    check(j2.get("/me")[0] == 401, "…who is signed out at once")
    check(tenant_login(Client(), "james@example.com", "651-555-0102", "310")[0] == 401, "…and cannot sign back in")
    check(m.get("/staff/workorders/%d" % r2)[0] == 200, "their work orders are kept")
    check(m.post("/staff/residents/%d" % ids["james@example.com"], {"active": True})[0] == 200, "manager restores a resident")
    check(tenant_login(j2, "james@example.com", "651-555-0102", "310")[0] == 200, "…who can sign in again")
    check(m.post("/staff/residents/%d" % ids["james@example.com"], {"unit": "311", "phone": "651-555-0222"})[0] == 200, "manager moves a resident to another apartment")
    check(j2.get("/me")[0] == 401, "…their old sign-in stops working")
    check(tenant_login(j2, "james@example.com", "651-555-0102", "310")[0] == 401, "…old details are refused")
    check(tenant_login(j2, "james@example.com", "651-555-0222", "311")[0] == 200, "…new details work")
    check(m.post("/staff/residents/%d" % ids["james@example.com"], {"email": "bad"})[0] == 400, "edits are validated")
    check(m.post("/staff/residents/99999", {"active": False})[0] == 404, "missing resident is 404")

    check(t.post("/logout")[0] == 200 and "rw_tenant" not in t.cookies and t.get("/me")[0] == 401, "resident signs out")
    check(k.post("/staff/logout")[0] == 200 and k.get("/staff/me")[0] == 401, "staff sign out")

    s, j = m.get("/staff/activity")
    events = [e["event"] for e in j["activity"]]
    for ev in ("portal_set_up", "sign_in", "sign_in_failed", "request_created", "request_cancelled", "order_completed",
               "order_updated", "resident_added", "residents_imported", "resident_removed", "resident_unlocked",
               "team_member_added", "team_password_reset", "password_changed", "settings_changed", "records_exported",
               "account_created", "resident_approved", "resident_declined", "resident_password_changed", "resident_password_reset",
               "contact_updated", "contacts_exported"):
        check(ev in events, "activity log records " + ev)
    failed_rows = [e for e in j["activity"] if e["event"] == "sign_in_failed" and e["actor_kind"] == "tenant"]
    check(any("Tried apartment 204" in e["detail"] and "651-555-9999" in e["detail"] and e["actor_label"] == "maria@example.com"
              for e in failed_rows), "failed resident sign-ins show the email, phone and apartment tried", failed_rows[:2])
    ok_rows = [e for e in j["activity"] if e["event"] == "sign_in" and e["actor_kind"] == "tenant"]
    check(any("maria@example.com" in e["detail"] and "651-555-0101" in e["detail"] for e in ok_rows), "resident sign-ins record email and phone", ok_rows[:2])
    dump = json.dumps(sql("SELECT * FROM activity_log") + sql("SELECT * FROM email_log") + sql("SELECT * FROM staff")
                      + sql("SELECT * FROM tenants"))
    check(not any(p in dump for p in ("a brand new password", "my own password 9", "reset by manager 3", "temporary pass 1",
                                      "nora-chosen-pass", "nora-second-pass", "my-own-pass-307")),
          "no staff or resident password appears in any table")

    # ------------------------------------------------------------ odds and ends
    s, j = m.post("/staff/workorders", b"{not json")
    check(s == 400, "malformed JSON is a clean 400", j)
    s, j = m.post("/staff/workorders", b"[1,2,3]")
    check(s == 400, "a JSON array is a clean 400", j)
    s, j = m.post("/staff/workorders/%d/notes" % r3, {"body": "x" * 70000})
    check(s == 413, "an oversized body is refused", j)
    check(len(sql("SELECT id FROM work_orders")) > 10, "work_orders survived the hostile text")
    print("  (%.0f s)" % (time.time() - t0))


if __name__ == "__main__":
    main()
