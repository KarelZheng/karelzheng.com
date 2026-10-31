"""Export DMR 5G (terrain) and DMP (surface) from CUZK for the Praha 1-8 bbox at 2 m, EPSG:5514."""
import json, os, urllib.request, urllib.parse, math
from pyproj import Transformer
from shapely.geometry import shape
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); RAW=os.path.join(ROOT,"data","raw"); OUT=os.path.join(RAW,"elev"); os.makedirs(OUT,exist_ok=True)
u=shape(json.load(open(os.path.join(RAW,"districts_geo.json")))["union"]).buffer(0.004)
tr=Transformer.from_crs("EPSG:4326","EPSG:5514",always_xy=True)
w,s,e,n=u.bounds
xs,ys=zip(*[tr.transform(lon,lat) for lon,lat in [(w,s),(w,n),(e,s),(e,n)]])
RES=2.0
x0=math.floor(min(xs)/RES)*RES; y0=math.floor(min(ys)/RES)*RES; x1=math.ceil(max(xs)/RES)*RES; y1=math.ceil(max(ys)/RES)*RES
W=int((x1-x0)/RES); H=int((y1-y0)/RES)
print("grid",W,H,"origin",x0,y0,flush=True)
json.dump({"res":RES,"x0":x0,"y0":y0,"x1":x1,"y1":y1,"W":W,"H":H,"crs":"EPSG:5514"},open(os.path.join(OUT,"grid.json"),"w"))
MAXH=4000
for svc in ["dmr5g","dmp"]:
    for i,yy in enumerate(range(0,H,MAXH)):
        h=min(MAXH,H-yy); ya=y1-(yy+h)*RES; yb=y1-yy*RES   # rows from top
        f=os.path.join(OUT,f"{svc}_{i}.tif")
        if os.path.exists(f) and os.path.getsize(f)>1e6: print("cached",f,flush=True); continue
        q=urllib.parse.urlencode({"f":"json","bbox":f"{x0},{ya},{x1},{yb}","bboxSR":5514,"imageSR":5514,"size":f"{W},{h}","format":"tiff","pixelType":"F32","noData":"-9999","interpolation":"RS_BilinearInterpolation"})
        d=json.load(urllib.request.urlopen(f"https://ags.cuzk.cz/arcgis/rest/services/3D/{svc}/ImageServer/exportImage?{q}",timeout=600))
        if "href" not in d: print("ERR",svc,i,d,flush=True); continue
        data=urllib.request.urlopen(d["href"],timeout=900).read(); open(f,"wb").write(data)
        print(svc,i,"rows",yy,yy+h,"MB",round(len(data)/1e6,1),flush=True)
print("DONE",flush=True)
