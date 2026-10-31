# Tiny Prague

Isometric pixel-art map of Praha 1-8, drawn procedurally in the browser. Inspired by isometric.nyc and tiny.london.

```
pipeline/   data build (Python): OSM download, parse, rasters, chunk build, overview tile bake
web/        the site: index.html + iso.js (renderer, no dependencies) + chunks/ (data) + tiles/ (baked overview)
ai/         the AI route (nano banana teacher set, Qwen LoRA, joint sampler): config generated, runbook in ai/README.md
data/       raw downloads (not in the zip), work files, chunks, packs
```

## How the map is made

1. `pipeline/fetch_osm.py`: OSM API map calls over Praha 1-8 in 0.01 degree boxes (262 boxes, 1 GB XML).
2. `pipeline/fetch_elevation.py`: CUZK DMR 5G (terrain) and DMP (surface) at 2 m via the ArcGIS ImageServer, EPSG:5514.
3. `pipeline/parse_osm.py`: dedupe, project to Krovak, classify into buildings, parts, land cover, roads, rails, streams, bridges, labels, trees.
4. `pipeline/build_chunks.py`: building heights = median(DMP - DMR) over each footprint when OSM has no `height`
   (OSM `building:levels=1` placeholders are common in Prague and are ignored when the raster is available);
   base = 15th percentile of terrain under the footprint; outlines that contain 3D parts or other buildings are
   not extruded; roof type from `roof:shape` or a historic-core heuristic; hipped-roof ridge ring from a negative
   buffer; land cover rasterised at 4 m; terrain vertices every 8 m; roads densified to 10 m and draped; bridges
   elevated by interpolating between the merged bridge component's ends; water polygons keep per-vertex terrain
   z (DMR is flat on water, with steps at the weirs). Output: 256 m chunks (json), packed 4x4 for hosting.
5. `pipeline/prerender.js`: bakes the two lowest zoom levels to PNG tiles through the page's own renderer.

## Renderer (web/iso.js)

2:1 isometric projection, x east, y north, z up: `sx = (x + y) S`, `sy = ((x - y) / 2 - 0.85 z) S`.
Screen-space 512 px tiles rendered on demand and cached per zoom level (S = 4, 2, 1, 0.5, 0.25, 0.125 px/m).
Each tile gathers items from the chunks whose projected bbox intersects it, sorts by depth key (x - y of the
front-most point), and paints: terrain quads with per-corner elevation and slope shading, water strips,
bridge decks, road quads with round joints, buildings (visible walls, windows per floor, roof faces with hips,
domes, spires), tree sprites (mapped trees plus hashed synthetic ones in forest/park cells). Large flat polygons
and large buildings are split into 12-16 m depth strips so painter's order holds. After painting, every pixel is
snapped to the palette, which turns Canvas anti-aliasing into hard pixel edges.

## Run locally

```
cd web && python3 -m http.server 8765     # chunks/ -> ../data/packs (symlink), tiles/ baked
```
Rebuild data: `python3 pipeline/fetch_osm.py && python3 pipeline/fetch_elevation.py && python3 pipeline/parse_osm.py && python3 pipeline/build_chunks.py && python3 pipeline/postbuild.py`, then pack (see `pipeline/pack.py`) and `node pipeline/prerender.js`.

Data: OpenStreetMap contributors (ODbL); elevation CUZK DMR 5G and DMP (open data, attribution).
