#!/usr/bin/env python3
"""Draw web/images/harbour-map.svg, the sea and land under the fares map.

    pip install shapely
    python3 scripts/make-harbour-map.py            # downloads the coastline
    python3 scripts/make-harbour-map.py file.geojson

The coastline is geoBoundaries' Bahamas islands (CC BY 4.0, credited on the
map). Its edges are traced from a raster, so they come in small steps; this
rounds them off. The projection is a flat one, fine at this size, and the
numbers below (W0, E0, S0, N0, W) are repeated in web/script.js (HARBOUR_VIEW)
so the pins land on the same spots. Change them together.
"""
import json
import math
import pathlib
import sys
import urllib.request

from shapely.geometry import MultiPolygon, box, shape
from shapely.affinity import translate
from shapely.ops import unary_union

SOURCE = ("https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/"
          "releaseData/gbOpen/BHS/ADM1/geoBoundaries-BHS-ADM1.geojson")
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "images" / "harbour-map.svg"
ROUTES = ROOT / "web" / "images" / "harbour-routes.json"  # the boat's way to each stop
SCRIPT = ROOT / "web" / "script.js"  # where the stops' positions are

# New Providence is drawn this many degrees further south than it really is,
# to open up the harbour between it and Paradise Island so the pins there can
# be told apart. Same number as HARBOUR_VIEW.npShift in web/script.js.
NP_SHIFT = 0.006

# West, east, south and north edges, in degrees, and the drawing's width.
W0, E0, S0, N0 = -77.425, -77.185, 25.009, 25.130
W = 1000
K = math.cos(math.radians((S0 + N0) / 2))
H = round(W * (N0 - S0) / ((E0 - W0) * K))


def xy(lon, lat):
    return (lon - W0) / (E0 - W0) * W, (N0 - lat) / (N0 - S0) * H


def chaikin(pts):
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        out += [(.75 * x0 + .25 * x1, .75 * y0 + .25 * y1), (.25 * x0 + .75 * x1, .25 * y0 + .75 * y1)]
    return out + out[:1]


def path(geom, min_area=1.5e-7):
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    parts = []
    for p in polys:
        if p.area < min_area:
            continue
        for ring in [p.exterior, *p.interiors]:
            pts = [xy(x, y) for x, y in chaikin(chaikin(list(ring.coords)))]
            parts.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z")
    return "".join(parts)


def main():
    if len(sys.argv) > 1:
        data = json.loads(pathlib.Path(sys.argv[1]).read_text())
    else:
        with urllib.request.urlopen(SOURCE, timeout=120) as r:
            data = json.loads(r.read())
    clip = box(W0 - .02, S0 - .02, E0 + .02, N0 + .02)
    land = unary_union([shape(f["geometry"]).buffer(0).intersection(clip) for f in data["features"]])
    islands = sorted(land.geoms, key=lambda g: g.area)
    mainland = translate(islands.pop(), yoff=-NP_SHIFT)  # the biggest is New Providence
    land = unary_union([mainland, *islands])
    r = 0.0004  # round the raster steps off, then thin the points
    land = land.buffer(r, join_style=1).buffer(-2 * r, join_style=1).buffer(r, join_style=1)
    land = land.simplify(0.0001, preserve_topology=True)
    shallow = land.buffer(0.0024, join_style=1).simplify(0.00015)

    OUT.write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9e6f0"/><stop offset="1" stop-color="#d6f1f6"/></linearGradient></defs>
<rect width="{W}" height="{H}" fill="url(#s)"/>
<path d="{path(shallow)}" fill="#e4f6f9"/>
<path d="{path(land)}" fill="#f3e6c4" stroke="#d8c493" stroke-width="1" stroke-linejoin="round"/>
</svg>
''')
    print(f"wrote {OUT} ({W} x {H}, {OUT.stat().st_size // 1024} KB)")
    write_routes(land)


# ── The boat's routes ────────────────────────────────────────────────────────
# From the Cruise Port to each stop by water: the shortest way that keeps a little off every
# shore, found on a grid over the drawing, then straightened and rounded. Written to
# harbour-routes.json, which the map's boat follows (script.js, drawHarbourRoute).

def stops_from_script():
    import re
    src = SCRIPT.read_text()
    shift = float(re.search(r"npShift: ([\d.]+)", src).group(1))
    on_np = set(re.findall(r'"([^"]+)"', src[src.index("ON_NEW_PROVIDENCE"):src.index("]);", src.index("ON_NEW_PROVIDENCE"))]))
    block = src[src.index("const HARBOUR_STOPS"):]
    block = block[:block.index("];")]
    stops = {}
    for name, lat, lon in re.findall(r'\["([^"]+)", ([\d.]+), (-[\d.]+),', block):
        lat = float(lat) - (shift if name in on_np else 0)
        stops[name] = xy(float(lon), lat)
    return stops


def write_routes(land, port="Nassau Cruise Port"):
    import heapq
    from PIL import Image, ImageDraw
    from shapely.geometry import LineString, Point, Polygon as P

    G = 2  # drawing units per grid cell
    cols, rows = W // G + 1, H // G + 1
    keep_off = land.buffer(0.0009, join_style=1)  # how far the route keeps from the shore
    img = Image.new("L", (cols, rows), 0)
    draw = ImageDraw.Draw(img)
    polys = keep_off.geoms if isinstance(keep_off, MultiPolygon) else [keep_off]
    for poly in polys:
        draw.polygon([(x / G, y / G) for x, y in (xy(*c) for c in poly.exterior.coords)], fill=255)
        for hole in poly.interiors:
            draw.polygon([(x / G, y / G) for x, y in (xy(*c) for c in hole.coords)], fill=0)
    blocked = img.load()
    free = lambda c, r: 0 <= c < cols and 0 <= r < rows and blocked[c, r] == 0

    def nearest_free(x, y):
        c0, r0 = round(x / G), round(y / G)
        for d in range(0, 40):
            best = None
            for c in range(c0 - d, c0 + d + 1):
                for r in (r0 - d, r0 + d) if d else (r0,):
                    if free(c, r):
                        best = best or (c, r)
            for r in range(r0 - d + 1, r0 + d):
                for c in (c0 - d, c0 + d):
                    if free(c, r):
                        best = best or (c, r)
            if best:
                return best
        raise SystemExit(f"no water near {x:.0f},{y:.0f}")

    def a_star(a, b):
        steps = [(1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)]
        h = lambda c: ((c[0] - b[0]) ** 2 + (c[1] - b[1]) ** 2) ** 0.5
        came, cost, todo = {a: None}, {a: 0}, [(h(a), a)]
        while todo:
            _, cur = heapq.heappop(todo)
            if cur == b:
                break
            for dc, dr, k in steps:
                nxt = (cur[0] + dc, cur[1] + dr)
                if not free(*nxt):
                    continue
                new = cost[cur] + k
                if new < cost.get(nxt, 1e18):
                    cost[nxt], came[nxt] = new, cur
                    heapq.heappush(todo, (new + h(nxt), nxt))
        if b not in came:
            raise SystemExit("no way by water")
        cells, cur = [], b
        while cur:
            cells.append(cur)
            cur = came[cur]
        return [(c * G, r * G) for c, r in reversed(cells)]

    # The shore in drawing units, to check a straightened route still keeps off it.
    shore = unary_union([P([xy(*c) for c in p.exterior.coords]) for p in (land.geoms if isinstance(land, MultiPolygon) else [land]) if p.area > 1.5e-7]).buffer(1.5)

    stops = stops_from_script()
    px, py = stops[port]
    start = nearest_free(px, py - 6)
    routes = {}
    for name, (x, y) in stops.items():
        if name == port:
            continue
        cells = a_star(start, nearest_free(x, y - 6))
        line = LineString([(px, py - 6), *cells, (x, y - 6)])
        # Straightened as far as it stays off the shore (except right by the two pins,
        # which sit on it).
        ends = Point(px, py - 6).buffer(9).union(Point(x, y - 6).buffer(9))
        for tol in (6, 4, 2.5, 1.5, 0.8, 0):
            short = line.simplify(tol)
            if tol == 0 or not short.difference(ends).intersects(shore):
                break
        pts = list(short.coords)
        if len(pts) > 2:  # round the corners
            for _ in range(2):
                pts = [pts[0]] + [q for a, b in zip(pts, pts[1:]) for q in ((.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]), (.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1]))][1:-1] + [pts[-1]]
        routes[name] = "M" + "L".join(f"{a:.1f} {b:.1f}" for a, b in pts)
    ROUTES.write_text(json.dumps(routes, ensure_ascii=False, indent=0) + "\n")
    print(f"wrote {ROUTES} ({len(routes)} routes)")


if __name__ == "__main__":
    main()
