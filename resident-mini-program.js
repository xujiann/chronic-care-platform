(function () {
  "use strict";

  const Core = window.ResidentMiniProgramCore;
  const adapter = window.ResidentMiniProgramAdapter.createAdapter(window);
  const auth = window.HealthCityAuth;
  const SESSION_KEY = "health-city-auth-session";
  const SESSION_CHECK_INTERVAL = 30 * 1000;

  const services = Object.freeze([
    { route: "health-record", label: "健康档案", icon: "档案", description: "查看健康指标、检查检验与健康资料来源。", collections: ["personalRecords"], boundary: "仅展示当前居民的最小化健康资料；原文与影像需另行受控调阅。" },
    { route: "emr", label: "电子病历", icon: "病历", description: "查看医疗机构返回的诊疗摘要。", collections: ["personalRecords"], category: "emr", boundary: "电子病历摘要来自医疗机构，不能替代完整病历原文或医生解释。" },
    { route: "registration", label: "预约挂号", icon: "挂号", description: "查看当前居民的挂号记录与服务状态。", collections: ["registrationOrders"], boundary: "本页面不直接伪造预约结果；提交预约须进入业务模块并等待医院、支付与医保网关回执。" },
    { route: "nursing", label: "护理服务", icon: "护理", description: "查看互联网护理申请和服务进度。", collections: ["internetNursingOrders"], boundary: "护理申请、派单、接单和完成状态均以服务端正式回执为准。" },
    { route: "escort", label: "陪诊服务", icon: "陪诊", description: "查看陪诊申请、保障与服务进度。", collections: ["escortServiceOrders"], boundary: "陪诊预约需由服务主体确认，页面不会在未收到回执时显示办理成功。" },
    { route: "family-doctor", label: "家庭医生", icon: "家医", description: "查看签约申请、合同与履约情况。", collections: ["phase2FamilyDoctorApplications", "phase2FamilyDoctorContracts", "phase2FamilyDoctorFulfillments"], boundary: "家庭医生签约需实名确认、机构审核和电子签署，当前页面仅展示已返回状态。" },
    { route: "emergency", label: "急救服务", icon: "急救", description: "紧急情况下拨打 120，并向救援人员口头说明健康情况。", collections: [], boundary: "页面不会自动发起急救事件、上传位置或共享健康资料。拨打 120 需由设备和本人再次确认。" },
    { route: "tasks", label: "健康待办", icon: "待办", description: "查看随访、生命周期服务和近期健康提醒。", collections: ["followups", "citizenLifecycleActions"], boundary: "完成、确认或反馈等写入操作必须进入对应业务模块并等待服务端回执。" }
  ]);

  const state = {
    session: null,
    identity: null,
    scope: null,
    data: null,
    sensitive: Core.createSensitiveState(""),
    route: "home",
    messageFilter: "all",
    abortController: null,
    locked: true,
    toastTimer: null
  };

  const elements = {
    app: document.querySelector("#resident-mini-app"),
    content: document.querySelector("#app-content"),
    gate: document.querySelector("#session-gate"),
    gateTitle: document.querySelector("#gate-title"),
    gateMessage: document.querySelector("#gate-message"),
    gateLogin: document.querySelector("#gate-login"),
    platformLabel: document.querySelector("#platform-label"),
    memberSwitcher: document.querySelector("#member-switcher"),
    memberDialog: document.querySelector("#member-dialog"),
    memberList: document.querySelector("#member-list"),
    currentMemberName: document.querySelector("#current-member-name"),
    memberAvatar: document.querySelector("#member-avatar"),
    homeMemberName: document.querySelector("#home-member-name"),
    homeSummary: document.querySelector("#home-summary"),
    metricGrid: document.querySelector("#metric-grid"),
    serviceGrid: document.querySelector("#service-grid"),
    homeTaskList: document.querySelector("#home-task-list"),
    messageList: document.querySelector("#message-list"),
    messageBadge: document.querySelector("#message-badge"),
    profileSession: document.querySelector("#profile-session"),
    largeTextToggle: document.querySelector("#large-text-toggle"),
    contrastToggle: document.querySelector("#contrast-toggle"),
    detailTitle: document.querySelector("#detail-title"),
    detailKicker: document.querySelector("#detail-kicker"),
    detailDescription: document.querySelector("#detail-description"),
    detailSummary: document.querySelector("#detail-summary"),
    detailList: document.querySelector("#detail-list"),
    detailBoundary: document.querySelector("#detail-boundary"),
    toast: document.querySelector("#toast")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "时间待确认";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return Core.chineseBusinessText(value, "时间待确认");
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
    }).format(date);
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 2600);
  }

  function clearLocalSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      // Browsers that block local storage still remain locked.
    }
  }

  function lockApp(title, message, clearSession = false) {
    state.abortController?.abort();
    state.abortController = null;
    state.locked = true;
    state.session = null;
    state.identity = null;
    state.scope = null;
    state.data = null;
    state.sensitive = Core.createSensitiveState("");
    if (clearSession) clearLocalSession();
    elements.gateTitle.textContent = title;
    elements.gateMessage.textContent = message;
    if (!document.documentElement.contains(elements.gateLogin)) {
      document.querySelector(".gate-card")?.append(elements.gateLogin);
    }
    elements.gateLogin.hidden = false;
    elements.gate.hidden = false;
    elements.content.hidden = true;
    elements.app.setAttribute("aria-busy", "false");
  }

  async function fetchJson(url, options = {}) {
    const request = auth?.authFetch || window.fetch.bind(window);
    const response = await request(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(Core.chineseBusinessText(payload.message, "服务暂不可用，请稍后重试"));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function initialize() {
    elements.platformLabel.textContent = `${adapter.platformLabel()} · 居民健康服务`;
    applyPreferences(adapter.getPreferences());
    state.session = auth?.getUser?.() || null;
    const localDecision = Core.isProductionSession(state.session);
    if (!localDecision.ok) {
      const staticMessage = location.protocol === "file:"
        ? "静态文件不承载居民身份和健康数据，请通过本地服务或集成环境安全登录。"
        : localDecision.message;
      lockApp("需要安全登录", staticMessage, Boolean(state.session));
      return;
    }
    state.abortController = new AbortController();
    try {
      const identityPayload = await fetchJson("/api/auth/me", { signal: state.abortController.signal });
      const identityDecision = Core.validateServerIdentity(state.session, identityPayload);
      if (!identityDecision.ok) {
        lockApp("身份核验未通过", identityDecision.message, true);
        return;
      }
      state.identity = identityDecision;
      const [rawState, messagePayload] = await Promise.all([
        fetchJson("/api/state", { signal: state.abortController.signal }),
        fetchJson("/api/messages", { signal: state.abortController.signal })
      ]);
      rawState.taskMessages = Array.isArray(messagePayload.messages) ? messagePayload.messages : [];
      state.scope = Core.deriveResidentScope(rawState, identityDecision.user);
      if (!state.scope.allowedIds.has(identityDecision.user.residentId)) {
        lockApp("居民范围核验失败", "服务端未返回当前居民的可访问范围，已阻断健康数据展示。", true);
        return;
      }
      state.data = Core.projectDataForAllowedResidents(rawState, state.scope);
      state.sensitive = Core.createSensitiveState(identityDecision.user.residentId);
      state.route = Core.routeName(new URLSearchParams(location.search).get("page"));
      state.locked = false;
      elements.gate.hidden = true;
      elements.content.hidden = false;
      elements.app.setAttribute("aria-busy", "false");
      renderAll();
      navigate(state.route, { replace: true });
    } catch (error) {
      if (error.name === "AbortError") return;
      const expired = [401, 403].includes(error.status);
      lockApp(expired ? "登录已失效" : "安全服务暂不可用", expired ? "请重新登录后继续使用居民健康服务。" : "当前无法核验身份或居民范围，已停止展示健康数据。", expired);
    }
  }

  function currentResident() {
    return state.data?.residents?.find((item) => item.id === state.sensitive.residentId) || null;
  }

  function currentRelationship() {
    return state.data?.relationships?.find((item) => item.residentId === state.sensitive.residentId) || null;
  }

  function renderAll() {
    renderMember();
    renderHome();
    renderMessages();
    renderProfile();
    renderMemberDialog();
  }

  function renderMember() {
    const resident = currentResident();
    const relationship = currentRelationship();
    if (!resident) return;
    elements.currentMemberName.textContent = `${resident.name} · ${relationship?.relation || "居民"}`;
    elements.homeMemberName.textContent = resident.name;
    elements.memberAvatar.textContent = resident.name.slice(-1) || "居";
  }

  function metricValue(value, unit, empty = "待更新") {
    return value === null || value === undefined ? empty : `${value}${unit}`;
  }

  function renderHome() {
    const resident = currentResident();
    if (!resident) return;
    const summary = Core.summarizeResident(state.data, resident.id);
    elements.homeSummary.textContent = summary.taskCount
      ? `您有 ${summary.taskCount} 项健康提醒待查看，服务结果均以正式回执为准。`
      : "当前没有新增健康提醒，建议定期查看健康档案。";
    const metrics = [
      { label: "血压", value: resident.metrics.systolic !== null && resident.metrics.diastolic !== null ? `${resident.metrics.systolic}/${resident.metrics.diastolic}` : "待更新", unit: "毫米汞柱" },
      { label: "血糖", value: metricValue(resident.metrics.glucose, ""), unit: "毫摩尔/升" },
      { label: "体重指数", value: metricValue(resident.metrics.bmi, ""), unit: "健康参考" }
    ];
    elements.metricGrid.innerHTML = metrics.map((item) => `
      <article class="metric-card">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
        <small>${escapeHtml(item.unit)}</small>
      </article>
    `).join("");
    elements.serviceGrid.innerHTML = services.map((service) => `
      <button class="service-card" type="button" data-route="${escapeHtml(service.route)}" aria-label="打开${escapeHtml(service.label)}">
        <span class="service-icon" aria-hidden="true">${escapeHtml(service.icon)}</span>
        <strong>${escapeHtml(service.label)}</strong>
      </button>
    `).join("");
    const tasks = currentTasks().slice(0, 3);
    elements.homeTaskList.innerHTML = tasks.length ? tasks.map(taskCard).join("") : emptyState("暂无近期健康待办");
    updateMessageBadge(summary.unreadCount);
  }

  function currentTasks() {
    const residentId = state.sensitive.residentId;
    return [
      ...(state.data?.followups || []),
      ...(state.data?.citizenLifecycleActions || [])
    ]
      .filter((item) => item.residentId === residentId)
      .filter((item) => !/已完成|已关闭/.test(item.status))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function taskCard(item) {
    return `
      <article class="list-card">
        <header>
          <h4>${escapeHtml(item.title)}</h4>
          <span class="list-meta">${escapeHtml(item.status)}</span>
        </header>
        <p>${escapeHtml(item.summary)}</p>
        <p class="eyebrow">${escapeHtml(formatDate(item.date))}</p>
      </article>
    `;
  }

  function emptyState(message) {
    return `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
  }

  function currentMessages() {
    const residentId = state.sensitive.residentId;
    const rows = (state.data?.taskMessages || []).filter((item) => item.residentId === residentId);
    return state.messageFilter === "unread" ? rows.filter((item) => !item.isRead) : rows;
  }

  function renderMessages() {
    const messages = currentMessages();
    elements.messageList.innerHTML = messages.length ? messages.map((message) => `
      <article class="message-card ${message.isRead ? "" : "unread"}" data-message-id="${escapeHtml(message.id)}">
        <header>
          <h3>${escapeHtml(message.title)}</h3>
          <span class="message-status">${escapeHtml(message.isRead ? "已读" : "未读")}</span>
        </header>
        <p>${escapeHtml(message.body)}</p>
        <p class="eyebrow">${escapeHtml(formatDate(message.createdAt, true))}</p>
        <div class="message-actions">
          <button class="message-action primary" type="button" data-message-route="${escapeHtml(message.route)}">查看相关服务</button>
          ${message.isRead ? "" : `<button class="message-action" type="button" data-mark-read="${escapeHtml(message.id)}">标记已读</button>`}
        </div>
      </article>
    `).join("") : emptyState(state.messageFilter === "unread" ? "没有未读消息" : "暂无居民消息");
    updateMessageBadge((state.data?.taskMessages || []).filter((item) => item.residentId === state.sensitive.residentId && !item.isRead).length);
  }

  function updateMessageBadge(count) {
    elements.messageBadge.textContent = String(Math.min(count, 99));
    elements.messageBadge.hidden = count < 1;
  }

  function renderProfile() {
    const resident = currentResident();
    const expiresAt = state.identity?.expiresAt;
    elements.profileSession.textContent = `${resident?.name || "当前居民"}的身份已由服务端核验，本次登录有效期至 ${formatDate(expiresAt, true)}。`;
  }

  function renderMemberDialog() {
    const currentId = state.sensitive.residentId;
    const allowed = (state.data?.relationships || []).map((item) => `
      <button class="member-option" type="button" data-member-id="${escapeHtml(item.residentId)}" aria-current="${item.residentId === currentId}">
        <span class="member-avatar" aria-hidden="true">${escapeHtml(item.name.slice(-1) || "居")}</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.relation)} · ${escapeHtml(item.accessLabel)}</small></span>
        <span>${item.residentId === currentId ? "当前" : "切换"}</span>
      </button>
    `);
    const blocked = (state.data?.blockedRelationships || []).map((item) => `
      <button class="member-option" type="button" disabled aria-disabled="true">
        <span class="member-avatar" aria-hidden="true">家</span>
        <span><strong>${escapeHtml(item.relation)}</strong><small>${escapeHtml(item.accessLabel)}</small></span>
        <span>不可访问</span>
      </button>
    `);
    elements.memberList.innerHTML = [...allowed, ...blocked].join("") || emptyState("当前没有可切换的家庭成员");
  }

  function detailRows(service) {
    const residentId = state.sensitive.residentId;
    const rows = service.collections.flatMap((collection) => {
      const items = Array.isArray(state.data?.[collection]) ? state.data[collection] : [];
      return items.filter((item) => item.residentId === residentId);
    });
    if (service.category) return rows.filter((item) => item.category === service.category);
    return rows;
  }

  function renderDetail(route) {
    const service = services.find((item) => item.route === route) || services[0];
    const rows = detailRows(service);
    elements.detailKicker.textContent = "居民健康服务";
    elements.detailTitle.textContent = service.label;
    elements.detailDescription.textContent = service.description;
    elements.detailSummary.innerHTML = `
      <strong>${escapeHtml(currentResident()?.name || "当前居民")}</strong>
      <p>已按当前居民范围归集 ${rows.length} 条相关记录。</p>
    `;
    if (route === "emergency") {
      elements.detailList.innerHTML = `
        <article class="list-card">
          <header><h4>紧急呼救</h4><span class="list-meta">需本人确认</span></header>
          <p>如遇危及生命的紧急情况，请立即拨打 120，并准确说明所在位置和患者情况。</p>
          <div class="message-actions"><a class="message-action primary" href="tel:120" aria-label="拨打急救电话一二零">拨打 120</a></div>
        </article>
      `;
    } else if (route === "health-record" || route === "emr") {
      elements.detailList.innerHTML = rows.length ? rows.map((item) => `
        <article class="list-card">
          <header><h4>${escapeHtml(item.name)}</h4><span class="list-meta">${escapeHtml(item.status)}</span></header>
          <p>${escapeHtml(item.result)}</p>
          <p class="eyebrow">${escapeHtml(item.source)} · ${escapeHtml(formatDate(item.date))}</p>
        </article>
      `).join("") : emptyState("当前居民暂无相关健康资料");
    } else {
      elements.detailList.innerHTML = rows.length ? rows.map(taskCard).join("") : emptyState(`当前居民暂无${service.label}记录`);
    }
    elements.detailBoundary.textContent = service.boundary;
  }

  function navigate(route, options = {}) {
    if (state.locked) return;
    const safeRoute = Core.routeName(route);
    state.route = safeRoute;
    state.sensitive.route = safeRoute;
    document.querySelectorAll(".app-page").forEach((page) => {
      const pageName = page.dataset.page;
      const visible = safeRoute === pageName || (!["home", "messages", "profile"].includes(safeRoute) && pageName === "detail");
      page.hidden = !visible;
    });
    document.querySelectorAll(".bottom-nav [data-route]").forEach((button) => {
      const current = button.dataset.route === safeRoute;
      if (current) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (!["home", "messages", "profile"].includes(safeRoute)) renderDetail(safeRoute);
    if (!options.replace) adapter.navigate(safeRoute);
    document.querySelector("#app-main")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function switchMember(residentId) {
    state.abortController?.abort();
    state.abortController = new AbortController();
    const decision = Core.switchResident(state.sensitive, residentId, state.scope.allowedIds);
    if (!decision.ok) {
      state.sensitive = decision.state;
      elements.memberDialog.close();
      lockApp("居民范围已阻断", "所选家庭成员不在本次会话可访问范围内，请重新登录或核验家庭关系与授权。", false);
      return;
    }
    state.sensitive = decision.state;
    state.messageFilter = "all";
    renderAll();
    navigate("home");
    elements.memberDialog.close();
    showToast("已切换服务对象，并清除上一居民的临时状态");
  }

  async function markMessageRead(messageId, button) {
    const existing = (state.data?.taskMessages || []).find((item) => item.id === messageId && item.residentId === state.sensitive.residentId);
    if (!existing || existing.isRead) return;
    button.disabled = true;
    button.textContent = "正在等待回执";
    try {
      const payload = await fetchJson(`/api/messages/${encodeURIComponent(messageId)}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "read" }),
        signal: state.abortController?.signal
      });
      const receipt = Core.confirmMessageReceipt(payload, messageId);
      if (!receipt.ok || receipt.message.residentId !== state.sensitive.residentId) throw new Error("服务端回执校验失败");
      state.data.taskMessages = state.data.taskMessages.map((item) => item.id === messageId ? receipt.message : item);
      state.sensitive.pendingAction = null;
      renderMessages();
      renderHome();
      showToast("服务端已确认消息为已读");
    } catch (error) {
      if (error.name === "AbortError") return;
      button.disabled = false;
      button.textContent = "标记已读";
      showToast("未收到有效回执，消息仍保持未读");
    }
  }

  function applyPreferences(preferences = {}) {
    const largeText = Boolean(preferences.largeText);
    const highContrast = Boolean(preferences.highContrast);
    document.body.classList.toggle("large-text", largeText);
    document.body.classList.toggle("high-contrast", highContrast);
    elements.largeTextToggle.checked = largeText;
    elements.contrastToggle.checked = highContrast;
  }

  async function logout() {
    state.abortController?.abort();
    state.data = null;
    state.scope = null;
    state.sensitive = Core.createSensitiveState("");
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } catch (error) {
      // Local credentials are removed even if the remote logout endpoint is unavailable.
    } finally {
      clearLocalSession();
      location.replace("./login.html?loggedOut=1");
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const routeButton = event.target.closest("[data-route]");
      if (routeButton) navigate(routeButton.dataset.route);
      const messageRoute = event.target.closest("[data-message-route]");
      if (messageRoute) navigate(messageRoute.dataset.messageRoute);
      const memberButton = event.target.closest("[data-member-id]");
      if (memberButton) switchMember(memberButton.dataset.memberId);
      const readButton = event.target.closest("[data-mark-read]");
      if (readButton) void markMessageRead(readButton.dataset.markRead, readButton);
    });
    elements.memberSwitcher.addEventListener("click", () => elements.memberDialog.showModal());
    document.querySelector("#detail-back").addEventListener("click", () => navigate("home"));
    document.querySelector("#accessibility-shortcut").addEventListener("click", () => navigate("profile"));
    document.querySelector("#logout-button").addEventListener("click", () => void logout());
    document.querySelectorAll("[data-message-filter]").forEach((button) => button.addEventListener("click", () => {
      state.messageFilter = button.dataset.messageFilter;
      document.querySelectorAll("[data-message-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      renderMessages();
    }));
    elements.largeTextToggle.addEventListener("change", () => {
      adapter.setPreference("largeText", elements.largeTextToggle.checked);
      applyPreferences(adapter.getPreferences());
      showToast(elements.largeTextToggle.checked ? "大字模式已开启" : "大字模式已关闭");
    });
    elements.contrastToggle.addEventListener("change", () => {
      adapter.setPreference("highContrast", elements.contrastToggle.checked);
      applyPreferences(adapter.getPreferences());
      showToast(elements.contrastToggle.checked ? "高对比度已开启" : "高对比度已关闭");
    });
    window.addEventListener("popstate", () => navigate(new URLSearchParams(location.search).get("page"), { replace: true }));
    window.addEventListener("resident-mini-program:navigate", (event) => {
      if (event.detail?.route !== state.route) navigate(event.detail.route, { replace: true });
    });
  }

  function verifySessionStillValid() {
    if (state.locked) return;
    const decision = Core.isProductionSession(state.session);
    if (!decision.ok || new Date(state.identity?.expiresAt || 0).getTime() <= Date.now()) {
      lockApp("登录已过期", "为保护居民健康资料，请重新登录。", true);
    }
  }

  bindEvents();
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date());
  window.ResidentMiniProgramApp = {
    getState: () => ({
      locked: state.locked,
      route: state.route,
      residentId: state.sensitive.residentId,
      allowedResidentIds: [...(state.scope?.allowedIds || [])],
      sensitive: { ...state.sensitive }
    }),
    navigate,
    reinitialize: initialize
  };
  void initialize();
  setInterval(verifySessionStillValid, SESSION_CHECK_INTERVAL);
})();
