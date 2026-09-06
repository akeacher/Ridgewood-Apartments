"""Generate an isometric floor-plan SVG from a plan description in feet.

Projection is true isometric: x runs right-and-down, y runs left-and-down,
z runs up. Faces are depth-sorted with a painter's algorithm.
"""
import math

C, S = math.cos(math.radians(30)), 0.5
SCALE = 30.0          # pixels per foot
WALL_T = 0.5          # wall thickness, feet
WALL_H = 2.9          # cutaway wall height, feet

PAL = dict(
    floor_wood="#c2a074", floor_wood_dk="#a8865c", grain="#a9885f",
    tile="#d9d6cd", tile_line="#c2beb2", carpet="#cbc2ae",
    wall_top="#f6f3ec", wall_x="#ddd6c6", wall_y="#c9c1af",
    slab="#b9b0a0", shadow="#2a2e26",
    forest="#2a4627", sage="#8a9a82", gold="#cc9e45",
    wood="#7a5c3c", fabric="#9aa694", linen="#e8e3d6",
    metal="#b9bcbb", glass="#bcd0d6",
)

def proj(x, y, z):
    return ((x - y) * C * SCALE, ((x + y) * S - z) * SCALE)

def poly(pts, fill, stroke=None, sw=0.6, extra=""):
    d = " ".join(f"{px:.2f},{py:.2f}" for px, py in pts)
    st = f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"' if stroke else ''
    return f'<polygon points="{d}" fill="{fill}"{st}{extra}/>'

class Scene:
    def __init__(self):
        self.items = []      # (depth, svg)

    def add(self, depth, svg):
        self.items.append((depth, svg))

    def box(self, x0, y0, x1, y1, z0, z1, top, fx, fy, stroke=None, extra="", depth=None):
        """A rectangular prism; only the top and the two viewer-facing sides show."""
        p = proj
        top_f = [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)]
        xf    = [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)]
        yf    = [p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)]
        svg = poly(xf, fx, stroke) + poly(yf, fy, stroke) + poly(top_f, top, stroke, extra=extra)
        # painter's order in isometric: larger x+y at the near corner draws later
        self.add((x1 + y1) if depth is None else depth, svg)

    def slab(self, x0, y0, x1, y1, z, fill, extra="", depth=-4000):
        pts = [proj(x0, y0, z), proj(x1, y0, z), proj(x1, y1, z), proj(x0, y1, z)]
        self.add(depth, poly(pts, fill, extra=extra))

    def planks(self, x0, y0, x1, y1, z, colour, step=0.75):
        """Floorboard seams, drawn in plan space so they follow the projection."""
        lines = []
        v = y0 + step
        while v < y1 - 0.01:
            a, b = proj(x0, v, z), proj(x1, v, z)
            lines.append(f'<line x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}"/>')
            v += step
        if lines:
            self.add(-3900,
                     f'<g stroke="{colour}" stroke-width="0.7" opacity=".55">{"".join(lines)}</g>')

    def tiles(self, x0, y0, x1, y1, z, colour, step=1.6):
        lines = []
        v = y0 + step
        while v < y1 - 0.01:
            a, b = proj(x0, v, z), proj(x1, v, z)
            lines.append(f'<line x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}"/>')
            v += step
        h = x0 + step
        while h < x1 - 0.01:
            a, b = proj(h, y0, z), proj(h, y1, z)
            lines.append(f'<line x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}"/>')
            h += step
        if lines:
            self.add(-3900,
                     f'<g stroke="{colour}" stroke-width="0.7" opacity=".7">{"".join(lines)}</g>')

    def render(self):
        return "\n".join(s for _, s in sorted(self.items, key=lambda t: t[0]))


def wall_run(sc, fixed, a, b, axis, gaps=(), h=WALL_H, t=WALL_T):
    """A wall along one axis, split around door and window openings."""
    cuts, pos = [], a
    for g0, g1 in sorted(gaps):
        if g0 > pos:
            cuts.append((pos, g0))
        pos = max(pos, g1)
    if pos < b:
        cuts.append((pos, b))
    for c0, c1 in cuts:
        if c1 - c0 < 0.05:
            continue
        if axis == "x":      # wall runs along x at y = fixed
            sc.box(c0, fixed - t / 2, c1, fixed + t / 2, 0, h,
                   PAL["wall_top"], PAL["wall_x"], PAL["wall_y"])
        else:                # wall runs along y at x = fixed
            sc.box(fixed - t / 2, c0, fixed + t / 2, c1, 0, h,
                   PAL["wall_top"], PAL["wall_x"], PAL["wall_y"])


def sill(sc, fixed, a, b, axis, t=WALL_T):
    """A low window sill with glazing above it."""
    if axis == "x":
        sc.box(a, fixed - t / 2, b, fixed + t / 2, 0, 0.9,
               PAL["wall_top"], PAL["wall_x"], PAL["wall_y"])
        sc.box(a, fixed - t / 6, b, fixed + t / 6, 0.9, WALL_H,
               PAL["glass"], PAL["glass"], PAL["glass"])
    else:
        sc.box(fixed - t / 2, a, fixed + t / 2, b, 0, 0.9,
               PAL["wall_top"], PAL["wall_x"], PAL["wall_y"])
        sc.box(fixed - t / 6, a, fixed + t / 6, b, 0.9, WALL_H,
               PAL["glass"], PAL["glass"], PAL["glass"])
