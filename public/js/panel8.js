/* ==========================================================================
   panel8.js — fixed-clip preview of the log-MMSE enhancement engine
   (enhance.js). Same algorithm panel 9 runs on your own audio; this is
   just a quick look with no controls, on a synthetic demo clip.
   ========================================================================== */

let actx8 = null;
let srcNode8 = null;
let buffers8 = {};
let playing8 = false;
let startedAt8 = 0;
let offset8 = 0;
let curSrc8 = 'raw';
let result8 = null;

const P8_OPT = { floorDb: -18, adapt: 1, tsens: 6, transAware: true, attenImpulse: true };

function runP8() {
  const cv = document.getElementById('cv8');
  if (!cv) return;

  const raw = enhMakeDemo('imp', 21);
  const { out, transMask, keep } = enhProcess(raw, P8_OPT);
  result8 = { raw, out, transMask, keep };

  drawP8Wave();
  buildBuffers8(raw, out);
}

function drawP8Wave() {
  const cv = document.getElementById('cv8');
  if (!cv || !result8) return;
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  c.fillStyle = CSS('--bg-screen') || '#06090D';
  c.fillRect(0, 0, W, H);

  const { raw, out, transMask } = result8;
  const n = raw.length, step = Math.max(1, Math.floor(n / W)), mid = H / 2;

  c.fillStyle = 'rgba(255, 92, 92, .18)';
  for (let f = 0; f < transMask.length; f++) if (transMask[f]) {
    const px = (f * ENH_HOP) / n * W;
    c.fillRect(px, 0, Math.max(2, ENH_HOP / n * W), H);
  }

  const trace = (data, color) => {
    c.strokeStyle = color; c.lineWidth = 1.6; c.beginPath();
    for (let px = 0; px < W; px++) {
      let mx = 0;
      for (let i = px * step; i < (px + 1) * step && i < data.length; i++) mx = Math.max(mx, Math.abs(data[i]));
      const h = mx * mid * 0.92;
      c.moveTo(px, mid - h); c.lineTo(px, mid + h);
    }
    c.stroke();
  };
  trace(raw, CSS('--sysB') || '#FFB830');
  trace(out, CSS('--sysC') || '#00E5A3');
}

function buildBuffers8(raw, enhanced) {
  actx8 = actx8 || new (window.AudioContext || window.webkitAudioContext)();
  const dur = raw.length / ENH_SR;
  for (const [k, sig] of [['raw', raw], ['enh', enhanced]]) {
    const b = actx8.createBuffer(1, sig.length, ENH_SR);
    const ch = b.getChannelData(0);
    for (let i = 0; i < sig.length; i++) ch[i] = Math.max(-1.0, Math.min(1.0, sig[i]));
    buffers8[k] = b;
  }
  buffers8._dur = dur;
}

function startAudio8(from) {
  if (srcNode8) {
    srcNode8.onended = null;
    try { srcNode8.stop(); } catch (e) {}
    srcNode8 = null;
  }
  if (!buffers8[curSrc8]) return;

  srcNode8 = actx8.createBufferSource();
  srcNode8.buffer = buffers8[curSrc8];
  srcNode8.connect(actx8.destination);
  srcNode8.start(0, from);
  startedAt8 = actx8.currentTime - from;
  playing8 = true;
  srcNode8.onended = () => {
    if (playing8) {
      playing8 = false; offset8 = 0;
      const btn = document.getElementById('playBtn8');
      if (btn) btn.textContent = 'Play';
    }
  };
}

const playBtn8 = document.getElementById('playBtn8');
if (playBtn8) {
  playBtn8.onclick = () => {
    if (!buffers8.raw) runP8();
    if (actx8.state === 'suspended') actx8.resume();
    const dur = buffers8._dur || 6.0;

    if (playing8) {
      offset8 = (actx8.currentTime - startedAt8) % dur;
      if (srcNode8) {
        srcNode8.onended = null;
        try { srcNode8.stop(); } catch (e) {}
      }
      playing8 = false;
      playBtn8.textContent = 'Play';
    } else {
      startAudio8(offset8 % dur);
      playBtn8.textContent = 'Pause';
    }
  };
}

seg('enhSrc', v => {
  curSrc8 = v === 'enh' ? 'enh' : 'raw';
  if (playing8 && buffers8.raw) {
    const dur = buffers8._dur || 6.0;
    const pos = (actx8.currentTime - startedAt8) % dur;
    startAudio8(pos);
  }
});

setInterval(() => {
  if (!playing8 || !actx8 || !buffers8.raw) return;
  const dur = buffers8._dur || 6.0;
  const pos = (actx8.currentTime - startedAt8) % dur;
  const playBar8 = document.getElementById('playBar8');
  if (playBar8) playBar8.style.width = (pos / dur) * 100 + '%';
  const playTime8 = document.getElementById('playTime8');
  if (playTime8) playTime8.textContent = pos.toFixed(1) + 's';
}, 50);
