/* ==========================================================================
   enhance.js — real-time speech enhancement engine, shared by panel 8 (a
   fixed demo clip) and panel 9 (the judge's own recorded/uploaded audio).

   This is a published, classical spectral-enhancement pipeline, not a
   trained model:
     - noise PSD tracking: Cohen & Berdugo (2002), minima-controlled
       recursive averaging; Martin (2001), minimum statistics
     - gain rule: Ephraim & Malah (1984/1985), decision-directed a priori
       SNR + log-spectral-amplitude MMSE estimator
     - transient handling: an energy-ratio + spectral-flux detector (the
       same shape as sim.js's Detector) freezes the noise estimate during
       a transient, then optionally attenuates the impulse on the output —
       two separate knobs, because "don't let the impulse corrupt the noise
       floor" and "suppress the impulse itself" are different jobs.

   Everything here operates on mono audio resampled to ENH_SR — matches the
   architecture panel's own "16 kHz enhancement lane" framing, and keeps the
   algorithm's time constants meaningful regardless of the input file's
   native sample rate.
   ========================================================================== */

const ENH_N = 512;      // FFT size
const ENH_HOP = 128;    // 8 ms hop at 16 kHz, 75% overlap
const ENH_SR = 16000;

/* ---------- iterative radix-2 FFT, shared by every enhProcess() call ---------- */
function enhMakeFFT(N) {
  const levels = Math.log2(N) | 0;
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = Math.sin(2 * Math.PI * i / N); }
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let x = i, r = 0;
    for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  return function (re, im) {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= N; size *= 2) {
      const half = size / 2, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

/* Exponential integral E1, Abramowitz & Stegun 5.1.53 / 5.1.56 — needed for
   the log-MMSE gain's closed form. */
function enhExpint(x) {
  if (x <= 0) return 0;
  if (x <= 1) {
    return -Math.log(x) - 0.57721566 + x * (0.99999193 + x * (-0.24991055 +
      x * (0.05519968 + x * (-0.00976004 + x * 0.00107857))));
  }
  const num = x * x + 2.334733 * x + 0.250621, den = x * x + 3.330657 * x + 1.681534;
  return Math.exp(-x) / x * (num / den);
}

const enhFFT = enhMakeFFT(ENH_N);
const enhWin = new Float64Array(ENH_N);
for (let i = 0; i < ENH_N; i++) enhWin[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / ENH_N));

/* opt = { floorDb, adapt (0/1/2 = slow/medium/fast), tsens, transAware, attenImpulse } */
function enhProcess(x, opt) {
  const t0 = performance.now();
  const bins = ENH_N / 2 + 1;
  const nFrames = Math.max(1, Math.floor((x.length - ENH_N) / ENH_HOP) + 1);
  const out = new Float32Array(x.length);
  const wsum = new Float64Array(x.length);

  const re = new Float64Array(ENH_N), im = new Float64Array(ENH_N);
  const noise = new Float64Array(bins).fill(1e-6);
  const S = new Float64Array(bins);
  const Smin = new Float64Array(bins).fill(1e9);
  const Stmp = new Float64Array(bins).fill(1e9);
  const p = new Float64Array(bins);
  const Gprev = new Float64Array(bins).fill(1);
  const Yprev = new Float64Array(bins);
  const magPrev = new Float64Array(bins);

  const ALPHA_DD = 0.98;
  const AS = 0.8, AP = 0.2, AD = 0.85, DELTA = 5;
  const SUBWIN = [80, 48, 24][opt.adapt];
  const Gmin = Math.pow(10, opt.floorDb / 20);

  let Eb = 0, warm = Math.round(0.35 * ENH_SR / ENH_HOP), fi = 0, transHold = 0, transCount = 0;
  const onsets = [];
  const transMask = new Uint8Array(nFrames);
  let extra = 1;

  const specOrig = [], specEnh = [];
  const keep = Math.max(1, Math.floor(nFrames / 900));

  /* Frame energies in/out, used for the percentile-based metrics below
     rather than speech/noise labels — the labels themselves shift when
     transient handling changes, which pointed the readouts the wrong way
     during testing. */
  const eInF = new Float64Array(nFrames), eOutF = new Float64Array(nFrames);

  for (let f = 0; f < nFrames; f++) {
    const off = f * ENH_HOP;
    for (let i = 0; i < ENH_N; i++) { re[i] = (x[off + i] || 0) * enhWin[i]; im[i] = 0; }
    enhFFT(re, im);

    let E = 0, flux = 0;
    const mag = new Float64Array(bins), pow = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const pw = re[k] * re[k] + im[k] * im[k];
      pow[k] = pw; mag[k] = Math.sqrt(pw); E += pw;
      const d = mag[k] - magPrev[k]; if (d > 0) flux += d;
    }
    fi++;
    let detected = false;
    if (fi < warm) { Eb += (E - Eb) / fi; }
    else {
      const ratio = E / (Eb + 1e-12);
      const fluxNorm = flux / (Math.sqrt(Eb) * bins * 0.02 + 1e-9);
      const fired = ratio > opt.tsens && fluxNorm > 1;
      if (fired) {
        if (transHold === 0) { transCount++; onsets.push(f); }
        detected = true; transHold = Math.round(0.05 * ENH_SR / ENH_HOP);
      } else if (transHold > 0) { transHold--; detected = true; }
      else { Eb = 0.995 * Eb + 0.005 * E; }
      Eb = 0.9999 * Eb + 0.0001 * Math.min(E, 4 * Eb);
    }
    transMask[f] = detected ? 1 : 0;
    const isTrans = detected && opt.transAware;

    /* noise estimate (MCRA), frozen during a detected transient */
    for (let k = 0; k < bins; k++) {
      S[k] = AS * S[k] + (1 - AS) * pow[k];
      if (Stmp[k] > S[k]) Stmp[k] = S[k];
      if (Smin[k] > S[k]) Smin[k] = S[k];
    }
    if (f % SUBWIN === 0) {
      for (let k = 0; k < bins; k++) { Smin[k] = Math.min(Stmp[k], S[k]); Stmp[k] = S[k]; }
    }
    if (!isTrans) {
      for (let k = 0; k < bins; k++) {
        const I = (S[k] / (Smin[k] + 1e-12)) > DELTA ? 1 : 0;
        p[k] = AP * p[k] + (1 - AP) * I;
        const ad = AD + (1 - AD) * p[k];
        noise[k] = ad * noise[k] + (1 - ad) * pow[k];
      }
    }

    /* gain: decision-directed a priori SNR + log-MMSE */
    let eIn = 0, eOut = 0;
    for (let k = 0; k < bins; k++) {
      const lam = noise[k] + 1e-12;
      const gamma = Math.min(pow[k] / lam, 1e6);
      let xi = ALPHA_DD * (Gprev[k] * Gprev[k] * Yprev[k] / lam) + (1 - ALPHA_DD) * Math.max(gamma - 1, 0);
      xi = Math.max(xi, 1e-4);
      const v = xi / (1 + xi) * gamma;
      let G = xi / (1 + xi) * Math.exp(0.5 * enhExpint(v));
      if (!isFinite(G)) G = Gmin;
      G = Math.min(1, Math.max(Gmin, G));
      Gprev[k] = G; Yprev[k] = pow[k];
      const g2 = G * G;
      eIn += pow[k]; eOut += pow[k] * g2;
      re[k] *= G; im[k] *= G;
      if (k > 0 && k < bins - 1) { re[ENH_N - k] = re[k]; im[ENH_N - k] = -im[k]; }
    }

    /* impulse attenuation on the outgoing path — a separate concern from
       freezing the noise estimate, keyed off detection either way */
    let target = 1;
    if (opt.attenImpulse && detected) target = Gmin;
    extra = target < extra ? 0.5 * extra + 0.5 * target : 0.92 * extra + 0.08 * target;
    if (opt.attenImpulse) {
      for (let k = 0; k < ENH_N; k++) { re[k] *= extra; im[k] *= extra; }
      eOut *= extra * extra;
    }

    if (f % keep === 0) {
      const co = new Float32Array(96), ce = new Float32Array(96);
      for (let b = 0; b < 96; b++) {
        const k0 = Math.floor(b * bins / 96), k1 = Math.max(k0 + 1, Math.floor((b + 1) * bins / 96));
        let a = 0, c = 0;
        for (let k = k0; k < k1; k++) { a += pow[k]; c += re[k] * re[k] + im[k] * im[k]; }
        co[b] = 10 * Math.log10(a / (k1 - k0) + 1e-12);
        ce[b] = 10 * Math.log10(c / (k1 - k0) + 1e-12);
      }
      specOrig.push(co); specEnh.push(ce);
    }

    eInF[f] = eIn; eOutF[f] = eOut;

    for (let k = 0; k < ENH_N; k++) im[k] = -im[k];
    enhFFT(re, im);
    for (let i = 0; i < ENH_N; i++) {
      const v = re[i] / ENH_N * enhWin[i];
      if (off + i < out.length) { out[off + i] += v; wsum[off + i] += enhWin[i] * enhWin[i]; }
    }
    magPrev.set(mag);
  }

  for (let i = 0; i < out.length; i++) if (wsum[i] > 1e-8) out[i] /= wsum[i];

  let peak = 0; for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.999) { const s = 0.999 / peak; for (let i = 0; i < out.length; i++) out[i] *= s; }

  const pct = (arr, q) => {
    const a = Array.from(arr).filter(v => v > 0).sort((x, y) => x - y);
    return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 1e-12;
  };
  const dB = v => 10 * Math.log10(v + 1e-15);
  const inFloor = dB(pct(eInF, 0.10)), inPeak = dB(pct(eInF, 0.90));
  const outFloor = dB(pct(eOutF, 0.10)), outPeak = dB(pct(eOutF, 0.90));
  const noiseRed = inFloor - outFloor;
  const snrGain = (outPeak - outFloor) - (inPeak - inFloor);

  /* The metric that shows the actual differentiator: how much signal
     survives 100-600 ms after each detected impulse. If the noise
     estimate got poisoned by the impulse, this window is over-suppressed
     and the words right after a gunshot get eaten. */
  let pIn = 0, pOut = 0;
  for (const f0 of onsets) {
    const a = f0 + Math.round(0.10 * ENH_SR / ENH_HOP), b2 = f0 + Math.round(0.60 * ENH_SR / ENH_HOP);
    for (let f = a; f < Math.min(b2, nFrames); f++) { pIn += eInF[f]; pOut += eOutF[f]; }
  }
  const postKeep = onsets.length ? 10 * Math.log10((pOut + 1e-15) / (pIn + 1e-15)) : NaN;

  return {
    out, specOrig, specEnh, transMask, keep,
    noiseRed, snrGain, transCount, postKeep, ms: performance.now() - t0
  };
}

/* ---------- synthetic demo clip: speech-like formants + selectable noise
   condition, shared by panel 8's fixed preview and panel 9's "Built-in
   clip" option. Reuses sim.js's own rng()/gauss() rather than duplicating
   a second PRNG. ---------- */
function enhMakeDemo(kind, seed) {
  const dur = 6, n = dur * ENH_SR, x = new Float32Array(n), r = rng(seed || 21);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / ENH_SR;
    const syll = Math.max(0, Math.sin(2 * Math.PI * 2.6 * t)) ** 1.5;
    const f0 = 115 + 18 * Math.sin(2 * Math.PI * 1.3 * t);
    let s = 0;
    for (let h = 1; h <= 14; h++) {
      const f = f0 * h;
      const env = Math.exp(-Math.pow((f - 620) / 420, 2)) + 0.7 * Math.exp(-Math.pow((f - 1700) / 620, 2));
      s += env * Math.sin(2 * Math.PI * f * t + h);
    }
    x[i] = 0.32 * syll * s / 4;
  }
  for (let i = 0; i < n; i++) {
    const t = i / ENH_SR;
    lp = 0.93 * lp + 0.07 * gauss(r);
    lp2 = 0.75 * lp2 + 0.25 * gauss(r);
    let nse = 0;
    if (kind === 'stat' || kind === 'all') {
      nse += 0.9 * lp + 0.22 * Math.sin(2 * Math.PI * 105 * t) + 0.14 * Math.sin(2 * Math.PI * 210 * t) + 0.05 * lp2;
    }
    if (kind === 'nonstat' || kind === 'all') {
      const f = 95 + 55 * Math.sin(2 * Math.PI * 0.22 * t);
      nse += (0.55 * Math.sin(2 * Math.PI * f * t) + 0.7 * lp) * (1 + 0.55 * Math.sin(2 * Math.PI * 0.6 * t));
    }
    x[i] += 0.34 * nse;
  }
  if (kind === 'imp' || kind === 'all') {
    if (kind === 'imp') { for (let i = 0; i < n; i++) { lp = 0.93 * lp + 0.07 * gauss(r); x[i] += 0.12 * lp; } }
    for (const t0 of [1.4, 2.9, 4.3, 5.2]) {
      const i0 = Math.round(t0 * ENH_SR), L = Math.round(0.012 * ENH_SR);
      for (let k = 0; k < L && i0 + k < n; k++) x[i0 + k] += 2.6 * Math.exp(-k / (L / 5)) * gauss(r);
    }
  }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
  for (let i = 0; i < n; i++) x[i] = x[i] / pk * 0.92;
  return x;
}
