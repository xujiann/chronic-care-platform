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
