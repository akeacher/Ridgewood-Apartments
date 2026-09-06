"""Check that no door swing collides with furniture, in any generated plan.

Reads the finished SVGs rather than the build scripts, so it checks what is
actually shipped. A door is a <line class="leaf"> from the hinge to the fully
open position, plus a <path class="swing"> arc; together they define a circular
sector. Anything drawn as <rect class="fx"> inside that sector is something the
door would hit.

Run:  python3 tools/check_swings.py
"""
import math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLANS = {"The Wilson": "wilson2d.svg", "The Battle Creek": "battlecreek2d.svg"}

# must match the build scripts
SC, MX = 11.0, 26.0
MY = {"wilson2d.svg": 87.0, "battlecreek2d.svg": 87.0}


def check(name, fn):
    svg = open(os.path.join(HERE, fn), encoding="utf-8").read()
    my = MY[fn]
    ft = lambda px, py: ((px - MX) / SC, (py - my) / SC)

    leaves = [tuple(map(float, m)) for m in re.findall(
        r'<line class="leaf" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"', svg)]
    rects = [tuple(map(float, m)) for m in re.findall(
        r'<rect class="fx" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"', svg)]
    arcs = [tuple(map(float, m)) for m in re.findall(
        r'<path class="swing" d="M ([-\d.]+) ([-\d.]+) A ([\d.]+) [\d.]+ 0 0 [01] ([-\d.]+) ([-\d.]+)"', svg)]

    hits = []
    for ax, ay, r_px, lex, ley in arcs:
        # the leaf that ends where this arc ends gives us the hinge
        hinge = None
        for x1, y1, x2, y2 in leaves:
            if abs(x2 - lex) < 0.6 and abs(y2 - ley) < 0.6:
                hinge = (x1, y1)
                break
        if hinge is None:
            continue
        hx, hy = hinge
        r = r_px / SC
        hfx, hfy = ft(hx, hy)
        a0 = math.atan2(*reversed([c - h for c, h in zip(ft(ax, ay), (hfx, hfy))]))
        a1 = math.atan2(*reversed([c - h for c, h in zip(ft(lex, ley), (hfx, hfy))]))
        # normalise to the short way round (a door sweeps 90 degrees)
        d = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi

        for rx, ry, rw, rh in rects:
            x0, y0 = ft(rx, ry)
            x1_, y1_ = ft(rx + rw, ry + rh)
            worst = 0.0
            for i in range(21):
                for j in range(21):
                    px = x0 + (x1_ - x0) * i / 20
                    py = y0 + (y1_ - y0) * j / 20
                    dx, dy = px - hfx, py - hfy
                    dist = math.hypot(dx, dy)
                    if dist > r or dist < 0.02:
                        continue
                    ang = math.atan2(dy, dx)
                    t = (ang - a0 + math.pi) % (2 * math.pi) - math.pi
                    if (0 <= t <= d) if d > 0 else (d <= t <= 0):
                        worst = max(worst, r - dist)
            if worst > 0.05:
                hits.append((round(hfx, 1), round(hfy, 1), round(x0, 1), round(y0, 1),
                             round(x1_, 1), round(y1_, 1), round(worst, 2)))

    # ---- window clearance -------------------------------------------------
    # Glazing is drawn as a pair of lines just inside the wall. Anything parked
    # in front of one is blocking the light, which a door-swing check misses.
    CLEAR = 1.2
    glz = [tuple(map(float, m)) for m in re.findall(
        r'<line class="glz" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"', svg)]
    xs = [ft(rx, ry)[0] for rx, ry, _, _ in rects] or [0]
    ys = [ft(rx, ry)[1] for rx, ry, _, _ in rects] or [0]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)

    seen, blocked = set(), []
    for gx1, gy1, gx2, gy2 in glz:
        a = ft(gx1, gy1)
        b = ft(gx2, gy2)
        horiz = abs(a[1] - b[1]) < 0.05
        key = (round(a[0]), round(b[0]), round(a[1]), round(b[1]), horiz)
        if key in seen:
            continue
        seen.add(key)
        if horiz:                                   # window in a wall running along x
            lo, hi, at = min(a[0], b[0]), max(a[0], b[0]), a[1]
            inward = 1 if cy > at else -1
            zone = (lo, min(at, at + inward * CLEAR), hi, max(at, at + inward * CLEAR))
        else:                                       # wall running along y
            lo, hi, at = min(a[1], b[1]), max(a[1], b[1]), a[0]
            inward = 1 if cx > at else -1
            zone = (min(at, at + inward * CLEAR), lo, max(at, at + inward * CLEAR), hi)
        for rx, ry, rw, rh in rects:
            fx0, fy0 = ft(rx, ry)
            fx1, fy1 = ft(rx + rw, ry + rh)
            if fx0 < zone[2] and fx1 > zone[0] and fy0 < zone[3] and fy1 > zone[1]:
                blocked.append((round(lo, 1), round(hi, 1), round(at, 1), horiz,
                                round(fx0, 1), round(fy0, 1), round(fx1, 1), round(fy1, 1)))

    print(f"{name}: {len(arcs)} doors, {len(seen)} windows, {len(rects)} fixtures")
    ok = True
    if hits:
        ok = False
        print(f"  {len(hits)} DOOR COLLISION(S)")
        for hx, hy, x0, y0, x1_, y1_, o in hits:
            print(f"    door hinged at ({hx}, {hy}) sweeps into the fixture at "
                  f"({x0}, {y0})-({x1_}, {y1_}) by {o} ft")
    if blocked:
        ok = False
        print(f"  {len(blocked)} BLOCKED WINDOW(S)  (needs {CLEAR} ft clear)")
        for lo, hi, at, horiz, fx0, fy0, fx1, fy1 in blocked:
            axis = f"y={at}, x {lo}-{hi}" if horiz else f"x={at}, y {lo}-{hi}"
            print(f"    window at {axis} is blocked by the fixture at "
                  f"({fx0}, {fy0})-({fx1}, {fy1})")
    if ok:
        print("  no door collisions, no blocked windows")
    return ok


ok = all([check(n, f) for n, f in PLANS.items()])
sys.exit(0 if ok else 1)
