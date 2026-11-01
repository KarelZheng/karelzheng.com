/* Tiny Prague Startups 3D (painted): streams baked chunks (mesh + atlas painted from four AI paintings) and shows
   Prague's startups as logos above their buildings. Local frame: x east, y north, z metres above sea.
   Three.js frame: X = x - X0, Y = z - Z0, Z = -(y - Y0). */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

const BASE = './';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const CAPTURE = !!params.get('capture');
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const SKY = new THREE.Color('#cfe3ec');
const scene = new THREE.Scene(); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 2600, 7500);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 3, 10000);
const controls = new MapControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 25; controls.maxDistance = 8000; controls.screenSpacePanning = false;
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const MAN = await (await fetch(BASE + 'manifest.json')).json();   // { C, keys, center:[x,y], z, ref }
const C = MAN.C, [X0, Y0] = MAN.center, Z0 = MAN.z;
const KEYS = MAN.keys.map(k => { const [cx, cy] = k.split('_').map(Number); return { k, cx, cy, x: cx * C + C / 2 - X0, y: cy * C + C / 2 - Y0 }; });
const toW = (x, y, z) => new THREE.Vector3(x - X0, z - Z0, -(y - Y0));
// lon/lat <-> local (least-squares affine through the procedural map's reference points)
const AFF = (() => {
  const solve = k => { const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (const r of MAN.ref) { const p = [r[0], r[1], 1]; for (let i = 0; i < 3; i++) { v[i] += p[i] * r[k]; for (let j = 0; j < 3; j++) A[i][j] += p[i] * p[j]; } }
    const M = A.map((row, i) => [...row, v[i]]);
    for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]]; for (let r = i + 1; r < 3; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; } }
    const x = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = M[i][3]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; } return x; };
  const cx = solve(2), cy = solve(3), det = cx[0] * cy[1] - cx[1] * cy[0];
  return { fwd: (lon, lat) => [cx[0] * lon + cx[1] * lat + cx[2], cy[0] * lon + cy[1] * lat + cy[2]], inv: (x, y) => { const X = x - cx[2], Y = y - cy[2]; return [(cy[1] * X - cx[1] * Y) / det, (-cy[0] * X + cx[0] * Y) / det]; } };
})();

// ------------------------------------------------------------ chunk streaming
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const loader = new THREE.TextureLoader();
const CH = new Map(); let inflight = 0;
function tex(url) { return new Promise((res, rej) => loader.load(url, t => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = Math.min(8, maxAniso); res(t); }, undefined, rej)); }
async function load(key) {
  const rec = { state: 'loading' }; CH.set(key, rec);
  try {
    const buf = await (await fetch(BASE + 'chunks/' + key + '.bin')).arrayBuffer();
    const hl = new DataView(buf).getUint32(0, true); const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
    let off = 4 + hl; const q = new Int16Array(buf, off, hdr.n * 3); off += hdr.n * 6; const uq = new Uint16Array(buf, off, hdr.n * 2); off += hdr.n * 4;
    const idx = hdr.i32 ? new Uint32Array(buf, off, hdr.m) : new Uint16Array(buf, off, hdr.m);
    const [cx, cy] = key.split('_').map(Number); const ox = cx * C - X0, oy = cy * C - Y0;
    const pos = new Float32Array(hdr.n * 3), uv = new Float32Array(hdr.n * 2);
    for (let i = 0; i < hdr.n; i++) { pos[i * 3] = ox + q[i * 3] / 50; pos[i * 3 + 1] = hdr.zb + q[i * 3 + 2] / 50 - Z0; pos[i * 3 + 2] = -(oy + q[i * 3 + 1] / 50); uv[i * 2] = uq[i * 2] / 65535; uv[i * 2 + 1] = uq[i * 2 + 1] / 65535; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
    const lo = await tex(BASE + 'chunks/' + key + '_lo.webp');
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: lo, side: THREE.DoubleSide })); m.matrixAutoUpdate = false; scene.add(m);
    Object.assign(rec, { state: 'lo', mesh: m, lo }); pinsFor(cx, cy, m);
  } catch (e) { rec.state = 'fail'; }
}
async function upgrade(key, rec) { rec.state = 'hi-loading'; try { const hi = await tex(BASE + 'chunks/' + key + '.webp'); if (!rec.mesh) return; rec.mesh.material.map = hi; rec.mesh.material.needsUpdate = true; rec.hi = hi; rec.state = 'hi'; } catch (e) { rec.state = 'lo'; } }
function downgrade(rec) { if (!rec.hi) return; rec.mesh.material.map = rec.lo; rec.mesh.material.needsUpdate = true; rec.hi.dispose(); rec.hi = null; rec.state = 'lo'; }
function drop(key, rec) { scene.remove(rec.mesh); rec.mesh.geometry.dispose(); rec.mesh.material.dispose(); rec.lo.dispose(); if (rec.hi) rec.hi.dispose(); CH.delete(key); }
function stream() {
  const t = controls.target; const dist = camera.position.distanceTo(t);
  const R = Math.min(6500, Math.max(1000, dist * 2.6)), RH = Math.max(450, Math.min(1500, dist * 1.4));
  const cand = [];
  for (const c of KEYS) {
    const d = Math.hypot(c.x - t.x, c.y + t.z); const rec = CH.get(c.k);
    if (!rec) { if (d < R) cand.push([d, c.k]); }
    else if (rec.state === 'lo' && d < RH) cand.push([d - 1e6, c.k]);
    else if (rec.state === 'hi' && d > RH * 1.5) downgrade(rec);
    else if (rec.state === 'lo' && d > R * 1.6) drop(c.k, rec);
  }
  cand.sort((a, b) => a[0] - b[0]);
  for (const [, k] of cand) { if (inflight >= 8) break; const rec = CH.get(k); inflight++; (rec ? upgrade(k, rec) : load(k)).finally(() => inflight--); }
}

// ------------------------------------------------------------ startups
let CO = [];
const ray = new THREE.Raycaster(); const DOWN = new THREE.Vector3(0, -1, 0);
function pinsFor(cx, cy, mesh) {
  for (const c of CO) {
    if (Math.floor(c.lx / C) !== cx || Math.floor(c.ly / C) !== cy) continue;
    // highest surface within 6 m of the address (the building, not the street in front of it)
    let top = -1e9;
    for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) { ray.set(new THREE.Vector3(c.lx + dx - X0, 2000, -(c.ly + dy - Y0)), DOWN); const h = ray.intersectObject(mesh, false)[0]; if (h) top = Math.max(top, h.point.y + Z0); }
    if (top > -1e8) { c.z = top + 8; c.world = toW(c.lx, c.ly, c.z); }
  }
}
const v3 = new THREE.Vector3();
function updateTags() {
  const camDist = camera.position.distanceTo(controls.target);
  for (const c of CO) {
    if (!c.el) continue; if (!c.world) { c.el.style.display = 'none'; continue; }
    v3.copy(c.world).project(camera);
    if (v3.z > 1 || v3.x < -1.1 || v3.x > 1.1 || v3.y < -1.1 || v3.y > 1.1) { c.el.style.display = 'none'; continue; }
    const d = camera.position.distanceTo(c.world); if (d > 6500) { c.el.style.display = 'none'; continue; }
    c.el.style.display = ''; c.el.style.left = ((v3.x + 1) / 2 * innerWidth) + 'px'; c.el.style.top = ((1 - v3.y) / 2 * innerHeight) + 'px';
    c.el.classList.toggle('near', d < 900 && camDist < 900);
  }
}
const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
let selTag = null;
function showCard(c) {
  if (selTag) selTag.classList.remove('sel'); selTag = c.el; if (c.el) c.el.classList.add('sel');
  $('cname').textContent = c.name; $('cdesc').textContent = c.desc; $('caddr').textContent = c.address;
  $('clogo').src = c.logo ? BASE + c.logo : ''; $('clogo').style.display = c.logo ? '' : 'none';
  $('clinks').innerHTML = (c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">website</a>` : '') + (c.linkedin ? `<a href="${esc(c.linkedin)}" target="_blank" rel="noopener">linkedin</a>` : '');
  $('card').classList.add('on');
}
$('closecard').onclick = () => { $('card').classList.remove('on'); if (selTag) selTag.classList.remove('sel'); };

// ------------------------------------------------------------ camera
let FLY = null;
function groundAt(x, y) { // terrain height from any loaded chunk, else the manifest's mean
  for (const [, rec] of CH) if (rec.mesh) { ray.set(new THREE.Vector3(x - X0, 2000, -(y - Y0)), DOWN); const h = ray.intersectObject(rec.mesh, false)[0]; if (h) return h.point.y + Z0; }
  return Z0;
}
function flyTo(x, y, z, dist) {
  const target = toW(x, y, z); const off = camera.position.clone().sub(controls.target); off.setLength(dist || Math.min(off.length(), 600));
  FLY = { ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: target.clone().add(off), t0: performance.now(), dur: 1500 };
}
function place(az, el, dist, tx, ty, tz) { const a = az * Math.PI / 180, e = el * Math.PI / 180; controls.target.set(tx, ty, tz); camera.position.set(tx + Math.sin(a) * Math.cos(e) * dist, ty + Math.sin(e) * dist, tz + Math.cos(a) * Math.cos(e) * dist); camera.lookAt(controls.target); controls.update(); }
function startView(lat, lon, S) { const [x, y] = AFF.fwd(lon, lat); const t = toW(x, y, Z0); place(-15, 42, Math.max(250, Math.min(6000, 900 / Math.max(0.05, S))), t.x, t.y, t.z); }
const KEYSD = new Set();
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; KEYSD.add(e.key.toLowerCase()); });
addEventListener('keyup', e => KEYSD.delete(e.key.toLowerCase())); addEventListener('blur', () => KEYSD.clear());
function keyFly(dt) {
  if (!KEYSD.size) return; const dist = camera.position.distanceTo(controls.target); const sp = Math.max(60, dist * 0.9) * dt * (KEYSD.has('shift') ? 3 : 1);
  const fwd = controls.target.clone().sub(camera.position); fwd.y = 0; fwd.normalize(); const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize(); const mv = new THREE.Vector3();
  if (KEYSD.has('w') || KEYSD.has('arrowup')) mv.add(fwd); if (KEYSD.has('s') || KEYSD.has('arrowdown')) mv.sub(fwd);
  if (KEYSD.has('d') || KEYSD.has('arrowright')) mv.add(right); if (KEYSD.has('a') || KEYSD.has('arrowleft')) mv.sub(right);
  if (KEYSD.has('e')) mv.y += 0.6; if (KEYSD.has('q')) mv.y -= 0.6;
  if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); controls.target.add(mv); camera.position.add(mv); FLY = null; }
}

// ------------------------------------------------------------ UI
let pinsOn = true; try { pinsOn = localStorage.getItem('tp-pins') !== '0'; } catch (e) {}
function setPins(on) { pinsOn = on; document.body.classList.toggle('nopins', !on); $('pins').classList.toggle('on', on); try { localStorage.setItem('tp-pins', on ? '1' : '0'); } catch (e) {} }
$('pins').onclick = () => setPins(!pinsOn); setPins(pinsOn);
$('zin').onclick = () => { const off = camera.position.clone().sub(controls.target).multiplyScalar(0.55); camera.position.copy(controls.target).add(off); };
$('zout').onclick = () => { const off = camera.position.clone().sub(controls.target).multiplyScalar(1.8); camera.position.copy(controls.target).add(off); };
$('share').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(location.href); $('share').textContent = 'ok'; setTimeout(() => $('share').textContent = '@', 1200); };
const FLAT = MAN.flat || 'https://tiny-prague-startups.vercel.app/ai/';
let hashT = 0;
function syncHash() { clearTimeout(hashT); hashT = setTimeout(() => { const t = controls.target; const [lon, lat] = AFF.inv(t.x + X0, -t.z + Y0); const S = 900 / camera.position.distanceTo(t);
  const h = '#p-' + Math.round(lat * 1e5) + '-' + Math.round(lon * 1e5) + '-' + Math.round(S * 1000); try { history.replaceState(null, '', h); } catch (e) {} $('flat').href = FLAT + h; }, 250); }
controls.addEventListener('change', syncHash);

let L = [], NL = [], hits = [], sel = -1, hdr = '';
const KIND = ['city', 'district', 'quarter', 'station', 'museum', 'landmark', 'park', 'street', 'startup'];
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function render() {
  $('results').innerHTML = (hdr && hits.length ? `<li class="hdr">${hdr}</li>` : '') + hits.map((h, i) => h[5]
    ? `<li data-i="${i}" class="co ${i === sel ? 'sel' : ''}"><img src="${BASE}${esc(h[5].logo || '')}" alt="" loading="lazy"><span>${esc(h[0])} <small>${esc(h[4])}</small></span></li>`
    : `<li data-i="${i}" class="${i === sel ? 'sel' : ''}">${esc(h[0])}${h[4] ? ' <small>' + esc(h[4]) + '</small>' : ''} <small>${KIND[h[3]] || ''}</small></li>`).join('');
}
function listAll() { hdr = CO.length + ' Prague startups &amp; funds'; hits = L.slice(0, CO.length); sel = -1; render(); }
function pick(h) {
  hits = []; hdr = ''; render(); $('search').blur();
  if (h[5]) { setPins(true); const c = h[5]; flyTo(c.lx, c.ly, c.z ? c.z - 8 : groundAt(c.lx, c.ly), 380); showCard(c); }
  else flyTo(h[1], h[2], groundAt(h[1], h[2]), h[3] <= 1 ? 2200 : 500);
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
const m = /^#p-(\d+)-(\d+)-(\d+)$/.exec(location.hash);
if (m) startView(+m[1] / 1e5, +m[2] / 1e5, +m[3] / 1000); else startView(50.0868, 14.4205, 1.5);
$('flat').href = FLAT + (location.hash || '');
const [comp, labels] = await Promise.all([fetch(BASE + 'companies.json').then(r => r.json()).catch(() => ({ companies: [] })), fetch(BASE + 'labels.json').then(r => r.json()).catch(() => [])]);
CO = comp.companies;
for (const c of CO) {
  [c.lx, c.ly] = AFF.fwd(c.lon, c.lat);
  const el = document.createElement('div'); el.className = 'tag'; el.title = c.name; el.style.display = 'none';
  el.innerHTML = `<div class="nm">${esc(c.name)}</div><div class="lg" style="${c.logo ? `background-image:url('${BASE}${esc(c.logo)}')` : ''}"></div><div class="st"></div>`;
  el.onclick = () => showCard(c); document.body.appendChild(el); c.el = el;
}
L = CO.map(c => [c.name, c.lx, c.ly, 8, c.desc, c]).concat(labels.map(p => [p[0], p[1], p[2], p[3], p[4]]));
NL = L.map(l => norm(l[0] + ' ' + (l[4] || '')));
for (const [k, rec] of CH) if (rec.mesh) { const [cx, cy] = k.split('_').map(Number); pinsFor(cx, cy, rec.mesh); }

// capture hooks (video and screenshots in headless browsers)
window.setView = (az, el, dist, tx, ty, tz) => place(az, el, dist, tx, ty, tz);
window.settle = async () => { for (let i = 0; i < 80; i++) { stream(); await new Promise(r => setTimeout(r, 200)); if (!inflight) { stream(); if (!inflight) break; } } renderer.render(scene, camera); updateTags(); };
window.grab = () => { renderer.render(scene, camera); return canvas.toDataURL('image/png'); };
window.P3D_READY = true;

let last = performance.now(), fr = 0;
(function loop(now) {
  requestAnimationFrame(loop); now = now || performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (FLY) { const k = Math.min(1, (now - FLY.t0) / FLY.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; controls.target.lerpVectors(FLY.ft, FLY.tt, e); camera.position.lerpVectors(FLY.fp, FLY.tp, e); if (k >= 1) FLY = null; }
  keyFly(dt); controls.update(); if (fr++ % 12 === 0) stream();
  if (!CAPTURE) { renderer.render(scene, camera); updateTags(); }
  if ($('loading') && [...CH.values()].filter(r => r.mesh).length >= 6) $('loading').remove();
})();
setTimeout(() => { if ($('loading')) $('loading').remove(); }, 15000);
