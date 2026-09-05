/* ==========================================================================
   panel9.js — Live Audio Processing Lab: continuous mic (or a file/demo
   clip played through the same path) run live through the trained
   SIH26052 CRN/GRU model (rt_engine.js), enhanced audio audible within a
   couple of chunks. No record-then-process step — the engine runs
   continuously from Start to Stop.
   ========================================================================== */

let p9Ctx = null;              // shared 16 kHz AudioContext for the live graph
let p9Engine = null;           // active RTEngine.RTNeuralEngine, or null when stopped
let p9SourceNode = null;       // MediaStreamAudioSourceNode or AudioBufferSourceNode
let p9MicStream = null;        // raw MediaStream, so we can stop its tracks on Stop
let p9Kind = 'mic';            // 'mic' | 'file' | 'demo'
let p9FileBuffer = null;       // decoded AudioBuffer for the last uploaded file
let p9MetricsTimer = null;
let p9Recording = false;
let p9RecordedWav = null;      // Float32Array, built when capture is stopped

function p9EnsureCtx() {
  p9Ctx = p9Ctx || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: ENH_SR });
  if (p9Ctx.state === 'suspended') p9Ctx.resume();
  return p9Ctx;
}
function p9SetStatus(msg) {
  const el = document.getElementById('p9Status');
  if (el) el.textContent = msg;
}

/* ---- source picker ---- */
const p9SrcPick = document.getElementById('p9SrcPick');
if (p9SrcPick) {
  p9SrcPick.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (p9Engine) return; // can't switch source mid-stream
    p9SrcPick.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    p9Kind = b.dataset.k;
    const paneFile = document.getElementById('p9PaneFile');
    const paneDemo = document.getElementById('p9PaneDemo');
    if (paneFile) paneFile.hidden = p9Kind !== 'file';
    if (paneDemo) paneDemo.hidden = p9Kind !== 'demo';
  });
}

const p9FileIn = document.getElementById('p9File');
if (p9FileIn) {
  p9FileIn.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const arr = await f.arrayBuffer();
      p9FileBuffer = await p9EnsureCtx().decodeAudioData(arr);
      p9SetStatus(`${f.name} ready · ${p9FileBuffer.duration.toFixed(1)}s · press Start`);
    } catch (err) {
      p9FileBuffer = null;
      p9SetStatus('Could not decode that file');
    }
  });
}

/* ---- live controls: floor / impulse attenuation / fast prior ---- */
const p9PendingParams = { floorDb: -18, impulseExtraDb: -24, fastPriorWeight: 0.95, useFastPrior: true };
function p9ApplyParams() { if (p9Engine) p9Engine.setParams(p9PendingParams); }

const p9StrengthEl = document.getElementById('p9Strength');
if (p9StrengthEl) p9StrengthEl.oninput = e => {
  document.getElementById('p9StrengthOut').textContent = e.target.value;
  p9PendingParams.floorDb = +e.target.value;
  p9ApplyParams();
};
const p9ImpulseDbEl = document.getElementById('p9ImpulseDb');
if (p9ImpulseDbEl) p9ImpulseDbEl.oninput = e => {
  document.getElementById('p9ImpulseDbOut').textContent = e.target.value;
  p9PendingParams.impulseExtraDb = +e.target.value;
  p9ApplyParams();
};
const p9SwFastPrior = document.getElementById('p9SwFastPrior');
if (p9SwFastPrior) p9SwFastPrior.onclick = () => {
  const on = p9SwFastPrior.getAttribute('aria-pressed') !== 'true';
  p9SwFastPrior.setAttribute('aria-pressed', on);
  p9PendingParams.useFastPrior = on;
  p9ApplyParams();
};

/* ---- monitor toggle (live, no restart) ---- */
function p9PickAB(k) {
  document.querySelectorAll('#p9AbRow button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === k));
  if (p9Engine) p9Engine.setMonitor(k);
}
seg('p9AbRow', v => p9PickAB(v));

/* ---- capture enhanced output + download ---- */
const p9RecOutBtn = document.getElementById('p9RecOutBtn');
if (p9RecOutBtn) {
  p9RecOutBtn.onclick = () => {
    if (!p9Engine) return;
    if (!p9Recording) {
      p9Engine.startRecording();
      p9Recording = true;
      p9RecOutBtn.textContent = 'Stop capture';
      document.getElementById('p9DlBtn').disabled = true;
    } else {
      const chunks = p9Engine.stopRecording();
      p9Recording = false;
      p9RecOutBtn.textContent = 'Capture enhanced audio';
      let n = 0; for (const c of chunks) n += c.length;
      p9RecordedWav = new Float32Array(n);
      let off = 0; for (const c of chunks) { p9RecordedWav.set(c, off); off += c.length; }
      document.getElementById('p9DlBtn').disabled = n === 0;
    }
  };
}
const p9DlBtn = document.getElementById('p9DlBtn');
if (p9DlBtn) {
  p9DlBtn.onclick = () => {
    if (!p9RecordedWav || !p9RecordedWav.length) return;
    const d = p9RecordedWav, n = d.length;
    const ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, ENH_SR, true); v.setUint32(28, ENH_SR * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wr(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    const url = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
    const a = document.createElement('a'); a.href = url; a.download = 'enhanced-live.wav'; a.click();
    URL.revokeObjectURL(url);
  };
}

/* ---- start / stop the live engine ---- */
const p9LiveBtn = document.getElementById('p9LiveBtn');
if (p9LiveBtn) p9LiveBtn.onclick = () => { p9Engine ? p9Stop() : p9Start(); };

async function p9Start() {
  p9LiveBtn.disabled = true;
  p9SetStatus('Loading neural engine…');
  let session, manifest;
  try {
    ({ session, manifest } = await RTEngine.loadModel());
  } catch (err) {
    p9SetStatus(err.message || 'Could not load the neural engine');
    p9LiveBtn.disabled = false;
    return;
  }

  const ctx = p9EnsureCtx();
  try {
    if (p9Kind === 'mic') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Microphone unavailable (needs HTTPS or localhost).');
      p9MicStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      p9SourceNode = ctx.createMediaStreamSource(p9MicStream);
    } else if (p9Kind === 'file') {
      if (!p9FileBuffer) throw new Error('Choose a file first');
      p9SourceNode = ctx.createBufferSource();
      p9SourceNode.buffer = p9FileBuffer;
      p9SourceNode.onended = () => { if (p9Engine) p9Stop(); };
    } else {
      const kind = document.getElementById('p9DemoPick').value;
      const f32 = enhMakeDemo(kind, 21);
      const buf = ctx.createBuffer(1, f32.length, ENH_SR);
      buf.getChannelData(0).set(f32);
      p9SourceNode = ctx.createBufferSource();
      p9SourceNode.buffer = buf;
      p9SourceNode.onended = () => { if (p9Engine) p9Stop(); };
    }
  } catch (err) {
    p9SetStatus(err.message || 'Could not start the audio source');
    p9LiveBtn.disabled = false;
    return;
  }

  p9Engine = new RTEngine.RTNeuralEngine(session, manifest, p9PendingParams);
  const abBtn = document.querySelector('#p9AbRow button[aria-pressed="true"]');
  p9Engine.setMonitor(abBtn ? abBtn.dataset.v : 'enh');
  p9Engine.onChunk = result => p9OnChunk(result);
  p9Engine.start(ctx, p9SourceNode);
  if (p9Kind !== 'mic') p9SourceNode.start(0);

  p9LiveBtn.innerHTML = '<span class="rec-dot"></span>Stop';
  p9LiveBtn.classList.add('rec-on');
  p9LiveBtn.disabled = false;
  p9RecOutBtn.disabled = false;
  document.querySelectorAll('#p9SrcPick button, #p9File, #p9DemoPick').forEach(el => el.disabled = true);
  p9SetStatus(`Live — ${p9Kind === 'mic' ? 'microphone' : p9Kind === 'file' ? 'uploaded file' : 'built-in clip'}`);
  p9DrawReset();
  p9MetricsTimer = setInterval(p9UpdateMetrics, 150);
}

function p9Stop() {
  if (!p9Engine) return;
  p9Engine.stop();
  p9Engine = null;
  clearInterval(p9MetricsTimer); p9MetricsTimer = null;
  if (p9MicStream) { p9MicStream.getTracks().forEach(t => t.stop()); p9MicStream = null; }
  if (p9SourceNode) { try { p9SourceNode.stop(); } catch (e) {} p9SourceNode = null; }
  if (p9Recording) {
    p9Recording = false;
    p9RecOutBtn.textContent = 'Capture enhanced audio';
  }
  p9RecOutBtn.disabled = true;
  p9LiveBtn.innerHTML = '<span class="rec-dot"></span>Start live enhancement';
  p9LiveBtn.classList.remove('rec-on');
  document.querySelectorAll('#p9SrcPick button, #p9File, #p9DemoPick').forEach(el => el.disabled = false);
  p9SetStatus('Neural engine idle');
}

/* ---- live metrics readout ---- */
function p9UpdateMetrics() {
  if (!p9Engine) return;
  const m = p9Engine.metrics;
  const set = (id, v, dp, unit) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = (isFinite(v) ? v.toFixed(dp) : '—') + (unit ? `<span class="u">${unit}</span>` : '');
  };
  set('p9MNoise', m.noiseRedDb, 1, 'dB');
  set('p9MSnr', m.snrGainDb, 1, 'dB');
  document.getElementById('p9MClass').textContent = m.noiseClass.replace('_', '-');
  set('p9MVad', m.vadProb * 100, 0, '%');
  set('p9MImpulse', m.impulseProb * 100, 0, '%');
  document.getElementById('p9MEvents').textContent = m.impulseEvents;
  set('p9MInfer', m.inferMs, 1, 'ms');
  set('p9MLatency', m.chunkMs + m.inferMs, 0, 'ms');
  const t = document.getElementById('p9LiveTime');
  if (t) t.textContent = ((performance.now() - m.startedAt) / 1000).toFixed(1) + 's';
  if (m.queued > 4) p9SetStatus(`Live — falling behind (${m.queued} chunks queued), try a shorter suppression floor or close other tabs`);
}

/* ==========================================================================
   Live drawing — scrolling spectrogram + waveform, one column per chunk.
   Runs its own small FFT on the chunk audio rt_engine already handed back,
   independent of the engine's internal buffers (no shared state).
   ========================================================================== */
const P9_BANDS = 96;
const p9DrawRe = new Float64Array(RTEngine.RT_N);
const p9DrawIm = new Float64Array(RTEngine.RT_N);
const p9DrawWin = new Float64Array(RTEngine.RT_N);
for (let i = 0; i < RTEngine.RT_N; i++) p9DrawWin[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / RTEngine.RT_N);

function p9BandDb(samples) {
  const off = samples.length - RTEngine.RT_N;
  for (let i = 0; i < RTEngine.RT_N; i++) { p9DrawRe[i] = (samples[off + i] || 0) * p9DrawWin[i]; p9DrawIm[i] = 0; }
  enhFFT(p9DrawRe, p9DrawIm);
  const bins = RTEngine.RT_BINS, bands = new Float32Array(P9_BANDS);
  for (let b = 0; b < P9_BANDS; b++) {
    const k0 = Math.floor(b * bins / P9_BANDS), k1 = Math.max(k0 + 1, Math.floor((b + 1) * bins / P9_BANDS));
    let a = 0;
    for (let k = k0; k < k1; k++) a += p9DrawRe[k] * p9DrawRe[k] + p9DrawIm[k] * p9DrawIm[k];
    bands[b] = 10 * Math.log10(a / (k1 - k0) + 1e-12);
  }
  return bands;
}
function p9Heat(db) {
  const t = Math.max(0, Math.min(1, (db + 95) / 85));
  const r = Math.round(255 * Math.min(1, Math.max(0, t * 2.3 - 0.85)));
  const g = Math.round(255 * Math.min(1, Math.max(0, t * 1.7 - 0.25)));
  const b = Math.round(255 * Math.min(1, Math.max(0, 0.35 + t * 1.1 - Math.max(0, t * 2.1 - 0.9))));
  return `rgb(${r},${g},${b})`;
}

function p9DrawReset() {
  const spec = document.getElementById('cv9Spec'), wave = document.getElementById('cv9Wave');
  if (spec) { const c = spec.getContext('2d'); c.fillStyle = CSS('--bg-screen') || '#06090D'; c.fillRect(0, 0, spec.width, spec.height); }
  if (wave) { const c = wave.getContext('2d'); c.fillStyle = CSS('--bg-screen') || '#06090D'; c.fillRect(0, 0, wave.width, wave.height); }
}

const P9_COL_W = 3;
function p9OnChunk(result) {
  const spec = document.getElementById('cv9Spec');
  if (spec) {
    const c = spec.getContext('2d'), W = spec.width, H = spec.height, half = (H - 40) / 2, ch = half / P9_BANDS;
    c.drawImage(spec, -P9_COL_W, 0);
    c.fillStyle = CSS('--bg-screen') || '#06090D';
    c.fillRect(W - P9_COL_W, 0, P9_COL_W, H);
    const rawBands = p9BandDb(result.raw), enhBands = p9BandDb(result.enh);
    for (let b = 0; b < P9_BANDS; b++) {
      c.fillStyle = p9Heat(rawBands[b]);
      c.fillRect(W - P9_COL_W, 8 + (P9_BANDS - 1 - b) * ch, P9_COL_W, Math.ceil(ch));
      c.fillStyle = p9Heat(enhBands[b]);
      c.fillRect(W - P9_COL_W, 32 + half + (P9_BANDS - 1 - b) * ch, P9_COL_W, Math.ceil(ch));
    }
    c.fillStyle = '#C6D2D6'; c.font = '20px ' + (CSS('--font-sans') || 'sans-serif'); c.textAlign = 'left';
    c.fillText('raw input', 10, 26);
    c.fillText('enhanced', 10, 50 + half);
  }

  const wave = document.getElementById('cv9Wave');
  if (wave) {
    const c = wave.getContext('2d'), W = wave.width, H = wave.height, mid = H / 2;
    c.drawImage(wave, -P9_COL_W, 0);
    c.fillStyle = CSS('--bg-screen') || '#06090D';
    c.fillRect(W - P9_COL_W, 0, P9_COL_W, H);
    let rawMax = 0, enhMax = 0;
    for (let i = 0; i < result.raw.length; i++) { rawMax = Math.max(rawMax, Math.abs(result.raw[i])); enhMax = Math.max(enhMax, Math.abs(result.enh[i])); }
    if (p9Engine && p9Engine.metrics.impulseProb > 0.5) {
      c.fillStyle = 'rgba(255, 92, 92, .25)';
      c.fillRect(W - P9_COL_W, 0, P9_COL_W, H);
    }
    c.fillStyle = CSS('--sysB') || '#FFB830';
    c.fillRect(W - P9_COL_W, mid - rawMax * mid * 0.92, P9_COL_W, Math.max(1, rawMax * mid * 0.92 * 2));
    c.fillStyle = CSS('--sysC') || '#00E5A3';
    c.fillRect(W - P9_COL_W, mid - enhMax * mid * 0.6, P9_COL_W, Math.max(1, enhMax * mid * 0.6 * 2));
  }
}

/* ---- reset (invoked by the footer "Reset Panel Parameters" button / R key) ---- */
function p9Reset() {
  if (p9Engine) p9Stop();

  p9PendingParams.floorDb = -18; p9PendingParams.impulseExtraDb = -24; p9PendingParams.useFastPrior = true;
  if (p9StrengthEl) { p9StrengthEl.value = -18; document.getElementById('p9StrengthOut').textContent = '-18'; }
  if (p9ImpulseDbEl) { p9ImpulseDbEl.value = -24; document.getElementById('p9ImpulseDbOut').textContent = '-24'; }
  if (p9SwFastPrior) p9SwFastPrior.setAttribute('aria-pressed', 'true');

  document.querySelectorAll('#p9AbRow button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === 'enh'));

  p9Kind = 'mic';
  document.querySelectorAll('#p9SrcPick button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === 'mic'));
  const paneFile = document.getElementById('p9PaneFile'), paneDemo = document.getElementById('p9PaneDemo');
  if (paneFile) paneFile.hidden = true;
  if (paneDemo) paneDemo.hidden = true;
  p9FileBuffer = null;

  p9RecordedWav = null;
  if (p9DlBtn) p9DlBtn.disabled = true;
  const t = document.getElementById('p9LiveTime'); if (t) t.textContent = '0.0s';

  p9SetStatus('Neural engine idle');
  p9DrawReset();
}

p9DrawReset();
