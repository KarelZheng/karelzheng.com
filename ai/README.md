# Tiny Prague, AI route: runbook

Goal: the isometric.nyc / tiny.london look for Praha 1-8: a fine-tuned image model redraws orthographic
Google 3D Tiles renders as pixel art, stitched into one gigapixel canvas, served as a Deep Zoom pyramid.

This folder is the Prague-specific layer on top of two public projects:

* `cannoneyed/isometric-nyc` (MIT): renderer for Google 3D Tiles, Gemini teacher notebook, quadrant database,
  generation app with the no-seam infill rules, Modal inference server, DZI export, OpenSeadragon viewer.
  Clone it next to this repo; everything below refers to it as `nyc/`.
* `ostris/ai-toolkit` (MIT): LoRA trainer, used through `train_lora_modal.py`.

## What exists and what state it is in

| Piece | File | Needs | Status |
|---|---|---|---|
| Prague generation config (seed, 84x49 tiles, camera) | `out/generation_config.json` | nothing | generated, used by `nyc/` as-is |
| District boundary polygon for the bounds app | `out/bounds_praha1-8.json` | nothing | generated |
| Teacher frame list (1,472 frames + 396 zoomed landmarks) | `out/frames.csv` | nothing | generated |
| 3D Tiles orthographic renderer | `nyc/src/isometric_nyc/generation/web_renderer.py` | `GOOGLE_MAPS_API_KEY` (Map Tiles API enabled) | tested upstream |
| Gemini teacher drawings | `nyc/src/notebooks/nano-banana.py` + prompt below | `GEMINI_API_KEY` | tested upstream; prompt swapped to prague |
| Dataset filtering (structure, flat-fill, water) | `filter_pairs.py` (to write; rules below) | nothing | not written |
| LoRA training on H100 | `train_lora_modal.py` | Modal account, `HF_TOKEN` | written, not run |
| Inference A: infill quadrants (nyc app) | `nyc/inference/server.py` + generation app | Modal | tested upstream |
| Inference B: joint sampler, no seams | `joint_sampler.py` | Modal | draft, needs one GPU debugging session |
| Viewer | `nyc/src/app` (OpenSeadragon) + `export_dzi.py` | R2 or any static host | tested upstream |

## Step by step

### 0. Keys and accounts
* Google Maps Platform: enable **Map Tiles API** (Photorealistic 3D Tiles). Put the key in `nyc/.env` as `GOOGLE_MAPS_API_KEY`.
* Gemini API key with access to the image model (Nano Banana Pro / `gemini-3-pro-image`): `GEMINI_API_KEY`.
* Modal: `pip install modal && modal setup`. Create secret `huggingface` with `HF_TOKEN`.
* Budget, whole Praha 1-8: Gemini ~1,900 calls, with retries ~2,800, about $250-400. H100 on Modal: training ~4 h, inference 3-6 h with the joint sampler (138 km2 is 9% of Greater London's 31 h), 10+ h of experiments: $80-150. 3D Tiles: usually inside the free tier for ~2k renders.

### 1. Seed the quadrant database and render the reference layer
```bash
cd nyc
cp ../tinyprague/ai/out/generation_config.json generations/praha/generation_config.json
uv run python src/isometric_nyc/generation/seed_tiles.py generations/praha
uv run python src/isometric_nyc/generation/create_bounds.py generations/praha --load ../tinyprague/ai/out/bounds_praha1-8.json
# one quadrant render to check the camera (Playwright + three.js, orthographic, azimuth -15, elevation -45):
uv run python src/isometric_nyc/generation/render_tile.py generations/praha 0 0
# bulk: the automatic plan renders and generates as it goes; `--max-steps 0` style dry runs exist, see its --help
uv run python src/isometric_nyc/generation/automatic_generation.py generations/praha --top-left -84,-49 --bottom-right 84,49 --visualize
uv run python src/isometric_nyc/generation/debug_map.py generations/praha
```
Sanity check: open `generations/praha/debug_map.png`. Vltava, the islands and Petrin should be obvious.
Note: `render_tile.py` takes quadrant x y relative to the seed; the bounds polygon limits the plan.

### 2. Teacher dataset with Gemini
Render each row of `out/frames.csv` at 1024 px (`web_renderer.py` takes lat, lng, view_height). Then redraw it
with the notebook `src/notebooks/nano-banana.py`, prompt:

```
Redraw this aerial render of Prague as isometric pixel art in the <isometric prague pixel art> style:
hard pixels, limited palette, 1 px dark outlines, red clay tiled roofs on the old city, copper roofs on
churches, pale ochre and cream facades, the Vltava flat and blue. Keep every building, street, bridge
and park exactly where it is in the render. No people, no vehicles, no text.
```
tiny.london's filters, which rejected 31% of attempts, to reimplement in `filter_pairs.py`:
* structure: edge map of output vs edge map of render, keep if IoU of dilated edges > 0.45
* flat-fill share: fraction of pixels in runs of identical colour >= 4 px must be > 0.6 (pixel art, not a painting)
* water: pixels inside OSM water polygons (we have them in `data/work/layers.pkl`) must be blue-ish in > 80% of the area
Up to 3 redraws per frame; drop the frame after that.
Then build the infill training pairs with `nyc/src/isometric_nyc/synthetic_data/create_omni_dataset.py`
(mix of full / quadrant / half / strip / rectangle infills, red 1 px border on the input region, optional
desaturation + noise + gamma crush on the render) at 1024 and 512 px. Expect ~6k examples.
Layout for the trainer: `ai/dataset/controls/<id>.png`, `ai/dataset/targets/<id>.png`, `ai/dataset/targets/<id>.txt`
holding the prompt `Fill in the outlined section with the missing pixels corresponding to the <isometric prague pixel art> style, removing the border and exactly following the shape/style/structure of the surrounding image (if present).`

### 3. Train
```bash
modal volume create tinyprague-data
modal volume put tinyprague-data ai/dataset /dataset
modal run ai/train_lora_modal.py --base edit --steps 8000      # ~4 h on one H100
modal volume get tinyprague-data /output/tiny-prague-v1 ./lora
```
Check the samples it writes every 1000 steps. Water and trees are where both predecessors struggled; if water
comes out textured, add more water frames (there are 68 in `frames.csv`; raise `STEP` sampling near water).

### 4. Generate
Route A (works today, more manual review): upload the LoRA to the Modal volume per `nyc/inference/README.md`,
`modal deploy nyc/inference/server.py`, set `MODAL_INFERENCE_URL`, then use the generation app
(`uv run python src/isometric_nyc/generation/app.py`) with `Gen Rect` and the strip plan. ~16k quadrants at
200/h is ~80 GPU-hours; this is the expensive route and the reason tiny.london wrote the joint sampler.

Route B (seamless, 5-10x cheaper): finish `joint_sampler.py` on an H100 (three `CHECK` lines are the
diffusers API points), run blocks of 12,288 px in four parity phases over the full reference render,
write 512 px tiles, then repair water with the mask-and-Poisson-blend trick.

### 5. Viewer
`uv run python src/isometric_nyc/generation/export_dzi.py` then `cd src/app && bun run build`. Host the DZI
folder on R2 (immutable cache headers, one folder per version). The procedural map in `../web` can stay as a
fallback layer or a toggle.

## Licences, so nobody is surprised later
* Qwen-Image-Edit: Apache-2.0. Qwen-Image-2.1-Turbo: Qwen Research License (non-commercial).
* Training targets come from Gemini; Google's generative terms apply to the drawings.
* Map imagery is derived from Google Photorealistic 3D Tiles; attribution required, and this is a grey zone
  both predecessors chose to accept. OSM data is ODbL. CUZK elevation is open data with attribution.
