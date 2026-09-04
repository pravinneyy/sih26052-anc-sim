/* ==========================================================================
   panel10.js — AI/ML Neural Adaptive Engine & Tactical Cue Classifier
   SIH26052 Interactive Panel 10

   Visualisations:
     · Scrolling Log-Mel feature map  (Brain 1 input)
     · Live 5-class probability bars  (Brain 1 output)
     · Neural µ(t) trajectory         (Brain 2 output)
     · Per-bin spectral mask preview  (Brain 3 output)
     · Tactical mode switcher

   Uses AIML global from aiml_engine.js.
   Uses rng()/gauss() globals from sim.js (for deterministic synth audio).
   ========================================================================== */

/* ---- constants ---- */
const P10_SR       = 4000;            // Simulation sample rate (matches FS in sim.js)
const P10_HIST     = 90;              // Frames kept in scrolling history
const P10_INTERVAL = 60;             // ms between frames (~16 fps visual)
const P10_MU_NOM   = 0.005;          // Nominal µ (same as panel2 runFxLMS default)

/* ---- audio audition state (declared early so p10Stop can reference them) ---- */
let p10AudioCtx     = null;
let p10AudioSrc     = null;
let p10AudioPlaying = false;

/* ---- state ---- */
let p10Scenario   = 'heli';
let p10Mode       = AIML.MODES.TACTICAL_VOICE;
let p10t          = 0;                // Simulation time (seconds)
let p10AnimTimer  = null;
let p10Running    = false;

// Circular/scrolling history buffers
const p10MelHist   = [];  // Array<Float64Array(N_MELS)>
const p10MuHist    = [];  // Array<number>
const p10ProbHist  = [];  // Array<number[]>  (latest only for bars)
let   p10LastResult = null;

// Noise-PRNG state (refreshed each scenario switch)
let p10Rng = rng(42);

/* ---- scenario → synthetic frame generator ---- */
function p10GenFrame(scenario, t) {
  const N  = AIML.FFT_N;
  const fr = new Float64Array(N);
  const sr = P10_SR;

  for (let i = 0; i < N; i++) {
    const ti = t + i / sr;

    switch (scenario) {
      case 'heli': {
        // Helicopter: main rotor (12–15 Hz blade rate) + gear mesh + turbine
        const blade = 13.2 + 0.8 * Math.sin(2 * Math.PI * 0.05 * t); // slight RPM variation
        fr[i] = 0.55 * Math.sin(2 * Math.PI * blade * ti)
              + 0.35 * Math.sin(2 * Math.PI * blade * 2 * ti)
              + 0.20 * Math.sin(2 * Math.PI * blade * 4 * ti)
              + 0.28 * Math.sin(2 * Math.PI * 115 * ti)   // turbine tone
              + 0.15 * gauss(p10Rng);
        break;
      }
      case 'tank': {
        // Diesel tank engine: 4-stroke harmonic series, slow RPM modulation
        const rpm = 1800 + 120 * Math.sin(2 * Math.PI * 0.2 * t);
        const f0  = rpm / 60 / 2; // 4-cylinder, firing every 180°
        fr[i] = (0.65 * Math.sin(2 * Math.PI * f0 * ti)
               + 0.45 * Math.sin(2 * Math.PI * 2 * f0 * ti)
               + 0.25 * Math.sin(2 * Math.PI * 4 * f0 * ti)
               + 0.35 * gauss(p10Rng) * 0.4)
               * (1 + 0.18 * Math.sin(2 * Math.PI * 0.4 * t));
        break;
      }
      case 'gun': {
        // Gunfire: sharp impulse with exponential decay and broadband ring
        const decay = 300 + 50 * (p10Rng() - 0.5);
        fr[i] = 4.0 * Math.exp(-i / sr * decay) * gauss(p10Rng)
              + 0.12 * gauss(p10Rng);
        break;
      }
      case 'voice': {
        // Tactical voice: quasi-periodic voiced speech F0 ~150-220 Hz
        const f0 = 175 + 35 * Math.sin(2 * Math.PI * 2.5 * t);
        const env = 0.5 + 0.5 * Math.abs(Math.sin(2 * Math.PI * 1.8 * t)); // syllable energy
        fr[i] = env * (0.50 * Math.sin(2 * Math.PI * f0 * ti)
                     + 0.32 * Math.sin(2 * Math.PI * 2 * f0 * ti)
                     + 0.18 * Math.sin(2 * Math.PI * 3 * f0 * ti)
                     + 0.12 * Math.sin(2 * Math.PI * 4 * f0 * ti))
              + 0.08 * gauss(p10Rng);
        break;
      }
      case 'siren': {
        // Warning siren: sweeping tone 800–1800 Hz + AM modulation
        const freq = 1000 + 600 * Math.sin(2 * Math.PI * 1.8 * t);
        fr[i] = 0.82 * Math.sin(2 * Math.PI * freq * ti)
              * (0.7 + 0.3 * Math.sin(2 * Math.PI * 4 * t))
              + 0.06 * gauss(p10Rng);
        break;
      }
      default:
        fr[i] = gauss(p10Rng) * 0.3;
    }
  }

  // Normalise peak to avoid clipping
  let pk = 0;
  for (let i = 0; i < N; i++) if (Math.abs(fr[i]) > pk) pk = Math.abs(fr[i]);
  if (pk > 1e-6) { const sc = 0.9 / pk; for (let i = 0; i < N; i++) fr[i] *= sc; }

  return fr;
}

/* ---- animation tick ---- */
function p10Tick() {
  const frame  = p10GenFrame(p10Scenario, p10t);
  p10t        += AIML.FFT_N / P10_SR;

  AIML.setMode(p10Mode);
  const res   = AIML.processFrame(frame, P10_SR);
  p10LastResult = res;

  // Append to scrolling histories
  p10MelHist.push(res.mel.slice());
  if (p10MelHist.length > P10_HIST) p10MelHist.shift();

  p10MuHist.push(res.muScale);
  if (p10MuHist.length > P10_HIST) p10MuHist.shift();

  p10ProbHist.push(res.probs.slice());
  if (p10ProbHist.length > P10_HIST) p10ProbHist.shift();

  // Draw everything
  p10DrawMel();
  p10DrawMu();
  p10UpdateProbs(res);
  p10DrawMask(res.mask);
  p10UpdateReadouts(res);
}

/* ==========================================================================
   Drawing — Log-Mel Feature Map
   ========================================================================== */
function p10MelHeat(v) {
  // v is log-energy, typically -15 to 0 normalised to [0,1]
  const t = Math.max(0, Math.min(1, (v + 15) / 15));
  const r = Math.round(255 * Math.min(1, Math.max(0, t * 2.2 - 0.8)));
  const g = Math.round(255 * Math.min(1, Math.max(0, t * 1.8 - 0.2)));
  const b = Math.round(255 * Math.min(1, Math.max(0, 0.4 + t * 0.9 - Math.max(0, t * 2.0 - 1.0))));
  return `rgb(${r},${g},${b})`;
}

function p10DrawMel() {
  const cv = document.getElementById('cv10Mel');
  if (!cv) return;
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  c.fillStyle = '#06090D';
  c.fillRect(0, 0, W, H);

  if (!p10MelHist.length) return;

  const frames = p10MelHist.length;
  const cw = W / P10_HIST;
  const ch = H / AIML.N_MELS;

  for (let f = 0; f < frames; f++) {
    const mel = p10MelHist[f];
    for (let m = 0; m < AIML.N_MELS; m++) {
      c.fillStyle = p10MelHeat(mel[m]);
      c.fillRect(
        f * cw,
        H - (m + 1) * ch,
        Math.ceil(cw) + 1,
        Math.ceil(ch) + 1
      );
    }
  }

  // Frequency axis labels on left
  c.fillStyle = 'rgba(148,163,184,0.7)';
  c.font = '10px JetBrains Mono, monospace';
  c.textAlign = 'left';
  const nLabels = 5;
  for (let i = 0; i <= nLabels; i++) {
    const m  = Math.round(i * (AIML.N_MELS - 1) / nLabels);
    const y  = H - (m + 0.5) * ch;
    // Approximate Hz label
    const hz = Math.round(700 * (Math.pow(10, (0.5 + m / AIML.N_MELS) * Math.log10(1 + 2000 / 700)) - 1));
    c.fillText(`${hz < 1000 ? hz : (hz / 1000).toFixed(1) + 'k'}`, 3, y + 4);
  }
}

/* ==========================================================================
   Drawing — Neural µ(t) Trajectory
   ========================================================================== */
function p10DrawMu() {
  const cv = document.getElementById('cv10Mu');
  if (!cv) return;
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  c.fillStyle = '#06090D';
  c.fillRect(0, 0, W, H);

  const n = p10MuHist.length;
  if (!n) return;

  const pad = { l: 48, r: 14, t: 12, b: 30 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  const muMin = 0, muMax = 1.6;
  const X = i => pad.l + (i / (P10_HIST - 1)) * pw;
  const Y = v => pad.t + (1 - (v - muMin) / (muMax - muMin)) * ph;

  // Grid
  c.strokeStyle = 'rgba(255,255,255,0.05)';
  c.lineWidth = 1;
  for (let v = 0; v <= 1.5; v += 0.5) {
    c.beginPath(); c.moveTo(pad.l, Y(v)); c.lineTo(W - pad.r, Y(v)); c.stroke();
    c.fillStyle = '#64748B';
    c.font = '10px JetBrains Mono, monospace';
    c.textAlign = 'right';
    c.fillText(v.toFixed(1), pad.l - 4, Y(v) + 4);
  }

  // Nominal µ reference line (dashed grey)
  c.strokeStyle = 'rgba(148,163,184,0.35)';
  c.lineWidth = 1.5;
  c.setLineDash([5, 4]);
  const nomY = Y(1.0);
  c.beginPath(); c.moveTo(pad.l, nomY); c.lineTo(W - pad.r, nomY); c.stroke();
  c.setLineDash([]);
  c.fillStyle = 'rgba(148,163,184,0.5)';
  c.font = '10px JetBrains Mono, monospace';
  c.textAlign = 'left';
  c.fillText('1.00× (nominal)', pad.l + 4, nomY - 4);

  // AI µ(t) curve
  c.strokeStyle = '#00D2FF';
  c.lineWidth = 2.2;
  c.shadowColor = 'rgba(0,210,255,0.5)';
  c.shadowBlur  = 6;
  c.beginPath();
  let started = false;
  for (let i = 0; i < n; i++) {
    const px = X(P10_HIST - n + i);
    const py = Y(Math.max(muMin, Math.min(muMax, p10MuHist[i])));
    if (!started) { c.moveTo(px, py); started = true; }
    else          c.lineTo(px, py);
  }
  c.stroke();
  c.shadowBlur = 0;

  // Axis label
  c.fillStyle = '#94A3B8';
  c.font = '11px Inter, sans-serif';
  c.textAlign = 'center';
  c.fillText('Neural Step-Size µ(t) · Scale Factor', pad.l + pw / 2, H - 4);
}

/* ==========================================================================
   Drawing — Spectral Mask Preview (Brain 3)
   ========================================================================== */
function p10DrawMask(mask) {
  const cv = document.getElementById('cv10Mask');
  if (!cv || !mask) return;
  const c  = cv.getContext('2d');
  const W  = cv.width, H = cv.height;

  c.fillStyle = '#06090D';
  c.fillRect(0, 0, W, H);

  const bw = W / mask.length;
  for (let k = 0; k < mask.length; k++) {
    const g  = mask[k];  // [0, 1]
    // Colour: 0=dark, 1=cyan/green
    const r  = Math.round(0   + g * 0);
    const gv = Math.round(80  + g * 175);
    const b  = Math.round(40  + g * 215);
    c.fillStyle = `rgb(${r},${gv},${b})`;
    const barH = Math.max(2, g * (H - 8));
    c.fillRect(k * bw, H - barH, Math.ceil(bw) + 1, barH);
  }

  // Freq labels
  c.fillStyle = 'rgba(148,163,184,0.7)';
  c.font = '10px JetBrains Mono, monospace';
  c.textAlign = 'center';
  const freqLabels = ['0', '250', '500', '1k', '2k'];
  freqLabels.forEach((lbl, i) => {
    const x = (i / (freqLabels.length - 1)) * W;
    c.fillText(lbl, x, H - 2);
  });
}

/* ==========================================================================
   Class Probability Bars (Brain 1 output)
   ========================================================================== */
function p10InitProbBars() {
  const container = document.getElementById('p10Probs');
  if (!container) return;
  container.innerHTML = '';
  for (let c = 0; c < AIML.N_CLASSES; c++) {
    const row  = document.createElement('div');
    row.className = 'prob-row';
    row.id = `p10ProbRow${c}`;

    const lbl  = document.createElement('div');
    lbl.className = 'prob-label';
    lbl.title = AIML.CLASS_NAMES[c];
    lbl.textContent = AIML.CLASS_SHORT[c];

    const track = document.createElement('div');
    track.className = 'prob-track';
    const fill = document.createElement('div');
    fill.className = 'prob-fill';
    fill.id = `p10Fill${c}`;
    fill.style.width = '0%';
    fill.style.background = AIML.CLASS_COLORS[c];
    fill.style.color = AIML.CLASS_COLORS[c];
    track.appendChild(fill);

    const pct = document.createElement('div');
    pct.className = 'prob-pct';
    pct.id = `p10Pct${c}`;
    pct.textContent = '0%';

    row.appendChild(lbl);
    row.appendChild(track);
    row.appendChild(pct);
    container.appendChild(row);
  }
}

function p10UpdateProbs(res) {
  const probs  = res.probs;
  let topClass = 0;
  for (let c = 1; c < probs.length; c++) if (probs[c] > probs[topClass]) topClass = c;

  for (let c = 0; c < AIML.N_CLASSES; c++) {
    const pct  = Math.round(probs[c] * 100);
    const fill = document.getElementById(`p10Fill${c}`);
    const pctEl = document.getElementById(`p10Pct${c}`);
    const row  = document.getElementById(`p10ProbRow${c}`);
    if (fill)  fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (row)   row.style.opacity = c === topClass ? '1' : '0.65';
  }

  // Threat alert log
  const alertEl = document.getElementById('p10Alert');
  if (alertEl) {
    if (topClass === 2 && probs[2] > 0.35) {
      alertEl.innerHTML = '<span class="threat-alert">⚡ BLAST TRANSIENT — Neural µ frozen, Huber 2.0× active</span>';
    } else if (topClass === 4 && probs[4] > 0.3) {
      alertEl.innerHTML = '<span class="threat-alert siren-alert">🔊 THREAT SIREN — Cue pass-through enabled</span>';
    } else {
      alertEl.innerHTML = '';
    }
  }
}

/* ==========================================================================
   Readout updates
   ========================================================================== */
function p10UpdateReadouts(res) {
  const muEl   = document.getElementById('p10MuVal');
  const betaEl = document.getElementById('p10BetaVal');
  const fluxEl = document.getElementById('p10FluxVal');

  if (muEl)   muEl.innerHTML   = res.muScale.toFixed(2) + '<span class="u">× nominal</span>';
  if (betaEl) betaEl.innerHTML = res.betaScale.toFixed(1) + '<span class="u">× σ</span>';
  if (fluxEl) {
    const fluxDb = 10 * Math.log10(res.flux + 1e-10);
    fluxEl.innerHTML = fluxDb.toFixed(1) + '<span class="u">dB</span>';
  }
}

/* ==========================================================================
   Scenario & mode controls
   ========================================================================== */
const p10ScenarioEl = document.getElementById('p10Scenario');
if (p10ScenarioEl) {
  p10ScenarioEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    p10ScenarioEl.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    p10Scenario = b.dataset.v;
    p10t        = 0;
    p10Rng      = rng(Date.now() & 0xFFFF);  // Fresh noise for new scenario
    AIML.resetState();
    p10MelHist.length  = 0;
    p10MuHist.length   = 0;
    p10ProbHist.length = 0;
  });
}

const p10ModeEl = document.getElementById('p10Mode');
if (p10ModeEl) {
  p10ModeEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    p10ModeEl.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    p10Mode = +b.dataset.v;
    AIML.setMode(p10Mode);

    const descEl = document.getElementById('p10ModeDesc');
    if (descEl) descEl.textContent = AIML.MODE_DESCRIPTIONS[p10Mode];
  });
}

/* ==========================================================================
   Start / Stop / Reset
   ========================================================================== */
function p10Start() {
  if (p10Running) return;
  p10Running = true;
  AIML.resetState();
  AIML.setMode(p10Mode);
  p10InitProbBars();

  // Set initial mode description
  const descEl = document.getElementById('p10ModeDesc');
  if (descEl) descEl.textContent = AIML.MODE_DESCRIPTIONS[p10Mode];

  function loop() {
    if (!p10Running) return;
    p10Tick();
    p10AnimTimer = setTimeout(loop, P10_INTERVAL);
  }
  loop();
}

function p10Stop() {
  p10Running = false;
  if (p10AnimTimer) { clearTimeout(p10AnimTimer); p10AnimTimer = null; }
  // Stop any scenario audio playing
  if (p10AudioSrc) { try { p10AudioSrc.stop(); } catch (e) {} p10AudioSrc = null; }
  p10AudioPlaying = false;
  const audBtn = document.getElementById('p10AuditionBtn');
  if (audBtn) audBtn.textContent = '\u25B6 Audition Scenario';
}

function p10Reset() {
  p10Stop();
  p10t = 0;
  p10MelHist.length  = 0;
  p10MuHist.length   = 0;
  p10ProbHist.length = 0;
  p10Scenario = 'heli';
  p10Mode     = AIML.MODES.TACTICAL_VOICE;
  AIML.resetState();
  AIML.setMode(p10Mode);

  // Reset UI controls
  if (p10ScenarioEl) {
    p10ScenarioEl.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.v === 'heli');
    });
  }
  if (p10ModeEl) {
    p10ModeEl.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.v === '1');
    });
  }

  // Clear canvases
  ['cv10Mel', 'cv10Mu', 'cv10Mask'].forEach(id => {
    const cv = document.getElementById(id);
    if (cv) cv.getContext('2d').fillRect(0, 0, cv.width, cv.height);
  });

  // Re-initialise probability bars
  p10InitProbBars();
}

/* ==========================================================================
   Audio Audition — play a 3-second synthetic scenario burst through WebAudio
   ========================================================================== */

function p10GetCtx() {
  p10AudioCtx = p10AudioCtx || new (window.AudioContext || window.webkitAudioContext)();
  return p10AudioCtx;
}

function p10Audition() {
  // Toggle stop if already playing
  if (p10AudioPlaying && p10AudioSrc) {
    try { p10AudioSrc.stop(); } catch (e) {}
    return;  // onended will clean up
  }

  const ctx = p10GetCtx();
  if (ctx.state === 'suspended') ctx.resume();

  // Generate 3 seconds of the current scenario at P10_SR
  const dur = 3;
  const nSamples = dur * P10_SR;
  const N = AIML.FFT_N;  // 256 samples per frame
  const buf = ctx.createBuffer(1, nSamples, P10_SR);
  const data = buf.getChannelData(0);

  // Use a fresh PRNG so we don't disturb the visualisation's p10Rng
  let audRng = rng((Date.now() & 0xFFFF) ^ 0x5A5A);
  let at = p10t;  // Start from current sim time for continuity

  for (let i = 0; i < nSamples; i += N) {
    // Build one frame using the current scenario
    const fr = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      const ti = at + j / P10_SR;
      switch (p10Scenario) {
        case 'heli': {
          const blade = 13.2 + 0.8 * Math.sin(2 * Math.PI * 0.05 * at);
          fr[j] = 0.55 * Math.sin(2 * Math.PI * blade * ti)
                + 0.35 * Math.sin(2 * Math.PI * blade * 2 * ti)
                + 0.20 * Math.sin(2 * Math.PI * blade * 4 * ti)
                + 0.28 * Math.sin(2 * Math.PI * 115 * ti)
                + 0.15 * gauss(audRng); break;
        }
        case 'tank': {
          const rpm = 1800 + 120 * Math.sin(2 * Math.PI * 0.2 * at);
          const f0  = rpm / 60 / 2;
          fr[j] = (0.65 * Math.sin(2 * Math.PI * f0 * ti)
                 + 0.45 * Math.sin(2 * Math.PI * 2 * f0 * ti)
                 + 0.25 * Math.sin(2 * Math.PI * 4 * f0 * ti)
                 + 0.35 * gauss(audRng) * 0.4)
                 * (1 + 0.18 * Math.sin(2 * Math.PI * 0.4 * at)); break;
        }
        case 'gun': {
          const decay = 300 + 50 * (audRng() - 0.5);
          fr[j] = 4.0 * Math.exp(-j / P10_SR * decay) * gauss(audRng)
                + 0.12 * gauss(audRng); break;
        }
        case 'voice': {
          const f0 = 175 + 35 * Math.sin(2 * Math.PI * 2.5 * at);
          const env = 0.5 + 0.5 * Math.abs(Math.sin(2 * Math.PI * 1.8 * at));
          fr[j] = env * (0.50 * Math.sin(2 * Math.PI * f0 * ti)
                       + 0.32 * Math.sin(2 * Math.PI * 2 * f0 * ti)
                       + 0.18 * Math.sin(2 * Math.PI * 3 * f0 * ti)
                       + 0.12 * Math.sin(2 * Math.PI * 4 * f0 * ti))
                + 0.08 * gauss(audRng); break;
        }
        case 'siren': {
          const freq = 1000 + 600 * Math.sin(2 * Math.PI * 1.8 * at);
          fr[j] = 0.82 * Math.sin(2 * Math.PI * freq * ti)
                * (0.7 + 0.3 * Math.sin(2 * Math.PI * 4 * at))
                + 0.06 * gauss(audRng); break;
        }
        default: fr[j] = gauss(audRng) * 0.3;
      }
    }
    at += N / P10_SR;
    const len = Math.min(N, nSamples - i);
    for (let j = 0; j < len; j++) data[i + j] = fr[j];
  }

  // Peak-normalise
  let peak = 0;
  for (let i = 0; i < nSamples; i++) if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
  if (peak > 1e-6) { const s = 0.88 / peak; for (let i = 0; i < nSamples; i++) data[i] *= s; }

  p10AudioSrc = ctx.createBufferSource();
  p10AudioSrc.buffer = buf;
  p10AudioSrc.connect(ctx.destination);
  p10AudioSrc.onended = () => {
    p10AudioPlaying = false;
    p10AudioSrc = null;
    const btn = document.getElementById('p10AuditionBtn');
    if (btn) btn.textContent = '\u25B6 Audition Scenario';
  };
  p10AudioSrc.start();
  p10AudioPlaying = true;
  const btn = document.getElementById('p10AuditionBtn');
  if (btn) btn.textContent = '\u25A0 Stop';
}

// Wire audition button
const p10AuditionBtnEl = document.getElementById('p10AuditionBtn');
if (p10AuditionBtnEl) p10AuditionBtnEl.onclick = p10Audition;

/* Panel 10 auto-starts when navigated to (show() calls redraw → p10Start).
   Stop when navigating away. We hook into the shell's show() by overriding
   the global redraw function's p10 branch (main.js calls p10Start on show). */
