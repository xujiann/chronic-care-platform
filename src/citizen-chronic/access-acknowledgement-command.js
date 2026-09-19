"use strict";

const { randomUUID: createId } = require("node:crypto");
const { sha256, withStateCommandLock, prepareCollectionCas, isStorageConflict } = require("../platform/storage/state-command-consistency");

const SCHEMA = "resident-access-acknowledgement.v1";
const ACTION = "access-acknowledge";
const COLLECTION = "accessAcknowledgements";
const CAPACITY = 2000;
const REQUEST_FIELDS = ["id", "residentId", "accessLogId", "decision", "status", "acknowledgedAt", "idempotencyKey", "requestedAt"];
const RECEIPT_FIELDS = ["schemaVersion", "id", "residentId", "accessLogId", "resourceId", "decision", "status", "acknowledgedAt", "acceptedAt", "receiptId", "auditRef", "syncStatus"];

function fail(suffix, statusCode, message) {
  throw Object.assign(new Error(message), { code: `CARE_ACCESS_ACK_${suffix}`, statusCode });
}

function exactText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function isoTime(value) {
  if (!exactText(value, 60) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number(value.slice(11, 13)) < 24;
}

function receipt(row) {
  return Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, row[field]]));
}

function validStoredRows(rows) {
  if (!Array.isArray(rows)) return false;
  const seen = Object.fromEntries(["id", "receiptId", "auditRef", "idempotencyKeyHash", "resource"].map((field) => [field, new Set()]));
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || row.schemaVersion !== SCHEMA || row.decision !== "recognized" || row.status !== "accepted" || row.syncStatus !== "accepted"
      || !exactText(row.id, 220) || !exactText(row.residentId, 120) || !exactText(row.accessLogId, 160)
      || row.resourceId !== row.accessLogId || !exactText(row.actorId, 120)
      || !exactText(row.receiptId, 160) || !exactText(row.auditRef, 160)
      || !isoTime(row.acknowledgedAt) || !isoTime(row.acceptedAt)
      || typeof row.idempotencyKeyHash !== "string" || !/^[a-f0-9]{64}$/.test(row.idempotencyKeyHash)
      || typeof row.requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.requestDigest)) return false;
    for (const field of ["id", "receiptId", "auditRef", "idempotencyKeyHash", "resource"]) {
      const value = field === "resource" ? JSON.stringify([row.residentId, row.accessLogId]) : row[field];
      if (seen[field].has(value)) return false;
      seen[field].add(value);
    }
  }
  return true;
}

function createAccessAcknowledgementCommand({ readDatabase, writeDatabase, queryResidentAccessEvent, validateAuthorization, appendSecurityAudit, verifyAuditTrail, getRuntimePolicy, now = () => new Date(), randomUUID = createId } = {}) {
  for (const [name, port] of Object.entries({ readDatabase, writeDatabase, queryResidentAccessEvent, validateAuthorization, appendSecurityAudit, verifyAuditTrail, getRuntimePolicy, now, randomUUID })) {
    if (typeof port !== "function") throw new TypeError(`${name} port must be a function`);
  }

  function requireEnvironment() {
    const policy = getRuntimePolicy();
    if (policy?.production === true) fail("PRODUCTION_DISABLED", 503, "生产环境不允许此声明写入或重放");
    if (policy?.production !== false || !["json", "sqlite"].includes(policy.storageMode)) fail("STORAGE_UNSUPPORTED", 503, "当前环境不支持此声明命令");
  }

  return async function execute({ user, session, accessLogId, payload, idempotencyKey } = {}) {
    requireEnvironment();
    if (user?.role !== "citizen" || !exactText(user.id || user.username, 120) || !exactText(user.residentId, 120)) {
      fail("FORBIDDEN", 403, "仅居民本人可以提交访问知晓声明");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || Object.keys(payload).some((field) => !REQUEST_FIELDS.includes(field))
      || REQUEST_FIELDS.some((field) => !Object.hasOwn(payload, field))
      || !exactText(payload.id, 220) || !exactText(payload.residentId, 120) || !exactText(payload.accessLogId, 160)
      || !exactText(accessLogId, 160) || payload.accessLogId !== accessLogId
      || payload.decision !== "recognized" || payload.status !== "submitted"
      || !isoTime(payload.acknowledgedAt) || !isoTime(payload.requestedAt)
      || !exactText(payload.idempotencyKey, 240) || !exactText(idempotencyKey, 240)) {
      fail("INVALID", 400, "访问知晓声明请求格式无效");
    }
    if (payload.residentId !== user.residentId) fail("FORBIDDEN", 403, "仅居民本人可以提交访问知晓声明");
    if (idempotencyKey !== payload.idempotencyKey) fail("KEY_MISMATCH", 400, "请求头与请求体的幂等键必须完整一致");
    const actor = { id: user.id || user.username, residentId: user.residentId, role: user.role };
    const binding = { schemaVersion: SCHEMA, actor, action: ACTION };
    const keyHash = sha256({ ...binding, idempotencyKey });
    const canonicalPayload = Object.fromEntries(REQUEST_FIELDS.filter((field) => field !== "idempotencyKey").map((field) => [field, payload[field]]));
    const requestDigest = sha256({ ...binding, accessLogId, payload: canonicalPayload });

    return withStateCommandLock("citizen-chronic:accessAcknowledgements", async () => {
      requireEnvironment();
      let data;
      try { data = readDatabase(); } catch { fail("STORAGE_FAILED", 503, "声明存储读取失败"); }
      // Raw read and live authorization are synchronous within the collection lock.
      // Never trust the principal captured before the HTTP request body completed.
      try {
        if (!exactText(session?.sessionId, 128) || data?.then) throw new Error("synchronous session validation required");
        const validation = validateAuthorization({ data, user, session });
        if (validation === false || validation?.then) throw new Error("synchronous session validation required");
      } catch {
        fail("FORBIDDEN", 403, "当前会话或本人身份已失效");
      }
      let auditIntact = false;
      try { auditIntact = Array.isArray(data?.securityEvents) && verifyAuditTrail(data.securityEvents).passed === true; } catch { /* reject without resealing */ }
      if (!validStoredRows(data?.accessAcknowledgements) || !auditIntact) fail("STORED_STATE_INVALID", 409, "现有声明或审计无法验证，未修改历史记录");
      const source = queryResidentAccessEvent({ data, user, accessLogId });
      if (source?.schemaVersion !== "resident-access-event.v1" || source.residentId !== actor.residentId || source.accessLogId !== accessLogId) {
        fail("STORED_STATE_INVALID", 409, "访问事件核验未返回匹配的可信事实");
      }
      const existing = data.accessAcknowledgements.find((row) => row.idempotencyKeyHash === keyHash);
      if (existing) {
        if (existing.requestDigest !== requestDigest) fail("IDEMPOTENCY_CONFLICT", 409, "幂等键已绑定不同的声明请求");
        return { statusCode: 200, body: receipt(existing) };
      }
      if (data.accessAcknowledgements.some((row) => row.residentId === actor.residentId && row.accessLogId === accessLogId)) {
        fail("ALREADY_ACKNOWLEDGED", 409, "该访问事件已有本人知晓声明");
      }
      if (data.accessAcknowledgements.length >= CAPACITY) fail("CAPACITY", 409, "声明容量已满，历史记录不会被淘汰");
      try {
        const workingData = structuredClone(data);
        const at = now().toISOString();
        const row = {
          schemaVersion: SCHEMA, id: `access-ack-${randomUUID()}`, residentId: actor.residentId,
          accessLogId, resourceId: accessLogId, decision: "recognized", status: "accepted",
          acknowledgedAt: at, acceptedAt: at, receiptId: `care-receipt-${randomUUID()}`,
          auditRef: `care-audit-${randomUUID()}`, syncStatus: "accepted", actorId: actor.id,
          idempotencyKeyHash: keyHash, requestDigest
        };
        workingData.accessAcknowledgements.push(row);
        if (!validStoredRows(workingData.accessAcknowledgements)) fail("STORED_STATE_INVALID", 409, "声明回执身份无法唯一验证");
        prepareCollectionCas(workingData, [COLLECTION, "securityEvents"], COLLECTION, undefined, "CARE_ACCESS_ACK_STORAGE_CONFLICT");
        appendSecurityAudit(workingData, {
          id: row.auditRef, at, actor: actor.id, role: actor.role, action: "居民访问知晓声明",
          target: accessLogId, result: "允许", detail: "仅记录本人知晓，不改变原访问结果或授权"
        });
        if (!Array.isArray(workingData.securityEvents) || verifyAuditTrail(workingData.securityEvents).passed !== true
          || workingData.securityEvents.filter((event) => event.id === row.auditRef).length !== 1) {
          fail("STORED_STATE_INVALID", 409, "操作审计未形成有效回执");
        }
        await writeDatabase(workingData);
        return { statusCode: 201, body: receipt(row) };
      } catch (error) {
        if (error?.code?.startsWith("CARE_ACCESS_ACK_")) throw error;
        if (isStorageConflict(error)) fail("STORAGE_CONFLICT", 409, "声明存储版本冲突，请重新读取");
        fail("STORAGE_FAILED", 503, "声明提交失败，未返回成功回执");
      }
    });
  };
}

module.exports = { createAccessAcknowledgementCommand };
