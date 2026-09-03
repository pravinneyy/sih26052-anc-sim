/* ==========================================================================
   panel9.js — Interactive Audio Processing Lab: record or upload any audio,
   run it through the enhance.js log-MMSE engine, compare original vs
   enhanced by ear. All p9-prefixed to avoid colliding with panel3.js's own
   globals (actx, srcNode, playing, startedAt, offset are already taken).
   ========================================================================== */

let p9ctx = null;
let p9raw = null;       // original AudioBuffer, resampled to ENH_SR mono
let p9enh = null;       // enhanced AudioBuffer
let p9src = null;
let p9playing = false;
let p9startedAt = 0;
let p9offset = 0;
let p9cur = 'orig';
let p9lastResult = null;
let p9recorder = null;
let p9chunks = [];
let p9recTimer = null;
let p9recT0 = 0;

function p9EnsureCtx() {
  p9ctx = p9ctx || new (window.AudioContext || window.webkitAudioContext)();
  return p9ctx;
}
function p9SetStatus(msg) {
  const el = document.getElementById('p9Status');
  if (el) el.textContent = msg;
}
function p9CurrentBuffer() {
  return p9cur === 'enh' ? p9enh : p9raw;
}

/* Peak/RMS of the loaded input, shown right in the status line so a quiet
   mic input is visible without guessing — a laptop mic with no automatic
   gain control (disabled on purpose here, see the Record handler) can
   legitimately record very low levels, which the algorithm handles
   mathematically fine but can make the effect harder to hear. */
function p9LevelInfo(buf) {
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
  const rms = Math.sqrt(sum / d.length);
  const peakDb = 20 * Math.log10(peak + 1e-12);
  let note = '';
  if (peak < 0.02) note = ' — very quiet, try speaking closer to the mic or louder';
  else if (peak < 0.08) note = ' — quiet input';
  return `peak ${peakDb.toFixed(0)}dBFS, RMS ${rms.toFixed(3)}${note}`;
}

/* ---- resample any decoded/recorded buffer to mono @ ENH_SR ---- */
async function p9ToMono16k(buf) {
  const len = Math.max(1, Math.round(buf.duration * ENH_SR));
  const off = new OfflineAudioContext(1, len, ENH_SR);
  const s = off.createBufferSource();
  s.buffer = buf; s.connect(off.destination); s.start();
  const r = await off.startRendering();
  return r.getChannelData(0);
}
function p9ToAudioBuffer(f32) {
  const b = p9EnsureCtx().createBuffer(1, f32.length, ENH_SR);
  b.getChannelData(0).set(f32);
  return b;
}

/* ---- source picker: record / upload / built-in demo ---- */
const p9SrcPick = document.getElementById('p9SrcPick');
if (p9SrcPick) {
  p9SrcPick.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    p9SrcPick.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    const k = b.dataset.k;
    const paneMic = document.getElementById('p9PaneMic');
    const paneFile = document.getElementById('p9PaneFile');
    const paneDemo = document.getElementById('p9PaneDemo');
    if (paneMic) paneMic.hidden = k !== 'mic';
    if (paneFile) paneFile.hidden = k !== 'file';
    if (paneDemo) paneDemo.hidden = k !== 'demo';
  });
}

/* ---- record ---- */
const p9RecordBtn = document.getElementById('p9Record');
if (p9RecordBtn) {
  p9RecordBtn.onclick = async () => {
    if (p9recorder && p9recorder.state === 'recording') { p9recorder.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      p9SetStatus('Microphone unavailable — use Upload or a built-in clip. (Needs a secure context: HTTPS or localhost.)');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    } catch (err) {
      p9SetStatus('Microphone unavailable — use Upload or a built-in clip');
      return;
    }
    p9chunks = [];
    p9recorder = new MediaRecorder(stream);
    p9recorder.ondataavailable = e => { if (e.data.size > 0) p9chunks.push(e.data); };
    p9recorder.onstop = async () => {
      clearInterval(p9recTimer);
      p9RecordBtn.classList.remove('rec-on');
      p9RecordBtn.innerHTML = '<span class="rec-dot"></span>Start recording';
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(p9chunks, { type: p9recorder.mimeType || 'audio/webm' });
      await p9LoadBlob(blob, 'recording');
    };
    p9recorder.start();
    p9recT0 = performance.now();
    p9RecordBtn.classList.add('rec-on');
    p9RecordBtn.innerHTML = '<span class="rec-dot"></span>Stop recording';
    p9SetStatus('Recording…');
    p9recTimer = setInterval(() => {
      const el = document.getElementById('p9RecTime');
      if (el) el.textContent = ((performance.now() - p9recT0) / 1000).toFixed(1) + 's';
    }, 100);
  };
}

/* ---- upload ---- */
const p9FileIn = document.getElementById('p9File');
if (p9FileIn) {
  p9FileIn.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    p9SetStatus('Decoding…');
    await p9LoadBlob(f, f.name);
  });
}

async function p9LoadBlob(blob, label) {
  try {
    const arr = await blob.arrayBuffer();
    const decoded = await p9EnsureCtx().decodeAudioData(arr);
    const mono = await p9ToMono16k(decoded);
    p9raw = p9ToAudioBuffer(mono);
    p9enh = null; p9lastResult = null; p9cur = 'orig'; p9offset = 0;
    if (p9playing) { p9playing = false; const btn = document.getElementById('p9PlayBtn'); if (btn) btn.textContent = 'Play'; }

    document.querySelectorAll('#p9AbRow button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === 'orig'));
    const enhBtn = document.querySelector('#p9AbRow button[data-v="enh"]');
    if (enhBtn) enhBtn.disabled = true;
    const processBtn = document.getElementById('p9Process');
    if (processBtn) processBtn.disabled = false;
    const playBtn = document.getElementById('p9PlayBtn');
    if (playBtn) playBtn.disabled = false;
    const dlBtn = document.getElementById('p9DlBtn');
    if (dlBtn) dlBtn.disabled = true;

    p9SetStatus(`${label} · ${p9raw.duration.toFixed(1)}s loaded · ${p9LevelInfo(p9raw)}`);
    p9DrawWave();
    p9DrawSpecEmpty();
  } catch (err) {
    p9SetStatus('Could not decode that file');
  }
}

/* ---- built-in demo clip ---- */
const p9LoadDemoBtn = document.getElementById('p9LoadDemo');
if (p9LoadDemoBtn) {
  p9LoadDemoBtn.onclick = () => {
    const kind = document.getElementById('p9DemoPick').value;
    const f32 = enhMakeDemo(kind, 21);
    p9raw = p9ToAudioBuffer(f32);
    p9enh = null; p9lastResult = null; p9cur = 'orig'; p9offset = 0;
    if (p9playing) { p9playing = false; const btn = document.getElementById('p9PlayBtn'); if (btn) btn.textContent = 'Play'; }

    document.querySelectorAll('#p9AbRow button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === 'orig'));
    const enhBtn = document.querySelector('#p9AbRow button[data-v="enh"]');
    if (enhBtn) enhBtn.disabled = true;
    document.getElementById('p9Process').disabled = false;
    document.getElementById('p9PlayBtn').disabled = false;
    document.getElementById('p9DlBtn').disabled = true;

    p9SetStatus(`built-in clip · ${p9raw.duration.toFixed(1)}s loaded · ${p9LevelInfo(p9raw)}`);
    p9DrawWave();
    p9DrawSpecEmpty();
  };
}

/* ---- controls ---- */
const P9_ADAPT_LABELS = ['slow', 'medium', 'fast'];
const p9StrengthEl = document.getElementById('p9Strength');
if (p9StrengthEl) p9StrengthEl.oninput = e => { document.getElementById('p9StrengthOut').textContent = e.target.value; };
const p9AdaptEl = document.getElementById('p9Adapt');
if (p9AdaptEl) p9AdaptEl.oninput = e => { document.getElementById('p9AdaptOut').textContent = P9_ADAPT_LABELS[+e.target.value]; };
const p9TsensEl = document.getElementById('p9Tsens');
if (p9TsensEl) p9TsensEl.oninput = e => { document.getElementById('p9TsensOut').textContent = (+e.target.value).toFixed(1); };

function p9WireToggle(id) {
  const b = document.getElementById(id);
  if (!b) return;
  b.onclick = () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
}
p9WireToggle('p9SwTrans');
p9WireToggle('p9SwImp');

/* ---- process ---- */
const p9ProcessBtn = document.getElementById('p9Process');
if (p9ProcessBtn) {
  p9ProcessBtn.onclick = () => {
    if (!p9raw) return;
    p9ProcessBtn.disabled = true;
    p9SetStatus('Processing…');
    setTimeout(() => {
      const opt = {
        floorDb: +document.getElementById('p9Strength').value,
        adapt: +document.getElementById('p9Adapt').value,
        tsens: +document.getElementById('p9Tsens').value,
        transAware: document.getElementById('p9SwTrans').getAttribute('aria-pressed') === 'true',
        attenImpulse: document.getElementById('p9SwImp').getAttribute('aria-pressed') === 'true'
      };
      const res = enhProcess(p9raw.getChannelData(0), opt);
      p9lastResult = res;
      p9enh = p9ToAudioBuffer(res.out);

      const set = (id, v, dp, unit) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = (isFinite(v) ? v.toFixed(dp) : '—') + (unit ? `<span class="u">${unit}</span>` : '');
      };
      set('p9MNoise', res.noiseRed, 1, 'dB');
      set('p9MSnr', res.snrGain, 1, 'dB');
      set('p9MKeep', res.postKeep, 1, 'dB');
      document.getElementById('p9MTrans').textContent = res.transCount;
      set('p9MTime', res.ms, 0, 'ms');

      const enhBtn = document.querySelector('#p9AbRow button[data-v="enh"]');
      if (enhBtn) enhBtn.disabled = false;
      document.getElementById('p9DlBtn').disabled = false;
      p9ProcessBtn.disabled = false;
      p9SetStatus(`Processed. Enhanced ${p9LevelInfo(p9enh)}. Switch to Enhanced and listen.`);
      p9PickAB('enh');
      p9DrawSpec();
      p9DrawWave();
    }, 20);
  };
}

/* ---- A/B compare + transport ---- */
function p9PickAB(k) {
  p9cur = k;
  document.querySelectorAll('#p9AbRow button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === k));
  if (p9playing) { const pos = p9CurPos(); p9StopNode(); p9StartFrom(pos); }
}
seg('p9AbRow', v => p9PickAB(v));

function p9CurPos() { return p9playing ? (p9EnsureCtx().currentTime - p9startedAt) : p9offset; }
function p9StopNode() {
  if (p9src) { p9src.onended = null; try { p9src.stop(); } catch (e) {} p9src = null; }
  p9playing = false;
}
function p9StartFrom(pos) {
  const b = p9CurrentBuffer(); if (!b) return;
  pos = Math.max(0, Math.min(pos, b.duration - 0.01));
  const ctx = p9EnsureCtx();
  p9src = ctx.createBufferSource();
  p9src.buffer = b; p9src.connect(ctx.destination);
  p9src.onended = () => {
    if (p9playing) { p9playing = false; p9offset = 0; const btn = document.getElementById('p9PlayBtn'); if (btn) btn.textContent = 'Play'; }
  };
  p9src.start(0, pos);
  p9startedAt = ctx.currentTime - pos; p9playing = true;
  const btn = document.getElementById('p9PlayBtn'); if (btn) btn.textContent = 'Pause';
}
const p9PlayBtn = document.getElementById('p9PlayBtn');
if (p9PlayBtn) {
  p9PlayBtn.onclick = () => {
    if (!p9raw) return;
    const ctx = p9EnsureCtx();
    if (ctx.state === 'suspended') ctx.resume();
    if (p9playing) { p9offset = p9CurPos(); p9StopNode(); p9PlayBtn.textContent = 'Play'; }
    else p9StartFrom(p9offset);
  };
}
const p9SeekBar = document.getElementById('p9SeekBar');
if (p9SeekBar) {
  p9SeekBar.onclick = e => {
    const b = p9CurrentBuffer(); if (!b) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width * b.duration;
    if (p9playing) { p9StopNode(); p9StartFrom(pos); } else { p9offset = pos; p9UpdateTime(); }
  };
}
function p9UpdateTime() {
  const b = p9CurrentBuffer(); if (!b) return;
  const pos = Math.min(p9CurPos(), b.duration);
  const fill = document.getElementById('p9PlayBar');
  if (fill) fill.style.width = (pos / b.duration * 100) + '%';
  const time = document.getElementById('p9PlayTime');
  if (time) time.textContent = pos.toFixed(1) + ' / ' + b.duration.toFixed(1) + 's';
}
setInterval(p9UpdateTime, 70);

/* ---- download enhanced clip as a 16-bit PCM WAV ---- */
const p9DlBtn = document.getElementById('p9DlBtn');
if (p9DlBtn) {
  p9DlBtn.onclick = () => {
    if (!p9enh) return;
    const d = p9enh.getChannelData(0), n = d.length;
    const ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, ENH_SR, true); v.setUint32(28, ENH_SR * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wr(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    const url = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
    const a = document.createElement('a'); a.href = url; a.download = 'enhanced.wav'; a.click();
    URL.revokeObjectURL(url);
  };
}

/* ==========================================================================
   Drawing — spectrogram + waveform. Prefixed p9* so they can't collide with
   the generic line-plot plot() in draw.js.
   ========================================================================== */
function p9Heat(db) {
  const t = Math.max(0, Math.min(1, (db + 95) / 85));
  const r = Math.round(255 * Math.min(1, Math.max(0, t * 2.3 - 0.85)));
  const g = Math.round(255 * Math.min(1, Math.max(0, t * 1.7 - 0.25)));
  const b = Math.round(255 * Math.min(1, Math.max(0, 0.35 + t * 1.1 - Math.max(0, t * 2.1 - 0.9))));
  return `rgb(${r},${g},${b})`;
}
function p9DrawSpecEmpty() {
  const cv = document.getElementById('cv9Spec'); if (!cv) return;
  const c = cv.getContext('2d');
  c.fillStyle = CSS('--bg-screen') || '#06090D'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#5F7178'; c.font = '24px ' + (CSS('--font-sans') || 'sans-serif'); c.textAlign = 'center';
  c.fillText('Process the audio to see the spectrogram', cv.width / 2, cv.height / 2);
}
function p9DrawSpec() {
  const cv = document.getElementById('cv9Spec'); if (!cv) return;
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  c.fillStyle = CSS('--bg-screen') || '#06090D'; c.fillRect(0, 0, W, H);
  if (!p9lastResult) return p9DrawSpecEmpty();
  const { specOrig, specEnh } = p9lastResult, F = specOrig.length, B = 96;
  if (!F) return p9DrawSpecEmpty();
  const half = (H - 40) / 2, cw = W / F, ch = half / B;
  for (let f = 0; f < F; f++) {
    for (let b = 0; b < B; b++) {
      c.fillStyle = p9Heat(specOrig[f][b]);
      c.fillRect(f * cw, 8 + (B - 1 - b) * ch, Math.ceil(cw), Math.ceil(ch));
      c.fillStyle = p9Heat(specEnh[f][b]);
      c.fillRect(f * cw, 32 + half + (B - 1 - b) * ch, Math.ceil(cw), Math.ceil(ch));
    }
  }
  c.fillStyle = '#C6D2D6'; c.font = '20px ' + (CSS('--font-sans') || 'sans-serif'); c.textAlign = 'left';
  c.fillText('original', 10, 26);
  c.fillText('enhanced', 10, 50 + half);
}
function p9DrawWave() {
  const cv = document.getElementById('cv9Wave'); if (!cv) return;
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  c.fillStyle = CSS('--bg-screen') || '#06090D'; c.fillRect(0, 0, W, H);
  if (!p9raw) return;
  const o = p9raw.getChannelData(0), n = o.length, step = Math.max(1, Math.floor(n / W)), mid = H / 2;
  if (p9lastResult) {
    const { transMask } = p9lastResult;
    c.fillStyle = 'rgba(255, 92, 92, .2)';
    for (let f = 0; f < transMask.length; f++) if (transMask[f]) {
      const px = (f * ENH_HOP) / n * W;
      c.fillRect(px, 0, Math.max(2, ENH_HOP / n * W), H);
    }
  }
  const trace = (data, color) => {
    c.strokeStyle = color; c.lineWidth = 1.8; c.beginPath();
    for (let px = 0; px < W; px++) {
      let mx = 0;
      for (let i = px * step; i < (px + 1) * step && i < data.length; i++) mx = Math.max(mx, Math.abs(data[i]));
      const h = mx * mid * 0.92;
      c.moveTo(px, mid - h); c.lineTo(px, mid + h);
    }
    c.stroke();
  };
  trace(o, CSS('--sysB') || '#FFB830');
  if (p9enh) trace(p9enh.getChannelData(0), CSS('--sysC') || '#00E5A3');
}

/* ---- reset ---- */
function p9Reset() {
  p9StopNode();
  p9raw = null; p9enh = null; p9lastResult = null; p9offset = 0; p9cur = 'orig';

  // Controls back to defaults — these were never reset before.
  const strengthEl = document.getElementById('p9Strength');
  if (strengthEl) { strengthEl.value = -18; document.getElementById('p9StrengthOut').textContent = '-18'; }
  const adaptEl = document.getElementById('p9Adapt');
  if (adaptEl) { adaptEl.value = 1; document.getElementById('p9AdaptOut').textContent = P9_ADAPT_LABELS[1]; }
  const tsensEl = document.getElementById('p9Tsens');
  if (tsensEl) { tsensEl.value = 6; document.getElementById('p9TsensOut').textContent = '6.0'; }
  const swTrans = document.getElementById('p9SwTrans'); if (swTrans) swTrans.setAttribute('aria-pressed', 'true');
  const swImp = document.getElementById('p9SwImp'); if (swImp) swImp.setAttribute('aria-pressed', 'true');

  // Source picker back to "Record"
  document.querySelectorAll('#p9SrcPick button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === 'mic'));
  const paneMic = document.getElementById('p9PaneMic'), paneFile = document.getElementById('p9PaneFile'), paneDemo = document.getElementById('p9PaneDemo');
  if (paneMic) paneMic.hidden = false;
  if (paneFile) paneFile.hidden = true;
  if (paneDemo) paneDemo.hidden = true;

  document.querySelectorAll('#p9AbRow button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === 'orig'));
  const enhBtn = document.querySelector('#p9AbRow button[data-v="enh"]');
  if (enhBtn) enhBtn.disabled = true;
  const playBtn = document.getElementById('p9PlayBtn'); if (playBtn) { playBtn.disabled = true; playBtn.textContent = 'Play'; }
  const dlBtn = document.getElementById('p9DlBtn'); if (dlBtn) dlBtn.disabled = true;
  const processBtn = document.getElementById('p9Process'); if (processBtn) processBtn.disabled = true;
  const bar = document.getElementById('p9PlayBar'); if (bar) bar.style.width = '0%';
  const time = document.getElementById('p9PlayTime'); if (time) time.textContent = '0.0 / 0.0s';
  p9SetStatus('No audio loaded');
  p9DrawSpecEmpty();
  const wave = document.getElementById('cv9Wave');
  if (wave) wave.getContext('2d').fillRect(0, 0, wave.width, wave.height);
}

p9DrawSpecEmpty();
