/* Tiny Prague Startups 3D: the procedural city data (OSM + ČÚZK lidar chunks) as a three.js scene.
   Local data frame: x east, y north, z metres above sea. Three.js frame: X = x - X0, Y = z, Z = -(y - Y0). */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

const DATA = '/chunks/';
const AI = '/ai/tiles/';
const $ = id => document.getElementById(id);

// ------------------------------------------------------------ palette (same as the 2D procedural map)
const LC = ['#cfc6b5', '#bfb8ac', '#a9a59c', '#d9c48a', '#9cc46f', '#8fb46a', '#9dc06a', '#a3c080', '#86c26a', '#5f9148', '#d3c7ae', '#b7ad9a', '#bdb2a0', '#5a93b4'];
const ROAD = { 1: '#7d7d7f', 2: '#858587', 3: '#8a8a8c', 4: '#90908f', 5: '#979795', 6: '#a19f9b', 7: '#c9bea6', 8: '#aaa8a3', 9: '#b9a78a', 10: '#c6b995', 11: '#c0b391', 20: '#6e665e', 21: '#8d8782', 22: '#6e665e', 30: '#5b9cc9', 31: '#6aa9d3' };
const ROAD_W = { 1: 14, 2: 8, 3: 12, 4: 9, 5: 8, 6: 6.5, 7: 5, 8: 4, 9: 3, 10: 2.2, 11: 2.2, 20: 3.2, 21: 2.6, 22: 3, 30: 7, 31: 3 };
const FACADE = ['#f1e2c3', '#e9d6b1', '#f3dcc6', '#dfe3c4', '#d8e1e6', '#f6efdf', '#e6cfa6', '#efe6d2', '#c9c3b8', '#b9b5ad', '#d6d3cc', '#dcd1c0', '#c8d0d4', '#f4e6b4', '#f2d2c4', '#dde6d3', '#efe1cf', '#f7f1e6'];
const ROOF = { r: '#c2583a', s: '#6f7378', c: '#5f9a86', g: '#9c9a94', l: '#9fb9c4' };
const ROOF_RED = ['#c2583a', '#b34f30', '#cf6948', '#a9492d', '#c65f3e'];
const WATER = '#5a93b4', BRIDGE = '#8a8580';
const SKY = new THREE.Color('#cfe3ec');

const col = new THREE.Color();
function hash2(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// ------------------------------------------------------------ renderer, scene, camera
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let PIX = 2; try { if (localStorage.getItem('tp3d-pix') === '0') PIX = 1; } catch (e) {}
const dpr = Math.min(window.devicePixelRatio || 1, 2);
function resize() { renderer.setPixelRatio(dpr / (PIX === 2 ? 2 * dpr : 1)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
const scene = new THREE.Scene(); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 2500, 7000);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 5, 12000);
scene.add(new THREE.HemisphereLight('#f4f0e6', '#8a8a78', 0.85));
const sun = new THREE.DirectionalLight('#fff3dc', 2.3); sun.position.set(-0.92, 1.25, -0.39); scene.add(sun); // same light direction as the 2D map (from the north-west)
resize(); addEventListener('resize', resize);

const controls = new MapControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 40; controls.maxDistance = 9000; controls.zoomSpeed = 1.2;

const matTerrain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const matFlat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const matBld = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const matTree = new THREE.MeshLambertMaterial({ color: '#4c8a3c', flatShading: true });
const treeGeo = new THREE.IcosahedronGeometry(1, 0);

// ------------------------------------------------------------ data index + lon/lat affine
let INDEX, CHUNK, ZSTEP, LCRES, NV, NC, X0 = 0, Y0 = 0, AFF;
const toWorld = (x, y, z) => new THREE.Vector3(x - X0, z, -(y - Y0));
function fitAffine(ref) { // x = a*lon + b*lat + c (least squares)
  const solve = (k) => { const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (const r of ref) { const p = [r[0], r[1], 1]; for (let i = 0; i < 3; i++) { v[i] += p[i] * r[k]; for (let j = 0; j < 3; j++) A[i][j] += p[i] * p[j]; } }
    const M = A.map((row, i) => [...row, v[i]]);
    for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]]; for (let r = i + 1; r < 3; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; } }
    const x = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = M[i][3]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; } return x; };
  const cx = solve(2), cy = solve(3); const det = cx[0] * cy[1] - cx[1] * cy[0];
  return { fwd: (lon, lat) => [cx[0] * lon + cx[1] * lat + cx[2], cy[0] * lon + cy[1] * lat + cy[2]],
           inv: (x, y) => { const X = x - cx[2], Y = y - cy[2]; return [(cy[1] * X - cx[1] * Y) / det, (-cy[0] * X + cx[0] * Y) / det]; } };
}

// ------------------------------------------------------------ chunks
const CHUNKS = new Map();     // key -> {group, ch} | 'pending' | null
const PACKS = new Map();      // pack key -> 'pending' | 'done'
const BUILDQ = [];            // chunks waiting for geometry
function b64u16(s, n) { const bin = atob(s); const out = new Uint16Array(n); for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); return out; }
function rleDecode(s, n) { const out = new Uint8Array(n); let p = 0; for (const run of s.split(',')) { const [v, c] = run.split(':'); out.fill(+v, p, p + +c); p += +c; } return out; }
function prep(j, cx, cy) {
  const z = b64u16(j.z, NV * NV); const zm = new Float32Array(NV * NV); for (let i = 0; i < zm.length; i++) zm[i] = (z[i] + j.z0) / 10;
  const lc = rleDecode(j.lc, NC * NC); const ox = cx * CHUNK, oy = cy * CHUNK;
  const zAt = (lx, ly) => { const fx = Math.max(0, Math.min(NV - 1.0001, lx / ZSTEP)), fy = Math.max(0, Math.min(NV - 1.0001, ly / ZSTEP)); const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, i = iy * NV + ix;
    return zm[i] * (1 - tx) * (1 - ty) + zm[i + 1] * tx * (1 - ty) + zm[i + NV] * (1 - tx) * ty + zm[i + NV + 1] * tx * ty; };
  return { cx, cy, ox, oy, zm, lc, raw: j, zAt };
}
function loadPack(pk) {
  PACKS.set(pk, 'pending');
  fetch(DATA + pk + '.json').then(r => r.json()).then(j => {
    for (const k in j) { const [cx, cy] = k.split('_').map(Number); const ch = prep(j[k], cx, cy); CHUNKS.set(k, { ch, group: null }); BUILDQ.push(k); }
    PACKS.set(pk, 'done');
  }).catch(e => { console.warn(pk, e); PACKS.delete(pk); });
}

class Buf { // non-indexed triangle soup with per-vertex colours
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, color) { this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); for (let i = 0; i < 3; i++) this.c.push(color.r, color.g, color.b); }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  mesh(mat) { if (!this.p.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; return m; }
}
const cA = new THREE.Color(), cB = new THREE.Color();
function jitter(hex, s) { cA.set(hex); const f = 0.96 + 0.08 * s; return cA.clone().multiplyScalar(f); }
function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function pip(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (((a[1] > y) !== (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

function buildChunk(key) {
  const rec = CHUNKS.get(key); if (!rec || rec.group) return;
  const { ch } = rec; const { ox, oy, lc, raw, zAt } = ch; const group = new THREE.Group();
  // terrain: 8 m cells, flat colour per cell (land-cover majority at the cell centre)
  const T = new Buf(); const cs = 8, n = CHUNK / cs, step = cs / LCRES;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const cls = lc[(j * step + (step >> 1)) * NC + i * step + (step >> 1)]; if (cls === 255) continue;
    const x0 = i * cs, y0 = j * cs; let z1 = zAt(x0, y0), z2 = zAt(x0 + cs, y0), z3 = zAt(x0 + cs, y0 + cs), z4 = zAt(x0, y0 + cs);
    if (cls === 13) { const m = Math.min(z1, z2, z3, z4) - 0.6; z1 = z2 = z3 = z4 = m; }
    T.quad(toWorld(ox + x0, oy + y0, z1), toWorld(ox + x0 + cs, oy + y0, z2), toWorld(ox + x0 + cs, oy + y0 + cs, z3), toWorld(ox + x0, oy + y0 + cs, z4), jitter(LC[cls] || LC[0], hash2(ox + x0, oy + y0)));
  }
  const tm = T.mesh(matTerrain); if (tm) group.add(tm);
  // water polygons, roads and bridge decks: flat colour layers just above the ground
  const F = new Buf();
  const fillRings = (rings, zf, color) => {
    const outer = rings[0].map(p => new THREE.Vector2(p[0], p[1])); if (outer.length < 3) return;
    const holes = rings.slice(1).filter(h => h.length >= 3).map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse(); holes.forEach(h => { if (!THREE.ShapeUtils.isClockWise(h)) h.reverse(); });
    const pts = outer.concat(...holes); let tris; try { tris = THREE.ShapeUtils.triangulateShape(outer, holes); } catch (e) { return; }
    for (const [a, b, c] of tris) { const A = pts[a], B = pts[b], C = pts[c]; F.tri(toWorld(A.x, A.y, zf(A)), toWorld(B.x, B.y, zf(B)), toWorld(C.x, C.y, zf(C)), color); }
  };
  cB.set(WATER);
  for (const rings of raw.w) {
    const rr = rings.map(r => { const o = []; for (let k = 0; k < r.length; k += 3) o.push([ox + r[k] / 4, oy + r[k + 1] / 4, r[k + 2] / 10]); return o; });
    let zmin = 1e9; for (const p of rr[0]) zmin = Math.min(zmin, p[2]); fillRings(rr, () => zmin - 0.3, cB.clone());
  }
  for (const rings of (raw.bp || [])) {
    const rr = rings.map(r => { const o = []; for (let k = 0; k < r.length; k += 3) o.push([ox + r[k] / 4, oy + r[k + 1] / 4, r[k + 2] / 10]); return o; });
    const zb = rr[0][0][2]; fillRings(rr, () => zb + 0.4, new THREE.Color(BRIDGE));
  }
  for (const [cls, bridge, arr] of raw.r) {
    if (cls === 11 || cls === 10 || cls === 30 || cls === 31) continue; const w = ROAD_W[cls] || 3; const c = new THREE.Color(ROAD[cls] || '#a19f9b'); if (bridge) c.set(BRIDGE);
    for (let k = 0; k + 3 < arr.length; k += 3) {
      const P = [ox + arr[k] / 4, oy + arr[k + 1] / 4, arr[k + 2] / 10 + 0.25], Q = [ox + arr[k + 3] / 4, oy + arr[k + 4] / 4, arr[k + 5] / 10 + 0.25];
      const dx = Q[0] - P[0], dy = Q[1] - P[1], L = Math.hypot(dx, dy); if (L < 0.01) continue; const nx = -dy / L * w / 2, ny = dx / L * w / 2;
      F.quad(toWorld(P[0] + nx, P[1] + ny, P[2]), toWorld(P[0] - nx, P[1] - ny, P[2]), toWorld(Q[0] - nx, Q[1] - ny, Q[2]), toWorld(Q[0] + nx, Q[1] + ny, Q[2]), c);
    }
  }
  const fm = F.mesh(matFlat); if (fm) { fm.renderOrder = 1; group.add(fm); }
  // buildings
  const B = new Buf(); const tops = [];
  for (const b of raw.b) {
    const [rings, hdm, basedm, roof, roofc, fc, minhdm, rhdm] = b; const inset = b[8];
    const h = hdm / 10, base = basedm / 10, minh = (minhdm || 0) / 10, rh = (rhdm || 0) / 10;
    const rr = rings.map(r => { const o = []; for (let k = 0; k < r.length; k += 2) o.push([ox + r[k] / 4, oy + r[k + 1] / 4]); return o; });
    if (rr[0].length < 3) continue;
    if (ringArea(rr[0]) < 0) rr[0].reverse(); for (let i = 1; i < rr.length; i++) if (ringArea(rr[i]) > 0) rr[i].reverse();
    const seed = hash2(rings[0][0] + ch.cx * 7, rings[0][1] + ch.cy * 13);
    const fcol = new THREE.Color(typeof fc === 'string' ? fc : (FACADE[fc] || FACADE[0]));
    const rcol = new THREE.Color(typeof roofc === 'string' && roofc[0] === '#' ? roofc : roofc === 'r' ? ROOF_RED[(seed * 97) % 5 | 0] : (ROOF[roofc] || ROOF.g));
    const zb = base + minh - (minh > 0 ? 0 : 3), zt = base + h;
    // walls (outer ring counter-clockwise, holes clockwise: both face outwards from the solid)
    for (const r of rr) for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      B.quad(toWorld(p[0], p[1], zb), toWorld(q[0], q[1], zb), toWorld(q[0], q[1], zt), toWorld(p[0], p[1], zt), fcol);
    }
    // roof
    let roofTop = zt;
    if (roof === 'p' && inset && rr.length === 1 && rh > 0.5) {
      const ins = []; for (let k = 0; k < inset.length; k += 2) ins.push([ox + inset[k] / 4, oy + inset[k + 1] / 4]);
      if (ins.length >= 3) {
        const outer = rr[0].map(p => new THREE.Vector2(p[0], p[1])); const inner = ins.map(p => new THREE.Vector2(p[0], p[1]));
        if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse(); if (!THREE.ShapeUtils.isClockWise(inner)) inner.reverse();
        const pts = outer.concat(inner); const nO = outer.length;
        try {
          for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(outer, [inner])) { const z = i => i < nO ? zt : zt + rh; B.tri(toWorld(pts[a].x, pts[a].y, z(a)), toWorld(pts[b2].x, pts[b2].y, z(b2)), toWorld(pts[c].x, pts[c].y, z(c)), rcol); }
          const cap = inner.slice().reverse(); for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(cap, [])) B.tri(toWorld(cap[a].x, cap[a].y, zt + rh), toWorld(cap[b2].x, cap[b2].y, zt + rh), toWorld(cap[c].x, cap[c].y, zt + rh), rcol);
          roofTop = zt + rh;
        } catch (e) { flatRoof(B, rr, zt, rcol); }
      } else flatRoof(B, rr, zt, rcol);
    } else if ((roof === 'd' || roof === 'o') && rr.length === 1) {
      flatRoof(B, rr, zt, rcol);
      let cx = 0, cy = 0; for (const p of rr[0]) { cx += p[0]; cy += p[1]; } cx /= rr[0].length; cy /= rr[0].length;
      const rad = Math.sqrt(Math.abs(ringArea(rr[0])) / Math.PI) * (roof === 'd' ? 0.8 : 0.7); const hh = roof === 'd' ? Math.max(rh, rad * 0.8) : Math.max(rh, rad * 3);
      const N = 8; const apex = toWorld(cx, cy, zt + hh);
      for (let i = 0; i < N; i++) { const a1 = i / N * Math.PI * 2, a2 = (i + 1) / N * Math.PI * 2; B.tri(toWorld(cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad, zt), toWorld(cx + Math.cos(a2) * rad, cy + Math.sin(a2) * rad, zt), apex, rcol); }
      roofTop = zt + hh;
    } else flatRoof(B, rr, zt, rcol);
    tops.push({ ring: rr[0], top: roofTop });
  }
  const bm = B.mesh(matBld); if (bm) group.add(bm);
  // trees: OSM trees plus a few per forest / park cell
  const tp = [];
  const tr = raw.t || []; for (let k = 0; k < tr.length; k += 2) tp.push([ox + tr[k] / 4, oy + tr[k + 1] / 4, 1]);
  for (let j = 0; j < NC; j += 3) for (let i = 0; i < NC; i += 3) { const c = lc[j * NC + i]; if (c === 9 || (c === 4 && hash2(i + ox, j + oy) < 0.12)) tp.push([ox + (i + hash2(i, j + 7) * 3) * LCRES, oy + (j + hash2(i + 5, j) * 3) * LCRES, c === 9 ? 1.3 : 1]); }
  if (tp.length) {
    const im = new THREE.InstancedMesh(treeGeo, matTree, tp.length); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    tp.forEach(([x, y, f], i) => { const r = (3 + hash2(x | 0, y | 0) * 2.5) * f; s.set(r, r * 1.25, r); m.compose(toWorld(x, y, zAt(x - ox, y - oy) + r * 1.1), q, s); im.setMatrixAt(i, m); im.setColorAt(i, col.set(hash2(y | 0, x | 0) < 0.5 ? '#4c8a3c' : '#5d9a47')); });
    im.instanceMatrix.needsUpdate = true; group.add(im);
  }
  rec.group = group; rec.tops = tops; scene.add(group);
  placePinsIn(rec);
}
function flatRoof(B, rr, zt, rcol) {
  const outer = rr[0].map(p => new THREE.Vector2(p[0], p[1])); const holes = rr.slice(1).filter(h => h.length >= 3).map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse(); holes.forEach(h => { if (!THREE.ShapeUtils.isClockWise(h)) h.reverse(); });
  const pts = outer.concat(...holes); let tris; try { tris = THREE.ShapeUtils.triangulateShape(outer, holes); } catch (e) { return; }
  for (const [a, b, c] of tris) B.tri(toWorld(pts[a].x, pts[a].y, zt), toWorld(pts[b].x, pts[b].y, zt), toWorld(pts[c].x, pts[c].y, zt), rcol);
}
function dropChunk(key) { const rec = CHUNKS.get(key); if (!rec || !rec.group) return; scene.remove(rec.group); rec.group.traverse(o => { if (o.geometry && o.geometry !== treeGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); }); rec.group = null; }

// stream chunks around the controls target; radius grows with camera distance
function stream() {
  if (!INDEX) return;
  const t = controls.target; const x = t.x + X0, y = -t.z + Y0; const dist = camera.position.distanceTo(t);
  const R = Math.min(5200, Math.max(1100, dist * 2.4)); const P = INDEX.pack || 1;
  const want = [];
  const c0x = Math.floor((x - R) / CHUNK), c1x = Math.floor((x + R) / CHUNK), c0y = Math.floor((y - R) / CHUNK), c1y = Math.floor((y + R) / CHUNK);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const k = cx + '_' + cy; if (!INDEX.chunks[k]) continue; const d = Math.hypot((cx + 0.5) * CHUNK - x, (cy + 0.5) * CHUNK - y); if (d > R) continue;
    const rec = CHUNKS.get(k);
    if (!rec) { const pk = Math.floor(cx / P) + '_' + Math.floor(cy / P); if (!PACKS.has(pk)) want.push([d, pk]); }
    else if (!rec.group && !BUILDQ.includes(k)) BUILDQ.push(k);
  }
  want.sort((a, b) => a[0] - b[0]); const inflight = [...PACKS.values()].filter(v => v === 'pending').length;
  for (const [, pk] of want.slice(0, Math.max(0, 6 - inflight))) if (!PACKS.has(pk)) loadPack(pk);
  // build nearest first
  BUILDQ.sort((a, b) => dd(a, x, y) - dd(b, x, y));
  for (const [k, rec] of CHUNKS) if (rec && rec.group && dd(k, x, y) > R + 900) dropChunk(k);
}
function dd(k, x, y) { const [cx, cy] = k.split('_').map(Number); return Math.hypot((cx + 0.5) * CHUNK - x, (cy + 0.5) * CHUNK - y); }

// ------------------------------------------------------------ startups (HTML tags projected each frame)
let CO = [];
const tagLayer = document.body;
function placePinsIn(rec) {
  const { ch } = rec;
  for (const c of CO) {
    if (Math.floor(c.lx / CHUNK) !== ch.cx || Math.floor(c.ly / CHUNK) !== ch.cy) continue;
    let top = ch.zAt(c.lx - ch.ox, c.ly - ch.oy);
    for (const t of rec.tops) if (pip(c.lx, c.ly, t.ring)) { top = Math.max(top, t.top); break; }
    if (top === ch.zAt(c.lx - ch.ox, c.ly - ch.oy)) for (const t of rec.tops) { let best = 1e9; for (const p of t.ring) best = Math.min(best, Math.hypot(p[0] - c.lx, p[1] - c.ly)); if (best < 15) top = Math.max(top, t.top); }
    c.z = top + 6; c.world = toWorld(c.lx, c.ly, c.z);
  }
}
const v3 = new THREE.Vector3();
function updateTags() {
  const camDist = camera.position.distanceTo(controls.target); document.body.classList.toggle('names', camDist < 700);
  for (const c of CO) {
    if (!c.el) continue; if (!c.world) { c.el.style.display = 'none'; continue; }
    v3.copy(c.world).project(camera);
    if (v3.z > 1 || v3.x < -1.1 || v3.x > 1.1 || v3.y < -1.1 || v3.y > 1.1) { c.el.style.display = 'none'; continue; }
    const d = camera.position.distanceTo(c.world); if (d > 6000) { c.el.style.display = 'none'; continue; }
    c.el.style.display = ''; c.el.style.left = ((v3.x + 1) / 2 * innerWidth) + 'px'; c.el.style.top = ((1 - v3.y) / 2 * innerHeight) + 'px';
    c.el.style.zIndex = c.el.classList.contains('sel') ? 4 : 3; c.el.classList.toggle('near', d < 900);
  }
}
const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
let selTag = null;
function showCard(c) {
  if (selTag) selTag.classList.remove('sel'); selTag = c.el; if (c.el) c.el.classList.add('sel');
  $('cname').textContent = c.name; $('cdesc').textContent = c.desc; $('caddr').textContent = c.address;
  $('clogo').src = c.logo ? AI + c.logo : ''; $('clogo').style.display = c.logo ? '' : 'none';
  $('clinks').innerHTML = (c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">website</a>` : '') + (c.linkedin ? `<a href="${esc(c.linkedin)}" target="_blank" rel="noopener">linkedin</a>` : '');
  $('card').classList.add('on');
}
$('closecard').onclick = () => { $('card').classList.remove('on'); if (selTag) selTag.classList.remove('sel'); };

// ------------------------------------------------------------ camera moves
let FLY = null; // {from, to, t0, dur}
function flyTo(x, y, z, dist, now) {
  const target = toWorld(x, y, z); const off = camera.position.clone().sub(controls.target);
  if (off.length() < 1) off.set(-0.26, 1, 0.97); off.setLength(dist || Math.min(off.length(), 600));
  if (now) { controls.target.copy(target); camera.position.copy(target).add(off); return; }
  FLY = { ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: target.clone().add(off), t0: performance.now(), dur: 1400 };
}
function startView(lat, lon, S) {
  const [x, y] = AFF.fwd(lon, lat); const z = terrainGuess(x, y); const target = toWorld(x, y, z);
  // the painting's camera: from the south, 15 degrees to the west, 45 degrees down
  const dist = Math.max(250, Math.min(6000, 900 / Math.max(0.05, S)));
  const az = -15 * Math.PI / 180, el = 45 * Math.PI / 180;
  const off = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
  controls.target.copy(target); camera.position.copy(target).add(off); controls.update();
}
function terrainGuess(x, y) { const k = Math.floor(x / CHUNK) + '_' + Math.floor(y / CHUNK); const rec = CHUNKS.get(k); if (rec && rec.ch) return rec.ch.zAt(x - rec.ch.ox, y - rec.ch.oy); const info = INDEX.chunks[k]; return info ? info[0] / 10 : 230; }

// keyboard flying
const KEYS = new Set();
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; KEYS.add(e.key.toLowerCase());
  if (e.key === 's' && !e.repeat && e.altKey) setPins(!pinsOn);
  if (e.key === 'x') setPix(PIX === 2 ? 1 : 2); });
addEventListener('keyup', e => KEYS.delete(e.key.toLowerCase())); addEventListener('blur', () => KEYS.clear());
function keyFly(dt) {
  if (!KEYS.size) return; const dist = camera.position.distanceTo(controls.target); let sp = Math.max(60, dist * 0.9) * dt * (KEYS.has('shift') ? 3 : 1);
  const fwd = controls.target.clone().sub(camera.position); fwd.y = 0; fwd.normalize(); const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const mv = new THREE.Vector3();
  if (KEYS.has('w') || KEYS.has('arrowup')) mv.add(fwd); if (KEYS.has('s') || KEYS.has('arrowdown')) mv.sub(fwd);
  if (KEYS.has('d') || KEYS.has('arrowright')) mv.add(right); if (KEYS.has('a') || KEYS.has('arrowleft')) mv.sub(right);
  if (KEYS.has('e')) mv.y += 0.6; if (KEYS.has('q')) mv.y -= 0.6;
  if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); controls.target.add(mv); camera.position.add(mv); FLY = null; }
}

// ------------------------------------------------------------ UI
let pinsOn = true; try { pinsOn = localStorage.getItem('tp-pins') !== '0'; } catch (e) {}
function setPins(on) { pinsOn = on; document.body.classList.toggle('nopins', !on); $('pins').classList.toggle('on', on); try { localStorage.setItem('tp-pins', on ? '1' : '0'); } catch (e) {} }
function setPix(p) { PIX = p; $('pix').classList.toggle('on', p === 2); try { localStorage.setItem('tp3d-pix', p === 2 ? '1' : '0'); } catch (e) {} resize(); }
$('pins').onclick = () => setPins(!pinsOn); $('pix').onclick = () => setPix(PIX === 2 ? 1 : 2);
$('zin').onclick = () => { const off = camera.position.clone().sub(controls.target).multiplyScalar(0.55); camera.position.copy(controls.target).add(off); };
$('zout').onclick = () => { const off = camera.position.clone().sub(controls.target).multiplyScalar(1.8); camera.position.copy(controls.target).add(off); };
$('share').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(location.href); $('share').textContent = 'ok'; setTimeout(() => $('share').textContent = '@', 1200); };
setPins(pinsOn); setPix(PIX);

function curLatLonS() { const t = controls.target; const [lon, lat] = AFF.inv(t.x + X0, -t.z + Y0); const S = 900 / camera.position.distanceTo(t); return [lat, lon, S]; }
let hashT = 0;
function syncHash() { clearTimeout(hashT); hashT = setTimeout(() => { const [lat, lon, S] = curLatLonS(); const h = '#p-' + Math.round(lat * 1e5) + '-' + Math.round(lon * 1e5) + '-' + Math.round(S * 1000); try { history.replaceState(null, '', h); } catch (e) {} $('flat').href = '/ai/' + h; }, 250); }
controls.addEventListener('change', syncHash);

// search: startups first, then places/streets from the procedural map's index
let L = [], NL = [], hits = [], sel = -1, hdr = '';
const KIND = ['city', 'district', 'quarter', 'station', 'museum', 'landmark', 'park', 'street', 'startup'];
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function render() {
  $('results').innerHTML = (hdr && hits.length ? `<li class="hdr">${hdr}</li>` : '') + hits.map((h, i) => h[5]
    ? `<li data-i="${i}" class="co ${i === sel ? 'sel' : ''}"><img src="${AI}${esc(h[5].logo || '')}" alt="" loading="lazy"><span>${esc(h[0])} <small>${esc(h[4])}</small></span></li>`
    : `<li data-i="${i}" class="${i === sel ? 'sel' : ''}">${esc(h[0])}${h[4] ? ' <small>' + esc(h[4]) + '</small>' : ''} <small>${KIND[h[3]] || ''}</small></li>`).join('');
}
function listAll() { hdr = CO.length + ' Prague startups &amp; funds'; hits = L.slice(0, CO.length); sel = -1; render(); }
function pick(h) {
  hits = []; hdr = ''; render(); $('search').blur();
  if (h[5]) { setPins(true); const c = h[5]; flyTo(c.lx, c.ly, c.z ? c.z - 6 : terrainGuess(c.lx, c.ly), 380); showCard(c); }
  else flyTo(h[1], h[2], terrainGuess(h[1], h[2]), h[3] <= 1 ? 2200 : 500);
}
$('search').oninput = () => {
  const q = norm($('search').value.trim()); sel = -1; hdr = ''; if (!q) { listAll(); return; }
  const out = []; for (let i = 0; i < L.length && out.length < 60; i++) if (L[i][3] === 8 ? NL[i].includes(q) : (q.length >= 2 && NL[i].includes(q))) out.push(L[i]);
  out.sort((a, b) => (b[3] === 8) - (a[3] === 8) || (norm(a[0]).startsWith(q) ? 0 : 1) - (norm(b[0]).startsWith(q) ? 0 : 1) || a[3] - b[3]);
  hits = out.slice(0, 20); render();
};
$('search').onfocus = () => { if (!$('search').value.trim()) listAll(); };
$('search').onblur = () => setTimeout(() => { if (!$('search').value.trim()) { hits = []; hdr = ''; render(); } }, 200);
$('search').onkeydown = e => {
  if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); render(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
  else if (e.key === 'Enter' && hits.length) pick(hits[Math.max(0, sel)]);
  else if (e.key === 'Escape') { hits = []; render(); }
};
$('results').onmousedown = e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(hits[+li.dataset.i]); } };

// ------------------------------------------------------------ boot
(async () => {
  INDEX = await (await fetch(DATA + 'index.json')).json(); CHUNK = INDEX.chunk; ZSTEP = INDEX.zstep; LCRES = INDEX.lcres; NV = CHUNK / ZSTEP + 1; NC = CHUNK / LCRES;
  AFF = fitAffine(INDEX.ref); const [cx0, cy0] = AFF.fwd(14.4214, 50.0875); X0 = Math.round(cx0); Y0 = Math.round(cy0);
  const m = /^#p-(\d+)-(\d+)-(\d+)$/.exec(location.hash);
  if (m) startView(+m[1] / 1e5, +m[2] / 1e5, +m[3] / 1000); else startView(50.0865, 14.4135, 1.4);
  $('flat').href = '/ai/' + (location.hash || '');
  const [comp, labels] = await Promise.all([fetch(AI + 'companies.json').then(r => r.json()).catch(() => ({ companies: [] })), fetch(DATA + 'labels.json').then(r => r.json()).catch(() => [])]);
  CO = comp.companies;
  for (const c of CO) {
    [c.lx, c.ly] = AFF.fwd(c.lon, c.lat);
    const el = document.createElement('div'); el.className = 'tag'; el.title = c.name; el.style.display = 'none';
    el.innerHTML = `<div class="nm">${esc(c.name)}</div><div class="lg" style="${c.logo ? `background-image:url('${AI}${esc(c.logo)}')` : ''}"></div><div class="st"></div>`;
    el.onclick = () => showCard(c); tagLayer.appendChild(el); c.el = el;
  }
  L = CO.map(c => [c.name, c.lx, c.ly, 8, c.desc, c]).concat(labels.map(p => [p[0], p[1], p[2], p[3], p[4]]));
  NL = L.map(l => norm(l[0] + ' ' + (l[4] || '')));
  for (const [, rec] of CHUNKS) if (rec && rec.group) placePinsIn(rec);
})();

let last = performance.now(), frames = 0;
function loop(now) {
  requestAnimationFrame(loop); const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (FLY) { const k = Math.min(1, (now - FLY.t0) / FLY.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; controls.target.lerpVectors(FLY.ft, FLY.tt, e); camera.position.lerpVectors(FLY.fp, FLY.tp, e); if (k >= 1) FLY = null; }
  keyFly(dt); controls.update();
  if (INDEX) {
    if (frames++ % 15 === 0) stream();
    // build a few chunks per frame within a time budget
    const t0 = performance.now(); while (BUILDQ.length && performance.now() - t0 < 10) { const k = BUILDQ.shift(); const rec = CHUNKS.get(k); if (rec && !rec.group) buildChunk(k); }
    if ($('loading') && CHUNKS.size > 20 && BUILDQ.length < 5) $('loading').remove();
  }
  renderer.render(scene, camera); updateTags();
}
requestAnimationFrame(loop);
