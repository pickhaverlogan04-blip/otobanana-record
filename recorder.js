(function () {
  if (window.__recInstalled) return;
  window.__recInstalled = true;
  window.__recState = { phase: 'init', tracks: 0, chunks: 0, startedAt: null, err: null, url: location.href };
  var recorder = null, idx = 0, used = false;

  function blobToBase64(blob, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var s = String(fr.result || '');
      cb(s.indexOf(',') >= 0 ? s.split(',')[1] : s);
    };
    fr.onerror = function () { cb(''); };
    fr.readAsDataURL(blob);
  }

  function start(track) {
    if (used || !track) return;
    used = true;
    window.__recState.phase = 'starting';
    var ms = new MediaStream([track]);
    try {
      recorder = new MediaRecorder(ms, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    } catch (e) {
      try { recorder = new MediaRecorder(ms); } catch (e2) { window.__recState.err = String(e2); return; }
    }
    recorder.ondataavailable = function (ev) {
      if (!ev.data || ev.data.size === 0) return;
      idx++;
      window.__recState.chunks = idx;
      var n = idx;
      blobToBase64(ev.data, function (b64) {
        if (!b64) return;
        try {
          if (window.__deliverChunk) window.__deliverChunk(b64, n);
        } catch (e) { window.__recState.err = String(e); }
      });
    };
    recorder.onerror = function (e) { window.__recState.err = String((e && e.error) || e); };
    recorder.start(30000);
    window.__recState.phase = 'recording';
    window.__recState.startedAt = Date.now();
  }

  window.__stopRec = function () {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
    window.__recState.phase = 'stopped';
  };

  var OrigPC = window.RTCPeerConnection;
  if (OrigPC) {
    var Wrapped = function (cfg, cons) {
      var pc = new OrigPC(cfg, cons);
      try {
        pc.addEventListener('track', function (e) {
          if (e.track && e.track.kind === 'audio') { window.__recState.tracks++; start(e.track); }
        });
      } catch (err) {}
      return pc;
    };
    Wrapped.prototype = OrigPC.prototype;
    try { Object.setPrototypeOf(Wrapped, OrigPC); } catch (e) {}
    window.RTCPeerConnection = Wrapped;
  }

  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
    if (desc && desc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        get: desc.get,
        set: function (v) {
          desc.set.call(this, v);
          try {
            if (v && v.getAudioTracks && v.getAudioTracks().length) {
              window.__recState.tracks++;
              start(v.getAudioTracks()[0]);
            }
          } catch (e) {}
        }
      });
    }
  } catch (e) {}

  setInterval(function () {
    if (used) return;
    var els = document.querySelectorAll('audio,video');
    for (var i = 0; i < els.length; i++) {
      try {
        var s = els[i].captureStream ? els[i].captureStream() : null;
        if (s && s.getAudioTracks().length > 0) {
          window.__recState.tracks++;
          start(s.getAudioTracks()[0]);
          return;
        }
      } catch (e) {}
    }
  }, 5000);
})();
