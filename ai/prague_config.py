"""Generate the Prague-specific inputs for the AI pipeline (no API keys needed).

Outputs (ai/out/):
  generation_config.json  - isometric-nyc generation config centred on Prague, grid sized to Praha 1-8
  bounds_praha1-8.json    - lat/lon polygon of the eight districts (for the isometric-nyc bounds app)
  frames.csv              - teacher-dataset frame centres (lat, lng, kind) for the 3D Tiles renderer
  landmarks.csv           - named landmarks to oversample (zoomed quarters, as tiny.london did)

Camera: azimuth -15 deg, elevation -45 deg, 1024 px frame = 300 m tall (same as isometric.nyc, so the
nyc prompt/infill tooling works unchanged; tiny.london used the same frame).
"""
import csv, json, math, os, pickle, random
from shapely.geometry import shape, Point, box
from shapely.ops import unary_union
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "ai", "out"); os.makedirs(OUT, exist_ok=True)
D = json.load(open(os.path.join(ROOT, "data", "raw", "districts_geo.json")))
union_ll = shape(D["union"])
tr = Transformer.from_crs("EPSG:4326", "EPSG:5514", always_xy=True); inv = Transformer.from_crs("EPSG:5514", "EPSG:4326", always_xy=True)

# ---- 1. generation config (isometric-nyc format)
VIEW_H = 300.0            # metres covered by 1024 px vertically
AZ, EL = -15.0, -45.0
w, s, e, n = union_ll.bounds
lat_c, lng_c = (s + n) / 2, (w + e) / 2
# extent in metres (Krovak)
x0, y0 = tr.transform(w, s); x1, y1 = tr.transform(e, n)
ext_x, ext_y = x1 - x0, y1 - y0
# a 1024 px tile covers ~VIEW_H*2/cos(45) metres of ground north-south projected; be generous: tiles of 300 m ground
tile_ground = VIEW_H          # approx ground metres per tile edge after the iso projection (conservative)
n_tiles_x = math.ceil(ext_x / tile_ground * 1.15); n_tiles_y = math.ceil(ext_y / tile_ground * 1.15)
cfg = {"name": "praha1-8", "seed": {"lat": round(lat_c, 6), "lng": round(lng_c, 6)}, "n_tiles_x": n_tiles_x, "n_tiles_y": n_tiles_y,
       "camera_azimuth_degrees": AZ, "camera_elevation_degrees": EL, "width_px": 1024, "height_px": 1024, "view_height_meters": VIEW_H, "tile_step": 0.5}
json.dump(cfg, open(os.path.join(OUT, "generation_config.json"), "w"), indent=2)
print("generation_config:", cfg, "-> quadrants ~", n_tiles_x * n_tiles_y * 4)

# ---- 2. bounds polygon (lat/lon) for the bounds app; simplified to keep it editable
poly = union_ll.simplify(0.0004, preserve_topology=True)
ring = list(poly.exterior.coords) if poly.geom_type == "Polygon" else list(max(poly.geoms, key=lambda g: g.area).exterior.coords)
json.dump({"name": "praha1-8", "polygon": [[lat, lng] for lng, lat in ring]}, open(os.path.join(OUT, "bounds_praha1-8.json"), "w"))
print("bounds vertices:", len(ring))

# ---- 3. teacher frames: stratified coverage. Grid every 450 m inside the districts, plus water-adjacent and landmark frames.
L = pickle.load(open(os.path.join(ROOT, "data", "work", "layers.pkl"), "rb"))
idx = json.load(open(os.path.join(ROOT, "data", "chunks", "index.json"))); X0, Y0 = idx["origin"]
water = unary_union([p for _, p, c, t in L["lands"] if c == "water" and p.area > 2000]).buffer(120)
union_m = unary_union([])
def to_ll(x, y):
    lon, lat = inv.transform(x + X0, y + Y0); return lat, lon
random.seed(7)
frames = []
# local-metre bbox of the union (via Krovak)
xs, ys = zip(*[tr.transform(lon, lat) for lon, lat in ring])
mx0, my0, mx1, my1 = min(xs) - X0, min(ys) - Y0, max(xs) - X0, max(ys) - Y0
STEP = 450
y = my0
while y < my1:
    x = mx0
    while x < mx1:
        jx, jy = x + random.uniform(-80, 80), y + random.uniform(-80, 80)
        lat, lon = to_ll(jx, jy)
        if union_ll.contains(Point(lon, lat)):
            kind = "water" if water.contains(Point(jx, jy)) else "grid"
            frames.append((round(lat, 6), round(lon, 6), kind))
        x += STEP
    y += STEP
# landmarks (named, notable) -> frame + one zoomed quarter frame (view 150 m) for detail
land = []
for _, pt, t in L["pois"]:
    if t.get("tourism") in ("attraction", "museum", "viewpoint") or t.get("historic") in ("castle", "palace", "monument", "city_gate", "church", "monastery") or t.get("building") in ("church", "cathedral", "palace", "castle") or t.get("man_made") == "tower" or t.get("railway") == "station":
        if "name" in t:
            lat, lon = to_ll(pt.x, pt.y)
            if union_ll.contains(Point(lon, lat)):
                land.append((t["name"], round(lat, 6), round(lon, 6)))
seen = set(); land = [l for l in land if not (l[0] in seen or seen.add(l[0]))]
for name, lat, lon in land:
    frames.append((lat, lon, "landmark"))
with open(os.path.join(OUT, "frames.csv"), "w", newline="") as f:
    wr = csv.writer(f); wr.writerow(["lat", "lng", "kind", "view_height_m"])
    for lat, lon, kind in frames:
        wr.writerow([lat, lon, kind, VIEW_H])
    for name, lat, lon in land:
        wr.writerow([lat, lon, "landmark_zoom", VIEW_H / 2])
with open(os.path.join(OUT, "landmarks.csv"), "w", newline="") as f:
    wr = csv.writer(f); wr.writerow(["name", "lat", "lng"]); wr.writerows(land)
from collections import Counter
print("frames:", len(frames) + len(land), Counter(k for _, _, k in frames), "landmarks", len(land))
