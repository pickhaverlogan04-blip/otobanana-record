const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LIVE_ID = process.env.LIVE_ID;
const OUT = process.env.OUT_DIR || 'out';
const TITLE = process.env.TITLE || '';
const API = 'https://api.v2.otobanana.com/api/users/a28c1be1-bb11-43fc-935a-c6c85bbb40e7/livestreams/?is_adult=1';

if (!LIVE_ID) {
  console.log('no LIVE_ID, exit');
  process.exit(0);
}

let cookies = [];
try {
  cookies = JSON.parse((process.env.OTO_COOKIES || '[]').replace(/^\uFEFF/, ''));
} catch (e) {
  console.log('cookie parse error', e.message);
}
console.log('cookies loaded:', cookies.length);

async function stillLive() {
  try {
    const r = await fetch(API, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    const live = (j.data || []).find((x) => x.is_open && x.post && x.post.id === LIVE_ID);
    return !!live;
  } catch (e) {
    console.log('api check err', e.message);
    return true;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
      '--use-fake-ui-for-media-stream',
    ],
  });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
    recordVideo: { dir: path.join(OUT, 'video'), size: { width: 1280, height: 900 } },
  });

  const normalized = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: typeof c.expires === 'number' && c.expires > 0 ? Math.floor(c.expires) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
  }));
  try {
    await ctx.addCookies(normalized);
  } catch (e) {
    console.log('addCookies error', e.message);
  }

  const page = await ctx.newPage();
  let count = 0;
  await page.exposeFunction('__deliverChunk', (b64, idx) => {
    try {
      const buf = Buffer.from(b64, 'base64');
      const name = `part_${String(idx).padStart(4, '0')}.webm`;
      fs.writeFileSync(path.join(OUT, name), buf);
      count++;
      console.log(`chunk ${idx} saved ${buf.length} bytes`);
    } catch (e) {
      console.log('save chunk error', e.message);
    }
  });

  await page.addInitScript({ path: 'recorder.js' });

  const url = `https://otobanana.com/deep/livestream/${LIVE_ID}`;
  console.log('goto', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto err', e.message));

  const started = Date.now();
  let lastLog = 0;
  while (true) {
    await page.waitForTimeout(15000);
    let st = null;
    try {
      st = await page.evaluate(() => window.__recState || null);
    } catch (e) {
      console.log('eval err', e.message);
    }
    if (st && Date.now() - lastLog > 60000) {
      console.log('state', JSON.stringify(st));
      lastLog = Date.now();
    }
    if (Date.now() - started > 5.5 * 3600 * 1000) {
      console.log('time guard');
      break;
    }
    if (Date.now() - started > 60000 && !(await stillLive())) {
      console.log('stream ended');
      break;
    }
  }

  try {
    await page.evaluate(() => window.__stopRec && window.__stopRec());
  } catch (e) {}
  await page.waitForTimeout(8000);

  try {
    const v = page.video();
    await page.close();
    await ctx.close();
    if (v) {
      const videoPath = await v.path();
      console.log('video path', videoPath);
      if (videoPath && fs.existsSync(videoPath)) {
        fs.copyFileSync(videoPath, path.join(OUT, 'screen.webm'));
        console.log('screen.webm copied', fs.statSync(path.join(OUT, 'screen.webm')).size);
      }
    }
  } catch (e) {
    console.log('video save err', e.message);
  }
  await browser.close();
  console.log('done, chunks =', count);
})();
