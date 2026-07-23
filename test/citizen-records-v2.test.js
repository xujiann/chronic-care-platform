"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const V1 = require("../citizen-records-v1");
const V2 = require("../citizen-records-v2");

const now = new Date("2026-07-23T08:00:00.000Z");

function activeAuthorization(overrides = {}) {
  return {
    residentId: "resident-owner",
    category: "authorizations",
    status: "active",
    date: "2026-07-30",
    meta: {
      status: "active",
      granteeId: "account-family",
      scopes: ["labs"],
      expiresAt: "2026-07-30",
      ...overrides.meta
    },
    ...overrides
  };
}

function verifiedRelationship(overrides = {}) {
  return {
    residentId: "resident-owner",
    relation: "子女",
    relationshipStatus: "verified",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    evidenceSource: "政务关系核验",
    ...overrides
  };
}

test("1. protected access requires relationship, active scoped authorization and matching grantee", () => {
  const base = {
    actor: { role: "citizen", residentId: "resident-family", accountId: "account-family" },
    residentId: "resident-owner",
    record: { residentId: "resident-owner", category: "labs" },
    relationship: verifiedRelationship(),
    authorization: activeAuthorization(),
    purpose: "协助复诊",
    now
  };
  assert.equal(V2.evaluateProtectedAccess(base).allowed, true);
  assert.equal(V2.evaluateProtectedAccess({ ...base, actor: { ...base.actor, role: "doctor" } }).reason, "citizen-role-required");
  assert.equal(V2.evaluateProtectedAccess({ ...base, authorization: activeAuthorization({ status: "pending", meta: { status: "pending" } }) }).allowed, false);
  assert.equal(V2.evaluateProtectedAccess({ ...base, authorization: activeAuthorization({ meta: { status: "active", granteeId: "other", scopes: ["labs"], expiresAt: "2026-07-30" } }) }).reason, "grantee-mismatch");
  assert.equal(V2.evaluateProtectedAccess({ ...base, authorization: activeAuthorization({ meta: { status: "active", granteeId: "account-family", scopes: ["emr-summary"], expiresAt: "2026-07-30" } }) }).reason, "scope-denied");
});

test("2. institution records deduplicate by source identity and keep latest provenance", () => {
  const merged = V2.mergeInstitutionRecords([
    { id: "local-1", residentId: "r1", source: "医院A", updatedAt: "2026-01-01", meta: { sourceSystem: "EMR", sourceRecordId: "visit-1", version: 1 } },
    { id: "local-2", residentId: "r1", source: "医院A", updatedAt: "2026-02-01", result: "更正摘要", meta: { sourceSystem: "EMR", sourceRecordId: "visit-1", version: 2, sourceTrust: "clinical" } },
    { id: "local-3", residentId: "r1", source: "医院B", updatedAt: "2026-01-15", meta: { sourceSystem: "LIS", sourceRecordId: "lab-1" } },
    { id: "local-4", residentId: "r2", source: "医院B", updatedAt: "2026-01-16", meta: { sourceSystem: "LIS", sourceRecordId: "lab-1" } }
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((item) => item.provenance.sourceRecordId === "visit-1").result, "更正摘要");
  assert.deepEqual(merged.find((item) => item.provenance.sourceRecordId === "visit-1").provenance, {
    sourceSystem: "EMR",
    sourceOrganization: "医院A",
    sourceRecordId: "visit-1",
    version: "2",
    lastSynchronizedAt: "2026-02-01",
    trust: "clinical"
  });
});

test("3. controlled access intent is one-time, audited and capped at five minutes", () => {
  const intent = V2.buildControlledAccessIntent({
    accessDecision: { allowed: true, residentId: "r1", scope: "attachments", purpose: "复诊" },
    resourceId: "attachment-1",
    resourceType: "attachment",
    purpose: "复诊查看原文",
    ttlSeconds: 3600
  });
  assert.equal(intent.ttlSeconds, 300);
  assert.equal(intent.oneTime, true);
  assert.equal(intent.credentialStatus, "pending-server-issuance");
  assert.equal(Object.hasOwn(intent, "url"), false);
  assert.throws(() => V2.buildControlledAccessIntent({
    accessDecision: { allowed: false },
    resourceId: "attachment-1",
    resourceType: "attachment",
    purpose: "复诊"
  }), /未获授权/);
});

test("4. guardian relationship fails closed after adulthood transition or missing evidence", () => {
  assert.equal(V2.relationshipAccessState(verifiedRelationship(), now).active, true);
  assert.equal(V2.relationshipAccessState(verifiedRelationship({ evidenceSource: "" }), now).reason, "evidence-required");
  assert.equal(V2.relationshipAccessState(verifiedRelationship({
    relation: "监护人",
    subjectBecameAdultAt: "2026-07-01"
  }), now).reason, "adult-transition-review");
  assert.equal(V2.relationshipAccessState(verifiedRelationship({ expiresAt: "2026-07-01" }), now).reason, "expired");
});

test("5. abnormal results create care tasks without generating clinical advice", () => {
  const tasks = V2.buildAbnormalCareTasks([
    { id: "lab-1", residentId: "r1", category: "labs", name: "血钾", result: "危急值，已由报告机构复核", meta: { severity: "critical" } },
    { id: "lab-2", residentId: "r1", category: "labs", name: "血糖", result: "偏高" },
    { id: "lab-3", residentId: "r1", category: "labs", name: "血常规", result: "未见明显异常", status: "正常" }
  ], now);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].severity, "critical");
  assert.match(tasks[0].clinicalBoundary, /不由居民端生成诊断/);
  assert.deepEqual(tasks[1].actions, ["查看报告", "联系医生", "预约复诊", "完成随访"]);
});

test("6. EMR summary keeps structured resident-readable fields and version", () => {
  const summary = V2.structuredEmrSummary({
    id: "emr-1",
    residentId: "r1",
    category: "emr",
    date: "2026-07-01",
    source: "医院A",
    result: "继续随访",
    meta: {
      visitType: "门诊",
      department: "心内科",
      chiefComplaint: "复诊",
      diagnoses: ["高血压"],
      orders: ["复查血压"],
      followupPlan: "两周后复诊",
      version: 3,
      authority: "clinical"
    }
  });
  assert.equal(summary.department, "心内科");
  assert.deepEqual(summary.diagnoses, ["高血压"]);
  assert.equal(summary.correctedVersion, "3");
  assert.equal(V2.structuredEmrSummary({ category: "labs" }), null);
});

test("7. medication reconciliation flags duplicate, self-reported and allergy review", () => {
  const result = V2.reconcileMedicationList([
    { id: "m1", name: "阿司匹林片", source: "医院", meta: { authority: "clinical" } },
    { id: "m2", name: "阿司匹林", source: "居民", meta: { authority: "resident-upload" } }
  ], [{ name: "阿司匹林过敏" }]);
  assert.equal(result.reviewRequired, true);
  assert.ok(result.flags.includes("duplicate-source"));
  assert.ok(result.flags.includes("self-reported-review"));
  assert.ok(result.flags.includes("allergy-review"));
  assert.match(result.clinicalBoundary, /医生或药师/);
});

test("8. correction requests preserve originals and enforce state transitions", () => {
  const request = V2.buildCorrectionRequest({
    recordId: "emr-1",
    residentId: "r1",
    field: "diagnosis",
    requestedValue: "待机构核对",
    reason: "本人认为诊断表述有误",
    submittedAt: now,
    sourceVersion: 2
  });
  assert.equal(request.overwriteOriginal, false);
  const accepted = V2.transitionCorrectionRequest(request, "accepted", "2026-07-23T09:00:00Z");
  assert.equal(accepted.status, "accepted");
  assert.throws(() => V2.transitionCorrectionRequest(request, "corrected"), /不允许/);
});

test("9. trends and disease topics retain source trust and related records", () => {
  const records = [
    { id: "r1", category: "labs", date: "2026-01-01", name: "高血压复查", result: "稳定", metrics: { systolic: 150 }, meta: { sourceTrust: "clinical", diagnoses: ["高血压"] } },
    { id: "r2", category: "physical-exam", date: "2026-07-01", name: "年度体检", result: "高血压随访", metrics: { systolic: 135 }, meta: { sourceTrust: "self-reported" } }
  ];
  const trends = V2.buildMetricTrends(records, ["systolic"]);
  assert.equal(trends[0].latest, 135);
  assert.equal(trends[0].points[0].sourceTrust, "clinical");
  const topic = V2.buildDiseaseTopic({ id: "d1", type: "高血压", status: "管理中" }, records);
  assert.deepEqual(topic.recordIds, ["r1", "r2"]);
  assert.deepEqual(topic.categories, ["labs", "physical-exam"]);
});

test("10. completeness produces score and stale or missing reminders", () => {
  const result = V2.assessRecordCompleteness({
    residentId: "r1",
    resident: { id: "r1", identityVerified: true },
    records: [
      { residentId: "r1", category: "emr", date: "2026-07-01" },
      { residentId: "r1", category: "labs", date: "2024-01-01" }
    ],
    now
  });
  assert.equal(result.score, 38);
  assert.ok(result.reminders.includes("检验检查超过18个月未更新"));
  assert.ok(result.reminders.includes("待补齐用药记录"));
});

test("11. one-time share packages have minimal scopes, seven-day maximum and revocation", () => {
  const packageRecord = V2.buildSharePackage({
    residentId: "r1",
    granteeId: "hospital-a",
    purpose: "转诊",
    scopes: ["emr-summary", "labs"],
    createdAt: now,
    expiresAt: "2026-07-25T08:00:00Z"
  });
  assert.equal(V2.sharePackageState(packageRecord, now).active, true);
  assert.equal(packageRecord.oneTimeCodeRequired, true);
  const revoked = V2.revokeSharePackage(packageRecord, "2026-07-23T09:00:00Z");
  assert.equal(V2.sharePackageState(revoked, now).active, false);
  assert.throws(() => V2.buildSharePackage({
    residentId: "r1",
    granteeId: "hospital-a",
    purpose: "转诊",
    scopes: ["*"],
    createdAt: now,
    expiresAt: "2026-07-24T08:00:00Z"
  }), /范围不受支持/);
  assert.throws(() => V2.buildSharePackage({
    residentId: "r1",
    granteeId: "hospital-a",
    purpose: "转诊",
    scopes: ["labs"],
    createdAt: now,
    expiresAt: "2026-08-01T08:00:00Z"
  }), /未来7天内/);
});

test("12. accessibility preferences clamp text size and retain safety confirmations", () => {
  assert.deepEqual(V2.normalizeAccessibilityPreferences({
    simpleMode: true,
    highContrast: true,
    textScale: 2,
    readAloud: true,
    confirmSensitiveActions: false
  }), {
    simpleMode: true,
    highContrast: true,
    textScale: 1.5,
    readAloud: true,
    confirmSensitiveActions: false,
    currentSubjectBanner: true
  });
});

test("resident write actions carry stable idempotency metadata", () => {
  const action = V2.buildIdempotentAction({
    operation: "share-create",
    residentId: "r1",
    nonce: "request-001",
    requestedAt: now,
    payload: { purpose: "转诊" }
  });
  assert.equal(action.purpose, "转诊");
  assert.equal(action.requestedAt, now.toISOString());
  assert.equal(action.idempotencyKey, "citizen-share-create-r1-1784793600000-request-001");
  assert.throws(() => V2.buildIdempotentAction({ operation: "share-create", residentId: "r1" }), /请求标识/);
});

test("correction and share receipts cannot overwrite resident security fields", () => {
  const correction = V2.buildCorrectionRequest({
    recordId: "emr-1",
    residentId: "r1",
    field: "summary",
    reason: "摘要不一致",
    submittedAt: now
  });
  const correctedReceipt = V2.projectCorrectionReceipt({
    status: "accepted",
    residentId: "r1",
    recordId: "emr-1",
    receiptId: "receipt-1",
    auditRef: "audit-1",
    reason: "恶意覆盖"
  }, correction);
  assert.equal(correctedReceipt.reason, "摘要不一致");
  assert.equal(correctedReceipt.receiptId, "receipt-1");
  assert.equal(correctedReceipt.auditRef, "audit-1");
  assert.throws(() => V2.projectCorrectionReceipt({ status: "accepted", residentId: "r2" }, correction), /居民不匹配/);
  assert.throws(() => V2.projectCorrectionReceipt({ status: "accepted", residentId: "r1", auditRef: "audit-only" }, correction), /受理编号/);

  const share = V2.buildSharePackage({
    residentId: "r1",
    granteeId: "hospital-a",
    purpose: "转诊",
    scopes: ["labs"],
    createdAt: now,
    expiresAt: "2026-07-24T08:00:00Z"
  });
  const shareReceipt = V2.projectSharePackageReceipt({
    status: "active",
    residentId: "r1",
    granteeId: "attacker",
    scopes: ["*"],
    expiresAt: "2099-01-01",
    accessRef: "HP-SERVER",
    receiptId: "receipt-share",
    auditRef: "audit-share"
  }, share);
  assert.equal(shareReceipt.granteeId, "hospital-a");
  assert.deepEqual(shareReceipt.scopes, ["labs"]);
  assert.equal(shareReceipt.expiresAt, share.expiresAt);
  assert.equal(shareReceipt.accessRef, "HP-SERVER");
});

test("controlled credentials require one-time HTTPS, short expiry, matching resource and audit", () => {
  const intent = V2.buildControlledAccessIntent({
    accessDecision: { allowed: true, residentId: "r1", scope: "attachments", purpose: "复诊" },
    resourceId: "attachment-1",
    resourceType: "attachment",
    purpose: "复诊查看原文",
    ttlSeconds: 300
  });
  const valid = V2.validateControlledCredential({
    downloadIntent: {
      downloadUrl: "https://records.example/short/abc",
      expiresAt: "2026-07-23T08:04:00Z",
      oneTime: true,
      resourceId: "attachment-1",
      scope: "attachments",
      auditRef: "audit-download-1"
    }
  }, intent, {
    now,
    baseUrl: "https://resident.example/",
    allowedOrigins: ["https://records.example"]
  });
  assert.equal(valid.url, "https://records.example/short/abc");
  assert.equal(valid.oneTime, true);
  assert.equal(valid.auditRef, "audit-download-1");
  assert.throws(() => V2.validateControlledCredential({
    url: "javascript:alert(1)",
    expiresAt: "2026-07-23T08:01:00Z",
    oneTime: true,
    auditRef: "audit-1"
  }, intent, { now, baseUrl: "https://resident.example/" }), /HTTPS/);
  assert.throws(() => V2.validateControlledCredential({
    url: "https://evil.example/short",
    expiresAt: "2026-07-23T08:01:00Z",
    oneTime: true,
    auditRef: "audit-1"
  }, intent, { now, baseUrl: "https://resident.example/" }), /允许域名/);
  assert.throws(() => V2.validateControlledCredential({
    url: "https://resident.example/short",
    expiresAt: "2026-07-23T08:10:00Z",
    oneTime: true,
    auditRef: "audit-1"
  }, intent, { now, baseUrl: "https://resident.example/" }), /有效期/);
  assert.throws(() => V2.validateControlledCredential({
    url: "https://resident.example/short",
    expiresAt: "2026-07-23T08:01:00Z",
    oneTime: false,
    auditRef: "audit-1"
  }, intent, { now, baseUrl: "https://resident.example/" }), /单次标识/);
});

test("care workspace sync projection is resident scoped and strips secrets", () => {
  const projected = V2.projectCareWorkspacePayload({
    corrections: [
      { id: "c1", residentId: "r1", recordId: "emr-1", field: "summary", reason: "不一致", status: "accepted", receiptId: "receipt-c1", auditRef: "audit-c1", internalAssignee: "secret" },
      { id: "c2", residentId: "r2", recordId: "emr-2", field: "summary", reason: "other", status: "accepted" }
    ],
    sharePackages: [
      { id: "s1", residentId: "r1", granteeId: "hospital-a", purpose: "转诊", scopes: ["labs"], status: "active", expiresAt: "2026-07-24T08:00:00Z", accessRef: "HP-1", oneTimeCode: "SECRET", downloadUrl: "https://secret.example" },
      { id: "s2", residentId: "r1", granteeId: "hospital-a", purpose: "越权", scopes: ["labs", "*"], status: "active", expiresAt: "2026-07-24T08:00:00Z" }
    ],
    taskUpdates: {
      "care-task-1": { residentId: "r1", status: "completed", completedAt: "2026-07-23T09:00:00Z", auditRef: "audit-task" },
      "care-task-2": { residentId: "r2", status: "completed" }
    },
    accessAcknowledgements: [
      { id: "ack-1", residentId: "r1", accessLogId: "access-1", decision: "recognized", status: "accepted", auditRef: "audit-ack", internalNote: "secret" },
      { id: "ack-2", residentId: "r2", accessLogId: "access-2", status: "accepted" }
    ],
    accessDisputes: [
      { id: "dispute-1", residentId: "r1", accessLogId: "access-3", category: "unknown-actor", reason: "无法确认", status: "processing", auditRef: "audit-dispute", investigator: "secret" }
    ],
    syncedAt: "2026-07-23T09:05:00Z",
    cursor: "cursor-1",
    databaseToken: "SECRET"
  }, "r1");
  assert.deepEqual(projected.recordCorrections.map((item) => item.id), ["c1"]);
  assert.equal("internalAssignee" in projected.recordCorrections[0], false);
  assert.deepEqual(projected.recordSharePackages.map((item) => item.id), ["s1"]);
  assert.equal("oneTimeCode" in projected.recordSharePackages[0], false);
  assert.equal("downloadUrl" in projected.recordSharePackages[0], false);
  assert.deepEqual(Object.keys(projected.careTaskUpdates), ["care-task-1"]);
  assert.deepEqual(projected.accessAcknowledgements.map((item) => item.id), ["ack-1"]);
  assert.equal("internalNote" in projected.accessAcknowledgements[0], false);
  assert.deepEqual(projected.accessDisputes.map((item) => item.id), ["dispute-1"]);
  assert.equal("investigator" in projected.accessDisputes[0], false);
  assert.equal("databaseToken" in projected, false);
  assert.equal(projected.sync.cursor, "cursor-1");
});

test("server-synced care state wins conflicts while preserving unsynced local rows", () => {
  const merged = V2.mergeCareWorkspaceState({
    recordCorrections: [
      { id: "c1", status: "submitted", updatedAt: "2026-07-23T10:00:00Z", reason: "local" },
      { id: "c-local", status: "submitted", updatedAt: "2026-07-23T10:01:00Z" }
    ],
    recordSharePackages: [],
    careTaskUpdates: { task1: { status: "in-progress", updatedAt: "2026-07-23T10:00:00Z" } }
  }, {
    recordCorrections: [{ id: "c1", status: "accepted", updatedAt: "2026-07-23T09:00:00Z", reason: "server", syncStatus: "server-synced" }],
    recordSharePackages: [{ id: "s1", status: "active", syncStatus: "server-synced" }],
    careTaskUpdates: { task1: { status: "completed", updatedAt: "2026-07-23T09:00:00Z", syncStatus: "server-synced" } },
    sync: { cursor: "next" }
  });
  assert.equal(merged.recordCorrections.find((item) => item.id === "c1").status, "accepted");
  assert.equal(merged.recordCorrections.some((item) => item.id === "c-local"), true);
  assert.equal(merged.careTaskUpdates.task1.status, "completed");
  assert.equal(merged.sync.cursor, "next");
});

test("static care preview metadata expires within 24 hours", () => {
  const metadata = V2.buildCarePreviewMetadata(now, 48);
  assert.equal(metadata.expiresAt, "2026-07-24T08:00:00.000Z");
  assert.equal(V2.isCarePreviewExpired(metadata, "2026-07-24T07:59:59Z"), false);
  assert.equal(V2.isCarePreviewExpired(metadata, "2026-07-24T08:00:00Z"), true);
  assert.equal(V2.isCarePreviewExpired({}, now), true);
});

test("access review queue distinguishes blocked, recognized and unverified access", () => {
  const authorization = activeAuthorization({
    residentId: "r1",
    name: "hospital-a",
    meta: {
      status: "active",
      granteeId: "hospital-a",
      scopes: ["labs"],
      expiresAt: "2026-07-30"
    }
  });
  const queue = V2.buildAccessReviewQueue([
    { id: "access-1", residentId: "r1", at: "2026-07-23T08:00:00Z", actor: "hospital-a", role: "医疗机构", scope: "检验检查", purpose: "复诊", result: "允许" },
    { id: "access-2", residentId: "r1", at: "2026-07-23T09:00:00Z", actor: "unknown", role: "机构", scope: "内部全量", purpose: "查询", result: "允许" },
    { id: "access-3", residentId: "r1", at: "2026-07-23T10:00:00Z", actor: "unknown", role: "机构", scope: "电子病历摘要", purpose: "查询", result: "拒绝" }
  ], "r1", [authorization], now);
  assert.equal(queue[0].reviewState, "blocked");
  assert.equal(queue[0].disclosed, false);
  assert.equal(queue[1].reason, "unknown-scope");
  assert.equal(queue[2].reviewState, "recognized");
  assert.equal(queue[2].scope, "labs");
  const pending = V2.classifyAccessEvent({
    id: "access-pending",
    residentId: "r1",
    actor: "hospital-a",
    scope: "检验检查",
    purpose: "复诊",
    result: "待核验"
  }, [authorization], now);
  assert.equal(pending.reason, "result-unverified");
  assert.equal(pending.disclosed, null);
});

test("resident can acknowledge or dispute access with immutable receipt fields", () => {
  const acknowledgement = V2.buildAccessAcknowledgement({
    residentId: "r1",
    accessLogId: "access-1",
    acknowledgedAt: now
  });
  assert.equal(acknowledgement.decision, "recognized");
  const dispute = V2.buildAccessDispute({
    residentId: "r1",
    accessLogId: "access-2",
    category: "unknown-actor",
    reason: "本人不认识该访问主体",
    contactPreference: "phone",
    submittedAt: now
  });
  const receipt = V2.projectAccessReviewActionReceipt({
    status: "accepted",
    residentId: "r1",
    resourceId: "access-2",
    receiptId: "receipt-dispute",
    auditRef: "audit-dispute",
    reason: "恶意覆盖"
  }, dispute);
  assert.equal(receipt.reason, "本人不认识该访问主体");
  assert.equal(receipt.auditRef, "audit-dispute");
  assert.throws(() => V2.buildAccessDispute({
    residentId: "r1",
    accessLogId: "access-2",
    category: "unsupported",
    reason: "test"
  }), /异议类型/);
  assert.throws(() => V2.projectAccessReviewActionReceipt({
    status: "accepted",
    residentId: "r2",
    resourceId: "access-2",
    receiptId: "receipt",
    auditRef: "audit"
  }, dispute), /居民不匹配/);
});

test("access export contains only minimized resident-readable columns", () => {
  const rows = V2.buildAccessExportRows([{
    eventId: "secret-event-id",
    residentId: "r1",
    at: "2026-07-23T08:00:00Z",
    actor: "医院A",
    role: "医疗机构",
    scope: "labs",
    purpose: "复诊",
    result: "允许",
    label: "授权匹配",
    auditHash: "secret"
  }]);
  assert.deepEqual(Object.keys(rows[0]), ["time", "actor", "role", "scope", "purpose", "result", "review"]);
  assert.equal("eventId" in rows[0], false);
  assert.equal("auditHash" in rows[0], false);
});

test("record search stays resident scoped and filters only minimized display fields", () => {
  const records = [
    {
      id: "lab-r1",
      residentId: "r1",
      category: "labs",
      date: "2026-07-20",
      name: "心电图检查",
      result: "窦性心律",
      source: "大连市中心医院 LIS",
      meta: { reportNo: "ECG-001", objectKey: "secret-object-key" }
    },
    {
      id: "self-r1",
      residentId: "r1",
      category: "labs",
      date: "2026-07-21",
      name: "家庭血糖",
      result: "6.2 mmol/L",
      source: "居民个人提供（待核验）",
      meta: {}
    },
    {
      id: "lab-r2",
      residentId: "r2",
      category: "labs",
      date: "2026-07-20",
      name: "心电图检查",
      result: "其他居民记录",
      source: "大连市中心医院 LIS",
      meta: { reportNo: "ECG-OTHER" }
    }
  ];

  const filtered = V2.filterResidentRecords(records, {
    residentId: "r1",
    keyword: "ecg-001",
    trust: "authoritative",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31"
  });
  assert.equal(filtered.total, 2);
  assert.equal(filtered.matched, 1);
  assert.equal(filtered.items[0].id, "lab-r1");
  assert.equal(filtered.applied, true);
  assert.equal(V2.filterResidentRecords(records, { residentId: "r1", keyword: "secret-object-key" }).matched, 0);
  assert.equal(V2.filterResidentRecords(records, { residentId: "r1", trust: "self-reported" }).items[0].id, "self-r1");
});

test("record search rejects inverted date ranges without leaking results", () => {
  const result = V2.filterResidentRecords([
    { id: "lab-r1", residentId: "r1", category: "labs", date: "2026-07-20", name: "检验", source: "医院 LIS" }
  ], {
    residentId: "r1",
    dateFrom: "2026-07-31",
    dateTo: "2026-07-01"
  });
  assert.equal(result.invalidRange, true);
  assert.equal(result.matched, 0);
  assert.deepEqual(result.items, []);
});

test("authorization scope disclosure explains inclusions and exclusions without broadening scopes", () => {
  const disclosure = V2.buildAuthorizationScopeDisclosure([
    "health-record-summary",
    "attachments",
    "attachments"
  ]);
  assert.equal(disclosure.selectedCount, 2);
  assert.deepEqual(disclosure.items.map((item) => item.scope), ["health-record-summary", "attachments"]);
  assert.match(disclosure.items[0].allows, /健康指标/);
  assert.match(disclosure.items[0].excludes, /不包含医院原始病历/);
  assert.match(disclosure.items[1].excludes, /不自动包含影像原图/);
  assert.match(disclosure.boundary, /服务端再次校验/);
  assert.equal(V2.buildAuthorizationScopeDisclosure([]).selectedCount, 0);
  assert.throws(() => V2.buildAuthorizationScopeDisclosure(["labs", "internal-all-records"]), /未知范围/);
});

test("authorization create response preserves the resident request and strips server internals", () => {
  const request = V1.buildAuthorizationRecord({
    residentId: "r1",
    granteeName: "家庭医生团队",
    granteeId: "team-r1",
    granteeType: "care-team",
    purpose: "慢病复诊",
    scopes: ["health-record-summary", "labs"],
    expiresAt: "2027-12-31",
    grantedAt: "2026-07-23T08:00:00.000Z"
  });
  const projected = V2.projectAuthorizationCreateResponse({
    ...request,
    id: "auth-created-1",
    receiptId: "receipt-auth-create-1",
    auditRef: "audit-auth-create-1",
    personIndex: "must-not-pass",
    meta: { ...request.meta, objectKey: "must-not-pass" }
  }, request);
  assert.equal(projected.id, "auth-created-1");
  assert.equal(projected.residentId, "r1");
  assert.equal(projected.meta.granteeId, "team-r1");
  assert.equal(projected.receiptId, "receipt-auth-create-1");
  assert.equal(projected.auditRef, "audit-auth-create-1");
  assert.doesNotMatch(JSON.stringify(projected), /personIndex|objectKey|must-not-pass/);
  assert.throws(() => V2.projectAuthorizationCreateResponse({
    ...request,
    id: "auth-created-2",
    receiptId: "receipt-auth-create-2",
    auditRef: "audit-auth-create-2",
    meta: { ...request.meta, granteeId: "attacker-team" }
  }, request), /granteeId不匹配/);
  assert.throws(() => V2.projectAuthorizationCreateResponse({
    ...request,
    id: "auth-created-3",
    receiptId: "receipt-auth-create-3",
    auditRef: "audit-auth-create-3",
    residentId: "r2"
  }, request), /居民或分类不匹配/);
  assert.throws(() => V2.projectAuthorizationCreateResponse({
    ...request,
    id: "auth-created-no-receipt"
  }, request));
});

test("authorization revoke response cannot alter immutable authorization fields", () => {
  const record = {
    ...V1.buildAuthorizationRecord({
      residentId: "r1",
      granteeName: "医院A",
      granteeId: "hospital-a",
      granteeType: "institution",
      purpose: "复诊资料核对",
      scopes: ["emr-summary"],
      expiresAt: "2027-12-31",
      grantedAt: "2026-07-23T08:00:00.000Z"
    }),
    id: "auth-revoke-1"
  };
  const revoked = V2.projectAuthorizationRevocationResponse({
    ...record,
    name: "恶意覆盖对象",
    status: "已撤销",
    revokedAt: "2026-07-24T01:00:00.000Z",
    receiptId: "receipt-auth-revoke-1",
    auditRef: "audit-auth-revoke-1",
    revokeReason: "居民主动撤销",
    meta: { ...record.meta, status: "active", objectKey: "must-not-pass" }
  }, record, "居民主动撤销");
  assert.equal(revoked.name, "医院A");
  assert.equal(revoked.meta.granteeId, "hospital-a");
  assert.equal(revoked.receiptId, "receipt-auth-revoke-1");
  assert.equal(revoked.auditRef, "audit-auth-revoke-1");
  assert.equal(V1.authorizationState(revoked).key, "revoked");
  assert.doesNotMatch(JSON.stringify(revoked), /恶意覆盖对象|objectKey|must-not-pass/);
  assert.throws(() => V2.projectAuthorizationRevocationResponse({
    ...record,
    status: "active",
    revokedAt: "",
    receiptId: "receipt-auth-revoke-invalid",
    auditRef: "audit-auth-revoke-invalid"
  }, record, "居民主动撤销"), /未确认撤销状态/);
  assert.throws(() => V2.projectAuthorizationRevocationResponse({
    ...record,
    status: "revoked",
    revokedAt: "2026-07-24T01:00:00.000Z",
    revokeReason: "resident-requested"
  }, record, "resident-requested"));
});

test("authorization lifecycle highlights expiring and incomplete records", () => {
  const expiring = activeAuthorization({
    id: "auth-expiring",
    residentId: "r1",
    name: "医院A",
    date: "2026-07-30",
    meta: {
      status: "active",
      granteeId: "hospital-a",
      granteeType: "institution",
      purpose: "复诊",
      scopes: ["labs"],
      expiresAt: "2026-07-30"
    }
  });
  const incomplete = {
    id: "auth-legacy",
    residentId: "r1",
    category: "authorizations",
    name: "历史团队",
    status: "active",
    date: "2026-12-31",
    meta: { status: "active", expiresAt: "2026-12-31" }
  };
  const lifecycle = V2.buildAuthorizationLifecycle([expiring, incomplete], now, 30);
  assert.equal(lifecycle.expiring, 1);
  assert.equal(lifecycle.incomplete, 1);
  assert.equal(lifecycle.active, 1);
  assert.equal(lifecycle.items[0].lifecycleKey, "expiring");
  assert.equal(lifecycle.items[1].renewEligible, false);
  assert.equal(lifecycle.items[1].active, false);
  assert.equal("sourceRecord" in lifecycle.items[0], false);
});

test("authorization lifecycle counts only explicit active states with future expiry", () => {
  const future = "2026-08-30";
  const records = ["active", "pending", "rejected", "suspended"].map((status) => activeAuthorization({
    id: `auth-${status}`,
    status,
    date: future,
    meta: {
      status,
      granteeId: `team-${status}`,
      granteeType: "care-team",
      purpose: "慢病复诊",
      scopes: ["health-record-summary"],
      expiresAt: future
    }
  }));
  const lifecycle = V2.buildAuthorizationLifecycle(records, now, 30);
  assert.equal(lifecycle.active, 1);
  assert.equal(lifecycle.items.filter((item) => item.active).length, 1);
  ["pending", "rejected", "suspended"].forEach((status) => {
    assert.equal(lifecycle.items.find((item) => item.id === `auth-${status}`).lifecycleKey, "inactive");
  });
});

test("authorization lifecycle uses calendar-day expiry boundaries consistently", () => {
  const reference = new Date("2026-07-23T22:00:00+08:00");
  const record = (id, expiresAt) => activeAuthorization({
    id,
    date: expiresAt,
    meta: {
      status: "active",
      granteeId: `team-${id}`,
      granteeType: "care-team",
      purpose: "慢病复诊",
      scopes: ["health-record-summary"],
      expiresAt
    }
  });
  const lifecycle = V2.buildAuthorizationLifecycle([
    record("today", "2026-07-23"),
    record("day-30", "2026-08-22"),
    record("day-31", "2026-08-23")
  ], reference, 30);
  assert.equal(lifecycle.items.find((item) => item.id === "today").lifecycleKey, "expiring");
  assert.equal(lifecycle.items.find((item) => item.id === "today").remainingDays, 0);
  assert.equal(lifecycle.items.find((item) => item.id === "day-30").lifecycleKey, "expiring");
  assert.equal(lifecycle.items.find((item) => item.id === "day-30").remainingDays, 30);
  assert.equal(lifecycle.items.find((item) => item.id === "day-31").lifecycleKey, "active");
});

test("authorization renewal is an explicit new consent draft without an expiry", () => {
  const record = activeAuthorization({
    id: "auth-renew",
    residentId: "r1",
    name: "医院A",
    meta: {
      status: "active",
      granteeId: "hospital-a",
      granteeType: "institution",
      purpose: "复诊资料核对",
      scopes: ["emr-summary", "labs"],
      expiresAt: "2026-07-30"
    }
  });
  const draft = V2.buildAuthorizationRenewalDraft(record);
  assert.equal(draft.previousAuthorizationId, "auth-renew");
  assert.equal(draft.granteeId, "hospital-a");
  assert.deepEqual(draft.scopes, ["emr-summary", "labs"]);
  assert.equal(draft.expiresAt, "");
  assert.equal(draft.consentConfirmed, false);
  assert.throws(() => V2.buildAuthorizationRenewalDraft({
    id: "legacy",
    residentId: "r1",
    category: "authorizations",
    status: "active",
    date: "2026-12-31",
    meta: { status: "active", expiresAt: "2026-12-31" }
  }), /重新核验对象/);
});

test("workspace summary composes deduplication, care tasks, EMR and completeness", () => {
  const result = V2.summarizeCareWorkspace({
    residentId: "r1",
    resident: { id: "r1", identityVerified: true },
    records: [
      { id: "e1", residentId: "r1", category: "emr", date: "2026-07-01", source: "医院A", result: "高血压复诊", meta: { sourceSystem: "EMR", sourceRecordId: "e1", authority: "clinical" } },
      { id: "l1", residentId: "r1", category: "labs", date: "2026-07-20", source: "医院A", result: "血糖偏高", meta: { sourceSystem: "LIS", sourceRecordId: "l1" } }
    ],
    diseases: [{ id: "d1", type: "高血压" }],
    now
  });
  assert.equal(result.records.length, 2);
  assert.equal(result.careTasks.length, 1);
  assert.equal(result.emr.length, 1);
  assert.equal(result.diseaseTopics.length, 1);
});

test("V2 scope mapping stays aligned with V1 authorization whitelist", () => {
  assert.deepEqual([...V2.ACCESS_SCOPES].sort(), [...V1.RESIDENT_AUTHORIZATION_SCOPES].sort());
});
