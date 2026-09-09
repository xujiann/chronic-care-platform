"use strict";

(function exposeCitizenServiceFeedback(root, factory) {
  const api = Object.freeze(factory(root));
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CitizenServiceFeedback = api;
})(typeof window !== "undefined" ? window : globalThis, function createCitizenServiceFeedback(root) {
  const supportedCollections = new Set(["escortServiceOrders", "internetNursingOrders"]);
  const eligibleStatuses = new Set(["completed", "quality-review", "closed"]);
  const satisfactionOptions = new Set(["非常满意", "满意", "一般", "不满意", "非常不满意"]);

  function taskStatus(item) {
    return String(item?.rawStatus || item?.status || "").trim();
  }

  function hasSubmittedFeedback(item) {
    return item?.taskAction === "quality-feedback"
      || item?.qualityReview === "citizen-feedback"
      || item?.qualityCallback === "citizen-feedback";
  }

  function satisfactionLabel(value) {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    if (typeof value.label === "string") return value.label.trim();
    const score = Number(value.score);
    if (Number.isFinite(score) && score > 0) return `${score} 分`;
    return typeof value.status === "string" ? value.status.trim() : "";
  }

  function complaintScopeIsValid(item, complaint) {
    if (!complaint || typeof complaint !== "object" || Array.isArray(complaint)) return false;
    const domain = String(complaint.domain || "").trim();
    const expectedDomain = { internetNursingOrders: "nursing", escortServiceOrders: "escort" }[String(item?.sourceCollection || item?.collection || "").trim()];
    if (!["nursing", "escort"].includes(domain) || (expectedDomain && domain !== expectedDomain)) return false;
    if (!["low", "medium", "high", "critical"].includes(String(complaint.severity || "").trim())) return false;
    const sourceId = serviceOrderSourceId(item);
    if (!sourceId || String(complaint.orderId || "").trim() !== sourceId) return false;
    const residentId = String(item?.residentId || "").trim();
    return Boolean(residentId) && String(complaint.residentId || "").trim() === residentId;
  }

  function hasComplaintClosureEvidence(item) {
    const complaint = item?.complaint;
    if (!complaint || typeof complaint !== "object" || Array.isArray(complaint)) return false;
    const flatStatus = String(item?.complaintStatus || "").trim().toLowerCase();
    const nestedStatus = String(complaint.status || "").trim().toLowerCase();
    if (!["closed", "resolved"].includes(flatStatus) || !["closed", "resolved"].includes(nestedStatus)) return false;
    if (!complaintScopeIsValid(item, complaint)) return false;
    const required = [
      "id", "orderId", "domain", "residentId", "severity", "category", "description", "ownerId",
      "submittedAt", "acknowledgedAt", "dueAt", "resolution", "resolvedBy", "resolvedAt", "residentNotifiedAt"
    ];
    if (required.some((key) => !String(complaint[key] || "").trim())) return false;
    const submittedAt = Date.parse(complaint.submittedAt);
    const acknowledgedAt = Date.parse(complaint.acknowledgedAt);
    const dueAt = Date.parse(complaint.dueAt);
    const resolvedAt = Date.parse(complaint.resolvedAt);
    const residentNotifiedAt = Date.parse(complaint.residentNotifiedAt);
    if ([submittedAt, acknowledgedAt, dueAt, resolvedAt, residentNotifiedAt].some((value) => !Number.isFinite(value))) return false;
    if (acknowledgedAt < submittedAt || dueAt <= submittedAt || resolvedAt < acknowledgedAt || residentNotifiedAt < resolvedAt) return false;
    if (resolvedAt > dueAt && (!String(complaint.slaBreachReason || "").trim() || !Number.isFinite(Date.parse(complaint.escalatedAt)))) return false;
    return true;
  }

  function complaintStatusView(item) {
    const flatStatus = String(item?.complaintStatus || "").trim().toLowerCase();
    const nestedStatus = String(item?.complaint?.status || "").trim().toLowerCase();
    const isNone = (status) => !status || status === "none";
    if (isNone(flatStatus) && isNone(nestedStatus)) return null;
    if (["closed", "resolved"].includes(flatStatus) && hasComplaintClosureEvidence(item)) {
      return Object.freeze({
        code: "closed",
        label: "投诉已关闭",
        detail: "订单已记录关闭；处置结果以服务机构正式回访或回执为准。",
        tone: "ready",
        terminal: true
      });
    }
    const complaintMissing = item?.complaint == null;
    if (flatStatus === "open" && (complaintMissing || (nestedStatus === "open" && complaintScopeIsValid(item, item.complaint)))) {
      return Object.freeze({
        code: "open",
        label: "投诉已登记",
        detail: "等待服务机构处置；机构消息已读不代表投诉结案。",
        tone: "warn",
        terminal: false
      });
    }
    return Object.freeze({
      code: "unknown",
      label: "投诉状态待核验",
      detail: "订单返回了未识别状态，尚不能解释为机构已处置。",
      tone: "danger",
      terminal: false
    });
  }

  function serviceOrderSourceId(item) {
    const explicit = String(item?.sourceId || "").trim();
    if (explicit) return explicit;
    const id = String(item?.id || item?.serviceOrderId || "").trim();
    return id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  }

  function enrichServiceOrder(item, sources = {}, residentId = "") {
    const sourceCollection = String(item?.sourceCollection || item?.collection || "").trim();
    const sourceId = serviceOrderSourceId(item);
    const expectedResidentId = String(residentId || item?.residentId || "").trim();
    if (!supportedCollections.has(sourceCollection) || !sourceId || !expectedResidentId) return { ...item };
    if (item?.residentId && String(item.residentId).trim() !== expectedResidentId) return { ...item };
    const rows = Array.isArray(sources[sourceCollection]) ? sources[sourceCollection] : [];
    const source = rows.find((row) => String(row?.id || "").trim() === sourceId
      && String(row?.residentId || "").trim() === expectedResidentId);
    if (!source) return { ...item };
    return {
      ...item,
      sourceId,
      residentId: expectedResidentId,
      complaintStatus: source.complaintStatus,
      complaint: source.complaint,
      residentFeedback: source.residentFeedback,
      satisfaction: source.satisfaction,
      complaintView: complaintStatusView({ ...source, sourceCollection })
    };
  }

  function serviceOrderStatusClass(status = "") {
    const value = String(status).toLowerCase();
    if (value === "cancel-requested" || value === "取消待确认") return "warn";
    if (/cancel|reject|failed|异常|取消|拒绝|失败/.test(value)) return "danger";
    if (/pending|wait|待|审核|处理中|requested|submitted/.test(value)) return "warn";
    return "";
  }

  function serviceOrderLifecycle(status = "") {
    const value = String(status).toLowerCase();
    if (value === "cancel-requested" || value === "取消待确认") return "待处理";
    if (/completed|closed|done|已完成|已关闭|完诊|履约/.test(value)) return "已完成";
    if (/cancel|reject|failed|取消|拒绝|失败/.test(value)) return "已终止";
    if (/pending|wait|submitted|requested|待|审核|处理中/.test(value)) return "待处理";
    return "进行中";
  }

  function normalizeServiceOrder(item, sources, residentId) {
    const enriched = enrichServiceOrder(item, sources, residentId);
    return { ...enriched, lifecycle: serviceOrderLifecycle(enriched.status), statusClass: serviceOrderStatusClass(enriched.status) };
  }

  function serviceOrderTypeLabel(type = "") {
    return { nursing: "护理", escort: "陪诊", registration: "挂号", "physical-exam": "体检", "family-doctor": "家医" }[String(type || "").trim()] || String(type || "服务");
  }

  function serviceOrderNeedsAttention(item) {
    return !["已完成", "已终止"].includes(item.lifecycle) || complaintStatusView(item)?.terminal === false;
  }

  function buildServiceOrderHighlight(orders, openOrders, href, title = "统一服务订单中心深化") {
    return {
      id: "service-order-center-plus",
      title,
      status: `${orders.length} 单 / ${openOrders.length} 需关注`,
      metric: openOrders.length,
      action: "查看订单",
      href,
      detail: orders.slice(0, 4).map((item) => `${item.service}:${item.lifecycle}`).join("；") || "护理、陪诊、挂号、体检、家医提交后统一进入 serviceOrders。",
      evidence: "/api/service-orders 正式接口优先，保留本地聚合回退。",
      ready: true
    };
  }

  function renderComplaintStatus(item, escapeHtml) {
    const view = complaintStatusView(item);
    if (!view) return "";
    return `<aside class="service-complaint-status ${escapeHtml(view.tone)}" role="status" aria-label="投诉跟进状态">
      <strong>${escapeHtml(view.label)}</strong>
      <span>${escapeHtml(view.detail)}</span>
    </aside>`;
  }

  function matchesSubmittedFeedback(item, payload = {}) {
    if (!hasSubmittedFeedback(item)) return false;
    return String(item?.residentFeedback || "").trim() === String(payload.comment || "").trim()
      && satisfactionLabel(item?.satisfaction) === satisfactionLabel(payload.satisfaction)
      && String(item?.complaintStatus || "none").trim().toLowerCase() === String(payload.complaintStatus || "none").trim().toLowerCase();
  }

  function isRecoverableDuplicateFeedback(error) {
    return Number(error?.status) === 400
      && (error?.code === "CITIZEN_SERVICE_FEEDBACK_ALREADY_SUBMITTED"
        || /已提交评价|重复提交/.test(String(error?.message || "")));
  }

  function isCitizenVisibleMessage(item) {
    return item?.targetRole === "citizen";
  }

  async function recoverSubmittedFeedback(options) {
    const refreshed = await options.fetchState();
    const rows = Array.isArray(refreshed?.[options.collection]) ? refreshed[options.collection] : [];
    const itemId = String(options.taskId || "").split(":")[1];
    const recovered = rows.find((item) => item.id === itemId && item.residentId === options.residentId);
    if (!matchesSubmittedFeedback(recovered, options.payload)) return null;
    await options.onRecovered(refreshed);
    return recovered;
  }

  async function handleFailedSubmission(response, action, recover) {
    const errorBody = await response.json().catch(() => ({}));
    const error = new Error(errorBody.message || `服务待办更新失败：${response.status}`);
    error.status = response.status;
    error.code = errorBody.code;
    if (action === "quality-feedback" && isRecoverableDuplicateFeedback(error)) {
      const recovered = await recover();
      if (recovered) return { ...recovered, recoveredFromDuplicate: true };
    }
    throw error;
  }

  function isCompletedService(item) {
    return eligibleStatuses.has(taskStatus(item));
  }

  function isFeedbackEligible(item) {
    return supportedCollections.has(String(item?.collection || ""))
      && isCompletedService(item)
      && !hasSubmittedFeedback(item);
  }

  function shouldIncludeOrder(item, collection) {
    const status = taskStatus(item);
    const open = !["closed", "completed", "quality-review", "cancel-requested", "cancelled", "canceled"].includes(status);
    return open || isFeedbackEligible({ ...item, collection });
  }

  function shouldIncludeEscortOrder(item) {
    return shouldIncludeOrder(item, "escortServiceOrders");
  }

  function shouldIncludeNursingOrder(item) {
    return shouldIncludeOrder(item, "internetNursingOrders");
  }

  function buildPayload(input = {}) {
    const satisfaction = String(input.satisfaction || "").trim();
    const comment = String(input.comment || "").trim();
    if (!satisfactionOptions.has(satisfaction)) throw new Error("请选择总体满意度");
    if (comment.length < 2) throw new Error("请填写至少 2 个字符的评价内容");
    return {
      action: "quality-feedback",
      comment,
      satisfaction,
      complaintStatus: input.complaintRequested === true || input.complaintRequested === "open" ? "open" : "none"
    };
  }

  function replaceTaskItem(primaryRows, mirrorRows, updated) {
    for (const rows of [primaryRows, mirrorRows]) {
      if (!Array.isArray(rows)) continue;
      const index = rows.findIndex((item) => item.id === updated?.id);
      if (index >= 0) rows[index] = updated;
    }
  }

  function createDialogController(document, submitTaskAction, showToast = () => {}, render = () => {}, commandContext = () => ({})) {
    const dialog = document?.querySelector("#service-quality-feedback-dialog");
    const form = document?.querySelector("#service-quality-feedback-form");
    const error = document?.querySelector("#service-quality-feedback-error");
    const title = document?.querySelector("#service-quality-feedback-title");
    if (!dialog || !form || !error || typeof submitTaskAction !== "function") return null;
    let activeSession = null;

    function reset() {
      if (activeSession) activeSession.button.disabled = false;
      activeSession = null;
      form.reset();
      delete form.dataset.taskKey;
      error.textContent = "";
      const submit = form.querySelector("button[type='submit']");
      if (submit) submit.disabled = false;
    }

    function close() {
      reset();
      dialog.close();
    }

    document.querySelectorAll("[data-quality-feedback-cancel]").forEach((button) => button.addEventListener("click", close));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("close", () => {
      // Native close events are queued and may arrive after another session opens.
      if (!dialog.open) reset();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const session = activeSession;
      if (!dialog.open) return;
      if (!session) {
        error.textContent = "未找到需要评价的服务，请关闭后重试。";
        return;
      }
      if (session.pending) return;
      let payload;
      try {
        const data = Object.fromEntries(new root.FormData(form));
        payload = buildPayload({
          satisfaction: data.satisfaction,
          comment: data.comment,
          complaintRequested: data.complaintRequested === "open"
        });
      } catch (validationError) {
        error.textContent = validationError.message || "请核对评价内容";
        return;
      }
      const submit = form.querySelector("button[type='submit']");
      session.pending = true;
      session.button.disabled = true;
      if (submit) submit.disabled = true;
      error.textContent = "正在提交评价…";
      try {
        const result = await submitTaskAction(session.taskId, session.collection, payload, session.command);
        if (activeSession !== session || !dialog.open) return;
        close();
        showToast(result?.recoveredFromDuplicate
          ? "评价与投诉已登记，已同步最新状态"
          : payload.complaintStatus === "open" ? "评价已提交，服务机构将跟进处理" : "服务评价已提交");
        render();
      } catch {
        if (activeSession !== session || !dialog.open) return;
        error.textContent = "服务评价提交失败，请稍后重试。";
        showToast("服务评价提交失败，已保留填写内容");
      } finally {
        session.pending = false;
        if (activeSession === session && dialog.open) {
          session.button.disabled = false;
          if (submit) submit.disabled = false;
        }
      }
    });

    return Object.freeze({
      open(button) {
        if (!button) return false;
        const taskKey = `${button.dataset.taskCollection}:${button.dataset.taskId}`;
        if (!dialog.open || !activeSession || form.dataset.taskKey !== taskKey) {
          reset();
          form.dataset.taskKey = taskKey;
          activeSession = {
            button,
            taskId: button.dataset.taskId,
            collection: button.dataset.taskCollection,
            command: commandContext(button) || {},
            pending: false
          };
        }
        if (activeSession.pending) return true;
        if (title) title.textContent = `${button.dataset.taskCollection === "internetNursingOrders" ? "互联网护理" : "助医陪诊"}服务评价`;
        error.textContent = "";
        dialog.showModal();
        form.elements.satisfaction.focus();
        return true;
      }
    });
  }

  function createCommand(collectionVersions, collection) {
    const expectedVersion = collectionVersions?.[collection];
    return {
      idempotencyKey: crypto.randomUUID(),
      ...(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0 ? { expectedVersion } : {})
    };
  }

  function taskActionRequest(payload, command = {}, referralCommandId = "", referralVersion = 1) {
    const feedbackCommandId = payload.action === "quality-feedback" ? String(command.idempotencyKey || "").trim() : "";
    const idempotencyKey = referralCommandId || feedbackCommandId;
    const commandPayload = referralCommandId
      ? { ...payload, expectedVersion: Number(referralVersion || 1) }
      : feedbackCommandId
        ? { ...payload, idempotencyKey: feedbackCommandId, ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }) }
        : payload;
    return {
      headers: { "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: JSON.stringify(commandPayload)
    };
  }

  return {
    buildPayload,
    buildServiceOrderHighlight,
    complaintStatusView,
    createCommand,
    createDialogController,
    enrichServiceOrder,
    hasComplaintClosureEvidence,
    hasSubmittedFeedback,
    handleFailedSubmission,
    isCompletedService,
    isFeedbackEligible,
    isCitizenVisibleMessage,
    isRecoverableDuplicateFeedback,
    matchesSubmittedFeedback,
    normalizeServiceOrder,
    recoverSubmittedFeedback,
    renderComplaintStatus,
    replaceTaskItem,
    satisfactionLabel,
    serviceOrderSourceId,
    serviceOrderLifecycle,
    serviceOrderStatusClass,
    serviceOrderTypeLabel,
    serviceOrderNeedsAttention,
    shouldIncludeEscortOrder,
    shouldIncludeNursingOrder,
    shouldIncludeOrder,
    taskActionRequest,
    taskStatus
  };
});
