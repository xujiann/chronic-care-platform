#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  runTransactionalDirectReportWorkerCycle
} = require("../public-health-direct-report-worker");

const ROOT = path.resolve(__dirname, "..");

function enabled(value) {
  return /^(1|true|yes|enabled)$/i.test(String(value || "").trim());
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function workerError(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function workerConfiguration(env = process.env) {
  return {
    enabled: enabled(env.PUBLIC_HEALTH_DIRECT_REPORT_WORKER_ENABLED),
    workerId: String(env.PUBLIC_HEALTH_DIRECT_REPORT_WORKER_ID || "").trim(),
    runtimeModule: String(
      env.PUBLIC_HEALTH_DIRECT_REPORT_RUNTIME_MODULE
      || "public-health-direct-report-production-runtime.js"
    ).trim(),
    batchSize: boundedInteger(env.PUBLIC_HEALTH_DIRECT_REPORT_WORKER_BATCH_SIZE, 20, 1, 100),
    leaseSeconds: boundedInteger(env.PUBLIC_HEALTH_DIRECT_REPORT_WORKER_LEASE_SECONDS, 120, 15, 600),
    endpointConfigured: Boolean(String(env.PUBLIC_HEALTH_DIRECT_REPORT_URL || "").trim()),
    signingSecretConfigured: Boolean(String(env.PUBLIC_HEALTH_DIRECT_REPORT_SECRET || "").trim()),
    referenceSecretConfigured: Boolean(String(env.PUBLIC_HEALTH_REFERENCE_SECRET || "").trim()),
    callbackSecretConfigured: Boolean(String(env.PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET || "").trim()),
    storageEngine: String(env.STORAGE_ENGINE || "").trim().toLowerCase()
  };
}

function publicWorkerStatus(env = process.env) {
  const configuration = workerConfiguration(env);
  const blockers = [
    ...(!configuration.enabled ? ["worker activation"] : []),
    ...(!configuration.workerId ? ["stable worker identity"] : []),
    ...(configuration.storageEngine !== "sqlite" ? ["SQLite transactional storage"] : []),
    ...(!configuration.endpointConfigured ? ["direct-report endpoint"] : []),
    ...(!configuration.signingSecretConfigured ? ["request signing secret"] : []),
    ...(!configuration.referenceSecretConfigured ? ["keyed reference secret"] : []),
    ...(!configuration.callbackSecretConfigured ? ["callback signing secret"] : []),
    "official field dictionary, network allowlist, agency credentials and signed joint-test receipt"
  ];
  return {
    enabled: configuration.enabled,
    workerIdConfigured: Boolean(configuration.workerId),
    runtimeModuleConfigured: Boolean(configuration.runtimeModule),
    batchSize: configuration.batchSize,
    leaseSeconds: configuration.leaseSeconds,
    storageEngine: configuration.storageEngine || "not-configured",
    endpointConfigured: configuration.endpointConfigured,
    signingSecretConfigured: configuration.signingSecretConfigured,
    referenceSecretConfigured: configuration.referenceSecretConfigured,
    callbackSecretConfigured: configuration.callbackSecretConfigured,
    codeReady: true,
    productionReady: false,
    blockers
  };
}

function loadRuntimeModule(env = process.env) {
  const modulePath = workerConfiguration(env).runtimeModule;
  if (!modulePath) {
    throw workerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RUNTIME_MODULE_REQUIRED",
      "PUBLIC_HEALTH_DIRECT_REPORT_RUNTIME_MODULE is required"
    );
  }
  const resolved = path.isAbsolute(modulePath) ? modulePath : path.resolve(ROOT, modulePath);
  const loaded = require(resolved);
  const dependencies = typeof loaded.createPublicHealthDirectReportRuntimeDependencies === "function"
    ? loaded.createPublicHealthDirectReportRuntimeDependencies({ env })
    : loaded;
  if (!dependencies?.repository || typeof dependencies.repository.transaction !== "function") {
    throw workerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_REPOSITORY_INVALID",
      "direct-report runtime module must export a transactional repository"
    );
  }
  if (dependencies.dispatch !== undefined && typeof dependencies.dispatch !== "function") {
    throw workerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DISPATCH_INVALID",
      "direct-report runtime dispatch dependency is invalid"
    );
  }
  return dependencies;
}

async function runWorkerOnce(options = {}) {
  const env = options.env || process.env;
  const configuration = workerConfiguration(env);
  if (!configuration.enabled) {
    return {
      ok: true,
      skipped: true,
      reason: "PUBLIC_HEALTH_DIRECT_REPORT_WORKER_ENABLED is not enabled",
      status: publicWorkerStatus(env)
    };
  }
  if (!configuration.workerId) {
    throw workerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_WORKER_ID_REQUIRED",
      "PUBLIC_HEALTH_DIRECT_REPORT_WORKER_ID is required"
    );
  }
  if (configuration.storageEngine !== "sqlite") {
    throw workerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_SQLITE_REQUIRED",
      "STORAGE_ENGINE=sqlite is required for the independent direct-report worker"
    );
  }
  const dependencies = options.dependencies || loadRuntimeModule(env);
  const cycle = await runTransactionalDirectReportWorkerCycle(dependencies.repository, {
    workerId: configuration.workerId,
    limit: configuration.batchSize,
    leaseSeconds: configuration.leaseSeconds,
    randomUUID: options.randomUUID || randomUUID,
    clock: options.clock,
    dispatch: options.dispatch || dependencies.dispatch,
    dispatchOptions: {
      ...(dependencies.dispatchOptions || {}),
      env
    }
  });
  return {
    ok: cycle.deadLetters === 0,
    skipped: false,
    workerId: configuration.workerId,
    processed: cycle.processed,
    awaitingCallback: cycle.awaitingCallback,
    retryScheduled: cycle.retryScheduled,
    deadLetters: cycle.deadLetters,
    deliveries: cycle.deliveries.map((item) => ({
      id: item.id,
      state: item.state,
      attemptCount: item.attemptCount,
      version: item.version,
      failureCode: item.lastFailure?.code || ""
    })),
    productionReady: false
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes("--status")) {
      process.stdout.write(`${JSON.stringify(publicWorkerStatus(process.env))}\n`);
      return;
    }
    const result = await runWorkerOnce();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "PUBLIC_HEALTH_DIRECT_REPORT_WORKER_FAILED"),
      message: String(error?.message || "direct-report worker failed").slice(0, 300)
    })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  loadRuntimeModule,
  main,
  publicWorkerStatus,
  runWorkerOnce,
  workerConfiguration
};
