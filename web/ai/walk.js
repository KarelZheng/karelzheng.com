/* Walk mode for the painted isometric map: a small pixel walker you steer across the painting.
   Moves in screen directions; vertical image motion is foreshortened by the 45 deg camera, so ground speed stays true.
   Needs window.TP = { viewer, meta, CO, pinEls, showCard, goTo, exists } from index.html. */
(() => {
  const TP = window.TP, { viewer, meta, CO, pinEls, showCard, exists } = TP;
  const vp = () => viewer.viewport, $ = id => document.getElementById(id);
  const MPP = meta.mpp, FORE = Math.sin(45 * Math.PI / 180);
  const SPEEDS = [5, 15, 50, 150, 500, 2000];   // km/h
  const W = { on: false, picking: false, x: 0, y: 0, dir: 0, frame: 0, t: 0, si: 3, keys: new Set(), ptr: null, userS: 3, met: new Set() };

  // ------------------------------------------------------------- sprite (12 x 18 pixel walker, 4 directions x 4 frames)
  const PAL = { k: '#2b2a28', s: '#e8b894', h: '#4a3426', r: '#c2583a', p: '#2f3b52', b: '#f4ecd8', w: '#ffffff', o: '#7a5a3a' };
  const BODY = {   // rows 0-11: head + torso; legs drawn per frame
    down: ['    hhhh    ', '   hhhhhh   ', '   hsssssh  ', '   skssks   ', '   ssssss   ', '    ssss    ', '  rrrrrrrr  ', ' srrrrrrrrs ', ' srrrrrrrrs ', ' s rrrrrr s ', '   rrrrrr   ', '   pppppp   '],
    up:   ['    hhhh    ', '   hhhhhh   ', '   hhhhhh   ', '   hhhhhh   ', '   shhhhs   ', '    ssss    ', '  rbbbbbbr  ', ' rrbbbbbbrr ', ' srbbbbbbrs ', ' s bbbbbb s ', '   rrrrrr   ', '   pppppp   '],
    left: ['    hhhh    ', '   hhhhhh   ', '  sshhhhh   ', '  kssshhh   ', '   sssss    ', '    sss     ', '    rrrrb   ', '   srrrrbb  ', '   srrrrbb  ', '   srrrrb   ', '    rrrr    ', '    pppp    '],
  };
  const LEGS = {   // 6 rows, frames 0..3
    front: [['   pp  pp   ', '   pp  pp   ', '   pp  pp   ', '   pp  pp   ', '   kk  kk   ', '            '],
            ['   pp  pp   ', '   pp  pp   ', '   pp   pp  ', '   pp   pp  ', '   kk   kk  ', '            '],
            ['   pp  pp   ', '   pp  pp   ', '   pp  pp   ', '   pp  pp   ', '   kk  kk   ', '            '],
            ['   pp  pp   ', '   pp  pp   ', '  pp   pp   ', '  pp   pp   ', '  kk   kk   ', '            ']],
    side:  [['    pppp    ', '    pppp    ', '    pppp    ', '    pppp    ', '    kkkk    ', '            '],
            ['    pp pp   ', '   pp   pp  ', '   pp   pp  ', '  pp     pp ', '  kk     kk ', '            '],
            ['    pppp    ', '    pppp    ', '    pppp    ', '    pppp    ', '    kkkk    ', '            '],
            ['    pp pp   ', '   pp   pp  ', '   pp   pp  ', '  pp     pp ', '  kk     kk ', '            ']],
  };
  const SC = 4, SW = 12, SH = 18, sheet = document.createElement('canvas');
  sheet.width = SW * SC * 4; sheet.height = SH * SC * 4;
  (() => {
    const g = sheet.getContext('2d');
    const put = (rows, ox, oy, mirror) => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === ' ') return; g.fillStyle = PAL[ch]; g.fillRect((ox + (mirror ? SW - 1 - x : x)) * SC, (oy + y) * SC, SC, SC); }));
    ['down', 'up', 'left', 'right'].forEach((d, di) => { for (let f = 0; f < 4; f++) {
      const ox = f * SW, oy = di * SH, body = BODY[d === 'right' ? 'left' : d], legs = (d === 'down' || d === 'up') ? LEGS.front[f] : LEGS.side[f];
      const bob = (f % 2) ? 1 : 0;
      put(body, ox, oy + bob, d === 'right'); put(legs, ox, oy + 12, d === 'right');
    } });
  })();
  const DIRS = { down: 0, up: 1, left: 2, right: 3 };

  // ------------------------------------------------------------- DOM
  const el = document.createElement('canvas'); el.id = 'walker'; el.width = SW * SC; el.height = SH * SC; const EW = 30, EH = 45; el.style.width = EW + 'px'; el.style.height = EH + 'px'; document.body.appendChild(el);
  const shadow = document.createElement('div'); shadow.id = 'wshadow'; document.body.appendChild(shadow);
  const ctx = el.getContext('2d');
  const hud = $('walkhud'), osd = $('osd');
  const draw = () => { ctx.clearRect(0, 0, el.width, el.height); ctx.drawImage(sheet, W.frame * SW * SC, W.dir * SH * SC, SW * SC, SH * SC, 0, 0, SW * SC, SH * SC); };

  const curS = () => vp().viewportToImageZoom(vp().getZoom()) / MPP;   // screen px per metre
  const toScreen = (x, y) => vp().pixelFromPoint(vp().imageToViewportCoordinates(new OpenSeadragon.Point(x, y)), true);
  const onCanvas = (x, y) => x >= 0 && y >= 0 && x < meta.width && y < meta.height && exists(x, y);

  function setSpeed(i) { W.si = Math.max(0, Math.min(SPEEDS.length - 1, i)); $('wspeed').textContent = SPEEDS[W.si] + ' km/h'; document.querySelectorAll('#wbtns button[data-s]').forEach(b => b.classList.toggle('on', +b.dataset.s === W.si)); }

  function enter() {
    W.on = true; W.picking = true; document.body.classList.add('walking', 'picking'); $('walk').classList.add('on');
    $('whint').textContent = 'click anywhere on the map to start walking there';
  }
  function exit() {
    W.on = false; W.picking = false; document.body.classList.remove('walking', 'picking', 'placed'); $('walk').classList.remove('on');
    viewer.setMouseNavEnabled(true); W.keys.clear(); W.ptr = null;
  }
  function place(x, y) {
    if (!onCanvas(x, y)) { $('whint').textContent = 'that spot is off the painting, pick another one'; return; }
    W.x = x; W.y = y; W.picking = false; W.met.clear(); document.body.classList.remove('picking'); document.body.classList.add('placed');
    $('whint').textContent = 'WASD or arrows to walk, or hold the mouse where you want to go. 1-6 speed, shift x5, N new start, Esc stop';
    W.userS = Math.max(curS(), 2.5);
    vp().zoomTo(vp().imageToViewportZoom(W.userS * MPP), null, false); vp().panTo(vp().imageToViewportCoordinates(new OpenSeadragon.Point(x, y)), false);
    viewer.setMouseNavEnabled(false);
  }
  viewer.addHandler('canvas-click', e => {
    if (!W.on || !W.picking || !e.quick) return; e.preventDefaultAction = true;
    const p = vp().viewportToImageCoordinates(vp().pointFromPixel(e.position)); place(p.x, p.y);
  });

  // ------------------------------------------------------------- input
  addEventListener('keydown', e => {
    if (!W.on || e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); e.stopPropagation();
    if (k === 'escape') { exit(); return; }
    if (k === 'n') { W.picking = true; document.body.classList.add('picking'); document.body.classList.remove('placed'); viewer.setMouseNavEnabled(true); $('whint').textContent = 'click anywhere on the map to start walking there'; return; }
    if (k >= '1' && k <= '6') { setSpeed(+k - 1); return; }
    W.keys.add(k); if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  }, true);
  addEventListener('keyup', e => W.keys.delete(e.key.toLowerCase())); addEventListener('blur', () => W.keys.clear());
  osd.addEventListener('pointerdown', e => { if (W.on && !W.picking) { W.ptr = [e.clientX, e.clientY]; osd.setPointerCapture(e.pointerId); } });
  osd.addEventListener('pointermove', e => { if (W.ptr) W.ptr = [e.clientX, e.clientY]; });
  const up = () => { W.ptr = null; }; osd.addEventListener('pointerup', up); osd.addEventListener('pointercancel', up);
  osd.addEventListener('wheel', e => { if (!W.on || W.picking) return; e.preventDefault(); W.userS = Math.max(0.05, Math.min(20, W.userS * (e.deltaY < 0 ? 1.4 : 1 / 1.4))); }, { passive: false });
  $('walk').onclick = () => (W.on ? exit() : enter());
  $('wstop').onclick = exit; $('wnew').onclick = () => { W.keys.add('n'); dispatchEvent(new KeyboardEvent('keydown', { key: 'n' })); W.keys.delete('n'); };
  document.querySelectorAll('#wbtns button[data-s]').forEach(b => b.onclick = () => setSpeed(+b.dataset.s));
  setSpeed(3);

  // ------------------------------------------------------------- loop
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const show = W.on && !W.picking; el.style.display = shadow.style.display = show ? 'block' : 'none';
    if (!show) return;
    // direction in screen space
    let dx = 0, dy = 0; const K = W.keys;
    if (K.has('w') || K.has('arrowup')) dy -= 1; if (K.has('s') || K.has('arrowdown')) dy += 1;
    if (K.has('a') || K.has('arrowleft')) dx -= 1; if (K.has('d') || K.has('arrowright')) dx += 1;
    const sp = toScreen(W.x, W.y);
    if (W.ptr) { const ux = W.ptr[0] - sp.x, uy = W.ptr[1] - (sp.y - 20); const L = Math.hypot(ux, uy); if (L > 12) { dx = ux / L; dy = uy / L; } }
    const L = Math.hypot(dx, dy); let moving = L > 0;
    const kmh = SPEEDS[W.si] * (K.has('shift') ? 5 : 1), mps = kmh / 3.6;
    if (moving) {
      dx /= L; dy /= L;
      const nx = W.x + dx * mps * dt / MPP, ny = W.y + dy * mps * dt * FORE / MPP;
      if (onCanvas(nx, ny)) { W.x = nx; W.y = ny; } else if (onCanvas(nx, W.y)) W.x = nx; else if (onCanvas(W.x, ny)) W.y = ny; else moving = false;
      W.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? DIRS.left : DIRS.right) : (dy < 0 ? DIRS.up : DIRS.down);
      W.t += dt * Math.min(14, 6 + kmh / 60); W.frame = Math.floor(W.t) % 4;
    } else { W.frame = 0; W.t = 0; }
    // camera: follow; zoom out when fast so the ground does not blur past (walker crosses ~1/3 screen per second at most)
    const fit = Math.min(innerWidth, innerHeight) / 3 / Math.max(mps, 0.1);
    const wantS = moving ? Math.min(W.userS, Math.max(0.04, fit)) : W.userS;
    const S = curS(), nS = S + (wantS - S) * Math.min(1, dt * 2.5);
    vp().zoomTo(vp().imageToViewportZoom(nS * MPP), null, true);
    vp().panTo(vp().imageToViewportCoordinates(new OpenSeadragon.Point(W.x, W.y)), true);
    const p = toScreen(W.x, W.y);
    el.style.left = (p.x - EW / 2) + 'px'; el.style.top = (p.y - EH + 3) + 'px';
    shadow.style.left = (p.x - 10) + 'px'; shadow.style.top = (p.y - 3) + 'px';
    draw();
    $('wspeed').textContent = Math.round(moving ? kmh : 0) + ' km/h';
    // passing a startup opens its card
    if ((W.k = (W.k || 0) + 1) % 10 === 0) for (let i = 0; i < CO.length; i++) {
      const c = CO[i]; if (W.met.has(i)) continue;
      const dm = Math.hypot((c.x - W.x) * MPP, (c.y - W.y) * MPP / FORE);
      if (dm < Math.max(40, mps * 0.4)) { W.met.add(i); showCard(c, pinEls[i]); }
    }
  }
  requestAnimationFrame(loop);
  window.WALK = { W, place, enter, exit, setSpeed };
})();
