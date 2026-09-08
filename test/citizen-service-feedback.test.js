"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const feedback = require("../citizen-service-feedback");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

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
  assert.match(serviceWorker, /chronic-care-citizen-v62-service-feedback/);
  assert.match(serviceWorker, /citizen-service-feedback\.js/);
});
