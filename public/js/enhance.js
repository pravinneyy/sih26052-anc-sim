/* enhance.js — illustrative gain-mask engine, shared by panel 8 (a synthetic
   demo clip at the sim rate FS) and panel 9 (whatever audio the judge
   records or uploads, at its own real sample rate).
   This is a hand-written energy-ratio heuristic standing in for the trained
   GRU mask described in panel 1. It is not a neural network and was not
   trained on data — see panel 7. Six broad bands stand in for the 22 Bark
   bands the real design uses. */
const ENH_BAND_EDGES = [150,350,700,1100,1500]; // Hz, upper edge of bands 0..4; band 5 is everything above
const ENH_BAND_LABELS = ['<150','150-350','350-700','700-1100','1100-1500','1500+'];
const ENH_COLORS = ['#FF6B5A','#FFC14D','#4ADEC0','#7FD4E8','#C792EA','#8899A6'];

/* Fast/slow time constants (seconds) for the per-band gain tracker below,
   chosen to match the exact behaviour the original FS=4000 build had at
   af=0.2/as=0.995 per-sample, just expressed rate-independently so panel 9
   can run it on 44.1/48 kHz audio without retuning. */
const ENH_TAU_FAST = 0.00112; // ~1.1 ms attack
const ENH_TAU_SLOW = 0.0499;  // ~50 ms noise-floor adaptation

function enhOnepoleLP(x,fc,fs){
  const alpha=1-Math.exp(-2*Math.PI*fc/fs);
  const y=new Float64Array(x.length);
  let acc=0;
  for(let i=0;i<x.length;i++){acc+=alpha*(x[i]-acc);y[i]=acc;}
  return y;
}
/* Telescoping low-pass differences give a filter bank that sums back to
   the original signal exactly, so applying a gain per band and summing
   is a faithful "mask then resynthesise" step. */
function enhSplitBands(x,fs){
  const lps=ENH_BAND_EDGES.map(fc=>enhOnepoleLP(x,fc,fs));
  const n=x.length, nb=ENH_BAND_EDGES.length+1, bands=[];
  for(let b=0;b<nb;b++){
    const y=new Float64Array(n);
    for(let i=0;i<n;i++){
      const hi=b<ENH_BAND_EDGES.length?lps[b][i]:x[i];
      const lo=b>0?lps[b-1][i]:0;
      y[i]=hi-lo;
    }
    bands.push(y);
  }
  return bands;
}
/* Fast/slow energy tracker, the same exponential-tracking shape as
   Detector's Ef/Eb in sim.js: the noise floor only adapts while the fast
   envelope is close to it, so it does not chase speech bursts. Gain is a
   Wiener-style ratio, clamped to [0,1]. */
function enhBandGain(bandSig,fs){
  const n=bandSig.length, gain=new Float64Array(n);
  const af=1-Math.exp(-1/(ENH_TAU_FAST*fs));
  const as=Math.exp(-1/(ENH_TAU_SLOW*fs));
  let Ef=0, Eb=1e-6;
  for(let i=0;i<n;i++){
    const p=bandSig[i]*bandSig[i];
    Ef=(1-af)*Ef+af*p;
    if(Ef<=1.5*Eb) Eb=as*Eb+(1-as)*p;
    gain[i]=Math.max(0,Math.min(1,Ef/(Ef+Eb+1e-9)));
  }
  return gain;
}
/* Apply the mask to any mono Float32/Float64Array at any sample rate —
   the entry point panel 9 uses for recorded/uploaded audio. */
function applyEnhancementMask(signal,fs){
  const bands=enhSplitBands(signal,fs);
  const gains=bands.map(b=>enhBandGain(b,fs));
  const enhanced=new Float64Array(signal.length);
  for(let b=0;b<bands.length;b++)
    for(let i=0;i<signal.length;i++)
      enhanced[i]+=bands[b][i]*gains[b][i];
  return {enhanced,gains};
}

/* ---- synthetic boom-mic clip used only by panel 8's fixed demo ---- */
function genBoomSignal(n,seed){
  const r=rng(seed||21), x=new Float64Array(n);
  let lp=0;
  for(let i=0;i<n;i++){
    const t=i/FS;
    lp=0.9*lp+0.1*gauss(r);
    const speech=0.35*Math.sin(2*Math.PI*(180+40*Math.sin(2*Math.PI*2.5*t))*t)*(0.5+0.5*Math.sin(2*Math.PI*1.7*t));
    const noise=lp*1.2+0.35*Math.sin(2*Math.PI*110*t);
    x[i]=speech+noise;
  }
  return x;
}
function runEnhancement(n,seed){
  const raw=genBoomSignal(n,seed);
  const {enhanced,gains}=applyEnhancementMask(raw,FS);
  return {raw,enhanced,gains};
}
