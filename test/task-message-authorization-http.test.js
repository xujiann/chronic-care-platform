"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { jsonCommand, startCareApiCharacterization } = require("./helpers/care-api-characterization-runtime");

test("resident service complaint messages enforce target role, organization and receipt states over HTTP", async (t) => {
  const runtime = await startCareApiCharacterization("sec011-task-message-authorization");
  t.after(runtime.stop);
  const [citizenToken, hospitalToken, communityToken, commissionToken, countyToken, insuranceToken] = await Promise.all([
    runtime.login("citizen"),
    runtime.login("hospital"),
    runtime.login("community"),
    runtime.login("health"),
    runtime.login("county"),
    runtime.login("insurance")
  ]);

  const completed = await runtime.request(
    `/api/tasks/${encodeURIComponent("internetNursingOrders:ino-001")}/actions`,
    hospitalToken,
    jsonCommand(hospitalToken, "sec011-complete-nursing-order", { action: "update", status: "completed" })
  );
  assert.equal(completed.response.status, 200, JSON.stringify(completed.body));

  const feedback = await runtime.request(
    `/api/tasks/${encodeURIComponent("internetNursingOrders:ino-001")}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "sec011-open-complaint", {
      action: "quality-feedback",
      comment: "服务迟到，请机构联系说明",
      satisfaction: "不满意",
      complaintStatus: "open"
    })
  );
  assert.equal(feedback.response.status, 200, JSON.stringify(feedback.body));
  assert.equal(feedback.body.complaintStatus, "open");

  const hospitalMessages = await runtime.request("/api/messages", hospitalToken);
  assert.equal(hospitalMessages.response.status, 200);
  const message = hospitalMessages.body.messages.find((item) => item.messageType === "resident-service-quality-feedback" && item.sourceId === "ino-001");
  assert.ok(message);
  assert.equal(message.targetRole, "institution");
  assert.equal(message.targetOrgCode, "MR1");

  for (const [label, token] of [
    ["non-owner institution", communityToken],
    ["resident", citizenToken],
    ["county", countyToken],
    ["insurance", insuranceToken]
  ]) {
    const listed = await runtime.request("/api/messages", token);
    assert.equal(listed.response.status, 200, label);
    assert.equal(listed.body.messages.some((item) => item.id === message.id), false, label);
  }
  const oversight = await runtime.request("/api/messages", commissionToken);
  assert.equal(oversight.response.status, 200);
  assert.equal(oversight.body.messages.some((item) => item.id === message.id), true);

  const unauthenticated = await runtime.request(`/api/messages/${message.id}/receipt`, "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "read" })
  });
  assert.equal(unauthenticated.response.status, 401);

  for (const [label, token] of [
    ["resident", citizenToken],
    ["non-owner institution", communityToken],
    ["commission oversight", commissionToken],
    ["county", countyToken],
    ["insurance", insuranceToken]
  ]) {
    const denied = await runtime.request(`/api/messages/${message.id}/receipt`, token, {
      method: "POST",
      body: JSON.stringify({ status: "handled" })
    });
    assert.equal(denied.response.status, 403, label);
  }

  const invalidStatus = await runtime.request(`/api/messages/${message.id}/receipt`, hospitalToken, {
    method: "POST",
    body: JSON.stringify({ status: "completed" })
  });
  assert.equal(invalidStatus.response.status, 400);

  const acknowledged = await runtime.request(`/api/messages/${message.id}/receipt`, hospitalToken, {
    method: "POST",
    body: JSON.stringify({ status: "acknowledged" })
  });
  assert.equal(acknowledged.response.status, 200, JSON.stringify(acknowledged.body));
  assert.equal(acknowledged.body.status, "acknowledged");
  assert.equal(acknowledged.body.receipts[0].status, "acknowledged");

  const state = await runtime.request("/api/state", commissionToken);
  assert.equal(state.response.status, 200);
  assert.equal(state.body.internetNursingOrders.find((item) => item.id === "ino-001").complaintStatus, "open");
  assert.equal(state.body.taskMessages.find((item) => item.id === message.id).status, "acknowledged");
  assert.equal(state.body.securityEvents.filter((item) => item.target === `taskMessages/${message.id}` && item.result === "拒绝").length, 5);
});

test("historical resident service messages derive exactly one owner organization or fail closed", () => {
  const { residentServiceMessageTargetOrgCode } = require("../server");
  const nursingMessage = { collection: "internetNursingOrders", sourceId: "n1", targetRole: "institution" };
  const nursingState = {
    internetNursingOrders: [{ id: "n1", institutionId: "i1", institutionCode: "MR1", taskAction: "quality-feedback" }],
    internetNursingInstitutions: [{ id: "i1", institutionCode: "MR1" }]
  };
  assert.equal(residentServiceMessageTargetOrgCode(nursingMessage, nursingState), "MR1");
  assert.equal(residentServiceMessageTargetOrgCode({ ...nursingMessage, targetOrgCode: "MR3" }, nursingState), "");

  const escortMessage = { collection: "escortServiceOrders", sourceId: "e1", targetRole: "institution" };
  const conflictingEscortState = {
    escortServiceOrders: [{ id: "e1", providerId: "p1", institutionCode: "ORG-PROVIDER", hospitalCode: "MR1", taskAction: "quality-feedback" }],
    escortServiceProviders: [{ id: "p1", institutionCode: "ORG-PROVIDER" }]
  };
  assert.equal(residentServiceMessageTargetOrgCode(escortMessage, conflictingEscortState), "");
  assert.equal(residentServiceMessageTargetOrgCode({ ...nursingMessage, sourceId: "missing" }, nursingState), "");
});
