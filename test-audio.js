const { chromium } = require('playwright');

const MP3 = 'https://media.otobanana.com/converted/users/a283e196-f4f8-4811-962b-a265c4ba6872/casts/89905f11-68cf-42cf-a529-83ca09760b88.mp3';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('about:blank');

  const r = await page.evaluate(async (src) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const res = await fetch(src);
      const arr = await res.arrayBuffer();
      const buf = await ac.decodeAudioData(arr);
      const node = ac.createBufferSource();
      node.buffer = buf;
      node.loop = true;
      node.connect(ac.destination);
      node.start();
      await ac.resume();
      return 'playing ' + buf.duration.toFixed(1) + 's state=' + ac.state;
    } catch (e) { return 'err:' + e.message; }
  }, MP3);
  console.log('setup:', r);

  await page.waitForTimeout(40000);
  console.log('done playing test tone');
  await browser.close();
})();
