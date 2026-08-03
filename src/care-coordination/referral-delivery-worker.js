"use strict";

const { randomUUID } = require("node:crypto");
const { inspectReferralTransportReadiness } = require("./referral-delivery-transport");

const MIN_WORKER_LEASE_MS = 60 * 1000;
const ACK_RETRY_LIMIT = 3;
const TRANSIENT_ACK_CODES = new Set([
  "REFERRAL_DELIVERY_DATABASE_FAILED",
  "REFERRAL_DELIVERY_SERIALIZATION_RETRY",
  "ECONNRESET",
  "ETIMEDOUT"
]);

function text(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function buildReferralWorkerReadiness(options = {}) {
  const env = options.env || process.env;
  const postgres = options.postgresConfig || {};
  const transport = options.transportReadiness || inspectReferralTransportReadiness(env);
  const centralCutoverRequested = /^(?:1|true|yes)$/i.test(String(env.REFERRAL_DELIVERY_CENTRAL_CUTOVER_ENABLED || ""));
  const workerEvidence = text(env.REFERRAL_DELIVERY_WORKER_EVIDENCE_ID, 160);
  const requirements = Object.freeze({
    postgresWriteEnabled: postgres.writeEnabled === true,
    postgresEvidenceReady: postgres.evidenceReady === true,
    signedHttpsTransport: transport.configured === true && transport.https === true,
    transportEvidenceReady: transport.evidenceReady === true,
    workerEvidence: workerEvidence.length >= 4,
    centralCutoverRequested,
    centralCutoverConnected: false
  });
  return Object.freeze({
    requirements,
    blockers: Object.freeze(Object.entries(requirements).filter(([, ready]) => !ready).map(([name]) => name)),
    credentialsPersisted: false,
    productionReady: false
  });
}

async function acknowledgeWithRetry(repository, eventId, input, options = {}) {
  const wait = typeof options.wait === "function"
    ? options.wait
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  let lastError;
  for (let attempt = 1; attempt <= ACK_RETRY_LIMIT; attempt += 1) {
    try {
      return await repository.acknowledge(eventId, input);
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_ACK_CODES.has(String(error?.code || "")) || attempt === ACK_RETRY_LIMIT) throw error;
      await wait(attempt * 25);
    }
  }
  throw lastError;
}

async function runReferralDeliveryWorkerOnce(options = {}) {
  const repository = options.repository;
  const transport = options.transport;
  if (!repository || typeof repository.claim !== "function"
    || typeof repository.acknowledge !== "function"
    || typeof repository.fail !== "function") {
    throw new TypeError("referral delivery worker requires a delivery repository");
  }
  if (typeof transport !== "function") throw new TypeError("referral delivery worker requires a signed transport");
  const workerId = text(options.workerId || `referral-worker-${randomUUID()}`, 160);
  const runId = text(options.runId || `referral-run-${randomUUID()}`, 200);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const claims = await repository.claim({
    workerId,
    limit: 1,
    leaseMs: Math.min(15 * 60 * 1000, Math.max(MIN_WORKER_LEASE_MS, Number(options.leaseMs) || MIN_WORKER_LEASE_MS)),
    now: now()
  });
  if (!Array.isArray(claims) || claims.length > 1) {
    throw new TypeError("referral delivery repository must return at most one claim per worker run");
  }
  const outcomes = [];
  for (const claim of claims) {
    let receipt;
    try {
      receipt = await transport(claim, { workerId, runId });
    } catch (error) {
      try {
        const failed = await repository.fail(claim.id, {
          workerId,
          leaseToken: claim.leaseToken,
          leaseVersion: claim.leaseVersion,
          errorCode: text(error?.code || "REFERRAL_DELIVERY_FAILED", 120),
          errorMessage: text(error?.message || "referral delivery failed", 1000),
          failedAt: now()
        });
        outcomes.push(Object.freeze({
          eventId: claim.id,
          status: failed.status,
          errorCode: failed.lastErrorCode || text(error?.code, 120)
        }));
      } catch (leaseError) {
        outcomes.push(Object.freeze({
          eventId: claim.id,
          status: "stale-lease",
          errorCode: text(leaseError?.code || "REFERRAL_DELIVERY_LEASE_STALE", 120)
        }));
      }
      continue;
    }
    try {
      const acknowledged = await acknowledgeWithRetry(repository, claim.id, {
        workerId,
        leaseToken: claim.leaseToken,
        leaseVersion: claim.leaseVersion,
        receipt,
        acknowledgedAt: now()
      }, { wait: options.wait });
      outcomes.push(Object.freeze({
        eventId: claim.id,
        status: "delivered",
        idempotentReplay: acknowledged.idempotentReplay === true
      }));
    } catch (error) {
      outcomes.push(Object.freeze({
        eventId: claim.id,
        status: error?.code === "REFERRAL_DELIVERY_LEASE_STALE" ? "stale-lease" : "ack-failed",
        errorCode: text(error?.code || "REFERRAL_DELIVERY_ACK_FAILED", 120)
      }));
    }
  }
  const counts = outcomes.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  return Object.freeze({
    runId,
    workerId,
    claimed: claims.length,
    counts: Object.freeze(counts),
    outcomes: Object.freeze(outcomes),
    payloadsExposed: false,
    leaseTokensExposed: false,
    productionReady: false
  });
}

module.exports = {
  ACK_RETRY_LIMIT,
  acknowledgeWithRetry,
  buildReferralWorkerReadiness,
  MIN_WORKER_LEASE_MS,
  runReferralDeliveryWorkerOnce
};
