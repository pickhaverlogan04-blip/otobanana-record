const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  let chunks = 0;
  let bytes = 0;
  await page.exposeFunction('__deliverChunk', (b64, idx) => {
    chunks++;
    const len = Math.floor((b64.length * 3) / 4);
    bytes += len;
    console.log(`chunk ${idx} ~${len} bytes`);
  });

  page.on('console', (m) => console.log('page:', m.text()));

  await page.addInitScript({ path: 'recorder.js' });
  await page.goto('about:blank');

  const r = await page.evaluate(() => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      gain.gain.value = 0.2;
      osc.frequency.value = 440;
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      ac.resume();
      window.__testCtx = ac;
      return 'osc started, state=' + ac.state;
    } catch (e) {
      return 'err:' + e.message;
    }
  });
  console.log('setup:', r);

  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => ({
      rec: window.__recState || null,
      ctx: window.__testCtx ? window.__testCtx.state : null,
    }));
    console.log('state', JSON.stringify(st));
  }

  await page.evaluate(() => window.__stopRec && window.__stopRec());
  await page.waitForTimeout(3000);
  console.log(`RESULT chunks=${chunks} bytes=${bytes}`);
  await browser.close();
})();
