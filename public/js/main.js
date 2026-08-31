/* main.js — reset-all, redraw dispatch, initial render. Loaded last so every
   panelN.js has already defined the state/functions referenced below. */
function resetPanel(){
  if(cur===1){ampEl.value=400;ampOut.textContent='400';
    document.querySelectorAll('#sysToggles .tg').forEach(b=>{sysOn[b.dataset.s]=true;b.setAttribute('aria-pressed',true);});
    runP2();}
  if(cur===3){thrEl.value=4;thrOut.textContent='4.0';window.__thr=4;runP4();}
  if(cur===4){mmEl.value=0;mmOut.textContent='0';}
  if(cur===5){document.getElementById('resetLive').click();}
  if(cur===7){
    if(playing8){srcNode8.onended=null;srcNode8.stop();playing8=false;
      document.getElementById('playBtn8').textContent='Play';}
    offset8=0; curSrc8='raw';
    document.querySelectorAll('#enhSrc button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v==='raw'));
    runP8();
  }
  if(cur===8) p9Reset();
}
document.getElementById('resetAll').onclick=resetPanel;

/* ---------- redraw on panel change ---------- */
function redraw(){
  if(cur===1)runP2();
  if(cur===3)runP4();
  if(cur===5)runP6();
  if(cur===7)runP8();
}
show(0);
