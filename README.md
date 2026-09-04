# SIH26052 — AI/ML-Assisted Adaptive Tactical Noise Cancellation & Hardware Console

Interactive simulation and embedded hardware architecture console for the **SIH26052 Adaptive, AI/ML-Assisted Tactical Hearing Protection & Communication System**.

Designed for combat military environments featuring mixed **stationary noise** (tank diesel engines, turbine hum), **non-stationary noise** (rotorcraft blade slap, wind buffeting), and **impulsive noise** (gunfire shocks 160+ dBSPL, mortar/rocket blasts) while **preserving speech intelligibility and vital acoustic situational awareness cues**.

---

## Edge AI/ML Tri-Brain & Dual-Lane Signal Processing Architecture

1. **48 kHz Hard Real-Time Active Cancellation Lane (<90 µs Latency Budget)**:
   - Runs on **ARM Cortex-M7 Core 0** @ 480 MHz executing normalized FxLMS with AI dynamic step-size $\mu(t)$ supervision and Huber M-estimation in **84.2 µs**.
2. **Edge AI Multi-Head Neural Threat & Acoustic Classifier (0.86 ms Frame Inference)**:
   - Runs on **Arm Ethos-U55 microNPU / Cortex-M55 (or CMSIS-NN INT8 SIMD)**.
   - Extracts 16 Log-Mel filterbank bands + kurtosis + spectral flux to classify 5 tactical regimes:
     - `Stationary Engine / Turbine Hum`
     - `Non-Stationary Rotor / Wind`
     - `High-Energy Gunfire / Blast Transient`
     - `Tactical Voice / Squad Comms`
     - `Acoustic Threat Cues (Sniper crack, warning siren, footsteps)`
3. **Neural Step-Size ($\mu(t)$) & Stability Supervisor**:
   - Zero-sample instant freeze during blast transients (0.0 dB attenuation lost) and dynamic acceleration back to steady state (<8 ms recovery).
4. **16 kHz Deep Subband Complex Masking & Selective Transparency Lane**:
   - Isolates speech harmonics on Core 1 while selectively passing and enhancing directional threat cues based on tactical mode.

---

## Tactical Operational Modes

- **🛡️ Combat Threat Cue Awareness**: Suppresses continuous engine/rotor rumble while passing through gunfire azimuth, footsteps, and tactical siren alerts for 360° situational awareness.
- **📻 Tactical Radio Comms**: Deep voice harmonic isolation (250 Hz – 3.4 kHz), rejecting all ambient combat noise.
- **🔇 Stealth ANC**: Maximum broadband attenuation (>22 dB) across all acoustic frequency bands.
- **👂 Enhanced Ambient / Whisper Boost**: Amplifies low-level footsteps and whisper commands while clamping loud blasts to safe <85 dBA thresholds.

---

## Ten Interactive Simulation Panels

1. **Solution Architecture & Latency Budget**: Interactive SVG dual-lane signal flow with Edge AI NPU block, hardware specs, and latency budget breakdown.
2. **Hardware & Bill of Materials (BOM)**: STM32H7 + Ethos-U55 NPU specs, Knowles MEMS array, and itemized production BOM (₹13,500/unit).
3. **Impulse Response & Controller Performance**: Live side-by-side comparison of **Vanilla FxLMS (System A)**, **Robust M-Estimator (System B)**, **State-Gated Hybrid (System C)**, and **AI/ML Neural FxLMS (System D)** showing 0.0 dB attenuation lost and <8 ms recovery.
4. **Acoustic Listening Console**: Seamless WebAudio transport player allowing real-time listening comparison between raw input and candidate ANC controllers with tactical threat cue retention.
5. **Transient Energy Classifier**: Energy ratio threshold tuning ($P_d$ and $P_{fa}$ validation).
6. **Secondary-Path Acoustic Mismatch Sweep**: Stability boundary evaluation under transfer function error (0% to 240%).
7. **Adaptive LMS Filter Simulator**: Real-time parameter tuning for step size $\mu$ and filter tap length $L$.
8. **Subband Speech Enhancement Preview**: Demo clip spectral enhancement visualization.
9. **Interactive Audio Lab**: Microphone recording and audio upload lab with live switching between Classical log-MMSE and **AI Deep Complex Subband Masking**.
10. **AI/ML Neural Adaptive Engine & Tactical Cue Classifier**: Real-time 16 Mel-band feature spectrogram, neural classifier probability radar, dynamic $\mu(t)$ trajectory scope, live acoustic threat event stream, and interactive tactical audio synthesizer!

---

## Running the Console

**Directly in any Browser (Zero dependencies, 100% offline):**

Open `public/index.html` in any web browser.

**Development Server & REST API:**

```bash
npm start   # Runs Express server with AI/ML REST endpoints at http://localhost:3000
```

**Python AI/ML Training, Benchmarking & Edge Export Toolchain:**

```bash
# 1. Train synthetic tactical acoustic AI models & export INT8 CMSIS-NN C header
python sih_python/train_acoustic_ai.py

# 2. Run comprehensive 100-trial comparative benchmark across Systems A, B, C, D
python sih_python/evaluate_aiml_anc.py

# 3. Export quantized C weights to c_embedded/arm_nn_weights.h
python sih_python/export_edge_ai.py
```

---

## Keyboard Navigation

- `←` / `→` arrow keys: Switch active panels (1 through 10)
- `R`: Reset active panel parameters
- `Space`: Trigger acoustic transient event (Panel 2)

