/* panel1.js — architecture diagram, clickable blocks */
const BLOCK_INFO={
  ref:['Reference microphone','Sits outside the earcup and hears noise before it reaches the ear. Its signal drives both the adaptive filter and the state detector.'],
  fxlms:['Robust variable-step FxLMS','Runs at the audio sample rate. The update carries a state-dependent step size and a bounded score function, so an impulse cannot wreck the coefficients even if the detector misses it.'],
  spk:['Earcup speaker','Emits anti-noise. The path from here to the error microphone is the secondary path, and it must be identified offline or the filter diverges.'],
  det:['Shared state detector','Short-term energy against a slow background estimate. Runs on the reference mic, not the boom mic, so shouting cannot trigger transient protection.'],
  boom:['Boom microphone','Carries the speech going out over the radio, mixed with the same noise field.'],
  nn:['Causal GRU mask','Predicts a gain per Bark band. Streaming and causal — no lookahead, because lookahead is latency. See panel 8 for a hand-written preview of the idea.'],
  radio:['Radio transmit','The enhanced speech. Intelligibility, not noise attenuation, is what matters on this path.']
};
document.querySelectorAll('.blk').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.blk').forEach(x=>x.setAttribute('data-sel',x===b));
    const [t,d]=BLOCK_INFO[b.dataset.info];
    document.getElementById('blockInfo').innerHTML=`<h3>${t}</h3><p>${d}</p>`;
  });
});
