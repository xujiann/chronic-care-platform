"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { verifyAuditTrail } = require("../src/identity-security/audit-chain");
const { jsonCommand, startCareApiCharacterization } = require("./helpers/care-api-characterization-runtime");

function readRuntimeState(runtime) {
  return JSON.parse(fs.readFileSync(path.join(runtime.dataDir, "db.json"), "utf8"));
}

function writeRuntimeState(runtime, data) {
  fs.writeFileSync(path.join(runtime.dataDir, "db.json"), `${JSON.stringify(data, null, 2)}\n`);
}

function addProviderIdentityFixture(fixture) {
  fixture.authOrganizations.push({
    orgCode: "ORG-HOSPITAL",
    name: "SEC-011 provider fixture",
    orgType: "medical_institution",
    orgLevel: "service-provider",
    parentCode: "ORG-DIST-ZS",
    portal: "institution.html",
    dataScope: "escort complaint fixture",
    interfaces: []
  });
  fixture.authUsers.push({
    id: "sec011-provider-user",
    accountCode: "SEC011-PROVIDER-FIXTURE",
    catalogOrder: 990,
    username: "sec011_provider",
    password: "sec011-test-only-password",
    name: "SEC-011 provider fixture",
    role: "institution",
    roleName: "escort quality fixture",
    orgCode: "ORG-HOSPITAL",
    orgName: "SEC-011 provider fixture",
    orgType: "medical_institution",
    orgLevel: "service-provider",
    dataScope: "escort complaint fixture",
    home: "institution.html",
    accountType: "manager",
    status: "启用"
  });
}

test("resident service complaint messages enforce target role, organization and receipt states over HTTP", async (t) => {
  const runtime = await startCareApiCharacterization("sec011-task-message-authorization", addProviderIdentityFixture);
  t.after(runtime.stop);
  const [citizenToken, hospitalToken, communityToken, commissionToken, countyToken, insuranceToken, providerToken] = await Promise.all([
    runtime.login("citizen"),
    runtime.login("hospital"),
    runtime.login("community"),
    runtime.login("health"),
    runtime.login("county"),
    runtime.login("insurance"),
    runtime.login("sec011_provider", "sec011-test-only-password")
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

  const beforeInvalidStatus = readRuntimeState(runtime).taskMessages.find((item) => item.id === message.id);
  const invalidStatus = await runtime.request(`/api/messages/${message.id}/receipt`, hospitalToken, {
    method: "POST",
    body: JSON.stringify({ status: "completed" })
  });
  assert.equal(invalidStatus.response.status, 400);
  const afterInvalidStatus = readRuntimeState(runtime).taskMessages.find((item) => item.id === message.id);
  assert.deepEqual(afterInvalidStatus, beforeInvalidStatus);

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

  const persisted = readRuntimeState(runtime);
  const poisonBody = "SEC011-SECRET-COMPLAINT-CONTENT";
  const malformed = [
    { ...message, id: "sec011-explicit-org-mismatch", targetOrgCode: "MR3", status: "sent", receipts: [], body: poisonBody },
    { ...message, id: "sec011-orphan", sourceId: "missing", taskId: "internetNursingOrders:missing", status: "sent", receipts: [], body: poisonBody },
    { ...message, id: "sec011-resident-mismatch", residentId: "r2", status: "sent", receipts: [], body: poisonBody },
    { ...message, id: "sec011-task-mismatch", taskId: "internetNursingOrders:ino-other", status: "sent", receipts: [], body: poisonBody }
  ];
  const legacyCitizenMessage = {
    id: "sec011-legacy-citizen-quality-review",
    taskId: "internetNursingOrders:ino-001",
    collection: "internetNursingOrders",
    sourceId: "ino-001",
    residentId: "r1",
    targetRole: "citizen",
    title: "互联网护理：服务完成质量回访",
    body: "请查看服务完成回执",
    status: "sent",
    receipts: []
  };
  persisted.taskMessages = [...malformed, legacyCitizenMessage, ...persisted.taskMessages];
  writeRuntimeState(runtime, persisted);

  const citizenAfterQuality = await runtime.request("/api/messages", citizenToken);
  assert.equal(citizenAfterQuality.body.messages.some((item) => item.id === legacyCitizenMessage.id), true);
  const hospitalAfterPoison = await runtime.request("/api/messages", hospitalToken);
  malformed.forEach((item) => assert.equal(hospitalAfterPoison.body.messages.some((row) => row.id === item.id), false, item.id));

  for (const poisoned of malformed) {
    const before = readRuntimeState(runtime).taskMessages.find((item) => item.id === poisoned.id);
    const denied = await runtime.request(`/api/messages/${poisoned.id}/receipt`, hospitalToken, {
      method: "POST",
      body: JSON.stringify({ status: "handled" })
    });
    assert.equal(denied.response.status, 403, poisoned.id);
    const after = readRuntimeState(runtime).taskMessages.find((item) => item.id === poisoned.id);
    assert.deepEqual(after, before, poisoned.id);
  }
  const audited = readRuntimeState(runtime);
  assert.equal(verifyAuditTrail(audited.securityEvents).passed, true);
  const poisonedAudit = audited.securityEvents.filter((item) => malformed.some((messageRow) => item.target === `taskMessages/${messageRow.id}`));
  assert.equal(poisonedAudit.length, malformed.length);
  poisonedAudit.forEach((item) => assert.doesNotMatch(String(item.detail || ""), /SEC011-SECRET-COMPLAINT-CONTENT/));

  const taskId = "escortServiceOrders:eso-r1-20260622";
  const escortCompleted = await runtime.request(
    `/api/tasks/${encodeURIComponent(taskId)}/actions`,
    hospitalToken,
    jsonCommand(hospitalToken, "sec011-complete-escort-order", { action: "update", status: "completed" })
  );
  assert.equal(escortCompleted.response.status, 200, JSON.stringify(escortCompleted.body));
  const escortFeedback = await runtime.request(
    `/api/tasks/${encodeURIComponent(taskId)}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "sec011-open-escort-complaint", {
      action: "quality-feedback",
      comment: "陪诊迟到，请服务机构联系处理",
      satisfaction: "不满意",
      complaintStatus: "open"
    })
  );
  assert.equal(escortFeedback.response.status, 200, JSON.stringify(escortFeedback.body));

  const providerMessages = await runtime.request("/api/messages", providerToken);
  const complaint = providerMessages.body.messages.find((item) => item.messageType === "resident-service-quality-feedback" && item.sourceId === "eso-r1-20260622");
  assert.ok(complaint);
  assert.equal(complaint.targetOrgCode, "ORG-HOSPITAL");
  for (const [label, token] of [["visit hospital", hospitalToken], ["other institution", communityToken], ["resident", citizenToken]]) {
    const listed = await runtime.request("/api/messages", token);
    assert.equal(listed.body.messages.some((item) => item.id === complaint.id), false, label);
  }
  const escortOversight = await runtime.request("/api/messages", commissionToken);
  assert.equal(escortOversight.body.messages.some((item) => item.id === complaint.id), true);
  const wrongInstitutionReceipt = await runtime.request(`/api/messages/${complaint.id}/receipt`, hospitalToken, {
    method: "POST",
    body: JSON.stringify({ status: "handled" })
  });
  assert.equal(wrongInstitutionReceipt.response.status, 403);
  const providerAcknowledged = await runtime.request(`/api/messages/${complaint.id}/receipt`, providerToken, {
    method: "POST",
    body: JSON.stringify({ status: "acknowledged" })
  });
  assert.equal(providerAcknowledged.response.status, 200, JSON.stringify(providerAcknowledged.body));
  const escortState = await runtime.request("/api/state", commissionToken);
  assert.equal(escortState.body.escortServiceOrders.find((item) => item.id === "eso-r1-20260622").complaintStatus, "open");

  const unresolvedFixture = readRuntimeState(runtime);
  const unresolvedOrders = [
    {
      id: "sec011-provider-missing",
      residentId: "r1",
      providerId: "missing-provider",
      institutionCode: "",
      hospitalCode: "MR1",
      status: "completed",
      complaintStatus: "none",
      qualityReview: "pending",
      auditTrail: []
    },
    {
      id: "sec011-provider-conflict",
      residentId: "r1",
      providerId: "esp-pudong-carehub",
      institutionCode: "ORG-CONFLICT",
      hospitalCode: "MR1",
      status: "completed",
      complaintStatus: "none",
      qualityReview: "pending",
      auditTrail: []
    }
  ];
  unresolvedFixture.escortServiceOrders.push(...unresolvedOrders);
  writeRuntimeState(runtime, unresolvedFixture);
  for (const order of unresolvedOrders) {
    const beforeFailure = readRuntimeState(runtime);
    const beforeOrder = beforeFailure.escortServiceOrders.find((item) => item.id === order.id);
    const beforeMessageCount = beforeFailure.taskMessages.length;
    const rejected = await runtime.request(
      `/api/tasks/${encodeURIComponent(`escortServiceOrders:${order.id}`)}/actions`,
      citizenToken,
      jsonCommand(citizenToken, `sec011-${order.id}`, {
        action: "quality-feedback",
        comment: "责任机构不明时不应写入",
        satisfaction: "不满意",
        complaintStatus: "open"
      })
    );
    assert.equal(rejected.response.status, 400, order.id);
    assert.equal(rejected.body.code, "RESIDENT_SERVICE_FEEDBACK_OWNER_UNRESOLVED", order.id);
    const afterFailure = readRuntimeState(runtime);
    assert.deepEqual(afterFailure.escortServiceOrders.find((item) => item.id === order.id), beforeOrder, order.id);
    assert.equal(afterFailure.taskMessages.length, beforeMessageCount, order.id);
  }
});

test("historical resident service messages derive exactly one owner organization or fail closed", () => {
  const { residentServiceMessageTargetOrgCode } = require("../server");
  const nursingMessage = { taskId: "internetNursingOrders:n1", collection: "internetNursingOrders", sourceId: "n1", residentId: "r1", targetRole: "institution" };
  const nursingState = {
    internetNursingOrders: [{ id: "n1", residentId: "r1", institutionId: "i1", institutionCode: "MR1", taskAction: "quality-feedback" }],
    internetNursingInstitutions: [{ id: "i1", institutionCode: "MR1" }]
  };
  assert.equal(residentServiceMessageTargetOrgCode(nursingMessage, nursingState), "MR1");
  assert.equal(residentServiceMessageTargetOrgCode({ ...nursingMessage, targetOrgCode: "MR3" }, nursingState), "");

  const escortMessage = { taskId: "escortServiceOrders:e1", collection: "escortServiceOrders", sourceId: "e1", residentId: "r1", targetRole: "institution" };
  const conflictingEscortState = {
    escortServiceOrders: [{ id: "e1", residentId: "r1", providerId: "p1", institutionCode: "ORG-ORDER", hospitalCode: "MR1", taskAction: "quality-feedback" }],
    escortServiceProviders: [{ id: "p1", institutionCode: "ORG-PROVIDER" }]
  };
  assert.equal(residentServiceMessageTargetOrgCode(escortMessage, conflictingEscortState), "");
  assert.equal(residentServiceMessageTargetOrgCode({ ...nursingMessage, sourceId: "missing" }, nursingState), "");
});
