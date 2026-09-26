/* ==========================================================================
   rt_engine.js — live streaming noise-suppression engine for panel 9.

   Mic (or a file/demo clip played through the same graph) -> STFT framing
   -> per-frame suppression gain -> inverse STFT -> speakers, processed in
   64 ms chunks with the output a couple of chunks behind the input.

   Each frame's gain comes from two estimators fused together:

     1. The trained SIH26052 CRN/GRU model (models/crn_gru_voice_mask.pt,
        exported by sih_python/export_streaming_onnx.py), run through ONNX
        Runtime Web with its GRU hidden state and a short causal-conv
        context window carried across calls. It supplies a per-bin mask,
        a voice-activity logit, an impulse logit and a noise-class head.
     2. A classical, microphone-agnostic suppressor (RTSuppressor below):
        MCRA noise tracking (Cohen & Berdugo 2002) + OM-LSA gain with
        speech-presence probability (Cohen 2003). It adapts to whatever
        noise the actual microphone hears, which the model — trained on a
        synthetic corpus — can't be relied on to do alone.

   On top of the per-bin gain, a frame-level voice gate closes between
   words (the noise the listener notices most), an impulse gate ducks
   gunshot-like transients, and everything below 90 Hz is cut.

   Streaming notes (how the batch pipeline became a stateful one):
     - STFT: a rolling N-sample history, right-aligned each hop — same
       alignment as torch.stft(center=True) up to a fixed ~24 ms delay.
     - GRU hidden state: explicit input/output on the streaming ONNX graph,
       persisted across chunks here.
     - Causal conv receptive field (6 frames): the last CONTEXT_FRAMES
       frames of log-magnitude are re-fed each call and the matching
       leading output frames dropped.

   Depends on ENH_N/ENH_HOP/ENH_SR/enhFFT/enhExpint (enhance.js, loaded
   first) and the onnxruntime-web UMD build (window.ort).
   Global: RTEngine (object)
   ========================================================================== */

const RTEngine = (() => {
  'use strict';

  const RT_N = ENH_N;             // 512 — same FFT size as the model was trained with
  const RT_HOP = ENH_HOP;         // 128
  const RT_BINS = RT_N / 2 + 1;   // 257
  const RT_SYN_DELAY_MS = (RT_N - RT_HOP) / ENH_SR * 1000; // WOLA: a hop leaves the synth 3 hops after it arrived
  const hz = f => Math.round(f * RT_N / ENH_SR);

  /* Plain (non-sqrt) Hann, periodic — matches torch.hann_window(512), used
     for both analysis and synthesis like torch.stft/istft (sum-of-squares
     normalised WOLA), so the mask lines up with what the model trained on. */
  const RT_WIN = new Float64Array(RT_N);
  const RT_WIN2 = new Float64Array(RT_N);
  for (let i = 0; i < RT_N; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / RT_N);
    RT_WIN[i] = w; RT_WIN2[i] = w * w;
  }

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  /* ---- causal energy-ratio impulse prior, ported from
     sih_python/ml_audio_utils.py::impulse_prior_from_wave (ratio 8, flux 2,
     10-frame hold). Returns 1 on the frame it fires and through the hold;
     run on the >1 kHz band energy. ---- */
  class RTImpulsePrior {
    constructor() {
      this.slow = 1e-6; this.fast = 1e-6; this.hold = 0;
      this.frame = 0; this.warm = 24; this.prevEnergy = 1e-6;
    }
    step(rawEnergy) {
      const energy = rawEnergy + 1e-12;
      this.fast = 0.55 * this.fast + 0.45 * energy;
      if (this.frame < this.warm) {
        this.slow += (energy - this.slow) / (this.frame + 1);
        this.prevEnergy = energy; this.frame++;
        return 0;
      }
      const ratio = this.fast / (this.slow + 1e-12);
      const flux = Math.max(0, energy - this.prevEnergy) / (this.slow + 1e-12);
      const fired = ratio > 8.0 && flux > 2.0;
      if (fired) this.hold = 10;
      else if (this.hold > 0) this.hold--;
      else this.slow = 0.995 * this.slow + 0.005 * Math.min(energy, 4 * this.slow);
      this.prevEnergy = energy; this.frame++;
      return (fired || this.hold > 0) ? 1 : 0;
    }
  }

  /* ---- rolling N-sample analysis window, right-aligned so its newest
     sample is always the most recently received one. ---- */
  class RTFramer {
    constructor() { this.hist = new Float64Array(RT_N); }
    pushHop(hopSamples /* length RT_HOP */) {
      this.hist.copyWithin(0, RT_HOP);
      for (let i = 0; i < RT_HOP; i++) this.hist[RT_N - RT_HOP + i] = hopSamples[i];
      return this.hist;
    }
  }

  /* ---- weighted-overlap-add synthesis, one finished hop out per frame in. ---- */
  class RTSynth {
    constructor() { this.buf = new Float64Array(RT_N); this.wsum = new Float64Array(RT_N); }
    addFrameAndFlush(frameOut /* length RT_N, already = ifft/N * win */) {
      for (let i = 0; i < RT_N; i++) { this.buf[i] += frameOut[i]; this.wsum[i] += RT_WIN2[i]; }
      const out = new Float32Array(RT_HOP);
      for (let i = 0; i < RT_HOP; i++) out[i] = this.wsum[i] > 1e-8 ? this.buf[i] / this.wsum[i] : 0;
      this.buf.copyWithin(0, RT_HOP); this.buf.fill(0, RT_N - RT_HOP);
      this.wsum.copyWithin(0, RT_HOP); this.wsum.fill(0, RT_N - RT_HOP);
      return out;
    }
  }

  /* ==========================================================================
     RTSuppressor — per-frame gain: MCRA noise tracking + OM-LSA, fused with
     the neural mask, then the voice gate, impulse gate and low cut.
     ========================================================================== */
  const SUB_V = 24, SUB_U = 8;         // minimum-statistics window: 8 x 24 frames = 1.5 s
  const MCRA_AS = 0.8, MCRA_AP = 0.2, MCRA_AD = 0.92, MCRA_DELTA = 5;
  const DD_ALPHA = 0.98;               // decision-directed a priori SNR smoothing
  const XI_MIN = Math.pow(10, -15 / 10);
  const ZETA_LO = Math.pow(10, -10 / 10), ZETA_HI = Math.pow(10, -5 / 10);
  const WARM_FRAMES = 12;              // ~100 ms of noise-only learning at stream start
  const K_LOCUT = hz(90), K_V0 = hz(250), K_V1 = hz(3500), K_HF = hz(3000), K_IMP = hz(1000);
  const GATE_HOLD = 30;                // frames (~240 ms) the gate stays open after the last voiced frame
  const IMP_GAIN = Math.pow(10, -30 / 20);
  const FLOOR_RISE = Math.pow(10, 15 / 10 / (ENH_SR / RT_HOP)); // band floor may rise 15 dB/s: follows engine swells, not syllable onsets
  const NN_KEEP = 0.8;                 // lowest fraction of the OM-LSA gain the model may leave on a speech bin
  const VAD_NN_WEIGHT = 0.2;           // the model's VAD false-alarms on real noise, so it only nudges the gate
  const GATE_BAND_SNR = 2.5;           // speech band must stand ~4 dB above its fast floor to open the gate
  const SILENCE_P = 1e-10;             // digital silence (mic warming up, muted input)

  function presence(z) { // soft 0..1 map of a smoothed a priori SNR, Cohen 2003 eq. 26
    if (z <= ZETA_LO) return 0;
    if (z >= ZETA_HI) return 1;
    return Math.log(z / ZETA_LO) / Math.log(ZETA_HI / ZETA_LO);
  }

  class RTSuppressor {
    constructor(params) {
      const B = RT_BINS;
      this.params = params;
      this.Pf = new Float64Array(B);
      this.S = new Float64Array(B);
      this.Smin = new Float64Array(B);
      this.Sw = new Float64Array(B);
      this.subMins = [];
      this.lambda = new Float64Array(B);
      this.pMcra = new Float64Array(B);
      this.gh1Prev = new Float64Array(B).fill(1);
      this.gammaPrev = new Float64Array(B).fill(1);
      this.zeta = new Float64Array(B);
      this.zCum = new Float64Array(B + 1);
      this.pSpeech = new Float64Array(B);
      this.gain = new Float64Array(B);
      this.frames = 0;
      this.gate = 0;
      this.gateHold = 0;
      this.voiceScore = 0;
      this.bandE = 0;
      this.bandFloor = 0;
      this.impulsePrior = new RTImpulsePrior();
      this.impHold = 0;
    }

    /* P: power spectrum (RT_BINS). frameEnergy: mean-square of the time frame (unused, kept for callers).
       nn: { mask (RT_BINS view), vad, imp } or null when the model isn't used.
       Returns per-frame flags; the gain itself is left in this.gain. */
    process(P, frameEnergy, nn) {
      const B = RT_BINS, gain = this.gain, prm = this.params;
      let total = 0;
      for (let k = 0; k < B; k++) total += P[k];
      if (total < SILENCE_P) {
        gain.fill(0);
        return { silent: true, voice: false, impulse: false, impulseOnset: false, voiceProb: 0 };
      }

      const depth = Math.max(6, prm.suppressDb);          // total attenuation in speech gaps
      const gMin = Math.pow(10, -Math.min(depth, 0.6 * depth + 4) / 20); // floor inside speech
      const gGap = Math.pow(10, -depth / 20);

      // Frequency-smoothed periodogram
      const Pf = this.Pf;
      Pf[0] = 0.75 * P[0] + 0.25 * P[1];
      for (let k = 1; k < B - 1; k++) Pf[k] = 0.25 * P[k - 1] + 0.5 * P[k] + 0.25 * P[k + 1];
      Pf[B - 1] = 0.25 * P[B - 2] + 0.75 * P[B - 1];

      // Impulse detection: energy-ratio prior confirmed by a broadband (not
      // speech-shaped) spectrum, or the model's own impulse head.
      // The prior runs on the energy above 1 kHz: engine rumble lives below
      // it and would otherwise mask a bang, which is broadband.
      let hf = 0, above1k = 0;
      for (let k = K_HF; k < B; k++) hf += P[k];
      for (let k = K_IMP; k < B; k++) above1k += P[k];
      const prevAbove1k = this.prevAbove1k || above1k;
      this.prevAbove1k = above1k;
      const priorOn = this.impulsePrior.step(above1k);
      // A bang reaches full level within one 8 ms hop; speech onsets build
      // over tens of ms. Mid-speech (plosives) demand a much bigger jump.
      const jump = above1k / (prevAbove1k + 1e-20);
      const sudden = Math.max(jump, this.prevJump || 0) > (this.gateHold > 0 ? 15 : 8);
      this.prevJump = jump;
      const broadband = hf / total > 0.2;
      const nnImp = nn ? nn.imp : 0;
      let impulseOnset = false;
      if (priorOn && sudden && (broadband || nnImp > 0.6)) {
        impulseOnset = this.impHold === 0;
        this.impHold = 10;
      } else if (this.impHold > 0 && !priorOn) this.impHold--;
      const impulse = this.impHold > 0;

      // Speech-band energy against a floor that falls instantly but rises at
      // most 15 dB/s: a swelling engine drags the floor up with it, while a
      // syllable onset (tens of dB in ~50 ms) jumps clear of it.
      let eb = 0;
      for (let k = K_V0; k <= K_V1; k++) eb += P[k];
      this.bandE = this.frames ? 0.6 * this.bandE + 0.4 * eb : eb;
      if (!this.frames || this.bandE < this.bandFloor) this.bandFloor = this.frames ? 0.7 * this.bandFloor + 0.3 * this.bandE : this.bandE;
      else if (!impulse) this.bandFloor = Math.min(this.bandE, this.bandFloor * FLOOR_RISE);
      const bandSnr = this.bandE / this.bandFloor;

      // Warm-up: learn the noise from the first ~100 ms, output muted.
      if (this.frames < WARM_FRAMES) {
        const n = ++this.frames;
        for (let k = 0; k < B; k++) {
          this.lambda[k] += (P[k] - this.lambda[k]) / n;
          this.S[k] = n === 1 ? Pf[k] : MCRA_AS * this.S[k] + (1 - MCRA_AS) * Pf[k];
          this.Smin[k] = this.Sw[k] = this.S[k];
          gain[k] = gGap;
        }
        return { silent: false, voice: false, impulse, impulseOnset, voiceProb: 0 };
      }
      this.frames++;

      // --- MCRA noise tracking ---
      const S = this.S, Smin = this.Smin, Sw = this.Sw, lambda = this.lambda, pM = this.pMcra;
      for (let k = 0; k < B; k++) {
        S[k] = MCRA_AS * S[k] + (1 - MCRA_AS) * Pf[k];
        if (S[k] < Sw[k]) Sw[k] = S[k];
        if (S[k] < Smin[k]) Smin[k] = S[k];
      }
      if (this.frames % SUB_V === 0) {
        this.subMins.push(Sw.slice());
        if (this.subMins.length > SUB_U) this.subMins.shift();
        for (let k = 0; k < B; k++) {
          let m = S[k];
          for (const sm of this.subMins) if (sm[k] < m) m = sm[k];
          Smin[k] = m; Sw[k] = S[k];
        }
      }
      // Deep in a gap (gate shut, band level on its floor) the frame is noise
      // whatever MCRA's per-bin test says, so learn it quickly � this is what
      // lets the estimate keep up with noise that changes level.
      const surelyNoise = this.gateHold === 0 && bandSnr < 1.6;
      if (!impulse) {
        for (let k = 0; k < B; k++) {
          const I = S[k] > MCRA_DELTA * Smin[k] ? 1 : 0;
          pM[k] = MCRA_AP * pM[k] + (1 - MCRA_AP) * I;
          const ad = surelyNoise ? 0.85 : MCRA_AD + (1 - MCRA_AD) * pM[k];
          lambda[k] = Math.max(1e-14, ad * lambda[k] + (1 - ad) * P[k]);
        }
      }

      // --- OM-LSA gain with speech-presence probability ---
      const zeta = this.zeta, zCum = this.zCum, pS = this.pSpeech;
      const xiArr = gain; // reuse as scratch for xi before the gain is written
      for (let k = 0; k < B; k++) {
        const gamma = Math.min(P[k] / lambda[k], 1e4);
        let xi = DD_ALPHA * this.gh1Prev[k] * this.gh1Prev[k] * this.gammaPrev[k] + (1 - DD_ALPHA) * Math.max(gamma - 1, 0);
        xi = Math.max(xi, XI_MIN);
        xiArr[k] = xi;
        zeta[k] = 0.7 * zeta[k] + 0.3 * xi;
        this.gammaPrev[k] = gamma;
      }
      zCum[0] = 0;
      for (let k = 0; k < B; k++) zCum[k + 1] = zCum[k] + zeta[k];
      const zAvg = (a, b) => { a = Math.max(0, a); b = Math.min(B - 1, b); return (zCum[b + 1] - zCum[a]) / (b - a + 1); };
      const pFrame = presence(zAvg(K_V0, K_V1));
      let voiceNum = 0, voiceDen = 0;
      for (let k = 0; k < B; k++) {
        const xi = xiArr[k];
        const gamma = this.gammaPrev[k];
        const v = gamma * xi / (1 + xi);
        const gh1 = Math.min(1, xi / (1 + xi) * Math.exp(0.5 * enhExpint(Math.max(v, 1e-8))));
        this.gh1Prev[k] = gh1;
        const q = Math.min(0.95, 1 - presence(zAvg(k - 1, k + 1)) * presence(zAvg(k - 15, k + 15)) * pFrame);
        const p = 1 / (1 + q / (1 - q) * (1 + xi) * Math.exp(-Math.min(v, 50)));
        pS[k] = p;
        if (k >= K_V0 && k <= K_V1) { voiceNum += p * P[k]; voiceDen += P[k]; }
        let g = Math.pow(gh1, p) * Math.pow(gMin, 1 - p);
        if (nn) {
          // The model's mask can pull a bin further down (noise it recognises
          // that the tracker hasn't caught up with yet) but by at most ~2 dB
          // where the tracker is confident it's speech: offline tests on real
          // speech showed deeper model cuts cost as much voice as noise.
          const m = Math.min(1, Math.max(gMin, nn.mask[k]));
          g = Math.min(g, Math.max(m, g * (NN_KEEP + (1 - NN_KEEP) * (1 - p))));
        }
        gain[k] = g;
      }

      // --- frame-level voice gate ---
      const dspVoice = voiceDen > 0 ? voiceNum / voiceDen : 0;
      const nnVad = nn ? nn.vad : dspVoice;
      const score = (1 - VAD_NN_WEIGHT) * dspVoice + VAD_NN_WEIGHT * nnVad;
      this.voiceScore = score;
      const voiced = !impulse && score > 0.45 && bandSnr > GATE_BAND_SNR;
      if (voiced) this.gateHold = GATE_HOLD;
      else if (this.gateHold > 0) this.gateHold--;
      const target = this.gateHold > 0 ? 1 : gGap / gMin;
      this.gate = target > this.gate ? target : 0.8 * this.gate + 0.2 * target;

      const gImp = impulse ? IMP_GAIN : 1;
      for (let k = 0; k < B; k++) {
        let g = gain[k] * this.gate * gImp;
        if (k < K_LOCUT) g = Math.min(g, gGap);
        gain[k] = Math.max(gGap * gImp * 0.5, Math.min(1, g));
      }
      return { silent: false, voice: this.gateHold > 0 && !impulse, impulse, impulseOnset, voiceProb: score };
    }
  }

  let _modelPromise = null;
  /* Loads the ONNX session + manifest once and caches it — repeated
     Start/Stop cycles in the same page load reuse it. */
  function loadModel() {
    if (_modelPromise) return _modelPromise;
    _modelPromise = (async () => {
      if (location.protocol === 'file:') {
        throw new Error('The live neural engine needs the local server (browser security blocks it from loading the ONNX model over file://). Run "npm start" and open http://localhost:3000.');
      }
      if (!window.ort) throw new Error('onnxruntime-web did not load — check your network connection and reload.');
      ort.env.wasm.numThreads = 1; // avoids requiring COOP/COEP cross-origin isolation headers
      ort.env.wasm.wasmPaths = '/vendor/onnxruntime-web/';
      const manifest = await fetch('models/crn_gru_voice_mask_streaming.json').then(r => {
        if (!r.ok) throw new Error('crn_gru_voice_mask_streaming.json not found — export it first with sih_python/export_streaming_onnx.py.');
        return r.json();
      });
      const session = await ort.InferenceSession.create('models/' + manifest.onnx, { executionProviders: ['wasm'] });
      return { session, manifest };
    })();
    return _modelPromise;
  }

  /* ---- the live engine itself ---- */
  const DEFAULT_PARAMS = { suppressDb: 35, outputGainDb: 12, useModel: true };
  const STAT_DECAY = 1 - 1 / 500; // ~4 s memory for the live measurements (frames)

  class RTNeuralEngine {
    constructor(session, manifest, params) {
      this.session = session;
      this.manifest = manifest;
      this.CTX_FRAMES = manifest.context_frames;
      this.CHUNK_FRAMES = manifest.chunk_frames;
      this.params = Object.assign({}, DEFAULT_PARAMS, params);

      this.hidden = new Float32Array(manifest.gru_layers * manifest.gru_hidden);
      this.context = new Float32Array(this.CTX_FRAMES * RT_BINS);

      this.framer = new RTFramer();
      this.suppressor = new RTSuppressor(this.params);
      this.synth = new RTSynth();
      this.anaRe = new Float64Array(RT_N); this.anaIm = new Float64Array(RT_N);
      this.synRe = new Float64Array(RT_N); this.synIm = new Float64Array(RT_N);
      this.pow = new Float64Array(RT_BINS);
      this.frameOut = new Float64Array(RT_N);

      this.jobQueue = [];
      this.outputQueue = [];
      this.processing = false;
      this.running = false;
      this.monitor = 'enh'; // 'enh' | 'raw'
      this.recording = false;
      this.recordedChunks = [];
      this.seq = 0;
      this.debugGains = null; // set to [] to collect per-frame gains (offline testing)

      // Leaky energy sums, split by what the gate decided each frame was
      this.stat = { vIn: 0, vOut: 0, vnIn: 0, vnOut: 0, vN: 0, gIn: 0, gOut: 0, gN: 0 };
      this.gapMeanDb = NaN; this.gapVarDb = 0; // level statistics of the gaps, for the noise-type readout
      this.lastImpulseAt = -Infinity; this.frameCount = 0;

      this.metrics = {
        noiseClass: '—', voiceActive: false, voiceProb: 0, impulseEvents: 0,
        gapCutDb: NaN, talkCutDb: NaN, voiceKeptDb: NaN, snrInDb: NaN, snrOutDb: NaN, inferMs: 0,
        chunkMs: (this.CHUNK_FRAMES * RT_HOP) / ENH_SR * 1000, latencyMs: NaN,
        queued: 0, startedAt: 0, inputDb: -Infinity,
      };
      this.onChunk = null; // (result) => void, for live drawing
    }

    setParams(p) {
      Object.assign(this.params, p);
      if (this.outGain) this.outGain.gain.value = Math.pow(10, this.params.outputGainDb / 20);
    }
    setMonitor(m) { this.monitor = m; }

    start(ctx, sourceNode) {
      this.ctx = ctx;
      const bufSize = this.CHUNK_FRAMES * RT_HOP;
      this.node = ctx.createScriptProcessor(bufSize, 1, 1);
      this.node.onaudioprocess = e => this._onAudio(e);
      sourceNode.connect(this.node);
      // The mic is opened without browser AGC, so it arrives quiet: apply
      // make-up gain, with a limiter after it so loud sounds can't clip.
      this.outGain = ctx.createGain();
      this.outGain.gain.value = Math.pow(10, this.params.outputGainDb / 20);
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
      this.node.connect(this.outGain);
      this.outGain.connect(this.limiter);
      this.limiter.connect(ctx.destination);
      this.sourceNode = sourceNode;
      this.running = true;
      this.metrics.startedAt = performance.now();
    }

    stop() {
      this.running = false;
      if (this.node) { try { this.node.disconnect(); } catch (e) {} this.node.onaudioprocess = null; }
      if (this.outGain) { try { this.outGain.disconnect(); this.limiter.disconnect(); } catch (e) {} this.outGain = this.limiter = null; }
      if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch (e) {} }
      this.jobQueue.length = 0;
      this.outputQueue.length = 0;
    }

    startRecording() { this.recording = true; this.recordedChunks = []; }
    stopRecording() { this.recording = false; return this.recordedChunks; }

    /* STFT analysis of one chunk of input into a job for _runInference. */
    analyse(inCh) {
      const n = this.CHUNK_FRAMES;
      const logMag = new Float32Array(n * RT_BINS);
      const frameRe = new Array(n), frameIm = new Array(n), energy = new Float64Array(n);
      for (let f = 0; f < n; f++) {
        const frame = this.framer.pushHop(inCh.subarray(f * RT_HOP, (f + 1) * RT_HOP));
        let e = 0;
        for (let i = 0; i < RT_N; i++) e += frame[i] * frame[i];
        energy[f] = e / RT_N;
        for (let i = 0; i < RT_N; i++) { this.anaRe[i] = frame[i] * RT_WIN[i]; this.anaIm[i] = 0; }
        enhFFT(this.anaRe, this.anaIm);
        const reRow = new Float32Array(RT_BINS), imRow = new Float32Array(RT_BINS);
        for (let k = 0; k < RT_BINS; k++) {
          reRow[k] = this.anaRe[k]; imRow[k] = this.anaIm[k];
          logMag[f * RT_BINS + k] = Math.log1p(Math.hypot(this.anaRe[k], this.anaIm[k]));
        }
        frameRe[f] = reRow; frameIm[f] = imRow;
      }
      return { logMag, energy, frameRe, frameIm, raw: new Float32Array(inCh), seq: this.seq++ };
    }

    _onAudio(e) {
      if (!this.running) return;
      const inCh = e.inputBuffer.getChannelData(0);
      this.jobQueue.push(this.analyse(inCh));
      this._pump();

      const outCh = e.outputBuffer.getChannelData(0);
      const ready = this.outputQueue.shift();
      if (ready) {
        outCh.set(this.monitor === 'raw' ? ready.raw : ready.enh);
        if (this.recording) this.recordedChunks.push(ready.enh.slice());
        // input buffering (1 chunk) + chunks waited in the queue + WOLA delay + device output latency
        const lagChunks = this.seq - 1 - ready.seq;
        const devMs = ((this.ctx && (this.ctx.outputLatency || this.ctx.baseLatency)) || 0) * 1000;
        this.metrics.latencyMs = (1 + lagChunks) * this.metrics.chunkMs + RT_SYN_DELAY_MS + devMs;
        if (this.onChunk) this.onChunk(ready);
      } else {
        outCh.fill(0);
      }
      this.metrics.queued = this.jobQueue.length + this.outputQueue.length;
    }

    async _pump() {
      if (this.processing) return;
      this.processing = true;
      while (this.jobQueue.length) {
        const job = this.jobQueue.shift();
        let result;
        try {
          result = await this._runInference(job);
        } catch (err) {
          console.error('RTEngine inference error, passing audio through unprocessed:', err);
          result = { enh: job.raw, raw: job.raw, seq: job.seq, ms: 0, error: err };
        }
        this.outputQueue.push(result);
        while (this.outputQueue.length > 6) this.outputQueue.shift(); // don't let latency run away if we fall behind
      }
      this.processing = false;
    }

    async _runInference(job) {
      const t0 = performance.now();
      const n = this.CHUNK_FRAMES, ctxN = this.CTX_FRAMES;

      let maskAll = null, vadAll = null, impAll = null;
      if (this.params.useModel) {
        const total = ctxN + n;
        const inputArr = new Float32Array(total * RT_BINS);
        inputArr.set(this.context, 0);
        inputArr.set(job.logMag, ctxN * RT_BINS);
        const logMagTensor = new ort.Tensor('float32', inputArr, [1, total, RT_BINS]);
        const hiddenTensor = new ort.Tensor('float32', this.hidden, [this.manifest.gru_layers, 1, this.manifest.gru_hidden]);
        const results = await this.session.run({ log_mag: logMagTensor, hidden_in: hiddenTensor });
        this.hidden = results.hidden_out.data;
        this.context = inputArr.slice(inputArr.length - ctxN * RT_BINS);
        maskAll = results.mask.data;
        vadAll = results.vad_logit.data;
        impAll = results.impulse_logit.data;
      }

      const enh = new Float32Array(n * RT_HOP);
      const sup = this.suppressor, gain = sup.gain, P = this.pow, st = this.stat;
      let lastFlags = null, peakIn = 0;

      for (let f = 0; f < n; f++) {
        const gi = ctxN + f;
        const reRow = job.frameRe[f], imRow = job.frameIm[f];
        let eIn = 0;
        for (let k = 0; k < RT_BINS; k++) { P[k] = reRow[k] * reRow[k] + imRow[k] * imRow[k]; eIn += P[k]; }

        const nn = maskAll ? {
          mask: maskAll.subarray(gi * RT_BINS, (gi + 1) * RT_BINS),
          vad: sigmoid(vadAll[gi]),
          imp: sigmoid(impAll[gi]),
        } : null;
        const flags = sup.process(P, job.energy[f], nn);
        lastFlags = flags;
        if (this.debugGains) this.debugGains.push(Float64Array.from(gain));

        let eOut = 0;
        for (let k = 0; k < RT_BINS; k++) {
          const g = gain[k];
          eOut += P[k] * g * g;
          this.synRe[k] = reRow[k] * g; this.synIm[k] = imRow[k] * g;
          if (k > 0 && k < RT_BINS - 1) { this.synRe[RT_N - k] = this.synRe[k]; this.synIm[RT_N - k] = -this.synIm[k]; }
        }
        for (let k = 0; k < RT_N; k++) this.synIm[k] = -this.synIm[k];
        enhFFT(this.synRe, this.synIm);
        for (let i = 0; i < RT_N; i++) this.frameOut[i] = (this.synRe[i] / RT_N) * RT_WIN[i];
        enh.set(this.synth.addFrameAndFlush(this.frameOut), f * RT_HOP);

        // Live statistics, split by the gate's own talking / gap decision.
        // While talking, the noise part is the tracker's estimate lambda
        // (in) and lambda*g^2 (out); the rest of the energy is voice.
        for (const key in st) st[key] *= STAT_DECAY;
        if (!flags.silent && !flags.impulse) {
          if (flags.voice) {
            let nIn = 0, nOut = 0;
            const lam = sup.lambda;
            for (let k = 0; k < RT_BINS; k++) { nIn += lam[k]; nOut += lam[k] * gain[k] * gain[k]; }
            st.vIn += Math.max(0, eIn - nIn); st.vOut += Math.max(0, eOut - nOut);
            st.vnIn += nIn; st.vnOut += nOut; st.vN += 1;
          } else if (flags.voiceProb < 0.2) { st.gIn += eIn; st.gOut += eOut; st.gN += 1; }
        }
        this.frameCount++;
        if (flags.impulseOnset) { this.metrics.impulseEvents++; this.lastImpulseAt = this.frameCount; }
        if (!flags.silent && !flags.voice && !flags.impulse && flags.voiceProb < 0.2) {
          const x = 10 * Math.log10(sup.bandE + 1e-20); // speech band: ignores sub-bass rumble wander
          if (isNaN(this.gapMeanDb)) this.gapMeanDb = x;
          const d = x - this.gapMeanDb;
          this.gapMeanDb += 0.02 * d;
          this.gapVarDb = 0.98 * (this.gapVarDb + 0.02 * d * d);
        }
      }
      for (let i = 0; i < job.raw.length; i++) peakIn = Math.max(peakIn, Math.abs(job.raw[i]));

      this._updateMetrics(lastFlags, peakIn, performance.now() - t0);
      return { enh, raw: job.raw, seq: job.seq, voice: lastFlags.voice, impulse: lastFlags.impulse, ms: performance.now() - t0 };
    }

    _updateMetrics(flags, peakIn, ms) {
      const m = this.metrics, st = this.stat;
      m.inferMs = m.inferMs ? 0.8 * m.inferMs + 0.2 * ms : ms;
      m.voiceActive = flags.voice;
      m.voiceProb = flags.voiceProb;
      m.inputDb = 20 * Math.log10(peakIn + 1e-9);

      const dB = v => 10 * Math.log10(Math.max(v, 1e-30));
      if (st.gN > 5) {
        m.gapCutDb = dB(st.gIn / st.gOut);
        // Noise type from how the gap level behaves: steady (fans, engines at
        // constant rpm), fluctuating (traffic, rpm changes) or recent bangs
        const recentImpulse = this.frameCount - this.lastImpulseAt < 4 * ENH_SR / RT_HOP;
        m.noiseClass = recentImpulse ? 'impulsive' : Math.sqrt(this.gapVarDb) < 2.5 ? 'steady' : 'fluctuating';
        m.noiseStdDb = Math.sqrt(this.gapVarDb);
      }
      if (st.vN > 5) {
        m.talkCutDb = dB(st.vnIn / st.vnOut);
        m.voiceKeptDb = Math.min(0, dB(st.vOut / st.vIn));
        m.snrInDb = dB(st.vIn / st.vnIn);
        m.snrOutDb = dB(st.vOut / st.vnOut);
      }
    }
  }

  return { loadModel, RTNeuralEngine, RTSuppressor, RTFramer, RTSynth, RT_N, RT_HOP, RT_BINS, RT_WIN, DEFAULT_PARAMS };
})();
