"use strict";

const { ObjectStorageDurableError, sha256 } = require("../../../platform/storage/object-storage-durable");

const CONTRACT = "object-storage-async-api.v2";

function publicAttachment(attachment = {}) {
  const { objectKey, ...safe } = attachment;
  return Object.freeze({ ...safe, objectKeyPresent: Boolean(objectKey), productionReady: false });
}

function publicCommand(command = {}, now = new Date()) {
  const resultExpired = command.resultExpiresAt && Date.parse(command.resultExpiresAt) <= now.getTime();
  const { objectKey: _objectKey, ...publicResult } = command.result && typeof command.result === "object"
    ? command.result
    : {};
  return Object.freeze({
    contract: CONTRACT,
    commandId: command.commandId,
    attachmentId: command.attachmentId,
    operation: command.operation,
    status: command.status,
    attempts: command.attempts,
    nextAttemptAt: command.nextAttemptAt,
    result: resultExpired || !command.result ? null : publicResult,
    resultExpiresAt: resultExpired ? "" : command.resultExpiresAt,
    lastErrorCode: command.lastErrorCode,
    deadLetteredAt: command.deadLetteredAt,
    replayCount: command.replayCount,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
    productionReady: false
  });
}

function actorId(user = {}) {
  return String(user.username || user.accountId || user.name || user.role || "").trim();
}

function actorScope(user = {}) {
  return `${user.role}:${user.orgCode || user.residentId || actorId(user)}`;
}

function decodePathIdentifier(value) {
  try {
    const decoded = decodeURIComponent(String(value || ""));
    if (!decoded || decoded.includes("/") || /[\r\n\t]/.test(decoded)) throw new Error("invalid identifier");
    return decoded;
  } catch {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_PATH_ID_INVALID", "object storage path identifier is invalid", 400);
  }
}

function repositoryScope(user, data, canAccessResident) {
  if (user.role === "commission") return Object.freeze({ role: "commission" });
  if (user.role === "institution") return Object.freeze({ role: "institution", orgCode: String(user.orgCode || "").trim() });
  const residentIds = (Array.isArray(data.residents) ? data.residents : [])
    .filter((resident) => canAccessResident(user, resident.id, data))
    .map((resident) => resident.id);
  return Object.freeze({ role: "citizen", residentIds });
}

function sendError(res, sendJson, error) {
  const known = error instanceof ObjectStorageDurableError;
  sendJson(res, known ? error.statusCode : 503, {
    ok: false,
    code: known ? error.code : "OBJECT_STORAGE_V2_UNAVAILABLE",
    message: known ? error.message : "object storage v2 is unavailable",
    productionReady: false
  });
}

function createHandler(runtime) {
  const {
    canAccessResident,
    canAccessSecureAttachment,
    collectJson,
    randomUUID,
    readDatabase,
    requireApiRole,
    sendJson,
    validateAttachmentMetadata,
    withObjectStorageDurableRepository
  } = runtime;
  return async function handleObjectStorageV2(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/attachments/v2") {
      const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/attachments/v2");
      if (!user) return true;
      const data = readDatabase();
      try {
        const page = withObjectStorageDurableRepository((repository) => repository.listAttachments({
          scope: repositoryScope(user, data, canAccessResident),
          cursor: String(url.searchParams.get("cursor") || ""),
          limit: Number(url.searchParams.get("limit") || 50)
        }));
        sendJson(res, 200, {
          contract: CONTRACT,
          attachments: page.items.map(publicAttachment),
          nextCursor: page.nextCursor,
          highWaterMark: page.highWaterMark,
          productionReady: false
        });
      } catch (error) { sendError(res, sendJson, error); }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/attachments/v2/upload-intents") {
      const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/attachments/v2/upload-intents");
      if (!user) return true;
      const payload = await collectJson(req);
      const data = readDatabase();
      const residentId = String(payload.residentId || user.residentId || "").trim();
      if (residentId && !(data.residents || []).some((item) => item.id === residentId)) {
        sendJson(res, 404, { ok: false, code: "OBJECT_STORAGE_RESIDENT_NOT_FOUND", message: "resident was not found" });
        return true;
      }
      if (residentId && !canAccessResident(user, residentId, data)) {
        sendJson(res, 403, { ok: false, code: "OBJECT_STORAGE_RESIDENT_SCOPE_DENIED", message: "resident scope denied" });
        return true;
      }
      let metadata;
      try { metadata = validateAttachmentMetadata(payload); } catch (error) {
        sendJson(res, 400, { ok: false, code: "OBJECT_STORAGE_ATTACHMENT_INVALID", message: error.message });
        return true;
      }
      const key = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
      if (!key) {
        sendJson(res, 400, { ok: false, code: "OBJECT_STORAGE_IDEMPOTENCY_KEY_REQUIRED", message: "Idempotency-Key is required" });
        return true;
      }
      const stableKeyDigest = sha256({ scope: actorScope(user), key });
      const attachmentId = `att-v2-${stableKeyDigest.slice(0, 32)}`;
      const commandId = `objcmd-v2-${stableKeyDigest.slice(0, 32)}`;
      const now = new Date().toISOString();
      try {
        const result = withObjectStorageDurableRepository((repository) => repository.createUploadCommand({
          commandId,
          attachmentId,
          idempotencyKey: key,
          scope: actorScope(user),
          actorId: actorId(user),
          actorRole: user.role,
          orgCode: user.orgCode || "",
          createdAt: now,
          attachment: {
            id: attachmentId,
            residentId,
            sourceCollection: String(payload.sourceCollection || "").trim(),
            sourceId: String(payload.sourceId || "").trim(),
            filename: metadata.filename,
            contentType: metadata.contentType,
            expectedSizeBytes: metadata.sizeBytes,
            expectedChecksumSha256: `sha256:${metadata.checksumSha256}`,
            classification: metadata.classification,
            retentionPolicy: metadata.retentionPolicy,
            retentionYears: metadata.retentionYears,
            immutable: metadata.immutable,
            legalHold: false,
            createdBy: actorId(user),
            createdByRole: user.role,
            createdByOrgCode: user.orgCode || "",
            status: "pending",
            scanStatus: "pending",
            createdAt: now,
            updatedAt: now
          },
          payload: { namespace: String(payload.namespace || (residentId ? "clinical-records" : "platform-evidence")) }
        }));
        sendJson(res, result.idempotent ? 200 : 202, {
          contract: CONTRACT,
          commandId: result.command.commandId,
          statusUrl: `/api/attachments/v2/commands/${encodeURIComponent(result.command.commandId)}`,
          attachment: publicAttachment(result.attachment),
          idempotentReplay: result.idempotent,
          productionReady: false
        });
      } catch (error) { sendError(res, sendJson, error); }
      return true;
    }

    const statusMatch = url.pathname.match(/^\/api\/attachments\/v2\/commands\/([^/]+)$/);
    if (req.method === "GET" && statusMatch) {
      const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/attachments/v2/commands/:id");
      if (!user) return true;
      const data = readDatabase();
      try {
        const result = withObjectStorageDurableRepository((repository) => repository.getCommand(decodePathIdentifier(statusMatch[1])));
        if (!result) {
          sendJson(res, 404, { ok: false, code: "OBJECT_STORAGE_COMMAND_NOT_FOUND", message: "command was not found" });
        } else if (!canAccessSecureAttachment(user, result.attachment, data)) {
          sendJson(res, 403, { ok: false, code: "OBJECT_STORAGE_COMMAND_SCOPE_DENIED", message: "command scope denied" });
        } else {
          sendJson(res, 200, { command: publicCommand(result.command), attachment: publicAttachment(result.attachment) });
        }
      } catch (error) { sendError(res, sendJson, error); }
      return true;
    }

    const replayMatch = url.pathname.match(/^\/api\/attachments\/v2\/commands\/([^/]+)\/replay$/);
    if (req.method === "POST" && replayMatch) {
      const user = requireApiRole(req, res, ["commission"], "/api/attachments/v2/commands/:id/replay");
      if (!user) return true;
      const payload = await collectJson(req);
      const key = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
      const reason = String(payload.reason || "").trim();
      if (!key || reason.length < 2) {
        sendJson(res, 400, { ok: false, code: "OBJECT_STORAGE_REPLAY_INPUT_INVALID", message: "Idempotency-Key and reason are required" });
        return true;
      }
      try {
        const result = withObjectStorageDurableRepository((repository) => repository.replayDeadLetter({
          commandId: decodePathIdentifier(replayMatch[1]),
          replayKeyDigest: sha256({ scope: actorScope(user), key }),
          actorDigest: sha256(actorId(user)),
          reasonDigest: sha256(reason)
        }));
        sendJson(res, 202, { command: publicCommand(result.command), idempotentReplay: result.idempotent, productionReady: false });
      } catch (error) { sendError(res, sendJson, error); }
      return true;
    }

    const completeMatch = url.pathname.match(/^\/api\/attachments\/v2\/([^/]+)\/complete$/);
    const downloadMatch = url.pathname.match(/^\/api\/attachments\/v2\/([^/]+)\/download-intents$/);
    const lifecycleMatch = url.pathname.match(/^\/api\/attachments\/v2\/([^/]+)\/actions$/);
    if (req.method === "POST" && (completeMatch || downloadMatch || lifecycleMatch)) {
      const route = completeMatch ? "/api/attachments/v2/:id/complete" : downloadMatch
        ? "/api/attachments/v2/:id/download-intents" : "/api/attachments/v2/:id/actions";
      const user = requireApiRole(req, res, lifecycleMatch ? ["commission", "institution"] : ["commission", "institution", "citizen"], route);
      if (!user) return true;
      const payload = await collectJson(req);
      const data = readDatabase();
      const key = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
      if (!key) {
        sendJson(res, 400, { ok: false, code: "OBJECT_STORAGE_IDEMPOTENCY_KEY_REQUIRED", message: "Idempotency-Key is required" });
        return true;
      }
      try {
        const attachmentId = decodePathIdentifier((completeMatch || downloadMatch || lifecycleMatch)[1]);
        const result = withObjectStorageDurableRepository((repository) => {
          const attachment = repository.getAttachment(attachmentId);
          if (!attachment) throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_NOT_FOUND", "attachment was not found", 404);
          if (!canAccessSecureAttachment(user, attachment, data)) throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_SCOPE_DENIED", "attachment scope denied", 403);
          let operation;
          let commandPayload;
          let expectedAttachmentStatus = "";
          let expectedAttachmentScanStatus = "";
          if (completeMatch) {
            operation = "complete-upload";
            expectedAttachmentStatus = "upload-authorized";
            commandPayload = { uploadId: String(payload.uploadId || "").trim() };
            if (!commandPayload.uploadId) throw new ObjectStorageDurableError("OBJECT_STORAGE_UPLOAD_ID_REQUIRED", "uploadId is required", 400);
          } else if (downloadMatch) {
            operation = "create-download-intent";
            expectedAttachmentStatus = "active";
            expectedAttachmentScanStatus = "clean";
            commandPayload = {};
          } else {
            const action = String(payload.action || "").trim().toLowerCase();
            const reason = String(payload.reason || "").trim();
            if (!new Set(["quarantine", "legal-hold", "release-hold", "delete"]).has(action) || reason.length < 2) {
              throw new ObjectStorageDurableError("OBJECT_STORAGE_LIFECYCLE_INPUT_INVALID", "lifecycle action and reason are invalid", 400);
            }
            if (["legal-hold", "release-hold", "delete"].includes(action) && user.role !== "commission") {
              throw new ObjectStorageDurableError("OBJECT_STORAGE_LIFECYCLE_SCOPE_DENIED", "lifecycle action scope denied", 403);
            }
            operation = "apply-lifecycle";
            commandPayload = { action, reason: reason.slice(0, 200) };
          }
          return repository.enqueueCommand({
            commandId: `objcmd-${randomUUID()}`,
            attachmentId,
            operation,
            idempotencyKey: key,
            scope: actorScope(user),
            actorId: actorId(user),
            expectedAttachmentVersion: attachment.version,
            expectedAttachmentStatus,
            expectedAttachmentScanStatus,
            payload: commandPayload
          });
        });
        sendJson(res, result.idempotent ? 200 : 202, {
          contract: CONTRACT,
          commandId: result.command.commandId,
          statusUrl: `/api/attachments/v2/commands/${encodeURIComponent(result.command.commandId)}`,
          idempotentReplay: result.idempotent,
          productionReady: false
        });
      } catch (error) { sendError(res, sendJson, error); }
      return true;
    }
    return false;
  };
}

module.exports = { CONTRACT, createHandler, publicAttachment, publicCommand };
