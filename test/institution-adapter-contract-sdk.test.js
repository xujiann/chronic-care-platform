"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildAdapterContractReadiness,
  createInstitutionAdapterSdk,
  createReceiptDigest,
  sha256,
  startAdapterContractRun
} = require("../src/care-coordination/institution-adapter-contract-sdk");
const program = require("../config/care-integration-v2-program.json");

function urlFor(system) {
  return `https://${system.toLowerCase()}-adapter.invalid/metadata-contract`;
}

function accepted(request, receivedAt) {
  const receipt = {
    acknowledgedRequestDigest: request.requestDigest,
    responseDigest: sha256(`response:${request.correlationId}`),
    signatureDigest: sha256(`signature:${request.correlationId}`),
    receiptEvidenceRef: `evidence://care-adapter/${request.system.toLowerCase()}/${request.correlationId}`,
    receivedAt
  };
  return { outcome: "accepted", receipt: { ...receipt, receiptDigest: createReceiptDigest(receipt) } };
}

function start(state, contract, index, requestDigest = sha256(`request:${contract.system}`)) {
  return startAdapterContractRun(state, {
    commandId: `adapter-start-${index}`,
    contractId: contract.id,
    correlationId: `corr-${contract.system.toLowerCase()}-${index}`,
    requestDigest,
    requestEvidenceRef: `artifact://care-adapter/${contract.system.toLowerCase()}/request-${index}`,
    idempotencyKey: `opaque-idempotency-${contract.system}-${index}`
  }, { endpoint: urlFor(contract.system), now: `2026-08-17T12:${String(index).padStart(2, "0")}:00.000Z` });
}

test("adapter SDK covers HIS EMR LIS PACS pharmacy and insurance with retry, signature and reconciliation controls", async () => {
  let state = {};
  const calls = new Map();
  const sdk = createInstitutionAdapterSdk({
    async dispatch(request) {
      calls.set(request.system, (calls.get(request.system) || 0) + 1);
      if (request.system === "HIS" && calls.get(request.system) === 1) {
        return { outcome: "retryable-failure", errorCode: "SYNTHETIC_TIMEOUT" };
      }
      return accepted(request, new Date(Date.parse(request.requestTimestamp) + 1000).toISOString());
    },
    async verifyReceipt(receipt) {
      return { verified: true, evidenceRef: `vault://care-adapter/verification/${receipt.system.toLowerCase()}` };
    }
  });
  const runIds = {};
  for (let index = 0; index < program.adapterContracts.length; index += 1) {
    const contract = program.adapterContracts[index];
    let result = start(state, contract, index);
    state = result.data;
    runIds[contract.system] = result.result.runId;
    const minute = String(index).padStart(2, "0");
    result = await sdk.execute(state, {
      commandId: `adapter-attempt-${index}`,
      runId: result.result.runId,
      expectedVersion: 0
    }, {
      endpoint: urlFor(contract.system), nonce: `nonce-${contract.system}-${index}`,
      requestTimestamp: `2026-08-17T12:${minute}:05.000Z`, now: `2026-08-17T12:${minute}:06.000Z`
    });
    state = result.data;
    if (contract.system === "HIS") {
      assert.equal(result.result.status, "retry-wait");
      assert.equal(result.result.nextRetryAt, "2026-08-17T12:00:36.000Z");
      result = await sdk.execute(state, {
        commandId: "adapter-attempt-his-retry",
        runId: result.result.runId,
        expectedVersion: 1
      }, {
        endpoint: urlFor(contract.system), nonce: "nonce-HIS-retry",
        requestTimestamp: "2026-08-17T12:00:40.000Z", now: "2026-08-17T12:00:41.000Z"
      });
      state = result.data;
    }
    assert.equal(result.result.status, "passed");
    assert.equal(result.result.receipt.matched, true);
    assert.equal(result.result.productionReady, false);
  }

  const readiness = buildAdapterContractReadiness(state, { now: "2026-08-17T12:20:00.000Z" });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.summary.passedSystems, 6);
  assert.deepEqual(readiness.declaredControls,
    ["signature", "replay", "idempotency", "retry", "dead-letter", "receipt-reconciliation"]);
  assert.equal(readiness.productionGate, "NO-GO");
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.externalEvidenceVerified, false);
  assert.ok(runIds.HIS && runIds.PHARMACY && runIds.INSURANCE);

  const stored = JSON.stringify(state);
  assert.doesNotMatch(stored, /https:\/\//);
  assert.doesNotMatch(stored, /opaque-idempotency|nonce-HIS|signature:corr/);
  assert.doesNotMatch(stored, /"payload"|"body"|"patient"|"credentials"|"privateKey"/i);
});

test("adapter SDK enforces idempotency, replay, HTTPS, signatures and receipt reconciliation", async () => {
  const contract = program.adapterContracts.find((item) => item.system === "HIS");
  let result = start({}, contract, 20);
  const duplicate = startAdapterContractRun(result.data, {
    commandId: "adapter-start-duplicate",
    contractId: contract.id,
    correlationId: "corr-his-20",
    requestDigest: result.result.requestDigest,
    requestEvidenceRef: "artifact://care-adapter/his/request-20",
    idempotencyKey: "opaque-idempotency-HIS-20"
  }, { endpoint: urlFor("HIS") });
  assert.equal(duplicate.replayed, true);
  assert.equal(duplicate.result.runId, result.result.runId);
  assert.throws(() => startAdapterContractRun(result.data, {
    commandId: "adapter-start-conflict",
    contractId: contract.id,
    correlationId: "conflicting-correlation",
    requestDigest: sha256("conflicting-request"),
    requestEvidenceRef: "artifact://care-adapter/his/conflict",
    idempotencyKey: "opaque-idempotency-HIS-20"
  }, { endpoint: urlFor("HIS") }), (error) => error.code === "ADAPTER_CONTRACT_IDEMPOTENCY_CONFLICT");
  assert.throws(() => startAdapterContractRun({}, {
    commandId: "adapter-start-http",
    contractId: contract.id,
    correlationId: "corr-http",
    requestDigest: sha256("request-http"),
    requestEvidenceRef: "artifact://care-adapter/his/http",
    idempotencyKey: "opaque-http-key"
  }, { endpoint: "http://adapter.invalid" }), (error) => error.code === "ADAPTER_CONTRACT_HTTPS_REQUIRED");

  let mismatchCalls = 0;
  const mismatchSdk = createInstitutionAdapterSdk({
    async dispatch(request) {
      mismatchCalls += 1;
      const response = accepted(request, "2026-08-17T12:20:02.000Z");
      response.receipt.acknowledgedRequestDigest = sha256("different-request");
      response.receipt.receiptDigest = createReceiptDigest(response.receipt);
      return response;
    },
    async verifyReceipt() { return { verified: true, evidenceRef: "vault://care-adapter/verification/mismatch" }; }
  });
  result = await mismatchSdk.execute(result.data, {
    commandId: "adapter-mismatch-020", runId: result.result.runId, expectedVersion: 0
  }, {
    endpoint: urlFor("HIS"), nonce: "nonce-mismatch-020",
    requestTimestamp: "2026-08-17T12:20:00.000Z", now: "2026-08-17T12:20:03.000Z"
  });
  assert.equal(result.result.status, "reconciliation-required");
  assert.equal(buildAdapterContractReadiness(result.data).ok, false);

  const idempotentReplay = await mismatchSdk.execute(result.data, {
    commandId: "adapter-mismatch-020", runId: result.result.runId, expectedVersion: 0
  }, {
    endpoint: urlFor("HIS"), nonce: "unused-idempotent-replay",
    requestTimestamp: "2026-08-17T12:20:00.000Z", now: "2026-08-17T12:20:04.000Z"
  });
  assert.equal(idempotentReplay.replayed, true);
  assert.equal(mismatchCalls, 1);

  await assert.rejects(() => mismatchSdk.execute(result.data, {
    commandId: "adapter-replay-020", runId: result.result.runId, expectedVersion: 1
  }, {
    endpoint: urlFor("HIS"), nonce: "nonce-mismatch-020",
    requestTimestamp: "2026-08-17T12:21:00.000Z", now: "2026-08-17T12:21:01.000Z"
  }), (error) => error.code === "ADAPTER_CONTRACT_REPLAY_BLOCKED");

  const unsigned = start({}, contract, 21);
  const unsignedSdk = createInstitutionAdapterSdk({
    async dispatch(request) { return accepted(request, "2026-08-17T12:21:02.000Z"); },
    async verifyReceipt() { return { verified: false }; }
  });
  await assert.rejects(() => unsignedSdk.execute(unsigned.data, {
    commandId: "adapter-unsigned-021", runId: unsigned.result.runId, expectedVersion: 0
  }, {
    endpoint: urlFor("HIS"), nonce: "nonce-unsigned-021",
    requestTimestamp: "2026-08-17T12:21:00.000Z", now: "2026-08-17T12:21:03.000Z"
  }), (error) => error.code === "ADAPTER_CONTRACT_SIGNATURE_UNVERIFIED");
});

test("adapter SDK dead-letters permanent failure and rejects raw provider material", async () => {
  const contract = program.adapterContracts.find((item) => item.system === "EMR");
  let result = start({}, contract, 30);
  const sdk = createInstitutionAdapterSdk({
    async dispatch() { return { outcome: "permanent-failure", errorCode: "CONTRACT_REJECTED" }; },
    async verifyReceipt() { throw new Error("not called"); }
  });
  result = await sdk.execute(result.data, {
    commandId: "adapter-dead-030", runId: result.result.runId, expectedVersion: 0
  }, {
    endpoint: urlFor("EMR"), nonce: "nonce-dead-030",
    requestTimestamp: "2026-08-17T12:30:00.000Z", now: "2026-08-17T12:30:01.000Z"
  });
  assert.equal(result.result.status, "dead-letter");

  const raw = start({}, contract, 31);
  const rawSdk = createInstitutionAdapterSdk({
    async dispatch(request) { return { ...accepted(request, "2026-08-17T12:31:01.000Z"), payload: { patient: "forbidden" } }; },
    async verifyReceipt() { return { verified: true, evidenceRef: "vault://care-adapter/verification/raw" }; }
  });
  await assert.rejects(() => rawSdk.execute(raw.data, {
    commandId: "adapter-raw-031", runId: raw.result.runId, expectedVersion: 0
  }, {
    endpoint: urlFor("EMR"), nonce: "nonce-raw-031",
    requestTimestamp: "2026-08-17T12:31:00.000Z", now: "2026-08-17T12:31:02.000Z"
  }), (error) => error.code === "ADAPTER_CONTRACT_RAW_MATERIAL_REJECTED");
});
