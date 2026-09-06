import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createHmac, timingSafeEqual, scryptSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { queries } from './db.js';
import { buildCalendar, validateSlot } from './lib/slots.js';
import { sendRequestReceived, sendNewRequestAlert, sendApproved, sendDeclined, esc } from './lib/mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!SESSION_SECRET || !ADMIN_PASSWORD) {
  console.error('Missing SESSION_SECRET or ADMIN_PASSWORD. Copy .env.example to .env and fill them in.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---------------------------------------------------------------- admin auth

const derive = (pw) => scryptSync(String(pw), SESSION_SECRET, 32);
const ADMIN_KEY = derive(ADMIN_PASSWORD);

function passwordMatches(candidate) {
  const a = derive(candidate);
  return a.length === ADMIN_KEY.length && timingSafeEqual(a, ADMIN_KEY);
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function signSession(expiresAt) {
  const payload = String(expiresAt);
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function sessionValid(cookie) {
  if (typeof cookie !== 'string' || !cookie.includes('.')) return false;
  const [payload, sig] = cookie.split('.');
  const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig || '', 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}

function requireAdmin(req, res, next) {
  if (sessionValid(req.cookies?.rw_admin)) return next();
  res.status(401).json({ error: 'Not signed in.' });
}

// ------------------------------------------------------------- rate limiting

const bookLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later, or call the office.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' }
});

// -------------------------------------------------------------- public pages

app.use(express.static(path.join(__dirname, 'public'), { index: false, extensions: ['html'] }));

app.get('/', (req, res) => res.redirect('/book'));
app.get('/book', (req, res) => res.sendFile(path.join(__dirname, 'public', 'book.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/config', (req, res) => {
  res.json({
    propertyName: process.env.PROPERTY_NAME || 'Ridgewood Apartments',
    address: process.env.PROPERTY_ADDRESS || '',
    phone: process.env.PROPERTY_PHONE || '',
    plans: ['The Wilson — 1 Bed', 'The Battle Creek — 2 Bed', 'The Wakefield — 3 Bed', 'Not sure yet']
  });
});

app.get('/api/slots', (req, res) => {
  res.json(buildCalendar());
});

// ------------------------------------------------------------ create request

const MAX = { name: 120, email: 200, phone: 40, plan: 80, message: 1000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

app.post('/api/tours', bookLimiter, async (req, res) => {
  const body = req.body ?? {};
  const clean = (v, max) => String(v ?? '').trim().slice(0, max);

  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email).toLowerCase();
  const phone = clean(body.phone, MAX.phone);
  const plan = clean(body.plan, MAX.plan);
  const message = clean(body.message, MAX.message);
  const slotStart = clean(body.slot, 40);

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Please enter a phone number we can reach you at.' });
  if (!plan) return res.status(400).json({ error: 'Please choose which floor plan interests you.' });

  if (queries.openRequestsForEmail(email) >= 3) {
    return res.status(429).json({ error: 'You already have several open tour requests. Please call the office instead.' });
  }

  const slot = validateSlot(slotStart);
  if (!slot.ok) return res.status(409).json({ error: slot.error });

  const tour = queries.create({
    name,
    email,
    phone,
    plan,
    message,
    slot_start: slot.start.toISOString(),
    slot_end: slot.end.toISOString()
  });

  // A mail outage should not lose the booking — it is already saved.
  Promise.allSettled([sendRequestReceived(tour), sendNewRequestAlert(tour)]).then((results) => {
    results.filter((r) => r.status === 'rejected').forEach((r) => console.error('Email failed:', r.reason?.message));
  });

  res.status(201).json({
    ok: true,
    tour: { id: tour.id, slot_start: tour.slot_start, slot_end: tour.slot_end, status: tour.status }
  });
});

// ------------------------------------------------------------ prospect cancel

app.get('/cancel/:token', (req, res) => {
  const tour = queries.byToken(String(req.params.token));
  const page = (title, body) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<body style="margin:0;background:#f2eee7;font-family:Helvetica,Arial,sans-serif;color:#2a2e26;">
  <div style="max-width:520px;margin:14vh auto;padding:40px;background:#fbfaf7;border:1px solid #d6cfc1;text-align:center;">
    <h1 style="font-weight:400;font-size:24px;margin:0 0 14px;">${esc(title)}</h1>
    <p style="line-height:1.7;color:#6f7064;margin:0 0 26px;">${body}</p>
    <a href="/book" style="background:#2a2e26;color:#f2eee7;padding:14px 26px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Book a tour</a>
  </div>
</body>`;

  if (!tour) return res.status(404).send(page('Link not found', 'This cancellation link is not valid.'));
  if (tour.status === 'cancelled') return res.send(page('Already cancelled', 'This tour was already cancelled.'));

  const cancelled = queries.cancelByToken(tour.token);
  if (!cancelled) return res.send(page('Nothing to cancel', 'This request is no longer active.'));

  res.send(page('Your tour is cancelled', 'That time slot is open again. You are welcome to book another whenever you like.'));
});

// ---------------------------------------------------------------- admin API

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const password = String(req.body?.password ?? '');
  if (!passwordMatches(password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const expiresAt = Date.now() + SESSION_TTL_MS;
  res.cookie('rw_admin', signSession(expiresAt), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('rw_admin');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ signedIn: sessionValid(req.cookies?.rw_admin) });
});

app.get('/api/admin/tours', requireAdmin, (req, res) => {
  const status = String(req.query.status ?? 'pending');
  res.json({ tours: queries.list(status), counts: queries.counts() });
});

app.post('/api/admin/tours/:id/approve', requireAdmin, async (req, res) => {
  const tour = queries.decide(Number(req.params.id), 'approved');
  if (!tour) return res.status(409).json({ error: 'That request was already decided.' });
  try {
    await sendApproved(tour);
  } catch (err) {
    console.error('Approval email failed:', err.message);
    return res.json({ ok: true, tour, warning: 'Approved, but the confirmation email failed to send.' });
  }
  res.json({ ok: true, tour });
});

app.post('/api/admin/tours/:id/decline', requireAdmin, async (req, res) => {
  const note = String(req.body?.note ?? '').trim().slice(0, 500);
  const tour = queries.decide(Number(req.params.id), 'declined', note || null);
  if (!tour) return res.status(409).json({ error: 'That request was already decided.' });
  try {
    await sendDeclined(tour);
  } catch (err) {
    console.error('Decline email failed:', err.message);
    return res.json({ ok: true, tour, warning: 'Declined, but the notification email failed to send.' });
  }
  res.json({ ok: true, tour });
});

// ------------------------------------------------------------------- errors

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

app.listen(PORT, () => {
  console.log(`Ridgewood tours running on http://localhost:${PORT}`);
  console.log(`  Booking page  →  http://localhost:${PORT}/book`);
  console.log(`  Admin console →  http://localhost:${PORT}/admin`);
  if (process.env.MAIL_DRY_RUN === 'true') console.log('  MAIL_DRY_RUN is on — emails print to this console.');
});
