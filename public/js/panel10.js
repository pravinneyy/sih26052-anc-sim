/* ==========================================================================
   panel10.js — AI/ML Neural Adaptive Engine & Tactical Cue Classifier Hub
   Features:
     - Real-Time Feature Spectrogram & Log-Mel Energy Map
     - Multi-Class Neural Probability Radar / Real-Time Classifier
     - Neural Dynamic Step-Size (µ(t)) & Stability Supervisor Trajectory
     - Tactical Transparency Mode Switcher with Interactive Audio Synthesizer
     - Live Edge Threat & Acoustic Cue Detection Event Stream
     - ARM Cortex-M7 + Ethos-U55 Edge NPU Hardware Budget Telemetry
   ========================================================================== */

let p10Scenario = 'threat_cue';
let p10TacticalMode = 'threat_aware';
let p10Ctx = null;
let p10SrcNode = null;
let p10Playing = false;
let p10StartedAt = 0;
let p10Offset = 0;
let p10Data = null;
let p10Anim = null;

// Synthetic Scenario Audio Generators
function generateScenarioSignal(type, durationSec = 4.0, fs = 16000) {
  const n = Math.round(durationSec * fs);
  const sig = new Float32Array(n);
  const r = rng(2026);
  let lp = 0;

  for (let i = 0; i < n; i++) {
    const t = i / fs;
    lp = 0.92 * lp + 0.08 * gauss(r);

    if (type === 'stat_engine') {
      // Tank/IFV diesel engine: 80Hz, 160Hz, 240Hz harmonics + rumble
      sig[i] = (lp * 1.8 +
        0.6 * Math.sin(2 * Math.PI * 85 * t) +
        0.4 * Math.sin(2 * Math.PI * 170 * t) +
        0.25 * Math.sin(2 * Math.PI * 255 * t));
    } else if (type === 'nonstat_rotor') {
      // Rotor blade slap + variable turbine pitch
      const fRotor = 22.5;
      const fTurbine = 450 + 180 * Math.sin(2 * Math.PI * 0.4 * t);
      const bladeSlap = Math.pow(Math.max(0, Math.sin(2 * Math.PI * fRotor * t)), 8) * 1.6;
      sig[i] = (lp * 1.2 + 0.4 * Math.sin(2 * Math.PI * fTurbine * t) + bladeSlap);
    } else if (type === 'impulse_threat') {
      // Background noise + multi-round gunfire burst at t=1.2s, 1.4s, 1.6s, 1.8s
      let base = lp * 0.8 + 0.3 * Math.sin(2 * Math.PI * 120 * t);
      const shots = [1.2, 1.38, 1.56, 1.74, 2.8];
      for (const t0 of shots) {
        if (t >= t0 && t < t0 + 0.08) {
          const dt = t - t0;
          base += 4.5 * Math.exp(-dt * 220) * (gauss(r) + 0.3);
        }
      }
      sig[i] = base;
    } else if (type === 'tactical_voice') {
      // NATO Phonetic Tactical Comms in engine noise: "Bravo Two, Move to Extraction Point"
      const f0 = 130 + 35 * Math.sin(2 * Math.PI * 3.2 * t);
      const voiceActive = (t > 0.4 && t < 1.6) || (t > 2.0 && t < 3.4);
      let voice = 0;
      if (voiceActive) {
        voice = (0.7 * Math.sin(2 * Math.PI * f0 * t) +
          0.5 * Math.sin(2 * Math.PI * 2 * f0 * t) +
          0.3 * Math.sin(2 * Math.PI * 3 * f0 * t)) * (0.8 + 0.3 * Math.sin(2 * Math.PI * 15 * t));
      }
      sig[i] = voice * 1.5 + (lp * 0.6 + 0.2 * Math.sin(2 * Math.PI * 90 * t));
    } else {
      // Mixed Threat Cues: Engine rumble + Sniper crack @ t=1.5s + Warning Siren @ t=2.4s + Footsteps
      let env = lp * 0.9 + 0.3 * Math.sin(2 * Math.PI * 110 * t);
      // Footstep clicks
      if ((t > 0.3 && t < 1.2) && (Math.floor(t * 5) % 2 === 0)) {
        env += 0.4 * (gauss(r) * Math.exp(-((t % 0.2) * 80)));
      }
      // Gunshot crack at t=1.5s
      if (t >= 1.5 && t < 1.56) {
        env += 5.2 * Math.exp(-(t - 1.5) * 300) * (gauss(r) + 0.5);
      }
      // Tactical siren alert oscillating 800-1200 Hz starting t=2.2s
      if (t >= 2.2 && t <= 3.8) {
        const sirenF = 950 + 250 * Math.sin(2 * Math.PI * 1.8 * (t - 2.2));
        env += 0.65 * Math.sin(2 * Math.PI * sirenF * t);
      }
      sig[i] = env;
    }
  }

  // Energy normalize
  let energy = 0;
  for (let i = 0; i < n; i++) energy += sig[i] * sig[i];
  const rms = Math.sqrt(energy / n) || 1.0;
  for (let i = 0; i < n; i++) sig[i] /= rms;

  return sig;
}

function runP10() {
  const cvFeats = document.getElementById('cv10Features');
  const cvMu = document.getElementById('cv10Mu');
  if (!cvFeats || !cvMu) return;

  // Generate tactical signal
  const fs = 16000;
  const rawSignal = generateScenarioSignal(p10Scenario, 4.0, fs);

  // Run AI processing pipeline
  const N = 256;
  const hop = 64;
  const numFrames = Math.floor((rawSignal.length - N) / hop) + 1;

  const logMelHistory = [];
  const classProbsHistory = [];
  const muHistory = new Float32Array(numFrames);
  const timeAxis = new Float32Array(numFrames);
  const threatEvents = [];

  const supervisor = new NeuralStepSupervisor(0.005);
  let maxKurtosis = 0;

  for (let f = 0; f < numFrames; f++) {
    const idx = f * hop;
    const tSec = idx / fs;
    timeAxis[f] = tSec;

    const frame = rawSignal.subarray(idx, idx + N);
    const feats = AIML_EXTRACTOR.extract(frame);
    const cls = AIML_CLASSIFIER.predict(feats);

    logMelHistory.push(feats.logMel);
    classProbsHistory.push(cls.probs);

    const supResult = supervisor.compute(cls, feats.energy, 0.05);
    muHistory[f] = supResult.mu;

    if (feats.kurtosis > maxKurtosis) maxKurtosis = feats.kurtosis;

    // Log high-confidence threat events
    if (cls.isImpulse && (threatEvents.length === 0 || tSec - threatEvents[threatEvents.length - 1].time > 0.25)) {
      threatEvents.push({
        time: tSec,
        type: '💥 GUNFIRE / BLAST IMPULSE',
        action: 'AI Zero-Sample Filter Freeze (0µs divergence)',
        status: 'PROTECTED',
        badge: 'bad'
      });
    } else if (cls.isThreatCue && (threatEvents.length === 0 || tSec - threatEvents[threatEvents.length - 1].time > 0.4)) {
      threatEvents.push({
        time: tSec,
        type: '⚠️ ACOUSTIC THREAT CUE',
        action: 'Tactical Pass-Through Enabled (Spatial Cue Preserved)',
        status: 'PRESERVED',
        badge: 'good'
      });
    } else if (cls.isVoice && (threatEvents.length === 0 || tSec - threatEvents[threatEvents.length - 1].time > 0.6)) {
      threatEvents.push({
        time: tSec,
        type: '🎙️ TACTICAL SQUAD COMMS',
        action: 'Speech Formants Isolated (250Hz - 3.4kHz)',
        status: 'ENHANCED',
        badge: 'good'
      });
    }
  }

  // Run deep enhancement & selective transparency
  const enhResult = AIML_ENHANCER.processSignal(rawSignal, p10TacticalMode);

  p10Data = {
    rawSignal,
    enhancedSignal: enhResult.enhancedSignal,
    logMelHistory,
    classProbsHistory,
    muHistory,
    timeAxis,
    threatEvents,
    numFrames,
    fs
  };

  // Render Visuals
  drawP10Spectrogram(cvFeats, logMelHistory, classProbsHistory, numFrames);
  drawP10MuController(cvMu, timeAxis, muHistory, threatEvents);
  updateP10ClassifierRadar(classProbsHistory);
  updateP10ThreatLog(threatEvents);
  updateP10Telemetry();
}

/* ---------- Visualizer 1: Log-Mel Spectrogram & Neural Feature Map ---------- */
function drawP10Spectrogram(canvas, logMelHistory, classProbsHistory, numFrames) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#06090D';
  ctx.fillRect(0, 0, W, H);

  const numBands = 16;
  const cellW = Math.max(1, W / numFrames);
  const cellH = H / numBands;

  // Draw Log-Mel heatmap
  for (let f = 0; f < numFrames; f++) {
    const mel = logMelHistory[f];
    const px = f * cellW;

    for (let m = 0; m < numBands; m++) {
      // Invert Y so low frequency is at bottom
      const py = H - (m + 1) * cellH;
      const val = Math.max(0, Math.min(1.0, (mel[m] + 8.0) / 10.0));

      // Color mapping: dark blue -> tactical cyan -> neon purple -> bright yellow
      let r = 0, g = 0, b = 0;
      if (val < 0.35) {
        b = Math.floor((val / 0.35) * 220);
        g = Math.floor((val / 0.35) * 70);
      } else if (val < 0.7) {
        const norm = (val - 0.35) / 0.35;
        b = Math.floor(220 * (1 - norm) + 255 * norm);
        g = Math.floor(70 + 160 * norm);
        r = Math.floor(120 * norm);
      } else {
        const norm = (val - 0.7) / 0.3;
        r = Math.floor(120 + 135 * norm);
        g = Math.floor(230 + 25 * norm);
        b = Math.floor(255 * (1 - norm) + 80 * norm);
      }

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px, py, Math.ceil(cellW) + 0.5, Math.ceil(cellH) + 0.5);
    }
  }

  // Draw Time & Frequency Grid Overlays
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let s = 1; s <= 3; s++) {
    const gx = (s / 4.0) * W;
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, H);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`${s}.0s`, gx + 4, H - 6);
  }

  // Frequency Labels
  ctx.fillStyle = 'rgba(0, 229, 255, 0.75)';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillText('8.0 kHz', 8, 14);
  ctx.fillText('2.4 kHz (Speech)', 8, H * 0.45);
  ctx.fillText('80 Hz (Engine)', 8, H - 8);
}

/* ---------- Visualizer 2: Neural Step-Size µ(t) & Stability Supervisor ---------- */
function drawP10MuController(canvas, timeAxis, muHistory, threatEvents) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#080D14';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let y = 0.2; y <= 0.8; y += 0.2) {
    ctx.beginPath();
    ctx.moveTo(0, y * H);
    ctx.lineTo(W, y * H);
    ctx.stroke();
  }

  // Highlight Impulse Freeze Zones
  ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
  for (const ev of threatEvents) {
    if (ev.type.includes('GUNFIRE')) {
      const px = (ev.time / 4.0) * W;
      ctx.fillRect(px - 4, 0, 28, H);
    }
  }

  // Plot µ(t) Curve
  const maxMu = 0.012;
  ctx.strokeStyle = '#00D2FF';
  ctx.lineWidth = 2.4;
  ctx.beginPath();

  for (let i = 0; i < timeAxis.length; i++) {
    const px = (timeAxis[i] / 4.0) * W;
    const py = H - (muHistory[i] / maxMu) * (H * 0.82) - H * 0.08;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Baseline reference µ line
  const basePy = H - (0.005 / maxMu) * (H * 0.82) - H * 0.08;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, basePy);
  ctx.lineTo(W, basePy);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillText('Nominal µ = 0.005', 10, basePy - 4);
  ctx.fillStyle = '#00D2FF';
  ctx.fillText('AI Neural Dynamic µ(t)', 10, 18);
  ctx.fillStyle = '#EF4444';
  ctx.fillText('Blast Freeze Zone (µ = 0)', W - 180, 18);
}

/* ---------- Classifier Confidence Multi-Bar Radar ---------- */
function updateP10ClassifierRadar(classProbsHistory) {
  const radarEl = document.getElementById('p10ProbRadar');
  if (!radarEl || classProbsHistory.length === 0) return;

  // Average probability over the last 20% of frames
  const startF = Math.floor(classProbsHistory.length * 0.7);
  const avgProbs = new Float32Array(5);
  let count = 0;

  for (let f = startF; f < classProbsHistory.length; f++) {
    for (let c = 0; c < 5; c++) {
      avgProbs[c] += classProbsHistory[f][c];
    }
    count++;
  }
  for (let c = 0; c < 5; c++) avgProbs[c] /= Math.max(1, count);

  let html = '';
  AIML_CONFIG.classes.forEach((cls, i) => {
    const pct = (avgProbs[i] * 100).toFixed(1);
    const isDominant = avgProbs[i] > 0.35;
    html += `
      <div class="ai-class-bar ${isDominant ? 'dominant' : ''}">
        <div class="ai-class-header">
          <span>${cls.icon} <b>${cls.label}</b></span>
          <span class="num" style="color:${cls.color}">${pct}%</span>
        </div>
        <div class="track">
          <div class="fill" style="width:${pct}%;background:${cls.color}"></div>
        </div>
      </div>
    `;
  });

  radarEl.innerHTML = html;
}

/* ---------- Real-Time Threat Event Log ---------- */
function updateP10ThreatLog(threatEvents) {
  const logEl = document.getElementById('p10ThreatLog');
  if (!logEl) return;

  if (threatEvents.length === 0) {
    logEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:8px">No tactical anomalies detected in current window. Continuous background tracking active.</div>`;
    return;
  }

  let html = '';
  threatEvents.slice(-6).forEach(ev => {
    html += `
      <div class="threat-log-item">
        <span class="threat-time">${ev.time.toFixed(2)}s</span>
        <span class="threat-name">${ev.type}</span>
        <span class="threat-action">${ev.action}</span>
        <span class="badge ${ev.badge}">${ev.status}</span>
      </div>
    `;
  });
  logEl.innerHTML = html;
}

/* ---------- Edge NPU/MCU Hardware Telemetry ---------- */
function updateP10Telemetry() {
  const prof = getEdgeAIProfile();
  const el = document.getElementById('p10Telemetry');
  if (!el) return;

  el.innerHTML = `
    <div class="readouts">
      <div class="readout good">
        <div class="lbl">Active ANC Core 0 Latency</div>
        <div class="val">${prof.activeAncLatencyUs}<span class="u">µs</span></div>
      </div>
      <div class="readout good">
        <div class="lbl">Edge AI Frame Latency</div>
        <div class="val">${prof.aiInferenceLatencyMs}<span class="u">ms</span></div>
      </div>
      <div class="readout info">
        <div class="lbl">Inference Workload</div>
        <div class="val">${prof.macPerInference}</div>
      </div>
      <div class="readout info">
        <div class="lbl">SRAM DTCM Footprint</div>
        <div class="val">${prof.ramUsageKb}<span class="u">KB</span></div>
      </div>
      <div class="readout good">
        <div class="lbl">Power Consumption</div>
        <div class="val">${prof.powerConsumptionMw}</div>
      </div>
    </div>
  `;
}

/* ---------- Audio Transport Player for Panel 10 ---------- */
function initP10Audio() {
  p10Ctx = p10Ctx || new (window.AudioContext || window.webkitAudioContext)();
  return p10Ctx;
}

function startAudioP10(from = 0) {
  if (p10SrcNode) {
    p10SrcNode.onended = null;
    try { p10SrcNode.stop(); } catch (e) {}
    p10SrcNode = null;
  }
  if (!p10Data || !p10Data.enhancedSignal) return;

  const actx = initP10Audio();
  const buffer = actx.createBuffer(1, p10Data.enhancedSignal.length, p10Data.fs);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < p10Data.enhancedSignal.length; i++) {
    ch[i] = Math.max(-1.0, Math.min(1.0, p10Data.enhancedSignal[i] * 0.8));
  }

  p10SrcNode = actx.createBufferSource();
  p10SrcNode.buffer = buffer;
  p10SrcNode.connect(actx.destination);
  p10SrcNode.loop = true;
  p10SrcNode.start(0, from);
  p10StartedAt = actx.currentTime - from;
  p10Playing = true;

  const playBtn = document.getElementById('p10PlayBtn');
  if (playBtn) playBtn.textContent = 'Pause';
}

function stopAudioP10() {
  if (p10SrcNode) {
    p10SrcNode.onended = null;
    try { p10SrcNode.stop(); } catch (e) {}
    p10SrcNode = null;
  }
  p10Playing = false;
  const playBtn = document.getElementById('p10PlayBtn');
  if (playBtn) playBtn.textContent = 'Play Tactical Audio';
}

// Event Listeners for Panel 10
document.addEventListener('DOMContentLoaded', () => {
  // Scenario Picker
  const scenarioGroup = document.getElementById('p10ScenarioGroup');
  if (scenarioGroup) {
    scenarioGroup.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !b.dataset.v) return;
      scenarioGroup.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      p10Scenario = b.dataset.v;
      runP10();
      if (p10Playing) startAudioP10(0);
    });
  }

  // Tactical Mode Picker
  const modeGroup = document.getElementById('p10ModeGroup');
  if (modeGroup) {
    modeGroup.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !b.dataset.v) return;
      modeGroup.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      p10TacticalMode = b.dataset.v;
      const modeDesc = document.getElementById('p10ModeDesc');
      if (modeDesc && AIML_CONFIG.tacticalModes[p10TacticalMode]) {
        modeDesc.textContent = AIML_CONFIG.tacticalModes[p10TacticalMode].desc;
      }
      runP10();
      if (p10Playing) startAudioP10(0);
    });
  }

  // Audio Play Button
  const playBtn = document.getElementById('p10PlayBtn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      initP10Audio();
      if (p10Ctx.state === 'suspended') p10Ctx.resume();
      if (p10Playing) {
        stopAudioP10();
      } else {
        startAudioP10(0);
      }
    });
  }
});
