"use strict";

const DOMAIN = "state-data";
const PROCESS = "T02";
const DEPENDENCIES = Object.freeze([
  "COLLECTION_WRITE_KEYS", "auditTrailRowsMatch", "collectJson",
  "normalizeState", "prependAuditTrailEntry", "randomUUID",
  "readDatabase", "redactSensitiveResponse", "requireApiRole",
  "scopeStateForUser", "seedState", "sendJson",
  "storageMeta", "verifyAuditTrail", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };

