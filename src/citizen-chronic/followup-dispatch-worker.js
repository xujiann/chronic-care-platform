"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  assertVerifiedFollowupEventPublisherReceipt,
  createFollowupEventPublisher
} = require("./followup-event-publisher");
const { sha256, stableStringify } = require("./followup-dispatch-outbox");
const { attachWorkerObservability } = require("../platform/operations/worker-observability-contract");

const WORKER_CONTRACT = "citizen-chronic.followup-dispatch-worker.v1";

function isProduction(env = {}) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function canonicalPath(value) {
  const absolute = path.resolve(String(value || ""));
  if (fs.existsSync(absolute)) return fs.realpathSync.native(absolute);
  const parent = path.dirname(absolute);
  const canonicalParent = fs.existsSync(parent) ? fs.realpathSync.native(parent) : path.resolve(parent);
  return path.join(canonicalParent, path.basename(absolute));
}

function resolveFollowupDispatchSqliteFile(env = process.env, explicitValue = "") {
  const dataDirectory = String(env.DATA_DIR || env.DEPLOYMENT_DATA_DIR || "").trim();
  if (!dataDirectory || !path.isAbsolute(dataDirectory)) throw new Error("platform DATA_DIR must be an absolute path");
  const platformFile = canonicalPath(path.join(dataDirectory, "health-city.sqlite"));
  const explicit = String(explicitValue || env.CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE || "").trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error("followup dispatch SQLite file must be absolute");
    const workerFile = canonicalPath(explicit);
    const same = process.platform === "win32"
      ? workerFile.toLowerCase() === platformFile.toLowerCase()
      : workerFile === platformFile;
    if (!same) throw new Error("followup dispatch SQLite file must match platform DATA_DIR/health-city.sqlite");
  }
  return platformFile;
}

function receiptEvidence(receipt, event, environment) {
  if (!receipt || receipt.accepted !== true || !String(receipt.receiptId || "").trim()) {
    const error = new Error("followup dispatch publisher receipt is invalid");
    error.code = "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_INVALID";
    throw error;
  }
  const envelope = {
    eventId: event.eventId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    correlationId: event.correlationId,
    payload: event.payload
  };
  const verified = environment === "production"
    ? assertVerifiedFollowupEventPublisherReceipt(receipt, envelope)
    : null;
  const deliveryStatus = String(verified?.deliveryStatus || receipt.status || "accepted").toLowerCase();
  return Object.freeze({
    deliveryStatus: new Set(["accepted", "delivered"]).has(deliveryStatus) ? deliveryStatus : "accepted",
    receiptDigest: sha256({
      eventId: event.eventId,
      payloadDigest: event.payloadDigest,
      providerReceiptDigest: verified?.providerReceiptDigest || sha256(String(receipt.receiptId)),
      receiptBindingDigest: verified?.receiptBindingDigest || "",
      signatureDigest: verified?.signatureDigest || "",
      activationDigest: verified?.activationDigest || ""
    })
  });
}

function errorCode(error) {
  return String(error?.code || "FOLLOWUP_DISPATCH_TRANSPORT_FAILED")
    .trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 120)
    || "FOLLOWUP_DISPATCH_TRANSPORT_FAILED";
}

async function runFollowupDispatchWorker(options = {}) {
  const repository = options.repository;
  if (!repository || typeof repository.claimBatch !== "function") throw new TypeError("followup dispatch repository is required");
  const env = options.env || process.env;
  const environment = String(env.NODE_ENV || "").trim().toLowerCase();
  const publisher = options.publisher || createFollowupEventPublisher({
    env,
    activationVerifier: options.activationVerifier,
    fetchImpl: options.fetchImpl,
    now: options.publisherNow,
    resolveAddresses: options.resolveAddresses
  });
  const workerId = String(options.workerId || env.CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_WORKER_ID || "").trim();
  if (!workerId) throw new TypeError("followup dispatch worker id is required");
  const claims = repository.claimBatch({
    workerId,
    limit: options.limit,
    leaseSeconds: options.leaseSeconds,
    at: options.at
  });
  const outcomes = [];
  for (const event of claims) {
    const fence = {
      eventId: event.eventId,
      workerId,
      leaseToken: event.leaseToken,
      leaseVersion: event.leaseVersion
    };
    let evidence;
    try {
      const receipt = await publisher.publish(Object.freeze({
        eventId: event.eventId,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        correlationId: event.correlationId,
        payload: event.payload
      }));
      evidence = receiptEvidence(receipt, event, environment);
    } catch (error) {
      try {
        const failed = repository.markFailed({
          ...fence,
          errorCode: errorCode(error),
          failedAt: options.completedAt,
          baseBackoffSeconds: options.baseBackoffSeconds
        });
        outcomes.push(Object.freeze({
          eventId: event.eventId,
          status: failed.status,
          attempts: failed.attempts,
          errorDigest: sha256(errorCode(error))
        }));
      } catch (persistenceError) {
        outcomes.push(Object.freeze({
          eventId: event.eventId,
          status: "persistence-rejected",
          attempts: event.attempts,
          persistenceOperation: "failure",
          errorDigest: sha256(errorCode(persistenceError))
        }));
      }
      continue;
    }
    try {
      const delivered = repository.markDelivered({ ...fence, ...evidence, deliveredAt: options.completedAt });
      outcomes.push(Object.freeze({ eventId: event.eventId, status: delivered.status, attempts: delivered.attempts }));
    } catch (persistenceError) {
      outcomes.push(Object.freeze({
        eventId: event.eventId,
        status: "persistence-rejected",
        attempts: event.attempts,
        persistenceOperation: "completion",
        errorDigest: sha256(errorCode(persistenceError))
      }));
    }
  }
  return attachWorkerObservability("chronic-followup-dispatch", {
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

function inspectFollowupDispatchWorkerReadiness(env = process.env, options = {}) {
  let sqliteFile = "";
  let sqlitePathError = "";
  try {
    sqliteFile = resolveFollowupDispatchSqliteFile(env);
  } catch {
    sqlitePathError = "SQLite path unavailable";
  }
  const workerId = String(env.CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_WORKER_ID || "").trim();
  const endpoint = String(env.CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL || "").trim();
  const secret = String(env.CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET || "").trim();
  const activationVerifierConfigured = options.activationVerifierConfigured === true;
  const externalEvidenceVerified = options.externalEvidenceVerified === true;
  const configurationChecks = [
    Object.freeze({ id: "durable-sqlite", passed: Boolean(sqliteFile), detail: sqliteFile ? sha256(sqliteFile) : sqlitePathError || "SQLite path missing" }),
    Object.freeze({ id: "worker-identity", passed: Boolean(workerId), detail: workerId ? sha256(workerId) : "worker id missing" }),
    Object.freeze({ id: "https-endpoint", passed: /^https:\/\//i.test(endpoint), detail: endpoint ? sha256(endpoint) : "endpoint missing" }),
    Object.freeze({ id: "publisher-secret", passed: secret.length >= 32, detail: secret ? "secret reference present" : "secret missing" }),
    Object.freeze({ id: "activation-verifier", passed: activationVerifierConfigured, detail: activationVerifierConfigured ? "external verifier injected" : "external activation verifier missing" }),
    Object.freeze({ id: "request-path-isolation", passed: true, detail: "HTTP request path only commits local outbox state" })
  ];
  const checks = Object.freeze([
    ...configurationChecks,
    Object.freeze({
      id: "external-production-evidence",
      passed: externalEvidenceVerified,
      detail: externalEvidenceVerified
        ? "release-bound evidence verified by external trust provider"
        : "release-bound externally verified production evidence required"
    })
  ]);
  const configured = configurationChecks.every((item) => item.passed);
  return Object.freeze({
    contract: WORKER_CONTRACT,
    configured,
    checks,
    configurationDigest: sha256(stableStringify({ sqliteFile: Boolean(sqliteFile), workerId: Boolean(workerId), endpoint: Boolean(endpoint), secret: Boolean(secret) })),
    externalReceiptRequired: isProduction(env),
    externalEvidenceVerified,
    productionReady: configured && externalEvidenceVerified,
    boundary: "Runtime configuration is necessary but production readiness also requires release-bound evidence verified by the external trust provider."
  });
}

module.exports = {
  WORKER_CONTRACT,
  inspectFollowupDispatchWorkerReadiness,
  resolveFollowupDispatchSqliteFile,
  receiptEvidence,
  runFollowupDispatchWorker
};
