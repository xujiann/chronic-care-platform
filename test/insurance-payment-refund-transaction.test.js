"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Persistence = require("../insurance-payment-persistence");
const RefundTransaction = require("../insurance-payment-refund-transaction");

function fixture(amountFen = 10_000) {
  return {
    integrationGatewayEvents: [{
      id: "payment-event-001",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      externalId: "ORDER-001",
      adapterReceipt: { receiptId: "PAYMENT-TRADE-001", status: "succeeded" },
      requestPayload: { payload: { orderNo: "ORDER-001", amountFen, currency: "CNY" } },
      providerStatus: "succeeded",
      reconciliationStatus: "provider-final",
      callbackEvents: []
    }],
    onlinePaymentRefunds: []
  };
}

function request(overrides = {}) {
  return {
    id: "refund-001",
    paymentEventId: "payment-event-001",
    paymentTradeNo: "PAYMENT-TRADE-001",
    orderReference: "ORDER-001",
    refundAmountFen: 3_000,
    refundReason: "resident cancelled the service",
    reasonCode: "SERVICE_CANCELLED",
    idempotencyKey: "client-secret-idempotency-key",
    ...overrides
  };
}

const actor = {
  username: "hospital",
  role: "institution",
  orgCode: "MR1",
  orgName: "人民医院"
};

test("real refund request commits domain state command receipt and versioned outbox together", async () => {
  const original = fixture();
  const result = await RefundTransaction.createRefundRequestTransaction(original, request(), actor);

  assert.equal(original.onlinePaymentRefunds.length, 0);
  assert.equal(result.data.onlinePaymentRefunds.length, 1);
  assert.equal(result.row.id, "refund-001");
  assert.equal(result.row.organizationId, "MR1");
  assert.equal(result.idempotent, false);
  assert.deepEqual(result.contract, RefundTransaction.REFUND_REQUEST_CONTRACT);
  assert.equal(result.row.refundTransactionRuntime, undefined);
  assert.equal(result.row.requestKeyHash, undefined);

  const stored = result.data.onlinePaymentRefunds[0];
  assert.equal(stored.idempotencyKey.includes("client-secret"), false);
  assert.equal(JSON.stringify(stored).includes("client-secret-idempotency-key"), false);
  assert.equal(stored.refundTransactionRuntime.schema, RefundTransaction.RUNTIME_SCHEMA);
  const checkpoint = stored.refundTransactionRuntime.checkpoint;
  assert.equal(Persistence.verifyPersistenceRecord(checkpoint), true);
  assert.equal(checkpoint.version, 1);
  assert.equal(checkpoint.commands.length, 1);
  assert.equal(checkpoint.outbox.length, 1);
  assert.equal(checkpoint.outbox[0].eventType, "insurance-payment.refund-requested.v1");
  assert.equal(checkpoint.outbox[0].payload.contractId, "insurance-payment.refund-request.v1");
  assert.equal(checkpoint.outbox[0].payload.productionEvidence, false);
});

test("same idempotency key replays once and conflicting reuse is rejected before another refund", async () => {
  const first = await RefundTransaction.createRefundRequestTransaction(fixture(), request(), actor);
  const replay = await RefundTransaction.createRefundRequestTransaction(first.data, request({ id: "ignored-replay-id" }), actor);

  assert.equal(replay.idempotent, true);
  assert.equal(replay.row.id, "refund-001");
  assert.equal(replay.data.onlinePaymentRefunds.length, 1);
  assert.equal(replay.data.onlinePaymentRefunds[0].refundTransactionRuntime.checkpoint.commands.length, 1);
  assert.equal(replay.data.onlinePaymentRefunds[0].refundTransactionRuntime.checkpoint.outbox.length, 1);

  await assert.rejects(
    RefundTransaction.createRefundRequestTransaction(first.data, request({ refundAmountFen: 4_000 }), actor),
    (error) => error.code === "PERSISTENCE_COMMAND_CONFLICT" && error.statusCode === 409
  );
  assert.equal(first.data.onlinePaymentRefunds.length, 1);
});

test("payment-scoped unit-of-work lock serializes stale readers and preserves refundable balance", async () => {
  let persisted = fixture(5_000);
  const work = (payload, delayMs) => RefundTransaction.withRefundRequestLock(payload, async () => {
    const readSnapshot = structuredClone(persisted);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const result = await RefundTransaction.createRefundRequestTransaction(readSnapshot, payload, actor);
    persisted = result.data;
    return result;
  });

  const outcomes = await Promise.allSettled([
    work(request({ id: "refund-a", idempotencyKey: "refund-a", refundAmountFen: 3_000 }), 15),
    work(request({ id: "refund-b", idempotencyKey: "refund-b", refundAmountFen: 3_000 }), 0)
  ]);

  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, "rejected");
  assert.equal(outcomes[1].reason.code, "REFUND_AMOUNT_EXCEEDS_AVAILABLE");
  assert.equal(persisted.onlinePaymentRefunds.length, 1);
  assert.equal(persisted.onlinePaymentRefunds[0].refundAmountFen, 3_000);
});

test("outbox delivery uses the versioned anti-corruption contract and durable inbox deduplication", async () => {
  const created = await RefundTransaction.createRefundRequestTransaction(fixture(), request(), actor);
  const handled = [];
  const delivered = await RefundTransaction.consumePendingRefundEvents(created.data, {
    consumerName: "refund-ledger-projection",
    handler: async (event) => handled.push(event)
  });

  assert.equal(delivered.results.length, 1);
  assert.equal(delivered.results[0].processed, true);
  assert.equal(delivered.results[0].status, "published");
  assert.equal(handled.length, 1);
  assert.equal(handled[0].type, "insurance-payment.refund-requested.v1");
  assert.equal(handled[0].payload.contractVersion, 1);
  assert.equal(handled[0].payload.productionEvidence, false);

  const stored = delivered.data.onlinePaymentRefunds[0];
  assert.equal(stored.refundTransactionRuntime.inbox.length, 1);
  assert.equal(stored.refundTransactionRuntime.inbox[0].status, "completed");
  assert.equal(stored.refundTransactionRuntime.checkpoint.outbox[0].status, "published");

  const replay = await RefundTransaction.consumePendingRefundEvents(delivered.data, {
    consumerName: "refund-ledger-projection",
    handler: async (event) => handled.push(event)
  });
  assert.equal(replay.results.length, 0);
  assert.equal(handled.length, 1);
});

test("failed event delivery is released from inbox and remains retryable in the outbox", async () => {
  const created = await RefundTransaction.createRefundRequestTransaction(fixture(), request(), actor);
  const delivered = await RefundTransaction.consumePendingRefundEvents(created.data, {
    consumerName: "refund-provider-adapter",
    handler: async () => {
      const error = new Error("provider unavailable");
      error.code = "PROVIDER_UNAVAILABLE";
      throw error;
    }
  });

  assert.equal(delivered.results[0].status, "pending");
  assert.equal(delivered.results[0].errorCode, "PROVIDER_UNAVAILABLE");
  const runtime = delivered.data.onlinePaymentRefunds[0].refundTransactionRuntime;
  assert.equal(runtime.inbox.length, 0);
  assert.equal(runtime.checkpoint.outbox[0].status, "pending");
  assert.equal(runtime.checkpoint.outbox[0].attempts, 1);
  assert.equal(runtime.checkpoint.outbox[0].lastErrorCode, "PROVIDER_UNAVAILABLE");
});
