# Ridgewood Apartments

Marketing website for Ridgewood Apartments, 1871 & 1885 Wilson Ave, Saint Paul, MN 55119.
Live at **https://ridgewoodapartments.org**.
Leasing office: 651-578-0498, Monday–Friday 1:00–5:00pm.

## What's in here

| Folder | What it is |
| --- | --- |
| `website/` | **The source pages.** Edit these. Six pages: home, residences, amenities, gallery, neighborhood, questions. |
| `dist/` | **The deployed site.** Generated — never edit by hand. |
| `portal/` | **Resident & staff portal** — maintenance requests and work orders. See below. |
| `wrangler.jsonc` | Tells Cloudflare how to deploy: static files from `dist/`, plus the portal's Worker. |
| `tools/` | Build and drawing scripts (floor plans, the site build). |
| `assets/` | Logo files. |
| `photos/web/` | Web-optimised photos. |
| `tour-booking-app/` | Tour scheduling backend. Written but not yet run — see its own README. |

## Editing the site

1. Change a page in `website/`.
2. Rebuild:

   ```bash
   python3 tools/build_site.py
   ```

3. Commit and push. The host redeploys on its own.

The pages in `website/` are written to double as Claude artifacts, so they carry
their photos inline as base64 and have no `<head>` of their own. The build step
turns them into a normal website: it writes a proper HTML document, adds meta and
social tags, rewrites the cross-page links to plain filenames, and pulls every
image out into `dist/assets/img/` so photos shared between pages download once.
That takes the HTML from about 6.8 MB to 0.23 MB.

## Deploying

Hosted on **Cloudflare Workers** (project `ridgewood-apartments`), deploying from
this repo on every push to `main`. There is no build step on Cloudflare's side:
`dist/` is committed, so what ships is exactly what was tested locally.
`wrangler.jsonc` describes the deploy — static files from `dist/`, and the Worker
in `portal/worker.js` for the portal's API.

Headers live in `dist/_headers`, which the build writes.

**Preview locally before pushing:**

```bash
python3 tools/build_site.py && python3 portal/dev/server.py
```

Then open http://127.0.0.1:8872. That serves the site the way Cloudflare does
and runs the portal too.

## Resident & staff portal

Residents sign in at `/portal/` to request maintenance and follow it. Staff sign
in at `/portal/staff` to work the requests, write up completed work, and leave
notes that stay with an apartment for the next technician.

| Path | What it is |
| --- | --- |
| `portal/worker.js` | The server: everything under `/api/portal/`. One file, no dependencies. |
| `portal/site/` | The two pages and their CSS/JS. The site build copies them to `dist/portal/`. |
| `portal/dev/` | Local test rig — nothing in it is deployed. |
| `portal/SETUP-CODE.txt` | The one-time code for creating the first manager account. **Not in git.** |

**How sign-in works.** A resident enters email, phone number and apartment number,
which must match an entry staff have added under *Residents*; the password is the
apartment number. Because that password is guessable, sign-in locks after 10 wrong
tries in 15 minutes and locks until staff unlock it after 30 in a day, and every
attempt is in the staff *Activity log*. Staff use an email and their own password
(stored only as a salted PBKDF2 hash).

**Data** lives in a Cloudflare D1 database bound as `DB`. The Worker creates its
own tables on first use, so there are no migrations to run.

**Email.** Every notification is written to the *Email log*. They are only
actually sent once a `RESEND_API_KEY` secret is added to the Worker in the
Cloudflare dashboard and a "send from" address is saved under *Settings*.

**Testing.** There is no Node on the build machine, so the rig runs the real
Worker under macOS's built-in JavaScriptCore, with SQLite standing in for D1:

```bash
python3 portal/dev/test_portal.py
```

Run it after any change to `portal/worker.js`.

## Floor plans

The Wilson's plan is generated, not hand-drawn:

```bash
python3 tools/build_wilson2d.py
```

That writes `tools/wilson2d.svg`, which then gets pasted into both plan slots in
`website/index.html`. The Battle Creek and Wakefield plans are still simple
hand-written SVGs inside `index.html`.

## Not in this repo

Kept out deliberately, to stop the repo bloating — they stay on the Desktop:

- `assets/property-video.mp4` (44 MB, not referenced by the site)
- `photos/raw/` and the full-size originals in `photos/` (~71 MB, already
  optimised into `photos/web/` and embedded in the pages)

**Git is not a backup.** Keep those originals in iCloud or Time Machine.

## Still open

- The Wakefield has no measured floor plan yet — it is still the placeholder
  schematic, and its description is unverified copy.
- Two Q&A answers still defer to the leasing office: renters insurance and
  garage cost.
- `tour-booking-app/` has never been executed &mdash; there is no Node on the
  build machine. The site currently books through Calendly instead.
- The portal has no photo uploads, and email delivery is off until an email
  service key is added (see above).
