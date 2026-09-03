# Secondary Path Modeling

## 1. Purpose
Explain what the secondary path is, why FxLMS depends on an estimate of it, and document our 0–40% secondary-path mismatch experiment.

## 2. Why It Is Required in This Project
As established in `FxLMS_Algorithm.md`, FxLMS filters the reference signal through an *estimate* `Ŝ(z)` of the secondary path to keep the weight-update gradient direction valid. Because the true secondary path `S(z)` in a real defence deployment (helmet/headset fit, cabin acoustics, temperature, component ageing) will differ from any offline estimate, understanding the effect of `Ŝ(z) ≠ S(z)` is essential to assessing feasibility and stability risk before hardware is built.

## 3. What the Secondary Path Is
The secondary path `S(z)` is the transfer function of everything between the digital controller output and the digitized error-microphone signal: D/A converter → power amplifier → loudspeaker → acoustic propagation to the error microphone → error microphone → A/D converter. It is a physical, generally unknown or only approximately-known transfer function.

## 4. Why FxLMS Needs It
Without correcting for `S(z)`, the reference signal used in the LMS weight-update is no longer properly correlated with the error signal's dependence on the filter weights, which — as discussed in Boucher, Elliott & Nelson (1991) and the broader literature — can slow convergence or destabilize the adaptive filter, especially when `S(z)` introduces significant phase shift relative to the sampling rate. FxLMS addresses this by filtering the reference through an estimate `Ŝ(z)` (see `FxLMS_Algorithm.md` §9).

## 5. Estimated vs. Actual Secondary Path
- `S(z)`: the true, physical secondary path (unknown exactly, would require measurement in a real system, e.g. via an offline system-identification step using injected test noise).
- `Ŝ(z)`: the estimate used inside the FxLMS filtered-x computation. In a real deployment this is typically obtained via an offline or online system-identification procedure (not performed in our project — no physical hardware exists yet).

## 6. Secondary-Path Modelling Error
Modelling error is commonly characterized as a mismatch between `Ŝ(z)` and `S(z)`, e.g. expressed as a percentage magnitude/phase deviation, or as a normalized misalignment measure such as:

```
Mismatch = ||S(z) - Ŝ(z)|| / ||S(z)||
```

Our simulation panel expresses secondary-path mismatch as a percentage (0–40%) applied to a synthetic model secondary path, allowing the user to observe the qualitative effect of increasing mismatch on convergence and stability.

## 7. Effect of Mismatch
As mismatch increases:
- Convergence typically slows because the filtered-x signal used for the update is a progressively less accurate representation of the true gradient direction.
- Steady-state residual error typically increases.
- Beyond some mismatch level (frequency-dependent — related to how far the phase error between `S(z)` and `Ŝ(z)` departs from the stable range), the adaptive filter can become unstable, with coefficients growing without bound.

## 8. Stability Implications
A widely cited informal stability guideline (e.g., as discussed in Kuo & Morgan's treatment of FxLMS) is that FxLMS remains stable if the phase error between the true and estimated secondary path stays within ±90° across the frequency range containing significant reference-signal energy; larger phase errors risk driving the update in the wrong direction at those frequencies. This is presented as general theoretical guidance from the literature, not a bound our team has independently derived or numerically verified for this project.

## 9. Our 0–40% Mismatch Experiment
**Implemented:** the Secondary-Path Mismatch Experiment panel lets a user apply a configurable mismatch (0% to 40%) between the synthetic `Ŝ(z)` used by the live in-browser FxLMS engine and a synthetic "actual" `S(z)` used to generate the simulated error signal, and observe the resulting convergence/error-signal behaviour in real time. See `06_Experiments/Secondary_Path_Mismatch.md` for the full experimental protocol (objective, setup, procedure, metrics — result values pending execution/measurement).

## 10. Inputs and Outputs
- **Inputs:** synthetic true secondary path `S(z)`, synthetic estimated secondary path `Ŝ(z)` (with adjustable mismatch), reference signal.
- **Outputs:** filtered-x signal `x'(n)`, resulting FxLMS convergence trace, residual error `e(n)`.

## 11. Important Parameters
- Mismatch percentage (0–40%, our experiment's configurable range).
- Nature of the mismatch applied (our panel may vary magnitude and/or phase/delay characteristics of the synthetic path — see the panel's own configuration for exact behaviour).
- Step size `μ` of the underlying FxLMS filter, since mismatch tolerance interacts with step size.

## 12. Advantages of Studying This Explicitly
- Surfaces a real deployment risk (secondary-path drift due to helmet/headset fit variation, temperature, ageing) before any hardware is committed to.
- Directly informs the projected hardware requirements discussed in `07_Hardware/Hardware_Feasibility.md` (e.g., whether periodic re-estimation of `Ŝ(z)` would be needed in the field).

## 13. Limitations
- Our experiment uses a **synthetic** secondary path; it demonstrates the qualitative principle of mismatch-driven degradation, not the quantitative mismatch tolerance of any specific physical hardware, since no physical secondary path has been measured.
- No physical system-identification procedure has been implemented.

## 14. How It Is Used in SIH26052
Secondary-path awareness is directly relevant to the "defence environment" aspect of the problem statement, since real deployment conditions (helmet fit, vehicle cabin variation) will introduce exactly this kind of path uncertainty.

## 15. Relationship to Our Current Implementation
**Implemented:** synthetic secondary-path mismatch sweep (0–40%) integrated with the live FxLMS engine. **Future work:** physical secondary-path measurement and online system identification on real hardware.

## 16. Relevant Research References
Boucher, Elliott & Nelson (1991); Kuo & Morgan (1999); Morgan (1980) — see `08_References/Research_Papers.md`.
