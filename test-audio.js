const { chromium } = require('playwright');
const fs = require('fs');

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

  const r = await page.evaluate(async () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.frequency.value = 440;
      osc.connect(dest);
      osc.start();
      await ac.resume();

      const pc1 = new RTCPeerConnection();
      const pc2 = new RTCPeerConnection();
      pc1.onicecandidate = (e) => { if (e.candidate) pc2.addIceCandidate(e.candidate); };
      pc2.onicecandidate = (e) => { if (e.candidate) pc1.addIceCandidate(e.candidate); };

      dest.stream.getTracks().forEach((t) => pc1.addTrack(t, dest.stream));

      const remoteStream = new MediaStream();
      pc2.ontrack = (e) => { remoteStream.addTrack(e.track); };

      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);

      window.__remote = remoteStream;
      await new Promise((res) => setTimeout(res, 3000));
      return 'webrtc ok, remote audio tracks=' + remoteStream.getAudioTracks().length + ', state=' + remoteStream.getAudioTracks().map(t => t.readyState + '/muted=' + t.muted).join(',');
    } catch (e) {
      return 'err:' + e.message;
    }
  });
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
