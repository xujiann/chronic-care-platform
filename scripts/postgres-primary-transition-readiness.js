#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  buildPostgresPrimaryStorageConfig,
  buildTransitionAssessment
} = require("../src/platform/storage/postgres-primary-storage-contract");

const MAX_INPUT_BYTES = 1024 * 1024;
const INPUT_ENV = "POSTGRES_PRIMARY_TRANSITION_INPUT_FILE";
const INPUT_SHA256_ENV = "POSTGRES_PRIMARY_TRANSITION_INPUT_SHA256";
const TOP_LEVEL_FIELDS = Object.freeze([
  "requestedMode",
  "migration",
  "reconciliation",
  "delivery",
  "recovery",
  "capacity",
  "failover",
  "fallback"
]);
const SECTION_FIELDS = Object.freeze({
  migration: Object.freeze(["status", "sourceCollections", "targetCollections", "sourceDigest", "targetDigest"]),
  reconciliation: Object.freeze(["status", "mismatched", "unresolvedCases"]),
  delivery: Object.freeze(["pending", "retry", "failed"]),
  recovery: Object.freeze([
    "backupStatus",
    "restoreStatus",
    "measuredRtoSeconds",
    "targetRtoSeconds",
    "measuredRpoSeconds",
    "targetRpoSeconds"
  ]),
  capacity: Object.freeze([
    "status",
    "profileRef",
    "evidenceRef",
    "targetRecords",
    "testedRecords",
    "targetConcurrency",
    "measuredConcurrency",
    "targetThroughputPerSecond",
    "measuredThroughputPerSecond",
    "targetP95LatencyMs",
    "measuredP95LatencyMs",
    "targetP99LatencyMs",
    "measuredP99LatencyMs",
    "criticalFindingsOpen"
  ]),
  failover: Object.freeze([
    "status",
    "evidenceRef",
    "targetFailoverSeconds",
    "measuredFailoverSeconds",
    "dataLossObserved",
    "criticalFindingsOpen"
  ]),
  fallback: Object.freeze(["status", "target", "dataLossObserved", "evidenceRef"])
});
const SAFE_FAILURE_MESSAGES = Object.freeze({
  POSTGRES_TRANSITION_INPUT_PATH_INVALID: "PostgreSQL transition input must use an absolute path",
  POSTGRES_TRANSITION_INPUT_UNAVAILABLE: "PostgreSQL transition input is unavailable",
  POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID: "PostgreSQL transition input must be a non-empty regular file within the size limit",
  POSTGRES_TRANSITION_INPUT_DIGEST_INVALID: "PostgreSQL transition input digest must be a lowercase SHA-256 value",
  POSTGRES_TRANSITION_INPUT_DIGEST_MISMATCH: "PostgreSQL transition input digest does not match the opened file",
  POSTGRES_TRANSITION_INPUT_JSON_INVALID: "PostgreSQL transition input must contain valid JSON",
  POSTGRES_TRANSITION_INPUT_SHAPE_INVALID: "PostgreSQL transition input must use the closed metadata-only contract",
  POSTGRES_TRANSITION_ARGUMENT_INVALID: "PostgreSQL transition readiness arguments are invalid",
  INVALID_POSTGRES_PRIMARY_STORAGE_MODE: "PostgreSQL primary storage configuration is invalid",
  INVALID_POSTGRES_TRANSITION_MODE: "PostgreSQL transition mode is invalid"
});

class PostgresTransitionReadinessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PostgresTransitionReadinessError";
    this.code = code;
  }
}

function readinessError(code, message) {
  return new PostgresTransitionReadinessError(code, message);
}

function exactFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function isMetadataScalar(value) {
  return (typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && !/[\r\n]/.test(value)
    && !/(?:postgres(?:ql)?:\/\/[^\s]*@|-----BEGIN|DATABASE_URL\s*=|(?:password|secret|token)\s*=|bearer\s+)/i.test(value))
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function validateTransitionInput(input) {
  if (!exactFields(input, TOP_LEVEL_FIELDS)) {
    throw readinessError(
      "POSTGRES_TRANSITION_INPUT_SHAPE_INVALID",
      "PostgreSQL transition input must use the closed metadata-only contract"
    );
  }
  for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
    if (!exactFields(input[section], fields)
      || Object.values(input[section]).some((value) => !isMetadataScalar(value))) {
      throw readinessError(
        "POSTGRES_TRANSITION_INPUT_SHAPE_INVALID",
        "PostgreSQL transition input must use the closed metadata-only contract"
      );
    }
  }
  if (typeof input.requestedMode !== "string") {
    throw readinessError(
      "POSTGRES_TRANSITION_INPUT_SHAPE_INVALID",
      "PostgreSQL transition input must use the closed metadata-only contract"
    );
  }
  return structuredClone(input);
}

function resolveInputFile(value) {
  const file = String(value || "").trim();
  if (!file || !path.isAbsolute(file)) {
    throw readinessError(
      "POSTGRES_TRANSITION_INPUT_PATH_INVALID",
      "PostgreSQL transition input must use an absolute path"
    );
  }
  return path.resolve(file);
}

function readTransitionInput(file, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const resolved = resolveInputFile(file);
  const expectedDigest = String(options.sha256 || "").trim();
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw readinessError(
      "POSTGRES_TRANSITION_INPUT_DIGEST_INVALID",
      "PostgreSQL transition input digest must be a lowercase SHA-256 value"
    );
  }
  let pathStat;
  try {
    pathStat = fileSystem.lstatSync(resolved);
  } catch {
    throw readinessError(
      "POSTGRES_TRANSITION_INPUT_UNAVAILABLE",
      "PostgreSQL transition input is unavailable"
    );
  }
  const maximumBytes = Number(options.maximumBytes) || MAX_INPUT_BYTES;
  if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.size <= 0 || pathStat.size > maximumBytes) {
    throw readinessError(
      "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID",
      "PostgreSQL transition input must be a non-empty regular file within the size limit"
    );
  }
  let descriptor;
  try {
    descriptor = fileSystem.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch {
    throw readinessError(
      "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID",
      "PostgreSQL transition input must be a non-empty regular file within the size limit"
    );
  }
  let input;
  try {
    const openedStat = fileSystem.fstatSync(descriptor);
    const currentPathStat = fileSystem.lstatSync(resolved);
    const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
    const sameSnapshot = (left, right) => sameIdentity(left, right)
      && left.size === right.size
      && left.mtimeMs === right.mtimeMs
      && left.ctimeMs === right.ctimeMs;
    const sameObject = sameSnapshot(pathStat, openedStat) && sameSnapshot(openedStat, currentPathStat);
    if (!openedStat.isFile()
      || currentPathStat.isSymbolicLink()
      || !currentPathStat.isFile()
      || !sameObject
      || openedStat.size <= 0
      || openedStat.size > maximumBytes) {
      throw readinessError(
        "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID",
        "PostgreSQL transition input must be a non-empty regular file within the size limit"
      );
    }
    const bytes = Buffer.alloc(openedStat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fileSystem.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const finalStat = fileSystem.fstatSync(descriptor);
    if (offset !== openedStat.size || !sameSnapshot(openedStat, finalStat)) {
      throw readinessError(
        "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID",
        "PostgreSQL transition input must be a non-empty regular file within the size limit"
      );
    }
    const openedBytes = bytes.subarray(0, offset);
    if (createHash("sha256").update(openedBytes).digest("hex") !== expectedDigest) {
      throw readinessError(
        "POSTGRES_TRANSITION_INPUT_DIGEST_MISMATCH",
        "PostgreSQL transition input digest does not match the opened file"
      );
    }
    input = JSON.parse(openedBytes.toString("utf8"));
  } catch (error) {
    if (error instanceof PostgresTransitionReadinessError) throw error;
    throw readinessError(
      "POSTGRES_TRANSITION_INPUT_JSON_INVALID",
      "PostgreSQL transition input must contain valid JSON"
    );
  } finally {
    fileSystem.closeSync(descriptor);
  }
  return validateTransitionInput(input);
}

function buildTransitionReadinessReport(options = {}) {
  const env = options.env || process.env;
  const input = options.input || readTransitionInput(
    options.file || env[INPUT_ENV],
    { ...options, sha256: options.sha256 || env[INPUT_SHA256_ENV] }
  );
  const config = buildPostgresPrimaryStorageConfig(env);
  const assessment = buildTransitionAssessment(validateTransitionInput(input), config);
  const checks = assessment.checks.map((item) => (
    item.id === "configuration"
      ? { ...item, passed: item.passed && config.mode === assessment.requestedMode }
      : item
  ));
  const blockers = checks.filter((item) => !item.passed).map((item) => item.id);
  return {
    schemaVersion: "postgres-primary-transition-readiness-v1",
    ok: true,
    inputContract: "postgres-primary-transition-metadata-v1",
    requestedMode: assessment.requestedMode,
    readyForControlledRehearsal: checks.every((item) => item.passed),
    checks,
    blockers,
    activationAuthorized: false,
    productionReady: false,
    productionPrimary: false,
    runtimeCutoverEnabled: false,
    credentialsPersisted: false,
    payloadsPersisted: false,
    boundary: assessment.boundary
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const value of argv) {
    if (!value.startsWith("--")) {
      throw readinessError("POSTGRES_TRANSITION_ARGUMENT_INVALID", "unexpected positional argument");
    }
    const [key, ...rest] = value.slice(2).split("=");
    if (!["input", "sha256"].includes(key) || Object.hasOwn(flags, key) || rest.length === 0 || !rest.join("=").trim()) {
      throw readinessError("POSTGRES_TRANSITION_ARGUMENT_INVALID", "invalid transition readiness argument");
    }
    flags[key] = rest.join("=");
  }
  return flags;
}

function safeFailure(error) {
  const code = /^[A-Z0-9_]{2,100}$/.test(String(error?.code || ""))
    ? String(error.code)
    : "POSTGRES_TRANSITION_READINESS_FAILED";
  return {
    schemaVersion: "postgres-primary-transition-readiness-v1",
    ok: false,
    code,
    message: SAFE_FAILURE_MESSAGES[code] || "PostgreSQL transition readiness evaluation failed",
    readyForControlledRehearsal: false,
    activationAuthorized: false,
    productionReady: false,
    productionPrimary: false,
    runtimeCutoverEnabled: false,
    credentialsPersisted: false,
    payloadsPersisted: false
  };
}

function runCli(argv = process.argv.slice(2), env = process.env) {
  const flags = parseArgs(argv);
  return buildTransitionReadinessReport({
    env,
    file: typeof flags.input === "string" ? flags.input : env[INPUT_ENV],
    sha256: typeof flags.sha256 === "string" ? flags.sha256 : env[INPUT_SHA256_ENV]
  });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  INPUT_ENV,
  INPUT_SHA256_ENV,
  MAX_INPUT_BYTES,
  PostgresTransitionReadinessError,
  SECTION_FIELDS,
  TOP_LEVEL_FIELDS,
  buildTransitionReadinessReport,
  parseArgs,
  readTransitionInput,
  resolveInputFile,
  runCli,
  safeFailure,
  validateTransitionInput
};
