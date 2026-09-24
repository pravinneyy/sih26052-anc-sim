/* ==========================================================================
   rt_engine.js — live streaming ANC/enhancement engine for panel 9.

   Runs the trained SIH26052 CRN/GRU model (models/crn_gru_voice_mask.pt,
   exported by sih_python/export_streaming_onnx.py) continuously on a live
   Web Audio graph: mic (or a file/demo clip played through the same graph)
   -> STFT framing -> ONNX Runtime Web inference, with the GRU hidden state
   and a short causal-conv context window carried across calls -> neural
   mask + the same causal energy-ratio impulse prior used by the offline
   batch script (ml_audio_utils.impulse_prior_from_wave) -> inverse STFT ->
   speakers, with output delayed by only a couple of chunks.

   This mirrors sih_python/batch_enhance_crn_gru.py's enhance_audio() as
   closely as a chunked/stateful pipeline allows — see the inline notes at
   each point where a batch (whole-clip) operation had to become a
   streaming (persisted-state) one:

     - STFT: batch uses torch.stft(..., center=True); streaming keeps a
       rolling N-sample history and forms a right-aligned window each hop,
       which is the same alignment up to a constant ~16 ms edge delay at
       stream start (no reflect-padding available for audio that hasn't
       happened yet).
     - GRU hidden state: exposed as an explicit input/output on the
       streaming ONNX graph (the offline export resets it to zero every
       call) and persisted across chunks here.
     - Causal conv receptive field (3 layers x kernel-time 3 => 6 frames of
       lookback): the offline export sees this lookback within one big
       batch call; streaming re-feeds the last CONTEXT_FRAMES frames of
       log-magnitude from the previous chunk and drops the corresponding
       leading frames of the output, verified against the batch path in
       development (mean mask error ~0.01 on random test signal, error
       concentrated at chunk boundaries as expected).
     - Impulse prior: ml_audio_utils.impulse_prior_from_wave is already a
       causal, frame-recursive filter — ported 1:1 in RTImpulsePrior below,
       just with a fixed warm-up (a live stream has no known total length).

   Zero external dependencies beyond ENH_N/ENH_HOP/ENH_SR/enhFFT (from
   enhance.js, loaded first) and the onnxruntime-web UMD build (loaded as
   window.ort before this file).
   Global: RTEngine (object)
   ========================================================================== */

const RTEngine = (() => {
  'use strict';

  const RT_N = ENH_N;             // 512 — same FFT size as the model was trained with
  const RT_HOP = ENH_HOP;         // 128
  const RT_BINS = RT_N / 2 + 1;   // 257

  /* Plain (non-sqrt) Hann, periodic — matches torch.hann_window(512), used
     for both analysis and synthesis exactly like torch.stft/istft's own
     WOLA convention (sum-of-squares normalised), so the mask this engine
     computes lines up with the one the model was trained against. This is
     deliberately NOT enhance.js's enhWin (sqrt-Hann, tuned for the
     log-MMSE engine's own COLA scheme). */
  const RT_WIN = new Float64Array(RT_N);
  const RT_WIN2 = new Float64Array(RT_N);
  for (let i = 0; i < RT_N; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / RT_N);
    RT_WIN[i] = w; RT_WIN2[i] = w * w;
  }

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function softmax3(a, b, c) {
    const m = Math.max(a, b, c);
    const ea = Math.exp(a - m), eb = Math.exp(b - m), ec = Math.exp(c - m);
    const s = ea + eb + ec;
    return [ea / s, eb / s, ec / s];
  }

  /* ---- causal energy-ratio impulse prior, ported from
     sih_python/ml_audio_utils.py::impulse_prior_from_wave (ratio_threshold
     8.0, hold_frames=10, matching the values batch_enhance_crn_gru.py
     actually calls it with). ---- */
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
     sample is always the most recently received one (see header note on
     STFT alignment). ---- */
  class RTFramer {
    constructor() { this.hist = new Float64Array(RT_N); }
    pushHop(hopSamples /* length RT_HOP */) {
      this.hist.copyWithin(0, RT_HOP);
      for (let i = 0; i < RT_HOP; i++) this.hist[RT_N - RT_HOP + i] = hopSamples[i];
      return this.hist;
    }
  }

  /* ---- weighted-overlap-add synthesis, one hop of finished output per
     frame in — same normalisation as enhance.js/aiml_engine.js's batch OLA
     (accumulate windowed IFFT output + sum-of-squared-window weights, then
     divide), just windowed to a fixed-size buffer that shifts by one hop
     per call instead of writing into a whole-clip array. ---- */
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
  class RTNeuralEngine {
    constructor(session, manifest, params) {
      this.session = session;
      this.manifest = manifest;
      this.CTX_FRAMES = manifest.context_frames;
      this.CHUNK_FRAMES = manifest.chunk_frames;
      this.params = Object.assign({ floorDb: -18, impulseExtraDb: -24, fastPriorWeight: 0.95, useFastPrior: true }, params);

      this.hidden = new Float32Array(manifest.gru_layers * manifest.gru_hidden);
      this.context = new Float32Array(this.CTX_FRAMES * RT_BINS);

      this.framer = new RTFramer();
      this.impulsePrior = new RTImpulsePrior();
      this.synth = new RTSynth();
      this.anaRe = new Float64Array(RT_N); this.anaIm = new Float64Array(RT_N);
      this.synRe = new Float64Array(RT_N); this.synIm = new Float64Array(RT_N);

      this.jobQueue = [];
      this.outputQueue = [];
      this.processing = false;
      this.running = false;
      this.monitor = 'enh'; // 'enh' | 'raw'
      this.recording = false;
      this.recordedChunks = [];

      this.energyRoll = []; // one {eIn, eOut} entry per processed chunk, for a rolling noise-reduction / SNR estimate
      this.ROLL_MAX = 240;  // ~15s of chunks at 64ms each

      this.metrics = {
        noiseClass: 'stationary', vadProb: 0, impulseProb: 0, impulseEvents: 0,
        noiseRedDb: NaN, snrGainDb: NaN, inferMs: 0,
        chunkMs: (this.CHUNK_FRAMES * RT_HOP) / ENH_SR * 1000,
        queued: 0, startedAt: 0,
      };
      this.onChunk = null; // (result) => void, for live drawing
    }

    setParams(p) { Object.assign(this.params, p); }
    setMonitor(m) { this.monitor = m; }

    start(ctx, sourceNode) {
      this.ctx = ctx;
      const bufSize = this.CHUNK_FRAMES * RT_HOP;
      this.node = ctx.createScriptProcessor(bufSize, 1, 1);
      this.node.onaudioprocess = e => this._onAudio(e);
      sourceNode.connect(this.node);
      this.node.connect(ctx.destination);
      this.sourceNode = sourceNode;
      this.running = true;
      this.metrics.startedAt = performance.now();
    }

    stop() {
      this.running = false;
      if (this.node) { try { this.node.disconnect(); } catch (e) {} this.node.onaudioprocess = null; }
      if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch (e) {} }
      this.jobQueue.length = 0;
      this.outputQueue.length = 0;
    }

    startRecording() { this.recording = true; this.recordedChunks = []; }
    stopRecording() { this.recording = false; return this.recordedChunks; }

    _onAudio(e) {
      if (!this.running) return;
      const inCh = e.inputBuffer.getChannelData(0);
      const n = this.CHUNK_FRAMES;
      const logMag = new Float32Array(n * RT_BINS);
      const frameRe = new Array(n), frameIm = new Array(n);
      const prior = new Float32Array(n);

      for (let f = 0; f < n; f++) {
        const hop = inCh.subarray(f * RT_HOP, (f + 1) * RT_HOP);
        const frame = this.framer.pushHop(hop);

        let energy = 0;
        for (let i = 0; i < RT_N; i++) energy += frame[i] * frame[i];
        energy /= RT_N;
        prior[f] = this.impulsePrior.step(energy);

        for (let i = 0; i < RT_N; i++) { this.anaRe[i] = frame[i] * RT_WIN[i]; this.anaIm[i] = 0; }
        enhFFT(this.anaRe, this.anaIm);
        const reRow = new Float32Array(RT_BINS), imRow = new Float32Array(RT_BINS);
        for (let k = 0; k < RT_BINS; k++) {
          reRow[k] = this.anaRe[k]; imRow[k] = this.anaIm[k];
          logMag[f * RT_BINS + k] = Math.log1p(Math.hypot(this.anaRe[k], this.anaIm[k]));
        }
        frameRe[f] = reRow; frameIm[f] = imRow;
      }

      const job = { logMag, prior, frameRe, frameIm, raw: new Float32Array(inCh) };
      this.jobQueue.push(job);
      this._pump();

      const outCh = e.outputBuffer.getChannelData(0);
      const ready = this.outputQueue.shift();
      if (ready) {
        outCh.set(this.monitor === 'raw' ? ready.raw : ready.enh);
        if (this.recording) this.recordedChunks.push(ready.enh.slice());
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
          result = { enh: job.raw, raw: job.raw, ms: 0, error: err };
        }
        this.outputQueue.push(result);
        while (this.outputQueue.length > 6) this.outputQueue.shift(); // don't let latency run away if we fall behind
      }
      this.processing = false;
    }

    async _runInference(job) {
      const t0 = performance.now();
      const n = this.CHUNK_FRAMES, ctxN = this.CTX_FRAMES;
      const total = ctxN + n;
      const inputArr = new Float32Array(total * RT_BINS);
      inputArr.set(this.context, 0);
      inputArr.set(job.logMag, ctxN * RT_BINS);

      const logMagTensor = new ort.Tensor('float32', inputArr, [1, total, RT_BINS]);
      const hiddenTensor = new ort.Tensor('float32', this.hidden, [this.manifest.gru_layers, 1, this.manifest.gru_hidden]);
      const results = await this.session.run({ log_mag: logMagTensor, hidden_in: hiddenTensor });

      this.hidden = results.hidden_out.data;
      this.context = inputArr.slice(inputArr.length - ctxN * RT_BINS);

      const maskAll = results.mask.data;
      const noiseAll = results.noise_logits.data;
      const vadAll = results.vad_logit.data;
      const impAll = results.impulse_logit.data;

      const floor = Math.pow(10, this.params.floorDb / 20);
      const impulseGainLin = Math.pow(10, this.params.impulseExtraDb / 20);
      const fastWeight = this.params.useFastPrior ? this.params.fastPriorWeight : 0;

      const enh = new Float32Array(n * RT_HOP);
      let eIn = 0, eOut = 0, vadSum = 0, impSum = 0, impEvents = 0;
      const classSum = [0, 0, 0];

      for (let f = 0; f < n; f++) {
        const gi = ctxN + f;
        const neuralImp = sigmoid(impAll[gi]);
        const impProb = Math.min(1, Math.max(neuralImp, fastWeight * job.prior[f]));
        if (impProb > 0.5) impEvents++;
        impSum += impProb;
        vadSum += sigmoid(vadAll[gi]);
        const cp = softmax3(noiseAll[gi * 3], noiseAll[gi * 3 + 1], noiseAll[gi * 3 + 2]);
        classSum[0] += cp[0]; classSum[1] += cp[1]; classSum[2] += cp[2];

        const impulseGate = 1 - impProb * (1 - impulseGainLin);
        const reRow = job.frameRe[f], imRow = job.frameIm[f];
        for (let k = 0; k < RT_BINS; k++) {
          let m = maskAll[gi * RT_BINS + k];
          m = Math.min(1, Math.max(floor, m)) * impulseGate;
          m = Math.min(1, Math.max(floor, m));
          const p0 = reRow[k] * reRow[k] + imRow[k] * imRow[k];
          eIn += p0; eOut += p0 * m * m;
          this.synRe[k] = reRow[k] * m; this.synIm[k] = imRow[k] * m;
          if (k > 0 && k < RT_BINS - 1) { this.synRe[RT_N - k] = this.synRe[k]; this.synIm[RT_N - k] = -this.synIm[k]; }
        }
        for (let k = 0; k < RT_N; k++) this.synIm[k] = -this.synIm[k];
        enhFFT(this.synRe, this.synIm);
        const frameOut = new Float64Array(RT_N);
        for (let i = 0; i < RT_N; i++) frameOut[i] = (this.synRe[i] / RT_N) * RT_WIN[i];
        enh.set(this.synth.addFrameAndFlush(frameOut), f * RT_HOP);
      }

      this._updateMetrics({ eIn, eOut, vadSum, impSum, impEvents, classSum, n, ms: performance.now() - t0 });
      return { enh, raw: job.raw, ms: performance.now() - t0 };
    }

    _updateMetrics(s) {
      const m = this.metrics;
      m.inferMs = 0.3 * m.inferMs + 0.7 * s.ms;
      m.vadProb = s.vadSum / s.n;
      m.impulseProb = s.impSum / s.n;
      m.impulseEvents += s.impEvents;

      const names = this.manifest.noise_classes;
      let top = 0; for (let c = 1; c < 3; c++) if (s.classSum[c] > s.classSum[top]) top = c;
      m.noiseClass = names[top];

      this.energyRoll.push({ eIn: s.eIn / s.n, eOut: s.eOut / s.n });
      if (this.energyRoll.length > this.ROLL_MAX) this.energyRoll.shift();
      if (this.energyRoll.length >= 8) {
        const ins = this.energyRoll.map(r => r.eIn).sort((a, b) => a - b);
        const outs = this.energyRoll.map(r => r.eOut).sort((a, b) => a - b);
        const dB = v => 10 * Math.log10(v + 1e-15);
        const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
        const inFloor = dB(q(ins, 0.10)), inPeak = dB(q(ins, 0.90));
        const outFloor = dB(q(outs, 0.10)), outPeak = dB(q(outs, 0.90));
        m.noiseRedDb = inFloor - outFloor;
        m.snrGainDb = (outPeak - outFloor) - (inPeak - inFloor);
      }
    }
  }

  return { loadModel, RTNeuralEngine, RT_N, RT_HOP, RT_BINS };
})();
