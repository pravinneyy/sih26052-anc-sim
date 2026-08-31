/* draw.js — canvas plotting */
const CSS=k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim();
function plot(cv,opts){
  const ctx=cv.getContext('2d'), W=cv.width, H=cv.height;
  const m={l:96,r:26,t:24,b:60};
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle=CSS('--screen'); ctx.fillRect(0,0,W,H);
  const {xmin,xmax,ymin,ymax}=opts;
  const X=v=>m.l+(v-xmin)/(xmax-xmin)*(W-m.l-m.r);
  const Y=v=>H-m.b-(v-ymin)/(ymax-ymin)*(H-m.t-m.b);

  ctx.strokeStyle=CSS('--grid'); ctx.lineWidth=1.5;
  ctx.fillStyle='#7E9099'; ctx.font='22px '+CSS('--mono');
  const yStep=(ymax-ymin)/5;
  for(let i=0;i<=5;i++){const v=ymin+i*yStep;
    ctx.beginPath();ctx.moveTo(m.l,Y(v));ctx.lineTo(W-m.r,Y(v));ctx.stroke();
    ctx.textAlign='right';ctx.fillText(v.toFixed(0),m.l-14,Y(v)+8);}
  const xStep=(xmax-xmin)/6;
  for(let i=0;i<=6;i++){const v=xmin+i*xStep;
    ctx.beginPath();ctx.moveTo(X(v),m.t);ctx.lineTo(X(v),H-m.b);ctx.stroke();
    ctx.textAlign='center';ctx.fillText(opts.xfmt?opts.xfmt(v):v.toFixed(1),X(v),H-m.b+34);}

  ctx.fillStyle='#96A8AE'; ctx.font='24px '+CSS('--sans');
  ctx.textAlign='center'; ctx.fillText(opts.xlabel||'',(m.l+W-m.r)/2,H-10);
  ctx.save(); ctx.translate(26,(m.t+H-m.b)/2); ctx.rotate(-Math.PI/2);
  ctx.fillText(opts.ylabel||'',0,0); ctx.restore();

  /* state shading behind the traces */
  if(opts.states){
    for(const s of opts.states){
      ctx.fillStyle=s.c; ctx.fillRect(X(s.a),m.t,Math.max(2,X(s.b)-X(s.a)),H-m.t-m.b);
    }
  }
  if(opts.marker!==undefined){
    ctx.strokeStyle='#8FA0A6'; ctx.setLineDash([10,8]); ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(X(opts.marker),m.t);ctx.lineTo(X(opts.marker),H-m.b);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#8FA0A6'; ctx.textAlign='left'; ctx.font='22px '+CSS('--sans');
    ctx.fillText(opts.markerLabel||'',X(opts.marker)+10,m.t+26);
  }
  for(const s of opts.series){
    ctx.strokeStyle=s.color; ctx.lineWidth=s.w||3.5;
    if(s.dash)ctx.setLineDash(s.dash);
    ctx.beginPath();
    const step=Math.max(1,Math.floor(s.y.length/1400));
    let started=false;
    for(let i=0;i<s.y.length;i+=step){
      const xv=s.x?s.x[i]:i/FS, yv=s.y[i];
      if(!isFinite(yv))continue;
      const px=X(xv),py=Y(Math.max(ymin,Math.min(ymax,yv)));
      started?ctx.lineTo(px,py):(ctx.moveTo(px,py),started=true);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
}
