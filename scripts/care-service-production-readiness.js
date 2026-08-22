#!/usr/bin/env node
"use strict";

const { readRuntimeSource } = require("../src/http/runtime-source");

const fs = require("node:fs");
const path = require("node:path");
const Runtime = require("../care-service-runtime");
const CutoverEvidence = require("../care-service-cutover-evidence");
const DependencyEvidence = require("../care-service-dependency-evidence");
const { objectStorageCenter } = require("../secure-object-storage");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_JSON = path.join(ROOT, "release", "care-service-production-readiness.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "care-service-production-readiness.md");

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function enabled(value) {
  return /^(1|true|yes|ready|signed|approved)$/i.test(String(value || "").trim());
}

function secretReady(value, minimum = 32) {
  const candidate = String(value || "").trim();
  return candidate.length >= minimum
    && !/replace-with|change-me|changeme|placeholder|example|demo[-_]/i.test(candidate);
}

function productionValueReady(value) {
  const candidate = String(value || "").trim();
  return Boolean(candidate)
    && !/replace-with|change-me|changeme|placeholder|example|demo[-_]|localhost|127\.0\.0\.1|\[?::1\]?/i.test(candidate);
}

function httpsUrl(value) {
  try {
    const candidate = String(value || "").trim();
    return productionValueReady(candidate) && new URL(candidate).protocol === "https:";
  } catch {
    return false;
  }
}

function configuredSignedEndpoint(env, urlName, secretNames) {
  return httpsUrl(env[urlName]) && secretNames.some((name) => secretReady(env[name]));
}

function check(id, name, passed, detail, owner, action, category = "external") {
  return { id, name, passed: Boolean(passed), detail, owner, action, category };
}

function buildCodeChecks(sources) {
  return [
    check(
      "code:workflow",
      "evidence-gated nursing and escort workflow",
      [
        "validateDispatchEvidence", "validateServiceEvidence", "validateFinancialEvidence",
        "validateRiskQualityEvidence", "validateCancellationRefundEvidence", "validateSchedulingEvidence",
        "validateTimelineIntegrity", "recordNotificationReceipt"
      ].every((marker) => sources.domain.includes(marker)),
      "shared workflow validates dispatch, service, finance, risk, refund, scheduling, timeline and receipts",
      "T06",
      "restore missing shared-domain controls",
      "code"
    ),
    check(
      "code:nursing-write",
      "guarded internet nursing write path",
      [
        "createInternetNursingOrder", "transitionInternetNursingOrder",
        "recordInternetNursingNotificationReceipt", "NURSING_EVIDENCE_BYPASS_FORBIDDEN",
        "NURSING_OUTBOX_INTEGRITY_INVALID"
      ].every((marker) => sources.nursing.includes(marker)),
      "nursing create, transition, receipt and outbox integrity adapters present",
      "T06",
      "restore the nursing write adapter",
      "code"
    ),
    check(
      "code:escort-write",
      "guarded escort write path",
      [
        "createEscortOrder", "transitionEscortOrder", "recordEscortNotificationReceipt",
        "ESCORT_EVIDENCE_BYPASS_FORBIDDEN", "validateProviderAndCatalog",
        "ESCORT_OUTBOX_INTEGRITY_INVALID"
      ].every((marker) => sources.escort.includes(marker)),
      "escort authorization, provider catalog, transition, receipt and outbox controls present",
      "T06",
      "restore the escort write adapter",
      "code"
    ),
    check(
      "code:transaction-runtime",
      "transactional command runtime",
      [
        "executeTransactionalCommand", "transaction.readState", "transaction.writeState",
        "expectedVersion", "CARE_TRANSACTION_COMMAND_ID_REQUIRED"
      ].every((marker) => sources.runtime.includes(marker)),
      "repository transaction contract commits order and outbox state with optimistic version binding",
      "T06/T00",
      "wire the runtime transaction contract into the public server repository",
      "code"
    ),
    check(
      "code:reliable-outbox",
      "leased outbox delivery and compensation",
      [
        "claimOutboxEvents", "leaseExpiresAt", "retryDelaySeconds", "dead-letter",
        "requeueDeadLetter", "DEAD_LETTER_CONFIRMATION", "buildOutboxHealth",
        "runTransactionalOutboxWorker"
      ].every((marker) => sources.runtime.includes(marker)),
      "bounded claim leases, exponential retry, dead letters, health and audited requeue are implemented",
      "T06/T00",
      "deploy the worker and expose operations through the public server",
      "code"
    ),
    check(
      "code:negative-tests",
      "security and failure-path tests",
      [
        "outbox claims are ordered", "delivery receipts bind worker", "dead-letters at the limit",
        "outbox integrity failure blocks", "transaction executor commits order and outbox together",
        "transactional worker commits leases before network delivery"
      ].every((marker) => sources.runtimeTest.includes(marker))
        && /forged evidence is rejected/.test(sources.escortTest)
        && /forbids bypass switches/.test(sources.nursingTest),
      "authorization, binding, tamper, lease, retry, dead-letter and rollback paths are covered",
      "T06",
      "restore missing negative tests",
      "code"
    ),
    check(
      "code:platform-adapter",
      "dependency-injected public platform adapter",
      [
        "createCareServicePlatformAdapter", "createOrder", "transitionOrder",
        "recordNotificationReceipt", "readOutboxHealth", "runOutboxWorker",
        "CARE_PLATFORM_EVIDENCE_BYPASS_FORBIDDEN", "errorResponse"
      ].every((marker) => sources.platformAdapter.includes(marker))
        && /atomically creates guarded nursing and escort orders/.test(sources.platformAdapterTest)
        && /fails closed on missing command scope and evidence bypass/.test(sources.platformAdapterTest),
      "T00 can wire framework-neutral handlers without reimplementing T06 authorization, transaction or worker controls",
      "T06",
      "restore the public platform integration adapter and negative tests",
      "code"
    ),
    check(
      "code:worker-deployment",
      "hardened outbox worker deployment",
      [
        "runWorkerOnce", "CARE_SERVICE_RUNTIME_MODULE", "CARE_WORKER_RUNTIME_MODULE_REQUIRED",
        "runTransactionalOutboxWorker"
      ].every((marker) => sources.worker.includes(marker))
        && ["Type=oneshot", "NoNewPrivileges=true", "ProtectSystem=strict", "ReadWritePaths="]
          .every((marker) => sources.workerService.includes(marker))
        && ["OnUnitActiveSec=15s", "Persistent=true"]
          .every((marker) => sources.workerTimer.includes(marker))
        && /CARE_OUTBOX_WORKER_ENABLED=true/.test(sources.workerEnv)
        && /enabled worker refuses to run without stable identity or runtime module/.test(sources.workerTest),
      "worker entry point, stable identity, external production module and hardened timer templates are available",
      "T06/T00",
      "restore worker entry point and hardened deployment templates",
      "code"
    ),
    check(
      "code:cutover-evidence",
      "evidence-bound production cutover approvals",
      [
        "validateCutoverEvidence", "loadCutoverEvidence", "CUTOVER_EVIDENCE_DIGEST_MISMATCH",
        "CUTOVER_EVIDENCE_SIGNER_REUSED", "CUTOVER_EVIDENCE_STALE", "REQUIRED_SCOPES"
      ].every((marker) => sources.cutoverEvidence.includes(marker))
        && /accepts five current independent approvals/.test(sources.cutoverEvidenceTest)
        && /loader verifies the exact archived file bytes/.test(sources.cutoverEvidenceTest)
        && /CARE_CUTOVER_EVIDENCE_FILE/.test(sources.cutoverEnv)
        && /care-service-cutover-evidence-v1/.test(sources.cutoverTemplate),
      "cutover requires a deployment-pinned evidence manifest with five current independent approvals",
      "T06/T00",
      "restore the evidence manifest validator, templates and negative tests",
      "code"
    ),
    check(
      "code:dependency-evidence",
      "fresh production dependency probe evidence",
      [
        "validateDependencyEvidence", "loadDependencyEvidence", "targetDigestForDependency",
        "CARE_DEPENDENCY_EVIDENCE_DIGEST_MISMATCH", "CARE_DEPENDENCY_EVIDENCE_TARGET_MISMATCH",
        "CARE_DEPENDENCY_EVIDENCE_STALE", "REQUIRED_DEPENDENCIES"
      ].every((marker) => sources.dependencyEvidence.includes(marker))
        && /accepts fresh independently receipted probes/.test(sources.dependencyEvidenceTest)
        && /rejects any change to the pinned file bytes/.test(sources.dependencyEvidenceTest)
        && /buildDependencyTargetInventory/.test(sources.dependencyTargets)
        && /digest-only production bindings/.test(sources.dependencyTargetsTest)
        && /CARE_DEPENDENCY_EVIDENCE_FILE/.test(sources.dependencyEvidenceEnv)
        && /care-service-dependency-evidence-v1/.test(sources.dependencyEvidenceTemplate),
      "configured production targets require fresh independently receipted health evidence bound to their target digests",
      "T06/T00",
      "restore the dependency evidence validator, templates and failure-path tests",
      "code"
    )
  ];
}

function buildEnvironmentChecks(env, dependencyEvidence) {
  const storageEngine = String(env.STORAGE_ENGINE || "").trim().toLowerCase();
  const runtimeModuleValue = String(env.CARE_SERVICE_RUNTIME_MODULE || "").trim();
  const runtimeModulePath = runtimeModuleValue
    ? path.isAbsolute(runtimeModuleValue) ? runtimeModuleValue : path.resolve(ROOT, runtimeModuleValue)
    : "";
  const runtimeModuleReady = Boolean(runtimeModulePath)
    && fs.existsSync(runtimeModulePath)
    && path.basename(runtimeModulePath) === "care-service-production-runtime.js";
  const sessionSecrets = String(env.SESSION_SECRETS || env.SESSION_SECRET || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const databaseReady = storageEngine === "sqlite";
  const secureObjectStorage = objectStorageCenter(env);
  const healthyDependencies = new Set(dependencyEvidence.healthyDependencies || []);
  const probesReady = (...dependencies) => dependencies.every((dependency) => healthyDependencies.has(dependency));
  const probeDetail = (...dependencies) => {
    const codes = dependencyEvidence.errors
      .filter((error) => !error.dependency || dependencies.includes(error.dependency))
      .map((error) => error.code);
    return codes.length ? codes.join(", ") : "fresh target-bound probe receipts verified";
  };
  return [
    check("runtime:production-profile", "production runtime profile", env.NODE_ENV === "production", env.NODE_ENV || "missing", "运维", "set NODE_ENV=production"),
    check("runtime:durable-storage", "durable transactional storage", databaseReady && probesReady("storage"), databaseReady ? probeDetail("storage") : (storageEngine || "missing"), "数据库运维", "configure the supported production SQLite runtime, backups and collection-version CAS, then archive a fresh transactional storage probe receipt; PostgreSQL remains blocked until its public runtime adapter is enabled"),
    check("runtime:session-secrets", "strong session secrets", sessionSecrets.length >= 1 && sessionSecrets.every((item) => secretReady(item)), `${sessionSecrets.length} configured`, "安全运维", "configure non-demo SESSION_SECRETS with at least 32 characters each"),
    check("runtime:integration-secret", "strong integration signing secret", secretReady(env.INTEGRATION_GATEWAY_SECRET), env.INTEGRATION_GATEWAY_SECRET ? "configured" : "missing", "接口运维", "configure INTEGRATION_GATEWAY_SECRET"),
    check(
      "runtime:identity",
      "government identity and family authorization",
      httpsUrl(env.OIDC_ISSUER_URL) && Boolean(env.OIDC_CLIENT_ID) && secretReady(env.OIDC_CLIENT_SECRET)
        && probesReady("identity"),
      env.OIDC_ISSUER_URL ? probeDetail("identity") : "missing",
      "统一身份责任方",
      "configure production OIDC issuer, client and secret; complete resident/family scope joint test"
    ),
    check(
      "runtime:sms",
      "SMS gateway and signed callback",
      httpsUrl(env.SMS_GATEWAY_URL) && Boolean(env.SMS_TEMPLATE_ID)
        && secretReady(env.SMS_GATEWAY_TOKEN) && secretReady(env.SMS_DELIVERY_CALLBACK_SECRET)
        && probesReady("sms"),
      env.SMS_GATEWAY_URL ? probeDetail("sms") : "missing",
      "消息平台责任方",
      "configure HTTPS SMS gateway, approved template, credential and callback secret"
    ),
    check(
      "runtime:hospital",
      "HIS and appointment adapters",
      configuredSignedEndpoint(env, "HIS_ADAPTER_URL", ["HIS_ADAPTER_SECRET", "HOSPITAL_ADAPTER_SECRET"])
        && configuredSignedEndpoint(env, "APPOINTMENT_ADAPTER_URL", ["APPOINTMENT_ADAPTER_SECRET", "HOSPITAL_ADAPTER_SECRET"])
        && probesReady("his", "appointment"),
      env.HIS_ADAPTER_URL && env.APPOINTMENT_ADAPTER_URL ? probeDetail("his", "appointment") : "missing",
      "医院信息科",
      "configure HTTPS HIS and appointment endpoints with signing secrets"
    ),
    check(
      "runtime:object-storage",
      "clinical evidence object storage",
      secureObjectStorage.adapterReady && probesReady("object-storage"),
      secureObjectStorage.adapterReady ? probeDetail("object-storage") : secureObjectStorage.blockers.join("; "),
      "存储运维",
      "configure object-storage-gateway-trust-v1, independent request/receipt keys, exact upload/download origins, retention and malware scan"
    ),
    check(
      "runtime:financial",
      "payment insurance and certificate gateways",
      [
        ["PAYMENT_GATEWAY_URL", "PAYMENT_GATEWAY_SECRET", "PAYMENT_CALLBACK_SECRET"],
        ["INSURANCE_GATEWAY_URL", "INSURANCE_GATEWAY_SECRET", "INSURANCE_CALLBACK_SECRET"],
        ["CERTIFICATE_GATEWAY_URL", "CERTIFICATE_GATEWAY_SECRET", "CERTIFICATE_CALLBACK_SECRET"]
      ].every(([url, secret, callback]) => httpsUrl(env[url]) && secretReady(env[secret]) && secretReady(env[callback]))
        && probesReady("payment", "insurance", "certificate"),
      env.PAYMENT_GATEWAY_URL && env.INSURANCE_GATEWAY_URL && env.CERTIFICATE_GATEWAY_URL
        ? probeDetail("payment", "insurance", "certificate")
        : "missing",
      "财务/医保/签章责任方",
      "configure signed HTTPS payment, insurance and certificate gateways and callbacks"
    ),
    check(
      "runtime:audit",
      "audit retention and SIEM",
      Boolean(
        (productionValueReady(env.AUDIT_EXPORT_PATH) && env.AUDIT_EXPORT_PATH)
        || httpsUrl(env.SIEM_ENDPOINT)
      ) && probesReady("audit"),
      env.AUDIT_EXPORT_PATH || env.SIEM_ENDPOINT ? probeDetail("audit") : "missing",
      "安全运维",
      "configure immutable audit export or HTTPS SIEM endpoint"
    ),
    check(
      "runtime:outbox-worker",
      "outbox worker deployment",
      enabled(env.CARE_OUTBOX_WORKER_ENABLED)
        && Boolean(String(env.CARE_OUTBOX_WORKER_ID || "").trim())
        && runtimeModuleReady
        && !/replace-with|placeholder|example/i.test(runtimeModuleValue)
        && probesReady("outbox-worker"),
      enabled(env.CARE_OUTBOX_WORKER_ENABLED) ? probeDetail("outbox-worker") : "disabled",
      "平台运维",
      "deploy the care-service outbox worker with a stable worker identity, T00 runtime module and health scrape"
    ),
    check(
      "runtime:care-delivery",
      "signed nursing and escort delivery endpoints",
      configuredSignedEndpoint(env, "CARE_NURSING_DELIVERY_URL", ["CARE_NURSING_DELIVERY_SECRET", "CARE_OUTBOX_DELIVERY_SECRET"])
        && configuredSignedEndpoint(env, "CARE_ESCORT_DELIVERY_URL", ["CARE_ESCORT_DELIVERY_SECRET", "CARE_OUTBOX_DELIVERY_SECRET"])
        && probesReady("nursing-delivery", "escort-delivery"),
      env.CARE_NURSING_DELIVERY_URL && env.CARE_ESCORT_DELIVERY_URL
        ? probeDetail("nursing-delivery", "escort-delivery")
        : "missing",
      "平台接口运维",
      "configure both signed HTTPS care-service delivery endpoints and managed secrets"
    ),
    check(
      "runtime:dependency-evidence",
      "fresh production dependency evidence manifest",
      dependencyEvidence.ok,
      dependencyEvidence.ok
        ? `${dependencyEvidence.healthyDependencies.length} target-bound probes verified`
        : dependencyEvidence.errors.map((error) => error.code).join(", "),
      "平台运维/接口责任方",
      "run approved production probes, archive independent receipts, and pin the exact dependency evidence manifest SHA-256"
    )
  ];
}

function buildSignoffChecks(cutoverEvidence) {
  const definitions = [
    ["signoff:business", "business", "service catalog, risk and operating procedure signoff", "老龄健康/护理管理部门"],
    ["signoff:interface", "interface", "identity, message, HIS and gateway joint-test signoff", "医院信息科/接口责任方"],
    ["signoff:security", "security", "privacy, security assessment and audit signoff", "网信与安全责任部门"],
    ["signoff:dr", "dr", "backup restore and disaster recovery rehearsal signoff", "数据库与灾备责任方"],
    ["signoff:oncall", "oncall", "monitoring, alert and on-call handoff signoff", "运维值守负责人"]
  ];
  const globalErrors = cutoverEvidence.errors.filter((error) => (
    !error.scope || !cutoverEvidence.requiredScopes.includes(error.scope)
  ));
  return definitions.map(([id, scope, name, owner]) => {
    const scopeErrors = cutoverEvidence.errors.filter((error) => error.scope === scope);
    const passed = globalErrors.length === 0 && scopeErrors.length === 0
      && cutoverEvidence.approvedScopes.includes(scope);
    const codes = [...globalErrors, ...scopeErrors].map((error) => error.code);
    return check(
      id,
      name,
      passed,
      passed ? `approved in ${cutoverEvidence.releaseId}` : (codes.join(", ") || "approval missing"),
      owner,
      "archive the signed evidence packet, add a current independent approval to the cutover manifest, and pin the exact manifest SHA-256 in deployment configuration",
      "signoff"
    );
  });
}

function buildCareServiceProductionReadiness(options = {}) {
  const env = options.env || process.env;
  const data = options.data || readJson("data/db.json");
  const sources = options.sources || {
    domain: readText("nursing-escort-domain.js"),
    nursing: readText("internet-nursing-service.js"),
    escort: readText("escort-service.js"),
    runtime: readText("care-service-runtime.js"),
    platformAdapter: readText("care-service-platform-adapter.js"),
    stateRepository: readText("care-service-state-repository.js"),
    deliveryAdapters: readText("care-service-delivery-adapters.js"),
    productionRuntime: readText("care-service-production-runtime.js"),
    server: readRuntimeSource(ROOT),
    worker: readText("scripts/care-service-outbox-worker.js"),
    workerService: readText("deploy/care-service-outbox-worker.service.template"),
    workerTimer: readText("deploy/care-service-outbox-worker.timer.template"),
    workerEnv: readText("deploy/care-service-outbox.env.template"),
    cutoverEvidence: readText("care-service-cutover-evidence.js"),
    cutoverEvidenceTest: readText("test/care-service-cutover-evidence.test.js"),
    cutoverEnv: readText("deploy/care-service-cutover.env.template"),
    cutoverTemplate: readText("deploy/care-service-cutover-evidence.template.json"),
    dependencyEvidence: readText("care-service-dependency-evidence.js"),
    dependencyEvidenceTest: readText("test/care-service-dependency-evidence.test.js"),
    dependencyTargets: readText("scripts/care-service-dependency-targets.js"),
    dependencyTargetsTest: readText("test/care-service-dependency-targets.test.js"),
    dependencyEvidenceEnv: readText("deploy/care-service-dependency-evidence.env.template"),
    dependencyEvidenceTemplate: readText("deploy/care-service-dependency-evidence.template.json"),
    runtimeTest: readText("test/care-service-runtime.test.js"),
    platformAdapterTest: readText("test/care-service-platform-adapter.test.js"),
    workerTest: readText("test/care-service-outbox-worker.test.js"),
    nursingTest: readText("test/internet-nursing-service.test.js"),
    escortTest: readText("test/escort-service.test.js")
  };
  const codeChecks = buildCodeChecks(sources);
  const dependencyEvidence = DependencyEvidence.loadDependencyEvidence(env, {
    root: ROOT,
    at: options.at || new Date().toISOString(),
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    maximumAgeMinutes: Number(env.CARE_DEPENDENCY_PROBE_MAX_AGE_MINUTES || 15)
  });
  const environmentChecks = buildEnvironmentChecks(env, dependencyEvidence);
  const platformWired = (
    /createCareServicePlatformAdapter/.test(sources.server || "")
    && /createCareServiceRuntimeDependencies/.test(sources.server || "")
    && /createCareServiceStateRepository/.test(sources.server || "")
    && /recordNotificationReceipt/.test(sources.server || "")
    && /\/api\/care-services\/outbox\/health/.test(sources.server || "")
    && /\/api\/care-services\/outbox\/worker\/run/.test(sources.server || "")
    && /createCareServiceRuntimeDependencies/.test(sources.productionRuntime || "")
    && /CARE_REPOSITORY_VERSION_CONFLICT/.test(sources.stateRepository || "")
    && /x-care-signature/.test(sources.deliveryAdapters || "")
  );
  const cutoverEvidence = CutoverEvidence.loadCutoverEvidence(env, {
    root: ROOT,
    at: options.at || new Date().toISOString(),
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    maximumAgeDays: Number(env.CARE_CUTOVER_SIGNOFF_MAX_AGE_DAYS || 30)
  });
  const signoffChecks = buildSignoffChecks(cutoverEvidence);
  const platformCheck = check(
    "platform:public-write-integration",
    "public API transaction and worker integration",
    options.platformIntegrated === true || platformWired,
    options.platformIntegrated === true
      ? "verified by injected integration evidence"
      : platformWired
        ? "public API, transaction repository, signed delivery and worker wiring verified"
        : "public API, transaction repository, signed delivery or worker markers missing",
    "T00 平台集成",
    "wire the T06 service and runtime adapters into the public server repository transaction and worker endpoints",
    "platform"
  );
  const outboxHealth = Runtime.buildOutboxHealth(data, {
    at: options.at || new Date().toISOString(),
    maxPendingAgeSeconds: Number(env.CARE_OUTBOX_MAX_PENDING_AGE_SECONDS || 300)
  });
  const outboxCheck = check(
    "runtime:outbox-health",
    "outbox integrity and backlog health",
    outboxHealth.ok,
    `${outboxHealth.summary.pending} pending, ${outboxHealth.summary.deadLetters} dead letters, ${outboxHealth.summary.integrityFailures} integrity failures`,
    "平台运维",
    "clear dead letters, expired leases, overdue events and integrity failures before cutover"
  );
  const checks = [...codeChecks, platformCheck, ...environmentChecks, outboxCheck, ...signoffChecks];
  const codeReady = codeChecks.every((item) => item.passed);
  const platformIntegrated = platformCheck.passed;
  const runtimeReady = [...environmentChecks, outboxCheck].every((item) => item.passed);
  const signoffsReady = signoffChecks.every((item) => item.passed);
  const productionReady = codeReady && platformIntegrated && runtimeReady && signoffsReady;
  const blockers = checks.filter((item) => !item.passed);
  return {
    generatedAt: options.at || new Date().toISOString(),
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    codeReady,
    platformIntegrated,
    runtimeReady,
    signoffsReady,
    productionReady,
    formalGoLiveState: !codeReady
      ? "blocked-by-code"
      : !platformIntegrated
        ? "blocked-by-platform-integration"
      : !runtimeReady
        ? "blocked-by-production-configuration-or-health"
        : !signoffsReady
          ? "blocked-until-site-evidence-signed"
          : "ready-for-production-cutover",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      blockers: blockers.length,
      codeBlockers: blockers.filter((item) => item.category === "code").length,
      platformBlockers: blockers.filter((item) => item.category === "platform").length,
      runtimeBlockers: blockers.filter((item) => item.category === "external").length,
      signoffBlockers: blockers.filter((item) => item.category === "signoff").length
    },
    checks,
    blockers,
    outboxHealth,
    dependencyEvidence,
    cutoverEvidence,
    boundary: "A production-ready result requires real production configuration, healthy delivery state and a deployment-pinned manifest of current independent site approvals. Demo values or standalone signed flags must not be used to satisfy cutover."
  };
}

function renderMarkdown(report) {
  return [
    "# Internet nursing and escort production readiness",
    "",
    `Generated at: ${report.generatedAt}`,
    `Formal go-live state: ${report.formalGoLiveState}`,
    `Code ready: ${report.codeReady ? "YES" : "NO"}`,
    `Platform integrated: ${report.platformIntegrated ? "YES" : "NO"}`,
    `Runtime ready: ${report.runtimeReady ? "YES" : "NO"}`,
    `Site signoffs ready: ${report.signoffsReady ? "YES" : "NO"}`,
    `Production ready: ${report.productionReady ? "YES" : "NO"}`,
    "",
    "## Boundary",
    "",
    report.boundary,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Owner | Detail | Required action |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "BLOCK"} | ${item.category} | ${item.name} | ${item.owner} | ${String(item.detail).replace(/\|/g, "/")} | ${item.passed ? "" : String(item.action).replace(/\|/g, "/")} |`),
    "",
    "## Outbox health",
    "",
    `- Total: ${report.outboxHealth.summary.total}`,
    `- Pending: ${report.outboxHealth.summary.pending}`,
    `- Delivered: ${report.outboxHealth.summary.delivered}`,
    `- Dead letters: ${report.outboxHealth.summary.deadLetters}`,
    `- Stale leases: ${report.outboxHealth.summary.staleLeases}`,
    `- Overdue: ${report.outboxHealth.summary.overdue}`,
    `- Integrity failures: ${report.outboxHealth.summary.integrityFailures}`,
    "",
    "## Production dependency evidence",
    "",
    `- Manifest valid: ${report.dependencyEvidence.ok ? "YES" : "NO"}`,
    `- Release ID: ${report.dependencyEvidence.releaseId || "missing"}`,
    `- Healthy dependencies: ${report.dependencyEvidence.healthyDependencies.join(", ") || "none"}`,
    `- Validation errors: ${report.dependencyEvidence.errors.map((item) => item.code).join(", ") || "none"}`,
    "",
    "## Cutover evidence",
    "",
    `- Manifest valid: ${report.cutoverEvidence.ok ? "YES" : "NO"}`,
    `- Release ID: ${report.cutoverEvidence.releaseId || "missing"}`,
    `- Approved scopes: ${report.cutoverEvidence.approvedScopes.join(", ") || "none"}`,
    `- Validation errors: ${report.cutoverEvidence.errors.map((item) => item.code).join(", ") || "none"}`
  ].join("\n");
}

function writeReport(report, jsonPath = DEFAULT_JSON, markdownPath = DEFAULT_MARKDOWN) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
}

function main() {
  const report = buildCareServiceProductionReadiness();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.codeReady) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  buildCareServiceProductionReadiness,
  renderMarkdown,
  writeReport
};
