const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto('http://localhost:8765/index.html#50.0865,14.4135,2', { waitUntil: 'load' }); await p.waitForFunction(() => window.TP && TP.INDEX); await p.evaluate(() => TP.toggleNight()); await p.waitForTimeout(9000);
  await p.screenshot({ path: process.argv[2] }); await b.close(); })();
