"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const GrouperContract = require("../disease-payment-grouper-contract");
const Intake = require("../disease-payment-intake");
const Service = require("../disease-payment-service");

const callbackSecret = "test-grouper-callback-secret-with-at-least-32-characters";
const callbackSourceId = "test-official-grouper";
const callbackNowMs = Date.parse("2026-07-24T08:00:00.000Z");
const callbackTimestamp = String(Math.floor(callbackNowMs / 1000));
const callbackNonce = "test-grouper-callback-nonce-001";
const receiptKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const receiptPrivateKey = receiptKeys.privateKey.export({ type: "pkcs8", format: "pem" });
const receiptPublicKey = receiptKeys.publicKey.export({ type: "spki", format: "pem" });
const receiptFingerprint = GrouperContract.publicKeyFingerprint(receiptPublicKey);

function transportOptions(payload, overrides = {}) {
  const nonce = overrides.nonce || callbackNonce;
  const sourceId = overrides.sourceId || callbackSourceId;
  const timestamp = overrides.timestamp || callbackTimestamp;
  return {
    env: { NODE_ENV: "production" },
    secret: callbackSecret,
    timestamp,
    nonce,
    sourceId,
    allowedSourceIds: [callbackSourceId],
    signature: GrouperContract.signTrustedGrouperCallback(payload, { secret: callbackSecret, timestamp, nonce, sourceId }),
    nowMs: callbackNowMs,
    ...overrides
  };
}

function completedCallbackFixture() {
  const state = Service.seedDiseasePaymentState();
  state.grouperAdapters.find((item) => item.id === "official-adapter-v1").trustedSignerFingerprints = [receiptFingerprint];
  const created = Intake.createFormalGroupingJob(state, { id: "trusted-callback-job", idempotencyKey: "trusted-callback-job-idem", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: ["dp-case-001"] }, "operator");
  const dispatched = Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: true, transportId: "trusted-transport" }, "adapter");
  const item = dispatched.state.cases.find((row) => row.id === "dp-case-001");
  const receipt = GrouperContract.createSignedReceipt({
    caseId: item.id,
    receiptId: "TRUSTED-CALLBACK-RECEIPT",
    groupCode: "BR23",
    schemeVersion: dispatched.job.schemeVersion,
    inputDigest: Intake.officialCaseDigest(item, "DRG"),
    signedAt: "2026-07-24T07:59:58.000Z"
  }, receiptPrivateKey, { keyId: "test-receipt-key", signerOrganization: "测试正式分组器", validUntil: "2036-12-31T23:59:59.000Z" });
  const payload = { eventId: "trusted-grouper-event-001", correlationId: dispatched.job.correlationId, officialResults: [receipt] };
  return { dispatched, payload };
}

test("trusted grouper callback requires source allowlist time window and HMAC", () => {
  const payload = { eventId: "transport-event-001", correlationId: "fg-transport-test", officialResults: [] };
  const options = transportOptions(payload);
  const verified = GrouperContract.verifyTrustedGrouperCallback(payload, options);
  assert.equal(verified.signatureVerified, true);
  assert.equal(verified.sourceId, callbackSourceId);
  assert.match(verified.payloadDigest, /^[a-f0-9]{64}$/);
  assert.match(verified.nonceDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(verified).includes(callbackSecret), false);
  assert.equal(JSON.stringify(verified).includes(callbackNonce), false);

  assert.throws(
    () => GrouperContract.verifyTrustedGrouperCallback({ ...payload, correlationId: "forged" }, options),
    (error) => error.code === "GROUPER_CALLBACK_SIGNATURE_MISMATCH"
  );
  assert.throws(
    () => GrouperContract.verifyTrustedGrouperCallback(payload, { ...options, allowedSourceIds: ["another-grouper"] }),
    (error) => error.code === "GROUPER_CALLBACK_SOURCE_DENIED"
  );
  assert.throws(
    () => GrouperContract.verifyTrustedGrouperCallback(payload, { ...options, nowMs: callbackNowMs + 901_000 }),
    (error) => error.code === "GROUPER_CALLBACK_TIMESTAMP_EXPIRED"
  );
});

test("formal grouper production configuration is strict redacted and evidence-gated", () => {
  const missing = GrouperContract.buildGrouperProductionConfiguration({});
  assert.equal(missing.configured, false);
  assert.equal(missing.productionReady, false);
  const productionEnv = {
    DISEASE_PAYMENT_GROUPER_ENDPOINT: "https://grouper.example.test/v1/jobs",
    DISEASE_PAYMENT_GROUPER_CALLBACK_SECRET: callbackSecret,
    DISEASE_PAYMENT_GROUPER_CALLBACK_ALLOWED_SOURCES: `${callbackSourceId},backup-official-grouper`,
    DISEASE_PAYMENT_GROUPER_TRUSTED_SIGNER_FINGERPRINTS: `${"a".repeat(64)},${"b".repeat(64)}`,
    DISEASE_PAYMENT_GROUPER_CREDENTIAL_REFERENCE: "vault://insurance/grouper/client-credential",
    DISEASE_PAYMENT_GROUPER_CALLBACK_MAX_SKEW_SECONDS: "300"
  };
  const configured = GrouperContract.buildGrouperProductionConfiguration(productionEnv);
  assert.equal(configured.configured, true);
  assert.equal(configured.productionReady, false);
  assert.equal(configured.summary.allowedSourceCount, 2);
  assert.equal(configured.summary.trustedSignerCount, 2);
  assert.equal(JSON.stringify(configured).includes(callbackSecret), false);
  assert.equal(JSON.stringify(configured).includes("grouper.example.test"), false);
  assert.equal(JSON.stringify(configured).includes("vault://insurance"), false);
  const evidenced = GrouperContract.buildGrouperProductionConfiguration(productionEnv, { externalEvidenceVerified: true });
  assert.equal(evidenced.productionReady, true);
  const credentialLeak = GrouperContract.buildGrouperProductionConfiguration({ ...productionEnv, DISEASE_PAYMENT_GROUPER_ENDPOINT: "https://user:password@grouper.example.test/v1" });
  assert.equal(credentialLeak.checks.find((item) => item.id === "https-endpoint").passed, false);
});

test("trusted grouper callback is recorded once and bound to the completed result", () => {
  const { dispatched, payload } = completedCallbackFixture();
  const options = transportOptions(payload);
  const received = Intake.receiveTrustedFormalGroupingReceipt(dispatched.state, dispatched.job.id, payload, options, Service.calculateCase);
  assert.equal(received.job.status, "completed");
  assert.equal(received.callbackEvent.eventId, payload.eventId);
  assert.equal(received.callbackEvent.signatureVerified, true);
  assert.equal(received.state.formalGroupingCallbackEvents.length, 1);
  assert.equal(Intake.verifyLedger(received.state.formalGroupingCallbackEvents), true);
  assert.equal(Intake.verifyFormalGroupingResultProjection(received.state, received.job), true);
  const operations = Intake.buildFormalGroupingOperations(received.state);
  assert.equal(operations.jobs[0].trustedTransport, true);
  assert.equal(operations.jobs[0].integrity, true);

  const replay = Intake.receiveTrustedFormalGroupingReceipt(received.state, received.job.id, payload, options, Service.calculateCase);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.transportReplay, true);
  assert.equal(replay.state.formalGroupingCallbackEvents.length, 1);
});

test("trusted grouper callback blocks nonce replay and callback-ledger drift", () => {
  const { dispatched, payload } = completedCallbackFixture();
  const first = Intake.receiveTrustedFormalGroupingReceipt(dispatched.state, dispatched.job.id, payload, transportOptions(payload), Service.calculateCase);
  const replayPayload = { ...payload, eventId: "trusted-grouper-event-002" };
  assert.throws(
    () => Intake.receiveTrustedFormalGroupingReceipt(first.state, first.job.id, replayPayload, transportOptions(replayPayload), Service.calculateCase),
    (error) => error.code === "GROUPER_CALLBACK_NONCE_REPLAY"
  );
  const drifted = structuredClone(first.state);
  drifted.formalGroupingCallbackEvents[0].sourceId = "forged-source";
  const driftedJob = drifted.formalGroupingJobs.find((item) => item.id === first.job.id);
  assert.equal(Intake.verifyFormalGroupingResultProjection(drifted, driftedJob), false);
  assert.equal(Intake.buildFormalGroupingOperations(drifted).summary.invalidJobs, 1);
});

test("rejected trusted callback remains ledger-bound after a new retry correlation", () => {
  const { dispatched, payload } = completedCallbackFixture();
  const rejectedPayload = {
    ...payload,
    eventId: "trusted-grouper-event-rejected",
    officialResults: [{ ...payload.officialResults[0], groupCode: "FORGED-AFTER-SIGNING" }]
  };
  const rejected = Intake.receiveTrustedFormalGroupingReceipt(dispatched.state, dispatched.job.id, rejectedPayload, transportOptions(rejectedPayload, { nonce: "test-grouper-callback-nonce-rejected" }), Service.calculateCase);
  assert.equal(rejected.job.status, "receipt-rejected");
  assert.equal(rejected.callbackEvent.outcomeStatus, "receipt-rejected");
  assert.equal(Intake.verifyFormalGroupingResultProjection(rejected.state, rejected.job), true);
  const originalCorrelationId = rejected.job.correlationId;
  const retried = Intake.retryFormalGroupingJob(rejected.state, rejected.job.id, "operator");
  assert.notEqual(retried.job.correlationId, originalCorrelationId);
  assert.equal(Intake.verifyFormalGroupingResultProjection(retried.state, retried.job), true);
  const missingCallbackLedger = structuredClone(retried.state);
  missingCallbackLedger.formalGroupingCallbackEvents = [];
  const missingLedgerJob = missingCallbackLedger.formalGroupingJobs.find((item) => item.id === retried.job.id);
  assert.equal(Intake.verifyFormalGroupingResultProjection(missingCallbackLedger, missingLedgerJob), false);
});
