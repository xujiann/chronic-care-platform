"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  MAX_INPUT_BYTES,
  buildTransitionReadinessReport,
  parseArgs,
  readTransitionInput,
  safeFailure,
  validateTransitionInput
} = require("../scripts/postgres-primary-transition-readiness");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "postgres-primary-transition-readiness.js");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validInput(overrides = {}) {
  const digest = "a".repeat(64);
  return {
    requestedMode: "primary-read",
    migration: {
      status: "verified",
      sourceCollections: 12,
      targetCollections: 12,
      sourceDigest: digest,
      targetDigest: digest
    },
    reconciliation: { status: "matched", mismatched: 0, unresolvedCases: 0 },
    delivery: { pending: 0, retry: 0, failed: 0 },
    recovery: {
      backupStatus: "verified",
      restoreStatus: "verified",
      measuredRtoSeconds: 20,
      targetRtoSeconds: 30,
      measuredRpoSeconds: 5,
      targetRpoSeconds: 10
    },
    capacity: {
      status: "verified",
      profileRef: "capacity-profile-20260824",
      evidenceRef: "capacity-evidence-20260824",
      targetRecords: 1000,
      testedRecords: 1200,
      targetConcurrency: 20,
      measuredConcurrency: 24,
      targetThroughputPerSecond: 100,
      measuredThroughputPerSecond: 120,
      targetP95LatencyMs: 250,
      measuredP95LatencyMs: 180,
      targetP99LatencyMs: 500,
      measuredP99LatencyMs: 420,
      criticalFindingsOpen: 0
    },
    failover: {
      status: "verified",
      evidenceRef: "failover-evidence-20260824",
      targetFailoverSeconds: 60,
      measuredFailoverSeconds: 45,
      dataLossObserved: false,
      criticalFindingsOpen: 0
    },
    fallback: {
      status: "verified",
      target: "sqlite",
      dataLossObserved: false,
      evidenceRef: "fallback-evidence-20260824"
    },
    ...overrides
  };
}

function readyEnv(extra = {}) {
  return {
    POSTGRES_PRIMARY_STORAGE_MODE: "primary-read",
    DATABASE_URL: "postgresql://private-user:private-password@db.internal/platform",
    POSTGRES_SSL_MODE: "verify-full",
    POSTGRES_SCHEMA_EVIDENCE_ID: "schema-evidence-20260824",
    POSTGRES_MIGRATION_EVIDENCE_ID: "migration-evidence-20260824",
    POSTGRES_RECONCILIATION_EVIDENCE_ID: "reconciliation-evidence-20260824",
    POSTGRES_BACKUP_EVIDENCE_ID: "backup-evidence-20260824",
    POSTGRES_RTO_RPO_EVIDENCE_ID: "recovery-evidence-20260824",
    POSTGRES_ROLLBACK_EVIDENCE_ID: "rollback-evidence-20260824",
    POSTGRES_CUTOVER_APPROVAL_ID: "approval-evidence-20260824",
    ...extra
  };
}

test("transition readiness exposes seven passed gates but never authorizes activation", () => {
  const report = buildTransitionReadinessReport({ input: validInput(), env: readyEnv() });
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 7);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.readyForControlledRehearsal, true);
  assert.equal(report.activationAuthorized, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.productionPrimary, false);
  assert.equal(report.runtimeCutoverEnabled, false);
  assert.equal(report.credentialsPersisted, false);
  assert.equal(report.payloadsPersisted, false);
  assert.doesNotMatch(JSON.stringify(report), /private-user|private-password|DATABASE_URL/);
});

test("transition readiness remains fail closed when any gate is incomplete", () => {
  const report = buildTransitionReadinessReport({
    input: validInput({ delivery: { pending: 1, retry: 0, failed: 0 } }),
    env: readyEnv()
  });
  assert.equal(report.readyForControlledRehearsal, false);
  assert.deepEqual(report.blockers, ["outbox"]);

  const configBlocked = buildTransitionReadinessReport({ input: validInput(), env: {} });
  assert.equal(configBlocked.readyForControlledRehearsal, false);
  assert.deepEqual(configBlocked.blockers, ["configuration"]);

  const modeMismatch = buildTransitionReadinessReport({
    input: validInput({ requestedMode: "primary-write" }),
    env: readyEnv({ POSTGRES_PRIMARY_STORAGE_MODE: "primary-read" })
  });
  assert.equal(modeMismatch.readyForControlledRehearsal, false);
  assert.equal(modeMismatch.checks.find((item) => item.id === "configuration").passed, false);
  assert.deepEqual(modeMismatch.blockers, ["configuration"]);
});

test("transition input uses an exact metadata-only closed shape", () => {
  assert.deepEqual(validateTransitionInput(validInput()), validInput());
  assert.throws(
    () => validateTransitionInput({ ...validInput(), databaseUrl: "postgresql://secret" }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_SHAPE_INVALID"
  );
  assert.throws(
    () => validateTransitionInput({
      ...validInput(),
      migration: { ...validInput().migration, records: [{ patient: "not metadata" }] }
    }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_SHAPE_INVALID"
  );
  assert.throws(
    () => validateTransitionInput({ ...validInput(), failover: { ...validInput().failover, dataLossObserved: null } }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_SHAPE_INVALID"
  );
  assert.throws(
    () => validateTransitionInput({
      ...validInput(),
      fallback: { ...validInput().fallback, evidenceRef: "postgresql://user:password@private-db" }
    }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_SHAPE_INVALID"
  );
});

test("transition input file must be absolute, regular, non-symlink and at most one MiB", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-transition-readiness-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const validFile = path.join(directory, "transition.json");
  const validSource = JSON.stringify(validInput());
  fs.writeFileSync(validFile, validSource, "utf8");
  assert.deepEqual(readTransitionInput(validFile, { sha256: sha256(validSource) }), validInput());
  assert.throws(
    () => readTransitionInput(validFile),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_DIGEST_INVALID"
  );
  for (const digest of ["A".repeat(64), "z".repeat(64)]) {
    assert.throws(
      () => readTransitionInput(validFile, { sha256: digest }),
      (error) => error.code === "POSTGRES_TRANSITION_INPUT_DIGEST_INVALID"
    );
  }
  assert.throws(
    () => readTransitionInput(validFile, { sha256: "0".repeat(64) }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_DIGEST_MISMATCH"
  );
  assert.throws(
    () => readTransitionInput("transition.json"),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_PATH_INVALID"
  );
  assert.throws(
    () => readTransitionInput(path.join(directory, "missing.json"), { sha256: "a".repeat(64) }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_UNAVAILABLE"
  );
  assert.throws(
    () => readTransitionInput(directory, { sha256: "a".repeat(64) }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID"
  );

  const invalidJson = path.join(directory, "invalid.json");
  const invalidSource = "{not-json";
  fs.writeFileSync(invalidJson, invalidSource, "utf8");
  assert.throws(
    () => readTransitionInput(invalidJson, { sha256: sha256(invalidSource) }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_JSON_INVALID"
  );

  const oversized = path.join(directory, "oversized.json");
  const oversizedSource = Buffer.alloc(MAX_INPUT_BYTES + 1, 0x20);
  fs.writeFileSync(oversized, oversizedSource);
  assert.throws(
    () => readTransitionInput(oversized, { sha256: sha256(oversizedSource) }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID"
  );

  const link = path.join(directory, "transition-link.json");
  try {
    fs.symlinkSync(validFile, link, "file");
  } catch (error) {
    t.diagnostic(`symlink test unavailable: ${error.code || error.message}`);
    return;
  }
  assert.throws(
    () => readTransitionInput(link, { sha256: sha256(validSource) }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID"
  );
});

test("transition input revalidates the opened descriptor after a path swap", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-transition-swap-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "transition.json");
  fs.writeFileSync(file, JSON.stringify(validInput()), "utf8");
  const replacingFileSystem = {
    lstatSync: fs.lstatSync.bind(fs),
    openSync(target, ...args) {
      fs.writeFileSync(target, Buffer.alloc(MAX_INPUT_BYTES + 1, 0x20));
      return fs.openSync(target, ...args);
    },
    fstatSync: fs.fstatSync.bind(fs),
    readSync: fs.readSync.bind(fs),
    closeSync: fs.closeSync.bind(fs)
  };
  assert.throws(
    () => readTransitionInput(file, { fileSystem: replacingFileSystem, sha256: sha256(JSON.stringify(validInput())) }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID"
  );

  const sameSizeFile = path.join(directory, "same-size.json");
  const original = JSON.stringify(validInput());
  const replacement = original.replace('"verified"', '"attacker"');
  assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(original));
  fs.writeFileSync(sameSizeFile, original, "utf8");
  let firstLstat = true;
  const sameSizeReplacingFileSystem = {
    lstatSync(target) {
      const stat = fs.lstatSync(target);
      if (firstLstat) {
        firstLstat = false;
        const replacementFile = path.join(directory, "replacement.json");
        fs.writeFileSync(replacementFile, replacement, "utf8");
        fs.rmSync(target);
        fs.renameSync(replacementFile, target);
      }
      return stat;
    },
    openSync: fs.openSync.bind(fs),
    fstatSync: fs.fstatSync.bind(fs),
    readSync: fs.readSync.bind(fs),
    closeSync: fs.closeSync.bind(fs)
  };
  assert.throws(
    () => readTransitionInput(sameSizeFile, { fileSystem: sameSizeReplacingFileSystem, sha256: sha256(original) }),
    (error) => error.code === "POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID"
  );

  const inPlaceFile = path.join(directory, "in-place.json");
  fs.writeFileSync(inPlaceFile, original, "utf8");
  const inPlaceReplacingFileSystem = {
    lstatSync: fs.lstatSync.bind(fs),
    openSync(target, ...args) {
      fs.writeFileSync(target, replacement, "utf8");
      return fs.openSync(target, ...args);
    },
    fstatSync: fs.fstatSync.bind(fs),
    readSync: fs.readSync.bind(fs),
    closeSync: fs.closeSync.bind(fs)
  };
  assert.throws(
    () => readTransitionInput(inPlaceFile, { fileSystem: inPlaceReplacingFileSystem, sha256: sha256(original) }),
    (error) => ["POSTGRES_TRANSITION_INPUT_BOUNDARY_INVALID", "POSTGRES_TRANSITION_INPUT_DIGEST_MISMATCH"].includes(error.code)
  );
});

test("transition readiness CLI arguments use a closed fail-closed contract", () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(["--input=C:\\evidence\\transition.json", `--sha256=${"a".repeat(64)}`]), {
    input: "C:\\evidence\\transition.json",
    sha256: "a".repeat(64)
  });
  for (const argv of [
    ["transition.json"],
    ["--unknown=value"],
    ["--input"],
    ["--input="],
    ["--sha256"],
    ["--sha256="],
    ["--input=a", "--input=b"],
    ["--sha256=a", "--sha256=b"]
  ]) {
    assert.throws(
      () => parseArgs(argv),
      (error) => error.code === "POSTGRES_TRANSITION_ARGUMENT_INVALID"
    );
  }
});

test("CLI fails closed for missing and malformed input without leaking paths or content", (t) => {
  const missing = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, POSTGRES_PRIMARY_TRANSITION_INPUT_FILE: "" },
    encoding: "utf8"
  });
  assert.equal(missing.status, 1);
  const missingReport = JSON.parse(missing.stderr);
  assert.equal(missingReport.ok, false);
  assert.equal(missingReport.code, "POSTGRES_TRANSITION_INPUT_PATH_INVALID");
  assert.equal(missingReport.readyForControlledRehearsal, false);
  assert.equal(missingReport.productionReady, false);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-transition-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const valid = path.join(directory, "transition.json");
  const validSource = JSON.stringify(validInput());
  fs.writeFileSync(valid, validSource, "utf8");
  const passed = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...readyEnv(),
      POSTGRES_PRIMARY_TRANSITION_INPUT_FILE: valid,
      POSTGRES_PRIMARY_TRANSITION_INPUT_SHA256: sha256(validSource)
    },
    encoding: "utf8"
  });
  assert.equal(passed.status, 0, passed.stderr);
  const passedReport = JSON.parse(passed.stdout);
  assert.equal(passedReport.checks.length, 7);
  assert.equal(passedReport.readyForControlledRehearsal, true);
  assert.equal(passedReport.productionPrimary, false);
  assert.doesNotMatch(passed.stdout, /private-user|private-password|DATABASE_URL/);

  const invalid = path.join(directory, "database-password-super-secret.json");
  const invalidSource = "postgresql://user:database-password@private-db";
  fs.writeFileSync(invalid, invalidSource, "utf8");
  const malformed = spawnSync(process.execPath, [SCRIPT, `--input=${invalid}`, `--sha256=${sha256(invalidSource)}`], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8"
  });
  assert.equal(malformed.status, 1);
  const malformedReport = JSON.parse(malformed.stderr);
  assert.equal(malformedReport.code, "POSTGRES_TRANSITION_INPUT_JSON_INVALID");
  assert.doesNotMatch(malformed.stderr, /database-password|private-db|postgresql:\/\//);
});

test("unexpected failures are reduced to a stable redacted projection", () => {
  const failure = safeFailure(new Error("postgresql://user:secret@private-db/internal"));
  assert.equal(failure.code, "POSTGRES_TRANSITION_READINESS_FAILED");
  assert.equal(failure.productionPrimary, false);
  assert.doesNotMatch(JSON.stringify(failure), /user:secret|private-db|postgresql:\/\//);

  let configurationError;
  try {
    buildTransitionReadinessReport({
      input: validInput(),
      env: readyEnv({ POSTGRES_PRIMARY_STORAGE_MODE: "postgresql://user:secret@private-db" })
    });
  } catch (error) {
    configurationError = error;
  }
  const configurationFailure = safeFailure(configurationError);
  assert.equal(configurationFailure.code, "INVALID_POSTGRES_PRIMARY_STORAGE_MODE");
  assert.doesNotMatch(JSON.stringify(configurationFailure), /user:secret|private-db|postgresql:\/\//);
});
