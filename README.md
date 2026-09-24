# SIH26052 — Adaptive Noise Cancellation & Hardware Console

Interactive simulation and hardware architecture console for the SIH26052 Adaptive Noise Cancellation solution.

## Overview & Architecture

The project features a **Dual-Lane Signal Processing Architecture**:
1. **48 kHz Cancellation Lane**: Hard real-time active noise cancellation (<90 µs latency budget) running robust normalized FxLMS with M-estimation and state-gated step-size adaptation on Core 0 of an ARM Cortex-M7 microcontroller.
2. **16 kHz Speech Enhancement Lane**: Causal subband spectral mask engine (12 ms latency budget) isolating speech harmonics from background acoustic noise on Core 1.
3. **Shared Acoustic State & Transient Detector**: Energy ratio classifier monitoring reference microphone signals to gate filter adaptation during acoustic transients.

## Eight Interactive Panels

1. **System Architecture & Hardware Specs**: Interactive SVG architecture diagram, hardware specifications grid (ARM Cortex-M7 @ 480 MHz, Dual I2S Audio Codecs, MEMS Mic Array), latency budget, and complete itemized Bill of Materials (BOM).
2. **Impulse Experiment**: Real-time simulation of system stability under high-energy acoustic transients (Vanilla FxLMS vs Robust M-Estimate vs State-Gated Hybrid).
3. **Audio Comparison**: WebAudio transport comparing unprocessed microphone input against Candidate ANC controllers.
4. **Transient Detector**: Energy ratio threshold tuning, measuring Detection Probability ($P_d$) and False Alarm Rate ($P_{fa}$) under impulse and loud speech scenarios.
5. **Secondary Path Mismatch**: Secondary-path model error stability sweep (0% to 40%).
6. **Live Adaptive Filter Simulator**: Interactive parameter tuning for step size $\mu$ and filter tap length $L$.
7. **Subband Speech Enhancement**: Spectral subband mask gain visualization across Bark frequency bands.
8. **Live Audio Lab**: Continuous, real-time enhancement — microphone (or a file/demo clip played through the same path) run live through the trained CRN/GRU neural model, with enhanced audio audible within a couple of chunks. No record-then-process step.

## Running the Console

**Directly in any Browser (No install required, works 100% offline):**

Open `public/index.html` in a web browser. Every panel works this way **except** panel 8's live neural engine —
browsers block a `file://` page from loading the ONNX model, so that panel needs the dev server below.

**Dev Server (required for the Live Audio Lab's neural engine):**

```bash
npm install
npm start   # Runs Express server at http://localhost:3000
```

## Responsive UI/UX

- **Desktop & Mobile Support**: Responsive sidebar navigation with collapsible mobile drawer.
- **High-DPI Canvas Rendering**: Sharp chart plotting supporting Retina / 4K displays (`devicePixelRatio` scaling).
- **Keyboard Navigation**:
  - `←` / `→` arrow keys: Switch panels
  - `R`: Reset active panel parameters
  - `Space`: Trigger impulse event (Panel 2)

## AI/ML Voice Enhancement Pipeline

The project includes a compact CRN/GRU training and batch-inference path in `sih_python/`:

- `ml_audio_model.py`: Tiny CRN/GRU mask model with noise-class, VAD, and impulse heads.
- `train_crn_gru_voice_mask.py`: trains on clean speech mixed with MAD/noise datasets.
- `batch_enhance_crn_gru.py`: enhances a requested number of operator audio files and reports stationary / non-stationary / impulsive predictions.
- `CRN_GRU_AUDIO_ML.md`: dataset layout and commands.

Quick batch command after training:

```bash
python sih_python/batch_enhance_crn_gru.py --checkpoint models/crn_gru_voice_mask.pt --input-dir incoming_audio --max-files 25
```
