"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const feedback = require("../citizen-service-feedback");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function createFeedbackDialogHarness() {
  function eventTarget(extra = {}) {
    const listeners = new Map();
    return {
      ...extra,
      addEventListener(type, listener) {
        const registered = listeners.get(type) || [];
        registered.push(listener);
        listeners.set(type, registered);
      },
      async dispatch(type, event = {}) {
        event.preventDefault = () => { event.defaultPrevented = true; };
        await Promise.all((listeners.get(type) || []).map((listener) => listener(event)));
        return event;
      }
    };
  }
  const closeEvents = [];
  const submitButton = { disabled: false };
  const form = eventTarget({
    dataset: {},
    values: {},
    elements: { satisfaction: { focus() {} } },
    reset() { this.values = { satisfaction: "", comment: "", complaintRequested: "" }; },
    querySelector(selector) { return selector === "button[type='submit']" ? submitButton : null; }
  });
  const dialog = eventTarget({
    open: false,
    showModal() { this.open = true; },
    close() {
      if (!this.open) return;
      this.open = false;
      // Native close events are queued: reopening can precede delivery.
      closeEvents.push(() => this.dispatch("close"));
    }
  });
  const error = { textContent: "" };
  const title = { textContent: "" };
  const cancelButton = eventTarget();
  const nodes = {
    "#service-quality-feedback-dialog": dialog,
    "#service-quality-feedback-form": form,
    "#service-quality-feedback-error": error,
    "#service-quality-feedback-title": title
  };
  const document = {
    querySelector: (selector) => nodes[selector] || null,
    querySelectorAll: (selector) => selector === "[data-quality-feedback-cancel]" ? [cancelButton] : []
  };
  const context = vm.createContext({
    module: { exports: {} },
    FormData: class {
      constructor(target) { this.entries = Object.entries(target.values); }
      [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
    }
  });
  vm.runInContext(read("citizen-service-feedback.js"), context, { filename: "citizen-service-feedback.js" });
  const requests = [];
  const toasts = [];
  const commands = [];
  let renders = 0;
  const controller = context.module.exports.createDialogController(document, (taskId, collection, payload, command) => {
    const request = { taskId, collection, payload, command, ...deferred() };
    requests.push(request);
    return request.promise;
  }, (message) => toasts.push(message), () => { renders += 1; }, () => {
    const command = { idempotencyKey: `feedback-command-${commands.length + 1}`, expectedVersion: 7 };
    commands.push(command);
    return command;
  });
  return {
    controller, dialog, form, error, title, submitButton, requests, toasts, commands,
    get renders() { return renders; },
    button(id) { return { disabled: false, dataset: { taskId: `escort:${id}`, taskCollection: "escortServiceOrders" } }; },
    fill(comment = "服务体验良好", satisfaction = "满意", complaintRequested = "") {
      form.values = { satisfaction, comment, complaintRequested };
    },
    submit() { return form.dispatch("submit"); },
    close() { return cancelButton.dispatch("click"); },
    async cancel() {
      const event = await dialog.dispatch("cancel");
      if (!event.defaultPrevented) dialog.close();
    },
    async flushCloseEvents() {
      while (closeEvents.length) await closeEvents.shift()();
    }
  };
}

for (const outcome of ["success", "failure"]) {
  for (const nextSubmitting of [false, true]) {
    test(`feedback dialog ignores stale ${outcome} while next session is ${nextSubmitting ? "submitting" : "editing"}`, async () => {
      const h = createFeedbackDialogHarness();
      const a = h.button("a");
      const b = h.button("b");
      h.controller.open(a);
      h.fill("第一单的原始评价");
      const pendingA = h.submit();
      await h.close();
      await h.flushCloseEvents();
      h.controller.open(b);
      h.fill("第二单的独立评价", "不满意", "open");
      const pendingB = nextSubmitting ? h.submit() : null;
      const expectedError = h.error.textContent;
      const expectedDraft = { ...h.form.values };
      if (outcome === "success") h.requests[0].resolve({});
      else h.requests[0].reject(new Error("internal stale service failure"));
      await pendingA;
      assert.equal(h.dialog.open, true);
      assert.deepEqual(h.form.values, expectedDraft);
      assert.equal(h.error.textContent, expectedError);
      assert.equal(h.submitButton.disabled, nextSubmitting);
      assert.equal(b.disabled, nextSubmitting);
      assert.deepEqual(h.toasts, []);
      assert.equal(h.renders, 0);
      if (pendingB) {
        assert.equal(h.requests[1].command, h.commands[1]);
        h.requests[1].resolve({});
        await pendingB;
        assert.equal(h.dialog.open, false);
        assert.equal(h.renders, 1);
      }
    });
  }
}

test("feedback dialog suppresses repeated submit events and retains failed draft and command for retry", async () => {
  const h = createFeedbackDialogHarness();
  const button = h.button("retry");
  h.controller.open(button);
  h.fill("需要机构联系说明", "不满意", "open");
  const original = { ...h.form.values };
  const first = h.submit();
  const duplicate = h.submit();
  assert.equal(h.requests.length, 1);
  await duplicate;
  h.requests[0].reject(new Error("database password and internal stack"));
  await first;
  assert.equal(h.dialog.open, true);
  assert.deepEqual(h.form.values, original);
  assert.equal(h.error.textContent, "服务评价提交失败，请稍后重试。");
  assert.equal(h.submitButton.disabled, false);
  assert.equal(button.disabled, false);
  assert.deepEqual(h.toasts, ["服务评价提交失败，已保留填写内容"]);
  const retry = h.submit();
  assert.equal(h.requests.length, 2);
  assert.equal(h.commands.length, 1);
  assert.equal(h.requests[1].command, h.requests[0].command);
  assert.equal(JSON.stringify(h.requests[1].payload), JSON.stringify(h.requests[0].payload));
  h.requests[1].resolve({ recoveredFromDuplicate: true });
  await retry;
  await h.flushCloseEvents();
  assert.equal(h.dialog.open, false);
  assert.equal(button.disabled, false);
  assert.equal(h.toasts.at(-1), "评价与投诉已登记，已同步最新状态");
  assert.equal(h.renders, 1);
});

test("feedback dialog delayed close and old completion do not unlock a reopened same-button session", async () => {
  const h = createFeedbackDialogHarness();
  const button = h.button("same");
  h.controller.open(button);
  h.fill("第一会话评价");
  const old = h.submit();
  await h.close();
  h.controller.open(button);
  h.fill("重新打开后的评价");
  const current = h.submit();
  assert.equal(h.commands.length, 2);
  assert.notEqual(h.requests[0].command.idempotencyKey, h.requests[1].command.idempotencyKey);
  await h.flushCloseEvents();
  assert.equal(h.dialog.open, true);
  assert.equal(h.submitButton.disabled, true);
  assert.equal(button.disabled, true);
  h.requests[0].reject(new Error("old failure"));
  await old;
  assert.equal(h.error.textContent, "正在提交评价…");
  assert.equal(h.submitButton.disabled, true);
  assert.equal(button.disabled, true);
  h.requests[1].resolve({});
  await current;
  assert.equal(h.dialog.open, false);
  assert.equal(h.renders, 1);
});

for (const closeKind of ["cancel", "native"]) {
  test(`feedback dialog ${closeKind} close invalidates the old session before reopen`, async () => {
    const h = createFeedbackDialogHarness();
    const button = h.button("same");
    h.controller.open(button);
    h.fill("关闭前的评价");
    const old = h.submit();
    if (closeKind === "cancel") await h.cancel();
    else h.dialog.close();
    h.controller.open(button);
    assert.equal(h.commands.length, 2);
    assert.equal(h.form.values.comment, "");
    await h.flushCloseEvents();
    h.fill("关闭后新会话评价");
    h.requests[0].resolve({});
    await old;
    assert.equal(h.dialog.open, true);
    assert.equal(h.form.values.comment, "关闭后新会话评价");
    assert.deepEqual(h.toasts, []);
    assert.equal(h.renders, 0);
    const current = h.submit();
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve({});
    await current;
  });
}

test("feedback dialog completion after dismissal produces no stale toast or render", async () => {
  for (const outcome of ["success", "failure"]) {
    const h = createFeedbackDialogHarness();
    const button = h.button("dismissed");
    h.controller.open(button);
    h.fill();
    const pending = h.submit();
    await h.close();
    if (outcome === "success") h.requests[0].resolve({});
    else h.requests[0].reject(new Error("late failure"));
    await pending;
    await h.flushCloseEvents();
    assert.equal(h.dialog.open, false);
    assert.equal(h.error.textContent, "");
    assert.equal(button.disabled, false);
    assert.deepEqual(h.toasts, []);
    assert.equal(h.renders, 0);
  }
});

test("feedback dialog validation keeps known input guidance without issuing a request", async () => {
  const h = createFeedbackDialogHarness();
  h.controller.open(h.button("validation"));
  h.fill("正常长度评价", "");
  await h.submit();
  assert.equal(h.error.textContent, "请选择总体满意度");
  h.fill("好", "满意");
  await h.submit();
  assert.equal(h.error.textContent, "请填写至少 2 个字符的评价内容");
  assert.equal(h.requests.length, 0);
  assert.equal(h.commands.length, 1);
  assert.equal(h.submitButton.disabled, false);
});

for (const status of ["cancel-requested", "取消待确认"]) {
  test(`pending cancellation ${status} remains a warning that needs attention`, () => {
    const order = feedback.normalizeServiceOrder({ status });
    assert.equal(order.lifecycle, "待处理");
    assert.equal(order.statusClass, "warn");
    assert.equal(feedback.serviceOrderNeedsAttention(order), true);
    assert.equal(order.status, status);
    assert.match(feedback.buildServiceOrderHighlight([order], [order], "#orders").status, /1 需关注/);
  });
}

test("pending cancellation classification preserves genuine terminal and other pending states", () => {
  for (const status of ["cancelled", "canceled", "已取消", "rejected", "failed"]) {
    const order = feedback.normalizeServiceOrder({ status });
    assert.equal(order.lifecycle, "已终止", status);
    assert.equal(order.statusClass, "danger", status);
    assert.equal(feedback.serviceOrderNeedsAttention(order), false, status);
  }
  for (const status of ["completed", "closed", "已完成", "已关闭"]) {
    const order = feedback.normalizeServiceOrder({ status });
    assert.equal(order.lifecycle, "已完成", status);
    assert.equal(feedback.serviceOrderNeedsAttention(order), false, status);
  }
  for (const status of ["requested", "pending", "待确认", "refund-pending"]) {
    const order = feedback.normalizeServiceOrder({ status });
    assert.equal(order.lifecycle, "待处理", status);
    assert.equal(order.statusClass, "warn", status);
    assert.equal(feedback.serviceOrderNeedsAttention(order), true, status);
  }
  const cancelledWithComplaint = feedback.normalizeServiceOrder({ status: "cancelled", complaintStatus: "open" });
  assert.equal(cancelledWithComplaint.lifecycle, "已终止");
  assert.equal(feedback.serviceOrderNeedsAttention(cancelledWithComplaint), true);
});

test("resident service feedback is offered only after completion and only once", () => {
  for (const collection of ["escortServiceOrders", "internetNursingOrders"]) {
    assert.equal(feedback.isFeedbackEligible({ collection, status: "requested" }), false);
    assert.equal(feedback.isFeedbackEligible({ collection, status: "in-service" }), false);
    assert.equal(feedback.isFeedbackEligible({ collection, status: "completed" }), true);
    assert.equal(feedback.isFeedbackEligible({ collection, status: "quality-review" }), true);
    assert.equal(feedback.isFeedbackEligible({ collection, status: "closed" }), true);
    assert.equal(feedback.isFeedbackEligible({ collection, status: "cancelled" }), false);
    assert.equal(feedback.isFeedbackEligible({ collection, status: "completed", taskAction: "quality-feedback" }), false);
    assert.equal(feedback.isFeedbackEligible({ collection, status: "completed", qualityReview: "citizen-feedback" }), false);
    assert.equal(feedback.isFeedbackEligible({ collection, status: "completed", qualityCallback: "citizen-feedback" }), false);
  }
  assert.equal(feedback.isFeedbackEligible({ collection: "followups", status: "completed" }), false);
  assert.equal(feedback.isCompletedService({ status: "quality-review", taskAction: "quality-feedback" }), true);
});

test("completed services remain visible until resident feedback is submitted", () => {
  assert.equal(feedback.shouldIncludeOrder({ status: "requested" }, "escortServiceOrders"), true);
  assert.equal(feedback.shouldIncludeOrder({ status: "completed" }, "escortServiceOrders"), true);
  assert.equal(feedback.shouldIncludeOrder({ status: "completed", taskAction: "quality-feedback" }, "escortServiceOrders"), false);
  assert.equal(feedback.shouldIncludeOrder({ status: "quality-review", qualityReview: "citizen-feedback" }, "escortServiceOrders"), false);
  assert.equal(feedback.shouldIncludeOrder({ status: "cancelled" }, "escortServiceOrders"), false);
});

test("resident feedback payload preserves the selected satisfaction and complaint intent", () => {
  assert.deepEqual(feedback.buildPayload({
    satisfaction: "不满意",
    comment: "  服务迟到，希望联系说明  ",
    complaintRequested: true
  }), {
    action: "quality-feedback",
    satisfaction: "不满意",
    comment: "服务迟到，希望联系说明",
    complaintStatus: "open"
  });
  assert.equal(feedback.buildPayload({ satisfaction: "非常满意", comment: "服务很好" }).complaintStatus, "none");
  assert.throws(() => feedback.buildPayload({ satisfaction: "", comment: "服务很好" }), /请选择总体满意度/);
  assert.throws(() => feedback.buildPayload({ satisfaction: "满意", comment: "好" }), /至少 2 个字符/);
  assert.throws(() => feedback.buildPayload({ satisfaction: "伪造状态", comment: "服务很好" }), /请选择总体满意度/);
});

test("complaint status stays tied to the scoped source order and never treats a message receipt as closure", () => {
  assert.deepEqual(feedback.complaintStatusView({ complaintStatus: "open" }), {
    code: "open",
    label: "投诉已登记",
    detail: "等待服务机构处置；机构消息已读不代表投诉结案。",
    tone: "warn",
    terminal: false
  });
  assert.equal(feedback.complaintStatusView({ complaintStatus: "none" }), null);
  assert.equal(feedback.complaintStatusView({ complaintStatus: "none", complaint: { status: "open" } }).terminal, false);
  assert.equal(feedback.complaintStatusView({ complaintStatus: "none", complaint: { status: "resolved" } }).terminal, false);
  assert.equal(feedback.complaintStatusView({ complaintStatus: "handled" }).code, "unknown");
  assert.equal(feedback.complaintStatusView({ complaintStatus: "closed" }).terminal, false);
  const resolvedOrder = {
    id: "eso-closed",
    residentId: "r1",
    complaintStatus: "closed",
    complaint: {
      id: "complaint-1",
      status: "resolved",
      orderId: "eso-closed",
      domain: "escort",
      residentId: "r1",
      severity: "medium",
      category: "service-quality",
      description: "服务迟到",
      ownerId: "complaint-owner-1",
      submittedAt: "2026-09-07T08:00:00.000Z",
      acknowledgedAt: "2026-09-07T08:10:00.000Z",
      dueAt: "2026-09-08T08:00:00.000Z",
      resolution: "已完成情况说明与服务复核",
      resolvedBy: "complaint-owner-1",
      resolvedAt: "2026-09-07T10:00:00.000Z",
      residentNotifiedAt: "2026-09-07T10:05:00.000Z"
    }
  };
  assert.equal(feedback.hasComplaintClosureEvidence(resolvedOrder), true);
  assert.equal(feedback.complaintStatusView(resolvedOrder).terminal, true);
  assert.equal(feedback.hasComplaintClosureEvidence({ ...resolvedOrder, complaint: { ...resolvedOrder.complaint, residentNotifiedAt: "" } }), false);
  assert.equal(feedback.hasComplaintClosureEvidence({ ...resolvedOrder, complaint: { ...resolvedOrder.complaint, resolution: "" } }), false);
  assert.equal(feedback.hasComplaintClosureEvidence({ ...resolvedOrder, complaint: { ...resolvedOrder.complaint, acknowledgedAt: "2026-09-07T11:00:00.000Z" } }), false);
  assert.equal(feedback.complaintStatusView({ ...resolvedOrder, complaint: { ...resolvedOrder.complaint, status: "open" } }).terminal, false);
  assert.equal(feedback.hasComplaintClosureEvidence({ ...resolvedOrder, complaint: { ...resolvedOrder.complaint, severity: "unknown" } }), false);
  assert.equal(feedback.hasComplaintClosureEvidence({ ...resolvedOrder, sourceCollection: "internetNursingOrders" }), false);
  assert.equal(feedback.complaintStatusView({
    id: "eso-closed", residentId: "r1", sourceCollection: "escortServiceOrders", complaintStatus: "open",
    complaint: { ...resolvedOrder.complaint, status: "open", orderId: "other", residentId: "r2", domain: "nursing", severity: "unknown" }
  }).code, "unknown");
  assert.equal(feedback.renderComplaintStatus({ ...resolvedOrder, complaintView: { label: "伪造关闭", terminal: true } }, (value) => value).includes("伪造关闭"), false);
  assert.equal(feedback.hasComplaintClosureEvidence({ ...resolvedOrder, sourceCollection: "escortServiceOrders", complaint: { ...resolvedOrder.complaint, domain: "nursing" } }), false);

  const orderIndex = {
    id: "escortServiceOrders:eso-1",
    sourceCollection: "escortServiceOrders",
    sourceId: "eso-1",
    residentId: "r1",
    status: "completed"
  };
  const sources = {
    escortServiceOrders: [
      { id: "eso-1", residentId: "r1", complaintStatus: "open", residentFeedback: "请联系说明", satisfaction: "不满意" },
      { id: "eso-1", residentId: "r2", complaintStatus: "closed", residentFeedback: "other resident" }
    ]
  };
  const enriched = feedback.enrichServiceOrder(orderIndex, sources, "r1");
  assert.equal(enriched.complaintStatus, "open");
  assert.equal(enriched.residentFeedback, "请联系说明");
  assert.equal(enriched.complaintView.terminal, false);
  assert.equal(feedback.enrichServiceOrder(orderIndex, sources, "r2").complaintStatus, undefined);
  assert.match(feedback.buildServiceOrderHighlight([enriched], [enriched], "#orders").status, /1 需关注/);
});

test("ambiguous feedback recovery requires the exact persisted evaluation", () => {
  const persisted = {
    taskAction: "quality-feedback",
    residentFeedback: "服务迟到，希望联系说明",
    satisfaction: "不满意",
    complaintStatus: "open"
  };
  const payload = {
    comment: "服务迟到，希望联系说明",
    satisfaction: "不满意",
    complaintStatus: "open"
  };
  assert.equal(feedback.matchesSubmittedFeedback(persisted, payload), true);
  assert.equal(feedback.matchesSubmittedFeedback({ ...persisted, complaintStatus: "none" }, payload), false);
  assert.equal(feedback.matchesSubmittedFeedback({ ...persisted, satisfaction: { score: 2, status: "submitted" } }, payload), false);
  assert.equal(feedback.satisfactionLabel({ score: 5, status: "submitted" }), "5 分");
  assert.equal(feedback.isRecoverableDuplicateFeedback({ status: 400, message: "该服务已提交评价，请勿重复提交" }), true);
  assert.equal(feedback.isRecoverableDuplicateFeedback({ status: 400, code: "CITIZEN_SERVICE_FEEDBACK_ALREADY_SUBMITTED", message: "already submitted" }), true);
  assert.equal(feedback.isRecoverableDuplicateFeedback({ status: 500, message: "该服务已提交评价" }), false);
  assert.equal(feedback.isCitizenVisibleMessage({ targetRole: "citizen" }), true);
  assert.equal(feedback.isCitizenVisibleMessage({}), false);
  assert.equal(feedback.isCitizenVisibleMessage({ targetRole: "institution" }), false);

  const request = feedback.taskActionRequest(
    { action: "quality-feedback", comment: "服务迟到" },
    { idempotencyKey: "feedback-command-1", expectedVersion: 7 }
  );
  assert.equal(request.headers["Idempotency-Key"], "feedback-command-1");
  assert.deepEqual(JSON.parse(request.body), {
    action: "quality-feedback", comment: "服务迟到", idempotencyKey: "feedback-command-1", expectedVersion: 7
  });
});

test("resident portal wires a structured feedback dialog without changing the task API", () => {
  const html = read("citizen.html");
  const js = read("citizen.js");
  const feedbackModule = read("citizen-service-feedback.js");
  const serviceWorker = read("service-worker.js");
  assert.match(html, /id="service-quality-feedback-dialog"/);
  assert.match(html, /name="satisfaction"/);
  assert.match(html, /name="complaintRequested" value="open"/);
  assert.match(html, /citizen-service-feedback\.js/);
  assert.match(js, /CSF\.createDialogController/);
  assert.match(feedbackModule, /function buildPayload/);
  assert.match(feedbackModule, /服务评价提交失败，已保留填写内容/);
  assert.match(js, /投诉待处理/);
  assert.match(js, /filter\(CSF\.isCitizenVisibleMessage\)/);
  assert.match(js, /CSF\.isCitizenVisibleMessage\(item\) &&/);
  assert.match(js, /recoverSubmittedServiceFeedback/);
  assert.match(js, /\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/actions/);
  assert.doesNotMatch(js, /satisfaction:\s*action === "quality-feedback" \? "满意"/);
  assert.match(serviceWorker, /chronic-care-citizen-v63-service-feedback/);
  assert.match(serviceWorker, /citizen-service-feedback\.js/);
});
