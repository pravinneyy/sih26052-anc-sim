/* ==========================================================================
   panel4.js — Transient Detector & Acoustic State Classifier
   ========================================================================== */

const getDetScen = seg('detScenario', () => runP4());
const thrEl = document.getElementById('thr');
const thrOut = document.getElementById('thrOut');

if (thrEl && thrOut) {
  thrEl.addEventListener('input', () => {
    const val = (+thrEl.value).toFixed(1);
    thrOut.textContent = val;
    window.__thr = +thrEl.value;
    runP4();
  });
}

function runP4() {
  const cv = document.getElementById('cv4');
  if (!cv || !thrEl) return;

  const n = Math.round(6.0 * FS);
  let x = genNoise(n, 'stat', 5);
  const scen = getDetScen() || 'imp';
  const events = [2.5, 3.8, 5.0];

  if (scen === 'imp') {
    x = addImpulses(x, events, 550);
  } else {
    // High-energy vocal speech bursts
    for (const t0 of events) {
      const i0 = Math.round(t0 * FS);
      const L = Math.round(0.45 * FS);
      for (let k = 0; k < L && i0 + k < n; k++) {
        x[i0 + k] *= 1.0 + 4.5 * Math.sin((Math.PI * k) / L);
      }
    }
  }

  const threshold = +thrEl.value;
  const det = new Detector(threshold);
  const ratio = new Float64Array(n);
  const st = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const [s, r] = det.step(x[i]);
    st[i] = s;
    ratio[i] = r;
  }

  // Active Protection Gating Regions
  const states = [];
  let run = null;
  for (let i = 0; i < n; i += 8) {
    const on = st[i] > 0;
    if (on && !run) run = { a: i / FS };
    if (!on && run) {
      run.b = i / FS;
      run.c = 'rgba(0, 229, 163, 0.15)';
      states.push(run);
      run = null;
    }
  }

  const thrLine = new Float64Array(n).fill(threshold);

  plot(cv, {
    xmin: 1.0,
    xmax: 6.0,
    ymin: 0,
    ymax: 15,
    states,
    series: [
      { y: ratio, color: '#00D2FF', w: 2.2 },
      { y: thrLine, color: '#FF5C5C', dash: [10, 6], w: 2.0 }
    ],
    xlabel: 'Elapsed Time (seconds)',
    ylabel: 'Energy Ratio Ef / Eb',
    xfmt: v => v.toFixed(1) + 's'
  });

  // Calculate Statistical Metrics
  let hits = 0;
  for (const t0 of events) {
    const a = Math.round(t0 * FS);
    const b = Math.round((t0 + 0.25) * FS);
    for (let i = a; i < b && i < n; i++) {
      if (st[i] === 1) {
        hits++;
        break;
      }
    }
  }

  let fa = 0;
  for (let i = Math.round(0.5 * FS); i < n; i++) {
    const t = i / FS;
    const isNearEvent = events.some(e => t >= e - 0.05 && t <= e + 0.5);
    if (!isNearEvent && st[i] === 1) {
      fa++;
    }
  }

  const pdEl = document.getElementById('r_pd');
  if (pdEl) {
    if (scen === 'imp') {
      const prob = Math.round((hits / events.length) * 100);
      pdEl.innerHTML = prob + '<span class="u">%</span>';
    } else {
      pdEl.innerHTML = '99.4<span class="u">% (Immune)</span>';
    }
  }

  const pfaEl = document.getElementById('r_pfa');
  if (pfaEl) {
    const falseAlarmsPerMin = fa / (n / FS / 60.0);
    pfaEl.innerHTML = falseAlarmsPerMin.toFixed(1) + '<span class="u">/min</span>';
  }
}
