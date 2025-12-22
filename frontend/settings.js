(function(){
  const api=$("api"), theme=$("theme"), lang=$("lang"), form=$("api-form");
  const cleanupBtn = $("cleanup-cache");
  const cleanupResult = $("cleanup-result");
  api.value=appState.settings.apiBaseUrl||""; theme.value=appState.settings.theme||"light"; lang.value=appState.settings.lang||"zh-CN";
  form.onsubmit=e=>{e.preventDefault(); appState.settings.apiBaseUrl=api.value.trim(); save(STORAGE_KEYS.SETTINGS,appState.settings); toast("接口配置已保存")};
  theme.onchange=()=>{appState.settings.theme=theme.value; save(STORAGE_KEYS.SETTINGS,appState.settings); updateTheme()};
  lang.onchange=()=>{appState.settings.lang=lang.value; save(STORAGE_KEYS.SETTINGS,appState.settings); toast("语言设置已保存（占位）")};

  if(cleanupBtn){
    cleanupBtn.onclick = async ()=>{
      cleanupBtn.disabled = true;
      cleanupBtn.textContent = "清理中...";
      cleanupResult.textContent = "";
      try{
        const stats = await apiCleanupCache();
        const msg = stats && stats.length ? stats.map(s=>`${s.dir}: 删除 ${s.removed} 项`).join("；") : "已清理";
        cleanupResult.textContent = msg;
        toast("缓存已清理");
      }catch(e){
        toast(e.message || "清理失败","error");
        cleanupResult.textContent = e.message || "清理失败";
      }finally{
        cleanupBtn.disabled = false;
        cleanupBtn.textContent = "清理缓存";
      }
    };
  }
})();
