"use strict";

const IdentityPostgres = require("../../identity-security/session-security-audit-postgres-repository");
const ReferralPostgres = require("../../care-coordination/referral-delivery-postgres-repository");
const ReferralTransport = require("../../care-coordination/referral-delivery-transport");
const ReferralWorker = require("../../care-coordination/referral-delivery-worker");
const EmergencyPostgres = require("../../clinical-specialties/emergency-signal-delivery-postgres");
const EmergencyTransport = require("../../clinical-specialties/emergency-signal-delivery-transport");
const EmergencyWorker = require("../../clinical-specialties/emergency-signal-delivery-worker");

const MODES = new Set(["disabled", "rehearsal", "shadow", "cutover-gated"]);
const REQUIRED_APPROVAL_ROLES = Object.freeze([
  "platform-operations",
  "security-compliance",
  "data-platform",
  "project-owner"
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function runtimeError(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 200) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function enabled(value) {
  return /^(?:1|true|yes|enabled)$/i.test(clean(value, 20));
}

function buildProductionAdapterRuntimeConfig(env = process.env) {
  const mode = clean(env.PLATFORM_PRODUCTION_ADAPTER_MODE || "disabled", 40).toLowerCase();
  if (!MODES.has(mode)) {
    throw runtimeError(
      "PLATFORM_PRODUCTION_ADAPTER_MODE_INVALID",
      "platform production adapter mode is invalid",
      400
    );
  }
  return Object.freeze({
    schema: "platform-production-adapter-runtime-v1",
    mode,
    workerActivationRequested: enabled(env.PLATFORM_PRODUCTION_WORKERS_ENABLED),
    workerId: clean(env.PLATFORM_PRODUCTION_WORKER_ID, 160),
    productionPrimary: false,
    productionReady: false,
    credentialsPersisted: false,
    boundary: "Environment flags configure local execution only. They cannot prove migration, joint testing, assessment, site acceptance, approval, or production cutover."
  });
}

function validateExternalAuthorization(input, now = new Date().toISOString()) {
  const approvals = Array.isArray(input?.approvals) ? input.approvals : [];
  const accounts = approvals.map((item) => clean(item?.account, 160)).filter(Boolean);
  const approvedRoles = new Set(
    approvals
      .filter((item) => item?.status === "approved" && clean(item?.evidenceRef, 240))
      .map((item) => clean(item.role, 80))
  );
  const approvedAt = Date.parse(input?.approvedAt || "");
  const expiresAt = Date.parse(input?.expiresAt || "");
  const nowTime = Date.parse(now);
  const checks = Object.freeze({
    releaseId: Boolean(clean(input?.releaseId, 160)),
    evidenceFingerprint: SHA256.test(clean(input?.evidenceFingerprint, 80)),
    approvalWindow: Number.isFinite(approvedAt)
      && Number.isFinite(expiresAt)
      && approvedAt <= nowTime
      && expiresAt > nowTime,
    independentAccounts: accounts.length === REQUIRED_APPROVAL_ROLES.length
      && new Set(accounts).size === REQUIRED_APPROVAL_ROLES.length,
    requiredRoles: REQUIRED_APPROVAL_ROLES.every((role) => approvedRoles.has(role)),
    explicitDecision: input?.decision === "GO"
      && input?.confirmation === "APPROVE PRODUCTION ADAPTER CUTOVER"
  });
  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    checks,
    releaseId: checks.releaseId ? clean(input.releaseId, 160) : "",
    evidenceFingerprint: checks.evidenceFingerprint ? clean(input.evidenceFingerprint, 80) : "",
    productionReady: false,
    externalEvidenceInferred: false
  });
}

function adapterProjection(config = {}) {
  const requirements = config.requirements && typeof config.requirements === "object"
    ? Object.fromEntries(Object.entries(config.requirements).map(([key, value]) => [key, value === true]))
    : {};
  return Object.freeze({
    adapter: clean(config.adapter, 120),
    mode: clean(config.mode || "disabled", 40),
    configured: config.configured === true,
    writeEnabled: config.writeEnabled === true,
    evidenceReady: config.evidenceReady === true,
    requirements: Object.freeze(requirements),
    migration: config.migration
      ? Object.freeze({
        path: clean(config.migration.path, 240),
        sha256: clean(config.migration.sha256, 80)
      })
      : null,
    credentialsExposed: false,
    productionReady: false
  });
}

function createProductionAdapterRuntime(options = {}) {
  const env = options.env || process.env;
  const config = buildProductionAdapterRuntimeConfig(env);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const authorization = validateExternalAuthorization(options.externalAuthorization, now());
  const factories = {
    identityRepository: options.factories?.identityRepository
      || ((factoryOptions) => IdentityPostgres.createPostgresSessionSecurityAuditRepository(factoryOptions)),
    referralRepository: options.factories?.referralRepository
      || ((factoryOptions) => ReferralPostgres.createReferralDeliveryPostgresRepository(factoryOptions)),
    emergencyRepository: options.factories?.emergencyRepository
      || ((factoryOptions) => EmergencyPostgres.createEmergencySignalPostgresRepository(factoryOptions)),
    referralTransport: options.factories?.referralTransport
      || ((factoryOptions) => ReferralTransport.createReferralDeliveryTransport(factoryOptions)),
    emergencyTransport: options.factories?.emergencyTransport
      || ((factoryOptions) => EmergencyTransport.createEmergencySignalSignedTransport(factoryOptions))
  };
  const adapterConfigs = Object.freeze({
    identity: IdentityPostgres.buildPostgresSessionSecurityAuditConfig(env),
    referral: ReferralPostgres.buildReferralDeliveryPostgresConfig(env),
    emergency: EmergencyPostgres.buildEmergencySignalPostgresConfig(env)
  });
  const repositories = new Map();
  const schemaReports = new Map();

  function repository(id) {
    if (!["identity", "referral", "emergency"].includes(id)) {
      throw runtimeError("PLATFORM_PRODUCTION_ADAPTER_UNKNOWN", "production adapter is unknown", 400);
    }
    if (!repositories.has(id)) {
      const factoryOptions = {
        env,
        pool: options.pools?.[id]
      };
      if (id === "identity" || id === "emergency") {
        factoryOptions.poolTlsVerification = options.poolSecurityEvidence?.[id];
      }
      if (id === "referral") {
        factoryOptions.tlsProbeEvidence = options.poolSecurityEvidence?.referral;
      }
      repositories.set(id, factories[`${id}Repository`](factoryOptions));
    }
    return repositories.get(id);
  }

  async function verifySchemas() {
    const reports = {};
    for (const id of ["identity", "referral", "emergency"]) {
      const current = repository(id);
      if (typeof current.verifySchema !== "function") {
        throw runtimeError(
          "PLATFORM_PRODUCTION_SCHEMA_VERIFIER_MISSING",
          `${id} production adapter does not expose schema verification`
        );
      }
      const report = await current.verifySchema();
      const safe = Object.freeze({
        ok: report?.ok === true,
        checks: Object.freeze(Object.fromEntries(
          Object.entries(report?.checks || {}).map(([key, value]) => [key, value === true])
        )),
        migrationSha256: clean(report?.migrationSha256 || report?.migration?.sha256, 80),
        productionReady: false
      });
      schemaReports.set(id, safe);
      reports[id] = safe;
    }
    return Object.freeze(reports);
  }

  async function readiness(input = {}) {
    if (input.verifySchemas === true) await verifySchemas();
    const adapters = Object.fromEntries(
      Object.entries(adapterConfigs).map(([id, value]) => [id, adapterProjection(value)])
    );
    const schemaVerified = ["identity", "referral", "emergency"]
      .every((id) => schemaReports.get(id)?.ok === true);
    const localChecks = Object.freeze({
      runtimeEnabled: config.mode !== "disabled",
      adaptersConfigured: Object.values(adapters).every((item) => item.configured),
      adapterWritesEvidenceGated: Object.values(adapters).every((item) => item.writeEnabled),
      schemaVerified,
      workerIdentityConfigured: Boolean(config.workerId),
      workerActivationRequested: config.workerActivationRequested
    });
    return Object.freeze({
      schema: config.schema,
      mode: config.mode,
      adapters: Object.freeze(adapters),
      schemas: Object.freeze(Object.fromEntries(schemaReports)),
      localChecks,
      externalAuthorization: authorization,
      workersEligible: Object.values(localChecks).every(Boolean) && authorization.ok,
      productionPrimary: false,
      productionReady: false,
      credentialsExposed: false,
      boundary: config.boundary
    });
  }

  async function shadowRelayReadiness(id, input = {}) {
    if (!["referral", "emergency"].includes(id)) {
      throw runtimeError(
        "PLATFORM_SHADOW_RELAY_ADAPTER_UNKNOWN",
        "only referral and emergency adapters support domain shadow relay",
        400
      );
    }
    if (input.verifySchema === true) {
      const current = repository(id);
      const report = await current.verifySchema();
      schemaReports.set(id, Object.freeze({
        ok: report?.ok === true,
        checks: Object.freeze(Object.fromEntries(
          Object.entries(report?.checks || {}).map(([key, value]) => [key, value === true])
        )),
        migrationSha256: clean(report?.migrationSha256 || report?.migration?.sha256, 80),
        productionReady: false
      }));
    }
    const adapter = adapterProjection(adapterConfigs[id]);
    const checks = Object.freeze({
      shadowMode: config.mode === "shadow" || config.mode === "cutover-gated",
      adapterConfigured: adapter.configured,
      adapterWriteEnabled: adapter.writeEnabled,
      schemaVerified: schemaReports.get(id)?.ok === true
    });
    return Object.freeze({
      adapter: id,
      eligible: Object.values(checks).every(Boolean),
      checks,
      schema: schemaReports.get(id) || null,
      externalAuthorizationRequired: false,
      productionPrimary: false,
      productionReady: false,
      boundary: "Eligibility permits only an idempotent PostgreSQL shadow copy. It does not authorize worker delivery, primary reads, migration completion, or production cutover."
    });
  }

  async function runWorkerOnce(id, workerOptions = {}) {
    const report = await readiness();
    if (!report.workersEligible || !options.activateWorkers) {
      throw runtimeError(
        "PLATFORM_PRODUCTION_WORKER_GATE_BLOCKED",
        "production worker activation requires verified schemas, explicit runtime activation, and current independent external authorization",
        409
      );
    }
    const workerId = clean(workerOptions.workerId || config.workerId, 160);
    if (id === "referral") {
      return ReferralWorker.runReferralDeliveryWorkerOnce({
        ...workerOptions,
        workerId,
        repository: repository("referral"),
        transport: factories.referralTransport({ env, fetchImpl: options.fetch, now })
      });
    }
    if (id === "emergency") {
      return EmergencyWorker.runEmergencySignalDeliveryWorkerOnce({
        ...workerOptions,
        workerId,
        repository: repository("emergency"),
        transport: factories.emergencyTransport({ env, fetchImpl: options.fetch, now })
      });
    }
    throw runtimeError(
      "PLATFORM_PRODUCTION_WORKER_UNKNOWN",
      "only referral and emergency delivery workers are centrally runnable",
      400
    );
  }

  async function close() {
    await Promise.all([...repositories.values()].map(async (current) => {
      if (typeof current.close === "function") await current.close();
    }));
    repositories.clear();
  }

  return Object.freeze({
    config,
    adapterConfigs,
    authorization,
    repository,
    verifySchemas,
    readiness,
    shadowRelayReadiness,
    runWorkerOnce,
    close
  });
}

module.exports = {
  MODES,
  REQUIRED_APPROVAL_ROLES,
  adapterProjection,
  buildProductionAdapterRuntimeConfig,
  createProductionAdapterRuntime,
  validateExternalAuthorization
};
