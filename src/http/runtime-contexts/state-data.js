"use strict";

const DOMAIN = "state-data";
const PROCESS = "T02";
const DEPENDENCIES = Object.freeze([
  "COLLECTION_WRITE_KEYS", "auditTrailRowsMatch", "auditTrailRowsMatchById", "collectJson",
  "normalizeState", "prependAuditEventPreservingTrail", "prependAuditTrailEntry", "randomUUID",
  "readDatabase", "redactSensitiveResponse", "requireApiRole", "resealAuditTrail",
  "scopeStateForUser", "sealAuditTrail", "seedState", "sendJson",
  "storageMeta", "verifyAuditTrail", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };

