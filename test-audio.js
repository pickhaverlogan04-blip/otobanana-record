const { chromium } = require('playwright');

const MP3 = 'https://media.otobanana.com/converted/users/a283e196-f4f8-4811-962b-a265c4ba6872/casts/89905f11-68cf-42cf-a529-83ca09760b88.mp3';

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

  await page.addInitScript({ path: 'recorder.js' });
  await page.goto('about:blank');

  await page.evaluate((src) => {
    const a = document.createElement('audio');
    a.src = src;
    a.loop = true;
    document.body.appendChild(a);
    return a.play().then(() => 'playing').catch((e) => 'fail:' + e.message);
  }, MP3).then((r) => console.log('play:', r));

  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.__recState || null);
    console.log('state', JSON.stringify(st));
  }

  await page.evaluate(() => window.__stopRec && window.__stopRec());
  await page.waitForTimeout(3000);
  console.log(`RESULT chunks=${chunks} bytes=${bytes}`);
  await browser.close();
})();
