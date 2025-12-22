(function(){
  const logKey=STORAGE_KEYS.LOGS; appState.logs=load(logKey,[]);
  const drop=$("drop"), file=$("file"), pv=$("pv"), img=$("img"), bbox=$("bbox"), fn=$("fn"), fs=$("fs");
  const empty=$("empty"), res=$("res"), pn=$("pn"), conf=$("conf"), timeEl=$("time"), veh=$("veh"), db=$("db");
  const copy=$("copy"), form=$("owner"), oplate=$("o-plate"), oname=$("o-name"), ophone=$("o-phone"), ename=$("e-name"), ephone=$("e-phone"), saveBtn=$("save");
  const recent=$("recent"), clr=$("clr"), testList=$("test-image-list");

  function renderRecent(){
    const a=appState.logs.slice(0,8);
    if(!a.length){recent.classList.add("empty");recent.innerHTML='<div class="empty-hint">暂无识别记录。</div>';return}
    recent.classList.remove("empty");
    recent.innerHTML=a.map(l=>`<div class="recent-item"><div class="recent-thumb" ${l.previewUrl?`style="background-image:url('${l.previewUrl}')"`:''}></div><div class="recent-info"><div class="plate">${l.plateNumber||"--"}</div><div class="time">${fmtTime(l.time)}</div></div></div>`).join("");
  }
  function addLog(r){appState.logs.unshift(r);if(appState.logs.length>200)appState.logs.length=200;save(logKey,appState.logs);renderRecent()}
    // 把远端图片当成 File 来走同一套识别逻辑
  async function loadTestImage(url, filename){
    try{
      const resp = await fetch(url);
      const blob = await resp.blob();
      const f = new File([blob], filename || "test.jpg", { type: blob.type || "image/jpeg" });
      handleFiles([f]);
    }catch(e){
      console.error(e);
      toast("加载测试图片失败","error");
    }
  }

  // 加载 test_image 目录的测试图片列表
  async function loadTestImages(){
    if(!testList) return;
    testList.innerHTML = '<div class="empty-hint">正在加载测试图片...</div>';
    try{
      const resp = await fetch("/api/test-images");
      const data = await resp.json();
      if(!data.success || !data.items || !data.items.length){
        testList.innerHTML = '<div class="empty-hint">未找到测试图片，请检查 test_image 目录。</div>';
        return;
      }
      testList.innerHTML = data.items.map(it =>
        `<div class="test-image-item" data-url="${it.url}" data-name="${it.name}"
             style="background-image:url('${it.url}')"></div>`
      ).join("");

      testList.querySelectorAll(".test-image-item").forEach(el=>{
        el.onclick = ()=>{
          const url = el.getAttribute("data-url");
          const name = el.getAttribute("data-name") || "test.jpg";
          loadTestImage(url, name);
        };
      });
    }catch(e){
      console.error(e);
      testList.innerHTML = '<div class="empty-hint">加载测试图片失败。</div>';
    }
  }

  function handleFiles(files){
    if(!files||!files.length)return;
    if(files.length>1){location.href="/batch"; toast("已为你跳转到【批量识别任务】","success"); return}
    const f=files[0];
    if(!f.type.startsWith("image/")){toast("仅支持图片","error");return}
    if(f.size>10*1024*1024){toast("图片过大，≤10MB","error");return}
    const r=new FileReader();
    r.onload=e=>{img.src=e.target.result; pv.classList.remove("hidden"); empty.classList.remove("hidden"); res.classList.add("hidden"); fn.textContent=f.name; fs.textContent=fmtSize(f.size); bbox.classList.add("hidden")};
    r.readAsDataURL(f);
    recognize(f);
  }
  async function recognize(f){
    saveBtn.disabled=true; saveBtn.textContent="识别中...";
    try{
      const d=await apiRecognize(f);
      const plate=d.plateNumber||"", c=d.confidence||0, t=d.time||new Date().toISOString();
      pn.textContent=plate||"--"; conf.textContent=(c*100).toFixed(1)+"%"; timeEl.textContent=fmtTime(t);
      veh.textContent=d.vehicleType||"--"; db.textContent=d.inDatabase?"已在数据库中":"未绑定车主信息";
      empty.classList.add("hidden"); res.classList.remove("hidden");
      oplate.value=plate; oname.value=d.ownerName||""; ophone.value=d.ownerPhone||"";
      if(d.bbox&&img.complete){const [x,y,w,h]=d.bbox;const r=img.getBoundingClientRect(); bbox.style.left=(r.width*x)+"px";bbox.style.top=(r.height*y)+"px";bbox.style.width=(r.width*w)+"px";bbox.style.height=(r.height*h)+"px";bbox.classList.remove("hidden")} else bbox.classList.add("hidden");
      addLog({fileName:f.name,plateNumber:plate,finalPlateNumber:plate,confidence:c,time:t,source:"单张",previewUrl:img.src});
    }catch(e){toast(e.message||"识别失败","error")}finally{saveBtn.disabled=false;saveBtn.textContent="保存车主信息"}
  }

  drop.onclick=()=>file.click();
  drop.ondragover=e=>{e.preventDefault();drop.classList.add("dragover")}
  drop.ondragleave=e=>{e.preventDefault();drop.classList.remove("dragover")}
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove("dragover");handleFiles(e.dataTransfer.files)}
  file.onchange=e=>handleFiles(e.target.files);

  copy.onclick=()=>{const t=pn.textContent.trim(); if(!t||t==="--")return; navigator.clipboard.writeText(t).then(()=>toast("已复制")).catch(()=>toast("复制失败","error"))}

  form.onsubmit=async e=>{
    e.preventDefault(); ename.textContent=""; ephone.textContent="";
    const plate=oplate.value.trim(), name=oname.value.trim(), phone=ophone.value.trim();
    if(!plate){ename.textContent="请先识别车牌";return}
    if(!name){ename.textContent="姓名不能为空";return}
    if(phone && !/^\+?\d{6,20}$/.test(phone)){ephone.textContent="手机号格式不正确";return}
    saveBtn.disabled=true; saveBtn.textContent="保存中...";
    try{await apiSaveOwner(plate,name,phone); toast("保存成功")}catch(e){toast("保存失败","error")}finally{saveBtn.disabled=false; saveBtn.textContent="保存车主信息"}
  };

  clr.onclick=()=>{appState.logs=[];save(logKey,appState.logs);renderRecent()}
  if(requireAuth()) initNav();
  renderRecent();
  loadTestImages();
})();
