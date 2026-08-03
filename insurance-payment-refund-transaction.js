"use strict";

const { createHash } = require("node:crypto");
const OnlinePaymentRefunds = require("./online-payment-refunds");
const Persistence = require("./insurance-payment-persistence");
const { IdempotentEventConsumer, createDomainEvent } = require("./src/platform/events/domain-event-runtime");

const REFUND_REQUEST_CONTRACT = Object.freeze({
  id: "insurance-payment.refund-request.v1",
  version: 1,
  eventType: "insurance-payment.refund-requested.v1"
});
const RUNTIME_SCHEMA = "insurance-payment-refund-runtime-v1";
const RUNTIME_FIELD = "refundTransactionRuntime";
const refundWriteTails = new Map();

class RefundTransactionError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "RefundTransactionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function requireText(value, label, maxLength = 240) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new RefundTransactionError(`${label}格式无效`, "REFUND_CONTRACT_FIELD_INVALID", 400);
  }
  return normalized;
}

function normalizeExternalRequest(input = {}, actor = {}) {
  const idempotencyKey = requireText(input.idempotencyKey, "幂等键", 200);
  const refundAmountFen = Number(input.refundAmountFen);
  if (!Number.isSafeInteger(refundAmountFen) || refundAmountFen <= 0) {
    throw new RefundTransactionError("退款金额必须为正整数分", "REFUND_CONTRACT_AMOUNT_INVALID", 400);
  }
  const requestKeyHash = `sha256:${sha256(idempotencyKey)}`;
  return Object.freeze({
    contractId: REFUND_REQUEST_CONTRACT.id,
    contractVersion: REFUND_REQUEST_CONTRACT.version,
    requestKeyHash,
    opaqueIdempotencyKey: `refund:${requestKeyHash.slice(7)}`,
    paymentEventId: requireText(input.paymentEventId, "原支付事件", 160),
    paymentTradeNo: requireText(input.paymentTradeNo, "原支付交易号", 160),
    orderReference: String(input.orderReference || "").trim().slice(0, 160),
    refundAmountFen,
    refundReason: requireText(input.refundReason, "退款原因", 240),
    reasonCode: String(input.reasonCode || "OTHER").trim().slice(0, 40) || "OTHER",
    organizationId: String(actor.orgCode || "").trim().slice(0, 120),
    organizationName: String(actor.orgName || "").trim().slice(0, 160),
    requestedBy: String(actor.username || actor.name || actor.role || "operator").trim().slice(0, 120)
  });
}

function commandPayload(request) {
  return Object.freeze({
    contractId: request.contractId,
    contractVersion: request.contractVersion,
    requestKeyHash: request.requestKeyHash,
    paymentEventId: request.paymentEventId,
    paymentTradeNoDigest: `sha256:${sha256(request.paymentTradeNo)}`,
    orderReferenceDigest: `sha256:${sha256(request.orderReference)}`,
    refundAmountFen: request.refundAmountFen,
    refundReasonDigest: `sha256:${sha256(request.refundReason)}`,
    reasonCode: request.reasonCode,
    organizationId: request.organizationId
  });
}

function eventPayload(request, refund) {
  return Object.freeze({
    contractId: request.contractId,
    contractVersion: request.contractVersion,
    refundId: refund.id,
    paymentEventId: request.paymentEventId,
    orderReference: refund.orderReference,
    refundAmountFen: request.refundAmountFen,
    reasonCode: request.reasonCode,
    organizationId: request.organizationId,
    requestedBy: request.requestedBy,
    productionEvidence: false
  });
}

function publicRefund(row = {}) {
  const copy = structuredClone(row);
  delete copy[RUNTIME_FIELD];
  delete copy.requestKeyHash;
  return copy;
}

function runtimeFor(row) {
  const runtime = row?.[RUNTIME_FIELD];
  if (!runtime || runtime.schema !== RUNTIME_SCHEMA || runtime.contractId !== REFUND_REQUEST_CONTRACT.id) {
    return null;
  }
  return runtime;
}

function createRepository(request, runtime) {
  const aggregateId = `refund-request:${request.requestKeyHash.slice(7, 39)}`;
  const repository = Persistence.createInMemoryInsurancePaymentRepository(
    { refundId: "", state: "NONE", refundAmountFen: 0 },
    { aggregateId }
  );
  return runtime?.checkpoint
    ? repository.restoreCheckpoint(runtime.checkpoint).then(() => repository)
    : Promise.resolve(repository);
}

function withRefundRequestLock(input = {}, work) {
  if (typeof work !== "function") {
    throw new RefundTransactionError("退款事务工作单元不能为空", "REFUND_TRANSACTION_WORK_REQUIRED", 503);
  }
  const paymentEventId = requireText(input.paymentEventId, "原支付事件", 160);
  const lockKey = `payment:${paymentEventId}`;
  const previous = refundWriteTails.get(lockKey) || Promise.resolve();
  const pending = previous.then(work, work);
  const tail = pending.then(() => undefined, () => undefined);
  refundWriteTails.set(lockKey, tail);
  tail.finally(() => {
    if (refundWriteTails.get(lockKey) === tail) refundWriteTails.delete(lockKey);
  });
  return pending;
}

async function createRefundRequestTransaction(data, input = {}, actor = {}, context = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new RefundTransactionError("退款账本不可用", "REFUND_LEDGER_UNAVAILABLE", 503);
  }
  const request = normalizeExternalRequest(input, actor);
  const nextData = structuredClone(data);
  nextData.onlinePaymentRefunds = Array.isArray(nextData.onlinePaymentRefunds) ? nextData.onlinePaymentRefunds : [];
  const existing = nextData.onlinePaymentRefunds.find((item) => item.requestKeyHash === request.requestKeyHash);
  const existingRuntime = runtimeFor(existing);
  const repository = await createRepository(request, existingRuntime);
  const snapshot = await repository.load();
  let createdRow = null;

  let committed;
  try {
    committed = await Persistence.executeInsurancePaymentCommand(repository, {
      commandId: `refund-request:${request.requestKeyHash.slice(7)}`,
      commandType: "insurance-payment.refund-request.v1",
      payload: commandPayload(request),
      expectedVersion: snapshot.version,
      actor: request.requestedBy,
      traceId: String(context.correlationId || "").trim()
        || `refund-trace:${request.requestKeyHash.slice(7, 39)}`
    }, (state) => {
      const result = OnlinePaymentRefunds.createRefundRequest(nextData, {
        id: input.id,
        paymentEventId: request.paymentEventId,
        paymentTradeNo: request.paymentTradeNo,
        orderReference: request.orderReference,
        refundAmountFen: request.refundAmountFen,
        refundReason: request.refundReason,
        reasonCode: request.reasonCode,
        idempotencyKey: request.opaqueIdempotencyKey
      }, actor);
      createdRow = result.row;
      createdRow.requestKeyHash = request.requestKeyHash;
      createdRow.organizationId = request.organizationId;
      createdRow.organizationName = request.organizationName;
      state.refundId = createdRow.id;
      state.state = createdRow.state;
      state.refundAmountFen = createdRow.refundAmountFen;
      return {
        nextState: state,
        result: { refundId: createdRow.id },
        eventType: REFUND_REQUEST_CONTRACT.eventType,
        eventPayload: eventPayload(request, createdRow)
      };
    });
  } catch (error) {
    if (error instanceof Persistence.InsurancePaymentPersistenceError) {
      error.statusCode = error.status;
    }
    throw error;
  }

  const row = createdRow || existing;
  if (!row) {
    throw new RefundTransactionError("幂等回放缺少已提交退款申请", "REFUND_TRANSACTION_REPLAY_STATE_MISSING", 409);
  }
  row[RUNTIME_FIELD] = {
    schema: RUNTIME_SCHEMA,
    contractId: REFUND_REQUEST_CONTRACT.id,
    contractVersion: REFUND_REQUEST_CONTRACT.version,
    checkpoint: await repository.exportCheckpoint(),
    inbox: Array.isArray(existingRuntime?.inbox) ? structuredClone(existingRuntime.inbox) : []
  };
  return Object.freeze({
    data: nextData,
    row: publicRefund(row),
    idempotent: committed.idempotentReplay,
    outboxEventId: committed.outboxEvent?.id || "",
    contract: REFUND_REQUEST_CONTRACT
  });
}

function toDomainEvent(outboxEvent) {
  if (outboxEvent.eventType !== REFUND_REQUEST_CONTRACT.eventType
    || outboxEvent.payload?.contractId !== REFUND_REQUEST_CONTRACT.id
    || outboxEvent.payload?.contractVersion !== REFUND_REQUEST_CONTRACT.version) {
    throw new RefundTransactionError("退款事件契约不受支持", "REFUND_EVENT_CONTRACT_UNSUPPORTED", 409);
  }
  return createDomainEvent({
    id: outboxEvent.id,
    domain: "insurance-payment",
    type: outboxEvent.eventType,
    aggregateId: outboxEvent.aggregateId,
    aggregateVersion: outboxEvent.aggregateVersion,
    correlationId: outboxEvent.traceId,
    causationId: outboxEvent.commandId,
    occurredAt: outboxEvent.occurredAt,
    payload: outboxEvent.payload
  });
}

function createRuntimeInbox(runtime) {
  return {
    async claim(key) {
      const current = runtime.inbox.find((item) => item.key === key);
      if (current?.status === "completed" || current?.status === "processing") return false;
      runtime.inbox.push({ key, status: "processing" });
      return true;
    },
    async complete(key) {
      const current = runtime.inbox.find((item) => item.key === key);
      if (current) current.status = "completed";
    },
    async release(key) {
      runtime.inbox = runtime.inbox.filter((item) => item.key !== key);
    }
  };
}

async function consumePendingRefundEvents(data, { consumerName, handler, workerId = "refund-event-consumer" } = {}) {
  if (typeof handler !== "function") {
    throw new RefundTransactionError("退款事件消费者处理器不能为空", "REFUND_EVENT_HANDLER_REQUIRED", 503);
  }
  const nextData = structuredClone(data);
  const results = [];
  for (const row of Array.isArray(nextData.onlinePaymentRefunds) ? nextData.onlinePaymentRefunds : []) {
    const runtime = runtimeFor(row);
    if (!runtime) continue;
    const request = { requestKeyHash: row.requestKeyHash };
    const repository = await createRepository(request, runtime);
    const claimed = await repository.claimOutbox({ workerId, limit: 10 });
    for (const outboxEvent of claimed) {
      const event = toDomainEvent(outboxEvent);
      const consumer = new IdempotentEventConsumer({
        name: requireText(consumerName, "消费者名称", 120),
        inbox: createRuntimeInbox(runtime),
        handler
      });
      try {
        const consumed = await consumer.consume(event);
        await repository.acknowledgeOutbox(outboxEvent.id, {
          workerId,
          leaseToken: outboxEvent.leaseToken
        });
        results.push({ eventId: event.id, ...consumed, status: "published" });
      } catch (error) {
        await repository.failOutbox(outboxEvent.id, {
          workerId,
          leaseToken: outboxEvent.leaseToken,
          errorCode: String(error.code || "REFUND_EVENT_DELIVERY_FAILED"),
          errorMessage: error.message
        });
        results.push({ eventId: event.id, processed: false, duplicate: false, status: "pending", errorCode: String(error.code || "REFUND_EVENT_DELIVERY_FAILED") });
      }
    }
    runtime.checkpoint = await repository.exportCheckpoint();
  }
  return Object.freeze({ data: nextData, results: Object.freeze(results), productionEvidence: false });
}

module.exports = {
  REFUND_REQUEST_CONTRACT,
  RUNTIME_FIELD,
  RUNTIME_SCHEMA,
  RefundTransactionError,
  consumePendingRefundEvents,
  createRefundRequestTransaction,
  normalizeExternalRequest,
  publicRefund,
  toDomainEvent,
  withRefundRequestLock
};
