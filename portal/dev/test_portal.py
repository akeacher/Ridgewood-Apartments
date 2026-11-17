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


def raw(method, path, body=None, headers=None):
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    try:
        res = urllib.request.urlopen(req, timeout=180)
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
        for _ in range(50):
            try:
                raw("GET", "/api/portal/health")
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
                                          "email": "maria@example.com", "phone": "651-555-0101"}, "resident sees their own details", me)
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
    check(j == {"office_email": "", "mail_from": "", "delivery_on": False, "provider_key_set": False}, "settings start empty", j)
    check(m.post("/staff/settings", {"office_email": "not an email"})[0] == 400, "office address is validated")
    check(m.post("/staff/settings", {"office_email": "Office@Ridgewood.test", "mail_from": "Ridgewood <portal@ridgewood.test>"})[0] == 200, "save settings")
    dev("mail-mode", {"mode": "ok"})
    check(m.get("/staff/settings")[1]["delivery_on"] is True, "delivery shows as on once a key and from-address exist")
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
    check(s == 200 and kinds == {"office_new_request", "resident_received", "resident_update", "resident_completed"}, "email log lists every kind", kinds)
    check(j["emails"][0]["id"] > j["emails"][-1]["id"], "email log is newest first")

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
               "team_member_added", "team_password_reset", "password_changed", "settings_changed", "records_exported"):
        check(ev in events, "activity log records " + ev)
    failed_rows = [e for e in j["activity"] if e["event"] == "sign_in_failed" and e["actor_kind"] == "tenant"]
    check(any("Tried apartment 204" in e["detail"] and "651-555-9999" in e["detail"] and e["actor_label"] == "maria@example.com"
              for e in failed_rows), "failed resident sign-ins show the email, phone and apartment tried", failed_rows[:2])
    ok_rows = [e for e in j["activity"] if e["event"] == "sign_in" and e["actor_kind"] == "tenant"]
    check(any("maria@example.com" in e["detail"] and "651-555-0101" in e["detail"] for e in ok_rows), "resident sign-ins record email and phone", ok_rows[:2])
    dump = json.dumps(sql("SELECT * FROM activity_log") + sql("SELECT * FROM email_log") + sql("SELECT * FROM staff"))
    check(not any(p in dump for p in ("a brand new password", "my own password 9", "reset by manager 3", "temporary pass 1")),
          "no staff password appears in any table")

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
