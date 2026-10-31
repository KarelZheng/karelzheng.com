"""Add lon/lat reference points to index.json, build labels.json (search index incl. streets)."""
import json, os, glob, pickle
from pyproj import Transformer
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=os.path.join(ROOT,"data","chunks")
idx=json.load(open(os.path.join(OUT,"index.json"))); X0,Y0=idx["origin"]
tr=Transformer.from_crs("EPSG:4326","EPSG:5514",always_xy=True)
ref=[]
for lon in (14.22,14.36,14.51):
    for lat in (50.01,50.08,50.16):
        x,y=tr.transform(lon,lat); ref.append([lon,lat,x-X0,y-Y0])
idx["ref"]=ref
json.dump(idx,open(os.path.join(OUT,"index.json"),"w"),separators=(",",":"))
labels=[]; seen=set()
for f in glob.glob(os.path.join(OUT,"*_*.json")):
    cx,cy=map(int,os.path.basename(f)[:-5].split("_")); ch=json.load(open(f))
    for name,x,y,kind,en in ch["p"]:
        key=(name,kind)
        if key in seen: continue
        seen.add(key); labels.append([name,cx*256+x/4,cy*256+y/4,kind,en])
# streets: named highways, one entry per name (centroid of longest way)
L=pickle.load(open(os.path.join(ROOT,"data","work","layers.pkl"),"rb"))
best={}
for wid,ln,t in L["roads"]:
    n=t.get("name")
    if not n or t.get("highway") in ("footway","path","steps","service","track","cycleway"): continue
    if n not in best or ln.length>best[n][0]: best[n]=(ln.length,ln)
for n,(l,ln) in best.items():
    c=ln.interpolate(0.5,normalized=True); labels.append([n,round(c.x,1),round(c.y,1),7,""])
labels.sort(key=lambda p:(p[3],p[0]))
json.dump(labels,open(os.path.join(OUT,"labels.json"),"w"),separators=(",",":"),ensure_ascii=False)
print("labels",len(labels),"ref",len(ref))

# district outline + Vltava for the minimap
from shapely.geometry import shape as _shape
from shapely.ops import unary_union as _uu
import shapely
D=json.load(open(os.path.join(ROOT,"data","raw","districts_geo.json")))
def _proj(g): return shapely.transform(g, lambda a: __import__("numpy").column_stack(tr.transform(a[:,0],a[:,1]))-__import__("numpy").array([X0,Y0]))
out={"districts":{},"union":None}
for k,v in D["districts"].items():
    g=_proj(_shape(v)).simplify(25); g=g if g.geom_type=="Polygon" else max(g.geoms,key=lambda a:a.area); out["districts"][k]=[[round(x),round(y)] for x,y in g.exterior.coords]
u=_proj(_shape(D["union"])).simplify(25); u=u if u.geom_type=="Polygon" else max(u.geoms,key=lambda a:a.area); out["union"]=[[round(x),round(y)] for x,y in u.exterior.coords]
w=_uu([p for _,p,c,t in L["lands"] if c=="water" and p.area>20000]).simplify(20)
out["water"]=[[[round(x),round(y)] for x,y in g.exterior.coords] for g in (w.geoms if w.geom_type=="MultiPolygon" else [w]) if g.area>20000]
json.dump(out,open(os.path.join(OUT,"outline.json"),"w"),separators=(",",":")); print("outline written")
