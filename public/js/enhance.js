/* ==========================================================================
   enhance.js — Multi-Band Causal Subband Speech Enhancement Engine
   ========================================================================== */

const ENH_BAND_EDGES = [160, 380, 750, 1200, 1750]; // Frequency band cutoff boundaries (Hz)
const ENH_BAND_LABELS = ['0–160', '160–380', '380–750', '750–1.2k', '1.2k–1.75k', '1.75k+'];
const ENH_COLORS = ['#FF5C5C', '#FFB830', '#00E5A3', '#00D2FF', '#A78BFA', '#60A5FA'];

// Rate-independent attack and decay time constants
const ENH_TAU_FAST = 0.0012; // 1.2 ms fast attack
const ENH_TAU_SLOW = 0.0520; // 52 ms noise envelope adaptation

// Single-Pole Causal Lowpass Filter
function enhOnepoleLP(x, fc, fs) {
  const alpha = 1.0 - Math.exp((-2.0 * Math.PI * fc) / fs);
  const y = new Float64Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += alpha * (x[i] - acc);
    y[i] = acc;
  }
  return y;
}

// Subband Decomposition Filter Bank
function enhSplitBands(x, fs) {
  const lps = ENH_BAND_EDGES.map(fc => enhOnepoleLP(x, fc, fs));
  const n = x.length;
  const nb = ENH_BAND_EDGES.length + 1;
  const bands = [];

  for (let b = 0; b < nb; b++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const hi = b < ENH_BAND_EDGES.length ? lps[b][i] : x[i];
      const lo = b > 0 ? lps[b - 1][i] : 0;
      y[i] = hi - lo;
    }
    bands.push(y);
  }
  return bands;
}

// Adaptive Subband Wiener Gain Computation
function enhBandGain(bandSig, fs) {
  const n = bandSig.length;
  const gain = new Float64Array(n);
  const af = 1.0 - Math.exp(-1.0 / (ENH_TAU_FAST * fs));
  const as = Math.exp(-1.0 / (ENH_TAU_SLOW * fs));
  let Ef = 0;
  let Eb = 1e-6;

  for (let i = 0; i < n; i++) {
    const p = bandSig[i] * bandSig[i];
    Ef = (1.0 - af) * Ef + af * p;

    // Track stationary noise floor when speech energy is absent
    if (Ef <= 1.6 * Eb) {
      Eb = as * Eb + (1.0 - as) * p;
    }

    // Wiener Spectral Gain: G(k) = Ef / (Ef + Eb)
    const g = Ef / (Ef + Eb + 1e-9);
    gain[i] = Math.max(0.02, Math.min(1.0, g));
  }
  return gain;
}

// Multi-Band Enhancement Mask Application
function applyEnhancementMask(signal, fs) {
  const bands = enhSplitBands(signal, fs);
  const gains = bands.map(b => enhBandGain(b, fs));
  const enhanced = new Float64Array(signal.length);

  for (let b = 0; b < bands.length; b++) {
    for (let i = 0; i < signal.length; i++) {
      enhanced[i] += bands[b][i] * gains[b][i];
    }
  }
  return { enhanced, gains };
}

// Synthetic Tactical Radio Speech & Ambient Noise Generator
function genBoomSignal(n, seed) {
  const r = rng(seed || 333);
  const x = new Float64Array(n);
  let lp = 0;

  for (let i = 0; i < n; i++) {
    const t = i / FS;
    lp = 0.9 * lp + 0.1 * gauss(r);

    // Formant vocal speech harmonics
    const formant1 = Math.sin(2 * Math.PI * (220 + 35 * Math.sin(2 * Math.PI * 3.0 * t)) * t);
    const formant2 = 0.5 * Math.sin(2 * Math.PI * (680 + 70 * Math.sin(2 * Math.PI * 2.2 * t)) * t);
    const envelope = Math.max(0, Math.sin(2 * Math.PI * 1.5 * t));
    const speech = 0.42 * (formant1 + formant2) * envelope;

    // High ambient cockpit noise
    const noise = lp * 1.3 + 0.4 * Math.sin(2 * Math.PI * 115 * t);
    x[i] = speech + noise;
  }
  return x;
}

function runEnhancement(n, seed) {
  const raw = genBoomSignal(n, seed);
  const { enhanced, gains } = applyEnhancementMask(raw, FS);
  return { raw, enhanced, gains };
}
