# Hardware Feasibility

## 1. Purpose
Document the proposed embedded implementation for a future prototype phase, distinguishing clearly between (a) what our Round‑1 browser simulation demonstrates, (b) projected/estimated hardware requirements based on general ANC/embedded-audio literature and standard component specifications, and (c) the actual future prototype, which has not been built.

> **No hardware has been built, measured, or tested. All figures in this document are projected/estimated based on general literature and typical component specifications, not measurements of a physical prototype.**

## 2. Three-Way Distinction

| Category | Status | What It Covers |
|---|---|---|
| **Simulation** | Implemented | Client-side browser simulation described in `05_Simulation/Simulation_Methodology.md`; no physical hardware involved. |
| **Projected Hardware Requirements** | Estimated / Future | Computational, memory, latency, and power estimates based on the algorithm's known complexity (see `03_Algorithms/FxLMS_Algorithm.md`) and typical embedded-audio component specifications from the literature. |
| **Future Prototype** | Not started | An actual embedded build (MCU/DSP + microphones + speaker) implementing FxLMS, the state detector, and protection/recovery logic in real time on physical hardware. |

## 3. Computational Feasibility (Projected)

The FxLMS algorithm's per-sample computational cost is `O(L)` multiply-accumulate operations for the filter output plus a comparable `O(L)` for the filtered-x computation and weight update, i.e., roughly `O(2L)`–`O(3L)` MACs per sample depending on implementation details (see `03_Algorithms/FxLMS_Algorithm.md` §12, §18). For a real-time system at a typical audio sampling rate (e.g., 8–16 kHz, as used in several DSP-based ANC headset implementations in the literature — see `08_References/Research_Papers.md`), this places FxLMS well within the capability of commodity fixed-point or floating-point DSPs/MCUs historically used for ANC headset applications (e.g., TI TMS320-family DSPs, per Kuo & Morgan's implementation-oriented treatment). The state detector's short-time energy computation adds a comparatively small additional per-sample cost. **These are order-of-magnitude, literature-informed estimates, not measurements on our specific target hardware, which has not yet been selected or benchmarked.**

## 4. Latency Requirements (Projected)

Effective feedforward ANC requires the total signal path — reference sensing, computation, D/A output, and acoustic propagation to the error point — to remain short enough that the cancelling signal stays correlated with the noise it targets; ANC systems in the literature typically target total loop latency on the order of a few milliseconds. This is a **design target/constraint derived from general ANC literature**, not a latency value our system has measured, since no end-to-end hardware loop exists yet.

## 5. MCU/DSP Considerations (Projected)

Based on the computational profile above and typical practice in the cited ANC headset literature, a fixed-point or floating-point DSP/MCU with hardware multiply-accumulate support and adequate clock speed for the chosen filter length and sample rate would be an appropriate target device class. Selecting a specific part number, clock speed, and fixed- vs. floating-point architecture is **future work**, dependent on final filter-length/sample-rate choices which are themselves pending experimental tuning (see `06_Experiments/`).

## 6. Microphone / Audio Interface (Projected)

A physical implementation would require, at minimum, a reference microphone, an error microphone, and a loudspeaker/transducer suitable for the target defence form factor (e.g., helmet-mounted or headset-mounted), plus associated ADC/DAC and analog front-end circuitry. No specific components have been selected, sourced, or tested.

## 7. Memory (Projected)

Memory requirements scale primarily with filter length `L` (coefficient storage plus reference/filtered-x history buffers) and are expected to be modest (on the order of a few hundred bytes to a few kilobytes for typical ANC filter lengths used in the literature), well within the SRAM budget of common audio-class MCUs/DSPs. This is an order-of-magnitude estimate pending final filter-length selection.

## 8. Power (Projected)

Power budget for a wearable/portable defence device would be constrained by battery size and thermal limits typical of headset/helmet-mounted electronics; specific power figures require a selected component set and are not available at this stage.

## 9. Cost (Projected)

No bill-of-materials or cost estimate has been produced, since component selection has not occurred; this is deferred to the future prototype phase.

## 10. Advantages of the Proposed Direction
- FxLMS's low computational complexity (§3) keeps the algorithm within the envelope of well-established, field-proven embedded ANC implementation practice.
- The state-detector/protection-recovery layer is designed to add only lightweight additional computation (§3), preserving embedded feasibility.

## 11. Limitations / Open Feasibility Questions
- No physical secondary-path measurements exist to validate the `Ŝ(z)` estimate needed on real hardware (see `03_Algorithms/Secondary_Path_Modeling.md`).
- No validated latency budget has been measured end-to-end on any physical loop.
- Component selection, power budget, and cost are entirely unaddressed pending prototype-phase work.
- The state-detector threshold tuning and protection/recovery mechanism (still "to be finalized," per `03_Algorithms/Protection_and_Recovery.md`) must be resolved before embedded resource requirements can be finalized.

## 12. How It Is Used in SIH26052
This document responds to the problem statement's hardware/DRDO context by giving judges a transparent, literature-grounded feasibility picture rather than fabricated specifications, while being explicit about what remains to be validated in a future prototype phase.

## 13. Relationship to Our Current Implementation
**Simulation (Implemented):** browser-based, no hardware. **Projected Hardware Requirements (this document):** literature-informed estimates only. **Future Prototype:** not started.

## 14. Relevant Research References
Kuo & Morgan (1996/1999); DSP-based ANC headset implementation literature (e.g., adaptive feedback ANC headset studies) — see `08_References/Research_Papers.md`, category "Embedded ANC / real-time ANC."
