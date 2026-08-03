"use strict";

const { randomUUID } = require("node:crypto");
const { inspectReferralTransportReadiness } = require("./referral-delivery-transport");

function text(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function buildReferralWorkerReadiness(options = {}) {
  const env = options.env || process.env;
  const postgres = options.postgresConfig || {};
  const transport = options.transportReadiness || inspectReferralTransportReadiness(env);
  const centralCutover = /^(?:1|true|yes)$/i.test(String(env.REFERRAL_DELIVERY_CENTRAL_CUTOVER_ENABLED || ""));
  const workerEvidence = text(env.REFERRAL_DELIVERY_WORKER_EVIDENCE_ID, 160);
  const requirements = Object.freeze({
    postgresWriteEnabled: postgres.writeEnabled === true,
    postgresEvidenceReady: postgres.evidenceReady === true,
    signedHttpsTransport: transport.configured === true && transport.https === true,
    transportEvidenceReady: transport.evidenceReady === true,
    workerEvidence: workerEvidence.length >= 4,
    centralCutover
  });
  return Object.freeze({
    requirements,
    blockers: Object.freeze(Object.entries(requirements).filter(([, ready]) => !ready).map(([name]) => name)),
    credentialsPersisted: false,
    productionReady: Object.values(requirements).every(Boolean)
  });
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
    limit: Math.min(100, Math.max(1, Number(options.limit) || 10)),
    leaseMs: Math.min(15 * 60 * 1000, Math.max(1000, Number(options.leaseMs) || 30 * 1000)),
    now: now()
  });
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
      const acknowledged = await repository.acknowledge(claim.id, {
        workerId,
        leaseToken: claim.leaseToken,
        leaseVersion: claim.leaseVersion,
        receipt,
        acknowledgedAt: now()
      });
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
  buildReferralWorkerReadiness,
  runReferralDeliveryWorkerOnce
};
