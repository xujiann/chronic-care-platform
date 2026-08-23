"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  FinancialCallbackError,
  applyFinancialCallback,
  financialDispatchRequestDigest,
  financialIdempotencyScopeKey,
  signFinancialCallback,
  validateFinancialRequest,
  verifyFinancialCallback,
  withFinancialDispatchLock,
  withFinancialDispatchStateLock
} = require("../financial-gateways");
const { createRouteSegments: createInsurancePaymentRouteSegments } = require("../src/http/routes/insurance-payment");

const ROOT = path.resolve(__dirname, "..");
const CALLBACK_SECRET = "financial-storage-callback-secret-2026-08";

function verifiedCallback(payload, nonce) {
  const nowMs = Date.parse(payload.occurredAt);
  const timestamp = String(Math.floor(nowMs / 1000));
  return verifyFinancialCallback(payload, {
    type: payload.gatewayType,
    env: { NODE_ENV: "production", PAYMENT_CALLBACK_SECRET: CALLBACK_SECRET },
    timestamp,
    nonce,
    signature: signFinancialCallback(payload, { secret: CALLBACK_SECRET, timestamp, nonce }),
    nowMs
  });
}
let sqliteAvailable = true;
try {
  require("node:sqlite");
} catch {
  sqliteAvailable = false;
}

test("legacy financial capacity scope prioritizes institution over the historical principal fallback", () => {
  assert.equal(financialIdempotencyScopeKey({
    adapterType: "financial",
    gatewayType: "PAYMENT",
    receivedBy: "historical-user",
    requestPayload: { payload: { institutionCode: "ORG-HISTORICAL" } }
  }), "institution:ORG-HISTORICAL");
  assert.equal(financialIdempotencyScopeKey({
    adapterType: "financial",
    gatewayType: "PAYMENT",
    receivedBy: "historical-user",
    requestPayload: { payload: {} }
  }), "principal:historical-user");
});

test("financial idempotency events survive display truncation and real SQLite rejects stale writes", { skip: !sqliteAvailable }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-ledger-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "sqlite";
  const storage = require(path.join(ROOT, "server.js"));
  t.after(() => {
    storage.stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  storage.ensureDatabase();
  const idempotencyKey = "financial-storage-contract-oldest-001";
  const financialEvent = {
    id: "financial-storage-contract-event-001",
    direction: "outbound",
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "create-payment",
    contractId: "payment-create-v1",
    idempotencyKey,
    status: "accepted",
    adapterReceipt: {
      type: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-create-v1",
      idempotencyKey,
      receiptId: "financial-storage-receipt-001",
      status: "accepted",
      acceptedAt: "2026-08-23T09:00:00.000Z"
    },
    providerStatus: "accepted",
    dispatchedAt: "2026-08-23T09:00:00.000Z",
    businessDate: "2026-08-23",
    requestPayload: {
      type: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-create-v1",
      idempotencyKey,
      payload: { orderNo: "STORAGE-ORDER-001", amountFen: 100, currency: "CNY" }
    }
  };
  const requestDigest = financialDispatchRequestDigest(financialEvent.requestPayload);
  const reservationEvent = { ...financialEvent, status: "dispatching" };

  const seeded = storage.readDatabase();
  seeded.integrationGatewayEvents = [
    ...Array.from({ length: 205 }, (_, index) => ({
      id: `display-event-${index}`,
      adapterType: "hospital",
      idempotencyKey: `display-key-${index}`,
      status: "accepted"
    })),
    reservationEvent
  ];
  storage.writeDatabase(seeded, {
    financialGatewayWrite: {
      kind: "reserve",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest
    }
  });
  const finalized = storage.readDatabase();
  const reservationIndex = finalized.integrationGatewayEvents.findIndex((item) => item.id === financialEvent.id);
  finalized.integrationGatewayEvents[reservationIndex] = financialEvent;
  storage.writeDatabase(finalized, {
    financialGatewayWrite: {
      kind: "finalize",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest
    }
  });

  const genericWriter = storage.readDatabase();
  genericWriter.integrationGatewayEvents = [
    { id: "latest-display-event", adapterType: "hospital", idempotencyKey: "latest-display-key", status: "accepted" },
    ...genericWriter.integrationGatewayEvents
  ].slice(0, 200);
  storage.writeDatabase(genericWriter);

  const retained = storage.readDatabase();
  assert.equal(retained.integrationGatewayEvents.length, 201);
  assert.equal(
    retained.integrationGatewayEvents.find((item) => item.idempotencyKey === idempotencyKey)?.id,
    financialEvent.id
  );

  const staleFinancialVersions = storage.readDatabase().storageMeta;
  const callbackWinner = storage.readDatabase();
  const winnerVerified = verifiedCallback({
    eventId: "trusted-callback-winner",
    gatewayType: "PAYMENT",
    receiptId: "financial-storage-receipt-001",
    status: "succeeded",
    occurredAt: "2026-08-23T10:00:00.000Z",
    businessDate: "2026-08-23",
    amountFen: 100,
    providerCode: "OK",
    failureReason: "",
    settlementReference: ""
  }, "trusted-callback-nonce-winner");
  const winnerResult = applyFinancialCallback(callbackWinner, winnerVerified);
  storage.writeDatabase(callbackWinner, {
    financialGatewayWrite: {
      kind: "callback",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest,
      callbackEventId: winnerResult.callbackEvent.eventId,
      callbackAttestation: winnerResult.verificationAttestation
    }
  });
  const staleFinancial = storage.readDatabase();
  staleFinancial.storageMeta = staleFinancialVersions;
  const staleVerified = verifiedCallback({
    eventId: "trusted-callback-stale",
    gatewayType: "PAYMENT",
    receiptId: "financial-storage-receipt-001",
    status: "succeeded",
    occurredAt: "2026-08-23T10:01:00.000Z",
    businessDate: "2026-08-23",
    amountFen: 100,
    providerCode: "OK-REPLAY",
    failureReason: "",
    settlementReference: ""
  }, "trusted-callback-nonce-stale");
  const staleResult = applyFinancialCallback(staleFinancial, staleVerified);
  assert.throws(() => storage.writeDatabase(staleFinancial, {
    financialGatewayWrite: {
      kind: "callback",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest,
      callbackEventId: staleResult.callbackEvent.eventId,
      callbackAttestation: staleResult.verificationAttestation
    }
  }), /SQLite optimistic lock conflict on integrationGatewayEvents/);
  const financialAfterConflict = storage.readDatabase().integrationGatewayEvents.find((item) => item.id === financialEvent.id);
  assert.equal(financialAfterConflict.status, "accepted");
  assert.equal(financialAfterConflict.providerStatus, "succeeded");
  assert.equal(financialAfterConflict.callbackEvents[0].eventId, "trusted-callback-winner");

  const forgedCallback = storage.readDatabase();
  const forgedResult = applyFinancialCallback(forgedCallback, {
    eventId: "forged-callback-evidence",
    gatewayType: "PAYMENT",
    receiptId: "financial-storage-receipt-001",
    status: "succeeded",
    occurredAt: "2026-08-23T10:02:00.000Z",
    receivedAt: "2026-08-23T10:02:00.000Z",
    businessDate: "2026-08-23",
    amountFen: 100,
    providerCode: "FORGED",
    failureReason: "",
    settlementReferenceDigest: "",
    nonceDigest: "forged-nonce-digest",
    signatureVerified: true
  });
  assert.throws(() => storage.writeDatabase(forgedCallback, {
    financialGatewayWrite: {
      kind: "callback",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest,
      callbackEventId: forgedResult.callbackEvent.eventId,
      callbackAttestation: "a".repeat(64)
    }
  }), /callback verification attestation is invalid/);

  const derivedDecisionTamper = storage.readDatabase();
  const mismatchVerified = verifiedCallback({
    eventId: "trusted-callback-amount-mismatch",
    gatewayType: "PAYMENT",
    receiptId: "financial-storage-receipt-001",
    status: "succeeded",
    occurredAt: "2026-08-23T10:02:30.000Z",
    businessDate: "2026-08-23",
    amountFen: 999,
    providerCode: "AMOUNT-MISMATCH",
    failureReason: ""
  }, "trusted-callback-nonce-mismatch");
  const mismatchResult = applyFinancialCallback(derivedDecisionTamper, mismatchVerified);
  assert.equal(mismatchResult.callbackEvent.stateApplied, false);
  assert.equal(mismatchResult.callbackEvent.ignoredReason, "amount-mismatch");
  mismatchResult.callbackEvent.stateApplied = true;
  mismatchResult.callbackEvent.ignoredReason = "";
  mismatchResult.gatewayEvent.latestCallbackAt = mismatchResult.callbackEvent.occurredAt;
  mismatchResult.gatewayEvent.businessDate = mismatchResult.callbackEvent.businessDate;
  mismatchResult.gatewayEvent.providerCode = mismatchResult.callbackEvent.providerCode;
  mismatchResult.gatewayEvent.providerStatus = mismatchResult.callbackEvent.status;
  mismatchResult.gatewayEvent.reconciliationStatus = "provider-final";
  assert.throws(() => storage.writeDatabase(derivedDecisionTamper, {
    financialGatewayWrite: {
      kind: "callback",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest,
      callbackEventId: mismatchResult.callbackEvent.eventId,
      callbackAttestation: mismatchResult.verificationAttestation
    }
  }), /callback verification attestation is invalid/);

  const staleAttestationCandidate = storage.readDatabase();
  const newVerified = verifiedCallback({
    eventId: "trusted-callback-new-evidence",
    gatewayType: "PAYMENT",
    receiptId: "financial-storage-receipt-001",
    status: "succeeded",
    occurredAt: "2026-08-23T10:02:45.000Z",
    businessDate: "2026-08-23",
    amountFen: 100,
    providerCode: "NEW-EVIDENCE",
    failureReason: ""
  }, "trusted-callback-nonce-new-evidence");
  applyFinancialCallback(staleAttestationCandidate, newVerified);
  assert.throws(() => storage.writeDatabase(staleAttestationCandidate, {
    financialGatewayWrite: {
      kind: "callback",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest,
      callbackEventId: winnerResult.callbackEvent.eventId,
      callbackAttestation: winnerResult.verificationAttestation
    }
  }), /callback verification attestation is invalid/);

  const evidenceFreeRequest = {
    type: "PAYMENT",
    operation: "create-payment",
    contractId: "payment-create-v1",
    idempotencyKey: "financial-finalize-without-evidence-001",
    payload: { orderNo: "STORAGE-ORDER-EVIDENCE-FREE", amountFen: 100, currency: "CNY" }
  };
  const evidenceFreeDigest = financialDispatchRequestDigest(evidenceFreeRequest);
  const evidenceFreeReservation = {
    id: "financial-finalize-without-evidence-event-001",
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "create-payment",
    contractId: "payment-create-v1",
    idempotencyKey: evidenceFreeRequest.idempotencyKey,
    status: "dispatching",
    requestPayload: evidenceFreeRequest
  };
  const evidenceFreeState = storage.readDatabase();
  evidenceFreeState.integrationGatewayEvents.unshift(evidenceFreeReservation);
  storage.writeDatabase(evidenceFreeState, { financialGatewayWrite: {
    kind: "reserve",
    eventId: evidenceFreeReservation.id,
    idempotencyKey: evidenceFreeReservation.idempotencyKey,
    requestDigest: evidenceFreeDigest
  } });
  const evidenceFreeFinalize = storage.readDatabase();
  const evidenceFreeIndex = evidenceFreeFinalize.integrationGatewayEvents.findIndex((item) => item.id === evidenceFreeReservation.id);
  evidenceFreeFinalize.integrationGatewayEvents[evidenceFreeIndex] = {
    ...evidenceFreeFinalize.integrationGatewayEvents[evidenceFreeIndex],
    status: "succeeded",
    providerStatus: "succeeded",
    reconciliationStatus: "provider-final"
  };
  assert.throws(() => storage.writeDatabase(evidenceFreeFinalize, { financialGatewayWrite: {
    kind: "finalize",
    eventId: evidenceFreeReservation.id,
    idempotencyKey: evidenceFreeReservation.idempotencyKey,
    requestDigest: evidenceFreeDigest
  } }), /finalize provider receipt is incomplete/);
  evidenceFreeFinalize.integrationGatewayEvents[evidenceFreeIndex] = {
    ...evidenceFreeFinalize.integrationGatewayEvents[evidenceFreeIndex],
    adapterReceipt: {
      type: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-create-v1",
      idempotencyKey: evidenceFreeRequest.idempotencyKey,
      receiptId: "invalid-time-receipt-001",
      status: "succeeded",
      acceptedAt: "not-a-time"
    },
    dispatchedAt: "not-a-time",
    businessDate: "not-a-time"
  };
  assert.throws(() => storage.writeDatabase(evidenceFreeFinalize, { financialGatewayWrite: {
    kind: "finalize",
    eventId: evidenceFreeReservation.id,
    idempotencyKey: evidenceFreeReservation.idempotencyKey,
    requestDigest: evidenceFreeDigest
  } }), /finalize provider receipt is incomplete/);
  const incompleteFailure = storage.readDatabase();
  const incompleteFailureIndex = incompleteFailure.integrationGatewayEvents.findIndex((item) => item.id === evidenceFreeReservation.id);
  incompleteFailure.integrationGatewayEvents[incompleteFailureIndex] = {
    ...incompleteFailure.integrationGatewayEvents[incompleteFailureIndex],
    status: "failed",
    failureCode: "FORGED_FAILURE",
    failedAt: "2026-08-23T10:03:00.000Z",
    reconciliationStatus: "dead-letter"
  };
  assert.throws(() => storage.writeDatabase(incompleteFailure, { financialGatewayWrite: {
    kind: "finalize",
    eventId: evidenceFreeReservation.id,
    idempotencyKey: evidenceFreeReservation.idempotencyKey,
    requestDigest: evidenceFreeDigest
  } }), /finalize failure evidence is incomplete/);
  incompleteFailure.integrationGatewayEvents[incompleteFailureIndex] = {
    ...incompleteFailure.integrationGatewayEvents[incompleteFailureIndex],
    status: "failed",
    failureCode: "FINANCIAL_DISPATCH_PROVIDER_REJECTED",
    failedAt: "not-a-time",
    deadLetter: true,
    deadLetterReason: "stable provider failure",
    reconciliationStatus: "dead-letter"
  };
  assert.throws(() => storage.writeDatabase(incompleteFailure, { financialGatewayWrite: {
    kind: "finalize",
    eventId: evidenceFreeReservation.id,
    idempotencyKey: evidenceFreeReservation.idempotencyKey,
    requestDigest: evidenceFreeDigest
  } }), /finalize failure evidence is incomplete/);

  const duplicateReceiptRequest = {
    type: "PAYMENT",
    operation: "create-payment",
    contractId: "payment-create-v1",
    idempotencyKey: "financial-duplicate-receipt-key-001",
    payload: { orderNo: "STORAGE-ORDER-DUPLICATE-RECEIPT", amountFen: 100, currency: "CNY" }
  };
  const duplicateReceiptDigest = financialDispatchRequestDigest(duplicateReceiptRequest);
  const duplicateReceiptReservation = {
    id: "financial-duplicate-receipt-event-001",
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "create-payment",
    contractId: "payment-create-v1",
    idempotencyKey: duplicateReceiptRequest.idempotencyKey,
    status: "dispatching",
    requestPayload: duplicateReceiptRequest
  };
  const duplicateReceiptState = storage.readDatabase();
  duplicateReceiptState.integrationGatewayEvents.unshift(duplicateReceiptReservation);
  storage.writeDatabase(duplicateReceiptState, { financialGatewayWrite: {
    kind: "reserve",
    eventId: duplicateReceiptReservation.id,
    idempotencyKey: duplicateReceiptReservation.idempotencyKey,
    requestDigest: duplicateReceiptDigest
  } });
  const duplicateReceiptFinalize = storage.readDatabase();
  const duplicateReceiptIndex = duplicateReceiptFinalize.integrationGatewayEvents.findIndex((item) => item.id === duplicateReceiptReservation.id);
  duplicateReceiptFinalize.integrationGatewayEvents[duplicateReceiptIndex] = {
    ...duplicateReceiptFinalize.integrationGatewayEvents[duplicateReceiptIndex],
    status: "accepted",
    providerStatus: "accepted",
    reconciliationStatus: "provider-accepted",
    dispatchedAt: "2026-08-23T10:04:00.000Z",
    businessDate: "2026-08-23",
    adapterReceipt: {
      type: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-create-v1",
      idempotencyKey: duplicateReceiptRequest.idempotencyKey,
      receiptId: "financial-storage-receipt-001",
      status: "accepted",
      acceptedAt: "2026-08-23T10:04:00.000Z"
    }
  };
  assert.throws(() => storage.writeDatabase(duplicateReceiptFinalize, { financialGatewayWrite: {
    kind: "finalize",
    eventId: duplicateReceiptReservation.id,
    idempotencyKey: duplicateReceiptReservation.idempotencyKey,
    requestDigest: duplicateReceiptDigest
  } }), /provider receipt is already bound to another event/);

  const lifecycleRewrite = storage.readDatabase();
  const lifecycleRewriteIndex = lifecycleRewrite.integrationGatewayEvents.findIndex((item) => item.id === financialEvent.id);
  lifecycleRewrite.integrationGatewayEvents[lifecycleRewriteIndex].status = "failed";
  assert.throws(() => storage.writeDatabase(lifecycleRewrite, {
    financialGatewayWrite: { kind: "callback", eventId: financialEvent.id, idempotencyKey, requestDigest }
  }), /may not rewrite dispatch lifecycle status/);

  const evidenceDeletion = storage.readDatabase();
  const evidenceDeletionIndex = evidenceDeletion.integrationGatewayEvents.findIndex((item) => item.id === financialEvent.id);
  evidenceDeletion.integrationGatewayEvents[evidenceDeletionIndex].callbackEvents = [];
  assert.throws(() => storage.writeDatabase(evidenceDeletion, {
    financialGatewayWrite: { kind: "callback", eventId: financialEvent.id, idempotencyKey, requestDigest }
  }), /callback evidence must be append-only/);

  const invalidVersion = storage.readDatabase();
  invalidVersion.storageMeta.collectionVersions.integrationGatewayEvents = undefined;
  assert.throws(() => storage.writeDatabase(invalidVersion, {
    financialGatewayWrite: {
      kind: "callback",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest
    }
  }), /valid integrationGatewayEvents expected version/);

  const identitySpoof = storage.readDatabase();
  const identitySpoofIndex = identitySpoof.integrationGatewayEvents.findIndex((item) => item.id === financialEvent.id);
  identitySpoof.integrationGatewayEvents[identitySpoofIndex] = {
    ...identitySpoof.integrationGatewayEvents[identitySpoofIndex],
    adapterType: "hospital"
  };
  assert.throws(() => storage.writeDatabase(identitySpoof), /identity is immutable/);

  const nestedIdentitySpoof = storage.readDatabase();
  const nestedIdentityIndex = nestedIdentitySpoof.integrationGatewayEvents.findIndex((item) => item.id === financialEvent.id);
  nestedIdentitySpoof.integrationGatewayEvents[nestedIdentityIndex].requestPayload.idempotencyKey = "provider-other-key";
  assert.throws(() => storage.writeDatabase(nestedIdentitySpoof, {
    financialGatewayWrite: { kind: "callback", eventId: financialEvent.id, idempotencyKey, requestDigest }
  }), /request identity is inconsistent/);

  const projectionWithoutEvidence = storage.readDatabase();
  const projectionIndex = projectionWithoutEvidence.integrationGatewayEvents.findIndex((item) => item.id === financialEvent.id);
  projectionWithoutEvidence.integrationGatewayEvents[projectionIndex].providerCode = "FORGED-WITHOUT-CALLBACK";
  assert.throws(() => storage.writeDatabase(projectionWithoutEvidence, {
    financialGatewayWrite: { kind: "callback", eventId: financialEvent.id, idempotencyKey, requestDigest }
  }), /provider projection requires new callback evidence/);

  const rebound = storage.readDatabase();
  rebound.integrationGatewayEvents = rebound.integrationGatewayEvents.filter((item) => item.id !== financialEvent.id);
  rebound.integrationGatewayEvents.unshift({ ...financialEvent, id: "financial-storage-contract-event-rebound" });
  assert.throws(
    () => storage.writeDatabase(rebound, {
      financialGatewayWrite: {
        kind: "reserve",
        eventId: "financial-storage-contract-event-rebound",
        idempotencyKey,
        requestDigest
      }
    }),
    /idempotency key is already bound to another event/
  );

  const digestMutation = storage.readDatabase();
  const digestMutationIndex = digestMutation.integrationGatewayEvents.findIndex((item) => item.id === financialEvent.id);
  digestMutation.integrationGatewayEvents[digestMutationIndex] = {
    ...digestMutation.integrationGatewayEvents[digestMutationIndex],
    requestPayload: {
      ...digestMutation.integrationGatewayEvents[digestMutationIndex].requestPayload,
      payload: { orderNo: "STORAGE-ORDER-001", amountFen: 999, currency: "CNY" }
    }
  };
  const mutatedDigest = financialDispatchRequestDigest(digestMutation.integrationGatewayEvents[digestMutationIndex].requestPayload);
  assert.throws(() => storage.writeDatabase(digestMutation, {
    financialGatewayWrite: {
      kind: "callback",
      eventId: financialEvent.id,
      idempotencyKey,
      requestDigest: mutatedDigest
    }
  }), /request digest is immutable/);

  const stale = storage.readDatabase();
  const winner = storage.readDatabase();
  winner.integrationGatewayEvents.unshift({
    id: "sqlite-winner-event",
    adapterType: "hospital",
    idempotencyKey: "sqlite-winner-key",
    status: "accepted"
  });
  storage.writeDatabase(winner);
  stale.integrationGatewayEvents.unshift({
    id: "sqlite-stale-event",
    adapterType: "hospital",
    idempotencyKey: "sqlite-stale-key",
    status: "accepted"
  });
  assert.throws(() => storage.writeDatabase(stale), /SQLite optimistic lock conflict on integrationGatewayEvents/);
  const afterConflict = storage.readDatabase();
  assert.ok(afterConflict.integrationGatewayEvents.some((item) => item.id === "sqlite-winner-event"));
  assert.ok(!afterConflict.integrationGatewayEvents.some((item) => item.id === "sqlite-stale-event"));
  assert.ok(afterConflict.integrationGatewayEvents.some((item) => item.id === financialEvent.id));

  const routeStale = storage.readDatabase();
  const routeWinner = storage.readDatabase();
  routeWinner.integrationGatewayEvents.unshift({
    id: "sqlite-route-winner-event",
    adapterType: "hospital",
    idempotencyKey: "sqlite-route-winner-key",
    status: "accepted"
  });
  storage.writeDatabase(routeWinner);
  let providerCalls = 0;
  const routeRuntime = {
    FinancialCallbackError,
    collectJson: (req) => Promise.resolve(structuredClone(req.body)),
    dispatchFinancialRequest: async () => { providerCalls += 1; return {}; },
    financialDispatchRequestDigest,
    randomUUID: () => "sqlite-route-reservation-event",
    readDatabase: () => structuredClone(routeStale),
    requireApiRole: () => ({ username: "commission", name: "委端", role: "commission" }),
    sendJson(res, status, body) { res.status = status; res.body = body; },
    validateFinancialRequest,
    withFinancialDispatchLock,
    withFinancialDispatchStateLock,
    writeDatabase: storage.writeDatabase
  };
  const dispatchSegment = createInsurancePaymentRouteSegments(routeRuntime).find((item) => item.id === "insurance-payment-01");
  const routeResponse = {};
  await dispatchSegment.handle({
    method: "POST",
    headers: {},
    body: {
      type: "PAYMENT",
      operation: "create-payment",
      idempotencyKey: "sqlite-real-route-conflict-key",
      payload: { orderNo: "SQLITE-ROUTE-CONFLICT", amountFen: 100, currency: "CNY" }
    }
  }, routeResponse, new URL("http://platform.test/api/financial-gateways/dispatch"));
  assert.equal(routeResponse.status, 409);
  assert.equal(routeResponse.body.code, "FINANCIAL_DISPATCH_VERSION_CONFLICT");
  assert.doesNotMatch(JSON.stringify(routeResponse.body), /expected|current|integrationGatewayEvents/);
  assert.equal(providerCalls, 0);

  const previousGlobalCapacity = process.env.FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS;
  const previousScopeCapacity = process.env.FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS_PER_SCOPE;
  process.env.FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS = "1000";
  process.env.FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS_PER_SCOPE = "100";
  const capacityState = storage.readDatabase();
  const capacityEvents = (count) => Array.from({ length: count }, (_, index) => ({
    id: `capacity-alert-event-${index}`,
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "create-payment",
    contractId: "payment-transaction-v1",
    idempotencyKey: `capacity-alert-key-${index}`,
    receivedBy: "institution-capacity-test",
    status: "accepted",
    requestPayload: {
      type: "PAYMENT", operation: "create-payment", contractId: "payment-transaction-v1",
      idempotencyKey: `capacity-alert-key-${index}`,
      payload: { institutionCode: "CAPACITY-ORG", orderNo: `CAPACITY-ORDER-${index}`, amountFen: 1, currency: "CNY" }
    }
  }));
  const warningSignal = storage.buildObservabilitySignals({ ...capacityState, integrationGatewayEvents: capacityEvents(80) })
    .find((item) => item.source === "financial-gateway-ledger");
  const criticalSignal = storage.buildObservabilitySignals({ ...capacityState, integrationGatewayEvents: capacityEvents(95) })
    .find((item) => item.source === "financial-gateway-ledger");
  assert.equal(warningSignal.severity, "warning");
  assert.equal(warningSignal.metrics.financialLedgerUtilizationPercent, "80");
  assert.equal(criticalSignal.severity, "critical");
  assert.equal(criticalSignal.metrics.financialLedgerUtilizationPercent, "95");
  if (previousGlobalCapacity === undefined) delete process.env.FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS;
  else process.env.FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS = previousGlobalCapacity;
  if (previousScopeCapacity === undefined) delete process.env.FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS_PER_SCOPE;
  else process.env.FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS_PER_SCOPE = previousScopeCapacity;

  const db = storage.openSqliteDatabase();
  try {
    db.prepare("UPDATE state_collections SET payload = ? WHERE key = ?").run('{"corrupt":true}', "integrationGatewayEvents");
  } finally {
    db.close();
  }
  assert.throws(() => storage.writeDatabase(afterConflict), /ledger must be an array/);
});

test("JSON financial ledger corruption fails closed before a state write", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-json-ledger-"));
  try {
    fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const storage = require(${JSON.stringify(path.join(ROOT, "server.js"))});
      const state = storage.readDatabase();
      fs.writeFileSync(path.join(process.env.DATA_DIR, "db.json"), "{invalid-financial-ledger", "utf8");
      try {
        storage.writeDatabase(state);
        process.exit(2);
      } catch (error) {
        if (!/JSON|Unexpected|property name/i.test(String(error && error.message))) process.exit(3);
      }
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, STORAGE_ENGINE: "json" },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("JSON financial ledger with valid JSON but an invalid collection shape fails closed", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-json-shape-"));
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
    seed.integrationGatewayEvents = [];
    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seed), "utf8");
    const script = `
      const storage = require(${JSON.stringify(path.join(ROOT, "server.js"))});
      const fs = require("node:fs");
      const path = require("node:path");
      const databaseFile = path.join(process.env.DATA_DIR, "db.json");
      const baseline = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
      for (const invalidShape of [{ corrupt: true }, null, false, 0, ""]) {
        fs.writeFileSync(databaseFile, JSON.stringify({ ...baseline, integrationGatewayEvents: invalidShape }), "utf8");
        try {
          const state = storage.readDatabase();
          storage.writeDatabase(state);
          process.exit(2);
        } catch (error) {
          if (!/ledger must be an array/.test(String(error && error.message))) process.exit(3);
        }
      }
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, STORAGE_ENGINE: "json" },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("legacy financial events with a key but no request payload accept callback evidence through the legacy intent", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-legacy-callback-"));
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
    seed.integrationGatewayEvents = [{
      id: "legacy-financial-event-001",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      contractId: "legacy-payment-v1",
      idempotencyKey: "legacy-key-without-request-payload",
      status: "accepted",
      adapterReceipt: { receiptId: "legacy-financial-receipt-001", status: "accepted" },
      payload: { orderNo: "LEGACY-001", amountFen: 100 },
      callbackEvents: []
    }];
    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seed), "utf8");
    const script = `
      const storage = require(${JSON.stringify(path.join(ROOT, "server.js"))});
      const gateways = require(${JSON.stringify(path.join(ROOT, "financial-gateways.js"))});
      const state = storage.readDatabase();
      const payload = {
        eventId: "legacy-callback-001", gatewayType: "PAYMENT", receiptId: "legacy-financial-receipt-001",
        status: "succeeded", occurredAt: "2026-08-23T11:00:00.000Z",
        businessDate: "2026-08-23", amountFen: 100, providerCode: "OK", failureReason: ""
      };
      const timestamp = String(Math.floor(Date.parse(payload.occurredAt) / 1000));
      const nonce = "legacy-callback-nonce-001";
      const secret = ${JSON.stringify(CALLBACK_SECRET)};
      const verified = gateways.verifyFinancialCallback(payload, {
        type: "PAYMENT", env: { NODE_ENV: "production", PAYMENT_CALLBACK_SECRET: secret }, timestamp, nonce,
        signature: gateways.signFinancialCallback(payload, { secret, timestamp, nonce }), nowMs: Date.parse(payload.occurredAt)
      });
      const result = gateways.applyFinancialCallback(state, verified);
      storage.writeDatabase(state, { financialGatewayWrite: {
        kind: "legacy-callback", eventId: "legacy-financial-event-001",
        callbackEventId: result.callbackEvent.eventId, callbackAttestation: result.verificationAttestation
      } });
      const persisted = storage.readDatabase().integrationGatewayEvents[0];
      if (persisted.status !== "accepted" || persisted.providerStatus !== "succeeded" || persisted.callbackEvents.length !== 1) process.exit(2);
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, STORAGE_ENGINE: "json" },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("real storage commits a successful callback racing a failed retry into reconciliation-required state", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-retry-callback-race-"));
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
    const idempotencyKey = "real-storage-retry-race-key-001";
    seed.integrationGatewayEvents = [{
      id: "real-storage-retry-race-event-001",
      direction: "outbound",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-transaction-v1",
      idempotencyKey,
      receivedBy: "commission-reviewer",
      capacityScope: "principal:commission-reviewer",
      status: "failed",
      deadLetter: true,
      deadLetterReason: "prior provider dispatch failed",
      failureCode: "FINANCIAL_DISPATCH_PROVIDER_REJECTED",
      failedAt: "2026-08-23T08:00:00.000Z",
      reconciliationStatus: "dead-letter",
      retryCount: 0,
      adapterReceipt: { receiptId: "real-storage-retry-old-receipt-001", status: "accepted" },
      providerStatus: "accepted",
      callbackEvents: [],
      requestPayload: {
        type: "PAYMENT",
        operation: "create-payment",
        contractId: "payment-transaction-v1",
        idempotencyKey,
        payload: { orderNo: "REAL-STORAGE-RETRY-RACE", amountFen: 1200, currency: "CNY" }
      }
    }];
    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seed), "utf8");
    const script = `
      (async () => {
        const storage = require(${JSON.stringify(path.join(ROOT, "server.js"))});
        const gateways = require(${JSON.stringify(path.join(ROOT, "financial-gateways.js"))});
        const integrationRoutes = require(${JSON.stringify(path.join(ROOT, "src", "http", "routes", "integration.js"))});
        const insuranceRoutes = require(${JSON.stringify(path.join(ROOT, "src", "http", "routes", "insurance-payment.js"))});
        let providerCalls = 0;
        let releaseProvider;
        let markProviderEntered;
        const providerEntered = new Promise((resolve) => { markProviderEntered = resolve; });
        const providerRelease = new Promise((resolve) => { releaseProvider = resolve; });
        const runtime = {
          ...storage,
          appendSecurityEvent: () => {},
          collectJson: (req) => Promise.resolve(req.body || {}),
          dispatchFinancialRequest: async () => {
            providerCalls += 1;
            markProviderEntered();
            await providerRelease;
            throw new Error("provider retry failed: secret must be redacted");
          },
          requireApiRole: () => ({ username: "commission-reviewer", name: "委端审核员", role: "commission" }),
          sendJson: (res, status, body) => { res.status = status; res.body = body; }
        };
        const retrySegment = integrationRoutes.createRouteSegments(runtime).find((item) => item.id === "integration-03");
        const callbackSegment = insuranceRoutes.createRouteSegments(runtime).find((item) => item.id === "insurance-payment-01");
        const retryRequest = async () => {
          const res = {};
          await retrySegment.handle({ method: "POST", headers: {} }, res, new URL("http://platform.test/api/integration/events/real-storage-retry-race-event-001/retry"));
          return res;
        };
        const retryPromise = retryRequest();
        await providerEntered;
        const occurredAt = new Date().toISOString();
        const payload = {
          eventId: "real-storage-retry-race-callback-001",
          gatewayType: "PAYMENT",
          receiptId: "real-storage-retry-old-receipt-001",
          status: "succeeded",
          occurredAt,
          businessDate: occurredAt.slice(0, 10),
          amountFen: 1200,
          providerCode: "OK"
        };
        const timestamp = String(Math.floor(Date.parse(occurredAt) / 1000));
        const nonce = "real-storage-retry-race-nonce-001";
        const secret = process.env.PAYMENT_CALLBACK_SECRET;
        const callbackRes = {};
        await callbackSegment.handle({ method: "POST", body: payload, headers: {
          "x-financial-timestamp": timestamp,
          "x-financial-nonce": nonce,
          "x-financial-signature": gateways.signFinancialCallback(payload, { secret, timestamp, nonce })
        } }, callbackRes, new URL("http://platform.test/api/financial-gateways/callbacks/PAYMENT"));
        releaseProvider();
        const retryRes = await retryPromise;
        const blockedRes = await retryRequest();
        const persisted = storage.readDatabase().integrationGatewayEvents.find((item) => item.id === "real-storage-retry-race-event-001");
        if (callbackRes.status !== 200) process.exit(2);
        if (retryRes.status !== 200 || retryRes.body.status !== "failed" || retryRes.body.reconciliationStatus !== "provider-exception") process.exit(3);
        if (blockedRes.status !== 409 || blockedRes.body.code !== "FINANCIAL_RETRY_RECONCILIATION_REQUIRED") process.exit(4);
        if (providerCalls !== 1 || persisted.status !== "failed" || persisted.providerStatus !== "succeeded") process.exit(5);
        if (persisted.callbackEvents?.[0]?.eventId !== payload.eventId || persisted.lastRetryResult !== "callback-race-reconciliation-required") process.exit(6);
        if (!storage.readDatabase().securityEvents.some((item) => item.action === "重试金融网关事件" && item.result === "需复核")) process.exit(7);
      })().catch((error) => { console.error(error); process.exit(9); });
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        STORAGE_ENGINE: "json",
        PAYMENT_CALLBACK_SECRET: CALLBACK_SECRET
      },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("callback attestation cannot be rebased onto a newer persisted callback ledger head", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-callback-head-"));
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
    const idempotencyKey = "callback-head-key-001";
    seed.integrationGatewayEvents = [{
      id: "callback-head-event-001",
      direction: "outbound",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-transaction-v1",
      idempotencyKey,
      status: "accepted",
      providerStatus: "accepted",
      reconciliationStatus: "provider-accepted",
      dispatchedAt: "2026-08-23T08:00:00.000Z",
      businessDate: "2026-08-23",
      adapterReceipt: { receiptId: "callback-head-receipt-001", status: "accepted" },
      callbackEvents: [],
      requestPayload: {
        type: "PAYMENT", operation: "create-payment", contractId: "payment-transaction-v1", idempotencyKey,
        payload: { orderNo: "CALLBACK-HEAD-ORDER", amountFen: 100, currency: "CNY" }
      }
    }];
    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seed), "utf8");
    const script = `
      const storage = require(${JSON.stringify(path.join(ROOT, "server.js"))});
      const gateways = require(${JSON.stringify(path.join(ROOT, "financial-gateways.js"))});
      const secret = ${JSON.stringify(CALLBACK_SECRET)};
      const verify = (eventId, status, occurredAt, nonce) => {
        const payload = {
          eventId, gatewayType: "PAYMENT", receiptId: "callback-head-receipt-001", status,
          occurredAt, businessDate: occurredAt.slice(0, 10), amountFen: 100, providerCode: status.toUpperCase()
        };
        const timestamp = String(Math.floor(Date.parse(occurredAt) / 1000));
        return gateways.verifyFinancialCallback(payload, {
          type: "PAYMENT", env: { NODE_ENV: "production", PAYMENT_CALLBACK_SECRET: secret }, timestamp, nonce,
          signature: gateways.signFinancialCallback(payload, { secret, timestamp, nonce }), nowMs: Date.parse(occurredAt)
        });
      };
      const now = Date.now();
      const staleState = storage.readDatabase();
      const staleResult = gateways.applyFinancialCallback(staleState, verify(
        "callback-head-stale-processing", "processing", new Date(now - 2000).toISOString(), "callback-head-stale-nonce"
      ));
      const freshState = storage.readDatabase();
      const freshResult = gateways.applyFinancialCallback(freshState, verify(
        "callback-head-fresh-succeeded", "succeeded", new Date(now - 1000).toISOString(), "callback-head-fresh-nonce"
      ));
      const requestDigest = gateways.financialDispatchRequestDigest(freshResult.gatewayEvent.requestPayload);
      storage.writeDatabase(freshState, { financialGatewayWrite: {
        kind: "callback", eventId: freshResult.gatewayEvent.id, idempotencyKey: freshResult.gatewayEvent.idempotencyKey,
        requestDigest, callbackEventId: freshResult.callbackEvent.eventId, callbackAttestation: freshResult.verificationAttestation
      }});
      const rebased = storage.readDatabase();
      const event = rebased.integrationGatewayEvents.find((item) => item.id === "callback-head-event-001");
      event.callbackEvents = [staleResult.callbackEvent, ...event.callbackEvents];
      event.updatedAt = staleResult.gatewayEvent.updatedAt;
      event.providerStatus = staleResult.gatewayEvent.providerStatus;
      event.latestCallbackAt = staleResult.gatewayEvent.latestCallbackAt;
      event.businessDate = staleResult.gatewayEvent.businessDate;
      event.providerCode = staleResult.gatewayEvent.providerCode;
      event.reconciliationStatus = staleResult.gatewayEvent.reconciliationStatus;
      try {
        storage.writeDatabase(rebased, { financialGatewayWrite: {
          kind: "callback", eventId: event.id, idempotencyKey: event.idempotencyKey, requestDigest,
          callbackEventId: staleResult.callbackEvent.eventId, callbackAttestation: staleResult.verificationAttestation
        }});
        process.exit(2);
      } catch (error) {
        if (!/callback verification attestation is invalid/.test(String(error && error.message))) process.exit(3);
      }
      const persisted = storage.readDatabase().integrationGatewayEvents.find((item) => item.id === event.id);
      if (persisted.providerStatus !== "succeeded" || persisted.callbackEvents.length !== 1) process.exit(4);
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, STORAGE_ENGINE: "json" },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("callback evidence grows beyond the legacy 30-item window and fails closed only at the configured append-only cap", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-callback-capacity-"));
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
    const idempotencyKey = "callback-capacity-key-001";
    seed.integrationGatewayEvents = [{
      id: "callback-capacity-event-001",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-transaction-v1",
      idempotencyKey,
      status: "accepted",
      providerStatus: "accepted",
      adapterReceipt: { receiptId: "callback-capacity-receipt-001", status: "accepted" },
      requestPayload: {
        type: "PAYMENT", operation: "create-payment", contractId: "payment-transaction-v1", idempotencyKey,
        payload: { orderNo: "CALLBACK-CAPACITY-001", amountFen: 100, currency: "CNY" }
      },
      callbackEvents: Array.from({ length: 30 }, (_, index) => ({
        eventId: `historical-callback-${index}`,
        gatewayType: "PAYMENT",
        receiptId: "callback-capacity-receipt-001",
        status: "accepted",
        occurredAt: `2026-08-22T10:${String(index).padStart(2, "0")}:00.000Z`,
        businessDate: "2026-08-22",
        amountFen: 100,
        nonceDigest: `sha256:${String(index).padStart(64, "0")}`,
        signatureVerified: true,
        stateApplied: true,
        ignoredReason: ""
      }))
    }];
    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seed), "utf8");
    const script = `
      const storage = require(${JSON.stringify(path.join(ROOT, "server.js"))});
      const gateways = require(${JSON.stringify(path.join(ROOT, "financial-gateways.js"))});
      const state = storage.readDatabase();
      const secret = ${JSON.stringify(CALLBACK_SECRET)};
      const callback = (eventId, nonce, status, occurredAt) => {
        const payload = {
          eventId, gatewayType: "PAYMENT", receiptId: "callback-capacity-receipt-001", status,
          occurredAt, businessDate: "2026-08-23", amountFen: 100,
          providerCode: "OK", failureReason: ""
        };
        const timestamp = String(Math.floor(Date.parse(occurredAt) / 1000));
        return gateways.verifyFinancialCallback(payload, {
          type: "PAYMENT", env: { NODE_ENV: "production", PAYMENT_CALLBACK_SECRET: secret }, timestamp, nonce,
          signature: gateways.signFinancialCallback(payload, { secret, timestamp, nonce }), nowMs: Date.parse(occurredAt)
        });
      };
      const result = gateways.applyFinancialCallback(state, callback("callback-31", "callback-capacity-nonce-31", "processing", "2026-08-23T10:00:00.000Z"));
      storage.writeDatabase(state, { financialGatewayWrite: {
        kind: "callback", eventId: "callback-capacity-event-001", idempotencyKey: "callback-capacity-key-001",
        requestDigest: gateways.financialDispatchRequestDigest(state.integrationGatewayEvents[0].requestPayload),
        callbackEventId: result.callbackEvent.eventId, callbackAttestation: result.verificationAttestation
      }});
      if (storage.readDatabase().integrationGatewayEvents[0].callbackEvents.length !== 31) process.exit(2);
      process.env.FINANCIAL_CALLBACK_LEDGER_MAX_EVENTS_PER_REQUEST = "31";
      try {
        gateways.applyFinancialCallback(storage.readDatabase(), callback("callback-32", "callback-capacity-nonce-32", "succeeded", "2026-08-23T10:01:00.000Z"));
        process.exit(3);
      } catch (error) {
        if (error.code !== "FINANCIAL_CALLBACK_LEDGER_CAPACITY_REACHED" || error.statusCode !== 507) process.exit(4);
      }
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, STORAGE_ENGINE: "json" },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("financial idempotency ledger capacity fails closed without evicting old receipts", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-ledger-capacity-"));
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
    seed.integrationGatewayEvents = Array.from({ length: 1000 }, (_, index) => ({
      id: `capacity-financial-event-${index}`,
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-transaction-v1",
      idempotencyKey: `capacity-financial-key-${index}`,
      status: "accepted",
      requestPayload: {
        type: "PAYMENT",
        operation: "create-payment",
        contractId: "payment-transaction-v1",
        idempotencyKey: `capacity-financial-key-${index}`,
        payload: { orderNo: `CAPACITY-${index}`, amountFen: index + 1, currency: "CNY" }
      }
    }));
    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seed), "utf8");
    const script = `
      const storage = require(${JSON.stringify(path.join(ROOT, "server.js"))});
      const { financialDispatchRequestDigest } = require(${JSON.stringify(path.join(ROOT, "financial-gateways.js"))});
      const state = storage.readDatabase();
      const requestPayload = {
        type: "PAYMENT", operation: "create-payment", contractId: "payment-transaction-v1",
        idempotencyKey: "capacity-financial-new-key", payload: { orderNo: "CAPACITY-NEW", amountFen: 1, currency: "CNY" }
      };
      const event = {
        id: "capacity-financial-new-event", adapterType: "financial", gatewayType: "PAYMENT",
        operation: "create-payment", contractId: "payment-transaction-v1",
        idempotencyKey: requestPayload.idempotencyKey, status: "dispatching", requestPayload
      };
      state.integrationGatewayEvents.unshift(event);
      try {
        storage.writeDatabase(state, { financialGatewayWrite: {
          kind: "reserve", eventId: event.id, idempotencyKey: event.idempotencyKey,
          requestDigest: financialDispatchRequestDigest(requestPayload)
        }});
        process.exit(2);
      } catch (error) {
        if (!/ledger capacity reached/.test(String(error && error.message))) process.exit(3);
      }
      if (storage.readDatabase().integrationGatewayEvents.length !== 1000) process.exit(4);
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        STORAGE_ENGINE: "json",
        FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS: "1000"
      },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("financial idempotency capacity isolates an institution scope before the global ledger is exhausted", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-financial-scope-capacity-"));
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
    seed.integrationGatewayEvents = Array.from({ length: 100 }, (_, index) => ({
      id: `scope-capacity-event-${index}`,
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-transaction-v1",
      idempotencyKey: `scope-capacity-key-${index}`,
      receivedBy: "hospital-user",
      capacityScope: "institution:SCOPE-A",
      status: "accepted",
      requestPayload: {
        type: "PAYMENT", operation: "create-payment", contractId: "payment-transaction-v1",
        idempotencyKey: `scope-capacity-key-${index}`,
        payload: { institutionCode: `CLIENT-VALUE-${index}`, orderNo: `SCOPE-${index}`, amountFen: 1, currency: "CNY" }
      }
    }));
    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seed), "utf8");
    const script = `
      const storage = require(${JSON.stringify(path.join(ROOT, "server.js"))});
      const gateways = require(${JSON.stringify(path.join(ROOT, "financial-gateways.js"))});
      const reserve = (state, id, key, scope) => {
        const requestPayload = { type: "PAYMENT", operation: "create-payment", contractId: "payment-transaction-v1", idempotencyKey: key, payload: { institutionCode: "CLIENT-CANNOT-SELECT-SCOPE", orderNo: id, amountFen: 1, currency: "CNY" } };
        const event = { id, adapterType: "financial", gatewayType: "PAYMENT", operation: "create-payment", contractId: "payment-transaction-v1", idempotencyKey: key, receivedBy: "hospital-user", capacityScope: scope, status: "dispatching", requestPayload };
        state.integrationGatewayEvents.unshift(event);
        return { event, requestDigest: gateways.financialDispatchRequestDigest(requestPayload) };
      };
      const sameState = storage.readDatabase();
      const same = reserve(sameState, "scope-capacity-same", "scope-capacity-same-key", "institution:SCOPE-A");
      try {
        storage.writeDatabase(sameState, { financialGatewayWrite: { kind: "reserve", eventId: same.event.id, idempotencyKey: same.event.idempotencyKey, requestDigest: same.requestDigest } });
        process.exit(2);
      } catch (error) {
        if (!/scope capacity reached/.test(String(error && error.message))) process.exit(3);
      }
      const otherState = storage.readDatabase();
      const other = reserve(otherState, "scope-capacity-other", "scope-capacity-other-key", "institution:SCOPE-B");
      storage.writeDatabase(otherState, { financialGatewayWrite: { kind: "reserve", eventId: other.event.id, idempotencyKey: other.event.idempotencyKey, requestDigest: other.requestDigest } });
      if (!storage.readDatabase().integrationGatewayEvents.some((item) => item.id === other.event.id)) process.exit(4);
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        STORAGE_ENGINE: "json",
        FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS: "1000",
        FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS_PER_SCOPE: "100"
      },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
