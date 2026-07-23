const assert = require("node:assert/strict");
const test = require("node:test");

const { buildAuthorizationRecord } = require("../citizen-records-v1");
const {
  allowedResidentIdsForCitizen,
  canCitizenReadRecord,
  canCitizenReadResident,
  buildCitizenControlledAccessIntent,
  evaluateCitizenRecordAccess,
  evaluateCitizenResidentRead,
  normalizeCitizenSupplement,
  projectCitizenRecordResponse
} = require("../citizen-records-policy");

const NOW = new Date("2026-07-22T09:00:00+08:00");
const citizen = { role: "citizen", username: "citizen-a", accountId: "a1", residentId: "r1" };

function authorization(overrides = {}) {
  const record = buildAuthorizationRecord({
    residentId: "r4",
    granteeName: "演示居民A账户",
    granteeId: "a1",
    granteeType: "family-member",
    purpose: "协助查看健康档案",
    scopes: ["health-record-summary"],
    expiresAt: "2026-12-31",
    grantedAt: "2026-07-22T08:00:00.000Z"
  });
  record.id = "auth-r4-a1";
  record.meta.granteeAccountId = "a1";
  return { ...record, ...overrides, meta: { ...record.meta, ...(overrides.meta || {}) } };
}

function dataWith(member, records = []) {
  return {
    accounts: [{ id: "a1", members: [{ residentId: "r1", relation: "本人" }, member] }],
    personalRecords: records
  };
}

test("citizen can always read self but account membership alone does not grant family access", () => {
  const data = dataWith({ residentId: "r4", relation: "母亲" });
  assert.equal(canCitizenReadResident(data, citizen, "r1", { now: NOW }), true);
  assert.deepEqual(evaluateCitizenResidentRead(data, citizen, "r4", { now: NOW }), {
    allowed: false,
    reason: "verified-relationship-required"
  });
  assert.deepEqual([...allowedResidentIdsForCitizen(data, citizen, { now: NOW })], ["r1"]);
});

test("family access requires both verified relationship evidence and active matching scope", () => {
  const verifiedMember = {
    residentId: "r4",
    relation: "母亲",
    relationshipStatus: "verified",
    verifiedAt: "2026-07-20T09:00:00.000Z",
    evidenceSource: "公安亲属关系核验回执"
  };
  assert.equal(canCitizenReadResident(dataWith(verifiedMember), citizen, "r4", { now: NOW }), false);
  assert.equal(canCitizenReadResident(dataWith(verifiedMember, [authorization()]), citizen, "r4", {
    now: NOW,
    scope: "health-record-summary"
  }), true);
  assert.equal(canCitizenReadResident(dataWith(verifiedMember, [authorization()]), citizen, "r4", {
    now: NOW,
    scope: "imaging-report"
  }), false);
  const wrongGrantee = authorization({ meta: { granteeId: "a2", granteeAccountId: "a2" } });
  assert.equal(canCitizenReadResident(dataWith(verifiedMember, [wrongGrantee]), citizen, "r4", {
    now: NOW,
    scope: "health-record-summary"
  }), false);
  const labAuthorization = authorization({ meta: { scopes: ["labs"] } });
  assert.equal(canCitizenReadRecord(dataWith(verifiedMember, [labAuthorization]), citizen, { residentId: "r4", category: "labs" }, { now: NOW }), true);
  assert.equal(canCitizenReadRecord(dataWith(verifiedMember, [labAuthorization]), citizen, { residentId: "r4", category: "medications" }, { now: NOW }), false);
  assert.equal(canCitizenReadResident(dataWith(verifiedMember, [authorization({ revokedAt: "2026-07-22T08:30:00.000Z" })]), citizen, "r4", { now: NOW }), false);
  assert.equal(canCitizenReadResident(dataWith(verifiedMember, [authorization({ meta: { expiresAt: "2026-07-21" }, date: "2026-07-21" })]), citizen, "r4", { now: NOW }), false);
});

test("future expiry never activates pending rejected or suspended family authorizations", () => {
  const verifiedMember = {
    residentId: "r4",
    relation: "母亲",
    relationshipStatus: "verified",
    verifiedAt: "2026-07-20T09:00:00.000Z",
    evidenceSource: "公安亲属关系核验回执"
  };

  for (const status of ["pending", "rejected", "suspended"]) {
    const record = authorization({ status, meta: { status, expiresAt: "2026-12-31" } });
    assert.equal(
      canCitizenReadResident(dataWith(verifiedMember, [record]), citizen, "r4", {
        now: NOW,
        scope: "health-record-summary"
      }),
      false,
      `${status} authorization must fail closed even with a future expiry`
    );
  }

  const active = authorization({ status: "active", meta: { status: "active", expiresAt: "2026-12-31" } });
  assert.equal(canCitizenReadResident(dataWith(verifiedMember, [active]), citizen, "r4", {
    now: NOW,
    scope: "health-record-summary"
  }), true);
});

test("family authorization scopes are exact allowlisted and never wildcard-expanded", () => {
  const verifiedMember = {
    residentId: "r4",
    relation: "母亲",
    relationshipStatus: "verified",
    verifiedAt: "2026-07-20T09:00:00.000Z",
    evidenceSource: "公安亲属关系核验回执"
  };
  const wildcard = authorization({ meta: { scopes: ["*"] } });
  assert.equal(canCitizenReadRecord(
    dataWith(verifiedMember, [wildcard]),
    citizen,
    { residentId: "r4", category: "labs" },
    { now: NOW }
  ), false);

  const mixedUnknown = authorization({ meta: { scopes: ["labs", "internal-all-records"] } });
  assert.equal(canCitizenReadRecord(
    dataWith(verifiedMember, [mixedUnknown]),
    citizen,
    { residentId: "r4", category: "labs" },
    { now: NOW }
  ), false);

  const attachments = authorization({ meta: { scopes: ["attachments"] } });
  const scopedData = dataWith(verifiedMember, [attachments]);
  assert.equal(canCitizenReadRecord(scopedData, citizen, { residentId: "r4", category: "attachments" }, { now: NOW }), true);
  assert.equal(canCitizenReadRecord(scopedData, citizen, { residentId: "r4", category: "imaging" }, { now: NOW }), false);
});

test("resident supplement normalization prevents authority impersonation and cross-resident writes", () => {
  const normalized = normalizeCitizenSupplement({
    residentId: "r1",
    category: "imaging",
    name: "个人补充的既往影像报告",
    result: "供医生复核",
    source: "医院PACS",
    meta: {
      authority: "clinical",
      sourceTrust: "clinical",
      objectPath: "oss://private/path",
      originalAvailable: true
    }
  }, citizen);

  assert.equal(normalized.source, "居民个人提供（待核验）");
  assert.equal(normalized.meta.authority, "resident-upload");
  assert.equal(normalized.meta.sourceTrust, "self-reported");
  assert.equal(normalized.meta.dataQualityStatus, "unverified");
  assert.equal(normalized.meta.originalAvailable, false);
  assert.equal("objectPath" in normalized.meta, false);
  assert.throws(() => normalizeCitizenSupplement({ residentId: "r1", category: "emr" }, citizen), /self-reported/);
  assert.throws(() => normalizeCitizenSupplement({ residentId: "r4", category: "labs" }, citizen), /self record/);
});

test("server response projection applies the same resident and field allowlist", () => {
  const record = {
    id: "record-r1",
    residentId: "r1",
    category: "labs",
    name: "肾功能",
    personIndex: "secret-index",
    meta: { reportNo: "LIS-001", uploadUrl: "https://storage.example/upload" }
  };
  const projected = projectCitizenRecordResponse(record, "r1");
  assert.equal(projected.meta.reportNo, "LIS-001");
  assert.equal("personIndex" in projected, false);
  assert.equal("uploadUrl" in projected.meta, false);
  assert.equal(projectCitizenRecordResponse(record, "r2"), null);
});

test("server integration decision returns an auditable fail-closed contract", () => {
  const verifiedMember = {
    residentId: "r4",
    relation: "母亲",
    relationshipStatus: "verified",
    verifiedAt: "2026-07-20T09:00:00.000Z",
    evidenceSource: "公安亲属关系核验回执"
  };
  const labAuthorization = authorization({ meta: { scopes: ["labs"] } });
  const access = evaluateCitizenRecordAccess(
    dataWith(verifiedMember, [labAuthorization]),
    citizen,
    { id: "lab-r4", residentId: "r4", category: "labs" },
    { now: NOW, purpose: "协助复诊" }
  );
  assert.equal(access.allowed, true);
  assert.equal(access.auditRequired, true);
  assert.equal(access.scope, "labs");

  const denied = evaluateCitizenRecordAccess(
    dataWith(verifiedMember, [labAuthorization]),
    citizen,
    { id: "attachment-r4", residentId: "r4", category: "attachments" },
    { now: NOW, purpose: "下载原文" }
  );
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "active-authorization-required");
});

test("server integration builds only a one-time short-lived controlled access request", () => {
  const verifiedMember = {
    residentId: "r4",
    relation: "母亲",
    relationshipStatus: "verified",
    verifiedAt: "2026-07-20T09:00:00.000Z",
    evidenceSource: "公安亲属关系核验回执"
  };
  const attachmentAuthorization = authorization({ meta: { scopes: ["attachments"] } });
  const intent = buildCitizenControlledAccessIntent(
    dataWith(verifiedMember, [attachmentAuthorization]),
    citizen,
    { id: "attachment-record-r4", residentId: "r4", category: "attachments" },
    {
      now: NOW,
      purpose: "协助复诊查看原文",
      resourceId: "attachment-r4",
      resourceType: "attachment",
      ttlSeconds: 900
    }
  );
  assert.equal(intent.oneTime, true);
  assert.equal(intent.ttlSeconds, 300);
  assert.equal(intent.auditRequired, true);
  assert.equal(Object.hasOwn(intent, "downloadUrl"), false);
});
