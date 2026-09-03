"use strict";

(function initializeAccountLifecycleWorkbench() {
  const core = window.HealthAccountLifecycleCore;
  if (!core) return;
  const auth = window.HealthCityAuth;
  const currentUser = auth?.getUser?.() || {};
  const apiEnabled = location.protocol !== "file:";
  const client = core.createClient({ base: "/api", fetchImpl: (...args) => (auth?.authFetch || fetch)(...args) });
  const state = { accounts: [], requests: [], lifecycle: {}, directoryPlan: null, selectedRequestId: "", requestVersion: 0, source: "loading" };
  const $ = (selector) => document.querySelector(selector);
  const el = (tag, options = {}) => {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.type) node.type = options.type;
    return node;
  };
  const sampleRequests = [core.normalizeRequest({
    id: "ACCOUNT-REQUEST-SAMPLE",
    type: "temporaryGrant",
    accountId: "DEMO-PRIMARY-DOCTOR",
    username: "doctor",
    requesterId: "sample-requester",
    requesterName: "示范机构账号管理员",
    status: "pending-review",
    reason: "临时参与慢病质控数据核验",
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    timeline: [{ at: new Date().toISOString(), actor: "示范机构账号管理员", action: "提交临时授权申请", note: "只读结构示例" }]
  })];

  function setBanner(title, detail, tone = "warning") {
    $("#account-source-title").textContent = title;
    $("#account-source-detail").textContent = detail;
    $("#account-source-banner").dataset.tone = tone;
  }
  function formatTime(value) {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? (value || "-") : date.toLocaleString("zh-CN", { hour12: false });
  }
  function statusLabel(status) {
    return ({ "pending-review": "待复核", pending: "待复核", approved: "已批准", rejected: "已退回", applied: "已执行", failed: "执行失败" })[status] || status;
  }
  function appendMetric(target, label, value, hint) {
    const card = el("article", { className: "work-metric" }); card.append(el("span", { text: label }), el("strong", { text: String(value) }), el("small", { text: hint })); target.append(card);
  }
  function renderMetrics() {
    const target = $("#account-metrics"); target.replaceChildren();
    const active = state.accounts.filter((item) => !["disabled", "inactive", "停用"].includes(String(item.status))).length;
    const pending = state.requests.filter((item) => ["pending-review", "pending", "待复核"].includes(item.status)).length;
    const temporary = state.requests.filter((item) => item.type === "temporaryGrant" && !["rejected", "expired"].includes(item.status)).length;
    const plan = state.directoryPlan?.summary || {};
    appendMetric(target, "账号总数", state.accounts.length, `${active} 个当前可用`);
    appendMetric(target, "待独立复核", pending, "申请人与复核人必须不同");
    appendMetric(target, "临时授权", temporary, "到期后应自动回收");
    appendMetric(target, "目录待绑定", plan.bindingReviews || 0, "不按同名账号自动绑定");
    appendMetric(target, "目录待停用", plan.deactivations || 0, "执行前需强认证与精确确认");
  }
  function accountLabel(account) { return `${account.name || account.displayName || account.username || account.id}（${account.username || account.id}）`; }
  function renderAccountOptions() {
    const select = $("#account-request-form").elements.accountId;
    const current = select.value;
    select.replaceChildren();
    const blank = el("option", { text: "新账号或请选择" }); blank.value = ""; select.append(blank);
    state.accounts.forEach((account) => { const option = el("option", { text: accountLabel(account) }); option.value = account.id || account.accountCode || account.username; select.append(option); });
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }
  function filteredRequests() {
    const keyword = $("#request-keyword").value.trim().toLowerCase();
    const type = $("#request-type-filter").value;
    const status = $("#request-status-filter").value;
    return state.requests.filter((request) => {
      if (type !== "all" && request.type !== type) return false;
      if (status !== "all" && request.status !== status) return false;
      return !keyword || [request.id, request.username, request.accountId, request.requesterName, request.typeLabel].some((value) => String(value || "").toLowerCase().includes(keyword));
    });
  }
  function renderRequests() {
    const requests = filteredRequests();
    const target = $("#request-list"); target.replaceChildren();
    $("#request-summary").textContent = `${requests.length} 项申请`;
    if (!requests.length) { target.append(el("div", { className: "empty-state", text: "当前筛选条件下没有账号申请" })); renderRequestDetail(); return; }
    if (!requests.some((item) => item.id === state.selectedRequestId)) state.selectedRequestId = requests[0].id;
    requests.forEach((request) => {
      const card = el("article", { className: "request-card" }); card.tabIndex = 0; card.dataset.requestId = request.id; card.setAttribute("aria-current", String(request.id === state.selectedRequestId));
      const header = el("header"); header.append(el("h3", { text: `${request.typeLabel} · ${request.username || request.accountId || "待创建账号"}` }), el("span", { className: `status-pill ${request.status === "rejected" ? "danger" : request.status === "approved" || request.status === "applied" ? "success" : "warning"}`, text: statusLabel(request.status) }));
      card.append(header, el("p", { text: `申请人：${request.requesterName} · ${formatTime(request.createdAt)}` }), el("p", { text: request.reason || "未填写申请说明" }));
      target.append(card);
    });
    renderRequestDetail();
  }
  function renderRequestDetail() {
    const target = $("#request-detail"); target.replaceChildren();
    const request = state.requests.find((item) => item.id === state.selectedRequestId);
    if (!request) { target.append(el("div", { className: "empty-state", text: "选择申请后查看审批时间线" })); return; }
    const summary = el("article", { className: "timeline-card" }); summary.append(el("strong", { text: `${request.typeLabel} · ${request.id}` }), el("p", { text: request.reason || "未填写申请说明" }), el("small", { text: `目标账号：${request.username || request.accountId || "待创建"}` })); target.append(summary);
    const timeline = request.timeline.length ? request.timeline : [{ at: request.createdAt, actor: request.requesterName, action: "提交申请", note: request.reason }];
    timeline.forEach((event) => { const card = el("article", { className: "timeline-card" }); card.append(el("strong", { text: event.action || event.status || "状态更新" }), el("p", { text: event.note || "无补充说明" }), el("small", { text: `${event.actor || "系统"} · ${formatTime(event.at)}` })); target.append(card); });
    const review = core.canReview(request, currentUser);
    const actions = el("div", { className: "review-actions" });
    const button = el("button", { className: "primary-work-button", text: "执行独立复核", type: "button" }); button.dataset.reviewRequest = request.id; button.disabled = !review.allowed || !apiEnabled; button.title = review.allowed ? "" : review.reason; actions.append(button); target.append(actions);
    if (!review.allowed) target.append(el("small", { text: review.reason }));
  }
  function renderDirectory() {
    const target = $("#directory-list"); target.replaceChildren();
    const items = state.directoryPlan?.items || [];
    const summary = state.directoryPlan?.summary || {};
    $("#directory-summary").textContent = state.directoryPlan ? `${items.length} 项差异 · ${summary.deactivations || 0} 项待停用` : "尚未预检";
    $("#directory-apply").disabled = !apiEnabled || !state.directoryPlan || !(summary.deactivations > 0);
    if (!items.length) { target.append(el("div", { className: "empty-state", text: state.directoryPlan ? "目录与本地账号当前没有待处理差异" : "运行身份目录预检后显示绑定、停用和人工复核事项。" })); return; }
    items.forEach((item) => {
      const card = el("article", { className: "directory-card" });
      card.append(el("strong", { text: item.displayName || item.username || "未命名目录账号" }), el("p", { text: `${item.username || "-"} · ${item.orgCode || "机构待映射"}` }), el("small", { text: `计划动作：${item.action || "review"} · 本地状态：${item.localStatus || "未绑定"}` }));
      if (item.action === "controlled-binding-required" && item.localUserId && item.externalSubject && item.remoteActive) {
        const button = el("button", { className: "secondary-work-button", text: "受控绑定", type: "button" }); button.dataset.directoryBind = "true"; button.dataset.localUserId = item.localUserId; button.dataset.externalSubject = item.externalSubject; card.append(button);
      }
      target.append(card);
    });
  }
  function render() { renderMetrics(); renderAccountOptions(); renderRequests(); renderDirectory(); }

  async function load() {
    $("#account-refresh").disabled = true;
    setBanner("正在读取账号治理数据", "正在加载账号、身份适配状态和审批记录。", "warning");
    const localAccounts = auth?.demoUsers || [];
    if (!apiEnabled) {
      state.accounts = localAccounts; state.requests = sampleRequests; state.source = "fallback";
      setBanner("当前显示只读结构示例", "静态预览未连接账号治理服务，提交和复核不会在本地伪造成功。", "danger");
      $("#account-refresh").disabled = false; render(); return;
    }
    const [lifecycleResult, stateResult, requestResult] = await Promise.allSettled([client.lifecycle(), client.state(), client.listRequests()]);
    if (lifecycleResult.status === "fulfilled") state.lifecycle = lifecycleResult.value;
    if (requestResult.status === "fulfilled") {
      state.accounts = requestResult.value.accounts || (stateResult.status === "fulfilled" ? stateResult.value.authUsers || stateResult.value.state?.authUsers : localAccounts) || localAccounts;
      state.requests = (requestResult.value.requests || []).map(core.normalizeRequest);
      state.requestVersion = Number(requestResult.value.collectionVersion || 0);
    }
    else state.requests = sampleRequests;
    if (requestResult.status !== "fulfilled") state.accounts = stateResult.status === "fulfilled" ? stateResult.value.authUsers || stateResult.value.state?.authUsers || localAccounts : localAccounts;
    state.source = requestResult.status === "fulfilled" ? "api" : "partial";
    const unavailable = [lifecycleResult, stateResult, requestResult].filter((item) => item.status === "rejected").length;
    setBanner(unavailable ? "账号治理服务部分可用" : "账号治理数据已连接", unavailable ? `${unavailable} 项数据源未就绪；只读示例已明确标识，任何提交仍以服务端回执为准。` : `最近刷新：${new Date().toLocaleString("zh-CN", { hour12: false })}。`, unavailable ? "warning" : "normal");
    $("#account-refresh").disabled = false; render();
  }

  function formValues(form) { return Object.fromEntries(new FormData(form)); }
  function showErrors(selector, message) { const target = $(selector); target.textContent = message; target.hidden = !message; }
  function requestConflicts() {
    const form = $("#account-request-form");
    const conflicts = core.checkConflicts(formValues(form), state.accounts, currentUser);
    const list = $("#conflict-list"); list.replaceChildren();
    conflicts.forEach((conflict) => list.append(el("li", { text: conflict.message }))); list.hidden = !conflicts.length;
    $("#conflict-result").textContent = conflicts.length ? `发现 ${conflicts.length} 项冲突` : "未发现已知职责冲突";
    return conflicts;
  }
  function openRequestDialog() { const form = $("#account-request-form"); form.reset(); showErrors("#account-request-errors", ""); $("#conflict-list").replaceChildren(); $("#conflict-list").hidden = true; $("#conflict-result").textContent = ""; $("#account-request-dialog").showModal(); }
  function openReviewDialog(id) { const request = state.requests.find((item) => item.id === id); const decision = core.canReview(request, currentUser); if (!decision.allowed) { setBanner("无法执行复核", decision.reason, "danger"); return; } const form = $("#account-review-form"); form.reset(); form.elements.requestId.value = id; showErrors("#account-review-errors", ""); $("#account-review-dialog").showModal(); }
  function openDirectoryDialog(action, item = {}) { const form = $("#directory-action-form"); form.reset(); form.elements.action.value = action; form.elements.localUserId.value = item.localUserId || ""; form.elements.externalSubject.value = item.externalSubject || ""; $("#directory-action-title").textContent = action === "bind" ? "受控绑定外部身份" : "执行目录停用同步"; form.elements.confirmation.placeholder = action === "bind" ? "BIND EXTERNAL IDENTITY" : "APPLY IDENTITY DIRECTORY DEACTIVATIONS"; showErrors("#directory-action-errors", ""); $("#directory-action-dialog").showModal(); }

  $("#new-account-request").addEventListener("click", openRequestDialog);
  $("#account-refresh").addEventListener("click", load);
  $("#conflict-check").addEventListener("click", requestConflicts);
  $("#account-request-form").elements.accountId.addEventListener("change", (event) => { const account = state.accounts.find((item) => [item.id, item.accountCode, item.username].includes(event.target.value)); if (!account) return; const form = $("#account-request-form"); form.elements.username.value = account.username || ""; form.elements.displayName.value = account.name || account.displayName || ""; form.elements.role.value = account.role || "commission"; form.elements.orgCode.value = account.orgCode || ""; });
  $("#account-request-form").addEventListener("submit", async (event) => {
    event.preventDefault(); showErrors("#account-request-errors", ""); const button = $("#account-request-submit");
    try {
      const payload = { ...core.buildRequest(formValues(event.currentTarget), currentUser, state.accounts), expectedVersion: state.requestVersion }; button.disabled = true;
      await client.submit(payload); $("#account-request-dialog").close(); setBanner("账号申请已由服务端受理", "申请进入独立复核队列，正在刷新审批状态。", "normal"); await load();
    } catch (error) { showErrors("#account-request-errors", error.message || "账号申请提交失败"); setBanner("账号申请未提交", "服务端没有返回成功回执，页面未生成本地审批记录。", "danger"); }
    finally { button.disabled = false; }
  });
  ["#request-keyword", "#request-type-filter", "#request-status-filter"].forEach((selector) => $(selector).addEventListener(selector === "#request-keyword" ? "input" : "change", renderRequests));
  $("#request-list").addEventListener("click", (event) => { const card = event.target.closest("[data-request-id]"); if (!card) return; state.selectedRequestId = card.dataset.requestId; renderRequests(); });
  $("#request-list").addEventListener("keydown", (event) => { if (!["Enter", " "].includes(event.key)) return; const card = event.target.closest("[data-request-id]"); if (!card) return; event.preventDefault(); state.selectedRequestId = card.dataset.requestId; renderRequests(); });
  $("#request-detail").addEventListener("click", (event) => { const button = event.target.closest("[data-review-request]"); if (button) openReviewDialog(button.dataset.reviewRequest); });
  $("#account-review-form").addEventListener("submit", async (event) => { event.preventDefault(); const values = formValues(event.currentTarget); if (values.note.trim().length < 8) { showErrors("#account-review-errors", "复核意见至少填写 8 个字符"); return; } const request = state.requests.find((item) => item.id === values.requestId); const button = $("#account-review-submit"); button.disabled = true; try { await client.review(values.requestId, { decision: values.decision, note: values.note, expectedVersion: Number(request?.version || 0) }); $("#account-review-dialog").close(); setBanner("复核结论已由服务端受理", "正在刷新审批时间线。", "normal"); await load(); } catch (error) { showErrors("#account-review-errors", error.message || "复核提交失败"); setBanner("复核未完成", "服务端没有返回成功回执，申请状态保持不变。", "danger"); } finally { button.disabled = false; } });
  $("#directory-preview").addEventListener("click", async () => { const button = $("#directory-preview"); button.disabled = true; try { const payload = await client.directoryPreview(); state.directoryPlan = payload.plan || null; setBanner("目录预检已完成", "预检仅生成差异计划，未修改任何账号。", "normal"); render(); } catch (error) { setBanner("目录预检失败", error.message || "身份目录服务不可用。", "danger"); } finally { button.disabled = false; } });
  $("#directory-list").addEventListener("click", (event) => { const button = event.target.closest("[data-directory-bind]"); if (button) openDirectoryDialog("bind", button.dataset); });
  $("#directory-apply").addEventListener("click", () => openDirectoryDialog("apply"));
  $("#directory-action-form").addEventListener("submit", async (event) => { event.preventDefault(); const values = formValues(event.currentTarget); const expected = values.action === "bind" ? "BIND EXTERNAL IDENTITY" : "APPLY IDENTITY DIRECTORY DEACTIVATIONS"; if (values.note.trim().length < 8 || values.confirmation !== expected) { showErrors("#directory-action-errors", `审计说明至少 8 个字符，并准确输入确认短语：${expected}`); return; } const button = $("#directory-action-submit"); button.disabled = true; try { const payload = values.action === "bind" ? await client.directoryBind({ localUserId: values.localUserId, externalSubject: values.externalSubject, note: values.note, confirmation: values.confirmation }) : await client.directoryApply({ note: values.note, confirmation: values.confirmation }); state.directoryPlan = payload.plan || state.directoryPlan; $("#directory-action-dialog").close(); setBanner("身份目录操作已由服务端受理", "服务端安全校验与审计写入均已返回成功，正在刷新差异计划。", "normal"); render(); } catch (error) { showErrors("#directory-action-errors", error.message || "身份目录操作失败"); setBanner("身份目录操作未完成", "服务端未返回成功回执，页面没有修改账号状态。", "danger"); } finally { button.disabled = false; } });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  load();
})();
