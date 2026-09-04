/* ==========================================================================
   shell.js — Navigation Rail, Tour Controller, Shortcuts & Responsive Shell
   ========================================================================== */

const PANELS = [
  ['Architecture', 'p1'],
  ['Hardware & BOM', 'phw'],
  ['Impulse & Controller Performance', 'p2'],
  ['Acoustic Listening Console', 'p3'],
  ['Transient Energy Classifier', 'p4'],
  ['Secondary-Path Stability Sweep', 'p5'],
  ['Adaptive LMS Filter Tuning', 'p6'],
  ['Subband Speech Enhancement', 'p8'],
  ['Interactive Audio Lab', 'p9'],
  ['AI/ML Neural Adaptive Engine', 'p10']
];

let cur = 0;
const nav = document.getElementById('nav');

function renderNav() {
  if (!nav) return;
  nav.innerHTML = '';
  PANELS.forEach(([label, id], i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button data-i="${i}" data-id="${id}" aria-current="${i === cur}">
      <span class="n">${i + 1}</span>
      <span>${label}</span>
    </button>`;
    nav.appendChild(li);
  });
}

function show(i) {
  cur = Math.max(0, Math.min(PANELS.length - 1, i));
  const activeId = PANELS[cur][1];

  document.querySelectorAll('.panel').forEach(p => {
    const isOn = p.id === activeId;
    p.classList.toggle('on', isOn);
  });

  if (nav) {
    nav.querySelectorAll('button').forEach((b, k) => {
      b.setAttribute('aria-current', k === cur);
    });
  }

  const tourPosEl = document.getElementById('tourPos');
  if (tourPosEl) {
    tourPosEl.textContent = `${cur + 1} / ${PANELS.length}`;
  }

  // Close mobile drawer if open
  const rail = document.querySelector('.rail');
  if (rail) rail.classList.remove('mobile-open');

  // Trigger chart redraw on active panel
  if (typeof redraw === 'function') {
    setTimeout(redraw, 20);
  }
}

renderNav();

if (nav) {
  nav.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && b.dataset.i !== undefined) {
      show(+b.dataset.i);
    }
  });
}

const tourNext = document.getElementById('tourNext');
if (tourNext) tourNext.onclick = () => show(cur + 1);

const tourPrev = document.getElementById('tourPrev');
if (tourPrev) tourPrev.onclick = () => show(cur - 1);

// Keyboard Shortcuts
document.addEventListener('keydown', e => {
  if (e.target.matches('input, button, select, textarea')) return;
  if (e.key === 'ArrowRight') show(cur + 1);
  if (e.key === 'ArrowLeft') show(cur - 1);
  if (e.key.toLowerCase() === 'r' && typeof resetPanel === 'function') {
    e.preventDefault();
    resetPanel();
  }
  if (e.key === ' ' && PANELS[cur][1] === 'p2' && typeof runP2 === 'function') {
    e.preventDefault();
    runP2();
  }
});

// Mobile Drawer Toggle
const menuBtn = document.getElementById('menuToggle');
if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    const rail = document.querySelector('.rail');
    if (rail) rail.classList.toggle('mobile-open');
  });
}

// Close drawer when clicking outside on mobile
document.addEventListener('click', e => {
  const rail = document.querySelector('.rail');
  const menuBtn = document.getElementById('menuToggle');
  if (rail && rail.classList.contains('mobile-open')) {
    if (!rail.contains(e.target) && !menuBtn.contains(e.target)) {
      rail.classList.remove('mobile-open');
    }
  }
});

// Segmented Control Helper
function seg(id, cb) {
  const el = document.getElementById(id);
  if (!el) return () => '';
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    if (cb) cb(b.dataset.v);
  });
  return () => {
    const active = el.querySelector('[aria-pressed="true"]');
    return active ? active.dataset.v : '';
  };
}
