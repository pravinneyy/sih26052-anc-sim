# Problem Overview — SIH26052: Adaptive Noise Cancellation for Defence Environments

**Organization:** DRDO
**Category:** Hardware
**Problem Statement ID:** SIH26052

> **Status label:** This document describes the official problem statement and our team's current Round‑1 interpretation of it. It does not claim completed hardware or field results.

---

## 1. Purpose of this Document

This document is the entry point of our technical documentation package. It states the problem as given, explains why the problem is hard, and defines the scope our team is addressing in Round 1 versus what is planned for later rounds. All other documents in this `docs/` package build on the scope defined here.

## 2. Problem Statement (as given)

Defence personnel operating in environments such as vehicle cabins, aircraft cockpits, control rooms, and field posts are continuously exposed to high-intensity, often non-stationary acoustic noise (engine/rotor noise, wind, mechanical vibration, and unpredictable **impulsive** events such as gunfire, blasts, or hatch/door slams). Conventional passive hearing protection reduces sound energy uniformly but cannot adapt to changing noise character, and it degrades speech intelligibility and situational awareness. The problem calls for an **adaptive noise cancellation (ANC)** solution capable of:

- Continuously attenuating steady/non-stationary background noise.
- Detecting and safely handling sudden high-amplitude impulsive events without instability or hardware/hearing risk.
- Preserving speech intelligibility and situational awareness for the operator.
- Being feasible for eventual embedded/real-time hardware deployment in a defence environment.

## 3. Why This Problem Is Difficult

| Challenge | Explanation |
|---|---|
| Non-stationary noise | Defence acoustic environments vary continuously (engine RPM changes, wind gusts, terrain), so a fixed filter cannot track the true noise path. |
| Impulsive disturbances | Gunfire/blast-like transients have very high instantaneous energy and short duration; classical adaptive filters such as LMS/FxLMS are derived under a minimum-mean-square-error assumption and can become unstable or diverge when driven by heavy-tailed, non-Gaussian impulsive inputs. |
| Secondary-path uncertainty | The acoustic/electrical path from the canceling loudspeaker to the error microphone (the *secondary path*) is not perfectly known and changes with fit, temperature, and component ageing; mismatch between the estimated and actual secondary path degrades stability and performance. |
| Real-time constraint | Any cancellation signal must be computed within a few milliseconds to remain correlated with the noise it is meant to cancel, which limits algorithm complexity on embedded hardware. |
| Speech preservation | Aggressive noise suppression must not destroy the intelligibility of command speech or situational sounds. |

## 4. Our Round‑1 Scope

Round 1 of our submission is a **software/web-based simulation and demonstration platform**, not a finished embedded product. It is designed to demonstrate algorithmic understanding, methodology, and feasibility analysis rather than to present field-validated hardware performance. The Round‑1 web simulation contains:

1. Architecture panel — visual explanation of the proposed system architecture.
2. Impulse experiment — interactive demonstration of impulsive-noise effects on adaptive filtering.
3. Audio comparison — before/after listening comparison for demonstration purposes.
4. State detector — Normal / Protection / Recovery acoustic-state detection logic.
5. Secondary-path mismatch experiment — interactive 0–40% mismatch sweep.
6. Live in-browser FxLMS — a working client-side FxLMS adaptive filter running in JavaScript.
7. Feasibility and limitations panel — an explicit statement of what is and is not implemented.
8. Illustrative enhancement preview — a hand-written heuristic gain mask used only to illustrate what a speech-enhancement lane could look like.
9. User-recorded/uploaded audio enhancement demonstration — lets a judge/user try the illustrative enhancement mechanism on their own audio.

## 5. Explicit Non-Claims (Round 1)

To keep this documentation package accurate, we explicitly state what is **not** present in the current Round‑1 implementation:

- No trained neural network of any kind is deployed. The "enhancement lane" is a hand-written heuristic gain mask, used purely for illustration.
- No embedded hardware (MCU/DSP) implementation has been built or tested.
- No physical/measured secondary-path or primary-path acoustic data has been collected; all acoustic paths used in the simulation are synthetic/modelled.
- No completed Python `anc_sim.py → results.json/WAV` offline pipeline exists yet; this is documented as intended future architecture (see `05_Simulation/Simulation_Methodology.md`).
- No field or lab-measured attenuation, latency, or robustness numbers exist yet; experiment documents use explicit placeholders for pending results.

## 6. Relationship Between Official Specification and Team Implementation

Throughout this documentation package we distinguish:

- **Official SIH Round 1 specification** — the problem statement and expected deliverables as issued by DRDO/SIH.
- **Team implementation** — the specific architecture, code, and demonstration our team has built to address the specification, including any design choices (e.g., the specific state-detector thresholding scheme or the illustrative gain-mask heuristic) that are our own engineering decisions and not mandated by the official statement.

Every algorithm document in `03_Algorithms/` contains a dedicated subsection making this distinction explicit.

## 7. Document Map

| Folder | Contents |
|---|---|
| `01_Problem_Statement/` | This document |
| `02_System_Architecture/` | End-to-end architecture of the Round‑1 simulation |
| `03_Algorithms/` | ANC theory, FxLMS, state detector, protection/recovery, robust ANC, secondary-path modelling |
| `04_AI_ML/` | Enhancement lane (explicitly future/illustrative) |
| `05_Simulation/` | Simulation methodology, current vs. future pipeline |
| `06_Experiments/` | Experiment protocols (objective/setup/procedure — not fabricated results) |
| `07_Hardware/` | Hardware feasibility analysis (projected, not measured) |
| `08_References/` | Research paper references |

## 8. Labeling Convention Used Throughout This Package

| Label | Meaning |
|---|---|
| **Implemented** | Working in the current Round‑1 web simulation/codebase today. |
| **Partially Implemented** | Core logic exists but is simplified, simulated, or missing sub-components. |
| **Illustrative** | Present in the demo for explanatory purposes only; not a validated or production algorithm. |
| **Future Work** | Planned but not yet started or not yet functional. |
