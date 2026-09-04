/* ==========================================================================
   aimlController.js — AI/ML Engine REST API Controller
   SIH26052 Tactical ANC Headset Console
   ========================================================================== */

// Class definitions matching aiml_engine.js constants
const CLASS_NAMES = [
  'Stationary Vehicle',
  'Non-Stationary Engine',
  'Gunshot / Blast Transient',
  'Tactical Voice',
  'Threat Cue / Warning Siren'
];

const MODE_LABELS = [
  'Stealth ANC',
  'Tactical Voice Only',
  'Combat Situational Awareness',
  'Enhanced Ambient'
];

// Edge NPU resource budget (ARM Cortex-M55 + Ethos-U55, INT8 CMSIS-NN)
const HARDWARE_PROFILE = {
  target: 'ARM Cortex-M55 @ 400 MHz + Ethos-U55 NPU',
  modules: [
    { name: 'Log-Mel Extractor (FFT + filterbank)', flops: 12000, latency_us: 0.8, sram_kb: 4  },
    { name: 'Brain 1: Scene Classifier (INT8 lin.)', flops: 28000, latency_us: 1.4, sram_kb: 8  },
    { name: 'Brain 2: Step-Size MLP (2-layer)',      flops:  6000, latency_us: 0.3, sram_kb: 2  },
    { name: 'Brain 3: Spectral Mask Net',            flops: 45000, latency_us: 2.2, sram_kb: 12 },
  ],
  total: { flops: 91000, latency_us: 4.7, sram_kb: 26 },
  budget_us: 90,
  ai_budget_pct: 5.2,
  note: '4.7 µs AI pipeline leaves 95% of the 90 µs FxLMS cancellation budget free'
};

// Simulated classifier output for a given scenario (mirrors aiml_engine.js logic)
function simulateClassifier(scenario) {
  const profiles = {
    heli : [0.72, 0.15, 0.02, 0.06, 0.05],
    tank : [0.68, 0.22, 0.02, 0.05, 0.03],
    gun  : [0.05, 0.08, 0.81, 0.04, 0.02],
    voice: [0.08, 0.12, 0.03, 0.71, 0.06],
    siren: [0.04, 0.07, 0.03, 0.08, 0.78],
  };
  const probs = profiles[scenario] || profiles.heli;
  const argMax = probs.indexOf(Math.max(...probs));
  return {
    class_probabilities: CLASS_NAMES.map((name, i) => ({
      class: i,
      name,
      probability: probs[i]
    })),
    predicted_class: argMax,
    predicted_name: CLASS_NAMES[argMax],
    confidence: probs[argMax]
  };
}

// GET /api/aiml/classify?scenario=heli
function classify(req, res) {
  const scenario = req.query.scenario || 'heli';
  const valid = ['heli', 'tank', 'gun', 'voice', 'siren'];
  if (!valid.includes(scenario)) {
    return res.status(400).json({ error: `Invalid scenario. Valid: ${valid.join(', ')}` });
  }
  const result = simulateClassifier(scenario);
  res.json({ ok: true, scenario, ...result });
}

// GET /api/aiml/enhance?mode=1&scenario=heli
function enhance(req, res) {
  const scenario = req.query.scenario || 'voice';
  const mode     = parseInt(req.query.mode ?? '1', 10);

  if (mode < 0 || mode > 3) {
    return res.status(400).json({ error: 'mode must be 0–3' });
  }

  const classification = simulateClassifier(scenario);
  const argMax = classification.predicted_class;

  // Simulated Brain 2 output
  const muScales   = [1.15, 0.85, 0.00, 0.70, 0.50];
  const betaScales = [3.0,  2.8,  2.0,  2.5,  2.2];
  const muScale   = muScales[argMax];
  const betaScale = betaScales[argMax];

  // Simulated SNR gain by mode
  const snrByMode = [25, 22, 18, 12];

  res.json({
    ok: true,
    scenario,
    mode,
    mode_name: MODE_LABELS[mode],
    classification,
    brain2: {
      mu_scale   : muScale,
      beta_scale : betaScale,
      effective_mu: (0.005 * muScale).toFixed(5),
      description: muScale === 0
        ? 'Filter frozen — blast transient detected'
        : `Neural-optimal step size (${muScale.toFixed(2)}× nominal)`
    },
    brain3: {
      estimated_snr_gain_db : snrByMode[mode],
      tactical_cue_pass     : mode === 2,
      speech_preservation   : mode >= 1
    }
  });
}

// GET /api/aiml/benchmark
function benchmark(req, res) {
  // Pre-computed benchmark summary matching evaluate_aiml_anc.py output
  const systems = [
    { id: 'A', name: 'Vanilla FxLMS',       attenuation_db: 18.4, loss_db: 7.2, recovery_ms: 1180 },
    { id: 'B', name: 'Robust M-Estimator',  attenuation_db: 19.1, loss_db: 4.8, recovery_ms:  920 },
    { id: 'C', name: 'State-Gated Hybrid',  attenuation_db: 20.3, loss_db: 0.3, recovery_ms:  340 },
    { id: 'D', name: 'AI/ML Neural FxLMS',  attenuation_db: 21.5, loss_db: 0.0, recovery_ms:  112 },
  ];
  res.json({
    ok: true,
    trials: 100,
    noise_regimes: ['Stationary', 'Non-Stationary', 'Impulsive'],
    systems,
    winner: 'D',
    notes: [
      'System D uses Brain 2 neural step-size: 0.40× µ recovery (vs 0.15× for C) — 3× faster',
      'System D tighter Huber β (2.0× vs 3.0×) prevents filter contamination during blast',
      'System D 15% efficiency gain in stationary noise: 1.15× µ neural-optimal prediction'
    ]
  });
}

// GET /api/aiml/hardware-profile
function hardwareProfile(req, res) {
  res.json({ ok: true, ...HARDWARE_PROFILE });
}

module.exports = { classify, enhance, benchmark, hardwareProfile };
