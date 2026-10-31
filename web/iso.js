/* Tiny Prague: isometric pixel-art renderer. Vanilla Canvas 2D, no dependencies.
   World: local metres, x east, y north, z metres above sea (stored as dm). Screen (scale S px/m):
   sx = (x + y) * S ; sy = ((x - y) / 2 - z * ZF) * S. Depth (painter key) = x - y. */
'use strict';
const ZF = 0.85;
const TILE = 512;
const DATA = (window.TP_DATA_BASE || 'chunks/');

// ---------------------------------------------------------------- palette
const PAL = {
  bg: '#dcd3bf', void: '#d8cfbb',
  ground: ['#cfc6b5', '#c7bda9'], industrial: ['#bfb8ac', '#b6afa2'], asphalt: ['#a9a59c', '#9f9b92'],
  farmland: ['#d9c48a', '#c9b376'], grass: ['#9cc46f', '#8fb862'], scrub: ['#8fb46a', '#7fa45c'],
  vineyard: ['#9dc06a', '#6f9448'], cemetery: ['#a3c080', '#95b374'], pitch: ['#86c26a', '#7ab45e'],
  forest: ['#5f9148', '#4f7d3b'], plaza: ['#d3c7ae', '#c8bba0'], railyard: ['#b7ad9a', '#a89e8b'], rock: ['#bdb2a0', '#a89d8b'],
  water: ['#5a93b4', '#6fa7c5', '#4a7e9c'],
  road: { 1: ['#7d7d7f', '#f1d87a'], 2: ['#858587', '#f1d87a'], 3: ['#8a8a8c', '#f3eedb'], 4: ['#90908f', '#f3eedb'], 5: ['#979795', '#f3eedb'], 6: ['#a19f9b', null], 7: ['#c9bea6', null], 8: ['#aaa8a3', null], 9: ['#b9a78a', null], 10: ['#c6b995', null], 11: ['#c0b391', null],
    20: ['#6e665e', '#9d948a'], 21: ['#8d8782', '#5a534d'], 22: ['#6e665e', '#9d948a'], 30: ['#5b9cc9', null], 31: ['#6aa9d3', null] },
  bridge: '#8a8580', bridgeEdge: '#5e5a56',
  facade: [ // [south face, east face, outline]
    ['#f1e2c3', '#d9c7a4', '#9a8667'], ['#e9d6b1', '#cdb88f', '#8f7a57'], ['#f3dcc6', '#dcbfa3', '#9c7f66'],
    ['#dfe3c4', '#c3c9a3', '#808a63'], ['#d8e1e6', '#bac7cf', '#7a8b96'], ['#f6efdf', '#dad2bf', '#98917f'],
    ['#e6cfa6', '#cbb084', '#8c7452'], ['#efe6d2', '#d2c7b0', '#8e836a'] /* church */,
    ['#c9c3b8', '#aea89d', '#6f6a62'], ['#b9b5ad', '#9e9a92', '#605c56'] /* industrial */,
    ['#d6d3cc', '#b9b6af', '#74716a'], ['#dcd1c0', '#bfb4a2', '#7a7062'], ['#c8d0d4', '#a8b1b6', '#6a7378'] /* modern */,
    ['#f4e6b4', '#d8c88f', '#97875a'] /* yellow */, ['#f2d2c4', '#d6b4a4', '#977466'] /* salmon */, ['#dde6d3', '#bfcab2', '#7d8a70'] /* mint */,
    ['#efe1cf', '#d1c1ab', '#8f806a'] /* beige */, ['#f7f1e6', '#dcd4c6', '#9a9284'] /* white */ ],
  roof: { r: ['#c2583a', '#d5704f', '#8a3a24'], s: ['#6f7378', '#868a90', '#44474b'], c: ['#5f9a86', '#79b29d', '#3c6b5c'], g: ['#9c9a94', '#aaa8a1', '#66645f'], l: ['#9fb9c4', '#c0d6de', '#5f7c88'] },
  roofRed: [['#c2583a', '#d5704f', '#8a3a24'], ['#b34f30', '#c86744', '#7d3520'], ['#cf6948', '#e08361', '#95452b'], ['#a9492d', '#bf5f3f', '#73301d'], ['#c65f3e', '#d87a57', '#8c3f26']],
  tree: ['#3f7a35', '#5d9a47', '#2c5a26', '#5a3d26'], shrub: ['#6d9c4a', '#86b35e'],
  label: '#2b2a28', labelHalo: 'rgba(240,232,214,0.9)'
};
const LC_NAMES = ['ground', 'industrial', 'asphalt', 'farmland', 'grass', 'scrub', 'vineyard', 'cemetery', 'pitch', 'forest', 'plaza', 'railyard', 'rock', 'water'];
const ROAD_W = { 1: 14, 2: 8, 3: 12, 4: 9, 5: 8, 6: 6.5, 7: 5, 8: 4, 9: 3, 10: 2.2, 11: 2.2, 20: 3.2, 21: 2.6, 22: 3, 30: 7, 31: 3 };

function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function shade(hex, f) { const [r, g, b] = hexToRgb(hex); const c = v => Math.max(0, Math.min(255, Math.round(v * f))); return '#' + [c(r), c(g), c(b)].map(v => v.toString(16).padStart(2, '0')).join(''); }

// palette snap table (built lazily from every colour we fill with)
const PALETTE = new Set();
function reg(c) { if (c && c[0] === '#') PALETTE.add(c); return c; }
(function collect(o) { for (const k in o) { const v = o[k]; if (typeof v === 'string') reg(v); else if (typeof v === 'object') collect(v); } })(PAL);
for (const f of PAL.facade) { reg(shade(f[0], 0.9)); reg(shade(f[1], 0.9)); reg(shade(f[0], 0.62)); reg(shade(f[1], 0.62)); }
for (const k in PAL.roof) { reg(shade(PAL.roof[k][0], 0.85)); }
for (const r of PAL.roofRed) { for (const c of r) reg(c); reg(shade(r[0], 0.85)); }
for (const c of [...PALETTE]) { for (const f of [0.4, 0.42, 0.45, 0.5, 0.6]) reg(shade(c, f)); }
for (const c of ['#1f3d5a', '#17304a', '#141a22', '#f6d77a', '#5a5040', '#213f1f', '#2d4f29', '#162a16', '#2a1d12', '#3a3734', '#2e2b28']) reg(c);
for (const c of [...PALETTE]) { reg(shade(c, 0.32)); reg(shade(c, 0.72)); reg(shade(c, 0.8)); reg(shade(shade(c, 0.88), 0.72)); reg(shade(shade(c, 1.07), 0.72)); }
let palRgb = [...PALETTE].map(hexToRgb);
let palInt = palRgb.map(([r, g, b]) => (r << 16) | (g << 8) | b);
const snapCache = new Map();
function regDynamic(c) { // colour from data: add to the snap palette (plus the shades the renderer derives)
  if (!c || PALETTE.has(c)) return;
  for (const f of [1, 0.9, 0.85, 0.62, 0.5, 0.42, 0.4, 0.32]) { const v = f === 1 ? c : shade(c, f); if (!PALETTE.has(v)) { PALETTE.add(v); const rgb = hexToRgb(v); palRgb.push(rgb); palInt.push((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]); } }
  snapCache.clear();
}
function snapNearest(rgbInt) {
  let v = snapCache.get(rgbInt); if (v !== undefined) return v;
  const r = rgbInt >> 16, g = (rgbInt >> 8) & 255, b = rgbInt & 255; let best = 0, bd = 1e9;
  for (let i = 0; i < palRgb.length; i++) { const p = palRgb[i]; const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 * 1.4 + (p[2] - b) ** 2; if (d < bd) { bd = d; best = i; } }
  v = palInt[best]; snapCache.set(rgbInt, v); return v;
}
function snapCanvas(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; const s = snapNearest(key);
    d[i] = s >> 16; d[i + 1] = (s >> 8) & 255; d[i + 2] = s & 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- data
let INDEX = null; const CHUNKS = new Map(); const PENDING = new Map();
let CHUNK = 256, ZSTEP = 8, LCRES = 4;
async function loadIndex() { INDEX = await (await fetch(DATA + 'index.json')).json(); CHUNK = INDEX.chunk; ZSTEP = INDEX.zstep; LCRES = INDEX.lcres; }
function chunkKey(cx, cy) { return cx + '_' + cy; }
const FETCHQ = []; let INFLIGHT = 0; const MAX_INFLIGHT = 8; const PACKS = new Set();
function pumpQueue() {
  while (INFLIGHT < MAX_INFLIGHT && FETCHQ.length) {
    const pk = FETCHQ.shift(); INFLIGHT++;
    fetch(DATA + pk + '.json').then(r => r.json()).then(j => { for (const k in j) { const [cx, cy] = k.split('_').map(Number); CHUNKS.set(k, prepareChunk(j[k], cx, cy)); } needRender = true; }).catch(e => { console.warn('pack', pk, e); }).finally(() => { PENDING.delete(pk); INFLIGHT--; pumpQueue(); });
  }
}
function requestChunk(cx, cy) {
  const k = chunkKey(cx, cy); if (CHUNKS.has(k)) return;
  if (!INDEX.chunks[k]) { CHUNKS.set(k, null); return; }
  const P = INDEX.pack || 1; const pk = (cx / P | 0) + '_' + (cy / P | 0); if (PENDING.has(pk)) return;
  PENDING.set(pk, true); FETCHQ.push(pk); pumpQueue();
}
function b64u16(s, n) { const bin = atob(s); const out = new Uint16Array(n); for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); return out; }
function rleDecode(s, n) { const out = new Uint8Array(n); let p = 0; for (const run of s.split(',')) { const [v, c] = run.split(':'); const vv = +v, cc = +c; out.fill(vv, p, p + cc); p += cc; } return out; }

function prepareChunk(j, cx, cy) {
  const NV = CHUNK / ZSTEP + 1; const z = b64u16(j.z, NV * NV); const z0 = j.z0; // dm, row 0 = south
  const zm = new Float32Array(NV * NV); for (let i = 0; i < zm.length; i++) zm[i] = (z[i] + z0) / 10;
  const NC = CHUNK / LCRES; const lc = rleDecode(j.lc, NC * NC);
  const ox = cx * CHUNK, oy = cy * CHUNK;
  const ch = { cx, cy, ox, oy, zm, lc, raw: j, items: {}, labels: [] };
  // terrain sampler (bilinear on the vertex grid)
  ch.zAt = (lx, ly) => { // local metres within chunk
    const fx = Math.max(0, Math.min(NV - 1.0001, lx / ZSTEP)), fy = Math.max(0, Math.min(NV - 1.0001, ly / ZSTEP));
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy; const i = iy * NV + ix;
    return zm[i] * (1 - tx) * (1 - ty) + zm[i + 1] * tx * (1 - ty) + zm[i + NV] * (1 - tx) * ty + zm[i + NV + 1] * tx * ty;
  };
  for (const p of j.p) ch.labels.push({ name: p[0], x: ox + p[1] / 4, y: oy + p[2] / 4, kind: p[3], en: p[4] });
  return ch;
}

// ---------------------------------------------------------------- geometry helpers
function clipHalf(ring, a, b, c) { // keep points with a*x + b*y <= c  (Sutherland-Hodgman) ; ring = [[x,y,z?],...]
  const out = []; const n = ring.length; if (!n) return out;
  for (let i = 0; i < n; i++) {
    const P = ring[i], Q = ring[(i + 1) % n];
    const dp = a * P[0] + b * P[1] - c, dq = a * Q[0] + b * Q[1] - c;
    if (dp <= 0) out.push(P);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P.length > 2 ? P[2] + (Q[2] - P[2]) * t : undefined]); }
  }
  return out;
}
function splitStrips(rings, width) { // split polygon (rings[0] outer, rest holes) into depth strips x - y in [k, k+width)
  let dmin = 1e9, dmax = -1e9; for (const p of rings[0]) { const d = p[0] - p[1]; if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
  if (dmax - dmin <= width * 1.5) return [rings];
  const out = []; const k0 = Math.floor(dmin / width) * width;
  for (let k = k0; k < dmax; k += width) {
    const rs = rings.map(r => clipHalf(clipHalf(r, 1, -1, k + width), -1, 1, -k)).filter(r => r.length >= 3);
    if (rs.length && rs[0].length >= 3) out.push(rs);
  }
  return out;
}
function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function polyCentroid(r) { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; }
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; h = h ^ (h >> 16); return (h >>> 0) / 4294967296; }

// ---------------------------------------------------------------- item building (per chunk, per LOD)
// LOD: 0 => S=4 (cells 4m), 1 => S=2 (4m), 2 => S=1 (8m), 3 => S=0.5 (16m), 4 => S=0.25 (32m), 5 => S=0.125 (64m)
function cellSizeForLod(lod) { return [4, 4, 8, 16, 32, 64][lod]; }
function chunkShadows(ch) {
  if (ch.shadows) return ch.shadows;
  const out = []; const { ox, oy, raw } = ch;
  for (const b of raw.b) {
    const h = b[1] / 10, minh = (b[6] || 0) / 10; if (h - minh <= 2.5) continue;
    const r = b[0][0]; const ring = []; for (let k = 0; k < r.length; k += 2) ring.push([ox + r[k] / 4, oy + r[k + 1] / 4]);
    const L = Math.min(55, (h - minh) * 0.75); out.push({ ring, sx: 0.92 * L, sy: -0.39 * L });
  }
  ch.shadows = out; return out;
}
function buildItems(ch, lod) {
  if (ch.items[lod]) return ch.items[lod];
  const items = []; const { ox, oy, zm, lc, raw } = ch; const NV = CHUNK / ZSTEP + 1; const NC = CHUNK / LCRES;
  const cs = cellSizeForLod(lod); const n = CHUNK / cs; const step = cs / LCRES; const shadows = [];
  // --- terrain cells
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // majority class over the covered lc cells (cheap: sample centre + corners)
    let cls; if (step === 1) cls = lc[j * NC + i]; else {
      const counts = new Map(); for (let b = 0; b < step; b += Math.max(1, step >> 1)) for (let a = 0; a < step; a += Math.max(1, step >> 1)) { const c = lc[(j * step + b) * NC + i * step + a]; counts.set(c, (counts.get(c) || 0) + 1); }
      let best = 0, bc = -1; for (const [c, k] of counts) if (k > bc) { bc = k; best = c; } cls = best;
    }
    if (cls === 255) continue;
    const x0 = i * cs, y0 = j * cs;
    const za = ch.zAt(x0, y0), zb = ch.zAt(x0 + cs, y0), zc = ch.zAt(x0 + cs, y0 + cs), zd = ch.zAt(x0, y0 + cs);
    let z1 = za, z2 = zb, z3 = zc, z4 = zd; if (cls === 13) { const m = Math.min(za, zb, zc, zd); z1 = z2 = z3 = z4 = m; }
    // light from the NW/top: slope facing south-east is darker
    const slope = cls === 13 ? 0 : ((zc + zb) - (za + zd)) / (2 * cs) * 0.6 + ((zc + zd) - (za + zb)) / (2 * cs) * -0.9;
    items.push({ t: 0, k: (x0 + cs + ox) - (y0 + oy), bx0: ox + x0, bx1: ox + x0 + cs, by0: oy + y0, by1: oy + y0 + cs, zlo: Math.min(z1, z2, z3, z4), zhi: Math.max(z1, z2, z3, z4), cls, pts: [[ox + x0, oy + y0, z1], [ox + x0 + cs, oy + y0, z2], [ox + x0 + cs, oy + y0 + cs, z3], [ox + x0, oy + y0 + cs, z4]], sh: slope, i, j, cs });
  }
  // --- water polygons (strip split)
  for (const rings of raw.w) {
    const rr = rings.map(r => { const o = []; for (let k = 0; k < r.length; k += 3) o.push([ox + r[k] / 4, oy + r[k + 1] / 4, r[k + 2] / 10]); return o; });
    // flatten z inside the piece to the lowest value (water surface), per piece
    let zmin = 1e9; for (const p of rr[0]) zmin = Math.min(zmin, p[2]); for (const r of rr) for (const p of r) p[2] = Math.max(zmin, p[2] - 0.3) < zmin + 0.6 ? zmin : p[2];
    for (const s of splitStrips(rr, 12)) {
      let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, k = -1e9; for (const p of s[0]) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); k = Math.max(k, p[0] - p[1]); }
      items.push({ t: 1, k: k + 0.01, bx0, bx1, by0, by1, zlo: zmin, zhi: zmin + 0.5, rings: s });
    }
  }
  // --- bridge decks
  for (const rings of (raw.bp || [])) {
    const rr = rings.map(r => { const o = []; for (let k = 0; k < r.length; k += 3) o.push([ox + r[k] / 4, oy + r[k + 1] / 4, r[k + 2] / 10]); return o; });
    for (const s of splitStrips(rr, 12)) {
      let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, k = -1e9; for (const p of s[0]) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); k = Math.max(k, p[0] - p[1]); }
      items.push({ t: 5, k: k + 0.015, bx0, bx1, by0, by1, zlo: rr[0][0][2] - 8, zhi: rr[0][0][2] + 1, rings: s });
    }
  }
  // --- roads
  const minCls = lod <= 1 ? 99 : lod === 2 ? 11 : lod === 3 ? 8 : lod === 4 ? 6 : 5; // skip classes >= minCls (paths first)
  for (const [cls, bridge, arr] of raw.r) {
    if (cls < 20 && cls >= minCls) continue; if (cls === 21 && lod >= 4) continue; if (cls === 31 && lod >= 3) continue; if (cls === 20 && lod >= 5) continue;
    const pts = []; for (let k = 0; k < arr.length; k += 3) pts.push([ox + arr[k] / 4, oy + arr[k + 1] / 4, arr[k + 2] / 10 + (bridge ? 0 : 0.15)]);
    const w = ROAD_W[cls] * (lod >= 4 ? 1.8 : lod === 3 ? 1.3 : 1);
    for (let k = 0; k + 1 < pts.length; k++) {
      const P = pts[k], Q = pts[k + 1]; const dx = Q[0] - P[0], dy = Q[1] - P[1]; const L = Math.hypot(dx, dy); if (L < 0.01) continue;
      const nx = -dy / L * w / 2, ny = dx / L * w / 2;
      const quad = [[P[0] + nx, P[1] + ny, P[2]], [Q[0] + nx, Q[1] + ny, Q[2]], [Q[0] - nx, Q[1] - ny, Q[2]], [P[0] - nx, P[1] - ny, P[2]]];
      let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, kk = -1e9; for (const p of quad) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); kk = Math.max(kk, p[0] - p[1]); }
      items.push({ t: 2, k: kk + (bridge ? 13 : 0.02) + (cls >= 20 && cls < 30 ? 0.01 : 0), bx0, bx1, by0, by1, zlo: Math.min(P[2], Q[2]), zhi: Math.max(P[2], Q[2]), quad, cls, bridge, w, P, Q, last: k + 2 === pts.length });
    }
  }
  // --- buildings
  for (const b of raw.b) {
    const [rings, hdm, basedm, roof, roofc, fc, minhdm, rhdm] = b; const inset = b[8], insetR = b[9] ? b[9] / 10 : 0; const rh = (rhdm || 0) / 10;
    const h = hdm / 10, base = basedm / 10, minh = minhdm / 10;
    if (lod >= 4 && h < 8 && lod === 4) { /* keep */ }
    if (lod === 5 && h < 7) continue;
    const rr = rings.map(r => { const o = []; for (let k = 0; k < r.length; k += 2) o.push([ox + r[k] / 4, oy + r[k + 1] / 4]); return o; });
    if (ringArea(rr[0]) < 0) rr[0].reverse(); for (let i = 1; i < rr.length; i++) if (ringArea(rr[i]) > 0) rr[i].reverse();
    let ins = null; if (inset) { ins = []; for (let k = 0; k < inset.length; k += 2) ins.push([ox + inset[k] / 4, oy + inset[k + 1] / 4]); if (ringArea(ins) < 0) ins.reverse(); }
    const pieces = (lod <= 2) ? splitStrips(rr, 16) : [rr];
    const insPieces = ins && pieces.length > 1 ? splitStrips([ins], 16) : (ins ? [[ins]] : null);
    const [cxm, cym] = polyCentroid(rr[0]);
    const seed0 = hash2(rings[0][0] + ch.cx * 7, rings[0][1] + ch.cy * 13);
    // resolve colours once per building
    let fac; if (typeof fc === 'string') { regDynamic(fc); const dark = shade(fc, 0.86); fac = [fc, dark, shade(fc, 0.62)]; } else fac = PAL.facade[fc] || PAL.facade[0];
    let rc; if (typeof roofc === 'string' && roofc[0] === '#') { regDynamic(roofc); rc = [roofc, shade(roofc, 1.12), shade(roofc, 0.7)]; regDynamic(shade(roofc, 1.12)); regDynamic(shade(roofc, 0.7)); } else if (roofc === 'r') rc = PAL.roofRed[(seed0 * 97) % 5 | 0]; else rc = PAL.roof[roofc] || PAL.roof.g;
    for (let pi = 0; pi < pieces.length; pi++) {
      const s = pieces[pi];
      let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, k = -1e9; for (const p of s[0]) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); k = Math.max(k, p[0] - p[1]); }
      // find inset piece overlapping this strip's depth range
      let insP = null; if (insPieces) { const dmid = (bx0 - by1 + bx1 - by0) / 2; for (const ip of insPieces) { let a = 1e9, bb = -1e9; for (const p of ip[0]) { const d = p[0] - p[1]; a = Math.min(a, d); bb = Math.max(bb, d); } if (pieces.length === 1 || (bb >= k - 16.5 && a <= k + 0.5)) { insP = ip[0]; break; } } }
      items.push({ t: 3, k: k + 0.5, bx0, bx1, by0, by1, zlo: base + minh, zhi: base + h + Math.max(insetR + 6, rh + 2), rings: s, h, base, minh, roof, fac, rc, ins: insP, insetR, rh, cx: cxm, cy: cym, area: Math.abs(ringArea(rr[0])), seed: seed0 });
    }
  }
  // --- trees: mapped + synthetic in forest/scrub/grass
  if (lod <= 2) {
    const tr = raw.t; for (let k = 0; k < tr.length; k += 2) { const x = ox + tr[k] / 4, y = oy + tr[k + 1] / 4; items.push({ t: 4, k: x - y + 0.3, bx0: x - 3, bx1: x + 3, by0: y - 3, by1: y + 3, zlo: ch.zAt(x - ox, y - oy), zhi: ch.zAt(x - ox, y - oy) + 8, x, y, z: ch.zAt(x - ox, y - oy), big: 1 });
    }
    for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
      const c = lc[j * NC + i]; let dens = 0; if (c === 9) dens = lod === 0 ? 0.62 : 0.5; else if (c === 5) dens = 0.3; else if (c === 4) dens = 0.14; else if (c === 7) dens = 0.14; else if (c === 6) dens = 0.0; else if (c === 3) dens = 0.0;
      if (!dens) continue; const r = hash2(ox + i * 7, oy + j * 13); if (r > dens) continue;
      const x = ox + (i - 0.4 + 1.8 * hash2(i + 3, j + 11)) * LCRES, y = oy + (j - 0.4 + 1.8 * hash2(i + 17, j + 5)) * LCRES; const lx = Math.max(0, Math.min(CHUNK, x - ox)), ly = Math.max(0, Math.min(CHUNK, y - oy)); const z = ch.zAt(lx, ly);
      items.push({ t: 4, k: x - y + 0.3, bx0: x - 4, bx1: x + 4, by0: y - 4, by1: y + 4, zlo: z, zhi: z + 10, x, y, z, big: c === 9 ? 1 : (c === 5 ? 0 : 1), sz: 0.7 + 0.7 * hash2(i * 31 + 7, j * 17 + 3) });
    }
  }
  // --- shadow mask (4 m cells): this chunk's buildings plus the neighbours on the light side
  if (lod <= 2) {
    const mc = document.createElement('canvas'); mc.width = NC; mc.height = NC; const m = mc.getContext('2d', { willReadFrequently: true });
    m.fillStyle = '#000';
    const paint = (list, dx, dy) => { for (const sh of list) { const r = sh.ring; const n = r.length; m.beginPath(); for (let i = 0; i < n; i++) { const P = r[i], Q = r[(i + 1) % n]; m.moveTo((P[0] + dx) / LCRES, (P[1] + dy) / LCRES); m.lineTo((Q[0] + dx) / LCRES, (Q[1] + dy) / LCRES); m.lineTo((Q[0] + dx + sh.sx) / LCRES, (Q[1] + dy + sh.sy) / LCRES); m.lineTo((P[0] + dx + sh.sx) / LCRES, (P[1] + dy + sh.sy) / LCRES); m.closePath(); } m.fill(); } };
    paint(chunkShadows(ch), -ox, -oy);
    for (const [ncx, ncy] of [[ch.cx - 1, ch.cy], [ch.cx - 1, ch.cy + 1], [ch.cx, ch.cy + 1], [ch.cx - 1, ch.cy - 1], [ch.cx, ch.cy - 1]]) {
      const nb = CHUNKS.get(chunkKey(ncx, ncy)); if (!nb) continue; paint(chunkShadows(nb), -ox, -oy);
    }
    const d = m.getImageData(0, 0, NC, NC).data; const mask = new Uint8Array(NC * NC); for (let i = 0; i < NC * NC; i++) mask[i] = d[i * 4 + 3] > 100 ? 1 : 0;
    ch.shadowMask = mask;   // row = y index from south (world y), col = x
    for (const it of items) {
      if (it.t === 0) { // fraction of 4 m cells in shadow -> shade level
        let cnt = 0, tot = 0; for (let b = 0; b < step; b++) for (let a = 0; a < step; a++) { const yy = it.j * step + b, xx = it.i * step + a; if (yy < NC && xx < NC) { tot++; cnt += mask[yy * NC + xx]; } }
        it.shadow = tot ? cnt / tot : 0;
      } else if (it.t === 2 && !it.bridge) { const mx = ((it.P[0] + it.Q[0]) / 2 - ox) / LCRES | 0, my = ((it.P[1] + it.Q[1]) / 2 - oy) / LCRES | 0; it.shadow = (mx >= 0 && my >= 0 && mx < NC && my < NC && mask[my * NC + mx]) ? 1 : 0; }
      else if (it.t === 4) { const mx = (it.x - ox) / LCRES | 0, my = (it.y - oy) / LCRES | 0; it.shadow = (mx >= 0 && my >= 0 && mx < NC && my < NC && mask[my * NC + mx]) ? 1 : 0; }
    }
  }
  items.sort((a, b) => a.k - b.k || a.t - b.t);
  ch.items[lod] = items; return items;
}

// ---------------------------------------------------------------- drawing primitives
function drawItems(ctx, items, S, offx, offy, lod, night) {
  const px = (x, y, z) => Math.round((x + y) * S - offx) + 0.0;
  const py = (x, y, z) => Math.round(((x - y) / 2 - z * ZF) * S - offy) + 0.0;
  function poly(pts, fill, stroke) { ctx.beginPath(); for (let i = 0; i < pts.length; i++) { const p = pts[i]; const X = px(p[0], p[1], p[2]), Y = py(p[0], p[1], p[2]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); } ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } }
  function polyRings(rings, fill, stroke) { ctx.beginPath(); for (const r of rings) { for (let i = 0; i < r.length; i++) { const p = r[i]; const X = px(p[0], p[1], p[2]), Y = py(p[0], p[1], p[2]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); } ctx.closePath(); } if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); } if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } }
  const hi = lod <= 1, mid = lod <= 2;
  for (const it of items) {
    if (it.t === 0) { // terrain cell
      const name = LC_NAMES[it.cls]; const cols = PAL[name] || PAL.ground;
      let col = cols[(name === 'plaza' && hash2(it.i * 5 + 1, it.j * 3 + 7) < 0.18) ? 1 : 0];
      if (it.sh > 0.08) col = shade(col, 0.88); else if (it.sh < -0.08) col = shade(col, 1.07);
      if (it.shadow >= 0.5 && !night) col = shade(col, 0.72);
      if (night) col = shade(col, 0.32);
      poly(it.pts, col, col);
      if (hi && !night) { // textures
        const X = px(it.pts[0][0] + it.cs / 2, it.pts[0][1] + it.cs / 2, (it.pts[0][2] + it.pts[2][2]) / 2), Y = py(it.pts[0][0] + it.cs / 2, it.pts[0][1] + it.cs / 2, (it.pts[0][2] + it.pts[2][2]) / 2);
        const r = hash2(it.i + it.cs, it.j * 3 + it.cs);
        if (it.cls === 4 || it.cls === 8 || it.cls === 7) { if (r < 0.35) { ctx.fillStyle = cols[1]; ctx.fillRect(X + ((r * 20) | 0) - 10, Y + ((r * 7) | 0) - 3, S >= 4 ? 2 : 1, 1); } }
        else if (it.cls === 3 || it.cls === 6) { ctx.fillStyle = cols[1]; ctx.fillRect(X - 6, Y + (it.cls === 6 ? 1 : 0), 12, 1); }
        else if (it.cls === 13 && r < 0.3) { ctx.fillStyle = PAL.water[1]; ctx.fillRect(X + ((r * 30) | 0) - 10, Y + ((r * 9) | 0) - 4, 3, 1); }
        else if (it.cls === 12 && r < 0.3) { ctx.fillStyle = cols[1]; ctx.fillRect(X - 1, Y, 2, 1); }
      }
    } else if (it.t === 1) { // water polygon
      ctx.lineWidth = 2; polyRings(it.rings, night ? '#17304a' : PAL.water[0], night ? '#17304a' : PAL.water[0]); ctx.lineWidth = 1;
      if (hi && !night) { // crisp bank edge
        ctx.save(); ctx.strokeStyle = PAL.water[2]; ctx.lineWidth = 1; ctx.beginPath(); const r = it.rings[0]; const n = r.length; for (let i = 0; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; if (Math.abs((p[0] - p[1]) - (q[0] - q[1])) < 0.05) continue; /* strip cut line, not a bank */ ctx.moveTo(px(p[0], p[1], p[2]), py(p[0], p[1], p[2])); ctx.lineTo(px(q[0], q[1], q[2]), py(q[0], q[1], q[2])); } ctx.stroke(); ctx.restore();
      }
    } else if (it.t === 2) { // road segment
      const spec = PAL.road[it.cls]; let col = spec[0]; if (it.bridge) col = PAL.bridge; if (it.shadow && !night) col = shade(col, 0.72); if (night) col = shade(col, 0.5);
      poly(it.quad, col, it.bridge ? PAL.bridgeEdge : null);
      if (mid) { // round joints
        const d = it.w * S / 2; const X = px(it.P[0], it.P[1], it.P[2]), Y = py(it.P[0], it.P[1], it.P[2]);
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(X, Y, d, d / 2, 0, 0, Math.PI * 2); ctx.fill();
        if (it.last) { const X2 = px(it.Q[0], it.Q[1], it.Q[2]), Y2 = py(it.Q[0], it.Q[1], it.Q[2]); ctx.beginPath(); ctx.ellipse(X2, Y2, d, d / 2, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      if (hi && spec[1] && it.cls < 20) { // centre line
        ctx.strokeStyle = spec[1]; ctx.lineWidth = 1; ctx.setLineDash(it.cls <= 2 ? [] : [4, 4]); ctx.beginPath(); ctx.moveTo(px(it.P[0], it.P[1], it.P[2]), py(it.P[0], it.P[1], it.P[2])); ctx.lineTo(px(it.Q[0], it.Q[1], it.Q[2]), py(it.Q[0], it.Q[1], it.Q[2])); ctx.stroke(); ctx.setLineDash([]);
      } else if (mid && spec[1] && it.cls >= 20 && it.cls < 30) { // rails: two thin rails
        ctx.strokeStyle = spec[1]; ctx.lineWidth = 1; ctx.setLineDash(it.cls === 20 ? [2, 3] : []); const q = it.quad;
        ctx.beginPath(); ctx.moveTo(px((q[0][0] * 3 + q[3][0]) / 4, (q[0][1] * 3 + q[3][1]) / 4, q[0][2]), py((q[0][0] * 3 + q[3][0]) / 4, (q[0][1] * 3 + q[3][1]) / 4, q[0][2])); ctx.lineTo(px((q[1][0] * 3 + q[2][0]) / 4, (q[1][1] * 3 + q[2][1]) / 4, q[1][2]), py((q[1][0] * 3 + q[2][0]) / 4, (q[1][1] * 3 + q[2][1]) / 4, q[1][2])); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px((q[0][0] + q[3][0] * 3) / 4, (q[0][1] + q[3][1] * 3) / 4, q[0][2]), py((q[0][0] + q[3][0] * 3) / 4, (q[0][1] + q[3][1] * 3) / 4, q[0][2])); ctx.lineTo(px((q[1][0] + q[2][0] * 3) / 4, (q[1][1] + q[2][1] * 3) / 4, q[1][2]), py((q[1][0] + q[2][0] * 3) / 4, (q[1][1] + q[2][1] * 3) / 4, q[1][2])); ctx.stroke(); ctx.setLineDash([]);
      }
    } else if (it.t === 3) { // building
      const fac = it.fac; const zb = it.base + it.minh, zt = it.base + it.h; const outer = it.rings[0];
      // walls (visible edges: outward normal . (1,-1) > 0 ; ring is CCW so outward normal of edge P->Q is (dy, -dx))
      for (const ring of it.rings) {
        const n = ring.length;
        for (let i = 0; i < n; i++) {
          const P = ring[i], Q = ring[(i + 1) % n]; const dx = Q[0] - P[0], dy = Q[1] - P[1];
          const nx = dy, ny = -dx; const vis = nx - ny; if (vis <= 0) continue;
          const L = Math.hypot(dx, dy); const south = (-ny / L); // 1 = faces south
          let col = south > 0.5 ? fac[0] : fac[1]; if (night) col = shade(col, 0.42);
          poly([[P[0], P[1], zb], [Q[0], Q[1], zb], [Q[0], Q[1], zt], [P[0], P[1], zt]], col, mid ? (night ? shade(fac[2], 0.5) : fac[2]) : null);
          // windows
          if (hi && L > 2.5 && it.h > 4 && fac !== PAL.facade[8] && fac !== PAL.facade[9]) {
            const floors = Math.floor((it.h - 1.0) / 3.2); const cols = Math.floor(L / 3.0);
            if (floors > 0 && cols > 0) {
              ctx.fillStyle = night ? (hash2(P[0] | 0, zt | 0) < 0.6 ? '#f6d77a' : '#5a5040') : shade(col, 0.62);
              for (let f = 0; f < floors; f++) {
                const z = zb + 1.6 + f * 3.2 + (it.h - floors * 3.2) * 0.3;
                for (let c = 0; c < cols; c++) { const t = (c + 0.5) / cols; const x = P[0] + dx * t, y = P[1] + dy * t; const X = px(x, y, z), Y = py(x, y, z); if (S >= 4) ctx.fillRect(X - 1, Y - 2, 2, 3); else ctx.fillRect(X, Y - 1, 1, 2); }
              }
            }
          }
        }
      }
      // roof
      const rc = it.rc; const top = it.rings.map(r => r.map(p => [p[0], p[1], zt]));
      let rcol = rc[0]; if (night) rcol = shade(rcol, 0.4);
      polyRings(top, rcol, mid ? (night ? shade(rc[2], 0.5) : rc[2]) : null);
      if (it.roof === 'p' && it.ins && it.ins.length >= 3) {
        const ridge = it.rh > 0 ? Math.min(it.rh, 30) : Math.min(it.insetR * 1.1, 5.5); const zr = zt + ridge; const ins = it.ins;
        const nearest = p => { let best = ins[0], bd = 1e9; for (const q of ins) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < bd) { bd = d; best = q; } } return best; };
        const n = outer.length; const nearIdx = outer.map(nearest);
        for (let i = 0; i < n; i++) {
          const P = outer[i], Q = outer[(i + 1) % n]; const dx = Q[0] - P[0], dy = Q[1] - P[1]; const L = Math.hypot(dx, dy); if (L < 0.8) continue;
          const nx = dy / L, ny = -dx / L; // outward normal (CCW ring)
          const face = nx - ny; let col;
          if (face > 0.3) col = (-ny > 0.5) ? rc[1] : rc[0]; else if (face > -0.3) col = rc[0]; else col = shade(rc[0], 0.85);
          if (night) col = shade(col, 0.4);
          const a = nearIdx[i], b = nearIdx[(i + 1) % n];
          const pts = (a === b) ? [[P[0], P[1], zt], [Q[0], Q[1], zt], [a[0], a[1], zr]] : [[P[0], P[1], zt], [Q[0], Q[1], zt], [b[0], b[1], zr], [a[0], a[1], zr]];
          poly(pts, col, null);
        }
        poly(ins.map(p => [p[0], p[1], zr]), night ? shade(rc[1], 0.4) : rc[1], mid ? (night ? shade(rc[2], 0.5) : rc[2]) : null);
        if (mid) { ctx.strokeStyle = night ? shade(rc[2], 0.5) : rc[2]; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < n; i++) { const p = outer[i]; const X = px(p[0], p[1], zt), Y = py(p[0], p[1], zt); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); } ctx.closePath(); ctx.stroke(); }
      } else if (it.roof === 'd') { // dome
        const r = Math.sqrt(it.area / Math.PI) * 0.85; const X = px(it.cx, it.cy, zt), Y = py(it.cx, it.cy, zt);
        ctx.fillStyle = night ? shade(rc[0], 0.4) : rc[0]; ctx.beginPath(); ctx.ellipse(X, Y - r * S * ZF * 0.6, r * S * 1.0, r * S * 0.9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = night ? shade(rc[1], 0.4) : rc[1]; ctx.beginPath(); ctx.ellipse(X - r * S * 0.25, Y - r * S * ZF * 0.9, r * S * 0.45, r * S * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      } else if (it.roof === 'o') { // pointed tower spire
        const r = Math.sqrt(it.area / Math.PI); const hs = it.rh > 0 ? it.rh : Math.max(5, r * 2.2); const X = px(it.cx, it.cy, zt + hs), Y = py(it.cx, it.cy, zt + hs);
        ctx.fillStyle = night ? shade(rc[0], 0.4) : rc[0]; ctx.beginPath(); ctx.moveTo(X, Y); const o = outer; for (const p of o) ctx.lineTo(px(p[0], p[1], zt), py(p[0], p[1], zt)); ctx.closePath(); ctx.fill();
      } else if (hi && it.roof === 'f' && it.area > 60) { // flat roof: a few rooftop details
        const X = px(it.cx, it.cy, zt), Y = py(it.cx, it.cy, zt); const r = it.seed;
        ctx.fillStyle = night ? shade(rc[2], 0.6) : rc[2]; ctx.fillRect(X + ((r * 10) | 0) - 5, Y + ((r * 4) | 0) - 2, 3, 2);
        if (r > 0.5) { ctx.fillStyle = rc[1]; ctx.fillRect(X - ((r * 8) | 0), Y + 1, 2, 1); }
      }
      // chimney for pitched old buildings
      if (hi && it.roof === 'p' && it.area > 80 && it.seed > 0.45 && !night) { const X = px(it.cx, it.cy, zt + 4), Y = py(it.cx, it.cy, zt + 4); ctx.fillStyle = PAL.roof.r[2]; ctx.fillRect(X + ((it.seed * 14) | 0) - 7, Y - 3, 2, 4); }
    } else if (it.t === 5) { // bridge deck
      const r0 = it.rings[0]; const col = night ? shade(PAL.bridge, 0.5) : '#b3ab9b';
      // piers / side faces: drop a dark skirt below the deck edge on the front-facing edges
      if (mid) { const n = r0.length; for (let i = 0; i < n; i++) { const P = r0[i], Q = r0[(i + 1) % n]; const nx = Q[1] - P[1], ny = -(Q[0] - P[0]); if (nx - ny <= 0) continue; poly([[P[0], P[1], P[2]], [Q[0], Q[1], Q[2]], [Q[0], Q[1], Q[2] - 2.5], [P[0], P[1], P[2] - 2.5]], night ? '#3a3734' : '#857d6f', null); } }
      polyRings(it.rings, col, mid ? (night ? '#2e2b28' : PAL.bridgeEdge) : null);
    } else if (it.t === 4) { // tree
      const X = px(it.x, it.y, it.z), Y = py(it.x, it.y, it.z); const r = Math.max(2, Math.round((it.big ? (S >= 4 ? 6 : S >= 2 ? 3.5 : 2) : (S >= 4 ? 3 : 2)) * (it.sz || 1)));
      let tc = night ? ['#213f1f', '#2d4f29', '#162a16', '#2a1d12'] : (it.big ? PAL.tree : [PAL.shrub[0], PAL.shrub[1], PAL.tree[2], PAL.tree[3]]);
      if (it.shadow && !night) tc = [shade(tc[0], 0.8), shade(tc[1], 0.8), tc[2], tc[3]];
      if (it.big && S >= 2) { ctx.fillStyle = tc[3]; ctx.fillRect(X, Y - 1, 1, 3); }
      ctx.fillStyle = tc[0]; ctx.beginPath(); ctx.ellipse(X, Y - r - 1, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tc[1]; ctx.beginPath(); ctx.ellipse(X - r * 0.3, Y - r - 1.4 - r * 0.2, r * 0.5, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      if (S >= 2) { ctx.fillStyle = tc[2]; ctx.fillRect(X - r + 1, Y - 1 - r * 0.3, r * 2 - 2, 1); }
    }
  }
}

// ---------------------------------------------------------------- tile renderer
const TILES = new Map(); const TILE_ORDER = []; const MAX_TILES = 420;
function lodForScale(S) { return S >= 4 ? 0 : S >= 2 ? 1 : S >= 1 ? 2 : S >= 0.5 ? 3 : S >= 0.25 ? 4 : 5; }
function chunksForRect(S, sx0, sy0, sx1, sy1) { // screen rect (scale S px) -> chunk list (needs INDEX)
  const out = []; const zMaxM = 420, zMinM = 160; // sea-level bounds of this area (m)
  // invert: sx=(x+y)S, sy=((x-y)/2 - z ZF)S ; x+y in [sx0/S, sx1/S]; (x-y) in [2(sy0/S + zmin ZF), 2(sy1/S + zmax ZF)]
  const a0 = sx0 / S, a1 = sx1 / S, d0 = 2 * (sy0 / S + zMinM * ZF), d1 = 2 * (sy1 / S + zMaxM * ZF);
  // x = (a + d)/2, y = (a - d)/2 over corners
  const xs = [(a0 + d0) / 2, (a0 + d1) / 2, (a1 + d0) / 2, (a1 + d1) / 2], ys = [(a0 - d0) / 2, (a0 - d1) / 2, (a1 - d0) / 2, (a1 - d1) / 2];
  const cx0 = Math.floor(Math.min(...xs) / CHUNK) - 1, cx1 = Math.floor(Math.max(...xs) / CHUNK) + 1, cy0 = Math.floor(Math.min(...ys) / CHUNK) - 1, cy1 = Math.floor(Math.max(...ys) / CHUNK) + 1;
  for (let cy = Math.max(0, cy0); cy <= Math.min(INDEX.ny - 1, cy1); cy++) for (let cx = Math.max(0, cx0); cx <= Math.min(INDEX.nx - 1, cx1); cx++) {
    const k = chunkKey(cx, cy); const info = INDEX.chunks[k]; if (!info) continue;
    const ox = cx * CHUNK, oy = cy * CHUNK; const zlo = info[0] / 10, zhi = info[1] / 10 + 8;
    const csx0 = (ox + oy) * S, csx1 = (ox + oy + 2 * CHUNK) * S; const csy0 = ((ox - oy - CHUNK) / 2 - zhi * ZF) * S, csy1 = ((ox - oy + CHUNK) / 2 - zlo * ZF) * S;
    if (csx1 < sx0 || csx0 > sx1 || csy1 < sy0 || csy0 > sy1) continue; out.push([cx, cy]);
  }
  return out;
}
function renderTile(S, tx, ty, night) {
  const sx0 = tx * TILE, sy0 = ty * TILE, sx1 = sx0 + TILE, sy1 = sy0 + TILE; const lod = lodForScale(S);
  const need = chunksForRect(S, sx0, sy0, sx1, sy1); let ready = true;
  for (const [cx, cy] of need) { const k = chunkKey(cx, cy); if (!CHUNKS.has(k)) { requestChunk(cx, cy); ready = false; } }
  if (!ready) return null;
  const c = document.createElement('canvas'); c.width = TILE; c.height = TILE; const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = night ? '#141a22' : PAL.void; ctx.fillRect(0, 0, TILE, TILE); ctx.imageSmoothingEnabled = false;
  const items = []; const margin = 40 * S;
  for (const [cx, cy] of need) {
    const ch = CHUNKS.get(chunkKey(cx, cy)); if (!ch) continue;
    for (const it of buildItems(ch, lod)) {
      // screen bbox of the item
      const isx0 = (it.bx0 + it.by0) * S, isx1 = (it.bx1 + it.by1) * S; const isy0 = ((it.bx0 - it.by1) / 2 - it.zhi * ZF) * S, isy1 = ((it.bx1 - it.by0) / 2 - it.zlo * ZF) * S;
      if (isx1 < sx0 - margin || isx0 > sx1 + margin || isy1 < sy0 - margin || isy0 > sy1 + margin) continue; items.push(it);
    }
  }
  items.sort((a, b) => a.k - b.k || a.t - b.t);
  drawItems(ctx, items, S, sx0, sy0, lod, night);
  snapCanvas(ctx, TILE, TILE);
  return c;
}

// ---------------------------------------------------------------- viewer
let canvas, ctx, VW, VH, needRender = true;
const view = { x: 0, y: 0, S: 2 }; // centre in world-screen units (scale 1 px), S = zoom scale px/m
let NIGHT = false; let LABELS = true;
function levelScale(S) { return Math.pow(2, Math.round(Math.log2(S))); }
function tileKey(S, tx, ty, n) { return S + '/' + tx + '/' + ty + (n ? 'n' : ''); }
let STATIC = null; // manifest: { '0.25': Set('tx_ty'), '0.125': Set(...) }
fetch((window.TP_TILE_BASE || 'tiles/') + 'manifest.json').then(r => r.ok ? r.json() : null).then(j => { if (j) { STATIC = {}; for (const k in j) STATIC[k] = new Set(j[k]); } }).catch(() => {});
const STATIC_PENDING = new Set();
function getTile(S, tx, ty) {
  const k = tileKey(S, tx, ty, NIGHT); const t = TILES.get(k); if (t) return t;
  if (!NIGHT && STATIC && STATIC[String(S)] && STATIC[String(S)].has(tx + '_' + ty) && !STATIC_PENDING.has(k)) {
    STATIC_PENDING.add(k); const img = new Image(); img.onload = () => { putTile(k, img); STATIC_PENDING.delete(k); }; img.onerror = () => STATIC_PENDING.delete(k); img.src = (window.TP_TILE_BASE || 'tiles/') + S + '/' + tx + '_' + ty + '.png';
    return null;
  }
  return null;
}
function hasStatic(S, tx, ty) { return !NIGHT && STATIC && STATIC[String(S)] && STATIC[String(S)].has(tx + '_' + ty); }
function putTile(k, c) { TILES.set(k, c); TILE_ORDER.push(k); while (TILE_ORDER.length > MAX_TILES) { const old = TILE_ORDER.shift(); TILES.delete(old); } }
let renderQueue = [];
function frame() {
  requestAnimationFrame(frame);
  if (!INDEX) return;
  const S = view.S, L = levelScale(S); const f = S / L; // tiles at level L drawn scaled by f
  ctx.imageSmoothingEnabled = false; ctx.fillStyle = NIGHT ? '#141a22' : PAL.void; ctx.fillRect(0, 0, VW, VH);
  // screen rect in level-L pixels
  const cxL = view.x * L, cyL = view.y * L; const w = VW / f, h = VH / f;
  const sx0 = cxL - w / 2, sy0 = cyL - h / 2; const tx0 = Math.floor(sx0 / TILE), ty0 = Math.floor(sy0 / TILE), tx1 = Math.floor((sx0 + w) / TILE), ty1 = Math.floor((sy0 + h) / TILE);
  const missing = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const t = getTile(L, tx, ty); const dx = Math.round((tx * TILE - sx0) * f), dy = Math.round((ty * TILE - sy0) * f); const ds = Math.ceil(TILE * f);
    if (t) ctx.drawImage(t, dx, dy, ds, ds);
    else {
      // fallback: parent level tile scaled
      const L2 = L / 2; const t2 = getTile(L2, Math.floor(tx / 2), Math.floor(ty / 2));
      if (t2) { const ox = (tx % 2 + 2) % 2 * TILE / 2, oy = (ty % 2 + 2) % 2 * TILE / 2; ctx.drawImage(t2, ox, oy, TILE / 2, TILE / 2, dx, dy, ds, ds); }
      else { const L3 = L * 2; let any = false; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const t3 = getTile(L3, tx * 2 + a, ty * 2 + b); if (t3) { ctx.drawImage(t3, dx + a * ds / 2, dy + b * ds / 2, ds / 2, ds / 2); any = true; } } }
      const pr = Math.hypot((tx + 0.5) * TILE - cxL, (ty + 0.5) * TILE - cyL); if (!hasStatic(L, tx, ty)) missing.push([pr, L, tx, ty]);
    }
  }
  missing.sort((a, b) => a[0] - b[0]);
  const t0 = performance.now(); let n = 0;
  for (const [, LL, tx, ty] of missing) { if (performance.now() - t0 > 24 && n > 0) break; const c = renderTile(LL, tx, ty, NIGHT); if (c) { putTile(tileKey(LL, tx, ty, NIGHT), c); n++; } }
  if (LABELS) drawLabels(S);
  drawHud();
}
let LABELS_ALL = [];
fetch(DATA + 'labels.json').then(r => r.json()).then(j => { LABELS_ALL = j.filter(p => p[3] <= 6).map(p => ({ name: p[0], x: p[1], y: p[2], kind: p[3], en: p[4] })); }).catch(() => {});
function drawLabels(S) {
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const seen = new Set();
  const kinds = S >= 4 ? [3, 4, 5, 6] : S >= 2 ? [2, 3, 4, 6] : S >= 1 ? [1, 2, 3, 6] : S >= 0.5 ? [1, 2] : [1];
  for (const lb of LABELS_ALL) {
    if (!kinds.includes(lb.kind)) continue;
    const z = terrainAt(lb.x, lb.y) + (lb.kind === 5 ? 6 : 0);
    const X = ((lb.x + lb.y) - view.x) * S + VW / 2, Y = (((lb.x - lb.y) / 2 - z * ZF) - view.y) * S + VH / 2;
    if (X < -100 || X > VW + 100 || Y < -40 || Y > VH + 40) continue;
    const size = lb.kind <= 1 ? 15 : lb.kind <= 3 ? 12 : 10; const txt = lb.kind <= 2 ? lb.name.toUpperCase() : lb.name;
    ctx.font = (lb.kind <= 1 ? 'bold ' : '') + size + 'px "Silkscreen", "Press Start 2P", monospace';
    const wdt = ctx.measureText(txt).width; const key = lb.kind >= 5 ? ('p' + Math.round(X / 260) + ':' + Math.round(Y / 110)) : (Math.round(X / 90) + ':' + Math.round(Y / 26)); if (seen.has(key)) continue; seen.add(key);
    ctx.fillStyle = NIGHT ? 'rgba(20,26,34,0.85)' : PAL.labelHalo; ctx.fillRect(Math.round(X - wdt / 2 - 3), Math.round(Y - size / 2 - 2), Math.round(wdt + 6), size + 4);
    ctx.fillStyle = NIGHT ? '#f0e6cf' : (lb.kind >= 5 ? '#6b3a1e' : PAL.label); ctx.fillText(txt, Math.round(X), Math.round(Y));
    if (lb.kind >= 5) { ctx.fillStyle = '#6b3a1e'; ctx.fillRect(Math.round(X) - 1, Math.round(Y + size / 2 + 2), 3, 3); }
  }
  ctx.restore();
}
let OUTLINE = null; fetch(DATA + 'outline.json').then(r => r.json()).then(j => { OUTLINE = j; }).catch(() => {});
function drawMinimap() {
  const mm = document.getElementById('minimap'); if (!mm || !OUTLINE || !INDEX) return;
  const W = mm.width, H = mm.height; const c = mm.getContext('2d'); c.imageSmoothingEnabled = false;
  // iso projection without z, fitted to the canvas
  const pts = OUTLINE.union.map(([x, y]) => [x + y, (x - y) / 2]); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [a, b] of pts) { x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
  const sc = Math.min((W - 8) / (x1 - x0), (H - 8) / (y1 - y0)); const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oy = (H - (y1 - y0) * sc) / 2 - y0 * sc;
  const P = ([x, y]) => [Math.round((x + y) * sc + ox), Math.round(((x - y) / 2) * sc + oy)];
  c.fillStyle = NIGHT ? '#1b222c' : '#f4ecd8'; c.fillRect(0, 0, W, H);
  c.fillStyle = NIGHT ? '#2a3340' : '#d9d0b8'; c.strokeStyle = NIGHT ? '#f0e6cf' : '#2b2a28'; c.lineWidth = 1;
  for (const k in OUTLINE.districts) { c.beginPath(); OUTLINE.districts[k].forEach((p, i) => { const [X, Y] = P(p); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); c.fill(); c.stroke(); }
  c.fillStyle = NIGHT ? '#17304a' : '#5b9cc9'; for (const ring of OUTLINE.water) { c.beginPath(); ring.forEach((p, i) => { const [X, Y] = P(p); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); c.fill(); }
  // viewport rectangle (screen units -> minimap): view.x/y are scale-1 screen coords; sx = (x+y), sy = (x-y)/2 - z*ZF ; ignore z
  const hw = VW / view.S / 2, hh = VH / view.S / 2; const rx = Math.round(view.x * sc + ox), ry = Math.round((view.y + 200 * ZF) * sc + oy);
  c.strokeStyle = '#c2583a'; c.lineWidth = 2; c.strokeRect(rx - hw * sc, ry - hh * sc, Math.max(3, hw * 2 * sc), Math.max(3, hh * 2 * sc));
  mm._fit = { sc, ox, oy };
}
function drawHud() { drawMinimap(); const el = document.getElementById('zoom'); if (el) el.textContent = (view.S >= 1 ? view.S.toFixed(1) : view.S.toFixed(2)) + ' px/m'; }

// ---------------------------------------------------------------- coordinates
let PROJ = null; // lon/lat <-> local metres (Krovak); set by index origin via a small affine approximation around Prague
function setupProj() {
  // Krovak is a conformal conic; over 25 km an affine fit from 3 reference points is accurate to ~1 m. Reference points computed server-side are embedded in index.json as 'ref'.
  const r = INDEX.ref; // [[lon,lat,x,y],...]
  if (!r) return;
  // solve least squares affine: x = a*lon + b*lat + c ; y = d*lon + e*lat + f
  const n = r.length; let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const [lon, lat, x, y] of r) { const v = [lon, lat, 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += v[i] * v[j]; bx[i] += v[i] * x; by[i] += v[i] * y; } }
  function solve(A, b) { const M = A.map((row, i) => [...row, b[i]]); for (let i = 0; i < 3; i++) { let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;[M[i], M[p]] = [M[p], M[i]]; for (let k = i + 1; k < 3; k++) { const fct = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= fct * M[i][j]; } } const x = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = M[i][3]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; } return x; }
  const cx = solve(A, bx), cy = solve(A, by);
  PROJ = { fwd: (lon, lat) => [cx[0] * lon + cx[1] * lat + cx[2], cy[0] * lon + cy[1] * lat + cy[2]], inv: (x, y) => { const det = cx[0] * cy[1] - cx[1] * cy[0]; const X = x - cx[2], Y = y - cy[2]; return [(cy[1] * X - cx[1] * Y) / det, (-cy[0] * X + cx[0] * Y) / det]; } };
}
function goToLonLat(lon, lat, S) { if (!PROJ) return; const [x, y] = PROJ.fwd(lon, lat); goToXY(x, y, S); }
function goToXY(x, y, S) { const z = terrainAt(x, y); view.x = x + y; view.y = (x - y) / 2 - z * ZF; if (S) view.S = S; needRender = true; updateHash(); }
function terrainAt(x, y) { const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK); const ch = CHUNKS.get(chunkKey(cx, cy)); if (ch) return ch.zAt(x - ch.ox, y - ch.oy); const info = INDEX.chunks[chunkKey(cx, cy)]; return info ? info[0] / 10 : 220; }
function updateHash() { if (!PROJ) return; const d = 2 * view.y; const x = (view.x + d) / 2, y = (view.x - d) / 2; /* approx (ignores z) */ const [lon, lat] = PROJ.inv(x, y); try { history.replaceState(null, '', '#p-' + Math.round(lat * 1e5) + '-' + Math.round(lon * 1e5) + '-' + Math.round(view.S * 1000)); } catch (e) {} }

// ---------------------------------------------------------------- input
function setupInput() {
  let drag = null; let pinch = null;
  const pos = e => ({ x: e.clientX, y: e.clientY });
  canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; canvas.style.cursor = 'grabbing'; });
  window.addEventListener('mousemove', e => { if (!drag) return; view.x = drag.vx - (e.clientX - drag.x) / view.S; view.y = drag.vy - (e.clientY - drag.y) / view.S; });
  window.addEventListener('mouseup', () => { if (drag) updateHash(); drag = null; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0015); zoomAt(e.clientX, e.clientY, k); }, { passive: false });
  canvas.addEventListener('touchstart', e => { if (e.touches.length === 1) { const t = e.touches[0]; drag = { x: t.clientX, y: t.clientY, vx: view.x, vy: view.y }; } else if (e.touches.length === 2) { drag = null; const a = e.touches[0], b = e.touches[1]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), S: view.S, cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2, vx: view.x, vy: view.y }; } }, { passive: true });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); if (e.touches.length === 1 && drag) { const t = e.touches[0]; view.x = drag.vx - (t.clientX - drag.x) / view.S; view.y = drag.vy - (t.clientY - drag.y) / view.S; } else if (e.touches.length === 2 && pinch) { const a = e.touches[0], b = e.touches[1]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); const ns = Math.max(0.125, Math.min(4, pinch.S * d / pinch.d)); const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2; const wx = pinch.vx + (pinch.cx - VW / 2) / pinch.S, wy = pinch.vy + (pinch.cy - VH / 2) / pinch.S; view.S = ns; view.x = wx - (mx - VW / 2) / ns; view.y = wy - (my - VH / 2) / ns; } }, { passive: false });
  canvas.addEventListener('touchend', () => { drag = null; pinch = null; updateHash(); });
  window.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; const st = 60 / view.S; if (e.key === 'ArrowLeft') view.x -= st; if (e.key === 'ArrowRight') view.x += st; if (e.key === 'ArrowUp') view.y -= st; if (e.key === 'ArrowDown') view.y += st; if (e.key === '+' || e.key === '=') zoomAt(VW / 2, VH / 2, 2); if (e.key === '-') zoomAt(VW / 2, VH / 2, 0.5); if (e.key === 'n') toggleNight(); if (e.key === 'l') { LABELS = !LABELS; } });
}
function zoomAt(mx, my, k) { const ns = Math.max(0.125, Math.min(4, view.S * k)); const wx = view.x + (mx - VW / 2) / view.S, wy = view.y + (my - VH / 2) / view.S; view.S = ns; view.x = wx - (mx - VW / 2) / ns; view.y = wy - (my - VH / 2) / ns; updateHash(); }
function toggleNight() { NIGHT = !NIGHT; document.body.classList.toggle('night', NIGHT); for (const ch of CHUNKS.values()) if (ch) { /* items are colour-independent */ } }

// ---------------------------------------------------------------- boot
function setupMinimap() {
  const mm = document.getElementById('minimap'); if (!mm) return;
  mm.addEventListener('click', e => { const f = mm._fit; if (!f) return; const r = mm.getBoundingClientRect(); const mx = (e.clientX - r.left) * mm.width / r.width, my = (e.clientY - r.top) * mm.height / r.height; const sx = (mx - f.ox) / f.sc, sy = (my - f.oy) / f.sc - 200 * ZF; view.x = sx; view.y = sy; updateHash(); });
}
async function boot() {
  canvas = document.getElementById('map'); ctx = canvas.getContext('2d');
  const resize = () => { VW = window.innerWidth; VH = window.innerHeight; canvas.width = VW; canvas.height = VH; canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px'; }; window.addEventListener('resize', resize); resize();
  await loadIndex(); setupProj(); setupInput(); setupMinimap();
  const m = /^#p-(\d+)-(\d+)-(\d+)$/.exec(location.hash); if (m) goToLonLat(+m[2] / 1e5, +m[1] / 1e5, Math.max(0.125, Math.min(4, +m[3] / 1000))); else goToLonLat(14.4135, 50.0865, 2); // Charles Bridge
  requestAnimationFrame(frame);
}
window.TP = { goToLonLat, goToXY, view, toggleNight, zoomAt, CHUNKS, get INDEX() { return INDEX; }, get PROJ() { return PROJ; }, set labels(v) { LABELS = v; }, requestChunk, renderTile, chunksForRect, prepareChunk, buildItems, drawItems, snapCanvas, PAL };
document.addEventListener('DOMContentLoaded', boot);
