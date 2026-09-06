# Ridgewood Apartments

Marketing website for Ridgewood Apartments, 1871 & 1885 Wilson Ave, Saint Paul, MN 55119.
Leasing office: 651-578-0498, Monday–Friday 1:00–5:00pm.

## What's in here

| Folder | What it is |
| --- | --- |
| `website/` | **The source pages.** Edit these. Four pages: home, gallery, neighborhood, questions. |
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

Publish directory is `dist`. No build command is needed on the host — `dist/` is
committed, so what ships is exactly what was tested locally.

**Netlify:** New site → import from Git → pick this repo → set publish directory
to `dist`, leave build command empty.

**Preview locally before pushing:**

```bash
cd dist && ruby -run -e httpd . -p 8850
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

- The "Schedule a Tour" button points at a placeholder Calendly URL
  (`calendly.com/ridgewood-apartments/property-tour`) that is not a real account.
- `tour-booking-app/` has never been executed — there is no Node on the build machine.
- Five answers on the Q&A page need real policy: pets, smoking, renters insurance,
  application requirements, and garage cost.
