"""Parse the downloaded OSM boxes into deduplicated, projected feature layers.

Output: data/work/layers.pkl with shapely geometries in local metres
(EPSG:5514 minus the elevation grid origin, so x east, y north).
"""
import glob, gzip, json, os, pickle, sys, time
import xml.etree.ElementTree as ET
import numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import linemerge, polygonize, unary_union
from shapely.validation import make_valid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
WORK = os.path.join(ROOT, "data", "work")
os.makedirs(WORK, exist_ok=True)
grid = json.load(open(os.path.join(RAW, "elev", "grid.json")))
X0, Y0 = grid["x0"], grid["y0"]
tr = Transformer.from_crs("EPSG:4326", "EPSG:5514", always_xy=True)

t0 = time.time()
# ---------------------------------------------------------------- pass 1: parse
node_lon, node_lat, node_ids = [], [], []
node_tags = {}          # id -> tags (only tagged nodes)
ways = {}               # id -> (refs list, tags dict)
rels = {}               # id -> (members list, tags)
seen_nodes = set()
KEEP_NODE_KEYS = {"place", "natural", "tourism", "historic", "amenity", "man_made", "railway", "name", "wikipedia", "wikidata", "height", "leisure", "shop", "public_transport", "station", "subway", "tram", "ele"}
KEEP_WAY_PREFIX = ("building", "roof", "height", "min_height", "name", "highway", "railway", "waterway", "natural", "landuse", "leisure", "amenity", "man_made", "bridge", "tunnel", "layer", "area", "wikipedia", "wikidata", "tourism", "historic", "colour", "material", "oneway", "lanes", "service", "sport", "religion", "place", "water", "barrier", "aeroway", "power", "level", "location", "covered", "tracktype", "parking", "embankment", "cutting", "public_transport", "attraction")
files = sorted(glob.glob(os.path.join(RAW, "osm", "*.osm.gz")))
for fi, f in enumerate(files):
    with gzip.open(f, "rb") as fh:
        for ev, el in ET.iterparse(fh, events=("end",)):
            tag = el.tag
            if tag == "node":
                nid = int(el.get("id"))
                if nid not in seen_nodes:
                    seen_nodes.add(nid)
                    node_ids.append(nid); node_lon.append(float(el.get("lon"))); node_lat.append(float(el.get("lat")))
                    tg = {t.get("k"): t.get("v") for t in el if t.tag == "tag"}
                    if tg and any(k in KEEP_NODE_KEYS for k in tg):
                        node_tags[nid] = tg
                el.clear()
            elif tag == "way":
                wid = int(el.get("id"))
                if wid not in ways:
                    refs = [int(nd.get("ref")) for nd in el if nd.tag == "nd"]
                    tg = {t.get("k"): t.get("v") for t in el if t.tag == "tag" and t.get("k").startswith(KEEP_WAY_PREFIX)}
                    ways[wid] = (refs, tg)
                el.clear()
            elif tag == "relation":
                rid = int(el.get("id"))
                if rid not in rels:
                    mem = [(m.get("type"), int(m.get("ref")), m.get("role") or "") for m in el if m.tag == "member"]
                    tg = {t.get("k"): t.get("v") for t in el if t.tag == "tag"}
                    rels[rid] = (mem, tg)
                el.clear()
    if fi % 40 == 0:
        print(f"parsed {fi+1}/{len(files)} files: nodes={len(node_ids)} ways={len(ways)} rels={len(rels)} {time.time()-t0:.0f}s", flush=True)
seen_nodes = None
print(f"parse done nodes={len(node_ids)} ways={len(ways)} rels={len(rels)} tagged_nodes={len(node_tags)} {time.time()-t0:.0f}s", flush=True)

# ---------------------------------------------------------------- project
lon = np.array(node_lon, dtype=np.float64); lat = np.array(node_lat, dtype=np.float64)
ex, ny = tr.transform(lon, lat)
ex = (ex - X0).astype(np.float32); ny = (ny - Y0).astype(np.float32)
idx = {nid: i for i, nid in enumerate(node_ids)}
node_lon = node_lat = node_ids = None
print("projected", time.time() - t0, flush=True)


def way_coords(refs):
    ii = [idx[r] for r in refs if r in idx]
    if len(ii) < 2:
        return None
    return np.stack([ex[ii], ny[ii]], axis=1)


def ring_poly(coords):
    if coords is None or len(coords) < 4:
        return None
    try:
        p = Polygon(coords)
        if not p.is_valid:
            p = make_valid(p)
            if p.geom_type == "MultiPolygon":
                p = max(p.geoms, key=lambda g: g.area)
            elif p.geom_type != "Polygon":
                polys = [g for g in getattr(p, "geoms", []) if g.geom_type == "Polygon"]
                if not polys:
                    return None
                p = max(polys, key=lambda g: g.area)
        return p if p.area > 0.5 else None
    except Exception:
        return None


def rel_multipolygon(members):
    outers, inners = [], []
    for mt, ref, role in members:
        if mt != "way" or ref not in ways:
            continue
        c = way_coords(ways[ref][0])
        if c is None:
            continue
        (inners if role == "inner" else outers).append(LineString(c))
    if not outers:
        return None
    try:
        op = list(polygonize(linemerge(outers) if len(outers) > 1 else outers[0]))
        if not op:
            return None
        g = unary_union(op)
        if inners:
            ip = list(polygonize(linemerge(inners) if len(inners) > 1 else inners[0]))
            if ip:
                g = g.difference(unary_union(ip))
        if not g.is_valid:
            g = make_valid(g)
        if g.is_empty:
            return None
        return g
    except Exception:
        return None


# ---------------------------------------------------------------- classify
def is_area(tags, closed):
    if not closed:
        return False
    if tags.get("area") == "no":
        return False
    if "highway" in tags and tags.get("area") != "yes" and tags["highway"] not in ("pedestrian", "services", "rest_area"):
        return False
    if "railway" in tags and tags.get("area") != "yes" and tags["railway"] != "platform":
        return False
    if "barrier" in tags and tags.get("area") != "yes":
        return False
    return True


WATER_CLASSES = ("water", "riverbank", "reservoir", "basin")


def landclass(t):
    """Return land cover class id or None. Higher priority classes come later in draw order (handled in build)."""
    if t.get("natural") in ("water",) or t.get("waterway") in ("riverbank", "dock") or t.get("landuse") in ("reservoir", "basin") or t.get("leisure") == "swimming_pool":
        return "water"
    if t.get("natural") in ("wood",) or t.get("landuse") == "forest":
        return "forest"
    if t.get("natural") in ("scrub", "heath"):
        return "scrub"
    if t.get("landuse") in ("vineyard", "orchard"):
        return "vineyard"
    if t.get("landuse") in ("farmland", "farmyard"):
        return "farmland"
    if t.get("landuse") == "cemetery" or t.get("amenity") == "grave_yard":
        return "cemetery"
    if t.get("leisure") in ("pitch", "stadium", "track"):
        return "pitch"
    if t.get("leisure") in ("playground", "sports_centre", "golf_course", "miniature_golf", "dog_park") or t.get("landuse") == "recreation_ground":
        return "grass"
    if t.get("leisure") in ("park", "garden") or t.get("landuse") in ("grass", "meadow", "village_green", "greenfield", "flowerbed", "plant_nursery", "allotments") or t.get("natural") in ("grassland",):
        return "grass"
    if t.get("landuse") == "railway":
        return "railyard"
    if t.get("landuse") in ("industrial", "commercial", "retail", "construction", "brownfield", "garages", "depot", "military", "quarry", "landfill"):
        return "industrial"
    if t.get("amenity") in ("parking",) or t.get("aeroway") in ("apron", "runway", "taxiway", "aerodrome"):
        return "asphalt"
    if t.get("natural") in ("bare_rock", "scree", "cliff", "sand", "beach"):
        return "rock"
    if t.get("highway") == "pedestrian" or t.get("place") == "square" or t.get("amenity") in ("marketplace",):
        return "plaza"
    if t.get("landuse") in ("residential",) or t.get("amenity") in ("school", "university", "hospital", "college", "kindergarten") or t.get("leisure") == "nature_reserve":
        return None  # too broad to colour
    return None


buildings, parts, lands, roads, rails, streams, pois, trees, bridges = [], [], [], [], [], [], [], [], []
nway = 0
for wid, (refs, t) in ways.items():
    if not t:
        continue
    closed = len(refs) > 3 and refs[0] == refs[-1]
    c = way_coords(refs)
    if c is None:
        continue
    if "building" in t and t["building"] != "no" and closed:
        p = ring_poly(c)
        if p is not None:
            buildings.append((wid, p, t))
    elif "building:part" in t and t["building:part"] != "no" and closed:
        p = ring_poly(c)
        if p is not None:
            parts.append((wid, p, t))
    if "highway" in t and not is_area(t, closed):
        roads.append((wid, LineString(c), t))
    elif "railway" in t and t["railway"] in ("rail", "tram", "light_rail", "narrow_gauge", "funicular", "subway") and not is_area(t, closed):
        rails.append((wid, LineString(c), t))
    elif "waterway" in t and t["waterway"] in ("river", "stream", "canal", "ditch", "drain") and not closed:
        streams.append((wid, LineString(c), t))
    if t.get("man_made") == "bridge" and closed:
        p = ring_poly(c)
        if p is not None:
            bridges.append((wid, p, t))
    if is_area(t, closed):
        lc = landclass(t)
        if lc:
            p = ring_poly(c)
            if p is not None:
                lands.append((wid, p, lc, t))
    if closed and ("name" in t) and (("wikipedia" in t) or ("wikidata" in t) or t.get("tourism") in ("attraction", "viewpoint", "museum") or t.get("historic") or t.get("amenity") == "place_of_worship" or t.get("man_made") in ("tower",)):
        p = ring_poly(c)
        if p is not None:
            pois.append((wid, p.representative_point(), t))
    nway += 1
print(f"ways classified: bld={len(buildings)} parts={len(parts)} lands={len(lands)} roads={len(roads)} rails={len(rails)} streams={len(streams)} bridges={len(bridges)} {time.time()-t0:.0f}s", flush=True)

for rid, (mem, t) in rels.items():
    if t.get("type") != "multipolygon" and t.get("type") != "building":
        continue
    g = None
    if "building" in t and t["building"] != "no":
        g = rel_multipolygon(mem)
        if g is not None:
            for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
                if p.geom_type == "Polygon" and p.area > 0.5:
                    buildings.append((-rid, p, t))
    elif "building:part" in t and t["building:part"] != "no":
        g = rel_multipolygon(mem)
        if g is not None:
            for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
                if p.geom_type == "Polygon" and p.area > 0.5:
                    parts.append((-rid, p, t))
    lc = landclass(t)
    if lc:
        g = rel_multipolygon(mem)
        if g is not None:
            for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
                if p.geom_type == "Polygon" and p.area > 0.5:
                    lands.append((-rid, p, lc, t))
    if t.get("man_made") == "bridge":
        g = rel_multipolygon(mem)
        if g is not None:
            for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
                if p.geom_type == "Polygon":
                    bridges.append((-rid, p, t))
print(f"with relations: bld={len(buildings)} parts={len(parts)} lands={len(lands)} bridges={len(bridges)} {time.time()-t0:.0f}s", flush=True)

for nid, t in node_tags.items():
    i = idx.get(nid)
    if i is None:
        continue
    pt = (float(ex[i]), float(ny[i]))
    if t.get("natural") == "tree":
        trees.append(pt)
    elif t.get("place") in ("suburb", "quarter", "neighbourhood", "city", "town", "village", "hamlet", "locality", "square") and "name" in t:
        pois.append((nid, Point(pt), t))
    elif "name" in t and (("wikipedia" in t) or ("wikidata" in t) or t.get("tourism") in ("attraction", "viewpoint", "museum", "artwork") or t.get("historic") in ("monument", "memorial", "castle", "church", "tower", "city_gate") or t.get("man_made") in ("tower",) or t.get("railway") == "station" or t.get("station") in ("subway", "light_rail")):
        pois.append((nid, Point(pt), t))
print(f"nodes: trees={len(trees)} pois={len(pois)} {time.time()-t0:.0f}s", flush=True)

pickle.dump({"buildings": buildings, "parts": parts, "lands": lands, "roads": roads, "rails": rails, "streams": streams, "pois": pois, "trees": trees, "bridges": bridges}, open(os.path.join(WORK, "layers.pkl"), "wb"), protocol=5)
print("saved", time.time() - t0, flush=True)
