"""The Wilson — flat 2D leasing plan, drawn from the hand sketch (IMG_8238).

Sketch reading, north (window wall) at the top:
  · living room down the left, wrapping along the bottom to the entry door
  · kitchen in the middle with the dining area at its north end, under a window
  · a partial wall between living room and kitchen — semi-open, per the photos
  · hallway across the middle, walk-in closet and bath opening off its south side
  · bedroom the full depth of the right-hand side, with its own wide shallow closet
  · balcony projecting north off the living room
33' x 24' = 792 sf.
"""
import math

SC = 11.0                      # px per foot
W, D = 33.0, 24.0
MX, MY = 26.0, 87.0            # unit origin in px (room above for the balcony)
VW, VH = 424.0, 391.0

def X(x): return MX + x * SC
def Y(y): return MY + y * SC

out = []
def add(s): out.append(s)

# ---------------------------------------------------------------- rooms
# name, [rects], label pos, printed dimension, area, hard floor?, label size
ROOMS = [
    ("Living Room", [(0, 0, 12, 15), (0, 15, 6, 24)], (6.0, 3.2), "12&prime; &times; 15&prime;", 234, False, 8.6),
    ("Dining Area", [(12, 0, 22, 6)],                 (17.0, 1.2), "10&prime; &times; 6&prime;",  60, True, 7.2),
    ("Kitchen",     [(12, 6, 22, 15)],                (17.0, 10.2), "10&prime; &times; 9&prime;",  90, True, 8.6),
    ("Hall",        [(6, 15, 22, 18)],                (13.6, 17.0), "16&prime; &times; 3&prime;",  48, False, 7.4),
    ("Walk-in Closet", [(6, 18, 15, 24)],             (11.0, 21.5), "9&prime; &times; 6&prime;",   54, False, 6.6),
    ("Bath",        [(15, 18, 23.5, 24)],             (19.3, 19.7), "8&prime;6&Prime; &times; 6&prime;", 51, True, 8.0),
    ("Bedroom",     [(22, 0, 33, 18), (23.5, 18, 33, 21.5)], (26.6, 15.0), "11&prime; &times; 18&prime;", 231, False, 8.6),
    ("Closet",      [(23.5, 21.5, 33, 24)],           (28.3, 22.6), "9&prime;6&Prime; &times; 2&prime;6&Prime;", 24, False, 6.8),
]
NO_PRINTED_DIM = {"Hall", "Closet", "Dining Area"}   # too shallow to print a dimension in

for name, rects, _lab, dim, area, wet, _fs in ROOMS:
    slug = name.lower().replace(" ", "-")
    for i, (x0, y0, x1, y1) in enumerate(rects):
        rid = f'rm-{slug}' + (f'-{i+1}' if i else '')
        add(f'<rect class="rm{" wet" if wet else ""}" x="{X(x0):.1f}" y="{Y(y0):.1f}" '
            f'width="{(x1-x0)*SC:.1f}" height="{(y1-y0)*SC:.1f}" '
            f'data-room="{name}" data-dim="{dim}" data-area="{area} sq ft" id="{rid}"/>')

# ---------------------------------------------------------------- fixtures
def fx(x0, y0, x1, y1, extra=""):
    add(f'<rect class="fx" x="{X(x0):.1f}" y="{Y(y0):.1f}" '
        f'width="{(x1-x0)*SC:.1f}" height="{(y1-y0)*SC:.1f}"{extra}/>')

def fline(x0, y0, x1, y1, extra=""):
    add(f'<line class="fx" x1="{X(x0):.1f}" y1="{Y(y0):.1f}" x2="{X(x1):.1f}" y2="{Y(y1):.1f}"{extra}/>')

def circ(cx, cy, r, extra=""):
    add(f'<circle class="fx" cx="{X(cx):.1f}" cy="{Y(cy):.1f}" r="{r*SC:.1f}"{extra}/>')

# --- galley kitchen: counters on both long walls, opening north to the dining area
fx(12, 6.2, 14, 11.5)                                    # west run, stops at the living-room opening
fx(20, 6.2, 22, 14.8)                                    # east run
fx(12.15, 8.0, 13.85, 10.4)                              # range
for cx, cy in ((12.6, 8.6), (13.4, 8.6), (12.6, 9.8), (13.4, 9.8)):
    circ(cx, cy, 0.27)
fx(20.1, 12.3, 21.9, 14.65)                              # refrigerator
fline(20.1, 12.9, 21.9, 12.9)
fx(20.2, 8.5, 21.8, 10.9)                                # double sink
fline(20.2, 9.7, 21.8, 9.7)
circ(21.0, 8.15, 0.22)

# --- bath
fx(17.6, 21.7, 23.3, 23.8, ' rx="3"')                    # tub
fx(18.0, 22.0, 22.9, 23.5, ' rx="2"')
circ(18.35, 22.75, 0.22)
fx(15.2, 18.3, 16.8, 21.3)                               # vanity
circ(16.0, 19.8, 0.52)
fx(21.85, 18.25, 23.15, 18.9)                            # wc tank
add(f'<ellipse class="fx" cx="{X(22.5):.1f}" cy="{Y(19.55):.1f}" '
    f'rx="{0.55*SC:.1f}" ry="{0.72*SC:.1f}"/>')

# --- closet shelving, hanging rail dashed
def shelf(x0, y0, x1, y1, vert):
    fx(x0, y0, x1, y1)
    if vert:
        m = (x0 + x1) / 2
        fline(m, y0 + 0.15, m, y1 - 0.15, ' stroke-dasharray="2 2"')
    else:
        m = (y0 + y1) / 2
        fline(x0 + 0.15, m, x1 - 0.15, m, ' stroke-dasharray="2 2"')

shelf(6, 18.25, 7.2, 23.75, True)        # walk-in, long wall
shelf(7.2, 22.85, 14.75, 23.78, False)   # walk-in, back wall
shelf(23.75, 23.05, 32.75, 23.78, False) # bedroom closet

# --- living room
fx(0.35, 5.2, 2.6, 10.8)                                 # sofa on the west wall
fx(0.95, 5.6, 2.55, 10.4)
fx(4.2, 6.8, 6.6, 9.2)                                   # coffee table
fx(4.4, 11.5, 6.4, 13.5)                                 # armchair
fx(4.75, 11.8, 6.35, 13.2)
fx(10.5, 6.4, 11.85, 9.6)                                # console on the blank wall
fx(0.4, 11.8, 1.8, 13.2)                                 # side table

# --- dining: round table under the window, a chair to each side
circ(17.0, 3.85, 1.15)
def chair(x0, y0, x1, y1, back):
    """Seat outline with a heavier line along the back edge."""
    fx(x0, y0, x1, y1)
    e = {"n": (x0, y0, x1, y0), "s": (x0, y1, x1, y1),
         "w": (x0, y0, x0, y1), "e": (x1, y0, x1, y1)}[back]
    fline(*e, ' stroke-width="1.5"')

chair(16.45, 1.55, 17.55, 2.55, "n")
chair(16.45, 5.15, 17.55, 5.95, "s")
chair(14.60, 3.30, 15.70, 4.40, "w")
chair(18.30, 3.30, 19.40, 4.40, "e")

# --- bedroom
fx(27.3, 5.9, 32.8, 10.9)                                # bed, head to the east wall
fx(31.5, 6.25, 32.6, 8.25)                               # pillows
fx(31.5, 8.55, 32.6, 10.55)
fline(29.4, 5.9, 29.4, 10.9)                             # turned-down blanket
fx(31.4, 4.3, 32.8, 5.65)                                # nightstands
fx(31.4, 11.15, 32.8, 12.5)
fx(22.2, 2.6, 23.7, 6.8)                                 # dresser
fx(24.4, 1.2, 26.4, 3.2)                                 # reading chair by the window

# ---------------------------------------------------------------- walls
def wall(x0, y0, x1, y1, w):
    add(f'<line class="wall" x1="{X(x0):.1f}" y1="{Y(y0):.1f}" '
        f'x2="{X(x1):.1f}" y2="{Y(y1):.1f}" stroke-width="{w}"/>')

EXT, INT = 3.4, 2.2

# perimeter — gaps are the slider, two windows and the entry door
for a, b in ((0, 3), (8.5, 13.5), (19.5, 24.5), (30.5, 33)):
    wall(a, 0, b, 0, EXT)                                # north exterior
wall(W, 0, W, D, EXT)                                    # east party wall
for a, b in ((0, 1.5), (4.5, W)):
    wall(a, D, b, D, EXT)                                # south corridor wall + entry
wall(0, 0, 0, D, EXT)                                    # west party wall

wall(12, 0, 12, 11.5, INT)                               # blank wall the living room faces
wall(9, 15, 22, 15, INT)                                 # kitchen / hall
wall(6, 18, 6, 24, INT)                                  # living room / walk-in
for a, b in ((6, 8), (11, 17), (19.5, 23.5)):
    wall(a, 18, b, 18, INT)                              # hall wall + closet and bath doors
wall(15, 18, 15, 24, INT)                                # walk-in / bath
wall(23.5, 18, 23.5, 24, INT)                            # bath / bedroom
for a, b in ((0, 15.3), (17.8, 18)):
    wall(22, a, 22, b, INT)                              # bedroom wall + bedroom door
for a, b in ((23.5, 25), (31.5, 33)):
    wall(a, 21.5, b, 21.5, INT)                          # bedroom closet

# ---------------------------------------------------------------- openings
def window(a, b, fixed):
    for off in (-0.16, 0.16):
        add(f'<line class="glz" x1="{X(a):.1f}" y1="{Y(fixed+off):.1f}" '
            f'x2="{X(b):.1f}" y2="{Y(fixed+off):.1f}"/>')

window(13.5, 19.5, 0)                                    # dining-area window
window(24.5, 30.5, 0)                                    # bedroom window

# sliding glass door to the balcony — two overlapping leaves
add(f'<line class="glz" x1="{X(3):.1f}" y1="{Y(-0.2):.1f}" x2="{X(6.2):.1f}" y2="{Y(-0.2):.1f}"/>')
add(f'<line class="glz" x1="{X(5.3):.1f}" y1="{Y(0.2):.1f}" x2="{X(8.5):.1f}" y2="{Y(0.2):.1f}"/>')

def door(hx, hy, ex, ey, ix, iy):
    """Leaf and swing arc: hinged at (hx,hy), opening to (ex,ey), swinging toward (ix,iy)."""
    vx, vy = ex - hx, ey - hy
    L = math.hypot(vx, vy)
    for px, py in ((-vy, vx), (vy, -vx)):
        if px * (ix - hx) + py * (iy - hy) > 0:
            lx, ly = hx + px, hy + py
            break
    sweep = 1 if vx * (ly - hy) - vy * (lx - hx) > 0 else 0
    add(f'<path class="swing" d="M {X(ex):.1f} {Y(ey):.1f} '
        f'A {L*SC:.1f} {L*SC:.1f} 0 0 {sweep} {X(lx):.1f} {Y(ly):.1f}"/>')
    add(f'<line class="leaf" x1="{X(hx):.1f}" y1="{Y(hy):.1f}" x2="{X(lx):.1f}" y2="{Y(ly):.1f}"/>')

door(1.5, 24, 4.5, 24, 3.0, 21.0)          # entry, into the living room
door(8.0, 18, 11.0, 18, 9.5, 21.0)         # walk-in closet
door(19.5, 18, 17.0, 18, 18.2, 21.0)       # bath
door(22, 17.8, 22, 15.3, 25.0, 16.5)       # bedroom, off the hall

# bedroom closet — bypass sliding doors
add(f'<line class="leaf" x1="{X(25):.1f}" y1="{Y(21.32):.1f}" x2="{X(28.5):.1f}" y2="{Y(21.32):.1f}"/>')
add(f'<line class="leaf" x1="{X(28.0):.1f}" y1="{Y(21.68):.1f}" x2="{X(31.5):.1f}" y2="{Y(21.68):.1f}"/>')

# ---------------------------------------------------------------- balcony
BX0, BX1, BY = 3.0, 11.0, -5.5
add(f'<rect class="bal" x="{X(BX0):.1f}" y="{Y(BY):.1f}" '
    f'width="{(BX1-BX0)*SC:.1f}" height="{-BY*SC:.1f}"/>')
add(f'<text class="lbl bal-t" x="{X(7.0):.1f}" y="{Y(-4.4):.1f}" '
    f'font-size="7.8" letter-spacing="1.5">BALCONY</text>')
add(f'<text class="lbl bal-t dm" x="{X(7.0):.1f}" y="{Y(-3.2):.1f}" '
    f'font-size="6.0" letter-spacing="0.9">8&prime; &times; 5&prime;6&Prime;</text>')
circ(7.0, -1.6, 0.9)                                     # bistro table
fx(4.9, -2.2, 6.1, -1.0)                                 # chairs
fx(7.9, -2.2, 9.1, -1.0)

# ---------------------------------------------------------------- labels
for name, _r, (lx, ly), dim, _a, _w, fs in ROOMS:
    add(f'<text class="lbl" x="{X(lx):.1f}" y="{Y(ly):.1f}" '
        f'font-size="{fs}" letter-spacing="{1.5 if fs >= 8 else 0.7}">{name.upper()}</text>')
    if name not in NO_PRINTED_DIM:
        drop = 1.2 if name == "Walk-in Closet" else 1.55
        add(f'<text class="lbl dm" x="{X(lx):.1f}" y="{Y(ly + drop):.1f}" '
            f'font-size="6.0" letter-spacing="0.8">{dim}</text>')

add(f'<text class="lbl" x="{X(3.0):.1f}" y="{Y(20.2):.1f}" '
    f'font-size="6.2" letter-spacing="1.1">ENTRY</text>')

# ---------------------------------------------------------------- dimensions
def dimline(x0, y0, x1, y1, label, rot=0):
    add(f'<g class="dim"><line x1="{X(x0):.1f}" y1="{Y(y0):.1f}" x2="{X(x1):.1f}" y2="{Y(y1):.1f}"/>')
    if y0 == y1:
        for px in (x0, x1):
            add(f'<line x1="{X(px):.1f}" y1="{Y(y0)-3:.1f}" x2="{X(px):.1f}" y2="{Y(y0)+3:.1f}"/>')
    else:
        for py in (y0, y1):
            add(f'<line x1="{X(x0)-3:.1f}" y1="{Y(py):.1f}" x2="{X(x0)+3:.1f}" y2="{Y(py):.1f}"/>')
    mx, my = X((x0 + x1) / 2), Y((y0 + y1) / 2)
    tr = f' transform="rotate({rot} {mx:.1f} {my:.1f})"' if rot else ''
    add(f'<text x="{mx:.1f}" y="{my - 4:.1f}" font-size="6.6" letter-spacing="1.2"{tr}>{label}</text></g>')

dimline(0, 26.2, W, 26.2, "33&prime; &ndash; 0&Prime;")
dimline(35.1, 0, 35.1, D, "24&prime; &ndash; 0&Prime;", rot=-90)

svg = (f'<svg class="plan" viewBox="0 0 {VW:.0f} {VH:.0f}" xmlns="http://www.w3.org/2000/svg" '
       f'role="img" aria-label="Floor plan of The Wilson, a one bedroom apartment of about 800 square feet">\n'
       + "\n".join(out) + "\n</svg>")

open("/Users/andrewkeacher/Desktop/Ridgewood Claude/tools/wilson2d.svg", "w").write(svg)
tot = sum((x1 - x0) * (y1 - y0) for _n, rs, *_ in ROOMS for x0, y0, x1, y1 in rs)
print(f"rooms={len(ROOMS)} tiled={tot:.0f} sf footprint={W*D:.0f} svg={len(svg)}B")
