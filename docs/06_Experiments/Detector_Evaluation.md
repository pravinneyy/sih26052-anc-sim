# Detector Evaluation

This document covers Experiments 6 and 7: detector response characterization and the loud-speech false-alarm test, both exercising the State Detector panel (see `03_Algorithms/State_Detector.md`).

**No numerical results have been measured yet. All result fields use the placeholder `[RESULT TO BE FILLED AFTER EXPERIMENT]`.**

---

## Experiment 6: Detector Response

**Objective:** Characterize the state detector's sensitivity and timing — i.e., how quickly and reliably it transitions to Protection state as a function of disturbance amplitude and detector configuration (frame length, smoothing factor, thresholds).

**Setup:** State Detector panel running concurrently with the live FxLMS engine on synthetic reference/error signals; configurable detector parameters (`N`, `α`, `T_protect`, `T_recover` — see `03_Algorithms/State_Detector.md` §4–5).

**Variables:** Disturbance amplitude; detector frame length `N`; smoothing factor `α`; threshold `T_protect`.

**Procedure:**
1. For a fixed detector configuration, inject synthetic impulsive disturbances at varying amplitudes (reusing the sweep from `Impulse_Experiment.md` Experiment 5).
2. Record whether/when the detector transitions to Protection state for each amplitude.
3. Repeat across different detector configurations (varying `N`, `α`, `T_protect`) to observe sensitivity/timing trade-offs.

**Expected Observation:** A detection threshold amplitude below which the detector does not trigger and above which it reliably does, with transition latency dependent on frame length `N` (larger `N` → smoother but slower response).

**Metrics:** Detection probability `P_d` at each tested amplitude/configuration; average detection latency (time from disturbance onset to Protection-state transition).

**Result Format:** Table of amplitude × configuration → (triggered: yes/no, latency); optional detection-probability-vs-amplitude curve.

**Interpretation:** **[RESULT TO BE FILLED AFTER EXPERIMENT]**

---

## Experiment 7: Loud-Speech False-Alarm Test

**Objective:** Assess how often the energy-ratio-based detector incorrectly transitions to Protection state in response to loud but legitimate speech (e.g., a shouted command), rather than a genuine impulsive disturbance — directly testing the known limitation discussed in `03_Algorithms/State_Detector.md` §9.

**Setup:** State Detector panel; a set of speech-like or shouted-voice test signals (synthetic or user-recorded/uploaded clips) used as the reference/error input instead of an impulsive disturbance.

**Variables:** Speech loudness/abruptness; detector threshold `T_protect`; frame length `N`.

**Procedure:**
1. Play or inject a set of loud/abrupt speech-like clips through the panel under a fixed detector configuration.
2. Record how many of these legitimate speech events incorrectly trigger a Protection-state transition (false alarms).
3. Repeat across different threshold configurations to observe the false-alarm-rate vs. sensitivity trade-off.

**Expected Observation:** Some nonzero false-alarm rate is expected with a purely energy-based detector, since loud abrupt speech can produce energy-ratio spikes similar to genuine impulsive noise; the rate should decrease as `T_protect` is raised, at the cost of reduced sensitivity to genuine disturbances (per Experiment 6).

**Metrics:** False alarm probability `P_fa` across tested speech clips and threshold configurations; number of false alarms per clip/session.

**Result Format:** Table of threshold configuration → measured `P_fa`; paired with the `P_d` results from Experiment 6 to characterize the sensitivity/false-alarm trade-off (e.g., as an ROC-style comparison).

**Interpretation:** **[RESULT TO BE FILLED AFTER EXPERIMENT]** — This trade-off directly informs whether the current purely energy-based detection scheme is adequate or whether additional discriminative features (e.g., harmonicity-based speech detection, as used in the broader acoustic-event-detection literature — see `08_References/Research_Papers.md`) should be pursued as future work.
