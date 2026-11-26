const { chromium } = require('playwright');
const fs = require('fs');

const MP3 = 'https://media.otobanana.com/converted/users/a283e196-f4f8-4811-962b-a265c4ba6872/casts/89905f11-68cf-42cf-a529-83ca09760b88.mp3';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  fs.mkdirSync('out', { recursive: true });
  let chunks = 0;
  let bytes = 0;
  await page.exposeFunction('__deliverChunk', (b64, idx) => {
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(`out/part_${String(idx).padStart(4, '0')}.webm`, buf);
    chunks++;
    bytes += buf.length;
    console.log(`chunk ${idx} ${buf.length} bytes`);
  });

  await page.addInitScript({ path: 'recorder.js' });
  await page.goto('about:blank');

  const r = await page.evaluate(async (src) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const res = await fetch(src);
      const arr = await res.arrayBuffer();
      const audioBuf = await ac.decodeAudioData(arr);
      const node = ac.createBufferSource();
      node.buffer = audioBuf;
      node.loop = true;
      const gain = ac.createGain();
      gain.gain.value = 1.0;
      node.connect(gain);
      gain.connect(ac.destination);
      node.start();
      await ac.resume();
      return 'decoded ' + audioBuf.duration.toFixed(1) + 's, state=' + ac.state;
    } catch (e) {
      return 'err:' + e.message;
    }
  }, MP3);
  console.log('setup:', r);

  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.__recState || null);
    console.log('state', JSON.stringify(st));
  }

  await page.evaluate(() => window.__stopRec && window.__stopRec());
  await page.waitForTimeout(4000);
  console.log(`RESULT chunks=${chunks} bytes=${bytes}`);
  await browser.close();
})();
