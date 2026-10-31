"""Build renderer chunks from parsed OSM layers + CUZK rasters.

Output: data/chunks/<cx>_<cy>.json and data/chunks/index.json
Units: local metres (x east, y north), heights in decimetres above sea level.
"""
import base64, json, math, os, pickle, sys, time, hashlib
import numpy as np
import rasterio
from rasterio import features
from shapely.geometry import box, shape, LineString, MultiLineString, Polygon, MultiPolygon, Point
from shapely.ops import unary_union, linemerge
from shapely.strtree import STRtree
from shapely import affinity
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw"); WORK = os.path.join(ROOT, "data", "work"); OUT = os.path.join(ROOT, "data", "chunks")
os.makedirs(OUT, exist_ok=True)
grid = json.load(open(os.path.join(RAW, "elev", "grid.json")))
X0, Y0, RES, W, H = grid["x0"], grid["y0"], grid["res"], grid["W"], grid["H"]
CHUNK = 256          # metres
ZSTEP = 8            # terrain vertex spacing (m)
LCRES = 4            # landcover cell (m)
t0 = time.time()
log = lambda *a: print(*a, f"[{time.time()-t0:.0f}s]", flush=True)

# ------------------------------------------------------------ rasters
def load(svc):
    parts = []
    i = 0
    while os.path.exists(os.path.join(RAW, "elev", f"{svc}_{i}.tif")):
        with rasterio.open(os.path.join(RAW, "elev", f"{svc}_{i}.tif")) as r:
            parts.append(r.read(1))
        i += 1
    a = np.concatenate(parts, axis=0)
    assert a.shape == (H, W), (a.shape, H, W)
    a[a < -100] = np.nan
    return a

dmr = load("dmr5g")          # row 0 = north (y1)
dmp = load("dmp")
ndsm = dmp - dmr
del dmp
ndsm = np.nan_to_num(ndsm, nan=0.0).astype(np.float32)
dmr = np.nan_to_num(dmr, nan=float(np.nanmedian(dmr))).astype(np.float32)
log("rasters loaded", dmr.shape, float(dmr.min()), float(dmr.max()))
# raster transform: pixel (col,row) -> local metres x = col*RES, y = (H-row)*RES
transform = rasterio.transform.from_origin(0, H * RES, RES, RES)   # local coords (origin subtracted)

# ------------------------------------------------------------ layers
L = pickle.load(open(os.path.join(WORK, "layers.pkl"), "rb"))
log("layers", {k: len(v) for k, v in L.items()})
tr = Transformer.from_crs("EPSG:4326", "EPSG:5514", always_xy=True)
union_ll = shape(json.load(open(os.path.join(RAW, "districts_geo.json")))["union"])
# project union polygon to local metres
def proj_poly(p):
    def ring(r):
        xs, ys = tr.transform([c[0] for c in r], [c[1] for c in r])
        return list(zip(np.array(xs) - X0, np.array(ys) - Y0))
    return Polygon(ring(p.exterior.coords), [ring(i.coords) for i in p.interiors])
union = proj_poly(union_ll) if union_ll.geom_type == "Polygon" else unary_union([proj_poly(g) for g in union_ll.geoms])
area_poly = union.buffer(120)     # render band around the districts
log("union area km2", union.area / 1e6)

# ------------------------------------------------------------ buildings: heights & bases
def parse_len(v):
    if v is None:
        return None
    try:
        s = str(v).strip().replace(",", ".")
        if s.endswith("m"):
            s = s[:-1].strip()
        if "'" in s or "ft" in s:
            return float(s.split("'")[0].replace("ft", "")) * 0.3048
        return float(s.split(";")[0])
    except Exception:
        return None

def parse_levels(v):
    try:
        return float(str(v).split(";")[0].replace(",", "."))
    except Exception:
        return None

HIST = union  # historic-ness heuristic uses distance to centre
CENTRE = np.array(tr.transform(14.4205, 50.0870)) - np.array([X0, Y0])

def building_record(bid, poly, t, h_est, base, is_part):
    """Return dict with geometry + style decisions, or None."""
    btype = t.get("building", t.get("building:part", "yes"))
    if btype in ("roof", "no", "shelter", "carport", "canopy") and not is_part:
        pass
    h = parse_len(t.get("height"))
    lv = parse_levels(t.get("building:levels"))
    roof_lv = parse_levels(t.get("roof:levels")) or 0
    minh = parse_len(t.get("min_height")) or 0
    if minh == 0 and t.get("building:min_level"):
        minh = (parse_levels(t.get("building:min_level")) or 0) * 3.2
    if h is None:
        if h_est is not None and h_est >= 2.0:
            h = float(h_est)
            if t.get("roof:shape") not in ("flat",) and h > 6:
                h = h - 1.2     # median of a pitched roof sits mid-slope; walls end a bit lower, ridge drawn on top
        elif lv is not None:
            h = lv * 3.3 + roof_lv * 2.5 + (0 if (t.get("roof:shape") == "flat") else 1.5)
        else:
            h = {"garage": 3, "garages": 3, "shed": 2.5, "hut": 2.5, "roof": 3, "greenhouse": 3, "church": 18, "cathedral": 25, "industrial": 8, "warehouse": 8, "apartments": 18, "house": 7, "detached": 7, "terrace": 8, "residential": 12}.get(btype, 10)
    h = max(2.5, min(h, 300))
    # roof shape
    rs = t.get("roof:shape")
    d_centre = float(np.hypot(*(np.array(poly.centroid.coords[0]) - CENTRE)))
    area = poly.area
    if rs in ("gabled", "hipped", "half-hipped", "gambrel", "mansard", "pyramidal", "round", "saltbox", "side_hipped", "skillion"):
        roof = "pitched"
    elif rs in ("flat",):
        roof = "flat"
    elif rs in ("dome", "onion"):
        roof = "dome"
    elif btype in ("church", "cathedral", "chapel", "monastery", "synagogue", "temple"):
        roof = "pitched"
    elif btype in ("garage", "garages", "industrial", "warehouse", "retail", "commercial", "office", "hospital", "school", "university", "parking", "transportation", "train_station", "sports_hall", "supermarket", "service", "kiosk", "hangar", "roof", "greenhouse"):
        roof = "flat"
    elif btype in ("apartments",) and h > 25:
        roof = "flat"
    elif btype in ("house", "detached", "terrace", "semidetached_house", "residential", "yes", "apartments", "civic", "public", "hotel", "farm", "villa", "bungalow", "cabin"):
        # old city fabric gets red tiled roofs; far-out large modern blocks get flat
        if d_centre < 4000 and area < 3500 and h < 40:
            roof = "pitched"
        elif area < 900 and h < 16:
            roof = "pitched"
        else:
            roof = "flat" if (h > 22 or area > 2500) else "pitched"
    else:
        roof = "flat" if area > 1500 else "pitched"
    if t.get("man_made") == "tower" or t.get("tower:type") or btype in ("tower",) or (rs in ("pyramidal", "cone") and area < 450 and h > 14) or (rs in ("gabled", "hipped") and area < 120 and h > 22) or (btype in ("church", "cathedral", "chapel") and area < 300 and h > 12):
        roof = "pointed"
    if rs in ("onion",):
        roof = "dome"
    # roof colour family
    rc = (t.get("roof:colour") or t.get("roof:material") or "").lower()
    if btype in ("church", "cathedral", "chapel") or rc in ("copper", "green", "#008000"):
        roofc = "copper" if btype in ("church", "cathedral", "chapel") and area > 400 else ("copper" if rc in ("copper", "green") else "red")
    elif roof == "flat":
        roofc = "grey"
    elif rc in ("slate", "grey", "gray", "black", "metal", "#808080", "darkgray", "darkgrey", "dimgray", "dimgrey", "lightgray", "lightgrey", "silver", "zinc", "tin", "lead"):
        roofc = "slate"
    else:
        roofc = "red"
    # facade colour index: deterministic per building
    hsh = int(hashlib.md5(str(bid).encode()).hexdigest()[:6], 16)
    if btype in ("church", "cathedral", "chapel", "monastery"):
        fc = 7
    elif btype in ("industrial", "warehouse", "garage", "garages", "hangar"):
        fc = 8 + hsh % 2
    elif roof == "flat" and h > 25:
        fc = 10 + hsh % 3     # panel / modern
    else:
        fc = hsh % 7
    # roof ridge inset ring for pitched roofs
    inset = None
    if roof == "pitched" and area > 25:
        r = min(4.0, 0.28 * math.sqrt(area))
        try:
            ip = poly.buffer(-r, join_style=2)
            if ip.geom_type == "MultiPolygon":
                ip = max(ip.geoms, key=lambda g: g.area)
            if ip.geom_type == "Polygon" and ip.area > 4:
                inset = (list(ip.exterior.simplify(0.5).coords), r)
        except Exception:
            inset = None
    rh = parse_len(t.get("roof:height")) or 0.0
    return {"h": h, "minh": minh, "base": base, "roof": roof, "roofc": roofc, "fc": fc, "inset": inset, "name": t.get("name"), "type": btype, "rh": rh}

def raster_stats(polys, shp):
    """Rasterise polygons (index+1) and return per-polygon (median ndsm, p15 dmr, count)."""
    n = len(polys)
    med = np.full(n, np.nan, np.float32); base = np.full(n, np.nan, np.float32); cnt = np.zeros(n, np.int32)
    BATCH = 60000
    for s in range(0, n, BATCH):
        sub = polys[s:s + BATCH]
        idx = features.rasterize(((p, i + 1) for i, p in enumerate(sub)), out_shape=shp, transform=transform, dtype=np.int32, all_touched=False)
        m = idx > 0
        ids = idx[m] - 1; nv = ndsm[m]; dv = dmr[m]
        del idx, m
        order = np.lexsort((nv, ids)); ids_s = ids[order]; nv_s = nv[order]; dv_s = dv[order]
        starts = np.flatnonzero(np.r_[True, ids_s[1:] != ids_s[:-1]]); counts = np.diff(np.r_[starts, len(ids_s)])
        gid = ids_s[starts]
        med[s + gid] = nv_s[starts + counts // 2]; cnt[s + gid] = counts
        order2 = np.lexsort((dv_s, ids_s)); dv_s2 = dv_s[order2]
        base[s + gid] = dv_s2[starts + counts // 6]
        del order, order2, ids_s, nv_s, dv_s, dv_s2, ids, nv, dv
        log(f"  raster batch {s}..{s+len(sub)}")
    return med, base, cnt

def sample_dmr(x, y):
    """bilinear-free nearest sample of terrain at local metres."""
    c = np.clip((np.asarray(x) / RES).astype(int), 0, W - 1); r = np.clip((H - 1 - np.asarray(y) / RES).astype(int), 0, H - 1)
    return dmr[r, c]

B = [(bid, p, t) for bid, p, t in L["buildings"] if p.intersects(area_poly)]
P = [(bid, p, t) for bid, p, t in L["parts"] if p.intersects(area_poly)]
log("buildings in area", len(B), "parts", len(P))
# outlines that have parts -> skip outline
tree = STRtree([p for _, p, _ in B])
has_parts = set()
for _, pp, _ in P:
    c = pp.representative_point()
    for j in tree.query(c, predicate="within"):
        has_parts.add(j)
log("outlines with parts", len(has_parts))
# enclosure outlines (castle/complex polygons that contain other buildings) are not extruded
from collections import Counter
contain = Counter()
pts = [p.representative_point() for _, p, _ in B]
for i, pt in enumerate(pts):
    for j in tree.query(pt, predicate="within"):
        if j != i:
            contain[j] += 1
for j, n in contain.items():
    bid, p, t = B[j]
    if (n >= 2 and p.area > 3000) or (t.get("building") in ("castle", "fort", "monastery") and p.area > 8000) or p.area > 60000:
        has_parts.add(j)
log("outlines skipped incl. enclosures", len(has_parts))
med, base, cnt = raster_stats([p for _, p, _ in B], dmr.shape)
pmed, pbase, pcnt = raster_stats([p for _, p, _ in P], dmr.shape)
BREC = []
for i, (bid, p, t) in enumerate(B):
    if i in has_parts:
        continue
    b = base[i] if cnt[i] >= 3 else float(sample_dmr(p.centroid.x, p.centroid.y))
    hest = float(med[i]) if cnt[i] >= 6 else None
    rec = building_record(bid, p, t, hest, float(b), False)
    if rec:
        BREC.append((p, rec))
for i, (bid, p, t) in enumerate(P):
    b = pbase[i] if pcnt[i] >= 3 else float(sample_dmr(p.centroid.x, p.centroid.y))
    # base of a part should be the ground under its parent outline: use lowest ground of containing outline if any
    cands = tree.query(p.representative_point(), predicate="within")
    if len(cands):
        j = cands[0]
        if cnt[j] >= 3:
            b = min(b, base[j])
    hest = float(pmed[i]) if pcnt[i] >= 6 else None
    rec = building_record(bid, p, t, hest, float(b), True)
    if rec:
        BREC.append((p, rec))
del tree
log("building records", len(BREC))

# ------------------------------------------------------------ land cover raster (4 m)
LC_ORDER = ["industrial", "asphalt", "farmland", "grass", "scrub", "vineyard", "cemetery", "pitch", "forest", "plaza", "railyard", "rock", "water"]
LC_ID = {n: i + 1 for i, n in enumerate(LC_ORDER)}   # 0 = urban ground
lcW, lcH = int(W * RES // LCRES), int(H * RES // LCRES)
lc_transform = rasterio.transform.from_origin(0, H * RES, LCRES, LCRES)
lc = np.zeros((lcH, lcW), np.uint8)
lands = [(p, c) for _, p, c, t in L["lands"] if p.intersects(area_poly)]
for name in LC_ORDER:
    shapes = [(p, LC_ID[name]) for p, c in lands if c == name]
    if shapes:
        features.rasterize(shapes, out=lc, transform=lc_transform, all_touched=False)
# void outside the render band
void = features.rasterize([(area_poly, 1)], out_shape=lc.shape, transform=lc_transform, dtype=np.uint8)
lc[void == 0] = 255
log("landcover raster", {n: int((lc == i).sum()) for n, i in LC_ID.items()})
water_polys = [p for p, c in lands if c == "water"]
water_union = unary_union(water_polys) if water_polys else Polygon()
log("water union area km2", water_union.area / 1e6)

# ------------------------------------------------------------ roads
ROAD_CLASS = {"motorway": 1, "motorway_link": 2, "trunk": 1, "trunk_link": 2, "primary": 3, "primary_link": 4, "secondary": 4, "secondary_link": 5, "tertiary": 5, "tertiary_link": 6, "residential": 6, "unclassified": 6, "living_street": 7, "pedestrian": 7, "service": 8, "track": 9, "footway": 10, "path": 10, "steps": 11, "cycleway": 10, "bridleway": 10, "busway": 5, "construction": 8}
roads = []
for wid, ln, t in L["roads"]:
    cls = ROAD_CLASS.get(t.get("highway"))
    if cls is None or not ln.intersects(area_poly):
        continue
    if t.get("tunnel") in ("yes", "building_passage") or t.get("covered") == "yes" or t.get("location") == "underground":
        continue
    try:
        if int(float(t.get("layer", "0"))) < 0 and t.get("bridge") != "yes":
            continue
    except Exception:
        pass
    bridge = t.get("bridge") in ("yes", "viaduct", "movable", "aqueduct")
    roads.append((ln, cls, bridge, 0))
for wid, ln, t in L["rails"]:
    if not ln.intersects(area_poly):
        continue
    if t.get("tunnel") == "yes" or t.get("railway") == "subway" or t.get("service") in ("yard", "siding", "spur", "crossover") and t.get("railway") == "rail" and False:
        continue
    if t.get("railway") == "subway":
        continue
    kind = 20 if t.get("railway") in ("rail", "light_rail", "narrow_gauge") else (21 if t.get("railway") == "tram" else 22)
    if t.get("railway") == "funicular":
        kind = 22
    bridge = t.get("bridge") in ("yes", "viaduct")
    roads.append((ln, kind, bridge, 0))
for wid, ln, t in L["streams"]:
    if ln.intersects(area_poly) and t.get("tunnel") != "yes" and t.get("tunnel") != "culvert":
        roads.append((ln, 30 if t.get("waterway") == "river" else 31, False, 0))
log("road-like lines", len(roads))

# bridge elevation: merge bridge lines into components, interpolate between component ends
bridge_lines = [ln for ln, cls, br, _ in roads if br]
merged = linemerge(unary_union(bridge_lines)) if bridge_lines else None
comps = list(merged.geoms) if merged is not None and merged.geom_type == "MultiLineString" else ([merged] if merged is not None else [])
ctree = STRtree(comps)
def densify(coords, step=12.0):
    out = [coords[0]]
    for a, b in zip(coords[:-1], coords[1:]):
        d = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(d // step))
        for k in range(1, n + 1):
            out.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    return out
def line_z(coords, bridge):
    xs = np.array([c[0] for c in coords]); ys = np.array([c[1] for c in coords])
    z = sample_dmr(xs, ys).astype(np.float64)
    if bridge and comps:
        ln = LineString(coords)
        j = ctree.query(ln, predicate="intersects")
        if len(j):
            comp = max((comps[k] for k in j), key=lambda c: c.length)
            L0 = comp.length
            e0 = comp.coords[0]; e1 = comp.coords[-1]
            z0 = float(sample_dmr(e0[0], e0[1])); z1 = float(sample_dmr(e1[0], e1[1]))
            # ends on land; if an end is on water (level), lift to neighbour terrain max
            s = np.array([comp.project(Point(c)) for c in coords]) / max(L0, 1e-6)
            zb = z0 + (z1 - z0) * s
            z = np.maximum(zb, z) if L0 < 60 else np.maximum(zb, np.minimum(z, zb + 0.5))
            z = zb + 1.0  # deck slightly above ground ends
    return z

# ------------------------------------------------------------ chunks
nx, ny = math.ceil(W * RES / CHUNK), math.ceil(H * RES / CHUNK)
log("chunk grid", nx, ny)
# spatial indexes
btree = STRtree([p for p, r in BREC])
rtree = STRtree([ln for ln, *_ in roads])
wtree = STRtree(water_polys)
pois = [(pt, t) for _, pt, t in L["pois"] if pt.intersects(area_poly)]
ptree = STRtree([pt for pt, t in pois])
trees = np.array(L["trees"]) if L["trees"] else np.zeros((0, 2))
bridges_poly = [p for _, p, t in L["bridges"] if p.intersects(area_poly)]
brtree = STRtree(bridges_poly)

def q(v):
    return int(round(v * 4))   # 0.25 m units
def flat(coords, ox, oy):
    return [q(c[0] - ox) if i % 2 == 0 else q(c[1] - oy) for i, c in enumerate([(c[0], c[1]) for c in coords for _ in (0, 1)])]
def flat2(coords, ox, oy):
    out = []
    for c in coords:
        out.append(q(c[0] - ox)); out.append(q(c[1] - oy))
    return out
def rle(arr):
    out = []; prev = int(arr[0]); n = 0
    for v in arr:
        v = int(v)
        if v == prev:
            n += 1
        else:
            out.append(f"{prev}:{n}"); prev = v; n = 1
    out.append(f"{prev}:{n}")
    return ",".join(out)

index = {"chunk": CHUNK, "zstep": ZSTEP, "lcres": LCRES, "nx": nx, "ny": ny, "origin": [X0, Y0], "crs": "EPSG:5514", "lc_classes": ["ground"] + LC_ORDER, "chunks": {}}
written = 0; tot_b = 0
label_seen = set()
for cy in range(ny):
    for cx in range(nx):
        ox, oy = cx * CHUNK, cy * CHUNK
        bb = box(ox, oy, ox + CHUNK, oy + CHUNK)
        if not bb.intersects(area_poly):
            continue
        # terrain vertices 33x33 (row 0 = south edge)
        gx = np.arange(0, CHUNK + 1, ZSTEP) + ox; gy = np.arange(0, CHUNK + 1, ZSTEP) + oy
        GX, GY = np.meshgrid(gx, gy)
        zv = sample_dmr(GX.ravel(), GY.ravel())
        zq = np.round(zv * 10).astype(np.int16)
        # landcover cells 64x64 (row 0 = south)
        r0 = lcH - (oy + CHUNK) // LCRES; c0 = ox // LCRES
        cell = lc[max(r0, 0):r0 + CHUNK // LCRES, c0:c0 + CHUNK // LCRES]
        if cell.shape != (CHUNK // LCRES, CHUNK // LCRES):
            cell = np.pad(cell, ((0, CHUNK // LCRES - cell.shape[0]), (0, CHUNK // LCRES - cell.shape[1])), constant_values=255)
        cell = cell[::-1]   # south first
        if (cell == 255).all() and not bb.intersects(area_poly):
            continue
        ch = {"z0": int(zq.min()), "z": base64.b64encode((zq - zq.min()).astype(np.uint16).tobytes()).decode(), "lc": rle(cell.ravel()), "b": [], "r": [], "w": [], "t": [], "p": []}
        # buildings by centroid
        for j in btree.query(bb, predicate="intersects"):
            p, rec = BREC[j]
            c = p.centroid
            if not (ox <= c.x < ox + CHUNK and oy <= c.y < oy + CHUNK):
                continue
            ps = p.simplify(0.35, preserve_topology=True)
            if ps.is_empty or ps.geom_type != "Polygon":
                ps = p
            rings = [flat2(ps.exterior.coords[:-1], ox, oy)] + [flat2(i.coords[:-1], ox, oy) for i in ps.interiors if i.length > 8]
            rec_out = [rings, int(round(rec["h"] * 10)), int(round(rec["base"] * 10)), {"pitched": "p", "flat": "f", "dome": "d", "pointed": "o"}[rec["roof"]], rec["roofc"][0], rec["fc"], int(round(rec["minh"] * 10)), int(round(min(rec["rh"], 60) * 10))]
            if rec["inset"]:
                rec_out.append(flat2(rec["inset"][0][:-1], ox, oy)); rec_out.append(int(round(rec["inset"][1] * 10)))
            ch["b"].append(rec_out)
            tot_b += 1
        # roads clipped
        for j in rtree.query(bb, predicate="intersects"):
            ln, cls, bridge, _ = roads[j]
            g = ln.intersection(bb.buffer(2))
            geoms = list(g.geoms) if g.geom_type == "MultiLineString" else ([g] if g.geom_type == "LineString" else [])
            for seg in geoms:
                coords = densify(list(seg.coords), 10.0 if cls < 20 else 12.0)
                z = line_z(coords, bridge)
                arr = []
                for (x, y), zz in zip(coords, z):
                    arr += [q(x - ox), q(y - oy), int(round(zz * 10))]
                ch["r"].append([cls, 1 if bridge else 0, arr])
        # water polygons clipped (flat, per-vertex z)
        for j in wtree.query(bb, predicate="intersects"):
            g = water_polys[j].intersection(bb)
            geoms = list(g.geoms) if g.geom_type in ("MultiPolygon", "GeometryCollection") else [g]
            for pg in geoms:
                if pg.geom_type != "Polygon" or pg.area < 2:
                    continue
                pg = pg.simplify(0.4, preserve_topology=True)
                rings = []
                for ring in [pg.exterior] + list(pg.interiors):
                    cs = list(ring.coords[:-1])
                    z = sample_dmr(np.array([c[0] for c in cs]), np.array([c[1] for c in cs]))
                    # water surface: use the lowest sampled value in this polygon piece to avoid bank bleed
                    arr = []
                    for (x, y), zz in zip(cs, z):
                        arr += [q(x - ox), q(y - oy), int(round(zz * 10))]
                    rings.append(arr)
                ch["w"].append(rings)
        # bridge decks (man_made=bridge polygons), flat at the height of the highest vertex (the abutments)
        for j in brtree.query(bb, predicate="intersects"):
            g = bridges_poly[j].intersection(bb)
            geoms = list(g.geoms) if g.geom_type in ("MultiPolygon", "GeometryCollection") else [g]
            full = bridges_poly[j]
            zs = sample_dmr(np.array([c[0] for c in full.exterior.coords]), np.array([c[1] for c in full.exterior.coords]))
            zdeck = float(np.percentile(zs, 90)) + 0.8
            for pg in geoms:
                if pg.geom_type != "Polygon" or pg.area < 2:
                    continue
                pg = pg.simplify(0.4, preserve_topology=True)
                rings = []
                for ring in [pg.exterior] + list(pg.interiors):
                    arr = []
                    for (x, y) in list(ring.coords[:-1]):
                        arr += [q(x - ox), q(y - oy), int(round(zdeck * 10))]
                    rings.append(arr)
                ch.setdefault("bp", []).append(rings)
        # trees (mapped)
        if len(trees):
            m = (trees[:, 0] >= ox) & (trees[:, 0] < ox + CHUNK) & (trees[:, 1] >= oy) & (trees[:, 1] < oy + CHUNK)
            ch["t"] = [int(v) for xy in trees[m] for v in (q(xy[0] - ox), q(xy[1] - oy))]
        # labels
        for j in ptree.query(bb, predicate="intersects"):
            pt, t = pois[j]
            if not (ox <= pt.x < ox + CHUNK and oy <= pt.y < oy + CHUNK):
                continue
            name = t.get("name")
            if not name:
                continue
            if t.get("place") in ("suburb", "quarter", "neighbourhood", "city", "town", "village", "hamlet", "locality", "square"):
                kind = {"city": 0, "town": 0, "suburb": 1, "quarter": 2, "neighbourhood": 3, "village": 2, "hamlet": 3, "locality": 4, "square": 4}[t["place"]]
            else:
                if t.get("memorial") == "stolperstein" or t.get("historic") == "memorial" and "wikipedia" not in t:
                    continue
                notable = (t.get("tourism") in ("attraction", "museum", "viewpoint", "gallery", "zoo", "theme_park") or t.get("man_made") in ("tower", "bridge") or t.get("historic") in ("castle", "palace", "monument", "city_gate", "fort", "church", "monastery", "tower") or t.get("amenity") in ("place_of_worship", "theatre") or t.get("building") in ("church", "cathedral", "palace", "castle", "chapel", "synagogue", "monastery", "stadium") or t.get("leisure") in ("stadium",))
                if not notable or len(name) > 34:
                    continue
                kind = 5
                if t.get("railway") == "station" or t.get("station") in ("subway", "light_rail"):
                    kind = 6
            key = (name, kind)
            if key in label_seen and kind < 5:
                continue
            label_seen.add(key)
            ch["p"].append([name, q(pt.x - ox), q(pt.y - oy), kind, t.get("name:en", "")])
        # stats for the index: screen bbox needs z range
        zmin = int(zq.min()); zmax = int(zq.max())
        hmax = max([b[1] + b[2] for b in ch["b"]] + [zmax])
        index["chunks"][f"{cx}_{cy}"] = [zmin, max(hmax, zmax), len(ch["b"]), len(ch["r"])]
        with open(os.path.join(OUT, f"{cx}_{cy}.json"), "w") as f:
            json.dump(ch, f, separators=(",", ":"), ensure_ascii=False)
        written += 1
    if cy % 10 == 0:
        log(f"row {cy}/{ny} written {written} buildings {tot_b}")
json.dump(index, open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"))
log("DONE chunks", written, "buildings", tot_b)
