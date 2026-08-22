"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { cliErrorCode, main, parseArgs, workerRunExitCode } = require("../scripts/chronic-followup-dispatch-worker");
const {
  inspectFollowupDispatchWorkerReadiness,
  resolveFollowupDispatchSqliteFile
} = require("../src/citizen-chronic/followup-dispatch-worker");

test("worker CLI parses bounded operational flags", () => {
  assert.deepEqual(parseArgs(["--status", "--limit=10", "--lease-seconds=30"]), {
    status: true,
    limit: "10",
    "lease-seconds": "30"
  });
});

test("worker SQLite path is canonically bound to the platform DATA_DIR", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "followup-worker-data-"));
  try {
    const expected = path.join(directory, "health-city.sqlite");
    assert.equal(resolveFollowupDispatchSqliteFile({ DATA_DIR: directory }, expected), expected);
    assert.throws(
      () => resolveFollowupDispatchSqliteFile({ DATA_DIR: directory }, path.join(directory, "wrong.sqlite")),
      /must match platform DATA_DIR/
    );
    assert.throws(() => resolveFollowupDispatchSqliteFile({}, expected), /platform DATA_DIR/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("worker preflight exposes external blockers without secret values or false readiness", async () => {
  const report = await main(["--preflight"], {
    env: {
      NODE_ENV: "production",
      DATA_DIR: "/var/lib/chronic-care-platform",
      CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE: "/var/lib/chronic-care-platform/health-city.sqlite",
      CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_WORKER_ID: "worker-a",
      CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL: "https://followup.example.gov.cn/events",
      CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET: "private-secret-that-must-not-be-printed"
    }
  });
  assert.equal(report.productionReady, false);
  assert.equal(report.configured, false);
  assert.equal(report.checks.find((item) => item.id === "activation-verifier").passed, false);
  assert.doesNotMatch(JSON.stringify(report), /private-secret-that-must-not-be-printed/);
});

test("worker readiness becomes true only with complete config and externally verified release evidence", () => {
  const env = {
    NODE_ENV: "production",
    DATA_DIR: "/var/lib/chronic-care-platform",
    CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE: "/var/lib/chronic-care-platform/health-city.sqlite",
    CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_WORKER_ID: "worker-a",
    CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL: "https://followup.example.gov.cn/events",
    CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET: "a".repeat(32)
  };
  const blocked = inspectFollowupDispatchWorkerReadiness(env, {
    activationVerifierConfigured: true
  });
  assert.equal(blocked.configured, true);
  assert.equal(blocked.productionReady, false);
  assert.equal(blocked.checks.find((item) => item.id === "external-production-evidence").passed, false);
  const ready = inspectFollowupDispatchWorkerReadiness(env, {
    activationVerifierConfigured: true,
    externalEvidenceVerified: true
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.externalEvidenceVerified, true);
  assert.equal(ready.productionReady, true);
});

test("CLI failure output uses one stable code and never includes provider messages or paths", () => {
  assert.equal(cliErrorCode(new Error("ENOENT C:\\private\\activation-registry.json")), "FOLLOWUP_DISPATCH_WORKER_FAILED");
  assert.equal(cliErrorCode({ code: "FOLLOWUP_SECRET_PRIVATE_PATH", message: "/run/secrets/private" }), "FOLLOWUP_DISPATCH_WORKER_FAILED");
  const source = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "chronic-followup-dispatch-worker.js"), "utf8");
  assert.doesNotMatch(source, /error\.message|error\?\.message/);
});

test("worker status opens a migrated v16 repository without delivery side effects", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const report = await main(["--status"], { db, env: {} });
    assert.deepEqual(report.counts, { pending: 0, leased: 0, delivered: 0, "dead-letter": 0 });
    assert.equal(report.requestPathExternalDispatch, false);
    assert.equal(report.productionReady, false);
  } finally {
    db.close();
  }
});

test("worker run exits nonzero after printing persistence rejection or new dead letter", async () => {
  assert.equal(workerRunExitCode({ persistenceRejected: 0, deadLettered: 0 }), 0);
  assert.equal(workerRunExitCode({ persistenceRejected: 1, deadLettered: 0 }), 1);
  assert.equal(workerRunExitCode({ persistenceRejected: 0, deadLettered: 1 }), 1);
  const db = new DatabaseSync(":memory:");
  const exitCodes = [];
  try {
    const report = await main([], {
      db,
      env: {},
      runWorker: async () => ({
        contract: "citizen-chronic.followup-dispatch-worker.v1",
        claimed: 1,
        delivered: 0,
        retryScheduled: 0,
        deadLettered: 0,
        persistenceRejected: 1,
        outcomes: [{
          eventId: "event-001",
          status: "persistence-rejected",
          errorDigest: `sha256:${"a".repeat(64)}`
        }],
        productionReady: false
      }),
      setExitCode: (value) => exitCodes.push(value)
    });
    assert.equal(report.persistenceRejected, 1);
    assert.deepEqual(exitCodes, [1]);
    assert.doesNotMatch(JSON.stringify(report), /lease-token|private error/);
  } finally {
    db.close();
  }
});
