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
  createDefaultRuntime,
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

test("worker default composition supplies a lazy control provider", () => {
  const serverPath = require.resolve("../server");
  delete require.cache[serverPath];
  const runtime = createDefaultRuntime();
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(typeof runtime.controlProvider, "function");
  assert.equal(require.cache[serverPath], undefined);
});

test("delivery cycle requires an injected provider without loading the composition root", async () => {
  const fixture = runtimeFixture();
  const serverPath = require.resolve("../server");
  delete require.cache[serverPath];
  try {
    const report = await runPilotCutoverAlertDeliveryCycle({
      env: fixture.env,
      now: NOW,
      dispatcher: async () => ({
        receiptId: "provider-required-receipt",
        status: "accepted",
        acceptedAt: NOW
      })
    });
    assert.equal(report.schema, "pilot-cutover-alert-worker-cycle-v1");
    assert.equal(report.controlDecision, "NO-GO");
    assert.equal(report.controlErrorCode, "PILOT_CUTOVER_CONTROL_PROVIDER_REQUIRED");
    assert.equal(report.productionReady, false);
    assert.equal(require.cache[serverPath], undefined);
  } finally {
    fixture.cleanup();
  }
});

test("provider failures expose only a bounded code and remain non-authorizing", async () => {
  const fixture = runtimeFixture();
  try {
    const report = await runPilotCutoverAlertDeliveryCycle({
      env: fixture.env,
      now: NOW,
      controlProvider: async () => {
        throw Object.assign(new Error("secret provider response must stay private"), {
          code: "UPSTREAM_CONTROL_PROVIDER_BLOCKED"
        });
      },
      dispatcher: async () => ({
        receiptId: "provider-failure-receipt",
        status: "accepted",
        acceptedAt: NOW
      })
    });
    assert.equal(report.controlDecision, "NO-GO");
    assert.equal(report.controlErrorCode, "UPSTREAM_CONTROL_PROVIDER_BLOCKED");
    assert.equal(report.cutoverExecutionAuthorized, false);
    assert.equal(report.productionReady, false);
    assert.doesNotMatch(JSON.stringify(report), /secret provider response/i);
  } finally {
    fixture.cleanup();
  }
});

test("invalid provider projections fail closed before candidate derivation", async () => {
  const fixture = runtimeFixture();
  try {
    const report = await runPilotCutoverAlertDeliveryCycle({
      env: fixture.env,
      now: NOW,
      controlProvider: async () => null,
      dispatcher: async () => ({
        receiptId: "invalid-provider-receipt",
        status: "accepted",
        acceptedAt: NOW
      })
    });
    assert.equal(report.controlDecision, "NO-GO");
    assert.equal(report.controlErrorCode, "PILOT_CUTOVER_CONTROL_PROVIDER_INVALID");
    assert.equal(report.cutoverExecutionAuthorized, false);
    assert.equal(report.productionReady, false);
  } finally {
    fixture.cleanup();
  }
});

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
  let providerCalls = 0;
  const result = await run({
    command: "run-once",
    options: {}
  }, {
    env: {},
    now: NOW,
    controlProvider: async () => {
      providerCalls += 1;
      return blockedControl();
    }
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.productionReady, false);
  assert.equal(providerCalls, 0);
});

test("worker CLI default provider composes the existing server readiness", async () => {
  const fixture = runtimeFixture();
  try {
    const result = await run({
      command: "run-once",
      options: {}
    }, {
      ...createDefaultRuntime(),
      env: fixture.env,
      now: NOW,
      dispatcher: async () => ({
        receiptId: "default-provider-receipt",
        status: "accepted",
        acceptedAt: NOW
      })
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.schema, "pilot-cutover-alert-worker-cycle-v1");
    assert.equal(result.report.controlDecision, "NO-GO");
    assert.equal(result.report.cutoverExecutionAuthorized, false);
    assert.equal(result.report.productionReady, false);
  } finally {
    fixture.cleanup();
  }
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
