# System Architecture — SIH26052 Round 1 Simulation

## 1. Purpose

This document describes the architecture of the current web-based Round‑1 simulation and how its nine panels relate to one another and to the underlying ANC algorithms documented in `03_Algorithms/`.

## 2. High-Level Architecture

```
                 ┌────────────────────────────────────────────┐
                 │            Browser Application               │
                 │  (client-side JavaScript, no server compute) │
                 └────────────────────────────────────────────┘
                                    │
        ┌───────────────┬──────────┼───────────┬───────────────┐
        ▼               ▼          ▼           ▼               ▼
 Architecture      Impulse      Live FxLMS   Secondary-Path   Enhancement
   Panel          Experiment      Engine      Mismatch Exp.     Preview
 (explains        (injects       (adaptive   (0–40% sweep on   (illustrative
  design)          impulses,     filter runs  estimated Ŝ(z)   gain-mask
                   shows filter   in-browser,  vs actual S(z))  heuristic on
                   response)      updates      demonstrates     uploaded/
                                  weights per   stability        recorded
                                  sample)       degradation)     audio)
        │               │             │            │               │
        └───────────────┴─────────────┴────────────┴───────────────┘
                                    │
                          ┌──────────────────┐
                          │  State Detector   │
                          │ (Normal/Protect/  │
                          │   Recovery logic) │
                          └──────────────────┘
                                    │
                          ┌──────────────────┐
                          │ Audio Comparison  │
                          │  & Feasibility/    │
                          │ Limitations Panel  │
                          └──────────────────┘
```

**Status:** All nine panels above are **Implemented** in the sense that they exist and run client-side in the browser. The FxLMS engine and state detector implement real signal-processing logic (see `03_Algorithms/`); the enhancement preview is explicitly **Illustrative**.

## 3. Panel-by-Panel Description

### 3.1 Architecture Panel — *Implemented*
A static/interactive explainer view that lays out the overall system concept (reference mic → controller → secondary source → error mic, plus the state detector and, prospectively, the enhancement lane) for judges and reviewers.

### 3.2 Impulse Experiment — *Implemented*
Lets the user inject synthetic impulsive disturbances into the simulated noise signal and observe the resulting filter/error behaviour. Used to visually demonstrate why plain FxLMS struggles with impulsive noise (see `06_Experiments/Impulse_Experiment.md`).

### 3.3 Audio Comparison — *Implemented*
A before/after playback panel that lets a user listen to the simulated primary noise vs. the (simulated) residual error signal after cancellation, for qualitative demonstration.

### 3.4 State Detector — *Implemented*
Runs an energy-ratio-based detector on the simulated error/reference signal and classifies the current condition into **Normal**, **Protection**, or **Recovery** states (see `03_Algorithms/State_Detector.md`).

### 3.5 Secondary-Path Mismatch Experiment — *Implemented*
Allows the user to sweep the mismatch between the estimated secondary path Ŝ(z) used inside FxLMS and an actual secondary path S(z) used to generate the simulated error signal, from 0% to 40%, and observe convergence/stability effects.

### 3.6 Live In-Browser FxLMS — *Implemented*
A JavaScript implementation of the FxLMS adaptive filter that updates its coefficients sample-by-sample on synthetic/simulated signals directly in the browser (no server-side or embedded computation).

### 3.7 Feasibility and Limitations Panel — *Implemented*
An explicit, judge-facing statement of what is simulated vs. real, and what remains future work — the same distinctions maintained throughout this documentation package.

### 3.8 Illustrative Enhancement Preview — *Illustrative, not a trained model*
Applies a hand-written heuristic gain mask (not a neural network) to demonstrate, conceptually, what a speech-enhancement lane placed alongside ANC might accomplish. See `04_AI_ML/Enhancement_Lane.md` for the explicit non-claim statement.

### 3.9 User-Recorded/Uploaded Audio Enhancement Demonstration — *Implemented (heuristic only)*
Lets a user record or upload their own audio clip and run it through the same illustrative heuristic gain-mask mechanism as §3.8, for hands-on demonstration purposes.

## 4. Data Flow Within the Browser

1. A synthetic reference signal (and, where relevant, a synthetic primary-noise/impulse signal) is generated in JavaScript.
2. The signal is passed through a simulated primary path and/or a simulated secondary path (simple synthetic filters — see `05_Simulation/Simulation_Methodology.md`), never a measured physical path.
3. The Live FxLMS engine (§3.6) filters the reference signal through an *estimated* secondary path, computes the adaptive filter output, and forms an error signal.
4. The State Detector (§3.4) continuously monitors this error/reference signal and outputs a state label used to gate/condition the FxLMS update logic (see `03_Algorithms/Protection_and_Recovery.md`).
5. Results are rendered as plots/audio in the Audio Comparison and Impulse/Mismatch experiment panels — all rendering and computation happens client-side; there is no server-side signal-processing backend in the current implementation.

## 5. What Is Explicitly Not Part of Current Architecture

- No microphone/speaker hardware interface.
- No embedded MCU/DSP firmware.
- No physically measured acoustic paths.
- No server-side processing pipeline or trained model inference.
- No completed offline Python simulation → `results.json`/WAV → static-site pipeline (see `05_Simulation/Simulation_Methodology.md` §4 for the intended future version of this).

## 6. Relationship to Algorithm Documents

| Architecture Element | Detailed in |
|---|---|
| FxLMS engine | `03_Algorithms/FxLMS_Algorithm.md` |
| State detector | `03_Algorithms/State_Detector.md` |
| Protection/Recovery gating | `03_Algorithms/Protection_and_Recovery.md` |
| Robustness comparison | `03_Algorithms/Robust_ANC.md` |
| Secondary path | `03_Algorithms/Secondary_Path_Modeling.md` |
| Enhancement preview | `04_AI_ML/Enhancement_Lane.md` |
