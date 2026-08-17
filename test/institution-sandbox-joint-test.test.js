"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildInstitutionSandboxReadiness,
  closeInstitutionSandboxReferral,
  createSignedReceiptDigest,
  executeInstitutionSandboxAttempt,
  sha256,
  startInstitutionSandboxJointTest
} = require("../src/platform/integration/institution-sandbox-joint-test");
const { main: readinessMain } = require("../scripts/institution-sandbox-readiness");

const ENDPOINT = "https://sandbox-his.invalid/joint-test";

function start(commandId = "sandbox-start-001", correlationId = "corr-sandbox-001") {
  return startInstitutionSandboxJointTest({}, {
    commandId,
    regionCode: "999999",
    institutionSlot: "preproduction-hospital-slot",
    correlationId,
    adapterId: "hospital-his",
    requestDigest: sha256(`request:${correlationId}`),
    requestEvidenceRef: `artifact://institution-sandbox/${correlationId}/request`
  }, { endpoint: ENDPOINT, now: "2026-08-17T10:00:00.000Z" });
}

function acceptedReceipt(request, receivedAt = "2026-08-17T10:01:01.000Z") {
  const receipt = {
    acknowledgedRequestDigest: request.requestDigest,
    responseDigest: sha256(`response:${request.correlationId}`),
    signatureDigest: sha256(`detached-signature:${request.correlationId}`),
    receiptEvidenceRef: `evidence://institution-sandbox/${request.correlationId}/receipt`,
    signatureVerificationEvidenceRef: `vault://institution-sandbox/${request.correlationId}/verification`,
    signatureVerified: true,
    receivedAt
  };
  return { ...receipt, receiptDigest: createSignedReceiptDigest(receipt) };
}

test("sandbox injects an HTTPS transport, verifies a signed-digest receipt and binds the chronic referral loop", async () => {
  let result = start();
  const sessionId = result.result.sessionId;
  let delivered;
  let transportCalls = 0;
  result = await executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-attempt-001",
    sessionId,
    expectedVersion: 0
  }, {
    endpoint: ENDPOINT,
    nonce: "one-time-nonce-001",
    requestTimestamp: "2026-08-17T10:01:00.000Z",
    now: "2026-08-17T10:01:02.000Z",
    transport: {
      async send(request) {
        transportCalls += 1;
        delivered = request;
        return { outcome: "accepted", receipt: acceptedReceipt(request) };
      }
    }
  });
  assert.equal(transportCalls, 1);
  assert.equal(delivered.endpoint, ENDPOINT);
  assert.equal(delivered.requestDigest, result.result.requestDigest);
  assert.equal(Object.hasOwn(delivered, "payload"), false);
  assert.equal(result.result.status, "receipt-verified");
  assert.equal(result.result.latestReceipt.signatureVerifiedByTransport, true);
  assert.equal(result.result.productionReady, false);

  const replay = await executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-attempt-001",
    sessionId,
    expectedVersion: 0
  }, {
    endpoint: ENDPOINT,
    nonce: "a-different-runtime-nonce",
    requestTimestamp: "2026-08-17T10:01:00.000Z",
    now: "2026-08-17T10:01:03.000Z",
    transport: { async send() { throw new Error("must not dispatch an idempotent replay"); } }
  });
  assert.equal(replay.replayed, true);
  assert.equal(transportCalls, 1);

  result = closeInstitutionSandboxReferral(result.data, {
    commandId: "sandbox-close-001",
    sessionId,
    expectedVersion: 1,
    subjectRefDigest: sha256("opaque-subject-reference")
  }, { now: "2026-08-17T10:02:00.000Z" });
  assert.equal(result.result.status, "sandbox-referral-closed");
  assert.equal(result.loop.ok, true);
  assert.equal(result.loop.phase, "closed");
  assert.match(result.result.referralClosure.loopIdDigest, /^sha256:[a-f0-9]{64}$/);

  const readiness = buildInstitutionSandboxReadiness(result.data, { now: "2026-08-17T10:03:00.000Z" });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.localTechnicalReady, true);
  assert.equal(readiness.summary.closedLoops, 1);
  assert.equal(readiness.productionGate, "NO-GO");
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.externalEvidenceVerified, false);

  const persisted = JSON.stringify(result.data);
  assert.doesNotMatch(persisted, /https:\/\//);
  assert.doesNotMatch(persisted, /one-time-nonce-001|opaque-subject-reference|detached-signature:/);
  assert.doesNotMatch(persisted, /"payload"|"body"|"credentials"|"privateKey"/i);
});

test("sandbox blocks non-HTTPS endpoints, stale windows and nonce replay before dispatch", async () => {
  assert.throws(() => startInstitutionSandboxJointTest({}, {
    commandId: "sandbox-start-http",
    regionCode: "999999",
    institutionSlot: "hospital-slot",
    correlationId: "corr-sandbox-http",
    adapterId: "hospital-his",
    requestDigest: sha256("http-request"),
    requestEvidenceRef: "artifact://institution-sandbox/http/request"
  }, { endpoint: "http://sandbox.invalid/joint-test" }), (error) => error.code === "INSTITUTION_SANDBOX_HTTPS_REQUIRED");

  let result = start("sandbox-start-002", "corr-sandbox-002");
  const sessionId = result.result.sessionId;
  let transportCalls = 0;
  await assert.rejects(() => executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-stale-002",
    sessionId,
    expectedVersion: 0
  }, {
    endpoint: ENDPOINT,
    nonce: "nonce-stale-002",
    requestTimestamp: "2026-08-17T09:00:00.000Z",
    now: "2026-08-17T10:01:00.000Z",
    transport: { async send() { transportCalls += 1; } }
  }), (error) => error.code === "INSTITUTION_SANDBOX_REQUEST_EXPIRED");
  assert.equal(transportCalls, 0);

  result = await executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-retry-002",
    sessionId,
    expectedVersion: 0
  }, {
    endpoint: ENDPOINT,
    nonce: "nonce-retry-002",
    requestTimestamp: "2026-08-17T10:01:00.000Z",
    now: "2026-08-17T10:01:00.000Z",
    transport: { async send() { throw new Error("synthetic connection failure"); } }
  });
  assert.equal(result.result.status, "retry-wait");
  assert.equal(result.result.nextRetryAt, "2026-08-17T10:01:30.000Z");
  assert.equal(result.data.institutionSandboxSessions[0].attempts[0].errorCode, "SANDBOX_TRANSPORT_ERROR");
  assert.equal(JSON.stringify(result.data).includes("synthetic connection failure"), false);

  await assert.rejects(() => executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-replay-002",
    sessionId,
    expectedVersion: 1
  }, {
    endpoint: ENDPOINT,
    nonce: "nonce-retry-002",
    requestTimestamp: "2026-08-17T10:02:00.000Z",
    now: "2026-08-17T10:02:00.000Z",
    transport: { async send() { transportCalls += 1; } }
  }), (error) => error.code === "INSTITUTION_SANDBOX_REPLAY_BLOCKED");
  assert.equal(transportCalls, 0);

  result = await executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-retry-due-002",
    sessionId,
    expectedVersion: 1
  }, {
    endpoint: ENDPOINT,
    nonce: "nonce-retry-due-002",
    requestTimestamp: "2026-08-17T10:02:00.000Z",
    now: "2026-08-17T10:02:02.000Z",
    transport: { async send(request) {
      transportCalls += 1;
      return { outcome: "accepted", receipt: acceptedReceipt(request, "2026-08-17T10:02:01.000Z") };
    } }
  });
  assert.equal(transportCalls, 1);
  assert.equal(result.result.status, "receipt-verified");
  assert.equal(result.result.attemptCount, 2);
});

test("sandbox rejects malformed receipts and any raw transport material", async () => {
  const result = start("sandbox-start-003", "corr-sandbox-003");
  const baseOptions = {
    endpoint: ENDPOINT,
    requestTimestamp: "2026-08-17T10:01:00.000Z",
    now: "2026-08-17T10:01:02.000Z"
  };
  await assert.rejects(() => executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-raw-003",
    sessionId: result.result.sessionId,
    expectedVersion: 0
  }, {
    ...baseOptions,
    nonce: "nonce-raw-003",
    transport: { async send(request) {
      return { outcome: "accepted", payload: { patient: "forbidden" }, receipt: acceptedReceipt(request) };
    } }
  }), (error) => error.code === "INSTITUTION_SANDBOX_RAW_MATERIAL_REJECTED");

  await assert.rejects(() => executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-integrity-003",
    sessionId: result.result.sessionId,
    expectedVersion: 0
  }, {
    ...baseOptions,
    nonce: "nonce-integrity-003",
    transport: { async send(request) {
      return {
        outcome: "accepted",
        receipt: { ...acceptedReceipt(request), receiptDigest: sha256("forged-receipt") }
      };
    } }
  }), (error) => error.code === "INSTITUTION_SANDBOX_RECEIPT_INTEGRITY");

  await assert.rejects(() => executeInstitutionSandboxAttempt(result.data, {
    commandId: "sandbox-signature-003",
    sessionId: result.result.sessionId,
    expectedVersion: 0
  }, {
    ...baseOptions,
    nonce: "nonce-signature-003",
    transport: { async send(request) {
      const receipt = { ...acceptedReceipt(request), signatureVerified: false };
      return { outcome: "accepted", receipt: { ...receipt, receiptDigest: createSignedReceiptDigest(receipt) } };
    } }
  }), (error) => error.code === "INSTITUTION_SANDBOX_SIGNATURE_UNVERIFIED");
});

test("readiness CLI is fail-closed without sandbox state", () => {
  let output = "";
  const report = readinessMain([], {
    now: "2026-08-17T11:00:00.000Z",
    write(value) { output += value; }
  });
  assert.equal(report.ok, false);
  assert.equal(report.productionReady, false);
  assert.equal(JSON.parse(output).productionGate, "NO-GO");
});
