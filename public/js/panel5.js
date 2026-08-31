/* panel5.js — secondary-path mismatch sweep */
const mmEl=document.getElementById('mm'), mmOut=document.getElementById('mmOut');
mmEl.addEventListener('input',()=>mmOut.textContent=mmEl.value);
document.getElementById('runSweep').onclick=runP5;
function runP5(){
  const cv=document.getElementById('cv5'); if(!cv)return;
  const btn=document.getElementById('runSweep');
  btn.textContent='Running…'; btn.disabled=true;
  setTimeout(()=>{
    const n=Math.round(3*FS), {P,S}=makePaths(0), x=genNoise(n,'stat',3);
    const pcts=[0,5,10,15,20,25,30,35,40];
    const out={A:[],B:[],C:[]};
    for(const pc of pcts){
      const Sh=perturb(S,pc,4);
      for(const v of ['A','B','C']){
        const r=runFxLMS(x,P,S,Sh,v,0.005,32);
        out[v].push(atten(r.d,r.e,Math.round(2.2*FS),Math.round(2.9*FS)));
      }
    }
    const colors={A:CSS('--sysA'),B:CSS('--sysB'),C:CSS('--sysC')};
    plot(cv,{xmin:0,xmax:40,ymin:-10,ymax:35,
      series:['A','B','C'].map(v=>({x:pcts,y:out[v],color:colors[v]})),
      xlabel:'Secondary-path model error (%)',ylabel:'Attenuation (dB)',
      xfmt:v=>v.toFixed(0)+'%'});
    btn.textContent='Run sweep'; btn.disabled=false;
  },30);
}
