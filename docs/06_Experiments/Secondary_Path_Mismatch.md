# Secondary-Path Mismatch Experiment

This document covers Experiment 8: the secondary-path mismatch sweep, exercising the Secondary-Path Mismatch panel (see `03_Algorithms/Secondary_Path_Modeling.md` §9).

**No numerical results have been measured yet. All result fields use the placeholder `[RESULT TO BE FILLED AFTER EXPERIMENT]`.**

---

## Experiment 8: Secondary-Path Mismatch

**Objective:** Characterize how FxLMS convergence, steady-state error, and stability degrade as the mismatch between the estimated secondary path `Ŝ(z)` and the synthetic "actual" secondary path `S(z)` increases from 0% to 40%.

**Setup:** Live in-browser FxLMS engine; synthetic true secondary path `S(z)`; synthetic estimated secondary path `Ŝ(z)`, with mismatch applied via the panel's configurable 0–40% control (see `03_Algorithms/Secondary_Path_Modeling.md` §6 for the mismatch definition used).

**Variables:** Mismatch percentage (0%, and increasing increments up to 40%); step size `μ` (held fixed per sweep, optionally repeated at multiple `μ` values).

**Procedure:**
1. Set mismatch to 0% and record baseline convergence behaviour (reusing/cross-referencing Experiment 1 in `Impulse_Experiment.md`).
2. Increase mismatch in defined increments (e.g., 5% or 10% steps) up to 40%, recording convergence and steady-state behaviour at each step.
3. Identify the approximate mismatch percentage at which the filter transitions from stable-but-degraded to unstable/divergent, if reached within the tested range.
4. Optionally repeat the sweep at a lower step size `μ` to observe whether reduced `μ` extends the stable mismatch range, consistent with the qualitative stability discussion in `03_Algorithms/FxLMS_Algorithm.md` §16.

**Expected Observation:** Progressive slowing of convergence and increase in steady-state residual error as mismatch increases, consistent with `03_Algorithms/Secondary_Path_Modeling.md` §7; possible transition to instability at higher mismatch, particularly at higher `μ`.

**Metrics:** Convergence time vs. mismatch %; steady-state error vs. mismatch %; stability boundary (mismatch % beyond which divergence occurs, if any, at the tested `μ`).

**Result Format:** Plot of mismatch % (x-axis) vs. convergence time and steady-state error (y-axes); note of stability boundary if observed within the 0–40% range tested.

**Interpretation:** **[RESULT TO BE FILLED AFTER EXPERIMENT]** — Results from this experiment directly inform the feasibility discussion in `07_Hardware/Hardware_Feasibility.md` regarding whether periodic re-estimation of the secondary path would be necessary in a fielded system (e.g., due to helmet/headset fit changes or thermal drift).
