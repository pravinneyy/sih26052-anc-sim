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
8. **Interactive Audio Lab**: Microphone recording and audio file upload lab for live spectral mask processing.

## Running the Console

**Directly in any Browser (No install required, works 100% offline):**

Open `public/index.html` in a web browser.

**Optional Dev Server:**

```bash
npm start   # Runs Express server at http://localhost:3000
```

## Responsive UI/UX

- **Desktop & Mobile Support**: Responsive sidebar navigation with collapsible mobile drawer.
- **High-DPI Canvas Rendering**: Sharp chart plotting supporting Retina / 4K displays (`devicePixelRatio` scaling).
- **Keyboard Navigation**:
  - `←` / `→` arrow keys: Switch panels
  - `R`: Reset active panel parameters
  - `Space`: Trigger impulse event (Panel 2)
