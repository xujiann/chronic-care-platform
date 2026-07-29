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
  const spawnOptions = { cwd: ROOT, stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  const result = process.platform === "win32"
    ? spawnSync(commandLine, { ...spawnOptions, shell: true })
    : spawnSync(command, args, { ...spawnOptions, shell: false });
  return {
    command: commandLine,
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: [result.stderr.trim(), result.error?.message].filter(Boolean).join("\n")
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
    "emergencyDispatchLoops",
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
    "publicHealthTriggerRules",
    "publicHealthSignals",
    "publicHealthAlerts",
    "publicHealthCommandTasks",
    "publicHealthResources",
    "publicHealthAiReviews",
    "publicHealthEvidenceRecords",
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
  const traceabilityPolicySources = Array.isArray(data.drugTraceabilityPolicySources) ? data.drugTraceabilityPolicySources : [];
  const traceabilityEvidenceRequirements = Array.isArray(data.drugTraceabilityEvidenceRequirements) ? data.drugTraceabilityEvidenceRequirements : [];
  const drugConsumableSupervisions = Array.isArray(data.drugConsumableSupervisions) ? data.drugConsumableSupervisions : [];
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const t10SpecialtyModuleGovernanceSource = fs.readFileSync(path.join(ROOT, "t10-specialty-module-governance.js"), "utf8");
  const bloodClinicalProductionSource = fs.readFileSync(path.join(ROOT, "blood-clinical-production.js"), "utf8");
  const emergencyModuleGateSource = fs.readFileSync(path.join(ROOT, "emergency-module-gate.js"), "utf8");
  const sessionStoreSource = fs.readFileSync(path.join(ROOT, "session-store.js"), "utf8");
  const authSource = fs.readFileSync(path.join(ROOT, "auth.js"), "utf8");
  const bloodBusinessSource = fs.readFileSync(path.join(ROOT, "blood-business.js"), "utf8");
  const bloodRecallSource = fs.readFileSync(path.join(ROOT, "blood-recall.js"), "utf8");
  const diseasePaymentIntakeSource = fs.readFileSync(path.join(ROOT, "disease-payment-intake.js"), "utf8");
  const diseasePaymentLocalPackageSource = fs.readFileSync(path.join(ROOT, "disease-payment-local-package.js"), "utf8");
  const diseasePaymentPackageSignatureSource = fs.readFileSync(path.join(ROOT, "disease-payment-package-signature.js"), "utf8");
  const diseasePaymentHtml = fs.readFileSync(path.join(ROOT, "disease-payment.html"), "utf8");
  const diseasePaymentUiSource = fs.readFileSync(path.join(ROOT, "disease-payment.js"), "utf8");
  const diseasePaymentReadinessSource = fs.readFileSync(path.join(ROOT, "scripts", "disease-payment-readiness.js"), "utf8");
  const insurancePaymentOperatingModelSource = fs.readFileSync(path.join(ROOT, "insurance-payment-operating-model.js"), "utf8");
  const insurancePaymentAcceptanceSource = fs.readFileSync(path.join(ROOT, "scripts", "insurance-payment-acceptance.js"), "utf8");
  const envTemplateSource = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const deploymentSource = fs.readFileSync(path.join(ROOT, "DEPLOYMENT.md"), "utf8");
  const publicHealthSource = fs.readFileSync(path.join(ROOT, "scripts", "public-health-readiness.js"), "utf8");
  const publicHealthUiSource = fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8");
  const publicHealthHtml = fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8");
  const portalCss = fs.readFileSync(path.join(ROOT, "portal.css"), "utf8");
  const publicHealthEndpointVerificationSource = fs.readFileSync(path.join(ROOT, "public-health-external-endpoint-verification-service.js"), "utf8");
  const publicHealthEndpointVerificationDoc = fs.readFileSync(path.join(ROOT, "docs", "public-health-external-endpoint-verification.md"), "utf8");
  const publicHealthEndpointProbeRunnerSource = fs.readFileSync(path.join(ROOT, "public-health-external-endpoint-probe-runner.js"), "utf8");
  const publicHealthEndpointProbeCampaignSource = fs.readFileSync(path.join(ROOT, "public-health-external-endpoint-probe-campaign-service.js"), "utf8");
  const publicHealthEndpointProbeKeyProviderSource = fs.readFileSync(path.join(ROOT, "public-health-external-key-provider.js"), "utf8");
  const publicHealthEndpointProbeDoc = fs.readFileSync(path.join(ROOT, "docs", "public-health-external-active-probing.md"), "utf8");
  const publicHealthEndpointProbeCampaignDoc = fs.readFileSync(path.join(ROOT, "docs", "public-health-external-endpoint-probe-campaigns.md"), "utf8");
  const imagingCloudSource = fs.readFileSync(path.join(ROOT, "imaging-cloud.js"), "utf8");
  const imagingCloudReadinessSource = fs.readFileSync(path.join(ROOT, "scripts", "imaging-cloud-readiness.js"), "utf8");
  const imagingCloudProductionSource = fs.readFileSync(path.join(ROOT, "imaging-cloud-production.js"), "utf8");
  const physicalExaminationProductionSource = fs.readFileSync(path.join(ROOT, "physical-examination-production.js"), "utf8");
  const physicalExaminationStandaloneHtml = fs.readFileSync(path.join(ROOT, "physical-examination-standalone.html"), "utf8");
  const physicalExaminationStandaloneReadinessSource = fs.readFileSync(path.join(ROOT, "scripts", "physical-examination-standalone-readiness.js"), "utf8");
  const productionReleaseEvidenceSource = fs.readFileSync(path.join(ROOT, "scripts", "production-release-evidence-readiness.js"), "utf8");
  const digitalHospitalStandardsSource = fs.readFileSync(path.join(ROOT, "scripts", "digital-hospital-standards-readiness.js"), "utf8");
  const digitalHospitalStandardsHtml = fs.readFileSync(path.join(ROOT, "digital-hospital-standards.html"), "utf8");
  const digitalHospitalStandardsJs = fs.readFileSync(path.join(ROOT, "digital-hospital-standards.js"), "utf8");
  const digitalHospitalGovernanceSource = fs.readFileSync(path.join(ROOT, "digital-hospital-governance.js"), "utf8");
  const digitalHospitalSelfAssessmentSource = fs.readFileSync(path.join(ROOT, "digital-hospital-self-assessment.js"), "utf8");
  const digitalHospitalSelfAssessmentHtml = fs.readFileSync(path.join(ROOT, "digital-hospital-self-assessment.html"), "utf8");
  const digitalHospitalSelfAssessmentUi = fs.readFileSync(path.join(ROOT, "digital-hospital-self-assessment-ui.js"), "utf8");
  const digitalHospitalEvaluationSource = fs.readFileSync(path.join(ROOT, "digital-hospital-evaluation.js"), "utf8");
  const digitalHospitalEvaluationHtml = fs.readFileSync(path.join(ROOT, "digital-hospital-evaluation.html"), "utf8");
  const digitalHospitalEvaluationUi = fs.readFileSync(path.join(ROOT, "digital-hospital-evaluation-ui.js"), "utf8");
  const digitalHospitalPilotReadinessSource = fs.readFileSync(path.join(ROOT, "scripts", "digital-hospital-pilot-readiness.js"), "utf8");
  const healthDashboardSource = fs.readFileSync(path.join(ROOT, "scripts", "health-dashboard-summary.js"), "utf8");
  const healthDashboardHtml = fs.readFileSync(path.join(ROOT, "health-dashboard.html"), "utf8");
  const healthDashboardJs = fs.readFileSync(path.join(ROOT, "health-dashboard.js"), "utf8");
  const healthDashboardIndicatorDoc = fs.readFileSync(path.join(ROOT, "docs", "health-dashboard-indicator-center-report.md"), "utf8");
  const regionalDataSharingSource = fs.readFileSync(path.join(ROOT, "regional-data-sharing.js"), "utf8");
  const regionalDataSharingHtml = fs.readFileSync(path.join(ROOT, "regional-data-sharing.html"), "utf8");
  const platformSource = fs.readFileSync(path.join(ROOT, "platform.js"), "utf8");
  const platformHtml = fs.readFileSync(path.join(ROOT, "platform.html"), "utf8");
  const productionSecuritySource = fs.readFileSync(path.join(ROOT, "production-security.js"), "utf8");
  const productionGoNoGoSource = fs.readFileSync(path.join(ROOT, "production-go-no-go.js"), "utf8");
  const productionGoNoGoUi = fs.readFileSync(path.join(ROOT, "production-go-no-go-ui.js"), "utf8");
  const pilotAcceptanceSource = fs.readFileSync(path.join(ROOT, "pilot-acceptance.js"), "utf8");
  const pilotAcceptanceUi = fs.readFileSync(path.join(ROOT, "pilot-acceptance-ui.js"), "utf8");
  const pilotAcceptanceReadiness = fs.readFileSync(path.join(ROOT, "scripts", "pilot-acceptance-readiness.js"), "utf8");
  const pilotAcceptanceDoc = fs.readFileSync(path.join(ROOT, "docs", "pilot-acceptance-control-center.md"), "utf8");
  const pilotAlertingTemplate = fs.readFileSync(path.join(ROOT, "deploy", "pilot-alerting.env.template"), "utf8");
  const citizenSource = fs.readFileSync(path.join(ROOT, "citizen.js"), "utf8");
  const citizenHtml = fs.readFileSync(path.join(ROOT, "citizen.html"), "utf8");
  const citizenRecordsV3Source = fs.readFileSync(path.join(ROOT, "citizen-records-v3.js"), "utf8");
  const citizenRecordsReadinessSource = fs.readFileSync(path.join(ROOT, "scripts", "citizen-records-readiness.js"), "utf8");
  const serviceWorkerSource = fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8");
  const immunizationHtml = fs.readFileSync(path.join(ROOT, "immunization.html"), "utf8");
  const immunizationSource = fs.readFileSync(path.join(ROOT, "immunization.js"), "utf8");
  const immunizationScheduleSource = fs.readFileSync(path.join(ROOT, "immunization-schedule.js"), "utf8");
  const immunizationReadinessSource = fs.readFileSync(path.join(ROOT, "scripts", "immunization-readiness.js"), "utf8");
  const immunizationDoc = fs.readFileSync(path.join(ROOT, "docs", "immunization-program-2026.md"), "utf8");
  const productionDatabaseCutoverDoc = fs.readFileSync(path.join(ROOT, "docs", "production-database-cutover-center.md"), "utf8");
  const postgresMigrationPackageSource = fs.readFileSync(path.join(ROOT, "scripts", "postgres-migration-package.js"), "utf8");
  const postgresMigrationPackageDoc = fs.readFileSync(path.join(ROOT, "docs", "postgresql-migration-package.md"), "utf8");
  const postgresRuntimeSyncSource = fs.readFileSync(path.join(ROOT, "postgres-runtime-sync.js"), "utf8");
  const postgresProductionAdapterSource = fs.readFileSync(path.join(ROOT, "postgres-production-adapter.js"), "utf8");
  const postgresRuntimeSyncWorker = fs.readFileSync(path.join(ROOT, "scripts", "postgres-sync-worker.js"), "utf8");
  const postgresShadowReconcile = fs.readFileSync(path.join(ROOT, "scripts", "postgres-shadow-reconcile.js"), "utf8");
  const postgresPrimaryReadRehearsal = fs.readFileSync(path.join(ROOT, "scripts", "postgres-primary-read-rehearsal.js"), "utf8");
  const postgresProductionAdapterCli = fs.readFileSync(path.join(ROOT, "scripts", "postgres-production-adapter.js"), "utf8");
  const postgresRuntimeSyncDoc = fs.readFileSync(path.join(ROOT, "docs", "postgresql-runtime-sync.md"), "utf8");
  const postgresRuntimeSyncService = fs.readFileSync(path.join(ROOT, "deploy", "postgres-sync-worker.service.template"), "utf8");
  const postgresRuntimeSyncTimer = fs.readFileSync(path.join(ROOT, "deploy", "postgres-sync-worker.timer.template"), "utf8");
  const postgresShadowReconcileService = fs.readFileSync(path.join(ROOT, "deploy", "postgres-shadow-reconcile.service.template"), "utf8");
  const postgresShadowReconcileTimer = fs.readFileSync(path.join(ROOT, "deploy", "postgres-shadow-reconcile.timer.template"), "utf8");
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
  const physicalExamHighlightsSource = fs.readFileSync(path.join(ROOT, "physical-examination-highlights.js"), "utf8");
  const physicalExamServiceSource = fs.readFileSync(path.join(ROOT, "physical-examination-service.js"), "utf8");
  const physicalExamPage = fs.readFileSync(path.join(ROOT, "physical-examination.html"), "utf8");
  const physicalExamCitizenPage = fs.readFileSync(path.join(ROOT, "citizen.html"), "utf8");
  const physicalExamHighlightsDoc = fs.readFileSync(path.join(ROOT, "docs", "体检系统创新亮点设计与验收-2026-07-17.md"), "utf8");
  const escortHospitalInterfaceDoc = fs.readFileSync(path.join(ROOT, "docs", "escort-hospital-interface.md"), "utf8");
  const internetNursingDoc = fs.readFileSync(path.join(ROOT, "docs", "互联网护理服务模块说明.md"), "utf8");
  const internetNursingHighlightsSource = fs.readFileSync(path.join(ROOT, "internet-nursing-highlights.js"), "utf8");
  const internetNursingSource = fs.readFileSync(path.join(ROOT, "internet-nursing.js"), "utf8");
  const internetNursingHtml = fs.readFileSync(path.join(ROOT, "internet-nursing.html"), "utf8");
  const internetNursingReadinessSource = fs.readFileSync(path.join(ROOT, "scripts", "internet-nursing-readiness.js"), "utf8");
  const internetNursingHighlightDoc = fs.readFileSync(path.join(ROOT, "docs", "internet-nursing-highlight-center.md"), "utf8");
  const citizenProductionRequirementsDoc = fs.readFileSync(path.join(ROOT, "docs", "citizen-production-launch-requirements.md"), "utf8");
  const chronicLaunchCoreDoc = fs.readFileSync(path.join(ROOT, "docs", "chronic-launch-core.md"), "utf8");
  const chronicInformatizationSourceDoc = fs.readFileSync(path.join(ROOT, "docs", "chronic-informatization-source-inventory.md"), "utf8");
  const platformResearchReportDoc = fs.readFileSync(path.join(ROOT, "docs", "卫生健康信息平台研发报告.md"), "utf8");
  const productionGoLiveRequirementsDoc = fs.readFileSync(path.join(ROOT, "docs", "production-go-live-requirements.md"), "utf8");
  const onsiteLaunchMaterialsDoc = fs.readFileSync(path.join(ROOT, "docs", "on-site-launch-materials.md"), "utf8");
  const publicHealthDoc = fs.readFileSync(path.join(ROOT, "docs", "公共卫生信息化系统建设报告.md"), "utf8");
  const publicHealthPlanDoc = fs.readFileSync(path.join(ROOT, "docs", "公共卫生信息化下一步开发计划.md"), "utf8");
  const phase2ProposalPlanDoc = fs.readFileSync(path.join(ROOT, "docs", "二期可研对标差距与下一步开发计划.md"), "utf8");
  const platformProductionAuditSource = fs.readFileSync(path.join(ROOT, "scripts", "platform-production-audit.js"), "utf8");
  const platformProductionAuditDoc = fs.readFileSync(path.join(ROOT, "docs", "数智医院标准平台全程审计与生产前开发规划.md"), "utf8");
  const platformDevelopmentReportDoc = fs.readFileSync(path.join(ROOT, "docs", "数智医院标准平台开发报告与下一步计划-2026-07-13.md"), "utf8");
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
    assertFile("drug-consumable-about.html"),
    assertFile("server.js"),
    assertFile("public-health-external-endpoint-verification-service.js"),
    assertFile("docs/public-health-external-endpoint-verification.md"),
    assertFile("public-health-external-endpoint-probe-runner.js"),
    assertFile("docs/public-health-external-active-probing.md"),
    assertFile("public-health-external-endpoint-probe-campaign-service.js"),
    assertFile("docs/public-health-external-endpoint-probe-campaigns.md"),
    assertFile("session-store.js"),
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
    assertFile("physical-examination-highlights.js"),
    assertFile("docs/体检系统创新亮点设计与验收-2026-07-17.md"),
    assertFile("docs/production-observability-alerting.md"),
    { name: "module:physicalExaminationHighlights", ok: ["buildTrajectories", "translateReport", "buildActionCards", "buildExamPlan", "buildRepeatAvoidance", "buildRadiationLedger", "buildFamilyRiskMaps", "buildSimulation", "reviewReportQuality", "buildInstitutionBenchmarks", "buildCityRadar", "buildStandardsImpact", "create-passport", "revoke-passport"].every((marker) => physicalExamHighlightsSource.includes(marker)) && ["健康时光机", "报告质量啄木鸟", "城市健康雷达"].every((marker) => physicalExamPage.includes(marker)) && physicalExamCitizenPage.includes("我的体检健康时光机") && ["15类亮点", "小样本抑制", "不生成绕过认证的公共访问地址"].every((marker) => physicalExamHighlightsDoc.includes(marker)) && serverSource.includes("/api/physical-exams/highlights/actions") && manifestSource.includes("physical-examination:readiness"), detail: "physical-examination resident, clinical, quality, privacy and governance highlights are release-wired" },
    { name: "module:physicalExaminationSpecializedRouting", ok: ["EXAM_PROGRAMS", "physicalExamSpecializedIntakes", "awaiting-specialized-profile", "applySpecializedIntakeAction"].every((marker) => physicalExamServiceSource.includes(marker)) && physicalExamPage.includes("专项体检隔离与分流") && serverSource.includes("/api/physical-exams/specialized-intakes/:id/actions"), detail: "specialized examinations are isolated from adult general archives and have an auditable routing workflow" },
    assertFile("scripts/postgres-migration-package.js"),
    assertFile("docs/postgresql-migration-package.md"),
    assertFile("postgres-runtime-sync.js"),
    assertFile("postgres-production-adapter.js"),
    assertFile("scripts/postgres-sync-worker.js"),
    assertFile("scripts/postgres-shadow-reconcile.js"),
    assertFile("scripts/postgres-primary-read-rehearsal.js"),
    assertFile("scripts/postgres-production-adapter.js"),
    assertFile("docs/postgresql-runtime-sync.md"),
    assertFile("deploy/postgres-sync-worker.service.template"),
    assertFile("deploy/postgres-sync-worker.timer.template"),
    assertFile("deploy/postgres-shadow-reconcile.service.template"),
    assertFile("deploy/postgres-shadow-reconcile.timer.template"),
    assertFile("scripts/production-deployment-package.js"),
    assertFile("docs/production-deployment-automation.md"),
    assertFile("deploy/chronic-care-platform.service.template"),
    assertFile("docs/citizen-production-launch-requirements.md"),
    assertFile("docs/escort-hospital-interface.md"),
    assertFile("docs/internet-nursing-highlight-center.md"),
    assertFile("internet-nursing-highlights.js"),
    assertFile("scripts/onsite-launch-requirements.js"),
    assertFile("scripts/storage-admin.js"),
    assertFile("scripts/chronic-informatization-sources.js"),
    assertFile("docs/chronic-informatization-source-inventory.md"),
    assertFile("scripts/hybrid-deployment-readiness.js"),
    assertFile("scripts/data-governance-readiness.js"),
    assertFile("scripts/digital-hospital-standards-readiness.js"),
    assertFile("digital-hospital-governance.js"),
    assertFile("digital-hospital-self-assessment.js"),
    assertFile("digital-hospital-self-assessment.html"),
    assertFile("digital-hospital-self-assessment-ui.js"),
    assertFile("digital-hospital-evaluation.js"),
    assertFile("digital-hospital-evaluation.html"),
    assertFile("digital-hospital-evaluation-ui.js"),
    assertFile("scripts/digital-hospital-pilot-readiness.js"),
    assertFile("docs/数智医院六域规范控制矩阵-2026.md"),
    assertFile("scripts/phase2-proposal-readiness.js"),
    assertFile("scripts/phase2-catalog-readiness.js"),
    assertFile("scripts/phase2-joint-test-readiness.js"),
    assertFile("scripts/phase2-mutual-recognition-readiness.js"),
    assertFile("scripts/phase2-disease-reporting-readiness.js"),
    assertFile("scripts/phase2-clinical-assist-readiness.js"),
    assertFile("scripts/phase2-family-doctor-readiness.js"),
    assertFile("scripts/citizen-operations-readiness.js"),
    assertFile("scripts/commercial-crypto-readiness.js"),
    assertFile("production-security-acceptance.js"),
    assertFile("production-security.js"),
    assertFile("scripts/production-security-readiness.js"),
    assertFile("production-go-no-go.js"),
    assertFile("production-go-no-go-ui.js"),
    assertFile("scripts/production-go-no-go-readiness.js"),
    assertFile("docs/production-go-no-go-command-center.md"),
    assertFile("pilot-acceptance.js"),
    assertFile("pilot-acceptance-ui.js"),
    assertFile("scripts/pilot-acceptance-readiness.js"),
    assertFile("docs/pilot-acceptance-control-center.md"),
    assertFile("deploy/pilot-alerting.env.template"),
    assertFile("scripts/registration-journey-readiness.js"),
    assertFile("scripts/registration-integration-readiness.js"),
    assertFile("scripts/platform-production-audit.js"),
    assertFile("scripts/platform-capability-map.js"),
    assertFile("platform-go-live-slices.js"),
    assertFile("scripts/platform-go-live-slices.js"),
    assertFile("immunization.html"),
    assertFile("immunization.js"),
    assertFile("immunization-schedule.js"),
    assertFile("scripts/immunization-readiness.js"),
    assertFile("docs/immunization-program-2026.md"),
    assertFile("scripts/public-health-readiness.js"),
    assertFile("public-health-highlights-service.js"),
    assertFile("public-health-highlights.html"),
    assertFile("public-health-highlights.js"),
    assertFile("scripts/public-health-highlights-readiness.js"),
    assertFile("scripts/seed-public-health-highlights-snapshot.js"),
    assertFile("docs/公共卫生五件套功能说明与验收.md"),
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
    assertFile("docs/数智医院标准平台开发报告与下一步计划-2026-07-13.md"),
    assertFile("blood.html"),
    assertFile("blood.js"),
    assertFile("blood-domain.js"),
    assertFile("blood-master-data.js"),
    assertFile("blood-service.js"),
    assertFile("blood-recall.js"),
    assertFile("blood-transaction-service.js"),
    assertFile("scripts/blood-system-readiness.js"),
    assertFile("disease-payment-service.js"),
    assertFile("disease-payment-intake.js"),
    assertFile("disease-payment-local-package.js"),
    assertFile("disease-payment-package-signature.js"),
    assertFile("scripts/disease-payment-package-builder.js"),
    assertFile("config/disease-payment/templates/local-drg-package.template.json"),
    assertFile("config/disease-payment/templates/local-dip-package.template.json"),
    assertFile("disease-payment.html"),
    assertFile("scripts/disease-payment-readiness.js"),
    assertFile("scripts/production-release-evidence-readiness.js"),
    assertFile("docs/production-security-release-execution-pack.md"),
    assertFile("docs/evidence-templates/production-security-release/security-assessment.json"),
    assertFile("docs/evidence-templates/production-security-release/monitoring-drill.json"),
    assertFile("docs/evidence-templates/production-security-release/dr-rehearsal.json"),
    assertFile("docs/evidence-templates/production-security-release/site-acceptance.json"),
    assertFile("docs/evidence-templates/production-security-release/go-no-go.json"),
    assertFile("insurance-payment-operating-model.js"),
    assertFile("insurance-payment-production-handoff.js"),
    assertFile("online-payment-refunds.js"),
    assertFile("scripts/insurance-payment-acceptance.js"),
    assertFile("scripts/insurance-payment-evidence-packet.js"),
    assertFile("test/insurance-payment-public-api.test.js"),
    assertFile("docs/按病种付费系统实施说明.md"),
    assertFile("emergency.html"),
    assertFile("emergency.js"),
    assertFile("emergency-service.js"),
    assertFile("emergency-lifechain.js"),
    assertFile("emergency-lifechain-ui.js"),
    assertFile("emergency-production.js"),
    assertFile("scripts/emergency-readiness.js"),
    assertFile("docs/院前急救协同信息系统立项与标准基线-2026-07-15.md"),
    assertFile("docs/院前急救生产前上线控制说明.md"),
    assertFile("docs/院前急救系统拓扑与流程图集.md"),
    assertFile("docs/院前急救事件证据包接口说明.md"),
    assertFile("docs/emergency-sos-aed.md"),
    assertFile("docs/emergency-life-chain.md"),
    assertFile("test/emergency-lifechain.test.js"),
    assertFile("test/blood-recall-workflow.test.js"),
    assertFile("test/blood-transaction-service.test.js"),
    { name: "package:bloodSystemReadiness", ok: Boolean(pkg.scripts?.["blood-system:readiness"]), detail: pkg.scripts?.["blood-system:readiness"] || "missing" },
    { name: "package:diseasePaymentReadiness", ok: Boolean(pkg.scripts?.["disease-payment:readiness"] && pkg.scripts?.["disease-payment:test"] && pkg.scripts?.["disease-payment:package"]), detail: `${pkg.scripts?.["disease-payment:readiness"] || "missing"} / ${pkg.scripts?.["disease-payment:test"] || "missing"} / ${pkg.scripts?.["disease-payment:package"] || "missing"}` },
    { name: "package:insurancePaymentAcceptance", ok: Boolean(pkg.scripts?.["insurance-payment:check"] && pkg.scripts?.["insurance-payment:test"] && pkg.scripts?.["insurance-payment:acceptance"] && pkg.scripts?.["insurance-payment:evidence"]), detail: ["insurance-payment:check", "insurance-payment:test", "insurance-payment:acceptance", "insurance-payment:evidence"].filter((name) => !pkg.scripts?.[name]).join(",") || "T07 scripts registered" },
    { name: "package:productionReleaseEvidence", ok: Boolean(pkg.scripts?.["production-release:evidence:check"] && pkg.scripts?.["production-release:evidence:test"] && pkg.scripts?.["production-release:evidence:readiness"]), detail: "T11 evidence check, test and readiness commands are registered" },
    { name: "api:productionReleaseEvidenceSummary", ok: serverSource.includes("/api/production-release/evidence-readiness") && serverSource.includes("buildProductionReleaseEvidencePublicSummary") && serverSource.includes("productionReady: false") && productionReleaseEvidenceSource.includes("createEvidenceFingerprint") && productionReleaseEvidenceSource.includes("findSensitiveMaterial") && envTemplateSource.includes("PRODUCTION_RELEASE_EVIDENCE_DIR"), detail: "commission-only T11 summary uses only the server-controlled directory and keeps global production authorization closed" },
    { name: "api:insurancePaymentPublicWiring", ok: ["/api/online-payments/refunds", "/api/disease-payment/special-cases/disclosure", "expert-reselection|appeals|appeals\\/review", "/api/disease-payment/annual-clearances", "applyInsuranceCoreSettlementCallback", "syncRefundFromFinancialCallback", "authorizeInsurancePaymentAction(\"formal-grouping.receipt\"", "receiveTrustedFormalGroupingReceipt", "INSURANCE_PAYMENT_SYSTEM_SIGNATURE_INVALID"].every((marker) => serverSource.includes(marker)) && insurancePaymentOperatingModelSource.includes("T00_ROUTE_CONTRACTS") && insurancePaymentAcceptanceSource.includes("t00RoutesPending"), detail: "23 T07 routes and callback hooks use responsibility, trusted callback and organization-scope controls" },
    { name: "api:diseasePaymentFormalGroupingOperations", ok: ["/api/disease-payment/formal-grouping/operations", "/api/disease-payment/formal-grouping/jobs", "dispatch|receipts|fail|retry|reconcile"].every((marker) => serverSource.includes(marker)) && ["createFormalGroupingJob", "dispatchFormalGroupingJob", "receiveFormalGroupingReceipt", "retryFormalGroupingJob", "reconcileFormalGroupingDeadLetter", "backoffSeconds: [60, 120, 240]"].every((marker) => diseasePaymentIntakeSource.includes(marker)) && ["data-payment-section=\"formal-grouping-operations\"", "formal-grouping-job-list", "formal-grouping-dead-letter-list"].every((marker) => diseasePaymentHtml.includes(marker)) && ["formal-dispatch", "formal-fail", "formal-retry", "formal-reconcile", "/formal-grouping/jobs"].every((marker) => diseasePaymentUiSource.includes(marker)) && ["formal-grouping-async", "formal-grouping-compensation", "formalGrouping"].every((marker) => diseasePaymentReadinessSource.includes(marker)), detail: "formal grouping async dispatch, receipt, retry and dead-letter operations are release-gated" },
    { name: "api:diseasePaymentLocalPackageGovernance", ok: ["/api/disease-payment/local-packages", "/api/disease-payment/local-packages/activate-due", "/api/disease-payment/local-packages/simulation-jobs", "catalog|diff-report|impact-report", "compare|simulate|submit|review|publish|activate|rollback", "process|retry|cancel", "collectJson(req, 30_000_000)", "DISEASE_PAYMENT_TRUSTED_SIGNER_FINGERPRINTS"].every((marker) => serverSource.includes(marker)) && ["validateLocalPaymentPackage", "compareLocalPaymentPackage", "getLocalPaymentPackageCatalogPage", "createLocalPaymentPackageSimulationJob", "processLocalPaymentPackageSimulationJob", "activateDueLocalPaymentPackages", "rollbackLocalPaymentPackage", "local-medical-insurance-approved", "verifyPackageSignature"].every((marker) => diseasePaymentLocalPackageSource.includes(marker)) && ["canonicalStringify", "createPackageSignature", "publicKeyFingerprint", "verifyPackageSignature", "crypto.verify"].every((marker) => diseasePaymentPackageSignatureSource.includes(marker)) && ["data-payment-section=\"local-package-governance\"", "local-package-file", "local-package-report-list", "local-package-job-list", "activate-due-local-packages"].every((marker) => diseasePaymentHtml.includes(marker)) && ["renderLocalPackageGovernance", "local-package-job-create", "local-package-job-process", "local-package-review", "local-package-publish", "local-package-activate", "local-package-rollback"].every((marker) => diseasePaymentUiSource.includes(marker)) && ["local-package-validation", "local-package-impact", "local-package-diff", "local-package-release", "local-package-scheduling", "local-package-rollback", "local-package-pagination", "catalog-prefix-index", "local-package-batch-simulation", "local-package-signature"].every((marker) => diseasePaymentReadinessSource.includes(marker)), detail: "large catalog index, resumable simulation, trusted signature, scheduled activation and safe rollback governance is release-gated" },
    { name: "package:emergencyReadiness", ok: Boolean(pkg.scripts?.["emergency:readiness"] && pkg.scripts?.["emergency:test"]), detail: `${pkg.scripts?.["emergency:readiness"] || "missing"} / ${pkg.scripts?.["emergency:test"] || "missing"}` },
    { name: "package:hospitalOperationsRelease", ok: Boolean(pkg.scripts?.["hospital-operations:readiness"] && pkg.scripts?.["hospital-operations:release"] && pkg.scripts?.["hospital-operations:module-report"] && pkg.scripts?.["hospital-operations:brief-pdf"]), detail: ["hospital-operations:readiness", "hospital-operations:release", "hospital-operations:module-report", "hospital-operations:brief-pdf"].filter((name) => !pkg.scripts?.[name]).join(",") || "hospital operations release scripts present" },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["launch:smoke"] && pkg.scripts?.["onsite:launch-requirements"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["quality-safety:report"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["hospital-operations:readiness"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["regional-data-sharing:report"] && pkg.scripts?.["referral:readiness"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["drug-consumable:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["chronic:followup-readiness"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    assertFile("scripts/research-sandbox-readiness.js"),
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["research:sandbox"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["data-governance:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["health-dashboard:summary"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:priorityApplicationTemplates", ok: Boolean(pkg.scripts?.["priority-apps:templates"]), detail: pkg.scripts?.["priority-apps:templates"] || "missing" },
    { name: "package:policyCoverage", ok: Boolean(pkg.scripts?.["policy:coverage"]), detail: pkg.scripts?.["policy:coverage"] || "missing" },
    { name: "package:maternalChildReadiness", ok: Boolean(pkg.scripts?.["maternal-child:readiness"]), detail: pkg.scripts?.["maternal-child:readiness"] || "missing" },
    { name: "package:immunizationReadiness", ok: Boolean(pkg.scripts?.["immunization:readiness"]), detail: pkg.scripts?.["immunization:readiness"] || "missing" },
    { name: "package:publicHealthReadiness", ok: Boolean(pkg.scripts?.["public-health:readiness"]), detail: pkg.scripts?.["public-health:readiness"] || "missing" },
    { name: "package:publicHealthHighlightsReadiness", ok: Boolean(pkg.scripts?.["public-health:highlights:readiness"]), detail: pkg.scripts?.["public-health:highlights:readiness"] || "missing" },
    { name: "package:digitalHospitalStandards", ok: Boolean(pkg.scripts?.["digital-hospital:standards-readiness"]), detail: pkg.scripts?.["digital-hospital:standards-readiness"] || "missing" },
    { name: "package:digitalHospitalPilotReadiness", ok: Boolean(pkg.scripts?.["digital-hospital:pilot-readiness"]), detail: pkg.scripts?.["digital-hospital:pilot-readiness"] || "missing" },
    { name: "package:phase2ProposalReadiness", ok: Boolean(pkg.scripts?.["phase2:proposal-readiness"]), detail: pkg.scripts?.["phase2:proposal-readiness"] || "missing" },
    { name: "package:phase2CatalogReadiness", ok: Boolean(pkg.scripts?.["phase2:catalog-readiness"]), detail: pkg.scripts?.["phase2:catalog-readiness"] || "missing" },
    { name: "package:phase2JointTestReadiness", ok: Boolean(pkg.scripts?.["phase2:joint-test-readiness"]), detail: pkg.scripts?.["phase2:joint-test-readiness"] || "missing" },
    { name: "package:phase2MutualRecognitionReadiness", ok: Boolean(pkg.scripts?.["phase2:mutual-recognition-readiness"]), detail: pkg.scripts?.["phase2:mutual-recognition-readiness"] || "missing" },
    { name: "package:phase2DiseaseReportingReadiness", ok: Boolean(pkg.scripts?.["phase2:disease-reporting-readiness"]), detail: pkg.scripts?.["phase2:disease-reporting-readiness"] || "missing" },
    { name: "package:phase2ClinicalAssistReadiness", ok: Boolean(pkg.scripts?.["phase2:clinical-assist-readiness"]), detail: pkg.scripts?.["phase2:clinical-assist-readiness"] || "missing" },
    { name: "package:phase2FamilyDoctorReadiness", ok: Boolean(pkg.scripts?.["phase2:family-doctor-readiness"]), detail: pkg.scripts?.["phase2:family-doctor-readiness"] || "missing" },
    { name: "package:citizenOperationsReadiness", ok: Boolean(pkg.scripts?.["phase2:citizen-operations-readiness"]), detail: pkg.scripts?.["phase2:citizen-operations-readiness"] || "missing" },
    { name: "package:commercialCryptoReadiness", ok: Boolean(pkg.scripts?.["security:commercial-crypto-readiness"]), detail: pkg.scripts?.["security:commercial-crypto-readiness"] || "missing" },
    { name: "package:productionSecurityReadiness", ok: Boolean(pkg.scripts?.["security:production-readiness"]), detail: pkg.scripts?.["security:production-readiness"] || "missing" },
    { name: "package:productionGoNoGoReadiness", ok: Boolean(pkg.scripts?.["production:go-no-go-readiness"]), detail: pkg.scripts?.["production:go-no-go-readiness"] || "missing" },
    { name: "package:registrationJourneyReadiness", ok: Boolean(pkg.scripts?.["registration:journey-readiness"]), detail: pkg.scripts?.["registration:journey-readiness"] || "missing" },
    { name: "package:registrationIntegrationReadiness", ok: Boolean(pkg.scripts?.["registration:integration-readiness"]), detail: pkg.scripts?.["registration:integration-readiness"] || "missing" },
    { name: "package:platformProductionAudit", ok: Boolean(pkg.scripts?.["platform:production-audit"]), detail: pkg.scripts?.["platform:production-audit"] || "missing" },
    { name: "package:platformCapabilityMap", ok: Boolean(pkg.scripts?.["platform:capability-map"]), detail: pkg.scripts?.["platform:capability-map"] || "missing" },
    { name: "package:platformGoLiveSlices", ok: Boolean(pkg.scripts?.["platform:go-live-slices"]), detail: pkg.scripts?.["platform:go-live-slices"] || "missing" },
    { name: "package:platformStandardsLedgers", ok: Boolean(pkg.scripts?.["platform:standards-ledgers"]), detail: pkg.scripts?.["platform:standards-ledgers"] || "missing" },
    { name: "package:objectStorageReadiness", ok: Boolean(pkg.scripts?.["object-storage:readiness"]), detail: pkg.scripts?.["object-storage:readiness"] || "missing" },
    { name: "package:financialGatewayReadiness", ok: Boolean(pkg.scripts?.["financial-gateway:readiness"]), detail: pkg.scripts?.["financial-gateway:readiness"] || "missing" },
    { name: "package:escortReadiness", ok: Boolean(pkg.scripts?.["escort:readiness"]), detail: pkg.scripts?.["escort:readiness"] || "missing" },
    { name: "package:internetNursingReadiness", ok: Boolean(pkg.scripts?.["internet-nursing:readiness"]), detail: pkg.scripts?.["internet-nursing:readiness"] || "missing" },
    { name: "package:multiPracticeReadiness", ok: Boolean(pkg.scripts?.["multi-practice:readiness"]), detail: pkg.scripts?.["multi-practice:readiness"] || "missing" },
    { name: "package:hybridDeploymentReadiness", ok: Boolean(pkg.scripts?.["hybrid:deployment-readiness"]), detail: pkg.scripts?.["hybrid:deployment-readiness"] || "missing" },
    { name: "package:postgresMigrationPackage", ok: Boolean(pkg.scripts?.["postgres:migration-package"] && pkg.scripts?.["postgres:migration-verify"]), detail: `${pkg.scripts?.["postgres:migration-package"] || "missing"} / ${pkg.scripts?.["postgres:migration-verify"] || "missing"}` },
    { name: "package:postgresSyncWorker", ok: Boolean(pkg.scripts?.["postgres:sync-worker"]), detail: pkg.scripts?.["postgres:sync-worker"] || "missing" },
    { name: "package:postgresShadowReconciliation", ok: Boolean(pkg.scripts?.["postgres:sync-bootstrap"] && pkg.scripts?.["postgres:shadow-reconcile"]), detail: `${pkg.scripts?.["postgres:sync-bootstrap"] || "missing"} / ${pkg.scripts?.["postgres:shadow-reconcile"] || "missing"}` },
    { name: "package:postgresPrimaryReadAdapter", ok: Boolean(pkg.scripts?.["postgres:primary-read-rehearsal"] && pkg.scripts?.["postgres:adapter-status"] && pkg.scripts?.["postgres:adapter-verify"]), detail: `${pkg.scripts?.["postgres:primary-read-rehearsal"] || "missing"} / ${pkg.scripts?.["postgres:adapter-status"] || "missing"} / ${pkg.scripts?.["postgres:adapter-verify"] || "missing"}` },
    { name: "package:chronicInstitutionInterfaces", ok: Boolean(pkg.scripts?.["chronic:institution-interfaces"]), detail: pkg.scripts?.["chronic:institution-interfaces"] || "missing" },
    { name: "package:chronicLaunchCore", ok: Boolean(pkg.scripts?.["chronic:launch-core"]), detail: pkg.scripts?.["chronic:launch-core"] || "missing" },
    { name: "package:chronicInformatizationSources", ok: Boolean(pkg.scripts?.["chronic:informatization-sources"]), detail: pkg.scripts?.["chronic:informatization-sources"] || "missing" },
    { name: "docs:chronicLaunchCore", ok: ["GET /api/chronic/launch-core", "POST /api/chronic/launch-core/actions", "launch-core:actionClosure", "launch-core:siteSignoffs", "HIS/EMR/LIS/PACS"].every((marker) => chronicLaunchCoreDoc.includes(marker)), detail: "chronic launch core API, closure, site signoff, and institution joint-test evidence are documented" },
    { name: "docs:chronicInformatizationSources", ok: ["screening-tiered-management", "institution-integration-launch", "monitoring-quality-public-health", "release/chronic-informatization-sources.md"].every((marker) => chronicInformatizationSourceDoc.includes(marker)) && manifestSource.includes("chronic-informatization-sources"), detail: "chronic source inventory maps source files to capability tracks and release artifacts" },
    { name: "docs:platformResearchReport", ok: ["政策文件依据", "已实现总体能力", "下一步开发计划", "internet-nursing:readiness", "health-dashboard:summary", "release:report"].every((marker) => platformResearchReportDoc.includes(marker)), detail: "platform R&D report documents policy basis, implemented capabilities, next plan, and release evidence" },
    { name: "docs:platformProductionAudit", ok: ["审计结论", "正式生产前已实现的主要功能", "生产割接差距", "下一步开发规划", "正式上线退出条件", "10/10"].every((marker) => platformProductionAuditDoc.includes(marker)) && platformProductionAuditSource.includes("PRODUCTION_BLOCKERS") && platformProductionAuditSource.includes("ROADMAP"), detail: "platform production audit documents implemented capabilities, owned blockers, phased roadmap and formal exit criteria" },
    { name: "docs:platformDevelopmentReport20260713", ok: ["本轮主要开发成果", "安全基线入队", "PostgreSQL 只读影子核对", "SQLite v10 差异处置闭环", "验证证据", "当前生产阻断项", "下一步开发计划", "P0：0-30 天", "P1：31-60 天", "P2：61-90 天", "88/88", "311/311", "255/256", "234/234"].every((marker) => platformDevelopmentReportDoc.includes(marker)), detail: "dated platform development report records baseline bootstrap, read-only reconciliation, difference case workflow, verification evidence, blockers and 30/60/90-day plan" },
    { name: "api:productionIdentityMessageAdapters", ok: ["fetchOidcUserInfo", "refreshOidcAccessToken", "revokeOidcToken", "fetchIdentityDirectory", "sendSmsVerificationCode", "digestPhoneVerificationCode", "identityLifecycleReady", "verifySmsDeliveryCallback", "applySmsDeliveryCallback", "buildSmsDeliveryCenter", "SMS_CALLBACK_REPLAY_DETECTED", "productionAdapterCenter"].every((marker) => productionAdaptersSource.includes(marker)) && ["/api/auth/oidc/exchange", "/api/auth/oidc/refresh", "/api/auth/oidc/revoke", "/api/auth/identity-lifecycle", "/api/auth/identity-directory/preview", "/api/auth/identity-directory/bind", "/api/auth/identity-directory/apply", "/api/auth/sms-delivery-callback", "/api/auth/sms-deliveries", "smsDeliveryReceipts", "BIND EXTERNAL IDENTITY", "IDENTITY_BINDING_SUBJECT_CONFLICT", "IDENTITY_BINDING_REASSIGNMENT_BLOCKED", "IDENTITY_DIRECTORY_SELF_DEACTIVATION_BLOCKED", "IDENTITY_DIRECTORY_LAST_COMMISSION_BLOCKED", "APPLY IDENTITY DIRECTORY DEACTIVATIONS", "codeDigest"].every((marker) => serverSource.includes(marker)) && ["identity-lifecycle-center", "sms-delivery-status", "sms-delivery-receipts"].every((marker) => platformHtml.includes(marker)) && ["renderIdentityLifecycleCenter", "runIdentityBindingAction", "runIdentityDirectoryAction", "smsDelivery"].every((marker) => platformSource.includes(marker)) && ["OIDC_TOKEN_URL=", "OIDC_REVOCATION_URL=", "IDENTITY_DIRECTORY_URL=", "IDENTITY_DIRECTORY_TOKEN=", "SMS_DELIVERY_CALLBACK_SECRET="].every((marker) => envTemplateSource.includes(marker)) && ["受控本地账号绑定", "不按同名用户名自动回退", "不自动开户", "不自动提权", "不自动复活", "最终送达回调", "回调验签", "重放", "现场联合测试回执"].every((marker) => productionAdaptersDoc.includes(marker)), detail: "OIDC subject binding, refresh, revocation and safe SCIM lifecycle plus signed, replay-safe, ordered SMS final-delivery callbacks, persisted operations receipts and explicit provider joint-test boundaries are wired" },
    { name: "security:productionRuntimeBoundary", ok: ["LOCAL_PASSWORD_LOGIN_DISABLED", "assertProductionRuntimeSecurity", "PRODUCTION_SESSION_SECRET_INVALID", "PRODUCTION_SESSION_STORE_INVALID", "PRODUCTION_SESSION_RETENTION_INVALID", "PRODUCTION_FINANCIAL_CALLBACK_INVALID", "PostgresSessionStore", "hydrateRequestSession", "probeSessionStoreStatus", "startServerAsync", "SESSION_STORE_UNAVAILABLE", "sessionStoreStatus", "cleanupRuntimeSessions", "scheduleSessionCleanup", "/api/auth/sessions/cleanup", "SESSION_CLEANUP_CONFIRMATION_REQUIRED", "script-src-attr 'none'", "applyResidentScope", "canManageResidentProfile"].every((marker) => serverSource.includes(marker)) && ["SqliteSessionStore", "class PostgresSessionStore", "auth_sessions", "revokeByUserIds", "async hydrate", "async health", "cleanup(options", "deletedExpired", "deletedRevoked", "crossProcess: true", "crossHost: true", "centralized: true"].every((marker) => sessionStoreSource.includes(marker)) && ["同一主机共享数据目录可跨进程撤销", "多主机中央会话可跨节点撤销", "会话保留"].every((marker) => platformSource.includes(marker)) && ["SESSION_STORE=sqlite", "SESSION_TOPOLOGY=single-host", "SESSION_EXPIRED_RETENTION_DAYS=", "SESSION_REVOKED_RETENTION_DAYS=", "SESSION_CLEANUP_INTERVAL_MS="].every((marker) => envTemplateSource.includes(marker)) && authSource.includes("认证服务暂不可用，请稍后重试") && [bloodBusinessSource, bloodRecallSource].every((source) => source.includes("escapeHtml")) && ["生产安全边界", "PostgreSQL 中央会话表", "POST /api/auth/sessions/cleanup"].every((marker) => productionAdaptersDoc.includes(marker)), detail: "production local passwords, weak signing and callback secrets, and in-memory session stores are blocked; single-host and centralized multi-host session revocation, health probes, retention cleanup, operations visibility, browser auth, resident scoping, CSP and persistent HTML fields fail closed" },
    { name: "api:productionHospitalConnectors", ok: ["dispatchHospitalRequest", "hospitalConnectorCenter", "X-Idempotency-Key", "X-Signature", "HOSPITAL_ADAPTER_MAX_ATTEMPTS"].every((marker) => hospitalConnectorsSource.includes(marker)) && ["/api/integration/adapters", "/api/integration/dispatch", "provider-accepted", "direction === \"outbound\""].every((marker) => serverSource.includes(marker)) && ["联合测试回执", "适配器基础通过不等于医院接口已正式验收"].every((marker) => hospitalConnectorsDoc.includes(marker)), detail: "HIS EMR LIS PACS and appointment outbound connectors are runtime-wired with signing, idempotency, receipts, real retry and site boundaries" },
    { name: "api:secureObjectStorage", ok: ["createObjectUploadIntent", "finalizeObjectUpload", "createObjectDownloadIntent", "applyObjectLifecycle", "malware scan did not pass"].every((marker) => objectStorageSource.includes(marker)) && ["/api/attachments/storage", "/api/attachments/upload-intents", "attachmentCompleteMatch", "attachmentDownloadMatch", "attachmentActionMatch", "secureAttachments"].every((marker) => serverSource.includes(marker)) && objectStorageReadiness.includes("objectStorage:releaseWiring") && ["适配器基础通过不等于真实附件存储已经正式验收", "WORM/对象锁"].every((marker) => objectStorageDoc.includes(marker)), detail: "secure attachment metadata, upload completion, server-side malware scan, download authorization and lifecycle controls are runtime-wired" },
    { name: "api:financialGateways", ok: ["dispatchFinancialRequest", "financialGatewayCenter", "verifyFinancialCallback", "applyFinancialCallback", "createFinancialReconciliationRun", "FINANCIAL_CALLBACK_REPLAY_DETECTED", "amount-mismatch", "superseded-receipt", "FORBIDDEN_PAYLOAD_KEYS", "FINANCIAL_GATEWAY_MAX_ATTEMPTS"].every((marker) => financialGatewaysSource.includes(marker)) && ["/api/financial-gateways", "/api/financial-gateways/dispatch", "/api/financial-gateways/callbacks/", "/api/financial-gateways/operations", "/api/financial-gateways/reconciliation-runs", "financialReconciliationRuns", "adapterType: \"financial\"", "event.adapterType === \"financial\""].every((marker) => serverSource.includes(marker)) && ["financial-gateway-operations-center", "financial-gateway-callback-events", "financial-reconciliation-runs"].every((marker) => platformHtml.includes(marker)) && ["renderFinancialGatewayOperationsCenter", "loadFinancialGatewayOperationsCenter"].every((marker) => platformSource.includes(marker)) && ["FINANCIAL_CALLBACK_SECRET=", "FINANCIAL_CALLBACK_MAX_SKEW_SECONDS="].every((marker) => envTemplateSource.includes(marker)) && financialGatewayReadiness.includes("financialGateway:operationsUi") && ["适配器基础通过不等于支付、医保或电子证照已经正式验收", "签名回调代码就绪", "摘要级日终对账", "现场联合测试回执"].every((marker) => financialGatewaysDoc.includes(marker)), detail: "payment insurance and certificate gateways are runtime-wired with outbound signing, minimized payloads, signed replay-safe amount-aware callbacks, digest-only daily reconciliation, operations UI and explicit site boundaries" },
    { name: "monitoring:alertRouting", ok: ["dispatchAlert", "alertRoutingCenter", "FORBIDDEN_ALERT_KEYS", "ALERTING_MAX_ATTEMPTS", "X-Idempotency-Key"].every((marker) => observabilityAlertingSource.includes(marker)) && ["/api/observability/alerts", "/api/observability/alerts/dispatch", "/api/observability/alert-deliveries/", "observabilityAlertDeliveries", "alert-delivery-recovered"].every((marker) => serverSource.includes(marker)) && ["observability-alert-status", "observability-alert-deliveries"].every((marker) => operationsHtml.includes(marker)) && ["renderObservabilityAlertCenter", "data-observability-alert-action", "retryObservabilityAlert"].every((marker) => operationsSource.includes(marker)) && ["monitoring:alertAdapter", "monitoring:productionBoundary", "env:ALERTING.routes"].every((marker) => monitoringReadinessSource.includes(marker)) && ["告警适配器基础通过不等于生产监控已经正式验收", "去标识化", "失败进入运维事件", "CUTOVER_MONITORING_SIGNOFF"].every((marker) => observabilityAlertingDoc.includes(marker)), detail: "signed and minimized SIEM/webhook routing, persisted receipts, retry incidents, UI and explicit production acceptance boundary are wired" },
    { name: "env:observabilityAlerting", ok: ["SIEM_ENDPOINT=", "SIEM_SIGNING_SECRET=", "ALERT_WEBHOOK_URL=", "ALERTING_MAX_ATTEMPTS="].every((marker) => envTemplateSource.includes(marker)) && ["SIEM_ENDPOINT", "SIEM_SIGNING_SECRET", "ALERTING_MAX_ATTEMPTS"].every((marker) => deploymentSource.includes(marker)), detail: "SIEM/webhook alert routing environment contract is documented" },
    { name: "snapshot:observabilityAlertDeliveries", ok: Array.isArray(data.observabilityAlertDeliveries), detail: `${data.observabilityAlertDeliveries?.length || 0} persisted alert delivery receipts` },
    { name: "snapshot:smsDeliveryReceipts", ok: Array.isArray(data.smsDeliveryReceipts), detail: `${data.smsDeliveryReceipts?.length || 0} persisted masked SMS delivery receipts` },
    { name: "snapshot:financialReconciliationRuns", ok: Array.isArray(data.financialReconciliationRuns), detail: `${data.financialReconciliationRuns?.length || 0} persisted digest-only financial reconciliation runs` },
    { name: "deployment:immutablePackage", ok: ["buildProductionDeploymentPackage", "verifyProductionDeploymentPackage", "DEPLOYMENT_ARTIFACT_DIGEST", "valuesPersisted", "requirePreviousArtifactDigest", "rollback:snapshot", "/api/live", "process-liveness", "dependency-readiness"].every((marker) => productionDeploymentPackageSource.includes(marker)) && ["NoNewPrivileges=true", "ProtectSystem=strict", "ReadWritePaths=__DATA_DIR__ __LOG_DIR__", "EnvironmentFile=__SECRET_ENV_FILE__"].every((marker) => productionServiceTemplate.includes(marker)) && ["deployment:package", "deployment:verify"].every((marker) => JSON.stringify(pkg.scripts || {}).includes(marker)) && ["deployment:package -- --strict", "deployment:verify"].every((marker) => ciSource.includes(marker)) && ["Vault、KMS 或容器/进程编排器注入密钥", "部署包校验通过不等于生产环境已经正式验收"].every((marker) => productionDeploymentDoc.includes(marker)), detail: "immutable runtime digest, split liveness/readiness probes, secret-reference boundary, hardened service template, CI verification and rollback prerequisites are wired" },
    { name: "deployment:packageRuntimeVerification", ok: productionDeploymentPackage.ok && productionDeploymentVerification.ok && /^sha256:[a-f0-9]{64}$/.test(productionDeploymentPackage.artifact.digest), detail: `${productionDeploymentPackage.artifact.files.length} runtime files / ${productionDeploymentPackage.artifact.digest}` },
    { name: "deployment:releaseWiring", ok: manifestSource.includes("production-deployment-package.md") && manifestSource.includes("deployment:package") && fs.readFileSync(path.join(ROOT, "scripts", "release-report.js"), "utf8").includes("deploymentPackage:readiness"), detail: "deployment package is indexed by release manifest and aggregated release report" },
    { name: "snapshot:collections", ok: requiredCollections.every((key) => data[key]), detail: requiredCollections.filter((key) => !data[key]).join(",") || "all present" },
    { name: "snapshot:regionalDataSharing", ok: (data.regionalSharingPackages || []).length >= 3 && (data.regionalSharingAccessReviews || []).length >= 1 && serverSource.includes("/api/regional-data-sharing"), detail: `${data.regionalSharingPackages?.length || 0} packages, ${data.regionalSharingAccessReviews?.length || 0} access reviews` },
    { name: "snapshot:regionalHandoffRuntime", ok: ["/api/regional-data-sharing/handoff-report", "buildRegionalHandoffReport", "renderRegionalHandoffMarkdown"].every((marker) => serverSource.includes(marker)) && ["regional-handoff-report-action", "regional-handoff-report"].every((marker) => regionalDataSharingHtml.includes(marker)) && ["generateRegionalHandoffReport", "/api/regional-data-sharing/handoff-report"].every((marker) => regionalDataSharingSource.includes(marker)), detail: "regional referral handoff report API, role-scoped checklist UI and runtime no-merge boundary are wired" },
    { name: "snapshot:escortService", ok: (data.escortServiceProviders || []).length >= 3 && (data.escortWorkers || []).length >= 4 && (data.escortServiceOrders || []).length >= 3 && serverSource.includes("/api/escort-services/dashboard"), detail: `${data.escortServiceProviders?.length || 0} providers, ${data.escortWorkers?.length || 0} workers, ${data.escortServiceOrders?.length || 0} orders` },
    { name: "docs:escortHospitalInterface", ok: escortHospitalInterfaceDoc.includes("POST /api/escort-services/orders/:id/hospital-handoff") && escortHospitalInterfaceDoc.includes("hospitalCode") && serverSource.includes("hospital-handoff"), detail: "escort hospital handoff API contract is documented and implemented" },
    { name: "snapshot:internetNursing", ok: (data.internetNursingInstitutions || []).length >= 2 && (data.internetNursingNurses || []).length >= 2 && (data.internetNursingOrders || []).length >= 3 && serverSource.includes("/api/internet-nursing/dashboard"), detail: `${data.internetNursingInstitutions?.length || 0} institutions, ${data.internetNursingNurses?.length || 0} nurses, ${data.internetNursingOrders?.length || 0} orders` },
    { name: "snapshot:internetNursingAuth", ok: (data.authUsers || []).some((item) => item.username === "nurse" && item.password === "123456" && item.home === "internet-nursing.html" && item.nurseId === "inn-001") && serverSource.includes('username: "nurse"') && serverSource.includes('password: "123456"'), detail: "nurse workstation demo account is seeded" },
    { name: "module:internetNursingHighlights", ok: ["smart-dispatch", "risk-score", "live-trace", "video-consent", "voice-record", "family-collaboration", "quality-control", "regulatory-dashboard", "payment-closure", "evidence-workbench"].every((marker) => internetNursingHighlightsSource.includes(marker)) && internetNursingSource.includes("renderNursingInnovationCenter") && internetNursingHtml.includes("nursing-highlight-center") && serverSource.includes("buildInternetNursingInnovationCenter") && internetNursingReadinessSource.includes("nursing:highlightFeatures") && internetNursingHighlightDoc.includes("Ten Highlight Functions"), detail: "10 Internet+ Nursing highlight features are wired through service, page, API, readiness evidence and handoff document" },
    { name: "snapshot:multiPractice", ok: (data.doctorProfiles || []).length >= 2 && (data.multiPracticeApplications || []).length >= 2 && serverSource.includes("/api/multi-practice-registry") && serverSource.includes("multiPracticeSummary"), detail: `${data.doctorProfiles?.length || 0} doctors, ${data.multiPracticeApplications?.length || 0} applications` },
    { name: "docs:internetNursing", ok: internetNursingDoc.includes("flowchart TD") && internetNursingDoc.includes("nurse / 123456") && internetNursingDoc.includes("/api/internet-nursing/orders/:id/actions"), detail: "internet nursing module handoff document is complete" },
    { name: "docs:citizenAccountProvisioning", ok: ["居民主索引管理员", "平台账号管理员", "authUsers", "securityEvents", "dataAccessLogs"].every((marker) => citizenProductionRequirementsDoc.includes(marker)), detail: "citizen launch requirements document account owners and audit evidence" },
    { name: "docs:citizenExternalDependencyOwners", ok: ["platform-ops", "identity-integration", "resident-master-index", "security-compliance", "mobile-release", "required-before-production", "上线阻断口径", "上线前必须归档的证据", "现场验收动作"].every((marker) => citizenProductionRequirementsDoc.includes(marker)), detail: "citizen launch requirements document production dependency owners, blockers, evidence, and onsite acceptance" },
    { name: "docs:productionGoLiveRequirements", ok: productionGoLiveRequirementsDoc.includes("GL-01") && productionGoLiveRequirementsDoc.includes("launch:smoke -- --base-url") && productionGoLiveRequirementsDoc.includes("发布阻断条件"), detail: "real production go-live requirements are documented" },
    { name: "docs:onsiteLaunchMaterials", ok: ["GLM-01", "GLM-04", "GLM-05", "GLM-08", "GLM-10", "CIT-01", "CIT-06", "launch:smoke -- --base-url"].every((marker) => onsiteLaunchMaterialsDoc.includes(marker)), detail: "on-site launch material checklist covers platform and citizen evidence" },
    { name: "ui:immunizationLaunchBoard", ok: ["immunization-launch-readiness", "immunization-launch-board", "renderLaunchBoard", "launchRequirementBadgeClass"].every((marker) => `${immunizationHtml}\n${immunizationSource}`.includes(marker)), detail: "immunization launch blockers and evidence ledger are visible in the standalone page" },
    { name: "rules:immunizationLaunchRequirements", ok: ["LAUNCH_REQUIREMENTS", "registry-interface", "inventory-cold-chain", "adverse-event-monitoring", "onsite-signoff-drill"].every((marker) => immunizationScheduleSource.includes(marker)) && ["launch:requirements", "launch:evidence-ledger", "launch:production-boundary"].every((marker) => immunizationReadinessSource.includes(marker)), detail: "immunization launch requirements, evidence ledger and production boundary are machine-checked" },
    { name: "docs:immunizationProductionGate", ok: ["Production launch gate", "formal production go-live", "Registry interface", "Inventory and cold-chain", "blocked-until-site-evidence-signed"].every((marker) => immunizationDoc.includes(marker)), detail: "immunization production launch gate documents registry, cold-chain, AEFI, consent, audit and signoff evidence" },
    { name: "api:siteLaunchEvidence", ok: serverSource.includes("/api/site-launch-evidence") && serverSource.includes("siteLaunchEvidence") && manifestSource.includes("site-launch-evidence"), detail: "runtime site launch evidence ledger API is wired" },
    { name: "snapshot:interfaceReadiness", ok: p0Interfaces.length >= 4 && p0Interfaces.every((item) => item.id && item.owner && item.status && item.next), detail: `${p0Interfaces.length} P0 interface tracks` },
    { name: "snapshot:securityAcceptance", ok: securityAcceptanceLedger.length >= 4 && securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), detail: `${securityAcceptanceLedger.length} security acceptance items` },
    { name: "snapshot:qualitySafety", ok: Array.isArray(data.qualitySafetyEvents) && data.qualitySafetyEvents.length >= 3 && Array.isArray(data.qualityRectificationOrders) && data.qualityRectificationOrders.length >= 1, detail: `${data.qualitySafetyEvents?.length || 0} events, ${data.qualityRectificationOrders?.length || 0} rectifications` },
    { name: "ui:digitalHospitalStandards", ok: digitalHospitalStandardsHtml.includes('requireRole(["commission"])') && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"standard-center\"") && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"launch-readiness\"") && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"production-evidence-packets\"") && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"launch-command-briefs\"") && digitalHospitalStandardsHtml.includes("data-digital-hospital-section=\"formal-cutover-approvals\"") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_STANDARD_DOMAINS") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_WORKFLOW"), detail: "digital hospital standards page, role guard, standard model, workflow, launch readiness board, production evidence packets, command briefs and formal cutover approval desk are wired" },
    { name: "ui:digitalHospitalPolicyGovernance", ok: ["data-digital-hospital-section=\"policy-register\"", "data-digital-hospital-section=\"control-matrix\"", "digital-hospital-policy-review-form", "digital-hospital-control-action-form", "digital-hospital-control-no-pii"].every((marker) => digitalHospitalStandardsHtml.includes(marker)) && ["DIGITAL_HOSPITAL_POLICY_REGISTER", "DIGITAL_HOSPITAL_CONTROL_MATRIX", "DIGITAL_HOSPITAL_CONTROL_MATRIX_ENDPOINT", "renderPolicyRegister", "renderControlMatrix", "recordDigitalHospitalPolicyReview", "recordDigitalHospitalControlAction"].every((marker) => digitalHospitalStandardsJs.includes(marker)), detail: "six-domain policy register, lifecycle review and auditable control remediation desk are visible" },
    { name: "digitalHospitalStandards:readiness", ok: ["digitalHospital:standardDomains", "digitalHospital:workflowLoop", "digitalHospital:officialSources", "digitalHospital:apiContract", "digitalHospital:controlRemediation", "digitalHospital:selfAssessment", "digitalHospital:launchReadiness", "digitalHospital:releaseWiring"].every((marker) => digitalHospitalStandardsSource.includes(marker)) && digitalHospitalStandardsSource.includes("production-evidence-packets") && digitalHospitalStandardsSource.includes("launch-command-briefs") && digitalHospitalStandardsSource.includes("formal-cutover-approvals"), detail: "digital hospital standards readiness covers domains, control remediation, hospital self-assessment, launch evidence and release wiring" },
    { name: "api:digitalHospitalStandards", ok: ["/api/digital-hospital/standards", "/api/digital-hospital/control-matrix", "/api/digital-hospital/launch-readiness", "/api/digital-hospital/production-evidence-packets", "/api/digital-hospital/launch-command-briefs", "/api/digital-hospital/formal-cutover-approvals", "buildDigitalHospitalStandardsOverview", "buildDigitalHospitalControlMatrixBoard", "buildDigitalHospitalLaunchReadiness", "buildDigitalHospitalLaunchCommandBriefBoard", "buildDigitalHospitalFormalCutoverApprovalBoard", "seedDigitalHospitalStandards", "seedDigitalHospitalProductionEvidencePackets", "seedDigitalHospitalLaunchCommandBriefs", "seedDigitalHospitalFormalCutoverApprovals", "digitalHospitalEvidencePackets", "digitalHospitalLaunchRequirements", "digitalHospitalProductionEvidencePackets", "digitalHospitalLaunchCommandBriefs", "digitalHospitalFormalCutoverApprovals", "digitalHospitalRiskItems"].every((marker) => serverSource.includes(marker)) && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_API_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_CONTROL_MATRIX_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_LAUNCH_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_PRODUCTION_EVIDENCE_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_COMMAND_BRIEF_ENDPOINT") && digitalHospitalStandardsJs.includes("DIGITAL_HOSPITAL_FORMAL_CUTOVER_APPROVAL_ENDPOINT") && digitalHospitalStandardsJs.includes("HealthCityAuth?.authFetch"), detail: "digital hospital standards API, launch readiness gate, production evidence packets, command briefs, formal cutover approvals, seed data and frontend fetch fallback are wired; control remediation API is included" },
    { name: "api:digitalHospitalPolicyGovernance", ok: ["/api/digital-hospital/policy-register", "/api/digital-hospital/policy-register/:id/actions", "/api/digital-hospital/control-matrix", "/api/digital-hospital/control-matrix/:id/actions", "buildDigitalHospitalPolicyRegisterBoard", "buildDigitalHospitalControlMatrixBoard", "normalizeDigitalHospitalPolicyReview", "normalizeDigitalHospitalControlAction", "digitalHospitalPolicyRegister", "digitalHospitalControlMatrix"].every((marker) => serverSource.includes(marker)) && ["seedDigitalHospitalPolicyRegister", "seedDigitalHospitalControlMatrix", "historical-planning", "local-supplement-required", "independent reviewer"].every((marker) => digitalHospitalGovernanceSource.includes(marker)), detail: "policy lifecycle and control remediation persist evidence, independent review and audit history" },
    { name: "api:digitalHospitalSelfAssessment", ok: ["/api/digital-hospital/self-assessments", "/api/digital-hospital/self-assessments/:id/actions", "buildDigitalHospitalSelfAssessmentBoard", "createDigitalHospitalSelfAssessment", "normalizeDigitalHospitalSelfAssessmentAction", "digitalHospitalSelfAssessments"].every((marker) => serverSource.includes(marker)) && ["DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS", "assign-assessment", "save-draft", "submit-assessment", "start-preliminary-review", "escalate-expert-review", "record-expert-opinion", "request-correction", "accept-assessment"].every((marker) => digitalHospitalSelfAssessmentSource.includes(marker)) && digitalHospitalSelfAssessmentHtml.includes('requireRole(["commission", "institution"])') && digitalHospitalSelfAssessmentUi.includes("recordDigitalSelfAssessmentAction") && digitalHospitalSelfAssessmentUi.includes("digital-self-assessment-dispute-indicators"), detail: "institution-scoped self-assessment, correction and tiered independent expert review workflow is wired" },
    { name: "ui:digitalHospitalPilotEvaluation", ok: ["pilot-operations", "pilot-issues", "catalog", "collection", "evidence", "preassessment", "rectification", "boundary"].every((marker) => digitalHospitalEvaluationHtml.includes(`data-digital-evaluation-section="${marker}"`)) && digitalHospitalEvaluationHtml.includes('requireRole(["commission", "institution"])') && digitalHospitalEvaluationHtml.includes("digital-evaluation-issue-action-no-pii") && digitalHospitalEvaluationUi.includes("run-preassessment") && digitalHospitalEvaluationUi.includes("renderPilotIssueActions") && digitalHospitalEvaluationUi.includes("refreshBoard"), detail: "four-pack evaluation and role-scoped pilot issue closure workbench are visible" },
    { name: "api:digitalHospitalPilotEvaluation", ok: ["/api/digital-hospital/evaluation-catalog", "/api/digital-hospital/pilot-readiness", "/api/digital-hospital/pilot-issues/actions", "/api/digital-hospital/pilot-issues/:id/actions", "/api/digital-hospital/collection-jobs/:id/actions", "/api/digital-hospital/evaluation-evidence/:id/actions", "/api/digital-hospital/pre-assessments/actions", "/api/digital-hospital/pre-assessments/:id/actions", "digitalHospitalCollectionJobs", "digitalHospitalEvaluationEvidence", "digitalHospitalPreAssessments", "digitalHospitalPilotIssues"].every((marker) => serverSource.includes(marker)) && ["EVALUATION_PROJECTS", "STANDARD_CLAUSES", "calculatePackResult", "normalizeDigitalHospitalPilotIssueAction", "independent issue reviewer", "pilot-launch-ready", "blocked-until-site-evidence-signed"].every((marker) => digitalHospitalEvaluationSource.includes(marker)) && digitalHospitalPilotReadinessSource.includes("39 EMR / 17 service / 10 management / 4 interoperability"), detail: "P0-P1 evaluation, evidence, pre-assessment and independently reviewed pilot issue closure are wired" },
    { name: "api:imagingCloudRecognitionAppeal", ok: ["submitImageCloudRecognitionAppeal", "reviewImageCloudRecognitionAppeal", "/api/imaging-cloud/studies/:id/mutual-recognition/appeal", "submit imaging mutual recognition appeal", "review imaging mutual recognition appeal"].every((marker) => serverSource.includes(marker)) && ["submitMutualRecognitionAppeal", "reviewMutualRecognitionAppeal", "data-appeal-recognition", "data-review-recognition-appeal"].every((marker) => imagingCloudSource.includes(marker)) && imagingCloudReadinessSource.includes("spec:recognition-appeal"), detail: "rejected imaging recognition decisions support minimized institution appeals and independent review" },
    { name: "snapshot:chronicFollowupStatusPolicy", ok: Boolean(data.chronicFollowupStatusPolicy?.version && data.chronicFollowupStatusPolicy?.statusGroups?.open && data.chronicFollowupStatusPolicy?.requiredEvidence?.followup), detail: data.chronicFollowupStatusPolicy?.version || "missing" },
    { name: "snapshot:publicHealth", ok: (data.publicHealthStandards || []).length === 21 && (data.publicHealthInstitutionScopes || []).length >= 7 && (data.publicHealthEvents || []).length >= 6 && (data.publicHealthExchangeTasks || []).length >= 6 && (data.publicHealthExchangeRuns || []).length >= 6 && (data.publicHealthInstitutionTasks || []).length >= 7 && (data.publicHealthOnsiteAcceptances || []).length >= 6 && (data.publicHealthCutoverBlockers || []).length >= 6 && (data.publicHealthCutoverEvidencePackets || []).length >= 6 && (data.publicHealthCutoverDrills || []).length >= 4 && (data.publicHealthProductionHandoffs || []).length >= 6 && (data.publicHealthGoLiveObservations || []).length >= 6 && (data.publicHealthLaunchIncidents || []).length >= 6 && (data.publicHealthLaunchDutyShifts || []).length >= 6 && (data.publicHealthLaunchCommandBriefs || []).length >= 5 && (data.publicHealthSiteEvidenceVerificationTasks || []).length >= 9 && (data.publicHealthLaunchApprovals || []).length >= 6 && (data.publicHealthTriggerRules || []).length >= 5 && (data.publicHealthSignals || []).length >= 6 && (data.publicHealthAlerts || []).length >= 4 && (data.publicHealthCommandTasks || []).length >= 4 && (data.publicHealthResources || []).length >= 5 && (data.publicHealthAiReviews || []).length >= 2 && (data.publicHealthEvidenceRecords || []).length >= 8, detail: `${data.publicHealthStandards?.length || 0} standards, ${data.publicHealthInstitutionScopes?.length || 0} scopes, ${data.publicHealthEvents?.length || 0} events, ${data.publicHealthExchangeTasks?.length || 0} exchange tasks, ${data.publicHealthExchangeRuns?.length || 0} runs, ${data.publicHealthInstitutionTasks?.length || 0} institution tasks, ${data.publicHealthOnsiteAcceptances?.length || 0} onsite rows, ${data.publicHealthCutoverBlockers?.length || 0} cutover blockers, ${data.publicHealthCutoverEvidencePackets?.length || 0} evidence packets, ${data.publicHealthCutoverDrills?.length || 0} cutover drills, ${data.publicHealthProductionHandoffs?.length || 0} production handoffs, ${data.publicHealthGoLiveObservations?.length || 0} go-live observations, ${data.publicHealthLaunchIncidents?.length || 0} launch incidents, ${data.publicHealthLaunchDutyShifts?.length || 0} launch duty shifts, ${data.publicHealthLaunchCommandBriefs?.length || 0} launch command briefs, ${data.publicHealthSiteEvidenceVerificationTasks?.length || 0} site evidence verification tasks, ${data.publicHealthLaunchApprovals?.length || 0} launch approvals, ${data.publicHealthTriggerRules?.length || 0} trigger rules, ${data.publicHealthSignals?.length || 0} signals, ${data.publicHealthAlerts?.length || 0} alerts, ${data.publicHealthCommandTasks?.length || 0} command tasks, ${data.publicHealthResources?.length || 0} resources, ${data.publicHealthAiReviews?.length || 0} AI reviews, ${data.publicHealthEvidenceRecords?.length || 0} evidence records` },
    { name: "api:publicHealth", ok: serverSource.includes("/api/public-health/system") && serverSource.includes("buildPublicHealthSystem") && fs.existsSync(path.join(ROOT, "public-health.html")) && fs.existsSync(path.join(ROOT, "public-health.js")), detail: "public health page and API are wired" },
    {
      name: "api:publicHealthExternalEndpointVerification",
      ok: [
        "/api/public-health/external/endpoints/summary",
        "/api/public-health/external/endpoints/receipts",
        "publicHealthEndpointVerificationContext",
        "publicHealthEndpointVerificationSummaryView",
        "publicHealthExternalEndpointProbeReceipts",
        "assertUniquePublicHealthEndpointProbeReceipts",
        "assertPublicHealthEndpointProbeInsert",
        "publicHealthEndpointProbeInsert"
      ].every((marker) => serverSource.includes(marker))
        && [
          "expectedEndpoint",
          "expectedContract",
          "resolvedAddress",
          "sniHostname",
          "attestationOrigin",
          "verificationSource",
          "seenReceiptIds",
          "seenNonces",
          "endpointConnectivityReady",
          "productionReady: false"
        ].every((marker) => publicHealthEndpointVerificationSource.includes(marker))
        && ["server-generated", "platform-observability", "endpointConnectivityReady", "productionReady"].every((marker) => publicHealthEndpointVerificationDoc.includes(marker))
        && pkg.scripts?.["public-health:resilience-check"]?.includes("public-health-external-endpoint-verification-service.js")
        && pkg.scripts?.["public-health:resilience-test"]?.includes("test/public-health-external-endpoint-verification-service.test.js"),
      detail: "commission-only redacted endpoint summaries and server-config-bound signed receipts enforce durable receiptId/nonce replay protection while production readiness remains blocked"
    },
    {
      name: "api:publicHealthExternalActiveEndpointProbe",
      ok: [
        "/api/public-health/external/endpoints/probes",
        "runControlledPublicHealthEndpointProbe",
        "publicHealthEndpointProbeMaxConcurrent",
        "publicHealthEndpointProbeInFlight",
        "publicHealthExternalEndpointProbeAudit",
        "ENDPOINT_PROBE_FREQUENCY_LIMIT",
        "publicHealthEndpointProbeInsert"
      ].every((marker) => serverSource.includes(marker))
        && [
          "ALLOWED_COMMAND_KEYS",
          "resolveAddresses",
          "lookup:",
          "rejectUnauthorized: true",
          "certificatePins",
          "requireMutualTls",
          "ENDPOINT_PROBE_CERTIFICATE_PIN_MISMATCH",
          "ENDPOINT_PROBE_MTLS_REQUIRED",
          "productionReady: false"
        ].every((marker) => publicHealthEndpointProbeRunnerSource.includes(marker))
        && [
          "loadPublicHealthEndpointProbeContext",
          "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES",
          "ENDPOINT_PROBE_KEYRING_REF",
          "ENDPOINT_PROBE_TLS_REF",
          "privateEndpointProbeContext"
        ].every((marker) => publicHealthEndpointProbeKeyProviderSource.includes(marker))
        && ["laneId", "DNS rebinding", "certificatePins", "requireMutualTls", "productionReady=false"].every((marker) => publicHealthEndpointProbeDoc.includes(marker))
        && pkg.scripts?.["public-health:resilience-check"]?.includes("public-health-external-endpoint-probe-runner.js")
        && pkg.scripts?.["public-health:resilience-test"]?.includes("test/public-health-external-endpoint-probe-runner.test.js"),
      detail: "commission-only active endpoint probes accept only laneId, enforce server-owned DNS/TLS/pin/mTLS policy, controlled concurrency/frequency, redacted audit and durable receiptId/nonce replay protection while production readiness remains blocked"
    },
    {
      name: "api:publicHealthExternalEndpointProbeCampaign",
      ok: [
        "/api/public-health/external/endpoints/campaigns",
        "/api/public-health/external/endpoints/campaigns/summary",
        "runControlledPublicHealthEndpointProbeCampaign",
        "publicHealthExternalEndpointProbeCampaigns",
        "publicHealthExternalEndpointProbeCampaignAudit",
        "assertUniquePublicHealthEndpointProbeCampaigns",
        "publicHealthEndpointProbeCampaignInsert",
        "endpointProbeContinuity",
        "continuityBreaks",
        "publicHealthEndpointProbeContinuityBreakView",
        "campaignChainLinksVerified",
        "expectedChainHeadDigest",
        "ENDPOINT_PROBE_CAMPAIGN_CHAIN_CAS_CONFLICT",
        "ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISSING",
        "ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISMATCH"
      ].every((marker) => serverSource.includes(marker))
        && [
          "public-health-endpoint-probe-campaign",
          "receiptDigest",
          "policyDigest",
          "continuousConnectivityReady",
          "continuityBreak",
          "campaign-verification-failed",
          "previousCampaignDigest",
          "campaign-chain-link-missing",
          "campaign-chain-link-mismatch",
          "requiredConsecutiveCampaigns",
          "productionReady: false"
        ].every((marker) => publicHealthEndpointProbeCampaignSource.includes(marker))
        && [
          "loadPublicHealthEndpointProbeCampaignContext",
          "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_KEYRING_REF",
          "independentFromLaneKeys"
        ].every((marker) => publicHealthEndpointProbeKeyProviderSource.includes(marker))
        && ["300", "900", "continuousConnectivityReady", "continuityBreak", "productionReady=false"].every((marker) =>
          publicHealthEndpointProbeCampaignDoc.includes(marker)
        )
        && pkg.scripts?.["public-health:resilience-check"]?.includes("public-health-external-endpoint-probe-campaign-service.js")
        && pkg.scripts?.["public-health:resilience-test"]?.includes("test/public-health-external-endpoint-probe-campaign-service.test.js"),
      detail: "commission-only eight-lane endpoint campaigns use independent managed signing, transactional chain-head CAS, atomic replay-safe persistence and redacted fail-closed predecessor gaps while connectivity and production readiness remain separate"
    },
    {
      name: "static:publicHealthExternalConnectivityPanel",
      ok: [
        "public-health-connectivity-status",
        "public-health-connectivity-metrics",
        "public-health-connectivity-break",
        "public-health-connectivity-worker",
        "public-health-connectivity-blockers",
        "data-public-health-connectivity-action=\"probe-lane\"",
        "data-public-health-connectivity-action=\"probe-campaign\"",
        "public-health-connectivity-action-status",
        "aria-live=\"polite\""
      ].every((marker) => publicHealthHtml.includes(marker))
        && [
          "/api/public-health/external/endpoints/summary",
          "/api/public-health/external/endpoints/campaigns/summary",
          "endpointConnectivityReady",
          "continuousConnectivityReady",
          "campaignChainLinksVerified",
          "签名前序链",
          "ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISSING",
          "ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISMATCH",
          "safeConnectivityCampaignId",
          "connectivityFailureMessage",
          "handlePublicHealthConnectivityAction",
          "PUBLIC_HEALTH_CONNECTIVITY_LANES",
          "ENDPOINT_PROBE_COMMAND_OVERRIDE_FORBIDDEN",
          "ENDPOINT_PROBE_CAMPAIGN_COMMAND_OVERRIDE_FORBIDDEN",
          "productionReady 仅由服务端和现场门禁决定"
        ].every((marker) => publicHealthUiSource.includes(marker))
        && ["connectivity-metric-grid", "connectivity-action-controls", "connectivity-detail-grid", "@media (max-width: 720px)"].every((marker) => portalCss.includes(marker))
        && pkg.scripts?.posttest?.includes("test/public-health-connectivity-ui.test.js"),
      detail: "commission public-health panel loads redacted summaries and submits only allowlisted lane or empty campaign commands; failures stay safe and endpoint, continuity and production gates remain separate"
    },
    {
      name: "api:publicHealthModernization",
      ok: [
        "/api/public-health/data-foundation",
        "/api/public-health/surveillance-signals",
        "/api/public-health/surveillance-signals/:id/actions",
        "/api/public-health/surveillance-center",
        "/api/public-health/surveillance-alerts/:id/actions",
        "/api/public-health/medical-prevention-tasks",
        "/api/public-health/medical-prevention-tasks/:id/actions",
        "/api/public-health/surveillance-model-governance",
        "/api/public-health/surveillance-models/:id/shadow-runs",
        "/api/public-health/surveillance-models/:id/validations",
        "/api/public-health/surveillance-model-validations/:id/actions",
        "/api/public-health/respiratory-pathogen-surveillance",
        "/api/public-health/respiratory-pathogen-batches",
        "/api/public-health/respiratory-pathogen-batches/:id/actions",
        "/api/public-health/respiratory-network-readiness",
        "/api/public-health/respiratory-network-evidence/:id/actions",
        "assertPublicHealthRespiratoryPayload",
        "assertPublicHealthRespiratoryNetworkEvidencePayload",
        "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_KEYRING_JSON",
        "publishPublicHealthRespiratoryPathogenSignalsToState",
        "assertPublicHealthSurveillanceModelPayload",
        "publicHealthModernizationCommand",
        "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
      ].every((marker) => serverSource.includes(marker))
        && fs.existsSync(path.join(ROOT, "public-health-data-foundation-service.js"))
        && fs.existsSync(path.join(ROOT, "public-health-surveillance-model-governance-service.js"))
        && fs.existsSync(path.join(ROOT, "public-health-respiratory-pathogen-surveillance-service.js"))
        && fs.existsSync(path.join(ROOT, "public-health-respiratory-network-readiness-service.js"))
        && fs.existsSync(path.join(ROOT, "public-health-surveillance-workflow-service.js"))
        && fs.existsSync(path.join(ROOT, "public-health-medical-prevention-collaboration-service.js")),
      detail: "commission-only modernization routes delegate data, model, aggregate respiratory-pathogen, signed network evidence and workflow transitions and bind actor, server time, idempotency and expectedVersion"
    },
    {
      name: "storage:publicHealthModernization",
      ok: [
        "PUBLIC_HEALTH_MODERNIZATION_COLLECTIONS",
        "assertUniquePublicHealthModernizationState",
        "assertPublicHealthModernizationWrite",
        "publicHealthModernizationWrite",
        "sourceRecordHash",
        "publicHealthSurveillanceModelRuns",
        "publicHealthSurveillanceModelAudit",
        "publicHealthSurveillanceModelValidations",
        "publicHealthRespiratoryPathogenBatches",
        "publicHealthRespiratoryPathogenAudit",
        "publicHealthRespiratoryNetworkEvidence",
        "publicHealthRespiratoryNetworkEvidenceAudit",
        "publish-respiratory-pathogen-signals",
        "issue-respiratory-network-evidence",
        "public health respiratory network evidence receipt id",
        "requiredCollections",
        "PUBLIC_HEALTH_MODERNIZATION_CAS_CONFLICT"
      ].every((marker) => serverSource.includes(marker))
        && pkg.scripts?.["public-health:resilience-test"]?.includes("test/public-health-modernization-api.test.js")
        && pkg.scripts?.["public-health:model-governance-test"]?.includes("test/public-health-surveillance-model-governance-api.test.js")
        && pkg.scripts?.["public-health:respiratory-pathogen-test"]?.includes("test/public-health-respiratory-pathogen-api.test.js")
        && pkg.scripts?.["public-health:respiratory-network-test"]?.includes("test/public-health-respiratory-network-api.test.js")
        && pkg.scripts?.["public-health:modernization-readiness"] === "node scripts/public-health-modernization-readiness.js",
      detail: "seventeen modernization collections use SQLite transaction CAS, including atomic respiratory publication and signed network-evidence audit"
    },
    {
      name: "static:publicHealthModernizationWorkbenches",
      ok: [
        "public-health-data-foundation-title",
          "public-health-surveillance-title",
          "public-health-surveillance-model-governance-title",
          "public-health-respiratory-pathogen-title",
          "public-health-respiratory-network-title",
          "public-health-respiratory-network-institutions",
          "public-health-medical-prevention-title",
          "public-health-signal-intake-form",
          "public-health-model-validation-form",
          "public-health-respiratory-pathogen-form",
          "modelAdviceOnly=true",
          "humanDecisionRequired=true",
          "alertCreated=false",
        "aria-live=\"polite\""
      ].every((marker) => publicHealthHtml.includes(marker))
        && [
          "loadPublicHealthModernizationWorkbenches",
          "handlePublicHealthModernizationAction",
          "renderPublicHealthSurveillanceModelGovernance",
          "renderPublicHealthRespiratoryPathogenSurveillance",
          "renderPublicHealthRespiratoryNetworkReadiness",
          "run-shadow-model",
          "review-model-validation",
          "verify-respiratory-pathogen-batch",
          "publish-respiratory-pathogen-signals",
          "Idempotency-Key",
          "expectedVersion",
          "人工核实"
        ].every((marker) => publicHealthUiSource.includes(marker))
        && ["public-health-modernization-grid", "modernization-form", "respiratory-network-tracks", "@media (max-width: 1100px)"].every((marker) => portalCss.includes(marker))
        && pkg.scripts?.["public-health:resilience-test"]?.includes("test/public-health-modernization-ui.test.js"),
      detail: "eight responsive data, source-operations, rule-governance, shadow-model, respiratory-pathogen, respiratory-network, surveillance and medical-prevention workbenches expose redacted summaries and a production-false boundary"
    },
    {
      name: "api:publicHealthRespiratoryNetworkReadiness",
      ok: [
        "publicHealthSafeRespiratoryNetworkReadiness",
        "issueTrustedRespiratoryNetworkEvidenceReceipt",
        "verifyTrustedRespiratoryNetworkEvidence",
        "RESPIRATORY_NETWORK_EVIDENCE_PURPOSE",
        "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_KEYRING_JSON",
        "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN",
        "technicalLaunchReady",
        "productionReady: false"
      ].every((marker) => serverSource.includes(marker))
        && pkg.scripts?.["public-health:respiratory-network-check"]?.includes("public-health-respiratory-network-readiness-service.js")
        && pkg.scripts?.["public-health:respiratory-network-test"]?.includes("test/public-health-respiratory-network-api.test.js")
        && publicHealthHtml.includes("technicalLaunchReady")
        && publicHealthUiSource.includes("productionReady=false"),
      detail: "managed purpose-bound evidence receipts, redacted six-track summaries and technical-versus-production launch boundaries are wired fail-closed"
    },
    {
      name: "api:publicHealthDataSourceOperations",
      ok: [
        "/api/public-health/data-source-operations",
        "buildPublicHealthDataSourceOperations",
        "publicHealthSafeDataSourceOperations",
        "public health data source operations query overrides are forbidden"
      ].every((marker) => serverSource.includes(marker))
        && ["public-health-data-source-operations-title", "public-health-data-source-operations-list"].every((marker) => publicHealthHtml.includes(marker))
        && ["/api/public-health/data-source-operations", "renderPublicHealthDataSourceOperations", "operationalState"].every((marker) => publicHealthUiSource.includes(marker)),
      detail: "commission-only source operations uses server time and exposes no endpoint, raw external record or credential material"
    },
    {
      name: "api:publicHealthSurveillanceRuleGovernance",
      ok: [
        "/api/public-health/surveillance-rule-governance",
        "/api/public-health/surveillance-rule-changes",
        "/api/public-health/surveillance-rule-changes/:id/actions",
        "PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_KEYRING_JSON",
        "PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_SECRET",
        "RULE_ACTIVATION_KEYRING_PURPOSE",
        "activationKeyring",
        "ruleActivationKeyring",
        "publicHealthSafeRuleActivationKeyStatus",
        "publicHealthSurveillanceRuleActivationOptions",
        "publicHealthSurveillanceRuleChanges",
        "PUBLIC_HEALTH_SURVEILLANCE_RULE_REVIEWER_NOT_INDEPENDENT",
        "PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_KEYRING_UNAVAILABLE",
        "PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_KEYRING_INVALID"
      ].every((marker) => serverSource.includes(marker))
        && fs.existsSync(path.join(ROOT, "public-health-surveillance-rule-governance-service.js"))
        && pkg.scripts?.["public-health:resilience-test"]?.includes("test/public-health-surveillance-rule-governance-api.test.js"),
      detail: "rule changes require independent review, server-only managed activation trust and atomic rule/change CAS persistence"
    },
    {
      name: "static:publicHealthSurveillanceRuleGovernance",
      ok: [
        "public-health-rule-governance-title",
        "public-health-rule-governance-status",
        "public-health-rule-change-form",
        "public-health-rule-change-status"
      ].every((marker) => publicHealthHtml.includes(marker))
        && [
          "renderPublicHealthRuleGovernance",
          "handlePublicHealthRuleChangeSubmit",
          "review-rule-change",
          "activate-rule-change",
          "activationConfigured",
          "managedKeyringReady",
          "activationKeys",
          "legacy compatibility / No-Go",
          "blockerCode"
        ].every((marker) => publicHealthUiSource.includes(marker))
        && pkg.scripts?.["public-health:resilience-check"]?.includes("public-health-surveillance-rule-governance-service.js")
        && pkg.scripts?.["public-health:resilience-test"]?.includes("test/public-health-surveillance-rule-governance-service.test.js"),
      detail: "rule governance workbench exposes only safe versions, thresholds, states and allowed actions while production remains blocked"
    },
    { name: "api:publicHealthHighlights", ok: ["/api/public-health/highlights", "/api/public-health/highlights/signals", "/api/public-health/highlights/alerts/:id/actions", "/api/public-health/highlights/command-tasks/:id/actions", "/api/public-health/highlights/ai-reviews/:id/actions", "/api/public-health/highlights/evidence/:id/actions"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8").includes("public-health-highlight-center") && fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8").includes("renderPublicHealthHighlights"), detail: "public health five-suite trigger, map, AI, command and evidence center is wired" },
    { name: "api:publicHealthHighlightsStandalone", ok: fs.existsSync(path.join(ROOT, "public-health-highlights.html")) && fs.existsSync(path.join(ROOT, "public-health-highlights.js")) && fs.existsSync(path.join(ROOT, "scripts", "public-health-highlights-readiness.js")) && serverSource.includes("buildPublicHealthHighlights") && fs.readFileSync(path.join(ROOT, "scripts", "public-health-highlights-readiness.js"), "utf8").includes("functionalState"), detail: "standalone public health five-suite command center and readiness report are present" },
    { name: "docs:publicHealthHighlights", ok: ["五件套", "多点触发", "GIS", "AI", "应急指挥", "证据链", "formalGoLiveState"].every((marker) => fs.readFileSync(path.join(ROOT, "docs", "公共卫生五件套功能说明与验收.md"), "utf8").includes(marker)), detail: "public health five-suite implementation, acceptance and go-live boundary are documented" },
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
    { name: "database:postgresMigrationPackage", ok: postgresMigrationPackage.ok && postgresMigrationPackage.manifest.mode === "manifest" && !postgresMigrationPackage.files["records.copy.tsv"] && ["postgres:migration-package", "postgres:migration-verify"].every((marker) => ciSource.includes(marker)) && ["acknowledge-sensitive-data", "must be written outside the repository", "credentialsPersisted: false", "health_platform.auth_sessions", "auth_sessions_user_active_idx"].every((marker) => postgresMigrationPackageSource.includes(marker)) && ["仓库之外", "不得上传 Git", "生产数据库已经正式验收"].every((marker) => postgresMigrationPackageDoc.includes(marker)), detail: `${postgresMigrationPackage.manifest.summary.collections} collections / ${postgresMigrationPackage.manifest.summary.records} records summarized without payload files and with centralized session schema` },
    { name: "database:postgresMigrationReleaseWiring", ok: manifestSource.includes("postgres-migration-package/manifest.json") && manifestSource.includes("postgres:migration-package") && fs.readFileSync(path.join(ROOT, "scripts", "release-report.js"), "utf8").includes("productionDb:migrationPackage"), detail: "PostgreSQL migration manifest is indexed by release manifest and aggregate report" },
    { name: "database:postgresTransactionalOutbox", ok: ["STORAGE_SCHEMA_VERSION = 11", "postgres_sync_outbox", "buildCollectionChanges", "enqueuePostgresSyncBatch", "readPostgresSyncStatus", "productionPrimary: false"].every((marker) => serverSource.includes(marker)) && ["buildPostgresSyncBatch", "validatePostgresSyncBatch", "previousChainHash", "chainHash"].every((marker) => postgresRuntimeSyncSource.includes(marker)), detail: "SQLite schema v11 retains atomic signed collection changes and health-visible queue state" },
    { name: "database:postgresIdempotentWorker", ok: ["runtime_sync_batches", "ON CONFLICT (batch_id) DO NOTHING", "runtime_collection_state", "source_version <= EXCLUDED.source_version", "markPostgresSyncBatch"].every((marker) => postgresRuntimeSyncSource.includes(marker)) && postgresRuntimeSyncWorker.includes("runPostgresSyncWorker") && ciSource.includes("test/postgres-runtime-sync.test.js"), detail: "worker applies ordered batches idempotently with stale-version protection, retries and CI contract tests" },
    { name: "database:postgresWorkerDeployment", ok: ["Type=oneshot", "POSTGRES_SYNC_MODE=outbox", "NoNewPrivileges=true", "ProtectSystem=strict"].every((marker) => postgresRuntimeSyncService.includes(marker)) && ["OnUnitActiveSec=15s", "Persistent=true"].every((marker) => postgresRuntimeSyncTimer.includes(marker)) && ["事务型 outbox", "不得上传 Git", "STORAGE_ENGINE=postgres"].every((marker) => postgresRuntimeSyncDoc.includes(marker)), detail: "hardened timer deployment and sensitive outbox production boundary are documented" },
    { name: "database:postgresBaselineBootstrap", ok: postgresRuntimeSyncSource.includes("enqueuePostgresSyncBaseline") && postgresShadowReconcile.includes('command === "bootstrap"') && postgresRuntimeSyncDoc.includes("postgres:sync-bootstrap"), detail: "current SQLite collection versions can be queued once before incremental sync" },
    { name: "database:postgresShadowReconciliation", ok: ["BEGIN READ ONLY", "comparePostgresShadowState", "recordPostgresReconciliation"].every((marker) => postgresRuntimeSyncSource.includes(marker)) && ["runPostgresShadowReconciliation", "contains no business payloads or database credentials"].every((marker) => postgresShadowReconcile.includes(marker)) && serverSource.includes("/api/production-database/shadow-reconciliation"), detail: "payload-free read-only collection version and digest comparison is API-visible" },
    { name: "database:postgresPrimaryReadRehearsal", ok: ["buildPostgresPrimaryReadSnapshot", "runPostgresPrimaryReadRehearsal", "REPEATABLE READ READ ONLY", "PRIMARY_READ_DIGEST_MISMATCH", "PRIMARY_READ_BASELINE_MISMATCH"].every((marker) => postgresRuntimeSyncSource.includes(marker)) && ["runPostgresPrimaryReadRehearsal", "contains no business payloads or database credentials"].every((marker) => postgresPrimaryReadRehearsal.includes(marker)) && ["/api/production-database/primary-read-rehearsal", "PRIMARY_READ_REHEARSAL_NOT_CONFIGURED"].every((marker) => serverSource.includes(marker)) && ["POSTGRES_PRIMARY_READ_MODE=disabled", "POSTGRES_PRIMARY_READ_MAX_BYTES=134217728"].every((marker) => envTemplateSource.includes(marker)), detail: "repeatable-read primary snapshot rehearsal verifies every payload digest and the complete SQLite baseline without enabling cutover" },
    { name: "database:postgresProductionAdapter", ok: ["readPostgresProductionState", "writePostgresProductionState", "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", "pg_advisory_xact_lock", "FOR UPDATE", "POSTGRES_EXPECTED_VERSIONS_INCOMPLETE", "runtime_primary_write_audit", "POSTGRES_PRIMARY_WRITE_BLOCKED"].every((marker) => postgresProductionAdapterSource.includes(marker)) && ["buildPostgresProductionAdapterConfig", "verifyPostgresProductionAdapterSchema"].every((marker) => postgresProductionAdapterCli.includes(marker)) && ["runtime_primary_write_audit", "runtimeAdapterImplemented: true", "runtimeAdapterEnabled: false"].every((marker) => postgresMigrationPackageSource.includes(marker)) && ["/api/production-database/adapter", "all-collection-versions", "runtime_primary_write_audit"].every((marker) => serverSource.includes(marker)) && ["postgres-adapter-status", "postgres-primary-read-status", "postgres-adapter-metrics", "data-postgres-primary-read-action"].every((marker) => platformHtml.includes(marker)) && ["loadPostgresProductionAdapterCenter", "renderPostgresProductionAdapterCenter", "runPostgresPrimaryReadRehearsal"].every((marker) => platformSource.includes(marker)) && ["POSTGRES_ADAPTER_MODE=disabled", "POSTGRES_PRODUCTION_WRITE_MODE=disabled", "POSTGRES_CUTOVER_APPROVAL_ID=", "POSTGRES_BACKUP_EVIDENCE_ID=", "POSTGRES_RTO_RPO_EVIDENCE_ID="].every((marker) => envTemplateSource.includes(marker)) && ["生产数据库适配器", "SERIALIZABLE", "productionPrimary"].every((marker) => postgresRuntimeSyncDoc.includes(marker)), detail: "asynchronous PostgreSQL adapter has verified reads, serializable writes, advisory locking, complete optimistic locking, payload-free audit and evidence-gated enablement" },
    { name: "database:postgresReconciliationCaseWorkflow", ok: ["syncPostgresReconciliationCases", "applyPostgresReconciliationCaseAction", "RECONCILIATION_CLEARANCE_REQUIRED", "auto-reopen"].every((marker) => postgresRuntimeSyncSource.includes(marker)) && ["postgres_sync_reconciliation_cases", "postgres_sync_reconciliation_case_actions", "/api/production-database/shadow-reconciliations", "/api/production-database/reconciliation-cases", "postgres-reconciliation-case-action", "/api/metrics/prometheus", "health_platform_postgres_sync_slo_breaches"].every((marker) => serverSource.includes(marker)) && ["postgres-reconciliation-cases", "postgres-reconciliation-history"].every((marker) => platformHtml.includes(marker)) && ["runPostgresReconciliationCaseAction", "data-postgres-reconciliation-action"].every((marker) => platformSource.includes(marker)), detail: "payload-free differences have commission-only operational UI, ownership, verified clearance, evidence-backed resolution, immutable actions and scrapeable SLOs" },
    { name: "database:postgresReconciliationDeployment", ok: ["Type=oneshot", "NoNewPrivileges=true", "ProtectSystem=strict"].every((marker) => postgresShadowReconcileService.includes(marker)) && ["OnUnitActiveSec=5min", "Persistent=true"].every((marker) => postgresShadowReconcileTimer.includes(marker)), detail: "hardened five-minute shadow reconciliation timer is deployable" },
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
    { name: "snapshot:drugTraceabilityPolicySources", ok: traceabilityPolicySources.length >= 5 && traceabilityPolicySources.every((item) => /^https:\/\/(www\.)?(nhsa|nmpa)\.gov\.cn\//.test(item.url || "")), detail: `${traceabilityPolicySources.length} official traceability policy sources` },
    { name: "snapshot:drugTraceabilityEvidenceRequirements", ok: traceabilityEvidenceRequirements.length >= 5 && traceabilityEvidenceRequirements.every((item) => item.id && Array.isArray(item.policySourceIds) && item.policySourceIds.every((id) => traceabilityPolicySources.some((source) => source.id === id)) && Array.isArray(item.evidenceFields) && item.evidenceFields.length > 0), detail: `${traceabilityEvidenceRequirements.length} traceability evidence requirements` },
    { name: "snapshot:drugConsumableSupplyAlerts", ok: drugConsumableSupervisions.some((item) => item.boundary === "supply-alert" && item.relatedPickupId && item.remediationStatus), detail: `${drugConsumableSupervisions.filter((item) => item.boundary === "supply-alert").length} supply alert rows` },
    { name: "snapshot:p2-complete", ok: (data.platformRoadmap || []).filter((item) => item.priority === "P2").every((item) => item.status === "已完成"), detail: (data.platformRoadmap || []).filter((item) => item.priority === "P2").map((item) => `${item.title}:${item.status}`).join(";") },
    { name: "snapshot:accessibility", ok: Array.isArray(data.accessibilityChecklist) && data.accessibilityChecklist.length >= 5, detail: `${data.accessibilityChecklist?.length || 0} checklist items` },
    { name: "snapshot:healthDashboard", ok: Array.isArray(data.healthDashboardSnapshots) && data.healthDashboardSnapshots.some((item) => Array.isArray(item.sourceApplications) && item.sourceApplications.length === 7), detail: `${data.healthDashboardSnapshots?.length || 0} dashboard snapshots` },
    { name: "snapshot:healthDashboardIndicatorCenter", ok: ["buildIndustryGovernanceIndicatorCenter", "dashboard:industry-governance-indicators", "dashboard:industry-governance-reports"].every((marker) => healthDashboardSource.includes(marker)) && healthDashboardHtml.includes("industry-governance-indicator-center") && healthDashboardJs.includes("renderIndustryGovernanceIndicatorCenter") && healthDashboardJs.includes("industry-indicator-export") && serverSource.includes("/api/health-dashboard/industry-governance-indicators") && ["健康体检", "发热门诊", "月报/年报", "JSON 导出"].every((marker) => healthDashboardIndicatorDoc.includes(marker)), detail: "phase-2 industry governance indicator center API, eight-topic model, filters, export, docs and report views are wired" },
    { name: "snapshot:dataGovernance", ok: serverSource.includes("seedDataGovernanceAssets") && serverSource.includes("seedStandardDataDictionaries") && serverSource.includes("seedDataLineageControls") && serverSource.includes("seedPlatformDataBusChannels") && serverSource.includes("/api/data-governance"), detail: "data asset catalog, standard dictionaries, lineage controls, platform bus channels, and API are seeded" },
    { name: "api:platformStandardsLedgerDetail", ok: ["/api/platform/standards-ledgers/:id", "buildPlatformStandardsLedgerDetail", "renderPlatformStandardsLedgerDetailMarkdown"].every((marker) => serverSource.includes(marker)) && ["platform-standards-ledger-filters", "platform-standards-ledger-detail", "export-platform-standards-ledger-detail"].every((marker) => platformHtml.includes(marker)) && ["loadPlatformStandardsLedgerDetail", "renderPlatformStandardsLedgerDetail", "exportPlatformStandardsLedgerDetail"].every((marker) => platformSource.includes(marker)), detail: "filterable standards ledger detail API, acceptance workbench and markdown export are wired" },
    { name: "snapshot:phase2Catalog", ok: ["seedPhase2DataCatalogs", "seedPhase2ServiceCatalogs", "seedPhase2FieldLineage", "seedPhase2CatalogQualityRules", "buildPhase2CatalogOverview", "/api/phase2/catalog"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2Catalog") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-catalog"), detail: "phase-2 data catalog, service catalog, lineage, quality rules, API, and platform UI are wired" },
    { name: "snapshot:phase2JointTest", ok: ["seedPhase2PilotInstitutions", "seedPhase2JointTestLinks", "seedPhase2SamplePayloads", "seedPhase2GatewayTraces", "seedPhase2JointTestIssues", "buildPhase2JointTestPilotOverview", "/api/phase2/joint-test-pilot"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2JointTestPilot") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-joint-test-pilot"), detail: "phase-2 minimum joint-test pilot, sample payloads, gateway traces, issue ledger, API, and platform UI are wired" },
    { name: "snapshot:phase2MutualRecognition", ok: ["seedPhase2MutualRecognitionCatalog", "seedPhase2MutualRecognitionCitations", "buildPhase2MutualRecognitionOverview", "/api/phase2/mutual-recognition", "phase2-mutual-recognition-decision"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "county.js"), "utf8").includes("renderPhase2MutualRecognition") && fs.readFileSync(path.join(ROOT, "county.html"), "utf8").includes("phase2-mutual-recognition-browser"), detail: "phase-2 mutual recognition 78-item mapping, report browser, citation chain, decision API, and county UI are wired" },
    { name: "snapshot:phase2DiseaseReporting", ok: ["seedPhase2DiseaseReportingRules", "seedPhase2DiseaseReportQueue", "seedPhase2DiseaseReportReceipts", "buildPhase2DiseaseReportingOverview", "/api/phase2/disease-reporting", "phase2-disease-report-receipt"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2DiseaseReporting") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-disease-reporting"), detail: "phase-2 disease reporting diagnosis triggers, report queue, county receipts, patient center, supervision stats, API, and platform UI are wired" },
    { name: "snapshot:phase2ClinicalAssist", ok: ["seedPhase2ClinicalAssistRules", "seedPhase2ClinicalAssistAlerts", "seedPhase2ClinicalAssistReceipts", "seedPhase2ClinicalAssistPluginContracts", "buildPhase2ClinicalAssistOverview", "/api/phase2/clinical-assist", "phase2-clinical-assist-receipt", "phase2-clinical-assist-rule-config"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "doctor.js"), "utf8").includes("renderDoctorClinicalAssist") && fs.readFileSync(path.join(ROOT, "doctor.html"), "utf8").includes("doctor-clinical-assist") && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2ClinicalAssist") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-clinical-assist"), detail: "phase-2 clinical assist rules, alerts, doctor receipts, plugin contracts, API, doctor UI, and platform UI are wired" },
    { name: "snapshot:phase2FamilyDoctor", ok: ["seedPhase2FamilyDoctorTemplates", "seedPhase2FamilyDoctorTeams", "seedPhase2FamilyDoctorServicePackages", "seedPhase2FamilyDoctorApplications", "seedPhase2FamilyDoctorContracts", "seedPhase2FamilyDoctorFulfillments", "buildPhase2FamilyDoctorOverview", "/api/phase2/family-doctor-contracts", "phase2-family-doctor-application-review", "phase2-family-doctor-fulfillment"].every((marker) => serverSource.includes(marker)) && fs.readFileSync(path.join(ROOT, "citizen.js"), "utf8").includes("renderFamilyDoctorContracts") && fs.readFileSync(path.join(ROOT, "citizen.html"), "utf8").includes("service-family-doctor") && fs.readFileSync(path.join(ROOT, "institution.js"), "utf8").includes("renderPhase2FamilyDoctorContracts") && fs.readFileSync(path.join(ROOT, "institution.html"), "utf8").includes("phase2-family-doctor-contracts") && fs.readFileSync(path.join(ROOT, "platform.js"), "utf8").includes("renderPhase2FamilyDoctorContracts") && fs.readFileSync(path.join(ROOT, "platform.html"), "utf8").includes("phase2-family-doctor-contracts"), detail: "phase-2 family doctor templates, teams, packages, applications, review, contracts, fulfillment, citizen UI, institution UI, platform UI, and API are wired" },
    { name: "snapshot:citizenOperations", ok: (data.citizenOperationContents || []).length >= 4 && (data.citizenAgreementVersions || []).length >= 4 && (data.citizenIdentityReviewCases || []).length >= 3 && (data.citizenServiceBlacklist || []).length >= 3 && (data.citizenHospitalServiceConfigs || []).length >= 3 && (data.citizenHospitalServiceConfigs || []).every((item) => item.productionReady === false), detail: `${data.citizenOperationContents?.length || 0} contents / ${data.citizenAgreementVersions?.length || 0} agreements / ${data.citizenIdentityReviewCases?.length || 0} identity reviews / ${data.citizenServiceBlacklist?.length || 0} blacklist rows / ${data.citizenHospitalServiceConfigs?.length || 0} hospitals` },
    { name: "snapshot:commercialCrypto", ok: (data.commercialCryptoCapabilities || []).length === 6 && (data.commercialCryptoCapabilities || []).every((item) => item.productionReady === false && Array.isArray(item.requiredPrimitives) && item.requiredPrimitives.length > 0) && (data.commercialCryptoEvidencePackets || []).length >= 2, detail: `${data.commercialCryptoCapabilities?.length || 0} contracts / ${data.commercialCryptoEvidencePackets?.length || 0} evidence packets / production ready 0` },
    { name: "api:productionSecurityAcceptance", ok: ["/api/production-security/center", "/api/production-security/findings/:id/actions", "/api/production-security/release-approvals/:id/actions", "production-security-finding-action"].every((marker) => serverSource.includes(marker)) && platformHtml.includes('data-platform-section="production-security-acceptance"') && ["data-production-security-action", "data-production-security-approval"].every((marker) => productionSecuritySource.includes(marker)), detail: "P0-07 finding remediation, independent retest, time-bound waiver, release opinions and platform UI are wired" },
    { name: "api:productionGoNoGo", ok: ["/api/production-go-no-go/center", "/api/production-go-no-go/approvals/:id/actions", "/api/production-go-no-go/decision", "production-go-no-go-decision"].every((marker) => serverSource.includes(marker)) && ["evidenceFingerprint", "staleApprovals", "APPROVE PRODUCTION GO LIVE", "goNoGo:drSignoff"].every((marker) => productionGoNoGoSource.includes(marker)) && platformHtml.includes('data-platform-section="production-go-no-go"') && ["data-go-no-go-approval", "data-go-no-go-decision", "data-go-no-go-drift", "data-go-no-go-approval-drift"].every((marker) => productionGoNoGoUi.includes(marker)), detail: "P0-10 global prerequisites, evidence fingerprint, stale approval drift, four-party approvals, command decision and UI are wired" },
    { name: "api:pilotAcceptance", ok: ["/api/pilot-acceptance/center", "pilot-acceptance-center"].every((marker) => serverSource.includes(marker)) && ["pilot-acceptance-tooling-ready", "blocked-until-site-evidence-signed", "official-grouper", "insurance-core", "his-emr-feed", "physical-exam-feed", "synthetic-no-patient-data"].every((marker) => pilotAcceptanceSource.includes(marker)) && platformHtml.includes('data-platform-section="pilot-acceptance"') && ["pilot-acceptance-applications", "pilot-acceptance-alerting", "pilot-acceptance-onsite", "pilot-acceptance-interfaces", "pilot-acceptance-trials", "pilot-acceptance-issues"].every((marker) => pilotAcceptanceUi.includes(marker)) && pilotAcceptanceReadiness.includes("pilot-acceptance-readiness-report.md") && ["P0-01至P0-10", "不会写入真实接收端"].every((marker) => pilotAcceptanceDoc.includes(marker)) && ["SIEM_ENDPOINT", "ALERT_WEBHOOK_URL", "CUTOVER_MONITORING_SIGNOFF=false"].every((marker) => pilotAlertingTemplate.includes(marker)), detail: "eight-application regression, alerting preflight, P0 task pack, synthetic interface samples, trial run, issue ledger and production boundary are wired" },
    { name: "snapshot:productionOperations", ok: (data.productionServiceLevels || []).length >= 4 && (data.operationsDutyShifts || []).length >= 3 && (data.operationsIncidents || []).length >= 3 && (data.disasterRecoveryDrills || []).length >= 3 && (data.operationsEvidencePackets || []).length >= 2 && [data.productionServiceLevels, data.operationsDutyShifts, data.operationsIncidents, data.disasterRecoveryDrills].flat().every((item) => item.productionReady === false), detail: `${data.productionServiceLevels?.length || 0} SLOs / ${data.operationsDutyShifts?.length || 0} shifts / ${data.operationsIncidents?.length || 0} incidents / ${data.disasterRecoveryDrills?.length || 0} drills / production ready 0` },
    { name: "snapshot:registrationJourney", ok: (data.registrationOrders || []).length >= 1 && (data.registrationOrders || []).every((item) => item.productionReady === false && item.journeyStage && item.hisConfirmationStatus && item.checkInStatus), detail: `${data.registrationOrders?.length || 0} appointment journeys / production ready 0` },
    { name: "snapshot:registrationIntegration", ok: (data.integrationContracts || []).some((item) => item.id === "appointment-order-v1" && item.signature === "HMAC-SHA256" && item.idempotencyKey === "externalId") && Array.isArray(data.integrationGatewayEvents), detail: `${data.integrationContracts?.length || 0} integration contracts / appointment callback contract present` },
    { name: "manifest:dataGovernance", ok: manifestSource.includes("data-governance-readiness-report.md") && manifestSource.includes("data-governance:readiness"), detail: "data governance readiness artifact is indexed" },
    { name: "manifest:digitalHospitalStandards", ok: manifestSource.includes("digital-hospital-standards-readiness-report.md") && manifestSource.includes("digital-hospital:standards-readiness"), detail: "digital hospital standards artifact is indexed" },
    { name: "manifest:digitalHospitalPilotReadiness", ok: manifestSource.includes("digital-hospital-pilot-readiness-report.md") && manifestSource.includes("digital-hospital:pilot-readiness"), detail: "digital hospital pilot readiness artifact is indexed" },
    { name: "manifest:phase2ProposalReadiness", ok: manifestSource.includes("phase2-proposal-readiness-report.md") && manifestSource.includes("phase2:proposal-readiness"), detail: "phase-2 proposal readiness artifact is indexed" },
    { name: "manifest:phase2CatalogReadiness", ok: manifestSource.includes("phase2-catalog-readiness-report.md") && manifestSource.includes("phase2:catalog-readiness"), detail: "phase-2 catalog readiness artifact is indexed" },
    { name: "manifest:phase2JointTestReadiness", ok: manifestSource.includes("phase2-joint-test-readiness-report.md") && manifestSource.includes("phase2:joint-test-readiness"), detail: "phase-2 joint-test readiness artifact is indexed" },
    { name: "manifest:phase2MutualRecognitionReadiness", ok: manifestSource.includes("phase2-mutual-recognition-readiness-report.md") && manifestSource.includes("phase2:mutual-recognition-readiness"), detail: "phase-2 mutual recognition readiness artifact is indexed" },
    { name: "manifest:phase2DiseaseReportingReadiness", ok: manifestSource.includes("phase2-disease-reporting-readiness-report.md") && manifestSource.includes("phase2:disease-reporting-readiness"), detail: "phase-2 disease reporting readiness artifact is indexed" },
    { name: "manifest:phase2ClinicalAssistReadiness", ok: manifestSource.includes("phase2-clinical-assist-readiness-report.md") && manifestSource.includes("phase2:clinical-assist-readiness"), detail: "phase-2 clinical assist readiness artifact is indexed" },
    { name: "manifest:phase2FamilyDoctorReadiness", ok: manifestSource.includes("phase2-family-doctor-readiness-report.md") && manifestSource.includes("phase2:family-doctor-readiness"), detail: "phase-2 family doctor readiness artifact is indexed" },
    { name: "manifest:citizenOperationsReadiness", ok: manifestSource.includes("citizen-operations-readiness-report.md") && manifestSource.includes("phase2:citizen-operations-readiness"), detail: "citizen service operations readiness artifact is indexed" },
    { name: "manifest:commercialCryptoReadiness", ok: manifestSource.includes("commercial-crypto-readiness-report.md") && manifestSource.includes("security:commercial-crypto-readiness"), detail: "commercial crypto adapter readiness artifact is indexed" },
    { name: "manifest:productionSecurityReadiness", ok: manifestSource.includes("production-security-readiness-report.md") && manifestSource.includes("security:production-readiness"), detail: "P0-07 production security acceptance artifact is indexed" },
    { name: "manifest:productionGoNoGoReadiness", ok: manifestSource.includes("production-go-no-go-readiness-report.md") && manifestSource.includes("production:go-no-go-readiness"), detail: "P0-10 global Go/No-Go command artifact is indexed" },
    { name: "manifest:pilotAcceptanceReadiness", ok: manifestSource.includes("pilot-acceptance-readiness-report.md") && manifestSource.includes("pilot:acceptance-readiness") && manifestSource.includes("/api/pilot-acceptance/center"), detail: "pilot acceptance readiness artifact is indexed" },
    { name: "manifest:productionOperationsReadiness", ok: manifestSource.includes("operations-readiness-report.md") && manifestSource.includes("/api/production-operations/center"), detail: "production operations run-center readiness artifact is indexed" },
    { name: "manifest:registrationJourneyReadiness", ok: manifestSource.includes("registration-journey-readiness-report.md") && manifestSource.includes("registration:journey-readiness"), detail: "registration journey readiness artifact is indexed" },
    { name: "manifest:platformProductionAudit", ok: manifestSource.includes("platform-production-audit.json") && manifestSource.includes("platform:production-audit") && manifestSource.includes("数智医院标准平台全程审计与生产前开发规划.md"), detail: "platform production audit and roadmap artifact is indexed" },
    { name: "manifest:platformCapabilityMap", ok: manifestSource.includes("platform-capability-map.json") && manifestSource.includes("platform:capability-map") && manifestSource.includes("/api/platform/capability-map"), detail: "platform capability map artifact is indexed" },
    { name: "manifest:platformGoLiveSlices", ok: manifestSource.includes("platform-go-live-slices.json") && manifestSource.includes("platform:go-live-slices") && manifestSource.includes("/api/platform/go-live-slices"), detail: "platform go-live slices artifact is indexed" },
    { name: "manifest:platformStandardsLedgers", ok: manifestSource.includes("platform-standards-ledgers.json") && manifestSource.includes("platform:standards-ledgers") && manifestSource.includes("/api/platform/standards-ledgers"), detail: "six platform standards ledgers artifact is indexed" },
    { name: "manifest:objectStorageReadiness", ok: manifestSource.includes("object-storage-readiness-report.json") && manifestSource.includes("object-storage:readiness") && manifestSource.includes("/api/attachments/storage"), detail: "object storage security readiness artifact is indexed" },
    { name: "manifest:registrationIntegrationReadiness", ok: manifestSource.includes("registration-integration-readiness-report.md") && manifestSource.includes("registration:integration-readiness"), detail: "registration callback integration readiness artifact is indexed" },
    { name: "manifest:healthDashboardSummary", ok: manifestSource.includes("health-dashboard-summary.md") && manifestSource.includes("health-dashboard:summary"), detail: "health dashboard summary artifact is indexed" },
    { name: "manifest:healthDashboardIndicatorCenter", ok: manifestSource.includes("health-dashboard-indicator-center-report.md") && manifestSource.includes("/api/health-dashboard/industry-governance-indicators"), detail: "health dashboard indicator center artifact is indexed" },
    { name: "manifest:launchSmoke", ok: manifestSource.includes("launch-smoke-report.md") && manifestSource.includes("launch:smoke"), detail: "launch smoke artifact is indexed" },
    { name: "manifest:onsiteLaunchRequirements", ok: manifestSource.includes("onsite-launch-requirements.md") && manifestSource.includes("onsite:launch-requirements"), detail: "on-site launch requirements artifact is indexed" },
    { name: "manifest:priorityApplicationTemplates", ok: manifestSource.includes("priority-application-templates.md") && manifestSource.includes("priority-apps:templates"), detail: "priority application template artifact is indexed" },
    { name: "manifest:citizenLaunchFoundation", ok: manifestSource.includes("citizen-launch-foundation-readiness.md") && manifestSource.includes("citizen:launch-foundation") && manifestSource.includes("citizen-pipeline-panel"), detail: "citizen launch foundation artifact links to the resident pipeline acceptance panel" },
    {
      name: "manifest:citizenRecordsReadiness",
      ok: manifestSource.includes("citizen-records-readiness-report.md")
        && manifestSource.includes("citizen-records:readiness")
        && manifestSource.includes("citizen-care-workspace")
        && serverSource.includes("/api/record-care-workspace")
        && serverSource.includes("evaluateCitizenRecordAccess")
        && citizenRecordsV3Source.includes("buildCareTaskActionIntent")
        && citizenSource.includes("handleCitizenRecordsV3CareTaskAction")
        && citizenRecordsReadinessSource.includes("proactive-care-task-routing")
        && serviceWorkerSource.includes("citizen-records-v3.js?v=20260728next4")
        && serviceWorkerSource.includes("citizen.js?v=20260728next3"),
      detail: "T04 resident record policy, care workspace, proactive task routing and current PWA cache are release indexed"
    },
    { name: "manifest:registrationReferralAcceptance", ok: manifestSource.includes("registration-referral-acceptance-report.md") && manifestSource.includes("registration-referral:acceptance") && manifestSource.includes("/api/registration-referral/operations") && serverSource.includes("/api/registration-referral/commands") && serverSource.includes("applyClosureCommand"), detail: "T05 command, operations, acceptance and release wiring are indexed" },
    { name: "manifest:policyCoverage", ok: manifestSource.includes("policy-coverage-report.md") && manifestSource.includes("policy:coverage"), detail: "policy coverage artifact is indexed" },
    { name: "manifest:maternalChildReadiness", ok: manifestSource.includes("maternal-child-readiness-report.md") && manifestSource.includes("maternal-child:readiness"), detail: "maternal-child readiness artifact is indexed" },
    { name: "manifest:immunizationReadiness", ok: manifestSource.includes("immunization-readiness-report.md") && manifestSource.includes("immunization:readiness") && manifestSource.includes("immunization.html"), detail: "immunization readiness artifact is indexed" },
    { name: "manifest:publicHealthReadiness", ok: manifestSource.includes("public-health-readiness-report.md") && manifestSource.includes("public-health:readiness"), detail: "public health readiness artifact is indexed" },
    { name: "manifest:publicHealthHighlights", ok: manifestSource.includes("public-health-highlights-readiness-report.md") && manifestSource.includes("public-health:highlights:readiness") && manifestSource.includes("/api/public-health/highlights"), detail: "public health five-suite readiness artifact is indexed" },
    { name: "manifest:publicHealthModernization", ok: manifestSource.includes("public-health-modernization-readiness-report.md") && manifestSource.includes("public-health:modernization-readiness") && manifestSource.includes("/api/public-health/surveillance-center"), detail: "public health data, surveillance and medical-prevention modernization readiness artifact is indexed" },
    { name: "manifest:diseasePaymentReadiness", ok: manifestSource.includes("disease-payment-readiness-report.md") && manifestSource.includes("disease-payment:readiness") && manifestSource.includes("/api/disease-payment"), detail: "disease payment DRG/DIP readiness artifact is indexed" },
    { name: "manifest:insurancePaymentAcceptance", ok: manifestSource.includes("insurance-payment-acceptance-report.md") && manifestSource.includes("insurance-payment:acceptance") && manifestSource.includes("insurance-payment-evidence-packet.md") && manifestSource.includes("insurance-payment:evidence"), detail: "T07 unified acceptance and digest-bound evidence are indexed" },
    { name: "manifest:productionReleaseEvidence", ok: manifestSource.includes("production-release-evidence-readiness.md") && manifestSource.includes("production-release:evidence:readiness") && manifestSource.includes("/api/production-release/evidence-readiness"), detail: "T11 production security release evidence is indexed" },
    { name: "manifest:escortServiceReadiness", ok: manifestSource.includes("escort-service-readiness-report.md") && manifestSource.includes("escort:readiness"), detail: "escort service readiness artifact is indexed" },
    { name: "manifest:internetNursingReadiness", ok: manifestSource.includes("internet-nursing-readiness-report.md") && manifestSource.includes("internet-nursing:readiness"), detail: "internet nursing readiness artifact is indexed" },
    { name: "manifest:internetNursingHighlightCenter", ok: manifestSource.includes("internet-nursing-highlight-center.md") && manifestSource.includes("nursing-highlight-section"), detail: "internet nursing highlight center handoff is indexed" },
    { name: "manifest:emergencyReadiness", ok: manifestSource.includes("emergency-readiness-report.md") && manifestSource.includes("emergency:readiness") && manifestSource.includes("/api/emergency/production-center") && manifestSource.includes("emergency-evidence-package-api") && manifestSource.includes("emergency-evidence-export-api") && manifestSource.includes("/api/emergency/events/:id/evidence-package/export?format=json") && manifestSource.includes("emergency-sos-aed-api") && manifestSource.includes("/api/emergency/sos /api/emergency/aed-map") && manifestSource.includes("emergency-life-chain") && manifestSource.includes("/api/emergency/life-chain/device-sos /api/emergency/life-chain/command-center /api/emergency/life-chain/quality"), detail: "prehospital emergency readiness, evidence exports, SOS/AED and golden four-minute life-chain artifacts are indexed" },
    { name: "manifest:t10SpecialtyCutover", ok: manifestSource.includes("t10-specialty-cutover-pack.md") && manifestSource.includes("t10:specialty-cutover") && manifestSource.includes("/api/t10-specialty/cutover-pack") && serverSource.includes("/api/t10-specialty/cutover-pack") && fs.readFileSync(path.join(ROOT, "workbench.html"), "utf8").includes("t10-specialty-cutover.html") && fs.readFileSync(path.join(ROOT, "t10-specialty-cutover.js"), "utf8").includes("/api/t10-specialty/cutover-pack") && fs.readFileSync(path.join(ROOT, "scripts", "release-report.js"), "utf8").includes("specialtyCutover:moduleCatalog"), detail: "T10 specialty module catalog, cutover API, portal entry and release artifact are indexed" },
    {
      name: "api:t10IndependentProductionGates",
      ok: [
        "/api/t10-specialty/modules/clinical-blood/readiness",
        "/api/t10-specialty/modules/emergency-life-chain/readiness",
        "/api/imaging-cloud/production-center",
        "imagingProductionEndpointMatch",
        "imagingProductionSyntheticMatch",
        "imagingProductionRequirementMatch",
        "imagingProductionReceiptMatch",
        "imagingProductionDrillMatch",
        "imagingProductionApprovalMatch",
        "blocked-until-trusted-site-evidence-and-platform-launch-approval"
      ].every((marker) => serverSource.includes(marker))
        && bloodClinicalProductionSource.includes("blocked-until-site-evidence-signed")
        && emergencyModuleGateSource.includes("independent-emergency-module")
        && imagingCloudProductionSource.includes("SITE_RECEIPT_CONTRACTS")
        && imagingCloudProductionSource.includes("ROUTE_CONTRACTS")
        && physicalExaminationProductionSource.includes("REQUIRED_STANDALONE_FILES")
        && physicalExaminationProductionSource.includes('decision: goLiveReady ? "GO" : "NO-GO"')
        && physicalExaminationStandaloneHtml.includes("physical-examination-production.js")
        && physicalExaminationStandaloneReadinessSource.includes('decision: "NO-GO"'),
      detail: "clinical blood, emergency, imaging and physical-examination module evidence remain subordinate to the T00 platform launch gate"
    },
    {
      name: "package:t10IndependentProductionGates",
      ok: [
        "t10:clinical-blood:readiness",
        "t10:clinical-blood:smoke",
        "t10:emergency-module:smoke",
        "imaging-cloud:test",
        "t10:physical-examination:readiness",
        "t10:physical-examination:test"
      ].every((name) => Boolean(pkg.scripts?.[name])),
      detail: "T10 independent module check, smoke and readiness commands are registered"
    },
    {
      name: "manifest:t10IndependentProductionGates",
      ok: [
        "t10-clinical-blood-independent-gate",
        "t10-emergency-independent-gate",
        "t10-imaging-production-gate",
        "t10-physical-examination-independent-gate"
      ].every((marker) => manifestSource.includes(marker)),
      detail: "T10 clinical blood, emergency, imaging and physical-examination production gates are indexed"
    },
    {
      name: "api:t10SpecialtyModuleGovernance",
      ok: [
        "/api/t10-specialty/modules",
        "t10-specialty-module-selection-change",
        "trustedT10Institution",
        "canReadT10InstitutionModules"
      ].every((marker) => serverSource.includes(marker))
        && [
          "T10_MODULE_ACTOR_FORBIDDEN",
          "T10_MODULE_BOUNDARY_OVERRIDE_FORBIDDEN",
          "T10_MODULE_VERSION_CONFLICT",
          "T10_MODULE_IDEMPOTENCY_CONFLICT",
          "siteNoGoEnforced",
          "productionReady: false"
        ].every((marker) => t10SpecialtyModuleGovernanceSource.includes(marker))
        && Boolean(pkg.scripts?.["t10:specialty-cutover:check"])
        && Boolean(pkg.scripts?.["t10:specialty-cutover:test"]),
      detail: "institution module selection is commission-controlled, versioned, idempotent, audited and fixed to the site No-Go boundary"
    },
    { name: "manifest:multiPracticeReadiness", ok: manifestSource.includes("multi-practice-readiness-report.md") && manifestSource.includes("multi-practice:readiness"), detail: "multi-practice readiness artifact is indexed" },
    { name: "manifest:hybridDeploymentReadiness", ok: manifestSource.includes("hybrid-deployment-readiness-report.md") && manifestSource.includes("hybrid:deployment-readiness"), detail: "hybrid deployment readiness artifact is indexed" },
    { name: "snapshot:storageMeta", ok: Boolean(data.storageMeta?.engine && data.storageMeta?.mode), detail: data.storageMeta ? `${data.storageMeta.engine}/${data.storageMeta.mode}` : "missing" }
  ];

  const runCommands = options.runCommands === true;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const commandResults = runCommands ? [
    run(npm, ["run", "check"]),
    run(npm, ["run", "regional-referral:overlap"]),
    run(npm, ["test"]),
    run(npm, ["run", "test:coverage"]),
    run(npm, ["run", "test:e2e"]),
    run(npm, ["audit", "--omit=dev", "--registry=https://registry.npmjs.org"])
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
