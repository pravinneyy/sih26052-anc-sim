# SIH26052 — Adaptive Noise Cancellation for Defence Environments
## Technical Documentation Package

This `docs/` folder is a GitHub-ready technical documentation package for our SIH26052 submission. It documents the algorithms, mathematics, simulation methodology, experiments, hardware feasibility, and research foundations of our Round‑1 web-based ANC simulation.

Every document uses the following labeling convention:

| Label | Meaning |
|---|---|
| **Implemented** | Working in the current Round‑1 web simulation/codebase today. |
| **Partially Implemented** | Core logic exists but is simplified, simulated, or missing sub-components. |
| **Illustrative** | Present in the demo for explanatory purposes only; not a validated or production algorithm. |
| **Future Work** | Planned but not yet started or not yet functional. |

**Nothing in this package claims a trained neural network, completed embedded hardware, measured acoustic paths, or a completed offline Python simulation pipeline — all of these are explicitly marked as future work throughout.**

## Folder Structure

```text
docs/
├── 01_Problem_Statement/     Problem definition, scope, and Round‑1 non-claims
├── 02_System_Architecture/   Panel-by-panel architecture of the web simulation
├── 03_Algorithms/            ANC theory, FxLMS, state detector, protection/recovery,
│                              robust ANC comparison, secondary-path modelling
├── 04_AI_ML/                 Enhancement lane (explicitly future/illustrative)
├── 05_Simulation/            Current client-side pipeline vs. intended future Python pipeline
├── 06_Experiments/           Experiment protocols (objective/setup/procedure — results pending)
├── 07_Hardware/              Projected embedded feasibility (no hardware built yet)
└── 08_References/            Verified research paper references
```

## Recommended Reading Order for Judges

1. `01_Problem_Statement/Problem_Overview.md`
2. `02_System_Architecture/System_Architecture.md`
3. `03_Algorithms/ANC_Fundamentals.md` → `FxLMS_Algorithm.md` → `State_Detector.md` → `Protection_and_Recovery.md` → `Robust_ANC.md` → `Secondary_Path_Modeling.md`
4. `04_AI_ML/Enhancement_Lane.md`
5. `05_Simulation/Simulation_Methodology.md`
6. `06_Experiments/*`
7. `07_Hardware/Hardware_Feasibility.md`
8. `08_References/Research_Papers.md`

## Priority: Which Documents to Complete First

Ranked by importance for demonstrating technical depth to SIH judges and by dependency (later documents reference earlier ones):

1. **`03_Algorithms/FxLMS_Algorithm.md`** — the algorithmic core of the entire project; everything else references it.
2. **`02_System_Architecture/System_Architecture.md`** — gives judges the map they need to navigate a demo.
3. **`03_Algorithms/State_Detector.md`** — the second core algorithm; directly differentiates this project from a generic FxLMS demo.
4. **`01_Problem_Statement/Problem_Overview.md`** — sets expectations and scope correctly; prevents overclaiming.
5. **`03_Algorithms/Secondary_Path_Modeling.md`** — backs the mismatch-experiment panel, a distinctive demo feature.
6. **`06_Experiments/*`** — turns panels into a credible evaluation story once experiments are actually run and placeholders filled in.
7. **`03_Algorithms/Protection_and_Recovery.md`** and **`Robust_ANC.md`** — important but explicitly depend on design decisions ("to be finalized") that should be locked down first.
8. **`08_References/Research_Papers.md`** — valuable to have complete but lowest technical risk if delayed.
9. **`04_AI_ML/Enhancement_Lane.md`** and **`07_Hardware/Hardware_Feasibility.md`** — both are explicitly future-facing; useful for showing roadmap thinking but not blocking for demonstrating the Round‑1 core.

## Recommended GitHub Commit Structure

```text
docs: add problem overview and Round 1 scope definition
docs: add system architecture documentation
docs: add ANC fundamentals documentation
docs: add FxLMS algorithm documentation
docs: add state detector methodology
docs: add protection and recovery documentation
docs: add robust ANC comparison documentation
docs: add secondary path modelling documentation
docs: add AI/ML enhancement lane documentation (future work)
docs: add simulation methodology documentation
docs: add impulse experiment methodology
docs: add detector evaluation experiment methodology
docs: add secondary path mismatch experiment methodology
docs: add hardware feasibility documentation
docs: add research paper references
docs: add docs README and priority/commit guide
```

Each commit should touch only the corresponding file(s) so that reviewers (and judges browsing commit history) can see the documentation build up algorithm-by-algorithm rather than as a single monolithic drop.
