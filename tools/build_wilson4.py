"""The Wilson — revision 3, worked from the three interior photographs.

What the photos establish:
  · living room and bedroom are CARPETED; kitchen and dining are dark vinyl plank
  · the kitchen block presents a long blank wall to the living room, and the
    galley opens at its far end into the dining nook with the window
  · slider to the balcony sits on the exterior wall at the end of the living room,
    with a through-wall A/C unit beside it and baseboard heat beneath
  · the front door is on the side wall at the back corner of the living room
30' x 27' = 810 sf.
"""
import sys, math, re
sys.path.insert(0, "/Users/andrewkeacher/Desktop/Ridgewood Claude/tools")
from isoplan import Scene, PAL, proj, poly, wall_run, sill, WALL_H, WALL_T, SCALE, C, S

W, D = 30.0, 27.0
sc = Scene()
DARK = "#3a3f3c"
VINYL, VINYL_SEAM = "#a79d90", "#8e8579"       # dark vinyl plank, per the kitchen photo
CARPET = "#c6bdae"

sh = [proj(-.6, -.6, 0), proj(W+.6, -.6, 0), proj(W+.6, D+.6, 0), proj(-.6, D+.6, 0)]
sc.add(-6000, poly([(x+12, y+18) for x, y in sh], PAL["shadow"], extra=' opacity=".15"'))
sc.box(0, 0, W, D, -0.45, 0, PAL["slab"], "#a79e8e", "#968d7e", depth=-5000)

ROOMS = [
    ("Dining",          0,  0, 14,  6, "vinyl"),
    ("Kitchen",         0,  6, 14, 16, "vinyl"),
    ("Living Room",    14,  0, 30, 16, "carpet"),
    ("Bedroom",         0, 16, 12, 27, "carpet"),
    ("Hall",           12, 16, 21, 27, "carpet"),
    ("Walk-in Closet", 21, 16, 30, 21, "carpet"),
    ("Bath",           21, 21, 30, 27, "vinyl"),
]
for name, x0, y0, x1, y1, kind in ROOMS:
    fill = {"vinyl": VINYL, "carpet": CARPET}[kind]
    tag = (f' class="rm" data-room="{name}" data-dim="{int(x1-x0)}&prime; &times; {int(y1-y0)}&prime;"'
           f' data-area="{round((x1-x0)*(y1-y0))} sq ft" id="rm-{name.lower().replace(" ","-")}"')
    sc.slab(x0, y0, x1, y1, 0.02, fill, extra=tag)
    if kind == "vinyl":
        sc.planks(x0, y0, x1, y1, 0.03, VINYL_SEAM, step=0.85)

# ------------------------------------------------------------------ perimeter
# entry and balcony swapped: the front door is on the corridor wall at y=0,
# the balcony hangs off the living room's outer wall at x=W
wall_run(sc, 0, 0, W, "x", gaps=[(20.5, 23.5)])                # corridor wall + FRONT DOOR
wall_run(sc, 0, 0, D, "y", gaps=[(1.5, 5.5), (18, 25)])        # exterior side
sill(sc, 0, 1.5, 5.5, "y")                                     # dining-nook window
sill(sc, 0, 18, 25, "y")                                       # bedroom window
wall_run(sc, W, 0, D, "y", gaps=[(1.8, 5.2), (9, 16)])         # exterior: window + slider
sill(sc, W, 1.8, 5.2, "y")                                     # living-room window
wall_run(sc, D, 0, W, "x")                                     # rear party wall

# slider glazing + through-wall A/C + baseboard heat, as in the photographs
sc.box(W-.18, 9, W+.18, 16, 0, WALL_H, PAL["glass"], "#a9bfc6", "#9ab0b7")
sc.box(W-.3, 6.2, W+.3, 8.2, 1.95, 2.85, "#dcdcd8", "#c6c6c2", "#b4b4b0", depth=39.6)

# ---- entry door, standing open into the living room ----
sc.box(20.5, -.26, 23.5, .26, 0, .10, "#7a6a52", "#6a5b46", "#5d4f3c", depth=39.9)
sc.box(20.55, .18, 20.85, 3.0, 0, 2.70, "#5a4630", "#4b3a27", "#413121")

# ------------------------------------------------------------------ partitions
# the long blank wall the living room looks at, open only at the dining end
wall_run(sc, 14,  0, 16, "y", gaps=[(1.0, 6.6)])
wall_run(sc, 16,  0, 14, "x")                                  # kitchen | bedroom
wall_run(sc, 16, 14, 21, "x", gaps=[(15.6, 19.2)])             # living opens to hall
wall_run(sc, 16, 21, 30, "x", gaps=[(22.4, 25.4)])             # walk-in, off the entry
wall_run(sc, 12, 16, 27, "y", gaps=[(20.0, 23.0)])             # bedroom door
wall_run(sc, 21, 16, 21, "y")                                  # hall | walk-in
wall_run(sc, 21, 21, 27, "y", gaps=[(22.2, 24.8)])             # bath door
wall_run(sc, 21, 21, 30, "x")                                  # walk-in | bath

# ------------------------------------------------------------------ balcony
BY0, BY1, BX = 9.0, 16.0, W + 6.5
sc.box(W, BY0, BX, BY1, -0.35, -0.05, "#b3aa99", "#a49b8b", "#948c7d", depth=46.19)
RH = 2.9
for px, py in ((W, BY0), (BX, BY0), (W, BY1), (BX, BY1)):
    sc.box(px-.13, py-.13, px+.13, py+.13, 0, RH, DARK, "#31352f", "#2a2e29")
by = BY0 + .62
while by < BY1 - .3:
    sc.box(BX-.045, by-.045, BX+.045, by+.045, .12, RH-.18, DARK, "#33372f", "#2c302a")
    by += .62
for sy in (BY0, BY1):
    bx = W + .62
    while bx < BX - .3:
        sc.box(bx-.045, sy-.045, bx+.045, sy+.045, .12, RH-.18, DARK, "#33372f", "#2c302a")
        bx += .62
sc.box(BX-.13, BY0, BX+.13, BY1, RH-.18, RH, "#4e544e", "#41463f", "#383c36")
for sy in (BY0, BY1):
    sc.box(W, sy-.13, BX, sy+.13, RH-.18, RH, "#4e544e", "#41463f", "#383c36")
sc.box(BX-.13, BY0, BX+.13, BY1, .12, .3, "#4e544e", "#41463f", "#383c36")
sc.box(W+1.4, 10.4, W+3.6, 12.6, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")
sc.box(W+1.4, 13.4, W+3.6, 15.6, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")
sc.box(W+2.1, 12.8, W+2.9, 13.6, 0, 1.2, DARK, "#31352f", "#2a2e29")

# ------------------------------------------------------------------ living room
sc.slab(16.2, 4.2, 28.0, 14.2, 0.05, "#b6ab95", depth=-3800)
sc.box(14.6, 6.0, 17.0, 12.4, 0, 1.45, PAL["linen"], "#d8d2c3", "#c7c1b3")     # sofa on the kitchen wall
sc.box(14.6, 6.0, 15.3, 12.4, 0, 2.30, "#e2ddd0", "#cfcabd", "#beb9ad")        # sofa back
sc.box(19.6, 7.6, 22.8, 10.6, 0, 0.95, "#c9a878", "#b0905f", "#9a7d50")        # coffee table
sc.box(25.6, 11.0, 27.8, 13.4, 0, 1.45, PAL["linen"], "#d8d2c3", "#c7c1b3")    # armchair by the slider
sc.box(14.8, 13.0, 16.6, 14.8, 0, 1.60, "#c9a878", "#b0905f", "#9a7d50")       # side table
sc.box(17.2, 1.2, 18.6, 2.6, 0, 2.90, "#6f7f63", "#5f6e55", "#526049")         # plant

# ------------------------------------------------------------------ dining nook
sc.box(1.7, 1.6, 5.1, 4.8, 0, 1.55, "#7a5c3c", "#664c31", "#5a4229")           # round table
for cx, cy in ((6.3, 3.2), (3.4, 0.95)):
    sc.box(cx-.55, cy-.65, cx+.55, cy+.65, 0, 1.9, PAL["linen"], "#cfc8b8", "#bdb6a7")

# ------------------------------------------------------------------ galley kitchen
sc.box(4.6, 6.4, 13.2, 8.4, 0, 1.85, "#5a4630", "#4b3a27", "#413121")          # dark cabinets
sc.box(4.6, 6.4, 13.2, 8.4, 1.85, 1.95, "#cfc9bb", "#bcb6a9", "#aba598")       # stone top
sc.box(7.0, 6.6, 9.4, 8.2, 1.95, 2.05, "#e6e4df", "#d2d0cb", "#c1bfba")        # range
sc.box(11.0, 6.4, 13.4, 9.0, 0, 4.6, "#e2e0da", "#cdcbc4", "#bcbab3")          # fridge
sc.box(1.0, 13.6, 13.2, 15.6, 0, 1.85, "#5a4630", "#4b3a27", "#413121")
sc.box(1.0, 13.6, 13.2, 15.6, 1.85, 1.95, "#cfc9bb", "#bcb6a9", "#aba598")
sc.box(5.0, 14.0, 8.0, 15.2, 1.95, 2.02, PAL["metal"], "#a7abaa", "#979b9a")   # double sink

# ------------------------------------------------------------------ bedroom
sc.slab(1.6, 19.0, 10.4, 25.6, 0.05, "#bcb2a1", depth=-3800)
sc.box(3.5, 22.0, 8.5, 26.6, 0, 1.35, PAL["linen"], "#d8d2c3", "#c7c1b3")      # bed
sc.box(3.5, 26.0, 8.5, 26.6, 0, 2.6, "#8d7f68", "#7a6d59", "#6b5f4d")          # headboard
sc.box(4.0, 22.4, 8.0, 24.0, 1.35, 1.55, "#e6e1d4", "#d3cec2", "#c2bdb2")
sc.box(2.1, 25.4, 3.3, 26.6, 0, 1.6, "#7a5c3c", "#664c31", "#5a4229")
sc.box(8.7, 25.4, 9.9, 26.6, 0, 1.6, "#7a5c3c", "#664c31", "#5a4229")
sc.box(9.6, 17.6, 11.4, 21.0, 0, 2.3, "#7a5c3c", "#664c31", "#5a4229")         # dresser
sc.box(1.0, 16.3, 9.0, 18.1, 1.85, 2.0, PAL["linen"], "#cfc8b8", "#bdb6a7")    # wide shallow closet

# ------------------------------------------------------------------ bath + walk-in
sc.box(27.4, 21.6, 29.7, 26.5, 0, 1.35, "#eeece6", "#dad8d1", "#c9c7c1")       # tub
sc.box(21.6, 21.6, 23.3, 24.8, 0, 2.25, PAL["linen"], "#cfc8b8", "#bdb6a7")    # vanity
sc.box(21.6, 25.3, 22.9, 26.6, 0, 1.5, "#f2f0ec", "#dedcd7", "#cdcbc7")        # wc
sc.box(21.6, 16.4, 29.5, 17.3, 1.95, 2.1, PAL["linen"], "#cfc8b8", "#bdb6a7")  # closet shelf
sc.box(21.6, 16.4, 29.5, 17.0, 1.45, 1.55, PAL["metal"], "#a7abaa", "#979b9a") # hanging rail
sc.box(28.6, 17.3, 29.5, 20.6, 1.95, 2.1, PAL["linen"], "#cfc8b8", "#bdb6a7")

# ------------------------------------------------------------------ dimensions
def dim(x0, y0, x1, y1, label, ox, oy):
    a, b = proj(x0 + ox, y0 + oy, 0), proj(x1 + ox, y1 + oy, 0)
    mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
    ang = math.degrees(math.atan2(b[1]-a[1], b[0]-a[0]))
    return (f'<g class="dim"><line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>'
            f'<line x1="{a[0]:.1f}" y1="{a[1]-4:.1f}" x2="{a[0]:.1f}" y2="{a[1]+4:.1f}"/>'
            f'<line x1="{b[0]:.1f}" y1="{b[1]-4:.1f}" x2="{b[0]:.1f}" y2="{b[1]+4:.1f}"/>'
            f'<text x="{mx:.1f}" y="{my-8:.1f}" transform="rotate({ang:.1f} {mx:.1f} {my:.1f})">{label}</text></g>')

body = (sc.render()
        + dim(0, 0, W, 0, "30&prime; 0&Prime;", 0, -2.8)
        + dim(0, 0, 0, D, "27&prime; 0&Prime;", -2.8, 0))
xs, ys = [], []
for m in re.finditer(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', body):
    xs.append(float(m.group(1))); ys.append(float(m.group(2)))
pad = 50
minx, miny = min(xs)-pad, min(ys)-pad
vw, vh = max(xs)+pad-minx, max(ys)+pad-miny
svg = (f'<svg class="plan" viewBox="{minx:.0f} {miny:.0f} {vw:.0f} {vh:.0f}" '
       f'xmlns="http://www.w3.org/2000/svg" role="img" '
       f'aria-label="Isometric floor plan of The Wilson, a one bedroom apartment of about 800 square feet">\n{body}\n</svg>')
open("/Users/andrewkeacher/Desktop/Ridgewood Claude/tools/wilson4.svg", "w").write(svg)
print(f"rooms={len(ROOMS)} tiled={sum((r[3]-r[1])*(r[4]-r[2]) for r in ROOMS):.0f} sf "
      f"footprint={W*D:.0f} svg={len(svg)}B view={vw:.0f}x{vh:.0f}")
