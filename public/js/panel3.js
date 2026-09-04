/* ==========================================================================
   panel3.js — Acoustic Demonstration & Listening Console
   ========================================================================== */

let actx = null;
let srcNode = null;
let buffers = {};
let playing = false;
let startedAt = 0;
let offset = 0;
let curSrc = 'raw';
let animFrame = null;

function buildBuffers() {
  actx = actx || new (window.AudioContext || window.webkitAudioContext)();
  const sr = actx.sampleRate;
  const dur = 4.0;
  const n = Math.round(sr * dur);
  const shape = { raw: 1.0, A: 0.45, B: 0.28, C: 0.16, D: 0.07 };

  for (const k of Object.keys(shape)) {
    const b = actx.createBuffer(1, n, sr);
    const ch = b.getChannelData(0);
    const r = rng(11);
    let lp = 0;

    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp = 0.9 * lp + 0.1 * gauss(r);

      // Speech audio harmonics (tactical squad voice)
      let speech =
        0.35 *
        Math.sin(2 * Math.PI * (180 + 40 * Math.sin(2 * Math.PI * 2.5 * t)) * t) *
        (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.7 * t));

      // In System D, AI neural formant tracking boosts speech clarity
      if (k === 'D') {
        speech *= 1.35;
      }

      // Background ambient noise
      let noise = (lp * 1.2 + 0.35 * Math.sin(2 * Math.PI * 110 * t)) * shape[k];

      // Acoustic impulse transient / threat cue at t = 2.0s
      if (t > 2.0 && t < 2.03) {
        if (k === 'raw') {
          noise += 3.0 * Math.exp(-(t - 2.0) * 350) * gauss(r);
        } else if (k === 'A' || k === 'B') {
          noise += 1.2 * Math.exp(-(t - 2.0) * 350) * gauss(r);
        } else if (k === 'C') {
          noise += 0.8 * Math.exp(-(t - 2.0) * 350) * gauss(r);
        } else if (k === 'D') {
          // System D: AI Threat Cue Pass-through (safely leveled at 75 dBA, preserving azimuth & snap)
          noise += 0.45 * Math.exp(-(t - 2.0) * 450) * (gauss(r) + 0.2);
        }
      }

      // System A coefficient divergence penalty post-impulse (t = 2.03 to 2.9s)
      if (k === 'A' && t >= 2.03 && t < 2.9) {
        noise *= 2.4;
      }

      ch[i] = Math.max(-1.0, Math.min(1.0, speech + noise * 0.55));
    }
    buffers[k] = b;
  }
}

function startAudio(from) {
  if (srcNode) {
    srcNode.onended = null;
    try { srcNode.stop(); } catch (e) {}
    srcNode = null;
  }

  if (!buffers[curSrc]) buildBuffers();

  srcNode = actx.createBufferSource();
  srcNode.buffer = buffers[curSrc];
  srcNode.connect(actx.destination);
  srcNode.loop = true;
  srcNode.start(0, from);
  startedAt = actx.currentTime - from;
  playing = true;
}

const playBtn = document.getElementById('playBtn');
if (playBtn) {
  playBtn.onclick = () => {
    buildBuffers();
    if (actx.state === 'suspended') actx.resume();

    if (playing) {
      offset = (actx.currentTime - startedAt) % 4.0;
      if (srcNode) {
        srcNode.onended = null;
        try { srcNode.stop(); } catch (e) {}
      }
      playing = false;
      playBtn.textContent = 'Play';
    } else {
      startAudio(offset % 4.0);
      playBtn.textContent = 'Pause';
    }
  };
}

const audioRow = document.getElementById('audioRow');
if (audioRow) {
  audioRow.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !b.dataset.src) return;

    audioRow.querySelectorAll('.audio-btn').forEach(x => x.setAttribute('aria-pressed', x === b));
    curSrc = b.dataset.src;

    // Seamlessly switch source buffer without stopping the timeline
    if (playing && actx) {
      const pos = (actx.currentTime - startedAt) % 4.0;
      startAudio(pos);
    }
  });
}

// Progress Bar & Timer Update Loop
setInterval(() => {
  if (!playing || !actx) return;
  const pos = (actx.currentTime - startedAt) % 4.0;
  const bar = document.getElementById('playBar');
  const time = document.getElementById('playTime');
  if (bar) bar.style.width = (pos / 4.0) * 100 + '%';
  if (time) time.textContent = pos.toFixed(1) + 's';
}, 50);
