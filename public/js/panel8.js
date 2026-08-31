/* panel8.js — enhancement preview (illustrative, on a synthetic clip) */
let actx8=null, srcNode8=null, buffers8={}, playing8=false, startedAt8=0, offset8=0, curSrc8='raw';
const enhBandLabels=document.getElementById('bandLabels');
ENH_BAND_LABELS.forEach(l=>{const s=document.createElement('span'); s.textContent=l+'Hz'; enhBandLabels.appendChild(s);});

function runP8(){
  const cv=document.getElementById('cv8'); if(!cv)return;
  const n=Math.round(4*FS);
  const {raw,enhanced,gains}=runEnhancement(n,21);
  plot(cv,{xmin:0,xmax:4,ymin:0,ymax:1,
    series:gains.map((g,i)=>({y:g,color:ENH_COLORS[i]})),
    xlabel:'Time (s)',ylabel:'Band gain',xfmt:v=>v.toFixed(1)+'s'});

  const bars=document.getElementById('bandBars');
  bars.innerHTML='';
  gains.forEach((g,i)=>{
    let s=0; for(let k=0;k<g.length;k++)s+=g[k];
    const mean=s/g.length;
    const el=document.createElement('div');
    el.className='bb';
    el.style.height=Math.max(2,mean*120)+'px';
    el.style.background=ENH_COLORS[i];
    bars.appendChild(el);
  });

  buildBuffers8(raw,enhanced);
}
function buildBuffers8(raw,enhanced){
  actx8=actx8||new (window.AudioContext||window.webkitAudioContext)();
  const dur=raw.length/FS;
  for(const [k,sig] of [['raw',raw],['enh',enhanced]]){
    const b=actx8.createBuffer(1,sig.length,FS), ch=b.getChannelData(0);
    for(let i=0;i<sig.length;i++)ch[i]=Math.max(-1,Math.min(1,sig[i]));
    buffers8[k]=b;
  }
  buffers8._dur=dur;
}
function startAudio8(from){
  if(srcNode8){srcNode8.onended=null;srcNode8.stop();srcNode8=null;}
  srcNode8=actx8.createBufferSource();
  srcNode8.buffer=buffers8[curSrc8];
  srcNode8.connect(actx8.destination);
  srcNode8.start(0,from);
  startedAt8=actx8.currentTime-from;
  playing8=true;
}
document.getElementById('playBtn8').onclick=()=>{
  if(!buffers8.raw)return;
  if(actx8.state==='suspended')actx8.resume();
  const dur=buffers8._dur||4;
  if(playing8){offset8=actx8.currentTime-startedAt8; srcNode8.stop(); playing8=false;
    document.getElementById('playBtn8').textContent='Play';}
  else{startAudio8(offset8%dur); document.getElementById('playBtn8').textContent='Pause';}
};
seg('enhSrc',v=>{
  curSrc8=v==='enh'?'enh':'raw';
  if(playing8&&buffers8.raw){const dur=buffers8._dur||4; const pos=(actx8.currentTime-startedAt8)%dur; startAudio8(pos);}
});
setInterval(()=>{
  if(!playing8||!actx8||!buffers8.raw)return;
  const dur=buffers8._dur||4;
  const pos=(actx8.currentTime-startedAt8)%dur;
  document.getElementById('playBar8').style.width=(pos/dur*100)+'%';
  document.getElementById('playTime8').textContent=pos.toFixed(1)+'s';
},80);
