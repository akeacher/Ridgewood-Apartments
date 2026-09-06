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

    print(f"{name}: {len(arcs)} doors, {len(rects)} fixtures", end="  ")
    if not hits:
        print("-> no collisions")
        return True
    print(f"-> {len(hits)} COLLISION(S)")
    for hx, hy, x0, y0, x1_, y1_, o in hits:
        print(f"    door hinged at ({hx}, {hy}) sweeps into the fixture at "
              f"({x0}, {y0})-({x1_}, {y1_}) by {o} ft")
    return False


ok = all([check(n, f) for n, f in PLANS.items()])
sys.exit(0 if ok else 1)
