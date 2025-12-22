(function(){
  const drop = $("video-drop");
  const fileInput = $("video-file");
  const previewWrap = $("video-preview");
  const inputVideo = $("input-video");
  const videoName = $("video-name");
  const videoSize = $("video-size");
  const fpsInput = $("fps-input");
  const startBtn = $("start-video");
  const clearBtn = $("clear-video");
  const statusEl = $("video-status");
  const saveOwnerName = $("save-owner-name");
  const saveOwnerPhone = $("save-owner-phone");

  const resultEmpty = $("video-result-empty");
  const resultPanel = $("video-result");
  const outputVideo = $("output-video");
  const plateTags = $("plate-tags");
  const plateSelect = $("plate-select");
  const saveSelectedBtn = $("save-selected");
  const frameCountEl = $("frame-count");
  const durationEl = $("duration");

  const logList = $("video-log");
  const clearLogsBtn = $("clear-video-logs");

  let currentFile = null;
  let previewUrl = null;
  let currentPlates = [];
  let selectedPlates = new Set();

  function setStatus(text){
    if(statusEl) statusEl.textContent = text;
  }

  function resetResult(){
    if(outputVideo){
      outputVideo.removeAttribute("src");
      outputVideo.load();
    }
    if(resultPanel) resultPanel.classList.add("hidden");
    if(resultEmpty) resultEmpty.classList.remove("hidden");
    if(plateTags) plateTags.innerHTML = "";
    if(plateSelect) plateSelect.innerHTML = "";
    if(frameCountEl) frameCountEl.textContent = "--";
    if(durationEl) durationEl.textContent = "--";
    currentPlates = [];
    selectedPlates = new Set();
    if(saveSelectedBtn) saveSelectedBtn.disabled = true;
  }

  function renderPlateSelect(plates){
    currentPlates = plates || [];
    selectedPlates = new Set(currentPlates);
    if(plateSelect){
      if(!currentPlates.length){
        plateSelect.innerHTML = '<div class="empty-hint">暂无车牌可选择</div>';
        if(saveSelectedBtn) saveSelectedBtn.disabled = true;
        return;
      }
      plateSelect.innerHTML = currentPlates.map(p=>`
        <label class="checkbox-tag">
          <input type="checkbox" data-plate="${p}" checked />
          <span>${p}</span>
        </label>
      `).join("");
      plateSelect.querySelectorAll('input[type="checkbox"]').forEach(chk=>{
        chk.onchange = ()=>{
          const pn = chk.dataset.plate;
          if(chk.checked) selectedPlates.add(pn); else selectedPlates.delete(pn);
          if(saveSelectedBtn) saveSelectedBtn.disabled = selectedPlates.size === 0;
        };
      });
      if(saveSelectedBtn) saveSelectedBtn.disabled = selectedPlates.size === 0;
    }
  }

  function resetAll(){
    currentFile = null;
    if(previewUrl){
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if(previewWrap) previewWrap.classList.add("hidden");
    if(inputVideo){
      inputVideo.removeAttribute("src");
      inputVideo.load();
    }
    if(fileInput) fileInput.value = "";
    resetResult();
    setStatus("等待选择视频");
  }

  function renderLogs(){
    if(!logList) return;
    const logs = load(STORAGE_KEYS.LOGS, []).filter(l=>l.source==="视频");
    if(!logs.length){
      logList.classList.add("empty");
      logList.innerHTML = '<div class="empty-hint">暂无视频识别记录</div>';
      return;
    }
    logList.classList.remove("empty");
    logList.innerHTML = logs.slice(0,5).map(l=>
      `<div class="recent-item">
         <div class="recent-info">
           <div class="plate">${l.finalPlateNumber||l.plateNumber||"--"}</div>
           <div class="time">${fmtTime(l.time)}</div>
           <div class="time">文件：${l.fileName||""}</div>
         </div>
       </div>`
    ).join("");
  }

  function handleFiles(files){
    if(!files||!files.length) return;
    const f = files[0];
    if(!f.type.startsWith("video/")){ toast("仅支持视频文件","error"); return; }
    if(f.size > 300*1024*1024){ toast("视频过大，建议≤300MB","error"); return; }
    currentFile = f;
    if(previewUrl){ URL.revokeObjectURL(previewUrl); }
    previewUrl = URL.createObjectURL(f);
    if(inputVideo){
      inputVideo.src = previewUrl;
      inputVideo.load();
    }
    if(previewWrap) previewWrap.classList.remove("hidden");
    if(videoName) videoName.textContent = f.name;
    if(videoSize) videoSize.textContent = fmtSize(f.size);
    resetResult();
    setStatus("已选择："+f.name);
  }

  async function startRecognition(){
    if(!currentFile){ toast("请先选择视频","error"); return; }
    let fps = parseInt(fpsInput?.value || "60", 10);
    if(!fps || fps < 1) fps = 60;
    startBtn.disabled = true;
    clearBtn.disabled = true;
    startBtn.textContent = "识别中...";
    setStatus("视频上传和识别中，请稍候…");
    try{
      const res = await apiRecognizeVideo(currentFile, fps);
      if(outputVideo && res.videoUrl){
        outputVideo.src = res.videoUrl;
        outputVideo.load();
      }
      if(frameCountEl) frameCountEl.textContent = res.frameCount != null ? res.frameCount : "--";
      if(durationEl) durationEl.textContent = res.durationSec != null ? res.durationSec : "--";
      if(plateTags){
        if(res.plates && res.plates.length){
          plateTags.innerHTML = res.plates.map(p=>`<span class="tag">${p}</span>`).join("");
        }else{
          plateTags.innerHTML = '<div class="empty-hint">未检测到车牌</div>';
        }
      }
      const uniquePlates = res.plates ? Array.from(new Set(res.plates)) : [];
      renderPlateSelect(uniquePlates);
      if(resultEmpty) resultEmpty.classList.add("hidden");
      if(resultPanel) resultPanel.classList.remove("hidden");

      const firstPlate = res.plates && res.plates[0] ? res.plates[0] : "";
      const log = {
        fileName: currentFile.name,
        plateNumber: firstPlate,
        finalPlateNumber: firstPlate,
        confidence: firstPlate ? 0.99 : 0,
        time: new Date().toISOString(),
        source: "视频",
        previewUrl: null,
      };
      appState.logs.unshift(log);
      if(appState.logs.length > 200) appState.logs.length = 200;
      save(STORAGE_KEYS.LOGS, appState.logs);
      renderLogs();
      toast("视频识别完成");
      setStatus("识别完成");
    }catch(e){
      console.error(e);
      toast(e.message || "视频识别失败","error");
      setStatus("识别失败：" + (e.message || ""));
    }finally{
      startBtn.disabled = false;
      clearBtn.disabled = false;
      startBtn.textContent = "开始识别";
    }
  }

  if(drop){
    drop.onclick = ()=>fileInput && fileInput.click();
    drop.ondragover = e=>{e.preventDefault();drop.classList.add("dragover");};
    drop.ondragleave = e=>{e.preventDefault();drop.classList.remove("dragover");};
    drop.ondrop = e=>{e.preventDefault();drop.classList.remove("dragover");handleFiles(e.dataTransfer.files);};
  }
  if(fileInput) fileInput.onchange = e=>handleFiles(e.target.files);
  if(startBtn) startBtn.onclick = startRecognition;
  if(clearBtn) clearBtn.onclick = resetAll;
  if(clearLogsBtn) clearLogsBtn.onclick = ()=>{appState.logs = appState.logs.filter(l=>l.source!=="视频"); save(STORAGE_KEYS.LOGS, appState.logs); renderLogs();};

  async function saveSelectedPlatesToDb(){
    if(!selectedPlates.size){
      toast("请勾选要写入的车牌","error");
      return;
    }
    const name = (saveOwnerName?.value || "").trim();
    const phone = (saveOwnerPhone?.value || "").trim();
    if(!name){
      toast("请填写车主姓名","error");
      return;
    }
    saveSelectedBtn.disabled = true;
    saveSelectedBtn.textContent = "写入中...";
    try{
      const toSave = Array.from(selectedPlates);
      for(const pn of toSave){
        try{
          await apiSaveOwner(pn, name, phone);
        }catch(err){
          console.warn("保存车主失败", pn, err);
        }
      }
      toast("已写入车主信息");
    }catch(e){
      toast(e.message || "写入失败","error");
    }finally{
      saveSelectedBtn.textContent = "写入所选车牌";
      saveSelectedBtn.disabled = selectedPlates.size === 0;
    }
  }

  if(saveSelectedBtn) saveSelectedBtn.onclick = saveSelectedPlatesToDb;

  renderLogs();
  setStatus("等待选择视频");
})();
