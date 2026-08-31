/* sim.js — reduced simulation core.
   Mirrors anc_sim.py at lower resolution so the skeleton shows real
   behaviour. Final build replaces panels 2/4/5 with results.json. */
const FS = 4000;

function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=Math.imul(s^s>>>15,1|s);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(r){let u=0,v=0;while(!u)u=r();while(!v)v=r();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}

/* Primary path built as P = S * G so an exact optimal filter exists.
   A random S is usually non-minimum-phase and even correct FxLMS diverges. */
function makePaths(seed){
  const r=rng(seed), nS=16, nG=20, dS=2, dG=4;
  const S=new Float64Array(nS), G=new Float64Array(nG);
  let sa=0, ga=0;
  for(let i=dS;i<nS;i++){S[i]=gauss(r)*Math.exp(-(i-dS)/4);sa+=Math.abs(S[i]);}
  for(let i=dG;i<nG;i++){G[i]=gauss(r)*Math.exp(-(i-dG)/6);ga+=Math.abs(G[i]);}
  for(let i=0;i<nS;i++)S[i]/=sa;
  for(let i=0;i<nG;i++)G[i]/=ga;
  const P=new Float64Array(nS+nG-1);
  for(let i=0;i<nS;i++)for(let j=0;j<nG;j++)P[i+j]+=S[i]*G[j];
  return {P,S,G};
}
function perturb(S,pct,seed){const r=rng(seed||9),o=new Float64Array(S.length);
  for(let i=0;i<S.length;i++)o[i]=S[i]*(1+pct/100*gauss(r));return o;}
function conv(x,h){const y=new Float64Array(x.length);
  for(let n=0;n<x.length;n++){let a=0;const m=Math.min(h.length,n+1);
    for(let k=0;k<m;k++)a+=h[k]*x[n-k];y[n]=a;}return y;}

function genNoise(n,type,seed){
  const r=rng(seed||2), x=new Float64Array(n);
  let lp=0;
  for(let i=0;i<n;i++){
    lp=0.86*lp+0.14*gauss(r);
    const t=i/FS;
    if(type==='nonstat'){
      const f=100+60*Math.sin(2*Math.PI*0.25*t);
      x[i]=(Math.sin(2*Math.PI*f*t)+0.8*lp)*(1+0.4*Math.sin(2*Math.PI*0.7*t));
    }else{
      x[i]=lp*2+0.5*Math.sin(2*Math.PI*120*t)+0.3*Math.sin(2*Math.PI*240*t);
    }
  }
  let m=0;for(let i=0;i<n;i++)m+=x[i]*x[i];m=Math.sqrt(m/n)||1;
  for(let i=0;i<n;i++)x[i]/=m;
  return x;
}
function addImpulses(x,times,amp){
  const y=Float64Array.from(x), L=Math.round(0.003*FS), r=rng(7);
  for(const t0 of times){const i0=Math.round(t0*FS);
    for(let k=0;k<L&&i0+k<y.length;k++)y[i0+k]+=amp*Math.exp(-k/(L/4))*gauss(r);}
  return y;
}

/* Detector. Warm-up prevents the bootstrap deadlock where the background
   estimate starts at zero, the detector trips on itself, and never recovers. */
class Detector{
  constructor(thr){this.T=thr||4; this.af=0.05; this.as=0.999;
    this.hold=Math.round(0.06*FS); this.warm=Math.round(0.4*FS);
    this.Ef=0;this.Eb=0;this.k=0;this.timer=0;this.state=0;}
  step(x){
    const p=x*x; this.Ef=(1-this.af)*this.Ef+this.af*p; this.k++;
    if(this.k<this.warm){this.Eb+=(p-this.Eb)/this.k; this.state=0; return [0,0];}
    const ratio=this.Ef/(this.Eb+1e-12);
    if(ratio>this.T){this.state=1;this.timer=this.hold;}
    else{this.Eb=this.as*this.Eb+(1-this.as)*p;
      if(this.timer>0){this.timer--;this.state=2;}else this.state=0;}
    this.Eb=0.99999*this.Eb+0.00001*Math.min(p,4*this.Eb);
    return [this.state,ratio];
  }
}
const score=(e,E0)=>e/(1+Math.pow(Math.abs(e)/(E0+1e-12),2));

function runFxLMS(x,P,S,Shat,variant,mu,L){
  L=L||32;
  const n=x.length, d=conv(x,P), xf=conv(x,Shat);
  const w=new Float64Array(L), xb=new Float64Array(L), xfb=new Float64Array(L),
        yb=new Float64Array(S.length), e=new Float64Array(n),
        st=new Uint8Array(n), ratio=new Float64Array(n);
  const det=new Detector(window.__thr||4);
  let Emed=1e-3, pnorm=1e-3;
  for(let k=0;k<n;k++){
    for(let i=L-1;i>0;i--){xb[i]=xb[i-1];xfb[i]=xfb[i-1];}
    xb[0]=x[k]; xfb[0]=xf[k];
    let y=0; for(let i=0;i<L;i++)y+=w[i]*xb[i];
    for(let i=yb.length-1;i>0;i--)yb[i]=yb[i-1];
    yb[0]=y;
    let yp=0; for(let i=0;i<S.length;i++)yp+=S[i]*yb[i];
    const err=d[k]-yp; e[k]=err;
    const [s,rt]=det.step(x[k]); st[k]=s; ratio[k]=rt;
    Emed=0.999*Emed+0.001*Math.abs(err);
    let upd, m;
    if(variant==='A'){upd=err; m=mu;}
    else if(variant==='B'){upd=score(err,3*Emed); m=mu;}
    else{ /* C — robust weighting only when the detector says we are at risk,
             so normal-state performance matches vanilla */
      if(s===1){upd=score(err,3*Emed); m=0;}
      else if(s===2){upd=score(err,3*Emed); m=0.15*mu;}
      else{upd=err; m=mu;}
    }
    let pw=0; for(let i=0;i<L;i++)pw+=xfb[i]*xfb[i];
    /* Bound how much one sample can move the power normaliser. Without this
       an impulse hijacks pnorm, the step size collapses for seconds, and all
       three systems freeze identically - hiding the very effect we study. */
    pnorm=0.999*pnorm+0.001*Math.min(pw,4*pnorm);
    const g=m/(pnorm+1e-6);
    for(let i=0;i<L;i++){w[i]+=g*upd*xfb[i]; if(w[i]>50)w[i]=50; if(w[i]<-50)w[i]=-50;}
  }
  return {e,d,st,ratio};
}
function smoothDb(e,ms){
  const w=Math.max(1,Math.round((ms||20)*FS/1000)), out=new Float64Array(e.length);
  let acc=0;
  for(let i=0;i<e.length;i++){acc+=e[i]*e[i]; if(i>=w)acc-=e[i-w]*e[i-w];
    out[i]=10*Math.log10(acc/Math.min(i+1,w)+1e-12);}
  return out;
}
function atten(d,e,a,b){let sd=0,se=0;
  for(let i=a;i<b;i++){sd+=d[i]*d[i];se+=e[i]*e[i];}
  return 10*Math.log10(sd/(se+1e-12));}

/* Recovery time: elapsed ms from `fromIdx` until the smoothed dB trace `sm`
   returns within tolDb of baselineDb and stays there for holdSamples in a
   row. If it never recovers inside the trace, returns time-to-end-of-trace
   so the readout still moves instead of silently freezing. */
function meanDbWindow(sm,a,b){let s=0,n=0;for(let i=a;i<b;i++){s+=sm[i];n++;}return n?s/n:0;}
function recoveryMs(sm,fromIdx,baselineDb,tolDb,holdSamples){
  let count=0;
  for(let i=fromIdx;i<sm.length;i++){
    if(Math.abs(sm[i]-baselineDb)<=tolDb){
      count++;
      if(count>=holdSamples) return Math.max(0,(i-holdSamples-fromIdx))/FS*1000;
    }else count=0;
  }
  return Math.max(0,(sm.length-fromIdx))/FS*1000;
}
