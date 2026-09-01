/* ==========================================================================
   panel2.js — Impulse Response & Robust Controller Performance Comparison
   ========================================================================== */

const getNoise = seg('noiseType', () => runP2());
const getPattern = seg('pattern', () => runP2());
const sysOn = { A: true, B: true, C: true };

const sysToggles = document.getElementById('sysToggles');
if (sysToggles) {
  sysToggles.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !b.dataset.s) return;
    sysOn[b.dataset.s] = !sysOn[b.dataset.s];
    b.setAttribute('aria-pressed', sysOn[b.dataset.s]);
    runP2();
  });
}

const ampEl = document.getElementById('amp');
const ampOut = document.getElementById('ampOut');
if (ampEl && ampOut) {
  ampEl.addEventListener('input', () => {
    ampOut.textContent = ampEl.value;
    runP2();
  });
}

const fireBtn = document.getElementById('fire');
if (fireBtn) {
  fireBtn.onclick = () => {
    // Add tactile animation
    fireBtn.style.transform = 'scale(0.97)';
    setTimeout(() => { fireBtn.style.transform = ''; }, 100);
    runP2();
  };
}

function runP2() {
  const cv = document.getElementById('cv2');
  if (!cv || !ampEl) return;

  const n = Math.round(6.0 * FS);
  const { P, S } = makePaths(0);
  const amp = +ampEl.value;
  const pat = getPattern();

  let times = [];
  if (pat === 'single') {
    times = [3.5];
  } else if (pat === 'burst') {
    times = [3.5, 3.62, 3.74, 3.86, 3.98, 4.10, 4.22, 4.34];
  }

  const noiseType = getNoise() || 'stat';
  const x = addImpulses(genNoise(n, noiseType, 3), times, amp);
  const colors = { A: '#FF5C5C', B: '#FFB830', C: '#00E5A3' };
  const series = [];
  const res = {};

  for (const v of ['A', 'B', 'C']) {
    const r = runFxLMS(x, P, S, S, v, 0.005, 32);
    r.sm = smoothDb(r.e, 25);
    res[v] = r;
    if (sysOn[v]) {
      series.push({
        y: r.sm,
        color: colors[v],
        w: v === 'C' ? 2.8 : 2.0
      });
    }
  }

  const states = [];
  if (times.length > 0 && res.C && res.C.st) {
    let run = null;
    for (let i = 0; i < res.C.st.length; i += 8) {
      const on = res.C.st[i] > 0;
      if (on && !run) run = { a: i / FS };
      if (!on && run) {
        run.b = i / FS;
        run.c = 'rgba(0, 229, 163, 0.14)';
        states.push(run);
        run = null;
      }
    }
  }

  plot(cv, {
    xmin: 2.0,
    xmax: 6.0,
    ymin: -65,
    ymax: 15,
    series,
    states,
    marker: times.length ? times[0] : undefined,
    markerLabel: 'Impulse Transient',
    xlabel: 'Elapsed Time (seconds)',
    ylabel: 'Residual Error Energy (dB)',
    xfmt: v => v.toFixed(1) + 's'
  });

  const pre = v => atten(res[v].d, res[v].e, Math.round(2.4 * FS), Math.round(3.4 * FS));
  const post = v =>
    atten(
      res[v].d,
      res[v].e,
      Math.round(((times.length ? times[times.length - 1] : 3.5) + 0.02) * FS),
      Math.round(((times.length ? times[times.length - 1] : 3.5) + 0.30) * FS)
    );

  const setVal = (id, val, dp) => {
    const el = document.getElementById(id);
    if (!el) return;
    const numStr = isFinite(val) ? val.toFixed(dp) : '0.0';
    el.innerHTML = numStr + '<span class="u">dB</span>';
  };

  if (times.length > 0) {
    const lossA = Math.max(0, pre('A') - post('A'));
    const lossC = Math.max(0, pre('C') - post('C'));
    setVal('r_loss', lossA, 1);
    setVal('r_lossC', lossC, 1);

    const lastT = times[times.length - 1];
    const baseline = meanDbWindow(res.A.sm, Math.round(2.4 * FS), Math.round(3.4 * FS));
    const fromIdx = Math.round((lastT + 0.02) * FS);
    const rec = recoveryMs(res.A.sm, fromIdx, baseline, 1.2, Math.round(0.05 * FS));

    const recEl = document.getElementById('r_rec');
    if (recEl) recEl.innerHTML = Math.round(rec) + '<span class="u">ms</span>';
  } else {
    setVal('r_loss', 0.0, 1);
    setVal('r_lossC', 0.0, 1);
    const recEl = document.getElementById('r_rec');
    if (recEl) recEl.innerHTML = '0<span class="u">ms</span>';
  }
}
