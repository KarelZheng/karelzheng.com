"""Download raw OSM data for Praha 1-8 via the OSM API 0.6 map call.

Boxes of 0.01 x 0.01 degrees, split adaptively when the API refuses (too many
nodes) or times out. Output: data/raw/osm/<w>_<s>_<e>_<n>.osm.gz, one per box.
Resumable: existing files are skipped.
"""
import gzip, json, math, os, sys, time, urllib.request, urllib.error
import concurrent.futures as cf
from shapely.geometry import shape, box

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(RAW, "osm")
os.makedirs(OUT, exist_ok=True)
H = {"User-Agent": "tinyprague-build/0.1 (isometric pixel map of Prague; karel.zheng@kaya.vc)"}
union = shape(json.load(open(os.path.join(RAW, "districts_geo.json")))["union"]).buffer(0.003)

STEP = 0.01
w0, s0, e0, n0 = union.bounds
cols = math.ceil((e0 - w0) / STEP)
rows = math.ceil((n0 - s0) / STEP)
boxes = []
for i in range(cols):
    for j in range(rows):
        b = (round(w0 + i * STEP, 4), round(s0 + j * STEP, 4), round(w0 + (i + 1) * STEP, 4), round(s0 + (j + 1) * STEP, 4))
        if box(*b).intersects(union):
            boxes.append(b)
print("boxes:", len(boxes), flush=True)


def fname(b):
    return os.path.join(OUT, "%.4f_%.4f_%.4f_%.4f.osm.gz" % b)


def fetch(b, depth=0):
    """Fetch one box; on 'too many nodes' split into 2 (alternating axis) and recurse."""
    f = fname(b)
    if os.path.exists(f):
        return [(b, "cached")]
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=%.4f,%.4f,%.4f,%.4f" % b
    for attempt in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=240)
            data = r.read()
            with gzip.open(f, "wb", compresslevel=6) as g:
                g.write(data)
            return [(b, len(data))]
        except urllib.error.HTTPError as e:
            body = e.read()[:200].decode("utf8", "ignore")
            if e.code == 400 and ("nodes" in body or "limit" in body) and depth < 4:
                w, s, e_, n = b
                if depth % 2 == 0:
                    halves = [(w, s, round((w + e_) / 2, 5), n), (round((w + e_) / 2, 5), s, e_, n)]
                else:
                    halves = [(w, s, e_, round((s + n) / 2, 5)), (w, round((s + n) / 2, 5), e_, n)]
                out = []
                for hb in halves:
                    out += fetch(hb, depth + 1)
                return out
            if e.code in (429, 503, 509, 502, 504):
                time.sleep(10 * (attempt + 1))
                continue
            return [(b, "HTTP %d %s" % (e.code, body))]
        except Exception as ex:  # timeouts etc.
            time.sleep(5 * (attempt + 1))
            last = ex
    return [(b, "FAILED %s" % last)]


done = 0
total_bytes = 0
t0 = time.time()
with cf.ThreadPoolExecutor(int(os.environ.get("PAR", "3"))) as ex:
    for res in ex.map(fetch, boxes):
        for b, r in res:
            done += 1
            if isinstance(r, int):
                total_bytes += r
            elif r != "cached":
                print("ERR", b, r, flush=True)
        if done % 10 == 0:
            print("progress %d boxes, %.0f MB, %.0fs" % (done, total_bytes / 1e6, time.time() - t0), flush=True)
print("DONE boxes=%d bytes=%.0fMB time=%.0fs" % (done, total_bytes / 1e6, time.time() - t0), flush=True)
