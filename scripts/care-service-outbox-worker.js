#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const Runtime = require("../care-service-runtime");
const { attachWorkerObservability } = require("../src/platform/operations/worker-observability-contract");

const ROOT = path.resolve(__dirname, "..");

function enabled(value) {
  return /^(1|true|yes|enabled)$/i.test(String(value || "").trim());
}

function workerError(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function loadRuntimeModule(env = process.env) {
  const modulePath = String(env.CARE_SERVICE_RUNTIME_MODULE || "").trim();
  if (!modulePath) {
    throw workerError(
      "CARE_WORKER_RUNTIME_MODULE_REQUIRED",
      "CARE_SERVICE_RUNTIME_MODULE must point to the T00 production repository and delivery adapter module"
    );
  }
  const resolved = path.isAbsolute(modulePath) ? modulePath : path.resolve(ROOT, modulePath);
  const loaded = require(resolved);
  const dependencies = typeof loaded.createCareServiceRuntimeDependencies === "function"
    ? loaded.createCareServiceRuntimeDependencies({ env })
    : loaded;
  if (!dependencies?.repository || typeof dependencies.repository.transaction !== "function") {
    throw workerError(
      "CARE_WORKER_REPOSITORY_INVALID",
      "care-service runtime module must export a transactional repository"
    );
  }
  if (!dependencies.deliveryAdapters || typeof dependencies.deliveryAdapters !== "object") {
    throw workerError(
      "CARE_WORKER_DELIVERY_ADAPTERS_INVALID",
      "care-service runtime module must export delivery adapters"
    );
  }
  return dependencies;
}

function workerConfiguration(env = process.env) {
  return {
    enabled: enabled(env.CARE_OUTBOX_WORKER_ENABLED),
    workerId: String(env.CARE_OUTBOX_WORKER_ID || "").trim(),
    batchSize: Number(env.CARE_OUTBOX_BATCH_SIZE || 20),
    leaseSeconds: Number(env.CARE_OUTBOX_LEASE_SECONDS || 60),
    maxAttempts: Number(env.CARE_OUTBOX_MAX_ATTEMPTS || 5),
    retryBaseSeconds: Number(env.CARE_OUTBOX_RETRY_BASE_SECONDS || 30),
    maxRetrySeconds: Number(env.CARE_OUTBOX_MAX_RETRY_SECONDS || 1800)
  };
}

async function runWorkerOnce(options = {}) {
  const env = options.env || process.env;
  const configuration = workerConfiguration(env);
  if (!configuration.enabled) {
    return attachWorkerObservability("care-service-outbox", {
      ok: true,
      skipped: true,
      reason: "CARE_OUTBOX_WORKER_ENABLED is not enabled"
    }, { observedAt: options.at || new Date().toISOString() });
  }
  if (!configuration.workerId) {
    throw workerError("CARE_WORKER_ID_REQUIRED", "CARE_OUTBOX_WORKER_ID is required");
  }
  const dependencies = options.dependencies || loadRuntimeModule(env);
  const runId = String(options.runId || randomUUID());
  const result = await Runtime.runTransactionalOutboxWorker(
    dependencies.repository,
    dependencies.deliveryAdapters,
    {
      workerId: configuration.workerId,
      runId,
      at: options.at || new Date().toISOString(),
      batchSize: configuration.batchSize,
      leaseSeconds: configuration.leaseSeconds,
      maxAttempts: configuration.maxAttempts,
      retryBaseSeconds: configuration.retryBaseSeconds,
      maxRetrySeconds: configuration.maxRetrySeconds
    }
  );
  return attachWorkerObservability("care-service-outbox", {
    ok: result.deadLetters === 0,
    skipped: false,
    runId,
    workerId: configuration.workerId,
    claimed: result.claimed,
    delivered: result.delivered,
    retried: result.retried,
    deadLetters: result.deadLetters,
    resultCodes: result.results.map((item) => ({
      domain: item.domain,
      eventId: item.eventId,
      status: item.status,
      errorCode: item.errorCode || ""
    }))
  }, { observedAt: options.at || new Date().toISOString() });
}

async function main() {
  try {
    const result = await runWorkerOnce();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "CARE_WORKER_FAILED"),
      message: String(error?.message || "care-service outbox worker failed").slice(0, 300)
    })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  workerConfiguration,
  loadRuntimeModule,
  runWorkerOnce
};
