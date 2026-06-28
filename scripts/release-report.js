#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildAuditRetentionReport, renderMarkdown: renderAuditRetentionMarkdown } = require("./audit-retention");
const { buildChronicFollowupReadinessReport, renderMarkdown: renderChronicFollowupMarkdown } = require("./chronic-followup-readiness");
const { buildDataQualityReport, renderMarkdown: renderDataQualityMarkdown } = require("./data-quality-report");
const { buildEvaluationEvidenceReport, renderMarkdown: renderEvaluationEvidenceMarkdown } = require("./evaluation-evidence");
const { buildEnvironmentMatrixReport, renderMarkdown: renderEnvironmentMatrixMarkdown } = require("./environment-matrix");
const { buildIdentityContract, renderMarkdown: renderIdentityContractMarkdown } = require("./identity-contract");
const { buildIntegrationReadinessReport, renderMarkdown: renderIntegrationReadinessMarkdown } = require("./integration-readiness");
const { buildInterfaceMappingReport, renderMarkdown: renderInterfaceMappingMarkdown } = require("./interface-mapping");
const { buildMonitoringReadinessReport, renderMarkdown: renderMonitoringReadinessMarkdown } = require("./monitoring-readiness");
const { buildOperationsReadinessReport, renderMarkdown: renderOperationsReadinessMarkdown } = require("./operations-readiness");
const { buildProcessAuditReport, renderMarkdown: renderProcessAuditMarkdown } = require("./process-audit");
const { buildProductionDbReadinessReport, renderMarkdown: renderProductionDbReadinessMarkdown } = require("./production-db-readiness");
const { buildReleaseArtifactManifest, renderMarkdown: renderReleaseArtifactManifestMarkdown } = require("./release-artifact-manifest");
const { buildSiteReadinessPack, renderMarkdown: renderSiteReadinessMarkdown, writeTemplateReadmes } = require("./site-readiness-pack");
const { inspectStorageModel } = require("./storage-admin");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_RELEASE_DIR = path.join(ROOT, "release");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "report", ...rawFlags] = argv;
  const flags = {};
  rawFlags.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return { command, flags };
}

function readEnvFile(file) {
  if (!file) return {};
  const resolved = path.resolve(ROOT, file);
  if (!fs.existsSync(resolved)) return {};
  return Object.fromEntries(fs.readFileSync(resolved, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const [key, ...valueParts] = line.split("=");
      return [key.trim(), valueParts.join("=").trim().replace(/^["']|["']$/g, "")];
    }));
}

function hasPlaceholder(value) {
  return /replace-with|change-me|changeme|demo-|demo_|example|placeholder/i.test(String(value || ""));
}

function secretQuality(value, minLength = 32) {
  const text = String(value || "");
  return {
    present: Boolean(text),
    length: text.length,
    placeholder: hasPlaceholder(text),
    strongEnough: text.length >= minLength && !hasPlaceholder(text)
  };
}

function check(name, passed, detail, severity = "error", category = "release") {
  return { name, category, severity, passed: Boolean(passed), detail };
}

function envFlagEnabled(env, name) {
  return /^(1|true|yes|ready|signed|approved)$/i.test(String(env[name] || "").trim());
}

function buildProductionCutoverChecklist(env, checks = []) {
  const byName = Object.fromEntries(checks.map((item) => [item.name, item]));
  const ready = (...names) => names.every((name) => byName[name]?.passed);
  const detail = (...names) => names.map((name) => `${name}: ${byName[name]?.detail || "missing"}`).join("; ");
  const signoff = (name) => `${name}: ${envFlagEnabled(env, name) ? "signed" : "missing site signoff"}`;
  const storageEngine = String(env.STORAGE_ENGINE || "auto").toLowerCase();
  return [
    {
      id: "cutover-env-file",
      phase: "environment",
      owner: "platform-ops",
      passed: ready("env:file", "env:NODE_ENV.production", "env:STORAGE_ENGINE", "env:STORAGE_ENGINE.production"),
      evidence: detail("env:file", "env:NODE_ENV.production", "env:STORAGE_ENGINE", "env:STORAGE_ENGINE.production"),
      nextAction: "在目标服务器创建真实 .env，设置 NODE_ENV=production，并确认不使用 JSON 作为生产主存储。"
    },
    {
      id: "cutover-secrets",
      phase: "security",
      owner: "security-admin",
      passed: ready("env:SESSION_SECRETS.present", "env:SESSION_SECRETS.productionQuality", "env:INTEGRATION_GATEWAY_SECRET.present", "env:INTEGRATION_GATEWAY_SECRET.productionQuality"),
      evidence: detail("env:SESSION_SECRETS.present", "env:SESSION_SECRETS.productionQuality", "env:INTEGRATION_GATEWAY_SECRET.present", "env:INTEGRATION_GATEWAY_SECRET.productionQuality"),
      nextAction: "生成不少于 32 位、非占位的会话密钥和接口网关 HMAC 密钥；按轮换策略把新密钥放在 SESSION_SECRETS 首位。"
    },
    {
      id: "cutover-identity",
      phase: "identity",
      owner: "identity-integration",
      passed: ready("env:OIDC.identityAdapter"),
      evidence: detail("env:OIDC.identityAdapter"),
      nextAction: "确认政务统一认证 OIDC/SAML 参数、客户端密钥、回调地址、机构目录和医生身份源映射。"
    },
    {
      id: "cutover-audit-retention",
      phase: "audit",
      owner: "security-admin",
      passed: ready("env:AUDIT.retentionTarget"),
      evidence: detail("env:AUDIT.retentionTarget"),
      nextAction: "配置 AUDIT_EXPORT_PATH 或 SIEM_ENDPOINT，并确认日志保全、留存年限、访问审计和导出权限。"
    },
    {
      id: "cutover-storage-adapter",
      phase: "storage",
      owner: "data-platform",
      passed: ready("env:STORAGE_ENGINE.runtimeAdapter", "env:DATABASE_URL.requiredForPostgres") && !["postgres", "postgresql"].includes(storageEngine),
      evidence: detail("env:STORAGE_ENGINE.runtimeAdapter", "env:DATABASE_URL.requiredForPostgres"),
      nextAction: "当前运行时支持 auto/sqlite；如切换 PostgreSQL，需先完成正式数据库适配器、迁移、回滚和原生备份演练。"
    },
    {
      id: "cutover-institution-interfaces",
      phase: "integration",
      owner: "institution-integration",
      passed: ready("integration:p0Coverage", "integration:contractsReady", "interfaceMapping:report", "interfaceMapping:requiredFields") && envFlagEnabled(env, "CUTOVER_SITE_INTERFACE_SIGNOFF"),
      evidence: `${detail("integration:p0Coverage", "integration:contractsReady", "interfaceMapping:report", "interfaceMapping:requiredFields")}; ${signoff("CUTOVER_SITE_INTERFACE_SIGNOFF")}`,
      nextAction: "Archive signed HIS/EMR/LIS/PACS and referral joint-test records from the target site before production cutover."
    },
    {
      id: "cutover-insurance-certificate",
      phase: "integration",
      owner: "cross-agency-integration",
      passed: ready("integration:contractsReady") && envFlagEnabled(env, "CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF"),
      evidence: `${detail("integration:contractsReady")}; ${signoff("CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF")}`,
      nextAction: "Attach signed insurance settlement, electronic certificate, and statistics exchange acceptance evidence from upstream agencies."
    },
    {
      id: "cutover-monitoring",
      phase: "operations",
      owner: "platform-ops",
      passed: ready("operations:readiness", "operations:routes", "operations:externalDependencies", "monitoring:readiness", "monitoring:sloTargets") && envFlagEnabled(env, "CUTOVER_MONITORING_SIGNOFF"),
      evidence: `${detail("operations:readiness", "operations:routes", "operations:externalDependencies", "monitoring:readiness", "monitoring:sloTargets")}; ${signoff("CUTOVER_MONITORING_SIGNOFF")}`,
      nextAction: "Bind /api/health, /api/metrics, readiness, alert routing, and on-call escalation to the production monitoring platform."
    },
    {
      id: "cutover-dr-rehearsal",
      phase: "resilience",
      owner: "data-platform",
      passed: ready("operations:externalDependencies", "storage:jsonSnapshot.present") && envFlagEnabled(env, "CUTOVER_DR_REHEARSAL_SIGNOFF"),
      evidence: `${detail("operations:externalDependencies", "storage:jsonSnapshot.present")}; ${signoff("CUTOVER_DR_REHEARSAL_SIGNOFF")}`,
      nextAction: "Complete production-grade backup, cross-site replica, RTO/RPO, and restore rehearsal signoff; demo snapshot rehearsal is not sufficient."
    }
  ];
}

function validateProductionConfig(options = {}) {
  const profile = String(options.profile || "demo").toLowerCase();
  const envFile = options.envFile || ".env.example";
  const envFileExists = !envFile || fs.existsSync(path.resolve(ROOT, envFile));
  const env = { ...readEnvFile(envFile), ...options.env };
  const strict = profile === "production" || options.strict === true;
  const sessionSecrets = String(env.SESSION_SECRETS || env.SESSION_SECRET || "");
  const sessionSecretItems = sessionSecrets.split(",").map((item) => item.trim()).filter(Boolean);
  const gatewaySecret = String(env.INTEGRATION_GATEWAY_SECRET || "");
  const storageEngine = String(env.STORAGE_ENGINE || "auto").toLowerCase();
  const nodeEnv = String(env.NODE_ENV || "");

  const checks = [
    check("env:file", envFileExists, envFileExists ? envFile : `${envFile} missing`, strict ? "error" : "warn", "environment"),
    check("env:NODE_ENV", Boolean(nodeEnv), nodeEnv || "missing", strict ? "error" : "warn", "environment"),
    check("env:STORAGE_ENGINE", ["auto", "json", "sqlite", "postgres", "postgresql"].includes(storageEngine), storageEngine, "error", "environment"),
    check("env:SESSION_SECRETS.present", sessionSecretItems.length > 0, `${sessionSecretItems.length} configured`, "error", "environment"),
    check("env:SESSION_SECRETS.productionQuality", !strict || sessionSecretItems.every((item) => secretQuality(item).strongEnough), strict ? "production secrets must be non-placeholder and at least 32 chars" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:INTEGRATION_GATEWAY_SECRET.present", Boolean(gatewaySecret), gatewaySecret ? "configured" : "missing", "error", "environment"),
    check("env:INTEGRATION_GATEWAY_SECRET.productionQuality", !strict || secretQuality(gatewaySecret).strongEnough, strict ? "production secret must be non-placeholder and at least 32 chars" : "not enforced outside production", strict ? "error" : "warn", "environment")
  ];

  if (strict) {
    checks.push(
      check("env:NODE_ENV.production", nodeEnv === "production", nodeEnv || "missing", "error", "environment"),
      check("env:STORAGE_ENGINE.production", storageEngine !== "json", "json storage is demo-only", "error", "environment"),
      check("env:STORAGE_ENGINE.runtimeAdapter", ["auto", "sqlite"].includes(storageEngine), ["auto", "sqlite"].includes(storageEngine) ? storageEngine : `${storageEngine} adapter not enabled`, "error", "environment"),
      check("env:DATABASE_URL.requiredForPostgres", !["postgres", "postgresql"].includes(storageEngine) || Boolean(env.DATABASE_URL), env.DATABASE_URL ? "configured" : "missing", "error", "environment"),
      check("env:OIDC.identityAdapter", Boolean(env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET), env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET ? "configured" : "missing OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET", "error", "environment"),
      check("env:AUDIT.retentionTarget", Boolean(env.AUDIT_EXPORT_PATH || env.SIEM_ENDPOINT), env.AUDIT_EXPORT_PATH || env.SIEM_ENDPOINT ? "configured" : "missing AUDIT_EXPORT_PATH or SIEM_ENDPOINT", "error", "environment")
    );
  }

  return {
    profile,
    envFile,
    passed: checks.every((item) => item.severity !== "error" || item.passed),
    checks,
    cutoverChecklist: buildProductionCutoverChecklist(env, checks)
  };
}

function assertFile(relativePath) {
  const file = path.join(ROOT, relativePath);
  return check(`file:${relativePath}`, fs.existsSync(file), fs.existsSync(file) ? "present" : "missing", "error", "files");
}

function snapshotChecks(data) {
  const requiredCollections = [
    "residents",
    "authUsers",
    "platformRoadmap",
    "platformEvidence",
    "platformInterfaces",
    "productionDeploymentPlan",
    "institutionCreditEvaluations",
    "researchDatasets",
    "diseaseRegistryModels",
    "accessibilityChecklist",
    "securityAcceptanceLedger"
  ];
  const raw = fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8");
  const p2 = (data.platformRoadmap || []).filter((item) => item.priority === "P2");
  const evidence = Array.isArray(data.platformEvidence) ? data.platformEvidence : [];
  const acceptanceRecords = evidence.flatMap((item) => item.records || []);
  const securityAcceptanceLedger = Array.isArray(data.securityAcceptanceLedger) ? data.securityAcceptanceLedger : [];
  const productionDeploymentPlan = Array.isArray(data.productionDeploymentPlan) ? data.productionDeploymentPlan : [];
  const p0Interfaces = (Array.isArray(data.platformInterfaces) ? data.platformInterfaces : []).filter((item) => item.priority === "P0");
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const externalDependencyRiskIds = [
    "identity-source",
    "institution-systems",
    "insurance-core",
    "certificate-sharing",
    "security-assessment",
    "disaster-recovery"
  ];

  return [
    check("snapshot:collections", requiredCollections.every((key) => data[key]), requiredCollections.filter((key) => !data[key]).join(",") || "all present", "error", "snapshot"),
    check("snapshot:p2Complete", p2.length > 0 && p2.every((item) => item.status === "已完成"), p2.map((item) => `${item.title}:${item.status}`).join(";"), "error", "snapshot"),
    check("snapshot:acceptanceEvidence", acceptanceRecords.length >= 2, `${acceptanceRecords.length} evidence records`, "error", "snapshot"),
    check("snapshot:securityAcceptance", securityAcceptanceLedger.length >= 4 && securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), `${securityAcceptanceLedger.length} security acceptance items`, "error", "snapshot"),
    check("snapshot:productionDeploymentPlan", productionDeploymentPlan.length >= 4 && productionDeploymentPlan.every((item) => item.id && item.owner && item.nextAction), `${productionDeploymentPlan.length} deployment tracks`, "error", "snapshot"),
    check("snapshot:interfaceReadiness", p0Interfaces.length >= 4 && p0Interfaces.every((item) => item.id && item.owner && item.status && item.next), `${p0Interfaces.length} P0 interface tracks`, "error", "snapshot"),
    check("snapshot:externalDependencyRisks", externalDependencyRiskIds.every((id) => serverSource.includes(id)), `${externalDependencyRiskIds.length} external dependency risks`, "error", "snapshot"),
    check("snapshot:noCorruptedPlaceholders", !/编码损坏|缂栫爜鎹熷潖|\?\?\?/.test(raw), "no known corrupted placeholders", "error", "snapshot"),
    check("snapshot:accessibility", Array.isArray(data.accessibilityChecklist) && data.accessibilityChecklist.length >= 5, `${data.accessibilityChecklist?.length || 0} checklist items`, "error", "snapshot")
  ];
}

function storageModelChecks(storageModel) {
  const json = storageModel.jsonSnapshot || {};
  const sqlite = storageModel.sqlite || {};
  return [
    check("storage:jsonSnapshot.present", json.present, json.file || "missing", "error", "storage"),
    check("storage:jsonSnapshot.collections", Number(json.collections || 0) >= 40, `${json.collections || 0} collections`, "error", "storage"),
    check("storage:jsonSnapshot.records", Number(json.totalRecords || 0) >= 1, `${json.totalRecords || 0} records`, "error", "storage"),
    check("storage:sqlite.inspectable", !sqlite.present || sqlite.available, sqlite.present ? (sqlite.available ? `${sqlite.tableCount || 0} tables` : sqlite.error || "unavailable") : "sqlite file not present in this checkout", sqlite.present ? "error" : "warn", "storage")
  ];
}

function identityContractChecks(identityContract) {
  return [
    check("identity:contract", identityContract.ok, identityContract.ok ? "all identity contract checks passed" : "identity contract failed", "error", "identity"),
    check("identity:requiredClaims", identityContract.requiredClaims?.filter((item) => item.required).length >= 5, `${identityContract.requiredClaims?.length || 0} claims`, "error", "identity"),
    check("identity:sampleMappings", identityContract.sampleMappings?.every((item) => item.passed), `${identityContract.sampleMappings?.length || 0} samples`, "error", "identity")
  ];
}

function auditRetentionChecks(auditRetention) {
  return [
    check("audit:retention", auditRetention.ok, auditRetention.ok ? "audit retention checks passed" : "audit retention checks failed", "error", "audit"),
    check("audit:exportDigest", Boolean(auditRetention.exportDigest), auditRetention.exportDigest || "missing", "error", "audit"),
    check("audit:retentionTargetConfigured", auditRetention.retentionTargets?.some((item) => item.configured), "production target is required during site cutover", "warn", "audit")
  ];
}

function chronicFollowupChecks(chronicFollowup) {
  return [
    check("chronicFollowup:readiness", chronicFollowup.ok, chronicFollowup.ok ? "chronic follow-up readiness checks passed" : "chronic follow-up readiness checks failed", "error", "chronic-followup"),
    check("chronicFollowup:boundaries", chronicFollowup.summary?.passed === chronicFollowup.summary?.boundaries, `${chronicFollowup.summary?.passed || 0}/${chronicFollowup.summary?.boundaries || 0} boundaries`, "error", "chronic-followup"),
    check("chronicFollowup:policyAlignment", chronicFollowup.summary?.policyAligned === chronicFollowup.summary?.policyItems && chronicFollowup.summary?.policyItems >= 7, `${chronicFollowup.summary?.policyAligned || 0}/${chronicFollowup.summary?.policyItems || 0} policy items`, "error", "chronic-followup"),
    check("chronicFollowup:alertQueue", chronicFollowup.summary?.alerts >= 1 && chronicFollowup.summary?.highPriorityAlerts >= 1, `${chronicFollowup.summary?.alerts || 0} alerts; high=${chronicFollowup.summary?.highPriorityAlerts || 0}`, "error", "chronic-followup"),
    check("chronicFollowup:residentExperience", chronicFollowup.summary?.selfMonitoringRecords >= 1 && chronicFollowup.summary?.satisfactionRecords >= 1 && chronicFollowup.summary?.familyProxyRecords >= 1, `${chronicFollowup.summary?.residentExperienceItems || 0} resident experience evidence items`, "error", "chronic-followup"),
    check("chronicFollowup:fieldIntegration", chronicFollowup.summary?.deviceMeasurementRecords >= 1 && chronicFollowup.summary?.pharmacyCallbackRecords >= 1 && chronicFollowup.summary?.familyDoctorClosureRecords >= 1 && chronicFollowup.summary?.reminderOutreachRecords >= 1, `${chronicFollowup.summary?.fieldIntegrationItems || 0} field integration evidence items`, "error", "chronic-followup"),
    check("chronicFollowup:feedback", chronicFollowup.summary?.feedbackRecords >= 1, `${chronicFollowup.summary?.feedbackRecords || 0} feedback records`, "error", "chronic-followup"),
    check("chronicFollowup:notifications", chronicFollowup.summary?.notificationMessages >= 1, `${chronicFollowup.summary?.notificationMessages || 0} notification messages`, "error", "chronic-followup")
  ];
}

function integrationReadinessChecks(integrationReadiness) {
  return [
    check("integration:readiness", integrationReadiness.ok, integrationReadiness.ok ? "integration readiness checks passed" : "integration readiness checks failed", "error", "integration"),
    check("integration:contractsReady", integrationReadiness.contracts?.every((item) => item.status === "ready"), `${integrationReadiness.contractCount || 0} contracts`, "error", "integration"),
    check("integration:p0Coverage", integrationReadiness.p0Coverage?.every((item) => item.ready), `${integrationReadiness.p0InterfaceCount || 0} P0 interfaces`, "error", "integration")
  ];
}

function interfaceMappingChecks(interfaceMapping) {
  return [
    check("interfaceMapping:report", interfaceMapping.ok, interfaceMapping.ok ? "interface field mappings passed" : "interface field mappings failed", "error", "integration"),
    check("interfaceMapping:requiredFields", interfaceMapping.mappings?.every((item) => item.fieldCoverage?.every((field) => field.mapped)), `${interfaceMapping.contractCount || 0} contracts mapped`, "error", "integration"),
    check("interfaceMapping:idempotency", interfaceMapping.mappings?.every((item) => item.idempotencyMapped), "idempotency keys mapped to platform fields", "error", "integration")
  ];
}

function evaluationEvidenceChecks(evaluationEvidence) {
  return [
    check("evaluation:evidence", evaluationEvidence.ok, evaluationEvidence.ok ? "evaluation evidence checks passed" : "evaluation evidence checks failed", "error", "evaluation"),
    check("evaluation:records", evaluationEvidence.interoperabilityEvidence?.records?.length >= 2, `${evaluationEvidence.interoperabilityEvidence?.records?.length || 0} evidence records`, "error", "evaluation"),
    check("evaluation:p1Requirements", evaluationEvidence.p1Requirements?.length >= 5, `${evaluationEvidence.p1Requirements?.length || 0} P1 requirements`, "error", "evaluation")
  ];
}

function environmentMatrixChecks(environmentMatrix) {
  return [
    check("environment:matrix", environmentMatrix.ok, environmentMatrix.ok ? "environment matrix checks passed" : "environment matrix checks failed", "error", "environment"),
    check("environment:profiles", environmentMatrix.profiles?.length === 3, `${environmentMatrix.profiles?.length || 0} environment profiles`, "error", "environment"),
    check("environment:gateScripts", environmentMatrix.profiles?.every((item) => item.missingScripts?.length === 0), "demo, staging, and production gate scripts mapped", "error", "environment")
  ];
}

function dataQualityChecks(dataQuality) {
  return [
    check("dataQuality:report", dataQuality.ok, dataQuality.ok ? "data quality checks passed" : "data quality checks failed", "error", "data-quality"),
    check("dataQuality:masterIndexCompleteness", dataQuality.scorecard?.residentIndexCompleteness === 100, `${dataQuality.scorecard?.residentIndexCompleteness || 0}% resident index completeness`, "error", "data-quality"),
    check("dataQuality:residentReferences", dataQuality.issues?.missingReferences?.length === 0, `${dataQuality.issues?.missingReferences?.length || 0} broken resident references`, "error", "data-quality")
  ];
}

function operationsReadinessChecks(operationsReadiness) {
  return [
    check("operations:readiness", operationsReadiness.ok, operationsReadiness.ok ? "operations readiness checks passed" : "operations readiness checks failed", "error", "operations"),
    check("operations:routes", operationsReadiness.operationRoutes?.every((item) => item.present && item.documented), `${operationsReadiness.operationRoutes?.length || 0} operation routes`, "error", "operations"),
    check("operations:externalDependencies", operationsReadiness.externalDependencies?.every((item) => item.present), `${operationsReadiness.externalDependencies?.length || 0} external dependencies`, "error", "operations")
  ];
}

function monitoringReadinessChecks(monitoringReadiness) {
  return [
    check("monitoring:readiness", monitoringReadiness.ok, monitoringReadiness.ok ? "monitoring readiness checks passed" : "monitoring readiness checks failed", "error", "monitoring"),
    check("monitoring:metricSignals", monitoringReadiness.metricSignals?.every((item) => item.present), `${monitoringReadiness.metricSignals?.length || 0} metric signals`, "error", "monitoring"),
    check("monitoring:sloTargets", monitoringReadiness.sloTargets?.every((item) => item.covered), `${monitoringReadiness.sloTargets?.length || 0} SLO targets`, "error", "monitoring")
  ];
}

function productionDbReadinessChecks(productionDbReadiness) {
  return [
    check("productionDb:readiness", productionDbReadiness.ok, productionDbReadiness.ok ? "production database readiness checks passed" : "production database readiness checks failed", "error", "production-db"),
    check("productionDb:runtimeBlock", productionDbReadiness.migrationEvidence?.runtimePostgresBlocked, "postgres runtime remains blocked until adapter cutover", "error", "production-db"),
    check("productionDb:rehearsalDocs", productionDbReadiness.rehearsalEvidence && Object.values(productionDbReadiness.rehearsalEvidence).every(Boolean), "backup, restore, RTO/RPO, and release artifact docs", "error", "production-db")
  ];
}

function processAuditChecks(processAudit) {
  return [
    check("process:audit", processAudit.ok, processAudit.ok ? "full process audit checks passed" : "full process audit checks failed", "error", "process-audit"),
    check("process:evidenceDomains", processAudit.evidenceDomains?.every((item) => item.passed), `${processAudit.summary?.passedDomains || 0}/${processAudit.summary?.evidenceDomains || 0} evidence domains`, "error", "process-audit"),
    check("process:matrixRows", processAudit.processRows?.length >= 10, `${processAudit.processRows?.length || 0} process rows`, "error", "process-audit")
  ];
}

function countOpen(items, closedStatuses = []) {
  const closed = new Set(closedStatuses);
  return (Array.isArray(items) ? items : []).filter((item) => !closed.has(item.status)).length;
}

function pickFirst(item, fields) {
  const field = fields.find((name) => item?.[name]);
  return field ? item[field] : "";
}

function actionPriorityOf(item) {
  const text = [item?.priority, item?.risk, item?.riskLevel, item?.grade, item?.status].filter(Boolean).join(" ");
  if (/高|危急|预警|逾期|紧急|high|urgent/i.test(text)) return "high";
  if (/中|待|需|warning|medium/i.test(text)) return "medium";
  return "normal";
}

function buildOpenActions(collection, domain, items, closedStatuses = []) {
  if (!closedStatuses.length) return [];
  const closed = new Set(closedStatuses);
  return (Array.isArray(items) ? items : [])
    .filter((item) => !closed.has(item.status))
    .map((item) => ({
      id: item.id || `${collection}-${item.residentId || item.status || "open"}`,
      collection,
      domain,
      subject: pickFirst(item, ["taskName", "topic", "diseaseType", "service", "metric", "medication", "orderType", "item", "chiefComplaint", "id"]),
      status: item.status || "open",
      owner: pickFirst(item, ["owner", "assignee", "provider", "institution", "center", "toInstitution", "sourceInstitution"]) || "owner-pending",
      due: pickFirst(item, ["due", "nextReview", "pushAt", "at", "requestedAt"]),
      priority: actionPriorityOf(item),
      nextAction: pickFirst(item, ["nextAction", "nextStep", "intervention", "result", "shortageAction", "current", "reason", "suggestion", "quality"]) || "next-action-pending",
      residentId: item.residentId || ""
    }))
    .sort((a, b) => ({ high: 3, medium: 2, normal: 1 }[b.priority] || 0) - ({ high: 3, medium: 2, normal: 1 }[a.priority] || 0));
}

function buildServiceAcceptanceSummary(data) {
  const chronicDomains = [
    ["screening", "Screening and risk stratification", "chronicScreeningTasks", data.chronicScreeningTasks, ["已评估", "已推送干预"]],
    ["education", "Precision education", "chronicEducationPushes", data.chronicEducationPushes, ["已确认", "已阅读"]],
    ["managementPlans", "Tiered management plans", "chronicManagementPlans", data.chronicManagementPlans, ["已复核"]],
    ["comorbidity", "Comorbidity management", "chronicComorbidityPlans", data.chronicComorbidityPlans, ["已复核"]],
    ["tcm", "TCM appropriate services", "chronicTcmServices", data.chronicTcmServices, ["已完成"]],
    ["selfManagement", "Self-management uploads", "chronicSelfManagement", data.chronicSelfManagement, ["已确认"]],
    ["medicationSupport", "Medication support", "chronicMedicationSupport", data.chronicMedicationSupport, ["运行中"]],
    ["quality", "Quality metrics", "chronicQualityMetrics", data.chronicQualityMetrics, ["已核验"]]
  ].map(([id, name, collection, items, closedStatuses]) => ({
    id,
    name,
    collection,
    rows: Array.isArray(items) ? items.length : 0,
    openItems: countOpen(items, closedStatuses),
    openActions: buildOpenActions(collection, id, items, closedStatuses),
    modeled: Array.isArray(items) && items.length > 0
  }));

  const countyDomains = [
    ["collaboration", "Collaboration orders", "countyCollaborationOrders", data.countyCollaborationOrders, ["已回传", "已完成"]],
    ["mutualRecognition", "Mutual recognition", "countyMutualRecognitionRecords", data.countyMutualRecognitionRecords, ["已互认"]],
    ["aiDiagnosis", "AI-assisted diagnosis", "countyAiDiagnosisCases", data.countyAiDiagnosisCases, ["已完成"]],
    ["diagnosticReports", "Diagnostic reports", "diagnosticReports", data.diagnosticReports, ["recognized", "completed", "已互认"]],
    ["performance", "Consortium performance", "medicalResources", data.performanceIndicators || data.countyPerformanceIndicators || data.medicalResources, []]
  ].map(([id, name, collection, items, closedStatuses]) => ({
    id,
    name,
    collection,
    rows: Array.isArray(items) ? items.length : 0,
    openItems: closedStatuses.length ? countOpen(items, closedStatuses) : 0,
    openActions: buildOpenActions(collection, id, items, closedStatuses),
    modeled: Array.isArray(items) && items.length > 0
  }));

  const summarize = (domains) => ({
    domains: domains.length,
    modeledDomains: domains.filter((item) => item.modeled).length,
    openItems: domains.reduce((sum, item) => sum + item.openItems, 0),
    openActions: domains.reduce((sum, item) => sum + item.openActions.length, 0),
    rows: domains.reduce((sum, item) => sum + item.rows, 0)
  });

  return {
    ok: chronicDomains.every((item) => item.modeled) && countyDomains.every((item) => item.modeled),
    chronic: { summary: summarize(chronicDomains), domains: chronicDomains, openActions: chronicDomains.flatMap((item) => item.openActions) },
    county: { summary: summarize(countyDomains), domains: countyDomains, openActions: countyDomains.flatMap((item) => item.openActions) }
  };
}

function serviceAcceptanceChecks(serviceAcceptance) {
  return [
    check("service:chronicDomains", serviceAcceptance.chronic.summary.modeledDomains === serviceAcceptance.chronic.summary.domains, `${serviceAcceptance.chronic.summary.modeledDomains}/${serviceAcceptance.chronic.summary.domains} chronic service domains modeled; open=${serviceAcceptance.chronic.summary.openItems}`, "error", "service"),
    check("service:countyDomains", serviceAcceptance.county.summary.modeledDomains === serviceAcceptance.county.summary.domains, `${serviceAcceptance.county.summary.modeledDomains}/${serviceAcceptance.county.summary.domains} county service domains modeled; open=${serviceAcceptance.county.summary.openItems}`, "error", "service")
  ];
}

function siteReadinessChecks(siteReadinessPack) {
  return [
    check("sitePack:readiness", siteReadinessPack.ok, siteReadinessPack.ok ? "site readiness pack checks passed" : "site readiness pack failed", "error", "site-pack"),
    check("sitePack:templates", siteReadinessPack.summary?.templateRows >= 20, `${siteReadinessPack.summary?.templateRows || 0} template rows`, "error", "site-pack"),
    check("sitePack:signoff", siteReadinessPack.templates?.signoff?.length >= 8, `${siteReadinessPack.templates?.signoff?.length || 0} signoff templates`, "error", "site-pack")
  ];
}

function packageChecks(pkg) {
  const requiredScripts = [
    "check",
    "test",
    "test:coverage",
    "test:e2e",
    "deploy:check",
    "env:check",
    "release:report",
    "release:manifest",
    "identity:contract",
    "audit:retention",
    "data-quality:report",
    "environment:matrix",
    "integration:readiness",
    "interface:mapping",
    "monitoring:readiness",
    "operations:readiness",
    "process:audit",
    "site:pack",
    "production-db:readiness",
    "evaluation:evidence",
    "storage:backup",
    "storage:inspect",
    "storage:assess",
    "rollback:snapshot"
  ];
  return [
    check("package:scripts", requiredScripts.every((name) => pkg.scripts?.[name]), requiredScripts.filter((name) => !pkg.scripts?.[name]).join(",") || "all required scripts present", "error", "package"),
    check("package:nodeEngine", Boolean(pkg.engines?.node), pkg.engines?.node || "missing", "error", "package")
  ];
}

function run(command, args) {
  const commandLine = [command, ...args].join(" ");
  const result = process.platform === "win32"
    ? spawnSync(commandLine, { cwd: ROOT, stdio: "pipe", shell: true, encoding: "utf8" })
    : spawnSync(command, args, { cwd: ROOT, stdio: "pipe", shell: false, encoding: "utf8" });
  return {
    command: commandLine,
    status: result.status,
    passed: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function commandChecks(runCommands) {
  if (!runCommands) return [];
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return [
    run(npm, ["run", "check"]),
    run(npm, ["test"]),
    run(npm, ["run", "test:coverage"]),
    run(npm, ["run", "test:e2e"]),
    run(npm, ["run", "deploy:check"]),
    run(npm, ["audit", "--omit=dev"])
  ].map((item) => check(`command:${item.command}`, item.passed, item.passed ? "passed" : item.stderr || item.stdout, "error", "commands"));
}

function buildReleaseReport(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const data = options.data || readJson("data/db.json");
  const env = validateProductionConfig(options);
  const storageModel = inspectStorageModel({ dataDir: path.join(ROOT, "data") });
  const identityContract = buildIdentityContract({ data });
  const auditRetention = buildAuditRetentionReport({ data, env: options.env || process.env });
  const chronicFollowup = buildChronicFollowupReadinessReport({ data });
  const dataQuality = buildDataQualityReport({ data });
  const integrationReadiness = buildIntegrationReadinessReport({ data });
  const interfaceMapping = buildInterfaceMappingReport({ data, pkg });
  const monitoringReadiness = buildMonitoringReadinessReport({ data, pkg });
  const operationsReadiness = buildOperationsReadinessReport({ data, pkg });
  const processAudit = buildProcessAuditReport({ data });
  const serviceAcceptance = buildServiceAcceptanceSummary(data);
  const productionDbReadiness = buildProductionDbReadinessReport({ data, pkg, storageModel });
  const evaluationEvidence = buildEvaluationEvidenceReport({ data });
  const environmentMatrix = buildEnvironmentMatrixReport({ data, pkg });
  const siteReadinessPack = buildSiteReadinessPack({ data, pkg, envFile: options.envFile || ".env.example", env: options.env || process.env, identityContract, interfaceMapping, monitoringReadiness });
  const checks = [
    assertFile("README.md"),
    assertFile("DEPLOYMENT.md"),
    assertFile(".env.example"),
    assertFile("data/db.json"),
    assertFile("server.js"),
    assertFile("scripts/storage-admin.js"),
    ...packageChecks(pkg),
    ...snapshotChecks(data),
    ...storageModelChecks(storageModel),
    ...identityContractChecks(identityContract),
    ...auditRetentionChecks(auditRetention),
    ...chronicFollowupChecks(chronicFollowup),
    ...dataQualityChecks(dataQuality),
    ...integrationReadinessChecks(integrationReadiness),
    ...interfaceMappingChecks(interfaceMapping),
    ...monitoringReadinessChecks(monitoringReadiness),
    ...operationsReadinessChecks(operationsReadiness),
    ...processAuditChecks(processAudit),
    ...serviceAcceptanceChecks(serviceAcceptance),
    ...siteReadinessChecks(siteReadinessPack),
    ...productionDbReadinessChecks(productionDbReadiness),
    ...evaluationEvidenceChecks(evaluationEvidence),
    ...environmentMatrixChecks(environmentMatrix),
    ...env.checks,
    ...commandChecks(options.runCommands)
  ];

  const failed = checks.filter((item) => item.severity === "error" && !item.passed);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    project: pkg.name,
    version: pkg.version,
    profile: env.profile,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: failed.length,
      warnings: checks.filter((item) => item.severity === "warn" && !item.passed).length
    },
    checks,
    productionCutover: buildProductionCutoverChecklist({ ...readEnvFile(options.envFile || ".env.example"), ...(options.env || {}) }, checks),
    storageModel,
    identityContract,
    auditRetention,
    chronicFollowup,
    dataQuality,
    integrationReadiness,
    interfaceMapping,
    monitoringReadiness,
    operationsReadiness,
    processAudit,
    serviceAcceptance,
    siteReadinessPack,
    productionDbReadiness,
    evaluationEvidence,
    environmentMatrix
  };
}

function renderStorageModelMarkdown(report) {
  const json = report.storageModel?.jsonSnapshot || {};
  const sqlite = report.storageModel?.sqlite || {};
  const largestRows = (json.largestCollections || []).map((item) => `| ${item.name} | ${item.records} |`);
  const tableRows = (sqlite.tables || []).map((name) => `| ${name} |`);
  const migrationRows = (sqlite.schemaMigrations || []).map((item) => `| ${item.version} | ${item.name || ""} | ${item.applied_at || ""} | ${item.checksum || ""} |`);
  return [
    "# Storage model inspection",
    "",
    `- Project: ${report.project}`,
    `- Version: ${report.version}`,
    `- Profile: ${report.profile}`,
    `- Generated at: ${report.generatedAt}`,
    `- Data directory: ${report.storageModel?.dataDir || ""}`,
    "",
    "## JSON snapshot",
    "",
    `- Present: ${json.present ? "yes" : "no"}`,
    `- Collections: ${json.collections || 0}`,
    `- Array collections: ${json.arrayCollections || 0}`,
    `- Total records: ${json.totalRecords || 0}`,
    `- SHA-256: ${json.sha256 || "n/a"}`,
    "",
    "### Largest JSON collections",
    "",
    "| Collection | Records |",
    "|---|---|",
    ...largestRows,
    "",
    "## SQLite store",
    "",
    `- Present: ${sqlite.present ? "yes" : "no"}`,
    `- Inspectable: ${sqlite.available ? "yes" : "no"}`,
    `- Tables: ${sqlite.tableCount || 0}`,
    `- Schema version: ${sqlite.schemaVersion || 0}`,
    `- SHA-256: ${sqlite.sha256 || "n/a"}`,
    sqlite.error ? `- Error: ${sqlite.error}` : "",
    "",
    "| Table |",
    "|---|",
    ...tableRows,
    "",
    "| Version | Name | Applied at | Checksum |",
    "|---|---|---|---|",
    ...migrationRows,
    ""
  ].join("\n");
}

function renderServiceAcceptanceMarkdown(report) {
  const rows = [
    ...(report.serviceAcceptance?.chronic?.domains || []).map((item) => ["chronic", item]),
    ...(report.serviceAcceptance?.county?.domains || []).map((item) => ["county", item])
  ].map(([group, item]) => `| ${group} | ${item.modeled ? "MODELED" : "MISSING"} | ${item.name} | ${item.rows} | ${item.openItems} |`);
  const openRows = [
    ...(report.serviceAcceptance?.chronic?.openActions || []).slice(0, 12).map((item) => ["chronic", item]),
    ...(report.serviceAcceptance?.county?.openActions || []).slice(0, 8).map((item) => ["county", item])
  ].map(([group, item]) =>
    `| ${group} | ${item.priority} | ${item.collection} | ${item.id} | ${String(item.subject || "").replace(/\|/g, "/")} | ${item.status} | ${item.owner} | ${item.due || ""} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`
  );
  return [
    "# Service acceptance summary",
    "",
    `- Project: ${report.project}`,
    `- Version: ${report.version}`,
    `- Profile: ${report.profile}`,
    `- Generated at: ${report.generatedAt}`,
    `- Chronic domains: ${report.serviceAcceptance?.chronic?.summary?.modeledDomains || 0}/${report.serviceAcceptance?.chronic?.summary?.domains || 0} modeled; open items ${report.serviceAcceptance?.chronic?.summary?.openItems || 0}`,
    `- County domains: ${report.serviceAcceptance?.county?.summary?.modeledDomains || 0}/${report.serviceAcceptance?.county?.summary?.domains || 0} modeled; open items ${report.serviceAcceptance?.county?.summary?.openItems || 0}`,
    "",
    "| Group | Status | Domain | Rows | Open items |",
    "|---|---|---|---:|---:|",
    ...rows,
    "",
    "## Open action preview",
    "",
    "| Group | Priority | Collection | Item | Subject | Status | Owner | Due | Next action |",
    "|---|---|---|---|---|---|---|---|---|",
    ...openRows,
    ""
  ].join("\n");
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : item.severity.toUpperCase()} | ${item.category} | ${item.name} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const cutoverRows = (report.productionCutover || []).map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.phase} | ${item.owner} | ${item.id} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const serviceRows = [
    ...(report.serviceAcceptance?.chronic?.domains || []).map((item) => ["chronic", item]),
    ...(report.serviceAcceptance?.county?.domains || []).map((item) => ["county", item])
  ].map(([group, item]) => `| ${group} | ${item.modeled ? "MODELED" : "MISSING"} | ${item.name} | ${item.rows} | ${item.openItems} |`);
  const serviceOpenRows = [
    ...(report.serviceAcceptance?.chronic?.openActions || []).slice(0, 6).map((item) => ["chronic", item]),
    ...(report.serviceAcceptance?.county?.openActions || []).slice(0, 6).map((item) => ["county", item])
  ].map(([group, item]) =>
    `| ${group} | ${item.priority} | ${item.collection} | ${item.id} | ${String(item.subject || "").replace(/\|/g, "/")} | ${item.status} | ${item.owner} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`
  );
  const storage = report.storageModel || {};
  return [
    `# Release readiness report`,
    "",
    `- Project: ${report.project}`,
    `- Version: ${report.version}`,
    `- Profile: ${report.profile}`,
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Checks: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`,
    `- Storage snapshot: ${storage.jsonSnapshot?.collections || 0} collections / ${storage.jsonSnapshot?.totalRecords || 0} records`,
    `- SQLite model: ${storage.sqlite?.present ? `${storage.sqlite?.tableCount || 0} tables, schema v${storage.sqlite?.schemaVersion || 0}` : "not present in this checkout"}`,
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Service acceptance summary",
    "",
    `- Chronic domains: ${report.serviceAcceptance?.chronic?.summary?.modeledDomains || 0}/${report.serviceAcceptance?.chronic?.summary?.domains || 0} modeled; open items ${report.serviceAcceptance?.chronic?.summary?.openItems || 0}`,
    `- County domains: ${report.serviceAcceptance?.county?.summary?.modeledDomains || 0}/${report.serviceAcceptance?.county?.summary?.domains || 0} modeled; open items ${report.serviceAcceptance?.county?.summary?.openItems || 0}`,
    "",
    "| Group | Status | Domain | Rows | Open items |",
    "|---|---|---|---:|---:|",
    ...serviceRows,
    "",
    "### Service open action preview",
    "",
    "| Group | Priority | Collection | Item | Subject | Status | Owner | Next action |",
    "|---|---|---|---|---|---|---|---|",
    ...serviceOpenRows,
    "",
    "## Production cutover checklist",
    "",
    "| Result | Phase | Owner | Item | Next action |",
    "|---|---|---|---|---|",
    ...cutoverRows,
    "",
    "## Storage model inspection",
    "",
    "See `storage-model-inspection.json` and `storage-model-inspection.md` for collection counts, largest collections, SQLite tables, and migration metadata.",
    "",
    "## Identity integration contract",
    "",
    "See `identity-contract.json` and `identity-contract.md` for required external claims, role-to-portal mappings, organization coverage, and sample claim mappings.",
    "",
    "## Audit retention report",
    "",
    "See `audit-retention-report.json` and `audit-retention-report.md` for audit-chain verification, export digest, retention targets, and security acceptance evidence.",
    "",
    "## Chronic follow-up readiness report",
    "",
    "See `chronic-followup-readiness-report.json` and `chronic-followup-readiness-report.md` for screening, tiered management, post-discharge follow-up, return visit reminders, medication adherence, family doctor collaboration, and resident feedback evidence.",
    "",
    "## Integration readiness report",
    "",
    "See `integration-readiness-report.json` and `integration-readiness-report.md` for P0 interface coverage, external contract readiness, idempotency, signature, and retry policy evidence.",
    "",
    "## Interface mapping report",
    "",
    "See `interface-mapping-report.json` and `interface-mapping-report.md` for contract-to-platform collection mappings, required field coverage, idempotency field mapping, signature, and retry evidence.",
    "",
    "## Data quality and master index report",
    "",
    "See `data-quality-report.json` and `data-quality-report.md` for resident master index completeness, resident reference checks, source traceability, and rectification issue evidence.",
    "",
    "## Operations readiness report",
    "",
    "See `operations-readiness-report.json` and `operations-readiness-report.md` for operation routes, production deployment tracks, external dependency risks, and release operation scripts.",
    "",
    "## Full process audit report",
    "",
    "See `process-audit-report.json` and `process-audit-report.md` for resident, chronic disease, county consortium, insurance, statistics, certificate, security, and cutover process evidence.",
    "",
    "## Site readiness pack",
    "",
    "See `site-readiness-pack.json` and `site-readiness-pack.md` for identity source mapping, interface joint-test, monitoring/on-call, and production signoff templates.",
    "",
    "## Monitoring readiness report",
    "",
    "See `monitoring-readiness-report.json` and `monitoring-readiness-report.md` for health and metrics routes, runtime metric signals, alert signals, SLO targets, and on-call escalation evidence.",
    "",
    "## Production database readiness report",
    "",
    "See `production-db-readiness-report.json` and `production-db-readiness-report.md` for PostgreSQL cutover prerequisites, current SQLite/JSON model evidence, backup rehearsal documentation, and runtime adapter guardrails.",
    "",
    "## Interoperability evaluation evidence report",
    "",
    "See `evaluation-evidence-report.json` and `evaluation-evidence-report.md` for interoperability artifacts, P1 interface requirements, transaction samples, and rectification evidence.",
    "",
    "## Environment matrix report",
    "",
    "See `environment-matrix-report.json` and `environment-matrix-report.md` for demo, staging, and production environment variables, gate scripts, owners, and blocking rules.",
    "",
    "## Release artifact manifest",
    "",
    "See `release-artifact-manifest.json` and `release-artifact-manifest.md` for the release package index, template READMEs, generation commands, and API evidence links.",
    ""
  ].join("\n");
}

function renderCutoverMarkdown(report) {
  const rows = (report.productionCutover || []).map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.phase} | ${item.owner} | ${item.id} | ${String(item.evidence || "").replace(/\|/g, "/")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  return [
    "# Production cutover checklist",
    "",
    `- Project: ${report.project}`,
    `- Version: ${report.version}`,
    `- Profile: ${report.profile}`,
    `- Generated at: ${report.generatedAt}`,
    "",
    "| Result | Phase | Owner | Item | Evidence | Next action |",
    "|---|---|---|---|---|---|",
    ...rows,
    ""
  ].join("\n");
}

function writeOutput(report, flags) {
  if (flags.output) {
    const output = path.resolve(ROOT, String(flags.output));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
    const cutoverJson = path.join(path.dirname(output), "production-cutover-checklist.json");
    fs.writeFileSync(cutoverJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      checklist: report.productionCutover || []
    }, null, 2), "utf8");
    const storageJson = path.join(path.dirname(output), "storage-model-inspection.json");
    fs.writeFileSync(storageJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      storageModel: report.storageModel
    }, null, 2), "utf8");
    const identityJson = path.join(path.dirname(output), "identity-contract.json");
    fs.writeFileSync(identityJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      identityContract: report.identityContract
    }, null, 2), "utf8");
    const auditJson = path.join(path.dirname(output), "audit-retention-report.json");
    fs.writeFileSync(auditJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      auditRetention: report.auditRetention
    }, null, 2), "utf8");
    const chronicFollowupJson = path.join(path.dirname(output), "chronic-followup-readiness-report.json");
    fs.writeFileSync(chronicFollowupJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      chronicFollowup: report.chronicFollowup
    }, null, 2), "utf8");
    const dataQualityJson = path.join(path.dirname(output), "data-quality-report.json");
    fs.writeFileSync(dataQualityJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      dataQuality: report.dataQuality
    }, null, 2), "utf8");
    const integrationJson = path.join(path.dirname(output), "integration-readiness-report.json");
    fs.writeFileSync(integrationJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      integrationReadiness: report.integrationReadiness
    }, null, 2), "utf8");
    const interfaceMappingJson = path.join(path.dirname(output), "interface-mapping-report.json");
    fs.writeFileSync(interfaceMappingJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      interfaceMapping: report.interfaceMapping
    }, null, 2), "utf8");
    const operationsJson = path.join(path.dirname(output), "operations-readiness-report.json");
    fs.writeFileSync(operationsJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      operationsReadiness: report.operationsReadiness
    }, null, 2), "utf8");
    const processAuditJson = path.join(path.dirname(output), "process-audit-report.json");
    fs.writeFileSync(processAuditJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      processAudit: report.processAudit
    }, null, 2), "utf8");
    const serviceAcceptanceJson = path.join(path.dirname(output), "service-acceptance-summary.json");
    fs.writeFileSync(serviceAcceptanceJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      serviceAcceptance: report.serviceAcceptance
    }, null, 2), "utf8");
    const siteReadinessJson = path.join(path.dirname(output), "site-readiness-pack.json");
    fs.writeFileSync(siteReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      siteReadinessPack: report.siteReadinessPack
    }, null, 2), "utf8");
    const monitoringJson = path.join(path.dirname(output), "monitoring-readiness-report.json");
    fs.writeFileSync(monitoringJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      monitoringReadiness: report.monitoringReadiness
    }, null, 2), "utf8");
    const productionDbJson = path.join(path.dirname(output), "production-db-readiness-report.json");
    fs.writeFileSync(productionDbJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      productionDbReadiness: report.productionDbReadiness
    }, null, 2), "utf8");
    const evaluationJson = path.join(path.dirname(output), "evaluation-evidence-report.json");
    fs.writeFileSync(evaluationJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      evaluationEvidence: report.evaluationEvidence
    }, null, 2), "utf8");
    const environmentJson = path.join(path.dirname(output), "environment-matrix-report.json");
    fs.writeFileSync(environmentJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      environmentMatrix: report.environmentMatrix
    }, null, 2), "utf8");
    const releaseArtifactManifest = buildReleaseArtifactManifest({ releaseReport: report });
    const releaseArtifactManifestJson = path.join(path.dirname(output), "release-artifact-manifest.json");
    fs.writeFileSync(releaseArtifactManifestJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      releaseArtifactManifest
    }, null, 2), "utf8");
  }
  if (flags.markdown) {
    const markdown = path.resolve(ROOT, String(flags.markdown));
    fs.mkdirSync(path.dirname(markdown), { recursive: true });
    fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
    const cutoverMarkdown = path.join(path.dirname(markdown), "production-cutover-checklist.md");
    fs.writeFileSync(cutoverMarkdown, renderCutoverMarkdown(report), "utf8");
    const storageMarkdown = path.join(path.dirname(markdown), "storage-model-inspection.md");
    fs.writeFileSync(storageMarkdown, renderStorageModelMarkdown(report), "utf8");
    const identityMarkdown = path.join(path.dirname(markdown), "identity-contract.md");
    fs.writeFileSync(identityMarkdown, renderIdentityContractMarkdown(report.identityContract), "utf8");
    const auditMarkdown = path.join(path.dirname(markdown), "audit-retention-report.md");
    fs.writeFileSync(auditMarkdown, renderAuditRetentionMarkdown(report.auditRetention), "utf8");
    const chronicFollowupMarkdown = path.join(path.dirname(markdown), "chronic-followup-readiness-report.md");
    fs.writeFileSync(chronicFollowupMarkdown, renderChronicFollowupMarkdown(report.chronicFollowup), "utf8");
    const dataQualityMarkdown = path.join(path.dirname(markdown), "data-quality-report.md");
    fs.writeFileSync(dataQualityMarkdown, renderDataQualityMarkdown(report.dataQuality), "utf8");
    const integrationMarkdown = path.join(path.dirname(markdown), "integration-readiness-report.md");
    fs.writeFileSync(integrationMarkdown, renderIntegrationReadinessMarkdown(report.integrationReadiness), "utf8");
    const interfaceMappingMarkdown = path.join(path.dirname(markdown), "interface-mapping-report.md");
    fs.writeFileSync(interfaceMappingMarkdown, renderInterfaceMappingMarkdown(report.interfaceMapping), "utf8");
    const operationsMarkdown = path.join(path.dirname(markdown), "operations-readiness-report.md");
    fs.writeFileSync(operationsMarkdown, renderOperationsReadinessMarkdown(report.operationsReadiness), "utf8");
    const processAuditMarkdown = path.join(path.dirname(markdown), "process-audit-report.md");
    fs.writeFileSync(processAuditMarkdown, renderProcessAuditMarkdown(report.processAudit), "utf8");
    const serviceAcceptanceMarkdown = path.join(path.dirname(markdown), "service-acceptance-summary.md");
    fs.writeFileSync(serviceAcceptanceMarkdown, renderServiceAcceptanceMarkdown(report), "utf8");
    const siteReadinessMarkdown = path.join(path.dirname(markdown), "site-readiness-pack.md");
    fs.writeFileSync(siteReadinessMarkdown, renderSiteReadinessMarkdown(report.siteReadinessPack), "utf8");
    writeTemplateReadmes(report.siteReadinessPack, path.join(path.dirname(path.relative(ROOT, markdown)), "templates"));
    const monitoringMarkdown = path.join(path.dirname(markdown), "monitoring-readiness-report.md");
    fs.writeFileSync(monitoringMarkdown, renderMonitoringReadinessMarkdown(report.monitoringReadiness), "utf8");
    const productionDbMarkdown = path.join(path.dirname(markdown), "production-db-readiness-report.md");
    fs.writeFileSync(productionDbMarkdown, renderProductionDbReadinessMarkdown(report.productionDbReadiness), "utf8");
    const evaluationMarkdown = path.join(path.dirname(markdown), "evaluation-evidence-report.md");
    fs.writeFileSync(evaluationMarkdown, renderEvaluationEvidenceMarkdown(report.evaluationEvidence), "utf8");
    const environmentMarkdown = path.join(path.dirname(markdown), "environment-matrix-report.md");
    fs.writeFileSync(environmentMarkdown, renderEnvironmentMatrixMarkdown(report.environmentMatrix), "utf8");
    const releaseArtifactManifestMarkdown = path.join(path.dirname(markdown), "release-artifact-manifest.md");
    fs.writeFileSync(releaseArtifactManifestMarkdown, renderReleaseArtifactManifestMarkdown(buildReleaseArtifactManifest({ releaseReport: report })), "utf8");
  }
}

function runCli() {
  const { command, flags } = parseArgs();
  const options = {
    profile: flags.profile || "demo",
    envFile: flags["config-env"] || flags["env-file"] || ".env.example",
    runCommands: flags["run-commands"] === true
  };
  if (command === "env-check") {
    const result = validateProductionConfig(options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (command === "report") {
    const report = buildReleaseReport(options);
    if (!flags.output && !flags.markdown && flags.write !== false) {
      flags.output = path.relative(ROOT, path.join(DEFAULT_RELEASE_DIR, "release-report.json"));
      flags.markdown = path.relative(ROOT, path.join(DEFAULT_RELEASE_DIR, "release-report.md"));
    }
    writeOutput(report, flags);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: release-report.js env-check|report [--profile=demo|production] [--config-env=.env] [--run-commands] [--output=path] [--markdown=path]");
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildProductionCutoverChecklist, buildReleaseReport, buildServiceAcceptanceSummary, parseArgs, readEnvFile, renderCutoverMarkdown, renderMarkdown, renderServiceAcceptanceMarkdown, renderStorageModelMarkdown, validateProductionConfig, writeOutput };
