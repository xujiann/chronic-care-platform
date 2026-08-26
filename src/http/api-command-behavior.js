"use strict";

const { sha256 } = require("../platform/governance/technical-evidence");

const commandResourceTails = new Map();
const RECEIPT_FIELD = "_apiCommandReceipts";
const MAX_RECEIPTS_PER_RESOURCE = 50;

function commandBehaviorError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function withApiCommandResourceLock(resourceKey, work) {
  const key = String(resourceKey || "").trim();
  const previous = commandResourceTails.get(key) || Promise.resolve();
  const pending = previous.then(work, work);
  const tail = pending.then(() => undefined, () => undefined);
  commandResourceTails.set(key, tail);
  tail.finally(() => {
    if (commandResourceTails.get(key) === tail) commandResourceTails.delete(key);
  });
  return pending;
}

function headerValue(req, name) {
  const headers = req?.headers || {};
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

function boundedCommandKey(value, field, errorPrefix) {
  if (typeof value !== "string") {
    throw commandBehaviorError(`${errorPrefix}_INVALID`, `${field} must be a string`, 400);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw commandBehaviorError(`${errorPrefix}_INVALID`, `${field} is invalid`, 400);
  }
  return normalized;
}

function commandActorScope(user = {}) {
  return {
    role: String(user.role || "").trim(),
    orgType: String(user.orgType || "").trim().toLowerCase(),
    orgCode: String(user.orgCode || "").trim().toUpperCase(),
    principal: String(user.id || user.username || "").trim()
  };
}

function createApiCommandIdentity({ req, user, payload, route, resourceId, legacyKey = "", errorPrefix }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw commandBehaviorError(`${errorPrefix}_INVALID`, "request body must be an object", 400);
  }
  const rawHeaderKey = headerValue(req, "idempotency-key");
  const headerKey = rawHeaderKey === undefined ? "" : boundedCommandKey(rawHeaderKey, "Idempotency-Key", errorPrefix);
  const bodyKey = payload.idempotencyKey === undefined
    ? ""
    : boundedCommandKey(payload.idempotencyKey, "idempotencyKey", errorPrefix);
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    throw commandBehaviorError(`${errorPrefix}_INVALID`, "Idempotency-Key conflicts with body idempotencyKey", 400);
  }
  const explicitKey = headerKey || bodyKey;
  const hasExpectedVersion = Object.hasOwn(payload, "expectedVersion");
  if (explicitKey && !hasExpectedVersion) {
    throw commandBehaviorError(`${errorPrefix}_EXPECTED_VERSION_REQUIRED`, "expectedVersion is required with an explicit idempotency key", 400);
  }
  const expectedVersion = hasExpectedVersion ? Number(payload.expectedVersion) : null;
  if (hasExpectedVersion && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
    throw commandBehaviorError(`${errorPrefix}_INVALID`, "expectedVersion must be a non-negative integer", 400);
  }
  const actorScope = commandActorScope(user);
  const canonicalRequest = {
    route,
    resourceId: String(resourceId || "").trim(),
    actorScope,
    payload: Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "idempotencyKey"))
  };
  const requestDigest = sha256(canonicalRequest);
  const selectedKey = explicitKey || String(legacyKey || "").trim() || `canonical:${requestDigest}`;
  return {
    actorScope,
    commandKeyHash: sha256({ route, actorScope, selectedKey }),
    errorPrefix,
    explicitContract: Boolean(explicitKey),
    expectedVersion,
    requestDigest
  };
}

function apiCommandReceipts(record) {
  return Array.isArray(record?.[RECEIPT_FIELD]) ? record[RECEIPT_FIELD] : [];
}

function findApiCommandReceipt(records, command) {
  for (const record of Array.isArray(records) ? records : []) {
    const receipt = apiCommandReceipts(record).find((item) => item.commandKeyHash === command.commandKeyHash);
    if (!receipt) continue;
    if (receipt.requestDigest !== command.requestDigest) {
      throw commandBehaviorError(
        `${command.errorPrefix}_IDEMPOTENCY_CONFLICT`,
        "idempotency key was already used with a different request",
        409
      );
    }
    return receipt;
  }
  return null;
}

function projectApiCommandRecord(record = {}) {
  const { [RECEIPT_FIELD]: _receipts, ...projected } = record;
  return projected;
}

function appendApiCommandReceipt(record, command, response, statusCode, now) {
  return {
    ...record,
    [RECEIPT_FIELD]: [
      {
        schemaVersion: "api-command-receipt.v1",
        commandKeyHash: command.commandKeyHash,
        requestDigest: command.requestDigest,
        statusCode,
        response: structuredClone(response),
        committedAt: now
      },
      ...apiCommandReceipts(record)
    ].slice(0, MAX_RECEIPTS_PER_RESOURCE)
  };
}

function assertApiCommandExpectedVersion(record, command) {
  const currentVersion = Number.isSafeInteger(Number(record?.version)) && Number(record?.version) >= 0
    ? Number(record.version)
    : 0;
  if (command.expectedVersion !== null && command.expectedVersion !== currentVersion) {
    throw commandBehaviorError(
      `${command.errorPrefix}_VERSION_CONFLICT`,
      `version conflict: expected ${command.expectedVersion}, current ${currentVersion}`,
      409
    );
  }
  return currentVersion;
}

function apiCommandHttpError(error, errorPrefix) {
  if (error?.code && Number.isInteger(error.statusCode)) {
    return {
      status: error.statusCode,
      body: {
        error: error.statusCode === 409 ? "Conflict" : error.statusCode === 403 ? "Forbidden" : "Bad Request",
        code: error.code,
        message: error.message
      }
    };
  }
  if (/SQLite optimistic lock conflict|version conflict|CAS conflict/i.test(String(error?.message || ""))) {
    return {
      status: 409,
      body: { error: "Conflict", code: `${errorPrefix}_VERSION_CONFLICT`, message: "resource version changed; refresh and retry" }
    };
  }
  return {
    status: 500,
    body: { error: "Internal Server Error", code: `${errorPrefix}_STORAGE_FAILED`, message: "command persistence failed" }
  };
}

function requireGovernanceOrganization(user, errorPrefix) {
  const orgType = String(user?.orgType || "").trim().toLowerCase();
  const orgCode = String(user?.orgCode || "").trim();
  if (!["city", "health_admin"].includes(orgType) || !orgCode) {
    throw commandBehaviorError(`${errorPrefix}_SCOPE_FORBIDDEN`, "organization scope denied", 403);
  }
}

function requireQualityFeedbackOrganization(user, errorPrefix) {
  const allowed = {
    commission: new Set(["city", "health_admin"]),
    institution: new Set(["medical_institution"]),
    county: new Set(["county_consortium"])
  };
  const role = String(user?.role || "").trim();
  const orgType = String(user?.orgType || "").trim().toLowerCase();
  const orgCode = String(user?.orgCode || "").trim();
  if (!allowed[role]?.has(orgType) || !orgCode) {
    throw commandBehaviorError(`${errorPrefix}_SCOPE_FORBIDDEN`, "organization scope denied", 403);
  }
}

function requireQualityOrderScope(user, order, errorPrefix, data = {}) {
  if (user.role === "commission") return;
  const ownerRole = String(order?.ownerRole || "").trim();
  if (ownerRole && ownerRole !== user.role) {
    throw commandBehaviorError(`${errorPrefix}_SCOPE_FORBIDDEN`, "rectification owner role scope denied", 403);
  }
  const userCode = String(user.orgCode || "").trim().toUpperCase();
  const userName = String(user.orgName || user.organization || "").trim().toLowerCase();
  const orderCode = String(order?.institutionId || order?.institutionCode || "").trim().toUpperCase();
  const orderName = String(order?.institutionName || "").trim().toLowerCase();
  if ((orderCode && orderCode === userCode) || (orderName && userName && orderName === userName)) return;
  const institutionAliases = [
    ...(Array.isArray(data.hospitalOperationSnapshots) ? data.hospitalOperationSnapshots : []),
    ...(Array.isArray(data.medicalResources) ? data.medicalResources : [])
  ];
  if (institutionAliases.some((item) => {
    const aliasCode = String(item.institutionId || item.orgCode || "").trim().toUpperCase();
    const aliasName = String(item.institutionName || item.institution || item.name || "").trim().toLowerCase();
    return aliasCode === userCode && aliasName && aliasName === orderName;
  })) return;
  throw commandBehaviorError(`${errorPrefix}_SCOPE_FORBIDDEN`, "rectification resource scope denied", 403);
}

module.exports = {
  appendApiCommandReceipt,
  apiCommandHttpError,
  assertApiCommandExpectedVersion,
  commandBehaviorError,
  createApiCommandIdentity,
  findApiCommandReceipt,
  projectApiCommandRecord,
  requireGovernanceOrganization,
  requireQualityFeedbackOrganization,
  requireQualityOrderScope,
  withApiCommandResourceLock
};
