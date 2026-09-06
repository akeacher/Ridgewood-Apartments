"""Turn the artifact-shaped pages into a real static website in dist/.

The pages in website/ are written to be published as Claude artifacts, which
means they are body fragments (the artifact viewer injects <!doctype>, <head>,
charset and viewport) and they carry every photo inline as a base64 data URI
because the artifact sandbox blocks external images.

Neither of those is right for a real host, so this build:
  · wraps each page in a complete HTML document with viewport + meta tags
  · rewrites the cross-page nav from claude.ai artifact URLs to plain filenames
  · pulls every embedded image out to assets/img/ and dedupes them, so a photo
    shared by three pages is downloaded once and cached
Run:  python3 tools/build_site.py
"""
import base64, hashlib, os, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, "website")
DIST = os.path.join(ROOT, "dist")

# Set this to the real domain once it is registered; it is only used for the
# social-preview tags, which need absolute URLs.
SITE_URL = "https://ridgewoodapartmentsmn.com"

# artifact URL -> the file it should be on a real host
ARTIFACT = {
    "b2f40200-1062-428b-bec4-ab3549b61130": "index.html",
    "51fc231b-eeb9-4f97-b7f7-1c1bec0dd45b": "gallery.html",
    "ee0c50c5-a17b-45b3-add7-b46b05ef7733": "neighborhood.html",
    "a3c9b0f3-1421-43f1-ad99-d91b9733cfd8": "questions.html",
}

PAGES = {
    "index.html": ("Ridgewood Apartments | Saint Paul, MN",
        "One, two, and three bedroom apartments on Saint Paul's east side. Heat, water, "
        "trash and sewer included. On-site parking with garages available. Call 651-578-0498."),
    "gallery.html": ("Gallery | Ridgewood Apartments",
        "Photos of Ridgewood Apartments in Saint Paul — the grounds along Wilson Avenue, "
        "the buildings, and the homes inside."),
    "neighborhood.html": ("The Neighborhood | Ridgewood Apartments",
        "What sits around Ridgewood Apartments — Battle Creek Park, shopping, coffee, "
        "college campuses, and drive times to downtown Saint Paul and the airport."),
    "questions.html": ("Questions & Answers | Ridgewood Apartments",
        "Answers to the questions prospective residents ask most about touring, applying, "
        "and living at Ridgewood Apartments."),
}

EXT = {"jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif", "webp": "webp", "svg+xml": "svg"}


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    imgdir = os.path.join(DIST, "assets", "img")
    os.makedirs(imgdir)

    pool = {}          # md5 -> filename, so a shared photo is written once

    def stash(mime, b64):
        h = hashlib.md5(b64.encode()).hexdigest()[:12]
        if h not in pool:
            ext = EXT.get(mime.lower(), "bin")
            name = f"{h}.{ext}"
            try:
                blob = base64.b64decode(b64 + "=" * (-len(b64) % 4))
            except Exception:
                return None
            open(os.path.join(imgdir, name), "wb").write(blob)
            pool[h] = name
        return pool[h]

    data_uri = re.compile(r'data:image/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+?)(?=["\')])')
    report = []

    for page, (title, desc) in PAGES.items():
        raw = open(os.path.join(SRC, page), encoding="utf-8").read()
        before = len(raw)

        # 1. images out to files
        def swap(m):
            name = stash(m.group(1), re.sub(r"\s+", "", m.group(2)))
            return f"assets/img/{name}" if name else m.group(0)
        body = data_uri.sub(swap, raw)

        # 2. nav links back to real filenames
        for aid, target in ARTIFACT.items():
            body = body.replace(f"https://claude.ai/code/artifact/{aid}", target)
        assert "claude.ai/code/artifact" not in body, f"{page}: artifact link left behind"

        # 3. strip any document scaffolding the source already had, so every
        #    page gets exactly one consistent head
        body = re.sub(r"^\s*<!doctype html>\s*", "", body, flags=re.I)
        body = re.sub(r"</?html[^>]*>", "", body, flags=re.I)
        body = re.sub(r"</?body[^>]*>", "", body, flags=re.I)
        inner = re.search(r"<head[^>]*>(.*?)</head>", body, re.S | re.I)
        if inner:
            body = body[:inner.start()] + inner.group(1) + body[inner.end():]
        body = re.sub(r"<title>.*?</title>\s*", "", body, count=1, flags=re.S | re.I)
        body = re.sub(r'<meta\s+charset[^>]*>\s*', "", body, flags=re.I)
        body = re.sub(r'<meta\s+name="viewport"[^>]*>\s*', "", body, flags=re.I)

        head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{SITE_URL}/{'' if page == 'index.html' else page}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ridgewood Apartments">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{SITE_URL}/{'' if page == 'index.html' else page}">
<meta property="og:image" content="{SITE_URL}/assets/img/social.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#2e482b">
<link rel="icon" href="assets/img/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="assets/img/favicon.png">
"""
        out = head + body.lstrip() + "\n</body>\n</html>\n"
        open(os.path.join(DIST, page), "w", encoding="utf-8").write(out)
        report.append((page, before, len(out)))

    # favicon + social preview from the assets we already have
    mark = os.path.join(ROOT, "assets", "logo-mark.png")
    if os.path.isfile(mark):
        shutil.copy(mark, os.path.join(imgdir, "favicon.png"))
    hero = os.path.join(ROOT, "photos", "web", "hero.jpg")
    if os.path.isfile(hero):
        shutil.copy(hero, os.path.join(imgdir, "social.jpg"))

    # tell crawlers where things are
    open(os.path.join(DIST, "robots.txt"), "w").write(
        f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n")
    urls = "".join(
        f"  <url><loc>{SITE_URL}/{'' if p == 'index.html' else p}</loc></url>\n" for p in PAGES)
    open(os.path.join(DIST, "sitemap.xml"), "w").write(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n")

    img_bytes = sum(os.path.getsize(os.path.join(imgdir, f)) for f in os.listdir(imgdir))
    print(f"{'page':<20}{'artifact':>12}{'deployed':>12}")
    for p, b, a in report:
        print(f"{p:<20}{b/1048576:>10.2f}MB{a/1048576:>10.2f}MB")
    print(f"\n{len(pool)} unique images extracted -> dist/assets/img "
          f"({img_bytes/1048576:.2f} MB, cached once and shared by every page)")
    print(f"html total: {sum(a for _, _, a in report)/1048576:.2f} MB "
          f"(was {sum(b for _, b, _ in report)/1048576:.2f} MB)")


if __name__ == "__main__":
    main()
