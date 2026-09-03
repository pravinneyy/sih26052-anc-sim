# State Detector

## 1. Purpose
Document the energy-ratio-based acoustic-state detector that classifies the current acoustic condition into **Normal**, **Protection**, or **Recovery** states, and describe how this classification interacts with the FxLMS controller.

## 2. Why an Acoustic-State Detector Is Needed
As established in `FxLMS_Algorithm.md` §17, plain FxLMS is not inherently robust to impulsive disturbances: a large-amplitude transient can drive a destabilizing weight update. Rather than redesigning the core adaptive algorithm (which trades away its simplicity/real-time suitability — see `Robust_ANC.md`), our approach adds a lightweight **state-dependent gating layer**: a detector continuously classifies the acoustic condition and this classification informs how the adaptive filter should behave (see `Protection_and_Recovery.md`).

## 3. Basic Concept
The detector monitors short-time signal energy (on the reference and/or error signal, depending on configuration) and compares it against a slowly-adapting background-energy estimate. A large, sudden increase in the ratio of instantaneous to background energy is interpreted as evidence of an impulsive/abnormal acoustic event.

## 4. Energy-Ratio Based Detection

For a short analysis frame of length `N` ending at sample `n`, the short-time energy is:

```
E(n) = (1/N) · Σ_{k=0}^{N-1} x(n-k)^2
```

A slowly-updated background/reference energy level `E_bg(n)` is maintained, e.g. via an exponential moving average:

```
E_bg(n) = (1-α) · E_bg(n-1) + α · E(n)      for α small (slow adaptation)
```

The detection statistic is the energy ratio:

```
R(n) = E(n) / E_bg(n)
```

## 5. Thresholding
The detector compares `R(n)` against threshold(s) to determine state transitions:

```
if R(n) > T_protect:   candidate for Protection state
elif R(n) < T_recover:  candidate for return to Normal (after Recovery)
else:                    remain in current state
```

**Note:** The exact numeric threshold values (`T_protect`, `T_recover`), frame length `N`, and smoothing factor `α` used in our implementation are configurable simulation parameters exposed in the State Detector panel; they are **tuning parameters to be finalized** through experimentation (see `06_Experiments/Detector_Evaluation.md`) rather than fixed values derived from field data, since no physical acoustic measurements have been taken yet.

## 6. States

| State | Meaning |
|---|---|
| **Normal** | No impulsive event detected; FxLMS adapts normally. |
| **Protection** | An impulsive/abnormal event has been detected; the system is intended to limit further disruption to the adaptive filter (see `Protection_and_Recovery.md`). |
| **Recovery** | The event has subsided; the system is transitioning back toward Normal operation in a controlled manner rather than resuming full adaptation instantaneously. |

## 7. State Transitions

```
        R(n) > T_protect
 Normal ───────────────────► Protection
   ▲                              │
   │                              │ event subsides
   │        R(n) < T_recover      ▼
   └───────────────────────── Recovery
```

The precise transition logic (e.g., minimum dwell time in Protection, hysteresis between thresholds) implemented in the simulation is documented in the panel's own configuration and should be read alongside the codebase; this document describes the general detection principle rather than asserting specific numeric behaviour not present in the source material.

## 8. Detection Probability and False Alarm Probability
In detection-theory terms, the detector's performance can be characterized by:
- **Detection probability `P_d`**: probability that a genuine impulsive event triggers Protection state.
- **False alarm probability `P_fa`**: probability that a non-impulsive event (e.g., a loud but legitimate sound) incorrectly triggers Protection state.

These are standard detection-theory metrics; **no measured `P_d`/`P_fa` values exist yet** for our system — see `06_Experiments/Detector_Evaluation.md`, which defines the protocol for measuring them (currently unexecuted, results pending).

## 9. False Positives During Loud Speech
Because the detector operates on short-time energy, a sufficiently loud and abrupt speech event (e.g., a shout) can, in principle, produce an energy ratio similar to a genuine impulsive disturbance, causing a false Protection-state trigger. This is a known limitation of purely energy-based detection (consistent with the broader acoustic-event-detection literature — see `08_References/Research_Papers.md`) and is explicitly tested in `06_Experiments/Detector_Evaluation.md` (Experiment 7: Loud-speech false-alarm test). No claim is made that our current threshold scheme has been validated against this failure mode; more discriminative features (e.g., harmonicity/spectral-shape cues used to distinguish speech from impulsive noise in the literature) are noted as **future work**.

## 10. How the Detector Interacts with FxLMS
The detector's current-state output is passed to the FxLMS update logic as a gating/conditioning signal. The specific behaviour induced by each state (e.g., whether adaptation is paused, slowed, or otherwise modified) is described in `Protection_and_Recovery.md`, where we are careful to only describe behaviour that is present in the implementation or explicitly mark it "to be finalized" where it is not.

## 11. Inputs and Outputs
- **Inputs:** reference and/or error signal samples; configuration parameters (`N`, `α`, thresholds).
- **Outputs:** discrete state label (`Normal` / `Protection` / `Recovery`) per frame, consumed by the FxLMS gating logic and displayed in the UI panel.

## 12. Important Parameters
- Analysis frame length `N`.
- Background-energy smoothing factor `α`.
- Threshold pair `T_protect`, `T_recover`.

## 13. Advantages
- Computationally cheap (short-time energy computation), suitable for real-time/embedded use.
- Simple to reason about and tune interactively, which suits a Round‑1 demonstration.
- Decouples "is something abnormal happening" from "how should the filter respond," allowing the two concerns to be developed and evaluated independently.

## 14. Limitations
- Energy-only features cannot reliably distinguish loud legitimate sounds (e.g., speech, shouted commands) from genuinely disruptive impulsive noise — a known challenge in acoustic event detection.
- Threshold values are environment-dependent and currently untuned against real acoustic data.
- Detector latency (frame length `N`) trades off against how quickly a genuine impulse can be caught.

## 15. How It Is Used in SIH26052
The state detector is the mechanism by which our system is intended to distinguish "normal adaptive-noise-cancellation operating conditions" from "an impulsive/defence-relevant disturbance event," directly addressing the problem statement's requirement to handle impulsive noise safely.

## 16. Relationship to Our Current Implementation
**Implemented:** energy-ratio computation, thresholded state classification, and the Normal/Protection/Recovery state machine, all running on synthetic signals in the browser simulation. **Not implemented / to be finalized:** threshold values validated against real acoustic data; speech-vs-impulse discrimination beyond simple energy thresholding; measured detection/false-alarm statistics.

## 17. Relevant Research References
Giannoulis et al. (2015) on detection/classification/localization of acoustic events; general acoustic transient/onset detection literature — see `08_References/Research_Papers.md`.
