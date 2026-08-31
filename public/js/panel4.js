/* panel4.js — detector behaviour */
const getDetScen=seg('detScenario',()=>runP4());
const thrEl=document.getElementById('thr'), thrOut=document.getElementById('thrOut');
thrEl.addEventListener('input',()=>{thrOut.textContent=(+thrEl.value).toFixed(1);});
thrEl.addEventListener('change',()=>{window.__thr=+thrEl.value; runP4();});

function runP4(){
  const cv=document.getElementById('cv4'); if(!cv)return;
  const n=Math.round(6*FS); let x=genNoise(n,'stat',5);
  const scen=getDetScen();
  const events=[3.0,4.0,5.0];
  if(scen==='imp'){ x=addImpulses(x,events,500); }
  else{ // loud speech: sustained amplitude-modulated bursts, not transients
    for(const t0 of events){const i0=Math.round(t0*FS),L=Math.round(0.5*FS);
      for(let k=0;k<L&&i0+k<n;k++)x[i0+k]*=1+5*Math.sin(Math.PI*k/L);}
  }
  const det=new Detector(+thrEl.value);
  const ratio=new Float64Array(n), st=new Uint8Array(n);
  for(let i=0;i<n;i++){const [s,r]=det.step(x[i]); st[i]=s; ratio[i]=r;}
  const states=[]; let run=null;
  for(let i=0;i<n;i+=8){const on=st[i]>0;
    if(on&&!run)run={a:i/FS};
    if(!on&&run){run.b=i/FS;run.c='rgba(74,222,192,.15)';states.push(run);run=null;}}
  const thrLine=new Float64Array(n).fill(+thrEl.value);
  plot(cv,{xmin:1,xmax:6,ymin:0,ymax:14,states,
    series:[{y:ratio,color:'#7FD4E8'},{y:thrLine,color:CSS('--sysA'),dash:[12,8],w:2.5}],
    xlabel:'Time (s)',ylabel:'Energy ratio',xfmt:v=>v.toFixed(1)+'s'});

  let hits=0;
  for(const t0 of events){const a=Math.round(t0*FS),b=Math.round((t0+0.3)*FS);
    for(let i=a;i<b;i++)if(st[i]===1){hits++;break;}}
  let fa=0; for(let i=Math.round(0.5*FS);i<n;i++){
    const t=i/FS; const near=events.some(e=>t>e-0.05&&t<e+0.6);
    if(!near&&st[i]===1)fa++;}
  document.getElementById('r_pd').innerHTML=
    (scen==='imp'?Math.round(hits/events.length*100):'n/a')+'<span class="u">%</span>';
  document.getElementById('r_pfa').innerHTML=
    (fa/(n/FS/60)).toFixed(1)+'<span class="u">/min</span>';
}
