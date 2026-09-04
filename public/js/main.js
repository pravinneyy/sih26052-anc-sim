/* ==========================================================================
   main.js — Master Application Boot, Redraw Dispatcher & Global Controls
   ========================================================================== */

function resetPanel() {
  const panelId = PANELS[cur] ? PANELS[cur][1] : '';

  if (panelId === 'p2') {
    const ampEl = document.getElementById('amp');
    const ampOut = document.getElementById('ampOut');
    if (ampEl && ampOut) {
      ampEl.value = 400;
      ampOut.textContent = '400';
    }
    document.querySelectorAll('#sysToggles .tg').forEach(b => {
      sysOn[b.dataset.s] = true;
      b.setAttribute('aria-pressed', 'true');
    });
    if (typeof runP2 === 'function') runP2();
  }

  if (panelId === 'p4') {
    const thrEl = document.getElementById('thr');
    const thrOut = document.getElementById('thrOut');
    if (thrEl && thrOut) {
      thrEl.value = 4.0;
      thrOut.textContent = '4.0';
    }
    window.__thr = 4.0;
    if (typeof runP4 === 'function') runP4();
  }

  if (panelId === 'p5') {
    const mmEl = document.getElementById('mm');
    const mmOut = document.getElementById('mmOut');
    if (mmEl && mmOut) {
      mmEl.value = 0;
      mmOut.textContent = '0';
    }
    if (typeof runP5 === 'function') runP5();
  }

  if (panelId === 'p6') {
    const resetBtn = document.getElementById('resetLive');
    if (resetBtn) resetBtn.click();
  }

  if (panelId === 'p8') {
    if (typeof playing8 !== 'undefined' && playing8 && typeof srcNode8 !== 'undefined' && srcNode8) {
      srcNode8.onended = null;
      try { srcNode8.stop(); } catch (e) {}
      playing8 = false;
      const playBtn = document.getElementById('playBtn8');
      if (playBtn) playBtn.textContent = 'Play';
    }
    if (typeof offset8 !== 'undefined') offset8 = 0;
    if (typeof curSrc8 !== 'undefined') curSrc8 = 'raw';
    document.querySelectorAll('#enhSrc button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.v === 'raw');
    });
    if (typeof runP8 === 'function') runP8();
  }

  if (panelId === 'p9') {
    if (typeof p9Reset === 'function') p9Reset();
  }

  if (panelId === 'p10') {
    if (typeof p10Reset === 'function') p10Reset();
  }
}

const resetAllBtn = document.getElementById('resetAll');
if (resetAllBtn) {
  resetAllBtn.onclick = resetPanel;
}

// Redraw handler based on active panel ID
function redraw() {
  const panelId = PANELS[cur] ? PANELS[cur][1] : '';
  if (panelId === 'p2' && typeof runP2 === 'function') runP2();
  if (panelId === 'p4' && typeof runP4 === 'function') runP4();
  if (panelId === 'p5' && typeof runP5 === 'function') runP5();
  if (panelId === 'p6' && typeof runP6 === 'function') runP6();
  if (panelId === 'p8' && typeof runP8 === 'function') runP8();
  if (panelId === 'p10' && typeof p10Start === 'function') p10Start();
}

// Debounce window resize
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    redraw();
  }, 120);
});

// Boot Application
show(0);
