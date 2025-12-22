(function(){
  const key=STORAGE_KEYS.TASKS; appState.tasks=load(key,[]);
  const files=$("files"), choose=$("choose"), count=$("count"), start=$("start"), taskname=$("taskname"), list=$("list");
  const overlay=$("overlay"), title=$("title"), body=$("body"), closeBtn=$("close"), exportBtn=$("export");

  function saveTasks(){save(key,appState.tasks)}
  function render(){
    const t=appState.tasks;
    if(!t.length){list.classList.add("empty");list.innerHTML='<div class="empty-hint">暂无批量任务。</div>';return}
    list.classList.remove("empty");
    list.innerHTML="<table><thead><tr><th>#</th><th>任务名称</th><th>创建时间</th><th>总数</th><th>已完成</th><th>状态</th><th>操作</th></tr></thead><tbody>"+
      t.map((task,i)=>`<tr><td>${i+1}</td><td>${task.name}</td><td>${fmtTime(task.createdAt)}</td><td>${task.items.length}</td><td>${task.items.filter(x=>x.status==="done").length}</td><td>${task.status}</td><td><button class="btn small" data-id="${task.id}">详情</button></td></tr>`).join("")+
      "</tbody></table>";
  }
  list.onclick=e=>{const b=e.target.closest("button[data-id]");if(!b)return;openDetail(b.dataset.id)}
  function openDetail(id){
    const task=appState.tasks.find(x=>x.id===id); if(!task)return;
    title.textContent="任务详情 - "+task.name;
    body.innerHTML="<table><thead><tr><th>#</th><th>图片</th><th>车牌号</th><th>置信度</th><th>姓名</th><th>电话</th><th>状态</th></tr></thead><tbody>"+
      task.items.map((it,i)=>`<tr><td>${i+1}</td><td>${it.fileName}</td><td>${it.plateNumber||""}</td><td>${it.confidence!=null?(it.confidence*100).toFixed(1)+"%":""}</td><td>${it.ownerName||""}</td><td>${it.ownerPhone||""}</td><td>${it.status}</td></tr>`).join("")+
      "</tbody></table>";
    overlay.classList.remove("hidden");
    exportBtn.onclick=()=>exportCsv(task);
  }
  closeBtn.onclick=()=>overlay.classList.add("hidden");
  function exportCsv(task){
    const lines=[["序号","文件名","车牌号","姓名","电话","置信度","识别时间"].join(",")];
    task.items.forEach((it,i)=>lines.push([i+1,`"${it.fileName||""}"`,`"${it.plateNumber||""}"`,`"${it.ownerName||""}"`,`"${it.ownerPhone||""}"`,it.confidence!=null?it.confidence:"",it.time?fmtTime(it.time):""].join(",")));
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=(task.name||"batch-task")+".csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  choose.onclick=()=>files.click();
  files.onchange=()=>{count.textContent=files.files?.length?`已选择 ${files.files.length} 张图片`:"未选择文件"}
  start.onclick=async ()=>{
    const f=files.files; if(!f||!f.length){toast("请先选择图片","error");return}
    const task={id:"task-"+Date.now(), name:taskname.value.trim()||("任务-"+fmtTime(new Date().toISOString())), createdAt:new Date().toISOString(), status:"running", items:Array.from(f).map(x=>({fileName:x.name,status:"pending",confidence:null,plateNumber:"",ownerName:"",ownerPhone:"",time:null}))};
    appState.tasks.unshift(task); saveTasks(); render();
    start.disabled=true; start.textContent="任务执行中...";
    for(let i=0;i<f.length;i++){const file=f[i], item=task.items[i]; item.status="running"; render();
      try{ const r=await apiRecognize(file); item.status="done"; item.plateNumber=r.plateNumber||""; item.confidence=r.confidence||0; item.time=r.time||new Date().toISOString(); }
      catch(e){ item.status="error"; }
      saveTasks(); render();
    }
    task.status="finished"; saveTasks(); render(); toast("批量任务完成");
    start.disabled=false; start.textContent="开始识别";
  };

  if(requireAuth()) initNav();
  render();
})();
