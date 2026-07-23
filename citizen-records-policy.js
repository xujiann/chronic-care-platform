"use strict";

const CitizenRecordsV1 = require("./citizen-records-v1");

const CITIZEN_SUPPLEMENT_CATEGORIES = new Set([
  "labs",
  "medications",
  "imaging",
  "attachments",
  "physical-exam",
  "allergies",
  "vaccines",
  "admissions"
]);

const AUTHORITY_ONLY_CATEGORIES = new Set(["emr", "authorizations"]);

function cleanText(value, maximum = 300) {
  return String(value ?? "").trim().slice(0, maximum);
}

function isVerifiedRelationship(member = {}) {
  const status = cleanText(member.relationshipStatus || member.verificationStatus || member.status, 60);
  const verified = /^(verified|confirmed|核验通过|已核验)$/i.test(status);
  const evidence = cleanText(member.evidenceSource || member.evidenceId || member.verificationEvidence, 200);
  return Boolean(member.residentId && verified && member.verifiedAt && evidence);
}

function authorizationTargetsUser(record = {}, user = {}) {
  const meta = record.meta || {};
  const granteeIds = new Set([
    meta.granteeId,
    meta.granteeResidentId,
    meta.granteeAccountId
  ].map((value) => cleanText(value, 160)).filter(Boolean));
  return [user.username, user.id, user.residentId, user.accountId]
    .map((value) => cleanText(value, 160))
    .filter(Boolean)
    .some((value) => granteeIds.has(value));
}

function authorizationHasScope(record = {}, scope = "health-record-summary") {
  const requestedScope = cleanText(scope, 100);
  if (!CitizenRecordsV1.RESIDENT_AUTHORIZATION_SCOPES.has(requestedScope)) return false;
  const scopes = (Array.isArray(record.meta?.scopes) ? record.meta.scopes : [])
    .map((item) => cleanText(item, 100))
    .filter(Boolean);
  if (!scopes.length || scopes.some((item) => !CitizenRecordsV1.RESIDENT_AUTHORIZATION_SCOPES.has(item))) return false;
  return scopes.includes(requestedScope);
}

function hasActiveResidentAuthorization(data = {}, ownerResidentId, user = {}, options = {}) {
  const now = options.now || new Date();
  const scope = cleanText(options.scope || "health-record-summary", 100);
  return (Array.isArray(data.personalRecords) ? data.personalRecords : []).some((record) => (
    record?.residentId === ownerResidentId
    && record?.category === "authorizations"
    && authorizationTargetsUser(record, user)
    && authorizationHasScope(record, scope)
    && CitizenRecordsV1.authorizationState(record, now).active
  ));
}

function evaluateCitizenResidentRead(data = {}, user = {}, residentId, options = {}) {
  if (!user || user.role !== "citizen") return { allowed: false, reason: "citizen-role-required" };
  if (!residentId) return { allowed: false, reason: "resident-id-required" };
  if (residentId === user.residentId) return { allowed: true, reason: "self" };
  const account = (Array.isArray(data.accounts) ? data.accounts : []).find((item) => item.id === user.accountId);
  const relationship = (Array.isArray(account?.members) ? account.members : []).find((member) => member.residentId === residentId);
  if (!isVerifiedRelationship(relationship)) return { allowed: false, reason: "verified-relationship-required" };
  if (!hasActiveResidentAuthorization(data, residentId, user, options)) {
    return { allowed: false, reason: "active-scoped-authorization-required" };
  }
  return { allowed: true, reason: "verified-relationship-and-authorization" };
}

function canCitizenReadResident(data, user, residentId, options = {}) {
  return evaluateCitizenResidentRead(data, user, residentId, options).allowed;
}

function scopeForRecordCategory(category) {
  const scopes = {
    emr: "emr-summary",
    labs: "labs",
    medications: "medications",
    imaging: "imaging-report",
    attachments: "attachments"
  };
  return scopes[cleanText(category, 60)] || "health-record-summary";
}

function canCitizenReadRecord(data, user, record = {}, options = {}) {
  return canCitizenReadResident(data, user, record.residentId, {
    ...options,
    scope: options.scope || scopeForRecordCategory(record.category)
  });
}

function allowedResidentIdsForCitizen(data = {}, user = {}, options = {}) {
  if (!user || user.role !== "citizen") return new Set();
  const account = (Array.isArray(data.accounts) ? data.accounts : []).find((item) => item.id === user.accountId);
  const candidates = new Set([user.residentId, ...(account?.members || []).map((member) => member.residentId)].filter(Boolean));
  return new Set([...candidates].filter((residentId) => canCitizenReadResident(data, user, residentId, options)));
}

function normalizeCitizenSupplement(payload = {}, user = {}) {
  if (!user || user.role !== "citizen" || !user.residentId) throw new Error("citizen identity required");
  const category = cleanText(payload.category, 60);
  if (AUTHORITY_ONLY_CATEGORIES.has(category) || !CITIZEN_SUPPLEMENT_CATEGORIES.has(category)) {
    throw new Error("citizen may only create self-reported supplement records");
  }
  if (payload.residentId && payload.residentId !== user.residentId) throw new Error("citizen may only supplement the self record");
  const projected = CitizenRecordsV1.projectRecord({
    ...payload,
    residentId: user.residentId,
    category,
    source: "居民个人提供（待核验）",
    createdBy: user.username || user.id || user.residentId,
    meta: {
      ...(payload.meta || {}),
      authority: "resident-upload",
      sourceTrust: "self-reported",
      dataQualityStatus: "unverified",
      originalAvailable: false
    }
  });
  if (!projected) throw new Error("resident record category is not supported");
  return projected;
}

function projectCitizenRecordResponse(record = {}, residentId = "") {
  if (residentId && record?.residentId !== residentId) return null;
  return CitizenRecordsV1.projectRecord(record);
}

module.exports = {
  AUTHORITY_ONLY_CATEGORIES,
  CITIZEN_SUPPLEMENT_CATEGORIES,
  allowedResidentIdsForCitizen,
  authorizationHasScope,
  authorizationTargetsUser,
  canCitizenReadRecord,
  canCitizenReadResident,
  evaluateCitizenResidentRead,
  hasActiveResidentAuthorization,
  isVerifiedRelationship,
  normalizeCitizenSupplement,
  projectCitizenRecordResponse,
  scopeForRecordCategory
};
