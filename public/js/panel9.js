/* ==========================================================================
   panel9.js — Interactive Audio Processing & Testing Lab
   ========================================================================== */

const P9_MAX_PROCESS_S = 30; // Max 30 seconds processing for snappiness

let p9ctx = null;
let p9raw = null;
let p9enh = null;
let p9src = null;
let p9playing = false;
let p9startedAt = 0;
let p9offset = 0;
let p9cur = 'raw';
let p9recorder = null;
let p9chunks = [];
let p9recTimer = null;

const p9status = document.getElementById('p9Status');
const p9processBtn = document.getElementById('p9Process');
const p9enhBtn = document.querySelector('#p9PlaySrc button[data-v="enh"]');

function p9EnsureCtx() {
  p9ctx = p9ctx || new (window.AudioContext || window.webkitAudioContext)();
  return p9ctx;
}

function p9SetStatus(msg) {
  if (p9status) p9status.textContent = msg;
}

function p9CurrentBuffer() {
  return p9cur === 'enh' ? p9enh : p9raw;
}

async function p9LoadBlob(blob) {
  p9SetStatus('Decoding audio waveform…');
  try {
    const arr = await blob.arrayBuffer();
    const ctx = p9EnsureCtx();
    const buf = await ctx.decodeAudioData(arr);
    p9raw = buf;
    p9enh = null;
    p9cur = 'raw';
    p9offset = 0;

    if (p9playing) {
      p9playing = false;
      const playBtn = document.getElementById('p9PlayBtn');
      if (playBtn) playBtn.textContent = 'Play';
    }

    document.querySelectorAll('#p9PlaySrc button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.v === 'raw');
    });

    if (p9enhBtn) p9enhBtn.disabled = true;
    if (p9processBtn) p9processBtn.disabled = false;

    const cv = document.getElementById('cv9');
    if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);

    p9SetStatus(`Audio loaded: ${buf.duration.toFixed(1)}s @ ${buf.sampleRate} Hz. Ready to process.`);
  } catch (err) {
    p9SetStatus('Unable to decode this audio format. Please provide a standard WAV or MP3 file.');
  }
}

// Microphone Recording
const recordBtn = document.getElementById('p9Record');
if (recordBtn) {
  recordBtn.onclick = async () => {
    if (p9recorder && p9recorder.state === 'recording') {
      p9recorder.stop();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      p9SetStatus('Microphone capture requires HTTPS or localhost. Please upload an audio file instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      p9chunks = [];
      p9recorder = new MediaRecorder(stream);

      p9recorder.ondataavailable = e => {
        if (e.data.size > 0) p9chunks.push(e.data);
      };

      p9recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearTimeout(p9recTimer);
        recordBtn.textContent = 'Record Microphone';
        recordBtn.classList.remove('active');
        const blob = new Blob(p9chunks, { type: p9recorder.mimeType || 'audio/webm' });
        p9LoadBlob(blob);
      };

      p9recorder.start();
      recordBtn.textContent = 'Stop Recording';
      recordBtn.classList.add('active');
      p9SetStatus('Recording in progress… (Max 20s)');
      p9recTimer = setTimeout(() => {
        if (p9recorder && p9recorder.state === 'recording') p9recorder.stop();
      }, 20000);
    } catch (err) {
      p9SetStatus('Microphone permission denied or device unavailable.');
    }
  };
}

// File Upload
const uploadBtn = document.getElementById('p9Upload');
const fileInput = document.getElementById('p9File');
if (uploadBtn && fileInput) {
  uploadBtn.onclick = () => fileInput.click();
  fileInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) p9LoadBlob(f);
  });
}

// Process Audio Stream
if (p9processBtn) {
  p9processBtn.onclick = () => {
    if (!p9raw) return;
    const fs = p9raw.sampleRate;
    const full = p9raw.getChannelData(0);
    const n = Math.min(full.length, Math.round(P9_MAX_PROCESS_S * fs));
    const sig = full.subarray(0, n);

    p9SetStatus('Executing multi-band spectral enhancement…');

    setTimeout(() => {
      const { enhanced, gains } = applyEnhancementMask(sig, fs);
      const ctx = p9EnsureCtx();
      const buf = ctx.createBuffer(1, n, fs);
      buf.getChannelData(0).set(enhanced);
      p9enh = buf;

      if (p9enhBtn) p9enhBtn.disabled = false;

      const cv = document.getElementById('cv9');
      if (cv) {
        plot(cv, {
          xmin: 0,
          xmax: n / fs,
          ymin: 0,
          ymax: 1.05,
          series: gains.map((g, i) => ({
            y: g,
            color: ENH_COLORS[i] || '#00D2FF',
            w: 2.0
          })),
          xlabel: 'Elapsed Time (seconds)',
          ylabel: 'Spectral Gain G(k)',
          xfmt: v => v.toFixed(1) + 's',
          fs: fs
        });
      }

      p9SetStatus('Processing complete. Select "Enhanced Audio" to compare.');
    }, 20);
  };
}

// Audio Transport
function p9Start(from) {
  const buf = p9CurrentBuffer();
  if (!buf) return;

  if (p9src) {
    p9src.onended = null;
    try { p9src.stop(); } catch (e) {}
    p9src = null;
  }

  const ctx = p9EnsureCtx();
  p9src = ctx.createBufferSource();
  p9src.buffer = buf;
  p9src.connect(ctx.destination);
  const clamped = Math.max(0, Math.min(from, Math.max(0, buf.duration - 0.01)));
  p9src.start(0, clamped);
  p9startedAt = ctx.currentTime - clamped;
  p9playing = true;

  p9src.onended = () => {
    if (p9playing) {
      p9playing = false;
      p9offset = 0;
      const playBtn = document.getElementById('p9PlayBtn');
      if (playBtn) playBtn.textContent = 'Play';
    }
  };
}

const p9PlayBtn = document.getElementById('p9PlayBtn');
if (p9PlayBtn) {
  p9PlayBtn.onclick = () => {
    const buf = p9CurrentBuffer();
    if (!buf) return;
    const ctx = p9EnsureCtx();
    if (ctx.state === 'suspended') ctx.resume();

    if (p9playing) {
      p9offset = ctx.currentTime - p9startedAt;
      if (p9src) {
        p9src.onended = null;
        try { p9src.stop(); } catch (e) {}
      }
      p9playing = false;
      p9PlayBtn.textContent = 'Play';
    } else {
      p9Start(p9offset % buf.duration);
      p9PlayBtn.textContent = 'Pause';
    }
  };
}

seg('p9PlaySrc', v => {
  p9cur = v;
  const buf = p9CurrentBuffer();
  if (!buf) return;
  if (p9playing) {
    const pos = (p9EnsureCtx().currentTime - p9startedAt) % buf.duration;
    p9Start(pos);
  }
});

setInterval(() => {
  const buf = p9CurrentBuffer();
  if (!p9playing || !buf) return;
  const pos = (p9EnsureCtx().currentTime - p9startedAt) % buf.duration;
  const bar = document.getElementById('p9PlayBar');
  const time = document.getElementById('p9PlayTime');
  if (bar) bar.style.width = (pos / buf.duration) * 100 + '%';
  if (time) time.textContent = pos.toFixed(1) + 's';
}, 50);

function p9Reset() {
  if (p9playing && p9src) {
    p9src.onended = null;
    try { p9src.stop(); } catch (e) {}
    p9playing = false;
    const playBtn = document.getElementById('p9PlayBtn');
    if (playBtn) playBtn.textContent = 'Play';
  }
  p9raw = null;
  p9enh = null;
  p9offset = 0;
  p9cur = 'raw';
  document.querySelectorAll('#p9PlaySrc button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.v === 'raw');
  });
  if (p9enhBtn) p9enhBtn.disabled = true;
  if (p9processBtn) p9processBtn.disabled = true;

  const cv = document.getElementById('cv9');
  if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);

  const bar = document.getElementById('p9PlayBar');
  const time = document.getElementById('p9PlayTime');
  if (bar) bar.style.width = '0%';
  if (time) time.textContent = '0.0s';
  p9SetStatus('No audio track loaded.');
}
