"use strict";

const { createHash } = require("node:crypto");

const CONTRACT_ID = "shared-drug-consumable-command.v1";
const MAX_COMMAND_RECEIPTS = 100;
const writeTails = new Map();
const ACTION_ROLES = Object.freeze({
  review: new Set(["commission", "insurance"]),
  remediation: new Set(["commission", "institution"]),
  "insurance-sync": new Set(["commission", "insurance"])
});
const AUDIT_ACTIONS = Object.freeze({
  review: "drug-consumable-review",
  remediation: "drug-consumable-remediation",
  "insurance-sync": "drug-consumable-insurance-sync"
});

class DrugConsumableCommandError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "DrugConsumableCommandError";
    this.code = code;
    this.status = status;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (!["commandId", "idempotencyKey"].includes(key)) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stableValue(value))).digest("hex");
}

function text(value) {
  return String(value ?? "").trim();
}

function actor(user = {}) {
  return {
    id: text(user.username || user.subject || user.id || user.role),
    role: text(user.role),
    orgCode: text(user.orgCode).toUpperCase(),
    orgType: text(user.orgType).toLowerCase()
  };
}

function commandError(code, message, status) {
  throw new DrugConsumableCommandError(code, message, status);
}

function currentVersion(record = {}) {
  if (record.domainVersion === undefined || record.domainVersion === null || record.domainVersion === "") return 0;
  if (!Number.isSafeInteger(record.domainVersion) || record.domainVersion < 0) {
    commandError("DRUG_CONSUMABLE_AGGREGATE_INVALID", "Drug-consumable aggregate version is invalid", 409);
  }
  return record.domainVersion;
}

function normalizePayload(action, payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    commandError("DRUG_CONSUMABLE_BODY_INVALID", "Drug-consumable command body must be an object");
  }
  const maximums = { evidence: 1000, nextAction: 1000, note: 1000, settlementBatch: 160 };
  for (const [field, maximum] of Object.entries(maximums)) {
    if (payload[field] !== undefined && (typeof payload[field] !== "string" || payload[field].trim().length > maximum)) {
      commandError("DRUG_CONSUMABLE_COMMAND_INVALID", `${field} is invalid`);
    }
  }
  if (payload.expectedVersion !== undefined && (
    !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 0
  )) commandError("DRUG_CONSUMABLE_EXPECTED_VERSION_REQUIRED", "expectedVersion must be a non-negative integer");
  if (!ACTION_ROLES[action]) commandError("DRUG_CONSUMABLE_COMMAND_INVALID", "Unsupported drug-consumable action");
  return structuredClone(payload);
}

function authorize(user, record, action, canAccessResident, state) {
  const scope = actor(user);
  if (!scope.id) {
    commandError("DRUG_CONSUMABLE_ROLE_DENIED", "Drug-consumable responsibility is not authorized", 403);
  }
  if (action === "remediation" && scope.role === "insurance") {
    commandError("DRUG_CONSUMABLE_DUTY_SEPARATION_REQUIRED", "Insurance actors cannot submit institution remediation", 403);
  }
  if (action === "insurance-sync" && scope.role === "institution") {
    commandError("DRUG_CONSUMABLE_DUTY_SEPARATION_REQUIRED", "Institution actors cannot confirm insurance synchronization", 403);
  }
  if (!ACTION_ROLES[action]?.has(scope.role)) {
    commandError("DRUG_CONSUMABLE_ROLE_DENIED", "Drug-consumable responsibility is not authorized", 403);
  }
  if (scope.role === "insurance" && !scope.orgType.includes("insurance")) {
    commandError("DRUG_CONSUMABLE_INSURANCE_SCOPE_DENIED", "Insurance responsibility scope is not authorized", 403);
  }
  if (scope.role === "commission" && !new Set(["city", "health_admin", "platform"]).has(scope.orgType)) {
    commandError("DRUG_CONSUMABLE_COMMISSION_SCOPE_DENIED", "Commission responsibility scope is not authorized", 403);
  }
  if (!canAccessResident(user, record.residentId, state)) {
    commandError("DRUG_CONSUMABLE_RESIDENT_SCOPE_DENIED", "Drug-consumable record is outside resident scope", 403);
  }
  return scope;
}

function identity({ action, recordId, payload, user, headerKey, version }) {
  const semanticPayload = { ...payload };
  delete semanticPayload.commandId;
  delete semanticPayload.idempotencyKey;
  delete semanticPayload.expectedVersion;
  const versionBinding = payload.expectedVersion === undefined ? "compat-current" : payload.expectedVersion;
  const requestDigest = sha256({ action, recordId, expectedVersion: versionBinding, payload: semanticPayload });
  for (const [field, value] of [["Idempotency-Key", headerKey], ["commandId", payload.commandId], ["idempotencyKey", payload.idempotencyKey]]) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      commandError("DRUG_CONSUMABLE_COMMAND_INVALID", `${field} must be a string`);
    }
  }
  const selectedKey = text(headerKey || payload.commandId || payload.idempotencyKey) || `canonical:${requestDigest}`;
  if (selectedKey.length > 160) commandError("DRUG_CONSUMABLE_COMMAND_INVALID", "Idempotency-Key is invalid");
  return {
    commandKeyHash: sha256({ contractId: CONTRACT_ID, action, recordId, actor: actor(user), selectedKey }),
    requestDigest,
    expectedVersion: payload.expectedVersion === undefined ? version : payload.expectedVersion
  };
}

function projectDrugConsumableRecord(record = {}) {
  const { commandReceipts, ...projected } = record;
  return structuredClone(projected);
}

function withDrugConsumableWriteLock(recordId, work) {
  const key = text(recordId);
  const previous = writeTails.get(key) || Promise.resolve();
  const pending = previous.then(work, work);
  const tail = pending.then(() => undefined, () => undefined);
  writeTails.set(key, tail);
  tail.finally(() => {
    if (writeTails.get(key) === tail) writeTails.delete(key);
  });
  return pending;
}

function patchFor(action, payload) {
  if (action === "review") return {
    reviewStatus: text(payload.reviewStatus || payload.status || "reviewed"),
    insuranceStatus: text(payload.insuranceStatus || "coordinating"),
    status: text(payload.status || "in-review"),
    nextAction: text(payload.nextAction || payload.note || "Continue insurance and institution coordination.")
  };
  if (action === "remediation") return {
    remediationStatus: text(payload.remediationStatus || payload.status || "submitted"),
    status: text(payload.status || "remediation-submitted"),
    evidence: text(payload.evidence),
    nextAction: text(payload.nextAction || payload.note || "Regulator reviews remediation evidence.")
  };
  return {
    insuranceStatus: text(payload.insuranceStatus || "synced"),
    settlementBatch: text(payload.settlementBatch || "demo-batch"),
    status: text(payload.status || "insurance-synced"),
    nextAction: text(payload.nextAction || payload.note || "Archive settlement coordination evidence.")
  };
}

function executeDrugConsumableCommand(options) {
  const {
    state,
    recordId,
    action,
    input,
    user,
    headerKey,
    canAccessResident,
    prependAuditTrailEntry,
    randomUUID,
    now = new Date().toISOString()
  } = options;
  const payload = normalizePayload(action, input);
  const records = Array.isArray(state.drugConsumableSupervisions) ? state.drugConsumableSupervisions : [];
  const index = records.findIndex((item) => item.id === recordId);
  if (index < 0) commandError("DRUG_CONSUMABLE_NOT_FOUND", "Drug-consumable supervision record not found", 404);
  const record = records[index];
  const scope = authorize(user, record, action, canAccessResident, state);
  const command = identity({ action, recordId, payload, user, headerKey, version: currentVersion(record) });
  const receipts = Array.isArray(record.commandReceipts) ? record.commandReceipts : [];
  const prior = receipts.find((item) => item.action === action && item.commandKeyHash === command.commandKeyHash);
  if (prior) {
    if (prior.requestDigest !== command.requestDigest) {
      commandError("DRUG_CONSUMABLE_IDEMPOTENCY_CONFLICT", "Idempotency-Key is bound to another drug-consumable command", 409);
    }
    return { state, response: projectDrugConsumableRecord(record), replayed: true };
  }
  if (command.expectedVersion !== currentVersion(record)) {
    commandError("DRUG_CONSUMABLE_VERSION_CONFLICT", "Drug-consumable record version changed; retry with a fresh snapshot", 409);
  }
  if (receipts.length >= MAX_COMMAND_RECEIPTS) {
    commandError("DRUG_CONSUMABLE_RECEIPT_CAPACITY_EXCEEDED", "Drug-consumable command receipt capacity is exhausted", 409);
  }

  const patch = patchFor(action, payload);
  const version = currentVersion(record) + 1;
  const auditAction = AUDIT_ACTIONS[action];
  const event = {
    at: now,
    actor: text(user.name || scope.id),
    role: scope.role,
    action: auditAction,
    result: patch.status || patch.reviewStatus || patch.remediationStatus || "updated"
  };
  const updated = {
    ...record,
    ...patch,
    domainVersion: version,
    auditTrail: [event, ...(Array.isArray(record.auditTrail) ? record.auditTrail : [])].slice(0, 20),
    commandReceipts: [
      ...receipts,
      {
        contractId: CONTRACT_ID,
        action,
        commandKeyHash: command.commandKeyHash,
        requestDigest: command.requestDigest,
        resultVersion: version,
        at: now
      }
    ],
    updatedBy: scope.id,
    updatedByName: text(user.name),
    lastUpdated: now
  };
  records[index] = updated;
  state.drugConsumableSupervisions = records;
  state.securityEvents = prependAuditTrailEntry(state.securityEvents, {
    id: randomUUID(),
    at: now,
    actor: text(user.name || scope.id),
    role: scope.role,
    action: auditAction,
    target: `drugConsumableSupervisions/${recordId}`,
    result: "allowed",
    detail: patch.nextAction || patch.status || "drug consumable supervision updated"
  });
  return { state, response: projectDrugConsumableRecord(updated), replayed: false };
}

module.exports = {
  CONTRACT_ID,
  DrugConsumableCommandError,
  executeDrugConsumableCommand,
  projectDrugConsumableRecord,
  withDrugConsumableWriteLock
};
