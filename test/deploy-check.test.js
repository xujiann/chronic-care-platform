const assert = require("node:assert/strict");
const test = require("node:test");

const { buildDeployCheckReport, run } = require("../scripts/deploy-check");

test("deploy command runner preserves output beyond the spawn default buffer", () => {
  const outputSize = 2 * 1024 * 1024;
  const result = run("node", ["-e", `process.stdout.write('x'.repeat(${outputSize}))`]);

  assert.equal(result.ok, true, result.stderr);
  assert.equal(result.stdout.length, outputSize);
});

test("deploy check report covers release-critical snapshot gates", () => {
  const report = buildDeployCheckReport();
  const checkNames = new Set(report.checks.map((item) => item.name));

  assert.equal(report.ok, true);
  [
    "file:README.md",
    "file:DEPLOYMENT.md",
    "file:session-store.js",
    "file:production-adapters.js",
    "file:docs/production-identity-message-adapters.md",
    "file:hospital-connectors.js",
    "file:docs/production-hospital-connectors.md",
    "file:secure-object-storage.js",
    "file:scripts/object-storage-readiness.js",
    "file:docs/production-object-storage.md",
    "file:docs/production-go-live-requirements.md",
    "file:docs/卫生健康信息平台研发报告.md",
    "file:docs/on-site-launch-materials.md",
    "file:docs/production-database-cutover-center.md",
    "file:docs/citizen-service-operations-center.md",
    "file:docs/commercial-crypto-adapter-center.md",
    "file:docs/production-operations-run-center.md",
    "file:docs/registration-journey-center.md",
    "file:docs/registration-integration-center.md",
    "file:scripts/onsite-launch-requirements.js",
    "file:scripts/digital-hospital-standards-readiness.js",
    "file:scripts/phase2-proposal-readiness.js",
    "file:scripts/phase2-catalog-readiness.js",
    "file:scripts/phase2-joint-test-readiness.js",
    "file:scripts/phase2-mutual-recognition-readiness.js",
    "file:scripts/phase2-disease-reporting-readiness.js",
    "file:scripts/phase2-clinical-assist-readiness.js",
    "file:scripts/phase2-family-doctor-readiness.js",
    "file:scripts/citizen-operations-readiness.js",
    "file:scripts/commercial-crypto-readiness.js",
    "file:scripts/registration-journey-readiness.js",
    "file:scripts/registration-integration-readiness.js",
    "file:scripts/platform-production-audit.js",
    "file:immunization.html",
    "file:immunization.js",
    "file:immunization-schedule.js",
    "file:scripts/immunization-readiness.js",
    "file:docs/immunization-program-2026.md",
    "file:docs/数智医院标准平台全程审计与生产前开发规划.md",
    "file:docs/citizen-production-launch-requirements.md",
    "file:docs/数智医院标准平台研发报告.md",
    "file:docs/二期可研对标差距与下一步开发计划.md",
    "package:scripts",
    "package:priorityApplicationTemplates",
    "package:publicHealthReadiness",
    "package:immunizationReadiness",
    "package:digitalHospitalStandards",
    "package:phase2ProposalReadiness",
    "package:phase2CatalogReadiness",
    "package:phase2JointTestReadiness",
    "package:phase2MutualRecognitionReadiness",
    "package:phase2DiseaseReportingReadiness",
    "package:phase2ClinicalAssistReadiness",
    "package:phase2FamilyDoctorReadiness",
    "package:citizenOperationsReadiness",
    "package:commercialCryptoReadiness",
    "package:registrationJourneyReadiness",
    "package:registrationIntegrationReadiness",
    "package:platformProductionAudit",
    "package:objectStorageReadiness",
    "file:docs/公共卫生信息化下一步开发计划.md",
    "package:hybridDeploymentReadiness",
    "package:postgresMigrationPackage",
    "package:postgresSyncWorker",
    "package:postgresPrimaryReadAdapter",
    "snapshot:collections",
    "snapshot:regionalDataSharing",
    "snapshot:interfaceReadiness",
    "snapshot:securityAcceptance",
    "ui:digitalHospitalStandards",
    "digitalHospitalStandards:readiness",
    "api:digitalHospitalStandards",
    "snapshot:chronicFollowupStatusPolicy",
    "snapshot:publicHealth",
    "api:publicHealth",
    "api:publicHealthEventActions",
    "api:publicHealthAdvancedActions",
    "api:chronicPublicHealthLoop",
    "snapshot:externalDependencyRisks",
    "snapshot:p2-complete",
    "snapshot:accessibility",
    "snapshot:healthDashboard",
    "snapshot:healthDashboardIndicatorCenter",
    "snapshot:phase2Catalog",
    "snapshot:phase2JointTest",
    "snapshot:phase2MutualRecognition",
    "snapshot:phase2DiseaseReporting",
    "snapshot:phase2ClinicalAssist",
    "snapshot:phase2FamilyDoctor",
    "snapshot:citizenOperations",
    "snapshot:commercialCrypto",
    "snapshot:productionOperations",
    "snapshot:registrationJourney",
    "snapshot:registrationIntegration",
    "snapshot:multiPractice",
    "docs:chronicLaunchCore",
    "docs:platformResearchReport",
    "docs:platformProductionAudit",
    "api:productionIdentityMessageAdapters",
    "security:productionRuntimeBoundary",
    "api:productionHospitalConnectors",
    "api:secureObjectStorage",
    "deployment:immutablePackage",
    "deployment:packageRuntimeVerification",
    "deployment:releaseWiring",
    "docs:citizenAccountProvisioning",
    "docs:citizenExternalDependencyOwners",
    "docs:productionGoLiveRequirements",
    "docs:onsiteLaunchMaterials",
    "ui:immunizationLaunchBoard",
    "rules:immunizationLaunchRequirements",
    "docs:immunizationProductionGate",
    "docs:publicHealth",
    "docs:publicHealthNextPlan",
    "docs:phase2ProposalPlan",
    "api:siteLaunchEvidence",
    "api:publicHealthCutoverReadiness",
    "api:publicHealthCutoverEvidencePackets",
    "api:publicHealthCutoverDrills",
    "api:publicHealthProductionHandoffs",
    "api:publicHealthGoLiveObservations",
    "api:publicHealthLaunchIncidents",
    "api:publicHealthLaunchDutyShifts",
    "api:publicHealthLaunchCommandBriefs",
    "api:publicHealthSiteEvidenceBridge",
    "api:publicHealthSiteEvidenceVerificationTasks",
    "api:publicHealthStandardImplementationLedger",
    "api:productionDatabaseCutoverCenter",
    "database:postgresMigrationPackage",
    "database:postgresMigrationReleaseWiring",
    "database:postgresTransactionalOutbox",
    "database:postgresIdempotentWorker",
    "database:postgresWorkerDeployment",
    "database:postgresBaselineBootstrap",
    "database:postgresShadowReconciliation",
    "database:postgresPrimaryReadRehearsal",
    "database:postgresProductionAdapter",
    "database:postgresReconciliationCaseWorkflow",
    "database:postgresReconciliationDeployment",
    "runtime:sqliteProductionProfile",
    "api:citizenOperationsCenter",
    "api:commercialCryptoCenter",
    "api:productionOperationsCenter",
    "api:registrationJourney",
    "api:registrationIntegration",
    "api:publicHealthLaunchGate",
    "api:publicHealthLaunchApprovalPreflight",
    "docs:publicHealthGoLiveObservations",
    "docs:publicHealthLaunchIncidents",
    "docs:publicHealthLaunchDutyShifts",
    "docs:publicHealthLaunchCommandBriefs",
    "manifest:healthDashboardSummary",
    "manifest:healthDashboardIndicatorCenter",
    "manifest:launchSmoke",
    "manifest:onsiteLaunchRequirements",
    "manifest:priorityApplicationTemplates",
    "manifest:citizenLaunchFoundation",
    "manifest:publicHealthReadiness",
    "manifest:immunizationReadiness",
    "manifest:digitalHospitalStandards",
    "manifest:phase2ProposalReadiness",
    "manifest:phase2CatalogReadiness",
    "manifest:phase2JointTestReadiness",
    "manifest:phase2MutualRecognitionReadiness",
    "manifest:phase2DiseaseReportingReadiness",
    "manifest:phase2ClinicalAssistReadiness",
    "manifest:phase2FamilyDoctorReadiness",
    "manifest:citizenOperationsReadiness",
    "manifest:commercialCryptoReadiness",
    "manifest:productionOperationsReadiness",
    "manifest:registrationJourneyReadiness",
    "manifest:registrationIntegrationReadiness",
    "manifest:platformProductionAudit",
    "manifest:objectStorageReadiness",
    "manifest:multiPracticeReadiness",
    "manifest:hybridDeploymentReadiness",
    "snapshot:storageMeta"
  ].forEach((name) => assert.equal(checkNames.has(name), true, `${name} should be checked`));
  assert.match(report.checks.find((item) => item.name === "api:chronicPublicHealthLoop").detail, /immunization infectious-reporting and CDC command summary/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthAdvancedActions").detail, /exchange exception, institution, onsite and cutover action APIs/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthCutoverReadiness").detail, /cutover readiness API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthCutoverEvidencePackets").detail, /cutover evidence packet API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthCutoverDrills").detail, /cutover drill API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthProductionHandoffs").detail, /production handoff API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthGoLiveObservations").detail, /go-live observation API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthLaunchIncidents").detail, /launch incident desk API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthLaunchDutyShifts").detail, /launch duty handoff API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthLaunchCommandBriefs").detail, /launch command brief API and board/);
  assert.match(report.checks.find((item) => item.name === "snapshot:publicHealth").detail, /launch incidents/);
  assert.match(report.checks.find((item) => item.name === "snapshot:publicHealth").detail, /launch duty shifts/);
  assert.match(report.checks.find((item) => item.name === "snapshot:publicHealth").detail, /launch command briefs/);
  assert.match(report.checks.find((item) => item.name === "snapshot:publicHealth").detail, /site evidence verification tasks/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthSiteEvidenceBridge").detail, /site evidence bridge API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthSiteEvidenceVerificationTasks").detail, /site evidence verification task API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthStandardImplementationLedger").detail, /standard implementation ledger API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthLaunchGate").detail, /production launch gate API and board/);
  assert.match(report.checks.find((item) => item.name === "api:publicHealthLaunchApprovalPreflight").detail, /approval preflight blocks final approval/);
  assert.match(report.checks.find((item) => item.name === "api:digitalHospitalStandards").detail, /standards API, launch readiness gate, production evidence packets, command briefs, formal cutover approvals, seed data and frontend fetch fallback/);
  assert.match(report.checks.find((item) => item.name === "docs:chronicLaunchCore").detail, /closure, site signoff/);
  assert.match(report.checks.find((item) => item.name === "docs:platformResearchReport").detail, /policy basis/);
  assert.match(report.checks.find((item) => item.name === "ui:immunizationLaunchBoard").detail, /evidence ledger/);
  assert.match(report.checks.find((item) => item.name === "docs:immunizationProductionGate").detail, /production launch gate/);
  assert.match(report.checks.find((item) => item.name === "api:productionIdentityMessageAdapters").detail, /OIDC subject binding, refresh, revocation/);
  assert.match(report.checks.find((item) => item.name === "security:productionRuntimeBoundary").detail, /retention cleanup/);
  assert.match(report.checks.find((item) => item.name === "security:productionRuntimeBoundary").detail, /centralized multi-host session/);
  assert.match(report.checks.find((item) => item.name === "api:productionHospitalConnectors").detail, /outbound connectors/);
  assert.match(report.checks.find((item) => item.name === "manifest:citizenLaunchFoundation").detail, /resident pipeline acceptance panel/);
  assert.match(report.checks.find((item) => item.name === "api:secureObjectStorage").detail, /malware scan/);
  assert.match(report.checks.find((item) => item.name === "api:financialGateways").detail, /signed replay-safe amount-aware callbacks/);
  assert.match(report.checks.find((item) => item.name === "docs:citizenExternalDependencyOwners").detail, /blockers, evidence, and onsite acceptance/);
});

test("deploy check report does not run expensive commands by default", () => {
  const report = buildDeployCheckReport();

  assert.equal(report.checks.some((item) => item.name.startsWith("command:")), false);
});
