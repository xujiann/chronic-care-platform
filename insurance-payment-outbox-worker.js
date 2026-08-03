"use strict";

const Persistence = require("./insurance-payment-persistence");

const DEFAULT_PUBLISH_TIMEOUT_MS = 10_000;

class InsurancePaymentOutboxWorkerError extends Error {
  constructor(message, code, status = 500) {
    super(message);
    this.name = "InsurancePaymentOutboxWorkerError";
    this.code = code;
    this.status = status;
  }
}

function safeWorkerError(error, fallback = "OUTBOX_PUBLISH_FAILED") {
  const code = /^[A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? String(error.code) : fallback;
  return {
    code,
    digest: `sha256:${Persistence.sha256(String(error?.message || code))}`
  };
}

function requireRepository(repository) {
  const methods = ["claimOutbox", "acknowledgeOutbox", "failOutbox", "outboxStatus"];
  if (!repository || methods.some((method) => typeof repository[method] !== "function")) {
    throw new InsurancePaymentOutboxWorkerError("医保支付 outbox 仓储未配置", "OUTBOX_REPOSITORY_REQUIRED", 503);
  }
  return repository;
}

function normalizePublishReceipt(value) {
  if (!value || typeof value !== "object" || value.accepted !== true) {
    throw new InsurancePaymentOutboxWorkerError("事件发布方未返回 accepted=true", "OUTBOX_PUBLISH_NOT_ACCEPTED", 502);
  }
  const receiptId = String(value.receiptId || value.messageId || "").trim();
  if (!receiptId || receiptId.length > 240 || /[\r\n]/.test(receiptId)) {
    throw new InsurancePaymentOutboxWorkerError("事件发布回执编号无效", "OUTBOX_PUBLISH_RECEIPT_INVALID", 502);
  }
  const publishedAt = value.publishedAt && Number.isFinite(Date.parse(value.publishedAt))
    ? new Date(value.publishedAt).toISOString()
    : "";
  return {
    receiptDigest: `sha256:${Persistence.sha256(receiptId)}`,
    duplicate: value.duplicate === true,
    publishedAt
  };
}

async function publishWithTimeout(publisher, event, context, timeoutMs) {
  if (typeof publisher !== "function") throw new InsurancePaymentOutboxWorkerError("医保支付事件发布器未配置", "OUTBOX_PUBLISHER_REQUIRED", 503);
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => publisher(Persistence.clone(event), { ...context, signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new InsurancePaymentOutboxWorkerError("医保支付事件发布超时", "OUTBOX_PUBLISH_TIMEOUT", 504));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildOutboxHealth(status = {}, options = {}) {
  const counts = {
    pending: Number(status.counts?.pending || 0),
    processing: Number(status.counts?.processing || 0),
    published: Number(status.counts?.published || 0),
    "dead-letter": Number(status.counts?.["dead-letter"] || 0)
  };
  const pendingWarning = Math.max(1, Number(options.pendingWarning) || 100);
  const processingWarning = Math.max(1, Number(options.processingWarning) || 50);
  const checks = [
    { id: "dead-letter-empty", passed: counts["dead-letter"] === 0, severity: "critical" },
    { id: "pending-backlog-bounded", passed: counts.pending < pendingWarning, severity: "warning" },
    { id: "processing-backlog-bounded", passed: counts.processing < processingWarning, severity: "warning" }
  ];
  const critical = checks.some((item) => item.severity === "critical" && !item.passed);
  const warning = checks.some((item) => item.severity === "warning" && !item.passed);
  return {
    status: critical ? "critical" : warning ? "warning" : "healthy",
    healthy: !critical,
    counts,
    checks,
    payloadsExposed: false
  };
}

async function runInsurancePaymentOutboxBatch(repositoryInput, publisher, options = {}) {
  const repository = requireRepository(repositoryInput);
  const workerId = Persistence.safeId(options.workerId, "workerId");
  const startedAt = Persistence.isoDate(options.startedAt, "startedAt", new Date().toISOString());
  const publishTimeoutMs = Math.min(120_000, Math.max(10, Number(options.publishTimeoutMs) || DEFAULT_PUBLISH_TIMEOUT_MS));
  const claimed = await repository.claimOutbox({
    workerId,
    now: options.claimAt || startedAt,
    limit: options.limit,
    leaseMs: options.leaseMs
  });
  const outcomes = [];
  for (const event of claimed) {
    let receipt;
    try {
      const rawReceipt = await publishWithTimeout(publisher, event, { workerId }, publishTimeoutMs);
      receipt = normalizePublishReceipt(rawReceipt);
    } catch (error) {
      const failure = safeWorkerError(error);
      try {
        const failed = await repository.failOutbox(event.id, {
          workerId,
          leaseToken: event.leaseToken,
          failedAt: options.now ? options.now() : new Date().toISOString(),
          errorCode: failure.code,
          errorMessage: error?.message || failure.code
        });
        outcomes.push({
          eventId: event.id,
          eventType: event.eventType,
          aggregateVersion: event.aggregateVersion,
          status: failed.status,
          attempts: failed.attempts,
          errorCode: failure.code,
          errorDigest: failure.digest
        });
      } catch (persistenceFailure) {
        const storedFailure = safeWorkerError(persistenceFailure, "OUTBOX_FAILURE_RECORD_FAILED");
        outcomes.push({
          eventId: event.id,
          eventType: event.eventType,
          aggregateVersion: event.aggregateVersion,
          status: "failure-record-unknown",
          attempts: event.attempts,
          errorCode: storedFailure.code,
          errorDigest: storedFailure.digest
        });
      }
      continue;
    }

    try {
      const acknowledged = await repository.acknowledgeOutbox(event.id, {
        workerId,
        leaseToken: event.leaseToken,
        publishedAt: receipt.publishedAt || (options.now ? options.now() : new Date().toISOString())
      });
      outcomes.push({
        eventId: event.id,
        eventType: event.eventType,
        aggregateVersion: event.aggregateVersion,
        status: "published",
        attempts: acknowledged.event.attempts,
        receiptDigest: receipt.receiptDigest,
        publisherDuplicate: receipt.duplicate,
        acknowledgementReplay: acknowledged.idempotentReplay === true
      });
    } catch (error) {
      const failure = safeWorkerError(error, "OUTBOX_ACKNOWLEDGEMENT_FAILED");
      outcomes.push({
        eventId: event.id,
        eventType: event.eventType,
        aggregateVersion: event.aggregateVersion,
        status: "published-acknowledgement-pending",
        attempts: event.attempts,
        receiptDigest: receipt.receiptDigest,
        publisherDuplicate: receipt.duplicate,
        errorCode: failure.code,
        errorDigest: failure.digest
      });
    }
  }
  const status = await repository.outboxStatus();
  const health = buildOutboxHealth(status, options.healthThresholds);
  return {
    schema: "insurance-payment-outbox-batch-v1",
    workerId,
    startedAt,
    finishedAt: Persistence.isoDate(options.finishedAt, "finishedAt", new Date().toISOString()),
    claimed: claimed.length,
    published: outcomes.filter((item) => item.status === "published").length,
    failed: outcomes.filter((item) => ["pending", "dead-letter", "failure-record-unknown"].includes(item.status)).length,
    acknowledgementPending: outcomes.filter((item) => item.status === "published-acknowledgement-pending").length,
    outcomes,
    health,
    payloadsExposed: false,
    credentialsPersisted: false,
    deliveryGuarantee: "at-least-once; consumers must deduplicate by eventId"
  };
}

module.exports = {
  DEFAULT_PUBLISH_TIMEOUT_MS,
  InsurancePaymentOutboxWorkerError,
  buildOutboxHealth,
  normalizePublishReceipt,
  publishWithTimeout,
  runInsurancePaymentOutboxBatch,
  safeWorkerError
};
