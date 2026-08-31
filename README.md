# SIH26052 — Adaptive Noise Cancellation, Round 1 web simulation

Interactive console for the Round 1 demonstration described in
`SIH26052_Web_Simulation_Spec.docx`. Nine panels: architecture, an impulse
experiment, a listen-to-it audio comparison, the state detector, secondary-path
mismatch, a live in-browser filter, an honesty panel, an illustrative preview
of the enhancement lane, and a panel that runs the judge's own recorded or
uploaded audio through that same mask.

## Run it

**Directly (matches the demo spec — no install, works offline):**

Open `public/index.html` in a browser. That's it. This is what gets carried on
a USB stick or hosted on GitHub Pages — the spec requires the demo to survive
a dead network on a projector, so nothing under `public/` depends on a server
being up. (Exception: microphone recording on panel 9 may need a secure
context — see Known gaps.)

**With the local dev server (optional convenience):**

```
npm install
npm start          # http://localhost:3000
```

`GET /api/health` returns `{"status":"ok"}` once it's running.

## Folder structure

```
public/            everything the browser actually loads — works via file://
  index.html       slim entry point, links css/js
  css/style.css
  js/
    sim.js          RNG, acoustic paths, noise generation, the state Detector,
                    the FxLMS core, dB smoothing / attenuation / recovery-time helpers
    draw.js         canvas plotting used by every scope panel
    enhance.js       illustrative gain-mask engine, shared by panels 8 and 9
    shell.js         panel list, nav rail, guided tour, keyboard shortcuts, seg() helper
    panel1.js        architecture diagram — clickable blocks
    panel2.js        the impulse experiment (centrepiece)
    panel3.js        listen — before/after audio transport (placeholder buffers)
    panel4.js        detector behaviour
    panel5.js        secondary-path mismatch sweep
    panel6.js        live FxLMS running in the browser
    panel8.js        enhancement preview on a synthetic clip
    panel9.js        try it on your own recorded/uploaded audio
    main.js          reset-all, redraw dispatch, initial render — loaded last
  data/            empty — where a future `results.json` (from `anc_sim.py`) would go
  audio/           empty — where future rendered `*.wav` clips would go

src/               a small Express app — local-dev convenience only, not required to run the demo
  app.js           express.static(public/) + routes + middlewares, listens on PORT
  config/          server.config.js — port and the path to public/
  controllers/     demoController.js — health check
  routes/          index.routes.js — GET /api/health
  middlewares/     requestLogger.js, notFound.js
  models/          empty, reserved — this app has no database or persistence
                   (an explicit non-goal in the spec), so there's nothing to model yet
  services/        empty, reserved — no server-side business logic; every
                   computation (FxLMS, the detector, the enhancement mask) runs
                   client-side in public/js, per the spec's pre-compute-then-serve-
                   statically architecture
  utils/           paths.js — resolves the public/ directory
```

Panel scripts are loaded in dependency order (engines first, then `shell.js`,
then each `panelN.js`, then `main.js` last) — see the `<script>` tags at the
bottom of `index.html`. They're plain global-scope scripts, no bundler, no
build step, per the spec's own stack choice.

## Panel status

| # | Panel | State |
|---|---|---|
| 1 | Two problems | Complete. Clickable diagram blocks, latency bars to scale. |
| 2 | Impulse experiment | Live — reduced FxLMS in `sim.js`. Attenuation-lost and recovery-time readouts are both computed from the trace, not hardcoded. Replace with `data/results.json` for the full-resolution build. |
| 3 | Listen | Transport logic complete. Audio buffers are synthesised placeholders — swap in rendered `audio/*.wav` from the Python pipeline. |
| 4 | Detector | Live — real detector, both scenarios, P_d / P_fa computed. |
| 5 | Path mismatch | Live — runs the sweep on demand. Stability boundary not yet marked with a labelled value. |
| 6 | Live filter | Live — real FxLMS, diverges when µ is pushed past ~0.02. |
| 7 | Honesty | Complete, static content. |
| 8 | Enhancement preview | Live, illustrative only — a hand-written per-band energy-ratio gain mask, explicitly labeled as not a trained model. Stands in for the Causal GRU mask shown in panel 1 until a real model exists. |
| 9 | Try your own audio | Live. Record or upload, then run the same mask from panel 8 on it. Enhancement-style only — cannot demonstrate FxLMS cancellation (needs a second reference-mic signal a single track doesn't have). |

Also working: rail navigation, guided tour (Previous/Next), keyboard shortcuts
(← → panels, R reset, Space fires the impulse on panel 2), per-panel reset.

## Why panels 8 and 9 exist

The underlying SIH problem statement is an AI/ML noise-suppression system, but
the spec explicitly scopes the neural enhancement path out of Round 1 ("say so
explicitly"). Rather than leave it as a diagram label with nothing behind it,
panel 8 shows the *mechanism* a learned mask would sit inside — per-band gain
estimated from local signal statistics, applied and resynthesised — and panel
9 lets a judge run that same mechanism on their own voice or a file they bring.
Neither is a neural network, neither was trained on data, and panel 7 says so.

## Pending / known gaps

- **No `anc_sim.py` / `results.json` pipeline yet.** Panels 2, 3, and 5
  compute or synthesise in the browser at reduced resolution instead of
  loading pre-computed full-resolution results, per spec section 2.1. This is
  the largest remaining item — everything else in the spec's build order
  depends on it existing.
- **Panel 3's before/after clips are synthesised placeholders**, not real
  rendered `*.wav` files from the Python pipeline.
- **Panel 5 doesn't mark each system's stability boundary** with a labelled
  number on the chart yet.
- **No trained model anywhere** — panels 8/9's enhancement mask is a
  disclosed hand-written heuristic, not the Causal GRU from panel 1. Training
  one needs the dataset-generation and training-framework phases from the
  original SIH problem statement, which are out of scope for this Round 1 web
  console.
- **Hardware phases (roadmap phases 1–4) haven't started**: no embedded/edge
  deployment, no ONNX/TensorRT export, no measured acoustic paths.
- **Panel 9's microphone recording needs a secure context.** Some
  browsers restrict `getUserMedia` when the page is opened from a bare
  `file://` path. If recording doesn't prompt for mic access, run
  `npm start` and use `http://localhost:3000` instead — file upload works
  either way regardless of context. **Test this on the actual demo laptop
  and browser before presenting**, per the spec's "rehearse on the actual
  projector" guidance.
- **No automated tests.**
- **Not yet in git / not yet deployed** — nothing has been pushed to GitHub
  Pages or committed to version control yet.
- `LICENSE` copyright line uses a placeholder name — edit it if you want your
  own name/team on it.
- Responsive layout is desktop-only by design (this runs on a laptop driving a
  projector) — do not present on a tablet.

## One implementation detail worth keeping

The power normaliser in `sim.js`'s `runFxLMS` is deliberately bounded:

```js
pnorm = 0.999*pnorm + 0.001*Math.min(pw, 4*pnorm);
```

Without the bound, a single impulse inflates the normaliser by four orders of
magnitude, the step size collapses for several seconds, and all three systems
freeze identically — which hides the exact effect the demo exists to show.
The same trap is worth knowing about for the firmware.
