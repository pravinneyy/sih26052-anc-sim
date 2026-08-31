/* shell.js — panel list, nav rail, tour, keyboard shortcuts.
   redraw() and resetPanel() are defined in main.js (loaded last, after every
   panelN.js has defined its runPN()/state) — show() just calls them by name,
   which is safe because show() is never invoked until the user interacts or
   main.js calls show(0) once everything else has loaded. */
const PANELS=[
  ['Two problems','p1'],['Impulse experiment','p2'],['Listen','p3'],
  ['Detector','p4'],['Path mismatch','p5'],['Live filter','p6'],['Honesty','p7'],
  ['Enhancement (mock)','p8'],['Try your audio','p9']
];
let cur=0;
const nav=document.getElementById('nav');
PANELS.forEach(([label,id],i)=>{
  const li=document.createElement('li');
  li.innerHTML=`<button data-i="${i}"><span class="n">${i+1}</span><span>${label}</span></button>`;
  nav.appendChild(li);
});
function show(i){
  cur=Math.max(0,Math.min(PANELS.length-1,i));
  document.querySelectorAll('.panel').forEach((p,k)=>p.classList.toggle('on',k===cur));
  nav.querySelectorAll('button').forEach((b,k)=>b.setAttribute('aria-current',k===cur));
  document.getElementById('tourPos').textContent=`${cur+1} / ${PANELS.length}`;
  redraw();
}
nav.addEventListener('click',e=>{const b=e.target.closest('button'); if(b)show(+b.dataset.i);});
document.getElementById('tourNext').onclick=()=>show(cur+1);
document.getElementById('tourPrev').onclick=()=>show(cur-1);
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,button'))return;
  if(e.key==='ArrowRight')show(cur+1);
  if(e.key==='ArrowLeft')show(cur-1);
  if(e.key.toLowerCase()==='r')resetPanel();
  if(e.key===' '&&cur===1){e.preventDefault();runP2();}
});

/* ---- segmented + toggle helper, shared by several panels ---- */
function seg(id,cb){
  const el=document.getElementById(id);
  el.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b)return;
    el.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));
    cb(b.dataset.v);
  });
  return ()=>el.querySelector('[aria-pressed="true"]').dataset.v;
}
