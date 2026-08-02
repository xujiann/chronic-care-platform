(function () {
  "use strict";

  const Core = window.ResidentMiniProgramCore;
  const adapter = window.ResidentMiniProgramAdapter.createAdapter(window);
  const auth = window.HealthCityAuth;
  const SESSION_KEY = "health-city-auth-session";
  const SESSION_CHECK_INTERVAL = 30 * 1000;
  const configuredTimeout = Number(window.__RESIDENT_MINI_PROGRAM_TIMEOUT_MS__ || 8000);
  const REQUEST_TIMEOUT_MS = Math.max(200, Math.min(Number.isFinite(configuredTimeout) ? configuredTimeout : 8000, 15000));

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
    subjectKey: "",
    scope: null,
    data: null,
    sensitive: Core.createSensitiveState(""),
    route: "home",
    messageFilter: "all",
    messageVisibleLimit: Core.DEFAULT_MESSAGE_PAGE_SIZE,
    pendingReadIds: new Set(),
    abortController: null,
    recoveryGeneration: 0,
    locked: true,
    suspended: false,
    initialized: false,
    networkState: "idle",
    toastTimer: null
  };

  const elements = {
    app: document.querySelector("#resident-mini-app"),
    content: document.querySelector("#app-content"),
    gate: document.querySelector("#session-gate"),
    gateStateLabel: document.querySelector("#gate-state-label"),
    gateTitle: document.querySelector("#gate-title"),
    gateMessage: document.querySelector("#gate-message"),
    gateRetry: document.querySelector("#gate-retry"),
    gateLogin: document.querySelector("#gate-login"),
    loadingSkeleton: document.querySelector("#loading-skeleton"),
    connectionBanner: document.querySelector("#connection-banner"),
    connectionMessage: document.querySelector("#connection-message"),
    platformLabel: document.querySelector("#platform-label"),
    platformCapabilityStatus: document.querySelector("#platform-capability-status"),
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
    messageSummary: document.querySelector("#message-summary"),
    messageLoadMore: document.querySelector("#message-load-more"),
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
    toast: document.querySelector("#toast"),
    announcer: document.querySelector("#screen-reader-announcer")
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

  function announce(message) {
    elements.announcer.textContent = "";
    window.setTimeout(() => {
      elements.announcer.textContent = message;
    }, 20);
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    announce(message);
    state.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 2800);
  }

  function focusElement(element) {
    if (!element) return;
    element.setAttribute("tabindex", "-1");
    element.focus({ preventScroll: true });
  }

  function clearLocalSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      // Storage restrictions do not weaken the locked state.
    }
  }

  function clearResidentRuntime() {
    state.abortController?.abort();
    state.abortController = null;
    state.scope = null;
    state.data = null;
    state.identity = null;
    state.sensitive = Core.createSensitiveState("");
    state.route = "home";
    state.messageFilter = "all";
    state.messageVisibleLimit = Core.DEFAULT_MESSAGE_PAGE_SIZE;
    state.pendingReadIds.clear();
  }

  function renderGate(kind, title, message, options = {}) {
    state.locked = true;
    state.networkState = kind;
    elements.gateStateLabel.textContent = options.label || (
      kind === "loading" ? "安全连接" :
        kind === "offline" ? "网络状态" :
          kind === "paused" ? "隐私保护" : "访问受限"
    );
    elements.gateTitle.textContent = title;
    elements.gateMessage.textContent = message;
    elements.loadingSkeleton.hidden = kind !== "loading";
    elements.gateRetry.hidden = !options.retry;
    elements.gateLogin.hidden = !options.login;
    if (!document.documentElement.contains(elements.gateLogin)) document.querySelector(".gate-actions")?.append(elements.gateLogin);
    elements.gate.hidden = false;
    elements.content.hidden = true;
    elements.app.setAttribute("aria-busy", String(kind === "loading"));
    if (kind !== "loading") focusElement(elements.gateTitle);
    announce(`${title}。${message}`);
  }

  function lockApp(kind, title, message, options = {}) {
    clearResidentRuntime();
    if (options.clearSession) {
      clearLocalSession();
      state.session = null;
      state.subjectKey = "";
    }
    renderGate(kind, title, message, options);
  }

  function requestError(kind, message, status = 0) {
    const error = new Error(message);
    error.kind = kind;
    error.status = status;
    return error;
  }

  async function fetchJson(url, options = {}) {
    if (navigator.onLine === false) throw requestError("offline", "当前网络不可用");
    const request = auth?.authFetch || window.fetch.bind(window);
    const controller = new AbortController();
    const parentSignal = options.signal;
    let timedOut = false;
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener?.("abort", abortFromParent, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await request(url, { ...options, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = Core.chineseBusinessText(payload.message, response.status === 401 ? "登录已失效" : "服务暂不可用，请稍后重试");
        throw requestError([401, 403].includes(response.status) ? "auth" : "service", message, response.status);
      }
      return payload;
    } catch (error) {
      if (error.kind) throw error;
      if (timedOut) throw requestError("timeout", "连接超时，请重新加载");
      if (parentSignal?.aborted) throw requestError("cancelled", "本次加载已取消");
      if (navigator.onLine === false) throw requestError("offline", "当前网络不可用");
      throw requestError("network", "网络连接失败，请重新加载");
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", abortFromParent);
    }
  }

  function recoveryFailure(error) {
    if (error.kind === "cancelled") return;
    if (error.kind === "auth") {
      lockApp("auth", "登录已失效", "请重新安全登录后继续使用居民健康服务。", { login: true, clearSession: true });
      return;
    }
    if (error.kind === "offline") {
      lockApp("offline", "当前网络不可用", "未加载任何缓存健康资料。恢复网络后可重新加载。", { retry: true });
      return;
    }
    if (error.kind === "timeout") {
      lockApp("timeout", "安全连接超时", "未收到服务端响应，当前不会展示缓存或本地办理结果。", { retry: true });
      return;
    }
    lockApp("error", "居民服务暂不可用", "身份或居民范围未能完成核验，已停止展示健康资料。", { retry: true });
  }

  function currentNavigationContext(residentId = state.sensitive.residentId) {
    return {
      residentId,
      allowedResidentIds: state.scope?.allowedIds || new Set(),
      messages: state.data?.taskMessages || []
    };
  }

  async function recover(reason = "startup") {
    const generation = ++state.recoveryGeneration;
    const previousSubjectKey = state.subjectKey;
    const wasInitialized = state.initialized;
    clearResidentRuntime();
    state.suspended = false;
    renderGate("loading", reason === "foreground" ? "正在恢复安全会话" : "正在核验安全登录", "正在向服务端确认居民身份、访问范围和最新消息，请稍候。");

    const session = auth?.getUser?.() || null;
    const localDecision = Core.isProductionSession(session);
    if (!localDecision.ok) {
      const staticMessage = location.protocol === "file:"
        ? "静态文件不承载居民身份和健康数据，请通过本地服务或集成环境安全登录。"
        : localDecision.message;
      lockApp("auth", "需要安全登录", staticMessage, { login: true, clearSession: Boolean(session) });
      return;
    }
    const localSubjectKey = Core.sessionSubjectKey(session);
    if (previousSubjectKey && localSubjectKey !== previousSubjectKey) {
      lockApp("auth", "登录主体发生变化", "为防止跨居民展示，已清空上一居民状态，请重新登录。", { login: true, clearSession: true });
      return;
    }

    state.session = session;
    state.abortController = new AbortController();
    try {
      const identityPayload = await fetchJson("/api/auth/me", { signal: state.abortController.signal });
      if (generation !== state.recoveryGeneration) return;
      const identityDecision = Core.validateServerIdentity(session, identityPayload);
      if (!identityDecision.ok) {
        lockApp("auth", "身份核验未通过", identityDecision.message, { login: true, clearSession: true });
        return;
      }
      const serverSubjectKey = Core.sessionSubjectKey(identityDecision.user);
      if (previousSubjectKey && serverSubjectKey !== previousSubjectKey) {
        lockApp("auth", "登录主体发生变化", "为防止跨居民展示，已清空上一居民状态，请重新登录。", { login: true, clearSession: true });
        return;
      }
      const [rawState, messagePayload] = await Promise.all([
        fetchJson("/api/state", { signal: state.abortController.signal }),
        fetchJson("/api/messages", { signal: state.abortController.signal })
      ]);
      if (generation !== state.recoveryGeneration) return;
      rawState.taskMessages = Array.isArray(messagePayload.messages) ? messagePayload.messages : [];
      const scope = Core.deriveResidentScope(rawState, identityDecision.user);
      if (!scope.allowedIds.has(identityDecision.user.residentId)) {
        lockApp("auth", "居民范围核验失败", "服务端未返回当前居民的可访问范围，已阻断健康数据展示。", { login: true, clearSession: true });
        return;
      }
      state.identity = identityDecision;
      state.subjectKey = serverSubjectKey;
      state.scope = scope;
      state.data = Core.projectDataForAllowedResidents(rawState, scope);
      state.sensitive = Core.createSensitiveState(identityDecision.user.residentId);
      state.locked = false;
      state.initialized = true;
      state.networkState = "online";
      elements.gate.hidden = true;
      elements.content.hidden = false;
      elements.app.setAttribute("aria-busy", "false");
      renderAll();
      const requested = wasInitialized
        ? { page: "home" }
        : Object.fromEntries(new URLSearchParams(location.search));
      const decision = Core.validateDeepLink(requested, currentNavigationContext());
      navigateDecision(decision.ok ? decision : { ok: true, route: "home", params: {} }, { replace: true });
      if (!decision.ok && Object.keys(requested).length) showToast("已阻止不安全或越权的页面链接");
      announce(`${currentResident()?.name || "当前居民"}的健康服务已安全加载`);
    } catch (error) {
      if (generation !== state.recoveryGeneration) return;
      recoveryFailure(error);
    }
  }

  function suspend(reason = "background") {
    if (state.suspended) return;
    state.suspended = true;
    ++state.recoveryGeneration;
    clearResidentRuntime();
    renderGate("paused", reason === "offline" ? "网络连接已断开" : "应用已进入后台", "已清空当前居民的详情、筛选和临时状态；返回应用时将重新核验。", {
      retry: reason === "offline"
    });
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
    updateMessageBadge(Core.countUnreadMessages(state.data?.taskMessages, resident.id));
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

  function messageBatch() {
    const residentId = state.sensitive.residentId;
    const batch = Core.buildMessageBatch(state.data?.taskMessages || [], residentId, {
      limit: Core.MAX_MESSAGE_BATCH
    });
    const filtered = state.messageFilter === "unread" ? batch.items.filter((item) => item.isUnread) : batch.items;
    return {
      ...batch,
      filtered,
      visible: filtered.slice(0, state.messageVisibleLimit)
    };
  }

  function renderMessages() {
    const batch = messageBatch();
    elements.messageSummary.textContent = `共 ${batch.filtered.length} 条，未读 ${batch.unreadCount} 条，已过期 ${batch.expiredCount} 条。`;
    elements.messageList.innerHTML = batch.visible.length ? batch.visible.map((message) => `
      <article class="message-card ${message.isUnread ? "unread" : ""}" data-message-id="${escapeHtml(message.id)}">
        <header>
          <h3>${escapeHtml(message.title)}</h3>
          <span class="message-status">${escapeHtml(message.expired ? "已过期" : message.isRead ? "已读" : "未读")}</span>
        </header>
        <p>${escapeHtml(message.body)}</p>
        <p class="eyebrow">${escapeHtml(formatDate(message.createdAt, true))}</p>
        ${message.expired ? "<p>此消息已过期，不再提供业务跳转。</p>" : `
          <div class="message-actions">
            <button class="message-action primary" type="button" data-message-link="${escapeHtml(message.id)}">查看相关服务</button>
            ${message.isRead ? "" : `<button class="message-action" type="button" data-mark-read="${escapeHtml(message.id)}" ${state.pendingReadIds.has(message.id) ? "disabled" : ""}>${state.pendingReadIds.has(message.id) ? "正在等待回执" : "标记已读"}</button>`}
          </div>
        `}
      </article>
    `).join("") : emptyState(state.messageFilter === "unread" ? "没有未读消息" : "暂无居民消息");
    elements.messageLoadMore.hidden = batch.visible.length >= batch.filtered.length;
    updateMessageBadge(batch.unreadCount);
  }

  function updateMessageBadge(count) {
    elements.messageBadge.textContent = String(Math.min(count, 99));
    elements.messageBadge.hidden = count < 1;
  }

  function renderProfile() {
    const resident = currentResident();
    elements.profileSession.textContent = `${resident?.name || "当前居民"}的身份已由服务端核验，本次登录有效期至 ${formatDate(state.identity?.expiresAt, true)}。`;
    const capabilities = adapter.probeCapabilities();
    elements.platformCapabilityStatus.textContent = [
      `当前环境：${adapter.platformLabel()}`,
      `页面导航：${capabilities.navigation ? "可用" : "不可用"}`,
      `平台拨号：${capabilities.phoneCall ? "可用" : "使用设备拨号"}`,
      `前后台恢复：${capabilities.lifecycle ? "可用" : "使用页面恢复"}`
    ].join("；");
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
      const callControl = adapter.runtime === "web"
        ? `<a class="message-action primary" href="tel:120" aria-label="拨打急救电话一二零">拨打 120</a>`
        : `<button class="message-action primary" type="button" data-emergency-call>拨打 120</button>`;
      elements.detailList.innerHTML = `
        <article class="list-card">
          <header><h4>紧急呼救</h4><span class="list-meta">需本人确认</span></header>
          <p>如遇危及生命的紧急情况，请立即拨打 120，并准确说明所在位置和患者情况。</p>
          <div class="message-actions">${callControl}</div>
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

  function navigateDecision(decision, options = {}) {
    if (state.locked || !decision?.ok) return false;
    const safeRoute = decision.route;
    state.route = safeRoute;
    state.sensitive.route = safeRoute;
    state.sensitive.selectedMessageId = decision.params?.messageId || "";
    state.sensitive.selectedRecordId = decision.params?.recordId || "";
    document.querySelectorAll(".app-page").forEach((page) => {
      const pageName = page.dataset.page;
      const visible = safeRoute === pageName || (!["home", "messages", "profile"].includes(safeRoute) && pageName === "detail");
      page.hidden = !visible;
    });
    document.querySelectorAll(".bottom-nav [data-route]").forEach((button) => {
      if (button.dataset.route === safeRoute) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (!["home", "messages", "profile"].includes(safeRoute)) renderDetail(safeRoute);
    if (!options.replace) {
      void adapter.navigate(safeRoute, decision.params || {}).then((result) => {
        if (!result.ok && result.status !== "unsupported") showToast(result.message);
      });
    }
    const heading = safeRoute === "home"
      ? document.querySelector("#home-title")
      : safeRoute === "messages"
        ? document.querySelector("#messages-title")
        : safeRoute === "profile"
          ? document.querySelector("#profile-title")
          : elements.detailTitle;
    focusElement(heading);
    window.scrollTo({ top: 0, behavior: "auto" });
    announce(`${heading?.textContent || "页面"}已打开`);
    return true;
  }

  function navigate(input, options = {}) {
    const candidate = typeof input === "string" ? { page: input } : input;
    const decision = Core.validateDeepLink(candidate, currentNavigationContext());
    if (!decision.ok) {
      showToast("已阻止不安全或越权的页面跳转");
      return false;
    }
    return navigateDecision(decision, options);
  }

  function switchMember(residentId) {
    state.abortController?.abort();
    state.abortController = new AbortController();
    const decision = Core.switchResident(state.sensitive, residentId, state.scope.allowedIds);
    if (!decision.ok) {
      elements.memberDialog.close();
      lockApp("auth", "居民范围已阻断", "所选家庭成员不在本次会话可访问范围内，请重新登录或核验家庭关系与授权。", { login: true });
      return;
    }
    state.sensitive = decision.state;
    state.messageFilter = "all";
    state.messageVisibleLimit = Core.DEFAULT_MESSAGE_PAGE_SIZE;
    state.pendingReadIds.clear();
    renderAll();
    navigate("home");
    elements.memberDialog.close();
    showToast("已切换服务对象，并清除上一居民的临时状态");
  }

  async function markMessageRead(messageId) {
    const existing = (state.data?.taskMessages || []).find((item) => item.id === messageId && item.residentId === state.sensitive.residentId);
    const intent = Core.messageReadIntent(existing, state.sensitive.residentId);
    if (!intent.ok || state.pendingReadIds.has(messageId)) {
      showToast("当前消息不可标记已读");
      return;
    }
    if (existing.isRead) {
      showToast("服务端已确认该消息为已读");
      return;
    }
    const snapshot = existing;
    state.pendingReadIds.add(messageId);
    renderMessages();
    try {
      const payload = await fetchJson(`/api/messages/${encodeURIComponent(intent.messageId)}/receipt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": intent.idempotencyKey
        },
        body: JSON.stringify({ status: intent.status }),
        signal: state.abortController?.signal
      });
      const receipt = Core.confirmMessageReceipt(payload, messageId, {
        residentId: intent.residentId,
        currentMessage: existing
      });
      if (!receipt.ok || !receipt.message || receipt.message.residentId !== state.sensitive.residentId) {
        throw requestError("service", "服务端回执校验失败");
      }
      state.data.taskMessages = state.data.taskMessages.map((item) => item.id === messageId ? receipt.message : item);
      showToast(receipt.idempotent ? "服务端已确认该消息为已读" : "服务端已确认消息为已读");
    } catch (error) {
      if (error.kind === "cancelled") return;
      state.data.taskMessages = state.data.taskMessages.map((item) => item.id === messageId ? snapshot : item);
      showToast(error.kind === "timeout" ? "回执等待超时，消息仍保持未读" : "未收到有效回执，消息仍保持未读");
    } finally {
      state.pendingReadIds.delete(messageId);
      if (state.data) {
        renderMessages();
        renderHome();
      }
    }
  }

  function openMessageLink(messageId) {
    const message = (state.data?.taskMessages || []).find((item) => item.id === messageId);
    const decision = Core.messageDeepLink(message, currentNavigationContext());
    if (!decision.ok) {
      showToast("该消息已过期或不属于当前居民，已阻止跳转");
      return;
    }
    navigateDecision(decision);
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
    ++state.recoveryGeneration;
    clearResidentRuntime();
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } catch (error) {
      // Local credentials are removed even when remote logout is unavailable.
    } finally {
      clearLocalSession();
      state.subjectKey = "";
      location.replace("./login.html?loggedOut=1");
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const routeButton = event.target.closest("[data-route]");
      if (routeButton) navigate(routeButton.dataset.route);
      const messageLink = event.target.closest("[data-message-link]");
      if (messageLink) openMessageLink(messageLink.dataset.messageLink);
      const memberButton = event.target.closest("[data-member-id]");
      if (memberButton) switchMember(memberButton.dataset.memberId);
      const readButton = event.target.closest("[data-mark-read]");
      if (readButton) void markMessageRead(readButton.dataset.markRead);
      const emergencyButton = event.target.closest("[data-emergency-call]");
      if (emergencyButton) {
        emergencyButton.disabled = true;
        void adapter.makeEmergencyCall({ timeoutMs: 5000 }).then((result) => {
          emergencyButton.disabled = false;
          showToast(result.message);
        });
      }
    });
    elements.memberSwitcher.addEventListener("click", () => elements.memberDialog.showModal());
    document.querySelector("#detail-back").addEventListener("click", () => navigate("home"));
    document.querySelector("#accessibility-shortcut").addEventListener("click", () => navigate("profile"));
    document.querySelector("#logout-button").addEventListener("click", () => void logout());
    elements.gateRetry.addEventListener("click", () => void recover("retry"));
    elements.messageLoadMore.addEventListener("click", () => {
      state.messageVisibleLimit = Math.min(state.messageVisibleLimit + Core.DEFAULT_MESSAGE_PAGE_SIZE, Core.MAX_MESSAGE_BATCH);
      renderMessages();
      announce(`已显示 ${messageBatch().visible.length} 条消息`);
    });
    document.querySelectorAll("[data-message-filter]").forEach((button) => button.addEventListener("click", () => {
      state.messageFilter = button.dataset.messageFilter;
      state.messageVisibleLimit = Core.DEFAULT_MESSAGE_PAGE_SIZE;
      document.querySelectorAll("[data-message-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      renderMessages();
      focusElement(elements.messageSummary);
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
    window.addEventListener("popstate", () => {
      const decision = Core.validateDeepLink(Object.fromEntries(new URLSearchParams(location.search)), currentNavigationContext());
      if (decision.ok) navigateDecision(decision, { replace: true });
      else navigate("home", { replace: true });
    });
    window.addEventListener("resident-mini-program:navigate", (event) => {
      if (event.detail?.route !== state.route) navigate({ page: event.detail.route, ...(event.detail.params || {}) }, { replace: true });
    });
    window.addEventListener("offline", () => suspend("offline"));
    window.addEventListener("online", () => {
      if (state.suspended || state.networkState === "offline" || state.networkState === "paused") void recover("retry");
    });
    adapter.onLifecycle((phase) => {
      if (phase === "background") suspend("background");
      else if (state.initialized && state.suspended) void recover("foreground");
    });
  }

  function verifySessionStillValid() {
    if (state.locked || state.suspended) return;
    const latest = auth?.getUser?.() || null;
    const decision = Core.isProductionSession(latest);
    if (!decision.ok || Core.sessionSubjectKey(latest) !== state.subjectKey || new Date(state.identity?.expiresAt || 0).getTime() <= Date.now()) {
      lockApp("auth", "登录已过期或主体变化", "为保护居民健康资料，已清空当前页面，请重新登录。", { login: true, clearSession: true });
    }
  }

  bindEvents();
  applyPreferences(adapter.getPreferences());
  elements.platformLabel.textContent = `${adapter.platformLabel()} · 居民健康服务`;
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date());
  window.ResidentMiniProgramApp = {
    getState: () => ({
      locked: state.locked,
      suspended: state.suspended,
      networkState: state.networkState,
      route: state.route,
      residentId: state.sensitive.residentId,
      allowedResidentIds: [...(state.scope?.allowedIds || [])],
      unreadCount: state.data ? Core.countUnreadMessages(state.data.taskMessages, state.sensitive.residentId) : 0,
      sensitive: { ...state.sensitive }
    }),
    navigate,
    recover: () => recover("manual")
  };
  void recover("startup");
  setInterval(verifySessionStillValid, SESSION_CHECK_INTERVAL);
})();
