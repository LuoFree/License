// 公共状态与工具
window.STORAGE_KEYS = { USER:"lp_user", SETTINGS:"lp_settings", LOGS:"lp_logs", TASKS:"lp_tasks" };
window.appState = { user:null, settings:{ apiBaseUrl:"", theme:"light", lang:"zh-CN" }, logs:[], tasks:[] };

function $(id){return document.getElementById(id);}
function save(k,v){
  try{
    const store = (k===STORAGE_KEYS.USER) ? sessionStorage : localStorage;
    store.setItem(k, JSON.stringify(v));
  }catch(e){}
}
function load(k,d){
  try{
    const store = (k===STORAGE_KEYS.USER) ? sessionStorage : localStorage;
    const r = store.getItem(k);
    return r ? JSON.parse(r) : d;
  }catch(e){return d}
}
function initState(){
  // 兼容旧版本：清掉曾经存过的持久化用户，改用 sessionStorage
  try{ localStorage.removeItem(STORAGE_KEYS.USER); }catch(e){}
  appState.user=load(STORAGE_KEYS.USER,null);
  appState.settings=Object.assign({apiBaseUrl:"",theme:"light",lang:"zh-CN"},load(STORAGE_KEYS.SETTINGS,{}));
  appState.logs=load(STORAGE_KEYS.LOGS,[]);
  appState.tasks=load(STORAGE_KEYS.TASKS,[]);
}
function updateTheme(){document.documentElement.setAttribute("data-theme",appState.settings.theme||"light");}
function toast(msg,type){let c=$("toast-container");if(!c){c=document.createElement("div");c.id="toast-container";document.body.appendChild(c)}const t=document.createElement("div");t.className="toast "+(type==="error"?"error":"success");t.textContent=msg;c.appendChild(t);setTimeout(()=>{t.style.opacity="0";setTimeout(()=>t.remove(),200)},2200);}
function fmtTime(iso){if(!iso)return"--";const d=new Date(iso);if(isNaN(d))return iso;const p=n=>n<10?"0"+n:n;return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
function fmtSize(b){if(b<1024)return b+" B";if(b<1024*1024)return (b/1024).toFixed(1)+" KB";return (b/1024/1024).toFixed(1)+" MB";}

function apiBase(){
  const base=(appState.settings.apiBaseUrl||"").trim();
  return (base?base:location.origin).replace(/\/$/,"")+"/api";
}

async function apiDeleteOwner(plate){
  const r = await fetch(apiBase()+"/owners/"+encodeURIComponent(plate), { method:"DELETE" });
  if (!r.ok) throw new Error("删除失败："+r.status);
  const d = await r.json();
  if (!d.success) throw new Error(d.detail || "删除失败");
  return true;
}

async function apiBatchDeleteOwners(plates){
  const r = await fetch(apiBase()+"/owners/batch_delete", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ plateNumbers: plates })
  });
  if (!r.ok) throw new Error("批量删除失败："+r.status);
  const d = await r.json();
  if (!d.success) throw new Error(d.detail || "批量删除失败");
  return d.deleted || 0;
}

async function apiRecognize(file){
  const f=new FormData();
  f.append("image",file);
  const r=await fetch(apiBase()+"/recognize",{method:"POST",body:f});
  if(!r.ok)throw new Error("识别接口错误："+r.status);
  return r.json();
}

async function apiRecognizeVideo(file,fps){
  const f=new FormData();
  f.append("video",file);
  if(fps)f.append("fps",fps);
  const r=await fetch(apiBase()+"/video-recognize",{method:"POST",body:f});
  if(!r.ok)throw new Error("视频识别接口错误："+r.status);
  const d=await r.json();
  if(!d.success)throw new Error(d.detail||"视频识别失败");
  return d;
}

async function apiPlates(){
  const r=await fetch(apiBase()+"/plates");
  if(!r.ok)throw new Error("获取车牌失败："+r.status);
  const d=await r.json();
  if(!d.success)throw new Error(d.detail||"拉取失败");
  return d.items||[];
}

async function apiSaveOwner(plate,name,phone){
  const r=await fetch(apiBase()+"/owners",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plateNumber:plate,ownerName:name,ownerPhone:phone})});
  if(!r.ok)throw new Error("保存失败："+r.status);
  const d=await r.json();
  if(!d.success)throw new Error(d.detail||"保存失败");
  return true;
}

async function apiUpdateOwner(oldPlate,newPlate,name,phone){
  const r=await fetch(apiBase()+"/owners/"+encodeURIComponent(oldPlate),{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ newPlateNumber:newPlate, ownerName:name, ownerPhone:phone })
  });
  if(!r.ok)throw new Error("更新失败："+r.status);
  const d=await r.json();
  if(!d.success)throw new Error(d.detail||"更新失败");
  return true;
}

async function apiCleanupCache(){
  const r=await fetch(apiBase()+"/cleanup-cache",{method:"POST"});
  if(!r.ok)throw new Error("清理失败："+r.status);
  const d=await r.json();
  if(!d.success)throw new Error(d.detail||"清理失败");
  return d.stats||[];
}

function requireAuth(){
  initState(); updateTheme();
  if(!appState.user||!appState.user.username){location.replace("/login");return false}
  const u=$("current-user-label"); if(u) u.textContent="已登录："+appState.user.username;
  const out=$("logout-btn"); if(out) out.addEventListener("click",()=>{appState.user=null;save(STORAGE_KEYS.USER,appState.user);location.replace("/login")});
  const page=document.body.getAttribute("data-page");
  document.querySelectorAll(".nav-item").forEach(li=>{ if(li.dataset.view===page) li.classList.add("active") });
  return true;
}
function initNav(){
  const map = {
    recognition: "/recognition",
    video: "/video",
    batch: "/batch",
    plates: "/plates",
    history: "/history",
    settings: "/settings",
  };
  document.querySelectorAll(".nav-item").forEach(li=>{
    const v = li.dataset.view;
    if (map[v]) li.onclick = () => { location.href = map[v]; };
  });
}
