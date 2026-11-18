/* Ridgewood resident portal — the API behind /portal and /portal/staff.

   Runs as the Cloudflare Worker in front of the static site. Anything under
   /api/portal/ is handled here against the D1 database bound as DB; every
   other request falls straight through to the static assets, so the marketing
   site behaves exactly as it did before this file existed.

   No dependencies and no build step: Web Crypto for hashing, D1 for storage.
   The tables are created on first use, so there are no migrations to run. */

const TENANT_SESSION_HOURS = 24 * 7;
const STAFF_SESSION_HOURS = 12;
const LOCK_WINDOW_MIN = 15;        // failed sign-ins are counted over this window
const LOCK_MAX_FAILS = 10;         // per email address; per-IP allows 4x for shared wifi
const LOCK_DAY_FAILS = 30;         // per email address in 24 hours, then the office has to unlock it
const MAX_REQUESTS_PER_DAY = 10;   // per resident
const PBKDF2_ITERATIONS = 100000;  // the most Workers' Web Crypto will accept
const MIN_STAFF_PASSWORD = 10;
const MIN_RESIDENT_PASSWORD = 8;
const MAX_SIGNUPS_PER_HOUR = 5;    // new accounts from one connection
const MAX_PENDING_SIGNUPS = 50;    // accounts waiting for approval at once
// who may create a resident account: 'approval' = residents, once staff confirm them;
// 'open' = residents, straight away; 'off' = only staff
const SIGNUP_MODES = ['approval', 'open', 'off'];

const CATEGORIES = ['Plumbing', 'Heating & cooling', 'Electrical', 'Appliance',
  'Doors, locks & windows', 'Walls, floors & ceilings', 'Pest control',
  'Laundry room', 'Common areas & grounds', 'Other'];
const URGENCIES = ['routine', 'soon', 'urgent'];
const OPEN_STATUSES = ['new', 'scheduled', 'in_progress', 'on_hold'];
const STATUS_LABEL = { new: 'Received', scheduled: 'Scheduled', in_progress: 'In progress',
  on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' };
const BUILDINGS = ['', '1871', '1885'];
// The floor plans on the main site. Their ids match the data-rw-price slots in the pages.
const PLANS = [
  { id: 'wilson', name: 'The Wilson', beds: '1 bedroom' },
  { id: 'battlecreek', name: 'The Battle Creek', beds: '2 bedrooms' },
  { id: 'wakefield', name: 'The Wakefield', beds: '3 bedrooms' },
];
const MAX_RENT = 20000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tenants (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     unit TEXT NOT NULL, unit_key TEXT NOT NULL, building TEXT NOT NULL DEFAULT '',
     name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, phone_key TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tenants_login ON tenants (email, phone_key, unit_key)`,
  `CREATE TABLE IF NOT EXISTS staff (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'tech', active INTEGER NOT NULL DEFAULT 1,
     must_change INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, last_login_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id INTEGER NOT NULL,
     created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS work_orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id INTEGER, unit TEXT NOT NULL, unit_key TEXT NOT NULL, building TEXT NOT NULL DEFAULT '',
     contact_name TEXT NOT NULL, contact_email TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '',
     category TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', description TEXT NOT NULL,
     urgency TEXT NOT NULL DEFAULT 'routine',
     permission_to_enter INTEGER NOT NULL DEFAULT 0, entry_notes TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'new', assigned_to INTEGER, source TEXT NOT NULL DEFAULT 'tenant',
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
     completed_at TEXT, completed_by INTEGER, completed_by_name TEXT,
     work_done TEXT, resident_message TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_wo_unit ON work_orders (unit_key, building, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_wo_tenant ON work_orders (tenant_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS notes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     work_order_id INTEGER NOT NULL, unit_key TEXT NOT NULL, building TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL, author_kind TEXT NOT NULL, author_id INTEGER, author_name TEXT NOT NULL,
     body TEXT NOT NULL, visible_to_tenant INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_wo ON notes (work_order_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_unit ON notes (unit_key, building, kind, created_at)`,
  `CREATE TABLE IF NOT EXISTS email_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at TEXT NOT NULL, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
     kind TEXT NOT NULL, work_order_id INTEGER, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS activity_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id INTEGER, actor_label TEXT NOT NULL DEFAULT '',
     event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log (at)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL, kind TEXT NOT NULL, ident TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', ok INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts (kind, at)`,
  `CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/* ------------------------------------------------------------------ basics */

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}

function json(data, status, cookies) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  for (const ck of cookies || []) headers.append('Set-Cookie', ck);
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

const nowIso = () => new Date().toISOString();
const str = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max || 4000);
const normEmail = (v) => str(v, 200).toLowerCase();
const normPhone = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.slice(0, 15);
};
// "Apt. #204", "unit 204" and "204" are all the same apartment
const normUnit = (v) => String(v || '').trim().toUpperCase()
  .replace(/^(APARTMENT|APT\.?|UNIT|NO\.?|#|\s)+/, '').replace(/[^A-Z0-9]/g, '').slice(0, 12);
// ten-digit numbers are kept in one tidy form, however they were typed
const fmtPhone = (v) => {
  const d = normPhone(v);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : str(v, 30);
};
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const fmtRef = (id) => 'RW-' + String(1000 + Number(id));

/* ---------------------------------------------------------------- database */

const P = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
function stmt(env, sql, params) {
  const s = env.DB.prepare(sql);
  return params.length ? s.bind(...params.map(P)) : s;
}
const all = async (env, sql, ...p) => (await stmt(env, sql, p).all()).results || [];
const one = (env, sql, ...p) => stmt(env, sql, p).first();
const run = async (env, sql, ...p) => (await stmt(env, sql, p).run()).meta || {};

// Changes made after the portal first went live. The tables above stay exactly
// as they were first created; each step here is applied once, in order, so a
// database that is already in use is brought up to date without losing a row.
const MIGRATIONS = [
  // residents choosing their own password and creating their own account
  [2, [
    'ALTER TABLE tenants ADD COLUMN pw_hash TEXT',
    'ALTER TABLE tenants ADD COLUMN pending INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE tenants ADD COLUMN source TEXT NOT NULL DEFAULT 'staff'",
  ]],
  // more ways to reach a resident, and who last changed their contact details
  [3, [
    "ALTER TABLE tenants ADD COLUMN alt_phone TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE tenants ADD COLUMN emergency_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE tenants ADD COLUMN emergency_phone TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE tenants ADD COLUMN contact_updated_at TEXT',
    "ALTER TABLE tenants ADD COLUMN contact_updated_by TEXT NOT NULL DEFAULT ''",
  ]],
];

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  const version = async () => Number(
    ((await env.DB.prepare("SELECT value FROM settings WHERE name = 'schema_version'").first()) || {}).value || 1);
  let at = await version();
  for (const [target, steps] of MIGRATIONS) {
    if (at >= target) continue;
    try {
      // one transaction: either the whole step lands and is recorded, or none of it
      await env.DB.batch(steps.map((sql) => env.DB.prepare(sql)).concat([env.DB.prepare(
        "INSERT INTO settings (name, value) VALUES ('schema_version', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value")
        .bind(String(target))]));
    } catch (e) {
      // two copies of the Worker can start at the same moment; if the other one got there first, carry on
      if (await version() < target) throw e;
    }
    at = target;
  }
  schemaReady = true;
}

async function getSettings(env) {
  const out = {};
  for (const r of await all(env, 'SELECT name, value FROM settings')) out[r.name] = r.value;
  return out;
}

/* ------------------------------------------------------------------ crypto */

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array((h.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}
async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
async function pbkdf2Hex(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return diff === 0;
}
// stored as pbkdf2$<iterations>$<salt>$<hash>, so the cost can be raised later
async function hashPassword(password) {
  const salt = randomHex(16);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2Hex(password, salt, PBKDF2_ITERATIONS)}`;
}
const DUMMY_HASH = 'pbkdf2$' + PBKDF2_ITERATIONS + '$' + '00'.repeat(16) + '$' + '00'.repeat(32);
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!(iterations > 0)) return false;
  return safeEqual(await pbkdf2Hex(password, parts[2], iterations), parts[3]);
}

/* ---------------------------------------------------------------- sessions */

const cookieName = (c, kind) => (c.secure ? '__Host-' : '') + 'rw_' + kind;

function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
function sessionCookie(c, kind, token, hours) {
  return `${cookieName(c, kind)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? hours * 3600 : 0}` +
    (c.secure ? '; Secure' : '');
}
async function createSession(c, kind, userId, hours) {
  const token = randomHex(32);
  await run(c.env, 'INSERT INTO sessions (token_hash, kind, user_id, created_at, expires_at, ip) VALUES (?,?,?,?,?,?)',
    await sha256Hex(token), kind, userId, nowIso(), new Date(Date.now() + hours * 3600e3).toISOString(), c.ip);
  // a sign-in is a convenient moment to sweep out what has expired
  await run(c.env, 'DELETE FROM sessions WHERE expires_at < ?', nowIso());
  await run(c.env, 'DELETE FROM login_attempts WHERE at < ?', new Date(Date.now() - 86400e3).toISOString());
  return token;
}
async function sessionUser(c, kind) {
  const token = readCookie(c.request, cookieName(c, kind));
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  const s = await one(c.env, 'SELECT user_id FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?',
    hash, kind, nowIso());
  if (!s) return null;
  const table = kind === 'tenant' ? 'tenants' : 'staff';
  const user = await one(c.env, `SELECT * FROM ${table} WHERE id = ? AND active = 1`, s.user_id);
  if (!user || (kind === 'tenant' && user.pending)) return null;
  c.tokenHash = hash;
  return user;
}
async function endSession(c, kind) {
  const token = readCookie(c.request, cookieName(c, kind));
  if (/^[0-9a-f]{64}$/.test(token)) {
    await run(c.env, 'DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(token));
  }
  return json({ ok: true }, 200, [sessionCookie(c, kind, '', 0)]);
}

/* ------------------------------------------------ lockout and the audit log */

async function guardAttempts(c, kind, ident) {
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60e3).toISOString();
  const day = new Date(Date.now() - 86400e3).toISOString();
  const n = await one(c.env,
    `SELECT SUM(CASE WHEN ident = ? AND at > ? THEN 1 ELSE 0 END) AS recent,
            SUM(CASE WHEN ident = ? THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN ip = ? AND ip != '' AND at > ? THEN 1 ELSE 0 END) AS from_ip
       FROM login_attempts WHERE kind = ? AND ok = 0 AND at > ?`,
    ident, since, ident, c.ip, since, kind, day) || {};
  if ((n.today || 0) >= LOCK_DAY_FAILS) {
    throw new HttpError(429, 'Sign-in is locked after too many attempts. Please call the leasing office at 651-578-0498.',
      { code: 'locked' });
  }
  if ((n.recent || 0) >= LOCK_MAX_FAILS || (n.from_ip || 0) >= LOCK_MAX_FAILS * 4) {
    throw new HttpError(429, `Too many attempts. Please wait ${LOCK_WINDOW_MIN} minutes and try again, or call the leasing office.`,
      { code: 'locked' });
  }
}
async function recordAttempt(c, kind, ident, ok) {
  if (ok) await run(c.env, 'DELETE FROM login_attempts WHERE kind = ? AND ident = ? AND ok = 0', kind, ident);
  await run(c.env, 'INSERT INTO login_attempts (at, kind, ident, ip, ok) VALUES (?,?,?,?,?)', nowIso(), kind, ident, c.ip, ok);
}
async function logActivity(c, actorKind, actorId, label, event, detail) {
  await run(c.env, 'INSERT INTO activity_log (at, actor_kind, actor_id, actor_label, event, detail, ip) VALUES (?,?,?,?,?,?,?)',
    nowIso(), actorKind, actorId, str(label, 200), event, str(detail, 500), c.ip);
}

/* ------------------------------------------------------------------- email */

// Every message is written to email_log whether or not it could be sent, so the
// office always has a record of what the portal tried to tell people.
async function sendEmail(c, settings, msg) {
  let status = 'not_sent';
  let detail = 'Email delivery is not switched on yet';
  const from = settings.mail_from || '';
  if (!msg.to) {
    detail = msg.missing || 'No address on file';
  } else if (c.env.RESEND_API_KEY && from) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.body }),
      });
      if (r.ok) { status = 'sent'; detail = ''; } else { status = 'failed'; detail = `The email provider answered ${r.status}`; }
    } catch (e) {
      status = 'failed'; detail = 'Could not reach the email provider';
    }
  }
  await run(c.env, 'INSERT INTO email_log (created_at, to_addr, subject, body, kind, work_order_id, status, detail) VALUES (?,?,?,?,?,?,?,?)',
    nowIso(), msg.to || '(not set)', str(msg.subject, 300), str(msg.body, 6000), msg.kind, msg.workOrderId || null, status, detail);
}

function describeOrder(o) {
  return [
    `Reference: ${fmtRef(o.id)}`,
    `Apartment: ${o.unit}${o.building ? ` (${o.building} Wilson Ave)` : ''}`,
    `Resident: ${o.contact_name}`,
    `Phone: ${o.contact_phone || 'not given'}`,
    `Email: ${o.contact_email || 'not given'}`,
    `Category: ${o.category}${o.location ? ` — ${o.location}` : ''}`,
    `Urgency: ${o.urgency}`,
    `Permission to enter: ${o.permission_to_enter ? 'Yes' : 'No — arrange a time first'}`,
    o.entry_notes ? `Entry notes: ${o.entry_notes}` : '',
    '',
    o.description,
  ].filter((l) => l !== '').join('\n');
}

async function emailNewRequest(c, o) {
  const s = await getSettings(c.env);
  await sendEmail(c, s, {
    to: s.office_email || '', missing: 'No office address is set under Settings',
    kind: 'office_new_request', workOrderId: o.id,
    subject: `New maintenance request — Apt ${o.unit} (${o.category})`,
    body: `${describeOrder(o)}\n\nOpen it: ${c.url.origin}/portal/staff`,
  });
  await sendEmail(c, s, {
    to: o.contact_email, kind: 'resident_received', workOrderId: o.id,
    subject: `We received your maintenance request (${fmtRef(o.id)})`,
    body: `Hello ${o.contact_name},\n\nThe Ridgewood maintenance team has your request and will be in touch.\n\n` +
      `${o.category}${o.location ? ` — ${o.location}` : ''}\n${o.description}\n\n` +
      `You can follow it at ${c.url.origin}/portal\n\nRidgewood Apartments · 651-578-0498`,
  });
}
async function emailResident(c, o, kind, subject, lines) {
  await sendEmail(c, await getSettings(c.env), {
    to: o.contact_email, kind, workOrderId: o.id, subject,
    body: `Hello ${o.contact_name},\n\n${lines}\n\nYou can see the full request at ${c.url.origin}/portal\n\nRidgewood Apartments · 651-578-0498`,
  });
}

/* ----------------------------------------------------------- request intake */

async function readBody(c) {
  const text = await c.request.text();
  if (text.length > 60000) throw new HttpError(413, 'That is more text than the portal can take in one go.');
  try {
    const v = JSON.parse(text || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch (e) { /* fall through */ }
  throw new HttpError(400, 'The portal could not read that request.');
}

function orderFields(b) {
  const category = str(b.category, 60);
  const description = str(b.description, 4000);
  const urgency = str(b.urgency, 20) || 'routine';
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Choose what kind of problem it is.');
  if (description.length < 5) throw new HttpError(400, 'Describe the problem in a sentence or two.');
  if (!URGENCIES.includes(urgency)) throw new HttpError(400, 'Choose how urgent it is.');
  return {
    category, description, urgency,
    location: str(b.location, 120),
    permission: b.permission_to_enter ? 1 : 0,
    entryNotes: str(b.entry_notes, 500),
  };
}

async function insertOrder(c, who, f) {
  const now = nowIso();
  const meta = await run(c.env,
    `INSERT INTO work_orders (tenant_id, unit, unit_key, building, contact_name, contact_email, contact_phone,
       category, location, description, urgency, permission_to_enter, entry_notes, status, source, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?)`,
    who.tenantId, who.unit, normUnit(who.unit), who.building, who.name, who.email, who.phone,
    f.category, f.location, f.description, f.urgency, f.permission, f.entryNotes, who.source, now, now);
  return one(c.env, 'SELECT * FROM work_orders WHERE id = ?', meta.last_row_id);
}

async function addNote(c, o, kind, author, body, visible) {
  await run(c.env,
    `INSERT INTO notes (work_order_id, unit_key, building, kind, author_kind, author_id, author_name, body, visible_to_tenant, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    o.id, o.unit_key, o.building, kind, author.kind, author.id, author.name, str(body, 4000), visible, nowIso());
}

/* --------------------------------------------------------- resident routes */

/* -------------------------------------------- residents' contact details */

// The optional ways to reach a resident. A field that is not sent keeps its
// current value; one sent blank is cleared.
function contactExtras(b, before) {
  const pick = (k, max) => (b[k] === undefined ? String((before && before[k]) || '') : str(b[k], max));
  const alt = pick('alt_phone', 30), ename = pick('emergency_name', 80), ephone = pick('emergency_phone', 30);
  if (alt && normPhone(alt).length < 10) throw new HttpError(400, 'Enter the second phone as a ten-digit number, or leave it blank.');
  if (ephone && normPhone(ephone).length < 10) {
    throw new HttpError(400, "Enter the emergency contact's phone as a ten-digit number, or leave it blank.");
  }
  return { alt_phone: alt ? fmtPhone(alt) : '', emergency_name: ename, emergency_phone: ephone ? fmtPhone(ephone) : '' };
}

const CONTACT_FIELDS = [['email', 'email'], ['phone', 'phone'], ['alt_phone', 'second phone'],
  ['emergency_name', 'emergency contact'], ['emergency_phone', 'emergency phone']];
// "phone: 651-555-0101 → 651-555-0199", one per field that changed
const contactChanges = (before, after) => CONTACT_FIELDS
  .filter(([k]) => String(before[k] || '') !== String(after[k] || ''))
  .map(([k, label]) => `${label}: ${before[k] || '(none)'} → ${after[k] || '(none)'}`);

// Open work orders carry a copy of how to reach the resident; keep it current.
// Finished ones keep the details they were completed under.
async function syncOpenOrders(c, tenantId, t) {
  await run(c.env,
    `UPDATE work_orders SET contact_name = ?, contact_email = ?, contact_phone = ?
      WHERE tenant_id = ? AND status IN ('new','scheduled','in_progress','on_hold')`,
    t.name, t.email, t.phone, tenantId);
}

// Re-entering the current password, before a resident changes how they sign in.
async function checkTenantPassword(c, t, typed) {
  typed = String(typed || '').slice(0, 200);
  await guardAttempts(c, 'tenant_reauth', String(t.id));
  const ok = t.pw_hash ? await verifyPassword(typed, t.pw_hash) : !!typed.trim() && normUnit(typed) === t.unit_key;
  await recordAttempt(c, 'tenant_reauth', String(t.id), ok);
  if (!ok) throw new HttpError(401, 'Your current password is not right.');
}

async function tenantLogin(c) {
  const b = await readBody(c);
  const email = normEmail(b.email), phoneKey = normPhone(b.phone);
  const unitKey = normUnit(b.unit), typed = String(b.password || '').slice(0, 200);
  if (!email || !phoneKey || !unitKey || !typed.trim()) {
    throw new HttpError(400, 'Enter your email, phone number, apartment number and password.');
  }
  await guardAttempts(c, 'tenant', email);
  const t = await one(c.env,
    'SELECT * FROM tenants WHERE active = 1 AND email = ? AND phone_key = ? AND unit_key = ? LIMIT 1', email, phoneKey, unitKey);
  // A resident who has chosen a password signs in with it. One who has not —
  // added by the office and never changed it — uses their apartment number.
  // The hash is checked either way, so every attempt takes the same time.
  const hashOk = await verifyPassword(typed, t && t.pw_hash ? t.pw_hash : DUMMY_HASH);
  const ok = !!t && (t.pw_hash ? hashOk : normUnit(typed) === t.unit_key);
  await recordAttempt(c, 'tenant', email, ok);
  if (!ok) {
    await logActivity(c, 'tenant', null, email, 'sign_in_failed', `Tried apartment ${str(b.unit, 20)} · phone ${str(b.phone, 30)}`);
    throw new HttpError(401, 'Those details do not match our records. Check them and try again, or call the leasing office.');
  }
  if (t.pending) {
    throw new HttpError(403, 'Your account is waiting for the leasing office to confirm it. You will be able to sign in as soon as they have.',
      { code: 'pending' });
  }
  const token = await createSession(c, 'tenant', t.id, TENANT_SESSION_HOURS);
  await logActivity(c, 'tenant', t.id, `${t.name} · Apt ${t.unit}`, 'sign_in', `${t.email} · ${t.phone}`);
  return json({ ok: true }, 200, [sessionCookie(c, 'tenant', token, TENANT_SESSION_HOURS)]);
}

const signupMode = (settings) => (SIGNUP_MODES.includes(settings.signup_mode) ? settings.signup_mode : 'approval');
function checkResidentPassword(pw) {
  pw = String(pw || '');
  if (pw.length < MIN_RESIDENT_PASSWORD) throw new HttpError(400, `Choose a password of at least ${MIN_RESIDENT_PASSWORD} characters.`);
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.');
  return pw;
}

// lets the sign-in page know whether to offer "create an account"
async function signupInfo(c) {
  return json({ mode: signupMode(await getSettings(c.env)) });
}

async function emailSignup(c, settings, t, pending) {
  const where = `Apartment ${t.unit}${t.building ? ` (${t.building} Wilson Ave)` : ''}`;
  await sendEmail(c, settings, {
    to: settings.office_email || '', missing: 'No office address is set under Settings', kind: 'office_new_signup',
    subject: `New resident account — Apt ${t.unit}${pending ? ' (needs approval)' : ''}`,
    body: `${t.name}\n${where}\nPhone: ${t.phone}\nEmail: ${t.email}\n\n` +
      (pending ? 'They cannot sign in until you approve the account.' : 'They can sign in straight away.') +
      `\n\nResidents: ${c.url.origin}/portal/staff`,
  });
  await sendEmail(c, settings, {
    to: t.email, kind: pending ? 'resident_signup' : 'resident_welcome',
    subject: pending ? 'We received your Ridgewood resident account request' : 'Your Ridgewood resident account is ready',
    body: `Hello ${t.name},\n\n` +
      (pending ? 'Thank you for signing up. The leasing office will confirm your account, and you will be able to sign in once they have.'
        : 'Your resident account is ready. You can sign in and send maintenance requests any time.') +
      `\n\n${c.url.origin}/portal\n\nRidgewood Apartments · 651-578-0498`,
  });
}

async function tenantSignup(c) {
  const settings = await getSettings(c.env);
  const mode = signupMode(settings);
  if (mode === 'off') throw new HttpError(403, 'Resident accounts are set up by the leasing office. Please call 651-578-0498.');
  const b = await readBody(c);
  const f = tenantFields(b);
  if (!f.building) throw new HttpError(400, 'Choose your building.');
  const pw = checkResidentPassword(b.password);

  const recent = await one(c.env, "SELECT COUNT(*) AS n FROM login_attempts WHERE kind = 'signup' AND ip = ? AND at > ?",
    c.ip, new Date(Date.now() - 3600e3).toISOString());
  if (recent.n >= MAX_SIGNUPS_PER_HOUR) {
    throw new HttpError(429, 'Too many accounts have been created from this connection. Please try again later, or call the leasing office.');
  }
  if ((await one(c.env, 'SELECT COUNT(*) AS n FROM tenants WHERE pending = 1')).n >= MAX_PENDING_SIGNUPS) {
    throw new HttpError(429, 'We cannot take new sign-ups online right now. Please call the leasing office at 651-578-0498.');
  }
  if (await one(c.env, 'SELECT id FROM tenants WHERE email = ? LIMIT 1', f.email)) {
    throw new HttpError(409, 'There is already an account for that email address. Try signing in, or call the leasing office.');
  }

  const now = nowIso(), pending = mode === 'approval' ? 1 : 0;
  const meta = await run(c.env,
    `INSERT INTO tenants (unit, unit_key, building, name, email, phone, phone_key, active, created_at, updated_at, pw_hash, pending, source)
     VALUES (?,?,?,?,?,?,?,1,?,?,?,?,'self')`,
    f.unit, normUnit(f.unit), f.building, f.name, f.email, f.phone, normPhone(f.phone), now, now, await hashPassword(pw), pending);
  await run(c.env, "INSERT INTO login_attempts (at, kind, ident, ip, ok) VALUES (?, 'signup', ?, ?, 1)", now, f.email, c.ip);
  await logActivity(c, 'tenant', meta.last_row_id, `${f.name} · Apt ${f.unit}`, 'account_created',
    `${f.email} · ${f.phone}${pending ? ' · waiting for approval' : ''}`);
  await emailSignup(c, settings, f, pending);
  if (pending) return json({ ok: true, pending: true });
  const token = await createSession(c, 'tenant', meta.last_row_id, TENANT_SESSION_HOURS);
  return json({ ok: true, pending: false }, 200, [sessionCookie(c, 'tenant', token, TENANT_SESSION_HOURS)]);
}

async function tenantChangePassword(c) {
  const b = await readBody(c);
  const t = c.user, current = String(b.current || '');
  await checkTenantPassword(c, t, current);
  const pw = checkResidentPassword(b.next);
  if (pw === current) throw new HttpError(400, 'Choose a password different from the current one.');
  await run(c.env, 'UPDATE tenants SET pw_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(pw), nowIso(), t.id);
  // every other device signed in as this resident is signed out
  await run(c.env, "DELETE FROM sessions WHERE kind = 'tenant' AND user_id = ? AND token_hash != ?", t.id, c.tokenHash);
  await logActivity(c, 'tenant', t.id, `${t.name} · Apt ${t.unit}`, 'resident_password_changed', '');
  return json({ ok: true });
}

async function tenantUpdateContact(c) {
  const t = c.user;
  const b = await readBody(c);
  await checkTenantPassword(c, t, b.password);
  const email = normEmail(b.email), phone = str(b.phone, 30);
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (normPhone(phone).length < 10) throw new HttpError(400, 'Enter your phone number as a ten-digit number.');
  const next = Object.assign({ email, phone: fmtPhone(phone) }, contactExtras(b, t));
  if (email !== t.email && await one(c.env, 'SELECT id FROM tenants WHERE email = ? AND id != ? LIMIT 1', email, t.id)) {
    throw new HttpError(409, 'That email address is already on another resident account. Please call the leasing office.');
  }
  const changes = contactChanges(t, next);
  if (!changes.length) return json({ ok: true, changed: 0, sign_in_changed: false });

  const now = nowIso();
  await run(c.env,
    `UPDATE tenants SET email = ?, phone = ?, phone_key = ?, alt_phone = ?, emergency_name = ?, emergency_phone = ?,
            contact_updated_at = ?, contact_updated_by = 'resident', updated_at = ? WHERE id = ?`,
    next.email, next.phone, normPhone(next.phone), next.alt_phone, next.emergency_name, next.emergency_phone, now, now, t.id);
  await syncOpenOrders(c, t.id, Object.assign({}, t, next));
  // email and phone are part of signing in, so other devices sign in again with the new ones
  const signInChanged = next.email !== t.email || normPhone(next.phone) !== t.phone_key;
  if (signInChanged) {
    await run(c.env, "DELETE FROM sessions WHERE kind = 'tenant' AND user_id = ? AND token_hash != ?", t.id, c.tokenHash);
  }
  await logActivity(c, 'tenant', t.id, `${t.name} · Apt ${t.unit}`, 'contact_updated', changes.join('; '));

  const settings = await getSettings(c.env);
  await sendEmail(c, settings, {
    to: settings.office_email || '', missing: 'No office address is set under Settings', kind: 'office_contact_update',
    subject: `Contact details updated — Apt ${t.unit}`,
    body: `${t.name} (Apartment ${t.unit}${t.building ? `, ${t.building} Wilson Ave` : ''}) updated their contact details:\n\n` +
      `${changes.join('\n')}\n\nContact sheet: ${c.url.origin}/portal/staff#/contacts`,
  });
  if (next.email !== t.email) {
    // the old address hears about it too, in case the change was not theirs
    await sendEmail(c, settings, {
      to: t.email, kind: 'resident_email_changed', subject: 'The email on your Ridgewood resident account was changed',
      body: `Hello ${t.name},\n\nThe email address on your Ridgewood resident portal account was changed to ${next.email}. ` +
        'From now on, sign in with that address.\n\nIf you did not make this change, call the leasing office at 651-578-0498 right away.' +
        '\n\nRidgewood Apartments',
    });
  }
  return json({ ok: true, changed: changes.length, sign_in_changed: signInChanged });
}

const tenantView = (o, notes) => ({
  id: o.id, ref: fmtRef(o.id), category: o.category, location: o.location, description: o.description,
  urgency: o.urgency, status: o.status, status_label: STATUS_LABEL[o.status] || o.status,
  permission_to_enter: !!o.permission_to_enter, entry_notes: o.entry_notes,
  created_at: o.created_at, updated_at: o.updated_at, completed_at: o.completed_at,
  resident_message: o.resident_message || '',
  open: OPEN_STATUSES.includes(o.status),
  // staff names stay inside the office; residents see who spoke, not which person
  updates: notes.map((n) => ({
    at: n.created_at, body: n.body, from: n.author_kind === 'tenant' ? 'You' : 'Ridgewood maintenance',
  })),
});

async function tenantMe(c) {
  const t = c.user;
  const orders = await all(c.env, 'SELECT * FROM work_orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100', t.id);
  const notes = await all(c.env,
    `SELECT work_order_id, created_at, body, author_kind FROM notes
      WHERE work_order_id IN (SELECT id FROM work_orders WHERE tenant_id = ?)
        AND (visible_to_tenant = 1 OR author_kind = 'tenant') ORDER BY created_at ASC`, t.id);
  return json({
    resident: { name: t.name, unit: t.unit, building: t.building, email: t.email, phone: t.phone,
      alt_phone: t.alt_phone || '', emergency_name: t.emergency_name || '', emergency_phone: t.emergency_phone || '',
      contact_updated_at: t.contact_updated_at || null, has_password: !!t.pw_hash },
    categories: CATEGORIES,
    requests: orders.map((o) => tenantView(o, notes.filter((n) => n.work_order_id === o.id))),
  });
}

async function tenantCreate(c) {
  const t = c.user;
  const f = orderFields(await readBody(c));
  const today = await one(c.env, 'SELECT COUNT(*) AS n FROM work_orders WHERE tenant_id = ? AND created_at > ?',
    t.id, new Date(Date.now() - 86400e3).toISOString());
  if (today.n >= MAX_REQUESTS_PER_DAY) {
    throw new HttpError(429, 'That is a lot of requests for one day. Please call the leasing office at 651-578-0498.');
  }
  const o = await insertOrder(c, { tenantId: t.id, unit: t.unit, building: t.building, name: t.name,
    email: t.email, phone: t.phone, source: 'tenant' }, f);
  await logActivity(c, 'tenant', t.id, `${t.name} · Apt ${t.unit}`, 'request_created', `${fmtRef(o.id)} · ${o.category}`);
  await emailNewRequest(c, o);
  return json({ ok: true, ref: fmtRef(o.id), id: o.id });
}

async function ownOrder(c, id) {
  const o = await one(c.env, 'SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?', id, c.user.id);
  if (!o) throw new HttpError(404, 'We could not find that request.');
  return o;
}
async function tenantAddNote(c, m) {
  const o = await ownOrder(c, m[1]);
  const text = str((await readBody(c)).body, 2000);
  if (text.length < 2) throw new HttpError(400, 'Write a short note first.');
  if (!OPEN_STATUSES.includes(o.status)) throw new HttpError(409, 'That request is closed. Please open a new one.');
  await addNote(c, o, 'tenant', { kind: 'tenant', id: c.user.id, name: c.user.name }, text, 1);
  await run(c.env, 'UPDATE work_orders SET updated_at = ? WHERE id = ?', nowIso(), o.id);
  return json({ ok: true });
}
async function tenantCancel(c, m) {
  const o = await ownOrder(c, m[1]);
  if (!OPEN_STATUSES.includes(o.status)) throw new HttpError(409, 'That request is already closed.');
  await run(c.env, "UPDATE work_orders SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), o.id);
  await addNote(c, o, 'tenant', { kind: 'tenant', id: c.user.id, name: c.user.name }, 'Cancelled by the resident.', 1);
  await logActivity(c, 'tenant', c.user.id, `${c.user.name} · Apt ${c.user.unit}`, 'request_cancelled', fmtRef(o.id));
  return json({ ok: true });
}

/* ------------------------------------------------- staff: sign-in and setup */

const staffView = (s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, active: !!s.active,
  must_change: !!s.must_change, last_login_at: s.last_login_at, created_at: s.created_at });

async function isActivated(env) {
  return (await one(env, 'SELECT COUNT(*) AS n FROM staff')).n > 0;
}
async function checkSetupCode(c, code) {
  if (!c.env.SETUP_CODE_SHA256) throw new HttpError(404, 'Not found');
  const who = c.ip || 'setup';
  await guardAttempts(c, 'setup', who);
  const ok = safeEqual(await sha256Hex(str(code, 200)), String(c.env.SETUP_CODE_SHA256).toLowerCase());
  await recordAttempt(c, 'setup', who, ok);
  if (!ok) throw new HttpError(401, 'That setup code is not right.');
}
function checkNewPassword(pw) {
  pw = String(pw || '');
  if (pw.length < MIN_STAFF_PASSWORD) throw new HttpError(400, `Choose a password of at least ${MIN_STAFF_PASSWORD} characters.`);
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.');
  return pw;
}

async function staffState(c) {
  const me = await sessionUser(c, 'staff');
  return json({
    activated: await isActivated(c.env),
    setup_available: !!c.env.SETUP_CODE_SHA256,
    signed_in: !!me, me: me ? staffView(me) : null,
  });
}

// One-time: creates the first manager. Closed for good once a real account exists.
async function staffSetup(c) {
  if (await isActivated(c.env)) throw new HttpError(409, 'The portal is already set up. Sign in instead.');
  const b = await readBody(c);
  await checkSetupCode(c, b.code);
  const name = str(b.name, 80), email = normEmail(b.email);
  if (name.length < 2) throw new HttpError(400, 'Enter your name.');
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  const pw = checkNewPassword(b.password);
  const meta = await run(c.env,
    "INSERT INTO staff (name, email, pw_hash, role, active, must_change, created_at, last_login_at) VALUES (?,?,?,'manager',1,0,?,?)",
    name, email, await hashPassword(pw), nowIso(), nowIso());
  const token = await createSession(c, 'staff', meta.last_row_id, STAFF_SESSION_HOURS);
  await logActivity(c, 'staff', meta.last_row_id, name, 'portal_set_up', email);
  return json({ ok: true }, 200, [sessionCookie(c, 'staff', token, STAFF_SESSION_HOURS)]);
}

async function staffLogin(c) {
  const b = await readBody(c);
  const email = normEmail(b.email), pw = String(b.password || '');
  if (!email || !pw) throw new HttpError(400, 'Enter your email and password.');
  await guardAttempts(c, 'staff', email);
  const s = await one(c.env, 'SELECT * FROM staff WHERE email = ? AND active = 1', email);
  // an unknown address does the same work as a wrong password, so timing gives nothing away
  const ok = await verifyPassword(pw, s ? s.pw_hash : DUMMY_HASH) && !!s;
  await recordAttempt(c, 'staff', email, ok);
  if (!ok) {
    await logActivity(c, 'staff', null, email, 'sign_in_failed', '');
    throw new HttpError(401, 'That email and password do not match.');
  }
  await run(c.env, 'UPDATE staff SET last_login_at = ? WHERE id = ?', nowIso(), s.id);
  const token = await createSession(c, 'staff', s.id, STAFF_SESSION_HOURS);
  await logActivity(c, 'staff', s.id, s.name, 'sign_in', s.email);
  return json({ ok: true, must_change: !!s.must_change }, 200, [sessionCookie(c, 'staff', token, STAFF_SESSION_HOURS)]);
}

const pendingCount = async (env) => (await one(env, 'SELECT COUNT(*) AS n FROM tenants WHERE pending = 1 AND active = 1')).n;
async function staffMe(c) {
  const team = await all(c.env, 'SELECT id, name FROM staff WHERE active = 1 ORDER BY name');
  return json({ me: staffView(c.user), team, categories: CATEGORIES, buildings: BUILDINGS, status_labels: STATUS_LABEL,
    pending_residents: await pendingCount(c.env) });
}

async function staffChangePassword(c) {
  const b = await readBody(c);
  if (!await verifyPassword(String(b.current || ''), c.user.pw_hash)) throw new HttpError(401, 'Your current password is not right.');
  const pw = checkNewPassword(b.next);
  if (pw === String(b.current)) throw new HttpError(400, 'Choose a password different from the current one.');
  await run(c.env, 'UPDATE staff SET pw_hash = ?, must_change = 0 WHERE id = ?', await hashPassword(pw), c.user.id);
  // every other device signed in as this person is signed out
  await run(c.env, "DELETE FROM sessions WHERE kind = 'staff' AND user_id = ? AND token_hash != ?", c.user.id, c.tokenHash);
  await logActivity(c, 'staff', c.user.id, c.user.name, 'password_changed', '');
  return json({ ok: true });
}

/* ------------------------------------------------------ staff: work orders */

const ORDER_SELECT = `SELECT w.*, s.name AS assigned_name FROM work_orders w LEFT JOIN staff s ON s.id = w.assigned_to`;
const orderView = (o) => Object.assign({}, o, {
  ref: fmtRef(o.id), status_label: STATUS_LABEL[o.status] || o.status,
  permission_to_enter: !!o.permission_to_enter, open: OPEN_STATUSES.includes(o.status),
});

async function staffOrders(c) {
  const view = c.url.searchParams.get('view') || 'open';
  const text = str(c.url.searchParams.get('q'), 80).replace(/[%_]/g, '');
  const where = [], args = [];
  if (view === 'open') where.push("w.status IN ('new','scheduled','in_progress','on_hold')");
  else if (view === 'completed') where.push("w.status = 'completed'");
  else if (view === 'mine') { where.push("w.status IN ('new','scheduled','in_progress','on_hold') AND w.assigned_to = ?"); args.push(c.user.id); }
  if (text) {
    where.push('(w.unit_key LIKE ? OR w.contact_name LIKE ? OR w.description LIKE ? OR w.category LIKE ? OR w.work_done LIKE ?)');
    const like = `%${text}%`;
    args.push(`%${normUnit(text) || text}%`, like, like, like, like);
  }
  const order = view === 'completed' ? 'w.completed_at DESC'
    : view === 'all' ? 'w.created_at DESC'
    : "CASE w.urgency WHEN 'urgent' THEN 0 WHEN 'soon' THEN 1 ELSE 2 END, w.created_at ASC";
  const rows = await all(c.env,
    `${ORDER_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 300`, ...args);
  const counts = {};
  for (const r of await all(c.env, 'SELECT status, COUNT(*) AS n FROM work_orders GROUP BY status')) counts[r.status] = r.n;
  return json({ orders: rows.map(orderView), counts, pending_residents: await pendingCount(c.env) });
}

async function getOrder(c, id) {
  const o = await one(c.env, `${ORDER_SELECT} WHERE w.id = ?`, id);
  if (!o) throw new HttpError(404, 'That work order does not exist.');
  return o;
}

// `building` null means "whichever building" — used by the apartment lookup
async function unitHistory(c, unitKey, building, exceptId) {
  const any = building === null ? 1 : 0;
  const previous = await all(c.env,
    `SELECT id, building, category, location, description, status, created_at, completed_at, completed_by_name, work_done
       FROM work_orders WHERE unit_key = ? AND (? = 1 OR building = ?) AND id != ? ORDER BY created_at DESC LIMIT 40`,
    unitKey, any, building || '', exceptId || 0);
  const handoff = await all(c.env,
    `SELECT id, work_order_id, building, body, author_name, created_at FROM notes
      WHERE unit_key = ? AND (? = 1 OR building = ?) AND kind = 'handoff' ORDER BY created_at DESC, id DESC LIMIT 40`,
    unitKey, any, building || '');
  return {
    previous: previous.map((p) => Object.assign(p, { ref: fmtRef(p.id), status_label: STATUS_LABEL[p.status] || p.status })),
    handoff: handoff.map((n) => Object.assign(n, { ref: fmtRef(n.work_order_id) })),
  };
}

async function staffOrderDetail(c, m) {
  const o = await getOrder(c, m[1]);
  const notes = await all(c.env,
    'SELECT id, kind, author_kind, author_name, body, visible_to_tenant, created_at FROM notes WHERE work_order_id = ? ORDER BY created_at ASC', o.id);
  return json({ order: orderView(o), notes, unit: await unitHistory(c, o.unit_key, o.building, o.id) });
}

async function staffUnit(c) {
  const unitKey = normUnit(c.url.searchParams.get('unit'));
  const asked = c.url.searchParams.get('building');
  const building = asked === null || asked === 'any' ? null : str(asked, 10);
  if (!unitKey) throw new HttpError(400, 'Enter an apartment number.');
  const residents = await all(c.env,
    `SELECT id, name, email, phone, unit, building, active, pending FROM tenants
      WHERE unit_key = ? AND (? = 1 OR building = ?) ORDER BY active DESC, name`,
    unitKey, building === null ? 1 : 0, building || '');
  return json(Object.assign({ unit: unitKey, building: building === null ? 'any' : building, residents },
    await unitHistory(c, unitKey, building, 0)));
}

// For requests that come in by phone or at the office window.
async function staffCreateOrder(c) {
  const b = await readBody(c);
  const f = orderFields(b);
  const unit = str(b.unit, 12), name = str(b.contact_name, 80);
  if (!normUnit(unit)) throw new HttpError(400, 'Enter the apartment number.');
  if (name.length < 2) throw new HttpError(400, "Enter the resident's name.");
  const building = BUILDINGS.includes(str(b.building, 10)) ? str(b.building, 10) : '';
  const email = normEmail(b.contact_email);
  const match = email ? await one(c.env,
    'SELECT id FROM tenants WHERE active = 1 AND email = ? AND unit_key = ? LIMIT 1', email, normUnit(unit)) : null;
  const o = await insertOrder(c, { tenantId: match ? match.id : null, unit, building, name, email,
    phone: fmtPhone(b.contact_phone), source: 'staff' }, f);
  await addNote(c, o, 'status', { kind: 'staff', id: c.user.id, name: c.user.name }, `Logged by ${c.user.name} on the resident's behalf.`, 0);
  await logActivity(c, 'staff', c.user.id, c.user.name, 'order_created', `${fmtRef(o.id)} · Apt ${o.unit}`);
  return json({ ok: true, id: o.id, ref: fmtRef(o.id) });
}

async function staffUpdateOrder(c, m) {
  const o = await getOrder(c, m[1]);
  const b = await readBody(c);
  const author = { kind: 'staff', id: c.user.id, name: c.user.name };
  const sets = [], args = [];
  if (b.status !== undefined && b.status !== o.status) {
    const status = str(b.status, 20);
    if (!STATUS_LABEL[status]) throw new HttpError(400, 'That status does not exist.');
    if (status === 'completed') throw new HttpError(400, 'Use "Complete work order" so the work is written up.');
    sets.push('status = ?'); args.push(status);
    await addNote(c, o, 'status', author, `Status changed to ${STATUS_LABEL[status]}.`, 1);
  }
  if (b.urgency !== undefined && b.urgency !== o.urgency) {
    if (!URGENCIES.includes(b.urgency)) throw new HttpError(400, 'That urgency does not exist.');
    sets.push('urgency = ?'); args.push(b.urgency);
    await addNote(c, o, 'status', author, `Urgency set to ${b.urgency}.`, 0);
  }
  const assignee = b.assigned_to === undefined ? undefined : (Number(b.assigned_to) || null);
  if (assignee !== undefined && assignee !== (o.assigned_to || null)) {
    let who = null;
    if (assignee) {
      who = await one(c.env, 'SELECT id, name FROM staff WHERE id = ? AND active = 1', assignee);
      if (!who) throw new HttpError(400, 'That person is not on the team.');
    }
    sets.push('assigned_to = ?'); args.push(who ? who.id : null);
    await addNote(c, o, 'status', author, who ? `Assigned to ${who.name}.` : 'Unassigned.', 0);
  }
  if (sets.length) {
    await run(c.env, `UPDATE work_orders SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, nowIso(), o.id);
    await logActivity(c, 'staff', c.user.id, c.user.name, 'order_updated', fmtRef(o.id));
  }
  return json({ ok: true });
}

async function staffAddNote(c, m) {
  const o = await getOrder(c, m[1]);
  const b = await readBody(c);
  const text = str(b.body, 4000);
  if (text.length < 2) throw new HttpError(400, 'Write the note first.');
  const author = { kind: 'staff', id: c.user.id, name: c.user.name };
  // 'handoff' notes stay with the apartment and are shown to whoever goes there next
  const kind = b.kind === 'handoff' ? 'handoff' : b.visible_to_tenant ? 'message' : 'note';
  await addNote(c, o, kind, author, text, kind === 'message' ? 1 : 0);
  await run(c.env, 'UPDATE work_orders SET updated_at = ? WHERE id = ?', nowIso(), o.id);
  if (kind === 'message') {
    await emailResident(c, o, 'resident_update', `An update on your maintenance request (${fmtRef(o.id)})`, text);
  }
  return json({ ok: true });
}

async function staffComplete(c, m) {
  const o = await getOrder(c, m[1]);
  if (o.status === 'completed') throw new HttpError(409, 'That work order is already completed.');
  const b = await readBody(c);
  const workDone = str(b.work_done, 4000);
  const handoff = str(b.handoff_note, 4000);
  const message = str(b.resident_message, 2000);
  if (workDone.length < 5) throw new HttpError(400, 'Write up what was done before completing it.');
  const author = { kind: 'staff', id: c.user.id, name: c.user.name };
  const now = nowIso();
  await run(c.env,
    `UPDATE work_orders SET status = 'completed', completed_at = ?, completed_by = ?, completed_by_name = ?,
            work_done = ?, resident_message = ?, updated_at = ? WHERE id = ?`,
    now, c.user.id, c.user.name, workDone, message, now, o.id);
  await addNote(c, o, 'completed', author, workDone, 0);
  if (handoff) await addNote(c, o, 'handoff', author, handoff, 0);
  await addNote(c, o, 'message', author, message || 'This request has been completed.', 1);
  await logActivity(c, 'staff', c.user.id, c.user.name, 'order_completed', `${fmtRef(o.id)} · Apt ${o.unit}`);
  await emailResident(c, o, 'resident_completed', `Your maintenance request is complete (${fmtRef(o.id)})`,
    `Your request has been completed.${message ? `\n\n${message}` : ''}\n\nIf anything is still not right, reply through the portal or call the office.`);
  return json({ ok: true });
}

function csvCell(v) {
  let s = String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;       // spreadsheets would run these as formulas
  return '"' + s.replace(/"/g, '""') + '"';
}
async function staffExport(c) {
  const rows = await all(c.env, `${ORDER_SELECT} ORDER BY w.created_at DESC LIMIT 5000`);
  const head = ['Reference', 'Apartment', 'Building', 'Resident', 'Email', 'Phone', 'Category', 'Location', 'Problem',
    'Urgency', 'Status', 'Opened', 'Completed', 'Completed by', 'Work completed', 'Assigned to'];
  const lines = [head.map(csvCell).join(',')];
  for (const o of rows) {
    lines.push([fmtRef(o.id), o.unit, o.building, o.contact_name, o.contact_email, o.contact_phone, o.category, o.location,
      o.description, o.urgency, STATUS_LABEL[o.status] || o.status, o.created_at, o.completed_at, o.completed_by_name,
      o.work_done, o.assigned_name].map(csvCell).join(','));
  }
  await logActivity(c, 'staff', c.user.id, c.user.name, 'records_exported', `${rows.length} work orders`);
  return new Response(lines.join('\r\n') + '\r\n', { status: 200, headers: new Headers({
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="ridgewood-work-orders-${nowIso().slice(0, 10)}.csv"`,
  }) });
}

/* --------------------------------------------------------- staff: residents */

function tenantFields(b) {
  const unit = str(b.unit, 12), name = str(b.name, 80), email = normEmail(b.email), phone = fmtPhone(b.phone);
  const building = str(b.building, 10);
  if (!normUnit(unit)) throw new HttpError(400, 'Enter the apartment number.');
  if (name.length < 2) throw new HttpError(400, 'Enter a full name.');
  if (!validEmail(email)) throw new HttpError(400, `"${email || 'blank'}" is not a valid email address.`);
  if (normPhone(phone).length < 10) throw new HttpError(400, 'Enter a ten-digit phone number.');
  if (!BUILDINGS.includes(building)) throw new HttpError(400, 'Choose 1871 or 1885 for the building, or leave it blank.');
  return { unit, name, email, phone, building };
}
async function insertTenant(c, f) {
  const dupe = await one(c.env, 'SELECT id FROM tenants WHERE active = 1 AND email = ? AND unit_key = ?', f.email, normUnit(f.unit));
  if (dupe) throw new HttpError(409, `${f.email} is already listed for apartment ${f.unit}.`);
  const now = nowIso();
  await run(c.env,
    'INSERT INTO tenants (unit, unit_key, building, name, email, phone, phone_key, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
    f.unit, normUnit(f.unit), f.building, f.name, f.email, f.phone, normPhone(f.phone), now, now);
}

async function staffTenants(c) {
  const rows = await all(c.env,
    `SELECT id, unit, building, name, email, phone, alt_phone, emergency_name, emergency_phone, contact_updated_at,
            contact_updated_by, active, pending, source, created_at, (pw_hash IS NOT NULL) AS has_password
       FROM tenants ORDER BY pending DESC, active DESC, building, unit_key, name LIMIT 2000`);
  return json({ residents: rows.map((r) => Object.assign(r, { active: !!r.active, pending: !!r.pending, has_password: !!r.has_password })) });
}
async function pendingTenant(c, id) {
  const t = await one(c.env, 'SELECT * FROM tenants WHERE id = ? AND pending = 1', id);
  if (!t) throw new HttpError(404, 'That account is not waiting for approval.');
  return t;
}
async function staffApproveTenant(c, m) {
  const t = await pendingTenant(c, m[1]);
  await run(c.env, 'UPDATE tenants SET pending = 0, updated_at = ? WHERE id = ?', nowIso(), t.id);
  await logActivity(c, 'staff', c.user.id, c.user.name, 'resident_approved', `${t.name} · Apt ${t.unit}`);
  await sendEmail(c, await getSettings(c.env), {
    to: t.email, kind: 'resident_welcome', subject: 'Your Ridgewood resident account is ready',
    body: `Hello ${t.name},\n\nThe leasing office has confirmed your account. You can now sign in and send maintenance requests.\n\n` +
      `${c.url.origin}/portal\n\nRidgewood Apartments · 651-578-0498`,
  });
  return json({ ok: true });
}
// A sign-up that was never approved has no history, so declining simply removes it.
async function staffDeclineTenant(c, m) {
  const t = await pendingTenant(c, m[1]);
  await run(c.env, 'DELETE FROM tenants WHERE id = ? AND pending = 1', t.id);
  await logActivity(c, 'staff', c.user.id, c.user.name, 'resident_declined', `${t.name} · Apt ${t.unit} · ${t.email}`);
  return json({ ok: true });
}
// For a resident who has forgotten theirs: the password goes back to the
// apartment number, and they choose a new one after signing in.
async function staffResetTenantPassword(c, m) {
  const t = await one(c.env, 'SELECT * FROM tenants WHERE id = ?', m[1]);
  if (!t) throw new HttpError(404, 'That resident does not exist.');
  await run(c.env, 'UPDATE tenants SET pw_hash = NULL, updated_at = ? WHERE id = ?', nowIso(), t.id);
  await run(c.env, "DELETE FROM sessions WHERE kind = 'tenant' AND user_id = ?", t.id);
  await run(c.env, "DELETE FROM login_attempts WHERE kind = 'tenant' AND ident = ? AND ok = 0", t.email);
  await logActivity(c, 'staff', c.user.id, c.user.name, 'resident_password_reset', `${t.name} · Apt ${t.unit}`);
  return json({ ok: true });
}
async function staffAddTenant(c) {
  const f = tenantFields(await readBody(c));
  await insertTenant(c, f);
  await logActivity(c, 'staff', c.user.id, c.user.name, 'resident_added', `${f.name} · Apt ${f.unit}`);
  return json({ ok: true });
}
// One resident per line: apartment, name, email, phone, building (optional)
async function staffBulkTenants(c) {
  const lines = str((await readBody(c)).text, 50000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new HttpError(400, 'Paste at least one line.');
  if (lines.length > 300) throw new HttpError(400, 'Add at most 300 residents at a time.');
  const taken = new Set((await all(c.env, 'SELECT email, unit_key FROM tenants WHERE active = 1'))
    .map((r) => `${r.email}|${r.unit_key}`));
  const inserts = [], problems = [], now = nowIso();
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i].split(/\t|,/).map((x) => x.trim());
    try {
      const f = tenantFields({ unit: p[0], name: p[1], email: p[2], phone: p[3], building: p[4] || '' });
      const key = `${f.email}|${normUnit(f.unit)}`;
      if (taken.has(key)) throw new HttpError(409, `${f.email} is already listed for apartment ${f.unit}.`);
      taken.add(key);
      inserts.push(c.env.DB.prepare(
        'INSERT INTO tenants (unit, unit_key, building, name, email, phone, phone_key, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)')
        .bind(f.unit, normUnit(f.unit), f.building, f.name, f.email, f.phone, normPhone(f.phone), now, now));
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      problems.push({ line: i + 1, text: lines[i].slice(0, 120), problem: e.message });
    }
  }
  for (let i = 0; i < inserts.length; i += 50) await c.env.DB.batch(inserts.slice(i, i + 50));
  if (inserts.length) await logActivity(c, 'staff', c.user.id, c.user.name, 'residents_imported', `${inserts.length} added`);
  return json({ ok: true, added: inserts.length, problems });
}
async function staffUnlockTenant(c, m) {
  const t = await one(c.env, 'SELECT * FROM tenants WHERE id = ?', m[1]);
  if (!t) throw new HttpError(404, 'That resident does not exist.');
  await run(c.env, "DELETE FROM login_attempts WHERE kind = 'tenant' AND ident = ? AND ok = 0", t.email);
  await logActivity(c, 'staff', c.user.id, c.user.name, 'resident_unlocked', `${t.name} · Apt ${t.unit}`);
  return json({ ok: true });
}
async function staffEditTenant(c, m) {
  const t = await one(c.env, 'SELECT * FROM tenants WHERE id = ?', m[1]);
  if (!t) throw new HttpError(404, 'That resident does not exist.');
  const b = await readBody(c);
  if (b.active !== undefined && Object.keys(b).length === 1) {
    await run(c.env, 'UPDATE tenants SET active = ?, updated_at = ? WHERE id = ?', !!b.active, nowIso(), t.id);
    if (!b.active) await run(c.env, "DELETE FROM sessions WHERE kind = 'tenant' AND user_id = ?", t.id);
    await logActivity(c, 'staff', c.user.id, c.user.name, b.active ? 'resident_restored' : 'resident_removed', `${t.name} · Apt ${t.unit}`);
    return json({ ok: true });
  }
  const f = tenantFields(Object.assign({ unit: t.unit, name: t.name, email: t.email, phone: t.phone, building: t.building }, b));
  const next = Object.assign({}, f, contactExtras(b, t));
  const changes = contactChanges(t, next);
  const now = nowIso();
  await run(c.env,
    `UPDATE tenants SET unit = ?, unit_key = ?, building = ?, name = ?, email = ?, phone = ?, phone_key = ?,
            alt_phone = ?, emergency_name = ?, emergency_phone = ?, updated_at = ? WHERE id = ?`,
    f.unit, normUnit(f.unit), f.building, f.name, f.email, f.phone, normPhone(f.phone),
    next.alt_phone, next.emergency_name, next.emergency_phone, now, t.id);
  if (changes.length) {
    await run(c.env, 'UPDATE tenants SET contact_updated_at = ?, contact_updated_by = ? WHERE id = ?', now, c.user.name, t.id);
  }
  await syncOpenOrders(c, t.id, next);
  // if how they sign in changed, they sign in again with the new details
  if (normUnit(f.unit) !== t.unit_key || f.email !== t.email || normPhone(f.phone) !== t.phone_key) {
    await run(c.env, "DELETE FROM sessions WHERE kind = 'tenant' AND user_id = ?", t.id);
  }
  await logActivity(c, 'staff', c.user.id, c.user.name, 'resident_edited',
    `${f.name} · Apt ${f.unit}${changes.length ? ' · ' + changes.join('; ') : ''}`);
  return json({ ok: true });
}

// Every resident's contact details, one row each, for a spreadsheet program.
const ACCOUNT_STATE = (r) => (!r.active ? 'Removed' : r.pending ? 'Waiting for approval' : 'Active');
const byUnit = (a, b) => String(a.building).localeCompare(String(b.building))
  || String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true, sensitivity: 'base' })
  || String(a.name).localeCompare(String(b.name));
async function staffContactsExport(c) {
  const rows = (await all(c.env, 'SELECT * FROM tenants LIMIT 5000')).sort(byUnit);
  const head = ['Building', 'Apartment', 'Resident', 'Email', 'Phone', 'Second phone', 'Emergency contact', 'Emergency phone',
    'Account', 'How added', 'Added', 'Contact details last updated', 'Updated by'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r.building, r.unit, r.name, r.email, r.phone, r.alt_phone, r.emergency_name, r.emergency_phone,
      ACCOUNT_STATE(r), r.source === 'self' ? 'Signed up online' : 'Added by the office', (r.created_at || '').slice(0, 10),
      (r.contact_updated_at || '').slice(0, 10), r.contact_updated_by === 'resident' ? 'Resident' : r.contact_updated_by]
      .map(csvCell).join(','));
  }
  await logActivity(c, 'staff', c.user.id, c.user.name, 'contacts_exported', `${rows.length} residents`);
  return new Response(lines.join('\r\n') + '\r\n', { status: 200, headers: new Headers({
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="ridgewood-resident-contacts-${nowIso().slice(0, 10)}.csv"`,
  }) });
}

/* ------------------------------------- staff: team, settings and the logs */

async function staffTeam(c) {
  return json({ team: (await all(c.env, 'SELECT * FROM staff ORDER BY active DESC, name')).map(staffView) });
}
async function staffAddMember(c) {
  const b = await readBody(c);
  const name = str(b.name, 80), email = normEmail(b.email), role = b.role === 'manager' ? 'manager' : 'tech';
  if (name.length < 2) throw new HttpError(400, 'Enter their name.');
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  const pw = checkNewPassword(b.password);
  if (await one(c.env, 'SELECT id FROM staff WHERE email = ?', email)) throw new HttpError(409, 'Someone on the team already uses that email.');
  // they are made to choose their own password the first time they sign in
  await run(c.env, 'INSERT INTO staff (name, email, pw_hash, role, active, must_change, created_at) VALUES (?,?,?,?,1,1,?)',
    name, email, await hashPassword(pw), role, nowIso());
  await logActivity(c, 'staff', c.user.id, c.user.name, 'team_member_added', `${name} (${role})`);
  return json({ ok: true });
}
async function staffEditMember(c, m) {
  const s = await one(c.env, 'SELECT * FROM staff WHERE id = ?', m[1]);
  if (!s) throw new HttpError(404, 'That person is not on the team.');
  const b = await readBody(c);
  const role = b.role === undefined ? s.role : b.role === 'manager' ? 'manager' : 'tech';
  const active = b.active === undefined ? !!s.active : !!b.active;
  if (s.id === c.user.id && (!active || role !== 'manager')) throw new HttpError(400, 'You cannot remove your own manager access.');
  if (b.password !== undefined) {
    await run(c.env, 'UPDATE staff SET pw_hash = ?, must_change = 1 WHERE id = ?', await hashPassword(checkNewPassword(b.password)), s.id);
    await run(c.env, "DELETE FROM sessions WHERE kind = 'staff' AND user_id = ?", s.id);
    await logActivity(c, 'staff', c.user.id, c.user.name, 'team_password_reset', s.name);
  }
  await run(c.env, 'UPDATE staff SET role = ?, active = ? WHERE id = ?', role, active, s.id);
  if (!active) await run(c.env, "DELETE FROM sessions WHERE kind = 'staff' AND user_id = ?", s.id);
  if (role !== s.role || active !== !!s.active) {
    await logActivity(c, 'staff', c.user.id, c.user.name, 'team_member_changed', `${s.name}: ${role}, ${active ? 'active' : 'removed'}`);
  }
  return json({ ok: true });
}

async function staffGetSettings(c) {
  const s = await getSettings(c.env);
  return json({ office_email: s.office_email || '', mail_from: s.mail_from || '', signup_mode: signupMode(s),
    delivery_on: !!(c.env.RESEND_API_KEY && s.mail_from), provider_key_set: !!c.env.RESEND_API_KEY });
}
// Only the settings that are sent are changed, so each form on the page saves its own.
async function staffSaveSettings(c) {
  const b = await readBody(c);
  const changes = [];
  if (b.office_email !== undefined) {
    const office = normEmail(b.office_email);
    if (office && !validEmail(office)) throw new HttpError(400, 'The office address is not a valid email.');
    changes.push(['office_email', office]);
  }
  if (b.mail_from !== undefined) changes.push(['mail_from', str(b.mail_from, 200)]);
  if (b.signup_mode !== undefined) {
    if (!SIGNUP_MODES.includes(b.signup_mode)) throw new HttpError(400, 'Choose how resident accounts are created.');
    changes.push(['signup_mode', b.signup_mode]);
  }
  for (const [name, value] of changes) {
    await run(c.env, 'INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', name, value);
  }
  await logActivity(c, 'staff', c.user.id, c.user.name, 'settings_changed', changes.map((x) => x[0]).join(', '));
  return json({ ok: true });
}
/* ------------------------------- rents and availability on the main site */

// Kept as one small JSON value in settings. A plan with no rent, no note and no
// availability chosen shows nothing on the site, which is how every plan starts.
const money = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// true = available, false = unavailable, null = not shown on the site
const availability = (v) => (v === true || v === false ? v : null);
function readPricing(settings) {
  let saved = {};
  try { saved = JSON.parse(settings.pricing || '{}') || {}; } catch (e) { saved = {}; }
  const plans = {};
  for (const p of PLANS) {
    const v = (saved.plans && saved.plans[p.id]) || {};
    const rent = Number.isInteger(v.rent) && v.rent > 0 && v.rent <= MAX_RENT ? v.rent : null;
    plans[p.id] = { name: p.name, beds: p.beds, rent, from: rent ? !!v.from : false, note: str(v.note, 80),
      available: availability(v.available) };
  }
  return { plans, updated_at: saved.updated_at || null, updated_by: saved.updated_by || null };
}
const describePrice = (v) => (v.rent ? (v.from ? 'from ' : '') + money(v.rent) : 'no price') + (v.note ? ` (${v.note})` : '');
const describeAvailability = (a) => (a === true ? 'available' : a === false ? 'unavailable' : 'not shown');

// Public: the main site reads this to fill in its price and availability slots.
async function publicPricing(c) {
  const pricing = readPricing(await getSettings(c.env));
  const plans = {};
  for (const p of PLANS) {
    const v = pricing.plans[p.id];
    plans[p.id] = { rent: v.rent, from: v.from, note: v.note, available: v.available };
  }
  return json({ plans, updated_at: pricing.updated_at });
}
async function staffGetPricing(c) {
  return json(readPricing(await getSettings(c.env)));
}
// Only what is sent changes: the availability toggle sends just { available },
// the rent form just the rent, note and "from".
async function staffSavePricing(c) {
  const b = await readBody(c);
  const sent = b.plans && typeof b.plans === 'object' ? b.plans : {};
  const before = readPricing(await getSettings(c.env));
  const plans = {}, changes = [];
  for (const p of PLANS) {
    const was = before.plans[p.id];
    const v = sent[p.id] && typeof sent[p.id] === 'object' ? sent[p.id] : {};
    let rent = was.rent;
    if (v.rent !== undefined) {
      // "$1,150", "1150" and 1150 are all the same rent; blank means do not show one
      const typed = String(v.rent === null ? '' : v.rent).replace(/[$,\s]/g, '');
      rent = null;
      if (typed !== '') {
        if (!/^\d+$/.test(typed) || Number(typed) < 1 || Number(typed) > MAX_RENT) {
          throw new HttpError(400, `Enter the rent for ${p.name} in whole dollars, like 1150, or leave it blank.`);
        }
        rent = Number(typed);
      }
    }
    if (v.available !== undefined && v.available !== null && typeof v.available !== 'boolean') {
      throw new HttpError(400, `Choose available or unavailable for ${p.name}.`);
    }
    const from = v.from !== undefined ? !!v.from : was.from;
    plans[p.id] = { rent, from: rent ? from : false, note: v.note !== undefined ? str(v.note, 80) : was.note,
      available: v.available !== undefined ? availability(v.available) : was.available };
    if (was.rent !== rent || was.from !== plans[p.id].from || was.note !== plans[p.id].note) {
      changes.push(`${p.name}: ${describePrice(was)} → ${describePrice(plans[p.id])}`);
    }
    if (was.available !== plans[p.id].available) {
      changes.push(`${p.name} availability: ${describeAvailability(was.available)} → ${describeAvailability(plans[p.id].available)}`);
    }
  }
  if (changes.length) {
    const stored = {};
    for (const p of PLANS) {
      const v = plans[p.id];
      stored[p.id] = { rent: v.rent, from: v.from, note: v.note, available: v.available };
    }
    await run(c.env, 'INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
      'pricing', JSON.stringify({ plans: stored, updated_at: nowIso(), updated_by: c.user.name }));
    await logActivity(c, 'staff', c.user.id, c.user.name, 'pricing_changed', changes.join('; '));
  }
  return json({ ok: true, changed: changes.length });
}

async function staffEmails(c) {
  return json({ emails: await all(c.env,
    'SELECT id, created_at, to_addr, subject, body, kind, work_order_id, status, detail FROM email_log ORDER BY id DESC LIMIT 300') });
}
async function staffActivity(c) {
  return json({ activity: await all(c.env,
    'SELECT id, at, actor_kind, actor_label, event, detail, ip FROM activity_log ORDER BY id DESC LIMIT 400') });
}

/* ------------------------------------------------------------------ router */

async function health(c) {
  return json({ ok: true, db: true, activated: await isActivated(c.env) });
}

// [method, path, handler, who may call it]
const ROUTES = [
  ['GET', /^\/health$/, health],
  ['GET', /^\/pricing$/, publicPricing],
  ['POST', /^\/login$/, tenantLogin],
  ['POST', /^\/logout$/, (c) => endSession(c, 'tenant')],
  ['GET', /^\/signup$/, signupInfo],
  ['POST', /^\/signup$/, tenantSignup],
  ['POST', /^\/password$/, tenantChangePassword, 'tenant'],
  ['POST', /^\/me\/contact$/, tenantUpdateContact, 'tenant'],
  ['GET', /^\/me$/, tenantMe, 'tenant'],
  ['POST', /^\/requests$/, tenantCreate, 'tenant'],
  ['POST', /^\/requests\/(\d+)\/note$/, tenantAddNote, 'tenant'],
  ['POST', /^\/requests\/(\d+)\/cancel$/, tenantCancel, 'tenant'],

  ['GET', /^\/staff\/state$/, staffState],
  ['POST', /^\/staff\/setup$/, staffSetup],
  ['POST', /^\/staff\/login$/, staffLogin],
  ['POST', /^\/staff\/logout$/, (c) => endSession(c, 'staff')],
  ['GET', /^\/staff\/me$/, staffMe, 'staff*'],
  ['POST', /^\/staff\/password$/, staffChangePassword, 'staff*'],
  ['GET', /^\/staff\/workorders$/, staffOrders, 'staff'],
  ['POST', /^\/staff\/workorders$/, staffCreateOrder, 'staff'],
  ['GET', /^\/staff\/workorders\/(\d+)$/, staffOrderDetail, 'staff'],
  ['POST', /^\/staff\/workorders\/(\d+)$/, staffUpdateOrder, 'staff'],
  ['POST', /^\/staff\/workorders\/(\d+)\/notes$/, staffAddNote, 'staff'],
  ['POST', /^\/staff\/workorders\/(\d+)\/complete$/, staffComplete, 'staff'],
  ['GET', /^\/staff\/unit$/, staffUnit, 'staff'],
  ['GET', /^\/staff\/export\.csv$/, staffExport, 'staff'],
  ['GET', /^\/staff\/contacts\.csv$/, staffContactsExport, 'manager'],
  ['GET', /^\/staff\/residents$/, staffTenants, 'staff'],
  ['POST', /^\/staff\/residents$/, staffAddTenant, 'manager'],
  ['POST', /^\/staff\/residents\/bulk$/, staffBulkTenants, 'manager'],
  ['POST', /^\/staff\/residents\/(\d+)$/, staffEditTenant, 'manager'],
  ['POST', /^\/staff\/residents\/(\d+)\/unlock$/, staffUnlockTenant, 'staff'],
  ['POST', /^\/staff\/residents\/(\d+)\/approve$/, staffApproveTenant, 'manager'],
  ['POST', /^\/staff\/residents\/(\d+)\/decline$/, staffDeclineTenant, 'manager'],
  ['POST', /^\/staff\/residents\/(\d+)\/reset-password$/, staffResetTenantPassword, 'manager'],
  ['GET', /^\/staff\/emails$/, staffEmails, 'staff'],
  ['GET', /^\/staff\/activity$/, staffActivity, 'manager'],
  ['GET', /^\/staff\/team$/, staffTeam, 'manager'],
  ['POST', /^\/staff\/team$/, staffAddMember, 'manager'],
  ['POST', /^\/staff\/team\/(\d+)$/, staffEditMember, 'manager'],
  ['GET', /^\/staff\/pricing$/, staffGetPricing, 'staff'],
  ['POST', /^\/staff\/pricing$/, staffSavePricing, 'manager'],
  ['GET', /^\/staff\/settings$/, staffGetSettings, 'manager'],
  ['POST', /^\/staff\/settings$/, staffSaveSettings, 'manager'],
];

async function handleApi(request, env, url) {
  if (!env.DB) return json({ error: 'The portal database is not connected yet.', code: 'no_db' }, 503);
  await ensureSchema(env);
  const c = {
    request, env, url, user: null, tokenHash: '',
    ip: request.headers.get('CF-Connecting-IP') || '',
    secure: url.protocol === 'https:',
  };
  const method = request.method.toUpperCase();
  const path = url.pathname.slice('/api/portal'.length);

  if (method === 'POST') {
    // browsers will not let another site attach this header, which is what stops
    // a page elsewhere from quietly submitting forms as a signed-in person
    if (request.headers.get('X-RW-Portal') !== '1') throw new HttpError(403, 'Request blocked.');
    const origin = request.headers.get('Origin');
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { /* not a URL */ }
      if (host !== url.host) throw new HttpError(403, 'Request blocked.');
    }
  }

  for (const [m, pattern, handler, who] of ROUTES) {
    const match = path.match(pattern);
    if (!match || m !== method) continue;
    if (who === 'tenant') {
      c.user = await sessionUser(c, 'tenant');
      if (!c.user) throw new HttpError(401, 'Please sign in.', { code: 'signed_out' });
    } else if (who) {
      c.user = await sessionUser(c, 'staff');
      if (!c.user) throw new HttpError(401, 'Please sign in.', { code: 'signed_out' });
      if (c.user.must_change && who !== 'staff*') throw new HttpError(403, 'Choose a new password first.', { code: 'must_change' });
      if (who === 'manager' && c.user.role !== 'manager') throw new HttpError(403, 'Only a manager can do that.');
    }
    return handler(c, match);
  }
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/portal' || url.pathname.startsWith('/api/portal/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json(Object.assign({ error: err.message }, err.extra), err.status);
        console.error('portal error', err && err.stack ? err.stack : err);
        return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
