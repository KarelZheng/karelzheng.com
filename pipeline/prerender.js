// Bake the lowest zoom levels to static PNG tiles using the page's own renderer.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const levels = (process.argv[2] || '0.125,0.25').split(',').map(Number);
  const outRoot = path.resolve(__dirname, '..', 'web', 'tiles'); fs.mkdirSync(outRoot, { recursive: true });
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', e => console.log('PAGEERR', String(e)));
  await page.goto('http://localhost:8765/index.html#50.0865,14.4135,2', { waitUntil: 'load' });
  await page.waitForFunction(() => window.TP && TP.INDEX);
  // load every chunk
  const total = await page.evaluate(() => { const ks = Object.keys(TP.INDEX.chunks); for (const k of ks) { const [cx, cy] = k.split('_').map(Number); TP.requestChunk(cx, cy); } return ks.length; });
  console.log('chunks to load', total);
  await page.waitForFunction(t => TP.CHUNKS.size >= t, total, { timeout: 600000 });
  console.log('all chunks loaded');
  const manifest = {};
  for (const S of levels) {
    const dir = path.join(outRoot, String(S)); fs.mkdirSync(dir, { recursive: true }); manifest[String(S)] = [];
    const bounds = await page.evaluate((S) => {
      const C = TP.INDEX.chunk, ZF = 0.85; let sx0 = 1e18, sx1 = -1e18, sy0 = 1e18, sy1 = -1e18;
      for (const k in TP.INDEX.chunks) { const [cx, cy] = k.split('_').map(Number); const ox = cx * C, oy = cy * C; const info = TP.INDEX.chunks[k]; const zlo = info[0] / 10, zhi = info[1] / 10 + 8;
        sx0 = Math.min(sx0, (ox + oy) * S); sx1 = Math.max(sx1, (ox + oy + 2 * C) * S); sy0 = Math.min(sy0, ((ox - oy - C) / 2 - zhi * ZF) * S); sy1 = Math.max(sy1, ((ox - oy + C) / 2 - zlo * ZF) * S); }
      return { tx0: Math.floor(sx0 / 512), tx1: Math.floor(sx1 / 512), ty0: Math.floor(sy0 / 512), ty1: Math.floor(sy1 / 512) };
    }, S);
    console.log('level', S, bounds);
    let n = 0;
    for (let ty = bounds.ty0; ty <= bounds.ty1; ty++) for (let tx = bounds.tx0; tx <= bounds.tx1; tx++) {
      const data = await page.evaluate(([S, tx, ty]) => { const need = TP.chunksForRect(S, tx * 512, ty * 512, tx * 512 + 512, ty * 512 + 512); if (!need.length) return null; let any = false; for (const [cx, cy] of need) if (TP.CHUNKS.get(cx + '_' + cy)) any = true; if (!any) return null; const c = TP.renderTile(S, tx, ty, false); return c ? c.toDataURL('image/png') : null; }, [S, tx, ty]);
      if (!data) continue;
      fs.writeFileSync(path.join(dir, tx + '_' + ty + '.png'), Buffer.from(data.split(',')[1], 'base64')); manifest[String(S)].push(tx + '_' + ty); n++;
    }
    console.log('level', S, 'tiles', n);
  }
  fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest));
  await browser.close();
})();
