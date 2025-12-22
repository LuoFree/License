(function () {
  const STORAGE_KEYS = {
    USER: "lp_user",
    SETTINGS: "lp_settings",
    LOGS: "lp_logs",
    TASKS: "lp_tasks",
  };

  const appState = {
    user: null,
    settings: {
      apiBaseUrl: "",
      theme: "light",
      lang: "zh-CN",
    },
    logs: [],
    tasks: [],
    currentView: "recognition",
    currentImage: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message, type = "success") {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast " + (type === "error" ? "error" : "success");
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => {
        toast.remove();
      }, 200);
    }, 2200);
  }

  function saveToStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("保存本地存储失败:", key, e);
    }
  }

  function loadFromStorage(key, defaultValue) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;
      return JSON.parse(raw);
    } catch (e) {
      return defaultValue;
    }
  }

  function initStateFromStorage() {
    appState.user = loadFromStorage(STORAGE_KEYS.USER, null);
    appState.settings = Object.assign(
      {
        apiBaseUrl: "",
        theme: "light",
        lang: "zh-CN",
      },
      loadFromStorage(STORAGE_KEYS.SETTINGS, {})
    );
    appState.logs = loadFromStorage(STORAGE_KEYS.LOGS, []);
    appState.tasks = loadFromStorage(STORAGE_KEYS.TASKS, []);
  }

  function persistState() {
    saveToStorage(STORAGE_KEYS.USER, appState.user);
    saveToStorage(STORAGE_KEYS.SETTINGS, appState.settings);
    saveToStorage(STORAGE_KEYS.LOGS, appState.logs);
    saveToStorage(STORAGE_KEYS.TASKS, appState.tasks);
  }

  function updateTheme() {
    const theme = appState.settings.theme || "light";
    document.documentElement.setAttribute("data-theme", theme);
  }

  function switchView(view) {
    appState.currentView = view;
    document
      .querySelectorAll(".view")
      .forEach((v) => v.classList.remove("active"));
    const target = $("view-" + view);
    if (target) target.classList.add("active");

    document
      .querySelectorAll(".nav-item")
      .forEach((item) => item.classList.remove("active"));
    document
      .querySelectorAll(`.nav-item[data-view="${view}"]`)
      .forEach((item) => item.classList.add("active"));

    if (view === "history") {
      renderHistoryTable();
    } else if (view === "batch") {
      renderTaskList();
    } else if (view === "plates") {
      refreshPlatesFromBackend();
    }
  }

  function formatDateTime(iso) {
    if (!iso) return "--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes()) +
      ":" +
      pad(d.getSeconds())
    );
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function getApiBaseUrl() {
    if (appState.settings.apiBaseUrl && appState.settings.apiBaseUrl.trim()) {
      return appState.settings.apiBaseUrl.replace(/\/$/, "");
    }
    return window.location.origin.replace(/\/$/, "") + "/api";
  }

  async function callRecognitionApi(file) {
    const base = getApiBaseUrl();
    const url = base + "/recognize";

    const form = new FormData();
    form.append("image", file);

    try {
      const resp = await fetch(url, {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        throw new Error("识别接口返回错误状态：" + resp.status);
      }
      const data = await resp.json();
      return data;
    } catch (e) {
      console.error("调用识别接口失败:", e);
      throw e;
    }
  }

  async function fetchPlatesFromBackend() {
    const base = getApiBaseUrl();
    const url = base + "/plates";
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("请求失败：" + resp.status);
      const data = await resp.json();
      if (!data || !data.success) {
        throw new Error(data.detail || "返回数据格式不正确");
      }
      return data.items || [];
    } catch (e) {
      console.warn("获取车牌列表失败，将只使用本地记录:", e);
      return [];
    }
  }

  async function saveOwnerToBackend(plateNumber, ownerName, ownerPhone) {
    const base = getApiBaseUrl();
    const url = base + "/owners";
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plateNumber,
          ownerName,
          ownerPhone,
        }),
      });
      if (!resp.ok) {
        throw new Error("保存失败：" + resp.status);
      }
      const data = await resp.json();
      if (!data.success) {
        throw new Error(data.detail || "保存失败");
      }
      return true;
    } catch (e) {
      console.warn("保存车主信息到后端失败:", e);
      return false;
    }
  }

  function addLogRecord(record) {
    appState.logs.unshift(record);
    if (appState.logs.length > 200) {
      appState.logs.length = 200;
    }
    saveToStorage(STORAGE_KEYS.LOGS, appState.logs);
  }

  function renderHistoryTable() {
    const wrapper = $("history-table-wrapper");
    const searchPlate = $("history-search-plate").value.trim();
    const confFilter = $("history-confidence-filter").value;

    let logs = appState.logs.slice();
    if (searchPlate) {
      logs = logs.filter((l) =>
        (l.plateNumber || "").toUpperCase().includes(searchPlate.toUpperCase())
      );
    }
    if (confFilter) {
      const min = parseFloat(confFilter);
      logs = logs.filter((l) => (l.confidence || 0) >= min);
    }

    if (!logs.length) {
      wrapper.classList.add("empty");
      wrapper.innerHTML = '<div class="empty-hint">暂无日志记录。</div>';
      return;
    }
    wrapper.classList.remove("empty");

    const rows = logs
      .map((log, idx) => {
        return (
          "<tr>" +
          `<td>${idx + 1}</td>` +
          `<td>${log.fileName || "--"}</td>` +
          `<td>${log.plateNumber || "--"}</td>` +
          `<td>${log.finalPlateNumber || log.plateNumber || "--"}</td>` +
          `<td>${log.confidence != null ? (log.confidence * 100).toFixed(
            1
          ) + "%" : "--"}</td>` +
          `<td>${formatDateTime(log.time)}</td>` +
          `<td>${log.source || "单张"}</td>` +
          "</tr>"
        );
      })
      .join("");

    wrapper.innerHTML =
      "<table><thead><tr>" +
      "<th>#</th><th>文件名</th><th>车牌（识别）</th><th>车牌（最终）</th><th>置信度</th><th>时间</th><th>来源</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>";
  }

  function renderRecentList() {
    const container = $("recent-list");
    const latest = appState.logs.slice(0, 8);
    if (!latest.length) {
      container.classList.add("empty");
      container.innerHTML = '<div class="empty-hint">暂无识别记录。</div>';
      return;
    }
    container.classList.remove("empty");
    container.innerHTML = latest
      .map((log, idx) => {
        const plate = log.plateNumber || "--";
        const time = formatDateTime(log.time);
        return (
          `<div class="recent-item" data-log-index="${idx}">` +
          `<div class="recent-thumb" style="${
            log.previewUrl ? "background-image:url('" + log.previewUrl + "')" : ""
          }"></div>` +
          '<div class="recent-info">' +
          `<div class="plate">${plate}</div>` +
          `<div class="time">${time}</div>` +
          "</div></div>"
        );
      })
      .join("");
  }

  function renderTaskList() {
    const listWrap = $("batch-task-list");
    if (!appState.tasks.length) {
      listWrap.classList.add("empty");
      listWrap.innerHTML = '<div class="empty-hint">暂无批量任务。</div>';
      return;
    }
    listWrap.classList.remove("empty");

    const rows = appState.tasks
      .map((task, idx) => {
        return (
          "<tr>" +
          `<td>${idx + 1}</td>` +
          `<td>${task.name}</td>` +
          `<td>${formatDateTime(task.createdAt)}</td>` +
          `<td>${task.items.length}</td>` +
          `<td>${task.items.filter((i) => i.status === "done").length}</td>` +
          `<td>${task.status}</td>` +
          `<td><button class="btn small" data-task-id="${task.id}" data-action="detail">详情</button></td>` +
          "</tr>"
        );
      })
      .join("");

    listWrap.innerHTML =
      "<table><thead><tr>" +
      "<th>#</th><th>任务名称</th><th>创建时间</th><th>总数</th><th>已完成</th><th>状态</th><th>操作</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>";
  }

  function openTaskDetail(taskId) {
    const task = appState.tasks.find((t) => t.id === taskId);
    if (!task) return;

    $("batch-detail-title").textContent = "任务详情 - " + task.name;
    const body = $("batch-detail-body");

    if (!task.items.length) {
      body.innerHTML = '<div class="empty-hint">该任务暂无记录。</div>';
    } else {
      const rows = task.items
        .map((item, idx) => {
          return (
            "<tr>" +
            `<td>${idx + 1}</td>` +
            `<td>${item.fileName}</td>` +
            `<td>${item.plateNumber || ""}</td>` +
            `<td>${
              item.confidence != null
                ? (item.confidence * 100).toFixed(1) + "%"
                : ""
            }</td>` +
            `<td>${item.ownerName || ""}</td>` +
            `<td>${item.ownerPhone || ""}</td>` +
            `<td>${item.status}</td>` +
            "</tr>"
          );
        })
        .join("");
      body.innerHTML =
        "<table><thead><tr>" +
        "<th>#</th><th>图片</th><th>车牌号</th><th>置信度</th><th>姓名</th><th>电话</th><th>状态</th>" +
        "</tr></thead><tbody>" +
        rows +
        "</tbody></table>";
    }

    $("batch-detail-overlay").classList.remove("hidden");
    $("batch-export-btn").onclick = function () {
      exportTaskToCsv(task);
    };
  }

  function exportTaskToCsv(task) {
    const header = [
      "序号",
      "文件名",
      "车牌号",
      "姓名",
      "电话",
      "置信度",
      "识别时间",
    ];
    const lines = [header.join(",")];
    task.items.forEach((item, idx) => {
      const row = [
        idx + 1,
        `"${item.fileName || ""}"`,
        `"${item.plateNumber || ""}"`,
        `"${item.ownerName || ""}"`,
        `"${item.ownerPhone || ""}"`,
        item.confidence != null ? item.confidence : "",
        item.time ? formatDateTime(item.time) : "",
      ];
      lines.push(row.join(","));
    });
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (task.name || "batch-task") + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function refreshPlatesFromBackend() {
    const wrapper = $("plates-table-wrapper");
    wrapper.innerHTML = '<div class="empty-hint">加载中...</div>';
    wrapper.classList.remove("empty");
    try {
      const records = await fetchPlatesFromBackend();
      if (!records.length) {
        wrapper.classList.add("empty");
        wrapper.innerHTML =
          '<div class="empty-hint">暂无车牌数据，可在识别后保存车主信息。</div>';
        return;
      }

      const searchPlate = $("plates-search-plate").value.trim();
      const searchName = $("plates-search-name").value.trim();

      let filtered = records;
      if (searchPlate) {
        filtered = filtered.filter((r) =>
          (r.plateNumber || "")
            .toUpperCase()
            .includes(searchPlate.toUpperCase())
        );
      }
      if (searchName) {
        filtered = filtered.filter((r) =>
          (r.ownerName || "").includes(searchName)
        );
      }

      const rows = filtered
        .map((r, idx) => {
          return (
            "<tr>" +
            `<td>${idx + 1}</td>` +
            `<td>${r.plateNumber || ""}</td>` +
            `<td>${r.ownerName || ""}</td>` +
            `<td>${r.ownerPhone || ""}</td>` +
            "</tr>"
          );
        })
        .join("");

      wrapper.classList.remove("empty");
      wrapper.innerHTML =
        "<table><thead><tr>" +
        "<th>#</th><th>车牌号</th><th>姓名</th><th>电话</th>" +
        "</tr></thead><tbody>" +
        rows +
        "</tbody></table>";
    } catch (e) {
      wrapper.classList.add("empty");
      wrapper.innerHTML =
        '<div class="empty-hint">从数据库获取数据失败，可稍后重试。</div>';
    }
  }

  function initAuth() {
    const loginView = $("login-view");
    const appLayout = $("app-layout");
    const currentUserLabel = $("current-user-label");
    const logoutBtn = $("logout-btn");
    const loginForm = $("login-form");
    const usernameInput = $("login-username");
    const passwordInput = $("login-password");
    const usernameError = $("login-username-error");
    const passwordError = $("login-password-error");

    function enterApp() {
      loginView.classList.add("hidden");
      appLayout.classList.remove("hidden");
      currentUserLabel.textContent =
        "已登录：" + (appState.user?.username || "--");
      $("api-base-url").value = appState.settings.apiBaseUrl || "";
      $("theme-select").value = appState.settings.theme || "light";
      $("lang-select").value = appState.settings.lang || "zh-CN";
      updateTheme();
      renderRecentList();
      renderHistoryTable();
      renderTaskList();
    }

    function leaveApp() {
      appLayout.classList.add("hidden");
      loginView.classList.remove("hidden");
      currentUserLabel.textContent = "已登录：--";
    }

    if (appState.user && appState.user.username) {
      enterApp();
    }

    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      usernameError.textContent = "";
      passwordError.textContent = "";

      const username = usernameInput.value.trim();
      const password = passwordInput.value.trim();

      if (!username) {
        usernameError.textContent = "请输入用户名";
        return;
      }
      if (!password) {
        passwordError.textContent = "请输入密码";
        return;
      }

      const validUsers = [
        { username: "admin", password: "123456" },
        { username: "test", password: "test123" },
      ];

      const match = validUsers.find(
        (u) => u.username === username && u.password === password
      );

      if (!match) {
        passwordError.textContent = "用户名或密码错误";
        showToast("用户名或密码错误", "error");
        return;
      }

      appState.user = {
        username: match.username,
        loginAt: new Date().toISOString(),
      };
      saveToStorage(STORAGE_KEYS.USER, appState.user);
      showToast("登录成功", "success");
      enterApp();
    });

    logoutBtn.addEventListener("click", () => {
      appState.user = null;
      saveToStorage(STORAGE_KEYS.USER, appState.user);
      leaveApp();
    });
  }

  function initNav() {
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        const view = item.getAttribute("data-view");
        switchView(view);
      });
    });
  }

  function initSettings() {
    const apiForm = $("settings-api-form");
    const themeSelect = $("theme-select");
    const langSelect = $("lang-select");

    apiForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const base = $("api-base-url").value.trim();
      appState.settings.apiBaseUrl = base;
      saveToStorage(STORAGE_KEYS.SETTINGS, appState.settings);
      showToast("接口配置已保存", "success");
    });

    themeSelect.addEventListener("change", () => {
      appState.settings.theme = themeSelect.value;
      saveToStorage(STORAGE_KEYS.SETTINGS, appState.settings);
      updateTheme();
    });

    langSelect.addEventListener("change", () => {
      appState.settings.lang = langSelect.value;
      saveToStorage(STORAGE_KEYS.SETTINGS, appState.settings);
      showToast("语言设置已保存（当前为占位实现）", "success");
    });
  }

  function initRecognitionPage() {
    const dropzone = $("upload-dropzone");
    const fileInput = $("upload-input");
    const preview = $("upload-preview");
    const previewImg = $("preview-image");
    const previewFilename = $("preview-filename");
    const previewSize = $("preview-size");
    const bboxOverlay = $("preview-bbox");
    const resultEmpty = $("recognition-empty");
    const resultPanel = $("recognition-result");
    const plateNumberEl = $("result-plate-number");
    const confEl = $("result-confidence");
    const timeEl = $("result-time");
    const vehicleEl = $("result-vehicle");
    const dbStatusEl = $("result-db-status");
    const btnCopyPlate = $("btn-copy-plate");
    const ownerPlateInput = $("owner-plate-number");
    const ownerNameInput = $("owner-name");
    const ownerPhoneInput = $("owner-phone");
    const ownerNameError = $("owner-name-error");
    const ownerPhoneError = $("owner-phone-error");
    const ownerForm = $("owner-form");
    const recentClearBtn = $("recent-clear-btn");

    function resetPreview() {
      preview.classList.add("hidden");
      resultPanel.classList.add("hidden");
      resultEmpty.classList.remove("hidden");
      appState.currentImage = null;
      ownerPlateInput.value = "";
      ownerNameInput.value = "";
      ownerPhoneInput.value = "";
      bboxOverlay.classList.add("hidden");
    }

    function handleFiles(files) {
      if (!files || !files.length) return;

      if (files.length > 1) {
        const batchInput = $("batch-file-input");
        batchInput.files = files;
        $("batch-file-count").textContent = "已选择 " + files.length + " 张图片";
        switchView("batch");
        showToast("已为你切换到【批量识别任务】页面", "success");
        return;
      }

      const file = files[0];
      if (!file.type.startsWith("image/")) {
        showToast("仅支持图片文件", "error");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast("图片过大，请控制在 10MB 以内", "error");
        return;
      }

      const reader = new FileReader();
      reader.onload = function (e) {
        previewImg.src = e.target.result;
        preview.classList.remove("hidden");
        resultEmpty.classList.remove("hidden");
        resultPanel.classList.add("hidden");
        previewFilename.textContent = file.name;
        previewSize.textContent = formatSize(file.size);
        bboxOverlay.classList.add("hidden");
      };
      reader.readAsDataURL(file);

      recognizeSingleImage(file);
    }

    async function recognizeSingleImage(file) {
      const saveBtn = $("owner-save-btn");
      saveBtn.disabled = true;
      saveBtn.textContent = "识别中...";
      try {
        const res = await callRecognitionApi(file);
        if (!res || res.success === false) {
          throw new Error(res && res.detail ? res.detail : "识别失败");
        }

        const plateNumber = res.plateNumber || "";
        const confidence = res.confidence || 0;
        const time = res.time || new Date().toISOString();
        const vehicleType = res.vehicleType || "";
        const inDb = !!res.inDatabase;
        const ownerName = res.ownerName || "";
        const ownerPhone = res.ownerPhone || "";

        appState.currentImage = {
          fileName: file.name,
          size: file.size,
          plateNumber,
          confidence,
          time,
          vehicleType,
          inDb,
          ownerName,
          ownerPhone,
          bbox: res.bbox || null,
          previewUrl: previewImg.src,
        };

        plateNumberEl.textContent = plateNumber || "--";
        confEl.textContent =
          confidence != null ? (confidence * 100).toFixed(1) + "%" : "--";
        timeEl.textContent = formatDateTime(time);
        vehicleEl.textContent = vehicleType || "--";
        dbStatusEl.textContent = inDb ? "已在数据库中" : "未绑定车主信息";
        resultEmpty.classList.add("hidden");
        resultPanel.classList.remove("hidden");

        ownerPlateInput.value = plateNumber || "";
        ownerNameInput.value = ownerName || "";
        ownerPhoneInput.value = ownerPhone || "";

        if (res.bbox && previewImg.complete) {
          drawBboxOnPreview(res.bbox);
        } else {
          bboxOverlay.classList.add("hidden");
        }

        addLogRecord({
          fileName: file.name,
          plateNumber,
          finalPlateNumber: plateNumber,
          confidence,
          time,
          source: "单张",
          previewUrl: previewImg.src,
        });
        renderRecentList();
      } catch (e) {
        console.error(e);
        showToast(e.message || "识别失败", "error");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "保存车主信息";
      }
    }

    function drawBboxOnPreview(bbox) {
      const [x, y, w, h] = bbox;
      if (!previewImg.naturalWidth || !previewImg.naturalHeight) return;

      const imgRect = previewImg.getBoundingClientRect();
      const boxWidth = imgRect.width * w;
      const boxHeight = imgRect.height * h;
      const left = imgRect.width * x;
      const top = imgRect.height * y;

      bboxOverlay.style.left = left + "px";
      bboxOverlay.style.top = top + "px";
      bboxOverlay.style.width = boxWidth + "px";
      bboxOverlay.style.height = boxHeight + "px";
      bboxOverlay.classList.remove("hidden");
    }

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      const files = e.dataTransfer.files;
      handleFiles(files);
    });

    fileInput.addEventListener("change", (e) => {
      handleFiles(e.target.files);
    });

    btnCopyPlate.addEventListener("click", () => {
      const text = plateNumberEl.textContent.trim();
      if (!text || text === "--") return;
      navigator.clipboard
        .writeText(text)
        .then(() => showToast("车牌号已复制到剪贴板"))
        .catch(() => showToast("复制失败，请手动复制", "error"));
    });

    ownerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      ownerNameError.textContent = "";
      ownerPhoneError.textContent = "";

      const plateNumber = ownerPlateInput.value.trim();
      const name = ownerNameInput.value.trim();
      const phone = ownerPhoneInput.value.trim();

      if (!plateNumber) {
        ownerNameError.textContent = "请先完成车牌识别";
        return;
      }
      if (!name) {
        ownerNameError.textContent = "姓名不能为空";
        return;
      }
      if (phone && !/^\+?\d{6,20}$/.test(phone)) {
        ownerPhoneError.textContent = "手机号格式不正确";
        return;
      }

      const btn = $("owner-save-btn");
      btn.disabled = true;
      btn.textContent = "保存中...";
      try {
        await saveOwnerToBackend(plateNumber, name, phone);
        if (appState.currentImage) {
          appState.currentImage.ownerName = name;
          appState.currentImage.ownerPhone = phone;
        }
        showToast("车主信息已保存", "success");
      } catch (e) {
        showToast("保存失败", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "保存车主信息";
      }
    });

    recentClearBtn.addEventListener("click", () => {
      appState.logs = [];
      saveToStorage(STORAGE_KEYS.LOGS, appState.logs);
      renderRecentList();
      renderHistoryTable();
    });
  }

  function initBatchPage() {
    const fileInput = $("batch-file-input");
    const chooseBtn = $("batch-choose-btn");
    const fileCountLabel = $("batch-file-count");
    const startBtn = $("batch-start-btn");
    const taskNameInput = $("batch-task-name");
    const listWrap = $("batch-task-list");

    chooseBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
      const count = fileInput.files ? fileInput.files.length : 0;
      fileCountLabel.textContent = count
        ? "已选择 " + count + " 张图片"
        : "未选择文件";
    });

    startBtn.addEventListener("click", async () => {
      const files = fileInput.files;
      if (!files || !files.length) {
        showToast("请先选择图片", "error");
        return;
      }

      const name =
        taskNameInput.value.trim() ||
        "任务-" + formatDateTime(new Date().toISOString());
      const id = "task-" + Date.now();

      const items = Array.from(files).map((f) => ({
        fileName: f.name,
        status: "pending",
        confidence: null,
        plateNumber: "",
        ownerName: "",
        ownerPhone: "",
        time: null,
      }));

      const task = {
        id,
        name,
        createdAt: new Date().toISOString(),
        status: "running",
        items,
      };

      appState.tasks.unshift(task);
      saveToStorage(STORAGE_KEYS.TASKS, appState.tasks);
      renderTaskList();

      startBtn.disabled = true;
      startBtn.textContent = "任务执行中...";

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const item = task.items[i];
        item.status = "running";
        renderTaskList();
        try {
          const res = await callRecognitionApi(file);
          const plateNumber = res.plateNumber || "";
          const conf = res.confidence || 0;
          item.status = "done";
          item.plateNumber = plateNumber;
          item.confidence = conf;
          item.time = res.time || new Date().toISOString();

          addLogRecord({
            fileName: file.name,
            plateNumber,
            finalPlateNumber: plateNumber,
            confidence: conf,
            time: item.time,
            source: "批量",
            previewUrl: null,
          });
        } catch (e) {
          item.status = "error";
        }
      }

      task.status = "finished";
      saveToStorage(STORAGE_KEYS.TASKS, appState.tasks);
      renderTaskList();
      renderHistoryTable();
      renderRecentList();

      startBtn.disabled = false;
      startBtn.textContent = "开始识别";
      showToast("批量任务已完成", "success");
    });

    listWrap.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-task-id]");
      if (!btn) return;
      const id = btn.getAttribute("data-task-id");
      openTaskDetail(id);
    });

    $("batch-detail-close").addEventListener("click", () => {
      $("batch-detail-overlay").classList.add("hidden");
    });
  }

  function initHistoryPage() {
    $("history-search-plate").addEventListener("input", () => {
      renderHistoryTable();
    });
    $("history-confidence-filter").addEventListener("change", () => {
      renderHistoryTable();
    });
    $("history-clear-btn").addEventListener("click", () => {
      appState.logs = [];
      saveToStorage(STORAGE_KEYS.LOGS, appState.logs);
      renderHistoryTable();
      renderRecentList();
    });
  }

  function initPlatesPage() {
    $("plates-refresh-btn").addEventListener("click", () => {
      refreshPlatesFromBackend();
    });
    $("plates-search-plate").addEventListener("input", () => {
      refreshPlatesFromBackend();
    });
    $("plates-search-name").addEventListener("input", () => {
      refreshPlatesFromBackend();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initStateFromStorage();
    updateTheme();

    initAuth();
    initNav();
    initSettings();
    initRecognitionPage();
    initBatchPage();
    initHistoryPage();
    initPlatesPage();

    renderTaskList();
    renderRecentList();
    renderHistoryTable();
  });
})();
