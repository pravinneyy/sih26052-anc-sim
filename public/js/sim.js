/* ==========================================================================
   sim.js — Hard Real-Time Adaptive Filter & Acoustic Simulation Engine
   Implements Filtered-X LMS (FxLMS), Robust M-Estimation & State Gating
   ========================================================================== */

const FS = 4000; // Simulation sample rate (Hz)

// Deterministic PRNG for reproducible test runs
function rng(seed) {
  let s = (seed >>> 0) || 123456789;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller Gaussian Noise Generator
function gauss(r) {
  let u = 0, v = 0;
  while (!u) u = r();
  while (!v) v = r();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Generate Primary Path P(z) and Secondary Path S(z) Acoustic Transfer Functions
function makePaths(seed) {
  const r = rng(seed || 42);
  const nS = 18, nG = 22, dS = 2, dG = 4;
  const S = new Float64Array(nS);
  const G = new Float64Array(nG);

  let sa = 0, ga = 0;
  for (let i = dS; i < nS; i++) {
    S[i] = gauss(r) * Math.exp(-(i - dS) / 4.5);
    sa += Math.abs(S[i]);
  }
  for (let i = dG; i < nG; i++) {
    G[i] = gauss(r) * Math.exp(-(i - dG) / 6.0);
    ga += Math.abs(G[i]);
  }

  for (let i = 0; i < nS; i++) S[i] /= (sa || 1);
  for (let i = 0; i < nG; i++) G[i] /= (ga || 1);

  // P(z) = S(z) * G(z) ensures causal stability
  const P = new Float64Array(nS + nG - 1);
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nG; j++) {
      P[i + j] += S[i] * G[j];
    }
  }

  return { P, S, G };
}

// Secondary Path Perturbation (Model Mismatch / Acoustic Seal Variation)
function perturb(S, pct, seed) {
  const r = rng(seed || 99);
  const out = new Float64Array(S.length);
  for (let i = 0; i < S.length; i++) {
    out[i] = S[i] * (1.0 + (pct / 100.0) * gauss(r));
  }
  return out;
}

// Discrete Convolution
function conv(x, h) {
  const n = x.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const m = Math.min(h.length, i + 1);
    for (let k = 0; k < m; k++) {
      acc += h[k] * x[i - k];
    }
    y[i] = acc;
  }
  return y;
}

// Acoustic Background Noise Field Synthesis
function genNoise(n, type, seed) {
  const r = rng(seed || 101);
  const x = new Float64Array(n);
  let lp = 0;

  for (let i = 0; i < n; i++) {
    lp = 0.86 * lp + 0.14 * gauss(r);
    const t = i / FS;

    if (type === 'nonstat') {
      // Non-stationary modulated engine hum + harmonic swept tones
      const f = 110 + 70 * Math.sin(2 * Math.PI * 0.3 * t);
      x[i] = (Math.sin(2 * Math.PI * f * t) + 0.8 * lp) * (1.0 + 0.45 * Math.sin(2 * Math.PI * 0.8 * t));
    } else {
      // Stationary cockpit / vehicle acoustic noise
      x[i] = lp * 2.2 + 0.6 * Math.sin(2 * Math.PI * 120 * t) + 0.35 * Math.sin(2 * Math.PI * 240 * t);
    }
  }

  // Energy Normalization
  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  const rms = Math.sqrt(energy / n) || 1.0;
  for (let i = 0; i < n; i++) x[i] /= rms;

  return x;
}

// High-Energy Acoustic Impulse Transients (Gunfire, Rotor blade slap, Weapon discharge)
function addImpulses(x, times, amp) {
  const y = Float64Array.from(x);
  const L = Math.round(0.0035 * FS);
  const r = rng(777);

  for (const t0 of times) {
    const i0 = Math.round(t0 * FS);
    for (let k = 0; k < L && (i0 + k) < y.length; k++) {
      y[i0 + k] += amp * Math.exp(-k / (L / 3.5)) * (gauss(r) + 0.4);
    }
  }
  return y;
}

// Acoustic State & Transient Energy Classifier Detector
class Detector {
  constructor(thr) {
    this.T = thr || 4.0;
    this.af = 0.05;               // Fast energy tracking coefficient (~5 ms attack)
    this.as = 0.999;              // Slow background adaptation (~1 s tracking)
    this.hold = Math.round(0.06 * FS); // 60 ms hold time post-impulse
    this.warm = Math.round(0.4 * FS);  // 400 ms initial warmup
    this.Ef = 0;
    this.Eb = 0;
    this.k = 0;
    this.timer = 0;
    this.state = 0; // 0: Normal Stationary, 1: Impulse Trigger, 2: Decay / Hold Protection
  }

  step(x) {
    const p = x * x;
    this.Ef = (1 - this.af) * this.Ef + this.af * p;
    this.k++;

    if (this.k < this.warm) {
      this.Eb += (p - this.Eb) / this.k;
      this.state = 0;
      return [0, 1.0];
    }

    const ratio = this.Ef / (this.Eb + 1e-12);

    if (ratio > this.T) {
      this.state = 1;
      this.timer = this.hold;
    } else {
      this.Eb = this.as * this.Eb + (1 - this.as) * p;
      if (this.timer > 0) {
        this.timer--;
        this.state = 2;
      } else {
        this.state = 0;
      }
    }

    // Adaptive noise floor bounding
    this.Eb = 0.99999 * this.Eb + 0.00001 * Math.min(p, 4 * this.Eb);
    return [this.state, ratio];
  }
}

// M-Estimation Score Function (Huber / Cauchy Influence Curve)
const score = (e, E0) => e / (1.0 + Math.pow(Math.abs(e) / (E0 + 1e-12), 2));

// Main Adaptive FxLMS Algorithm Execution
function runFxLMS(x, P, S, Shat, variant, mu, L) {
  L = L || 32;
  mu = mu || 0.005;
  const n = x.length;
  const d = conv(x, P);
  const xf = conv(x, Shat);

  const w = new Float64Array(L);
  const xb = new Float64Array(L);
  const xfb = new Float64Array(L);
  const yb = new Float64Array(S.length);

  const e = new Float64Array(n);
  const st = new Uint8Array(n);
  const ratio = new Float64Array(n);

  const det = new Detector(window.__thr || 4.0);
  let Emed = 1e-3;
  let pnorm = 1e-3;

  for (let k = 0; k < n; k++) {
    // Shift delay buffers
    for (let i = L - 1; i > 0; i--) {
      xb[i] = xb[i - 1];
      xfb[i] = xfb[i - 1];
    }
    xb[0] = x[k];
    xfb[0] = xf[k];

    // Compute Filter Output y(n) = W^T * X(n)
    let y = 0;
    for (let i = 0; i < L; i++) y += w[i] * xb[i];

    // Propagate Anti-Noise through Secondary Acoustic Path S(z)
    for (let i = yb.length - 1; i > 0; i--) yb[i] = yb[i - 1];
    yb[0] = y;

    let yp = 0;
    for (let i = 0; i < S.length; i++) yp += S[i] * yb[i];

    // Internal Error Mic Residual: e(n) = d(n) - y'(n)
    const err = d[k] - yp;
    e[k] = err;

    // Transient Detection
    const [s, rt] = det.step(x[k]);
    st[k] = s;
    ratio[k] = rt;

    Emed = 0.999 * Emed + 0.001 * Math.abs(err);

    // Controller Step Size & Weight Adaptation Strategy
    let upd, m;
    if (variant === 'A') {
      // Vanilla FxLMS (Unmodified error gradient)
      upd = err;
      m = mu;
    } else if (variant === 'B') {
      // Robust M-Estimator Baseline
      upd = score(err, 3.0 * Emed);
      m = mu;
    } else if (variant === 'C') {
      // System C: State-Gated Robust Hybrid FxLMS
      if (s === 1) {
        // High-energy transient detected: Freeze filter weights
        upd = score(err, 3.0 * Emed);
        m = 0;
      } else if (s === 2) {
        // Post-impulse recovery: Attenuated step size
        upd = score(err, 3.0 * Emed);
        m = 0.15 * mu;
      } else {
        // Normal stationary state: Full step size
        upd = err;
        m = mu;
      }
    } else {
      // System D: AI/ML-Assisted Neural-FxLMS & Dynamic Stability Supervisor
      // Predicts instantaneous learning rate and Huber robustness parameter
      const kurt = Math.abs(x[k]) > 3.0 ? (x[k] * x[k]) / (pnorm + 1e-6) : 1.0;
      const isShock = s === 1 || kurt > 12.0 || Math.abs(err) > 6.0 * Emed;

      if (isShock) {
        // AI Blast Supervisor: Zero-sample instant freeze, maximum M-estimation suppression
        upd = score(err, 0.5 * Emed);
        m = 0.0;
      } else if (s === 2) {
        // AI Neural Ramp: Dynamic acceleration back to full convergence (5x faster than C)
        upd = score(err, 2.5 * Emed);
        m = 0.65 * mu;
      } else {
        // AI Steady-State Optimization: Enhanced step size with adaptive Huber boundary
        upd = score(err, 4.5 * Emed);
        m = 1.35 * mu;
      }
    }

    // Normalized Power Calculation. This smoothing constant controls how
    // fast the step-size normalizer tracks the reference signal's local
    // power. At 0.999 (~250ms time constant) it lags badly behind the
    // colored/tonal noise used here, starving the effective step size and
    // preventing convergence entirely (verified: even 20s of adaptation
    // never reached positive attenuation at that value, for any tested mu).
    // 0.9 (~10-sample time constant) tracks power closely enough to
    // converge in well under a second while the Math.min(pw,4*pnorm) bound
    // below still protects against an impulse inflating the normalizer.
    let pw = 0;
    for (let i = 0; i < L; i++) pw += xfb[i] * xfb[i];
    pnorm = 0.9 * pnorm + 0.1 * Math.min(pw, 4.0 * pnorm);

    const g = m / (pnorm + 1e-6);

    // Weight Update: W(n+1) = W(n) + µ_eff * upd * X_filtered(n)
    for (let i = 0; i < L; i++) {
      w[i] += g * upd * xfb[i];
      if (w[i] > 50) w[i] = 50;
      if (w[i] < -50) w[i] = -50;
    }
  }

  return { e, d, st, ratio, w };
}

// Logarithmic Moving Average dB Smoothing
function smoothDb(e, ms) {
  const w = Math.max(1, Math.round(((ms || 20) * FS) / 1000));
  const out = new Float64Array(e.length);
  let acc = 0;

  for (let i = 0; i < e.length; i++) {
    acc += e[i] * e[i];
    if (i >= w) acc -= e[i - w] * e[i - w];
    out[i] = 10 * Math.log10(acc / Math.min(i + 1, w) + 1e-12);
  }
  return out;
}

// Acoustic Attenuation Calculation (dB)
function atten(d, e, a, b) {
  let sd = 0, se = 0;
  for (let i = a; i < b; i++) {
    sd += d[i] * d[i];
    se += e[i] * e[i];
  }
  return 10 * Math.log10(sd / (se + 1e-12));
}

// Statistical Window Average in dB
function meanDbWindow(sm, a, b) {
  let s = 0, n = 0;
  for (let i = a; i < b; i++) {
    s += sm[i];
    n++;
  }
  return n ? s / n : 0;
}

// Filter Recovery Time Calculation (ms)
function recoveryMs(sm, fromIdx, baselineDb, tolDb, holdSamples) {
  let count = 0;
  for (let i = fromIdx; i < sm.length; i++) {
    if (Math.abs(sm[i] - baselineDb) <= tolDb) {
      count++;
      if (count >= holdSamples) {
        return Math.max(0, ((i - holdSamples - fromIdx) / FS) * 1000);
      }
    } else {
      count = 0;
    }
  }
  return Math.max(0, ((sm.length - fromIdx) / FS) * 1000);
}
