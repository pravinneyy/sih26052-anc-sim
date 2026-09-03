/* ==========================================================================
   panel5.js — Secondary-Path Mismatch & Stability Boundary Sweep
   ========================================================================== */

const mmEl = document.getElementById('mm');
const mmOut = document.getElementById('mmOut');

if (mmEl && mmOut) {
  mmEl.addEventListener('input', () => {
    mmOut.textContent = mmEl.value;
    runP5();
  });
}

const sweepBtn = document.getElementById('runSweep');
if (sweepBtn) {
  sweepBtn.onclick = runP5;
}

function runP5() {
  const cv = document.getElementById('cv5');
  if (!cv || !sweepBtn) return;

  sweepBtn.textContent = 'Executing Sweep…';
  sweepBtn.disabled = true;

  setTimeout(() => {
    const n = Math.round(3.2 * FS);
    const { P, S } = makePaths(0);
    const x = genNoise(n, 'stat', 3);
    const pcts = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    const out = { A: [], B: [], C: [] };

    for (const pc of pcts) {
      const Sh = perturb(S, pc, 4);
      for (const v of ['A', 'B', 'C']) {
        const r = runFxLMS(x, P, S, Sh, v, 0.005, 32);
        const at = atten(r.d, r.e, Math.round(2.2 * FS), Math.round(3.0 * FS));
        out[v].push(Math.max(-10, Math.min(35, at)));
      }
    }

    const colors = { A: '#FF5C5C', B: '#FFB830', C: '#00E5A3' };
    plot(cv, {
      xmin: 0,
      xmax: 50,
      ymin: -10,
      ymax: 32,
      series: ['A', 'B', 'C'].map(v => ({
        x: pcts,
        y: out[v],
        color: colors[v],
        w: v === 'C' ? 2.8 : 2.0
      })),
      xlabel: 'Secondary-Path Model Error Ŝ(z) Deviation (%)',
      ylabel: 'Acoustic Attenuation (dB)',
      xfmt: v => v.toFixed(0) + '%'
    });

    sweepBtn.textContent = 'Execute Stability Sweep';
    sweepBtn.disabled = false;
  }, 40);
}
