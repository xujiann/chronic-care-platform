const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyDirectReportCallback,
  buildDirectReportPayload,
  firstIncrementStatus,
  ingestLisReport,
  retryDirectReport,
  validateLisReport
} = require("../medical-public-health-integration");
const { sha256, signDirectReportCallback, verifyDirectReportCallback } = require("../public-health-connectors");
const { issueCrossInstitutionAuthorization } = require("../interface-security-context");

const REFERENCE_SECRET = "public-health-reference-secret-with-32-characters";
const REFERENCE_ENV = { PUBLIC_HEALTH_REFERENCE_SECRET: REFERENCE_SECRET };

function state() {
  return { diagnosticReports: [], integrationGatewayEvents: [], publicHealthDirectReportCallbacks: [] };
}

function lisPayload(overrides = {}) {
  return {
    externalId: "LAB-20260722-0001",
    residentId: "TEST-PERSON-001",
    personIndex: "TEST-MPI-001",
    institutionCode: "MR1",
    institutionName: "Pilot Hospital",
    item: "Reportable pathogen nucleic acid",
    itemCode: "TEST-LAB-001",
    result: "detected",
    resultFlag: "positive",
    unit: "qualitative",
    specimenNo: "SPECIMEN-001",
    reportedAt: "2026-07-22T01:30:00.000Z",
    occurredAt: "2026-07-22T01:20:00.000Z",
    eventType: "infectious-disease-laboratory-positive",
    diseaseCode: "TEST-DISEASE-001",
    publicHealthReportRequired: true,
    ...overrides
  };
}

test("LIS landing stores a normalized report and treats the same institution report as idempotent", async () => {
  const data = state();
  const input = lisPayload({ publicHealthReportRequired: false, resultFlag: "normal", diseaseCode: "", eventType: "" });
  const first = await ingestLisReport(data, input, { signatureVerified: true, user: { username: "hospital-interface", name: "Hospital interface" } });
  const replay = await ingestLisReport(data, input, { signatureVerified: true, user: { username: "hospital-interface" } });
  assert.equal(first.idempotentReplay, false);
  assert.equal(first.diagnosticReport.status, "received");
  assert.equal(first.inboundEvent.signatureVerified, true);
  assert.equal(first.inboundEvent.payloadStored, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(data.diagnosticReports.length, 1);
  assert.equal(data.integrationGatewayEvents.length, 1);
  await assert.rejects(() => ingestLisReport(data, { ...input, result: "changed-after-replay" }, {
    signatureVerified: true,
    user: { username: "hospital-interface" }
  }), (error) => error.code === "LIS_IDEMPOTENCY_PAYLOAD_CONFLICT");
});

test("positive LIS result lands before dispatch and emits a minimized direct-report request", async () => {
  const data = state();
  let captured;
  const result = await ingestLisReport(data, lisPayload(), {
    signatureVerified: true,
    referenceEnv: REFERENCE_ENV,
    dispatcher: async (request) => {
      captured = request;
      return { receiptId: "CDC-DR-001", status: "accepted", acceptedAt: "2026-07-22T01:31:00.000Z", attempts: 1 };
    }
  });
  assert.equal(result.diagnosticReport.status, "public-health-report-accepted");
  assert.equal(result.directReportEvent.reconciliationStatus, "provider-accepted");
  assert.equal(captured.contractId, "public-health-direct-report-v1");
  assert.match(captured.payload.subjectReference, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.match(captured.payload.specimenReference, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.notEqual(captured.payload.subjectReference.split(":").at(-1), sha256("TEST-MPI-001"));
  assert.notEqual(captured.payload.specimenReference.split(":").at(-1), sha256("MR1|SPECIMEN-001"));
  assert.equal(Object.prototype.hasOwnProperty.call(captured.payload, "residentId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(captured.payload, "personIndex"), false);
  assert.equal(data.diagnosticReports.length, 1);
  assert.equal(data.integrationGatewayEvents.length, 2);
});

test("reportable LIS validation requires an explicit positive trigger and reporting codes", () => {
  assert.throws(() => validateLisReport(lisPayload({ resultFlag: "normal" })), (error) => error.code === "LIS_DIRECT_REPORT_TRIGGER_INVALID");
  assert.throws(() => validateLisReport(lisPayload({ diseaseCode: "" })), (error) => error.code === "LIS_DIRECT_REPORT_FIELDS_MISSING" && error.missingFields.includes("diseaseCode"));
});

test("direct-report payload uses stable versioned keyed references for subject and specimen", () => {
  const report = validateLisReport(lisPayload());
  const first = buildDirectReportPayload(report, { secret: REFERENCE_SECRET, env: {} });
  const replay = buildDirectReportPayload(report, { secret: REFERENCE_SECRET, env: {} });
  const rotated = buildDirectReportPayload(report, {
    secret: "rotated-public-health-reference-secret-32-bytes",
    env: {}
  });
  assert.equal(first.subjectReference, replay.subjectReference);
  assert.equal(first.specimenReference, replay.specimenReference);
  assert.notEqual(first.subjectReference, rotated.subjectReference);
  assert.notEqual(first.specimenReference, rotated.specimenReference);
  assert.notEqual(first.subjectReference.split(":").at(-1), sha256(report.personIndex));
  assert.notEqual(first.specimenReference.split(":").at(-1), sha256(`${report.institutionCode}|${report.specimenNo}`));
});

test("LIS validation enforces time order, future window and authenticated institution scope", async () => {
  assert.throws(() => validateLisReport(lisPayload({
    occurredAt: "2026-07-22T01:31:00.000Z",
    reportedAt: "2026-07-22T01:30:00.000Z"
  })), (error) => error.code === "LIS_TIME_ORDER_INVALID");
  assert.throws(() => validateLisReport(lisPayload({
    occurredAt: "2026-07-22T02:00:00.000Z",
    reportedAt: "2026-07-22T02:01:00.000Z"
  }), { nowMs: Date.parse("2026-07-22T01:30:00.000Z") }), (error) => error.code === "LIS_REPORTED_AT_IN_FUTURE");
  const data = state();
  let dispatched = false;
  await assert.rejects(() => ingestLisReport(data, lisPayload(), {
    signatureVerified: true,
    referenceEnv: REFERENCE_ENV,
    user: { role: "institution", username: "missing-org" },
    systemAuthorization: issueCrossInstitutionAuthorization("commission-router"),
    dispatcher: async () => {
      dispatched = true;
      return { receiptId: "must-not-dispatch", status: "accepted" };
    }
  }), (error) => error.code === "LIS_AUTHENTICATED_INSTITUTION_REQUIRED" && error.statusCode === 403);
  await assert.rejects(() => ingestLisReport(data, lisPayload(), {
    signatureVerified: true,
    referenceEnv: REFERENCE_ENV,
    allowCrossInstitution: true,
    systemAuthorization: {
      type: "cross-institution-interface",
      allowCrossInstitution: true,
      authorizedBy: "forged-in-request"
    },
    user: { role: "institution", orgCode: "MR2", username: "other-hospital" }
  }), (error) => error.code === "LIS_INSTITUTION_SCOPE_MISMATCH" && error.statusCode === 403);
  assert.equal(dispatched, false);
  assert.equal(data.diagnosticReports.length, 0);
  assert.equal(data.integrationGatewayEvents.length, 0);
});

test("process-issued capability permits an accountable LIS relay without external dispatch", async () => {
  const data = state();
  const result = await ingestLisReport(data, lisPayload({
    publicHealthReportRequired: false,
    resultFlag: "normal",
    diseaseCode: "",
    eventType: ""
  }), {
    signatureVerified: true,
    user: { role: "institution", orgCode: "MR2", username: "relay-hospital" },
    systemAuthorization: issueCrossInstitutionAuthorization("commission-router", {
      reason: "approved LIS relay",
      issuedAt: "2026-07-22T01:59:00.000Z"
    })
  });
  assert.equal(result.diagnosticReport.sourceInstitutionCode, "MR1");
  assert.equal(data.diagnosticReports.length, 1);
  assert.equal(data.integrationGatewayEvents.length, 1);
});

test("reportable LIS landing fails closed before persistence when reference secret is unavailable", async () => {
  const data = state();
  let dispatched = false;
  await assert.rejects(() => ingestLisReport(data, lisPayload(), {
    signatureVerified: true,
    referenceEnv: { NODE_ENV: "production" },
    dispatcher: async () => {
      dispatched = true;
      return { receiptId: "must-not-dispatch", status: "accepted" };
    }
  }), (error) => error.code === "DIRECT_REPORT_REFERENCE_SECRET_NOT_CONFIGURED");
  assert.equal(dispatched, false);
  assert.equal(data.diagnosticReports.length, 0);
  assert.equal(data.integrationGatewayEvents.length, 0);
});

test("failed direct report enters dead letter and can be replayed without duplicating the LIS record", async () => {
  const data = state();
  const failed = await ingestLisReport(data, lisPayload(), {
    signatureVerified: true,
    referenceEnv: REFERENCE_ENV,
    dispatcher: async () => { throw new Error("CDC endpoint unavailable"); }
  });
  assert.equal(failed.diagnosticReport.status, "public-health-report-dead-letter");
  assert.equal(failed.directReportEvent.deadLetter, true);
  const replayed = await retryDirectReport(data, failed.directReportEvent.id, {
    user: { username: "commission-operator" },
    dispatcher: async () => ({ receiptId: "CDC-DR-REPLAY-001", status: "accepted", acceptedAt: "2026-07-22T01:35:00.000Z", attempts: 1 })
  });
  assert.equal(replayed.event.deadLetter, false);
  assert.equal(replayed.event.retryCount, 1);
  assert.equal(replayed.diagnosticReport.status, "public-health-report-accepted");
  assert.equal(data.diagnosticReports.length, 1);
});

test("verified direct-report callback closes the provider receipt and is idempotent", async () => {
  const data = state();
  const ingested = await ingestLisReport(data, lisPayload(), {
    signatureVerified: true,
    referenceEnv: REFERENCE_ENV,
    dispatcher: async () => ({ receiptId: "CDC-DR-CALLBACK-001", status: "accepted", acceptedAt: "2026-07-22T01:31:00.000Z", attempts: 1 })
  });
  const secret = "direct-report-callback-secret-with-32-characters";
  const nowMs = Date.parse("2026-07-22T01:35:00.000Z");
  const timestamp = String(Math.floor(nowMs / 1000));
  const nonce = "direct-report-callback-nonce-002";
  const payload = {
    eventId: "cdc-callback-event-002",
    receiptId: "CDC-DR-CALLBACK-001",
    status: "succeeded",
    occurredAt: "2026-07-22T01:34:59.000Z",
    providerCode: "SUCCESS"
  };
  const signature = signDirectReportCallback(payload, { secret, timestamp, nonce });
  const verified = verifyDirectReportCallback(payload, {
    env: { NODE_ENV: "production", PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature,
    nowMs
  });
  const applied = applyDirectReportCallback(data, verified);
  const replay = applyDirectReportCallback(data, verified);
  assert.equal(applied.gatewayEvent.reconciliationStatus, "provider-final");
  assert.equal(applied.diagnosticReport.status, "public-health-report-confirmed");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(data.publicHealthDirectReportCallbacks.length, 1);
  assert.equal(firstIncrementStatus(data).summary.providerFinal, 1);
  assert.equal(ingested.directReportEvent.id, applied.gatewayEvent.id);
});

test("LIS landing rejects unverified signatures and mismatched institution idempotency keys", async () => {
  const data = state();
  await assert.rejects(() => ingestLisReport(data, lisPayload()), (error) => error.code === "LIS_SIGNATURE_VERIFICATION_REQUIRED");
  await assert.rejects(() => ingestLisReport(data, {
    contractId: "lis-report-v1",
    idempotencyKey: "wrong-key",
    payload: lisPayload()
  }, { signatureVerified: true }), (error) => error.code === "LIS_IDEMPOTENCY_KEY_CONFLICT");
  assert.equal(data.diagnosticReports.length, 0);
});

test("a provider-final direct report cannot be regressed by a later failure callback", async () => {
  const data = state();
  await ingestLisReport(data, lisPayload(), {
    signatureVerified: true,
    referenceEnv: REFERENCE_ENV,
    dispatcher: async () => ({ receiptId: "CDC-DR-TERMINAL-001", status: "accepted", acceptedAt: "2026-07-22T01:31:00.000Z", attempts: 1 })
  });
  const succeeded = {
    eventId: "cdc-terminal-success",
    receiptId: "CDC-DR-TERMINAL-001",
    status: "succeeded",
    occurredAt: "2026-07-22T01:32:00.000Z",
    receivedAt: "2026-07-22T01:32:01.000Z",
    nonceDigest: "a".repeat(64),
    signatureVerified: true
  };
  applyDirectReportCallback(data, succeeded);
  const lateFailure = applyDirectReportCallback(data, {
    ...succeeded,
    eventId: "cdc-terminal-late-failure",
    status: "failed",
    failureReason: "late provider message",
    occurredAt: "2026-07-22T01:33:00.000Z",
    receivedAt: "2026-07-22T01:33:01.000Z",
    nonceDigest: "b".repeat(64)
  });
  assert.equal(lateFailure.callbackEvent.stateApplied, false);
  assert.equal(lateFailure.callbackEvent.ignoredReason, "terminal-state-protected");
  assert.equal(lateFailure.gatewayEvent.providerStatus, "succeeded");
  assert.equal(lateFailure.gatewayEvent.reconciliationStatus, "provider-final");
  assert.equal(Object.prototype.hasOwnProperty.call(lateFailure.callbackEvent, "nonceDigest"), false);
});
