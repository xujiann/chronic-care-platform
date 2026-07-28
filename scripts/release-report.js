#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { hospitalConnectorCenter } = require("../hospital-connectors");
const { financialGatewayCenter } = require("../financial-gateways");
const { objectStorageCenter } = require("../secure-object-storage");
const { alertRoutingCenter } = require("../observability-alerting");
const { productionAdapterCenter } = require("../production-adapters");
const { buildAuditRetentionReport, renderMarkdown: renderAuditRetentionMarkdown } = require("./audit-retention");
const { buildChronicFollowupReadinessReport, renderMarkdown: renderChronicFollowupMarkdown } = require("./chronic-followup-readiness");
const { buildChronicInformatizationSourceReport, renderMarkdown: renderChronicInformatizationSourceMarkdown } = require("./chronic-informatization-sources");
const { buildChronicInstitutionInterfaceReport, renderMarkdown: renderChronicInstitutionInterfaceMarkdown } = require("./chronic-institution-interfaces");
const { buildChronicLaunchCoreReport, renderMarkdown: renderChronicLaunchCoreMarkdown } = require("./chronic-launch-core");
const { buildCitizenLaunchFoundationReadiness, renderMarkdown: renderCitizenLaunchFoundationMarkdown } = require("./citizen-launch-foundation-readiness");
const { assessCitizenRecordsReadiness, renderMarkdown: renderCitizenRecordsMarkdown } = require("./citizen-records-readiness");
const { buildRegistrationReferralAcceptance, renderMarkdown: renderRegistrationReferralAcceptanceMarkdown } = require("./registration-referral-acceptance");
const { buildCitizenOperationsReadiness, renderMarkdown: renderCitizenOperationsMarkdown } = require("./citizen-operations-readiness");
const { buildCommercialCryptoReadiness, renderMarkdown: renderCommercialCryptoMarkdown } = require("./commercial-crypto-readiness");
const { buildProductionSecurityReadiness, renderMarkdown: renderProductionSecurityMarkdown } = require("./production-security-readiness");
const { buildProductionGoNoGoReadiness, renderMarkdown: renderProductionGoNoGoMarkdown } = require("./production-go-no-go-readiness");
const {
  DEFAULT_EVIDENCE_DIR: DEFAULT_PRODUCTION_RELEASE_EVIDENCE_DIR,
  buildProductionReleaseEvidenceReadiness,
  renderMarkdown: renderProductionReleaseEvidenceMarkdown
} = require("./production-release-evidence-readiness");
const { buildPilotAcceptanceCenter } = require("../pilot-acceptance");
const { renderMarkdown: renderPilotAcceptanceMarkdown } = require("./pilot-acceptance-readiness");
const { buildDataGovernanceReadiness, renderMarkdown: renderDataGovernanceMarkdown } = require("./data-governance-readiness");
const { buildDataQualityReport, renderMarkdown: renderDataQualityMarkdown } = require("./data-quality-report");
const { buildDigitalHospitalStandardsReadiness, renderMarkdown: renderDigitalHospitalStandardsMarkdown } = require("./digital-hospital-standards-readiness");
const { buildDigitalHospitalPilotReadiness, renderMarkdown: renderDigitalHospitalPilotMarkdown } = require("./digital-hospital-pilot-readiness");
const { buildPlatformProductionAudit, renderMarkdown: renderPlatformProductionAuditMarkdown } = require("./platform-production-audit");
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
const { buildCareServiceProductionReadiness, renderMarkdown: renderCareServiceProductionReadinessMarkdown } = require("./care-service-production-readiness");
const { buildEnvironmentMatrixReport, renderMarkdown: renderEnvironmentMatrixMarkdown } = require("./environment-matrix");
const { buildEmergencyReadinessReport, renderMarkdown: renderEmergencyReadinessMarkdown } = require("./emergency-readiness");
const { buildSpecialtyCutoverPack, renderMarkdown: renderSpecialtyCutoverMarkdown } = require("../emergency-specialty-cutover");
const BloodClinicalProduction = require("../blood-clinical-production");
const EmergencyModuleGate = require("../emergency-module-gate");
const ImagingCloudProduction = require("../imaging-cloud-production");
const { buildReport: buildPhysicalExaminationStandaloneReadiness } = require("./physical-examination-standalone-readiness");
const { buildHealthDashboardSummary, buildPriorityApplicationTemplates, renderMarkdown: renderHealthDashboardMarkdown } = require("./health-dashboard-summary");
const { buildHybridDeploymentReadinessReport, renderMarkdown: renderHybridDeploymentMarkdown } = require("./hybrid-deployment-readiness");
const { buildProductionDeploymentPackage, verifyProductionDeploymentPackage, renderMarkdown: renderProductionDeploymentMarkdown } = require("./production-deployment-package");
const { buildIdentityContract, renderMarkdown: renderIdentityContractMarkdown } = require("./identity-contract");
const { buildIntegrationReadinessReport, renderMarkdown: renderIntegrationReadinessMarkdown } = require("./integration-readiness");
const { buildObjectStorageReadiness, renderMarkdown: renderObjectStorageMarkdown } = require("./object-storage-readiness");
const { buildFinancialGatewayReadiness, renderMarkdown: renderFinancialGatewayMarkdown } = require("./financial-gateway-readiness");
const { buildInterfaceMappingReport, renderMarkdown: renderInterfaceMappingMarkdown } = require("./interface-mapping");
const { buildHospitalOperationsReadinessReport, renderMarkdown: renderHospitalOperationsReadinessMarkdown } = require("./hospital-operations-readiness");
const { buildHospitalOperationsReleaseReport, renderMarkdown: renderHospitalOperationsReleaseMarkdown } = require("./hospital-operations-release");
const { buildHospitalOperationsModuleReport, renderMarkdown: renderHospitalOperationsModuleMarkdown } = require("./hospital-operations-module-report");
const { buildHospitalOperationsBriefPdfReport, renderMarkdown: renderHospitalOperationsBriefPdfMarkdown } = require("./hospital-operations-brief-pdf");
const { buildMonitoringReadinessReport, renderMarkdown: renderMonitoringReadinessMarkdown } = require("./monitoring-readiness");
const { buildOperationsReadinessReport, renderMarkdown: renderOperationsReadinessMarkdown } = require("./operations-readiness");
const { buildRegistrationJourneyReadiness, renderMarkdown: renderRegistrationJourneyMarkdown } = require("./registration-journey-readiness");
const { buildRegistrationIntegrationReadiness, renderMarkdown: renderRegistrationIntegrationMarkdown } = require("./registration-integration-readiness");
const { buildOnsiteLaunchRequirements, renderMarkdown: renderOnsiteLaunchRequirementsMarkdown } = require("./onsite-launch-requirements");
const { buildMaternalChildReadinessReport, renderMarkdown: renderMaternalChildReadinessMarkdown } = require("./maternal-child-readiness");
const { buildImmunizationReadinessReport, renderMarkdown: renderImmunizationReadinessMarkdown } = require("./immunization-readiness");
const { buildPolicyCoverageReport, renderMarkdown: renderPolicyCoverageMarkdown } = require("./policy-coverage");
const { buildProcessAuditReport, renderMarkdown: renderProcessAuditMarkdown } = require("./process-audit");
const { buildProductionDbReadinessReport, renderMarkdown: renderProductionDbReadinessMarkdown } = require("./production-db-readiness");
const { buildPublicHealthReadinessReport, renderMarkdown: renderPublicHealthMarkdown } = require("./public-health-readiness");
const { buildPublicHealthHighlightsReadiness, renderMarkdown: renderPublicHealthHighlightsMarkdown } = require("./public-health-highlights-readiness");
const { buildPublicHealthFinalReadiness, renderMarkdown: renderPublicHealthFinalMarkdown } = require("./public-health-final-readiness");
const { buildBloodSystemReadinessReport, renderMarkdown: renderBloodSystemMarkdown } = require("./blood-system-readiness");
const { buildDiseasePaymentReadiness, renderMarkdown: renderDiseasePaymentMarkdown } = require("./disease-payment-readiness");
const { buildInsurancePaymentAcceptance, renderMarkdown: renderInsurancePaymentAcceptanceMarkdown } = require("./insurance-payment-acceptance");
const { buildInsurancePaymentEvidencePacket, renderMarkdown: renderInsurancePaymentEvidenceMarkdown, verifyInsurancePaymentEvidencePacket } = require("./insurance-payment-evidence-packet");
const { renderMarkdown: renderPriorityApplicationTemplatesMarkdown } = require("./priority-application-templates");
const { buildRegionalDataSharingReport, renderMarkdown: renderRegionalDataSharingMarkdown } = require("./regional-data-sharing");
const { buildRegionalReferralOverlapReport, renderMarkdown: renderRegionalReferralOverlapMarkdown } = require("./regional-referral-overlap");
const { buildQualitySafetyReport, renderMarkdown: renderQualitySafetyMarkdown } = require("./quality-safety-report");
const { buildQualitySafetyInterfaceStandard, renderMarkdown: renderQualitySafetyInterfaceStandardMarkdown } = require("./quality-safety-interface-standard");
const { buildQualitySafetyInterfaceJointTestPack, renderMarkdown: renderQualitySafetyInterfaceJointTestMarkdown } = require("./quality-safety-interface-joint-test");
const { buildQualityOperationsGovernanceReadiness, renderMarkdown: renderQualityOperationsGovernanceMarkdown } = require("./quality-operations-governance-readiness");
const { buildReleaseArtifactManifest, renderMarkdown: renderReleaseArtifactManifestMarkdown } = require("./release-artifact-manifest");
const { buildCapabilityMap, renderCapabilityMapMarkdown } = require("../platform-capability-map");
const { buildPlatformGoLiveSlices, renderPlatformGoLiveSlicesMarkdown } = require("../platform-go-live-slices");
const { buildPlatformStandardsLedgers, renderPlatformStandardsLedgersMarkdown } = require("../platform-standards-ledgers");
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
  const sqliteProfileChecks = ["auto", "sqlite"].includes(storageEngine)
    ? ["env:SQLITE.journalMode", "env:SQLITE.synchronous", "env:SQLITE.busyTimeout"]
    : [];
  return [
    {
      id: "cutover-env-file",
      phase: "environment",
      owner: "platform-ops",
      passed: ready("env:file", "env:NODE_ENV.production", "env:STORAGE_ENGINE", "env:STORAGE_ENGINE.production", "env:SESSION_STORE.present", "env:SESSION_STORE", "env:SESSION_STORE.productionDurable", "env:SESSION_TOPOLOGY.present", "env:SESSION_TOPOLOGY", "env:SESSION_TOPOLOGY.storeCompatible", "env:SESSION_POSTGRES.database", "env:SESSION_POSTGRES.tls", "env:SESSION_RETENTION.present", "env:SESSION_RETENTION.policy", "env:SESSION_RETENTION.interval", "env:DEPLOYMENT.releaseId", "env:DEPLOYMENT.artifactDigest"),
      evidence: detail("env:file", "env:NODE_ENV.production", "env:STORAGE_ENGINE", "env:STORAGE_ENGINE.production", "env:SESSION_STORE.present", "env:SESSION_STORE", "env:SESSION_STORE.productionDurable", "env:SESSION_TOPOLOGY.present", "env:SESSION_TOPOLOGY", "env:SESSION_TOPOLOGY.storeCompatible", "env:SESSION_POSTGRES.database", "env:SESSION_POSTGRES.tls", "env:SESSION_RETENTION.present", "env:SESSION_RETENTION.policy", "env:SESSION_RETENTION.interval", "env:DEPLOYMENT.releaseId", "env:DEPLOYMENT.artifactDigest"),
      nextAction: "在目标服务器创建真实 .env，设置 NODE_ENV=production，绑定已批准发布编号和不可变制品摘要，并确认不使用 JSON 作为生产主存储。"
    },
    {
      id: "cutover-secrets",
      phase: "security",
      owner: "security-admin",
      passed: ready("env:SESSION_SECRETS.present", "env:SESSION_SECRETS.productionQuality", "env:INTEGRATION_GATEWAY_SECRET.present", "env:INTEGRATION_GATEWAY_SECRET.productionQuality", "env:DEPLOYMENT.secretProvider"),
      evidence: detail("env:SESSION_SECRETS.present", "env:SESSION_SECRETS.productionQuality", "env:INTEGRATION_GATEWAY_SECRET.present", "env:INTEGRATION_GATEWAY_SECRET.productionQuality", "env:DEPLOYMENT.secretProvider"),
      nextAction: "由 Vault、KMS 或编排器注入不少于 32 位、非占位的会话和接口签名密钥；按轮换策略把新密钥放在 SESSION_SECRETS 首位。"
    },
    {
      id: "cutover-identity",
      phase: "identity",
      owner: "identity-integration",
      passed: ready("env:OIDC.identityAdapter", "env:OIDC.lifecycle", "env:SMS.gateway"),
      evidence: detail("env:OIDC.identityAdapter", "env:OIDC.lifecycle", "env:SMS.gateway"),
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
      passed: ready("env:STORAGE_ENGINE.runtimeAdapter", "env:DATABASE_URL.requiredForPostgres", ...sqliteProfileChecks) && !["postgres", "postgresql"].includes(storageEngine),
      evidence: detail("env:STORAGE_ENGINE.runtimeAdapter", "env:DATABASE_URL.requiredForPostgres", ...sqliteProfileChecks),
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
      passed: ready("integration:contractsReady", "env:FINANCIAL.gateways", "env:FINANCIAL.secretQuality") && envFlagEnabled(env, "CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF"),
      evidence: `${detail("integration:contractsReady", "env:FINANCIAL.gateways", "env:FINANCIAL.secretQuality")}; ${signoff("CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF")}`,
      nextAction: "Attach signed insurance settlement, electronic certificate, and statistics exchange acceptance evidence from upstream agencies."
    },
    {
      id: "cutover-monitoring",
      phase: "operations",
      owner: "platform-ops",
      passed: ready("operations:readiness", "operations:routes", "operations:externalDependencies", "monitoring:readiness", "monitoring:sloTargets", "monitoring:alertRouting", "monitoring:productionBoundary", "env:ALERTING.routes", "env:ALERTING.secretQuality") && envFlagEnabled(env, "CUTOVER_MONITORING_SIGNOFF"),
      evidence: `${detail("operations:readiness", "operations:routes", "operations:externalDependencies", "monitoring:readiness", "monitoring:sloTargets", "monitoring:alertRouting", "monitoring:productionBoundary", "env:ALERTING.routes", "env:ALERTING.secretQuality")}; ${signoff("CUTOVER_MONITORING_SIGNOFF")}`,
      nextAction: "Bind /api/live, /api/health, /api/metrics, readiness, alert routing, and on-call escalation to the production monitoring platform."
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
  const configuredSessionStore = String(env.SESSION_STORE || "").trim().toLowerCase();
  const sessionStore = configuredSessionStore || (strict ? "sqlite" : "memory");
  const configuredSessionTopology = String(env.SESSION_TOPOLOGY || "").trim().toLowerCase();
  const sessionTopology = configuredSessionTopology || "single-host";
  const sessionRetentionConfigured = ["SESSION_EXPIRED_RETENTION_DAYS", "SESSION_REVOKED_RETENTION_DAYS", "SESSION_CLEANUP_INTERVAL_MS"]
    .every((name) => String(env[name] || "").trim());
  const sessionExpiredRetentionDays = Number(env.SESSION_EXPIRED_RETENTION_DAYS || 7);
  const sessionRevokedRetentionDays = Number(env.SESSION_REVOKED_RETENTION_DAYS || 30);
  const sessionCleanupIntervalMs = Number(env.SESSION_CLEANUP_INTERVAL_MS || 900000);
  const sqliteJournalMode = String(env.SQLITE_JOURNAL_MODE || "").toUpperCase();
  const sqliteSynchronous = String(env.SQLITE_SYNCHRONOUS || "").toUpperCase();
  const sqliteBusyTimeout = Number(env.SQLITE_BUSY_TIMEOUT_MS || 0);
  const nodeEnv = String(env.NODE_ENV || "");
  const deploymentSecretProvider = String(env.DEPLOYMENT_SECRET_PROVIDER || "").trim().toLowerCase();
  const deploymentReleaseId = String(env.DEPLOYMENT_RELEASE_ID || "").trim();
  const deploymentArtifactDigest = String(env.DEPLOYMENT_ARTIFACT_DIGEST || "").trim().toLowerCase();
  const postgresSyncMode = String(env.POSTGRES_SYNC_MODE || "disabled").trim().toLowerCase();
  const postgresSslMode = String(env.POSTGRES_SSL_MODE || "verify-full").trim().toLowerCase();
  const alertRouting = alertRoutingCenter(env);
  const alertSecrets = [
    env.SIEM_ENDPOINT ? env.SIEM_SIGNING_SECRET || env.ALERTING_SIGNING_SECRET : "",
    env.ALERT_WEBHOOK_URL ? env.ALERT_WEBHOOK_SECRET || env.ALERTING_SIGNING_SECRET : ""
  ].filter((_, index) => index === 0 ? Boolean(env.SIEM_ENDPOINT) : Boolean(env.ALERT_WEBHOOK_URL));
  const configuredAlertInputs = alertRouting.routes.filter((item) => item.endpointConfigured);

  const checks = [
    check("env:file", envFileExists, envFileExists ? envFile : `${envFile} missing`, strict ? "error" : "warn", "environment"),
    check("env:NODE_ENV", Boolean(nodeEnv), nodeEnv || "missing", strict ? "error" : "warn", "environment"),
    check("env:STORAGE_ENGINE", ["auto", "json", "sqlite", "postgres", "postgresql"].includes(storageEngine), storageEngine, "error", "environment"),
    check("env:SESSION_STORE.present", !strict || Boolean(configuredSessionStore), strict ? configuredSessionStore || "missing SESSION_STORE" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:SESSION_STORE", ["memory", "sqlite", "postgres"].includes(sessionStore), sessionStore || "missing", "error", "environment"),
    check("env:SESSION_STORE.productionDurable", !strict || ["sqlite", "postgres"].includes(sessionStore), strict ? `${sessionStore}; production requires durable SQLite or PostgreSQL sessions` : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:SESSION_TOPOLOGY.present", !strict || Boolean(configuredSessionTopology), strict ? configuredSessionTopology || "missing SESSION_TOPOLOGY" : "defaults to single-host", strict ? "error" : "warn", "environment"),
    check("env:SESSION_TOPOLOGY", ["single-host", "multi-host"].includes(sessionTopology), sessionTopology, "error", "environment"),
    check("env:SESSION_TOPOLOGY.storeCompatible", sessionTopology !== "multi-host" || sessionStore === "postgres", `${sessionTopology} / ${sessionStore}`, "error", "environment"),
    check("env:SESSION_POSTGRES.database", sessionStore !== "postgres" || /^postgres(?:ql)?:\/\//i.test(String(env.DATABASE_URL || "")), sessionStore === "postgres" ? env.DATABASE_URL ? "configured" : "missing DATABASE_URL" : "not required", "error", "environment"),
    check("env:SESSION_POSTGRES.tls", sessionStore !== "postgres" || !strict || (Boolean(String(env.POSTGRES_SSL_MODE || "").trim()) && postgresSslMode === "verify-full"), sessionStore === "postgres" ? String(env.POSTGRES_SSL_MODE || "").trim() || "missing POSTGRES_SSL_MODE" : "not required", strict ? "error" : "warn", "environment"),
    check("env:SESSION_RETENTION.present", !strict || sessionRetentionConfigured, strict ? sessionRetentionConfigured ? "configured" : "missing session retention settings" : "defaults allowed outside production", strict ? "error" : "warn", "environment"),
    check("env:SESSION_RETENTION.policy", Number.isInteger(sessionExpiredRetentionDays) && sessionExpiredRetentionDays >= 1 && sessionExpiredRetentionDays <= 3650 && Number.isInteger(sessionRevokedRetentionDays) && sessionRevokedRetentionDays >= sessionExpiredRetentionDays && sessionRevokedRetentionDays <= 3650, `${sessionExpiredRetentionDays}d expired / ${sessionRevokedRetentionDays}d revoked`, "error", "environment"),
    check("env:SESSION_RETENTION.interval", Number.isInteger(sessionCleanupIntervalMs) && sessionCleanupIntervalMs >= 60000 && sessionCleanupIntervalMs <= 86400000, `${sessionCleanupIntervalMs}ms`, "error", "environment"),
    check("env:SESSION_SECRETS.present", sessionSecretItems.length > 0, `${sessionSecretItems.length} configured`, "error", "environment"),
    check("env:SESSION_SECRETS.productionQuality", !strict || sessionSecretItems.every((item) => secretQuality(item).strongEnough), strict ? "production secrets must be non-placeholder and at least 32 chars" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:INTEGRATION_GATEWAY_SECRET.present", Boolean(gatewaySecret), gatewaySecret ? "configured" : "missing", "error", "environment"),
    check("env:INTEGRATION_GATEWAY_SECRET.productionQuality", !strict || secretQuality(gatewaySecret).strongEnough, strict ? "production secret must be non-placeholder and at least 32 chars" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:ALERTING.routes", alertRouting.adapterReady && configuredAlertInputs.every((item) => item.configured && item.productionHttps), `${alertRouting.summary.configured}/${alertRouting.summary.total} SIEM or webhook routes configured; ${configuredAlertInputs.length} endpoints declared`, strict ? "error" : "warn", "environment"),
    check("env:ALERTING.secretQuality", !strict || (alertSecrets.length > 0 && alertSecrets.every((secret) => secretQuality(secret).strongEnough)), strict ? "configured alert route secrets must be non-placeholder and at least 32 chars" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:DEPLOYMENT.secretProvider", !strict || ["vault", "kms", "orchestrator"].includes(deploymentSecretProvider), strict ? deploymentSecretProvider || "missing DEPLOYMENT_SECRET_PROVIDER" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:DEPLOYMENT.releaseId", !strict || (Boolean(deploymentReleaseId) && !hasPlaceholder(deploymentReleaseId)), strict ? deploymentReleaseId || "missing DEPLOYMENT_RELEASE_ID" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:DEPLOYMENT.artifactDigest", !strict || /^sha256:[a-f0-9]{64}$/.test(deploymentArtifactDigest), strict ? deploymentArtifactDigest || "missing DEPLOYMENT_ARTIFACT_DIGEST" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:POSTGRES_SYNC.mode", ["disabled", "outbox"].includes(postgresSyncMode), postgresSyncMode, "error", "environment"),
    check("env:POSTGRES_SYNC.database", postgresSyncMode !== "outbox" || /^postgres(?:ql)?:\/\//i.test(String(env.DATABASE_URL || "")), postgresSyncMode === "outbox" ? "PostgreSQL URL required for shadow sync" : "shadow sync disabled", strict ? "error" : "warn", "environment"),
    check("env:POSTGRES_SYNC.tls", postgresSyncMode !== "outbox" || postgresSslMode === "verify-full", postgresSyncMode === "outbox" ? postgresSslMode : "shadow sync disabled", strict ? "error" : "warn", "environment")
  ];

  if (strict) {
    const hospitalConnectors = hospitalConnectorCenter(env);
    const hospitalSecrets = ["HIS", "EMR", "LIS", "PACS", "APPOINTMENT"].map((domain) => String(env[`${domain}_ADAPTER_SECRET`] || env.HOSPITAL_ADAPTER_SECRET || ""));
    const financialGateways = financialGatewayCenter(env);
    const financialSecrets = ["PAYMENT", "INSURANCE", "CERTIFICATE"].map((type) => String(env[`${type}_GATEWAY_SECRET`] || env.FINANCIAL_GATEWAY_SECRET || ""));
    const financialCallbackSecrets = ["PAYMENT", "INSURANCE", "CERTIFICATE"].map((type) => String(env[`${type}_CALLBACK_SECRET`] || env.FINANCIAL_CALLBACK_SECRET || ""));
    const secureObjectStorage = objectStorageCenter(env);
    const productionAdapters = productionAdapterCenter(env);
    checks.push(
      check("env:NODE_ENV.production", nodeEnv === "production", nodeEnv || "missing", "error", "environment"),
      check("env:STORAGE_ENGINE.production", storageEngine !== "json", "json storage is demo-only", "error", "environment"),
      check("env:STORAGE_ENGINE.runtimeAdapter", ["auto", "sqlite"].includes(storageEngine), ["auto", "sqlite"].includes(storageEngine) ? storageEngine : `${storageEngine} adapter not enabled`, "error", "environment"),
      check("env:DATABASE_URL.requiredForPostgres", !["postgres", "postgresql"].includes(storageEngine) || Boolean(env.DATABASE_URL), env.DATABASE_URL ? "configured" : "missing", "error", "environment"),
      check("env:SQLITE.journalMode", !["auto", "sqlite"].includes(storageEngine) || sqliteJournalMode === "WAL", sqliteJournalMode || "missing SQLITE_JOURNAL_MODE", "error", "environment"),
      check("env:SQLITE.synchronous", !["auto", "sqlite"].includes(storageEngine) || ["FULL", "EXTRA"].includes(sqliteSynchronous), sqliteSynchronous || "missing SQLITE_SYNCHRONOUS", "error", "environment"),
      check("env:SQLITE.busyTimeout", !["auto", "sqlite"].includes(storageEngine) || sqliteBusyTimeout >= 5000, Number.isFinite(sqliteBusyTimeout) ? `${sqliteBusyTimeout}ms` : "invalid SQLITE_BUSY_TIMEOUT_MS", "error", "environment"),
      check("env:OIDC.identityAdapter", Boolean(env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET), env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET ? "configured" : "missing OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET", "error", "environment"),
      check("env:OIDC.lifecycle", productionAdapters.identityLifecycleReady, productionAdapters.identityLifecycleReady ? "refresh, revocation and identity directory adapters configured with production HTTPS" : productionAdapters.blockers.join("; "), "error", "environment"),
      check("env:SMS.gateway", Boolean(env.SMS_GATEWAY_URL && env.SMS_TEMPLATE_ID), env.SMS_GATEWAY_URL && env.SMS_TEMPLATE_ID ? "configured" : "missing SMS_GATEWAY_URL/SMS_TEMPLATE_ID", "error", "environment"),
      check("env:SMS.deliveryCallback", productionAdapters.smsDeliveryCallbackReady, productionAdapters.smsDeliveryCallbackReady ? "signed final-delivery callback is configured" : "missing SMS_DELIVERY_CALLBACK_SECRET or SMS gateway HTTPS configuration", "error", "environment"),
      check("env:SMS.callbackSecretQuality", secretQuality(env.SMS_DELIVERY_CALLBACK_SECRET).strongEnough, "SMS callback signing secret must be non-placeholder and at least 32 chars", "error", "environment"),
      check("env:HOSPITAL.connectors", hospitalConnectors.adapterReady, `${hospitalConnectors.summary.configured}/${hospitalConnectors.summary.total} hospital connectors configured with production HTTPS`, "error", "environment"),
      check("env:HOSPITAL.secretQuality", hospitalSecrets.every((secret) => secretQuality(secret).strongEnough), "hospital adapter signing secrets must be non-placeholder and at least 32 chars", "error", "environment"),
      check("env:OBJECT_STORAGE.adapter", secureObjectStorage.adapterReady, secureObjectStorage.adapterReady ? "object storage gateway, bucket and HTTPS are configured" : "missing OBJECT_STORAGE_GATEWAY_URL/OBJECT_STORAGE_BUCKET/OBJECT_STORAGE_SIGNING_SECRET or production HTTPS", "error", "environment"),
      check("env:OBJECT_STORAGE.secretQuality", secretQuality(env.OBJECT_STORAGE_SIGNING_SECRET).strongEnough, "object storage signing secret must be non-placeholder and at least 32 chars", "error", "environment"),
      check("env:FINANCIAL.gateways", financialGateways.adapterReady, `${financialGateways.summary.configured}/${financialGateways.summary.total} payment, insurance and certificate gateways configured with production HTTPS`, "error", "environment"),
      check("env:FINANCIAL.secretQuality", financialSecrets.every((secret) => secretQuality(secret).strongEnough), "financial gateway signing secrets must be non-placeholder and at least 32 chars", "error", "environment"),
      check("env:FINANCIAL.callbacks", financialGateways.callbackReady, `${financialGateways.summary.callbacksConfigured}/${financialGateways.summary.total} signed callback domains configured`, "error", "environment"),
      check("env:FINANCIAL.callbackSecretQuality", financialCallbackSecrets.every((secret) => secretQuality(secret).strongEnough), "financial callback secrets must be separate, non-placeholder and at least 32 chars", "error", "environment"),
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
    "compliantDataExports",
    "dataAccessLogs",
    "accessibilityChecklist",
    "regionalDataSharingScope",
    "regionalSharingPackages",
    "regionalSharingSnapshots",
    "regionalSharingAccessReviews",
    "securityAcceptanceLedger",
    "healthDashboardSnapshots",
    "observabilityAlertDeliveries"
  ];
  const raw = fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8");
  const p2 = (data.platformRoadmap || []).filter((item) => item.priority === "P2");
  const evidence = Array.isArray(data.platformEvidence) ? data.platformEvidence : [];
  const acceptanceRecords = evidence.flatMap((item) => item.records || []);
  const securityAcceptanceLedger = Array.isArray(data.securityAcceptanceLedger) ? data.securityAcceptanceLedger : [];
  const productionDeploymentPlan = Array.isArray(data.productionDeploymentPlan) ? data.productionDeploymentPlan : [];
  const traceabilityPolicySources = Array.isArray(data.drugTraceabilityPolicySources) ? data.drugTraceabilityPolicySources : [];
  const traceabilityEvidenceRequirements = Array.isArray(data.drugTraceabilityEvidenceRequirements) ? data.drugTraceabilityEvidenceRequirements : [];
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
    check("snapshot:researchSandbox", (data.researchDatasets || []).some((item) => item.authorizationStatus === "approved" && (item.deidentificationStatus === "released" || item.anonymization) && (item.sandbox?.status === "active" || item.status === "published") && ["ethics-approval", "data-use-agreement"].every((type) => (item.evidenceDocuments || []).some((doc) => doc.type === type && doc.status !== "rejected"))) && (data.dataAccessLogs || []).some((item) => /research|科研|数据集|沙箱|export/i.test(`${item.scope || ""} ${item.purpose || ""}`)) && (data.compliantDataExports || []).some((item) => item.reviewStatus === "approved" && item.exportStatus === "released" && item.deidentified === true && item.minimumNecessary === true), `${data.researchDatasets?.length || 0} datasets / ${data.compliantDataExports?.length || 0} exports / ${data.dataAccessLogs?.length || 0} audit logs`, "error", "snapshot"),
    check("snapshot:externalDependencyRisks", externalDependencyRiskIds.every((id) => serverSource.includes(id)), `${externalDependencyRiskIds.length} external dependency risks`, "error", "snapshot"),
    check("snapshot:drugTraceabilityPolicySources", traceabilityPolicySources.length >= 5 && traceabilityPolicySources.every((item) => /^https:\/\/(www\.)?(nhsa|nmpa)\.gov\.cn\//.test(item.url || "")), `${traceabilityPolicySources.length} official traceability policy sources`, "error", "snapshot"),
    check("snapshot:drugTraceabilityEvidenceRequirements", traceabilityEvidenceRequirements.length >= 5 && traceabilityEvidenceRequirements.every((item) => item.id && Array.isArray(item.policySourceIds) && item.policySourceIds.every((id) => traceabilityPolicySources.some((source) => source.id === id)) && Array.isArray(item.evidenceFields) && item.evidenceFields.length > 0), `${traceabilityEvidenceRequirements.length} traceability evidence requirements`, "error", "snapshot"),
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

function chronicFollowupChecks(chronicFollowup, chronicInstitutionInterfaces, chronicLaunchCore, chronicInformatizationSources) {
  const failedBoundaries = (chronicFollowup.boundaries || []).filter((item) => !item.passed).map((item) => item.id);
  return [
    check("chronicFollowup:readiness", chronicFollowup.ok, chronicFollowup.ok ? "chronic follow-up readiness checks passed" : `chronic follow-up readiness checks failed: ${failedBoundaries.join(",") || "unknown"}`, "error", "chronic-followup"),
    check("chronicFollowup:boundaries", chronicFollowup.summary?.passed === chronicFollowup.summary?.boundaries, `${chronicFollowup.summary?.passed || 0}/${chronicFollowup.summary?.boundaries || 0} boundaries${failedBoundaries.length ? `: ${failedBoundaries.join(",")}` : ""}`, "error", "chronic-followup"),
    check("chronicFollowup:feedback", chronicFollowup.summary?.feedbackRecords >= 1, `${chronicFollowup.summary?.feedbackRecords || 0} feedback records`, "error", "chronic-followup"),
    check("chronicFollowup:notifications", chronicFollowup.summary?.notificationMessages >= 1, `${chronicFollowup.summary?.notificationMessages || 0} notification messages`, "error", "chronic-followup"),
    check("chronicFollowup:policyAlignment", chronicFollowup.summary?.policyAligned === chronicFollowup.summary?.policyItems, `${chronicFollowup.summary?.policyAligned || 0}/${chronicFollowup.summary?.policyItems || 0} policy items`, "error", "chronic-followup"),
    check("chronicFollowup:alertQueue", chronicFollowup.summary?.alerts >= 1 && chronicFollowup.summary?.overdueAlerts >= 1 && chronicFollowup.summary?.highPriorityAlerts >= 1, `${chronicFollowup.summary?.alerts || 0} alerts / ${chronicFollowup.summary?.overdueAlerts || 0} overdue / ${chronicFollowup.summary?.highPriorityAlerts || 0} high priority`, "error", "chronic-followup"),
    check("chronicFollowup:residentExperience", chronicFollowup.summary?.residentExperienceItems >= 5, `${chronicFollowup.summary?.residentExperienceItems || 0} resident experience records`, "error", "chronic-followup"),
    check("chronicFollowup:fieldIntegration", chronicFollowup.summary?.fieldIntegrationItems >= 4, `${chronicFollowup.summary?.fieldIntegrationItems || 0} field integration records`, "error", "chronic-followup"),
    check("chronicFollowup:publicHealthLoop", chronicFollowup.summary?.publicHealthLoopReadyStages === 6, `${chronicFollowup.summary?.publicHealthLoopReadyStages || 0}/6 public health loop stages`, "error", "chronic-followup"),
    check("chronicFollowup:publicHealthIntegrations", chronicFollowup.summary?.publicHealthReadyIntegrationLinks === 3, `${chronicFollowup.summary?.publicHealthReadyIntegrationLinks || 0}/3 public health integrations`, "error", "chronic-followup"),
    check("chronicFollowup:informatizationSources", chronicInformatizationSources?.ok && chronicInformatizationSources.summary?.readyCapabilityTracks === chronicInformatizationSources.summary?.capabilityTracks, `${chronicInformatizationSources?.summary?.readyCapabilityTracks || 0}/${chronicInformatizationSources?.summary?.capabilityTracks || 0} source capability tracks`, "error", "chronic-followup"),
    check("chronicFollowup:institutionInterfaces", chronicInstitutionInterfaces?.ok && chronicInstitutionInterfaces.summary?.readyContracts === chronicInstitutionInterfaces.summary?.contracts, `${chronicInstitutionInterfaces?.summary?.readyContracts || 0}/${chronicInstitutionInterfaces?.summary?.contracts || 0} institution contracts`, "error", "chronic-followup"),
    check("chronicFollowup:launchCore", chronicLaunchCore?.ok && chronicLaunchCore.summary?.readyItems === chronicLaunchCore.summary?.items, `${chronicLaunchCore?.summary?.readyItems || 0}/${chronicLaunchCore?.summary?.items || 0} launch core items`, "error", "chronic-followup")
  ];
}

function integrationReadinessChecks(integrationReadiness) {
  return [
    check("integration:readiness", integrationReadiness.ok, integrationReadiness.ok ? "integration readiness checks passed" : "integration readiness checks failed", "error", "integration"),
    check("integration:contractsReady", integrationReadiness.contracts?.every((item) => /(^ready$|-ready$)/i.test(String(item.status || ""))), `${integrationReadiness.contractCount || 0} contracts`, "error", "integration"),
    check("integration:p0Coverage", integrationReadiness.p0Coverage?.every((item) => item.ready), `${integrationReadiness.p0InterfaceCount || 0} P0 interfaces`, "error", "integration"),
    check("integration:runtimeAdapters", integrationReadiness.runtimeAdapters?.length === 5 && integrationReadiness.runtimeAdapters.every((item) => item.sourceReady && item.environmentReady && item.runtimeReady && item.boundaryReady), `${integrationReadiness.runtimeAdapters?.length || 0}/5 hospital runtime adapter foundations`, "error", "integration")
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
  const handoffReportApi = regionalDataSharing.checks?.some((item) => item.id === "regional:handoffReportApi" && item.passed);
  const handoffReportUi = regionalDataSharing.checks?.some((item) => item.id === "regional:handoffReportUi" && item.passed);
  return [
    check("regionalDataSharing:report", regionalDataSharing.ok, regionalDataSharing.ok ? "regional data sharing checks passed" : "regional data sharing checks failed", "error", "regional-data-sharing"),
    check("regionalDataSharing:packages", regionalDataSharing.summary?.packages >= 3, `${regionalDataSharing.summary?.packages || 0} packages`, "error", "regional-data-sharing"),
    check("regionalDataSharing:accessReviews", regionalDataSharing.summary?.accessReviews >= 1, `${regionalDataSharing.summary?.accessReviews || 0} access reviews`, "error", "regional-data-sharing"),
    check("regionalDataSharing:handoffEvidence", regionalDataSharing.summary?.referralHandoffReady >= 1 && regionalDataSharing.summary?.referralHandoffChecks >= 18, `${regionalDataSharing.summary?.referralHandoffReady || 0} handoff-ready packages`, "error", "regional-data-sharing"),
    check("regionalDataSharing:handoffRuntime", handoffReportApi && handoffReportUi, handoffReportApi && handoffReportUi ? "runtime handoff report API and UI present" : "runtime handoff report API or UI missing", "error", "regional-data-sharing")
  ];
}

function regionalReferralOverlapChecks(regionalReferralOverlap) {
  return [
    check("regionalReferralOverlap:report", regionalReferralOverlap.ok, regionalReferralOverlap.ok ? "regional referral overlap checks passed" : "regional referral overlap checks failed", "error", "regional-data-sharing"),
    check("regionalReferralOverlap:mergeDecision", regionalReferralOverlap.mergeAllowed && regionalReferralOverlap.runtimeMergeAllowed === false, regionalReferralOverlap.decision || "missing decision", "error", "regional-data-sharing"),
    check("regionalReferralOverlap:sharedEvidence", regionalReferralOverlap.summary?.sharedCollections >= 6, `${regionalReferralOverlap.summary?.sharedCollections || 0} shared collections`, "error", "regional-data-sharing")
  ];
}

function researchSandboxChecks(researchSandbox) {
  return [
    check("researchSandbox:readiness", researchSandbox.ok, researchSandbox.ok ? "research sandbox checks passed" : "research sandbox checks failed", "error", "research"),
    check("researchSandbox:boundaries", researchSandbox.boundaries?.length >= 7, `${researchSandbox.boundaries?.length || 0} research boundaries`, "error", "research"),
    check("researchSandbox:reusedCollections", ["researchDatasets", "diseaseRegistryModels", "compliantDataExports", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"].every((key) => researchSandbox.reusableCollections?.includes(key)), "required reusable collections mapped", "error", "research"),
    check("researchSandbox:policyControls", researchSandbox.summary?.policyReady >= researchSandbox.summary?.datasets && researchSandbox.summary?.datasets >= 1, `${researchSandbox.summary?.policyReady || 0}/${researchSandbox.summary?.datasets || 0} datasets policy-ready`, "error", "research"),
    check("researchSandbox:evidenceDocuments", researchSandbox.summary?.evidenceReady >= researchSandbox.summary?.datasets && researchSandbox.summary?.datasets >= 1, `${researchSandbox.summary?.evidenceReady || 0}/${researchSandbox.summary?.datasets || 0} datasets evidence-ready`, "error", "research"),
    check("researchSandbox:compliantExports", researchSandbox.summary?.releasedExports >= 1, `${researchSandbox.summary?.releasedExports || 0} compliant exports released`, "error", "research"),
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

function objectStorageReadinessChecks(objectStorageReadiness) {
  return [
    check("objectStorage:readiness", objectStorageReadiness.ok, objectStorageReadiness.ok ? "object storage security checks passed" : "object storage security checks failed", "error", "object-storage"),
    check("objectStorage:controls", objectStorageReadiness.summary?.controlsReady === objectStorageReadiness.summary?.controls && (objectStorageReadiness.summary?.controls || 0) >= 6, `${objectStorageReadiness.summary?.controlsReady || 0}/${objectStorageReadiness.summary?.controls || 0} security controls`, "error", "object-storage"),
    check("objectStorage:api", objectStorageReadiness.summary?.apiGroupsReady === objectStorageReadiness.summary?.apiGroups && (objectStorageReadiness.summary?.apiGroups || 0) >= 5, `${objectStorageReadiness.summary?.apiGroupsReady || 0}/${objectStorageReadiness.summary?.apiGroups || 0} runtime API groups`, "error", "object-storage"),
    check("objectStorage:productionBoundary", objectStorageReadiness.productionReady === false && (objectStorageReadiness.summary?.productionBlockers || 0) >= 8, `${objectStorageReadiness.summary?.productionBlockers || 0} site production blockers remain explicit`, "error", "object-storage")
  ];
}

function financialGatewayReadinessChecks(financialGatewayReadiness) {
  return [
    check("financialGateway:readiness", financialGatewayReadiness.ok, financialGatewayReadiness.ok ? "financial gateway adapter checks passed" : "financial gateway adapter checks failed", "error", "financial-gateway"),
    check("financialGateway:capabilities", financialGatewayReadiness.summary?.capabilityGroupsReady === financialGatewayReadiness.summary?.capabilityGroups && (financialGatewayReadiness.summary?.operations || 0) === 14, `${financialGatewayReadiness.summary?.capabilityGroupsReady || 0}/${financialGatewayReadiness.summary?.capabilityGroups || 0} capability groups and ${financialGatewayReadiness.summary?.operations || 0} operations`, "error", "financial-gateway"),
    check("financialGateway:callbackReconciliation", financialGatewayReadiness.status === "signed-callback-reconciliation-ready-site-joint-test-pending" && financialGatewayReadiness.checks?.some((item) => item.id === "financialGateway:operationsUi" && item.passed), "signed callbacks, amount-safe state handling, digest reconciliation and operations UI are repository-ready", "error", "financial-gateway"),
    check("financialGateway:productionBoundary", financialGatewayReadiness.productionReady === false && (financialGatewayReadiness.summary?.productionBlockers || 0) >= 6, `${financialGatewayReadiness.summary?.productionBlockers || 0} production blockers remain explicit`, "error", "financial-gateway")
  ];
}

function hybridDeploymentChecks(hybridDeploymentReadiness) {
  return [
    check("hybridDeployment:readiness", hybridDeploymentReadiness.ok, hybridDeploymentReadiness.ok ? "hybrid deployment topology checks passed" : "hybrid deployment topology failed", "error", "deployment"),
    check("hybridDeployment:staticPreview", hybridDeploymentReadiness.checks?.some((item) => item.id === "hybrid:staticPreviewBoundary" && item.passed), "GitHub Pages/static preview boundary documented", "error", "deployment"),
    check("hybridDeployment:dynamicBackend", hybridDeploymentReadiness.checks?.some((item) => item.id === "hybrid:dynamicBackendRoutes" && item.passed), "server.js dynamic API routes covered", "error", "deployment")
  ];
}

function productionDeploymentPackageChecks(deploymentPackage) {
  return [
    check("deploymentPackage:readiness", deploymentPackage.ok && deploymentPackage.verification?.ok, deploymentPackage.ok && deploymentPackage.verification?.ok ? "immutable deployment package and integrity verification passed" : "deployment package or integrity verification failed", "error", "deployment"),
    check("deploymentPackage:secretBoundary", deploymentPackage.secretContract?.valuesPersisted === false && deploymentPackage.secretContract?.variables?.every((item) => !("value" in item)), `${deploymentPackage.secretContract?.variables?.length || 0} secret references; no values persisted`, "error", "deployment"),
    check("deploymentPackage:processContract", deploymentPackage.processContract?.healthChecks?.length === 4 && deploymentPackage.processContract.healthChecks.some((item) => item.route === "/api/live" && item.purpose === "process-liveness" && item.authentication === "none") && deploymentPackage.processContract.healthChecks.some((item) => item.route === "/api/health" && item.purpose === "dependency-readiness" && item.authentication === "none") && deploymentPackage.processContract?.restartPolicy === "on-failure" && deploymentPackage.processContract?.gracefulShutdownSeconds >= 30, "entrypoint, restart, graceful shutdown and split liveness/readiness probes declared", "error", "deployment"),
    check("deploymentPackage:rollbackContract", deploymentPackage.rollbackContract?.requirePreviousArtifactDigest && deploymentPackage.rollbackContract?.requireStorageBackup, "previous digest and storage backup required before rollback", "error", "deployment"),
    check("deploymentPackage:productionBoundary", deploymentPackage.productionReady === false && deploymentPackage.blockers?.length >= 6, `${deploymentPackage.blockers?.length || 0} site deployment blockers remain explicit`, "error", "deployment")
  ];
}

function healthDashboardChecks(healthDashboard) {
  const populationPeriods = healthDashboard.populationServiceBoard?.periods?.length || 0;
  const populationInsights = healthDashboard.populationServiceBoard?.insights?.length || 0;
  const populationSourceFields = healthDashboard.populationServiceBoard?.sourceDetails?.length || 0;
  const functionalItems = healthDashboard.functionalReport?.functions?.length || 0;
  const certificateTracks = healthDashboard.certificateExchange?.items?.length || 0;
  const drilldowns = healthDashboard.riskDrilldowns?.items?.length || 0;
  const evidenceArtifacts = healthDashboard.siteEvidencePackage?.items?.length || 0;
  const siteIssueRows = healthDashboard.siteIssueLedger?.items?.length || 0;
  const jurisdictionRows = healthDashboard.jurisdictionScope?.districts?.length || 0;
  const jurisdictionDetailRows = (healthDashboard.jurisdictionScope?.districts || []).filter((item) => item.id !== "all" && (item.institutionsList?.length || item.serviceReportList?.length || item.actionList?.length)).length;
  const actionTrendPeriods = healthDashboard.actionClosureTrend?.periods?.length || 0;
  const departmentRows = healthDashboard.functionalReport?.departmentFunctionMatrix?.length || 0;
  const cityCountyRows = healthDashboard.functionalReport?.cityCountyFunctionMatrix?.length || 0;
  const productionGateRows = healthDashboard.productionReadinessGate?.items?.length || 0;
  const indicatorRows = healthDashboard.indicatorCenter?.indicators?.length || 0;
  const indicatorDimensions = healthDashboard.indicatorCenter?.dimensions?.length || 0;
  const indicatorCategories = healthDashboard.indicatorCenter?.reformCategories?.length || 0;
  const indicatorEntrypoints = healthDashboard.indicatorCenter?.aggregationEntrypoints?.length || 0;
  return [
    check("healthDashboard:summary", healthDashboard.ok, healthDashboard.ok ? "health dashboard summary checks passed" : "health dashboard summary failed", "error", "health-dashboard"),
    check("healthDashboard:applications", healthDashboard.applications?.length === 8 && healthDashboard.totals?.sourceApplications === 7, `${healthDashboard.applications?.length || 0} applications; ${healthDashboard.totals?.sourceApplications || 0} source applications`, "error", "health-dashboard"),
    check("healthDashboard:developmentTemplate", healthDashboard.applications?.every((item) => item.functionalBoundary && item.reusePoints?.length && item.dataCollections?.length && item.apiRoutes?.length && item.frontendEntry && item.testEvidence?.length && item.acceptanceEvidence?.length), "boundary, reuse, data, API, frontend, test, and acceptance fields", "error", "health-dashboard"),
    check("healthDashboard:industryGovernanceIndicators", healthDashboard.indicatorCenter?.indicators?.length === 8 && healthDashboard.indicatorCenter?.periodViews?.length === 2 && healthDashboard.indicatorCenter?.indicators?.every((item) => item.definition && item.owner && item.sourceCollections?.length && item.reports?.length === 2 && item.drilldown?.href), `${healthDashboard.indicatorCenter?.indicators?.length || 0} indicators / ${healthDashboard.indicatorCenter?.periodViews?.length || 0} report views`, "error", "health-dashboard"),
    check("healthDashboard:boundary", /source business applications|source applications|不替代源业务应用/.test(healthDashboard.scope?.rule || ""), healthDashboard.scope?.rule || "missing", "error", "health-dashboard")
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

function immunizationReadinessChecks(immunizationReadiness) {
  return [
    check("immunization:readiness", immunizationReadiness.ok, immunizationReadiness.ok ? "immunization readiness checks passed" : "immunization readiness failed", "error", "immunization"),
    check("immunization:rules", (immunizationReadiness.summary?.doseRules || 0) >= 30 && (immunizationReadiness.summary?.healthProfiles || 0) >= 8, `${immunizationReadiness.summary?.doseRules || 0} dose rules / ${immunizationReadiness.summary?.healthProfiles || 0} health profiles`, "error", "immunization"),
    check("immunization:launchBoard", immunizationReadiness.checks?.some((item) => item.id === "ui:launch-board" && item.passed), "launch blockers and evidence ledger are visible in immunization.html", "error", "immunization"),
    check("immunization:productionBoundary", immunizationReadiness.formalGoLiveState === "blocked-until-site-evidence-signed" && (immunizationReadiness.summary?.launchSitePending || 0) >= 4, `${immunizationReadiness.summary?.launchSitePending || 0} site-pending launch blockers`, "error", "immunization")
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
    check("registrationJourney:cross-role", registrationJourney.checks?.filter((item) => ["registrationJourney:citizenUi", "registrationJourney:institutionUi", "registrationJourney:api", "registrationJourney:disruption", "registrationJourney:waitlist"].includes(item.id)).every((item) => item.passed), "resident, institution, API, disruption-rescheduling and waitlist actions are wired", "error", "registration-journey"),
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

function productionSecurityChecks(productionSecurity) {
  return [
    check("productionSecurity:readiness", productionSecurity.ok, productionSecurity.ok ? "P0-07 software controls passed" : "P0-07 software controls failed", "error", "production-security"),
    check("productionSecurity:findings", (productionSecurity.summary?.findings || 0) >= 4, `${productionSecurity.summary?.findings || 0} governed findings`, "error", "production-security"),
    check("productionSecurity:independentControls", productionSecurity.checks?.some((item) => item.id === "productionSecurity:stateMachine" && item.passed), "independent retest, waiver and release opinions enforced", "error", "production-security"),
    check("productionSecurity:formalBoundary", productionSecurity.center?.productionGate?.formalProductionReady === false, `${productionSecurity.center?.status || "unknown"}; formal readiness remains false`, "warn", "production-security")
  ];
}

function productionGoNoGoChecks(productionGoNoGo) {
  return [
    check("productionGoNoGo:readiness", productionGoNoGo.ok, productionGoNoGo.ok ? "P0-10 software controls passed" : "P0-10 software controls failed", "error", "production-go-no-go"),
    check("productionGoNoGo:prerequisites", productionGoNoGo.checks?.some((item) => item.id === "goNoGoReadiness:prerequisites" && item.passed), "five global production prerequisites modeled", "error", "production-go-no-go"),
    check("productionGoNoGo:evidenceDrift", productionGoNoGo.checks?.some((item) => item.id === "goNoGoReadiness:evidenceDrift" && item.passed), `${productionGoNoGo.center?.summary?.staleApprovals || 0} stale approvals visible`, "error", "production-go-no-go"),
    check("productionGoNoGo:boundary", productionGoNoGo.center?.gate?.softwareControlReady === true && productionGoNoGo.center?.gate?.productionGoRecorded === false, `${productionGoNoGo.center?.status || "unknown"}; no GO fabricated`, "warn", "production-go-no-go")
  ];
}

function pilotAcceptanceChecks(pilotAcceptance) {
  return [
    check("pilotAcceptance:readiness", pilotAcceptance.ok, pilotAcceptance.ok ? "pilot acceptance software controls passed" : "pilot acceptance software controls failed", "error", "pilot-acceptance"),
    check("pilotAcceptance:applications", pilotAcceptance.summary?.regressionReady === 8 && pilotAcceptance.summary?.applications === 8, `${pilotAcceptance.summary?.regressionReady || 0}/${pilotAcceptance.summary?.applications || 0} applications regression-ready`, "error", "pilot-acceptance"),
    check("pilotAcceptance:onsitePack", pilotAcceptance.summary?.onsiteTasks === 10, `${pilotAcceptance.summary?.onsiteTasks || 0}/10 P0 acceptance tasks`, "error", "pilot-acceptance"),
    check("pilotAcceptance:interfaceSamples", pilotAcceptance.summary?.interfaceSamples === 4 && pilotAcceptance.interfaceSamples?.every((item) => item.containsPatientData === false), `${pilotAcceptance.summary?.interfaceSamples || 0} synthetic no-patient-data samples`, "error", "pilot-acceptance"),
    check("pilotAcceptance:trialRun", pilotAcceptance.summary?.trialPassed === pilotAcceptance.summary?.trialScenarios && (pilotAcceptance.summary?.trialScenarios || 0) >= 7, `${pilotAcceptance.summary?.trialPassed || 0}/${pilotAcceptance.summary?.trialScenarios || 0} simulated scenarios`, "error", "pilot-acceptance"),
    check("pilotAcceptance:formalBoundary", pilotAcceptance.formalGoLiveState === "blocked-until-site-evidence-signed", pilotAcceptance.formalGoLiveState || "missing", "warn", "pilot-acceptance")
  ];
}

function qualitySafetyChecks(qualitySafety) {
  return [
    check("qualitySafety:report", qualitySafety.ok, qualitySafety.ok ? "quality and safety supervision checks passed" : "quality and safety supervision checks failed", "error", "quality-safety"),
    check("qualitySafety:boundaries", qualitySafety.summary?.modeledBoundaries === qualitySafety.summary?.boundaries, `${qualitySafety.summary?.modeledBoundaries || 0}/${qualitySafety.summary?.boundaries || 0} boundaries modeled`, "error", "quality-safety"),
    check("qualitySafety:reuse", qualitySafety.reusedCollections?.every((item) => item.present), `${qualitySafety.summary?.reusedCollections || 0} reused collections`, "error", "quality-safety"),
    check("qualitySafety:siteSignoffTracker", Array.isArray(qualitySafety.siteSignoffs) && qualitySafety.siteSignoffs.length >= 6, `${qualitySafety.summary?.siteSignoffs?.total || 0} site sign-off items`, "error", "quality-safety"),
    check("qualitySafety:warningIndicators", Array.isArray(qualitySafety.warningIndicators) && qualitySafety.warningIndicators.length >= 6 && qualitySafety.warningIndicators.every((item) => item.closedLoopReady), `${qualitySafety.summary?.warningIndicators || 0} warning indicators; ${qualitySafety.summary?.warningIndicatorsAttention || 0} requiring attention`, "error", "quality-safety"),
    check("qualitySafety:goLiveReadiness", qualitySafety.goLiveReadiness?.usable, `${qualitySafety.goLiveReadiness?.stage || "unknown"} score=${qualitySafety.goLiveReadiness?.score ?? 0}`, "error", "quality-safety")
  ];
}

function qualitySafetyInterfaceStandardChecks(standard) {
  return [
    check("qualitySafetyInterface:standard", standard.ok, standard.ok ? "quality-safety institution interface standard checks passed" : "quality-safety institution interface standard checks failed", "error", "quality-safety"),
    check("qualitySafetyInterface:interfaces", standard.summary?.interfaces >= 6, `${standard.summary?.interfaces || 0} interface documents`, "error", "quality-safety"),
    check("qualitySafetyInterface:acceptanceChecklist", standard.summary?.acceptanceRows >= 6, `${standard.summary?.acceptanceRows || 0} acceptance rows`, "error", "quality-safety")
  ];
}

function qualitySafetyInterfaceJointTestChecks(pack) {
  return [
    check("qualitySafetyInterfaceJointTest:pack", pack.ok, pack.ok ? "quality-safety joint-test pack checks passed" : "quality-safety joint-test pack checks failed", "error", "quality-safety"),
    check("qualitySafetyInterfaceJointTest:samples", pack.summary?.sampleAccepted === pack.summary?.sampleRequests, `${pack.summary?.sampleAccepted || 0}/${pack.summary?.sampleRequests || 0} sample messages accepted`, "error", "quality-safety"),
    check("qualitySafetyInterfaceJointTest:negativeCases", pack.negativeCases?.every((item) => !item.result.ok), `${pack.negativeCases?.length || 0} rejection cases`, "error", "quality-safety"),
    check("qualitySafetyInterfaceJointTest:siteSampleAcceptance", pack.summary?.siteSampleReady === pack.summary?.siteSampleAcceptance && pack.summary?.siteSampleAcceptance === pack.summary?.sampleRequests, `${pack.summary?.siteSampleReady || 0}/${pack.summary?.siteSampleAcceptance || 0} site sample acceptance rows ready`, "error", "quality-safety")
  ];
}

function qualityOperationsGovernanceChecks(report) {
  return [
    check("qualityOperationsGovernance:readiness", report.ok, report.ok ? "unified quality and operations governance checks passed" : "unified quality and operations governance checks failed", "error", "quality-operations-governance"),
    check("qualityOperationsGovernance:collections", report.catalog?.sourceCollections?.length === 3, `${report.catalog?.sourceCollections?.length || 0}/3 source collections adapted`, "error", "quality-operations-governance"),
    check("qualityOperationsGovernance:mapping", report.catalog?.summary?.unmapped === 0, `${report.catalog?.summary?.records || 0} records / ${report.catalog?.summary?.unmapped || 0} unmapped`, "error", "quality-operations-governance"),
    check("qualityOperationsGovernance:productionBoundary", report.productionReady === false && (report.blockers?.length || 0) >= 4, `${report.blockers?.length || 0} production blockers retained`, "error", "quality-operations-governance")
  ];
}

function digitalHospitalStandardsChecks(digitalHospitalStandards) {
  return [
    check("digitalHospitalStandards:readiness", digitalHospitalStandards.ok, digitalHospitalStandards.ok ? "digital hospital standards checks passed" : "digital hospital standards checks failed", "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:domains", (digitalHospitalStandards.summary?.standardDomains || 0) >= 6 && (digitalHospitalStandards.summary?.officialSources || 0) >= 6, `${digitalHospitalStandards.summary?.standardDomains || 0} domains / ${digitalHospitalStandards.summary?.officialSources || 0} source markers`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:api", (digitalHospitalStandards.summary?.apiMarkers || 0) >= 5, `${digitalHospitalStandards.summary?.apiMarkers || 0} API contract markers`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:launchReadiness", (digitalHospitalStandards.summary?.launchMarkers || 0) >= 16, `${digitalHospitalStandards.summary?.launchMarkers || 0} launch readiness markers`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:evidence", (digitalHospitalStandards.summary?.evidenceModes || 0) >= 5 && (digitalHospitalStandards.summary?.workflowMarkers || 0) >= 6, `${digitalHospitalStandards.summary?.evidenceModes || 0} evidence modes / ${digitalHospitalStandards.summary?.workflowMarkers || 0} workflow markers`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:policyGovernance", (digitalHospitalStandards.summary?.policyRecords || 0) >= 18 && (digitalHospitalStandards.summary?.policyControls || 0) >= 12, `${digitalHospitalStandards.summary?.policyRecords || 0} policy records / ${digitalHospitalStandards.summary?.policyControls || 0} six-domain controls`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:controlRemediation", (digitalHospitalStandards.summary?.controlActions || 0) >= 5, `${digitalHospitalStandards.summary?.controlActions || 0} auditable control actions`, "error", "digital-hospital-standards"),
    check("digitalHospitalStandards:selfAssessment", (digitalHospitalStandards.summary?.selfAssessmentActions || 0) >= 5, `${digitalHospitalStandards.summary?.selfAssessmentActions || 0} institution-scoped self-assessment actions`, "error", "digital-hospital-standards")
  ];
}

function publicHealthHighlightsReadinessChecks(publicHealthHighlightsReadiness) {
  return [
    check("publicHealthHighlights:readiness", publicHealthHighlightsReadiness.ok, publicHealthHighlightsReadiness.ok ? "public health five-suite readiness checks passed" : "public health five-suite readiness failed", "error", "public-health"),
    check("publicHealthHighlights:fiveSuites", publicHealthHighlightsReadiness.summary?.capabilities === 5 && publicHealthHighlightsReadiness.summary?.checksPassed === publicHealthHighlightsReadiness.summary?.checks, `${publicHealthHighlightsReadiness.summary?.capabilities || 0}/5 capabilities and ${publicHealthHighlightsReadiness.summary?.checksPassed || 0}/${publicHealthHighlightsReadiness.summary?.checks || 0} checks`, "error", "public-health"),
    check("publicHealthHighlights:productionBoundary", publicHealthHighlightsReadiness.functionalState === "five-suite-runnable" && publicHealthHighlightsReadiness.formalGoLiveState === "blocked-until-site-evidence-signed", `${publicHealthHighlightsReadiness.functionalState || "unknown"} / ${publicHealthHighlightsReadiness.formalGoLiveState || "unknown"}`, "error", "public-health")
  ];
}

function publicHealthFinalReadinessChecks(publicHealthFinalReadiness) {
  return [
    check("publicHealthFinal:readiness", publicHealthFinalReadiness.ok, `${publicHealthFinalReadiness.summary?.passed || 0}/${publicHealthFinalReadiness.summary?.checks || 0} T08 and T00 integration checks`, "error", "public-health"),
    check("publicHealthFinal:routes", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-public-routes" && item.passed), "coordination, worker, callback, recovery and operations routes registered", "error", "public-health"),
    check("publicHealthFinal:keyProvider", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-managed-key-provider" && item.passed), "lane request and receipt keyring provider registered", "error", "public-health"),
    check("publicHealthFinal:resiliencePolicy", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-resilience-policy" && item.passed), "server-only eight-lane resilience policies registered", "error", "public-health"),
    check("publicHealthFinal:dualCas", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-dual-cas" && item.passed), "dispatch and lane-control versions share one CAS persistence boundary", "error", "public-health"),
    check("publicHealthFinal:resilienceAlerts", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-resilience-alerts" && item.passed), "P0/P1 lane-control risks registered on operations board", "error", "public-health"),
    check("publicHealthFinal:contractGovernance", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-contract-governance" && item.passed), "server-only signed contract approvals bind deployed T08/T00 artifacts and persist accepted/rejected audit", "error", "public-health"),
    check("publicHealthFinal:contractCutover", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-contract-cutover" && item.passed), "active-contract recovery and cutover backlog share the outbox/resilience transaction boundary", "error", "public-health"),
    check("publicHealthFinal:contractChain", publicHealthFinalReadiness.checks?.some((item) => item.id === "contract:sequential-version-chain" && item.passed), "signed non-overlapping contract transitions advance sequentially and reject branch, gap, order and overlap risks", "error", "public-health"),
    check("publicHealthFinal:contractChainPersistence", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-contract-chain-persistence" && item.passed), "complete signed predecessor chains are append-only and validated inside the durable transaction", "error", "public-health"),
    check("publicHealthFinal:endpointVerification", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-endpoint-verification" && item.passed) && publicHealthFinalReadiness.endpointProbeRegistry?.endpointConnectivityReady === true && publicHealthFinalReadiness.endpointProbeRegistry?.productionReady === false, "trusted endpoint receipts are server-bound, replay-safe and explicitly separate connectivity from production approval", "error", "public-health"),
    check("publicHealthFinal:activeEndpointProbe", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-active-endpoint-probe" && item.passed) && publicHealthFinalReadiness.productionReady === false, "commission-only active probes use server-owned DNS, TLS, pin, mTLS, concurrency, frequency, audit and replay controls without asserting production readiness", "error", "public-health"),
    check("publicHealthFinal:endpointProbeCampaign", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-endpoint-probe-campaign" && item.passed) && publicHealthFinalReadiness.endpointProbeCampaignRegistry?.continuousConnectivityReady === true && publicHealthFinalReadiness.endpointProbeCampaignRegistry?.summary?.campaignChainLinksVerified === 2 && publicHealthFinalReadiness.endpointProbeCampaignRegistry?.productionReady === false, "three independent signed eight-lane campaigns and both predecessor links prove continuity without asserting production readiness", "error", "public-health"),
    check("publicHealthFinal:endpointConnectivityUi", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-endpoint-connectivity-ui" && item.passed), "commission UI exposes redacted summaries, signed predecessor-link counts and controlled lane/campaign actions with fail-closed states, server-owned security inputs and server-owned production authorization", "error", "public-health"),
    check("publicHealthFinal:modernizationRoutes", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-modernization-routes" && item.passed), "commission-only data foundation, shadow-model, aggregate respiratory-pathogen, surveillance and medical-prevention routes use server actor, time and idempotency context", "error", "public-health"),
    check("publicHealthFinal:modernizationPersistence", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-modernization-persistence" && item.passed), "fifteen modernization collections use nextData-only SQLite transaction CAS, including atomic respiratory publication", "error", "public-health"),
    check("publicHealthFinal:modernizationUi", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-modernization-ui-release" && item.passed), "seven redacted executable public-health workbenches are registered without granting production readiness", "error", "public-health"),
    check("publicHealthFinal:sourceOperations", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-modernization-source-operations" && item.passed), "commission source operations exposes only server-time freshness, quality and no-data summaries", "error", "public-health"),
    check("publicHealthFinal:ruleGovernance", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-surveillance-rule-governance" && item.passed), "rule changes require independent actors, server-owned activation trust and atomic rule/change persistence", "error", "public-health"),
    check("publicHealthFinal:ruleGovernanceUi", publicHealthFinalReadiness.checks?.some((item) => item.id === "integration:t00-surveillance-rule-governance-ui-release" && item.passed), "rule governance UI exposes only safe versions, thresholds, states and allowed actions", "error", "public-health"),
    check("publicHealthFinal:campaignContinuityGap", publicHealthFinalReadiness.summary?.t08FunctionalChecks === 63 && publicHealthFinalReadiness.summary?.t08FunctionalPassed === 63 && publicHealthFinalReadiness.summary?.t00BoundaryChecks === 21 && publicHealthFinalReadiness.summary?.t00BoundaryPassed === 21 && publicHealthFinalReadiness.endpointProbeCampaignFailureRegistry?.continuousConnectivityReady === false && publicHealthFinalReadiness.endpointProbeCampaignFailureRegistry?.continuityBreak?.code === "campaign-verification-failed" && publicHealthFinalReadiness.endpointProbeCampaignFailureRegistry?.productionReady === false, "63 T08 functional checks include managed rule-key rotation, governed rules, advisory models and respiratory multi-pathogen surveillance while 21 T00 public boundary checks remain separately visible", "error", "public-health"),
    check("publicHealthFinal:productionBoundary", publicHealthFinalReadiness.productionReady === false && /blocked-until-production-key-service/.test(publicHealthFinalReadiness.formalGoLiveState || ""), publicHealthFinalReadiness.formalGoLiveState || "missing", "error", "public-health")
  ];
}

function digitalHospitalPilotChecks(digitalHospitalPilot) {
  return [
    check("digitalHospitalPilot:readiness", digitalHospitalPilot.ok, digitalHospitalPilot.ok ? "digital hospital pilot checks passed" : "digital hospital pilot checks failed", "error", "digital-hospital-pilot"),
    check("digitalHospitalPilot:catalog", digitalHospitalPilot.summary?.packs === 4 && digitalHospitalPilot.summary?.projects === 70 && digitalHospitalPilot.summary?.clauses === 70, `${digitalHospitalPilot.summary?.packs || 0} packs / ${digitalHospitalPilot.summary?.projects || 0} projects / ${digitalHospitalPilot.summary?.clauses || 0} clauses`, "error", "digital-hospital-pilot"),
    check("digitalHospitalPilot:collection", (digitalHospitalPilot.summary?.collectionJobs || 0) >= 6 && (digitalHospitalPilot.summary?.evidenceRecords || 0) >= 6, `${digitalHospitalPilot.summary?.collectionJobs || 0} collection jobs / ${digitalHospitalPilot.summary?.evidenceRecords || 0} evidence records`, "error", "digital-hospital-pilot"),
    check("digitalHospitalPilot:functionalState", digitalHospitalPilot.functionalState === "pilot-launch-ready", digitalHospitalPilot.functionalState || "missing", "error", "digital-hospital-pilot"),
    check("digitalHospitalPilot:formalBoundary", digitalHospitalPilot.formalGoLiveState === "blocked-until-site-evidence-signed", digitalHospitalPilot.formalGoLiveState || "missing", "warn", "digital-hospital-pilot")
  ];
}

function platformProductionAuditChecks(platformProductionAudit) {
  return [
    check("platformProductionAudit:readiness", platformProductionAudit.ok, platformProductionAudit.ok ? "platform production audit checks passed" : "platform production audit checks failed", "error", "platform-production-audit"),
    check("platformProductionAudit:capabilities", platformProductionAudit.summary?.implementedDomains === platformProductionAudit.summary?.capabilityDomains && (platformProductionAudit.summary?.capabilityDomains || 0) >= 10, `${platformProductionAudit.summary?.implementedDomains || 0}/${platformProductionAudit.summary?.capabilityDomains || 0} capability domains have runnable evidence`, "error", "platform-production-audit"),
    check("platformProductionAudit:mvpRequiredModules", (platformProductionAudit.summary?.mvpRequiredModules || 0) >= 8 && platformProductionAudit.mvpRequiredModules?.every((item) => item.priority === "P0" && item.remainingCode && item.siteDependency), `${platformProductionAudit.summary?.mvpRequiredModules || 0} mandatory MVP production modules are explicitly scoped`, "error", "platform-production-audit"),
    check("platformProductionAudit:productionBoundary", platformProductionAudit.productionReady === false && (platformProductionAudit.summary?.productionBlockers || 0) >= 10, `${platformProductionAudit.summary?.productionBlockers || 0} production blockers remain explicitly owned`, "error", "platform-production-audit")
  ];
}

function drugConsumableChecks(drugConsumable) {
  return [
    check("drugConsumable:readiness", drugConsumable.ok, drugConsumable.ok ? "drug consumable supervision checks passed" : "drug consumable supervision checks failed", "error", "drug-consumable"),
    check("drugConsumable:boundaries", drugConsumable.requiredBoundaries?.every((boundary) => drugConsumable.checks?.find((item) => item.id === "drug-consumable:boundaries")?.detail?.includes(`${boundary}:present`)), `${drugConsumable.requiredBoundaries?.length || 0} boundaries`, "error", "drug-consumable"),
    check("drugConsumable:links", drugConsumable.linkedRows?.every((item) => item.pickupLinked && item.claimLinked && item.auditTrailPresent), `${drugConsumable.linkedRows?.length || 0} linked supervision rows`, "error", "drug-consumable"),
    check("drugConsumable:supplyAlert", drugConsumable.summary?.supplyAlerts >= 1 && drugConsumable.checks?.some((item) => item.id === "drug-consumable:supply-alert" && item.passed), `${drugConsumable.summary?.supplyAlerts || 0} supply assurance alerts`, "error", "drug-consumable"),
    check("drugConsumable:traceabilityPolicy", drugConsumable.summary?.traceabilityPolicySources >= 5 && drugConsumable.checks?.some((item) => item.id === "drug-consumable:traceability-policy" && item.passed), `${drugConsumable.summary?.traceabilityPolicySources || 0} official traceability policy sources`, "error", "drug-consumable"),
    check("drugConsumable:traceabilityEvidence", drugConsumable.summary?.traceabilityEvidenceRequirements >= 5 && drugConsumable.summary?.traceabilityEvidenceReady >= 5 && drugConsumable.checks?.some((item) => item.id === "drug-consumable:traceability-evidence" && item.passed), `${drugConsumable.summary?.traceabilityEvidenceReady || 0}/${drugConsumable.summary?.traceabilityEvidenceRequirements || 0} traceability evidence requirements ready`, "error", "drug-consumable"),
    check("drugConsumable:traceabilitySubmission", drugConsumable.summary?.traceabilitySubmissionReady === true && drugConsumable.checks?.some((item) => item.id === "drug-consumable:traceability-submission" && item.passed), drugConsumable.summary?.traceabilitySubmissionReady ? "traceability evidence submission action ready" : "traceability evidence submission action missing", "error", "drug-consumable"),
    check("drugConsumable:traceabilityCoverage", drugConsumable.summary?.traceabilityCoverageReady === true && drugConsumable.checks?.some((item) => item.id === "drug-consumable:traceability-coverage" && item.passed), drugConsumable.summary?.traceabilityCoverageReady ? "traceability evidence coverage ready" : "traceability evidence coverage missing", "error", "drug-consumable"),
    check("drugConsumable:launchReadiness", drugConsumable.launchReadiness?.demoReviewReady === true && drugConsumable.launchReadiness?.productionCutoverBlocked === true && drugConsumable.checks?.some((item) => item.id === "drug-consumable:launch-readiness" && item.passed), `${drugConsumable.launchReadiness?.implementedCapabilities?.length || 0} implemented capabilities; ${drugConsumable.launchReadiness?.preLaunchGaps?.length || 0} pre-launch gaps`, "error", "drug-consumable")
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
    check("hospitalOps:emergencyDispatchLoops", hospitalOperationsReadiness.summary?.emergencyDispatchLoops >= 1, `${hospitalOperationsReadiness.summary?.emergencyDispatchLoops || 0} emergency dispatch loops`, "error", "operations"),
    check("hospitalOps:reconciliation", hospitalOperationsReadiness.summary?.reconciliationReviews >= 2, `${hospitalOperationsReadiness.summary?.reconciliationReviews || 0} reconciliation reviews`, "error", "operations")
  ];
}

function hospitalOperationsReleaseChecks(hospitalOperationsRelease) {
  return [
    check("hospitalOpsRelease:ready", hospitalOperationsRelease.ok, hospitalOperationsRelease.ok ? "hospital operations release checks passed" : "hospital operations release checks failed", "error", "operations"),
    check("hospitalOpsRelease:scope", hospitalOperationsRelease.releaseItems?.length >= 5, `${hospitalOperationsRelease.releaseItems?.length || 0} release scope items`, "error", "operations"),
    check("hospitalOpsRelease:checks", hospitalOperationsRelease.summary?.failed === 0, `${hospitalOperationsRelease.summary?.passed || 0}/${hospitalOperationsRelease.summary?.checks || 0} checks passed`, "error", "operations")
  ];
}

function hospitalOperationsModuleChecks(hospitalOperationsModule) {
  return [
    check("hospitalOpsModule:ready", hospitalOperationsModule.ok, hospitalOperationsModule.ok ? "hospital operations module report passed" : "hospital operations module report failed", "error", "operations"),
    check("hospitalOpsModule:capabilities", hospitalOperationsModule.summary?.readyCapabilities === hospitalOperationsModule.summary?.capabilities, `${hospitalOperationsModule.summary?.readyCapabilities || 0}/${hospitalOperationsModule.summary?.capabilities || 0} capabilities ready`, "error", "operations"),
    check("hospitalOpsModule:nextPlan", (hospitalOperationsModule.nextPlan || []).length >= 4, `${hospitalOperationsModule.nextPlan?.length || 0} next-plan rows`, "error", "operations")
  ];
}

function hospitalOperationsBriefPdfChecks(hospitalOperationsBriefPdf) {
  return [
    check("hospitalOpsBriefPdf:ready", hospitalOperationsBriefPdf.ok, hospitalOperationsBriefPdf.ok ? "hospital operations brief PDF passed" : "hospital operations brief PDF failed", "error", "operations"),
    check("hospitalOpsBriefPdf:pages", hospitalOperationsBriefPdf.artifact?.pages === 2, `${hospitalOperationsBriefPdf.artifact?.pages || 0} pages`, "error", "operations"),
    check("hospitalOpsBriefPdf:artifact", hospitalOperationsBriefPdf.artifact?.pdf === "output/pdf/hospital-operations-module-brief-report.pdf", hospitalOperationsBriefPdf.artifact?.pdf || "missing", "error", "operations")
  ];
}

function monitoringReadinessChecks(monitoringReadiness) {
  return [
    check("monitoring:readiness", monitoringReadiness.ok, monitoringReadiness.ok ? "monitoring readiness checks passed" : "monitoring readiness checks failed", "error", "monitoring"),
    check("monitoring:metricSignals", monitoringReadiness.metricSignals?.every((item) => item.present), `${monitoringReadiness.metricSignals?.length || 0} metric signals`, "error", "monitoring"),
    check("monitoring:sloTargets", monitoringReadiness.sloTargets?.every((item) => item.covered), `${monitoringReadiness.sloTargets?.length || 0} SLO targets`, "error", "monitoring"),
    check("monitoring:alertRouting", ["adapter", "runtime", "ui", "environment", "releaseWiring"].every((section) => Object.values(monitoringReadiness.alertRouting?.[section] || {}).every(Boolean)), "signed, minimized, retryable SIEM/webhook alert delivery with runtime receipts and UI is wired", "error", "monitoring"),
    check("monitoring:productionBoundary", monitoringReadiness.productionReady === false && monitoringReadiness.summary?.blockers >= 6, `${monitoringReadiness.summary?.blockers || 0} site acceptance blockers remain explicit`, "error", "monitoring")
  ];
}

function referralTeleconsultationChecks(referralTeleconsultationReadiness) {
  return [
    check("referralTeleconsultation:readiness", referralTeleconsultationReadiness.ok, referralTeleconsultationReadiness.ok ? "referral teleconsultation readiness checks passed" : "referral teleconsultation readiness checks failed", "error", "referral"),
    check("referralTeleconsultation:authorization", referralTeleconsultationReadiness.checks?.some((item) => item.id === "referral:residentAuthorization" && item.passed), "resident authorization evidence present", "error", "referral"),
    check("referralTeleconsultation:closedLoop", referralTeleconsultationReadiness.checks?.some((item) => item.id === "referral:consortiumClosedLoop" && item.passed), "consortium closed-loop stage evidence present", "error", "referral"),
    check("referralTeleconsultation:closedLoopMetrics", referralTeleconsultationReadiness.checks?.some((item) => item.id === "referral:consortiumMetrics" && item.passed), "G-end consortium efficiency and completion metrics present", "error", "referral"),
    check("referralTeleconsultation:closedLoopMetricsApi", referralTeleconsultationReadiness.checks?.some((item) => item.id === "referral:consortiumMetricsApi" && item.passed), "G-end consortium metrics API present", "error", "referral"),
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
    check("internetNursing:closedLoopSummary", internetNursingReadiness.checks?.some((item) => item.id === "nursing:closedLoopSummary" && item.passed), "closed-loop summary evidence present", "error", "internet-nursing"),
    check("internetNursing:highlightFeatures", internetNursingReadiness.summary?.highlightFeatures === 10 && internetNursingReadiness.checks?.some((item) => item.id === "nursing:highlightFeatures" && item.passed), `${internetNursingReadiness.summary?.highlightFeatures || 0}/10 highlight features release-wired`, "error", "internet-nursing")
  ];
}

function careServiceProductionChecks(careServiceProductionReadiness) {
  return [
    check("careService:codeReady", careServiceProductionReadiness.codeReady, `${careServiceProductionReadiness.summary?.codeBlockers || 0} code blockers`, "error", "care-service"),
    check("careService:platformIntegrated", careServiceProductionReadiness.platformIntegrated, `${careServiceProductionReadiness.summary?.platformBlockers || 0} platform integration blockers`, "error", "care-service"),
    check(
      "careService:productionBoundary",
      careServiceProductionReadiness.productionReady === false
        && careServiceProductionReadiness.formalGoLiveState !== "ready-for-production-cutover"
        && (careServiceProductionReadiness.summary?.signoffBlockers || 0) === 5,
      `${careServiceProductionReadiness.formalGoLiveState}; ${careServiceProductionReadiness.summary?.runtimeBlockers || 0} runtime and ${careServiceProductionReadiness.summary?.signoffBlockers || 0} signoff blockers`,
      "error",
      "care-service"
    )
  ];
}

function emergencyReadinessChecks(emergencyReadiness) {
  return [
    check("emergency:readiness", emergencyReadiness.ok, emergencyReadiness.ok ? "prehospital emergency readiness checks passed" : "prehospital emergency readiness checks failed", "error", "emergency"),
    check("emergency:productionBoundary", emergencyReadiness.formalGoLiveState === "blocked-until-site-evidence-signed" && (emergencyReadiness.summary?.sitePending || 0) >= 5, `${emergencyReadiness.summary?.sitePending || 0} site evidence blockers remain visible`, "error", "emergency"),
    check("emergency:qualityClosure", emergencyReadiness.checks?.some((item) => item.id === "production:data-quality-closure" && item.passed), "data-quality issue closure requires evidence", "error", "emergency"),
    check("emergency:launchOperations", emergencyReadiness.checks?.some((item) => item.id === "ui:launch-operations" && item.passed), "production handoff, command, alert, observation and incident actions are operable", "error", "emergency")
  ];
}

function specialtyCutoverChecks(specialtyCutover) {
  const expectedStages = ["code-readiness", "synthetic-acceptance", "joint-test", "site-evidence", "go-no-go", "grey-release"];
  return [
    check("specialtyCutover:tracks", specialtyCutover.summary?.tracks === 4 && specialtyCutover.summary?.codeReady === 4, `${specialtyCutover.summary?.codeReady || 0}/${specialtyCutover.summary?.tracks || 0} specialty tracks code-ready`, "error", "specialty-cutover"),
    check("specialtyCutover:moduleCatalog", specialtyCutover.moduleCatalog?.modules?.length === 4 && specialtyCutover.moduleCatalog?.enabledModuleIds?.length === 4 && specialtyCutover.moduleCatalog?.peerModuleDependencyCount === 0 && specialtyCutover.moduleCatalog?.modules?.every((item) => item.independentlySelectable), `${specialtyCutover.moduleCatalog?.enabledModuleIds?.length || 0}/4 modules enabled; ${specialtyCutover.moduleCatalog?.peerModuleDependencyCount ?? "unknown"} peer dependencies`, "error", "specialty-cutover"),
    check("specialtyCutover:productionBoundary", specialtyCutover.summary?.productionReady === 0 && specialtyCutover.summary?.formalGoLiveState === "blocked-until-site-evidence-signed" && specialtyCutover.summary?.siteBlockers > 0, `${specialtyCutover.summary?.productionReady || 0}/${specialtyCutover.summary?.tracks || 0} production-ready; ${specialtyCutover.summary?.siteBlockers || 0} site blockers`, "error", "specialty-cutover"),
    check("specialtyCutover:stages", expectedStages.every((stage) => specialtyCutover.stages?.includes(stage)), `${specialtyCutover.stages?.length || 0}/${expectedStages.length} cutover stages`, "error", "specialty-cutover"),
    check("specialtyCutover:crossTrackControls", ["identity-and-role-scope", "signed-interface-and-idempotency", "four-eyes-site-evidence", "patient-safety-and-downgrade"].every((id) => specialtyCutover.crossTrackControls?.some((item) => item.id === id)), `${specialtyCutover.crossTrackControls?.length || 0} cross-track controls`, "error", "specialty-cutover"),
    check("specialtyCutover:rehearsalPlan", specialtyCutover.rehearsalPlan?.scope?.primaryTrackId === "emergency-life-chain" && specialtyCutover.rehearsalPlan?.timeline?.length === 3 && specialtyCutover.rehearsalPlan?.rollbackTriggers?.length >= 4, `${specialtyCutover.rehearsalPlan?.timeline?.length || 0} rehearsal stages`, "error", "specialty-cutover"),
    check("specialtyCutover:goNoGoDecision", specialtyCutover.goNoGoDecision?.currentDecision === "no-go-site-evidence-pending" && specialtyCutover.goNoGoDecision?.score === 20 && specialtyCutover.goNoGoDecision?.threshold === 100 && specialtyCutover.goNoGoDecision?.hardStops?.some((item) => item.id === "patient-safety"), `${specialtyCutover.goNoGoDecision?.score || 0}/${specialtyCutover.goNoGoDecision?.threshold || 0} go/no-go score`, "error", "specialty-cutover"),
    check("specialtyCutover:evidenceDossier", specialtyCutover.evidenceDossier?.status === "site-evidence-pending" && specialtyCutover.evidenceDossier?.totalEntries === specialtyCutover.summary?.siteBlockers && specialtyCutover.evidenceDossier?.hardStopOpen > 0 && specialtyCutover.evidenceDossier?.reviewPolicy?.submitterMustDifferFromReviewer, `${specialtyCutover.evidenceDossier?.totalEntries || 0} evidence entries / ${specialtyCutover.evidenceDossier?.hardStopOpen || 0} open hard stops`, "error", "specialty-cutover"),
    check("specialtyCutover:pilotBatchPlan", specialtyCutover.pilotBatchPlan?.status === "ready-to-plan-controlled-rehearsal" && specialtyCutover.pilotBatchPlan?.batches?.length === 3 && specialtyCutover.pilotBatchPlan?.batches?.some((item) => item.id === "batch-1-single-chain"), `${specialtyCutover.pilotBatchPlan?.batches?.length || 0} controlled pilot batches`, "error", "specialty-cutover"),
    check("specialtyCutover:siteEvidenceWorkflow", specialtyCutover.siteEvidenceWorkflow?.currentGate === "submitted-or-accepted-site-evidence-required-before-batch-1" && specialtyCutover.siteEvidenceWorkflow?.states?.length === 6 && specialtyCutover.siteEvidenceWorkflow?.transitions?.some((item) => item.action === "accept-evidence") && specialtyCutover.siteEvidenceWorkflow?.batchOneEntryRequires?.minimumStatus === "submitted", `${specialtyCutover.siteEvidenceWorkflow?.states?.length || 0} evidence states / ${specialtyCutover.siteEvidenceWorkflow?.transitions?.length || 0} transitions`, "error", "specialty-cutover"),
    check("specialtyCutover:acceptanceScenarioSuite", specialtyCutover.acceptanceScenarioSuite?.status === "ready-for-controlled-rehearsal-only" && specialtyCutover.acceptanceScenarioSuite?.summary?.scenarios === 5 && specialtyCutover.acceptanceScenarioSuite?.summary?.hardStopScenarios === 4 && specialtyCutover.acceptanceScenarioSuite?.scenarios?.some((item) => item.id === "scenario-3-signature-rejection"), `${specialtyCutover.acceptanceScenarioSuite?.summary?.scenarios || 0} acceptance scenarios / ${specialtyCutover.acceptanceScenarioSuite?.summary?.hardStopScenarios || 0} hard stops`, "error", "specialty-cutover"),
    check("specialtyCutover:scenarioEvidenceMatrix", specialtyCutover.scenarioEvidenceMatrix?.status === "not-run" && specialtyCutover.scenarioEvidenceMatrix?.summary?.scenarios === 5 && specialtyCutover.scenarioEvidenceMatrix?.summary?.evidenceLinks >= 10 && specialtyCutover.scenarioEvidenceMatrix?.rows?.some((item) => item.goNoGoImpact === "review-scorecard-after-replay"), `${specialtyCutover.scenarioEvidenceMatrix?.summary?.evidenceLinks || 0} scenario evidence links`, "error", "specialty-cutover"),
    check("specialtyCutover:cutoverCommandCenter", specialtyCutover.cutoverCommandCenter?.status === "command-center-ready-for-rehearsal" && specialtyCutover.cutoverCommandCenter?.summary?.windows === 3 && specialtyCutover.cutoverCommandCenter?.summary?.rosterSeats === 5 && specialtyCutover.cutoverCommandCenter?.windows?.some((item) => item.id === "window-t0-controlled-rehearsal") && specialtyCutover.cutoverCommandCenter?.roster?.some((item) => item.seat === "release-commander"), `${specialtyCutover.cutoverCommandCenter?.summary?.windows || 0} windows / ${specialtyCutover.cutoverCommandCenter?.summary?.rosterSeats || 0} command seats`, "error", "specialty-cutover"),
    check("specialtyCutover:observationSignalBoard", specialtyCutover.observationSignalBoard?.status === "observation-ready" && specialtyCutover.observationSignalBoard?.summary?.lanes === 4 && specialtyCutover.observationSignalBoard?.summary?.commandSeatsReady === 4 && specialtyCutover.observationSignalBoard?.lanes?.some((item) => item.id === "lane-evidence-audit" && item.linkedScenarios?.includes("scenario-5-evidence-replay")), `${specialtyCutover.observationSignalBoard?.summary?.lanes || 0} observation lanes / ${specialtyCutover.observationSignalBoard?.summary?.p0Signals || 0} P0 signals`, "error", "specialty-cutover"),
    check("specialtyCutover:runtimeSmokePlan", specialtyCutover.runtimeSmokePlan?.status === "ready-for-runtime-smoke" && specialtyCutover.runtimeSmokePlan?.launchMode === "controlled-rehearsal-only" && specialtyCutover.runtimeSmokePlan?.summary?.suites === 5 && specialtyCutover.runtimeSmokePlan?.suites?.some((item) => item.id === "smoke-server-api") && specialtyCutover.runtimeSmokePlan?.suites?.some((item) => item.id === "smoke-release-gates"), `${specialtyCutover.runtimeSmokePlan?.summary?.suites || 0} runtime smoke suites / ${specialtyCutover.runtimeSmokePlan?.summary?.hardStops || 0} hard stops`, "error", "specialty-cutover")
  ];
}

function citizenLaunchFoundationChecks(citizenLaunchFoundation) {
  return [
    check("citizenLaunch:readiness", citizenLaunchFoundation.ok, citizenLaunchFoundation.ok ? "citizen launch foundation checks passed" : "citizen launch foundation checks failed", "error", "citizen-launch"),
    check("citizenLaunch:phoneCodeDelivery", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:phone-code-delivery" && item.passed), "phone-code delivery exposes send action, cooldown, expiry, and demo gateway evidence", "error", "citizen-launch"),
    check("citizenLaunch:smsDeliveryCallback", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:sms-delivery-callback" && item.passed), "signed SMS final-delivery callback, replay protection, ordered ledger and operations visibility are wired", "error", "citizen-launch"),
    check("citizenLaunch:accountProvisioning", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:account-provisioning-boundary" && item.passed), "resident, doctor, and nurse account provisioning owners and audit evidence are documented", "error", "citizen-launch"),
    check("citizenLaunch:offlineCache", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:offline-cache" && item.passed), "resident PWA shell refreshes HTML/JS/CSS from network first", "error", "citizen-launch"),
    check("citizenLaunch:mobilePreviewServiceSwitch", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:mobile-preview-service-switch" && item.passed), "mobile preview service switch evidence present", "error", "citizen-launch"),
    check("citizenLaunch:pipelineAcceptanceChecklist", citizenLaunchFoundation.checks?.some((item) => item.id === "citizen-foundation:pipeline-acceptance-checklist" && item.passed), "C-end pipeline audit exposes copyable onsite acceptance checklist", "error", "citizen-launch"),
    check("citizenLaunch:externalDependencies", citizenLaunchFoundation.externalDependencies?.every((item) => item.status === "required-before-production" && item.owner && item.cutoverBlocker && item.evidence && item.onsiteAcceptance), `${citizenLaunchFoundation.externalDependencies?.length || 0} production dependencies surfaced with owners, blockers, evidence, and onsite acceptance`, "error", "citizen-launch")
  ];
}

function citizenRecordsChecks(citizenRecords) {
  return [
    check("citizenRecords:softwareReady", citizenRecords.summary?.softwareReady, `${citizenRecords.softwareChecks?.filter((item) => item.passed).length || 0}/${citizenRecords.softwareChecks?.length || 0} software checks`, "error", "citizen-records"),
    check("citizenRecords:integrationReady", citizenRecords.summary?.integrationReady, `${citizenRecords.integrationChecks?.filter((item) => item.passed).length || 0}/${citizenRecords.integrationChecks?.length || 0} T00 integration checks`, "error", "citizen-records"),
    check(
      "citizenRecords:productionBoundary",
      citizenRecords.summary?.productionReady === false && citizenRecords.summary?.externalReady === false && (citizenRecords.blockers?.length || 0) >= 1,
      `${citizenRecords.blockers?.length || 0} external or site blockers; productionReady=false`,
      "error",
      "citizen-records"
    )
  ];
}

function registrationReferralAcceptanceChecks(registrationReferralAcceptance) {
  return [
    check("registrationReferral:threadReady", registrationReferralAcceptance.threadReady, `${registrationReferralAcceptance.summary?.threadPassed || 0}/${registrationReferralAcceptance.summary?.threadChecks || 0} thread checks`, "error", "registration-referral"),
    check("registrationReferral:integrationReady", registrationReferralAcceptance.integrationReady, `${registrationReferralAcceptance.summary?.integrationPassed || 0}/${registrationReferralAcceptance.summary?.integrationChecks || 0} T00 checks`, "error", "registration-referral"),
    check("registrationReferral:productionBoundary", registrationReferralAcceptance.productionReady === false && registrationReferralAcceptance.status === "integrated-local-ready-production-blocked", `${registrationReferralAcceptance.summary?.commands || 0} commands; productionReady=false`, "error", "registration-referral")
  ];
}

function productionDbReadinessChecks(productionDbReadiness) {
  return [
    check("productionDb:readiness", productionDbReadiness.ok, productionDbReadiness.ok ? "production database readiness checks passed" : "production database readiness checks failed", "error", "production-db"),
    check("productionDb:runtimeBlock", productionDbReadiness.migrationEvidence?.runtimePostgresBlocked, "postgres runtime remains blocked until adapter cutover", "error", "production-db"),
    check("productionDb:sqliteRuntimeProfile", productionDbReadiness.sqliteRuntimeProfile && Object.values(productionDbReadiness.sqliteRuntimeProfile).every(Boolean), "SQLite WAL, FULL synchronous, foreign keys, busy timeout and integrity probe are wired", "error", "production-db"),
    check("productionDb:rehearsalDocs", productionDbReadiness.rehearsalEvidence && Object.values(productionDbReadiness.rehearsalEvidence).every(Boolean), "backup, restore, RTO/RPO, and release artifact docs", "error", "production-db"),
    check("productionDb:cutoverCenter", productionDbReadiness.cutoverCenter?.ok && productionDbReadiness.cutoverCenter?.summary?.migrationBatches >= 4 && productionDbReadiness.cutoverCenter?.summary?.productionReadyRuns === 0, `${productionDbReadiness.cutoverCenter?.summary?.migrationBatches || 0} migration batches / ${productionDbReadiness.cutoverCenter?.summary?.cutoverRuns || 0} rehearsal runs / production gate preserved`, "error", "production-db"),
    check("productionDb:migrationPackage", productionDbReadiness.postgresMigrationPackage?.ok && productionDbReadiness.postgresMigrationPackage?.manifest?.mode === "manifest" && !productionDbReadiness.postgresMigrationPackage?.files?.["records.copy.tsv"], `${productionDbReadiness.postgresMigrationPackage?.manifest?.summary?.records || 0} source records summarized without payload export`, "error", "production-db"),
    check("productionDb:migrationBoundary", productionDbReadiness.postgresMigrationPackage?.manifest?.productionReady === false && productionDbReadiness.migrationEvidence?.runtimePostgresBlocked, "migration package cannot enable PostgreSQL runtime or production readiness", "error", "production-db"),
    check("productionDb:transactionalOutbox", productionDbReadiness.postgresRuntimeSync?.transactionalOutbox && productionDbReadiness.postgresRuntimeSync?.batchIntegrity && productionDbReadiness.postgresRuntimeSync?.healthStatus, "SQLite schema v11 retains atomic signed PostgreSQL change batches and health status", "error", "production-db"),
    check("productionDb:idempotentWorker", productionDbReadiness.postgresRuntimeSync?.idempotentApply && productionDbReadiness.postgresRuntimeSync?.retryState && productionDbReadiness.postgresRuntimeSync?.workerCommand, "PostgreSQL worker is idempotent, version-aware and retryable", "error", "production-db"),
    check("productionDb:baselineBootstrap", productionDbReadiness.postgresRuntimeSync?.baselineBootstrap, "SQLite collection baseline can be queued once before incremental sync", "error", "production-db"),
    check("productionDb:shadowReconciliation", productionDbReadiness.postgresRuntimeSync?.readOnlyReconciliation && productionDbReadiness.postgresRuntimeSync?.reconciliationLedger && productionDbReadiness.postgresRuntimeSync?.reconciliationCommand, "read-only collection version and digest reconciliation is payload-free and health-visible", "error", "production-db"),
    check("productionDb:primaryReadRehearsal", productionDbReadiness.postgresRuntimeSync?.primaryReadRehearsal, "repeatable-read read-only PostgreSQL snapshot reconstruction verifies payload digests and the complete shadow baseline without enabling cutover", "error", "production-db"),
    check("productionDb:productionAdapter", productionDbReadiness.postgresRuntimeSync?.productionAdapter, "PostgreSQL adapter provides verified reads, serializable writes, complete optimistic locking and payload-free evidence-gated audit", "error", "production-db"),
    check("productionDb:reconciliationCaseWorkflow", productionDbReadiness.postgresRuntimeSync?.reconciliationCaseWorkflow, "commission-only reconciliation cases require ownership, matched-run clearance and resolution evidence", "error", "production-db"),
    check("productionDb:reconciliationScheduler", productionDbReadiness.postgresRuntimeSync?.reconciliationScheduler, "hardened reconciliation service runs every five minutes", "error", "production-db"),
    check("productionDb:shadowBoundary", productionDbReadiness.migrationEvidence?.runtimePostgresBlocked && productionDbReadiness.postgresMigrationPackage?.manifest?.target?.runtimeAdapterEnabled === false, "PostgreSQL remains a shadow target and cannot become primary through the worker", "error", "production-db")
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
    "digital-hospital:pilot-readiness",
    "phase2:catalog-readiness",
    "phase2:joint-test-readiness",
    "phase2:mutual-recognition-readiness",
    "phase2:clinical-assist-readiness",
    "phase2:disease-reporting-readiness",
    "phase2:proposal-readiness",
    "phase2:citizen-operations-readiness",
    "security:commercial-crypto-readiness",
    "quality-safety:report",
    "quality-safety:interface-standard",
    "quality-safety:joint-test",
    "environment:matrix",
    "hybrid:deployment-readiness",
    "deployment:package",
    "deployment:verify",
    "hospital-operations:readiness",
    "internet-nursing:readiness",
    "health-dashboard:summary",
    "priority-apps:templates",
    "maternal-child:readiness",
    "immunization:readiness",
    "public-health:readiness",
    "public-health:highlights:readiness",
    "public-health:coordination-readiness",
    "public-health:event-reporting-readiness",
    "public-health:priority-standard-review-readiness",
    "public-health:final-readiness",
    "blood-system:readiness",
    "policy:coverage",
    "integration:readiness",
    "interface:mapping",
    "monitoring:readiness",
    "referral:readiness",
    "operations:readiness",
    "process:audit",
    "site:pack",
    "production-db:readiness",
    "postgres:migration-package",
    "postgres:migration-verify",
    "postgres:sync-worker",
    "postgres:sync-bootstrap",
    "postgres:shadow-reconcile",
    "postgres:primary-read-rehearsal",
    "postgres:adapter-status",
    "postgres:adapter-verify",
    "platform:capability-map",
    "platform:go-live-slices",
    "platform:standards-ledgers",
    "evaluation:evidence",
    "regional-data-sharing:report",
    "regional-referral:overlap",
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

function platformCapabilityMapChecks(platformCapabilityMap) {
  return [
    check("platformCapabilityMap:readiness", platformCapabilityMap.ok, platformCapabilityMap.ok ? "platform capability map indexed manifest scripts data and evidence" : "platform capability map checks failed", "error", "governance"),
    check("platformCapabilityMap:releaseArtifacts", platformCapabilityMap.summary?.releaseArtifacts >= 60, `${platformCapabilityMap.summary?.releaseArtifacts || 0} release artifacts`, "error", "governance"),
    check("platformCapabilityMap:packageScripts", platformCapabilityMap.summary?.packageScripts >= 90, `${platformCapabilityMap.summary?.packageScripts || 0} package scripts`, "error", "governance"),
    check("platformCapabilityMap:dataCollections", platformCapabilityMap.summary?.dataCollections >= 200, `${platformCapabilityMap.summary?.dataCollections || 0} data collections`, "error", "governance"),
    check("platformCapabilityMap:domains", platformCapabilityMap.summary?.capabilityDomains >= 20, `${platformCapabilityMap.summary?.capabilityDomains || 0} capability domains`, "error", "governance")
  ];
}

function platformGoLiveSlicesChecks(platformGoLiveSlices) {
  return [
    check("platformGoLiveSlices:readiness", platformGoLiveSlices.ok, platformGoLiveSlices.ok ? "go-live slices are reportable" : "go-live slice checks failed", "error", "governance"),
    check("platformGoLiveSlices:blockerRegister", platformGoLiveSlices.summary?.openBlockers >= 1 && platformGoLiveSlices.summary?.p0Blockers >= 1, `${platformGoLiveSlices.summary?.openBlockers || 0} open / ${platformGoLiveSlices.summary?.p0Blockers || 0} P0 blockers`, "error", "governance"),
    check("platformGoLiveSlices:serviceOrderCenter", platformGoLiveSlices.summary?.serviceOrders >= 8 && platformGoLiveSlices.summary?.serviceTypes >= 4, `${platformGoLiveSlices.summary?.serviceOrders || 0} orders / ${platformGoLiveSlices.summary?.serviceTypes || 0} service types`, "error", "governance"),
    check("platformGoLiveSlices:masterDataDirectory", platformGoLiveSlices.summary?.masterDataDomains >= 6, `${platformGoLiveSlices.summary?.masterDataDomains || 0} master data domains`, "error", "governance"),
    check("platformGoLiveSlices:productionBoundary", platformGoLiveSlices.summary?.onsiteMasterDataGaps >= 1, `${platformGoLiveSlices.summary?.onsiteMasterDataGaps || 0} onsite master-data gaps remain explicit`, "error", "governance")
  ];
}

function platformStandardsLedgersChecks(platformStandardsLedgers) {
  return [
    check("platformStandardsLedgers:readiness", platformStandardsLedgers.ok, platformStandardsLedgers.ok ? "six platform standards ledgers are structurally ready" : "platform standards ledger checks failed", "error", "governance"),
    check("platformStandardsLedgers:sixRegisters", platformStandardsLedgers.summary?.ledgers === 6, `${platformStandardsLedgers.summary?.ledgers || 0}/6 ledgers`, "error", "governance"),
    check("platformStandardsLedgers:implemented", platformStandardsLedgers.summary?.implemented === 6, `${platformStandardsLedgers.summary?.implemented || 0}/6 ledger structures implemented`, "error", "governance"),
    check("platformStandardsLedgers:acceptanceCriteria", platformStandardsLedgers.summary?.acceptanceCriteria >= 24, `${platformStandardsLedgers.summary?.acceptanceCriteria || 0} acceptance criteria`, "error", "governance"),
    check("platformStandardsLedgers:automation", platformStandardsLedgers.summary?.automatedChecks >= 18, `${platformStandardsLedgers.summary?.automatedChecks || 0} automated checks`, "error", "governance"),
    check("platformStandardsLedgers:detailInspection", platformStandardsLedgers.ledgers?.every((item) => Array.isArray(item.rows) && item.acceptanceCriteria?.length >= 4 && item.sourceCollections?.length >= 4), "all six ledgers expose normalized rows, acceptance criteria and source facets", "error", "governance"),
    check("platformStandardsLedgers:productionBoundary", platformStandardsLedgers.summary?.formalGoLiveReady === 0 && platformStandardsLedgers.summary?.onsiteBlockers >= 6, "onsite evidence remains explicitly blocked", "error", "governance")
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
    run(npm, ["run", "blood-system:readiness"]),
    run(npm, ["run", "public-health:highlights:readiness"]),
    run(npm, ["run", "public-health:final-readiness"]),
    run(npm, ["test"]),
    run(npm, ["run", "test:coverage"]),
    run(npm, ["run", "test:e2e"]),
    run(npm, ["run", "deploy:check"]),
    run(npm, ["audit", "--omit=dev", "--registry=https://registry.npmjs.org"])
  ].map((item) => check(`command:${item.command}`, item.passed, item.passed ? "passed" : item.stderr || item.stdout, "error", "commands"));
}

function buildReleaseReport(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const data = options.data || readJson("data/db.json");
  const env = validateProductionConfig(options);
  const storageModel = inspectStorageModel({ dataDir: path.join(ROOT, "data") });
  const identityContract = buildIdentityContract({ data });
  const auditRetention = buildAuditRetentionReport({ data, env: auditRetentionEnvForRelease(options, env.profile) });
  const chronicInformatizationSources = buildChronicInformatizationSourceReport({ data, pkg });
  const chronicFollowup = buildChronicFollowupReadinessReport({ data, pkg, sourceTraceability: chronicInformatizationSources });
  const chronicInstitutionInterfaces = buildChronicInstitutionInterfaceReport({ data, pkg });
  const chronicLaunchCore = buildChronicLaunchCoreReport({ data, pkg });
  const dataQuality = buildDataQualityReport({ data });
  const qualitySafety = buildQualitySafetyReport({ data });
  const qualitySafetyInterfaceStandard = buildQualitySafetyInterfaceStandard({ data });
  const qualitySafetyInterfaceJointTest = buildQualitySafetyInterfaceJointTestPack({ data, standardReport: qualitySafetyInterfaceStandard });
  const qualityOperationsGovernance = buildQualityOperationsGovernanceReadiness({ data, pkg });
  const drugConsumable = buildDrugConsumableReadinessReport({ data, pkg });
  const integrationReadiness = buildIntegrationReadinessReport({ data });
  const objectStorageReadiness = buildObjectStorageReadiness({ data, pkg });
  const financialGatewayReadiness = buildFinancialGatewayReadiness({ pkg });
  const interfaceMapping = buildInterfaceMappingReport({ data, pkg });
  const dataGovernance = buildDataGovernanceReadiness({ data, pkg, interfaceMapping, dataQuality });
  const digitalHospitalStandards = buildDigitalHospitalStandardsReadiness({ pkg });
  const digitalHospitalPilot = buildDigitalHospitalPilotReadiness({ data, pkg });
  const platformProductionAudit = buildPlatformProductionAudit({ pkg });
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
  const productionSecurity = buildProductionSecurityReadiness({ data, pkg });
  const productionGoNoGo = buildProductionGoNoGoReadiness({ data, pkg, drRehearsalSigned: false });
  const productionReleaseEvidenceSource = buildProductionReleaseEvidenceReadiness({
    directory: (options.env || process.env).PRODUCTION_RELEASE_EVIDENCE_DIR || DEFAULT_PRODUCTION_RELEASE_EVIDENCE_DIR
  });
  const productionReleaseEvidenceReadiness = {
    ...productionReleaseEvidenceSource,
    evidenceDirectory: "server-configured-controlled-directory",
    productionReady: false
  };
  const pilotAcceptance = buildPilotAcceptanceCenter({ data, pkg, env: { ...process.env, ...(options.env || {}) } });
  const phase2Proposal = buildPhase2ProposalReadiness({ pkg });
  const regionalDataSharing = buildRegionalDataSharingReport({ data, pkg });
  const regionalReferralOverlap = buildRegionalReferralOverlapReport({ data, pkg });
  const hospitalOperationsReadiness = buildHospitalOperationsReadinessReport({ data, pkg });
  const hospitalOperationsRelease = buildHospitalOperationsReleaseReport({ data, pkg, readiness: hospitalOperationsReadiness });
  const hospitalOperationsModule = buildHospitalOperationsModuleReport({ data, pkg, readiness: hospitalOperationsReadiness, release: hospitalOperationsRelease });
  const hospitalOperationsBriefPdf = buildHospitalOperationsBriefPdfReport();
  const researchSandbox = buildResearchSandboxReadiness(data);
  const monitoringReadiness = buildMonitoringReadinessReport({ data, pkg });
  const referralTeleconsultationReadiness = buildReferralTeleconsultationReadinessReport({ data, pkg });
  const escortServiceReadiness = buildEscortServiceReadinessReport({ data, pkg });
  const internetNursingReadiness = buildInternetNursingReadinessReport({ data, pkg });
  const careServiceProductionReadiness = buildCareServiceProductionReadiness({
    data,
    env: { ...process.env, ...(options.env || {}) }
  });
  const emergencyReadiness = buildEmergencyReadinessReport();
  const specialtyCutover = buildSpecialtyCutoverPack();
  const t10ClinicalBloodReadiness = {
    ...BloodClinicalProduction.evaluateProductionReadiness({}),
    productionReady: false,
    formalGoLiveState: "blocked-until-trusted-site-evidence-and-platform-launch-approval"
  };
  const t10EmergencyModuleReadiness = {
    ...EmergencyModuleGate.buildIndependentModuleReadiness(data),
    productionReady: false,
    formalGoLiveState: "blocked-until-trusted-site-evidence-and-platform-launch-approval"
  };
  const t10ImagingProductionReadiness = {
    ...ImagingCloudProduction.center(data),
    productionReady: false,
    formalGoLiveState: "blocked-until-trusted-site-evidence-and-platform-launch-approval"
  };
  const t10PhysicalExaminationReadiness = {
    ...buildPhysicalExaminationStandaloneReadiness(),
    productionReady: false,
    formalGoLiveState: "blocked-until-trusted-site-evidence-and-platform-launch-approval"
  };
  const citizenLaunchFoundation = buildCitizenLaunchFoundationReadiness({
    pkg,
    phaseDoc: fs.existsSync(path.join(ROOT, "docs", "citizen-launch-foundation-plan.md"))
      ? fs.readFileSync(path.join(ROOT, "docs", "citizen-launch-foundation-plan.md"), "utf8")
      : ""
  });
  const citizenRecords = assessCitizenRecordsReadiness({
    root: ROOT,
    env: { ...process.env, ...(options.env || {}) },
    profile: "software"
  });
  const registrationReferralAcceptance = buildRegistrationReferralAcceptance({
    data,
    pkg,
    releaseWired: true
  });
  const operationsReadiness = buildOperationsReadinessReport({ data, pkg });
  const processAudit = buildProcessAuditReport({ data });
  const serviceAcceptance = buildServiceAcceptanceSummary(data);
  const productionDbReadiness = buildProductionDbReadinessReport({ data, pkg, storageModel });
  const evaluationEvidence = buildEvaluationEvidenceReport({ data });
  const environmentMatrix = buildEnvironmentMatrixReport({ data, pkg });
  const hybridDeploymentReadiness = buildHybridDeploymentReadinessReport({ data, pkg });
  const productionDeploymentPackage = buildProductionDeploymentPackage();
  productionDeploymentPackage.verification = verifyProductionDeploymentPackage(productionDeploymentPackage);
  const healthDashboard = buildHealthDashboardSummary({ data });
  const priorityApplicationTemplates = buildPriorityApplicationTemplates({ data });
  const maternalChildReadiness = buildMaternalChildReadinessReport({ data, packageSource: JSON.stringify(pkg) });
  const immunizationReadiness = buildImmunizationReadinessReport({ data });
  const publicHealthReadiness = buildPublicHealthReadinessReport({ data, pkg });
  const publicHealthHighlightsReadiness = buildPublicHealthHighlightsReadiness({ data, pkg });
  const publicHealthFinalReadiness = buildPublicHealthFinalReadiness({ data });
  const bloodSystemReadiness = buildBloodSystemReadinessReport({ pkg });
  const diseasePaymentReadiness = buildDiseasePaymentReadiness();
  const insurancePaymentAcceptance = buildInsurancePaymentAcceptance();
  const insurancePaymentEvidencePacket = buildInsurancePaymentEvidencePacket();
  const diseasePaymentFormalGroupingIds = ["formal-grouping-async", "formal-grouping-compensation", "formal-grouping-api-routes", "formal-grouping-ui"];
  const diseasePaymentFormalGroupingReady = diseasePaymentFormalGroupingIds
    .every((id) => diseasePaymentReadiness.checks?.some((item) => item.id === id && item.ok));
  const diseasePaymentLocalPackageIds = ["local-package-validation", "local-package-signature", "local-package-impact", "local-package-diff", "local-package-release", "local-package-scheduling", "local-package-rollback", "local-package-pagination", "catalog-prefix-index", "local-package-batch-simulation", "local-package-builder", "local-package-api-routes", "local-package-ui"];
  const diseasePaymentLocalPackageReady = diseasePaymentLocalPackageIds
    .every((id) => diseasePaymentReadiness.checks?.some((item) => item.id === id && item.ok));
  const policyCoverage = buildPolicyCoverageReport();
  const platformCapabilityManifest = buildReleaseArtifactManifest({ pkg, releaseReport: { summary: { total: 0 }, checks: [] } });
  const platformCapabilityMap = buildCapabilityMap({ data, pkg, manifest: platformCapabilityManifest });
  const platformGoLiveSlices = buildPlatformGoLiveSlices(data, platformCapabilityMap);
  const platformStandardsLedgers = buildPlatformStandardsLedgers(data, { manifest: platformCapabilityManifest });
  const siteReadinessPack = buildSiteReadinessPack({ data, pkg, envFile: options.envFile || ".env.example", env: options.env || process.env, identityContract, interfaceMapping, monitoringReadiness });
  const onsiteLaunchRequirements = buildOnsiteLaunchRequirements({ pkg, sitePack: siteReadinessPack, releaseReport: { ok: true }, envFile: options.envFile || ".env.example", env: options.env || process.env });
  const checks = [
    assertFile("README.md"),
    assertFile("DEPLOYMENT.md"),
    assertFile(".env.example"),
    assertFile("data/db.json"),
    assertFile("drug-consumable-about.html"),
    assertFile("server.js"),
    assertFile("session-store.js"),
    assertFile("scripts/storage-admin.js"),
    ...packageChecks(pkg),
    ...snapshotChecks(data),
    ...storageModelChecks(storageModel),
    ...identityContractChecks(identityContract),
    ...auditRetentionChecks(auditRetention),
    ...chronicFollowupChecks(chronicFollowup, chronicInstitutionInterfaces, chronicLaunchCore, chronicInformatizationSources),
    ...dataQualityChecks(dataQuality),
    ...dataGovernanceChecks(dataGovernance),
    ...digitalHospitalStandardsChecks(digitalHospitalStandards),
    ...digitalHospitalPilotChecks(digitalHospitalPilot),
    ...platformProductionAuditChecks(platformProductionAudit),
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
    ...productionSecurityChecks(productionSecurity),
    ...productionGoNoGoChecks(productionGoNoGo),
    check("productionReleaseEvidence:contract", productionReleaseEvidenceReadiness.summary?.documents === 5 && productionReleaseEvidenceReadiness.gates?.length === 5 && productionReleaseEvidenceReadiness.checks?.length >= 5, `${productionReleaseEvidenceReadiness.summary?.present || 0}/5 controlled evidence documents present`, "error", "production-release-evidence"),
    check("productionReleaseEvidence:publicSummary", fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes("/api/production-release/evidence-readiness") && fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes("buildProductionReleaseEvidencePublicSummary"), "commission-only redacted readiness summary is wired", "error", "production-release-evidence"),
    check("productionReleaseEvidence:formalGate", productionReleaseEvidenceReadiness.ok === true, `${productionReleaseEvidenceReadiness.status}; external evidence validation does not itself authorize production`, "warn", "production-release-evidence"),
    ...pilotAcceptanceChecks(pilotAcceptance),
    ...phase2ProposalChecks(phase2Proposal),
    ...qualitySafetyChecks(qualitySafety),
    ...qualitySafetyInterfaceStandardChecks(qualitySafetyInterfaceStandard),
    ...qualitySafetyInterfaceJointTestChecks(qualitySafetyInterfaceJointTest),
    ...qualityOperationsGovernanceChecks(qualityOperationsGovernance),
    ...drugConsumableChecks(drugConsumable),
    ...integrationReadinessChecks(integrationReadiness),
    ...objectStorageReadinessChecks(objectStorageReadiness),
    ...financialGatewayReadinessChecks(financialGatewayReadiness),
    ...interfaceMappingChecks(interfaceMapping),
    ...regionalDataSharingChecks(regionalDataSharing),
    ...regionalReferralOverlapChecks(regionalReferralOverlap),
    ...hospitalOperationsReadinessChecks(hospitalOperationsReadiness),
    ...hospitalOperationsReleaseChecks(hospitalOperationsRelease),
    ...hospitalOperationsModuleChecks(hospitalOperationsModule),
    ...hospitalOperationsBriefPdfChecks(hospitalOperationsBriefPdf),
    ...researchSandboxChecks(researchSandbox),
    ...monitoringReadinessChecks(monitoringReadiness),
    ...referralTeleconsultationChecks(referralTeleconsultationReadiness),
    ...escortServiceChecks(escortServiceReadiness),
    ...internetNursingChecks(internetNursingReadiness),
    ...careServiceProductionChecks(careServiceProductionReadiness),
    ...emergencyReadinessChecks(emergencyReadiness),
    ...specialtyCutoverChecks(specialtyCutover),
    check("specialtyCutover:clinicalBloodIndependentGate", t10ClinicalBloodReadiness.standalone === true && t10ClinicalBloodReadiness.productionReady === false && (t10ClinicalBloodReadiness.blockers?.length || 0) === 6, `${t10ClinicalBloodReadiness.blockers?.length || 0} clinical-blood site evidence blockers; platform gate closed`, "error", "cutover"),
    check("specialtyCutover:emergencyIndependentGate", t10EmergencyModuleReadiness.deployment === "independent-emergency-module" && t10EmergencyModuleReadiness.productionReady === false && t10EmergencyModuleReadiness.rollback?.formalGoLiveState, `${t10EmergencyModuleReadiness.rollback?.triggers?.length || 0} emergency rollback triggers; platform gate closed`, "error", "cutover"),
    check("specialtyCutover:imagingSiteReceiptGate", t10ImagingProductionReadiness.summary?.siteReceipts === 5 && t10ImagingProductionReadiness.routeContracts?.length === 9 && t10ImagingProductionReadiness.productionReady === false, `${t10ImagingProductionReadiness.summary?.siteReceiptsVerified || 0}/5 imaging receipts verified; platform gate closed`, "error", "cutover"),
    check("specialtyCutover:physicalExaminationIndependentGate", t10PhysicalExaminationReadiness.codeReady === true && t10PhysicalExaminationReadiness.decision === "NO-GO" && t10PhysicalExaminationReadiness.summary?.checks === 13 && t10PhysicalExaminationReadiness.productionReady === false, `${t10PhysicalExaminationReadiness.summary?.passed || 0}/13 physical-examination checks; platform gate closed`, "error", "cutover"),
    ...citizenLaunchFoundationChecks(citizenLaunchFoundation),
    ...citizenRecordsChecks(citizenRecords),
    ...registrationReferralAcceptanceChecks(registrationReferralAcceptance),
    ...operationsReadinessChecks(operationsReadiness),
    ...processAuditChecks(processAudit),
    ...serviceAcceptanceChecks(serviceAcceptance),
    ...siteReadinessChecks(siteReadinessPack),
    ...onsiteLaunchRequirementsChecks(onsiteLaunchRequirements),
    ...productionDbReadinessChecks(productionDbReadiness),
    ...evaluationEvidenceChecks(evaluationEvidence),
    ...environmentMatrixChecks(environmentMatrix),
    ...hybridDeploymentChecks(hybridDeploymentReadiness),
    ...productionDeploymentPackageChecks(productionDeploymentPackage),
    ...healthDashboardChecks(healthDashboard),
    ...priorityApplicationTemplateChecks(priorityApplicationTemplates),
    ...maternalChildReadinessChecks(maternalChildReadiness),
    ...immunizationReadinessChecks(immunizationReadiness),
    ...publicHealthReadinessChecks(publicHealthReadiness),
    ...publicHealthHighlightsReadinessChecks(publicHealthHighlightsReadiness),
    ...publicHealthFinalReadinessChecks(publicHealthFinalReadiness),
    check("bloodSystem:readiness", bloodSystemReadiness.ok, bloodSystemReadiness.ok ? "blood system readiness checks passed" : "blood system readiness failed", "error", "blood-system"),
    check("bloodSystem:formalGoLiveBoundary", bloodSystemReadiness.functionalState === "software-release-ready" && bloodSystemReadiness.formalGoLiveState === "blocked-until-site-evidence-signed" && bloodSystemReadiness.productionReady === false && (bloodSystemReadiness.onsiteBlockers?.length || 0) >= 8, `${bloodSystemReadiness.functionalState} / ${bloodSystemReadiness.formalGoLiveState} / ${bloodSystemReadiness.onsiteBlockers?.length || 0} onsite blockers`, "error", "blood-system"),
    check("diseasePayment:readiness", diseasePaymentReadiness.ready, diseasePaymentReadiness.ready ? `${diseasePaymentReadiness.checks.length}/${diseasePaymentReadiness.checks.length} disease payment readiness checks passed` : "disease payment readiness failed", "error", "disease-payment"),
    check("diseasePayment:formalGroupingOperations", diseasePaymentFormalGroupingReady && (diseasePaymentReadiness.summary?.formalGrouping?.completed || 0) >= 1, `${diseasePaymentReadiness.summary?.formalGrouping?.total || 0} formal grouping jobs, ${diseasePaymentReadiness.summary?.formalGrouping?.pendingDeadLetters || 0} pending dead letters`, "error", "disease-payment"),
    check("diseasePayment:localPackageGovernance", diseasePaymentLocalPackageReady, diseasePaymentLocalPackageReady ? "local official catalog and payment parameter package governance passed" : "local official package governance failed", "error", "disease-payment"),
    check("insurancePayment:domainAcceptance", insurancePaymentAcceptance.localReady === true && insurancePaymentAcceptance.summary?.workflowsReady === 6, `${insurancePaymentAcceptance.summary?.workflowsReady || 0}/6 insurance payment workflows ready`, "error", "insurance-payment"),
    check("insurancePayment:publicWiring", insurancePaymentAcceptance.integrationHandoff?.pending === 0 && insurancePaymentAcceptance.integrationHandoff?.wired === 23, `${insurancePaymentAcceptance.integrationHandoff?.wired || 0}/23 T00 routes and callback hooks wired`, "error", "insurance-payment"),
    check("insurancePayment:evidencePacket", verifyInsurancePaymentEvidencePacket(insurancePaymentEvidencePacket), `evidence packet ${insurancePaymentEvidencePacket.packetDigest || "missing"}`, "error", "insurance-payment"),
    check("insurancePayment:productionBoundary", insurancePaymentAcceptance.productionReady === false && insurancePaymentAcceptance.productionGate?.passed === false && insurancePaymentAcceptance.productionGate?.blockers?.includes("live-site-acceptance-confirmed") && (insurancePaymentAcceptance.externalBlockers?.length || 0) >= 20, `${insurancePaymentAcceptance.externalBlockers?.length || 0} external evidence blockers and live-site acceptance remain`, "error", "insurance-payment"),
    ...policyCoverageChecks(policyCoverage),
    ...platformCapabilityMapChecks(platformCapabilityMap),
    ...platformGoLiveSlicesChecks(platformGoLiveSlices),
    ...platformStandardsLedgersChecks(platformStandardsLedgers),
    ...env.checks,
    ...commandChecks(options.runCommands)
  ];

  const failed = checks.filter((item) => item.severity === "error" && !item.passed);
  platformProductionAudit.summary.releaseChecks = checks.length;
  platformProductionAudit.summary.releaseChecksPassed = checks.filter((item) => item.passed).length;
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
    chronicInformatizationSources,
    chronicInstitutionInterfaces,
    chronicLaunchCore,
    dataQuality,
    dataGovernance,
    digitalHospitalStandards,
    digitalHospitalPilot,
    platformProductionAudit,
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
    productionSecurity,
    productionGoNoGo,
    productionReleaseEvidenceReadiness,
    pilotAcceptance,
    phase2Proposal,
    qualitySafety,
    qualitySafetyInterfaceStandard,
    qualitySafetyInterfaceJointTest,
    qualityOperationsGovernance,
    drugConsumable,
    integrationReadiness,
    objectStorageReadiness,
    financialGatewayReadiness,
    interfaceMapping,
    regionalDataSharing,
    regionalReferralOverlap,
    hospitalOperationsReadiness,
    hospitalOperationsRelease,
    hospitalOperationsModule,
    hospitalOperationsBriefPdf,
    researchSandbox,
    monitoringReadiness,
    referralTeleconsultationReadiness,
    escortServiceReadiness,
    internetNursingReadiness,
    careServiceProductionReadiness,
    emergencyReadiness,
    specialtyCutover,
    t10ClinicalBloodReadiness,
    t10EmergencyModuleReadiness,
    t10ImagingProductionReadiness,
    t10PhysicalExaminationReadiness,
    citizenLaunchFoundation,
    citizenRecords,
    registrationReferralAcceptance,
    operationsReadiness,
    processAudit,
    serviceAcceptance,
    siteReadinessPack,
    onsiteLaunchRequirements,
    productionDbReadiness,
    evaluationEvidence,
    environmentMatrix,
    hybridDeploymentReadiness,
    productionDeploymentPackage,
    healthDashboard,
    priorityApplicationTemplates,
    maternalChildReadiness,
    immunizationReadiness,
    publicHealthReadiness,
    publicHealthHighlightsReadiness,
    publicHealthFinalReadiness,
    bloodSystemReadiness,
    diseasePaymentReadiness,
    insurancePaymentAcceptance,
    insurancePaymentEvidencePacket,
    policyCoverage,
    platformCapabilityMap,
    platformGoLiveSlices,
    platformStandardsLedgers
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
    "## Chronic launch core readiness",
    "",
    "See `chronic-launch-core.json` and `chronic-launch-core.md` for institution systems, identity scope, message receipts, quality model governance, and pharmacy-insurance closure evidence.",
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
    "See `research-sandbox-readiness-report.json` and `research-sandbox-readiness-report.md` for dataset applications, disease registries, ethics approval, de-identification release, sandbox access, compliant data export, usage audit, and outcome return evidence.",
    "",
    "## Data quality and master index report",
    "",
    "See `data-quality-report.json` and `data-quality-report.md` for resident master index completeness, resident reference checks, source traceability, and rectification issue evidence.",
    "",
    "## Digital hospital standards readiness report",
    "",
    "See `digital-hospital-standards-readiness-report.json` and `digital-hospital-standards-readiness-report.md` for the standards center, official policy mapping, evaluation workflow, evidence model, review queue, pilot boundary, and no-patient-PII collection guardrails.",
    "",
    "## Digital hospital pilot readiness report",
    "",
    "See `digital-hospital-pilot-readiness-report.json` and `digital-hospital-pilot-readiness-report.md` for the four evaluation rule packs, clause-level catalog, hospital collection adapters, evidence review, pre-assessment, rectification, and formal site-evidence boundary.",
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
    "See `drug-consumable-readiness-report.json` and `drug-consumable-readiness-report.md` for rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement coordination, traceability policy sources, and remediation-loop evidence.",
    "",
    "## Quality-safety institution interface standard",
    "",
    "See `quality-safety-interface-standard.json` and `quality-safety-interface-standard.md` for hospital-facing document control, transport, security, message envelope, field dictionaries, sample payloads, status codes, and joint-test acceptance checklist.",
    "",
    "## Quality-safety institution joint-test pack",
    "",
    "See `quality-safety-interface-joint-test-pack.json` and `quality-safety-interface-joint-test-pack.md` for sample requests, HMAC-SHA256 signature fixtures, field dictionaries, site sample acceptance rows, idempotency replay checks, and negative validation cases.",
    "",
    "## Operations readiness report",
    "",
    "See `operations-readiness-report.json` and `operations-readiness-report.md` for operation routes, production deployment tracks, external dependency risks, and release operation scripts.",
    "",
    "## Hospital operations readiness report",
    "",
    "See `hospital-operations-readiness-report.json` and `hospital-operations-readiness-report.md` for hospital operation snapshots, resource dispatch, direct-report reconciliation, alert rules, API permissions, and audit evidence.",
    "",
    "## Hospital operations release report",
    "",
    "See `hospital-operations-release-report.json` and `hospital-operations-release-report.md` for interface mapping, signed hospital system ingest APIs, SLA command chains, alert playbooks, shift handover, shift handover owner matrix, shift handover signoff audit trace, multi-status reconciliation review, performance indicator detail, dispatch lifecycle, and release script evidence.",
    "",
    "## Hospital operations module function report",
    "",
    "See `hospital-operations-module-report.json` and `hospital-operations-module-report.md` for module capability audit, signed hospital ingest coverage, release evidence, and next-step development plan.",
    "",
    "## Hospital operations brief PDF report",
    "",
    "See `hospital-operations-brief-pdf-report.json`, `hospital-operations-brief-pdf-report.md`, and `output/pdf/hospital-operations-module-brief-report.pdf` for the two-page on-site delivery brief and PDF artifact checks.",
    "",
    "## Full process audit report",
    "",
    "See `process-audit-report.json` and `process-audit-report.md` for resident, chronic disease, county consortium, insurance, statistics, certificate, security, and cutover process evidence.",
    "",
    "## Site readiness pack",
    "",
    "See `site-readiness-pack.json` and `site-readiness-pack.md` for identity source mapping, interface joint-test, monitoring/on-call, production signoff templates, and the platform policy source rule.",
    "",
    "## Priority application pilot acceptance readiness",
    "",
    "See `pilot-acceptance-readiness-report.json` and `pilot-acceptance-readiness-report.md` for the eight-application regression matrix, production alerting preflight, P0-01 through P0-10 onsite task pack, four synthetic joint-test samples, end-to-end trial run and issue ledger.",
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
    "## Regional data sharing and referral overlap report",
    "",
    "See `regional-data-sharing-report.json`, `regional-data-sharing-report.md`, `regional-referral-overlap-report.json`, and `regional-referral-overlap-report.md` for shared clinical evidence, referral handoff readiness, ownership boundaries, and the explicit no-runtime-merge decision.",
    "",
    "## Internet nursing readiness report",
    "",
    "See `internet-nursing-readiness-report.json`, `internet-nursing-readiness-report.md`, and `docs/internet-nursing-highlight-center.md` for resident appointment, hospital assessment and dispatch, nurse acceptance, location trace, service record, quality callback, policy evidence, and the 10-highlight innovation center.",
    "",
    "## Citizen launch foundation readiness report",
    "",
    "See `citizen-launch-foundation-readiness.json` and `citizen-launch-foundation-readiness.md` for resident phone-code delivery, PWA/app shell refresh, mini-program/app routing, copyable C-end pipeline acceptance checklist, and production SMS, real-name, guardian, HTTPS, signing, push, and monitoring dependencies with owners, blockers, evidence, and onsite acceptance.",
    "",
    "## Citizen health record readiness report",
    "",
    "See `citizen-records-readiness-report.json` and `citizen-records-readiness-report.md` for T04 resident projection, fail-closed authorization, care workspace routes, PWA cache integration, and unresolved production identity, clinical connector, storage, audit, legal, signoff, and TLS blockers.",
    "",
    "## Registration and referral acceptance report",
    "",
    "See `registration-referral-acceptance-report.json` and `registration-referral-acceptance-report.md` for T05 registration, bidirectional referral, material supplementation, family-doctor scheduling, idempotent command, event hash-chain, T00 integration, and retained site blockers.",
    "",
    "## Production database readiness report",
    "",
    "See `production-db-readiness-report.json`, `production-db-readiness-report.md`, and `postgres-migration-package/manifest.json` for PostgreSQL cutover prerequisites, current SQLite/JSON model evidence, payload-free migration counts and digests, backup rehearsal documentation, and runtime adapter guardrails.",
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
    "## Production deployment package",
    "",
    "See `production-deployment-package.json` and `production-deployment-package.md` for immutable runtime file hashes, the aggregate artifact digest, secret-reference boundary, process health contract, integrity verification and rollback prerequisites.",
    "",
    "## Health dashboard summary",
    "",
    "See `health-dashboard-summary.json` and `health-dashboard-summary.md` for the aggregate entry across the first seven applications, open actions, interface tracks, evidence, and site dependencies.",
    "`GET /api/priority-applications/templates` exposes the live eight-application handoff templates for independent conversation work.",
    "See `priority-application-templates.json` and `priority-application-templates.md` for the standalone release artifact version of that handoff contract.",
    "See `maternal-child-readiness-report.json` and `maternal-child-readiness-report.md` for maternal-child policy, birth certificate workflow, role scope, API, privacy, and release evidence.",
    "See `immunization-readiness-report.json` and `immunization-readiness-report.md` for 2026 immunization rules, special health-state decision support, launch blockers, evidence ledger and production go-live boundary.",
    "See `public-health-readiness-report.json` and `public-health-readiness-report.md` for the 21/125/421 public-health standard matrix, institution scopes, event loop, exchange tasks, cutover blockers, API, and release evidence.",
    "See `public-health-final-readiness-report.json` and `public-health-final-readiness-report.md` for eight-lane coordination, signed outbox callbacks, worker leases, full keyring rotation verification, server-bound endpoint probe receipts, controlled active DNS/TLS probes, independently signed continuity campaigns, emergency-revocation quarantine, and the retained production boundary.",
    "See `quality-operations-governance-readiness-report.json` and `quality-operations-governance-readiness-report.md` for the unified quality rectification, resource dispatch, and drug-consumable governance contract, scoped read APIs, idempotent writes, audit persistence, and retained production blockers.",
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
    const chronicInformatizationSourcesJson = path.join(path.dirname(output), "chronic-informatization-sources.json");
    fs.writeFileSync(chronicInformatizationSourcesJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      chronicInformatizationSources: report.chronicInformatizationSources
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
    const platformProductionAuditJson = path.join(path.dirname(output), "platform-production-audit.json");
    fs.writeFileSync(platformProductionAuditJson, JSON.stringify(report.platformProductionAudit, null, 2), "utf8");
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
    const productionSecurityJson = path.join(path.dirname(output), "production-security-readiness-report.json");
    fs.writeFileSync(productionSecurityJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      productionSecurity: report.productionSecurity
    }, null, 2), "utf8");
    const productionGoNoGoJson = path.join(path.dirname(output), "production-go-no-go-readiness-report.json");
    fs.writeFileSync(productionGoNoGoJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      productionGoNoGo: report.productionGoNoGo
    }, null, 2), "utf8");
    const productionReleaseEvidenceJson = path.join(path.dirname(output), "production-release-evidence-readiness.json");
    fs.writeFileSync(productionReleaseEvidenceJson, JSON.stringify(report.productionReleaseEvidenceReadiness, null, 2), "utf8");
    const pilotAcceptanceJson = path.join(path.dirname(output), "pilot-acceptance-readiness-report.json");
    fs.writeFileSync(pilotAcceptanceJson, JSON.stringify(report.pilotAcceptance, null, 2), "utf8");
    const qualitySafetyJson = path.join(path.dirname(output), "quality-safety-report.json");
    fs.writeFileSync(qualitySafetyJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      qualitySafety: report.qualitySafety
    }, null, 2), "utf8");
    const qualitySafetyInterfaceJson = path.join(path.dirname(output), "quality-safety-interface-standard.json");
    fs.writeFileSync(qualitySafetyInterfaceJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      qualitySafetyInterfaceStandard: report.qualitySafetyInterfaceStandard
    }, null, 2), "utf8");
    const qualitySafetyJointTestJson = path.join(path.dirname(output), "quality-safety-interface-joint-test-pack.json");
    fs.writeFileSync(qualitySafetyJointTestJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      qualitySafetyInterfaceJointTest: report.qualitySafetyInterfaceJointTest
    }, null, 2), "utf8");
    const qualityOperationsGovernanceJson = path.join(path.dirname(output), "quality-operations-governance-readiness-report.json");
    fs.writeFileSync(qualityOperationsGovernanceJson, JSON.stringify(report.qualityOperationsGovernance, null, 2), "utf8");
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
    const regionalReferralOverlapJson = path.join(path.dirname(output), "regional-referral-overlap-report.json");
    fs.writeFileSync(regionalReferralOverlapJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      regionalReferralOverlap: report.regionalReferralOverlap
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
    const hospitalOperationsReleaseJson = path.join(path.dirname(output), "hospital-operations-release-report.json");
    fs.writeFileSync(hospitalOperationsReleaseJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      hospitalOperationsRelease: report.hospitalOperationsRelease
    }, null, 2), "utf8");
    const hospitalOperationsModuleJson = path.join(path.dirname(output), "hospital-operations-module-report.json");
    fs.writeFileSync(hospitalOperationsModuleJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      hospitalOperationsModule: report.hospitalOperationsModule
    }, null, 2), "utf8");
    const hospitalOperationsBriefPdfJson = path.join(path.dirname(output), "hospital-operations-brief-pdf-report.json");
    fs.writeFileSync(hospitalOperationsBriefPdfJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      hospitalOperationsBriefPdf: report.hospitalOperationsBriefPdf
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
    const objectStorageJson = path.join(path.dirname(output), "object-storage-readiness-report.json");
    fs.writeFileSync(objectStorageJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      objectStorageReadiness: report.objectStorageReadiness
    }, null, 2), "utf8");
    const financialGatewayJson = path.join(path.dirname(output), "financial-gateway-readiness-report.json");
    fs.writeFileSync(financialGatewayJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      financialGatewayReadiness: report.financialGatewayReadiness
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
    const careServiceProductionJson = path.join(path.dirname(output), "care-service-production-readiness.json");
    fs.writeFileSync(careServiceProductionJson, JSON.stringify(report.careServiceProductionReadiness, null, 2), "utf8");
    const digitalHospitalPilotJson = path.join(path.dirname(output), "digital-hospital-pilot-readiness-report.json");
    fs.writeFileSync(digitalHospitalPilotJson, JSON.stringify(report.digitalHospitalPilot, null, 2), "utf8");
    const emergencyReadinessJson = path.join(path.dirname(output), "emergency-readiness-report.json");
    fs.writeFileSync(emergencyReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      emergencyReadiness: report.emergencyReadiness
    }, null, 2), "utf8");
    const specialtyCutoverJson = path.join(path.dirname(output), "t10-specialty-cutover-pack.json");
    fs.writeFileSync(specialtyCutoverJson, JSON.stringify(report.specialtyCutover, null, 2), "utf8");
    const citizenLaunchFoundationJson = path.join(path.dirname(output), "citizen-launch-foundation-readiness.json");
    fs.writeFileSync(citizenLaunchFoundationJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      citizenLaunchFoundation: report.citizenLaunchFoundation
    }, null, 2), "utf8");
    const citizenRecordsJson = path.join(path.dirname(output), "citizen-records-readiness-report.json");
    fs.writeFileSync(citizenRecordsJson, JSON.stringify(report.citizenRecords, null, 2), "utf8");
    const registrationReferralAcceptanceJson = path.join(path.dirname(output), "registration-referral-acceptance-report.json");
    fs.writeFileSync(registrationReferralAcceptanceJson, JSON.stringify(report.registrationReferralAcceptance, null, 2), "utf8");
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
    const productionDeploymentPackageJson = path.join(path.dirname(output), "production-deployment-package.json");
    fs.writeFileSync(productionDeploymentPackageJson, JSON.stringify(report.productionDeploymentPackage, null, 2), "utf8");
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
    const immunizationReadinessJson = path.join(path.dirname(output), "immunization-readiness-report.json");
    fs.writeFileSync(immunizationReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      immunizationReadiness: report.immunizationReadiness
    }, null, 2), "utf8");
    const publicHealthReadinessJson = path.join(path.dirname(output), "public-health-readiness-report.json");
    fs.writeFileSync(publicHealthReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      publicHealthReadiness: report.publicHealthReadiness
    }, null, 2), "utf8");
    const publicHealthHighlightsReadinessJson = path.join(path.dirname(output), "public-health-highlights-readiness-report.json");
    fs.writeFileSync(publicHealthHighlightsReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      publicHealthHighlightsReadiness: report.publicHealthHighlightsReadiness
    }, null, 2), "utf8");
    const publicHealthFinalReadinessJson = path.join(path.dirname(output), "public-health-final-readiness-report.json");
    fs.writeFileSync(publicHealthFinalReadinessJson, JSON.stringify(report.publicHealthFinalReadiness, null, 2), "utf8");
    const bloodSystemReadinessJson = path.join(path.dirname(output), "blood-system-readiness-report.json");
    fs.writeFileSync(bloodSystemReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      bloodSystemReadiness: report.bloodSystemReadiness
    }, null, 2), "utf8");
    const policyCoverageJson = path.join(path.dirname(output), "policy-coverage-report.json");
    fs.writeFileSync(policyCoverageJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      policyCoverage: report.policyCoverage
    }, null, 2), "utf8");
    const diseasePaymentReadinessJson = path.join(path.dirname(output), "disease-payment-readiness-report.json");
    fs.writeFileSync(diseasePaymentReadinessJson, JSON.stringify({
      project: report.project,
      version: report.version,
      profile: report.profile,
      generatedAt: report.generatedAt,
      diseasePaymentReadiness: report.diseasePaymentReadiness
    }, null, 2), "utf8");
    const insurancePaymentAcceptanceJson = path.join(path.dirname(output), "insurance-payment-acceptance-report.json");
    fs.writeFileSync(insurancePaymentAcceptanceJson, JSON.stringify(report.insurancePaymentAcceptance, null, 2), "utf8");
    const insurancePaymentEvidenceJson = path.join(path.dirname(output), "insurance-payment-evidence-packet.json");
    fs.writeFileSync(insurancePaymentEvidenceJson, JSON.stringify(report.insurancePaymentEvidencePacket, null, 2), "utf8");
    const platformCapabilityMapJson = path.join(path.dirname(output), "platform-capability-map.json");
    fs.writeFileSync(platformCapabilityMapJson, JSON.stringify(report.platformCapabilityMap, null, 2), "utf8");
    const platformGoLiveSlicesJson = path.join(path.dirname(output), "platform-go-live-slices.json");
    fs.writeFileSync(platformGoLiveSlicesJson, JSON.stringify(report.platformGoLiveSlices, null, 2), "utf8");
    const platformStandardsLedgersJson = path.join(path.dirname(output), "platform-standards-ledgers.json");
    fs.writeFileSync(platformStandardsLedgersJson, JSON.stringify(report.platformStandardsLedgers, null, 2), "utf8");
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
    const chronicInformatizationSourcesMarkdown = path.join(path.dirname(markdown), "chronic-informatization-sources.md");
    fs.writeFileSync(chronicInformatizationSourcesMarkdown, renderChronicInformatizationSourceMarkdown(report.chronicInformatizationSources), "utf8");
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
    const digitalHospitalPilotMarkdown = path.join(path.dirname(markdown), "digital-hospital-pilot-readiness-report.md");
    fs.writeFileSync(digitalHospitalPilotMarkdown, renderDigitalHospitalPilotMarkdown(report.digitalHospitalPilot), "utf8");
    const platformProductionAuditMarkdown = path.join(path.dirname(markdown), "platform-production-audit.md");
    fs.writeFileSync(platformProductionAuditMarkdown, renderPlatformProductionAuditMarkdown(report.platformProductionAudit), "utf8");
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
    const productionSecurityMarkdown = path.join(path.dirname(markdown), "production-security-readiness-report.md");
    fs.writeFileSync(productionSecurityMarkdown, renderProductionSecurityMarkdown(report.productionSecurity), "utf8");
    const productionGoNoGoMarkdown = path.join(path.dirname(markdown), "production-go-no-go-readiness-report.md");
    fs.writeFileSync(productionGoNoGoMarkdown, renderProductionGoNoGoMarkdown(report.productionGoNoGo), "utf8");
    const productionReleaseEvidenceMarkdown = path.join(path.dirname(markdown), "production-release-evidence-readiness.md");
    fs.writeFileSync(productionReleaseEvidenceMarkdown, renderProductionReleaseEvidenceMarkdown(report.productionReleaseEvidenceReadiness), "utf8");
    const pilotAcceptanceMarkdown = path.join(path.dirname(markdown), "pilot-acceptance-readiness-report.md");
    fs.writeFileSync(pilotAcceptanceMarkdown, renderPilotAcceptanceMarkdown(report.pilotAcceptance), "utf8");
    const qualitySafetyMarkdown = path.join(path.dirname(markdown), "quality-safety-report.md");
    fs.writeFileSync(qualitySafetyMarkdown, renderQualitySafetyMarkdown(report.qualitySafety), "utf8");
    const qualitySafetyInterfaceMarkdown = path.join(path.dirname(markdown), "quality-safety-interface-standard.md");
    fs.writeFileSync(qualitySafetyInterfaceMarkdown, renderQualitySafetyInterfaceStandardMarkdown(report.qualitySafetyInterfaceStandard), "utf8");
    const qualitySafetyJointTestMarkdown = path.join(path.dirname(markdown), "quality-safety-interface-joint-test-pack.md");
    fs.writeFileSync(qualitySafetyJointTestMarkdown, renderQualitySafetyInterfaceJointTestMarkdown(report.qualitySafetyInterfaceJointTest), "utf8");
    const qualityOperationsGovernanceMarkdown = path.join(path.dirname(markdown), "quality-operations-governance-readiness-report.md");
    fs.writeFileSync(qualityOperationsGovernanceMarkdown, renderQualityOperationsGovernanceMarkdown(report.qualityOperationsGovernance), "utf8");
    const integrationMarkdown = path.join(path.dirname(markdown), "integration-readiness-report.md");
    fs.writeFileSync(integrationMarkdown, renderIntegrationReadinessMarkdown(report.integrationReadiness), "utf8");
    const objectStorageMarkdown = path.join(path.dirname(markdown), "object-storage-readiness-report.md");
    fs.writeFileSync(objectStorageMarkdown, renderObjectStorageMarkdown(report.objectStorageReadiness), "utf8");
    const financialGatewayMarkdown = path.join(path.dirname(markdown), "financial-gateway-readiness-report.md");
    fs.writeFileSync(financialGatewayMarkdown, renderFinancialGatewayMarkdown(report.financialGatewayReadiness), "utf8");
    const interfaceMappingMarkdown = path.join(path.dirname(markdown), "interface-mapping-report.md");
    fs.writeFileSync(interfaceMappingMarkdown, renderInterfaceMappingMarkdown(report.interfaceMapping), "utf8");
    const regionalDataSharingMarkdown = path.join(path.dirname(markdown), "regional-data-sharing-report.md");
    fs.writeFileSync(regionalDataSharingMarkdown, renderRegionalDataSharingMarkdown(report.regionalDataSharing), "utf8");
    const regionalReferralOverlapMarkdown = path.join(path.dirname(markdown), "regional-referral-overlap-report.md");
    fs.writeFileSync(regionalReferralOverlapMarkdown, renderRegionalReferralOverlapMarkdown(report.regionalReferralOverlap), "utf8");
    const drugConsumableMarkdown = path.join(path.dirname(markdown), "drug-consumable-readiness-report.md");
    fs.writeFileSync(drugConsumableMarkdown, renderDrugConsumableMarkdown(report.drugConsumable), "utf8");
    const researchSandboxMarkdown = path.join(path.dirname(markdown), "research-sandbox-readiness-report.md");
    fs.writeFileSync(researchSandboxMarkdown, renderResearchSandboxMarkdown(report.researchSandbox), "utf8");
    const operationsMarkdown = path.join(path.dirname(markdown), "operations-readiness-report.md");
    fs.writeFileSync(operationsMarkdown, renderOperationsReadinessMarkdown(report.operationsReadiness), "utf8");
    const hospitalOperationsMarkdown = path.join(path.dirname(markdown), "hospital-operations-readiness-report.md");
    fs.writeFileSync(hospitalOperationsMarkdown, renderHospitalOperationsReadinessMarkdown(report.hospitalOperationsReadiness), "utf8");
    const hospitalOperationsReleaseMarkdown = path.join(path.dirname(markdown), "hospital-operations-release-report.md");
    fs.writeFileSync(hospitalOperationsReleaseMarkdown, renderHospitalOperationsReleaseMarkdown(report.hospitalOperationsRelease), "utf8");
    const hospitalOperationsModuleMarkdown = path.join(path.dirname(markdown), "hospital-operations-module-report.md");
    fs.writeFileSync(hospitalOperationsModuleMarkdown, renderHospitalOperationsModuleMarkdown(report.hospitalOperationsModule), "utf8");
    const hospitalOperationsBriefPdfMarkdown = path.join(path.dirname(markdown), "hospital-operations-brief-pdf-report.md");
    fs.writeFileSync(hospitalOperationsBriefPdfMarkdown, renderHospitalOperationsBriefPdfMarkdown(report.hospitalOperationsBriefPdf), "utf8");
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
    const careServiceProductionMarkdown = path.join(path.dirname(markdown), "care-service-production-readiness.md");
    fs.writeFileSync(careServiceProductionMarkdown, renderCareServiceProductionReadinessMarkdown(report.careServiceProductionReadiness), "utf8");
    const emergencyReadinessMarkdown = path.join(path.dirname(markdown), "emergency-readiness-report.md");
    fs.writeFileSync(emergencyReadinessMarkdown, renderEmergencyReadinessMarkdown(report.emergencyReadiness), "utf8");
    const specialtyCutoverMarkdown = path.join(path.dirname(markdown), "t10-specialty-cutover-pack.md");
    fs.writeFileSync(specialtyCutoverMarkdown, renderSpecialtyCutoverMarkdown(report.specialtyCutover), "utf8");
    const citizenLaunchFoundationMarkdown = path.join(path.dirname(markdown), "citizen-launch-foundation-readiness.md");
    fs.writeFileSync(citizenLaunchFoundationMarkdown, renderCitizenLaunchFoundationMarkdown(report.citizenLaunchFoundation), "utf8");
    const citizenRecordsMarkdown = path.join(path.dirname(markdown), "citizen-records-readiness-report.md");
    fs.writeFileSync(citizenRecordsMarkdown, renderCitizenRecordsMarkdown(report.citizenRecords), "utf8");
    const registrationReferralAcceptanceMarkdown = path.join(path.dirname(markdown), "registration-referral-acceptance-report.md");
    fs.writeFileSync(registrationReferralAcceptanceMarkdown, renderRegistrationReferralAcceptanceMarkdown(report.registrationReferralAcceptance), "utf8");
    const productionDbMarkdown = path.join(path.dirname(markdown), "production-db-readiness-report.md");
    fs.writeFileSync(productionDbMarkdown, renderProductionDbReadinessMarkdown(report.productionDbReadiness), "utf8");
    const evaluationMarkdown = path.join(path.dirname(markdown), "evaluation-evidence-report.md");
    fs.writeFileSync(evaluationMarkdown, renderEvaluationEvidenceMarkdown(report.evaluationEvidence), "utf8");
    const environmentMarkdown = path.join(path.dirname(markdown), "environment-matrix-report.md");
    fs.writeFileSync(environmentMarkdown, renderEnvironmentMatrixMarkdown(report.environmentMatrix), "utf8");
    const hybridDeploymentMarkdown = path.join(path.dirname(markdown), "hybrid-deployment-readiness-report.md");
    fs.writeFileSync(hybridDeploymentMarkdown, renderHybridDeploymentMarkdown(report.hybridDeploymentReadiness), "utf8");
    const productionDeploymentPackageMarkdown = path.join(path.dirname(markdown), "production-deployment-package.md");
    fs.writeFileSync(productionDeploymentPackageMarkdown, renderProductionDeploymentMarkdown(report.productionDeploymentPackage, report.productionDeploymentPackage.verification), "utf8");
    const healthDashboardMarkdown = path.join(path.dirname(markdown), "health-dashboard-summary.md");
    fs.writeFileSync(healthDashboardMarkdown, renderHealthDashboardMarkdown(report.healthDashboard), "utf8");
    const priorityApplicationTemplatesMarkdown = path.join(path.dirname(markdown), "priority-application-templates.md");
    fs.writeFileSync(priorityApplicationTemplatesMarkdown, renderPriorityApplicationTemplatesMarkdown(report.priorityApplicationTemplates), "utf8");
    const maternalChildReadinessMarkdown = path.join(path.dirname(markdown), "maternal-child-readiness-report.md");
    fs.writeFileSync(maternalChildReadinessMarkdown, renderMaternalChildReadinessMarkdown(report.maternalChildReadiness), "utf8");
    const immunizationReadinessMarkdown = path.join(path.dirname(markdown), "immunization-readiness-report.md");
    fs.writeFileSync(immunizationReadinessMarkdown, renderImmunizationReadinessMarkdown(report.immunizationReadiness), "utf8");
    const publicHealthReadinessMarkdown = path.join(path.dirname(markdown), "public-health-readiness-report.md");
    fs.writeFileSync(publicHealthReadinessMarkdown, renderPublicHealthMarkdown(report.publicHealthReadiness), "utf8");
    const publicHealthHighlightsReadinessMarkdown = path.join(path.dirname(markdown), "public-health-highlights-readiness-report.md");
    fs.writeFileSync(publicHealthHighlightsReadinessMarkdown, renderPublicHealthHighlightsMarkdown(report.publicHealthHighlightsReadiness), "utf8");
    const publicHealthFinalReadinessMarkdown = path.join(path.dirname(markdown), "public-health-final-readiness-report.md");
    fs.writeFileSync(publicHealthFinalReadinessMarkdown, renderPublicHealthFinalMarkdown(report.publicHealthFinalReadiness), "utf8");
    const bloodSystemReadinessMarkdown = path.join(path.dirname(markdown), "blood-system-readiness-report.md");
    fs.writeFileSync(bloodSystemReadinessMarkdown, renderBloodSystemMarkdown(report.bloodSystemReadiness), "utf8");
    const diseasePaymentReadinessMarkdown = path.join(path.dirname(markdown), "disease-payment-readiness-report.md");
    fs.writeFileSync(diseasePaymentReadinessMarkdown, renderDiseasePaymentMarkdown(report.diseasePaymentReadiness), "utf8");
    const insurancePaymentAcceptanceMarkdown = path.join(path.dirname(markdown), "insurance-payment-acceptance-report.md");
    fs.writeFileSync(insurancePaymentAcceptanceMarkdown, renderInsurancePaymentAcceptanceMarkdown(report.insurancePaymentAcceptance), "utf8");
    const insurancePaymentEvidenceMarkdown = path.join(path.dirname(markdown), "insurance-payment-evidence-packet.md");
    fs.writeFileSync(insurancePaymentEvidenceMarkdown, renderInsurancePaymentEvidenceMarkdown(report.insurancePaymentEvidencePacket), "utf8");
    const policyCoverageMarkdown = path.join(path.dirname(markdown), "policy-coverage-report.md");
    fs.writeFileSync(policyCoverageMarkdown, renderPolicyCoverageMarkdown(report.policyCoverage), "utf8");
    const platformCapabilityMapMarkdown = path.join(path.dirname(markdown), "platform-capability-map.md");
    fs.writeFileSync(platformCapabilityMapMarkdown, renderCapabilityMapMarkdown(report.platformCapabilityMap), "utf8");
    const platformGoLiveSlicesMarkdown = path.join(path.dirname(markdown), "platform-go-live-slices.md");
    fs.writeFileSync(platformGoLiveSlicesMarkdown, renderPlatformGoLiveSlicesMarkdown(report.platformGoLiveSlices), "utf8");
    const platformStandardsLedgersMarkdown = path.join(path.dirname(markdown), "platform-standards-ledgers.md");
    fs.writeFileSync(platformStandardsLedgersMarkdown, renderPlatformStandardsLedgersMarkdown(report.platformStandardsLedgers), "utf8");
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
