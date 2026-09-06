# Ridgewood Tours

Tour scheduling for Ridgewood Apartments. Prospects pick a time from a live
calendar; you approve or decline each request from a private dashboard; the app
emails the confirmation with a calendar invitation attached.

```
book  →  request stored as "pending"  →  you approve  →  confirmation email + .ics
                                      ↘  you decline  →  polite email + rebook link
```

## What's here

| File | Purpose |
| --- | --- |
| `server.js` | Express app: routes, admin auth, validation, rate limits |
| `db.js` | SQLite schema and queries |
| `lib/slots.js` | Turns your office hours into bookable slots; re-validates every booking |
| `lib/mailer.js` | The four emails, plus `.ics` generation |
| `public/book.html` · `book.js` | Prospect-facing calendar and form |
| `public/admin.html` · `admin.js` | Your approve/decline dashboard |
| `public/styles.css` | Shared styling, matched to the main site |

## Setup

Requires **Node 20+**.

```bash
npm install
cp .env.example .env
```

Open `.env` and set, at minimum:

- `ADMIN_PASSWORD` — what you type to get into the dashboard
- `SESSION_SECRET` — generate one:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `LEASING_EMAIL` — where new-request alerts go

Then:

```bash
npm start
```

- Booking page — http://localhost:3000/book
- Dashboard — http://localhost:3000/admin

`MAIL_DRY_RUN=true` is on by default, so emails print to your terminal instead
of sending. You can click through the whole flow before touching SMTP.

## Turning on real email

Set `MAIL_DRY_RUN=false` and fill in the SMTP block.

**Gmail** — turn on 2-factor auth, then create an
[App Password](https://myaccount.google.com/apppasswords) and use that as
`SMTP_PASS` (your normal password will not work).

**Better for deliverability** — [Resend](https://resend.com),
[Postmark](https://postmarkapp.com), or Amazon SES. All three give you SMTP
credentials that drop straight into the same variables. Mail sent from a real
domain you've verified is far less likely to land in spam than Gmail relay.

## Tour hours

The calendar is generated from these, so change them here rather than in code:

```
TOUR_DAYS=1,2,3,4,5     # Mon–Fri (0 = Sunday)
TOUR_START=13:00
TOUR_END=17:00
SLOT_MINUTES=30
LEAD_TIME_HOURS=12      # no same-afternoon surprises
BOOKING_WINDOW_DAYS=30
BLACKOUT_DATES=2026-12-25,2026-12-26
```

Defaults match the posted office hours: Monday–Friday, 1–5pm, in 30-minute slots.

**Set `TZ`** to the property's timezone (`America/Chicago`) or slots will be
generated in whatever timezone your server happens to run in.

## Deploying

Any host that runs Node and gives you a persistent disk works. The database is a
single `tours.db` file, so the one requirement is that the disk survives restarts.

- **Render / Railway / Fly.io** — connect the repo, set the env vars, attach a
  small persistent volume, point it at `npm start`.
- **A VPS** — run it behind nginx with `systemd` or `pm2` keeping it alive.

Set `NODE_ENV=production` so the admin session cookie is marked `Secure`, and
put the app behind HTTPS. Back up `tours.db` on a schedule.

## Connecting it to the website

On both site pages, the "Schedule a Tour" buttons currently open a Calendly
modal. To point them here instead, replace the modal trigger with a link:

```html
<a class="btn" href="https://tours.yourdomain.com/book">Schedule a Tour</a>
```

## Notes on how it behaves

- **Double-booking** is prevented server-side. The posted time is re-checked
  against the rules and the database on submit, so a stale browser tab or a
  hand-crafted request cannot take a slot that's gone.
- **Approving twice** does nothing the second time — the update only applies to
  rows still `pending`, so a double-click cannot send two confirmation emails.
- **Cancelled and declined slots free up** and reappear on the calendar.
- **A mail outage never loses a booking.** The request is saved first; email is
  attempted after, and failures are logged rather than thrown at the prospect.
- **Prospect input is escaped** everywhere it's rendered — the dashboard, the
  emails, and the `.ics` file each use the right escaping for their format.
- **Rate limits**: 8 booking attempts per hour per IP, 10 sign-in attempts per
  15 minutes, and a cap of 3 open requests per email address.

## Not built yet

Worth adding if the volume justifies it: SMS reminders, a reschedule link for
prospects, two-way sync with Google Calendar, and a nightly reminder email the
day before a confirmed tour.
