"""The Wilson — isometric plan built from the layout the owner described.

23' x 35' footprint (~805 sq ft). Galley kitchen opening at its far end into a
dining nook with a window, semi-open to a large living room with a balcony at
the far end; bedroom with window and a wide shallow closet; spacious closet at
the entry. Room sizes are proportioned to the description, not surveyed.
"""
import sys, math, re
sys.path.insert(0, "/Users/andrewkeacher/Desktop/Ridgewood Claude/tools")
from isoplan import Scene, PAL, proj, poly, wall_run, sill, WALL_H, WALL_T, SCALE, C, S

W, D = 23.0, 35.0
sc = Scene()
DARK = "#3a3f3c"

sh = [proj(-.6, -.6, 0), proj(W+.6, -.6, 0), proj(W+.6, D+.6, 0), proj(-.6, D+.6, 0)]
sc.add(-6000, poly([(x+12, y+18) for x, y in sh], PAL["shadow"], extra=' opacity=".15"'))
sc.box(0, 0, W, D, -0.45, 0, PAL["slab"], "#a79e8e", "#968d7e", depth=-5000)

ROOMS = [
    ("Coat Closet",    0,  0,  7,  6, "tile"),
    ("Entry",          7,  0, 15,  6, "tile"),
    ("Main Closet",   15,  0, 23,  6, "carpet"),
    ("Bedroom",        0,  6, 11, 18, "carpet"),
    ("Hall",          11,  6, 15, 18, "wood"),
    ("Bath",          15,  6, 23, 15, "tile"),
    ("Linen",         15, 15, 19, 18, "tile"),
    ("Utility",       19, 15, 23, 18, "tile"),
    ("Kitchen",        0, 18, 23, 24, "wood"),
    ("Living Room",    0, 24, 23, 35, "wood"),
]
for name, x0, y0, x1, y1, kind in ROOMS:
    fill = {"wood": PAL["floor_wood"], "tile": PAL["tile"], "carpet": PAL["carpet"]}[kind]
    slug = name.lower().replace(" ", "-")
    tag = (f' class="rm" data-room="{name}" data-dim="{int(x1-x0)}′ × {int(y1-y0)}′"'
           f' data-area="{round((x1-x0)*(y1-y0))} sq ft" id="rm-{slug}"')
    sc.slab(x0, y0, x1, y1, 0.02, fill, extra=tag)
    (sc.planks if kind == "wood" else sc.tiles if kind == "tile" else lambda *a: None)(
        x0, y0, x1, y1, 0.03, PAL["grain"] if kind == "wood" else PAL["tile_line"])

# ------------------------------------------------------------------ perimeter
wall_run(sc, 0, 0, W, "x", gaps=[(9.5, 13.0)])                 # corridor wall + front door
wall_run(sc, W, 0, D, "y")                                     # party wall, no openings
wall_run(sc, 0, 0, D, "y", gaps=[(8, 14), (19.5, 23.5), (26, 32)])
sill(sc, 0, 8, 14, "y")                                        # bedroom window
sill(sc, 0, 19.5, 23.5, "y")                                   # dining-nook window
sill(sc, 0, 26, 32, "y")                                       # living window
wall_run(sc, D, 0, W, "x", gaps=[(6, 16)])                     # balcony wall
sill(sc, D, 6, 16, "x")                                        # slider to balcony

# ------------------------------------------------------------------ partitions
wall_run(sc,  6,  0,  7, "x")                                  # coat closet back
wall_run(sc,  7,  0,  6, "y", gaps=[(1.2, 4.2)])               # coat closet door
wall_run(sc, 15,  0,  6, "y", gaps=[(1.5, 4.5)])               # main closet opening
wall_run(sc,  6,  7, 15, "x")                                  # entry | hall
wall_run(sc,  6, 15, 23, "x")                                  # entry | bath
wall_run(sc, 11,  6, 18, "y", gaps=[(8.5, 11.5)])              # bedroom door
wall_run(sc, 15,  6, 18, "y", gaps=[(6.6, 9.2)])               # bath door off hall
wall_run(sc, 15, 15, 23, "x")                                  # bath | linen+utility
wall_run(sc, 19, 15, 18, "y")                                  # linen | utility
wall_run(sc, 18,  0, 11, "x")                                  # bedroom | kitchen
wall_run(sc, 18, 11, 15, "x", gaps=[(11.4, 14.6)])             # hall opens to kitchen
wall_run(sc, 18, 15, 23, "x")                                  # utility | kitchen
wall_run(sc, 24,  0, 23, "x", gaps=[(8, 18)])                  # kitchen | living, semi-open

# ------------------------------------------------------------------ balcony
sc.box(4, D, 19, D + 6, -0.35, -0.05, "#b3aa99", "#a49b8b", "#948c7d", depth=-4500)
rail_y = D + 6
RH = 2.9
# corner posts only — a solid panel here reads as a black wall, not a railing
for px, py in ((4, D), (4, rail_y), (19, D), (19, rail_y)):
    sc.box(px - .13, py - .13, px + .13, py + .13, 0, RH, DARK, "#31352f", "#2a2e29")
bx = 4.85                                                                         # front balusters
while bx < 18.9:
    sc.box(bx - .045, rail_y - .045, bx + .045, rail_y + .045, .12, RH - .18, DARK, "#33372f", "#2c302a")
    bx += 0.62
for sx in (4, 19):                                                                # side balusters
    by = D + 0.7
    while by < rail_y - 0.4:
        sc.box(sx - .045, by - .045, sx + .045, by + .045, .12, RH - .18, DARK, "#33372f", "#2c302a")
        by += 0.62
sc.box(4, rail_y - .13, 19, rail_y + .13, RH - .18, RH, "#4e544e", "#41463f", "#383c36")   # top rail
for sx in (4, 19):
    sc.box(sx - .13, D, sx + .13, rail_y, RH - .18, RH, "#4e544e", "#41463f", "#383c36")
sc.box(4, rail_y - .13, 19, rail_y + .13, .12, .3, "#4e544e", "#41463f", "#383c36")        # bottom rail
sc.box(6.2, D + 1.4, 8.4, D + 3.6, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")
sc.box(9.4, D + 1.4, 11.6, D + 3.6, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")
sc.box(8.5, D + 2.1, 9.3, D + 2.9, 0, 1.2, DARK, "#31352f", "#2a2e29")

# ------------------------------------------------------------------ living room
sc.slab(4, 26, 17, 33, 0.05, "#b9ae97", depth=-3800)
sc.box(5, 25.4, 12, 28.0, 0, 1.45, PAL["fabric"], "#8d9a86", "#7e8a78")          # sofa
sc.box(5, 25.4, 12, 26.0, 0, 2.35, "#a7b3a0", "#8d9a86", "#7e8a78")              # sofa back
sc.box(6.6, 29.2, 10.6, 31.2, 0, 0.95, PAL["wood"], "#6b5034", "#5d452d")        # coffee table
sc.box(13.2, 28.8, 15.6, 31.2, 0, 1.5, PAL["fabric"], "#8d9a86", "#7e8a78")      # armchair
sc.box(21.2, 27.0, 22.5, 32.0, 0, 1.7, PAL["wood"], "#6b5034", "#5d452d")        # media console
sc.box(21.8, 28.4, 22.1, 31.0, 1.7, 4.0, "#3b423d", "#2f3532", "#272c29")        # tv

# ------------------------------------------------------------------ kitchen
sc.box(7.0, 18.3, 22.0, 20.3, 0, 1.85, PAL["linen"], "#cfc8b8", "#bdb6a7")       # run A
sc.box(12.0, 18.5, 14.4, 20.1, 1.85, 1.95, "#4a4f4b", "#3e433f", "#363b37")      # range
sc.box(19.4, 18.3, 22.0, 21.0, 0, 4.6, "#e2e0da", "#cdcbc4", "#bcbab3")          # fridge
sc.box(12.0, 21.9, 22.0, 23.7, 0, 1.85, PAL["linen"], "#cfc8b8", "#bdb6a7")      # run B
sc.box(15.6, 22.3, 18.4, 23.3, 1.85, 1.93, PAL["metal"], "#a7abaa", "#979b9a")   # sink
sc.box(1.3, 20.0, 4.7, 23.0, 0, 1.55, PAL["wood"], "#6b5034", "#5d452d")         # nook table
for cx, cy in ((0.9, 21.5), (5.1, 21.5)):
    sc.box(cx - .5, cy - .6, cx + .5, cy + .6, 0, 1.85, PAL["linen"], "#cfc8b8", "#bdb6a7")

# ------------------------------------------------------------------ bedroom
sc.slab(1.6, 9.5, 10.2, 17.4, 0.05, "#bdb3a0", depth=-3800)
sc.box(3.5, 13.0, 8.5, 17.6, 0, 1.35, PAL["linen"], "#d8d2c3", "#c7c1b3")        # bed
sc.box(3.5, 17.0, 8.5, 17.6, 0, 2.6, "#8d7f68", "#7a6d59", "#6b5f4d")            # headboard
sc.box(4.0, 13.4, 8.0, 15.0, 1.35, 1.55, "#e6e1d4", "#d3cec2", "#c2bdb2")        # bedding
sc.box(2.1, 16.3, 3.3, 17.5, 0, 1.6, PAL["wood"], "#6b5034", "#5d452d")
sc.box(8.7, 16.3, 9.9, 17.5, 0, 1.6, PAL["wood"], "#6b5034", "#5d452d")
sc.box(9.3, 9.2, 10.6, 12.6, 0, 2.3, PAL["wood"], "#6b5034", "#5d452d")          # dresser
sc.box(1.5, 6.3, 9.5, 7.9, 1.85, 2.0, PAL["linen"], "#cfc8b8", "#bdb6a7")        # wide closet

# ------------------------------------------------------------------ bath + closets
sc.box(20.3, 6.6, 22.6, 11.6, 0, 1.35, "#eeece6", "#dad8d1", "#c9c7c1")          # tub
sc.box(15.6, 6.6, 17.3, 10.0, 0, 2.25, PAL["linen"], "#cfc8b8", "#bdb6a7")       # vanity
sc.box(15.6, 11.2, 16.9, 12.6, 0, 1.5, "#f2f0ec", "#dedcd7", "#cdcbc7")          # wc
sc.box(15.6, 0.6, 22.4, 1.7, 1.85, 2.0, PAL["linen"], "#cfc8b8", "#bdb6a7")      # closet shelf
sc.box(21.3, 1.7, 22.4, 5.4, 1.85, 2.0, PAL["linen"], "#cfc8b8", "#bdb6a7")
sc.box(0.6, 0.6, 6.4, 1.7, 1.85, 2.0, PAL["linen"], "#cfc8b8", "#bdb6a7")

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

body = sc.render() + dim(0, 0, W, 0, "23′ 0″", 2.0) + dim(W, 0, W, D, "35′ 0″", -2.0)

xs, ys = [], []
for m in re.finditer(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', body):
    xs.append(float(m.group(1))); ys.append(float(m.group(2)))
pad = 50
minx, miny = min(xs)-pad, min(ys)-pad
vw, vh = max(xs)+pad-minx, max(ys)+pad-miny
svg = (f'<svg class="plan" viewBox="{minx:.0f} {miny:.0f} {vw:.0f} {vh:.0f}" '
       f'xmlns="http://www.w3.org/2000/svg" role="img" '
       f'aria-label="Isometric floor plan of The Wilson, a one bedroom apartment of about 800 square feet">\n{body}\n</svg>')
open("/Users/andrewkeacher/Desktop/Ridgewood Claude/tools/wilson2.svg", "w").write(svg)
area = sum((r[3]-r[1])*(r[4]-r[2]) for r in ROOMS)
print(f"rooms={len(ROOMS)} interior={area:.0f} sqft  footprint={W*D:.0f}  svg={len(svg)}B  view={vw:.0f}x{vh:.0f}")
