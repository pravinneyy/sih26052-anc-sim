/* ==========================================================================
   panel5.js — Secondary-Path Mismatch & Stability Boundary Sweep
   ========================================================================== */

const mmEl = document.getElementById('mm');
const mmOut = document.getElementById('mmOut');
let p5Sweep = null; // cached {pcts, out, colors} so the slider can move a
                     // marker on the chart without recomputing the sweep
let p5NoiseSeed = 3; // bumped on every "Execute Stability Sweep" press so
                     // repeat clicks visibly rerun instead of reproducing
                     // a pixel-identical chart, which reads as a dead button

if (mmEl && mmOut) {
  mmEl.addEventListener('input', () => {
    mmOut.textContent = mmEl.value;
    p5Replot();
  });
}

const sweepBtn = document.getElementById('runSweep');
if (sweepBtn) {
  sweepBtn.onclick = runP5;
}

function p5Replot() {
  const cv = document.getElementById('cv5');
  if (!cv || !p5Sweep) return;
  const { pcts, out, colors } = p5Sweep;
  plot(cv, {
    xmin: 0,
    xmax: 240,
    ymin: -40,
    ymax: 18,
    series: ['A', 'B', 'C', 'D'].map(v => ({
      x: pcts,
      y: out[v],
      color: colors[v],
      w: v === 'D' ? 3.0 : (v === 'C' ? 2.4 : 1.8)
    })),
    marker: mmEl ? +mmEl.value : undefined,
    markerLabel: mmEl ? mmEl.value + '%' : undefined,
    xlabel: 'Secondary-Path Model Error Ŝ(z) Deviation (%)',
    ylabel: 'Acoustic Attenuation (dB)',
    xfmt: v => v.toFixed(0) + '%'
  });
}

/* Linear-interpolate the % at which the attenuation curve first crosses
   0 dB, rather than just reporting the nearest sampled point. */
function findBoundary(pcts, vals) {
  for (let i = 1; i < vals.length; i++) {
    if (vals[i - 1] >= 0 && vals[i] < 0) {
      const t = vals[i - 1] / (vals[i - 1] - vals[i]);
      return pcts[i - 1] + t * (pcts[i] - pcts[i - 1]);
    }
  }
  return NaN; // never crossed zero within the swept range
}

function runP5() {
  const cv = document.getElementById('cv5');
  if (!cv || !sweepBtn) return;

  sweepBtn.textContent = 'Executing Sweep…';
  sweepBtn.disabled = true;
  p5NoiseSeed = (p5NoiseSeed + 1) % 100000 || 1;

  setTimeout(() => {
    const n = Math.round(3.2 * FS);
    const { P, S } = makePaths(0);
    const x = genNoise(n, 'stat', p5NoiseSeed);
    // Dense near the boundary (~180-220%), coarser elsewhere — the real
    // stability boundary for this path/step-size combination sits well
    // past 100% model error, not in the 0-40% range the slider used to
    // stop at.
    const pcts = [0, 20, 40, 60, 80, 100, 120, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240];
    const out = { A: [], B: [], C: [], D: [] };

    for (const pc of pcts) {
      const Sh = perturb(S, pc, 4);
      for (const v of ['A', 'B', 'C', 'D']) {
        const r = runFxLMS(x, P, S, Sh, v, 0.005, 32);
        const at = atten(r.d, r.e, Math.round(2.2 * FS), Math.round(3.0 * FS));
        out[v].push(Math.max(-40, Math.min(18, at)));
      }
    }

    const colors = { A: '#FF5C5C', B: '#FFB830', C: '#00E5A3', D: '#00D2FF' };
    p5Sweep = { pcts, out, colors };
    p5Replot();

    const setBound = (id, pct) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = (isFinite(pct) ? pct.toFixed(0) : '>240') + '<span class="u">%</span>';
    };
    setBound('r_boundA', findBoundary(pcts, out.A));
    setBound('r_boundB', findBoundary(pcts, out.B));
    setBound('r_boundC', findBoundary(pcts, out.C));
    setBound('r_boundD', findBoundary(pcts, out.D));

    sweepBtn.textContent = 'Execute Stability Sweep';
    sweepBtn.disabled = false;
  }, 30);
}
