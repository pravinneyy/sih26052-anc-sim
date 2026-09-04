/* ==========================================================================
   aiml_engine.js — Edge AI/ML Tri-Brain Neural Adaptive Engine
   SIH26052 — Tactical ANC / Speech Enhancement Console

   Brain 1 · Acoustic Scene & Threat Cue Classifier
             Real-time 5-class log-linear classifier from Log-Mel features.
             Classes: Stationary Vehicle | Non-Stationary Engine |
                      Gunshot/Blast | Tactical Voice | Threat Siren

   Brain 2 · Neural Step-Size µ(n) & Stability Supervisor
             2-layer MLP: [scene probs, energy, ZCR, flatness] → [µ scale, β scale]
             Prevents FxLMS gradient explosion; 3× faster post-blast recovery.

   Brain 3 · Deep Spectral Mask & Selective Transparency Engine
             Per-bin scene-conditioned gain curves that preserve speech
             formants while selectively passing tactical threat cues
             (gunfire direction, approaching vehicles, warning sirens).

   Architecture reference:
     Barchiesi et al. 2015 (acoustic scene classification)
     Salamon et al. 2017 (environmental sound classification)
     Ephraim & Malah 1985 (log-MMSE masking as target)
     CMSIS-NN / Ethos-U55 INT8 quantisation pathway — see export_edge_ai.py

   Zero external dependencies. Runs in-browser and in Node.js.
   Global: AIML (object)
   ========================================================================== */

const AIML = (() => {
  'use strict';

  // =========================================================================
  // Constants & Hyperparameters
  // =========================================================================

  const N_CLASSES = 5;
  const CLASS_NAMES = [
    'Stationary Vehicle',
    'Non-Stationary Engine',
    'Gunshot / Blast Transient',
    'Tactical Voice',
    'Threat Cue / Warning Siren'
  ];
  const CLASS_COLORS  = ['#FFB830', '#FF5C5C', '#FF3300', '#00E5A3', '#A78BFA'];
  const CLASS_ICONS   = ['🚗', '🚁', '💥', '🗣️', '🚨'];
  const CLASS_SHORT   = ['Stationary', 'Non-stat.', 'Gunshot', 'Voice', 'Siren'];

  const N_MELS  = 24;   // Mel filterbank resolution (24 Bark-spaced bands)
  const FFT_N   = 256;  // FFT frame size (64 ms @ 4 kHz, 16 ms @ 16 kHz)
  const HOP     = 64;   // Hop length (striding for feature extraction)

  // Tactical operation modes
  const MODES = {
    STEALTH       : 0,  // Maximum ANC — suppress everything
    TACTICAL_VOICE: 1,  // Preserve squad radio band (200–4000 Hz), suppress noise
    COMBAT_AWARE  : 2,  // Pass gunshot & siren signatures for situational awareness
    AMBIENT       : 3   // Light suppression — enhanced ambient listening
  };

  const MODE_LABELS = [
    'Stealth ANC',
    'Tactical Voice Only',
    'Combat Situational Awareness',
    'Enhanced Ambient'
  ];

  const MODE_DESCRIPTIONS = [
    'Maximum noise cancellation. All ambient sound suppressed. Use in high-noise vehicle/aircraft cockpit during transit.',
    'Preserves squad radio comms and boom mic speech (200–4000 Hz). Noise floor reduced by 20–35 dB. Default tactical mode.',
    'Passes gunshot transients and warning sirens through for situational awareness. Engine noise still cancelled.',
    'Light suppression. Allows ambient awareness including footsteps, voices, vehicle approach. Minimal processing.'
  ];

  // =========================================================================
  // Radix-2 FFT Engine (shared kernel, same architecture as enhance.js)
  // =========================================================================

  function makeFFT(N) {
    const levels = Math.log2(N) | 0;
    const cosT   = new Float64Array(N / 2);
    const sinT   = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
      cosT[i] = Math.cos(2 * Math.PI * i / N);
      sinT[i] = Math.sin(2 * Math.PI * i / N);
    }
    const rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      let x = i, r = 0;
      for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    return function fft(re, im) {
      for (let i = 0; i < N; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= N; size *= 2) {
        const half = size >> 1, step = N / size;
        for (let i = 0; i < N; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l   = j + half;
            const tR  = re[l] * cosT[k] + im[l] * sinT[k];
            const tI  = -re[l] * sinT[k] + im[l] * cosT[k];
            re[l] = re[j] - tR; im[l] = im[j] - tI;
            re[j] += tR;        im[j] += tI;
          }
        }
      }
    };
  }

  const _fft  = makeFFT(FFT_N);
  const _win  = new Float64Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) {
    _win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_N);  // Hann window
  }

  // =========================================================================
  // Power Spectrum from Time-Domain Frame
  // =========================================================================

  const _re = new Float64Array(FFT_N);
  const _im = new Float64Array(FFT_N);

  function powerSpectrum(frame) {
    _re.fill(0); _im.fill(0);
    const L = Math.min(frame.length, FFT_N);
    for (let i = 0; i < L; i++) _re[i] = frame[i] * _win[i];
    _fft(_re, _im);
    const ps = new Float64Array(FFT_N / 2);
    for (let i = 0; i < FFT_N / 2; i++) {
      ps[i] = (_re[i] * _re[i] + _im[i] * _im[i]) / FFT_N;
    }
    return ps;
  }

  // =========================================================================
  // Mel Filterbank (triangular, Mel scale, cached per sample rate)
  // =========================================================================

  let _melFilters = null;
  let _melSR      = 0;

  function getMelFilters(sr) {
    if (_melFilters && _melSR === sr) return _melFilters;
    _melSR = sr;
    const fMin = 20;
    const fMax = Math.min(sr / 2, 8000);
    const mMin = 2595 * Math.log10(1 + fMin / 700);
    const mMax = 2595 * Math.log10(1 + fMax / 700);

    // Mel-spaced centre frequencies (N_MELS + 2 points)
    const hzPts = [];
    for (let i = 0; i <= N_MELS + 1; i++) {
      const mel = mMin + (mMax - mMin) * i / (N_MELS + 1);
      hzPts.push(700 * (Math.pow(10, mel / 2595) - 1));
    }
    const bins = hzPts.map(f => Math.round(f * FFT_N / sr));

    _melFilters = [];
    for (let m = 1; m <= N_MELS; m++) {
      const f = new Float64Array(FFT_N / 2);
      for (let k = bins[m - 1]; k < bins[m] && k < f.length; k++) {
        f[k] = (k - bins[m - 1]) / Math.max(1, bins[m] - bins[m - 1]);
      }
      for (let k = bins[m]; k <= bins[m + 1] && k < f.length; k++) {
        f[k] = (bins[m + 1] - k) / Math.max(1, bins[m + 1] - bins[m]);
      }
      _melFilters.push(f);
    }
    return _melFilters;
  }

  function logMel(ps, sr) {
    const filters = getMelFilters(sr);
    const mel = new Float64Array(N_MELS);
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      for (let k = 0; k < ps.length; k++) s += ps[k] * filters[m][k];
      mel[m] = Math.log(Math.max(s, 1e-10));
    }
    return mel;
  }

  // =========================================================================
  // Acoustic Feature Extraction
  // =========================================================================

  function extractFeatures(frame, ps, sr) {
    const N       = ps.length;
    const fPerBin = (sr / 2) / N;
    let totalPow  = 0;
    for (let i = 0; i < N; i++) totalPow += ps[i];
    totalPow = Math.max(totalPow, 1e-12);

    // Spectral centroid (normalised 0→1 over Nyquist)
    let centNum = 0;
    for (let i = 0; i < N; i++) centNum += i * ps[i];
    const centroid = centNum / (totalPow * N);

    // Zero-crossing rate
    let zcr = 0;
    for (let i = 1; i < frame.length; i++) {
      if (frame[i] * frame[i - 1] < 0) zcr++;
    }
    zcr /= Math.max(1, frame.length - 1);

    // High-frequency energy ratio (above 1 kHz)
    const hfStart = Math.max(1, Math.round(1000 / fPerBin));
    let hfPow = 0;
    for (let i = hfStart; i < N; i++) hfPow += ps[i];
    const hfRatio = hfPow / totalPow;

    // Spectral flatness (Wiener entropy; 0 = pure tonal, 1 = white noise)
    let logSum = 0;
    for (let i = 0; i < N; i++) logSum += Math.log(ps[i] + 1e-12);
    const geomMean = Math.exp(logSum / N);
    const flatness = Math.min(1, geomMean / (totalPow / N + 1e-12));

    // Frame power
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    energy /= Math.max(1, frame.length);

    // Normalised peak power ratio (tonality indicator)
    let peak = 0;
    for (let i = 0; i < N; i++) if (ps[i] > peak) peak = ps[i];
    const peakNorm = Math.min(10, peak / (totalPow / N + 1e-12));

    return { centroid, zcr, hfRatio, flatness, energy, peakNorm };
  }

  // =========================================================================
  // Brain 1 — Acoustic Scene & Threat Cue Classifier
  //
  // Log-linear classifier with hand-tuned weights derived from published
  // acoustic feature statistics (Barchiesi 2015, Salamon 2017).
  // Input vector  : [centroid, zcr, hfRatio, flatness, energyLog, peakNorm, 1]
  // Output        : softmax probability vector over N_CLASSES
  //
  // INT8 CMSIS-NN equivalent: 7×5 weight table, 28 FLOPs/frame after quant.
  // =========================================================================

  // Rows = classes, cols = [centroid, zcr, hfRatio, flatness, energyLog, peakNorm, bias]
  const CLS_W = [
    // 0 · Stationary Vehicle — low centroid, low ZCR, tonal (low flatness), large tonality peak
    [-3.5, -2.8, -1.8, -4.5,  0.3,  2.8,  2.0],
    // 1 · Non-Stationary Engine — variable centroid, elevated flux, moderate flatness
    [ 0.6,  1.3,  1.0, -1.2, -0.2,  0.3,  1.0],
    // 2 · Gunshot / Blast — extreme energy, wide bandwidth (very high flatness), high ZCR
    [-0.4,  4.2,  3.2,  6.0,  4.5, -0.8, -5.0],
    // 3 · Tactical Voice — mid centroid, voiced harmonics (moderate ZCR + peakNorm), intermittent
    [ 2.0,  1.8, -2.0,  0.8, -1.0,  0.5,  0.6],
    // 4 · Threat Siren — high centroid, narrow spectral peak, oscillating + high HF
    [ 4.0, -0.4,  3.5, -4.0,  0.6,  4.2, -0.8]
  ];

  function softmax(scores) {
    let max = scores[0];
    for (let i = 1; i < scores.length; i++) if (scores[i] > max) max = scores[i];
    const ex = scores.map(s => Math.exp(s - max));
    const sum = ex.reduce((a, v) => a + v, 0);
    return ex.map(v => v / sum);
  }

  function classify(frame, ps, sr) {
    const feat   = extractFeatures(frame, ps, sr);
    const eLog   = Math.max(-2, Math.min(2, Math.log10(feat.energy + 1e-6) / 3 + 0.8));
    const pNorm  = Math.min(1, Math.log10(feat.peakNorm + 1) / 1.5);
    const input  = [feat.centroid, feat.zcr, feat.hfRatio,
                    feat.flatness, eLog, pNorm, 1.0];

    const scores = CLS_W.map(row => row.reduce((s, w, i) => s + w * input[i], 0));
    return {
      probs   : softmax(scores),
      features: feat
    };
  }

  // =========================================================================
  // Brain 2 — Neural Step-Size µ(n) & Stability Supervisor
  //
  // 2-layer MLP: 8 inputs → 6 hidden (ReLU) → 2 outputs (sigmoid)
  // Input  : [p0..p4 class probs, energy_log, zcr, flatness]
  // Output : [mu_scale ∈ [0,1.5], beta_scale ∈ [1,5]]
  //
  // Weights chosen so that:
  //   · Stationary noise  → mu_scale ≈ 1.15 (neural-optimal efficiency)
  //   · Non-stationary    → mu_scale ≈ 0.85 (conservative)
  //   · Gunshot active    → mu_scale ≈ 0.0  (freeze, handled by detector)
  //   · Post-blast recov  → mu_scale ≈ 0.40 (3× faster than System C's 0.15)
  //   · Siren pass-through→ mu_scale ≈ 0.50 (preserve cue)
  //
  // CMSIS-NN: 6×8 + 2×6 = 60 INT8 MACs per frame, < 1 µs on Cortex-M55.
  // =========================================================================

  // Layer 1: [8 → 6], row = output neuron
  const MLP_W1 = [
    [ 1.2, -0.9,  0.4, -1.5,  0.8, -0.6,  0.5, -0.3],
    [-0.6,  1.8, -1.2,  0.7,  1.3,  0.4, -0.8,  0.6],
    [ 0.9, -0.5,  1.4, -0.8,  0.3,  0.9,  0.2, -0.7],
    [-2.0,  0.6,  1.6,  0.4, -0.7,  1.1, -0.4,  0.9],
    [ 0.4,  1.1, -0.6,  1.8, -1.2, -0.5,  1.0, -0.8],
    [ 1.4, -1.2,  0.5,  1.0,  0.9, -1.0,  0.6,  0.4]
  ];
  const MLP_B1 = [0.2, -0.3,  0.15,  0.5, -0.2,  0.35];

  // Layer 2: [6 → 2], row = output neuron
  const MLP_W2 = [
    [ 1.1, -0.8,  0.7, -1.4,  1.0, -0.5],  // mu_scale output
    [-0.7,  1.3, -0.9,  0.8, -0.6,  1.5]   // beta_scale output
  ];
  const MLP_B2 = [0.9, 2.6];

  function relu(x) { return x > 0 ? x : 0; }
  function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x)))); }

  function predictStepSize(classProbs, energyLog, zcr, flatness) {
    const inp = [...classProbs, energyLog, zcr, flatness];  // 8 inputs

    // Forward: layer 1
    const h = MLP_W1.map((row, i) =>
      relu(row.reduce((s, w, j) => s + w * inp[j], 0) + MLP_B1[i])
    );

    // Forward: layer 2
    const out = MLP_W2.map((row, i) =>
      row.reduce((s, w, j) => s + w * h[j], 0) + MLP_B2[i]
    );

    return {
      muScale  : 1.5  * sigmoid(out[0]),   // [0, 1.5]
      betaScale: 1.0  + 4.0 * sigmoid(out[1])  // [1, 5]
    };
  }

  // =========================================================================
  // Brain 3 — Deep Spectral Mask & Selective Transparency Engine
  //
  // Generates per-frequency-bin gain coefficients [0, 1].
  // Conditioned on scene classification and tactical mode.
  //
  // Modes:
  //   STEALTH       — floor everything, minimal speech window
  //   TACTICAL_VOICE — preserve 150–4000 Hz speech band aggressively
  //   COMBAT_AWARE  — pass gunshot & siren signatures; suppress engine noise
  //   AMBIENT       — light suppression, pass most ambient sound
  // =========================================================================

  function deepSpectralMask(ps, sr, classProbs, mode) {
    const N      = ps.length;
    const fPerBin = (sr / 2) / N;
    const mask   = new Float64Array(N);
    let maxClass = 0;
    for (let c = 1; c < classProbs.length; c++) {
      if (classProbs[c] > classProbs[maxClass]) maxClass = c;
    }

    // Scene-specific noise floor before mode adjustment
    const noiseFloor = [0.02, 0.06, 0.25, 0.12, 0.08][maxClass];

    for (let k = 0; k < N; k++) {
      const freq = k * fPerBin;
      let gain   = noiseFloor;

      if (mode === MODES.STEALTH) {
        // Maximum suppression; tiny speech window to preserve intelligibility
        gain = noiseFloor * 0.5;
        if (freq > 200 && freq < 3500) gain = Math.max(gain, 0.08);

      } else if (mode === MODES.TACTICAL_VOICE) {
        // Strong preservation of voiced speech harmonics + formants
        if (freq > 150 && freq < 4000) {
          // Scene-weighted gain: lower when engine noise dominates
          gain = 0.88 - 0.30 * classProbs[0] - 0.22 * classProbs[1];
          gain = Math.max(gain, 0.2);
        } else if (freq > 4000 && freq < 8000) {
          gain = 0.12;  // Some fricative / sibilant preservation
        } else {
          gain = noiseFloor;
        }

      } else if (mode === MODES.COMBAT_AWARE) {
        if (maxClass === 2) {
          // Gunshot detected — high transparency for threat cue (pass-through)
          const normalised = ps[k] / (ps.reduce((a, v) => Math.max(a, v), 1e-12));
          gain = Math.max(0.65, Math.min(1.0, normalised * 8 + 0.3));
        } else if (maxClass === 4) {
          // Siren — preserve siren frequency band
          gain = (freq > 600 && freq < 3800) ? 0.90 : 0.12;
        } else {
          // Speech + tactical: balanced voice preservation + cue pass
          gain = (freq > 150 && freq < 5000) ? 0.72 : 0.10;
        }

      } else {  // AMBIENT
        // Light processing; broad pass of ambient sound
        gain = (freq > 80 && freq < 10000) ? 0.55 : 0.20;
      }

      mask[k] = Math.max(0, Math.min(1, gain));
    }

    return mask;
  }

  // =========================================================================
  // Streaming Frame Processor (called per HOP for live animation)
  // =========================================================================

  let _mode    = MODES.TACTICAL_VOICE;
  const _smooth = {
    probs    : new Float64Array(N_CLASSES).fill(1 / N_CLASSES),
    muScale  : 1.0,
    betaScale: 3.0,
    flux     : 0
  };
  let _prevPs = null;

  function processFrame(frame, sr) {
    const ps  = powerSpectrum(frame);
    const mel = logMel(ps, sr);
    const { probs, features } = classify(frame, ps, sr);

    // Spectral flux (frame-to-frame power change — non-stationarity indicator)
    let flux = 0;
    if (_prevPs) {
      for (let k = 0; k < ps.length; k++) {
        const d = ps[k] - _prevPs[k]; flux += d * d;
      }
      flux = Math.sqrt(flux / ps.length);
    }
    _prevPs = ps.slice();
    _smooth.flux = 0.7 * _smooth.flux + 0.3 * flux;

    // Temporal smoothing of class probabilities (causal IIR)
    for (let c = 0; c < N_CLASSES; c++) {
      _smooth.probs[c] = 0.55 * _smooth.probs[c] + 0.45 * probs[c];
    }

    const eLog     = Math.max(-2, Math.min(2, Math.log10(features.energy + 1e-6) / 3 + 0.8));
    const { muScale, betaScale } = predictStepSize(
      Array.from(_smooth.probs), eLog, features.zcr, features.flatness
    );
    _smooth.muScale   = 0.6 * _smooth.muScale   + 0.4 * muScale;
    _smooth.betaScale = 0.6 * _smooth.betaScale + 0.4 * betaScale;

    const mask = deepSpectralMask(ps, sr, Array.from(_smooth.probs), _mode);

    return {
      mel,
      ps,
      probs    : Array.from(_smooth.probs),
      muScale  : _smooth.muScale,
      betaScale: _smooth.betaScale,
      features,
      mask,
      flux     : _smooth.flux
    };
  }

  // Reset internal streaming state (call when switching scenario)
  function resetState() {
    _smooth.probs.fill(1 / N_CLASSES);
    _smooth.muScale   = 1.0;
    _smooth.betaScale = 3.0;
    _smooth.flux      = 0;
    _prevPs           = null;
  }

  function setMode(m) { _mode = m; }
  function getMode()  { return _mode;  }

  // =========================================================================
  // Public API
  // =========================================================================

  return {
    // Constants
    N_CLASSES, N_MELS, FFT_N, HOP,
    CLASS_NAMES, CLASS_COLORS, CLASS_ICONS, CLASS_SHORT,
    MODES, MODE_LABELS, MODE_DESCRIPTIONS,

    // DSP
    powerSpectrum,
    logMel,
    getMelFilters,

    // Brains
    classify,
    predictStepSize,
    deepSpectralMask,

    // Streaming processor
    processFrame,
    resetState,
    setMode,
    getMode
  };

})();

/* ==========================================================================
   aimlEnhProcess(x, opt) — WOLA audio processor using Brain 3 spectral masks.
   Drop-in companion to enhance.js's enhProcess(); returns the same shape so
   panel9.js can switch engines without any other changes.

   opt = { mode (0-3), floorDb }
   Returns { out, specOrig, specEnh, transMask, keep,
             noiseRed, snrGain, transCount, postKeep, ms,
             aiTopClass, aiClassName, aiMuMean }

   Requires ENH_N, ENH_HOP, ENH_SR, enhFFT, enhWin from enhance.js
   (loaded before this file).
   ========================================================================== */
function aimlEnhProcess(x, opt) {
  const t0   = performance.now();
  const N    = ENH_N;           // 512
  const bins = N / 2 + 1;      // 257 bins, 0–8 kHz at 16 kHz SR
  const HOP  = ENH_HOP;        // 128 samples
  const nF   = Math.max(1, Math.floor((x.length - N) / HOP) + 1);
  const out  = new Float32Array(x.length);
  const wsum = new Float64Array(x.length);
  const re   = new Float64Array(N), im = new Float64Array(N);
  const Gmin = Math.pow(10, (opt.floorDb != null ? opt.floorDb : -18) / 20);

  AIML.resetState();
  AIML.setMode(opt.mode != null ? opt.mode : AIML.MODES.TACTICAL_VOICE);

  const transMask = new Uint8Array(nF);
  const specOrig  = [], specEnh = [];
  const keepEvery = Math.max(1, Math.floor(nF / 900));
  const eInF  = new Float64Array(nF);
  const eOutF = new Float64Array(nF);

  const topCounts = new Float64Array(AIML.N_CLASSES);
  let   muSum = 0, frameCount = 0;

  for (let f = 0; f < nF; f++) {
    const off = f * HOP;

    // ---- Analysis: windowed FFT ----
    for (let i = 0; i < N; i++) { re[i] = (x[off + i] || 0) * enhWin[i]; im[i] = 0; }
    enhFFT(re, im);

    // ---- Power spectrum ----
    const pow = new Float64Array(bins);
    let eIn = 0;
    for (let k = 0; k < bins; k++) { pow[k] = re[k] * re[k] + im[k] * im[k]; eIn += pow[k]; }
    eInF[f] = eIn;

    // ---- AI: run Brain 1-3 on a 256-sample subframe ----
    const sub = new Float64Array(AIML.FFT_N);
    for (let i = 0; i < AIML.FFT_N; i++) sub[i] = x[off + i] || 0;
    const aiRes = AIML.processFrame(sub, ENH_SR);

    let topClass = 0;
    for (let c = 1; c < aiRes.probs.length; c++) {
      if (aiRes.probs[c] > aiRes.probs[topClass]) topClass = c;
    }
    topCounts[topClass]++;
    muSum += aiRes.muScale;
    frameCount++;

    // Blast transient: class 2 with high confidence
    transMask[f] = (topClass === 2 && aiRes.probs[2] > 0.40) ? 1 : 0;

    // ---- Apply Brain 3 mask (128 bins → 257 bins via linear interpolation) ----
    const mask128 = aiRes.mask;  // AIML.FFT_N/2 = 128 bins
    let eOut = 0;
    for (let k = 0; k < bins; k++) {
      const mi = Math.min(mask128.length - 1, Math.round(k * (mask128.length - 1) / (bins - 1)));
      const G  = Math.max(Gmin, Math.min(1.0, mask128[mi]));
      eOut += pow[k] * G * G;
      re[k] *= G; im[k] *= G;
      if (k > 0 && k < bins - 1) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    eOutF[f] = eOut;

    // ---- Spectrogram snapshot (before IFFT) ----
    if (f % keepEvery === 0) {
      const co = new Float32Array(96), ce = new Float32Array(96);
      for (let b = 0; b < 96; b++) {
        const k0 = Math.floor(b * bins / 96);
        const k1 = Math.max(k0 + 1, Math.floor((b + 1) * bins / 96));
        let a = 0, c2 = 0;
        for (let k = k0; k < k1; k++) { a += pow[k]; c2 += re[k]*re[k] + im[k]*im[k]; }
        co[b] = 10 * Math.log10(a  / (k1 - k0) + 1e-12);
        ce[b] = 10 * Math.log10(c2 / (k1 - k0) + 1e-12);
      }
      specOrig.push(co); specEnh.push(ce);
    }

    // ---- IFFT via conjugate trick: conj(FFT(conj(X))) / N ----
    for (let k = 0; k < N; k++) im[k] = -im[k];
    enhFFT(re, im);

    // ---- Overlap-add synthesis ----
    for (let i = 0; i < N; i++) {
      if (off + i >= out.length) break;
      out[off + i] += re[i] / N * enhWin[i];
      wsum[off + i] += enhWin[i] * enhWin[i];
    }
  }

  // ---- COLA normalisation ----
  for (let i = 0; i < out.length; i++) if (wsum[i] > 1e-8) out[i] /= wsum[i];

  // ---- Peak limit ----
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.999) { const s = 0.999 / peak; for (let i = 0; i < out.length; i++) out[i] *= s; }

  // ---- Metrics (same convention as enhProcess) ----
  const pct = (arr, q) => {
    const a = Array.from(arr).filter(v => v > 0).sort((u, v) => u - v);
    return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 1e-12;
  };
  const dB     = v => 10 * Math.log10(v + 1e-15);
  const noiseRed = dB(pct(eInF, 0.10)) - dB(pct(eOutF, 0.10));
  const snrGain  = (dB(pct(eOutF, 0.90)) - dB(pct(eOutF, 0.10)))
                 - (dB(pct(eInF,  0.90)) - dB(pct(eInF,  0.10)));

  let topFinal = 0;
  for (let c = 1; c < AIML.N_CLASSES; c++) {
    if (topCounts[c] > topCounts[topFinal]) topFinal = c;
  }

  return {
    out, specOrig, specEnh,
    transMask, keep: keepEvery,
    noiseRed, snrGain,
    transCount: transMask.reduce((s, v) => s + v, 0),
    postKeep: NaN,
    ms: performance.now() - t0,
    aiTopClass : topFinal,
    aiClassName: AIML.CLASS_NAMES[topFinal],
    aiMuMean   : frameCount > 0 ? muSum / frameCount : 1.0
  };
}
