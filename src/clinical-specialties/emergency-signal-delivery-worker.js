"use strict";

const { randomUUID } = require("node:crypto");
const { attachWorkerObservability } = require("../platform/operations/worker-observability-contract");

function workerError(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function text(value, maximum = 200) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function errorCode(error) {
  const candidate = text(error?.code, 80);
  return /^[A-Z0-9_]{2,80}$/.test(candidate)
    ? candidate
    : "EMERGENCY_SIGNAL_DELIVERY_FAILED";
}

function assertDependencies(repository, transport) {
  const required = ["claim", "acknowledge", "fail"];
  if (!repository || required.some((name) => typeof repository[name] !== "function")) {
    throw workerError(
      "EMERGENCY_SIGNAL_WORKER_REPOSITORY_INVALID",
      "emergency signal worker requires a PostgreSQL delivery repository"
    );
  }
  if (typeof transport !== "function") {
    throw workerError(
      "EMERGENCY_SIGNAL_WORKER_TRANSPORT_INVALID",
      "emergency signal worker requires a signed transport"
    );
  }
}

async function runEmergencySignalDeliveryWorkerOnce(options = {}) {
  const repository = options.repository;
  const transport = options.transport;
  assertDependencies(repository, transport);
  const workerId = text(options.workerId, 160);
  if (!workerId) {
    throw workerError(
      "EMERGENCY_SIGNAL_WORKER_ID_REQUIRED",
      "emergency signal worker id is required",
      400
    );
  }
  const runId = text(options.runId || randomUUID(), 160);
  const now = typeof options.now === "function"
    ? options.now
    : () => new Date().toISOString();
  const claimed = await repository.claim({
    workerId,
    now: new Date(now()).toISOString(),
    limit: 1,
    leaseMs: Math.min(15 * 60_000, Math.max(60_000, Number(options.leaseMs) || 90_000))
  });
  const results = [];
  for (const claim of claimed) {
    let receipt;
    try {
      receipt = await transport(claim.event, {
        eventId: claim.eventId,
        payloadDigest: claim.payloadDigest,
        attempt: claim.attempt,
        generation: claim.generation,
        workerId,
        runId
      });
    } catch (error) {
      const code = errorCode(error);
      const failed = await repository.fail(
        claim,
        {
          errorCode: code,
          message: text(error?.message || code, 500)
        },
        { now: new Date(now()).toISOString() }
      );
      results.push(Object.freeze({
        eventId: claim.eventId,
        status: failed.status,
        attempt: claim.attempt,
        generation: claim.generation,
        errorCode: code
      }));
      continue;
    }
    const maximumAckAttempts = Math.min(5, Math.max(1, Number(options.ackAttempts) || 3));
    let acknowledged;
    for (let ackAttempt = 1; ackAttempt <= maximumAckAttempts; ackAttempt += 1) {
      try {
        acknowledged = await repository.acknowledge(
          claim,
          receipt,
          { now: receipt.receivedAt }
        );
        break;
      } catch (error) {
        if (
          ackAttempt === maximumAckAttempts
          || /LEASE_(?:STALE|CONFLICT)/.test(String(error?.code || ""))
        ) {
          throw error;
        }
      }
    }
    results.push(Object.freeze({
      eventId: claim.eventId,
      status: acknowledged.status,
      attempt: claim.attempt,
      generation: claim.generation,
      errorCode: ""
    }));
  }
  const summary = {
    claimed: claimed.length,
    published: results.filter((item) => item.status === "published").length,
    retrying: results.filter((item) => item.status === "pending").length,
    deadLettered: results.filter((item) => item.status === "dead-letter").length
  };
  return attachWorkerObservability("emergency-signal-delivery", {
    ok: summary.deadLettered === 0,
    runId,
    workerId,
    summary: Object.freeze(summary),
    results: Object.freeze(results),
    payloadsExposed: false,
    leaseTokensExposed: false,
    productionReady: false,
    boundary: "The worker result is local operational evidence; T00 deployment, live credentials, external verification, and signed site acceptance remain required."
  }, { observedAt: now() });
}

module.exports = {
  runEmergencySignalDeliveryWorkerOnce
};
