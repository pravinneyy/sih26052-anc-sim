# Research Paper References

All entries below were verified via web search against publisher/aggregator listings (IEEE Xplore, SpringerLink, ScienceDirect/Elsevier, Semantic Scholar, PMC, PLOS, arXiv, ResearchGate) at the time of writing. No papers, authors, or DOIs have been invented. Where a DOI was not directly confirmed in search results, the official publisher/journal page link is given instead and marked accordingly. Team members should re-verify links before final submission, as this documentation snapshot is not a substitute for direct access to each paper.

---

## 1. FxLMS / Filtered-x LMS

**[R1] Morgan, D. R. (1980).** "An analysis of multiple correlation cancellation loops with a filter in the auxiliary path." *IEEE Transactions on Acoustics, Speech, and Signal Processing*, 28(4), 454–467.
- **Algorithm/method:** Original derivation of the filtered-x correlation-cancellation structure that underlies FxLMS.
- **Supports in SIH26052:** Theoretical foundation of `03_Algorithms/FxLMS_Algorithm.md`.
- **Influence:** Directly influences our implementation (foundational algorithm).

**[R2] Widrow, B., Glover, J. R., McCool, J. M., Kaunitz, J., Williams, C. S., Hearn, R. H., Zeidler, J. R., Dong, E., & Goodlin, R. C. (1975).** "Adaptive noise cancelling: principles and applications." *Proceedings of the IEEE*, 63(12), 1692–1716.
- **Algorithm/method:** Foundational adaptive noise cancellation framework (precursor to filtered-x extensions).
- **Supports in SIH26052:** Background theory for `03_Algorithms/ANC_Fundamentals.md`.
- **Influence:** Background/foundational reference.

---

## 2. Adaptive Noise Cancellation (General / Tutorial)

**[R3] Kuo, S. M., & Morgan, D. R. (1999).** "Active noise control: a tutorial review." *Proceedings of the IEEE*, 87(6), 943–973.
- **Algorithm/method:** Broad tutorial survey of ANC system structures, FxLMS variants, and DSP implementation considerations.
- **Supports in SIH26052:** `03_Algorithms/ANC_Fundamentals.md`, `03_Algorithms/FxLMS_Algorithm.md`, `07_Hardware/Hardware_Feasibility.md`.
- **Influence:** Directly influences our implementation's conceptual framing.

**[R4] Kuo, S. M., & Morgan, D. R. (1996).** *Active Noise Control Systems: Algorithms and DSP Implementations*. New York: John Wiley & Sons.
- **Algorithm/method:** Comprehensive text covering FxLMS variants, multichannel ANC, and practical DSP/embedded implementation.
- **Supports in SIH26052:** `07_Hardware/Hardware_Feasibility.md` (projected computational/DSP feasibility discussion).
- **Influence:** Background reference for implementation-oriented design choices.

---

## 3. Robust ANC

**[R5] Mirza, A., Zeb, A., & Sheikh, S. A. (2016).** "Robust adaptive algorithm for active control of impulsive noise." *EURASIP Journal on Advances in Signal Processing*, 2016, Article 44.
- **Algorithm/method:** Robust FxLMS-family algorithm specifically designed for impulsive-noise environments.
- **Supports in SIH26052:** `03_Algorithms/Robust_ANC.md`, `03_Algorithms/Protection_and_Recovery.md` (background for the robust-baseline comparison).
- **Influence:** Background research informing our proposed state-gated approach; not directly implemented in Round 1.

---

## 4. Impulsive-Noise Handling in ANC

**[R6] Mirza, A., Zeb, A., & Sheikh, S. A. (2016).** (see R5 above — same paper is the primary reference for this category).
- **Supports in SIH26052:** `03_Algorithms/Robust_ANC.md` §4.2–§4.3, §7 (least-mean-p-power cost-function background).
- **Influence:** Background research.

**[R7] Efficient Algorithms for Active Impulsive Noise Control.** IEEE conference publication (IEEE Xplore document 11300192).
- **Algorithm/method:** Proportionate affine-projection and DCD-based algorithms for active impulsive noise control (AINC).
- **Supports in SIH26052:** Additional background for the impulsive-noise robustness discussion in `03_Algorithms/Robust_ANC.md`.
- **Influence:** Background research only; specific author/year metadata should be re-confirmed on IEEE Xplore before citing formally, as it was not fully resolved in our search.

---

## 5. Secondary-Path Modelling

**[R8] Boucher, C. C., Elliott, S. J., & Nelson, P. A. (1991).** "Effects of errors in the plant model on the performance of algorithms for adaptive feedforward control." *IEE Proceedings F (Radar and Signal Processing)*, 138(4), 313–319.
- **Algorithm/method:** Analysis of secondary-path (plant-model) estimation error effects on adaptive feedforward control stability/performance.
- **Supports in SIH26052:** `03_Algorithms/Secondary_Path_Modeling.md` (theoretical basis for our mismatch experiment).
- **Influence:** Directly influences our understanding of the mismatch experiment's expected behaviour, though our experiment itself uses synthetic paths rather than replicating this paper's specific setup.

---

## 6. Acoustic Event / State Detection

**[R9] Łopatka, K., Kotus, J., & Czyżewski, A. (2016).** "Detection, classification and localization of acoustic events in the presence of background noise for acoustic surveillance of hazardous situations." *Multimedia Tools and Applications*, 75(17), 10407–10439. DOI: 10.1007/s11042-015-3105-4.
- **Algorithm/method:** Multi-technique acoustic event detection (including a short-time-level-based "Impulse Detector" and a harmonicity-based "Speech Detector") for hazardous-situation surveillance.
- **Supports in SIH26052:** `03_Algorithms/State_Detector.md` (energy-based detection concept and the speech-vs-impulse false-alarm discussion).
- **Influence:** Directly informs the design rationale and known limitations of our energy-ratio-based state detector; not directly implemented (our detector is a simplified energy-ratio scheme, not this paper's full multi-feature system).

---

## 7. Speech Enhancement / Neural Noise Suppression

**[R10] (PLOS ONE, 2023).** "Causal speech enhancement using dynamical-weighted loss and attention encoder-decoder recurrent neural network." *PLOS ONE*, 18(5), e0285629.
- **Algorithm/method:** Causal attention encoder-decoder LSTM architecture with a dynamically-weighted loss for real-time, low-latency speech enhancement.
- **Supports in SIH26052:** `04_AI_ML/Enhancement_Lane.md` (general concept of causal recurrent speech-enhancement architectures).
- **Influence:** Background research only; explicitly not implemented in Round 1.

**[R11] Compact deep neural networks for real-time speech enhancement on resource-limited devices.** *Speech Communication* (ScienceDirect), 2023.
- **Algorithm/method:** Convolutional encoder-decoder with GRU/LSTM/SRU bottleneck for compact, causal, real-time speech enhancement on resource-constrained devices.
- **Supports in SIH26052:** `04_AI_ML/Enhancement_Lane.md` (motivates the GRU-bottleneck concept and resource-constrained/embedded framing).
- **Influence:** Background research only; explicitly not implemented in Round 1. Full author list should be re-confirmed on ScienceDirect before formal citation.

---

## 8. Causal GRU or Low-Latency Neural Enhancement

**[R12] A Survey on Low-Latency DNN-Based Speech Enhancement.** (PMC article, PMC9921748.)
- **Algorithm/method:** Survey of causal DNN layer types (including GRU/LSTM units) and complexity-reduction techniques for low-latency speech enhancement.
- **Supports in SIH26052:** `04_AI_ML/Enhancement_Lane.md` §5 (latency-budget and architecture-constraint discussion for a hypothetical future Causal GRU lane).
- **Influence:** Background research only; explicitly not implemented in Round 1. Author metadata should be re-confirmed on PMC before formal citation.

**[R13] Compact deep neural networks for real-time speech enhancement on resource-limited devices.** (see R11 above — also directly relevant to this category due to its GRU-bottleneck comparison.)
- **Supports in SIH26052:** `04_AI_ML/Enhancement_Lane.md` §3 (Causal GRU concept).
- **Influence:** Background research only.

---

## 9. Embedded ANC / Real-Time ANC

**[R14] Gan, W. S., Mitra, S., & Kuo, S. M. (2005).** "Adaptive feedback active noise control headset: Implementation, evaluation and its extensions." *IEEE Transactions on Consumer Electronics*, 51(3), 975–982.
- **Algorithm/method:** Real-time DSP implementation of an adaptive feedback ANC headset, including secondary-path estimation methodology.
- **Supports in SIH26052:** `07_Hardware/Hardware_Feasibility.md` (embedded/DSP feasibility discussion), `03_Algorithms/Secondary_Path_Modeling.md` (offline secondary-path estimation practice).
- **Influence:** Background research informing our projected hardware-feasibility estimates; not directly implemented (no physical headset built).

**[R15] Kuo, S. M., & Morgan, D. R. (1996).** (see R4 above — also directly relevant to this category.)
- **Supports in SIH26052:** `07_Hardware/Hardware_Feasibility.md` §3–§5 (computational/MCU-DSP feasibility framing).
- **Influence:** Background research.

---

## Notes on Citation Hygiene

- Entries marked "author/metadata should be re-confirmed" indicate that our search process located the paper and its core claims with high confidence but could not fully resolve every bibliographic field (e.g., complete author list) from the snippets available; the team should pull the canonical citation directly from the publisher page before including it in a formal report or slide deck.
- No DOI, author, title, or result has been invented for this package. Where an official DOI was not directly confirmed, we have not fabricated one.
