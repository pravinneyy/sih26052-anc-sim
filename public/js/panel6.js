/* panel6.js — live FxLMS running in the browser */
const muEl=document.getElementById('mu'), muOut=document.getElementById('muOut'),
      tapsEl=document.getElementById('taps'), tapsOut=document.getElementById('tapsOut');
const muVal=()=>+muEl.value/1000;
muEl.addEventListener('input',()=>muOut.textContent=muVal().toFixed(3));
tapsEl.addEventListener('input',()=>tapsOut.textContent=tapsEl.value);
muEl.addEventListener('change',runP6);
tapsEl.addEventListener('change',runP6);
document.getElementById('resetLive').onclick=()=>{
  muEl.value=5; tapsEl.value=32;
  muOut.textContent='0.005'; tapsOut.textContent='32'; runP6();
};
function runP6(){
  const cv=document.getElementById('cv6'); if(!cv)return;
  const n=Math.round(3*FS), {P,S}=makePaths(1), x=genNoise(n,'stat',6);
  const r=runFxLMS(x,P,S,S,'A',muVal(),+tapsEl.value);
  plot(cv,{xmin:0,xmax:3,ymin:-70,ymax:40,
    series:[{y:smoothDb(r.e,25),color:'#7FD4E8'}],
    xlabel:'Time (s)',ylabel:'Residual error (dB)',xfmt:v=>v.toFixed(1)+'s'});
  const a=atten(r.d,r.e,Math.round(2.2*FS),Math.round(2.9*FS));
  document.getElementById('r_live').innerHTML=
    (isFinite(a)?a.toFixed(1):'—')+'<span class="u">dB</span>';
}
