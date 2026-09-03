# Impulse Experiment (and Baseline Noise Experiments)

This document covers Experiments 1, 2, 3, 4, 5, and 9 from our experiment plan: normal/stationary noise (baseline), non-stationary noise, single impulse, repeated impulse/burst, impulse amplitude variation, and FxLMS stability/divergence. All experiments run within the Impulse Experiment panel of the Round‑1 web simulation (see `02_System_Architecture/System_Architecture.md` §3.2).

**No numerical results have been measured yet. All result fields below use the placeholder `[RESULT TO BE FILLED AFTER EXPERIMENT]`.**

---

## Experiment 1: Normal / Stationary Noise (Baseline)

**Objective:** Establish baseline FxLMS convergence behaviour under stationary broadband noise, with no impulsive disturbance, as a reference point for all other experiments.

**Setup:** Synthetic stationary broadband reference noise generated in-browser; live FxLMS engine with fixed filter length `L` and step size `μ`; synthetic secondary path with 0% mismatch.

**Variables:** Step size `μ`; filter length `L`.

**Procedure:**
1. Generate a stationary noise reference signal of fixed duration.
2. Run the live FxLMS engine with 0% secondary-path mismatch.
3. Record the convergence curve (mean-square error vs. time) as displayed by the panel.

**Expected Observation:** Error signal magnitude decreasing over time toward a steady-state floor, consistent with standard LMS-family convergence behaviour.

**Metrics:** Convergence time (samples/seconds to reach steady state), steady-state residual error level.

**Result Format:** Time-series plot (as rendered by the panel) plus recorded convergence-time and steady-state-error values.

**Interpretation:** Serves as the reference baseline against which all impulsive/mismatch experiments are compared. **[RESULT TO BE FILLED AFTER EXPERIMENT]**

---

## Experiment 2: Non-Stationary Noise

**Objective:** Observe FxLMS tracking behaviour when the statistical properties of the reference noise change over time (e.g., amplitude or spectral-shape drift), without impulsive events.

**Setup:** Same as Experiment 1, but the synthetic noise generator is configured to vary its amplitude/spectral characteristics over the run.

**Variables:** Rate of non-stationarity (how quickly the noise characteristics change); `μ`.

**Procedure:**
1. Configure the noise generator for time-varying characteristics.
2. Run the live FxLMS engine and observe whether/how well the filter re-converges as conditions change.

**Expected Observation:** Some tracking lag proportional to how quickly conditions change and to `μ`; larger `μ` should track faster but with higher steady-state misadjustment.

**Metrics:** Tracking lag, steady-state error under varying conditions.

**Result Format:** Time-series plot with annotated regions of changing noise character.

**Interpretation:** **[RESULT TO BE FILLED AFTER EXPERIMENT]**

---

## Experiment 3: Single Impulse

**Objective:** Observe the effect of a single, isolated impulsive disturbance on FxLMS convergence and on the state detector's response.

**Setup:** Stationary background noise (as in Experiment 1) with a single synthetic impulsive event injected at a user-chosen time.

**Variables:** Impulse amplitude; impulse timing relative to filter convergence state (early vs. after convergence).

**Procedure:**
1. Start the live FxLMS engine on stationary background noise and allow it to converge.
2. Inject a single impulse of specified amplitude.
3. Observe the error signal, filter-coefficient behaviour, and state-detector output before, during, and after the impulse.

**Expected Observation:** A sharp spike in error signal and a corresponding disturbance to filter coefficients at the moment of the impulse; the state detector is expected to transition toward Protection state around this time (see `03_Algorithms/State_Detector.md`).

**Metrics:** Peak error-signal deviation, coefficient deviation, state-detector transition latency (time from impulse onset to Protection-state trigger).

**Result Format:** Annotated time-series plot showing impulse onset, error spike, and detector state timeline.

**Interpretation:** **[RESULT TO BE FILLED AFTER EXPERIMENT]**

---

## Experiment 4: Repeated Impulse / Burst

**Objective:** Observe FxLMS and detector behaviour under a rapid sequence (burst) of impulsive events, rather than a single isolated one.

**Setup:** Same as Experiment 3, but with multiple impulses injected in quick succession (configurable inter-impulse interval).

**Variables:** Number of impulses in the burst; inter-impulse interval; impulse amplitude.

**Procedure:**
1. Configure a burst of `k` impulses with a specified interval.
2. Run the live FxLMS engine and observe cumulative effect on convergence and repeated state transitions.

**Expected Observation:** Possible cumulative degradation of filter coefficients if impulses arrive faster than the system can recover; repeated Protection/Recovery state cycling.

**Metrics:** Cumulative coefficient drift across the burst; number of Protection-state triggers; whether the filter regains steady state after the burst ends.

**Result Format:** Time-series plot annotated with each impulse and each state transition.

**Interpretation:** **[RESULT TO BE FILLED AFTER EXPERIMENT]**

---

## Experiment 5: Impulse Amplitude Variation

**Objective:** Characterize how FxLMS/detector behaviour scales with impulse amplitude, to understand at what amplitude the system's response qualitatively changes (e.g., detector triggers, filter instability risk).

**Setup:** Same as Experiment 3, run repeatedly across a sweep of impulse amplitudes.

**Variables:** Impulse amplitude (swept across a defined range).

**Procedure:**
1. For each amplitude value in the sweep, inject a single impulse under otherwise identical conditions.
2. Record error-signal peak, detector trigger/no-trigger outcome, and post-impulse recovery behaviour for each amplitude.

**Expected Observation:** Monotonic (or approximately monotonic) increase in disturbance severity with amplitude, with a threshold region where the state detector begins reliably triggering.

**Metrics:** Error-signal peak vs. amplitude; detector trigger threshold amplitude.

**Result Format:** Table/plot of amplitude vs. measured metrics across the sweep.

**Interpretation:** **[RESULT TO BE FILLED AFTER EXPERIMENT]**

---

## Experiment 9: FxLMS Stability / Divergence

**Objective:** Identify the conditions (step size, impulse severity, secondary-path mismatch) under which the live FxLMS engine's coefficients diverge (grow without bound) rather than converge, to characterize practical stability boundaries in the simulation.

**Setup:** Live FxLMS engine with configurable `μ`, optional secondary-path mismatch (see `Secondary_Path_Mismatch.md`), and optional impulse injection (as in Experiments 3–5).

**Variables:** Step size `μ`; secondary-path mismatch percentage; impulse presence/amplitude.

**Procedure:**
1. Sweep `μ` upward from a small, known-stable value while monitoring coefficient magnitude.
2. Repeat with nonzero secondary-path mismatch.
3. Repeat with impulsive disturbances present.
4. Record the combination(s) of parameters at which coefficient magnitude begins to grow without bound rather than settle.

**Expected Observation:** A stability boundary in `μ` that decreases as secondary-path mismatch and/or impulse severity increases, consistent with the qualitative stability discussion in `03_Algorithms/FxLMS_Algorithm.md` §16 and `03_Algorithms/Secondary_Path_Modeling.md` §8.

**Metrics:** Maximum stable `μ` as a function of mismatch percentage and impulse presence.

**Result Format:** Table/plot of stability boundary vs. swept parameters.

**Interpretation:** **[RESULT TO BE FILLED AFTER EXPERIMENT]**
