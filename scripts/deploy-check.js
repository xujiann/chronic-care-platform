#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  buildProductionDeploymentPackage,
  verifyProductionDeploymentPackage
} = require("./production-deployment-package");
const { buildPostgresMigrationPackage } = require("./postgres-migration-package");

const ROOT = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function run(command, args) {
  const commandLine = [command, ...args].join(" ");
  const result = process.platform === "win32"
    ? spawnSync(commandLine, { cwd: ROOT, stdio: "pipe", shell: true, encoding: "utf8" })
    : spawnSync(command, args, { cwd: ROOT, stdio: "pipe", shell: false, encoding: "utf8" });
  return {
    command: commandLine,
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function assertFile(relativePath) {
  const file = path.join(ROOT, relativePath);
  return { name: `file:${relativePath}`, ok: fs.existsSync(file), detail: fs.existsSync(file) ? "present" : "missing" };
}

function buildDeployCheckReport(options = {}) {
  const pkg = readJson("package.json");
  const data = readJson("data/db.json");
  const requiredCollections = [
    "residents",
    "authUsers",
    "platformRoadmap",
    "platformInterfaces",
    "institutionCreditEvaluations",
    "creditEvaluationRules",
    "researchDatasets",
    "diseaseRegistryModels",
    "qualitySafetyEvents",
    "qualityRectificationOrders",
    "drugConsumableSupervisions",
    "dataAccessLogs",
    "mobileExperienceSettings",
    "accessibilityChecklist",
    "regionalDataSharingScope",
    "regionalSharingPackages",
    "regionalSharingSnapshots",
    "regionalSharingAccessReviews",
    "securityAcceptanceLedger",
    "commercialCryptoCapabilities",
    "commercialCryptoProbeRuns",
    "commercialCryptoEvidencePackets",
    "hospitalOperationSnapshots",
    "resourceDispatchRequests",
    "statisticsReconciliationReviews",
    "operationAlertRules",
    "productionServiceLevels",
    "operationsDutyShifts",
    "operationsIncidents",
    "disasterRecoveryDrills",
    "operationsEvidencePackets",
    "publicHealthStandards",
    "publicHealthInstitutionScopes",
    "publicHealthEvents",
    "publicHealthExchangeTasks",
    "publicHealthExchangeRuns",
    "publicHealthInstitutionTasks",
    "publicHealthOnsiteAcceptances",
    "publicHealthCutoverBlockers",
    "publicHealthCutoverEvidencePackets",
    "publicHealthCutoverDrills",
    "publicHealthProductionHandoffs",
    "publicHealthGoLiveObservations",
    "publicHealthLaunchIncidents",
    "publicHealthLaunchDutyShifts",
    "publicHealthLaunchCommandBriefs",
    "publicHealthSiteEvidenceVerificationTasks",
    "publicHealthLaunchApprovals",
    "publicHealthReadinessEvidence",
    "chronicFollowupStatusPolicy",
    "escortServicePolicy",
    "escortServiceProviders",
    "escortWorkers",
    "escortServiceOrders",
    "internetNursingPolicy",
    "internetNursingInstitutions",
    "internetNursingNurses",
    "internetNursingOrders",
    "citizenOperationContents",
    "citizenAgreementVersions",
    "citizenIdentityReviewCases",
    "citizenServiceBlacklist",
    "citizenHospitalServiceConfigs",
    "doctorProfiles",
    "multiPracticePolicy",
    "multiPracticeApplications",
    "healthDashboardSnapshots",
    "observabilityAlertDeliveries"
  ];
  const p0Interfaces = (Array.isArray(data.platformInterfaces) ? data.platformInterfaces : []).filter((item) => item.priority === "P0");
  const securityAcceptanceLedger = Array.isArray(data.securityAcceptanceLedger) ? data.securityAcceptanceLedger : [];
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const envTemplateSource = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const deploymentSource = fs.readFileSync(path.join(ROOT, "DEPLOYMENT.md"), "utf8");
  const publicHealthSource = fs.readFileSync(path.join(ROOT, "scripts", "public-health-readiness.js"), "utf8");
  const digitalHospitalStandardsSource = fs.readFileSync(path.join(ROOT, "scripts", "digital-hospital-standards-readiness.js"), "utf8");
  const digitalHospitalStandardsHtml = fs.readFileSync(path.join(ROOT, "digital-hospital-standards.html"), "utf8");
  const digitalHospitalStandardsJs = fs.readFileSync(path.join(ROOT, "digital-hospital-standards.js"), "utf8");
  const healthDashboardSource = fs.readFileSync(path.join(ROOT, "scripts", "health-dashboard-summary.js"), "utf8");
  const healthDashboardHtml = fs.readFileSync(path.join(ROOT, "health-dashboard.html"), "utf8");
  const healthDashboardJs = fs.readFileSync(path.join(ROOT, "health-dashboard.js"), "utf8");
  const healthDashboardIndicatorDoc = fs.readFileSync(path.join(ROOT, "docs", "health-dashboard-indicator-center-report.md"), "utf8");
  const platformSource = fs.readFileSync(path.join(ROOT, "platform.js"), "utf8");
  const platformHtml = fs.readFileSync(path.join(ROOT, "platform.html"), "utf8");
  const citizenSource = fs.readFileSync(path.join(ROOT, "citizen.js"), "utf8");
  const citizenHtml = fs.readFileSync(path.join(ROOT, "citizen.html"), "utf8");
  const productionDatabaseCutoverDoc = fs.readFileSync(path.join(ROOT, "docs", "production-database-cutover-center.md"), "utf8");
  const postgresMigrationPackageSource = fs.readFileSync(path.join(ROOT, "scripts", "postgres-migration-package.js"), "utf8");
  const postgresMigrationPackageDoc = fs.readFileSync(path.join(ROOT, "docs", "postgresql-migration-package.md"), "utf8");
  const citizenOperationsDoc = fs.readFileSync(path.join(ROOT, "docs", "citizen-service-operations-center.md"), "utf8");
  const commercialCryptoDoc = fs.readFileSync(path.join(ROOT, "docs", "commercial-crypto-adapter-center.md"), "utf8");
  const productionOperationsDoc = fs.readFileSync(path.join(ROOT, "docs", "production-operations-run-center.md"), "utf8");
  const registrationJourneyDoc = fs.readFileSync(path.join(ROOT, "docs", "registration-journey-center.md"), "utf8");
  const registrationIntegrationDoc = fs.readFileSync(path.join(ROOT, "docs", "registration-integration-center.md"), "utf8");
  const operationsSource = fs.readFileSync(path.join(ROOT, "operations.js"), "utf8");
  const operationsHtml = fs.readFileSync(path.join(ROOT, "operations.html"), "utf8");
  const institutionSource = fs.readFileSync(path.join(ROOT, "institution.js"), "utf8");
  const institutionHtml = fs.readFileSync(path.join(ROOT, "institution.html"), "utf8");
  const manifestSource = fs.readFileSync(path.join(ROOT, "scripts", "release-artifact-manifest.js"), "utf8");
  const escortHospitalInterfaceDoc = fs.readFileSync(path.join(ROOT, "docs", "escort-hospital-interface.md"), "utf8");
  const internetNursingDoc = fs.readFileSync(path.join(ROOT, "docs", "互联网护理服务模块说明.md"), "utf8");
  const citizenProductionRequirementsDoc = fs.readFileSync(path.join(ROOT, "docs", "citizen-production-launch-requirements.md"), "utf8");
  const chronicLaunchCoreDoc = fs.readFileSync(path.join(ROOT, "docs", "chronic-launch-core.md"), "utf8");
  const platformResearchReportDoc = fs.readFileSync(path.join(ROOT, "docs", "卫生健康信息平台研发报告.md"), "utf8");
  const productionGoLiveRequirementsDoc = fs.readFileSync(path.join(ROOT, "docs", "production-go-live-requirements.md"), "utf8");
  const onsiteLaunchMaterialsDoc = fs.readFileSync(path.join(ROOT, "docs", "on-site-launch-materials.md"), "utf8");
  const publicHealthDoc = fs.readFileSync(path.join(ROOT, "docs", "公共卫生信息化系统建设报告.md"), "utf8");
  const publicHealthPlanDoc = fs.readFileSync(path.join(ROOT, "docs", "公共卫生信息化下一步开发计划.md"), "utf8");
  const phase2ProposalPlanDoc = fs.readFileSync(path.join(ROOT, "docs", "二期可研对标差距与下一步开发计划.md"), "utf8");
  const platformProductionAuditSource = fs.readFileSync(path.join(ROOT, "scripts", "platform-production-audit.js"), "utf8");
  const platformProductionAuditDoc = fs.readFileSync(path.join(ROOT, "docs", "数智医院标准平台全程审计与生产前开发规划.md"), "utf8");
  const platformDevelopmentReportDoc = fs.readFileSync(path.join(ROOT, "docs", "数智医院标准平台开发报告与下一步计划-2026-07-11.md"), "utf8");
  const productionAdaptersSource = fs.readFileSync(path.join(ROOT, "production-adapters.js"), "utf8");
  const productionAdaptersDoc = fs.readFileSync(path.join(ROOT, "docs", "production-identity-message-adapters.md"), "utf8");
  const hospitalConnectorsSource = fs.readFileSync(path.join(ROOT, "hospital-connectors.js"), "utf8");
  const hospitalConnectorsDoc = fs.readFileSync(path.join(ROOT, "docs", "production-hospital-connectors.md"), "utf8");
  const objectStorageSource = fs.readFileSync(path.join(ROOT, "secure-object-storage.js"), "utf8");
  const objectStorageReadiness = fs.readFileSync(path.join(ROOT, "scripts", "object-storage-readiness.js"), "utf8");
  const objectStorageDoc = fs.readFileSync(path.join(ROOT, "docs", "production-object-storage.md"), "utf8");
  const financialGatewaysSource = fs.readFileSync(path.join(ROOT, "financial-gateways.js"), "utf8");
  const financialGatewayReadiness = fs.readFileSync(path.join(ROOT, "scripts", "financial-gateway-readiness.js"), "utf8");
  const financialGatewaysDoc = fs.readFileSync(path.join(ROOT, "docs", "production-financial-certificate-gateways.md"), "utf8");
  const observabilityAlertingSource = fs.readFileSync(path.join(ROOT, "observability-alerting.js"), "utf8");
  const monitoringReadinessSource = fs.readFileSync(path.join(ROOT, "scripts", "monitoring-readiness.js"), "utf8");
  const observabilityAlertingDoc = fs.readFileSync(path.join(ROOT, "docs", "production-observability-alerting.md"), "utf8");
  const productionDeploymentPackageSource = fs.readFileSync(path.join(ROOT, "scripts", "production-deployment-package.js"), "utf8");
  const productionDeploymentDoc = fs.readFileSync(path.join(ROOT, "docs", "production-deployment-automation.md"), "utf8");
  const productionServiceTemplate = fs.readFileSync(path.join(ROOT, "deploy", "chronic-care-platform.service.template"), "utf8");
  const ciSource = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const productionDeploymentPackage = buildProductionDeploymentPackage();
  const productionDeploymentVerification = verifyProductionDeploymentPackage(productionDeploymentPackage);
  const postgresMigrationPackage = buildPostgresMigrationPackage({ data });
  const externalDependencyRiskIds = [
    "identity-source",
    "institution-systems",
    "insurance-core",
    "certificate-sharing",
    "security-assessment",
    "disaster-recovery"
  ];
  const checks = [
    assertFile("README.md"),
    assertFile("DEPLOYMENT.md"),
    assertFile("docs/production-go-live-requirements.md"),
    assertFile("docs/卫生健康信息平台研发报告.md"),
    assertFile("docs/on-site-launch-materials.md"),
    assertFile("data/db.json"),
    assertFile("server.js"),
    assertFile("production-adapters.js"),
    assertFile("docs/production-identity-message-adapters.md"),
    assertFile("hospital-connectors.js"),
    assertFile("docs/production-hospital-connectors.md"),
    assertFile("secure-object-storage.js"),
    assertFile("scripts/object-storage-readiness.js"),
    assertFile("docs/production-object-storage.md"),
    assertFile("financial-gateways.js"),
    assertFile("scripts/financial-gateway-readiness.js"),
    assertFile("docs/production-financial-certificate-gateways.md"),
    assertFile("observability-alerting.js"),
    assertFile("scripts/monitoring-readiness.js"),
    assertFile("docs/production-observability-alerting.md"),
    assertFile("scripts/postgres-migration-package.js"),
    assertFile("docs/postgresql-migration-package.md"),
    assertFile("scripts/production-deployment-package.js"),
    assertFile("docs/production-deployment-automation.md"),
    assertFile("deploy/chronic-care-platform.service.template"),
    assertFile("docs/citizen-production-launch-requirements.md"),
    assertFile("docs/escort-hospital-interface.md"),
    assertFile("scripts/onsite-launch-requirements.js"),
    assertFile("scripts/storage-admin.js"),
    assertFile("scripts/hybrid-deployment-readiness.js"),
    assertFile("scripts/data-governance-readiness.js"),
    assertFile("scripts/digital-hospital-standards-readiness.js"),
    assertFile("scripts/phase2-proposal-readiness.js"),
    assertFile("scripts/phase2-catalog-readiness.js"),
    assertFile("scripts/phase2-joint-test-readiness.js"),
    assertFile("scripts/phase2-mutual-recognition-readiness.js"),
    assertFile("scripts/phase2-disease-reporting-readiness.js"),
    assertFile("scripts/phase2-clinical-assist-readiness.js"),
    assertFile("scripts/phase2-family-doctor-readiness.js"),
    assertFile("scripts/citizen-operations-readiness.js"),
    assertFile("scripts/commercial-crypto-readiness.js"),
    assertFile("scripts/registration-journey-readiness.js"),
    assertFile("scripts/registration-integration-readiness.js"),
    assertFile("scripts/platform-production-audit.js"),
    assertFile("scripts/public-health-readiness.js"),
    assertFile("docs/二期可研对标差距与下一步开发计划.md"),
    assertFile("docs/数智医院标准平台研发报告.md"),
    assertFile("docs/公共卫生信息化下一步开发计划.md"),
    assertFile("docs/health-dashboard-indicator-center-report.md"),
    assertFile("docs/production-database-cutover-center.md"),
    assertFile("docs/citizen-service-operations-center.md"),
    assertFile("docs/commercial-crypto-adapter-center.md"),
    assertFile("docs/production-operations-run-center.md"),
    assertFile("docs/registration-journey-center.md"),
    assertFile("docs/registration-integration-center.md"),
    assertFile("docs/数智医院标准平台全程审计与生产前开发规划.md"),
    assertFile("docs/数智医院标准平台开发报告与下一步计划-2026-07-11.md"),
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["launch:smoke"] && pkg.scripts?.["onsite:launch-requirements"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["quality-safety:report"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["hospital-operations:readiness"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["regional-data-sharing:report"] && pkg.scripts?.["referral:readiness"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["drug-consumable:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["chronic:followup-readiness"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    assertFile("scripts/research-sandbox-readiness.js"),
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["research:sandbox"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["health-dashboard:summary"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:priorityApplicationTemplates", ok: Boolean(pkg.scripts?.["priority-apps:templates"]), detail: pkg.scripts?.["priority-apps:templates"] || "missing" },
    { name: "package:policyCoverage", ok: Boolean(pkg.scripts?.["policy:coverage"]), detail: pkg.scripts?.["policy:coverage"] || "missing" },
    { name: "package:maternalChildReadiness", ok: Boolean(pkg.scripts?.["maternal-child:readiness"]), detail: pkg.scripts?.["maternal-child:readiness"] || "missing" },
    { name: "package:publicHealthReadiness", ok: Boolean(pkg.scripts?.["public-health:readiness"]), detail: pkg.scripts?.["public-health:readiness"] || "missing" },
    { name: "package:digitalHospitalStandards", ok: Boolean(pkg.scripts?.["digital-hospital:standards-readiness"]), detail: pkg.scripts?.["digital-hospital:standards-readiness"] || "missing" },
    { name: "package:phase2ProposalReadiness", ok: Boolean(pkg.scripts?.["phase2:proposal-readiness"]), detail: pkg.scripts?.["phase2:proposal-readiness"] || "missing" },
    { name: "package:phase2CatalogReadiness", ok: Boolean(pkg.scripts?.["phase2:catalog-readiness"]), detail: pkg.scripts?.["phase2:catalog-readiness"] || "missing" },
    { name: "package:phase2JointTestReadiness", ok: Boolean(pkg.scripts?.["phase2:joint-test-readiness"]), detail: pkg.scripts?.["phase2:joint-test-readiness"] || "missing" },
    { name: "package:phase2MutualRecognitionReadiness", ok: Boolean(pkg.scripts?.["phase2:mutual-recognition-readiness"]), detail: pkg.scripts?.["phase2:mutual-recognition-readiness"] || "missing" },
    { name: "package:phase2DiseaseReportingReadiness", ok: Boolean(pkg.scripts?.["phase2:disease-reporting-readiness"]), detail: pkg.scripts?.["phase2:disease-reporting-readiness"] || "missing" },
    { name: "package:phase2ClinicalAssistReadiness", ok: Boolean(pkg.scripts?.["phase2:clinical-assist-readiness"]), detail: pkg.scripts?.["phase2:clinical-assist-readiness"] || "missing" },
    { name: "package:phase2FamilyDoctorReadiness", ok: Boolean(pkg.scripts?.["phase2:family-doctor-readiness"]), detail: pkg.scripts?.["phase2:family-doctor-readiness"] || "missing" },
    { name: "package:citizenOperationsReadiness", ok: Boolean(pkg.scripts?.["phase2:citizen-operations-readiness"]), detail: pkg.scripts?.["phase2:citizen-operations-readiness"] || "missing" },
    { name: "package:commercialCryptoReadiness", ok: Boolean(pkg.scripts?.["security:commercial-crypto-readiness"]), detail: pkg.scripts?.["security:commercial-crypto-readiness"] || "missing" },
    { name: "package:registrationJourneyReadiness", ok: Boolean(pkg.scripts?.["registration:journey-readiness"]), detail: pkg.scripts?.["registration:journey-readiness"] || "missing" },
    { name: "package:registrationIntegrationReadiness", ok: Boolean(pkg.scripts?.["registration:integration-readiness"]), detail: pkg.scripts?.["registration:integration-readiness"] || "missing" },
    { name: "package:platformProductionAudit", ok: Boolean(pkg.scripts?.["platform:production-audit"]), detail: pkg.scripts?.["platform:production-audit"] || "missing" },
    { name: "package:objectStorageReadiness", ok: Boolean(pkg.scripts?.["object-storage:readiness"]), detail: pkg.scripts?.["object-storage:readiness"] || "missing" },
    { name: "package:financialGatewayReadiness", ok: Boolean(pkg.scripts?.["financial-gateway:readiness"]), detail: pkg.scripts?.["financial-gateway:readiness"] || "missing" },
    { name: "package:escortReadiness", ok: Boolean(pkg.scripts?.["escort:readiness"]), detail: pkg.scripts?.["escort:readiness"] || "missing" },
    { name: "package:internetNursingReadiness", ok: Boolean(pkg.scripts?.["internet-nursing:readiness"]), detail: pkg.scripts?.["internet-nursing:readiness"] || "missing" },
    { name: "package:multiPracticeReadiness", ok: Boolean(pkg.scripts?.["multi-practice:readiness"]), detail: pkg.scripts?.["multi-practice:readiness"] || "missing" },
    { name: "package:hybridDeploymentReadiness", ok: Boolean(pkg.scripts?.["hybrid:deployment-readiness"]), detail: pkg.scripts?.["hybrid:deployment-readiness"] || "missing" },
    { name: "package:postgresMigrationPackage", ok: Boolean(pkg.scripts?.["postgres:migration-package"] && pkg.scripts?.["postgres:migration-verify"]), detail: `${pkg.scripts?.["postgres:migration-package"] || "missing"} / ${pkg.scripts?.["postgres:migration-verify"] || "missing"}` },
    { name: "package:chronicInstitutionInterfaces", ok: Boolean(pkg.scripts?.["chronic:institution-interfaces"]), detail: pkg.scripts?.["chronic:institution-interfaces"] || "missing" },
    { name: "package:chronicLaunchCore", ok: Boolean(pkg.scripts?.["chronic:launch-core"]), detail: pkg.scripts?.["chronic:launch-core"] || "missing" },
    { name: "docs:chronicLaunchCore", ok: ["GET /api/chronic/launch-core", "POST /api/chronic/launch-core/actions", "launch-core:actionClosure", "launch-core:siteSignoffs", "HIS/EMR/LIS/PACS"].every((marker) => chronicLaunchCoreDoc.includes(marker)), detail: "chronic launch core API, closure, site signoff, and institution joint-test evidence are documented" },
    { name: "docs:platformResearchReport", ok: ["政策文件依据", "已实现总体能力", "下一步开发计划", "internet-nursing:readiness", "health-dashboard:summary", "release:report"].every((marker) => platformResearchReportDoc.includes(marker)), detail: "platform R&D report documents policy basis, implemented capabilities, next plan, and release evidence" },
    { name: "docs:platformProductionAudit", ok: ["审计结论", "正式生产前已实现的主要功能", "生产割接差距", "下一步开发规划", "正式上线退出条件", "10/10"].every((marker) => platformProductionAuditDoc.includes(marker)) && platformProductionAuditSource.includes("PRODUCTION_BLOCKERS") && platformProductionAuditSource.includes("ROADMAP"), detail: "platform production audit documents implemented capabilities, owned blockers, phased roadmap and formal exit criteria" },
    { name: "docs:platformDevelopmentReport20260711", ok: ["本轮主要开发成果", "生产可观测性与 SIEM 告警闭环", "不可变部署包与密钥外置", "PostgreSQL 迁移制品与安全导出", "正式生产前已实现的主要标准平台功能", "验证证据", "当前生产阻断项", "下一步开发计划", "P0：0-30 天", "P1：31-60 天", "P2：61-90 天", "310/310", "244/245", "206/206"].every((marker) => platformDevelopmentReportDoc.includes(marker)), detail: "dated platform development report records delivered production adapter, observability, immutable deployment and PostgreSQL migration foundations with verification evidence, blockers and 30/60/90-day plan" },
    { name: "api:productionIdentityMessageAdapters", ok: ["fetchOidcUserInfo", "sendSmsVerificationCode", "digestPhoneVerificationCode", "productionAdapterCenter"].every((marker) => productionAdaptersSource.includes(marker)) && ["/api/auth/oidc/exchange", "/api/auth/adapters", "codeDigest"].every((marker) => serverSource.includes(marker)) && ["受控本地账号绑定", "最终送达回调", "现场联合测试回执"].every((marker) => productionAdaptersDoc.includes(marker)), detail: "OIDC and SMS production adapter foundation is runtime-wired with controlled account binding and explicit provider joint-test boundaries" },
    { name: "api:productionHospitalConnectors", ok: ["dispatchHospitalRequest", "hospitalConnectorCenter", "X-Idempotency-Key", "X-Signature", "HOSPITAL_ADAPTER_MAX_ATTEMPTS"].every((marker) => hospitalConnectorsSource.includes(marker)) && ["/api/integration/adapters", "/api/integration/dispatch", "provider-accepted", "direction === \"outbound\""].every((marker) => serverSource.includes(marker)) && ["联合测试回执", "适配器基础通过不等于医院接口已正式验收"].every((marker) => hospitalConnectorsDoc.includes(marker)), detail: "HIS EMR LIS PACS and appointment outbound connectors are runtime-wired with signing, idempotency, receipts, real retry and site boundaries" },
    { name: "api:secureObjectStorage", ok: ["createObjectUploadIntent", "finalizeObjectUpload", "createObjectDownloadIntent", "applyObjectLifecycle", "malware scan did not pass"].every((marker) => objectStorageSource.includes(marker)) && ["/api/attachments/storage", "/api/attachments/upload-intents", "attachmentCompleteMatch", "attachmentDownloadMatch", "attachmentActionMatch", "secureAttachments"].every((marker) => serverSource.includes(marker)) && objectStorageReadiness.includes("objectStorage:releaseWiring") && ["适配器基础通过不等于真实附件存储已经正式验收", "WORM/对象锁"].every((marker) => objectStorageDoc.includes(marker)), detail: "secure attachment metadata, upload completion, server-side malware scan, download authorization and lifecycle controls are runtime-wired" },
    { name: "api:financialGateways", ok: ["dispatchFinancialRequest", "financialGatewayCenter", "FORBIDDEN_PAYLOAD_KEYS", "FINANCIAL_GATEWAY_MAX_ATTEMPTS"].every((marker) => financialGatewaysSource.includes(marker)) && ["/api/financial-gateways", "/api/financial-gateways/dispatch", "adapterType: \"financial\"", "event.adapterType === \"financial\""].every((marker) => serverSource.includes(marker)) && financialGatewayReadiness.includes("financialGateway:releaseWiring") && ["适配器基础通过不等于支付、医保或电子证照已经正式验收", "日终对账", "现场联合测试回执"].every((marker) => financialGatewaysDoc.includes(marker)), detail: "payment insurance and certificate gateways are runtime-wired with signing, minimization, idempotency, retry and reconciliation boundaries" },
    { name: "monitoring:alertRouting", ok: ["dispatchAlert", "alertRoutingCenter", "FORBIDDEN_ALERT_KEYS", "ALERTING_MAX_ATTEMPTS", "X-Idempotency-Key"].every((marker) => observabilityAlertingSource.includes(marker)) && ["/api/observability/alerts", "/api/observability/alerts/dispatch", "/api/observability/alert-deliveries/", "observabilityAlertDeliveries", "alert-delivery-recovered"].every((marker) => serverSource.includes(marker)) && ["observability-alert-status", "observability-alert-deliveries"].every((marker) => operationsHtml.includes(marker)) && ["renderObservabilityAlertCenter", "data-observability-alert-action", "retryObservabilityAlert"].every((marker) => operationsSource.includes(marker)) && ["monitoring:alertAdapter", "monitoring:productionBoundary", "env:ALERTING.routes"].every((marker) => monitoringReadinessSource.includes(marker)) && ["告警适配器基础通过不等于生产监控已经正式验收", "去标识化", "失败进入运维事件", "CUTOVER_MONITORING_SIGNOFF"].every((marker) => observabilityAlertingDoc.includes(marker)), detail: "signed and minimized SIEM/webhook routing, persisted receipts, retry incidents, UI and explicit production acceptance boundary are wired" },
    { name: "env:observabilityAlerting", ok: ["SIEM_ENDPOINT=", "SIEM_SIGNING_SECRET=", "ALERT_WEBHOOK_URL=", "ALERTING_MAX_ATTEMPTS="].every((marker) => envTemplateSource.includes(marker)) && ["SIEM_ENDPOINT", "SIEM_SIGNING_SECRET", "ALERTING_MAX_ATTEMPTS"].every((marker) => deploymentSource.includes(marker)), detail: "SIEM/webhook alert routing environment contract is documented" },
    { name: "snapshot:observabilityAlertDeliveries", ok: Array.isArray(data.observabilityAlertDeliveries), detail: `${data.observabilityAlertDeliveries?.length || 0} persisted alert delivery receipts` },
    { name: "deployment:immutablePackage", ok: ["buildProductionDeploymentPackage", "verifyProductionDeploymentPackage", "DEPLOYMENT_ARTIFACT_DIGEST", "valuesPersisted", "requirePreviousArtifactDigest", "rollback:snapshot"].every((marker) => productionDeploymentPackageSource.includes(marker)) && ["NoNewPrivileges=true", "ProtectSystem=strict", "ReadWritePaths=__DATA_DIR__ __LOG_DIR__", "EnvironmentFile=__SECRET_ENV_FILE__"].every((marker) => productionServiceTemplate.includes(marker)) && ["deployment:package", "deployment:verify"].every((marker) => JSON.stringify(pkg.scripts || {}).includes(marker)) && ["deployment:package -- --strict", "deployment:verify"].every((marker) => ciSource.includes(marker)) && ["Vault、KMS 或容器/进程编排器注入密钥", "部署包校验通过不等于生产环境已经正式验收"].every((marker) => productionDeploymentDoc.includes(marker)), detail: "immutable runtime digest, secret-reference boundary, hardened service template, CI verification and rollback prerequisites are wired" },
    { name: "deployment:packageRuntimeVerification", ok: productionDeploymentPackage.ok && productionDeploymentVerification.ok && /^sha256:[a-f0-9]{64}$/.test(productionDeploymentPackage.artifact.digest), detail: `${productionDeploymentPackage.artifact.files.length} runtime files / ${productionDeploymentPackage.artifact.digest}` },
    { name: "deployment:releaseWiring", ok: manifestSource.includes("production-deployment-package.md") && manifestSource.includes("deployment:package") && fs.readFileSync(path.join(ROOT, "scripts", "release-report.js"), "utf8").includes("deploymentPackage:readiness"), detail: "deployment package is indexed by release manifest and aggregated release report" },
    { name: "snapshot:collections", ok: requiredCollections.every((key) => data[key]), detail: requiredCollections.filter((key) => !data[key]).join(",") || "all present" },
    { name: "snapshot:regionalDataSharing", ok: (data.regionalSharingPackages || []).length >= 3 && (data.regionalSharingAccessReviews || []).length >= 1 && serverSource.includes("/api/regional-data-sharing"), detail: `${data.regionalSharingPackages?.length || 0} packages, ${data.regionalSharingAccessReviews?.length || 0} access reviews` },
    { name: "snapshot:escortService", ok: (data.escortServiceProviders || []).length >= 3 && (data.escortWorkers || []).length >= 4 && (data.escortServiceOrders || []).length >= 3 && serverSource.includes("/api/escort-services/dashboard"), detail: `${data.escortServiceProviders?.length || 0} providers, ${data.escortWorkers?.length || 0} workers, ${data.escortServiceOrders?.length || 0} orders` },
    { name: "docs:escortHospitalInterface", ok: escortHospitalInterfaceDoc.includes("POST /api/escort-services/orders/:id/hospital-handoff") && escortHospitalInterfaceDoc.includes("hospitalCode") && serverSource.includes("hospital-handoff"), detail: "escort hospital handoff API contract is documented and implemented" },
    { name: "snapshot:internetNursing", ok: (data.internetNursingInstitutions || []).length >= 2 && (data.internetNursingNurses || []).length >= 2 && (data.internetNursingOrders || []).length >= 3 && serverSource.includes("/api/internet-nursing/dashboard"), detail: `${data.internetNursingInstitutions?.length || 0} institutions, ${data.internetNursingNurses?.length || 0} nurses, ${data.internetNursingOrders?.length || 0} orders` },
    { name: "snapshot:internetNursingAuth", ok: (data.authUsers || []).some((item) => item.username === "nurse" && item.password === "123456" && item.home === "internet-nursing.html" && item.nurseId === "inn-001") && serverSource.includes('username: "nurse"') && serverSource.includes('password: "123456"'), detail: "nurse workstation demo account is seeded" },
    { name: "snapshot:multiPractice", ok: (data.doctorProfiles || []).length >= 2 && (data.multiPracticeApplications || []).length >= 2 && serverSource.includes("/api/multi-practice-registry") && serverSource.includes("multiPracticeSummary"), detail: `${data.doctorProfiles?.length || 0} doctors, ${data.multiPracticeApplications?.length || 0} applications` },
    { name: "docs:internetNursing", ok: internetNursingDoc.includes("flowchart TD") && internetNursingDoc.includes("nurse / 123456") && internetNursingDoc.includes("/api/internet-nursing/orders/:id/actions"), detail: "internet nursing module handoff document is complete" },
    { name: "docs:citizenAccountProvisioning", ok: ["居民主索引管理员", "平台账号管理员", "authUsers", "securityEvents", "dataAccessLogs"].every((marker) => citizenProductionRequirementsDoc.includes(marker)), detail: "citizen launch requirements document account owners and audit evidence" },
    { name: "docs:citizenExternalDependencyOwners", ok: ["platform-ops", "identity-integration", "resident-master-index", "security-compliance", "mobile-release", "required-before-production", "上线阻断口径", "上线前必须归档的证据", "现场验收动作"].every((marker) => citizenProductionRequirementsDoc.includes(marker)), detail: "citizen launch requirements document production dependency owners, blockers, evidence, and onsite acceptance" },
    { name: "docs:productionGoLiveRequirements", ok: productionGoLiveRequirementsDoc.includes("GL-01") && productionGoLiveRequirementsDoc.includes("launch:smoke -- --base-url") && productionGoLiveRequirementsDoc.includes("发布阻断条件"), detail: "real production go-live requirements are documented" },
    { name: "docs:onsiteLaunchMaterials", ok: ["GLM-01", "GLM-04", "GLM-05", "GLM-08", "GLM-10", "CIT-01", "CIT-06", "launch:smoke -- --base-url"].every((marker) => onsiteLaunchMaterialsDoc.includes(marker)), detail: "on-site launch material checklist covers platform and citizen evidence" },
    { name: "api:siteLaunchEvidence", ok: serverSource.includes("/api/site-launch-evidence") && serverSource.includes("siteLaunchEvidence") && manifestSource.includes("site-launch-evidence"), detail: "runtime site launch evidence ledger API is wired" },
    { name: "snapshot:interfaceReadiness", ok: p0Interfaces.length >= 4 && p0Interfaces.every((item) => item.id && item.owner && item.status && item.next), detail: `${p0Interfaces.length} P0 interface tracks` },
    { name: "snapshot:securityAcceptance", ok: securityAcceptanceLedger.length >= 4 && securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), detail: `${securityAcceptanceLedger.length} security acceptance items` },
    { name: "snapshot:qualitySafety", ok: Array.isArray(data.qualitySafetyEvents) && data.qualitySafetyEvents.length >= 3 && Array.isArray(data.qualityRectificationOrders) && data.qualityRectificationOrders.length >= 1, detail: `${data.qualitySafetyEvents?.length || 0} events, ${data.qualityRectificationOrders?.length || 0} rectifications` },
    { name: "ui:digitalHospitalStandards", ok: digitalHospitalStandardsHtml.includes('requireRole(["commission"])') && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"standard-center\"") && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"launch-readiness\"") && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"production-evidence-packets\"") && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"launch-command-briefs\"") && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"formal-cutover-approvals\"") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_STANDARD_DOMAINS") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_WORKFLOW"), detail: "digital hospital standards page, role guard, standard model, workflow, launch readiness board, production evidence packets, command briefs and formal cutover approval desk are wired" },
    { name: "digitalHospitalStandards:readiness", ok: ["digitalHospital:standardDomains", "digitalHospital:workflowLoop", "digitalHospital:officialSources", "digitalHospital:apiContract", "digitalHospital:launchReadiness", "digitalHospital:releaseWiring"].every((marker) => digitalHospitalStandardsSource.includes(marker)) && digitalHospitalStandardsSource.includes("production-evidence-packets") && digitalHospitalStandardsSource.includes("launch-command-briefs") && digitalHospitalStandardsSource.includes("formal-cutover-approvals"), detail: "digital hospital standards readiness checks cover domains, workflow, API contract, launch readiness, production evidence packets, command briefs, formal approvals, official sources and release wiring" },
    { name: "api:digitalHospitalStandards", ok: ["/api/digital-hospital/standards", "/api/digital-hospital/launch-readiness", "/api/digital-hospital/production-evidence-packets", "/api/digital-hospital/launch-command-briefs", "/api/digital-hospital/formal-cutover-approvals", "buildDigitalHospitalStandardsOverview", "buildDigitalHospitalLaunchReadiness", "buildDigitalHospitalLaunchCommandBriefBoard", "buildDigitalHospitalFormalCutoverApprovalBoard", "seedDigitalHospitalStandards", "seedDigitalHospitalProductionEvidencePackets", "seedDigitalHospitalLaunchCommandBriefs", "seedDigitalHospitalFormalCutoverApprovals", "digitalHospitalEvidencePackets", "digitalHospitalLaunchRequirements", "digitalHospitalProductionEvidencePackets", "digitalHospitalLaunchCommandBriefs", "digitalHospitalFormalCutoverApprovals", "digitalHospitalRiskItems"].every((marker) => serverSource.includes(marker)) && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_API_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_LAUNCH_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_PRODUCTION_EVIDENCE_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_COMMAND_BRIEF_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_FORMAL_CUTOVER_APPROVAL_ENDPOINT") && digitalHospitalStandardsJs.includes("HealthCityAuth?.authFetch"), detail: "digital hospital standards API, launch readiness gate, production evidence packets, command briefs, formal cutover approvals, seed data and frontend fetch fallback are wired" },
    { name: "snapshot:chronicFollowupStatusPolicy", ok: Boolean(data.chronicFollowupStatusPolicy?.version && data.chronicFollowupStatusPolicy?.statusGroups?.open && data.chronicFollowupStatusPolicy?.requiredEvidence?.followup), detail: data.chronicFollowupStatusPolicy?.version || "missing" },
    { name: "snapshot:publicHealth", ok: (data.publicHealthStandards || []).length === 21 && (data.publicHealthInstitutionScopes || []).length >= 7 && (data.publicHealthEvents || []).length >= 6 && (data.publicHealthExchangeTasks || []).length >= 6 && (data.publicHealthExchangeRuns || []).length >= 6 && (data.publicHealthInstitutionTasks || []).length >= 7 && (data.publicHealthOnsiteAcceptances || []).length >= 6 && (data.publicHealthCutoverBlockers || []).length >= 6 && (data.publicHealthCutoverEvidencePackets || []).length >= 6 && (data.publicHealthCutoverDrills || []).length >= 4 && (data.publicHealthProductionHandoffs || []).length >= 6 && (data.publicHealthGoLiveObservations || []).length >= 6 && (data.publicHealthLaunchIncidents || []).length >= 6 && (data.publicHealthLaunchDutyShifts || []).length >= 6 && (data.publicHealthLaunchCommandBriefs || []).length >= 5 && (data.publicHealthSiteEvidenceVerificationTasks || []).length >= 9 && (data.publicHealthLaunchApprovals || []).length >= 6, detail: `${data.publicHealthStandards?.length || 0} standards, ${data.publicHealthInstitutionScopes?.length || 0} scopes, ${data.publicHealthEvents?.length || 0} events, ${data.publicHealthExchangeTasks?.length || 0} exchange tasks, ${data.publicHealthExchangeRuns?.length || 0} runs, ${data.publicHealthInstitutionTasks?.length || 0} institution tasks, ${data.publicHealthOnsiteAcceptances?.length || 0} onsite rows, ${data.publicHealthCutoverBlockers?.length || 0} cutover blockers, ${data.publicHealthCutoverEvidencePackets?.length || 0} evidence packets, ${data.publicHealthCutoverDrills?.length || 0} cutover drills, ${data.publicHealthProductionHandoffs?.length || 0} production handoffs, ${data.publicHealthGoLiveObservations?.length || 0} go-live observations, ${data.publicHealthLaunchIncidents?.length || 0} launch incidents, ${data.publicHealthLaunchDutyShifts?.length || 0} launch duty shifts, ${data.publicHealthLaunchCommandBriefs?.length || 0} launch command briefs, ${data.publicHealthSiteEvidenceVerificationTasks?.length || 0} site evidence verification tasks, ${data.publicHealthLaunchApprovals?.length || 0} launch approvals` },
    { name: "api:publicHealth", ok: serverSource.includes("/api/public-health/system") && serverSource.includes("buildPublicHealthSystem") && fs.existsSync(path.join(ROOT, "public-health.html")) && fs.existsSync(path.join(ROOT, "public-health.js")), detail: "public health page and API are wired" },
    { name: "api:publicHealthEventActions", ok: serverSource.includes("/api/public-health/events/:id/actions") && serverSource.includes("public-health-event-action"), detail: "public health event action API is wired with audit evidence" },
    { name: "api:publicHealthAdvancedActions", ok: ["/api/public-health/exchange-tasks/:id/runs", "/api/public-health/exchange-runs/:id/actions", "/api/public-health/institution-tasks/:id/actions", "/api/public-health/onsite-acceptances/:id/actions", "/api/public-health/cutover-blockers/:id/actions", "public-health-exchange-run", "public-health-exchange-exception-action", "public-health-institution-task-action", "public-health-onsite-acceptance", "public-health-cutover-blocker-action"].every((marker) => serverSource.includes(marker)), detail: "public health exchange exception, institution, onsite and cutover action APIs are wired with audit evidence" },
    { name: "api:publicHealthCutoverReadiness", ok: ["/api/public-health/cutover-readiness", "public-health-cutover-readiness", "buildPublicHealthCutoverReadiness"].every((marker) => serverSource.includes(marker)) && ["public-health-cutover-readiness", "renderCutoverReadiness"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health cutover readiness API and board are wired" },
    { name: "api:publicHealthCutoverEvidencePackets", ok: ["/api/public-health/cutover-evidence-packets/:id/actions", "public-health-cutover-evidence-packet-action", "seedPublicHealthCutoverEvidencePackets"].every((marker) => serverSource.includes(marker)) && ["public-health-cutover-evidence-packets", "renderCutoverEvidencePackets"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health cutover evidence packet API and board are wired" },
    { name: "api:publicHealthCutoverDrills", ok: ["/api/public-health/cutover-drills", "/api/public-health/cutover-drills/:id/actions", "public-health-cutover-drill-action", "seedPublicHealthCutoverDrills"].every((marker) => serverSource.includes(marker)) && ["public-health-cutover-drills", "renderCutoverDrills", "data-public-health-cutover-drill"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health cutover drill API and board are wired" },
    { name: "api:publicHealthProductionHandoffs", ok: ["/api/public-health/production-handoffs", "/api/public-health/production-handoffs/:id/actions", "public-health-production-handoff-action", "seedPublicHealthProductionHandoffs"].every((marker) => serverSource.includes(marker)) && ["public-health-production-handoffs", "renderProductionHandoffs", "data-public-health-production-handoff"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health production handoff API and board are wired" },
    { name: "api:publicHealthGoLiveObservations", ok: ["/api/public-health/go-live-observations", "/api/public-health/go-live-observations/:id/actions", "public-health-go-live-observation-action", "seedPublicHealthGoLiveObservations"].every((marker) => serverSource.includes(marker)) && ["public-health-go-live-observations", "renderGoLiveObservations", "data-public-health-go-live-observation"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health go-live observation API and board are wired" },
    { name: "api:publicHealthLaunchIncidents", ok: ["/api/public-health/launch-incidents", "/api/public-health/launch-incidents/:id/actions", "public-health-launch-incident-action", "seedPublicHealthLaunchIncidents"].every((marker) => serverSource.includes(marker)) && ["public-health-launch-incidents", "renderLaunchIncidents", "data-public-health-launch-incident"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health launch incident desk API and board are wired" },
    { name: "api:publicHealthLaunchDutyShifts", ok: ["/api/public-health/launch-duty-shifts", "/api/public-health/launch-duty-shifts/:id/actions", "public-health-launch-duty-shift-action", "seedPublicHealthLaunchDutyShifts"].every((marker) => serverSource.includes(marker)) && ["public-health-launch-duty-shifts", "renderLaunchDutyShifts", "data-public-health-launch-duty-shift"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health launch duty handoff API and board are wired" },
    { name: "api:publicHealthLaunchCommandBriefs", ok: ["/api/public-health/launch-command-briefs", "/api/public-health/launch-command-briefs/:id/actions", "public-health-launch-command-brief-action", "seedPublicHealthLaunchCommandBriefs", "acknowledge-launch-command-brief", "escalate-launch-command-brief-receipt", "acknowledgementTarget"].every((marker) => serverSource.includes(marker)) && ["public-health-launch-command-briefs", "renderLaunchCommandBriefs", "data-public-health-launch-command-brief", "data-public-health-launch-command-brief-receipt-target", "pendingAcknowledgementTargets"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health launch command brief API and board are wired with delivery receipts and escalation" },
    { name: "api:publicHealthSiteEvidenceBridge", ok: ["/api/public-health/site-evidence-bridge", "/api/public-health/site-evidence-bridge/actions", "public-health-site-evidence-bridge-action"].every((marker) => serverSource.includes(marker)) && ["buildPublicHealthSiteEvidenceBridge", "PUBLIC_HEALTH_SITE_EVIDENCE_LINKS"].every((marker) => publicHealthSource.includes(marker)) && ["public-health-site-evidence-bridge", "renderSiteEvidenceBridge", "data-public-health-site-evidence-link"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health site evidence bridge API and board are wired" },
    { name: "api:publicHealthSiteEvidenceVerificationTasks", ok: ["/api/public-health/site-evidence-verification-tasks", "/api/public-health/site-evidence-verification-tasks/:id/actions", "public-health-site-evidence-verification-action", "seedPublicHealthSiteEvidenceVerificationTasks"].every((marker) => serverSource.includes(marker)) && ["buildPublicHealthSiteEvidenceVerificationBoard", "seedPublicHealthSiteEvidenceVerificationTasks"].every((marker) => publicHealthSource.includes(marker)) && ["public-health-site-evidence-verification", "renderSiteEvidenceVerificationTasks", "data-public-health-site-evidence-verification-task"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health site evidence verification task API and board are wired" },
    { name: "api:publicHealthStandardImplementationLedger", ok: ["/api/public-health/standard-implementation-ledger", "/api/public-health/standard-implementation-ledger/:id/actions", "public-health-standard-implementation-action", "seedPublicHealthStandardImplementationLedger", "record-standard-gap", "escalate-standard-gap", "assign-standard-gap-remediation", "verify-standard-gap-remediation", "link-standard-site-evidence", "remediationOwner and remediationDueAt"].every((marker) => serverSource.includes(marker)) && ["buildPublicHealthStandardImplementationBoard", "seedPublicHealthStandardImplementationLedger"].every((marker) => publicHealthSource.includes(marker)) && ["public-health-standard-implementation", "renderStandardImplementationLedger", "data-public-health-standard-implementation", "data-public-health-standard-action", "data-public-health-standard-evidence-id", "data-public-health-standard-remediation-owner", "data-public-health-standard-remediation-due-at", "standardImplementationEvidenceCandidates", "remediationUnassigned", "remediationDueSoon", "remediationOverdue"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health standard implementation ledger API and board are wired with remediation safeguards" },
    { name: "api:productionDatabaseCutoverCenter", ok: ["/api/production-database/cutover-center", "/api/production-database/cutover-runs", "production-database-cutover-rehearsal", "production-database-cutover-action"].every((marker) => serverSource.includes(marker)) && ["production-database-cutover-center", "renderProductionDatabaseCutoverCenter", "data-production-db-action"].every((marker) => platformHtml.includes(marker) || platformSource.includes(marker)) && ["migration batch", "rollback checkpoint", "/api/production-database/cutover-runs"].every((marker) => productionDatabaseCutoverDoc.includes(marker)), detail: "production database cutover rehearsal center API, platform board and production boundary are wired" },
    { name: "database:postgresMigrationPackage", ok: postgresMigrationPackage.ok && postgresMigrationPackage.manifest.mode === "manifest" && !postgresMigrationPackage.files["records.copy.tsv"] && ["postgres:migration-package", "postgres:migration-verify"].every((marker) => ciSource.includes(marker)) && ["acknowledge-sensitive-data", "must be written outside the repository", "credentialsPersisted: false"].every((marker) => postgresMigrationPackageSource.includes(marker)) && ["仓库之外", "不得上传 Git", "生产数据库已经正式验收"].every((marker) => postgresMigrationPackageDoc.includes(marker)), detail: `${postgresMigrationPackage.manifest.summary.collections} collections / ${postgresMigrationPackage.manifest.summary.records} records summarized without payload files` },
    { name: "database:postgresMigrationReleaseWiring", ok: manifestSource.includes("postgres-migration-package/manifest.json") && manifestSource.includes("postgres:migration-package") && fs.readFileSync(path.join(ROOT, "scripts", "release-report.js"), "utf8").includes("productionDb:migrationPackage"), detail: "PostgreSQL migration manifest is indexed by release manifest and aggregate report" },
    { name: "runtime:sqliteProductionProfile", ok: ["configureSqliteConnection", "PRAGMA foreign_keys = ON", "PRAGMA journal_mode", "PRAGMA synchronous", "PRAGMA busy_timeout", "sqliteRuntimeProfile", "quickCheck", "productionProfile"].every((marker) => serverSource.includes(marker)) && ["SQLITE_JOURNAL_MODE=WAL", "SQLITE_SYNCHRONOUS=FULL", "SQLITE_BUSY_TIMEOUT_MS=5000", "SQLITE_WAL_AUTOCHECKPOINT_PAGES=1000"].every((marker) => envTemplateSource.includes(marker)) && ["storage.sqliteProfile", "quickCheck"].every((marker) => deploymentSource.includes(marker)), detail: "SQLite runtime enforces WAL, durable sync, foreign keys, busy timeout and health-visible integrity checks" },
    { name: "api:citizenOperationsCenter", ok: ["/api/citizen-operations/center", "/api/citizen-operations/public", "citizen-operations-action"].every((marker) => serverSource.includes(marker)) && ["citizen-operations-center", "renderCitizenOperationsCenter", "data-citizen-operations-action"].every((marker) => platformHtml.includes(marker) || platformSource.includes(marker)) && ["citizen-service-public-feed", "renderCitizenOperationsPublicFeed", "citizen-operations/public"].every((marker) => citizenHtml.includes(marker) || citizenSource.includes(marker)) && ["real-name review", "blacklist", "hospital service enablement"].every((marker) => citizenOperationsDoc.includes(marker)), detail: "citizen operations API, platform center, resident public feed, actions and production boundary are wired" },
    { name: "api:commercialCryptoCenter", ok: ["/api/commercial-crypto/center", "/api/commercial-crypto/capabilities/", "commercial-crypto-action"].every((marker) => serverSource.includes(marker)) && ["commercial-crypto-center", "renderCommercialCryptoCenter", "data-commercial-crypto-action"].every((marker) => platformHtml.includes(marker) || platformSource.includes(marker)) && ["runtime compatibility", "production approval", "USBKey"].every((marker) => commercialCryptoDoc.includes(marker)), detail: "commercial crypto contracts, runtime probe, evidence actions and production assessment boundary are wired" },
    { name: "api:productionOperationsCenter", ok: ["/api/production-operations/center", "/api/production-operations/:resource/:id/actions", "production-operations-action"].every((marker) => serverSource.includes(marker)) && ["production-operations-run-center", "renderProductionOperationsCenter", "data-production-operations-action"].every((marker) => operationsHtml.includes(marker) || operationsSource.includes(marker)) && ["RPO", "RTO", "24x365", "Production approval"].every((marker) => productionOperationsDoc.includes(marker)), detail: "production operations SLO, duty, incident, recovery drill, evidence API and UI are wired" },
    { name: "api:registrationJourney", ok: ["/api/registrations/orders/:id/actions", "/api/registrations/orders/:id/disruption", "/api/registrations/waitlist/:id/actions", "registration-journey-action", "registration-disruption-action", "registration-waitlist-action", "applyRegistrationJourneyAction", "applyRegistrationDisruptionAction", "promoteNextRegistrationWaitlist"].every((marker) => serverSource.includes(marker)) && ["registration-journey-timeline", "registration-waitlist-cards", "runRegistrationJourneyAction", "runRegistrationDisruptionAction", "runRegistrationWaitlistAction", "data-registration-journey-action", "data-registration-disruption-action", "data-registration-waitlist-join"].every((marker) => citizenHtml.includes(marker) || citizenSource.includes(marker)) && ["registration-journey-workbench", "registration-waitlist-workbench", "renderRegistrationJourneyWorkbench", "runInstitutionRegistrationDisruptionAction", "runInstitutionRegistrationWaitlistAction", "data-registration-institution-action", "data-registration-disruption-schedule", "data-registration-waitlist-action"].every((marker) => institutionHtml.includes(marker) || institutionSource.includes(marker)) && ["payment", "refund", "HIS", "insurance", "resident-acceptance", "FIFO", "productionReady=false"].every((marker) => registrationJourneyDoc.includes(marker)), detail: "registration payment, confirmation, completion, refund, disruption rescheduling and FIFO waitlist auto-promotion are wired across resident and institution roles" },
    { name: "api:registrationIntegration", ok: ["appointment-order-v1", "/api/registrations/integration-center", "/api/registrations/integration-events/:id/retry", "/api/registrations/integration-events/:id/reconciliation", "applyRegistrationIntegrationCallback", "landAppointmentIntegrationEvent", "canManageAppointmentIntegrationEvent", "applyAppointmentIntegrationReconciliationAction"].every((marker) => serverSource.includes(marker)) && ["registration-integration-center", "registration-integration-events", "renderRegistrationIntegrationCenter", "data-registration-integration-retry", "runInstitutionRegistrationIntegrationRetry", "data-registration-reconciliation-action", "runInstitutionRegistrationReconciliationAction"].every((marker) => institutionHtml.includes(marker) || institutionSource.includes(marker)) && ["HMAC-SHA256", "idempotencyKey", "refund-failed", "/api/registrations/integration-events/:id/retry", "/api/registrations/integration-events/:id/reconciliation", "manual-compensation", "Production boundary"].every((marker) => registrationIntegrationDoc.includes(marker)), detail: "signed appointment callbacks, order landing, scoped retry, manual reconciliation cases and institution UI are wired" },
    { name: "api:publicHealthLaunchGate", ok: ["/api/public-health/launch-gate", "/api/public-health/launch-gate/actions", "public-health-launch-gate-action", "seedPublicHealthLaunchApprovals"].every((marker) => serverSource.includes(marker)) && ["public-health-launch-gate", "renderLaunchGate"].every((marker) => fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes(marker) || fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes(marker)), detail: "public health production launch gate API and board are wired" },
    { name: "api:publicHealthLaunchApprovalPreflight", ok: ["approvalPreflight", "launch approval is blocked until all prerequisite launch requirements pass", "APPROVE PUBLIC HEALTH LAUNCH"].every((marker) => serverSource.includes(marker)) && ["data-public-health-launch-approval-preflight", "submit-launch-approval"].every((marker) => publicHealthSource.includes(marker)), detail: "public health launch approval preflight blocks final approval until prerequisites pass" },
    { name: "docs:publicHealth", ok: ["21/125/421", "平战结合", "医防融合", "/api/public-health/system", "/api/public-health/events/:id/actions", "/api/public-health/exchange-tasks/:id/runs", "/api/public-health/cutover-blockers/:id/actions", "/api/public-health/cutover-readiness", "/api/public-health/cutover-evidence-packets/:id/actions", "/api/public-health/cutover-drills/:id/actions", "/api/public-health/site-evidence-bridge/actions", "/api/public-health/site-evidence-verification-tasks/:id/actions", "/api/public-health/standard-implementation-ledger/:id/actions", "/api/public-health/launch-gate/actions", "publicHealthExchangeRuns", "publicHealthInstitutionTasks", "publicHealthOnsiteAcceptances", "publicHealthCutoverBlockers", "publicHealthCutoverReadiness", "publicHealthCutoverEvidencePackets", "publicHealthCutoverDrills", "publicHealthSiteEvidenceBridge", "publicHealthSiteEvidenceVerificationTasks", "publicHealthStandardImplementationLedger", "publicHealthLaunchApprovals", "public-health:readiness"].every((marker) => publicHealthDoc.includes(marker)), detail: "public health system report documents source-derived scope, standard implementation ledger, action APIs, exchange runs, institution collaboration, onsite acceptance, cutover blockers, site evidence verification, launch gate, and release evidence" },
    { name: "docs:publicHealthProductionHandoffs", ok: ["/api/public-health/production-handoffs/:id/actions", "publicHealthProductionHandoffs", "production handoff"].every((marker) => publicHealthDoc.includes(marker)), detail: "public health system report documents production handoff packs" },
    { name: "docs:publicHealthGoLiveObservations", ok: ["/api/public-health/go-live-observations/:id/actions", "publicHealthGoLiveObservations", "go-live observation"].every((marker) => publicHealthDoc.includes(marker)), detail: "public health system report documents go-live observation and rollback watch" },
    { name: "docs:publicHealthLaunchIncidents", ok: ["/api/public-health/launch-incidents/:id/actions", "publicHealthLaunchIncidents", "launch incident desk"].every((marker) => publicHealthDoc.includes(marker)), detail: "public health system report documents launch incident desk and rollback decision triage" },
    { name: "docs:publicHealthLaunchDutyShifts", ok: ["/api/public-health/launch-duty-shifts/:id/actions", "publicHealthLaunchDutyShifts", "launch duty handoff"].every((marker) => publicHealthDoc.includes(marker)), detail: "public health system report documents launch duty handoff roster" },
    { name: "docs:publicHealthLaunchCommandBriefs", ok: ["/api/public-health/launch-command-briefs/:id/actions", "publicHealthLaunchCommandBriefs", "launch command brief", "acknowledge-launch-command-brief", "delivery receipt"].every((marker) => publicHealthDoc.includes(marker)), detail: "public health system report documents launch command brief broadcasts and delivery receipts" },
    { name: "docs:publicHealthNextPlan", ok: ["5 小时开发切片", "事件处置闭环", "验收清单"].every((marker) => publicHealthPlanDoc.includes(marker)), detail: "public health next development plan is documented" },
    { name: "docs:phase2ProposalPlan", ok: ["13 家医院", "5 家区市县平台", "216 张表", "78 项", "17 家医院", "SM2/SM3/SM4", "24x365", "phase2:proposal-readiness"].every((marker) => phase2ProposalPlanDoc.includes(marker)), detail: "phase-2 proposal gap plan documents proposal scope, P0/P1/P2 roadmap, external blockers, and release evidence" },
    { name: "api:chronicPublicHealthLoop", ok: serverSource.includes("/api/chronic/public-health-loop") && serverSource.includes("immunizationPlanning") && serverSource.includes("infectiousDiseaseReporting") && serverSource.includes("cdcSummary") && institutionSource.includes("loadChronicPublicHealthLoop") && institutionSource.includes("renderChronicPublicHealthLoop") && institutionHtml.includes("public-health-loop-stages") && institutionHtml.includes("public-health-loop-integrations") && institutionHtml.includes("public-health-cdc-summary"), detail: "chronic public health monitor-alert-dispatch-intervention-followup-summary loop plus immunization infectious-reporting and CDC command summary is wired" },
    { name: "snapshot:researchSandbox", ok: (data.researchDatasets || []).some((item) => item.authorizationStatus === "approved" && (item.deidentificationStatus === "released" || item.anonymization) && (item.sandbox?.status === "active" || item.status === "published")) && (data.dataAccessLogs || []).some((item) => /research|科研|数据集|沙箱/i.test(`${item.scope || ""} ${item.purpose || ""}`)), detail: `${data.researchDatasets?.length || 0} datasets / ${data.dataAccessLogs?.length || 0} audit logs` },
    { name: "snapshot:externalDependencyRisks", ok: externalDependencyRiskIds.every((id) => serverSource.includes(id)), detail: `${externalDependencyRiskIds.length} external dependency risks` },
    { name: "snapshot:p2-complete", ok: (data.platformRoadmap || []).filter((item) => item.priority === "P2").every((item) => item.status === "已完成"), detail: (data.platformRoadmap || []).filter((item) => item.priority === "P2").map((item) => `${item.title}:${item.status}`).join(";") },
    { name: "snapshot:accessibility", ok: Array.isArray(data.accessibilityChecklist) && data.accessibilityChecklist.length >= 5, detail: `${data.accessibilityChecklist?.length || 0} checklist items` },
    { name: "snapshot:healthDashboard", ok: Array.isArray(data.healthDashboardSnapshots) && data.healthDashboardSnapshots.some((item) => Array.isArray(item.sourceApplications) && item.sourceApplications.length === 7), detail: `${data.healthDashboardSnapshots?.length || 0} dashboard snapshots` },
    { name: "snapshot:healthDashboardIndicatorCenter", ok: ["buildIndustryGovernanceIndicatorCenter", "dashboard:industry-governance-indicators", "dashboard:industry-governance-reports"].every((marker) => healthDashboardSource.includes(marker)) && healthDashboardHtml.includes("industry-governance-indicator-center") && healthDashboardJs.includes("renderIndustryGovernanceIndicatorCenter") && healthDashboardJs.includes("industry-indicator-export") && serverSource.includes("/api/health-dashboard/industry-governance-indicators") && ["健康体检", "发热门诊", "月报/年报", "JSON 导出"].every((marker) => healthDashboardIndicatorDoc.includes(marker)), detail: "phase-2 industry governance indicator center API, eight-topic model, filters, export, docs and report views are wired" },
    { name: "snapshot:dataGovernance", ok: serverSource.includes("seedDataGovernanceAssets") && serverSource.includes("seedStandardDataDictionaries") && serverSource.includes("seedDataLineageControls") && serverSource.includes("seedPlatformDataBusChannels") && serverSource.includes("/api/data-governance"), detail: "data asset catalog, standard dictionaries, lineage controls, platform bus channels, and API are seeded" },
    { name: "snapshot:phase2Catalog", ok: ["seedPhase2DataCatalogs", "seedPhase2ServiceCatalogs", "seedPhase2FieldLineage", "seedPhase2CatalogQualityRules", "buildPhase2CatalogOverview", "/api/phase2/catalog"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2Catalog") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-catalog"), detail: "phase-2 data catalog, service catalog, lineage, quality rules, API, and platform UI are wired" },
    { name: "snapshot:phase2JointTest", ok: ["seedPhase2PilotInstitutions", "seedPhase2JointTestLinks", "seedPhase2SamplePayloads", "seedPhase2GatewayTraces", "seedPhase2JointTestIssues", "buildPhase2JointTestPilotOverview", "/api/phase2/joint-test-pilot"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2JointTestPilot") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-joint-test-pilot"), detail: "phase-2 minimum joint-test pilot, sample payloads, gateway traces, issue ledger, API, and platform UI are wired" },
    { name: "snapshot:phase2MutualRecognition", ok: ["seedPhase2MutualRecognitionCatalog", "seedPhase2MutualRecognitionCitations", "buildPhase2MutualRecognitionOverview", "/api/phase2/mutual-recognition", "phase2-mutual-recognition-decision"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "county.js"), "utf8").includes("renderPhase2MutualRecognition") && fs.readFileSync(path.join(ROOT, "county.html"), "utf8").includes("phase2-mutual-recognition-browser"), detail: "phase-2 mutual recognition 78-item mapping, report browser, citation chain, decision API, and county UI are wired" },
    { name: "snapshot:phase2DiseaseReporting", ok: ["seedPhase2DiseaseReportingRules", "seedPhase2DiseaseReportQueue", "seedPhase2DiseaseReportReceipts", "buildPhase2DiseaseReportingOverview", "/api/phase2/disease-reporting", "phase2-disease-report-receipt"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2DiseaseReporting") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-disease-reporting"), detail: "phase-2 disease reporting diagnosis triggers, report queue, county receipts, patient center, supervision stats, API, and platform UI are wired" },
    { name: "snapshot:phase2ClinicalAssist", ok: ["seedPhase2ClinicalAssistRules", "seedPhase2ClinicalAssistAlerts", "seedPhase2ClinicalAssistReceipts", "seedPhase2ClinicalAssistPluginContracts", "buildPhase2ClinicalAssistOverview", "/api/phase2/clinical-assist", "phase2-clinical-assist-receipt", "phase2-clinical-assist-rule-config"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "doctor.js"), "utf8").includes("renderDoctorClinicalAssist") && fs.readFileSync(path.join(ROOT, "doctor.html"), "utf8").includes("doctor-clinical-assist") && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2ClinicalAssist") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-clinical-assist"), detail: "phase-2 clinical assist rules, alerts, doctor receipts, plugin contracts, API, doctor UI, and platform UI are wired" },
    { name: "snapshot:phase2FamilyDoctor", ok: ["seedPhase2FamilyDoctorTemplates", "seedPhase2FamilyDoctorTeams", "seedPhase2FamilyDoctorServicePackages", "seedPhase2FamilyDoctorApplications", "seedPhase2FamilyDoctorContracts", "seedPhase2FamilyDoctorFulfillments", "buildPhase2FamilyDoctorOverview", "/api/phase2/family-doctor-contracts", "phase2-family-doctor-application-review", "phase2-family-doctor-fulfillment"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "citizen.js"), "utf8").includes("renderFamilyDoctorContracts") && fs.readFileSync(path.join(ROOT, "citizen.html"), "utf8").includes("service-family-doctor") && fs.readFileSync(path.join(ROOT, "institution.js"), "utf8").includes("renderPhase2FamilyDoctorContracts") && fs.readFileSync(path.join(ROOT, "institution.html"), "utf8").includes("phase2-family-doctor-contracts") && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2FamilyDoctorContracts") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-family-doctor-contracts"), detail: "phase-2 family doctor templates, teams, packages, applications, review, contracts, fulfillment, citizen UI, institution UI, platform UI, and API are wired" },
    { name: "snapshot:citizenOperations", ok: (data.citizenOperationContents || []).length >= 4 && (data.citizenAgreementVersions || []).length >= 4 && (data.citizenIdentityReviewCases || []).length >= 3 && (data.citizenServiceBlacklist || []).length >= 3 && (data.citizenHospitalServiceConfigs || []).length >= 3 && (data.citizenHospitalServiceConfigs || []).every((item) => item.productionReady === false), detail: `${data.citizenOperationContents?.length || 0} contents / ${data.citizenAgreementVersions?.length || 0} agreements / ${data.citizenIdentityReviewCases?.length || 0} identity reviews / ${data.citizenServiceBlacklist?.length || 0} blacklist rows / ${data.citizenHospitalServiceConfigs?.length || 0} hospitals` },
    { name: "snapshot:commercialCrypto", ok: (data.commercialCryptoCapabilities || []).length === 6 && (data.commercialCryptoCapabilities || []).every((item) => item.productionReady === false && Array.isArray(item.requiredPrimitives) && item.requiredPrimitives.length > 0) && (data.commercialCryptoEvidencePackets || []).length >= 2, detail: `${data.commercialCryptoCapabilities?.length || 0} contracts / ${data.commercialCryptoEvidencePackets?.length || 0} evidence packets / production ready 0` },
    { name: "snapshot:productionOperations", ok: (data.productionServiceLevels || []).length >= 4 && (data.operationsDutyShifts || []).length >= 3 && (data.operationsIncidents || []).length >= 3 && (data.disasterRecoveryDrills || []).length >= 3 && (data.operationsEvidencePackets || []).length >= 2 && [data.productionServiceLevels, data.operationsDutyShifts, data.operationsIncidents, data.disasterRecoveryDrills].flat().every((item) => item.productionReady === false), detail: `${data.productionServiceLevels?.length || 0} SLOs / ${data.operationsDutyShifts?.length || 0} shifts / ${data.operationsIncidents?.length || 0} incidents / ${data.disasterRecoveryDrills?.length || 0} drills / production ready 0` },
    { name: "snapshot:registrationJourney", ok: (data.registrationOrders || []).length >= 1 && (data.registrationOrders || []).every((item) => item.productionReady === false && item.journeyStage && item.hisConfirmationStatus && item.checkInStatus), detail: `${data.registrationOrders?.length || 0} appointment journeys / production ready 0` },
    { name: "snapshot:registrationIntegration", ok: (data.integrationContracts || []).some((item) => item.id === "appointment-order-v1" && item.signature === "HMAC-SHA256" && item.idempotencyKey === "externalId") && Array.isArray(data.integrationGatewayEvents), detail: `${data.integrationContracts?.length || 0} integration contracts / appointment callback contract present` },
    { name: "manifest:dataGovernance", ok: manifestSource.includes("data-governance-readiness-report.md") && manifestSource.includes("data-governance:readiness"), detail: "data governance readiness artifact is indexed" },
    { name: "manifest:digitalHospitalStandards", ok: manifestSource.includes("digital-hospital-standards-readiness-report.md") && manifestSource.includes("digital-hospital:standards-readiness"), detail: "digital hospital standards artifact is indexed" },
    { name: "manifest:phase2ProposalReadiness", ok: manifestSource.includes("phase2-proposal-readiness-report.md") && manifestSource.includes("phase2:proposal-readiness"), detail: "phase-2 proposal readiness artifact is indexed" },
    { name: "manifest:phase2CatalogReadiness", ok: manifestSource.includes("phase2-catalog-readiness-report.md") && manifestSource.includes("phase2:catalog-readiness"), detail: "phase-2 catalog readiness artifact is indexed" },
    { name: "manifest:phase2JointTestReadiness", ok: manifestSource.includes("phase2-joint-test-readiness-report.md") && manifestSource.includes("phase2:joint-test-readiness"), detail: "phase-2 joint-test readiness artifact is indexed" },
    { name: "manifest:phase2MutualRecognitionReadiness", ok: manifestSource.includes("phase2-mutual-recognition-readiness-report.md") && manifestSource.includes("phase2:mutual-recognition-readiness"), detail: "phase-2 mutual recognition readiness artifact is indexed" },
    { name: "manifest:phase2DiseaseReportingReadiness", ok: manifestSource.includes("phase2-disease-reporting-readiness-report.md") && manifestSource.includes("phase2:disease-reporting-readiness"), detail: "phase-2 disease reporting readiness artifact is indexed" },
    { name: "manifest:phase2ClinicalAssistReadiness", ok: manifestSource.includes("phase2-clinical-assist-readiness-report.md") && manifestSource.includes("phase2:clinical-assist-readiness"), detail: "phase-2 clinical assist readiness artifact is indexed" },
    { name: "manifest:phase2FamilyDoctorReadiness", ok: manifestSource.includes("phase2-family-doctor-readiness-report.md") && manifestSource.includes("phase2:family-doctor-readiness"), detail: "phase-2 family doctor readiness artifact is indexed" },
    { name: "manifest:citizenOperationsReadiness", ok: manifestSource.includes("citizen-operations-readiness-report.md") && manifestSource.includes("phase2:citizen-operations-readiness"), detail: "citizen service operations readiness artifact is indexed" },
    { name: "manifest:commercialCryptoReadiness", ok: manifestSource.includes("commercial-crypto-readiness-report.md") && manifestSource.includes("security:commercial-crypto-readiness"), detail: "commercial crypto adapter readiness artifact is indexed" },
    { name: "manifest:productionOperationsReadiness", ok: manifestSource.includes("operations-readiness-report.md") && manifestSource.includes("/api/production-operations/center"), detail: "production operations run-center readiness artifact is indexed" },
    { name: "manifest:registrationJourneyReadiness", ok: manifestSource.includes("registration-journey-readiness-report.md") && manifestSource.includes("registration:journey-readiness"), detail: "registration journey readiness artifact is indexed" },
    { name: "manifest:platformProductionAudit", ok: manifestSource.includes("platform-production-audit.json") && manifestSource.includes("platform:production-audit") && manifestSource.includes("数智医院标准平台全程审计与生产前开发规划.md"), detail: "platform production audit and roadmap artifact is indexed" },
    { name: "manifest:objectStorageReadiness", ok: manifestSource.includes("object-storage-readiness-report.json") && manifestSource.includes("object-storage:readiness") && manifestSource.includes("/api/attachments/storage"), detail: "object storage security readiness artifact is indexed" },
    { name: "manifest:registrationIntegrationReadiness", ok: manifestSource.includes("registration-integration-readiness-report.md") && manifestSource.includes("registration:integration-readiness"), detail: "registration callback integration readiness artifact is indexed" },
    { name: "manifest:healthDashboardSummary", ok: manifestSource.includes("health-dashboard-summary.md") && manifestSource.includes("health-dashboard:summary"), detail: "health dashboard summary artifact is indexed" },
    { name: "manifest:healthDashboardIndicatorCenter", ok: manifestSource.includes("health-dashboard-indicator-center-report.md") && manifestSource.includes("/api/health-dashboard/industry-governance-indicators"), detail: "health dashboard indicator center artifact is indexed" },
    { name: "manifest:launchSmoke", ok: manifestSource.includes("launch-smoke-report.md") && manifestSource.includes("launch:smoke"), detail: "launch smoke artifact is indexed" },
    { name: "manifest:onsiteLaunchRequirements", ok: manifestSource.includes("onsite-launch-requirements.md") && manifestSource.includes("onsite:launch-requirements"), detail: "on-site launch requirements artifact is indexed" },
    { name: "manifest:priorityApplicationTemplates", ok: manifestSource.includes("priority-application-templates.md") && manifestSource.includes("priority-apps:templates"), detail: "priority application template artifact is indexed" },
    { name: "manifest:citizenLaunchFoundation", ok: manifestSource.includes("citizen-launch-foundation-readiness.md") && manifestSource.includes("citizen:launch-foundation"), detail: "citizen launch foundation artifact is indexed" },
    { name: "manifest:policyCoverage", ok: manifestSource.includes("policy-coverage-report.md") && manifestSource.includes("policy:coverage"), detail: "policy coverage artifact is indexed" },
    { name: "manifest:maternalChildReadiness", ok: manifestSource.includes("maternal-child-readiness-report.md") && manifestSource.includes("maternal-child:readiness"), detail: "maternal-child readiness artifact is indexed" },
    { name: "manifest:publicHealthReadiness", ok: manifestSource.includes("public-health-readiness-report.md") && manifestSource.includes("public-health:readiness"), detail: "public health readiness artifact is indexed" },
    { name: "manifest:escortServiceReadiness", ok: manifestSource.includes("escort-service-readiness-report.md") && manifestSource.includes("escort:readiness"), detail: "escort service readiness artifact is indexed" },
    { name: "manifest:internetNursingReadiness", ok: manifestSource.includes("internet-nursing-readiness-report.md") && manifestSource.includes("internet-nursing:readiness"), detail: "internet nursing readiness artifact is indexed" },
    { name: "manifest:multiPracticeReadiness", ok: manifestSource.includes("multi-practice-readiness-report.md") && manifestSource.includes("multi-practice:readiness"), detail: "multi-practice readiness artifact is indexed" },
    { name: "manifest:hybridDeploymentReadiness", ok: manifestSource.includes("hybrid-deployment-readiness-report.md") && manifestSource.includes("hybrid:deployment-readiness"), detail: "hybrid deployment readiness artifact is indexed" },
    { name: "snapshot:storageMeta", ok: Boolean(data.storageMeta?.engine && data.storageMeta?.mode), detail: data.storageMeta ? `${data.storageMeta.engine}/${data.storageMeta.mode}` : "missing" }
  ];

  const runCommands = options.runCommands === true;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const commandResults = runCommands ? [
    run(npm, ["run", "check"]),
    run(npm, ["test"]),
    run(npm, ["run", "test:coverage"]),
    run(npm, ["run", "test:e2e"]),
    run(npm, ["audit", "--omit=dev"])
  ] : [];
  const allChecks = [...checks, ...commandResults.map((item) => ({ name: `command:${item.command}`, ok: item.ok, detail: item.ok ? "passed" : item.stderr || item.stdout }))];
  const report = {
    ok: allChecks.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    project: pkg.name,
    version: pkg.version,
    checks: allChecks
  };
  return report;
}

function main() {
  const report = buildDeployCheckReport({
    runCommands: process.argv.includes("--run-commands")
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildDeployCheckReport,
  run
};
