"""The Battle Creek — flat 2D leasing plan, drawn from the hand sketch
(photos/sketches/battlecreek-sketch.jpeg).

Sketch reading, exterior wall at the top, corridor along the bottom:
  · living room down the left, wrapping along the bottom to the entry door
  · balcony projecting off the living room
  · kitchen in the middle with the dining area at its north end
  · hallway across the middle, serving both bedrooms
  · walk-in closet and the single bath off the hallway's south side
  · bedroom one upper right, bedroom two lower right, each with its own closet
35' x 25' = 875 sf.
"""
import math

SC = 11.0                      # px per foot
W, D = 35.0, 25.0
MX, MY = 26.0, 87.0
VW, VH = 445.0, 402.0

def X(x): return MX + x * SC
def Y(y): return MY + y * SC

out = []
def add(s): out.append(s)

# ---------------------------------------------------------------- rooms
# name, [rects], label pos, printed dimension, area, hard floor?, label size
ROOMS = [
    ("Living Room", [(0, 0, 13, 16.5), (0, 16.5, 3.5, 25)], (6.2, 3.2),
     "13&prime; &times; 16&prime;6&Prime;", 244, False, 8.6),
    ("Dining Area", [(13, 0, 21, 7)], (17.0, 1.6), "8&prime; &times; 7&prime;", 56, True, 7.2),
    ("Kitchen", [(13, 7, 21, 13)], (18.2, 11.0), "8&prime; &times; 6&prime;", 48, True, 8.6),
    ("Bedroom 1", [(21, 0, 35, 13)], (28.6, 10.5), "14&prime; &times; 13&prime;", 182, False, 8.6),
    ("Hall", [(13, 13, 35, 16.5)], (16.5, 15.2), "22&prime; &times; 3&prime;6&Prime;", 77, False, 7.4),
    ("Walk-in Closet", [(3.5, 16.5, 10.5, 25)], (6.9, 18.4),
     "7&prime; &times; 8&prime;6&Prime;", 60, False, 6.2),
    ("Bath", [(10.5, 16.5, 20.5, 25)], (15.6, 19.2), "10&prime; &times; 8&prime;6&Prime;", 85, True, 8.0),
    ("Bedroom 2", [(20.5, 16.5, 35, 25)], (23.8, 20.5),
     "14&prime;6&Prime; &times; 8&prime;6&Prime;", 123, False, 8.0),
]
NO_PRINTED_DIM = {"Hall", "Dining Area"}

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

def chair(x0, y0, x1, y1, back):
    fx(x0, y0, x1, y1)
    e = {"n": (x0, y0, x1, y0), "s": (x0, y1, x1, y1),
         "w": (x0, y0, x0, y1), "e": (x1, y0, x1, y1)}[back]
    fline(*e, ' stroke-width="1.5"')

def shelf(x0, y0, x1, y1, vert):
    fx(x0, y0, x1, y1)
    if vert:
        m = (x0 + x1) / 2
        fline(m, y0 + 0.15, m, y1 - 0.15, ' stroke-dasharray="2 2"')
    else:
        m = (y0 + y1) / 2
        fline(x0 + 0.15, m, x1 - 0.15, m, ' stroke-dasharray="2 2"')

# --- L-shaped kitchen, opening north into the dining area
fx(13, 7.0, 15.2, 12.8)                                  # west run
fx(15.4, 7.0, 20.8, 9.0)                                 # peninsula to the dining area
fx(13.2, 7.4, 15.2, 9.7)                                 # range
for cx, cy in ((13.75, 8.0), (14.65, 8.0), (13.75, 9.1), (14.65, 9.1)):
    circ(cx, cy, 0.3)
fx(13, 10.2, 15.6, 12.8)                                 # refrigerator
fline(13, 10.9, 15.6, 10.9)
fx(17.0, 7.25, 19.4, 8.75)                               # double sink, facing north
fline(18.2, 7.25, 18.2, 8.75)
circ(18.2, 7.1, 0.22)

# --- dining
circ(17.0, 3.9, 1.6)
chair(16.20, 5.65, 17.80, 7.00, "s")
chair(13.60, 3.15, 15.15, 4.65, "w")
chair(18.85, 3.15, 20.40, 4.65, "e")

# --- living room
fx(0.35, 4.8, 3.10, 11.8)                                # sofa on the west wall
fx(1.05, 5.2, 3.05, 11.4)
fx(4.4, 6.5, 6.4, 10.1)                                  # coffee table
fx(4.2, 12.6, 6.8, 15.2)                                 # armchair
fx(4.55, 12.95, 6.75, 14.85)
fx(11.4, 5.8, 12.85, 10.8)                               # console on the kitchen wall
fx(0.4, 12.4, 2.0, 14.0)                                 # side table

# --- bedroom one: bed centred on the left-hand wall, a nightstand each side
fx(21.3, 3.9, 28.0, 8.9)
fx(21.5, 3.9, 23.3, 8.9)                                 # pillows
fline(25.6, 3.9, 25.6, 8.9)                              # turned-down blanket
fx(21.3, 2.1, 22.9, 3.7)                                 # nightstands
fx(21.3, 9.1, 22.9, 10.7)
fx(33.1, 9.9, 34.9, 12.9)                                # chest, under the closet
fx(29.2, 1.5, 31.8, 4.1)                                 # armchair by the window
shelf(32.6, 4.2, 34.9, 9.3, True)                        # closet shelf + rail

# --- bedroom two
fx(26.5, 18.3, 31.5, 25)
fx(26.5, 23.2, 31.5, 24.8)                               # pillows
fline(26.5, 20.8, 31.5, 20.8)
fx(24.8, 23.2, 26.4, 24.8)                               # nightstands
fx(31.6, 23.2, 33.2, 24.8)
shelf(32.6, 17.4, 34.9, 21.0, True)                      # closet shelf + rail

# --- bath
fx(14.6, 22.8, 20.3, 24.85, ' rx="3"')                   # tub
fx(15.0, 23.1, 19.9, 24.55, ' rx="2"')
circ(15.35, 23.85, 0.22)
fx(10.7, 17.2, 12.3, 20.2)                               # vanity
circ(11.5, 18.7, 0.52)
fx(18.95, 17.15, 20.25, 17.8)                            # wc tank
add(f'<ellipse class="fx" cx="{X(19.6):.1f}" cy="{Y(18.45):.1f}" '
    f'rx="{0.55*SC:.1f}" ry="{0.72*SC:.1f}"/>')

# --- walk-in closet shelving
shelf(9.3, 19.6, 10.4, 23.4, True)
shelf(3.7, 23.6, 10.4, 24.8, False)

# ---------------------------------------------------------------- walls
def wall(x0, y0, x1, y1, w):
    add(f'<line class="wall" x1="{X(x0):.1f}" y1="{Y(y0):.1f}" '
        f'x2="{X(x1):.1f}" y2="{Y(y1):.1f}" stroke-width="{w}"/>')

EXT, INT = 3.4, 2.2

# perimeter — slider, two windows on the north wall, one on the east, entry south
for a, b in ((0, 4), (9, 14.5), (19.5, 24), (31, 35)):
    wall(a, 0, b, 0, EXT)
for a, b in ((0, 22), (24.3, 25)):
    wall(W, a, W, b, EXT)                                # east exterior + bedroom 2 window
for a, b in ((0, 0.5), (3.5, W)):
    wall(a, D, b, D, EXT)                                # corridor wall + entry
wall(0, 0, 0, D, EXT)                                    # west party wall

wall(13, 4, 13, 13, INT)                                 # living room / kitchen, open at both ends
wall(21, 0, 21, 13, INT)                                 # kitchen and dining / bedroom one
for a, b in ((21, 22.5), (25.5, 35)):
    wall(a, 13, b, 13, INT)                              # bedroom one wall + its door
for a, b in ((3.5, 12.5), (15.5, 20.5)):
    wall(a, 16.5, b, 16.5, INT)                          # hall wall + bath door
for a, b in ((20.5, 21.5), (24.5, 35)):
    wall(a, 16.5, b, 16.5, INT)                          # bedroom two wall + its door
for a, b in ((16.5, 20.3), (22.3, 25)):
    wall(3.5, a, 3.5, b, INT)                            # living room / walk-in + its door
wall(10.5, 16.5, 10.5, 25, INT)                          # walk-in / bath
wall(20.5, 16.5, 20.5, 25, INT)                          # bath / bedroom two

# closet alcoves
wall(32.5, 4, 35, 4, INT)
wall(32.5, 9.5, 35, 9.5, INT)
wall(32.5, 17.2, 35, 17.2, INT)
wall(32.5, 21.2, 35, 21.2, INT)

# ---------------------------------------------------------------- openings
def window(a, b, fixed, horiz=True):
    for off in (-0.16, 0.16):
        if horiz:
            add(f'<line class="glz" x1="{X(a):.1f}" y1="{Y(fixed+off):.1f}" '
                f'x2="{X(b):.1f}" y2="{Y(fixed+off):.1f}"/>')
        else:
            add(f'<line class="glz" x1="{X(fixed+off):.1f}" y1="{Y(a):.1f}" '
                f'x2="{X(fixed+off):.1f}" y2="{Y(b):.1f}"/>')

window(14.5, 19.5, 0)                                    # dining window
window(24, 31, 0)                                        # bedroom one window
window(22, 24.3, W, horiz=False)                         # bedroom two window

# sliding glass door to the balcony
add(f'<line class="glz" x1="{X(4):.1f}" y1="{Y(-0.2):.1f}" x2="{X(6.8):.1f}" y2="{Y(-0.2):.1f}"/>')
add(f'<line class="glz" x1="{X(6.2):.1f}" y1="{Y(0.2):.1f}" x2="{X(9):.1f}" y2="{Y(0.2):.1f}"/>')

def door(hx, hy, ex, ey, ix, iy):
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

door(0.5, 25, 3.5, 25, 2.0, 22.0)          # entry, into the living room
door(3.5, 20.3, 3.5, 22.3, 5.5, 21.3)      # walk-in closet
door(12.5, 16.5, 15.5, 16.5, 14.0, 19.5)   # bath
door(25.5, 13, 22.5, 13, 24.0, 10.0)       # bedroom one, opening away from the bed
door(21.5, 16.5, 24.5, 16.5, 23.0, 19.5)   # bedroom two, off the hall

# closet bypass doors
for y0, y1 in ((4, 9.5), (17.2, 21.2)):
    mid = (y0 + y1) / 2
    add(f'<line class="leaf" x1="{X(32.32):.1f}" y1="{Y(y0):.1f}" '
        f'x2="{X(32.32):.1f}" y2="{Y(mid+0.3):.1f}"/>')
    add(f'<line class="leaf" x1="{X(32.68):.1f}" y1="{Y(mid-0.3):.1f}" '
        f'x2="{X(32.68):.1f}" y2="{Y(y1):.1f}"/>')

# ---------------------------------------------------------------- balcony
BX0, BX1, BY = 2.5, 11.0, -5.5
add(f'<rect class="bal" x="{X(BX0):.1f}" y="{Y(BY):.1f}" '
    f'width="{(BX1-BX0)*SC:.1f}" height="{-BY*SC:.1f}"/>')
add(f'<text class="lbl bal-t" x="{X(6.75):.1f}" y="{Y(-4.4):.1f}" '
    f'font-size="7.8" letter-spacing="1.5">BALCONY</text>')
add(f'<text class="lbl bal-t dm" x="{X(6.75):.1f}" y="{Y(-3.2):.1f}" '
    f'font-size="6.0" letter-spacing="0.9">8&prime;6&Prime; &times; 5&prime;6&Prime;</text>')
circ(6.75, -1.6, 0.9)
fx(4.55, -2.3, 5.95, -0.9)
fx(7.55, -2.3, 8.95, -0.9)

# ---------------------------------------------------------------- labels
for name, _r, (lx, ly), dim, _a, _w, fs in ROOMS:
    add(f'<text class="lbl" x="{X(lx):.1f}" y="{Y(ly):.1f}" '
        f'font-size="{fs}" letter-spacing="{1.5 if fs >= 8 else 0.7}">{name.upper()}</text>')
    if name not in NO_PRINTED_DIM:
        drop = 1.2 if name == "Walk-in Closet" else 1.55
        add(f'<text class="lbl dm" x="{X(lx):.1f}" y="{Y(ly + drop):.1f}" '
            f'font-size="6.0" letter-spacing="0.8">{dim}</text>')

add(f'<text class="lbl" x="{X(2.0):.1f}" y="{Y(21.2):.1f}" '
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

dimline(0, 26.2, W, 26.2, "35&prime; &ndash; 0&Prime;")
dimline(37.1, 0, 37.1, D, "25&prime; &ndash; 0&Prime;", rot=-90)

svg = (f'<svg class="plan" viewBox="0 0 {VW:.0f} {VH:.0f}" xmlns="http://www.w3.org/2000/svg" '
       f'role="img" aria-label="Floor plan of The Battle Creek, a two bedroom apartment of about 875 square feet">\n'
       + "\n".join(out) + "\n</svg>")

open("/Users/andrewkeacher/Desktop/Ridgewood Claude/tools/battlecreek2d.svg", "w").write(svg)
tot = sum((x1 - x0) * (y1 - y0) for _n, rs, *_ in ROOMS for x0, y0, x1, y1 in rs)
print(f"rooms={len(ROOMS)} tiled={tot:.0f} sf footprint={W*D:.0f} svg={len(svg)}B")
