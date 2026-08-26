"use strict";

const { attachWorkerObservability } = require("./worker-observability-contract");
const { sha256 } = require("../storage/object-storage-durable");

const WORKER_CONTRACT = "object-storage-command-worker.v2";

function errorCode(error) {
  return String(error?.code || "OBJECT_STORAGE_PROVIDER_FAILED")
    .trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 120)
    || "OBJECT_STORAGE_PROVIDER_FAILED";
}

async function executeCommand(command, adapter) {
  const attachment = command.attachment;
  if (command.operation === "create-upload-intent") {
    const intent = await adapter.createObjectUploadIntent({
      attachmentId: attachment.id,
      namespace: command.payload.namespace || "clinical-records",
      filename: attachment.filename,
      contentType: attachment.contentType,
      sizeBytes: attachment.expectedSizeBytes,
      checksumSha256: attachment.expectedChecksumSha256,
      classification: attachment.classification,
      retentionPolicy: attachment.retentionPolicy,
      retentionYears: attachment.retentionYears,
      immutable: attachment.immutable
    }, { requestId: command.commandId });
    return Object.freeze({
      outcome: "accepted",
      result: {
        objectKey: intent.objectKey,
        uploadId: intent.uploadId,
        uploadUrl: intent.uploadUrl,
        expiresAt: intent.expiresAt,
        requiredChecksumSha256: attachment.expectedChecksumSha256,
        requiredContentType: attachment.contentType
      },
      resultExpiresAt: intent.expiresAt,
      receiptDigest: sha256({ operation: command.operation, requestId: intent.requestId || "", objectKey: intent.objectKey, expiresAt: intent.expiresAt })
    });
  }
  if (command.operation === "complete-upload") {
    const receipt = await adapter.finalizeObjectUpload({
      attachmentId: attachment.id,
      uploadId: command.payload.uploadId,
      objectKey: attachment.objectKey,
      expectedSizeBytes: attachment.expectedSizeBytes,
      expectedChecksumSha256: String(attachment.expectedChecksumSha256 || "").replace(/^sha256:/, "")
    }, { requestId: command.commandId });
    return Object.freeze({
      outcome: "completed",
      result: {
        scanStatus: receipt.scanStatus,
        scannedAt: receipt.scannedAt,
        checksumSha256: receipt.checksumSha256,
        sizeBytes: receipt.sizeBytes,
        objectVersion: receipt.objectVersion
      },
      receiptDigest: sha256({ operation: command.operation, requestId: receipt.requestId || "", objectVersion: receipt.objectVersion, scanStatus: receipt.scanStatus })
    });
  }
  if (command.operation === "create-download-intent") {
    const intent = await adapter.createObjectDownloadIntent({
      attachmentId: attachment.id,
      objectKey: attachment.objectKey,
      objectVersion: attachment.objectVersion
    }, { requestId: command.commandId });
    return Object.freeze({
      outcome: "accepted",
      result: {
        downloadUrl: intent.downloadUrl,
        expiresAt: intent.expiresAt,
        filename: attachment.filename
      },
      resultExpiresAt: intent.expiresAt,
      receiptDigest: sha256({ operation: command.operation, requestId: intent.requestId || "", objectVersion: attachment.objectVersion, expiresAt: intent.expiresAt })
    });
  }
  if (command.operation === "apply-lifecycle") {
    const receipt = await adapter.applyObjectLifecycle({
      attachmentId: attachment.id,
      objectKey: attachment.objectKey,
      objectVersion: attachment.objectVersion,
      action: command.payload.action,
      reason: command.payload.reason
    }, { requestId: command.commandId });
    return Object.freeze({
      outcome: "completed",
      result: {
        status: receipt.status,
        effectiveAt: receipt.effectiveAt,
        action: command.payload.action
      },
      receiptDigest: sha256({ operation: command.operation, requestId: receipt.requestId || "", action: command.payload.action, effectiveAt: receipt.effectiveAt })
    });
  }
  const error = new Error("unsupported object storage operation");
  error.code = "OBJECT_STORAGE_OPERATION_INVALID";
  throw error;
}

async function runObjectStorageCommandWorker(options = {}) {
  const repository = options.repository;
  const adapter = options.adapter;
  if (!repository || typeof repository.claimBatch !== "function") throw new TypeError("object storage repository is required");
  if (!adapter || ["createObjectUploadIntent", "finalizeObjectUpload", "createObjectDownloadIntent", "applyObjectLifecycle"]
    .some((name) => typeof adapter[name] !== "function")) throw new TypeError("object storage gateway adapter is required");
  const workerId = String(options.workerId || "").trim();
  if (!workerId) throw new TypeError("object storage worker id is required");
  const claims = repository.claimBatch({
    workerId,
    at: options.at,
    limit: options.limit,
    leaseSeconds: options.leaseSeconds
  });
  const outcomes = [];
  for (const command of claims) {
    const fence = {
      commandId: command.commandId,
      workerId,
      leaseToken: command.leaseToken,
      leaseVersion: command.leaseVersion
    };
    try {
      const result = await executeCommand(command, adapter);
      try {
        const delivered = repository.markDelivered({ ...fence, ...result, deliveredAt: options.completedAt });
        outcomes.push(Object.freeze({ commandId: command.commandId, status: delivered.command.status, attempts: delivered.command.attempts }));
      } catch (error) {
        outcomes.push(Object.freeze({
          commandId: command.commandId,
          status: "persistence-rejected",
          errorDigest: sha256(errorCode(error))
        }));
      }
    } catch (error) {
      try {
        const failed = repository.markFailed({
          ...fence,
          failedAt: options.completedAt,
          baseBackoffSeconds: options.baseBackoffSeconds,
          errorCode: errorCode(error)
        });
        outcomes.push(Object.freeze({ commandId: command.commandId, status: failed.command.status, attempts: failed.command.attempts, errorDigest: sha256(errorCode(error)) }));
      } catch (persistenceError) {
        outcomes.push(Object.freeze({ commandId: command.commandId, status: "persistence-rejected", errorDigest: sha256(errorCode(persistenceError)) }));
      }
    }
  }
  return attachWorkerObservability("object-storage-command-v2", {
    contract: WORKER_CONTRACT,
    workerIdDigest: sha256(workerId),
    claimed: claims.length,
    delivered: outcomes.filter((item) => item.status === "delivered").length,
    retryScheduled: outcomes.filter((item) => item.status === "pending").length,
    deadLettered: outcomes.filter((item) => item.status === "dead-letter").length,
    persistenceRejected: outcomes.filter((item) => item.status === "persistence-rejected").length,
    outcomes: Object.freeze(outcomes),
    health: repository.health(),
    requestPathExternalDispatch: false,
    productionReady: false
  }, { observedAt: options.completedAt || options.at || new Date().toISOString() });
}

function inspectObjectStorageWorkerReadiness(env = process.env, options = {}) {
  const checks = Object.freeze([
    Object.freeze({ id: "sqlite-v17", passed: options.sqliteHead === 17, detail: `schema head ${options.sqliteHead || "missing"}` }),
    Object.freeze({ id: "worker-identity", passed: Boolean(String(env.OBJECT_STORAGE_COMMAND_WORKER_ID || "").trim()), detail: "worker identity reference required" }),
    Object.freeze({ id: "cursor-signing", passed: String(env.OBJECT_STORAGE_CURSOR_SIGNING_SECRET || "").length >= 32, detail: "cursor signing secret reference required" }),
    Object.freeze({ id: "gateway-contract", passed: options.gatewayConfigured === true, detail: "v1 signed gateway contract required" }),
    Object.freeze({ id: "request-path-isolation", passed: true, detail: "v2 HTTP path only commits local commands" }),
    Object.freeze({ id: "provider-status-capability", passed: options.providerStatusCapabilityVerified === true, detail: "external signed status/capability evidence required" }),
    Object.freeze({ id: "site-evidence", passed: options.externalEvidenceVerified === true, detail: "release-bound site evidence required" })
  ]);
  return Object.freeze({
    contract: WORKER_CONTRACT,
    configured: checks.slice(0, 5).every((item) => item.passed),
    checks,
    productionReady: checks.every((item) => item.passed) && options.productionPromotionAllowed === true,
    boundary: "Repository and worker readiness do not replace provider KMS/WORM/scanning, backup, capacity, or site evidence."
  });
}

module.exports = {
  WORKER_CONTRACT,
  executeCommand,
  inspectObjectStorageWorkerReadiness,
  runObjectStorageCommandWorker
};
