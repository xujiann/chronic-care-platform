"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyPilotCutoverAlertCommand,
  buildPilotCutoverAlertControlStatus,
  runPilotCutoverAlertDeliveryCycle
} = require("../src/platform/cutover/pilot-cutover-alert-runtime");
const {
  parseArgs,
  run
} = require("../scripts/platform-cutover-alert-worker");

const NOW = "2026-08-05T08:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;

function runtimeFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-alert-runtime-"));
  const file = path.join(directory, "alerts.ndjson");
  const env = {
    PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE: file,
    PLATFORM_PILOT_CUTOVER_ALERT_ROUTES: "SIEM",
    PLATFORM_PILOT_CUTOVER_ALERT_WORKER_ENABLED: "true",
    PLATFORM_PILOT_CUTOVER_ALERT_WORKER_ACCOUNT: "alert-worker",
    SIEM_ENDPOINT: "https://siem.example.invalid/alerts",
    SIEM_SIGNING_SECRET: "x".repeat(48)
  };
  return {
    directory,
    file,
    env,
    cleanup: () => fs.rmSync(directory, { force: true, recursive: true })
  };
}

function blockedControl() {
  return {
    schema: "pilot-cutover-authorization-control-v1",
    evaluatedAt: NOW,
    releaseId: "release-20260805",
    decision: "NO-GO",
    ledger: {
      releaseId: "release-20260805",
      packageFingerprint: `sha256:${"b".repeat(64)}`,
      headDigest: DIGEST,
      chainValid: false,
      trustReady: false,
      rehearsalReady: false,
      lifecycle: [],
      trust: []
    },
    cutoverExecutionAuthorized: false,
    productionReady: false
  };
}

test("worker delivers metadata candidates outside request handling and remains non-authorizing", async () => {
  const fixture = runtimeFixture();
  try {
    const before = buildPilotCutoverAlertControlStatus({
      env: fixture.env,
      now: NOW
    });
    assert.equal(before.status, "operational");
    assert.equal(before.summary.total, 0);

    const dispatched = [];
    const report = await runPilotCutoverAlertDeliveryCycle({
      env: fixture.env,
      now: NOW,
      controlProvider: async () => blockedControl(),
      dispatcher: async (request) => {
        dispatched.push(request);
        return {
          receiptId: `receipt-${dispatched.length}`,
          status: "accepted",
          acceptedAt: NOW
        };
      }
    });
    assert.equal(report.status, "completed");
    assert.equal(report.candidates, 3);
    assert.equal(report.delivered, 3);
    assert.equal(report.failed, 0);
    assert.equal(report.cutoverExecutionAuthorized, false);
    assert.equal(report.productionReady, false);
    assert.equal(dispatched.every((row) => row.route === "SIEM"), true);
    assert.doesNotMatch(fs.readFileSync(fixture.file, "utf8"), /SIEM_SIGNING_SECRET|x{20}|patient/i);

    const after = buildPilotCutoverAlertControlStatus({
      env: fixture.env,
      now: NOW
    });
    assert.equal(after.summary.total, 3);
    assert.equal(after.summary.critical, 3);
    assert.equal(after.summary.deadLetter, 0);
  } finally {
    fixture.cleanup();
  }
});

test("authenticated commands append constrained lifecycle events and expose no evidence body", async () => {
  const fixture = runtimeFixture();
  try {
    await runPilotCutoverAlertDeliveryCycle({
      env: fixture.env,
      now: NOW,
      controlProvider: async () => blockedControl(),
      dispatcher: async () => ({
        receiptId: "stable-receipt",
        status: "accepted",
        acceptedAt: NOW
      })
    });
    const fingerprint = buildPilotCutoverAlertControlStatus({
      env: fixture.env,
      now: NOW
    }).projection.alerts[0].fingerprint;
    for (const [action, extra] of [
      ["acknowledge", {}],
      ["escalate", { level: "P0", ownerGroup: "security-on-call" }],
      ["recover", {}]
    ]) {
      const result = applyPilotCutoverAlertCommand({
        env: fixture.env,
        action,
        alertFingerprint: fingerprint,
        actorAccount: "commission-user",
        evidenceRef: `ticket://alerts/${action}`,
        evidenceDigest: DIGEST,
        recordedAt: NOW,
        ...extra
      });
      assert.equal(result.action, action);
      assert.equal(result.event.actorAccount, "commission-user");
      assert.equal(result.productionReady, false);
      assert.equal("details" in result.event, false);
    }
    const alert = buildPilotCutoverAlertControlStatus({
      env: fixture.env,
      now: NOW
    }).projection.alerts.find((row) => row.fingerprint === fingerprint);
    assert.equal(alert.status, "recovered");
  } finally {
    fixture.cleanup();
  }
});

test("worker CLI is fail-closed when adapter configuration is absent", async () => {
  assert.deepEqual(parseArgs(["status", "--require-operational"]), {
    command: "status",
    options: { "require-operational": true }
  });
  const result = await run({
    command: "run-once",
    options: {}
  }, {
    env: {},
    now: NOW,
    controlProvider: async () => blockedControl()
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.productionReady, false);
});

test("deployment runs a hardened independent worker on a timer", () => {
  const service = fs.readFileSync(
    path.join(__dirname, "..", "deploy", "platform-cutover-alert-worker.service.template"),
    "utf8"
  );
  const timer = fs.readFileSync(
    path.join(__dirname, "..", "deploy", "platform-cutover-alert-worker.timer.template"),
    "utf8"
  );
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^User=health-platform-alert$/m);
  assert.match(service, /platform-cutover-alert-worker\.js run-once/);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
  assert.match(timer, /^OnUnitActiveSec=1min$/m);
  assert.doesNotMatch(service, /server\.js/);
});
