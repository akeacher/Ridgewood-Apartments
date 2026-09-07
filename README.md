# Ridgewood Apartments

Marketing website for Ridgewood Apartments, 1871 & 1885 Wilson Ave, Saint Paul, MN 55119.
Live at **https://ridgewoodapartments.org**.
Leasing office: 651-578-0498, Monday–Friday 1:00–5:00pm.

## What's in here

| Folder | What it is |
| --- | --- |
| `website/` | **The source pages.** Edit these. Six pages: home, residences, amenities, gallery, neighborhood, questions. |
| `dist/` | **The deployed site.** Generated — never edit by hand. |
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

Hosted on **Cloudflare Pages**, deploying from this repo on every push to `main`.
Build command is empty and the output directory is `dist` — `dist/` is committed,
so what ships is exactly what was tested locally.

Headers live in `dist/_headers`, which the build writes. That format is portable,
so moving hosts needs no repo changes.

**Preview locally before pushing:**

```bash
python3 tools/build_site.py && cd dist && ruby -run -e httpd . -p 8850
```

Then open http://127.0.0.1:8850.

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
