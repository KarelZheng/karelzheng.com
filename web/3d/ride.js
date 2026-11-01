/* Scooter ride mode: an original retro scooter driven over the baked city meshes.
   Physics is arcade: a down ray finds the street under the wheels (steps up to a kerb are allowed, higher is a wall),
   two forward rays stop the scooter at facades. Three.js frame: X east, Y up, -Z north. */
import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const MAXV = 14, BOOSTV = 21, ACC = 5.5, BRAKE = 11, DRAG = 0.35, STEP = 1.1, GRAV = 9.8;

function buildScooter() {
  const g = new THREE.Group();
  const mint = new THREE.MeshLambertMaterial({ color: '#8fd3c1', flatShading: true });
  const cream = new THREE.MeshLambertMaterial({ color: '#f4ecd8', flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: '#2b2a28', flatShading: true });
  const chrome = new THREE.MeshLambertMaterial({ color: '#c9ccd1', flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: '#c2583a', flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: '#e8b894', flatShading: true });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); g.add(m); return m; };
  // body: rounded rear shell, floorboard, front shield (scooter faces -Z)
  add(new THREE.SphereGeometry(0.42, 10, 8), mint, 0, 0.55, 0.42, 0, 0, 0, 0.85, 0.75, 1.25);
  add(new THREE.BoxGeometry(0.42, 0.08, 0.7), cream, 0, 0.3, -0.18);
  add(new THREE.BoxGeometry(0.5, 0.9, 0.1), mint, 0, 0.72, -0.58, -0.18);
  add(new THREE.BoxGeometry(0.16, 0.5, 0.16), mint, 0, 0.38, -0.66);              // fork cover
  add(new THREE.SphereGeometry(0.2, 8, 6), mint, 0, 0.42, -0.74, 0, 0, 0, 0.8, 0.6, 1.1); // front mudguard
  add(new THREE.BoxGeometry(0.34, 0.12, 0.62), dark, 0, 0.92, 0.38);               // seat
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 6), chrome, 0, 1.18, -0.64, 0, 0, Math.PI / 2); // handlebar
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), chrome, 0, 0.95, -0.66, -0.18);              // steering column
  const lamp = add(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), cream, 0, 1.14, -0.72, Math.PI / 2);
  add(new THREE.BoxGeometry(0.12, 0.06, 0.03), red, 0, 0.62, 0.95);                // tail light
  const wheels = [];
  for (const z of [-0.74, 0.62]) { const w = add(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 12), dark, 0, 0.22, z, 0, 0, Math.PI / 2); wheels.push(w); add(new THREE.CylinderGeometry(0.11, 0.11, 0.15, 8), chrome, 0, 0.22, z, 0, 0, Math.PI / 2); }
  // rider: torso, head, helmet, arms, legs
  const rider = new THREE.Group(); g.add(rider);
  const r = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; rider.add(m); return m; };
  r(new THREE.BoxGeometry(0.42, 0.55, 0.26), red, 0, 1.3, 0.28, -0.25);
  r(new THREE.BoxGeometry(0.24, 0.24, 0.24), skin, 0, 1.72, 0.16);
  r(new THREE.SphereGeometry(0.17, 10, 8), cream, 0, 1.8, 0.17);
  for (const s of [-1, 1]) { r(new THREE.BoxGeometry(0.1, 0.1, 0.55), red, s * 0.24, 1.35, -0.18, 0.5); r(new THREE.BoxGeometry(0.14, 0.14, 0.5), dark, s * 0.13, 0.82, -0.02, 1.2); r(new THREE.BoxGeometry(0.14, 0.4, 0.14), dark, s * 0.13, 0.5, -0.28); }
  g.userData = { wheels, lamp };
  return g;
}

export function createRide(ctx) {
  const { scene, camera, controls, CH, C, X0, Y0, stream, $ } = ctx;
  const S = { on: false, pos: new THREE.Vector3(), h: 0, v: 0, vy: 0, lean: 0, steer: 0, keys: new Set(), touch: {}, bvh: new WeakSet(), near: null, nearT: 0 };
  const scooter = buildScooter(); scooter.visible = false; scene.add(scooter);
  const hemi = new THREE.HemisphereLight('#fff7e8', '#6f7f6a', 1.6); const sun = new THREE.DirectionalLight('#ffffff', 1.4); sun.position.set(-3, 6, 2);
  scene.add(hemi, sun);
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const DOWN = new THREE.Vector3(0, -1, 0), tmp = new THREE.Vector3(), dir = new THREE.Vector3();

  function meshesNear(p) {
    const cx = Math.floor((p.x + X0) / C), cy = Math.floor((-p.z + Y0) / C), out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const rec = CH.get((cx + dx) + '_' + (cy + dy)); if (!rec || !rec.mesh) continue;
      if (!S.bvh.has(rec.mesh.geometry)) { rec.mesh.geometry.computeBoundsTree(); S.bvh.add(rec.mesh.geometry); }
      out.push(rec.mesh);
    }
    return out;
  }
  const cast = (o, d, far, ms) => { ray.set(o, d); ray.far = far; let best = null; for (const m of ms) { const h = ray.intersectObject(m, false)[0]; if (h && (!best || h.distance < best.distance)) best = h; } return best; };
  const topAt = (x, z, ms) => { const h = cast(tmp.set(x, 3000, z), DOWN, 6000, ms); return h ? h.point.y : null; };

  // spawn on open street near the view centre: low ground (not a roof), facing the longest clear run
  function freeRun(x, y, z, a, ms) { const h = cast(tmp.set(x, y + 1.2, z), new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), 80, ms); return h ? h.distance : 80; }
  function spawnNear(t, prefH) {
    const ms = meshesNear(t), pts = [];
    for (let r = 0; r <= 120; r += 8) for (let a = 0; a < (r ? 16 : 1); a++) {
      const x = t.x + Math.cos(a / 16 * 6.283) * r, z = t.z + Math.sin(a / 16 * 6.283) * r, y = topAt(x, z, ms);
      if (y !== null) pts.push([x, y, z, r]);
    }
    if (!pts.length) return false;
    const minY = Math.min(...pts.map(p => p[1]));
    let best = null;
    for (const [x, y, z, r] of pts) {
      if (y > minY + 2) continue;
      let open = 0, bestA = 0, bestScore = -1;
      for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283, f = freeRun(x, y, z, a, ms); open += f; const sc = f - (prefH === undefined ? 0 : 12 * (1 - Math.cos(a - prefH))); if (sc > bestScore) { bestScore = sc; bestA = a; } }
      const score = open / 16 - r * 0.15;
      if (!best || score > best[0]) best = [score, x, y, z, bestA];
    }
    if (!best) return false;
    S.pos.set(best[1], best[2], best[3]); S.h = best[4]; S.v = 0; S.vy = 0; return true;
  }

  // ---------------------------------------------------------------- audio
  let ac = null, eng = null, engGain = null, muted = false;
  function audioOn() {
    if (ac) { ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      eng = ac.createOscillator(); eng.type = 'sawtooth'; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
      engGain = ac.createGain(); engGain.gain.value = 0; eng.connect(f); f.connect(engGain); engGain.connect(ac.destination); eng.start();
    } catch (e) { ac = null; }
  }
  function horn() {
    if (!ac || muted) return; const t = ac.currentTime;
    for (const fr of [415, 494]) { const o = ac.createOscillator(), gn = ac.createGain(); o.type = 'square'; o.frequency.value = fr; gn.gain.setValueAtTime(0.06, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.45); o.connect(gn); gn.connect(ac.destination); o.start(t); o.stop(t + 0.5); }
  }

  // ---------------------------------------------------------------- input
  const down = k => S.keys.has(k);
  addEventListener('keydown', e => {
    if (!S.on || e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); S.keys.add(k);
    if (k === ' ' || k === 'h') { horn(); e.preventDefault(); }
    if (k === 'escape') stop(); if (k === 'r') spawnNear(S.pos.clone(), S.h); if (k === 'm') { muted = !muted; }
    if (k.startsWith('arrow')) e.preventDefault();
  }, true);
  addEventListener('keyup', e => S.keys.delete(e.key.toLowerCase())); addEventListener('blur', () => S.keys.clear());
  for (const [id, k] of [['tl', 'left'], ['tr', 'right'], ['tg', 'gas'], ['tb', 'brake']]) {
    const el = $(id); if (!el) continue;
    const on = e => { e.preventDefault(); S.touch[k] = true; el.classList.add('on'); }, off = e => { e.preventDefault(); S.touch[k] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
  }
  if ($('thorn')) $('thorn').onclick = horn;

  // ---------------------------------------------------------------- start / stop
  let saved = null;
  function start() {
    if (S.on) return;
    audioOn();
    const f = controls.target.clone().sub(camera.position);
    if (!spawnNear(controls.target.clone(), Math.atan2(f.x, -f.z))) { $('ridemsg').textContent = 'the city is still loading here, try again in a second'; return; }
    saved = { near: camera.near, far: camera.far };
    camera.near = 0.4; camera.far = 4000; camera.updateProjectionMatrix();
    S.on = true; controls.enabled = false; scooter.visible = true; document.body.classList.add('riding');
    camera.position.copy(S.pos).add(new THREE.Vector3(-Math.sin(S.h) * 11, 6, Math.cos(S.h) * 11));
    $('ride').classList.add('on');
  }
  function stop() {
    if (!S.on) return;
    S.on = false; scooter.visible = false; document.body.classList.remove('riding'); $('ride').classList.remove('on');
    if (engGain) engGain.gain.setTargetAtTime(0, ac.currentTime, 0.1);
    camera.near = saved.near; camera.far = saved.far; camera.updateProjectionMatrix();
    controls.target.copy(S.pos); const off = new THREE.Vector3(-Math.sin(S.h), 0.9, Math.cos(S.h)).setLength(320); camera.position.copy(S.pos).add(off);
    controls.enabled = true; controls.update();
  }

  // ---------------------------------------------------------------- physics
  function update(dt) {
    if (!S.on) return;
    const gas = down('w') || down('arrowup') || S.touch.gas, brk = down('s') || down('arrowdown') || S.touch.brake;
    const left = down('a') || down('arrowleft') || S.touch.left, right = down('d') || down('arrowright') || S.touch.right;
    const boost = down('shift'), vmax = boost ? BOOSTV : MAXV;
    if (gas) S.v += ACC * (boost ? 1.4 : 1) * dt * (1 - Math.max(0, S.v) / vmax);
    else if (brk) S.v -= (S.v > 0.2 ? BRAKE : 2.5) * dt;
    else S.v -= Math.sign(S.v) * Math.min(Math.abs(S.v), (DRAG + 0.04 * Math.abs(S.v)) * dt * 3);
    S.v = Math.max(-3, Math.min(vmax, S.v));
    const st = (right ? 1 : 0) - (left ? 1 : 0); S.steer += (st - S.steer) * Math.min(1, dt * 6);
    const turn = S.steer * Math.min(1.9, 0.6 + Math.abs(S.v) * 0.18) * Math.sign(S.v || 1);
    if (Math.abs(S.v) > 0.05) S.h += turn * dt;
    const ms = meshesNear(S.pos);
    if (!ms.length) { S.v = 0; return; }
    dir.set(Math.sin(S.h), 0, -Math.cos(S.h));
    const stepLen = S.v * dt;
    if (Math.abs(stepLen) > 1e-4) {
      const fwd = dir.clone().multiplyScalar(Math.sign(stepLen));
      let blocked = false;
      for (const hgt of [0.7, 1.5]) { const hit = cast(tmp.copy(S.pos).setY(S.pos.y + hgt), fwd, Math.abs(stepLen) + 0.9, ms); if (hit && Math.abs(hit.face ? hit.face.normal.y : 0) < 0.6) { blocked = true; break; } }
      const nx = S.pos.x + dir.x * stepLen, nz = S.pos.z + dir.z * stepLen;
      const g = cast(tmp.set(nx, S.pos.y + STEP + 1.2, nz), DOWN, 60, ms);
      if (!g || g.point.y > S.pos.y + STEP) blocked = true;
      if (blocked) { S.v = -S.v * 0.25; bump(); }
      else { S.pos.x = nx; S.pos.z = nz; S.ground = g.point.y; }
    }
    const g = cast(tmp.set(S.pos.x, S.pos.y + STEP + 1.2, S.pos.z), DOWN, 80, ms);
    const gy = g ? g.point.y : S.pos.y;
    if (S.pos.y > gy + 0.05) { S.vy -= GRAV * dt; S.pos.y = Math.max(gy, S.pos.y + S.vy * dt); }
    else { S.pos.y += (gy - S.pos.y) * Math.min(1, dt * 18); S.vy = 0; }
    // pose: yaw, lean into turns, pitch along slope
    S.lean += (-S.steer * Math.min(1, Math.abs(S.v) / 8) * 0.38 - S.lean) * Math.min(1, dt * 5);
    scooter.position.copy(S.pos); scooter.rotation.set(0, -S.h, 0); scooter.rotateZ(S.lean);
    for (const w of scooter.userData.wheels) w.rotation.x += S.v * dt / 0.22;
    // chase camera
    const back = 10 + Math.abs(S.v) * 0.18;
    const want = tmp.set(S.pos.x - dir.x * back, S.pos.y + 5.5 + Math.abs(S.v) * 0.08, S.pos.z - dir.z * back);
    camera.position.lerp(want, 1 - Math.exp(-dt * 4));
    if (camera.position.y < S.pos.y + 1.5) camera.position.y = S.pos.y + 1.5;
    controls.target.copy(S.pos);
    camera.lookAt(S.pos.x + dir.x * 9, S.pos.y + 1.2, S.pos.z + dir.z * 9);
    // engine
    if (engGain) { engGain.gain.setTargetAtTime(muted ? 0 : 0.025 + Math.abs(S.v) * 0.002, ac.currentTime, 0.05); eng.frequency.setTargetAtTime(48 + Math.abs(S.v) * 7 + (gas ? 14 : 0), ac.currentTime, 0.08); }
    $('speed').textContent = Math.round(Math.abs(S.v) * 3.6) + ' km/h';
  }
  let bumpT = 0; function bump() { const t = performance.now(); if (t - bumpT < 400) return; bumpT = t; if (ac && !muted) { const o = ac.createOscillator(), gn = ac.createGain(); o.type = 'triangle'; o.frequency.value = 90; gn.gain.setValueAtTime(0.08, ac.currentTime); gn.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15); o.connect(gn); gn.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.2); } }

  $('ride').onclick = () => (S.on ? stop() : start());
  if ($('rideexit')) $('rideexit').onclick = stop;
  return { S, update, start, stop, get on() { return S.on; } };
}
