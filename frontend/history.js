(function(){
  const wrap=$("wrap"), hp=$("hp"), hc=$("hc"), clear=$("clear");
  appState.logs=load(STORAGE_KEYS.LOGS,[]);
  function render(){
    let logs=appState.logs.slice();
    const p=(hp.value||"").toUpperCase(), c=hc.value?parseFloat(hc.value):null;
    if(p) logs=logs.filter(l=>(l.plateNumber||"").toUpperCase().includes(p));
    if(c) logs=logs.filter(l=>(l.confidence||0)>=c);
    if(!logs.length){wrap.classList.add("empty");wrap.innerHTML='<div class="empty-hint">暂无日志记录。</div>';return}
    wrap.classList.remove("empty");
    wrap.innerHTML="<table><thead><tr><th>#</th><th>文件名</th><th>车牌（识别）</th><th>车牌（最终）</th><th>置信度</th><th>时间</th><th>来源</th></tr></thead><tbody>"+
      logs.map((l,i)=>`<tr><td>${i+1}</td><td>${l.fileName||"--"}</td><td>${l.plateNumber||"--"}</td><td>${l.finalPlateNumber||l.plateNumber||"--"}</td><td>${l.confidence!=null?(l.confidence*100).toFixed(1)+"%":"--"}</td><td>${fmtTime(l.time)}</td><td>${l.source||"单张"}</td></tr>`).join("")+
      "</tbody></table>";
  }
  hp.oninput=render; hc.onchange=render; clear.onclick=()=>{appState.logs=[];save(STORAGE_KEYS.LOGS,appState.logs);render()};
  if(requireAuth()) initNav();
  render();
})();
