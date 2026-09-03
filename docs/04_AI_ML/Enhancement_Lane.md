# AI/ML Enhancement Lane

> **This document describes a future/illustrative component. It is not an implemented neural network.**
>
> The current Round 1 implementation does not contain a trained neural network. The current enhancement preview uses a hand-written heuristic gain mask for demonstration purposes.

## 1. Purpose
Explain the motivation for a possible future speech-enhancement lane alongside ANC, describe the proposed (not implemented) Causal GRU concept at a conceptual level, and state clearly what is illustrative vs. real in the current Round‑1 build.

## 2. Why Speech Enhancement May Complement ANC
FxLMS-based ANC is designed to cancel *coherent, predictable* noise components using a reference signal. It is not designed to remove residual broadband/non-coherent noise or to improve the perceptual clarity of speech that survives after cancellation. A complementary speech-enhancement stage — applied to the residual error signal, or the mixed signal delivered to the operator — could in principle further improve intelligibility, in the same spirit as post-filtering stages studied in the speech-enhancement literature (see `08_References/Research_Papers.md`).

## 3. Proposed Causal GRU Concept (Future Work — Not Implemented)
A **Causal Gated Recurrent Unit (GRU)** network is a recurrent neural architecture in which each output depends only on current and past inputs (no lookahead), making it suitable in principle for real-time, low-latency processing. In the broader speech-enhancement literature, causal GRU/LSTM-based models are commonly used as a temporal bottleneck within an encoder–decoder architecture to estimate a time-frequency mask that is applied to a noisy spectrogram to produce an enhanced speech estimate (see, e.g., the causal/low-latency speech-enhancement literature cited in `08_References/Research_Papers.md`).

For SIH26052, a Causal GRU-based enhancement lane is a **proposed future direction**, conceptually intended to:
- Take the ANC residual signal (post-FxLMS) as input.
- Estimate a time-frequency (or time-domain) mask/gain to further suppress non-coherent residual noise while preserving speech.
- Operate causally, frame-by-frame, to remain compatible with real-time operation.

**No such network has been designed in detail, implemented, or trained for this project.** This section describes only the general concept as it appears in the literature and as a candidate direction for future work — it is not a specification of a model our team has built.

## 4. Expected Role of the Enhancement Lane (If Built)
If implemented in a future phase, the enhancement lane would sit downstream of the FxLMS/state-detector stage, operating on the residual signal, rather than replacing the ANC controller itself. Its expected role would be to improve perceptual speech quality/intelligibility beyond what coherent-noise cancellation alone can achieve.

## 5. Latency Considerations
Any future neural enhancement stage intended for this application would need to operate within a total system latency budget compatible with real-time ANC (a few milliseconds end-to-end is typical for effective ANC — see `07_Hardware/Hardware_Feasibility.md`). This strongly constrains model size and architecture choice toward small, causal, low-parameter-count networks (an active research area — see the low-latency speech-enhancement survey cited in `08_References/Research_Papers.md`), and is a key open feasibility question rather than a solved problem in our current design.

## 6. Training Requirements (Not Yet Undertaken)
Training a causal GRU-based enhancement model would require, at minimum: a labelled paired dataset (noisy input, clean target), a defined loss function (e.g., time or time-frequency domain reconstruction loss, or intelligibility-oriented losses used in the cited literature), a training/validation split, and compute resources for iterative training. **None of this has been undertaken in Round 1.**

## 7. Dataset Requirements (Not Yet Sourced)
A defence-relevant enhancement model would ideally be trained/validated on speech recorded (or convincingly simulated) under representative defence-environment noise conditions, including impulsive disturbances. No such dataset has been collected or sourced by our team; this is identified as a prerequisite for future work rather than a current asset.

## 8. Future Embedded Deployment
Deploying any trained model on embedded hardware would require quantization/compression considerations and would need to be evaluated against the same MCU/DSP resource constraints discussed in `07_Hardware/Hardware_Feasibility.md`. No embedded deployment of any neural model has been attempted.

## 9. What Is Actually Implemented in Round 1: The Illustrative Heuristic Gain Mask

To give judges and users a tangible, interactive sense of "what an enhancement stage might sound like," our Round‑1 web simulation includes a **hand-written heuristic gain-mask mechanism** — **not** a trained neural network, **not** a Causal GRU, and **not** based on any dataset or training process. It:

- Applies a fixed/hand-tuned gain-shaping rule to an input audio signal (from the built-in demo or from a user's recorded/uploaded clip) to illustrate the general concept of a post-cancellation enhancement stage.
- Is intended purely for demonstration and does not represent measured performance, learned parameters, or generalizable enhancement quality.
- Should not be cited by our team, in presentations to judges, or in any derivative materials as evidence of a working neural speech-enhancement system.

## 10. Inputs and Outputs (Illustrative Heuristic, as Implemented)
- **Inputs:** demo audio or user-recorded/uploaded audio clip.
- **Outputs:** a heuristically gain-shaped version of the input, played back for qualitative before/after comparison in the browser.

## 11. Advantages of the Illustrative Approach (Round 1)
- Requires no training data or GPU compute, fitting Round‑1 timelines.
- Gives judges an interactive, concrete sense of the intended future capability.

## 12. Limitations
- Not adaptive, not learned, not validated against any objective speech-quality metric (e.g., PESQ, STOI).
- Provides no evidence of the eventual performance of a real Causal-GRU-based system.

## 13. How It Is Used in SIH26052
Positioned as a **future-work roadmap item** responding to the broader defence-communications-clarity aspect of the problem statement, while being transparent that it is not yet realized.

## 14. Relationship to Our Current Implementation
**Illustrative (Implemented as a demo, not as ML):** hand-written heuristic gain mask, exposed via the Illustrative Enhancement Preview panel and the user-recorded/uploaded audio demonstration panel. **Future Work:** Causal GRU design, training, dataset collection, and embedded deployment.

## 15. Relevant Research References
See `08_References/Research_Papers.md`, category "Speech enhancement / neural noise suppression" and "Causal GRU or low-latency neural enhancement."
