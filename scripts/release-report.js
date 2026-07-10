#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildAuditRetentionReport, renderMarkdown: renderAuditRetentionMarkdown } = require("./audit-retention");
const { buildChronicFollowupReadinessReport, renderMarkdown: renderChronicFollowupMarkdown } = require("./chronic-followup-readiness");
const { buildChronicInstitutionInterfaceReport, renderMarkdown: renderChronicInstitutionInterfaceMarkdown } = require("./chronic-institution-interfaces");
const { buildChronicLaunchCoreReport, renderMarkdown: renderChronicLaunchCoreMarkdown } = require("./chronic-launch-core");
const { buildCitizenLaunchFoundationReadiness, renderMarkdown: renderCitizenLaunchFoundationMarkdown } = require("./citizen-launch-foundation-readiness");
const { buildCitizenOperationsReadiness, renderMarkdown: renderCitizenOperationsMarkdown } = require("./citizen-operations-readiness");
const { buildCommercialCryptoReadiness, renderMarkdown: renderCommercialCryptoMarkdown } = require("./commercial-crypto-readiness");
const { buildDataGovernanceReadiness, renderMarkdown: renderDataGovernanceMarkdown } = require("./data-governance-readiness");
const { buildDataQualityReport, renderMarkdown: renderDataQualityMarkdown } = require("./data-quality-report");
const { buildDigitalHospitalStandardsReadiness, renderMarkdown: renderDigitalHospitalStandardsMarkdown } = require("./digital-hospital-standards-readiness");
const { buildPhase2CatalogReadiness, renderMarkdown: renderPhase2CatalogMarkdown } = require("./phase2-catalog-readiness");
const { buildPhase2JointTestReadiness, renderMarkdown: renderPhase2JointTestMarkdown } = require("./phase2-joint-test-readiness");
const { buildPhase2MutualRecognitionReadiness, renderMarkdown: renderPhase2MutualRecognitionMarkdown } = require("./phase2-mutual-recognition-readiness");
const { buildPhase2DiseaseReportingReadiness, renderMarkdown: renderPhase2DiseaseReportingMarkdown } = require("./phase2-disease-reporting-readiness");
const { buildPhase2ClinicalAssistReadiness, renderMarkdown: renderPhase2ClinicalAssistMarkdown } = require("./phase2-clinical-assist-readiness");
const { buildPhase2FamilyDoctorReadiness, renderMarkdown: renderPhase2FamilyDoctorMarkdown } = require("./phase2-family-doctor-readiness");
const { buildPhase2ProposalReadiness, renderMarkdown: renderPhase2ProposalMarkdown } = require("./phase2-proposal-readiness");
const { buildDrugConsumableReadinessReport, renderMarkdown: renderDrugConsumableMarkdown } = require("./drug-consumable-readiness");
const { buildEvaluationEvidenceReport, renderMarkdown: renderEvaluationEvidenceMarkdown } = require("./evaluation-evidence");
const { buildEscortServiceReadinessReport, renderMarkdown: renderEscortServiceMarkdown } = require("./escort-service-readiness");
const { buildInternetNursingReadinessReport, renderMarkdown: renderInternetNursingMarkdown } = require("./internet-nursing-readiness");
const { buildEnvironmentMatrixReport, renderMarkdown: renderEnvironmentMatrixMarkdown } = require("./environment-matrix");
const { buildHealthDashboardSummary, buildPriorityApplicationTemplates, renderMarkdown: renderHealthDashboardMarkdown } = require("./health-dashboard-summary");
const { buildHybridDeploymentReadinessReport, renderMarkdown: renderHybridDeploymentMarkdown } = require("./hybrid-deployment-readiness");
const { buildIdentityContract, renderMarkdown: renderIdentityContractMarkdown } = require("./identity-contract");
const { buildIntegrationReadinessReport, renderMarkdown: renderIntegrationReadinessMarkdown } = require("./integration-readiness");
const { buildInterfaceMappingReport, renderMarkdown: renderInterfaceMappingMarkdown } = require("./interface-mapping");
const { buildHospitalOperationsReadinessReport, renderMarkdown: renderHospitalOperationsReadinessMarkdown } = require("./hospital-operations-readiness");
const { buildMonitoringReadinessReport, renderMarkdown: renderMonitoringReadinessMarkdown } = require("./monitoring-readiness");
const { buildOperationsReadinessReport, renderMarkdown: renderOperationsReadinessMarkdown } = require("./operations-readiness");
const { buildRegistrationJourneyReadiness, renderMarkdown: renderRegistrationJourneyMarkdown } = require("./registration-journey-readiness");
const { buildRegistrationIntegrationReadiness, renderMarkdown: renderRegistrationIntegrationMarkdown } = require("./registration-integration-readiness");
const { buildOnsiteLaunchRequirements, renderMarkdown: renderOnsiteLaunchRequirementsMarkdown } = require("./onsite-launch-requirements");
const { buildMaternalChildReadinessReport, renderMarkdown: renderMaternalChildReadinessMarkdown } = require("./maternal-child-readiness");
const { buildPolicyCoverageReport, renderMarkdown: renderPolicyCoverageMarkdown } = require("./policy-coverage");
const { buildProcessAuditReport, renderMarkdown: renderProcessAuditMarkdown } = require("./process-audit");
const { buildProductionDbReadinessReport, renderMarkdown: renderProductionDbReadinessMarkdown } = require("./production-db-readiness");
const { buildPublicHealthReadinessReport, renderMarkdown: renderPublicHealthMarkdown } = require("./public-health-readiness");
const { renderMarkdown: renderPriorityApplicationTemplatesMarkdown } = require("./priority-application-templates");
const { buildRegionalDataSharingReport, renderMarkdown: renderRegionalDataSharingMarkdown } = require("./regional-data-sharing");
const { buildQualitySafetyReport, renderMarkdown: renderQualitySafetyMarkdown } = require("./quality-safety-report");
const { buildReleaseArtifactManifest, renderMarkdown: renderReleaseArtifactManifestMarkdown } = require("./release-artifact-manifest");
const { buildReferralTeleconsultationReadinessReport, renderMarkdown: renderReferralTeleconsultationReadinessMarkdown } = require("./referral-teleconsultation-readiness");
const { buildResearchSandboxReadiness, renderMarkdown: renderResearchSandboxMarkdown } = require("./research-sandbox-readiness");
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
      passed: ready("env:OIDC.identityAdapter", "env:SMS.gateway"),
      evidence: detail("env:OIDC.identityAdapter", "env:SMS.gateway"),
      nextAction: "确认政务统一认证 OIDC/SAML 参数、客户端密钥、回调地址、机构目录、医生身份源映射和居民端真实短信网关。"
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
      id: "cutover-chronic-launch-core",
      phase: "integration",
      owner: "chronic-followup",
      passed: ready("chronicFollowup:institutionInterfaces", "chronicFollowup:launchCore") && envFlagEnabled(env, "CUTOVER_CHRONIC_LAUNCH_CORE_SIGNOFF"),
      evidence: `${detail("chronicFollowup:institutionInterfaces", "chronicFollowup:launchCore")}; ${signoff("CUTOVER_CHRONIC_LAUNCH_CORE_SIGNOFF")}`,
      nextAction: "Archive chronic launch core closure, site signoff, pharmacy callback, and resident check-in evidence before production cutover."
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
      check("env:SMS.gateway", Boolean(env.SMS_GATEWAY_URL), env.SMS_GATEWAY_URL ? "configured" : "missing SMS_GATEWAY_URL", "error", "environment"),
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
    "qualitySafetyEvents",
    "qualityRectificationOrders",
    "dataAccessLogs",
    "accessibilityChecklist",
    "regionalDataSharingScope",
    "regionalSharingPackages",
    "regionalSharingSnapshots",
    "regionalSharingAccessReviews",
    "securityAcceptanceLedger",
    "healthDashboardSnapshots"
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
    check("snapshot:researchSandbox", (data.researchDatasets || []).some((item) => item.authorizationStatus === "approved" && (item.deidentificationStatus === "released" || item.anonymization) && (item.sandbox?.status === "active" || item.status === "published")) && (data.dataAccessLogs || []).some((item) => /research|科研|数据集|沙箱/i.test(`${item.scope || ""} ${item.purpose || ""}`)), `${data.researchDatasets?.length || 0} datasets / ${data.dataAccessLogs?.length || 0} audit logs`, "error", "snapshot"),
    check("snapshot:externalDependencyRisks", externalDependencyRiskIds.every((id) => serverSource.includes(id)), `${externalDependencyRiskIds.length} external dependency risks`, "error", "snapshot"),
    check("snapshot:noCorruptedPlaceholders", !/编码损坏|缂栫爜鎹熷潖|\?\?\?/.test(raw), "no known corrupted placeholders", "error", "snapshot"),
    check("snapshot:accessibility", Array.isArray(data.accessibilityChecklist) && data.accessibilityChecklist.length >= 5, `${data.accessibilityChecklist?.length || 0} checklist items`, "error", "snapshot"),
    check("snapshot:healthDashboard", Array.isArray(data.healthDashboardSnapshots) && data.healthDashboardSnapshots.some((item) => Array.isArray(item.sourceApplications) && item.sourceApplications.length === 7), `${data.healthDashboardSnapshots?.length || 0} dashboard snapshots`, "error", "snapshot")
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
  const retentionTargetDetail = (auditRetention.retentionTargets || [])
    .map((item) => `${item.env}:${item.configured ? "configured" : "missing"}`)
    .join(";") || "no retention targets declared";
  return [
    check("audit:retention", auditRetention.ok, auditRetention.ok ? "audit retention checks passed" : "audit retention checks failed", "error", "audit"),
    check("audit:exportDigest", Boolean(auditRetention.exportDigest), auditRetention.exportDigest || "missing", "error", "audit"),
    check("audit:retentionTargetConfigured", auditRetention.retentionTargets?.some((item) => item.configured), retentionTargetDetail, "warn", "audit")
  ];
}

function auditRetentionEnvForRelease(options, profile) {
  const env = { ...(options.env || process.env) };
  const strictProfile = profile === "production";
  if (!strictProfile && !env.AUDIT_EXPORT_PATH && !env.SIEM_ENDPOINT) {
    env.AUDIT_EXPORT_PATH = path.join(ROOT, "release", "audit-retention-report.json");
  }
  return env;
}

function chronicFollowupChecks(chronicFollowup, chronicInstitutionInterfaces, chronicLaunchCore) {
  return [
    check("chronicFollowup:readiness", chronicFollowup.ok, chronicFollowup.ok ? "chronic follow-up readiness checks passed" : "chronic follow-up readiness checks failed", "error", "chronic-followup"),
    check("chronicFollowup:boundaries", chronicFollowup.summary?.passed === chronicFollowup.summary?.boundaries, `${chronicFollowup.summary?.passed || 0}/${chronicFollowup.summary?.boundaries || 0} boundaries`, "error", "chronic-followup"),
    check("chronicFollowup:feedback", chronicFollowup.summary?.feedbackRecords >= 1, `${chronicFollowup.summary?.feedbackRecords || 0} feedback records`, "error", "chronic-followup"),
    check("chronicFollowup:publicHealthLoop", chronicFollowup.summary?.publicHealthLoopReadyStages === 6, `${chronicFollowup.summary?.publicHealthLoopReadyStages || 0}/6 public health loop stages`, "error", "chronic-followup"),
    check("chronicFollowup:publicHealthIntegrations", chronicFollowup.summary?.publicHealthReadyIntegrationLinks === 3, `${chronicFollowup.summary?.publicHealthReadyIntegrationLinks || 0}/3 public health integrations`, "error", "chronic-followup"),
    check("chronicFollowup:institutionInterfaces", chronicInstitutionInterfaces?.ok && chronicInstitutionInterfaces.summary?.readyContracts === chronicInstitutionInterfaces.summary?.contracts, `${chronicInstitutionInterfaces?.summary?.readyContracts || 0}/${chronicInstitutionInterfaces?.summary?.contracts || 0} institution contracts`, "error", "chronic-followup"),
    check("chronicFollowup:launchCore", chronicLaunchCore?.ok && chronicLaunchCore.summary?.readyItems === chronicLaunchCore.summary?.items, `${chronicLaunchCore?.summary?.readyItems || 0}/${chronicLaunchCore?.summary?.items || 0} launch core items`, "error", "chronic-followup")
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

function regionalDataSharingChecks(regionalDataSharing) {
  return [
    check("regionalDataSharing:report", regionalDataSharing.ok, regionalDataSharing.ok ? "regional data sharing checks passed" : "regional data sharing checks failed", "error", "regional-data-sharing"),
    check("regionalDataSharing:packages", regionalDataSharing.summary?.packages >= 3, `${regionalDataSharing.summary?.packages || 0} packages`, "error", "regional-data-sharing"),
    check("regionalDataSharing:accessReviews", regionalDataSharing.summary?.accessReviews >= 1, `${regionalDataSharing.summary?.accessReviews || 0} access reviews`, "error", "regional-data-sharing")
  ];
}

function researchSandboxChecks(researchSandbox) {
  return [
    check("researchSandbox:readiness", researchSandbox.ok, researchSandbox.ok ? "research sandbox checks passed" : "research sandbox checks failed", "error", "research"),
    check("researchSandbox:boundaries", researchSandbox.boundaries?.length >= 7, `${researchSandbox.boundaries?.length || 0} research boundaries`, "error", "research"),
    check("researchSandbox:reusedCollections", ["researchDatasets", "diseaseRegistryModels", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"].every((key) => researchSandbox.reusableCollections?.includes(key)), "required reusable collections mapped", "error", "research"),
    check("researchSandbox:sandboxReady", researchSandbox.summary?.sandboxReady >= 1, `${researchSandbox.summary?.sandboxReady || 0} sandbox-ready datasets`, "error", "research")
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

function hybridDeploymentChecks(hybridDeploymentReadiness) {
  return [
    check("hybridDeployment:readiness", hybridDeploymentReadiness.ok, hybridDeploymentReadiness.ok ? "hybrid deployment topology checks passed" : "hybrid deployment topology failed", "error", "deployment"),
    check("hybridDeployment:staticPreview", hybridDeploymentReadiness.checks?.some((item) => item.id === "hybrid:staticPreviewBoundary" && item.passed), "GitHub Pages/static preview boundary documented", "error", "deployment"),
    check("hybridDeployment:dynamicBackend", hybridDeploymentReadiness.checks?.some((item) => item.id === "hybrid:dynamicBackendRoutes" && item.passed), "server.js dynamic API routes covered", "error", "deployment")
  ];
}

function healthDashboardChecks(healthDashboard) {
  return [
    check("healthDashboard:summary", healthDashboard.ok, healthDashboard.ok ? "health dashboard summary checks passed" : "health dashboard summary failed", "error", "health-dashboard"),
    check("healthDashboard:applications", healthDashboard.applications?.length === 8 && healthDashboard.totals?.sourceApplications === 7, `${healthDashboard.applications?.length || 0} applications; ${healthDashboard.totals?.sourceApplications || 0} source applications`, "error", "health-dashboard"),
    check("healthDashboard:developmentTemplate", healthDashboard.applications?.every((item) => item.functionalBoundary && item.reusePoints?.length && item.dataCollections?.length && item.apiRoutes?.length && item.frontendEntry && item.testEvidence?.length && item.acceptanceEvidence?.length), "boundary, reuse, data, API, frontend, test, and acceptance fields", "error", "health-dashboard"),
    check("healthDashboard:industryGovernanceIndicators", healthDashboard.indicatorCenter?.indicators?.length === 8 && healthDashboard.indicatorCenter?.periodViews?.length === 2 && healthDashboard.indicatorCenter?.indicators?.every((item) => item.definition && item.owner && item.sourceCollections?.length && item.reports?.length === 2 && item.drilldown?.href), `${healthDashboard.indicatorCenter?.indicators?.length || 0} indicators / ${healthDashboard.indicatorCenter?.periodViews?.length || 0} report views`, "error", "health-dashboard"),
    check("healthDashboard:boundary", /source business applications|source applications/.test(healthDashboard.scope?.rule || ""), healthDashboard.scope?.rule || "missing", "error", "health-dashboard")
  ];
}

function priorityApplicationTemplateChecks(priorityApplicationTemplates) {
  return [
    check("priorityApps:templates", priorityApplicationTemplates.ok, priorityApplicationTemplates.ok ? "priority application templates passed" : "priority application templates failed", "error", "priority-apps"),
    check("priorityApps:count", priorityApplicationTemplates.summary?.applications === 8 && priorityApplicationTemplates.summary?.sourceApplications === 7, `${priorityApplicationTemplates.summary?.applications || 0} applications; ${priorityApplicationTemplates.summary?.sourceApplications || 0} source applications`, "error", "priority-apps"),
    check("priorityApps:conversationTitles", priorityApplicationTemplates.templates?.every((item) => item.conversationTitle), "conversation titles present", "error", "priority-apps"),
    check("priorityApps:conversationStarters", priorityApplicationTemplates.templates?.every((item) => item.conversationStarter && item.conversationStarter.includes(item.id)), "conversation starters present", "error", "priority-apps"),
    check("priorityApps:implementationChecklists", priorityApplicationTemplates.templates?.every((item) => Array.isArray(item.implementationChecklist) && item.implementationChecklist.length >= 8 && item.implementationChecklist.some((step) => /Follow Codex loop/.test(step))), "implementation checklists include Codex loop", "error", "priority-apps"),
    check("priorityApps:acceptanceGates", priorityApplicationTemplates.templates?.every((item) => item.acceptanceGate?.readyWhen?.length >= 4 && item.acceptanceGate?.evidence?.length), "acceptance gates present", "error", "priority-apps")
  ];
}

function maternalChildReadinessChecks(maternalChildReadiness) {
  const riskMetrics = maternalChildReadiness.summary?.riskMetrics || {};
  const hasRiskMetricKeys = ["pendingPublicSecuritySync", "pendingMaternalChildSync", "qualityPending"].every((key) => Number.isFinite(Number(riskMetrics[key])));
  return [
    check("maternalChild:readiness", maternalChildReadiness.ok, maternalChildReadiness.ok ? "maternal-child readiness checks passed" : "maternal-child readiness checks failed", "error", "maternal-child"),
    check("maternalChild:policy", maternalChildReadiness.checks?.some((item) => item.id === "docs:policy" && item.passed), "policy documents and module policy summary present", "error", "maternal-child"),
    check("maternalChild:riskMetrics", hasRiskMetricKeys && maternalChildReadiness.checks?.some((item) => item.id === "data:risk-metrics" && item.passed), `public-security pending ${riskMetrics.pendingPublicSecuritySync ?? 0}, maternal-child enrollment pending ${riskMetrics.pendingMaternalChildSync ?? 0}, quality correction pending ${riskMetrics.qualityPending ?? 0}`, "error", "maternal-child"),
    check("maternalChild:roles", ["role:institution", "role:commission", "role:citizen"].every((id) => maternalChildReadiness.checks?.some((item) => item.id === id && item.passed)), "institution, commission, and citizen roles covered", "error", "maternal-child")
  ];
}

function publicHealthReadinessChecks(publicHealthReadiness) {
  const readinessSeverity = publicHealthReadiness.ok ? "error" : "warn";
  return [
    check("publicHealth:readiness", publicHealthReadiness.ok, publicHealthReadiness.ok ? "public health readiness checks passed" : "public health readiness has site cutover blockers; see public health launch gate", readinessSeverity, "public-health"),
    check("publicHealth:standardTotal", publicHealthReadiness.standardCoverage?.total?.domains === 21 && publicHealthReadiness.standardCoverage?.total?.secondary === 125 && publicHealthReadiness.standardCoverage?.total?.tertiary === 421, `${publicHealthReadiness.standardCoverage?.total?.domains || 0}/${publicHealthReadiness.standardCoverage?.total?.secondary || 0}/${publicHealthReadiness.standardCoverage?.total?.tertiary || 0}`, "error", "public-health"),
    check("publicHealth:standardImplementationLedger", publicHealthReadiness.standardImplementationBoard?.traceabilityReady === true && publicHealthReadiness.standardImplementationBoard?.summary?.domains === 21 && publicHealthReadiness.standardImplementationBoard?.summary?.mappingComplete === 21 && publicHealthReadiness.checks?.some((item) => item.id === "standard:implementation-ledger" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:standard-implementation-ledger" && item.passed), `${publicHealthReadiness.standardImplementationBoard?.summary?.mappingComplete || 0}/${publicHealthReadiness.standardImplementationBoard?.summary?.domains || 0} mappings / ${publicHealthReadiness.standardImplementationBoard?.summary?.gaps || 0} gaps`, "error", "public-health"),
    check("publicHealth:standardImplementationActions", Number.isInteger(publicHealthReadiness.summary?.standardImplementationEvidenceCandidates) && ["standardImplementationAssignedGaps", "standardImplementationVerifiedGaps", "standardImplementationUnassignedGaps", "standardImplementationDueSoonGaps", "standardImplementationOverdueGaps"].every((key) => Number.isInteger(publicHealthReadiness.summary?.[key])) && publicHealthReadiness.checks?.some((item) => item.id === "frontend:standard-implementation-actions" && item.passed), `${publicHealthReadiness.summary?.standardImplementationEvidenceCandidates || 0} verified evidence candidates / ${publicHealthReadiness.standardImplementationBoard?.summary?.evidenceLinked || 0} linked / ${publicHealthReadiness.summary?.standardImplementationUnassignedGaps || 0} unassigned / ${publicHealthReadiness.summary?.standardImplementationDueSoonGaps || 0} due soon / ${publicHealthReadiness.summary?.standardImplementationOverdueGaps || 0} overdue / ${publicHealthReadiness.summary?.standardImplementationAssignedGaps || 0} assigned / ${publicHealthReadiness.summary?.standardImplementationVerifiedGaps || 0} remediation verified`, "error", "public-health"),
    check("publicHealth:institutionScopes", publicHealthReadiness.institutionScopes?.length >= 7, `${publicHealthReadiness.institutionScopes?.length || 0} institution scopes`, "error", "public-health"),
    check("publicHealth:eventLoop", publicHealthReadiness.riskQueue?.length >= 3 && publicHealthReadiness.riskQueue?.every((item) => item.commandAction && item.followupAction), `${publicHealthReadiness.riskQueue?.length || 0} risk queue items`, "error", "public-health"),
    check("publicHealth:eventActionApi", ["events:action-api", "frontend:event-actions"].every((id) => publicHealthReadiness.checks?.some((item) => item.id === id && item.passed)), "event action API and risk queue actions are wired", "error", "public-health"),
    check("publicHealth:nextPlan", publicHealthReadiness.checks?.some((item) => item.id === "docs:next-plan" && item.passed), "next development plan is documented", "error", "public-health"),
    check("publicHealth:exchangeTasks", ["direct-report", "laboratory", "immunization", "maternal-child", "emergency", "security"].every((category) => publicHealthReadiness.exchangeTasks?.some((item) => item.category === category)), `${publicHealthReadiness.exchangeTasks?.length || 0} exchange tasks`, "error", "public-health"),
    check("publicHealth:exchangeRuns", publicHealthReadiness.checks?.some((item) => item.id === "exchange:runs" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "exchange:compensation" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "exchange:exception-board" && item.passed) && ["exchangeExceptions", "openExchangeExceptions", "resolvedExchangeExceptions", "unassignedExchangeExceptions", "dueSoonExchangeExceptions", "overdueExchangeExceptions"].every((key) => Number.isInteger(publicHealthReadiness.summary?.[key])), `${publicHealthReadiness.exchangeRuns?.length || 0} exchange runs / ${publicHealthReadiness.summary?.openExchangeExceptions || 0} open exceptions / ${publicHealthReadiness.summary?.overdueExchangeExceptions || 0} overdue`, "error", "public-health"),
    check("publicHealth:institutionTasks", publicHealthReadiness.checks?.some((item) => item.id === "institution:tasks" && item.passed), `${publicHealthReadiness.institutionTasks?.length || 0} institution collaboration tasks`, "error", "public-health"),
    check("publicHealth:onsiteAcceptance", publicHealthReadiness.checks?.some((item) => item.id === "onsite:acceptance" && item.passed), `${publicHealthReadiness.onsiteAcceptances?.length || 0} onsite acceptance rows`, "error", "public-health"),
    check("publicHealth:cutoverBlockers", publicHealthReadiness.checks?.some((item) => item.id === "cutover:blockers" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "cutover:open-boundary" && item.passed), `${publicHealthReadiness.cutoverBlockers?.length || 0} cutover blockers, ${publicHealthReadiness.summary?.p0OpenCutoverBlockers || 0} P0 open`, "error", "public-health"),
    check("publicHealth:cutoverReadiness", publicHealthReadiness.cutoverReadiness?.releaseGate === "site-evidence-required" && publicHealthReadiness.checks?.some((item) => item.id === "cutover:readiness-board" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:cutover-readiness" && item.passed), `${publicHealthReadiness.cutoverReadiness?.readinessLevel || "unknown"} / ${publicHealthReadiness.cutoverReadiness?.summary?.p0Open || 0} P0 open / ${publicHealthReadiness.cutoverReadiness?.summary?.evidenceRecorded || 0} evidence recorded`, "error", "public-health"),
    check("publicHealth:cutoverEvidencePackets", publicHealthReadiness.checks?.some((item) => item.id === "cutover:evidence-packets" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:cutover-evidence-packets" && item.passed), `${publicHealthReadiness.cutoverEvidenceBoard?.summary?.packets || 0} packets / ${publicHealthReadiness.cutoverEvidenceBoard?.summary?.requiredItems || 0} required items / ${publicHealthReadiness.cutoverEvidenceBoard?.summary?.verifiedItems || 0} verified`, "error", "public-health"),
    check("publicHealth:cutoverDrills", publicHealthReadiness.cutoverDrillBoard?.status === "blocked" && publicHealthReadiness.checks?.some((item) => item.id === "cutover:drill-board" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:cutover-drills" && item.passed), `${publicHealthReadiness.cutoverDrillBoard?.summary?.blockedDrills || 0}/${publicHealthReadiness.cutoverDrillBoard?.summary?.drills || 0} drills blocked / ${publicHealthReadiness.cutoverDrillBoard?.summary?.openFindings || 0} findings`, "error", "public-health"),
    check("publicHealth:productionHandoffs", publicHealthReadiness.productionHandoffBoard?.status === "blocked" && publicHealthReadiness.checks?.some((item) => item.id === "production:handoffs" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:production-handoffs" && item.passed), `${publicHealthReadiness.productionHandoffBoard?.summary?.acceptedHandoffs || 0}/${publicHealthReadiness.productionHandoffBoard?.summary?.handoffs || 0} production handoffs accepted / ${publicHealthReadiness.productionHandoffBoard?.summary?.missingSignoffs || 0} missing signoffs`, "error", "public-health"),
    check("publicHealth:goLiveObservations", publicHealthReadiness.goLiveObservationBoard?.status === "watch-ready" && publicHealthReadiness.checks?.some((item) => item.id === "go-live:observation-plan" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:go-live-observations" && item.passed), `${publicHealthReadiness.goLiveObservationBoard?.summary?.planReady || 0}/${publicHealthReadiness.goLiveObservationBoard?.summary?.observations || 0} observation plans ready / ${publicHealthReadiness.goLiveObservationBoard?.summary?.openCriticalSignals || 0} critical signals`, "error", "public-health"),
    check("publicHealth:launchIncidents", publicHealthReadiness.launchIncidentBoard?.status === "desk-ready" && publicHealthReadiness.checks?.some((item) => item.id === "go-live:incident-desk" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:launch-incidents" && item.passed), `${publicHealthReadiness.launchIncidentBoard?.summary?.deskReady || 0}/${publicHealthReadiness.launchIncidentBoard?.summary?.lanes || 0} incident lanes ready / ${publicHealthReadiness.launchIncidentBoard?.summary?.criticalOpenTickets || 0} critical open`, "error", "public-health"),
    check("publicHealth:launchDutyShifts", publicHealthReadiness.launchDutyBoard?.status === "roster-ready" && publicHealthReadiness.checks?.some((item) => item.id === "go-live:duty-handoffs" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:launch-duty-shifts" && item.passed), `${publicHealthReadiness.launchDutyBoard?.summary?.readyShifts || 0}/${publicHealthReadiness.launchDutyBoard?.summary?.shifts || 0} duty shifts ready / ${publicHealthReadiness.launchDutyBoard?.summary?.missedHandoffs || 0} missed`, "error", "public-health"),
    check("publicHealth:launchCommandBriefs", publicHealthReadiness.launchCommandBriefBoard?.status === "briefing-ready" && publicHealthReadiness.checks?.some((item) => item.id === "go-live:command-briefs" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "go-live:command-brief-delivery-receipts" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "frontend:launch-command-brief-receipts" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:launch-command-briefs" && item.passed), `${publicHealthReadiness.launchCommandBriefBoard?.summary?.readyBriefs || 0}/${publicHealthReadiness.launchCommandBriefBoard?.summary?.briefs || 0} command briefs ready / ${publicHealthReadiness.launchCommandBriefBoard?.summary?.acknowledgedRecipients || 0}/${publicHealthReadiness.launchCommandBriefBoard?.summary?.expectedAcknowledgements || 0} delivery receipts / ${publicHealthReadiness.launchCommandBriefBoard?.summary?.pendingAcknowledgements || 0} pending`, "error", "public-health"),
    check("publicHealth:siteEvidenceBridge", publicHealthReadiness.siteEvidenceBridge?.summary?.links >= 8 && publicHealthReadiness.checks?.some((item) => item.id === "site-evidence:bridge" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:site-evidence-bridge" && item.passed), `${publicHealthReadiness.siteEvidenceBridge?.summary?.verifiedLinks || 0}/${publicHealthReadiness.siteEvidenceBridge?.summary?.links || 0} site evidence links`, "error", "public-health"),
    check("publicHealth:siteEvidenceVerificationTasks", publicHealthReadiness.siteEvidenceVerificationBoard?.summary?.tasks >= 9 && publicHealthReadiness.siteEvidenceVerificationBoard?.summary?.structurallyReadyTasks === publicHealthReadiness.siteEvidenceVerificationBoard?.summary?.tasks && ["evidence-pending", "verification-pending", "blocked", "verified"].includes(publicHealthReadiness.siteEvidenceVerificationBoard?.status) && publicHealthReadiness.checks?.some((item) => item.id === "site-evidence:verification-desk" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:site-evidence-verification-tasks" && item.passed), `${publicHealthReadiness.siteEvidenceVerificationBoard?.summary?.verifiedTasks || 0}/${publicHealthReadiness.siteEvidenceVerificationBoard?.summary?.tasks || 0} site evidence verification tasks / ${publicHealthReadiness.siteEvidenceVerificationBoard?.status || "unknown"}`, "error", "public-health"),
    check("publicHealth:launchApprovalPreflight", publicHealthReadiness.launchGate?.approvalPreflight?.status === "blocked" && publicHealthReadiness.launchGate?.approvalPreflight?.blockedPrerequisites >= 1 && publicHealthReadiness.launchGate?.approvalPreflight?.blockedRequirementIds?.includes("launch-site-evidence-verification") && publicHealthReadiness.checks?.some((item) => item.id === "launch:approval-preflight" && item.passed), `${publicHealthReadiness.launchGate?.approvalPreflight?.passedPrerequisites || 0}/${publicHealthReadiness.launchGate?.approvalPreflight?.prerequisiteRequirements || 0} approval prerequisites / ${publicHealthReadiness.launchGate?.approvalPreflight?.status || "unknown"}`, "error", "public-health"),
    check("publicHealth:launchGate", publicHealthReadiness.launchGate?.releaseGate === "site-evidence-required" && publicHealthReadiness.checks?.some((item) => item.id === "launch:gate" && item.passed) && publicHealthReadiness.checks?.some((item) => item.id === "api:launch-gate" && item.passed), `${publicHealthReadiness.launchGate?.summary?.passedRequirements || 0}/${publicHealthReadiness.launchGate?.summary?.requirements || 0} requirements / ${publicHealthReadiness.launchGate?.summary?.signedApprovals || 0}/${publicHealthReadiness.launchGate?.summary?.approvals || 0} approvals`, "error", "public-health")
  ];
}

function policyCoverageChecks(policyCoverage) {
  return [
    check("policyCoverage:report", policyCoverage.ok, policyCoverage.ok ? "policy coverage checks passed" : "policy coverage checks failed", "error", "policy"),
    check("policyCoverage:documents", policyCoverage.summary?.documentsPassed === policyCoverage.summary?.documents, `${policyCoverage.summary?.documentsPassed || 0}/${policyCoverage.summary?.documents || 0} policy documents`, "error", "policy"),
    check("policyCoverage:releaseGates", policyCoverage.checks?.filter((item) => /^policyCoverage:(releaseManifest|releaseReport|deployCheck|packageScript|ci)$/.test(item.id)).every((item) => item.passed), "policy coverage is wired into package, CI, deploy check, manifest, and release report", "error", "policy")
  ];
}

function dataQualityChecks(dataQuality) {
  return [
    check("dataQuality:report", dataQuality.ok, dataQuality.ok ? "data quality checks passed" : "data quality checks failed", "error", "data-quality"),
    check("dataQuality:masterIndexCompleteness", dataQuality.scorecard?.residentIndexCompleteness === 100, `${dataQuality.scorecard?.residentIndexCompleteness || 0}% resident index completeness`, "error", "data-quality"),
    check("dataQuality:residentReferences", dataQuality.issues?.missingReferences?.length === 0, `${dataQuality.issues?.missingReferences?.length || 0} broken resident references`, "error", "data-quality")
  ];
}

function dataGovernanceChecks(dataGovernance) {
  return [
    check("dataGovernance:readiness", dataGovernance.ok, dataGovernance.ok ? "data governance foundation passed" : "data governance foundation failed", "error", "data-governance"),
    check("dataGovernance:assets", (dataGovernance.summary?.assets || 0) >= 7 && (dataGovernance.summary?.sourceSystems || 0) >= 7, `${dataGovernance.summary?.assets || 0} assets / ${dataGovernance.summary?.sourceSystems || 0} sources`, "error", "data-governance"),
    check("dataGovernance:lineage", dataGovernance.lineage?.every((item) => item.contractPresent && item.targetCollectionPresent && item.signatureReady && item.idempotencyReady), `${dataGovernance.lineage?.length || 0} lineage controls linked`, "error", "data-governance"),
    check("dataGovernance:platformBus", (dataGovernance.summary?.busChannels || 0) >= 4 && dataGovernance.busChannels?.every((item) => item.owner && item.producerCollections?.length && item.consumerModules?.length), `${dataGovernance.summary?.busChannels || 0} reusable platform bus channels`, "error", "data-governance"),
    check("dataGovernance:onsiteBoundary", (dataGovernance.onsiteBlockers || []).length >= 3, `${dataGovernance.onsiteBlockers?.length || 0} onsite/external blockers surfaced`, "error", "data-governance")
  ];
}

function phase2ProposalChecks(phase2Proposal) {
  return [
    check("phase2Proposal:readiness", phase2Proposal.ok, phase2Proposal.ok ? "phase-2 proposal readiness checks passed" : "phase-2 proposal readiness failed", "error", "phase2-proposal"),
    check("phase2Proposal:gapLedger", (phase2Proposal.summary?.gapRows || 0) >= 12 && (phase2Proposal.summary?.domains || 0) >= 10, `${phase2Proposal.summary?.gapRows || 0} gap rows / ${phase2Proposal.summary?.domains || 0} domains`, "error", "phase2-proposal"),
    check("phase2Proposal:workPackages", (phase2Proposal.summary?.p0WorkPackages || 0) >= 4 && (phase2Proposal.summary?.p1WorkPackages || 0) >= 3 && (phase2Proposal.summary?.p2WorkPackages || 0) >= 1, `${phase2Proposal.summary?.p0WorkPackages || 0}/${phase2Proposal.summary?.p1WorkPackages || 0}/${phase2Proposal.summary?.p2WorkPackages || 0} P0/P1/P2 packages`, "error", "phase2-proposal"),
    check("phase2Proposal:externalBoundary", (phase2Proposal.summary?.onsiteBlockers || 0) >= 8 && (phase2Proposal.summary?.blockedLedgerRows || 0) >= 4, `${phase2Proposal.summary?.onsiteBlockers || 0} blockers / ${phase2Proposal.summary?.blockedLedgerRows || 0} blocked rows`, "error", "phase2-proposal")
  ];
}

function phase2CatalogChecks(phase2Catalog) {
  return [
    check("phase2Catalog:readiness", phase2Catalog.ok, phase2Catalog.ok ? "phase-2 catalog readiness checks passed" : "phase-2 catalog readiness failed", "error", "phase2-catalog"),
    check("phase2Catalog:tables", (phase2Catalog.summary?.tablesMapped || 0) >= 216 && (phase2Catalog.summary?.dataCatalogs || 0) >= 6, `${phase2Catalog.summary?.tablesMapped || 0}/216 tables across ${phase2Catalog.summary?.dataCatalogs || 0} domains`, "error", "phase2-catalog"),
    check("phase2Catalog:services", (phase2Catalog.summary?.serviceCatalogs || 0) >= 12 && (phase2Catalog.summary?.fieldLineage || 0) >= 10, `${phase2Catalog.summary?.serviceCatalogs || 0} services / ${phase2Catalog.summary?.fieldLineage || 0} lineage rows`, "error", "phase2-catalog"),
    check("phase2Catalog:qualityRules", (phase2Catalog.summary?.qualityRules || 0) >= 12 && (phase2Catalog.summary?.onsiteBlockers || 0) >= 6, `${phase2Catalog.summary?.qualityRules || 0} quality rules / ${phase2Catalog.summary?.onsiteBlockers || 0} blockers`, "error", "phase2-catalog")
  ];
}

function phase2JointTestChecks(phase2JointTest) {
  return [
    check("phase2JointTest:readiness", phase2JointTest.ok, phase2JointTest.ok ? "phase-2 joint-test pilot checks passed" : "phase-2 joint-test pilot failed", "error", "phase2-joint-test"),
    check("phase2JointTest:institutions", (phase2JointTest.summary?.institutions || 0) >= 3 && (phase2JointTest.summary?.sourceSystems || 0) >= 6, `${phase2JointTest.summary?.institutions || 0} institutions / ${phase2JointTest.summary?.sourceSystems || 0} source systems`, "error", "phase2-joint-test"),
    check("phase2JointTest:payloads", (phase2JointTest.summary?.samplePayloads || 0) >= 8 && (phase2JointTest.summary?.landedTraces || 0) >= 6, `${phase2JointTest.summary?.samplePayloads || 0} payloads / ${phase2JointTest.summary?.landedTraces || 0} landed traces`, "error", "phase2-joint-test"),
    check("phase2JointTest:siteBoundary", (phase2JointTest.summary?.openIssues || 0) >= 3 && (phase2JointTest.summary?.runnableChains || 0) >= 5, `${phase2JointTest.summary?.openIssues || 0} open issues / ${phase2JointTest.summary?.runnableChains || 0} runnable chains`, "error", "phase2-joint-test")
  ];
}

function phase2MutualRecognitionChecks(phase2MutualRecognition) {
  return [
    check("phase2MutualRecognition:readiness", phase2MutualRecognition.ok, phase2MutualRecognition.ok ? "phase-2 mutual recognition checks passed" : "phase-2 mutual recognition failed", "error", "phase2-mutual-recognition"),
    check("phase2MutualRecognition:catalog", (phase2MutualRecognition.summary?.catalogItems || 0) >= 78, `${phase2MutualRecognition.summary?.catalogItems || 0}/78 catalog items`, "error", "phase2-mutual-recognition"),
    check("phase2MutualRecognition:reports", (phase2MutualRecognition.summary?.reports || 0) >= 3 && (phase2MutualRecognition.summary?.citations || 0) >= 3, `${phase2MutualRecognition.summary?.reports || 0} reports / ${phase2MutualRecognition.summary?.citations || 0} citations`, "error", "phase2-mutual-recognition"),
    check("phase2MutualRecognition:decisionStats", (phase2MutualRecognition.summary?.recognized || 0) >= 1 && ((phase2MutualRecognition.summary?.rejected || 0) >= 1 || (phase2MutualRecognition.summary?.pending || 0) >= 1), `${phase2MutualRecognition.summary?.recognized || 0} recognized / ${phase2MutualRecognition.summary?.rejected || 0} rejected / ${phase2MutualRecognition.summary?.pending || 0} pending`, "error", "phase2-mutual-recognition")
  ];
}

function phase2DiseaseReportingChecks(phase2DiseaseReporting) {
  return [
    check("phase2DiseaseReporting:readiness", phase2DiseaseReporting.ok, phase2DiseaseReporting.ok ? "phase-2 disease reporting checks passed" : "phase-2 disease reporting failed", "error", "phase2-disease-reporting"),
    check("phase2DiseaseReporting:rules", (phase2DiseaseReporting.summary?.rules || 0) >= 4 && (phase2DiseaseReporting.summary?.categories || 0) >= 3, `${phase2DiseaseReporting.summary?.rules || 0} rules / ${phase2DiseaseReporting.summary?.categories || 0} categories`, "error", "phase2-disease-reporting"),
    check("phase2DiseaseReporting:receipts", (phase2DiseaseReporting.summary?.reportCards || 0) >= 4 && (phase2DiseaseReporting.summary?.receipts || 0) >= 3, `${phase2DiseaseReporting.summary?.reportCards || 0} report cards / ${phase2DiseaseReporting.summary?.receipts || 0} receipts`, "error", "phase2-disease-reporting"),
    check("phase2DiseaseReporting:patientCenter", (phase2DiseaseReporting.summary?.patientCenterRows || 0) >= 4 && (phase2DiseaseReporting.summary?.openExceptions || 0) >= 1, `${phase2DiseaseReporting.summary?.patientCenterRows || 0} patient center rows / ${phase2DiseaseReporting.summary?.openExceptions || 0} open exceptions`, "error", "phase2-disease-reporting")
  ];
}

function phase2ClinicalAssistChecks(phase2ClinicalAssist) {
  return [
    check("phase2ClinicalAssist:readiness", phase2ClinicalAssist.ok, phase2ClinicalAssist.ok ? "phase-2 clinical assist checks passed" : "phase-2 clinical assist failed", "error", "phase2-clinical-assist"),
    check("phase2ClinicalAssist:rules", (phase2ClinicalAssist.summary?.rules || 0) >= 4 && (phase2ClinicalAssist.summary?.categories || 0) >= 4, `${phase2ClinicalAssist.summary?.rules || 0} rules / ${phase2ClinicalAssist.summary?.categories || 0} categories`, "error", "phase2-clinical-assist"),
    check("phase2ClinicalAssist:alerts", (phase2ClinicalAssist.summary?.alerts || 0) >= 4 && (phase2ClinicalAssist.summary?.doctorScopes || 0) >= 2, `${phase2ClinicalAssist.summary?.alerts || 0} alerts / ${phase2ClinicalAssist.summary?.doctorScopes || 0} doctor scopes`, "error", "phase2-clinical-assist"),
    check("phase2ClinicalAssist:receipts", (phase2ClinicalAssist.summary?.receipts || 0) >= 3 && (phase2ClinicalAssist.summary?.pluginContracts || 0) >= 3, `${phase2ClinicalAssist.summary?.receipts || 0} receipts / ${phase2ClinicalAssist.summary?.pluginContracts || 0} plugin contracts`, "error", "phase2-clinical-assist")
  ];
}

function phase2FamilyDoctorChecks(phase2FamilyDoctor) {
  return [
    check("phase2FamilyDoctor:readiness", phase2FamilyDoctor.ok, phase2FamilyDoctor.ok ? "phase-2 family doctor checks passed" : "phase-2 family doctor failed", "error", "phase2-family-doctor"),
    check("phase2FamilyDoctor:catalog", (phase2FamilyDoctor.summary?.templates || 0) >= 3 && (phase2FamilyDoctor.summary?.packages || 0) >= 4 && (phase2FamilyDoctor.summary?.teams || 0) >= 3, `${phase2FamilyDoctor.summary?.templates || 0} templates / ${phase2FamilyDoctor.summary?.packages || 0} packages / ${phase2FamilyDoctor.summary?.teams || 0} teams`, "error", "phase2-family-doctor"),
    check("phase2FamilyDoctor:applications", (phase2FamilyDoctor.summary?.applications || 0) >= 4 && (phase2FamilyDoctor.summary?.pendingApplications || 0) >= 1, `${phase2FamilyDoctor.summary?.applications || 0} applications / ${phase2FamilyDoctor.summary?.pendingApplications || 0} pending`, "error", "phase2-family-doctor"),
    check("phase2FamilyDoctor:fulfillment", (phase2FamilyDoctor.summary?.contracts || 0) >= 3 && (phase2FamilyDoctor.summary?.fulfillments || 0) >= 5 && (phase2FamilyDoctor.summary?.satisfactionRows || 0) >= 3, `${phase2FamilyDoctor.summary?.contracts || 0} contracts / ${phase2FamilyDoctor.summary?.fulfillments || 0} fulfillments / ${phase2FamilyDoctor.summary?.satisfactionRows || 0} satisfaction rows`, "error", "phase2-family-doctor")
  ];
}

function citizenOperationsChecks(citizenOperations) {
  return [
    check("citizenOperations:readiness", citizenOperations.ok, citizenOperations.ok ? "citizen service operations checks passed" : "citizen service operations checks failed", "error", "citizen-operations"),
    check("citizenOperations:governance", (citizenOperations.summary?.publishedContents || 0) >= 3 && (citizenOperations.summary?.activeAgreements || 0) >= 3 && (citizenOperations.summary?.pendingIdentityReviews || 0) >= 1, `${citizenOperations.summary?.publishedContents || 0} published / ${citizenOperations.summary?.activeAgreements || 0} agreements / ${citizenOperations.summary?.pendingIdentityReviews || 0} pending identity reviews`, "error", "citizen-operations"),
    check("citizenOperations:service-control", (citizenOperations.summary?.enabledHospitals || 0) >= 2 && (citizenOperations.summary?.activeBlacklistEntries || 0) >= 1 && (citizenOperations.summary?.orders || 0) >= 7, `${citizenOperations.summary?.enabledHospitals || 0} hospitals / ${citizenOperations.summary?.activeBlacklistEntries || 0} active blacklist entries / ${citizenOperations.summary?.orders || 0} orders`, "error", "citizen-operations"),
    check("citizenOperations:production-boundary", citizenOperations.summary?.productionReadyHospitals === 0 && (citizenOperations.summary?.onsiteBlockers || 0) >= 4, `${citizenOperations.summary?.productionReadyHospitals || 0} production-ready hospitals / ${citizenOperations.summary?.onsiteBlockers || 0} onsite blockers`, "error", "citizen-operations")
  ];
}

function registrationJourneyChecks(registrationJourney) {
  return [
    check("registrationJourney:readiness", registrationJourney.ok, registrationJourney.ok ? "registration journey checks passed" : "registration journey checks failed", "error", "registration-journey"),
    check("registrationJourney:orders", (registrationJourney.center?.summary?.orders || 0) >= 1, `${registrationJourney.center?.summary?.orders || 0} scoped appointment journeys`, "error", "registration-journey"),
    check("registrationJourney:cross-role", registrationJourney.checks?.filter((item) => ["registrationJourney:citizenUi", "registrationJourney:institutionUi", "registrationJourney:api", "registrationJourney:disruption"].includes(item.id)).every((item) => item.passed), "resident, institution, API and disruption-rescheduling actions are wired", "error", "registration-journey"),
    check("registrationJourney:production-boundary", registrationJourney.center?.summary?.productionReady === 0 && (registrationJourney.center?.summary?.onsiteBlockers || 0) >= 4, `${registrationJourney.center?.summary?.productionReady || 0} production-ready / ${registrationJourney.center?.summary?.onsiteBlockers || 0} onsite blockers`, "error", "registration-journey")
  ];
}

function registrationIntegrationChecks(registrationIntegration) {
  return [
    check("registrationIntegration:readiness", registrationIntegration.ok, registrationIntegration.ok ? "appointment callback integration checks passed" : "appointment callback integration checks failed", "error", "registration-integration"),
    check("registrationIntegration:contract", registrationIntegration.center?.contract?.id === "appointment-order-v1", registrationIntegration.center?.contract?.id || "appointment contract missing", "error", "registration-integration"),
    check("registrationIntegration:gateway", registrationIntegration.checks?.filter((item) => ["registrationIntegration:gateway", "registrationIntegration:mapping", "registrationIntegration:api", "registrationIntegration:remediation", "registrationIntegration:manual-reconciliation"].includes(item.id)).every((item) => item.passed), "signature, idempotency, landing, mapping, retry and manual reconciliation are wired", "error", "registration-integration"),
    check("registrationIntegration:production-boundary", registrationIntegration.center?.summary?.productionReady === 0 && (registrationIntegration.center?.summary?.onsiteBlockers || 0) >= 5, `${registrationIntegration.center?.summary?.productionReady || 0} production-ready / ${registrationIntegration.center?.summary?.onsiteBlockers || 0} onsite blockers`, "error", "registration-integration")
  ];
}

function commercialCryptoChecks(commercialCrypto) {
  return [
    check("commercialCrypto:readiness", commercialCrypto.ok, commercialCrypto.ok ? "commercial crypto adapter checks passed" : "commercial crypto adapter checks failed", "error", "commercial-crypto"),
    check("commercialCrypto:contracts", commercialCrypto.summary?.capabilities === 6 && commercialCrypto.summary?.contractsReady === 6, `${commercialCrypto.summary?.contractsReady || 0}/${commercialCrypto.summary?.capabilities || 0} adapter contracts`, "error", "commercial-crypto"),
    check("commercialCrypto:runtime-probe", commercialCrypto.runtimeProbe?.primitives?.length === 3, `${commercialCrypto.summary?.primitiveAvailability || 0}/3 runtime primitives available`, "error", "commercial-crypto"),
    check("commercialCrypto:production-boundary", commercialCrypto.summary?.productionReady === 0 && (commercialCrypto.summary?.onsiteBlockers || 0) >= 5, `${commercialCrypto.summary?.productionReady || 0} production-ready / ${commercialCrypto.summary?.onsiteBlockers || 0} onsite blockers`, "error", "commercial-crypto")
  ];
}

function qualitySafetyChecks(qualitySafety) {
  return [
    check("qualitySafety:report", qualitySafety.ok, qualitySafety.ok ? "quality and safety supervision checks passed" : "quality and safety supervision checks failed", "error", "quality-safety"),
    check("qualitySafety:boundaries", qualitySafety.summary?.modeledBoundaries === qualitySafety.summary?.boundaries, `${qualitySafety.summary?.modeledBoundaries || 0}/${qualitySafety.summary?.boundaries || 0} boundaries modeled`, "error", "quality-safety"),
    check("qualitySafety:reuse", qualitySafety.reusedCollections?.every((item) => item.present), `${qualitySafety.summary?.reusedCollections || 0} reused collections`, "error", "quality-safety")
  ];
}

function digitalHospitalStandardsChecks(digitalHospitalStandards) {
  return [
    check("digitalHospitalStandards:readiness", digitalHospitalStandards.ok, digitalHospitalStandards.ok ? "digital hospital standards checks passed" : "digital hospital standards checks failed", "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:domains", (digitalHospitalStandards.summary?.standardDomains || 0) >= 6 && (digitalHospitalStandards.summary?.officialSources || 0) >= 6, `${digitalHospitalStandards.summary?.standardDomains || 0} domains / ${digitalHospitalStandards.summary?.officialSources || 0} source markers`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:api", (digitalHospitalStandards.summary?.apiMarkers || 0) >= 5, `${digitalHospitalStandards.summary?.apiMarkers || 0} API contract markers`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:launchReadiness", (digitalHospitalStandards.summary?.launchMarkers || 0) >= 16, `${digitalHospitalStandards.summary?.launchMarkers || 0} launch readiness markers`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:evidence", (digitalHospitalStandards.summary?.evidenceModes || 0) >= 5 && (digitalHospitalStandards.summary?.workflowMarkers || 0) >= 6, `${digitalHospitalStandards.summary?.evidenceModes || 0} evidence modes / ${digitalHospitalStandards.summary?.workflowMarkers || 0} workflow markers`, "error", "digital-hospital-standards")
  ];
}

function drugConsumableChecks(drugConsumable) {
  return [
    check("drugConsumable:readiness", drugConsumable.ok, drugConsumable.ok ? "drug consumable supervision checks passed" : "drug consumable supervision checks failed", "error", "drug-consumable"),
    check("drugConsumable:boundaries", drugConsumable.requiredBoundaries?.every((boundary) => drugConsumable.checks?.find((item) => item.id === "drug-consumable:boundaries")?.detail?.includes(`${boundary}:present`)), `${drugConsumable.requiredBoundaries?.length || 0} boundaries`, "error", "drug-consumable"),
    check("drugConsumable:links", drugConsumable.linkedRows?.every((item) => item.pickupLinked && item.claimLinked && item.auditTrailPresent), `${drugConsumable.linkedRows?.length || 0} linked supervision rows`, "error", "drug-consumable")
  ];
}

function operationsReadinessChecks(operationsReadiness) {
  return [
    check("operations:readiness", operationsReadiness.ok, operationsReadiness.ok ? "operations readiness checks passed" : "operations readiness checks failed", "error", "operations"),
    check("operations:routes", operationsReadiness.operationRoutes?.every((item) => item.present && item.documented), `${operationsReadiness.operationRoutes?.length || 0} operation routes`, "error", "operations"),
    check("operations:externalDependencies", operationsReadiness.externalDependencies?.every((item) => item.present), `${operationsReadiness.externalDependencies?.length || 0} external dependencies`, "error", "operations"),
    check("operations:runCenter", operationsReadiness.runCenter?.ok && operationsReadiness.runCenter?.summary?.serviceLevels >= 4 && operationsReadiness.runCenter?.summary?.dutyShifts >= 3 && operationsReadiness.runCenter?.summary?.drills >= 3, `${operationsReadiness.runCenter?.summary?.serviceLevels || 0} SLOs / ${operationsReadiness.runCenter?.summary?.dutyShifts || 0} shifts / ${operationsReadiness.runCenter?.summary?.drills || 0} drills`, "error", "operations"),
    check("operations:production-boundary", operationsReadiness.runCenter?.summary?.productionReady === 0 && operationsReadiness.runCenter?.summary?.onsiteBlockers >= 5, `${operationsReadiness.runCenter?.summary?.productionReady || 0} production-ready / ${operationsReadiness.runCenter?.summary?.onsiteBlockers || 0} onsite blockers`, "error", "operations")
  ];
}

function hospitalOperationsReadinessChecks(hospitalOperationsReadiness) {
  return [
    check("hospitalOps:readiness", hospitalOperationsReadiness.ok, hospitalOperationsReadiness.ok ? "hospital operations readiness checks passed" : "hospital operations readiness checks failed", "error", "operations"),
    check("hospitalOps:snapshots", hospitalOperationsReadiness.summary?.snapshots >= 3, `${hospitalOperationsReadiness.summary?.snapshots || 0} operation snapshots`, "error", "operations"),
    check("hospitalOps:dispatch", hospitalOperationsReadiness.summary?.dispatchRequests >= 2, `${hospitalOperationsReadiness.summary?.dispatchRequests || 0} dispatch requests`, "error", "operations"),
    check("hospitalOps:reconciliation", hospitalOperationsReadiness.summary?.reconciliationReviews >= 2, `${hospitalOperationsReadiness.summary?.reconciliationReviews || 0} reconciliation reviews`, "error", "operations")
  ];
}

function monitoringReadinessChecks(monitoringReadiness) {
  return [
    check("monitoring:readiness", monitoringReadiness.ok, monitoringReadiness.ok ? "monitoring readiness checks passed" : "monitoring readiness checks failed", "error", "monitoring"),
    check("monitoring:metricSignals", monitoringReadiness.metricSignals?.every((item) => item.present), `${monitoringReadiness.metricSignals?.length || 0} metric signals`, "error", "monitoring"),
    check("monitoring:sloTargets", monitoringReadiness.sloTargets?.every((item) => item.covered), `${monitoringReadiness.sloTargets?.length || 0} SLO targets`, "error", "monitoring")
  ];
}

function referralTeleconsultationChecks(referralTeleconsultationReadiness) {
  return [
    check("referralTeleconsultation:readiness", referralTeleconsultationReadiness.ok, referralTeleconsultationReadiness.ok ? "referral teleconsultation readiness checks passed" : "referral teleconsultation readiness checks failed", "error", "referral"),
    check("referralTeleconsultation:authorization", referralTeleconsultationReadiness.checks?.some((item) => item.id === "referral:residentAuthorization" && item.passed), "resident authorization evidence present", "error", "referral"),
    check("referralTeleconsultation:frontend", referralTeleconsultationReadiness.checks?.some((item) => item.id === "referral:frontend" && item.passed), "institution and county runnable entries present", "error", "referral")
  ];
}

function escortServiceChecks(escortServiceReadiness) {
  return [
    check("escortService:readiness", escortServiceReadiness.ok, escortServiceReadiness.ok ? "escort service readiness checks passed" : "escort service readiness checks failed", "error", "escort"),
    check("escortService:registry", escortServiceReadiness.summary?.providers >= 3 && escortServiceReadiness.summary?.trainedWorkers >= 3, `${escortServiceReadiness.summary?.providers || 0} providers / ${escortServiceReadiness.summary?.trainedWorkers || 0} trained workers`, "error", "escort"),
    check("escortService:riskQuality", escortServiceReadiness.checks?.some((item) => item.id === "escort:riskQuality" && item.passed), "risk queue and quality callback evidence present", "error", "escort"),
    check("escortService:citizenProviderAvailability", escortServiceReadiness.checks?.some((item) => item.id === "escort:citizenProviderAvailability" && item.passed), "citizen booking is guarded when no published provider is available", "error", "escort"),
    check("escortService:citizenSubmitReadiness", escortServiceReadiness.checks?.some((item) => item.id === "escort:citizenSubmitReadiness" && item.passed), "resident appointment submit readiness evidence present", "error", "escort"),
    check("escortService:appointmentFieldGuard", escortServiceReadiness.checks?.some((item) => item.id === "escort:appointmentFieldGuard" && item.passed), "resident appointment required field guard evidence present", "error", "escort")
  ];
}

function internetNursingChecks(internetNursingReadiness) {
  return [
    check("internetNursing:readiness", internetNursingReadiness.ok, internetNursingReadiness.ok ? "internet nursing readiness checks passed" : "internet nursing readiness checks failed", "error", "internet-nursing"),
    check("internetNursing:qualification", internetNursingReadiness.summary?.qualifiedNurses >= 2, `${internetNursingReadiness.summary?.qualifiedNurses || 0}/${internetNursingReadiness.summary?.nurses || 0} qualified nurses`, "error", "internet-nursing"),
    check("internetNursing:riskTrace", internetNursingReadiness.checks?.some((item) => item.id === "nursing:riskTrace" && item.passed), "risk queue and location tracking evidence present", "error", "internet-nursing"),
    check("internetNursing:closedLoopSummary", internetNursingReadiness.checks?.some((item) => item.id === "nursing:closedLoopSummary" && item.passed), "closed-loop summary evidence present", "error", "internet-nursing")
  ];
}

function citizenLaunchFoundationChecks(citizenLaunchFoundation) {
  return [
    check("citizenLaunch:readiness", citizenLaunchFoundation.ok, citizenLaunchFoundation.ok ? "citizen launch foundation checks passed" : "citizen launch foundation checks failed", "error", "citizen-launch"),
    check("citizenLaunch:phoneCodeDelivery", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:phone-code-delivery" && item.passed), "phone-code delivery exposes send action, cooldown, expiry, and demo gateway evidence", "error", "citizen-launch"),
    check("citizenLaunch:accountProvisioning", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:account-provisioning-boundary" && item.passed), "resident, doctor, and nurse account provisioning owners and audit evidence are documented", "error", "citizen-launch"),
    check("citizenLaunch:offlineCache", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:offline-cache" && item.passed), "resident PWA shell refreshes HTML/JS/CSS from network first", "error", "citizen-launch"),
    check("citizenLaunch:mobilePreviewServiceSwitch", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:mobile-preview-service-switch" && item.passed), "mobile preview service switch evidence present", "error", "citizen-launch"),
    check("citizenLaunch:externalDependencies", citizenLaunchFoundation.externalDependencies?.every((item) => item.status === "required-before-production" && item.owner && item.cutoverBlocker && item.evidence && item.onsiteAcceptance), `${citizenLaunchFoundation.externalDependencies?.length || 0} production dependencies surfaced with owners, blockers, evidence, and onsite acceptance`, "error", "citizen-launch")
  ];
}

function productionDbReadinessChecks(productionDbReadiness) {
  return [
    check("productionDb:readiness", productionDbReadiness.ok, productionDbReadiness.ok ? "production database readiness checks passed" : "production database readiness checks failed", "error", "production-db"),
    check("productionDb:runtimeBlock", productionDbReadiness.migrationEvidence?.runtimePostgresBlocked, "postgres runtime remains blocked until adapter cutover", "error", "production-db"),
    check("productionDb:rehearsalDocs", productionDbReadiness.rehearsalEvidence && Object.values(productionDbReadiness.rehearsalEvidence).every(Boolean), "backup, restore, RTO/RPO, and release artifact docs", "error", "production-db"),
    check("productionDb:cutoverCenter", productionDbReadiness.cutoverCenter?.ok && productionDbReadiness.cutoverCenter?.summary?.migrationBatches >= 4 && productionDbReadiness.cutoverCenter?.summary?.productionReadyRuns === 0, `${productionDbReadiness.cutoverCenter?.summary?.migrationBatches || 0} migration batches / ${productionDbReadiness.cutoverCenter?.summary?.cutoverRuns || 0} rehearsal runs / production gate preserved`, "error", "production-db")
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

function onsiteLaunchRequirementsChecks(onsiteLaunchRequirements) {
  return [
    check("onsiteLaunch:requirements", onsiteLaunchRequirements.ok, onsiteLaunchRequirements.ok ? "on-site launch requirements passed" : "on-site launch requirements failed", "error", "onsite-launch"),
    check("onsiteLaunch:p0Coverage", onsiteLaunchRequirements.summary?.p0Requirements >= 10, `${onsiteLaunchRequirements.summary?.p0Requirements || 0} P0 requirements`, "error", "onsite-launch"),
    check("onsiteLaunch:blockers", onsiteLaunchRequirements.summary?.blockingConditions >= 10, `${onsiteLaunchRequirements.summary?.blockingConditions || 0} blocking conditions`, "error", "onsite-launch")
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
    "onsite:launch-requirements",
    "identity:contract",
    "audit:retention",
    "data-governance:readiness",
    "data-quality:report",
    "digital-hospital:standards-readiness",
    "phase2:catalog-readiness",
    "phase2:joint-test-readiness",
    "phase2:mutual-recognition-readiness",
    "phase2:clinical-assist-readiness",
    "phase2:disease-reporting-readiness",
    "phase2:proposal-readiness",
    "phase2:citizen-operations-readiness",
    "security:commercial-crypto-readiness",
    "quality-safety:report",
    "environment:matrix",
    "hybrid:deployment-readiness",
    "hospital-operations:readiness",
    "internet-nursing:readiness",
    "health-dashboard:summary",
    "priority-apps:templates",
    "maternal-child:readiness",
    "public-health:readiness",
    "policy:coverage",
    "integration:readiness",
    "interface:mapping",
    "monitoring:readiness",
    "referral:readiness",
    "operations:readiness",
    "process:audit",
    "site:pack",
    "production-db:readiness",
    "evaluation:evidence",
    "regional-data-sharing:report",
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
  const auditRetention = buildAuditRetentionReport({ data, env: auditRetentionEnvForRelease(options, env.profile) });
  const chronicFollowup = buildChronicFollowupReadinessReport({ data });
  const chronicInstitutionInterfaces = buildChronicInstitutionInterfaceReport({ data, pkg });
  const chronicLaunchCore = buildChronicLaunchCoreReport({ data, pkg });
  const dataQuality = buildDataQualityReport({ data });
  const qualitySafety = buildQualitySafetyReport({ data });
  const drugConsumable = buildDrugConsumableReadinessReport({ data, pkg });
  const integrationReadiness = buildIntegrationReadinessReport({ data });
  const interfaceMapping = buildInterfaceMappingReport({ data, pkg });
  const dataGovernance = buildDataGovernanceReadiness({ data, pkg, interfaceMapping, dataQuality });
  const digitalHospitalStandards = buildDigitalHospitalStandardsReadiness({ pkg });
  const phase2Catalog = buildPhase2CatalogReadiness({ data, pkg });
  const phase2JointTest = buildPhase2JointTestReadiness({ data, pkg });
  const phase2MutualRecognition = buildPhase2MutualRecognitionReadiness({ data, pkg });
  const phase2DiseaseReporting = buildPhase2DiseaseReportingReadiness({ data, pkg });
  const phase2ClinicalAssist = buildPhase2ClinicalAssistReadiness({ data, pkg });
  const phase2FamilyDoctor = buildPhase2FamilyDoctorReadiness({ data, pkg });
  const citizenOperations = buildCitizenOperationsReadiness({ data, pkg });
  const registrationJourney = buildRegistrationJourneyReadiness({ data, pkg });
  const registrationIntegration = buildRegistrationIntegrationReadiness({ data, pkg });
  const commercialCrypto = buildCommercialCryptoReadiness({ data, pkg });
  const phase2Proposal = buildPhase2ProposalReadiness({ pkg });
  const regionalDataSharing = buildRegionalDataSharingReport({ data, pkg });
  const hospitalOperationsReadiness = buildHospitalOperationsReadinessReport({ data, pkg });
  const researchSandbox = buildResearchSandboxReadiness(data);
  const monitoringReadiness = buildMonitoringReadinessReport({ data, pkg });
  const referralTeleconsultationReadiness = buildReferralTeleconsultationReadinessReport({ data, pkg });
  const escortServiceReadiness = buildEscortServiceReadinessReport({ data, pkg });
  const internetNursingReadiness = buildInternetNursingReadinessReport({ data, pkg });
  const citizenLaunchFoundation = buildCitizenLaunchFoundationReadiness({
    pkg,
    phaseDoc: fs.existsSync(path.join(ROOT, "docs", "citizen-launch-foundation-plan.md"))
      ? fs.readFileSync(path.join(ROOT, "docs", "citizen-launch-foundation-plan.md"), "utf8")
      : ""
  });
  const operationsReadiness = buildOperationsReadinessReport({ data, pkg });
  const processAudit = buildProcessAuditReport({ data });
  const serviceAcceptance = buildServiceAcceptanceSummary(data);
  const productionDbReadiness = buildProductionDbReadinessReport({ data, pkg, storageModel });
  const evaluationEvidence = buildEvaluationEvidenceReport({ data });
  const environmentMatrix = buildEnvironmentMatrixReport({ data, pkg });
  const hybridDeploymentReadiness = buildHybridDeploymentReadinessReport({ data, pkg });
  const healthDashboard = buildHealthDashboardSummary({ data });
  const priorityApplicationTemplates = buildPriorityApplicationTemplates({ data });
  const maternalChildReadiness = buildMaternalChildReadinessReport({ data, packageSource: JSON.stringify(pkg) });
  const publicHealthReadiness = buildPublicHealthReadinessReport({ data, pkg });
  const policyCoverage = buildPolicyCoverageReport();
  const siteReadinessPack = buildSiteReadinessPack({ data, pkg, envFile: options.envFile || ".env.example", env: options.env || process.env, identityContract, interfaceMapping, monitoringReadiness });
  const onsiteLaunchRequirements = buildOnsiteLaunchRequirements({ pkg, sitePack: siteReadinessPack, releaseReport: { ok: true }, envFile: options.envFile || ".env.example", env: options.env || process.env });
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
    ...chronicFollowupChecks(chronicFollowup, chronicInstitutionInterfaces, chronicLaunchCore),
    ...dataQualityChecks(dataQuality),
    ...dataGovernanceChecks(dataGovernance),
    ...digitalHospitalStandardsChecks(digitalHospitalStandards),
    ...phase2CatalogChecks(phase2Catalog),
    ...phase2JointTestChecks(phase2JointTest),
    ...phase2MutualRecognitionChecks(phase2MutualRecognition),
    ...phase2DiseaseReportingChecks(phase2DiseaseReporting),
    ...phase2ClinicalAssistChecks(phase2ClinicalAssist),
    ...phase2FamilyDoctorChecks(phase2FamilyDoctor),
    ...citizenOperationsChecks(citizenOperations),
    ...registrationJourneyChecks(registrationJourney),
    ...registrationIntegrationChecks(registrationIntegration),
    ...commercialCryptoChecks(commercialCrypto),
    ...phase2ProposalChecks(phase2Proposal),
    ...qualitySafetyChecks(qualitySafety),
    ...drugConsumableChecks(drugConsumable),
    ...integrationReadinessChecks(integrationReadiness),
    ...interfaceMappingChecks(interfaceMapping),
    ...regionalDataSharingChecks(regionalDataSharing),
    ...hospitalOperationsReadinessChecks(hospitalOperationsReadiness),
    ...researchSandboxChecks(researchSandbox),
    ...monitoringReadinessChecks(monitoringReadiness),
    ...referralTeleconsultationChecks(referralTeleconsultationReadiness),
    ...escortServiceChecks(escortServiceReadiness),
    ...internetNursingChecks(internetNursingReadiness),
    ...citizenLaunchFoundationChecks(citizenLaunchFoundation),
    ...operationsReadinessChecks(operationsReadiness),
    ...processAuditChecks(processAudit),
    ...serviceAcceptanceChecks(serviceAcceptance),
    ...siteReadinessChecks(siteReadinessPack),
    ...onsiteLaunchRequirementsChecks(onsiteLaunchRequirements),
    ...productionDbReadinessChecks(productionDbReadiness),
    ...evaluationEvidenceChecks(evaluationEvidence),
    ...environmentMatrixChecks(environmentMatrix),
    ...hybridDeploymentChecks(hybridDeploymentReadiness),
    ...healthDashboardChecks(healthDashboard),
    ...priorityApplicationTemplateChecks(priorityApplicationTemplates),
    ...maternalChildReadinessChecks(maternalChildReadiness),
    ...publicHealthReadinessChecks(publicHealthReadiness),
    ...policyCoverageChecks(policyCoverage),
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
    chronicInstitutionInterfaces,
    chronicLaunchCore,
    dataQuality,
    dataGovernance,
    digitalHospitalStandards,
    phase2Catalog,
    phase2JointTest,
    phase2MutualRecognition,
    phase2DiseaseReporting,
    phase2ClinicalAssist,
    phase2FamilyDoctor,
    citizenOperations,
    registrationJourney,
    registrationIntegration,
    commercialCrypto,
    phase2Proposal,
    qualitySafety,
    drugConsumable,
    integrationReadiness,
    interfaceMapping,
    regionalDataSharing,
    hospitalOperationsReadiness,
    researchSandbox,
    monitoringReadiness,
    referralTeleconsultationReadiness,
    escortServiceReadiness,
    internetNursingReadiness,
    citizenLaunchFoundation,
    operationsReadiness,
    processAudit,
    serviceAcceptance,
    siteReadinessPack,
    onsiteLaunchRequirements,
    productionDbReadiness,
    evaluationEvidence,
    environmentMatrix,
    hybridDeploymentReadiness,
    healthDashboard,
    priorityApplicationTemplates,
    maternalChildReadiness,
    publicHealthReadiness,
    policyCoverage
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
    "See `docs/production-go-live-requirements.md` for the real production go-live requirements, site-owned inputs, blocking conditions, drill schedule, and signoff evidence required before this checklist can be used for a formal production decision.",
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
    "## Research sandbox readiness report",
    "",
    "See `research-sandbox-readiness-report.json` and `research-sandbox-readiness-report.md` for dataset applications, disease registries, ethics approval, de-identification release, sandbox access, usage audit, and outcome return evidence.",
    "",
    "## Data quality and master index report",
    "",
    "See `data-quality-report.json` and `data-quality-report.md` for resident master index completeness, resident reference checks, source traceability, and rectification issue evidence.",
    "",
    "## Digital hospital standards readiness report",
    "",
    "See `digital-hospital-standards-readiness-report.json` and `digital-hospital-standards-readiness-report.md` for the standards center, official policy mapping, evaluation workflow, evidence model, review queue, pilot boundary, and no-patient-PII collection guardrails.",
    "",
    "## Phase 2 proposal readiness report",
    "",
    "See `phase2-proposal-readiness-report.json` and `phase2-proposal-readiness-report.md` for the phase-2 feasibility-study gap ledger, P0/P1/P2 work packages, onsite blockers, and release wiring evidence.",
    "",
    "## Phase 2 catalog readiness report",
    "",
    "See `phase2-catalog-readiness-report.json` and `phase2-catalog-readiness-report.md` for the 216-table mapping, data/service catalog, field lineage, quality rules, runtime API, and platform UI evidence.",
    "",
    "## Phase 2 joint-test readiness report",
    "",
    "See `phase2-joint-test-readiness-report.json` and `phase2-joint-test-readiness-report.md` for the tertiary-hospital, district-platform, and primary-care pilot institutions, signed sample payloads, gateway landing/replay traces, issue retest ledger, and onsite signoff boundary.",
    "",
    "## Phase 2 mutual recognition readiness report",
    "",
    "See `phase2-mutual-recognition-readiness-report.json` and `phase2-mutual-recognition-readiness-report.md` for the 78-item mutual-recognition catalog, report browser, recognition/non-recognition decision loop, citation evidence chain, supervision statistics, and onsite PDF/LIS/PACS blocker boundary.",
    "",
    "## Phase 2 disease reporting readiness report",
    "",
    "See `phase2-disease-reporting-readiness-report.json` and `phase2-disease-reporting-readiness-report.md` for diagnosis trigger rules, disease report queue, county receipts, patient-center import/export, supervision statistics, and onsite HIS/county-platform signoff boundary.",
    "",
    "## Phase 2 clinical assist readiness report",
    "",
    "See `phase2-clinical-assist-readiness-report.json` and `phase2-clinical-assist-readiness-report.md` for duplicate diagnosis/check/lab/medication rules, doctor workstation alerts, message receipts, plugin contracts, supervision statistics, and onsite HIS/EMR signoff boundary.",
    "",
    "## Phase 2 family doctor readiness report",
    "",
    "See `phase2-family-doctor-readiness-report.json` and `phase2-family-doctor-readiness-report.md` for templates, teams, service packages, resident applications, institution review, contract fulfillment, renewal/satisfaction evidence, citizen/institution/platform UI, and onsite unified-entry/e-signature blocker boundary.",
    "",
    "## Citizen service operations readiness report",
    "",
    "See `citizen-operations-readiness-report.json` and `citizen-operations-readiness-report.md` for content publishing, agreement versions, real-name review, cross-service order query, blacklist controls, hospital service enablement, resident public feed, and onsite production blockers.",
    "",
    "## Commercial crypto adapter center readiness report",
    "",
    "See `commercial-crypto-readiness-report.json` and `commercial-crypto-readiness-report.md` for six adapter contracts, SM2/SM3/SM4 runtime compatibility probes, evidence actions, onsite blockers and the production assessment boundary.",
    "",
    "## Medical quality and safety supervision report",
    "",
    "See `quality-safety-report.json` and `quality-safety-report.md` for medical quality, safety event, critical value, clinical pathway, medical record QC, mutual recognition QC, dispatch, feedback, and review evidence.",
    "## Drug consumable readiness report",
    "",
    "See `drug-consumable-readiness-report.json` and `drug-consumable-readiness-report.md` for rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement coordination, and remediation-loop evidence.",
    "",
    "## Operations readiness report",
    "",
    "See `operations-readiness-report.json` and `operations-readiness-report.md` for operation routes, production deployment tracks, external dependency risks, and release operation scripts.",
    "",
    "## Hospital operations readiness report",
    "",
    "See `hospital-operations-readiness-report.json` and `hospital-operations-readiness-report.md` for hospital operation snapshots, resource dispatch, direct-report reconciliation, alert rules, API permissions, and audit evidence.",
    "",
    "## Full process audit report",
    "",
    "See `process-audit-report.json` and `process-audit-report.md` for resident, chronic disease, county consortium, insurance, statistics, certificate, security, and cutover process evidence.",
    "",
    "## Site readiness pack",
    "",
    "See `site-readiness-pack.json` and `site-readiness-pack.md` for identity source mapping, interface joint-test, monitoring/on-call, and production signoff templates.",
    "",
    "## On-site launch requirements",
    "",
    "See `onsite-launch-requirements.json` and `onsite-launch-requirements.md` for field-owned production inputs, P0 blockers, resident mobile acceptance, gray release scope, and signoff evidence.",
    "",
    "## Monitoring readiness report",
    "",
    "See `monitoring-readiness-report.json` and `monitoring-readiness-report.md` for health and metrics routes, runtime metric signals, alert signals, SLO targets, and on-call escalation evidence.",
    "",
    "## Referral teleconsultation readiness report",
    "",
    "See `referral-teleconsultation-readiness-report.json` and `referral-teleconsultation-readiness-report.md` for referral, teleconsultation, receiving feedback, report return, collaboration order, resident authorization, and performance evidence.",
    "",
    "## Internet nursing readiness report",
    "",
    "See `internet-nursing-readiness-report.json` and `internet-nursing-readiness-report.md` for resident appointment, hospital assessment and dispatch, nurse acceptance, location trace, service record, quality callback, and policy evidence.",
    "",
    "## Citizen launch foundation readiness report",
    "",
    "See `citizen-launch-foundation-readiness.json` and `citizen-launch-foundation-readiness.md` for resident phone-code delivery, PWA/app shell refresh, mini-program/app routing, and production SMS, real-name, guardian, HTTPS, signing, push, and monitoring dependencies with owners, blockers, evidence, and onsite acceptance.",
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
    "## Hybrid deployment readiness report",
    "",
    "See `hybrid-deployment-readiness-report.json` and `hybrid-deployment-readiness-report.md` for the static preview layer, Node dynamic backend routes, storage guardrails, environment template, release wiring, and CI evidence.",
    "",
    "## Health dashboard summary",
    "",
    "See `health-dashboard-summary.json` and `health-dashboard-summary.md` for the aggregate entry across the first seven applications, open actions, interface tracks, evidence, and site dependencies.",
    "`GET /api/priority-applications/templates` exposes the live eight-application handoff templates for independent conversation work.",
    "See `priority-application-templates.json` and `priority-application-templates.md` for the standalone release artifact version of that handoff contract.",
    "See `maternal-child-readiness-report.json` and `maternal-child-readiness-report.md` for maternal-child policy, birth certificate workflow, role scope, API, privacy, and release evidence.",
    "See `public-health-readiness-report.json` and `public-health-readiness-report.md` for the 21/125/421 public-health standard matrix, institution scopes, event loop, exchange tasks, cutover blockers, API, and release evidence.",
    "See `policy-coverage-report.json` and `policy-coverage-report.md` for About-page policy IDs, policy documents, template rules, CI, deploy check, release manifest, and operator documentation coverage.",
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
    const chronicInstitutionInterfacesJson = path.join(path.dirname(output), "chronic-institution-interfaces.json");
    fs.writeFileSync(chronicInstitutionInterfacesJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      chronicInstitutionInterfaces: report.chronicInstitutionInterfaces
    }, null, 2), "utf8");
    const chronicLaunchCoreJson = path.join(path.dirname(output), "chronic-launch-core.json");
    fs.writeFileSync(chronicLaunchCoreJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      chronicLaunchCore: report.chronicLaunchCore
    }, null, 2), "utf8");
    const dataQualityJson = path.join(path.dirname(output), "data-quality-report.json");
    fs.writeFileSync(dataQualityJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      dataQuality: report.dataQuality
    }, null, 2), "utf8");
    const dataGovernanceJson = path.join(path.dirname(output), "data-governance-readiness-report.json");
    fs.writeFileSync(dataGovernanceJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      dataGovernance: report.dataGovernance
    }, null, 2), "utf8");
    const digitalHospitalStandardsJson = path.join(path.dirname(output), "digital-hospital-standards-readiness-report.json");
    fs.writeFileSync(digitalHospitalStandardsJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      digitalHospitalStandards: report.digitalHospitalStandards
    }, null, 2), "utf8");
    const phase2ProposalJson = path.join(path.dirname(output), "phase2-proposal-readiness-report.json");
    fs.writeFileSync(phase2ProposalJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      phase2Proposal: report.phase2Proposal
    }, null, 2), "utf8");
    const phase2CatalogJson = path.join(path.dirname(output), "phase2-catalog-readiness-report.json");
    fs.writeFileSync(phase2CatalogJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      phase2Catalog: report.phase2Catalog
    }, null, 2), "utf8");
    const phase2JointTestJson = path.join(path.dirname(output), "phase2-joint-test-readiness-report.json");
    fs.writeFileSync(phase2JointTestJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      phase2JointTest: report.phase2JointTest
    }, null, 2), "utf8");
    const phase2MutualRecognitionJson = path.join(path.dirname(output), "phase2-mutual-recognition-readiness-report.json");
    fs.writeFileSync(phase2MutualRecognitionJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      phase2MutualRecognition: report.phase2MutualRecognition
    }, null, 2), "utf8");
    const phase2DiseaseReportingJson = path.join(path.dirname(output), "phase2-disease-reporting-readiness-report.json");
    fs.writeFileSync(phase2DiseaseReportingJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      phase2DiseaseReporting: report.phase2DiseaseReporting
    }, null, 2), "utf8");
    const phase2ClinicalAssistJson = path.join(path.dirname(output), "phase2-clinical-assist-readiness-report.json");
    fs.writeFileSync(phase2ClinicalAssistJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      phase2ClinicalAssist: report.phase2ClinicalAssist
    }, null, 2), "utf8");
    const phase2FamilyDoctorJson = path.join(path.dirname(output), "phase2-family-doctor-readiness-report.json");
    fs.writeFileSync(phase2FamilyDoctorJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      phase2FamilyDoctor: report.phase2FamilyDoctor
    }, null, 2), "utf8");
    const citizenOperationsJson = path.join(path.dirname(output), "citizen-operations-readiness-report.json");
    fs.writeFileSync(citizenOperationsJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      citizenOperations: report.citizenOperations
    }, null, 2), "utf8");
    const registrationJourneyJson = path.join(path.dirname(output), "registration-journey-readiness-report.json");
    fs.writeFileSync(registrationJourneyJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      registrationJourney: report.registrationJourney
    }, null, 2), "utf8");
    const registrationIntegrationJson = path.join(path.dirname(output), "registration-integration-readiness-report.json");
    fs.writeFileSync(registrationIntegrationJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      registrationIntegration: report.registrationIntegration
    }, null, 2), "utf8");
    const commercialCryptoJson = path.join(path.dirname(output), "commercial-crypto-readiness-report.json");
    fs.writeFileSync(commercialCryptoJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      commercialCrypto: report.commercialCrypto
    }, null, 2), "utf8");
    const qualitySafetyJson = path.join(path.dirname(output), "quality-safety-report.json");
    fs.writeFileSync(qualitySafetyJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      qualitySafety: report.qualitySafety
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
    const regionalDataSharingJson = path.join(path.dirname(output), "regional-data-sharing-report.json");
    fs.writeFileSync(regionalDataSharingJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      regionalDataSharing: report.regionalDataSharing
    }, null, 2), "utf8");
    const drugConsumableJson = path.join(path.dirname(output), "drug-consumable-readiness-report.json");
    fs.writeFileSync(drugConsumableJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      drugConsumable: report.drugConsumable
    }, null, 2), "utf8");
    const researchSandboxJson = path.join(path.dirname(output), "research-sandbox-readiness-report.json");
    fs.writeFileSync(researchSandboxJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      researchSandbox: report.researchSandbox
    }, null, 2), "utf8");
    const operationsJson = path.join(path.dirname(output), "operations-readiness-report.json");
    fs.writeFileSync(operationsJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      operationsReadiness: report.operationsReadiness
    }, null, 2), "utf8");
    const hospitalOperationsJson = path.join(path.dirname(output), "hospital-operations-readiness-report.json");
    fs.writeFileSync(hospitalOperationsJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      hospitalOperationsReadiness: report.hospitalOperationsReadiness
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
    const onsiteLaunchRequirementsJson = path.join(path.dirname(output), "onsite-launch-requirements.json");
    fs.writeFileSync(onsiteLaunchRequirementsJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      onsiteLaunchRequirements: report.onsiteLaunchRequirements
    }, null, 2), "utf8");
    const monitoringJson = path.join(path.dirname(output), "monitoring-readiness-report.json");
    fs.writeFileSync(monitoringJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      monitoringReadiness: report.monitoringReadiness
    }, null, 2), "utf8");
    const referralTeleconsultationJson = path.join(path.dirname(output), "referral-teleconsultation-readiness-report.json");
    fs.writeFileSync(referralTeleconsultationJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      referralTeleconsultationReadiness: report.referralTeleconsultationReadiness
    }, null, 2), "utf8");
    const escortServiceJson = path.join(path.dirname(output), "escort-service-readiness-report.json");
    fs.writeFileSync(escortServiceJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      escortServiceReadiness: report.escortServiceReadiness
    }, null, 2), "utf8");
    const internetNursingJson = path.join(path.dirname(output), "internet-nursing-readiness-report.json");
    fs.writeFileSync(internetNursingJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      internetNursingReadiness: report.internetNursingReadiness
    }, null, 2), "utf8");
    const citizenLaunchFoundationJson = path.join(path.dirname(output), "citizen-launch-foundation-readiness.json");
    fs.writeFileSync(citizenLaunchFoundationJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      citizenLaunchFoundation: report.citizenLaunchFoundation
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
    const hybridDeploymentJson = path.join(path.dirname(output), "hybrid-deployment-readiness-report.json");
    fs.writeFileSync(hybridDeploymentJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      hybridDeploymentReadiness: report.hybridDeploymentReadiness
    }, null, 2), "utf8");
    const healthDashboardJson = path.join(path.dirname(output), "health-dashboard-summary.json");
    fs.writeFileSync(healthDashboardJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      healthDashboard: report.healthDashboard
    }, null, 2), "utf8");
    const priorityApplicationTemplatesJson = path.join(path.dirname(output), "priority-application-templates.json");
    fs.writeFileSync(priorityApplicationTemplatesJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      priorityApplicationTemplates: report.priorityApplicationTemplates
    }, null, 2), "utf8");
    const maternalChildReadinessJson = path.join(path.dirname(output), "maternal-child-readiness-report.json");
    fs.writeFileSync(maternalChildReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      maternalChildReadiness: report.maternalChildReadiness
    }, null, 2), "utf8");
    const publicHealthReadinessJson = path.join(path.dirname(output), "public-health-readiness-report.json");
    fs.writeFileSync(publicHealthReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      publicHealthReadiness: report.publicHealthReadiness
    }, null, 2), "utf8");
    const policyCoverageJson = path.join(path.dirname(output), "policy-coverage-report.json");
    fs.writeFileSync(policyCoverageJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      policyCoverage: report.policyCoverage
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
    const chronicInstitutionInterfacesMarkdown = path.join(path.dirname(markdown), "chronic-institution-interfaces.md");
    fs.writeFileSync(chronicInstitutionInterfacesMarkdown, renderChronicInstitutionInterfaceMarkdown(report.chronicInstitutionInterfaces), "utf8");
    const chronicLaunchCoreMarkdown = path.join(path.dirname(markdown), "chronic-launch-core.md");
    fs.writeFileSync(chronicLaunchCoreMarkdown, renderChronicLaunchCoreMarkdown(report.chronicLaunchCore), "utf8");
    const dataQualityMarkdown = path.join(path.dirname(markdown), "data-quality-report.md");
    fs.writeFileSync(dataQualityMarkdown, renderDataQualityMarkdown(report.dataQuality), "utf8");
    const dataGovernanceMarkdown = path.join(path.dirname(markdown), "data-governance-readiness-report.md");
    fs.writeFileSync(dataGovernanceMarkdown, renderDataGovernanceMarkdown(report.dataGovernance), "utf8");
    const digitalHospitalStandardsMarkdown = path.join(path.dirname(markdown), "digital-hospital-standards-readiness-report.md");
    fs.writeFileSync(digitalHospitalStandardsMarkdown, renderDigitalHospitalStandardsMarkdown(report.digitalHospitalStandards), "utf8");
    const phase2ProposalMarkdown = path.join(path.dirname(markdown), "phase2-proposal-readiness-report.md");
    fs.writeFileSync(phase2ProposalMarkdown, renderPhase2ProposalMarkdown(report.phase2Proposal), "utf8");
    const phase2CatalogMarkdown = path.join(path.dirname(markdown), "phase2-catalog-readiness-report.md");
    fs.writeFileSync(phase2CatalogMarkdown, renderPhase2CatalogMarkdown(report.phase2Catalog), "utf8");
    const phase2JointTestMarkdown = path.join(path.dirname(markdown), "phase2-joint-test-readiness-report.md");
    fs.writeFileSync(phase2JointTestMarkdown, renderPhase2JointTestMarkdown(report.phase2JointTest), "utf8");
    const phase2MutualRecognitionMarkdown = path.join(path.dirname(markdown), "phase2-mutual-recognition-readiness-report.md");
    fs.writeFileSync(phase2MutualRecognitionMarkdown, renderPhase2MutualRecognitionMarkdown(report.phase2MutualRecognition), "utf8");
    const phase2DiseaseReportingMarkdown = path.join(path.dirname(markdown), "phase2-disease-reporting-readiness-report.md");
    fs.writeFileSync(phase2DiseaseReportingMarkdown, renderPhase2DiseaseReportingMarkdown(report.phase2DiseaseReporting), "utf8");
    const phase2ClinicalAssistMarkdown = path.join(path.dirname(markdown), "phase2-clinical-assist-readiness-report.md");
    fs.writeFileSync(phase2ClinicalAssistMarkdown, renderPhase2ClinicalAssistMarkdown(report.phase2ClinicalAssist), "utf8");
    const phase2FamilyDoctorMarkdown = path.join(path.dirname(markdown), "phase2-family-doctor-readiness-report.md");
    fs.writeFileSync(phase2FamilyDoctorMarkdown, renderPhase2FamilyDoctorMarkdown(report.phase2FamilyDoctor), "utf8");
    const citizenOperationsMarkdown = path.join(path.dirname(markdown), "citizen-operations-readiness-report.md");
    fs.writeFileSync(citizenOperationsMarkdown, renderCitizenOperationsMarkdown(report.citizenOperations), "utf8");
    const registrationJourneyMarkdown = path.join(path.dirname(markdown), "registration-journey-readiness-report.md");
    fs.writeFileSync(registrationJourneyMarkdown, renderRegistrationJourneyMarkdown(report.registrationJourney), "utf8");
    const registrationIntegrationMarkdown = path.join(path.dirname(markdown), "registration-integration-readiness-report.md");
    fs.writeFileSync(registrationIntegrationMarkdown, renderRegistrationIntegrationMarkdown(report.registrationIntegration), "utf8");
    const commercialCryptoMarkdown = path.join(path.dirname(markdown), "commercial-crypto-readiness-report.md");
    fs.writeFileSync(commercialCryptoMarkdown, renderCommercialCryptoMarkdown(report.commercialCrypto), "utf8");
    const qualitySafetyMarkdown = path.join(path.dirname(markdown), "quality-safety-report.md");
    fs.writeFileSync(qualitySafetyMarkdown, renderQualitySafetyMarkdown(report.qualitySafety), "utf8");
    const integrationMarkdown = path.join(path.dirname(markdown), "integration-readiness-report.md");
    fs.writeFileSync(integrationMarkdown, renderIntegrationReadinessMarkdown(report.integrationReadiness), "utf8");
    const interfaceMappingMarkdown = path.join(path.dirname(markdown), "interface-mapping-report.md");
    fs.writeFileSync(interfaceMappingMarkdown, renderInterfaceMappingMarkdown(report.interfaceMapping), "utf8");
    const regionalDataSharingMarkdown = path.join(path.dirname(markdown), "regional-data-sharing-report.md");
    fs.writeFileSync(regionalDataSharingMarkdown, renderRegionalDataSharingMarkdown(report.regionalDataSharing), "utf8");
    const drugConsumableMarkdown = path.join(path.dirname(markdown), "drug-consumable-readiness-report.md");
    fs.writeFileSync(drugConsumableMarkdown, renderDrugConsumableMarkdown(report.drugConsumable), "utf8");
    const researchSandboxMarkdown = path.join(path.dirname(markdown), "research-sandbox-readiness-report.md");
    fs.writeFileSync(researchSandboxMarkdown, renderResearchSandboxMarkdown(report.researchSandbox), "utf8");
    const operationsMarkdown = path.join(path.dirname(markdown), "operations-readiness-report.md");
    fs.writeFileSync(operationsMarkdown, renderOperationsReadinessMarkdown(report.operationsReadiness), "utf8");
    const hospitalOperationsMarkdown = path.join(path.dirname(markdown), "hospital-operations-readiness-report.md");
    fs.writeFileSync(hospitalOperationsMarkdown, renderHospitalOperationsReadinessMarkdown(report.hospitalOperationsReadiness), "utf8");
    const processAuditMarkdown = path.join(path.dirname(markdown), "process-audit-report.md");
    fs.writeFileSync(processAuditMarkdown, renderProcessAuditMarkdown(report.processAudit), "utf8");
    const serviceAcceptanceMarkdown = path.join(path.dirname(markdown), "service-acceptance-summary.md");
    fs.writeFileSync(serviceAcceptanceMarkdown, renderServiceAcceptanceMarkdown(report), "utf8");
    const siteReadinessMarkdown = path.join(path.dirname(markdown), "site-readiness-pack.md");
    fs.writeFileSync(siteReadinessMarkdown, renderSiteReadinessMarkdown(report.siteReadinessPack), "utf8");
    writeTemplateReadmes(report.siteReadinessPack, path.join(path.dirname(path.relative(ROOT, markdown)), "templates"));
    const onsiteLaunchRequirementsMarkdown = path.join(path.dirname(markdown), "onsite-launch-requirements.md");
    fs.writeFileSync(onsiteLaunchRequirementsMarkdown, renderOnsiteLaunchRequirementsMarkdown(report.onsiteLaunchRequirements), "utf8");
    const monitoringMarkdown = path.join(path.dirname(markdown), "monitoring-readiness-report.md");
    fs.writeFileSync(monitoringMarkdown, renderMonitoringReadinessMarkdown(report.monitoringReadiness), "utf8");
    const referralTeleconsultationMarkdown = path.join(path.dirname(markdown), "referral-teleconsultation-readiness-report.md");
    fs.writeFileSync(referralTeleconsultationMarkdown, renderReferralTeleconsultationReadinessMarkdown(report.referralTeleconsultationReadiness), "utf8");
    const escortServiceMarkdown = path.join(path.dirname(markdown), "escort-service-readiness-report.md");
    fs.writeFileSync(escortServiceMarkdown, renderEscortServiceMarkdown(report.escortServiceReadiness), "utf8");
    const internetNursingMarkdown = path.join(path.dirname(markdown), "internet-nursing-readiness-report.md");
    fs.writeFileSync(internetNursingMarkdown, renderInternetNursingMarkdown(report.internetNursingReadiness), "utf8");
    const citizenLaunchFoundationMarkdown = path.join(path.dirname(markdown), "citizen-launch-foundation-readiness.md");
    fs.writeFileSync(citizenLaunchFoundationMarkdown, renderCitizenLaunchFoundationMarkdown(report.citizenLaunchFoundation), "utf8");
    const productionDbMarkdown = path.join(path.dirname(markdown), "production-db-readiness-report.md");
    fs.writeFileSync(productionDbMarkdown, renderProductionDbReadinessMarkdown(report.productionDbReadiness), "utf8");
    const evaluationMarkdown = path.join(path.dirname(markdown), "evaluation-evidence-report.md");
    fs.writeFileSync(evaluationMarkdown, renderEvaluationEvidenceMarkdown(report.evaluationEvidence), "utf8");
    const environmentMarkdown = path.join(path.dirname(markdown), "environment-matrix-report.md");
    fs.writeFileSync(environmentMarkdown, renderEnvironmentMatrixMarkdown(report.environmentMatrix), "utf8");
    const hybridDeploymentMarkdown = path.join(path.dirname(markdown), "hybrid-deployment-readiness-report.md");
    fs.writeFileSync(hybridDeploymentMarkdown, renderHybridDeploymentMarkdown(report.hybridDeploymentReadiness), "utf8");
    const healthDashboardMarkdown = path.join(path.dirname(markdown), "health-dashboard-summary.md");
    fs.writeFileSync(healthDashboardMarkdown, renderHealthDashboardMarkdown(report.healthDashboard), "utf8");
    const priorityApplicationTemplatesMarkdown = path.join(path.dirname(markdown), "priority-application-templates.md");
    fs.writeFileSync(priorityApplicationTemplatesMarkdown, renderPriorityApplicationTemplatesMarkdown(report.priorityApplicationTemplates), "utf8");
    const maternalChildReadinessMarkdown = path.join(path.dirname(markdown), "maternal-child-readiness-report.md");
    fs.writeFileSync(maternalChildReadinessMarkdown, renderMaternalChildReadinessMarkdown(report.maternalChildReadiness), "utf8");
    const publicHealthReadinessMarkdown = path.join(path.dirname(markdown), "public-health-readiness-report.md");
    fs.writeFileSync(publicHealthReadinessMarkdown, renderPublicHealthMarkdown(report.publicHealthReadiness), "utf8");
    const policyCoverageMarkdown = path.join(path.dirname(markdown), "policy-coverage-report.md");
    fs.writeFileSync(policyCoverageMarkdown, renderPolicyCoverageMarkdown(report.policyCoverage), "utf8");
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
