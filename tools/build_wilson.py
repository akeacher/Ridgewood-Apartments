"""Build 'The Wilson' one-bedroom as an isometric SVG.

Dimensions here are ILLUSTRATIVE — derived from the ~625 sq ft figure, not from
measured drawings. Swap in real numbers before this is used for leasing.
"""
import sys, math
sys.path.insert(0, "/Users/andrewkeacher/Desktop/Ridgewood Claude/tools")
from isoplan import Scene, PAL, proj, poly, wall_run, sill, WALL_H, WALL_T, SCALE, C, S

W, D = 26.0, 24.0
sc = Scene()

# ---------------------------------------------------------------- ground shadow
sh = [proj(-0.6, -0.6, 0), proj(W + .6, -0.6, 0), proj(W + .6, D + .6, 0), proj(-0.6, D + .6, 0)]
sc.add(-2000, poly([(x + 10, y + 16) for x, y in sh], PAL["shadow"], extra=' opacity=".16"'))

# ---------------------------------------------------------------- floor slab
sc.box(0, 0, W, D, -0.45, 0, PAL["slab"], "#a79e8e", "#968d7e", depth=-5000)

ROOMS = [
    ("Living / Dining", 0, 0, 15, 14, "wood"),
    ("Kitchen",        15, 0, 26,  9, "wood"),
    ("Bath",           15, 9, 21, 15, "tile"),
    ("Entry",          21, 9, 26, 15, "tile"),
    ("Bedroom",         0, 14, 12, 24, "carpet"),
    ("Hall",           12, 14, 21, 24, "wood"),
    ("Walk-in Closet", 21, 15, 26, 24, "carpet"),
]

for name, x0, y0, x1, y1, kind in ROOMS:
    fill = {"wood": PAL["floor_wood"], "tile": PAL["tile"], "carpet": PAL["carpet"]}[kind]
    slug = name.lower().replace(" / ", "-").replace(" ", "-")
    area = round((x1 - x0) * (y1 - y0))
    dim = f"{int(x1-x0)}′ × {int(y1-y0)}′"
    tag = (f' class="rm" data-room="{name}" data-dim="{dim}" data-area="{area} sq ft"'
           f' id="rm-{slug}"')
    sc.slab(x0, y0, x1, y1, 0.02, fill, extra=tag)
    if kind == "wood":
        sc.planks(x0, y0, x1, y1, 0.03, PAL["grain"])
    elif kind == "tile":
        sc.tiles(x0, y0, x1, y1, 0.03, PAL["tile_line"])

# ---------------------------------------------------------------- walls
# perimeter, with a sliding door to the balcony and windows
wall_run(sc, 0, 0, W, "x", gaps=[(3, 11), (18.5, 23)])          # north
sill(sc, 0, 3, 11, "x")                                          # balcony slider
sill(sc, 0, 18.5, 23, "x")                                       # kitchen window
wall_run(sc, D, 0, W, "x", gaps=[(3.5, 8.5)])                    # south
sill(sc, D, 3.5, 8.5, "x")                                       # bedroom window
wall_run(sc, 0, 0, D, "y")                                       # west
wall_run(sc, W, 0, D, "y", gaps=[(10.5, 13.5)])                  # east + entry door

# interior partitions
wall_run(sc, 15, 0, 15, "y", gaps=[(1.5, 7.0)])                  # living | kitchen (open)
wall_run(sc,  9, 15, W, "x")                                     # kitchen | bath+entry
wall_run(sc, 21, 9, 15, "y")                                     # bath | entry
wall_run(sc, 14, 0, 15, "x", gaps=[(9.5, 13.0)])                 # living | hall
wall_run(sc, 15, 15, W, "x", gaps=[(16.0, 19.0)])                # bath door side
wall_run(sc, 12, 14, D, "y", gaps=[(17.0, 20.0)])                # bedroom door
wall_run(sc, 21, 15, D, "y", gaps=[(18.0, 21.0)])                # closet opening

# ---------------------------------------------------------------- balcony
sc.box(2.5, -6.0, 13.0, 0, -0.35, -0.05, "#b3aa99", "#a49b8b", "#948c7d", depth=-4500)
for bx in (2.5, 13.0):
    sc.box(bx - .12, -6.0, bx + .12, 0, 0, 1.5, PAL["metal"], "#9fa3a2", "#8e9291")
sc.box(2.5, -6.12, 13.0, -5.88, 0, 1.5, PAL["metal"], "#9fa3a2", "#8e9291")
sc.box(4.2, -4.4, 6.4, -2.2, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")   # chair
sc.box(7.4, -4.4, 9.6, -2.2, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")   # chair
sc.box(6.5, -3.6, 7.4, -2.9, 0, 1.1, PAL["wood"], "#6b5034", "#5d452d")     # side table

# ---------------------------------------------------------------- living / dining
sc.slab(2.6, 4.0, 11.0, 10.6, 0.05, "#b9ae97", depth=-3800)                              # rug
sc.box(3.4, 9.4, 9.6, 12.0, 0, 1.45, PAL["fabric"], "#8d9a86", "#7e8a78")   # sofa
sc.box(3.4, 11.4, 9.6, 12.0, 0, 2.3, "#a7b3a0", "#8d9a86", "#7e8a78")       # sofa back
sc.box(5.0, 6.4, 8.4, 8.4, 0, 0.95, PAL["wood"], "#6b5034", "#5d452d")      # coffee table
sc.box(3.4, 1.2, 9.6, 2.5, 0, 1.6, PAL["wood"], "#6b5034", "#5d452d")       # console
sc.box(5.2, 1.5, 7.8, 1.8, 1.6, 4.0, "#3b423d", "#2f3532", "#272c29")       # tv
sc.box(11.4, 6.8, 13.4, 8.8, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")   # armchair
# dining
sc.box(10.6, 2.4, 13.6, 5.4, 0, 1.55, PAL["linen"], "#d5cfc0", "#c4beb0")
for cx, cy in ((10.0, 3.0), (10.0, 4.4), (14.2, 3.0), (14.2, 4.4)):
    sc.box(cx - .45, cy - .45, cx + .45, cy + .45, 0, 1.8, PAL["wood"], "#6b5034", "#5d452d")

# ---------------------------------------------------------------- kitchen
sc.box(15.6, 0.6, 25.4, 2.6, 0, 1.85, PAL["linen"], "#cfc8b8", "#bdb6a7")   # counter run
sc.box(19.2, 0.8, 21.6, 2.4, 1.85, 1.95, "#4a4f4b", "#3e433f", "#363b37")   # range top
sc.box(23.4, 3.2, 25.4, 5.8, 0, 4.6, "#e2e0da", "#cdcbc4", "#bcbab3")       # fridge
sc.box(15.6, 6.4, 17.0, 8.4, 0, 1.85, PAL["linen"], "#cfc8b8", "#bdb6a7")   # base cab
sc.box(18.0, 3.6, 22.0, 6.2, 0, 1.9, "#d7d2c4", "#c3beb1", "#b2ada1")       # island
sc.box(19.0, 4.3, 21.0, 5.5, 1.9, 1.98, "#e9e5da", "#d5d1c7", "#c4c0b7")    # island top

# ---------------------------------------------------------------- bath
sc.box(15.6, 9.8, 18.2, 12.4, 0, 1.35, "#eeece6", "#dad8d1", "#c9c7c1")     # tub
sc.box(19.1, 9.8, 20.5, 12.2, 0, 2.25, PAL["linen"], "#cfc8b8", "#bdb6a7")  # vanity
sc.box(19.3, 13.0, 20.4, 14.3, 0, 1.5, "#f2f0ec", "#dedcd7", "#cdcbc7")     # wc

# ---------------------------------------------------------------- bedroom
sc.slab(1.6, 15.4, 10.6, 23.2, 0.05, "#bdb3a0", depth=-3800)                             # rug
sc.box(3.0, 16.2, 8.2, 22.6, 0, 1.35, PAL["linen"], "#d8d2c3", "#c7c1b3")   # bed
sc.box(3.0, 16.2, 8.2, 17.2, 0, 2.6, "#8d7f68", "#7a6d59", "#6b5f4d")       # headboard
sc.box(3.4, 17.4, 7.8, 19.2, 1.35, 1.55, "#e6e1d4", "#d3cec2", "#c2bdb2")   # pillows
sc.box(1.6, 16.2, 2.7, 17.4, 0, 1.6, PAL["wood"], "#6b5034", "#5d452d")     # nightstand
sc.box(8.5, 16.2, 9.6, 17.4, 0, 1.6, PAL["wood"], "#6b5034", "#5d452d")     # nightstand
sc.box(9.8, 19.0, 11.4, 22.8, 0, 2.3, PAL["wood"], "#6b5034", "#5d452d")    # dresser

# ---------------------------------------------------------------- closets
sc.box(21.6, 15.6, 25.4, 16.4, 1.9, 2.05, PAL["linen"], "#cfc8b8", "#bdb6a7")
sc.box(21.6, 18.0, 22.3, 23.4, 1.9, 2.05, PAL["linen"], "#cfc8b8", "#bdb6a7")
sc.box(22.0, 10.0, 25.4, 10.7, 1.9, 2.05, PAL["linen"], "#cfc8b8", "#bdb6a7")

# ---------------------------------------------------------------- dimensions
def dim_line(x0, y0, x1, y1, label, off):
    a, b = proj(x0, y0, 0), proj(x1, y1, 0)
    nx = (off * C * SCALE, off * S * SCALE) if y0 == y1 else (-off * C * SCALE, off * S * SCALE)
    ax, ay = a[0] - nx[0], a[1] - nx[1]
    bx, by = b[0] - nx[0], b[1] - nx[1]
    mx, my = (ax + bx) / 2, (ay + by) / 2
    ang = math.degrees(math.atan2(by - ay, bx - ax))
    return (f'<g class="dim"><line x1="{ax:.1f}" y1="{ay:.1f}" x2="{bx:.1f}" y2="{by:.1f}"/>'
            f'<line x1="{ax:.1f}" y1="{ay-4:.1f}" x2="{ax:.1f}" y2="{ay+4:.1f}"/>'
            f'<line x1="{bx:.1f}" y1="{by-4:.1f}" x2="{bx:.1f}" y2="{by+4:.1f}"/>'
            f'<text x="{mx:.1f}" y="{my-6:.1f}" transform="rotate({ang:.1f} {mx:.1f} {my:.1f})">{label}</text></g>')

dims = dim_line(0, 0, W, 0, "26′ 0″", 1.6) + dim_line(W, 0, W, D, "24′ 0″", -1.6)

# ---------------------------------------------------------------- assemble
body = sc.render() + dims
xs, ys = [], []
import re
for m in re.finditer(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', body):
    xs.append(float(m.group(1))); ys.append(float(m.group(2)))
pad = 46
minx, maxx, miny, maxy = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
vw, vh = maxx - minx, maxy - miny

svg = f'''<svg class="plan" viewBox="{minx:.0f} {miny:.0f} {vw:.0f} {vh:.0f}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Isometric floor plan of The Wilson, a one bedroom apartment">
{body}
</svg>'''
open("/Users/andrewkeacher/Desktop/Ridgewood Claude/tools/wilson.svg", "w").write(svg)
print("rooms:", len(ROOMS), "| svg bytes:", len(svg), "| viewBox:", f"{vw:.0f}x{vh:.0f}")
