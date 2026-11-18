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
from shapely.ops import unary_union

SOURCE = ("https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/"
          "releaseData/gbOpen/BHS/ADM1/geoBoundaries-BHS-ADM1.geojson")
OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "images" / "harbour-map.svg"

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


if __name__ == "__main__":
    main()
