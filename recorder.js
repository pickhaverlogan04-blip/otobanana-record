(function () {
  if (window.__recInstalled) return;
  window.__recInstalled = true;

  var S = (window.__recState = {
    phase: 'init',
    tracks: 0,
    chunks: 0,
    startedAt: null,
    err: null,
    url: location.href,
    mode: null,
    ctxState: null,
    muted: null,
    taps: 0,
    retries: 0
  });

  var recorder = null;
  var currentStream = null;
  var idx = 0;
  var started = false;
  var tapCtx = null;
  var tapDest = null;
  var tapNodes = [];
  var origConnect = null;
  var lastChunkAt = 0;

  function blobToBase64(blob, cb) {
    try {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        cb(s.indexOf(',') >= 0 ? s.split(',')[1] : s);
      };
      fr.onerror = function () { cb(''); };
      fr.readAsDataURL(blob);
    } catch (e) { cb(''); }
  }

  function startRec(stream, mode) {
    if (!stream || !stream.getAudioTracks || stream.getAudioTracks().length === 0) {
      S.err = 'stream has no audio track (' + mode + ')';
      return;
    }
    try {
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (e) {} }
      var opts = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 };
      try {
        recorder = new MediaRecorder(stream, opts);
      } catch (e1) {
        recorder = new MediaRecorder(stream);
      }
      currentStream = stream;
      recorder.ondataavailable = function (ev) {
        if (!ev.data || ev.data.size === 0) return;
        idx++;
        S.chunks = idx;
        S.lastChunkAt = Date.now();
        lastChunkAt = Date.now();
        var n = idx;
        blobToBase64(ev.data, function (x) {
          if (!x) return;
          try { if (window.__deliverChunk) window.__deliverChunk(x, n); } catch (e) { S.err = String(e); }
        });
      };
      recorder.onerror = function (e) { S.err = String((e && e.error) || e); };
      recorder.start(20000);
      S.phase = 'recording';
      S.mode = mode;
      if (!S.startedAt) S.startedAt = Date.now();
    } catch (e) {
      S.err = 'startRec:' + (e && e.message ? e.message : e);
    }
  }

  function ensureTap(ctx, node) {
    try {
      if (tapCtx !== ctx) {
        tapCtx = ctx;
        tapDest = ctx.createMediaStreamDestination();
        S.ctxState = ctx.state;
        try { ctx.resume(); } catch (e) {}
      }
      if (node) {
        try { origConnect.call(node, tapDest); S.taps++; } catch (e) {}
      }
      if (!started && tapDest) {
        started = true;
        startRec(tapDest.stream, 'tap');
      }
    } catch (e) {
      S.err = 'tap:' + (e && e.message ? e.message : e);
    }
  }

  try {
    var ACTX = window.AudioContext || window.webkitAudioContext;
    if (ACTX && window.AudioNode) {
      origConnect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (dest) {
        var r = origConnect.apply(this, arguments);
        try {
          if (dest && this.context && dest === this.context.destination) {
            tapNodes.push(this);
            ensureTap(this.context, this);
          }
        } catch (e) {}
        return r;
      };
    }
  } catch (e) {
    S.err = 'hook:' + (e && e.message ? e.message : e);
  }

  function fromTrack(track) {
    S.tracks++;
    try { if (track.muted) S.muted = true; } catch (e) {}
    if (started) return;
    try {
      var AC2 = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC2();
      var src = ctx.createMediaStreamSource(new MediaStream([track]));
      var dest = ctx.createMediaStreamDestination();
      src.connect(dest);
      try { ctx.resume(); } catch (e) {}
      S.ctxState = ctx.state;
      started = true;
      startRec(dest.stream, 'track-ctx');
    } catch (e) {
      S.err = 'trackCtx:' + (e && e.message ? e.message : e);
    }
  }

  var OrigPC = window.RTCPeerConnection;
  if (OrigPC) {
    var Wrapped = function (cfg, cons) {
      var pc = new OrigPC(cfg, cons);
      try {
        pc.addEventListener('track', function (e) {
          if (e.track && e.track.kind === 'audio') fromTrack(e.track);
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
            if (v && v.getAudioTracks && v.getAudioTracks().length) fromTrack(v.getAudioTracks()[0]);
          } catch (e) {}
        }
      });
    }
  } catch (e) {}

  window.__stopRec = function () {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
    S.phase = 'stopped';
  };

  // 自检：若长时间没有任何音频分片，尝试重建录制器
  setInterval(function () {
    if (!started) return;
    if (S.chunks === 0 && S.startedAt && Date.now() - S.startedAt > 45000 && S.retries < 3) {
      S.retries++;
      var s = tapDest && tapDest.stream ? tapDest.stream : currentStream;
      S.err = 'retry#' + S.retries;
      startRec(s, (S.mode || 'retry') + '+retry');
    }
  }, 10000);

  // 无 MediaStream 时的兜底：从页面 audio/video 元素抓音轨
  setInterval(function () {
    if (started) return;
    var els = document.querySelectorAll('audio,video');
    for (var i = 0; i < els.length; i++) {
      try {
        var s = els[i].captureStream ? els[i].captureStream() : null;
        if (s && s.getAudioTracks().length > 0) { fromTrack(s.getAudioTracks()[0]); return; }
      } catch (e) {}
    }
  }, 5000);
})();
