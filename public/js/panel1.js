/* ==========================================================================
   panel1.js — Solution Architecture & Hardware Inspector
   ========================================================================== */

const BLOCK_INFO = {
  ref: {
    title: 'External Reference Microphone Array',
    desc: 'Dual Knowles SPU0410LR5H-QB ultra-low-noise MEMS microphones (SNR > 65 dBA, 130 dBSPL Acoustic Overload Point) mounted flush on the outer earcup composite shell.',
    specs: [
      { label: 'Sampling Rate', val: '48.0 kHz' },
      { label: 'Sensitivity', val: '-38 dBV/Pa' },
      { label: 'ADC Topology', val: 'Differential 24-bit I2S' },
      { label: 'Role', val: 'Primary Reference x(n)' }
    ]
  },
  fxlms: {
    title: 'Hard Real-Time Normalized FxLMS DSP Pipeline',
    desc: 'Executes hard real-time Normalized Filtered-X LMS (NFxLMS) on ARM Cortex-M7 Core 0. Features Huber M-estimation and state-gated step adaptation (µ) with guaranteed deterministic latency (<22 µs execution cycle).',
    specs: [
      { label: 'Filter Taps', val: '32–64 FIR Taps' },
      { label: 'Cycle Budget', val: '10,500 Cycles @ 480MHz' },
      { label: 'Memory Bus', val: 'TCM / SRAM1 (AXI Bus)' },
      { label: 'Stability Margin', val: '> 35% S(z) Error Margin' }
    ]
  },
  spk: {
    title: 'Acoustic Actuator & Speaker Driver',
    desc: 'Custom 40mm high-excursion neodymium dynamic transducer driven by an ultra-low-THD Class-D amplifier (MAX98357A), generating instantaneous anti-phase acoustic pressure.',
    specs: [
      { label: 'Frequency Band', val: '20 Hz – 2.4 kHz' },
      { label: 'Max Output SPL', val: '118 dBSPL' },
      { label: 'THD+N', val: '< 0.05% @ 1 kHz' },
      { label: 'DAC Latency', val: '14.0 µs' }
    ]
  },
  err: {
    title: 'Internal Error Microphone Feedback Loop',
    desc: 'Omnidirectional MEMS capsule located inside the ear cavity adjacent to the listener’s ear canal. Captures residual acoustic error e(n) = d(n) - y’(n) to drive gradient weight updates.',
    specs: [
      { label: 'Placement', val: 'Concha / Ear Canal' },
      { label: 'Bandwidth', val: '20 Hz – 8 kHz' },
      { label: 'SNR', val: '66.5 dBA' },
      { label: 'Calibration', val: 'Online S(z) Tracking' }
    ]
  },
  det: {
    title: 'Shared Acoustic State & Transient Energy Classifier',
    desc: 'Monitors short-term energy vs long-term noise floor ratios on the reference mic. Classifies environmental acoustic states (Stationary, Non-Stationary, High-Energy Impulse) to gate adaptation.',
    specs: [
      { label: 'Attack Time', val: '1.2 ms (Ef Tracker)' },
      { label: 'Hold Time', val: '60.0 ms' },
      { label: 'Detection Rate', val: 'Pd > 99.2%' },
      { label: 'False Alarms', val: 'Pfa < 0.1 / min' }
    ]
  },
  boom: {
    title: 'Directional Noise-Canceling Boom Microphone',
    desc: 'Close-talk differential electret/MEMS boom capsule positioned at the mouth. Captures operator speech alongside surrounding cockpit/vehicle acoustic noise.',
    specs: [
      { label: 'Directivity', val: 'Cardioid / Hypercardioid' },
      { label: 'SNR', val: '68.0 dBA' },
      { label: 'Sampling Rate', val: '16.0 kHz' },
      { label: 'ADC Codec', val: 'WM8960 Channel 2' }
    ]
  },
  nn: {
    title: 'Log-MMSE Speech Enhancement Engine',
    desc: 'Ephraim & Malah decision-directed log-MMSE spectral suppression on a 512-point STFT, with minima-controlled recursive noise tracking and a transient detector that freezes the noise estimate during a detected impulse. A published, classical algorithm — try it live on panel 9.',
    specs: [
      { label: 'Frame / Hop', val: '512 / 128 samples, 8 ms hop' },
      { label: 'Gain Rule', val: 'Log-MMSE, decision-directed &alpha;=0.98' },
      { label: 'Core Assignment', val: 'ARM Cortex-M7 Core 1' },
      { label: 'Noise Tracking', val: 'MCRA (Cohen & Berdugo 2002)' }
    ]
  },
  radio: {
    title: 'Tactical Radio & Intercom Output',
    desc: 'Delivers clear, enhanced speech to tactical radios (VHF/UHF, Mil-Spec intercoms) with crystal clarity even in 115 dBSPL cockpit noise.',
    specs: [
      { label: 'Interface', val: 'Balanced Audio / PTT' },
      { label: 'Output Level', val: '0 dBu / 600 Ω' },
      { label: 'Latency', val: '< 15 ms Total Delay' },
      { label: 'Standard', val: 'MIL-STD-810G' }
    ]
  },
  aiml: {
    title: 'Edge AI/ML Tri-Brain Coprocessor & Neural Supervisor',
    desc: 'Real-time neural intelligence engine executing on Arm Cortex-M55 / Ethos-U55 microNPU (or CMSIS-NN INT8 SIMD). Features Multi-Head Acoustic Scene & Threat Cue Classifier, Neural Step-Size (µ(t)) Predictor, and Deep Subband Complex Masking for 0dB blast loss and selective tactical transparency.',
    specs: [
      { label: 'Inference Latency', val: '0.86 ms / 16ms Frame' },
      { label: 'Workload', val: '42.8 kMACs (INT8 Quantized)' },
      { label: 'Memory Footprint', val: '38.4 KB DTCM SRAM' },
      { label: 'Threat Cues', val: 'Gunfire Azimuth & Siren Pass' }
    ]
  }
};

function updateBlockInfo(key) {
  const item = BLOCK_INFO[key] || BLOCK_INFO.fxlms;
  const blockCard = document.getElementById('blockInfo');
  if (!blockCard) return;

  let specsHtml = '';
  if (item.specs && item.specs.length > 0) {
    specsHtml = `
      <div class="spec-highlight">
        ${item.specs.map(s => `
          <div class="spec-box">
            <div class="s-label">${s.label}</div>
            <div class="s-val">${s.val}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  blockCard.innerHTML = `
    <div class="card-header">
      <h3>${item.title}</h3>
      
    </div>
    <p>${item.desc}</p>
    ${specsHtml}
  `;
}

// Attach click listener to SVG blocks
document.querySelectorAll('.blk').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.blk').forEach(x => x.setAttribute('data-sel', x === b));
    const infoKey = b.dataset.info;
    updateBlockInfo(infoKey);
  });
});

// Initialize with FxLMS block highlighted
updateBlockInfo('fxlms');
