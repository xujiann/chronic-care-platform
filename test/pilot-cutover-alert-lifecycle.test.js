"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  acknowledgePilotCutoverAlert,
  buildPilotCutoverAlertProjection,
  deliverPilotCutoverAlert,
  derivePilotCutoverAlertCandidates,
  escalatePilotCutoverAlert,
  pilotCutoverMonitoringAdapterStatus,
  readPilotCutoverAlertJournal,
  recoverPilotCutoverAlert,
  redrivePilotCutoverAlert
} = require("../src/platform/cutover/pilot-cutover-alert-lifecycle");

const NOW = "2030-08-04T12:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;

function withJournal(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-alerts-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "alerts.ndjson");
}

function controlFixture() {
  return {
    evaluatedAt: NOW,
    releaseId: "release-2030-08-04",
    decision: "NO-GO",
    ledger: {
      releaseId: "release-2030-08-04",
      packageFingerprint: `sha256:${"b".repeat(64)}`,
      chainValid: false,
      headDigest: `sha256:${"c".repeat(64)}`,
      trustReady: false,
      rehearsalReady: false,
      lifecycle: [
        {
          eventId: "expired-security",
          scope: "security-assessment",
          expiresAt: "2030-08-04T11:59:59.000Z",
          revoked: false
        },
        {
          eventId: "revoked-monitoring",
          scope: "monitoring-drill",
          expiresAt: "2030-08-06T12:00:00.000Z",
          revoked: true
        },
        {
          eventId: "expiring-dr",
          scope: "dr-rehearsal",
          expiresAt: "2030-08-04T18:00:00.000Z",
          revoked: false
        }
      ],
      trust: [
        {
          eventId: "unknown-key-event",
          result: {
            scope: "site-acceptance",
            checks: {
              keyKnown: false,
              keyActiveAtIssuance: false,
              keyCurrent: false,
              account: false,
              scope: false,
              attestationSchema: true,
              algorithm: true,
              nonce: true,
              subjectDigest: true,
              signatureFormat: true,
              signature: false
            }
          }
        }
      ]
    }
  };
}

test("cutover health projection emits explicit metadata-only lifecycle signals", () => {
  const candidates = derivePilotCutoverAlertCandidates(controlFixture(), {
    now: NOW,
    warningHours: 12
  });
  const codes = new Set(candidates.map((row) => row.signalCode));
  [
    "CONTROL_EVIDENCE_EXPIRED",
    "CONTROL_EVIDENCE_EXPIRING",
    "CONTROL_EVIDENCE_REVOKED",
    "CUTOVER_PUBLIC_KEY_INVALID",
    "CUTOVER_SIGNATURE_ANOMALY",
    "LEDGER_CHAIN_INVALID",
    "PREPRODUCTION_REHEARSAL_EXPIRED"
  ].forEach((code) => assert.equal(codes.has(code), true, code));
  assert.equal(candidates.every((row) =>
    row.evidenceRefs.every((ref) => ref.startsWith("monitoring://"))), true);
  assert.doesNotMatch(
    JSON.stringify(candidates),
    /residentId|patientId|publicKeyPem|"signature"\s*:/
  );
});

test("delivery retries with a stable identity and stores only minimized receipts", async (t) => {
  const file = withJournal(t);
  const candidate = derivePilotCutoverAlertCandidates(controlFixture(), {
    now: NOW,
    warningHours: 12
  })[0];
  const received = [];
  const result = await deliverPilotCutoverAlert({
    file,
    candidate,
    routes: ["SIEM"],
    maximumAttempts: 3,
    actorAccount: "monitoring-worker",
    now: NOW,
    dispatcher: async (input) => {
      received.push(input);
      if (received.length === 1) {
        const error = new Error("receiver temporarily unavailable with raw internal trace");
        error.code = "MONITORING_TEMPORARY_UNAVAILABLE";
        error.retryable = true;
        throw error;
      }
      return {
        receiptId: "external-receipt-must-not-be-persisted",
        status: "accepted",
        acceptedAt: NOW
      };
    },
    sleep: async () => undefined
  });
  assert.equal(result.delivered, true);
  assert.equal(result.outcomes[0].attempts, 2);
  assert.equal(new Set(received.map((row) => row.idempotencyKey)).size, 1);
  const events = readPilotCutoverAlertJournal(file);
  assert.deepEqual(events.map((row) => row.type), [
    "alert-opened",
    "delivery-attempted",
    "delivery-failed",
    "delivery-attempted",
    "delivery-acknowledged"
  ]);
  const persisted = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(persisted, /raw internal trace|external-receipt-must-not-be-persisted/);
  assert.match(persisted, /monitoring:\/\/siem\//);
  assert.equal(buildPilotCutoverAlertProjection({ file, now: NOW }).summary.deadLetter, 0);
});

test("terminal delivery enters dead letter and authorized redrive is audited", async (t) => {
  const file = withJournal(t);
  const candidate = derivePilotCutoverAlertCandidates(controlFixture(), {
    now: NOW,
    warningHours: 12
  })[0];
  const result = await deliverPilotCutoverAlert({
    file,
    candidate,
    routes: "WEBHOOK",
    maximumAttempts: 2,
    actorAccount: "monitoring-worker",
    now: NOW,
    dispatcher: async () => {
      const error = new Error("receiver rejected");
      error.code = "MONITORING_RECEIVER_REJECTED";
      error.retryable = false;
      throw error;
    }
  });
  assert.equal(result.delivered, false);
  assert.equal(result.failClosed, true);
  assert.equal(result.outcomes[0].attempts, 1);
  assert.equal(buildPilotCutoverAlertProjection({ file, now: NOW }).summary.deadLetter, 1);
  await assert.rejects(() => deliverPilotCutoverAlert({
    file,
    candidate,
    routes: "WEBHOOK",
    maximumAttempts: 1,
    actorAccount: "monitoring-worker",
    now: NOW,
    dispatcher: async () => ({ receiptId: "must-not-redeliver" })
  }), /audited redrive approval/);

  redrivePilotCutoverAlert({
    file,
    alertFingerprint: candidate.fingerprint,
    actorAccount: "monitoring-commission",
    recordedAt: NOW,
    evidenceRef: "ticket://monitoring/redrive-approval",
    evidenceDigest: DIGEST
  });
  assert.equal(
    buildPilotCutoverAlertProjection({ file, now: NOW }).alerts[0].deliveryStatus,
    "pending"
  );
});

test("one failed route keeps a multi-route delivery in dead letter", async (t) => {
  const file = withJournal(t);
  const candidate = derivePilotCutoverAlertCandidates(controlFixture(), {
    now: NOW,
    warningHours: 12
  })[0];
  const result = await deliverPilotCutoverAlert({
    file,
    candidate,
    routes: ["WEBHOOK", "SIEM"],
    maximumAttempts: 1,
    actorAccount: "monitoring-worker",
    now: NOW,
    dispatcher: async (input) => {
      if (input.route === "WEBHOOK") {
        const error = new Error("webhook is unavailable");
        error.code = "WEBHOOK_UNAVAILABLE";
        error.retryable = false;
        throw error;
      }
      return { receiptId: "siem-receipt-1", status: "accepted", acceptedAt: NOW };
    }
  });
  assert.equal(result.delivered, false);
  assert.equal(
    buildPilotCutoverAlertProjection({ file, now: NOW }).alerts[0].deliveryStatus,
    "dead-letter"
  );
});

test("human acknowledgement, escalation and recovery form a constrained audit trail", async (t) => {
  const file = withJournal(t);
  const candidate = derivePilotCutoverAlertCandidates(controlFixture(), {
    now: NOW,
    warningHours: 12
  })[0];
  await deliverPilotCutoverAlert({
    file,
    candidate,
    routes: ["SIEM"],
    maximumAttempts: 1,
    actorAccount: "monitoring-worker",
    now: NOW,
    dispatcher: async () => ({
      receiptId: "siem-receipt-1",
      status: "accepted",
      acceptedAt: NOW
    })
  });
  assert.throws(() => recoverPilotCutoverAlert({
    file,
    alertFingerprint: candidate.fingerprint,
    actorAccount: "duty-officer",
    recordedAt: NOW,
    evidenceRef: "ticket://monitoring/recovery-1",
    evidenceDigest: DIGEST
  }), /acknowledged or escalated/);

  acknowledgePilotCutoverAlert({
    file,
    alertFingerprint: candidate.fingerprint,
    actorAccount: "duty-officer",
    recordedAt: NOW,
    evidenceRef: "ticket://monitoring/ack-1",
    evidenceDigest: DIGEST
  });
  escalatePilotCutoverAlert({
    file,
    alertFingerprint: candidate.fingerprint,
    actorAccount: "incident-commander",
    recordedAt: NOW,
    level: "P0",
    ownerGroup: "cutover-command",
    evidenceRef: "ticket://monitoring/escalation-1",
    evidenceDigest: DIGEST
  });
  recoverPilotCutoverAlert({
    file,
    alertFingerprint: candidate.fingerprint,
    actorAccount: "incident-commander",
    recordedAt: NOW,
    evidenceRef: "evidence://monitoring/recovery-1",
    evidenceDigest: DIGEST
  });
  const projection = buildPilotCutoverAlertProjection({ file, now: NOW });
  assert.equal(projection.alerts[0].status, "recovered");
  assert.equal(projection.alerts[0].escalationLevel, "P0");
  assert.equal(projection.summary.recovered, 1);
  assert.equal(projection.monitoringAcceptanceProven, false);
  assert.equal(projection.productionReady, false);
});

test("journal rejects tampering and sensitive fields", async (t) => {
  const file = withJournal(t);
  const candidate = derivePilotCutoverAlertCandidates(controlFixture(), {
    now: NOW,
    warningHours: 12
  })[0];
  await assert.rejects(() => deliverPilotCutoverAlert({
    file,
    candidate: { ...candidate, patientId: "forbidden" },
    routes: ["SIEM"],
    maximumAttempts: 1,
    actorAccount: "monitoring-worker",
    dispatcher: async () => ({ receiptId: "never" })
  }), /forbidden/);

  await deliverPilotCutoverAlert({
    file,
    candidate,
    routes: ["SIEM"],
    maximumAttempts: 1,
    actorAccount: "monitoring-worker",
    now: NOW,
    dispatcher: async () => ({
      receiptId: "siem-receipt-1",
      status: "accepted",
      acceptedAt: NOW
    })
  });
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const first = JSON.parse(lines[0]);
  first.details.title = "tampered";
  fs.writeFileSync(file, `${JSON.stringify(first)}\n${lines.slice(1).join("\n")}\n`);
  assert.throws(
    () => readPilotCutoverAlertJournal(file),
    (error) => error.code === "PILOT_CUTOVER_ALERT_JOURNAL_DIGEST_INVALID"
  );
});

test("adapter readiness is fail-closed and never exposes endpoints or secrets", (t) => {
  const file = withJournal(t);
  const blocked = pilotCutoverMonitoringAdapterStatus({
    file,
    env: { PLATFORM_PILOT_CUTOVER_ALERT_ROUTES: "SIEM" }
  });
  assert.equal(blocked.adapterReady, false);
  assert.equal(blocked.failClosed, true);

  const ready = pilotCutoverMonitoringAdapterStatus({
    file,
    env: {
      PLATFORM_PILOT_CUTOVER_ALERT_ROUTES: "SIEM,WEBHOOK",
      SIEM_ENDPOINT: "https://siem.example.gov.cn/events",
      SIEM_SIGNING_SECRET: "injected-secret",
      ALERT_WEBHOOK_URL: "https://alerts.example.gov.cn/hooks",
      ALERT_WEBHOOK_SECRET: "injected-webhook-secret"
    }
  });
  assert.equal(ready.adapterReady, true);
  assert.equal(ready.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify(ready),
    /siem\.example|alerts\.example|injected-secret|injected-webhook-secret/
  );
});
