const { chromium } = require('playwright');
(async () => {
  const [,, hash, out, w, h, wait] = process.argv;
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: +w || 1400, height: +h || 900 }, deviceScaleFactor: 1 });
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto('http://localhost:8765/index.html#' + hash, { waitUntil: 'load' });
  await page.waitForTimeout(+wait || 6000);
  await page.screenshot({ path: out });
  const stats = await page.evaluate(() => ({ chunks: TP.CHUNKS.size, S: TP.view.S }));
  console.log(JSON.stringify(stats), errs.slice(0, 5).join(' | '));
  await browser.close();
})();
