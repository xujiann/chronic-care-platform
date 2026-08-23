"use strict";

const { createHash } = require("node:crypto");
const inventory = require("../../../config/worker-observability-contract.json");

const CONTRACT_VERSION = "platform-worker-observability.v1";
const OUTCOMES = new Set(["idle", "succeeded", "partial", "retrying", "failed", "blocked", "skipped"]);
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROCESS_ID = /^T\d{2}$/;
const OBSERVABILITY_KEYS = [
  "contractVersion", "profileId", "ownerProcess", "outcome", "observedAt",
  "workerIdDigest", "runIdDigest", "work", "errorCodes", "semantics",
  "sourceReportDigest", "security", "productionAuthorization"
];
const WORK_KEYS = ["claimed", "succeeded", "retryScheduled", "deadLettered", "persistenceRejected", "failed"];
const SEMANTICS_KEYS = ["stateMachine", "deliveryGuarantee", "retryModel", "leaseModel", "checkpointModel"];
const SECURITY_KEYS = ["metadataOnly", "projectionBusinessDataExposed", "projectionCredentialsExposed", "projectionLeaseTokensExposed"];
const PRODUCTION_AUTHORIZATION_KEYS = ["inferred", "productionReady", "externalEvidenceRequired"];

function hasExactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex")}`;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathValue(source, path) {
  if (path === "$" || path === "") return source;
  return String(path || "").split(".").reduce((value, key) => value?.[key], source);
}

function firstValue(source, paths = []) {
  for (const path of paths) {
    const value = pathValue(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function summedCount(source, paths = []) {
  let observed = false;
  const total = paths.reduce((sum, path) => {
    const value = Number(pathValue(source, path));
    if (!Number.isSafeInteger(value) || value < 0) return sum;
    observed = true;
    return sum + value;
  }, 0);
  return observed ? total : 0;
}

function safeIdentifierDigest(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[a-f0-9]{64}$/.test(text)) return `sha256:${text}`;
  if (SHA256.test(text)) return text;
  return sha256(text);
}

function safeTimestamp(value, fallback) {
  const candidate = String(value || "").trim();
  if (Number.isFinite(Date.parse(candidate))) return new Date(candidate).toISOString();
  const safeFallback = String(fallback || "").trim();
  if (!Number.isFinite(Date.parse(safeFallback))) throw new TypeError("worker observability requires a valid observedAt timestamp");
  return new Date(safeFallback).toISOString();
}

function profileById(profileId) {
  const profile = inventory.profiles.find((item) => item.id === profileId);
  if (!profile) throw new TypeError(`unknown worker observability profile: ${String(profileId || "missing")}`);
  return profile;
}

function errorCodesFor(report, profile) {
  const values = [];
  for (const collection of profile.observability.errorCollections) {
    const source = pathValue(report, collection.path);
    const rows = Array.isArray(source) ? source : source ? [source] : [];
    for (const row of rows) {
      for (const path of collection.codePaths) {
        const code = String(pathValue(row, path) || "").trim().toUpperCase();
        if (ERROR_CODE.test(code)) values.push(code);
      }
    }
  }
  return [...new Set(values)].sort().slice(0, 20);
}

function deriveOutcome(report, work, profile) {
  if (firstValue(report, profile.observability.skippedPaths) === true) return "skipped";
  const status = String(firstValue(report, profile.observability.statusPaths) || "").trim().toLowerCase();
  if (status === "blocked") return "blocked";
  const failedStatus = ["critical", "failed", "error", "mismatch", "mismatched"].includes(status);
  const explicitOk = firstValue(report, profile.observability.okPaths);
  const terminalFailures = work.deadLettered + work.persistenceRejected + work.failed;
  if (terminalFailures > 0 || explicitOk === false || failedStatus) {
    return work.succeeded > 0 || work.retryScheduled > 0 ? "partial" : "failed";
  }
  if (work.retryScheduled > 0) return work.succeeded > 0 ? "partial" : "retrying";
  if (work.claimed === 0 && work.succeeded === 0) return "idle";
  return "succeeded";
}

function validateInventory(source = inventory) {
  if (!plainObject(source)
    || source.schemaVersion !== "platform-worker-semantics-inventory-v1"
    || source.contractVersion !== CONTRACT_VERSION
    || source.productionAuthorization !== "never"
    || !Array.isArray(source.profiles)
    || !Array.isArray(source.excludedWorkerLikeAssets)) {
    throw new TypeError("worker observability inventory is invalid");
  }
  const ids = new Set();
  for (const profile of source.profiles) {
    if (!plainObject(profile) || !PROFILE_ID.test(profile.id) || ids.has(profile.id) || !PROCESS_ID.test(profile.ownerProcess)) {
      throw new TypeError("worker observability profile identity is invalid");
    }
    ids.add(profile.id);
    for (const field of ["entrypoints", "implementationSources", "terminalStates"]) {
      if (!Array.isArray(profile[field])) throw new TypeError(`worker observability profile ${profile.id} ${field} is invalid`);
    }
    for (const field of ["stateMachine", "deliveryGuarantee", "retryModel", "leaseModel", "checkpointModel"]) {
      if (!String(profile[field] || "").trim()) throw new TypeError(`worker observability profile ${profile.id} ${field} is missing`);
    }
    const projection = profile.observability;
    if (!plainObject(projection) || !plainObject(projection.countPaths) || !Array.isArray(projection.errorCollections)) {
      throw new TypeError(`worker observability profile ${profile.id} projection is invalid`);
    }
    for (const field of ["workerIdentityPaths", "runIdentityPaths", "observedAtPaths", "okPaths", "skippedPaths", "statusPaths"]) {
      if (!Array.isArray(projection[field])) throw new TypeError(`worker observability profile ${profile.id} ${field} is invalid`);
    }
    for (const field of WORK_KEYS) {
      if (!Array.isArray(projection.countPaths[field])) throw new TypeError(`worker observability profile ${profile.id} count mapping is invalid`);
    }
  }
  return Object.freeze({ ok: true, profileCount: ids.size, contractVersion: source.contractVersion });
}

function validateWorkerObservability(value) {
  if (!plainObject(value) || Object.keys(value).sort().join("|") !== [...OBSERVABILITY_KEYS].sort().join("|")) {
    throw new TypeError("worker observability projection has unexpected fields");
  }
  if (value.contractVersion !== CONTRACT_VERSION || !PROFILE_ID.test(value.profileId) || !PROCESS_ID.test(value.ownerProcess)) {
    throw new TypeError("worker observability identity is invalid");
  }
  if (!OUTCOMES.has(value.outcome) || !Number.isFinite(Date.parse(value.observedAt))) {
    throw new TypeError("worker observability outcome is invalid");
  }
  if (![value.workerIdDigest, value.runIdDigest].every((item) => item === "" || SHA256.test(item))) {
    throw new TypeError("worker observability identity digest is invalid");
  }
  if (!plainObject(value.work) || Object.keys(value.work).sort().join("|") !== [...WORK_KEYS].sort().join("|")
    || WORK_KEYS.some((key) => !Number.isSafeInteger(value.work[key]) || value.work[key] < 0)) {
    throw new TypeError("worker observability work counts are invalid");
  }
  if (!Array.isArray(value.errorCodes) || value.errorCodes.length > 20 || value.errorCodes.some((code) => !ERROR_CODE.test(code))) {
    throw new TypeError("worker observability error codes are invalid");
  }
  if (!hasExactKeys(value.semantics, SEMANTICS_KEYS)
    || !SEMANTICS_KEYS.every((key) => String(value.semantics[key] || "").trim())) {
    throw new TypeError("worker observability semantics are invalid");
  }
  if (!SHA256.test(value.sourceReportDigest)
    || !hasExactKeys(value.security, SECURITY_KEYS)
    || value.security.metadataOnly !== true
    || value.security.projectionBusinessDataExposed !== false
    || value.security.projectionCredentialsExposed !== false
    || value.security.projectionLeaseTokensExposed !== false
    || !hasExactKeys(value.productionAuthorization, PRODUCTION_AUTHORIZATION_KEYS)
    || value.productionAuthorization.inferred !== false
    || value.productionAuthorization.productionReady !== false
    || value.productionAuthorization.externalEvidenceRequired !== true) {
    throw new TypeError("worker observability safety boundary is invalid");
  }
  return true;
}

function projectWorkerObservability(profileId, report = {}, options = {}) {
  if (!plainObject(report)) throw new TypeError("worker observability source report must be an object");
  const profile = profileById(profileId);
  const projection = profile.observability;
  const sourceReport = { ...report };
  delete sourceReport.workerObservability;
  const work = Object.freeze(Object.fromEntries(
    WORK_KEYS.map((key) => [key, summedCount(sourceReport, projection.countPaths[key])])
  ));
  const observedAt = safeTimestamp(
    firstValue(sourceReport, projection.observedAtPaths),
    options.observedAt || new Date().toISOString()
  );
  const outcome = deriveOutcome(sourceReport, work, profile);
  const workerIdDigest = safeIdentifierDigest(firstValue(sourceReport, projection.workerIdentityPaths));
  const runIdDigest = safeIdentifierDigest(firstValue(sourceReport, projection.runIdentityPaths));
  const errorCodes = Object.freeze(errorCodesFor(sourceReport, profile));
  const sourceReportDigest = sha256({
    profileId: profile.id,
    outcome,
    observedAt,
    workerIdDigest,
    runIdDigest,
    work,
    errorCodes
  });
  const value = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    profileId: profile.id,
    ownerProcess: profile.ownerProcess,
    outcome,
    observedAt,
    workerIdDigest,
    runIdDigest,
    work,
    errorCodes,
    semantics: Object.freeze({
      stateMachine: profile.stateMachine,
      deliveryGuarantee: profile.deliveryGuarantee,
      retryModel: profile.retryModel,
      leaseModel: profile.leaseModel,
      checkpointModel: profile.checkpointModel
    }),
    sourceReportDigest,
    security: Object.freeze({
      metadataOnly: true,
      projectionBusinessDataExposed: false,
      projectionCredentialsExposed: false,
      projectionLeaseTokensExposed: false
    }),
    productionAuthorization: Object.freeze({
      inferred: false,
      productionReady: false,
      externalEvidenceRequired: true
    })
  });
  validateWorkerObservability(value);
  return value;
}

function attachWorkerObservability(profileId, report = {}, options = {}) {
  if (report?.workerObservability) {
    validateWorkerObservability(report.workerObservability);
    if (report.workerObservability.profileId !== profileId) throw new TypeError("worker observability profile cannot be replaced");
    return report;
  }
  return Object.freeze({
    ...report,
    workerObservability: projectWorkerObservability(profileId, report, options)
  });
}

validateInventory();

module.exports = {
  CONTRACT_VERSION,
  attachWorkerObservability,
  projectWorkerObservability,
  sha256,
  stableStringify,
  validateInventory,
  validateWorkerObservability
};
