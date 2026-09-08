"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { jsonCommand, startCareApiCharacterization } = require("./helpers/care-api-characterization-runtime");

function feedbackPayload(comment = "护理服务体验需要改进") {
  return { action: "quality-feedback", comment, satisfaction: "不满意", complaintStatus: "open" };
}

function persisted(runtime) {
  return JSON.parse(fs.readFileSync(path.join(runtime.dataDir, "db.json"), "utf8"));
}

function command(runtime, token, orderId, key, payload, bodyKey = key) {
  return runtime.request(
    `/api/tasks/${encodeURIComponent(`internetNursingOrders:${orderId}`)}/actions`,
    token,
    jsonCommand(token, key, { ...payload, ...(bodyKey ? { idempotencyKey: bodyKey } : {}) })
  );
}

test("resident service feedback is atomic across replay, conflicts, legacy retries and concurrent commands", async (t) => {
  const ids = ["idem-feedback-replay", "idem-feedback-concurrent", "idem-feedback-legacy", "idem-feedback-mismatch", "idem-feedback-stale"];
  const runtime = await startCareApiCharacterization("resident-service-feedback-idempotency", (fixture) => {
    const source = fixture.internetNursingOrders.find((item) => item.id === "ino-001");
    const copies = ids.map((id) => ({
      ...structuredClone(source),
      id,
      residentId: "r1",
      status: "completed",
      taskAction: "",
      qualityCallback: "pending",
      complaintStatus: "none",
      residentFeedback: "",
      satisfaction: { score: 0, status: "pending" },
      auditTrail: [],
      _writeCommandReceipts: []
    }));
    fixture.internetNursingOrders = [...copies, ...fixture.internetNursingOrders.filter((item) => !ids.includes(item.id))];
    fixture.taskMessages = fixture.taskMessages.filter((item) => !ids.includes(item.sourceId));
    fixture.securityEvents = fixture.securityEvents.filter((item) => !ids.some((id) => item.target === `internetNursingOrders:${id}`));
  });
  t.after(runtime.stop);
  const citizenToken = await runtime.login("citizen");

  const replayPayload = feedbackPayload("同一评价命令只应落库一次");
  const first = await command(runtime, citizenToken, ids[0], "feedback-replay-key", replayPayload);
  const replay = await command(runtime, citizenToken, ids[0], "feedback-replay-key", replayPayload);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.deepEqual(replay.body, first.body);

  const conflict = await command(runtime, citizenToken, ids[0], "feedback-replay-key", feedbackPayload("同键不得改写为另一份评价"));
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, "CITIZEN_SERVICE_FEEDBACK_IDEMPOTENCY_CONFLICT");

  const concurrentPayload = feedbackPayload("两个不同命令并发时只能有一次成功写入");
  const concurrent = await Promise.all([
    command(runtime, citizenToken, ids[1], "feedback-concurrent-a", concurrentPayload),
    command(runtime, citizenToken, ids[1], "feedback-concurrent-b", concurrentPayload)
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 400]);
  assert.equal(concurrent.find((item) => item.response.status === 400).body.code, "CITIZEN_SERVICE_FEEDBACK_ALREADY_SUBMITTED");

  const legacyOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(feedbackPayload("旧客户端相同载荷使用自然键安全重放"))
  };
  const legacyFirst = await runtime.request(`/api/tasks/${encodeURIComponent(`internetNursingOrders:${ids[2]}`)}/actions`, citizenToken, legacyOptions);
  const legacyReplay = await runtime.request(`/api/tasks/${encodeURIComponent(`internetNursingOrders:${ids[2]}`)}/actions`, citizenToken, legacyOptions);
  assert.equal(legacyFirst.response.status, 200);
  assert.equal(legacyReplay.response.status, 200);
  assert.deepEqual(legacyReplay.body, legacyFirst.body);

  const mismatch = await command(runtime, citizenToken, ids[3], "feedback-header-key", feedbackPayload(), "feedback-body-key");
  assert.equal(mismatch.response.status, 400);
  assert.equal(mismatch.body.code, "STATE_COMMAND_IDEMPOTENCY_KEY_MISMATCH");

  const currentVersion = persisted(runtime).storageMeta.collectionVersions.internetNursingOrders;
  const stale = await command(runtime, citizenToken, ids[4], "feedback-stale-version", {
    ...feedbackPayload("过期集合版本不得写入"),
    expectedVersion: currentVersion + 1
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, "CITIZEN_SERVICE_FEEDBACK_VERSION_CONFLICT");

  const state = persisted(runtime);
  for (const id of ids.slice(0, 3)) {
    const order = state.internetNursingOrders.find((item) => item.id === id);
    assert.equal(order.taskAction, "quality-feedback", id);
    assert.equal(order.auditTrail.filter((item) => item.action === "quality-feedback").length, 1, id);
    assert.equal(order._writeCommandReceipts.length, 1, id);
    assert.equal(state.taskMessages.filter((item) => item.sourceId === id && item.messageType === "resident-service-quality-feedback").length, 1, id);
    assert.equal(state.securityEvents.filter((item) => item.target === `internetNursingOrders:${id}` && item.action === "handle unified task" && item.result === "allowed").length, 1, id);
  }
  for (const id of ids.slice(3)) {
    const untouched = state.internetNursingOrders.find((item) => item.id === id);
    assert.notEqual(untouched.taskAction, "quality-feedback", id);
    assert.equal(state.taskMessages.some((item) => item.sourceId === id), false, id);
  }
});
