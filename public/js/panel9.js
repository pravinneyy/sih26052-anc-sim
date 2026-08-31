/* panel9.js — try it on your own audio (record or upload), run it through
   the same illustrative gain mask as panel 8. This can only demonstrate the
   enhancement-style mask, not the classical FxLMS cancellation path: real
   ANC needs a synchronized reference-noise mic signal alongside the primary
   signal, which a single recorded/uploaded track does not have. */
const P9_MAX_PROCESS_S = 30; // trim long clips so processing stays snappy

let p9ctx=null, p9raw=null, p9enh=null, p9src=null, p9playing=false,
    p9startedAt=0, p9offset=0, p9cur='raw', p9recorder=null, p9chunks=[], p9recTimer=null;

const p9status=document.getElementById('p9Status');
const p9processBtn=document.getElementById('p9Process');
const p9enhBtn=document.querySelector('#p9PlaySrc button[data-v="enh"]');

function p9EnsureCtx(){ p9ctx = p9ctx || new (window.AudioContext||window.webkitAudioContext)(); return p9ctx; }
function p9SetStatus(msg){ p9status.textContent=msg; }
function p9CurrentBuffer(){ return p9cur==='enh' ? p9enh : p9raw; }

async function p9LoadBlob(blob){
  p9SetStatus('Decoding audio…');
  try{
    const arr=await blob.arrayBuffer();
    const ctx=p9EnsureCtx();
    const buf=await ctx.decodeAudioData(arr);
    p9raw=buf; p9enh=null; p9cur='raw'; p9offset=0;
    if(p9playing){p9playing=false; document.getElementById('p9PlayBtn').textContent='Play';}
    document.querySelectorAll('#p9PlaySrc button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v==='raw'));
    p9enhBtn.disabled=true;
    p9processBtn.disabled=false;
    document.getElementById('cv9').getContext('2d').clearRect(0,0,1600,360);
    p9SetStatus(`Loaded ${buf.duration.toFixed(1)}s at ${buf.sampleRate} Hz. Ready to process.`);
  }catch(err){
    p9SetStatus('Could not decode that audio — try a different file.');
  }
}

/* ---- record ---- */
document.getElementById('p9Record').onclick=async ()=>{
  const btn=document.getElementById('p9Record');
  if(p9recorder&&p9recorder.state==='recording'){ p9recorder.stop(); return; }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    p9SetStatus('Microphone capture is not available in this browser/context — try uploading a file instead. (Recording needs a secure context; if this is opened from a bare file:// path, run it through "npm start" and use localhost.)');
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    p9chunks=[];
    p9recorder=new MediaRecorder(stream);
    p9recorder.ondataavailable=e=>{ if(e.data.size>0) p9chunks.push(e.data); };
    p9recorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      clearTimeout(p9recTimer);
      btn.textContent='Record';
      const blob=new Blob(p9chunks,{type:p9recorder.mimeType||'audio/webm'});
      p9LoadBlob(blob);
    };
    p9recorder.start();
    btn.textContent='Stop';
    p9SetStatus('Recording… (stops automatically after 20s)');
    p9recTimer=setTimeout(()=>{ if(p9recorder&&p9recorder.state==='recording') p9recorder.stop(); },20000);
  }catch(err){
    p9SetStatus('Microphone access denied or unavailable.');
  }
};

/* ---- upload ---- */
document.getElementById('p9Upload').onclick=()=>document.getElementById('p9File').click();
document.getElementById('p9File').addEventListener('change',e=>{
  const f=e.target.files[0]; if(f) p9LoadBlob(f);
});

/* ---- process ---- */
p9processBtn.onclick=()=>{
  if(!p9raw) return;
  const fs=p9raw.sampleRate;
  const full=p9raw.getChannelData(0); // mono, first channel
  const n=Math.min(full.length,Math.round(P9_MAX_PROCESS_S*fs));
  const clipped=n<full.length;
  const sig=full.subarray(0,n);
  const {enhanced,gains}=applyEnhancementMask(sig,fs);

  const ctx=p9EnsureCtx();
  const buf=ctx.createBuffer(1,n,fs);
  buf.getChannelData(0).set(enhanced);
  p9enh=buf;
  p9enhBtn.disabled=false;

  plot(document.getElementById('cv9'),{xmin:0,xmax:n/fs,ymin:0,ymax:1,
    series:gains.map((g,i)=>({y:g,color:ENH_COLORS[i]})),
    xlabel:'Time (s)',ylabel:'Band gain',xfmt:v=>v.toFixed(1)+'s'});

  p9SetStatus(clipped
    ? `Processed the first ${P9_MAX_PROCESS_S}s. Switch playback to "After mask" to compare.`
    : 'Processed. Switch playback to "After mask" to compare.');
};

/* ---- transport (mirrors panels 3/8, but duration-aware since clips vary) ---- */
function p9Start(from){
  const buf=p9CurrentBuffer(); if(!buf) return;
  if(p9src){p9src.onended=null; try{p9src.stop();}catch(e){} p9src=null;}
  const ctx=p9EnsureCtx();
  p9src=ctx.createBufferSource();
  p9src.buffer=buf;
  p9src.connect(ctx.destination);
  const clamped=Math.max(0,Math.min(from,Math.max(0,buf.duration-0.01)));
  p9src.start(0,clamped);
  p9startedAt=ctx.currentTime-clamped;
  p9playing=true;
  p9src.onended=()=>{ if(p9playing){p9playing=false; p9offset=0;
    document.getElementById('p9PlayBtn').textContent='Play';} };
}
document.getElementById('p9PlayBtn').onclick=()=>{
  const buf=p9CurrentBuffer(); if(!buf) return;
  const ctx=p9EnsureCtx();
  if(ctx.state==='suspended') ctx.resume();
  if(p9playing){
    p9offset=ctx.currentTime-p9startedAt;
    if(p9src){p9src.onended=null; try{p9src.stop();}catch(e){}}
    p9playing=false;
    document.getElementById('p9PlayBtn').textContent='Play';
  }else{
    p9Start(p9offset % buf.duration);
    document.getElementById('p9PlayBtn').textContent='Pause';
  }
};
seg('p9PlaySrc',v=>{
  p9cur=v;
  const buf=p9CurrentBuffer(); if(!buf) return;
  if(p9playing){const pos=(p9EnsureCtx().currentTime-p9startedAt)%buf.duration; p9Start(pos);}
});
setInterval(()=>{
  const buf=p9CurrentBuffer();
  if(!p9playing||!buf) return;
  const pos=(p9EnsureCtx().currentTime-p9startedAt)%buf.duration;
  document.getElementById('p9PlayBar').style.width=(pos/buf.duration*100)+'%';
  document.getElementById('p9PlayTime').textContent=pos.toFixed(1)+'s';
},80);

function p9Reset(){
  if(p9playing&&p9src){p9src.onended=null; try{p9src.stop();}catch(e){} p9playing=false;
    document.getElementById('p9PlayBtn').textContent='Play';}
  p9raw=null; p9enh=null; p9offset=0; p9cur='raw';
  document.querySelectorAll('#p9PlaySrc button').forEach(b=>{b.setAttribute('aria-pressed',b.dataset.v==='raw'); });
  p9enhBtn.disabled=true;
  p9processBtn.disabled=true;
  document.getElementById('cv9').getContext('2d').clearRect(0,0,1600,360);
  document.getElementById('p9PlayBar').style.width='0%';
  document.getElementById('p9PlayTime').textContent='0.0s';
  p9SetStatus('No audio loaded yet.');
}
