/* ==========================================================================
   draw.js — High-DPI Canvas Plotting & Signal Visualization Engine
   ========================================================================== */

const CSS = k => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  return v || '#00D2FF';
};

function setupDpiCanvas(cv) {
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.max(300, Math.round((rect.width || 800) * dpr));
  const targetH = Math.max(160, Math.round((rect.height || 300) * dpr));

  if (cv.width !== targetW || cv.height !== targetH) {
    cv.width = targetW;
    cv.height = targetH;
  }
}

function plot(cv, opts) {
  if (!cv) return;
  setupDpiCanvas(cv);

  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;

  const dpr = W / (cv.getBoundingClientRect().width || (W / 2));
  const m = {
    l: Math.round(68 * dpr),
    r: Math.round(24 * dpr),
    t: Math.round(20 * dpr),
    b: Math.round(46 * dpr)
  };

  // Clear Background
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#06090D';
  ctx.fillRect(0, 0, W, H);

  const { xmin, xmax, ymin, ymax } = opts;
  const X = v => m.l + (v - xmin) / (xmax - xmin) * (W - m.l - m.r);
  const Y = v => H - m.b - (v - ymin) / (ymax - ymin) * (H - m.t - m.b);

  // Draw Subtle Background Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = Math.max(1, 1 * dpr);
  ctx.fillStyle = '#64748B';
  ctx.font = `500 ${Math.round(11 * dpr)}px JetBrains Mono, monospace`;

  // Horizontal Grid Lines & Y-Axis Scale
  const yDivisions = 5;
  const yStep = (ymax - ymin) / yDivisions;
  for (let i = 0; i <= yDivisions; i++) {
    const v = ymin + i * yStep;
    const yPos = Y(v);
    ctx.beginPath();
    ctx.moveTo(m.l, yPos);
    ctx.lineTo(W - m.r, yPos);
    ctx.stroke();

    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(0), m.l - (8 * dpr), yPos + (4 * dpr));
  }

  // Vertical Grid Lines & X-Axis Scale
  const xDivisions = 6;
  const xStep = (xmax - xmin) / xDivisions;
  for (let i = 0; i <= xDivisions; i++) {
    const v = xmin + i * xStep;
    const xPos = X(v);
    ctx.beginPath();
    ctx.moveTo(xPos, m.t);
    ctx.lineTo(xPos, H - m.b);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillText(opts.xfmt ? opts.xfmt(v) : v.toFixed(1), xPos, H - m.b + (20 * dpr));
  }

  // Axis Titles
  ctx.fillStyle = '#94A3B8';
  ctx.font = `600 ${Math.round(12 * dpr)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(opts.xlabel || '', (m.l + W - m.r) / 2, H - (6 * dpr));

  ctx.save();
  ctx.translate(Math.round(18 * dpr), (m.t + H - m.b) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(opts.ylabel || '', 0, 0);
  ctx.restore();

  // State Shading Region (e.g., Active Protection Gating)
  if (opts.states && opts.states.length > 0) {
    for (const s of opts.states) {
      ctx.fillStyle = s.c || 'rgba(0, 229, 163, 0.16)';
      const rx = X(Math.max(xmin, s.a));
      const rw = Math.max(2 * dpr, X(Math.min(xmax, s.b)) - rx);
      ctx.fillRect(rx, m.t, rw, H - m.t - m.b);

      // Top state indicator bar
      ctx.fillStyle = '#00E5A3';
      ctx.fillRect(rx, m.t, rw, 3 * dpr);
    }
  }

  // Marker Line (e.g. Impulse Trigger Time)
  if (opts.marker !== undefined && opts.marker >= xmin && opts.marker <= xmax) {
    const mx = X(opts.marker);
    ctx.strokeStyle = '#FF5C5C';
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.lineWidth = 1.8 * dpr;
    ctx.beginPath();
    ctx.moveTo(mx, m.t);
    ctx.lineTo(mx, H - m.b);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#FF5C5C';
    ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(11 * dpr)}px JetBrains Mono, monospace`;
    ctx.fillText(opts.markerLabel || 'Trigger', mx + (6 * dpr), m.t + (16 * dpr));
  }

  // Draw Data Series Curves
  if (opts.series) {
    for (const s of opts.series) {
      if (!s.y || s.y.length === 0) continue;

      ctx.strokeStyle = s.color || '#00D2FF';
      ctx.lineWidth = (s.w || 2.2) * dpr;
      if (s.dash) ctx.setLineDash(s.dash.map(d => d * dpr));
      ctx.beginPath();

      const step = Math.max(1, Math.floor(s.y.length / 1600));
      let started = false;

      for (let i = 0; i < s.y.length; i += step) {
        const xv = s.x ? s.x[i] : i / (opts.fs || 4000);
        if (xv < xmin || xv > xmax) continue;
        const yv = s.y[i];
        if (!isFinite(yv)) continue;

        const px = X(xv);
        const py = Y(Math.max(ymin, Math.min(ymax, yv)));

        if (started) {
          ctx.lineTo(px, py);
        } else {
          ctx.moveTo(px, py);
          started = true;
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Clean Chart Inner Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
}
