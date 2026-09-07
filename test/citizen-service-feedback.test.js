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

test("resident portal wires a structured feedback dialog without changing the task API", () => {
  const html = read("citizen.html");
  const js = read("citizen.js");
  const feedbackModule = read("citizen-service-feedback.js");
  const serviceWorker = read("service-worker.js");
  assert.match(html, /id="service-quality-feedback-dialog"/);
  assert.match(html, /name="satisfaction"/);
  assert.match(html, /name="complaintRequested" value="open"/);
  assert.match(html, /citizen-service-feedback\.js/);
  assert.match(js, /CitizenServiceFeedback\.createDialogController/);
  assert.match(feedbackModule, /function buildPayload/);
  assert.match(feedbackModule, /服务评价提交失败，已保留填写内容/);
  assert.match(js, /\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/actions/);
  assert.doesNotMatch(js, /satisfaction:\s*action === "quality-feedback" \? "满意"/);
  assert.match(serviceWorker, /chronic-care-citizen-v62-service-feedback/);
  assert.match(serviceWorker, /citizen-service-feedback\.js/);
});
