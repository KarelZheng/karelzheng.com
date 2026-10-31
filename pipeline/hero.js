const { chromium } = require('playwright');
(async () => { const [,, hash, out, w, h, night] = process.argv; const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.goto('http://localhost:8765/index.html#' + hash, { waitUntil: 'load' }); await p.waitForFunction(() => window.TP && TP.INDEX);
  if (night === '1') await p.evaluate(() => TP.toggleNight()); await p.evaluate(() => { TP.labels = false; });
  await p.waitForTimeout(12000); await p.evaluate(() => { for (const el of document.querySelectorAll('.panel')) el.style.display = 'none'; });
  await p.waitForTimeout(300); await p.screenshot({ path: out }); await b.close(); })();
