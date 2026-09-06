"""The Wilson — revision 2, following the owner's corrections.

Front door opens straight into a squarer living room; walk-in closet immediately
on the right as you enter; balcony off the far end of the living room; galley
kitchen sharing the living room's width and semi-open to it; hallway back to the
bath and a bedroom with a window and a wide, shallow closet.  33' x 24' = 792 sf.
"""
import sys, math, re
sys.path.insert(0, "/Users/andrewkeacher/Desktop/Ridgewood Claude/tools")
from isoplan import Scene, PAL, proj, poly, wall_run, sill, WALL_H, WALL_T, SCALE, C, S

W, D = 33.0, 24.0
sc = Scene()
DARK = "#3a3f3c"

sh = [proj(-.6, -.6, 0), proj(W+.6, -.6, 0), proj(W+.6, D+.6, 0), proj(-.6, D+.6, 0)]
sc.add(-6000, poly([(x+12, y+18) for x, y in sh], PAL["shadow"], extra=' opacity=".15"'))
sc.box(0, 0, W, D, -0.45, 0, PAL["slab"], "#a79e8e", "#968d7e", depth=-5000)

ROOMS = [
    ("Living Room",     0,  0, 17, 14, "wood"),
    ("Kitchen",         0, 14, 17, 24, "wood"),
    ("Walk-in Closet", 17,  0, 22,  5, "carpet"),
    ("Hall",           17,  5, 22, 24, "wood"),
    ("Bath",           22,  0, 33,  8, "tile"),
    ("Bedroom",        22,  8, 33, 24, "carpet"),
]
for name, x0, y0, x1, y1, kind in ROOMS:
    fill = {"wood": PAL["floor_wood"], "tile": PAL["tile"], "carpet": PAL["carpet"]}[kind]
    tag = (f' class="rm" data-room="{name}" data-dim="{int(x1-x0)}&prime; &times; {int(y1-y0)}&prime;"'
           f' data-area="{round((x1-x0)*(y1-y0))} sq ft" id="rm-{name.lower().replace(" ","-")}"')
    sc.slab(x0, y0, x1, y1, 0.02, fill, extra=tag)
    if kind == "wood":
        sc.planks(x0, y0, x1, y1, 0.03, PAL["grain"])
    elif kind == "tile":
        sc.tiles(x0, y0, x1, y1, 0.03, PAL["tile_line"])

# ------------------------------------------------------------------ perimeter
wall_run(sc, 0, 0, W, "x", gaps=[(12, 15)])                    # corridor wall + FRONT DOOR
wall_run(sc, W, 0, D, "y")                                     # party wall
wall_run(sc, 0, 0, D, "y", gaps=[(2, 12), (16, 21)])           # exterior: balcony + nook window
sill(sc, 0, 16, 21, "y")                                       # dining-nook window
wall_run(sc, D, 0, W, "x", gaps=[(25, 31)])                    # rear wall
sill(sc, D, 25, 31, "x")                                       # bedroom window

# ------------------------------------------------------------------ partitions
wall_run(sc, 17,  0,  5, "y", gaps=[(1.4, 4.0)])               # walk-in closet opening
wall_run(sc,  5, 17, 22, "x")                                  # closet | hall
wall_run(sc, 17,  5, 14, "y", gaps=[(6.5, 12.0)])              # living opens to hall
wall_run(sc, 17, 14, 24, "y", gaps=[(16.5, 20.5)])             # kitchen opens to hall
wall_run(sc, 22,  0,  8, "y", gaps=[(5.4, 7.6)])               # bath door off hall
wall_run(sc,  8, 22, 33, "x")                                  # bath | bedroom
wall_run(sc, 22,  8, 24, "y", gaps=[(11.5, 14.5)])             # bedroom door
wall_run(sc, 14,  0,  5, "x")                                  # living | kitchen …
wall_run(sc, 14, 12, 17, "x")                                  # … semi-open between x=5 and 12

# ------------------------------------------------------------------ balcony (off the living room)
BX0, BY0, BY1 = -6.5, 2.0, 12.0
sc.box(BX0, BY0, 0, BY1, -0.35, -0.05, "#b3aa99", "#a49b8b", "#948c7d", depth=-4500)
RH = 2.9
for px, py in ((BX0, BY0), (BX0, BY1), (0, BY0), (0, BY1)):
    sc.box(px - .13, py - .13, px + .13, py + .13, 0, RH, DARK, "#31352f", "#2a2e29")
by = BY0 + 0.62                                                 # balusters along the outer rail
while by < BY1 - 0.3:
    sc.box(BX0 - .045, by - .045, BX0 + .045, by + .045, .12, RH - .18, DARK, "#33372f", "#2c302a")
    by += 0.62
for sy in (BY0, BY1):                                           # balusters along the returns
    bx = BX0 + 0.62
    while bx < -0.3:
        sc.box(bx - .045, sy - .045, bx + .045, sy + .045, .12, RH - .18, DARK, "#33372f", "#2c302a")
        bx += 0.62
sc.box(BX0 - .13, BY0, BX0 + .13, BY1, RH - .18, RH, "#4e544e", "#41463f", "#383c36")
for sy in (BY0, BY1):
    sc.box(BX0, sy - .13, 0, sy + .13, RH - .18, RH, "#4e544e", "#41463f", "#383c36")
sc.box(BX0 - .13, BY0, BX0 + .13, BY1, .12, .3, "#4e544e", "#41463f", "#383c36")
sc.box(-4.6, 4.2, -2.4, 6.4, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")
sc.box(-4.6, 7.4, -2.4, 9.6, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")
sc.box(-3.9, 6.6, -3.1, 7.4, 0, 1.2, DARK, "#31352f", "#2a2e29")
sc.box(-.18, 2.0, .18, 12.0, 0, WALL_H, PAL["glass"], "#a9bfc6", "#9ab0b7")   # slider glazing

# ------------------------------------------------------------------ living room
sc.slab(3.5, 2.5, 13.5, 11.5, 0.05, "#b9ae97", depth=-3800)
sc.box(10.6, 3.6, 13.2, 10.4, 0, 1.45, PAL["fabric"], "#8d9a86", "#7e8a78")   # sofa facing balcony
sc.box(12.6, 3.6, 13.2, 10.4, 0, 2.35, "#a7b3a0", "#8d9a86", "#7e8a78")       # sofa back
sc.box(6.4, 5.6, 9.0, 8.6, 0, 0.95, PAL["wood"], "#6b5034", "#5d452d")        # coffee table
sc.box(5.6, 1.6, 8.0, 4.0, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")       # armchair
sc.box(4.4, 12.2, 9.6, 13.4, 0, 1.7, PAL["wood"], "#6b5034", "#5d452d")       # media console
sc.box(6.0, 12.9, 8.4, 13.2, 1.7, 4.0, "#3b423d", "#2f3532", "#272c29")       # tv

# ------------------------------------------------------------------ kitchen (galley + nook)
sc.box(6.0, 14.4, 16.4, 16.4, 0, 1.85, PAL["linen"], "#cfc8b8", "#bdb6a7")    # run A
sc.box(9.0, 14.6, 11.4, 16.2, 1.85, 1.95, "#4a4f4b", "#3e433f", "#363b37")    # range
sc.box(13.8, 14.4, 16.4, 17.1, 0, 4.6, "#e2e0da", "#cdcbc4", "#bcbab3")       # fridge
sc.box(6.0, 21.6, 16.4, 23.6, 0, 1.85, PAL["linen"], "#cfc8b8", "#bdb6a7")    # run B
sc.box(9.6, 22.0, 12.4, 23.0, 1.85, 1.93, PAL["metal"], "#a7abaa", "#979b9a") # sink
sc.box(1.3, 17.5, 4.7, 20.5, 0, 1.55, PAL["wood"], "#6b5034", "#5d452d")      # nook table
for cx, cy in ((0.9, 19.0), (5.1, 19.0)):
    sc.box(cx - .5, cy - .6, cx + .5, cy + .6, 0, 1.85, PAL["linen"], "#cfc8b8", "#bdb6a7")

# ------------------------------------------------------------------ bedroom
sc.slab(24.5, 11.0, 32.0, 21.0, 0.05, "#bdb3a0", depth=-3800)
sc.box(28.0, 13.5, 32.9, 18.5, 0, 1.35, PAL["linen"], "#d8d2c3", "#c7c1b3")   # bed
sc.box(32.3, 13.5, 32.9, 18.5, 0, 2.6, "#8d7f68", "#7a6d59", "#6b5f4d")       # headboard
sc.box(30.4, 14.0, 32.2, 18.0, 1.35, 1.55, "#e6e1d4", "#d3cec2", "#c2bdb2")   # bedding
sc.box(31.6, 12.1, 32.9, 13.3, 0, 1.6, PAL["wood"], "#6b5034", "#5d452d")
sc.box(31.6, 18.7, 32.9, 19.9, 0, 1.6, PAL["wood"], "#6b5034", "#5d452d")
sc.box(24.6, 22.2, 28.2, 23.5, 0, 2.3, PAL["wood"], "#6b5034", "#5d452d")     # dresser
sc.box(22.3, 10.0, 24.3, 18.0, 1.85, 2.0, PAL["linen"], "#cfc8b8", "#bdb6a7") # wide shallow closet

# ------------------------------------------------------------------ bath + walk-in
sc.box(30.5, 0.6, 32.9, 5.6, 0, 1.35, "#eeece6", "#dad8d1", "#c9c7c1")        # tub
sc.box(22.6, 0.6, 24.3, 4.0, 0, 2.25, PAL["linen"], "#cfc8b8", "#bdb6a7")     # vanity
sc.box(22.6, 5.0, 23.9, 6.4, 0, 1.5, "#f2f0ec", "#dedcd7", "#cdcbc7")         # wc
sc.box(17.5, 0.5, 21.6, 1.4, 1.9, 2.05, PAL["linen"], "#cfc8b8", "#bdb6a7")   # closet shelves
sc.box(20.7, 1.4, 21.6, 4.6, 1.9, 2.05, PAL["linen"], "#cfc8b8", "#bdb6a7")
sc.box(17.5, 0.5, 18.4, 4.6, 1.4, 1.5, PAL["metal"], "#a7abaa", "#979b9a")    # hanging rail

# ------------------------------------------------------------------ dimensions
def dim(x0, y0, x1, y1, label, off):
    a, b = proj(x0, y0, 0), proj(x1, y1, 0)
    n = (off * C * SCALE, off * S * SCALE) if y0 == y1 else (-off * C * SCALE, off * S * SCALE)
    ax, ay, bx2, by2 = a[0]-n[0], a[1]-n[1], b[0]-n[0], b[1]-n[1]
    mx, my = (ax+bx2)/2, (ay+by2)/2
    ang = math.degrees(math.atan2(by2-ay, bx2-ax))
    return (f'<g class="dim"><line x1="{ax:.1f}" y1="{ay:.1f}" x2="{bx2:.1f}" y2="{by2:.1f}"/>'
            f'<line x1="{ax:.1f}" y1="{ay-4:.1f}" x2="{ax:.1f}" y2="{ay+4:.1f}"/>'
            f'<line x1="{bx2:.1f}" y1="{by2-4:.1f}" x2="{bx2:.1f}" y2="{by2+4:.1f}"/>'
            f'<text x="{mx:.1f}" y="{my-7:.1f}" transform="rotate({ang:.1f} {mx:.1f} {my:.1f})">{label}</text></g>')

body = sc.render() + dim(0, 0, W, 0, "33&prime; 0&Prime;", 2.0) + dim(W, 0, W, D, "24&prime; 0&Prime;", -2.0)

xs, ys = [], []
for m in re.finditer(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', body):
    xs.append(float(m.group(1))); ys.append(float(m.group(2)))
pad = 50
minx, miny = min(xs)-pad, min(ys)-pad
vw, vh = max(xs)+pad-minx, max(ys)+pad-miny
svg = (f'<svg class="plan" viewBox="{minx:.0f} {miny:.0f} {vw:.0f} {vh:.0f}" '
       f'xmlns="http://www.w3.org/2000/svg" role="img" '
       f'aria-label="Isometric floor plan of The Wilson, a one bedroom apartment of about 800 square feet">\n{body}\n</svg>')
open("/Users/andrewkeacher/Desktop/Ridgewood Claude/tools/wilson3.svg", "w").write(svg)
print(f"rooms={len(ROOMS)} interior={sum((r[3]-r[1])*(r[4]-r[2]) for r in ROOMS):.0f} sf "
      f"footprint={W*D:.0f} svg={len(svg)}B view={vw:.0f}x{vh:.0f}")
