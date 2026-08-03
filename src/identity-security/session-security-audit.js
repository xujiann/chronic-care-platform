"use strict";

const { createHash } = require("node:crypto");

const SESSION_SECURITY_AUDIT_CATEGORY = "session-security";
const SESSION_SECURITY_AUDIT_SCHEMA = "session-security-audit/v2";
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const transactionTails = new WeakMap();

const SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT = Object.freeze({
  productionReady: false,
  localGuarantee: "repository commands use single-process serialized read-copy-write with one persistence commit",
  limitation: "the JSON adapter cannot coordinate writers outside this repository or make a session-store action and audit write atomic across processes",
  requiredProductionAdapter: Object.freeze({
    systemOfRecord: "postgresql",
    transactionBoundary: "identity or session security mutation + audit event + idempotency receipt",
    concurrency: "compare-and-swap the audit stream version or lock the owned aggregate row",
    idempotency: "unique command_key_hash; equal intent_hash replays and unequal intent_hash returns HTTP 409",
    commit: "all records commit or roll back together; fallback writes are forbidden"
  })
});

class SessionSecurityAuditError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "SessionSecurityAuditError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function digest(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function intentDigest(value) {
  return digest(JSON.stringify(stableValue(value)));
}

function bounded(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function requestPath(req) {
  return String(req?.url || "").split("?")[0].slice(0, 200);
}

function resolveCorrelationId(req, randomUUID) {
  const candidate = String(req?.correlationId || "").trim();
  return CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

function requestFingerprint(req) {
  const remoteAddress = String(req?.socket?.remoteAddress || "");
  const userAgent = String(req?.headers?.["user-agent"] || "");
  if (!remoteAddress && !userAgent) return "";
  return digest(`${remoteAddress}\n${userAgent}`);
}

function sessionReference(session) {
  return session?.sessionId ? digest(session.sessionId) : "";
}

function commandKey(req, event, randomUUID, explicitCommandId) {
  const explicit = bounded(explicitCommandId, 200);
  if (explicit) return explicit;
  const correlationId = bounded(req?.correlationId, 128) || randomUUID();
  return `session-audit:${correlationId}:${bounded(event?.action, 80) || "operation"}:${bounded(event?.result, 40) || "recorded"}`;
}

function enqueueTransaction(writeDatabase, task) {
  const previous = transactionTails.get(writeDatabase) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  transactionTails.set(writeDatabase, current);
  return current.finally(() => {
    if (transactionTails.get(writeDatabase) === current) transactionTails.delete(writeDatabase);
  });
}

function cloneState(value) {
  return structuredClone(value && typeof value === "object" ? value : {});
}

function buildAuditEntry({ req, session, event, randomUUID, now, commandHash }) {
  return {
    id: randomUUID(),
    at: now().toISOString(),
    category: SESSION_SECURITY_AUDIT_CATEGORY,
    schemaVersion: SESSION_SECURITY_AUDIT_SCHEMA,
    correlationId: resolveCorrelationId(req, randomUUID),
    actor: bounded(event?.actor || "anonymous", 120),
    role: bounded(event?.role || "anonymous", 80),
    action: bounded(event?.action || "session-operation", 120),
    target: bounded(event?.target || "unified-auth", 160),
    result: bounded(event?.result || "recorded", 40),
    detail: bounded(event?.detail, 500),
    request: {
      method: bounded(String(req?.method || "GET").toUpperCase(), 12),
      path: requestPath(req)
    },
    clientFingerprint: requestFingerprint(req),
    sessionRef: sessionReference(session),
    commandRef: commandHash
  };
}

function findCommandReceipt(data, commandHash) {
  return (Array.isArray(data.securityEvents) ? data.securityEvents : [])
    .find((item) => item?.category === SESSION_SECURITY_AUDIT_CATEGORY && item?.commandRef === commandHash);
}

function nextStreamVersion(data) {
  return (Array.isArray(data.securityEvents) ? data.securityEvents : []).reduce(
    (maximum, item) => Math.max(maximum, Number(item?.streamVersion || 0)),
    0
  ) + 1;
}

class SessionSecurityAuditRepository {
  constructor({
    readDatabase,
    writeDatabase,
    prependAuditTrailEntry,
    randomUUID,
    now = () => new Date()
  }) {
    if (typeof readDatabase !== "function" || typeof writeDatabase !== "function") {
      throw new TypeError("session security audit repository requires database read and write capabilities");
    }
    if (typeof prependAuditTrailEntry !== "function" || typeof randomUUID !== "function") {
      throw new TypeError("session security audit repository requires audit-chain and identifier capabilities");
    }
    this.readDatabase = readDatabase;
    this.writeDatabase = writeDatabase;
    this.prependAuditTrailEntry = prependAuditTrailEntry;
    this.randomUUID = randomUUID;
    this.now = now;
  }

  unitOfWork({
    commandId,
    intent,
    req,
    session,
    event,
    legacyEvent,
    mutate = () => undefined
  }) {
    const normalizedCommandId = bounded(commandId, 200);
    if (normalizedCommandId.length < 8) {
      throw new SessionSecurityAuditError(
        "SESSION_SECURITY_AUDIT_COMMAND_ID_REQUIRED",
        "Idempotency-Key or an equivalent command id of at least 8 characters is required"
      );
    }
    const commandHash = digest(normalizedCommandId);
    const payloadHash = intentDigest(intent);

    return enqueueTransaction(this.writeDatabase, async () => {
      const working = cloneState(await this.readDatabase());
      const existing = findCommandReceipt(working, commandHash);
      if (existing) {
        if (existing.intentRef !== payloadHash) {
          throw new SessionSecurityAuditError(
            "SESSION_SECURITY_AUDIT_IDEMPOTENCY_CONFLICT",
            "command id was already used for a different security intent",
            409
          );
        }
        return {
          entry: cloneState(existing),
          result: cloneState(existing.resultSnapshot),
          idempotentReplay: true,
          streamVersion: Number(existing.streamVersion || 0)
        };
      }

      const result = await mutate(working);
      const entry = buildAuditEntry({
        req,
        session,
        event,
        randomUUID: this.randomUUID,
        now: this.now,
        commandHash
      });
      const streamVersion = nextStreamVersion(working);
      entry.intentRef = payloadHash;
      entry.resultSnapshot = cloneState(result);
      entry.streamVersion = streamVersion;
      if (legacyEvent) {
        working.securityEvents = this.prependAuditTrailEntry(working.securityEvents, {
          id: this.randomUUID(),
          at: this.now().toISOString(),
          actor: bounded(legacyEvent.actor, 120),
          role: bounded(legacyEvent.role, 80),
          action: bounded(legacyEvent.action, 120),
          target: bounded(legacyEvent.target, 160),
          result: bounded(legacyEvent.result, 40),
          detail: bounded(legacyEvent.detail, 500),
          correlationId: entry.correlationId
        });
      }
      working.securityEvents = this.prependAuditTrailEntry(working.securityEvents, entry);
      await this.writeDatabase(working);
      return {
        entry: cloneState(entry),
        result: cloneState(result),
        idempotentReplay: false,
        streamVersion
      };
    });
  }

  execute(command) {
    return this.unitOfWork(command);
  }
}

function createSessionSecurityAuditRepository(options) {
  return new SessionSecurityAuditRepository(options);
}

async function appendSessionSecurityAudit({
  req,
  session,
  event,
  legacyEvent,
  commandId,
  readDatabase,
  writeDatabase,
  prependAuditTrailEntry,
  randomUUID,
  now = () => new Date(),
  repository
}) {
  const auditRepository = repository || createSessionSecurityAuditRepository({
    readDatabase,
    writeDatabase,
    prependAuditTrailEntry,
    randomUUID,
    now
  });
  const resolvedCommandId = commandKey(req, event, randomUUID, commandId);
  const response = await auditRepository.unitOfWork({
    commandId: resolvedCommandId,
    intent: {
      type: "session-security-audit",
      actor: bounded(event?.actor || "anonymous", 120),
      role: bounded(event?.role || "anonymous", 80),
      action: bounded(event?.action || "session-operation", 120),
      target: bounded(event?.target || "unified-auth", 160),
      result: bounded(event?.result || "recorded", 40),
      detail: bounded(event?.detail, 500),
      legacyEvent: legacyEvent ? stableValue(legacyEvent) : null,
      requestMethod: bounded(String(req?.method || "GET").toUpperCase(), 12),
      requestPath: requestPath(req),
      sessionRef: sessionReference(session),
      clientFingerprint: requestFingerprint(req)
    },
    req,
    session,
    event,
    legacyEvent
  });
  return response.entry;
}

async function executeSecurityControlAction({
  repository,
  commandId,
  req,
  user,
  controlId,
  payload
}) {
  if (!(repository instanceof SessionSecurityAuditRepository)) {
    throw new TypeError("security control action requires the identity-security audit repository");
  }
  const id = bounded(controlId, 200);
  const normalizedPayload = {
    status: bounded(payload?.status, 160),
    evidence: bounded(payload?.evidence, 500),
    next: bounded(payload?.next, 500),
    action: bounded(payload?.action || "update-evidence", 120)
  };
  return repository.unitOfWork({
    commandId,
    intent: {
      type: "security-control-action",
      controlId: id,
      actor: bounded(user?.username || user?.role, 120),
      payload: normalizedPayload
    },
    req,
    event: {
      actor: user?.name,
      role: user?.role,
      action: "security-control-action",
      target: id,
      result: "allowed",
      detail: normalizedPayload.status || "security control evidence updated"
    },
    mutate(data) {
      const index = (Array.isArray(data.securityAcceptanceLedger) ? data.securityAcceptanceLedger : [])
        .findIndex((item) => item?.id === id);
      if (index < 0) {
        throw new SessionSecurityAuditError(
          "SECURITY_CONTROL_NOT_FOUND",
          "security compliance control was not found",
          404
        );
      }
      const current = data.securityAcceptanceLedger[index];
      const updated = {
        ...current,
        status: normalizedPayload.status || current.status || "",
        evidence: normalizedPayload.evidence || current.evidence || "",
        next: normalizedPayload.next || current.next || "",
        lastAction: normalizedPayload.action,
        updatedAt: repository.now().toISOString(),
        updatedBy: bounded(user?.username || user?.role, 120)
      };
      data.securityAcceptanceLedger[index] = updated;
      return updated;
    }
  });
}

function projectSessionSecurityAudit(item) {
  return {
    id: bounded(item?.id, 160),
    at: bounded(item?.at, 80),
    category: SESSION_SECURITY_AUDIT_CATEGORY,
    schemaVersion: bounded(item?.schemaVersion, 80),
    correlationId: bounded(item?.correlationId, 128),
    actor: bounded(item?.actor, 120),
    role: bounded(item?.role, 80),
    action: bounded(item?.action, 120),
    target: bounded(item?.target, 160),
    result: bounded(item?.result, 40),
    detail: bounded(item?.detail, 500),
    request: {
      method: bounded(item?.request?.method, 12),
      path: String(item?.request?.path || "").split("?")[0].slice(0, 200)
    }
  };
}

function normalizeSessionSecurityAuditQuery({
  correlationId = "",
  action = "",
  result = "",
  limit = 50
} = {}) {
  return {
    correlationId: bounded(correlationId, 128),
    action: bounded(action, 120),
    result: bounded(result, 40),
    limit: Math.max(1, Math.min(100, Number(limit) || 50))
  };
}

function querySessionSecurityAudits(rows, options = {}) {
  const query = normalizeSessionSecurityAuditQuery(options);
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => item?.category === SESSION_SECURITY_AUDIT_CATEGORY)
    .filter((item) => !query.correlationId || item.correlationId === query.correlationId)
    .filter((item) => !query.action || item.action === query.action)
    .filter((item) => !query.result || item.result === query.result)
    .slice(0, query.limit)
    .map(projectSessionSecurityAudit);
}

function summarizeSessionSecurityAudits(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return {
    total: items.length,
    allowed: items.filter((item) => item.result === "allowed").length,
    denied: items.filter((item) => item.result === "denied").length,
    partial: items.filter((item) => item.result === "partial").length,
    correlations: new Set(items.map((item) => item.correlationId).filter(Boolean)).size
  };
}

module.exports = {
  SESSION_SECURITY_AUDIT_CATEGORY,
  SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT,
  SessionSecurityAuditError,
  SessionSecurityAuditRepository,
  appendSessionSecurityAudit,
  createSessionSecurityAuditRepository,
  executeSecurityControlAction,
  normalizeSessionSecurityAuditQuery,
  projectSessionSecurityAudit,
  querySessionSecurityAudits,
  summarizeSessionSecurityAudits
};
