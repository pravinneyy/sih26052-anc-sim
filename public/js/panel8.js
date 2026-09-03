/* ==========================================================================
   panel8.js — Causal Subband Speech Enhancement Engine
   ========================================================================== */

let actx8 = null;
let srcNode8 = null;
let buffers8 = {};
let playing8 = false;
let startedAt8 = 0;
let offset8 = 0;
let curSrc8 = 'raw';

const enhBandLabels = document.getElementById('bandLabels');
if (enhBandLabels && enhBandLabels.children.length === 0 && typeof ENH_BAND_LABELS !== 'undefined') {
  ENH_BAND_LABELS.forEach(l => {
    const s = document.createElement('span');
    s.textContent = l + ' Hz';
    enhBandLabels.appendChild(s);
  });
}

function runP8() {
  const cv = document.getElementById('cv8');
  if (!cv) return;

  const n = Math.round(4.0 * FS);
  const { raw, enhanced, gains } = runEnhancement(n, 21);

  plot(cv, {
    xmin: 0,
    xmax: 4.0,
    ymin: 0,
    ymax: 1.05,
    series: gains.map((g, i) => ({
      y: g,
      color: ENH_COLORS[i] || '#00D2FF',
      w: 2.0
    })),
    xlabel: 'Elapsed Time (seconds)',
    ylabel: 'Subband Spectral Gain G(k)',
    xfmt: v => v.toFixed(1) + 's'
  });

  const bars = document.getElementById('bandBars');
  if (bars) {
    bars.innerHTML = '';
    gains.forEach((g, i) => {
      let s = 0;
      for (let k = 0; k < g.length; k++) s += g[k];
      const mean = s / g.length;
      const el = document.createElement('div');
      el.className = 'bb';
      el.style.height = Math.max(4, mean * 115) + 'px';
      el.style.background = ENH_COLORS[i] || '#00D2FF';
      bars.appendChild(el);
    });
  }

  buildBuffers8(raw, enhanced);
}

function buildBuffers8(raw, enhanced) {
  actx8 = actx8 || new (window.AudioContext || window.webkitAudioContext)();
  const dur = raw.length / FS;
  for (const [k, sig] of [
    ['raw', raw],
    ['enh', enhanced]
  ]) {
    const b = actx8.createBuffer(1, sig.length, FS);
    const ch = b.getChannelData(0);
    for (let i = 0; i < sig.length; i++) {
      ch[i] = Math.max(-1.0, Math.min(1.0, sig[i]));
    }
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
  srcNode8.loop = true;
  srcNode8.start(0, from);
  startedAt8 = actx8.currentTime - from;
  playing8 = true;
}

const playBtn8 = document.getElementById('playBtn8');
if (playBtn8) {
  playBtn8.onclick = () => {
    if (!buffers8.raw) runP8();
    if (actx8.state === 'suspended') actx8.resume();
    const dur = buffers8._dur || 4.0;

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
    const dur = buffers8._dur || 4.0;
    const pos = (actx8.currentTime - startedAt8) % dur;
    startAudio8(pos);
  }
});

setInterval(() => {
  if (!playing8 || !actx8 || !buffers8.raw) return;
  const dur = buffers8._dur || 4.0;
  const pos = (actx8.currentTime - startedAt8) % dur;
  const playBar8 = document.getElementById('playBar8');
  if (playBar8) playBar8.style.width = (pos / dur) * 100 + '%';
  const playTime8 = document.getElementById('playTime8');
  if (playTime8) playTime8.textContent = pos.toFixed(1) + 's';
}, 50);
