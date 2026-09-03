# Robust ANC

## 1. Purpose
Explain why robustness to impulsive disturbances is a distinct concern in ANC design, survey the general classes of robust approaches from the literature, and position our proposed state-gated approach relative to a "vanilla FxLMS" baseline and a "robust baseline" algorithm.

## 2. Why It Is Required in This Project
The SIH26052 problem statement centers on defence environments where impulsive disturbances (gunfire, blasts, impacts) are expected. As shown in `FxLMS_Algorithm.md` §17, the standard FxLMS weight update reacts proportionally to instantaneous error, making it structurally vulnerable to such disturbances. Robust ANC is the research area addressing exactly this vulnerability.

## 3. Basic Concept
Standard LMS/FxLMS is derived by minimizing mean-square error, which implicitly assumes finite-variance, roughly Gaussian disturbances. Impulsive noise is often modelled with heavy-tailed, non-Gaussian statistics (e.g., symmetric α-stable distributions) for which the ordinary second moment may not even be well behaved. Robust adaptive filtering replaces or augments the MSE-based update rule with one that is less sensitive to large-magnitude outliers — for example by using a bounded or saturating nonlinearity on the error term, a different cost function (e.g., least-mean-p-power for p<2), or an outlier-aware step-size/threshold mechanism.

## 4. Three Approaches Compared

### 4.1 Vanilla FxLMS
As described in `FxLMS_Algorithm.md`: standard weight-update `w(n+1) = w(n) + μ·e(n)·x'(n)`, with no special handling of large-error samples. Simple and cheap, but can diverge or produce large transient artifacts when driven by impulsive noise.

### 4.2 Robust Baseline (Literature Approach)
The ANC literature contains several dedicated robust variants, such as filtered-x least-mean-p-power (FxLMP), reference-signal modification schemes, and nonlinear-transform-based algorithms (e.g., hyperbolic-tangent or logarithmic error transforms) designed specifically to bound the influence of outlier samples on the weight update at every time step, continuously — see Mirza, Zeb & Sheikh (2016) and related works cited in `08_References/Research_Papers.md`. These generally trade additional computation and/or slower steady-state convergence for continuous outlier robustness.

### 4.3 Proposed State-Gated Approach (Ours)
Rather than continuously applying a robust nonlinearity to every sample, our proposed approach (see `State_Detector.md`, `Protection_and_Recovery.md`) uses a lightweight detector to identify *when* an impulsive event is occurring and only modifies filter behaviour during and immediately after such events, keeping the algorithm as simple/cheap as vanilla FxLMS during normal operation. **This is a proposed design direction; the specific gating mechanism is not yet finalized (see `Protection_and_Recovery.md` §5), and no comparative performance numbers exist yet.**

## 5. Comparison Table (Qualitative — Numerical Results Pending)

| Property | Vanilla FxLMS | Robust Baseline (literature) | Proposed State-Gated Approach |
|---|---|---|---|
| Steady-state attenuation (normal noise) | Baseline reference | Typically comparable or slightly reduced, depending on the nonlinearity used | Expected comparable to vanilla FxLMS during Normal state (unchanged update rule) — **[RESULT TO BE FILLED AFTER EXPERIMENT]** |
| Impulse attenuation loss (during event) | High vulnerability — weight update can be strongly perturbed | Reduced vulnerability by design (continuous outlier suppression) | Intended to be reduced during Protection state via gating — **[RESULT TO BE FILLED AFTER EXPERIMENT]** |
| Recovery time after event | Depends on how far weights diverged; can be slow | Generally faster/more graceful due to continuous bounding | Governed by the (currently unfinalized) Recovery-state ramp — **[RESULT TO BE FILLED AFTER EXPERIMENT]** |
| Robustness (general) | Low | High (by design) | Intended to be high during events, unchanged (baseline) otherwise — **[RESULT TO BE FILLED AFTER EXPERIMENT]** |
| Computational cost | Lowest | Higher (per-sample nonlinearity/extra computation) | Close to vanilla FxLMS cost + lightweight detector overhead |

No numeric attenuation, recovery-time, or robustness figures have been measured for our system; all such values must come from executing the protocols in `06_Experiments/` and are currently marked with explicit placeholders.

## 6. Performance Trade-offs (General, from Literature)
- Continuously-robust algorithms typically sacrifice some steady-state convergence speed/accuracy under normal (non-impulsive) conditions in exchange for stability during outliers.
- Event-gated approaches (like ours) aim to avoid this trade-off during normal operation but depend critically on detector accuracy (`State_Detector.md` §8–9): a missed detection provides no protection, and a false alarm unnecessarily suppresses adaptation.

## 7. Mathematical Note on Robust Cost Functions (General Form)
Where vanilla LMS/FxLMS minimizes `E[e(n)^2]`, a representative robust alternative minimizes a least-mean-p-power cost:

```
J_p = E[|e(n)|^p],   0 < p < 2
```

with `p = 2` recovering ordinary LMS. Smaller `p` reduces the influence of large-magnitude error samples on the resulting gradient-based update, at the cost of a different convergence profile. This is presented here as general background theory from the cited literature; it is **not** the specific mechanism implemented in our system (see `Protection_and_Recovery.md` §5 for what remains open in our own design).

## 8. Inputs and Outputs
Same general inputs/outputs as FxLMS (§14 of `FxLMS_Algorithm.md`); a robust or gated variant additionally consumes a robustness-relevant signal (either a continuous nonlinearity applied to `e(n)`, or, in our case, the discrete state label from the State Detector).

## 9. Important Parameters
- Choice of robust nonlinearity / cost-function exponent `p` (literature approaches).
- Detector thresholds and gating mechanism parameters (our approach — see `Protection_and_Recovery.md`).

## 10. Advantages
- Directly targets the defence-relevant robustness requirement in SIH26052.
- Our proposed gated approach aims to preserve the computational simplicity of FxLMS during normal operation, which matters for eventual embedded deployment (`07_Hardware/Hardware_Feasibility.md`).

## 11. Limitations
- Continuously-robust literature algorithms add per-sample computational cost.
- Our gated approach's effectiveness is bounded by detector accuracy and by design choices not yet finalized.
- No field or lab data yet substantiates specific numeric robustness claims for our system.

## 12. How It Is Used in SIH26052
This document frames the trade-off space our proposed state-gated design sits within, situating our contribution relative to established robust-ANC literature rather than presenting it as a novel algorithm with proven superiority.

## 13. Relationship to Our Current Implementation
**Implemented:** the vanilla FxLMS baseline and the state-detection/impulse-experiment demonstration of *why* robustness matters. **Not implemented:** a literature-style continuously-robust FxLMS variant for direct comparison; **finalized numeric comparison data across all three approaches** — currently future work.

## 14. Relevant Research References
Mirza, Zeb & Sheikh (2016); related impulsive-noise ANC robustness literature — see `08_References/Research_Papers.md`.
