/* panel3.js — listen (placeholder before/after buffers) */
let actx=null, srcNode=null, buffers={}, playing=false, startedAt=0, offset=0, curSrc='raw';
function buildBuffers(){
  actx=actx||new (window.AudioContext||window.webkitAudioContext)();
  const sr=actx.sampleRate, dur=4, n=sr*dur;
  const shape={raw:1.0,A:0.45,B:0.30,C:0.22};   // placeholder attenuation factors
  for(const k of Object.keys(shape)){
    const b=actx.createBuffer(1,n,sr), ch=b.getChannelData(0), r=rng(11);
    let lp=0;
    for(let i=0;i<n;i++){
      const t=i/sr;
      lp=0.9*lp+0.1*gauss(r);
      const speech=0.35*Math.sin(2*Math.PI*(180+40*Math.sin(2*Math.PI*2.5*t))*t)
                   *(0.5+0.5*Math.sin(2*Math.PI*1.7*t));
      let noise=(lp*1.2+0.35*Math.sin(2*Math.PI*110*t))*shape[k];
      if(t>2.0&&t<2.02) noise+=(k==='raw'?3:1.2)*Math.exp(-(t-2)*400)*gauss(r);
      if(k==='A'&&t>2.02&&t<3.0) noise*=2.2;  // A stays degraded after the impulse
      ch[i]=Math.max(-1,Math.min(1,speech+noise*0.5));
    }
    buffers[k]=b;
  }
}
function startAudio(from){
  if(srcNode){srcNode.onended=null;srcNode.stop();srcNode=null;}
  srcNode=actx.createBufferSource();
  srcNode.buffer=buffers[curSrc];
  srcNode.connect(actx.destination);
  srcNode.start(0,from);
  startedAt=actx.currentTime-from;
  playing=true;
}
document.getElementById('playBtn').onclick=()=>{
  buildBuffers();
  if(actx.state==='suspended')actx.resume();
  if(playing){offset=actx.currentTime-startedAt; srcNode.stop(); playing=false;
    document.getElementById('playBtn').textContent='Play';}
  else{startAudio(offset%4); document.getElementById('playBtn').textContent='Pause';}
};
document.getElementById('audioRow').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  document.querySelectorAll('#audioRow .audio-btn').forEach(x=>x.setAttribute('aria-pressed',x===b));
  curSrc=b.dataset.src;
  // switch source WITHOUT restarting the transport
  if(playing){const pos=(actx.currentTime-startedAt)%4; startAudio(pos);}
});
setInterval(()=>{
  if(!playing||!actx)return;
  const pos=(actx.currentTime-startedAt)%4;
  document.getElementById('playBar').style.width=(pos/4*100)+'%';
  document.getElementById('playTime').textContent=pos.toFixed(1)+'s';
},80);
