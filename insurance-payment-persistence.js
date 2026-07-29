"use strict";

const { createHash, randomUUID } = require("node:crypto");

const PERSISTENCE_SCHEMA = "insurance-payment-persistence-v1";
const OUTBOX_SCHEMA = "insurance-payment-outbox-v1";
const DEFAULT_AGGREGATE_ID = "insurance-payment";
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 15 * 60_000;

class InsurancePaymentPersistenceError extends Error {
  constructor(message, code, status = 400, detail = {}) {
    super(message);
    this.name = "InsurancePaymentPersistenceError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function clone(value) {
  try {
    return structuredClone(value);
  } catch {
    throw new InsurancePaymentPersistenceError("医保支付持久化对象必须可结构化复制", "PERSISTENCE_VALUE_NOT_CLONEABLE");
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InsurancePaymentPersistenceError(`${label}必须是对象`, "PERSISTENCE_OBJECT_REQUIRED");
  }
  return value;
}

function safeId(value, label, maxLength = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength || !/^[A-Za-z0-9._:@/-]+$/.test(normalized)) {
    throw new InsurancePaymentPersistenceError(`${label}格式无效`, "PERSISTENCE_ID_INVALID");
  }
  return normalized;
}

function isoDate(value, label, fallback) {
  const candidate = value || fallback;
  if (!candidate || !Number.isFinite(Date.parse(candidate))) {
    throw new InsurancePaymentPersistenceError(`${label}时间无效`, "PERSISTENCE_TIME_INVALID");
  }
  return new Date(candidate).toISOString();
}

function stateDigest(state) {
  return `sha256:${sha256(stableStringify(requireObject(state, "业务状态")))}`;
}

function commandDigest(command = {}) {
  return `sha256:${sha256(stableStringify({
    commandType: String(command.commandType || "").trim(),
    payload: command.payload === undefined ? null : command.payload
  }))}`;
}

function eventDigest(event = {}) {
  const { digest: _digest, ...payload } = event;
  return `sha256:${sha256(stableStringify(payload))}`;
}

function normalizeExpectedVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new InsurancePaymentPersistenceError("expectedVersion 必须是非负安全整数", "PERSISTENCE_VERSION_INVALID");
  }
  return version;
}

function createInitialRecord(initialState, options = {}) {
  const state = clone(requireObject(initialState, "初始业务状态"));
  const aggregateId = safeId(options.aggregateId || DEFAULT_AGGREGATE_ID, "aggregateId");
  const now = isoDate(options.createdAt, "createdAt", new Date().toISOString());
  return {
    schema: PERSISTENCE_SCHEMA,
    aggregateId,
    version: 0,
    state,
    stateDigest: stateDigest(state),
    createdAt: now,
    updatedAt: now,
    commands: [],
    outbox: []
  };
}

function publicSnapshot(record) {
  return clone({
    schema: record.schema,
    aggregateId: record.aggregateId,
    version: record.version,
    state: record.state,
    stateDigest: record.stateDigest,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

function normalizeMutationResult(value, fallbackEventType) {
  if (value === undefined) return { result: null, nextState: null, eventType: fallbackEventType, eventPayload: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { result: value, nextState: null, eventType: fallbackEventType, eventPayload: {} };
  }
  const reserved = new Set(["result", "nextState", "eventType", "eventPayload"]);
  const usesEnvelope = Object.keys(value).some((key) => reserved.has(key));
  if (!usesEnvelope) return { result: value, nextState: null, eventType: fallbackEventType, eventPayload: {} };
  return {
    result: value.result === undefined ? null : value.result,
    nextState: value.nextState || null,
    eventType: value.eventType || fallbackEventType,
    eventPayload: value.eventPayload || {}
  };
}

function buildOutboxEvent(record, command, mutation, committedAt, options = {}) {
  const eventType = safeId(mutation.eventType || command.commandType, "eventType");
  const eventPayload = clone(requireObject(mutation.eventPayload || {}, "eventPayload"));
  const event = {
    schema: OUTBOX_SCHEMA,
    id: `ipe-${sha256(`${record.aggregateId}:${command.commandId}:${record.version}`).slice(0, 32)}`,
    aggregateId: record.aggregateId,
    aggregateVersion: record.version,
    commandId: command.commandId,
    commandType: command.commandType,
    eventType,
    occurredAt: committedAt,
    actor: command.actor,
    traceId: command.traceId,
    payload: eventPayload,
    status: "pending",
    attempts: 0,
    maxAttempts: options.maxAttempts,
    nextAttemptAt: committedAt,
    leaseOwner: "",
    leaseToken: "",
    leaseExpiresAt: "",
    publishedAt: "",
    deadLetteredAt: "",
    lastErrorCode: "",
    lastErrorDigest: ""
  };
  return { ...event, digest: eventDigest(event) };
}

function verifyOutboxEvent(item = {}) {
  if (!item || item.schema !== OUTBOX_SCHEMA) return false;
  if (!Number.isSafeInteger(item.aggregateVersion) || item.aggregateVersion < 1) return false;
  if (!new Set(["pending", "processing", "published", "dead-letter"]).has(item.status)) return false;
  if (!Number.isSafeInteger(item.maxAttempts) || item.maxAttempts < 1) return false;
  if (!Number.isSafeInteger(item.attempts) || item.attempts < 0 || item.attempts > item.maxAttempts) return false;
  if (item.status === "processing" && (!item.leaseOwner || !item.leaseToken || !Number.isFinite(Date.parse(item.leaseExpiresAt)))) return false;
  if (item.status === "published" && !Number.isFinite(Date.parse(item.publishedAt))) return false;
  if (item.status === "dead-letter" && !Number.isFinite(Date.parse(item.deadLetteredAt))) return false;
  return item.digest === eventDigest(item);
}

function verifyPersistenceRecord(record = {}) {
  if (!record || record.schema !== PERSISTENCE_SCHEMA) return false;
  if (!record.aggregateId || !Number.isSafeInteger(record.version) || record.version < 0) return false;
  if (!record.state || record.stateDigest !== stateDigest(record.state)) return false;
  if (!Array.isArray(record.commands) || !Array.isArray(record.outbox)) return false;
  if (!record.outbox.every(verifyOutboxEvent)) return false;
  const commandIds = new Set(record.commands.map((item) => item.commandId));
  const eventIds = new Set(record.outbox.map((item) => item.id));
  if (commandIds.size !== record.commands.length || eventIds.size !== record.outbox.length) return false;
  return record.commands.every((item) => /^sha256:[a-f0-9]{64}$/.test(item.commandDigest) && /^sha256:[a-f0-9]{64}$/.test(item.resultDigest));
}

function persistenceContract() {
  return Object.freeze({
    id: PERSISTENCE_SCHEMA,
    aggregate: DEFAULT_AGGREGATE_ID,
    consistency: "single-aggregate compare-and-swap transaction",
    requiredAdapterMethods: ["load", "transact", "claimOutbox", "acknowledgeOutbox", "failOutbox", "exportCheckpoint"],
    invariants: [
      "业务状态、命令回执和 outbox 事件必须在同一数据库事务提交",
      "expectedVersion 不匹配必须返回 PERSISTENCE_VERSION_CONFLICT，禁止静默覆盖",
      "commandId 与命令摘要共同去重；同键不同载荷必须返回 PERSISTENCE_COMMAND_CONFLICT",
      "outbox 采用租约和至少一次投递；消费者必须按 event.id 幂等",
      "发布确认必须校验 leaseOwner 与 leaseToken，避免过期工作者误确认",
      "达到最大重试次数后进入 dead-letter，必须由授权运维流程处置"
    ],
    productionBoundary: "内存仓储仅用于契约测试。生产适配器必须提供数据库行锁或等价 CAS、持久命令去重表和事务 outbox 表。"
  });
}

function createInMemoryInsurancePaymentRepository(initialState = {}, options = {}) {
  let record = createInitialRecord(initialState, options);
  let writeTail = Promise.resolve();
  const maxAttempts = Math.min(100, Math.max(1, Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  const retryBaseMs = Math.max(100, Number(options.retryBaseMs) || DEFAULT_RETRY_BASE_MS);
  const retryMaxMs = Math.max(retryBaseMs, Number(options.retryMaxMs) || DEFAULT_RETRY_MAX_MS);

  function exclusive(work) {
    const pending = writeTail.then(work, work);
    writeTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  function load() {
    return Promise.resolve(publicSnapshot(record));
  }

  function transact(commandInput = {}, mutator) {
    return exclusive(async () => {
      if (typeof mutator !== "function") {
        throw new InsurancePaymentPersistenceError("事务必须提供 mutator", "PERSISTENCE_MUTATOR_REQUIRED");
      }
      const command = {
        commandId: safeId(commandInput.commandId, "commandId"),
        commandType: safeId(commandInput.commandType, "commandType"),
        payload: clone(commandInput.payload === undefined ? null : commandInput.payload),
        expectedVersion: normalizeExpectedVersion(commandInput.expectedVersion),
        actor: String(commandInput.actor || "system").trim().slice(0, 160) || "system",
        traceId: safeId(commandInput.traceId || randomUUID(), "traceId")
      };
      command.commandDigest = commandDigest(command);
      const replay = record.commands.find((item) => item.commandId === command.commandId);
      if (replay) {
        if (replay.commandDigest !== command.commandDigest) {
          throw new InsurancePaymentPersistenceError("commandId 已被不同命令载荷使用", "PERSISTENCE_COMMAND_CONFLICT", 409, { commandId: command.commandId });
        }
        return clone({
          snapshot: publicSnapshot(record),
          result: replay.result,
          outboxEvent: record.outbox.find((item) => item.commandId === command.commandId),
          idempotentReplay: true
        });
      }
      if (command.expectedVersion !== record.version) {
        throw new InsurancePaymentPersistenceError("医保支付状态版本冲突", "PERSISTENCE_VERSION_CONFLICT", 409, {
          expectedVersion: command.expectedVersion,
          actualVersion: record.version
        });
      }

      const workingState = clone(record.state);
      const rawMutation = await mutator(workingState, clone(publicSnapshot(record)));
      const mutation = normalizeMutationResult(rawMutation, command.commandType);
      const committedState = clone(requireObject(mutation.nextState || workingState, "事务业务状态"));
      const result = clone(mutation.result);
      const committedAt = isoDate(commandInput.occurredAt, "occurredAt", new Date().toISOString());
      if (Date.parse(committedAt) < Date.parse(record.updatedAt)) {
        throw new InsurancePaymentPersistenceError("事务提交时间早于当前状态更新时间", "PERSISTENCE_TIME_REGRESSION", 409);
      }
      const nextRecord = clone(record);
      nextRecord.version += 1;
      nextRecord.state = committedState;
      nextRecord.stateDigest = stateDigest(committedState);
      nextRecord.updatedAt = committedAt;
      const outboxEvent = buildOutboxEvent(nextRecord, command, mutation, committedAt, { maxAttempts });
      nextRecord.commands.push({
        commandId: command.commandId,
        commandType: command.commandType,
        commandDigest: command.commandDigest,
        aggregateVersion: nextRecord.version,
        committedAt,
        result,
        resultDigest: `sha256:${sha256(stableStringify(result))}`
      });
      nextRecord.outbox.push(outboxEvent);
      if (!verifyPersistenceRecord(nextRecord)) {
        throw new InsurancePaymentPersistenceError("事务提交前完整性校验失败", "PERSISTENCE_INTEGRITY_FAILED", 500);
      }
      record = nextRecord;
      return clone({ snapshot: publicSnapshot(record), result, outboxEvent, idempotentReplay: false });
    });
  }

  function claimOutbox(input = {}) {
    return exclusive(() => {
      const workerId = safeId(input.workerId, "workerId");
      const now = isoDate(input.now, "now", new Date().toISOString());
      const nowMs = Date.parse(now);
      const limit = Math.min(100, Math.max(1, Number(input.limit) || 10));
      const leaseMs = Math.min(15 * 60_000, Math.max(1_000, Number(input.leaseMs) || DEFAULT_LEASE_MS));
      const nextRecord = clone(record);
      let changed = false;
      for (const item of nextRecord.outbox) {
        if (item.status === "processing" && Date.parse(item.leaseExpiresAt) <= nowMs) {
          item.status = item.attempts >= item.maxAttempts ? "dead-letter" : "pending";
          item.deadLetteredAt = item.status === "dead-letter" ? now : "";
          item.leaseOwner = "";
          item.leaseToken = "";
          item.leaseExpiresAt = "";
          item.digest = eventDigest(item);
          changed = true;
        }
      }
      const claimed = nextRecord.outbox
        .filter((item) => item.status === "pending" && Date.parse(item.nextAttemptAt) <= nowMs)
        .sort((a, b) => a.aggregateVersion - b.aggregateVersion || a.occurredAt.localeCompare(b.occurredAt))
        .slice(0, limit);
      for (const item of claimed) {
        item.status = "processing";
        item.attempts += 1;
        item.leaseOwner = workerId;
        item.leaseToken = randomUUID();
        item.leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
        item.digest = eventDigest(item);
        changed = true;
      }
      if (changed && !verifyPersistenceRecord(nextRecord)) {
        throw new InsurancePaymentPersistenceError("outbox 领取后完整性校验失败", "PERSISTENCE_INTEGRITY_FAILED", 500);
      }
      if (changed) record = nextRecord;
      return clone(claimed);
    });
  }

  function requireLease(sourceRecord, eventId, lease = {}) {
    const id = safeId(eventId, "eventId");
    const item = sourceRecord.outbox.find((row) => row.id === id);
    if (!item) throw new InsurancePaymentPersistenceError("outbox 事件不存在", "OUTBOX_EVENT_NOT_FOUND", 404);
    if (item.status === "published") return { item, replay: true };
    if (item.status !== "processing") throw new InsurancePaymentPersistenceError("outbox 事件未被领取", "OUTBOX_EVENT_NOT_CLAIMED", 409);
    if (item.leaseOwner !== safeId(lease.workerId, "workerId") || item.leaseToken !== safeId(lease.leaseToken, "leaseToken")) {
      throw new InsurancePaymentPersistenceError("outbox 租约不匹配", "OUTBOX_LEASE_CONFLICT", 409);
    }
    return { item, replay: false };
  }

  function acknowledgeOutbox(eventId, input = {}) {
    return exclusive(() => {
      const nextRecord = clone(record);
      const lease = requireLease(nextRecord, eventId, input);
      if (lease.replay) return clone({ event: lease.item, idempotentReplay: true });
      const publishedAt = isoDate(input.publishedAt, "publishedAt", new Date().toISOString());
      lease.item.status = "published";
      lease.item.publishedAt = publishedAt;
      lease.item.leaseOwner = "";
      lease.item.leaseToken = "";
      lease.item.leaseExpiresAt = "";
      lease.item.digest = eventDigest(lease.item);
      if (!verifyPersistenceRecord(nextRecord)) throw new InsurancePaymentPersistenceError("outbox 确认后完整性校验失败", "PERSISTENCE_INTEGRITY_FAILED", 500);
      record = nextRecord;
      return clone({ event: lease.item, idempotentReplay: false });
    });
  }

  function failOutbox(eventId, input = {}) {
    return exclusive(() => {
      const nextRecord = clone(record);
      const lease = requireLease(nextRecord, eventId, input);
      if (lease.replay) throw new InsurancePaymentPersistenceError("已发布事件不能标记失败", "OUTBOX_EVENT_ALREADY_PUBLISHED", 409);
      const failedAt = isoDate(input.failedAt, "failedAt", new Date().toISOString());
      const errorCode = String(input.errorCode || "DELIVERY_FAILED").trim().slice(0, 80) || "DELIVERY_FAILED";
      lease.item.lastErrorCode = errorCode;
      lease.item.lastErrorDigest = `sha256:${sha256(String(input.errorMessage || errorCode))}`;
      lease.item.leaseOwner = "";
      lease.item.leaseToken = "";
      lease.item.leaseExpiresAt = "";
      if (lease.item.attempts >= lease.item.maxAttempts) {
        lease.item.status = "dead-letter";
        lease.item.deadLetteredAt = failedAt;
      } else {
        const delayMs = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, lease.item.attempts - 1)));
        lease.item.status = "pending";
        lease.item.nextAttemptAt = new Date(Date.parse(failedAt) + delayMs).toISOString();
      }
      lease.item.digest = eventDigest(lease.item);
      if (!verifyPersistenceRecord(nextRecord)) throw new InsurancePaymentPersistenceError("outbox 失败处理后完整性校验失败", "PERSISTENCE_INTEGRITY_FAILED", 500);
      record = nextRecord;
      return clone(lease.item);
    });
  }

  function exportCheckpoint() {
    if (!verifyPersistenceRecord(record)) throw new InsurancePaymentPersistenceError("持久化检查点完整性校验失败", "PERSISTENCE_INTEGRITY_FAILED", 500);
    return Promise.resolve(clone(record));
  }

  function restoreCheckpoint(checkpoint) {
    return exclusive(() => {
      const candidate = clone(checkpoint);
      if (!verifyPersistenceRecord(candidate)) throw new InsurancePaymentPersistenceError("持久化检查点无效或已被篡改", "PERSISTENCE_CHECKPOINT_INVALID", 409);
      if (candidate.aggregateId !== record.aggregateId) throw new InsurancePaymentPersistenceError("持久化检查点聚合标识不匹配", "PERSISTENCE_AGGREGATE_CONFLICT", 409);
      if (candidate.version < record.version) throw new InsurancePaymentPersistenceError("禁止回退到较旧持久化检查点", "PERSISTENCE_CHECKPOINT_STALE", 409);
      record = candidate;
      return publicSnapshot(record);
    });
  }

  function outboxStatus() {
    const counts = { pending: 0, processing: 0, published: 0, "dead-letter": 0 };
    for (const item of record.outbox) counts[item.status] += 1;
    return Promise.resolve(clone({ total: record.outbox.length, counts, healthy: counts["dead-letter"] === 0 }));
  }

  return Object.freeze({
    contract: persistenceContract(),
    load,
    transact,
    claimOutbox,
    acknowledgeOutbox,
    failOutbox,
    exportCheckpoint,
    restoreCheckpoint,
    outboxStatus
  });
}

async function executeInsurancePaymentCommand(repository, command, mutator) {
  if (!repository || typeof repository.transact !== "function") {
    throw new InsurancePaymentPersistenceError("医保支付仓储未配置", "PERSISTENCE_REPOSITORY_REQUIRED", 503);
  }
  return repository.transact(command, mutator);
}

module.exports = {
  DEFAULT_AGGREGATE_ID,
  InsurancePaymentPersistenceError,
  OUTBOX_SCHEMA,
  PERSISTENCE_SCHEMA,
  commandDigest,
  createInMemoryInsurancePaymentRepository,
  eventDigest,
  executeInsurancePaymentCommand,
  persistenceContract,
  sha256,
  stableStringify,
  stateDigest,
  verifyOutboxEvent,
  verifyPersistenceRecord
};
