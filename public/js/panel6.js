/* ==========================================================================
   panel6.js — Real-Time Adaptive LMS Filter Simulator & Weight Convergence
   ========================================================================== */

const muEl = document.getElementById('mu');
const muOut = document.getElementById('muOut');
const tapsEl = document.getElementById('taps');
const tapsOut = document.getElementById('tapsOut');

const muVal = () => (muEl ? +muEl.value / 1000 : 0.005);

if (muEl && muOut) {
  muEl.addEventListener('input', () => {
    muOut.textContent = muVal().toFixed(3);
    runP6();
  });
}

if (tapsEl && tapsOut) {
  tapsEl.addEventListener('input', () => {
    tapsOut.textContent = tapsEl.value;
    runP6();
  });
}

const resetLiveBtn = document.getElementById('resetLive');
if (resetLiveBtn) {
  resetLiveBtn.onclick = () => {
    if (muEl && muOut) {
      muEl.value = 5;
      muOut.textContent = '0.005';
    }
    if (tapsEl && tapsOut) {
      tapsEl.value = 32;
      tapsOut.textContent = '32';
    }
    runP6();
  };
}

function runP6() {
  const cv = document.getElementById('cv6');
  if (!cv || !tapsEl) return;

  const n = Math.round(3.0 * FS);
  const { P, S } = makePaths(1);
  const x = genNoise(n, 'stat', 6);
  const r = runFxLMS(x, P, S, S, 'A', muVal(), +tapsEl.value);

  plot(cv, {
    xmin: 0,
    xmax: 3.0,
    ymin: -65,
    ymax: 30,
    series: [{ y: smoothDb(r.e, 25), color: '#00D2FF', w: 2.2 }],
    xlabel: 'Elapsed Time (seconds)',
    ylabel: 'Residual Error Energy (dB)',
    xfmt: v => v.toFixed(1) + 's'
  });

  const a = atten(r.d, r.e, Math.round(2.2 * FS), Math.round(2.9 * FS));
  const rLiveEl = document.getElementById('r_live');
  if (rLiveEl) {
    rLiveEl.innerHTML = (isFinite(a) ? a.toFixed(1) : '0.0') + '<span class="u">dB</span>';
  }
}
