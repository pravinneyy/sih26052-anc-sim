# Simulation Methodology

## 1. Purpose
Document how signals are generated, processed, and visualized in the current browser-based Round‑1 simulation, and clearly separate the currently implemented client-side pipeline from the intended future offline Python-based pipeline.

## 2. Currently Implemented: Client-Side Browser Simulation

All computation in Round 1 runs client-side in JavaScript, in the user's browser, with no server-side signal processing and no physical audio hardware interface.

### 2.1 Acoustic Signal Generation — *Implemented*
Reference/noise signals used across panels are synthetically generated in JavaScript (e.g., combinations of stationary broadband noise, tonal components, and, for relevant experiments, injected impulsive events). These are not recordings of real defence-environment noise.

### 2.2 Noise Generation — *Implemented*
Includes generation of stationary (steady-state) noise for baseline convergence demonstrations and, separately, controlled impulsive events (single impulses, repeated bursts, amplitude-varied impulses) for the Impulse Experiment panel (see `06_Experiments/Impulse_Experiment.md`).

### 2.3 Acoustic / Secondary-Path Modelling — *Implemented (synthetic)*
The secondary path used inside the live FxLMS engine (`Ŝ(z)`) and the "actual" path used to synthesize the error signal (`S(z)`) are both simple synthetic digital filters, not measured acoustic transfer functions. The Secondary-Path Mismatch panel parametrically varies the difference between them (0–40%).

### 2.4 FxLMS Simulation — *Implemented*
The live in-browser FxLMS engine (see `03_Algorithms/FxLMS_Algorithm.md`) runs sample-by-sample on the synthetic signals described above, updating filter coefficients and computing the residual error signal in real time within the browser.

### 2.5 State Detection — *Implemented*
The energy-ratio-based state detector (see `03_Algorithms/State_Detector.md`) runs concurrently on the simulated signals, producing the Normal/Protection/Recovery classification shown in the State Detector panel.

### 2.6 Impulse Injection — *Implemented*
User-configurable impulse injection (timing, amplitude, repetition) is supported in the Impulse Experiment panel to observe FxLMS/state-detector behaviour under controlled impulsive conditions.

### 2.7 Performance Measurement — *Partially Implemented*
The simulation visualizes convergence curves and error-signal traces in real time, but does not currently compute or export standardized quantitative performance metrics (e.g., dB attenuation, convergence time, misadjustment) as structured result files. Such metrics, where discussed in `06_Experiments/`, are currently placeholders pending a defined measurement/export step.

### 2.8 Secondary-Path Mismatch Sweep — *Implemented*
As described in `03_Algorithms/Secondary_Path_Modeling.md` §9, the mismatch percentage (0–40%) is user-adjustable and its effect is shown live.

### 2.9 Browser Visualization — *Implemented*
All plots (filter convergence, error-signal traces, state timeline) and audio playback (Audio Comparison panel) render directly in the browser using client-side rendering.

### 2.10 Audio Processing — *Implemented (synthetic + user-supplied demo audio)*
Audio processing includes both synthetic demonstration signals and, in the enhancement-preview panels, real user-recorded/uploaded audio processed through the illustrative heuristic gain mask described in `04_AI_ML/Enhancement_Lane.md` — not through any trained model.

## 3. Explicitly Not Implemented in the Simulation
- No physical microphone/speaker input/output.
- No measured acoustic impulse responses.
- No server-side or embedded compute.
- No standardized exported result files (`results.json`, WAV outputs) from a batch simulation run.
- No trained-model inference.

## 4. Intended Future Architecture (Not Yet Built)

The project specification anticipates an eventual offline Python-based simulation pipeline that would generate structured, reproducible results independent of live browser computation, feeding into the same (or an updated) static front-end for offline demonstration:

```text
Python simulation
       ↓
results.json + WAV
       ↓
Static HTML/CSS/JavaScript
       ↓
Offline demonstration
```

**Status: Future Work.** Specifically, none of the following currently exist:
- A Python script/module (e.g., `anc_sim.py`) implementing the FxLMS/state-detector/robust-ANC logic offline.
- A defined `results.json` schema for exporting quantitative performance metrics per experiment.
- Exported WAV files representing simulated before/after audio for offline (non-live) playback.
- A static front-end that consumes these pre-computed files rather than computing everything live in the browser.

This future pipeline is intended to (a) allow heavier/more accurate simulations than are practical in real-time JavaScript, (b) produce reproducible, versioned result artifacts suitable for inclusion in a report or offline demo kit, and (c) decouple result generation from the live browser demo so that judges without an internet-connected live environment can still review pre-computed evidence.

## 5. Inputs and Outputs (Current Client-Side Pipeline)
- **Inputs:** synthetic signal-generation parameters (noise type, impulse timing/amplitude, mismatch %, detector thresholds), optional user-recorded/uploaded audio (enhancement panels only).
- **Outputs:** live plots (convergence, error trace, state timeline), live audio playback, no persisted structured result files at present.

## 6. Important Parameters
- Sampling rate used by the browser audio/simulation context.
- Synthetic noise generation parameters (amplitude, spectral shape, impulse characteristics).
- FxLMS parameters (`μ`, filter length `L`) and detector parameters (frame length, thresholds) as described in `03_Algorithms/`.

## 7. Advantages of the Current Approach
- Zero-install, immediately interactive demonstration suitable for judges to try directly in a browser.
- Keeps Round‑1 scope achievable without requiring physical hardware or a trained model.

## 8. Limitations
- All results are qualitative/illustrative; no field- or lab-measured acoustic data is used anywhere in the pipeline.
- Real-time browser computation constrains achievable simulation fidelity/complexity compared to an offline batch pipeline.
- No persisted, reproducible result artifacts exist yet for inclusion in written reports.

## 9. How It Is Used in SIH26052
The simulation is our primary Round‑1 demonstration vehicle for the algorithms and concepts documented in `03_Algorithms/` and `04_AI_ML/`, and the basis for the experiment protocols in `06_Experiments/`.

## 10. Relationship to Our Current Implementation
Section 2 above **is** the current implementation. Section 4 is explicitly future work, not yet started beyond this architectural intent.
