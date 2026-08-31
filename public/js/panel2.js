/* panel2.js — the impulse experiment (centrepiece) */
const getNoise=seg('noiseType',()=>runP2());
const getPattern=seg('pattern',()=>runP2());
const sysOn={A:true,B:true,C:true};
document.getElementById('sysToggles').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  sysOn[b.dataset.s]=!sysOn[b.dataset.s];
  b.setAttribute('aria-pressed',sysOn[b.dataset.s]);
  runP2();
});
const ampEl=document.getElementById('amp'), ampOut=document.getElementById('ampOut');
ampEl.addEventListener('input',()=>ampOut.textContent=ampEl.value);
ampEl.addEventListener('change',runP2);
document.getElementById('fire').onclick=runP2;

function runP2(){
  const cv=document.getElementById('cv2'); if(!cv) return;
  const n=Math.round(6*FS), {P,S}=makePaths(0);
  const amp=+ampEl.value, pat=getPattern();
  let times=[];
  if(pat==='single')times=[3.5];
  else if(pat==='burst')times=[3.5,3.62,3.74,3.86,3.98,4.10,4.22,4.34];
  const x=addImpulses(genNoise(n,getNoise(),3),times,amp);
  const colors={A:CSS('--sysA'),B:CSS('--sysB'),C:CSS('--sysC')};
  const series=[]; let res={};
  for(const v of ['A','B','C']){
    const r=runFxLMS(x,P,S,S,v,0.005,32); r.sm=smoothDb(r.e,25); res[v]=r;
    if(sysOn[v])series.push({y:r.sm,color:colors[v]});
  }
  const states=[];
  if(times.length){
    let run=null;
    for(let i=0;i<res.C.st.length;i+=8){
      const on=res.C.st[i]>0;
      if(on&&!run)run={a:i/FS};
      if(!on&&run){run.b=i/FS;run.c='rgba(74,222,192,.13)';states.push(run);run=null;}
    }
  }
  plot(cv,{xmin:2,xmax:6,ymin:-70,ymax:20,series,states,
    marker:times.length?times[0]:undefined,markerLabel:'impulse',
    xlabel:'Time (s)',ylabel:'Residual error (dB)',xfmt:v=>v.toFixed(1)+'s'});

  const pre=(v)=>atten(res[v].d,res[v].e,Math.round(2.5*FS),Math.round(3.4*FS));
  const post=(v)=>atten(res[v].d,res[v].e,Math.round(((times.length?times[times.length-1]:3.5)+0.02)*FS),
                        Math.round(((times.length?times[times.length-1]:3.5)+0.28)*FS));
  const set=(id,v,dp)=>document.getElementById(id).innerHTML=
    (isFinite(v)?v.toFixed(dp):'—')+document.getElementById(id).innerHTML.replace(/^[^<]*/,'');
  if(times.length){
    set('r_loss',Math.max(0,pre('A')-post('A')),1);
    set('r_lossC',Math.max(0,pre('C')-post('C')),1);
    const lastT=times[times.length-1];
    const baseline=meanDbWindow(res.A.sm,Math.round(2.5*FS),Math.round(3.4*FS));
    const fromIdx=Math.round((lastT+0.02)*FS);
    const rec=recoveryMs(res.A.sm,fromIdx,baseline,1.0,Math.round(0.05*FS));
    document.getElementById('r_rec').innerHTML=Math.round(rec)+'<span class="u">ms</span>';
  }else{
    ['r_loss','r_lossC'].forEach(id=>set(id,0,1));
    document.getElementById('r_rec').innerHTML='0<span class="u">ms</span>';
  }
}
