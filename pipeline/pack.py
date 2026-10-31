"""Pack 256 m chunks into 4x4 groups for hosting (fewer files)."""
import json, os, glob, shutil
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=os.path.join(ROOT,"data","chunks"); PK=os.path.join(ROOT,"data","packs"); os.makedirs(PK,exist_ok=True)
for f in glob.glob(PK+"/*.json"): os.remove(f)
packs={}
for f in glob.glob(OUT+"/*_*.json"):
    cx,cy=map(int,os.path.basename(f)[:-5].split("_")); packs.setdefault(f"{cx>>2}_{cy>>2}",{})[f"{cx}_{cy}"]=json.load(open(f))
for k,v in packs.items(): json.dump(v,open(f"{PK}/{k}.json","w"),separators=(",",":"),ensure_ascii=False)
idx=json.load(open(OUT+"/index.json")); idx["pack"]=4; json.dump(idx,open(PK+"/index.json","w"),separators=(",",":"))
shutil.copy(OUT+"/labels.json",PK+"/labels.json"); shutil.copy(OUT+"/outline.json",PK+"/outline.json"); print("packs",len(packs))
