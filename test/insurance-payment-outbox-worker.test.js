"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Persistence = require("../insurance-payment-persistence");
const Worker = require("../insurance-payment-outbox-worker");

function repository(options = {}) {
  return Persistence.createInMemoryInsurancePaymentRepository({ values: [] }, {
    createdAt: "2026-07-29T01:00:00.000Z",
    retryBaseMs: 1_000,
    ...options
  });
}

async function append(repositoryInput, version, id, value) {
  return repositoryInput.transact({
    commandId: id,
    commandType: "value.append",
    payload: { value },
    expectedVersion: version,
    actor: "operator",
    traceId: `trace-${id}`,
    occurredAt: `2026-07-29T01:0${version + 1}:00.000Z`
  }, (state) => {
    state.values.push(value);
    return { result: { value }, eventType: "value.appended", eventPayload: { value } };
  });
}

test("outbox worker publishes events in aggregate order and acknowledges each lease", async () => {
  const store = repository();
  await append(store, 0, "cmd-a", "a");
  await append(store, 1, "cmd-b", "b");
  const delivered = [];
  const report = await Worker.runInsurancePaymentOutboxBatch(store, async (event) => {
    delivered.push({ id: event.id, version: event.aggregateVersion, payload: event.payload });
    return { accepted: true, messageId: `provider-${event.id}`, publishedAt: "2026-07-29T02:00:01.000Z" };
  }, {
    workerId: "outbox-worker-a",
    startedAt: "2026-07-29T02:00:00.000Z",
    claimAt: "2026-07-29T02:00:00.000Z",
    finishedAt: "2026-07-29T02:00:02.000Z",
    now: () => "2026-07-29T02:00:01.000Z"
  });

  assert.deepEqual(delivered.map((item) => item.version), [1, 2]);
  assert.equal(report.claimed, 2);
  assert.equal(report.published, 2);
  assert.equal(report.failed, 0);
  assert.equal(report.health.status, "healthy");
  assert.equal(report.outcomes.every((item) => /^sha256:[a-f0-9]{64}$/.test(item.receiptDigest)), true);
  assert.equal(JSON.stringify(report).includes('"value":"a"'), false);
  assert.equal(report.payloadsExposed, false);
});

test("publisher failure is stored as a digest and scheduled for retry without leaking the error", async () => {
  const store = repository();
  await append(store, 0, "cmd-fail", "sensitive-business-value");
  const report = await Worker.runInsurancePaymentOutboxBatch(store, async () => {
    const error = new Error("provider rejected secret credential and patient payload");
    error.code = "PROVIDER_UNAVAILABLE";
    throw error;
  }, {
    workerId: "outbox-worker-a",
    startedAt: "2026-07-29T02:00:00.000Z",
    claimAt: "2026-07-29T02:00:00.000Z",
    finishedAt: "2026-07-29T02:00:01.000Z",
    now: () => "2026-07-29T02:00:01.000Z"
  });

  assert.equal(report.failed, 1);
  assert.equal(report.outcomes[0].status, "pending");
  assert.equal(report.outcomes[0].errorCode, "PROVIDER_UNAVAILABLE");
  assert.match(report.outcomes[0].errorDigest, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(report), /secret credential|patient payload|sensitive-business-value/);
  assert.equal((await store.outboxStatus()).counts.pending, 1);
});

test("publisher timeout aborts the attempt and returns the event to retry", async () => {
  const store = repository();
  await append(store, 0, "cmd-timeout", "a");
  let aborted = false;
  const report = await Worker.runInsurancePaymentOutboxBatch(store, (_event, context) => new Promise((resolve) => {
    context.signal.addEventListener("abort", () => { aborted = true; resolve({ accepted: true, receiptId: "too-late" }); });
  }), {
    workerId: "outbox-worker-timeout",
    startedAt: "2026-07-29T02:00:00.000Z",
    claimAt: "2026-07-29T02:00:00.000Z",
    finishedAt: "2026-07-29T02:00:01.000Z",
    publishTimeoutMs: 10,
    now: () => "2026-07-29T02:00:01.000Z"
  });
  assert.equal(aborted, true);
  assert.equal(report.outcomes[0].errorCode, "OUTBOX_PUBLISH_TIMEOUT");
  assert.equal(report.outcomes[0].status, "pending");
});

test("successful publication with failed acknowledgement remains eligible for idempotent redelivery", async () => {
  const store = repository();
  await append(store, 0, "cmd-ack", "a");
  const wrapped = {
    claimOutbox: (...args) => store.claimOutbox(...args),
    failOutbox: (...args) => store.failOutbox(...args),
    outboxStatus: (...args) => store.outboxStatus(...args),
    acknowledgeOutbox: async () => { throw new Error("database unavailable after provider accepted event"); }
  };
  const report = await Worker.runInsurancePaymentOutboxBatch(wrapped, async () => ({ accepted: true, receiptId: "provider-receipt-001" }), {
    workerId: "outbox-worker-ack",
    startedAt: "2026-07-29T02:00:00.000Z",
    claimAt: "2026-07-29T02:00:00.000Z",
    finishedAt: "2026-07-29T02:00:01.000Z"
  });
  assert.equal(report.acknowledgementPending, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.outcomes[0].status, "published-acknowledgement-pending");
  assert.equal((await store.outboxStatus()).counts.processing, 1);
  assert.equal(report.deliveryGuarantee.includes("deduplicate"), true);
});

test("outbox health is critical for any dead letter and warns on bounded backlog", () => {
  const critical = Worker.buildOutboxHealth({ counts: { pending: 2, processing: 0, published: 10, "dead-letter": 1 } });
  assert.equal(critical.status, "critical");
  assert.equal(critical.healthy, false);
  const warning = Worker.buildOutboxHealth({ counts: { pending: 100, processing: 0, published: 10, "dead-letter": 0 } });
  assert.equal(warning.status, "warning");
  assert.equal(warning.healthy, true);
});

test("publisher receipts fail closed when acceptance or identity is missing", () => {
  assert.throws(() => Worker.normalizePublishReceipt({ accepted: false }), (error) => error.code === "OUTBOX_PUBLISH_NOT_ACCEPTED");
  assert.throws(() => Worker.normalizePublishReceipt({ accepted: true }), (error) => error.code === "OUTBOX_PUBLISH_RECEIPT_INVALID");
  assert.equal(Worker.normalizePublishReceipt({ accepted: true, receiptId: "receipt-001", duplicate: true }).duplicate, true);
});
