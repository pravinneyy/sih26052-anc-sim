# ANC Fundamentals

## 1. Purpose
Establish the baseline theory of Active Noise Control (ANC) that all later documents (FxLMS, State Detector, Robust ANC, Secondary-Path Modelling) build on.

## 2. Why It Is Required in This Project
SIH26052 asks for an *adaptive* noise-cancellation solution. Before describing our specific adaptive algorithm (FxLMS) and its extensions, the team must establish the classical ANC principle it is built on, so judges can trace every design choice back to first principles rather than treating FxLMS as a black box.

## 3. Basic Concept
ANC exploits the principle of destructive acoustic interference: an unwanted noise wave is cancelled by generating a second wave of equal amplitude and opposite phase (an "anti-noise" signal) that combines with the original at the point of interest (near the operator's ear/error microphone). This is distinct from passive noise control, which physically absorbs or blocks sound energy and is largely ineffective at low frequencies where wavelengths are long relative to practical absorber thickness.

## 4. Detailed Working Principle

A generic single-channel feedforward ANC system has:

- A **reference microphone** that senses the incoming noise before it reaches the protected zone (this reference signal, `x(n)`, must be correlated with the noise that will arrive at the error microphone).
- A **controller** (adaptive filter) that processes `x(n)` to produce a cancelling signal `y(n)`.
- A **secondary source** (loudspeaker) that emits `y(n)` into the acoustic environment.
- An **error microphone** that measures the residual sound `e(n)` = primary noise arriving at that point + the acoustic contribution of `y(n)`.
- A **feedback path** from the controller output back to the adaptive algorithm, which adjusts controller coefficients to minimize `e(n)`.

Because the acoustic environment (temperature, geometry, operator movement) changes over time, the controller must be **adaptive**, i.e., it must continuously re-estimate its coefficients rather than use a fixed filter. This adaptivity is what LMS-family algorithms provide (see `FxLMS_Algorithm.md`).

## 5. Mathematical Formulation (Baseline, Ideal Case)

If `d(n)` is the noise as it would arrive at the error microphone with no cancellation, and `y'(n)` is the acoustic result of the cancelling signal `y(n)` after propagating through the physical path from loudspeaker to error microphone (the **secondary path**, denoted `S(z)`), then the residual error is:

```
e(n) = d(n) - y'(n) = d(n) - (s(n) * y(n))
```

where `*` denotes convolution and `s(n)` is the impulse response of `S(z)`. Perfect cancellation requires `y'(n) = d(n)` at all times, i.e. the controller must effectively implement the *inverse* of the primary-to-error path expressed through the secondary path.

## 6. Variables and Their Meanings

| Symbol | Meaning |
|---|---|
| `x(n)` | Reference signal (noise sample before cancellation) |
| `d(n)` | Desired/primary noise signal as it would arrive at the error mic, uncancelled |
| `y(n)` | Controller (adaptive filter) output — the cancelling signal |
| `y'(n)` | Acoustic result of `y(n)` after propagating through the secondary path |
| `S(z)` | Secondary path transfer function (loudspeaker → acoustic path → error mic → ADC) |
| `e(n)` | Error signal measured by the error microphone — the quantity being minimized |

## 7. Inputs and Outputs

- **Inputs:** reference signal `x(n)`; (implicitly) the acoustic environment through which `d(n)` and `y'(n)` propagate.
- **Outputs:** cancelling signal `y(n)`; residual error `e(n)`, which is the practically-relevant output since it represents what the operator actually hears.

## 8. Important Parameters
- Sampling rate (must be high enough for the frequencies of concern; also bounds achievable latency).
- Adaptive filter length (number of taps), which limits how long an impulse response the controller can represent.
- Convergence/step-size parameter (see `FxLMS_Algorithm.md`).

## 9. Advantages of ANC (vs. passive-only protection)
- Effective at low frequencies where passive absorbers are impractical.
- Adapts to changing noise character over time.
- Can be combined with passive attenuation for broadband coverage.

## 10. Limitations
- Requires a coherent reference signal correlated with the noise to be cancelled.
- Cancellation zone is spatially limited ("quiet zone") around the error microphone.
- Naive adaptive controllers are vulnerable to fast/impulsive disturbances and to secondary-path uncertainty (motivating `Robust_ANC.md` and `Secondary_Path_Modeling.md`).
- Real-time computational constraints limit filter complexity on embedded hardware.

## 11. How It Is Used in SIH26052
The classical feedforward ANC structure above is the conceptual basis for our entire system: the reference/error microphone pair, the secondary path, and the adaptive controller. All subsequent documents describe specific extensions layered onto this basic structure to address the defence-specific challenges (impulsive noise, secondary-path drift) named in the problem statement.

## 12. Relationship to Our Current Implementation
**Implemented (conceptually, in simulation):** The reference→controller→secondary-path→error-mic signal chain is fully represented in the browser simulation using synthetic signals and a modelled secondary path (see `05_Simulation/Simulation_Methodology.md`). **Not implemented:** any physical microphone/loudspeaker hardware or measured acoustic path.

## 13. Relevant Research References
See `08_References/Research_Papers.md`, particularly Widrow et al. (1975), Kuo & Morgan (1999), and Elliott & Nelson's tutorial treatment of active noise control referenced therein.
