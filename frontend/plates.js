// frontend/plates.js
(async function(){
  const wrap = document.getElementById("table");  // 列表容器 id 必须是 table
  const sp = document.getElementById("sp");
  const sn = document.getElementById("sn");
  const refreshBtn = document.getElementById("refresh");
  const delSelBtn = document.getElementById("delSel");
  const overlay = document.getElementById("edit-overlay");
  const closeBtn = document.getElementById("edit-close");
  const saveBtn = document.getElementById("edit-save");
  const oldPlateInput = document.getElementById("edit-old-plate");
  const newPlateInput = document.getElementById("edit-new-plate");
  const nameInput = document.getElementById("edit-name");
  const phoneInput = document.getElementById("edit-phone");
  const errPlate = document.getElementById("edit-plate-err");
  const errName = document.getElementById("edit-name-err");

  let dataCache = [];        // 当前页数据
  let selected = new Set();  // 已勾选的车牌号

  async function loadData(){
    let list = await apiPlates(); // [{plateNumber, ownerName, ownerPhone}]
    const p = (sp.value||"").toUpperCase();
    const n = (sn.value||"");
    if (p) list = list.filter(r => (r.plateNumber||"").toUpperCase().includes(p));
    if (n) list = list.filter(r => (r.ownerName||"").includes(n));
    dataCache = list;
  }

  function render(){
    if (!dataCache.length){
      wrap.classList.add("empty");
      wrap.innerHTML = '<div class="empty-hint">暂无匹配记录。</div>';
      return;
    }
    wrap.classList.remove("empty");
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th style="width:42px;"><input type="checkbox" id="chkAll"></th>
            <th>#</th>
            <th>车牌号</th>
            <th>姓名</th>
            <th>电话</th>
            <th>创建时间</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${dataCache.map((r,i)=>`
            <tr>
              <td><input type="checkbox" class="chk" data-plate="${r.plateNumber||""}" ${selected.has(r.plateNumber)?'checked':''}></td>
              <td>${i+1}</td>
              <td>${r.plateNumber||""}</td>
              <td>${r.ownerName||""}</td>
              <td>${r.ownerPhone||""}</td>
              <td>${typeof fmtTime === 'function' ? fmtTime(r.createdAt) : (r.createdAt||'--')}</td>
              <td>${typeof fmtTime === 'function' ? fmtTime(r.updatedAt) : (r.updatedAt||'--')}</td>
              <td>
                <button class="btn small" data-edit="${r.plateNumber||""}">编辑</button>
                <button class="btn small" data-del="${r.plateNumber||""}">删除</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    // 同步“全选”勾选状态
    const chkAll = document.getElementById("chkAll");
    const allPlates = dataCache.map(x=>x.plateNumber);
    chkAll.checked = allPlates.length>0 && allPlates.every(p=>selected.has(p));
  }

  async function refresh(){
    try{
      await loadData();
      // 清理那些已经不在数据里的勾选
      const set2 = new Set();
      dataCache.forEach(x => { if (selected.has(x.plateNumber)) set2.add(x.plateNumber); });
      selected = set2;
      render();
    }catch(e){
      wrap.classList.add("empty");
      wrap.innerHTML = '<div class="empty-hint">从数据库获取失败。</div>';
    }
  }

  // 事件：刷新 & 筛选
  refreshBtn.onclick = refresh;
  sp.oninput = refresh;
  sn.oninput = refresh;

  // 事件：表格内的编辑、删除、勾选、全选
  wrap.addEventListener("click", async (e)=>{
    const delBtn = e.target.closest("button[data-del]");
    if (delBtn){
      const plate = delBtn.dataset.del;
      if (!plate) return;
      if (!confirm(`确认删除：${plate} ？此操作不可恢复`)) return;
      try{
        await apiDeleteOwner(plate);
        toast("删除成功");
        selected.delete(plate);
        await refresh();
      }catch(err){
        toast(err.message || "删除失败","error");
      }
      return;
    }

    const editBtn = e.target.closest("button[data-edit]");
    if (editBtn){
      const plate = editBtn.dataset.edit;
      const row = dataCache.find(x=>x.plateNumber===plate);
      if (!row) return;
      if (errPlate) errPlate.textContent="";
      if (errName) errName.textContent="";
      oldPlateInput.value = row.plateNumber || "";
      newPlateInput.value = row.plateNumber || "";
      nameInput.value = row.ownerName || "";
      phoneInput.value = row.ownerPhone || "";
      overlay.classList.remove("hidden");
      return;
    }
  });

  wrap.addEventListener("change", (e)=>{
    const chk = e.target.closest("input.chk");
    if (chk){
      const pn = chk.dataset.plate;
      if (chk.checked) selected.add(pn); else selected.delete(pn);
      // 同步“全选”
      const chkAll = document.getElementById("chkAll");
      const allPlates = dataCache.map(x=>x.plateNumber);
      chkAll.checked = allPlates.length>0 && allPlates.every(p=>selected.has(p));
      return;
    }
    if (e.target.id === "chkAll"){
      const all = e.target.checked;
      selected = new Set();
      if (all) dataCache.forEach(x=>selected.add(x.plateNumber));
      render(); // 重新渲染以更新每行勾选
    }
  });

  // 批量删除
  delSelBtn.onclick = async ()=>{
    const plates = Array.from(selected);
    if (!plates.length){ toast("请先勾选要删除的记录","error"); return; }
    if (!confirm(`确认批量删除 ${plates.length} 条记录？此操作不可恢复`)) return;
    try{
      const n = await apiBatchDeleteOwners(plates);
      toast(`已删除 ${n} 条`);
      selected.clear();
      await refresh();
    }catch(err){
      toast(err.message || "批量删除失败","error");
    }
  };

  // 编辑保存
  if (saveBtn) saveBtn.onclick = async ()=>{
    if (errPlate) errPlate.textContent="";
    if (errName) errName.textContent="";
    const oldPlate = (oldPlateInput.value||"").trim();
    const newPlate = (newPlateInput.value||"").trim();
    const name = (nameInput.value||"").trim();
    const phone = (phoneInput.value||"").trim();
    if(!newPlate){ if(errPlate) errPlate.textContent="新车牌不能为空"; return; }
    if(!name){ if(errName) errName.textContent="姓名不能为空"; return; }
    try{
      saveBtn.disabled=true; saveBtn.textContent="保存中...";
      await apiUpdateOwner(oldPlate, newPlate, name, phone);
      toast("更新成功");
      overlay.classList.add("hidden");
      await refresh();
    }catch(e){
      toast(e.message || "更新失败","error");
    }finally{
      saveBtn.disabled=false; saveBtn.textContent="保存";
    }
  };

  if (closeBtn) closeBtn.onclick = ()=> overlay.classList.add("hidden");

  if (requireAuth()) initNav();
  refresh();
})();
