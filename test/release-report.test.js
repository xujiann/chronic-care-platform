const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildReleaseReport, parseArgs, renderCutoverMarkdown, renderMarkdown, renderServiceAcceptanceMarkdown, renderStorageModelMarkdown, validateProductionConfig, writeOutput } = require("../scripts/release-report");

const ROOT = path.resolve(__dirname, "..");

test("release report validates demo and production environment profiles", () => {
  const demo = validateProductionConfig({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret"
    }
  });
  assert.equal(demo.passed, true);
  assert.equal(demo.checks.some((item) => item.name === "env:SESSION_SECRETS.productionQuality" && item.severity === "warn"), true);

  const failedProduction = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "json",
      SESSION_SECRETS: "replace-with-long-random-secret",
      SESSION_STORE: "memory",
      INTEGRATION_GATEWAY_SECRET: "demo-secret"
    }
  });
  assert.equal(failedProduction.passed, false);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:STORAGE_ENGINE.production" && !item.passed), true);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:SESSION_SECRETS.productionQuality" && !item.passed), true);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:SESSION_STORE.productionDurable" && !item.passed), true);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:SMS.gateway" && !item.passed), true);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:AUDIT.retentionTarget" && !item.passed), true);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:ALERTING.routes" && !item.passed), true);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:ALERTING.secretQuality" && !item.passed), true);
  assert.equal(failedProduction.cutoverChecklist.some((item) => item.id === "cutover-secrets" && !item.passed), true);
  assert.equal(failedProduction.cutoverChecklist.some((item) => item.id === "cutover-identity" && !item.passed), true);

  const invalidMultiHostSessions = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "sqlite",
      SESSION_STORE: "sqlite",
      SESSION_TOPOLOGY: "multi-host"
    }
  });
  assert.equal(invalidMultiHostSessions.checks.some((item) => item.name === "env:SESSION_TOPOLOGY.storeCompatible" && !item.passed), true);

  const weakSqliteProfile = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "sqlite",
      SQLITE_JOURNAL_MODE: "DELETE",
      SQLITE_SYNCHRONOUS: "NORMAL",
      SQLITE_BUSY_TIMEOUT_MS: "1000"
    }
  });
  assert.equal(weakSqliteProfile.checks.some((item) => item.name === "env:SQLITE.journalMode" && !item.passed), true);
  assert.equal(weakSqliteProfile.checks.some((item) => item.name === "env:SQLITE.synchronous" && !item.passed), true);
  assert.equal(weakSqliteProfile.checks.some((item) => item.name === "env:SQLITE.busyTimeout" && !item.passed), true);
  assert.equal(weakSqliteProfile.cutoverChecklist.some((item) => item.id === "cutover-storage-adapter" && !item.passed), true);

  const postgresBeforeAdapter = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "postgres",
      DATABASE_URL: "postgres://health:secret@example.internal:5432/health",
      SESSION_SECRETS: "0123456789abcdef0123456789abcdef",
      INTEGRATION_GATEWAY_SECRET: "fedcba9876543210fedcba9876543210",
      OIDC_ISSUER_URL: "https://identity.example.internal",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "abcdef0123456789abcdef0123456789",
      IDENTITY_DIRECTORY_URL: "https://identity.example.internal/scim/v2/Users",
      IDENTITY_DIRECTORY_TOKEN: "0123456789abcdef0123456789abcdef",
      SMS_GATEWAY_URL: "https://sms.example.internal/send",
      SMS_TEMPLATE_ID: "resident-login-code",
      SMS_DELIVERY_CALLBACK_SECRET: "0123456789abcdef0123456789abcdef",
      HOSPITAL_ADAPTER_SECRET: "0123456789abcdef0123456789abcdef",
      HIS_ADAPTER_URL: "https://his.example.internal/events",
      EMR_ADAPTER_URL: "https://emr.example.internal/events",
      LIS_ADAPTER_URL: "https://lis.example.internal/events",
      PACS_ADAPTER_URL: "https://pacs.example.internal/events",
      APPOINTMENT_ADAPTER_URL: "https://his.example.internal/appointments",
      OBJECT_STORAGE_GATEWAY_URL: "https://storage.example.internal/api/",
      OBJECT_STORAGE_BUCKET: "health-attachments",
      OBJECT_STORAGE_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
      FINANCIAL_GATEWAY_SECRET: "0123456789abcdef0123456789abcdef",
      FINANCIAL_CALLBACK_SECRET: "abcdef0123456789abcdef0123456789",
      PAYMENT_GATEWAY_URL: "https://payment.example.internal/transactions",
      INSURANCE_GATEWAY_URL: "https://insurance.example.internal/settlements",
      CERTIFICATE_GATEWAY_URL: "https://certificate.example.internal/certificates",
      SIEM_ENDPOINT: "https://siem.example.internal/events",
      SIEM_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
      DEPLOYMENT_SECRET_PROVIDER: "vault",
      DEPLOYMENT_RELEASE_ID: "release-20260711-001",
      DEPLOYMENT_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
      AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit"
    }
  });
  assert.equal(postgresBeforeAdapter.passed, false);
  assert.equal(postgresBeforeAdapter.checks.some((item) => item.name === "env:STORAGE_ENGINE.runtimeAdapter" && !item.passed), true);

  const production = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "sqlite",
      SQLITE_JOURNAL_MODE: "WAL",
      SQLITE_SYNCHRONOUS: "FULL",
      SQLITE_BUSY_TIMEOUT_MS: "5000",
      SESSION_SECRETS: "0123456789abcdef0123456789abcdef,abcdef0123456789abcdef0123456789",
      SESSION_STORE: "sqlite",
      SESSION_TOPOLOGY: "single-host",
      SESSION_EXPIRED_RETENTION_DAYS: "7",
      SESSION_REVOKED_RETENTION_DAYS: "30",
      SESSION_CLEANUP_INTERVAL_MS: "900000",
      INTEGRATION_GATEWAY_SECRET: "fedcba9876543210fedcba9876543210",
      OIDC_ISSUER_URL: "https://identity.example.internal",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "abcdef0123456789abcdef0123456789",
      IDENTITY_DIRECTORY_URL: "https://identity.example.internal/scim/v2/Users",
      IDENTITY_DIRECTORY_TOKEN: "0123456789abcdef0123456789abcdef",
      SMS_GATEWAY_URL: "https://sms.example.internal/send",
      SMS_TEMPLATE_ID: "resident-login-code",
      SMS_DELIVERY_CALLBACK_SECRET: "0123456789abcdef0123456789abcdef",
      HOSPITAL_ADAPTER_SECRET: "0123456789abcdef0123456789abcdef",
      HIS_ADAPTER_URL: "https://his.example.internal/events",
      EMR_ADAPTER_URL: "https://emr.example.internal/events",
      LIS_ADAPTER_URL: "https://lis.example.internal/events",
      PACS_ADAPTER_URL: "https://pacs.example.internal/events",
      APPOINTMENT_ADAPTER_URL: "https://his.example.internal/appointments",
      OBJECT_STORAGE_GATEWAY_URL: "https://storage.example.internal/api/",
      OBJECT_STORAGE_BUCKET: "health-attachments",
      OBJECT_STORAGE_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
      FINANCIAL_GATEWAY_SECRET: "0123456789abcdef0123456789abcdef",
      FINANCIAL_CALLBACK_SECRET: "abcdef0123456789abcdef0123456789",
      PAYMENT_GATEWAY_URL: "https://payment.example.internal/transactions",
      INSURANCE_GATEWAY_URL: "https://insurance.example.internal/settlements",
      CERTIFICATE_GATEWAY_URL: "https://certificate.example.internal/certificates",
      SIEM_ENDPOINT: "https://siem.example.internal/events",
      SIEM_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
      DEPLOYMENT_SECRET_PROVIDER: "vault",
      DEPLOYMENT_RELEASE_ID: "release-20260711-001",
      DEPLOYMENT_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
      AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit"
    }
  });
  assert.equal(production.passed, true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-identity" && item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-audit-retention" && item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-storage-adapter" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SQLITE.journalMode" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SQLITE.synchronous" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SQLITE.busyTimeout" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SESSION_STORE.productionDurable" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SESSION_TOPOLOGY.present" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SESSION_TOPOLOGY.storeCompatible" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SESSION_RETENTION.present" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SESSION_RETENTION.policy" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SESSION_RETENTION.interval" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:OIDC.lifecycle" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SMS.deliveryCallback" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:SMS.callbackSecretQuality" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:HOSPITAL.connectors" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:HOSPITAL.secretQuality" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:OBJECT_STORAGE.adapter" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:OBJECT_STORAGE.secretQuality" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:FINANCIAL.gateways" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:FINANCIAL.secretQuality" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:FINANCIAL.callbacks" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:FINANCIAL.callbackSecretQuality" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:ALERTING.routes" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:ALERTING.secretQuality" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:DEPLOYMENT.secretProvider" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:DEPLOYMENT.releaseId" && item.passed), true);
  assert.equal(production.checks.some((item) => item.name === "env:DEPLOYMENT.artifactDigest" && item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-institution-interfaces" && !item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-chronic-launch-core" && !item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-monitoring" && /missing site signoff/.test(item.evidence)), true);

  const missingEnvFile = validateProductionConfig({
    profile: "production",
    envFile: ".env.missing"
  });
  assert.equal(missingEnvFile.passed, false);
  assert.equal(missingEnvFile.checks.some((item) => item.name === "env:file" && !item.passed), true);
});

test("release report shows configured audit retention target detail", () => {
  const report = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret",
      AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit"
    }
  });
  const check = report.checks.find((item) => item.name === "audit:retentionTargetConfigured");
  assert.equal(check.passed, true);
  assert.match(check.detail, /AUDIT_EXPORT_PATH:configured/);
  assert.match(check.detail, /SIEM_ENDPOINT:missing/);
});

test("release report keeps the site evidence verification desk ready while evidence is awaiting review", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/db.json"), "utf8"));
  data.siteLaunchEvidence = [{
    id: "sle-release-report-partial",
    templateId: "interface-statistics-report-v1",
    status: "verified",
    artifactName: "signed direct-report receipt",
    verifiedAt: "2026-07-10T09:00:00+08:00",
    verifiedBy: "commission reviewer",
    attachmentNames: ["signed-receipt.pdf"]
  }];
  const report = buildReleaseReport({
    profile: "demo",
    data,
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret",
      SIEM_ENDPOINT: "https://siem.example.internal/events",
      SIEM_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
      AUDIT_EXPORT_PATH: "release/audit-export-test.ndjson"
    }
  });
  const deskCheck = report.checks.find((item) => item.name === "publicHealth:siteEvidenceVerificationTasks");
  assert.equal(report.publicHealthReadiness.siteEvidenceVerificationBoard.status, "verification-pending");
  assert.equal(deskCheck.passed, true);
  assert.match(deskCheck.detail, /verification-pending/);
});

test("release report summarizes repository readiness and renders markdown", () => {
  const report = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret",
      SIEM_ENDPOINT: "https://siem.example.internal/events",
      SIEM_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
      AUDIT_EXPORT_PATH: "release/audit-export-test.ndjson"
    }
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.warnings, 1);
  assert.equal(report.checks.some((item) => item.name === "productionReleaseEvidence:formalGate" && !item.passed && item.severity === "warn"), true);
  assert.equal(report.checks.some((item) => item.name === "monitoring:alertRouting" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "monitoring:productionBoundary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "env:ALERTING.routes" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "package:scripts" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "file:drug-consumable-about.html" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:acceptanceEvidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:securityAcceptance" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:productionDeploymentPlan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:interfaceReadiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:externalDependencyRisks" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:drugTraceabilityPolicySources" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:drugTraceabilityEvidenceRequirements" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "storage:jsonSnapshot.present" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "storage:jsonSnapshot.collections" && item.passed), true);
  assert.equal(report.storageModel.jsonSnapshot.present, true);
  assert.equal(report.storageModel.jsonSnapshot.collections >= 40, true);
  assert.equal(report.checks.some((item) => item.name === "identity:contract" && item.passed), true);
  assert.equal(report.identityContract.ok, true);
  assert.equal(report.checks.some((item) => item.name === "audit:retention" && item.passed), true);
  assert.equal(report.auditRetention.ok, true);
  assert.equal(report.checks.some((item) => item.name === "audit:retentionTargetConfigured" && item.passed), true);
  assert.equal(report.auditRetention.retentionTargets.some((item) => item.env === "AUDIT_EXPORT_PATH" && item.configured), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:policyAlignment" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:alertQueue" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:residentExperience" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:fieldIntegration" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:institutionInterfaces" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:launchCore" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:notifications" && item.passed), true);
  assert.equal(report.chronicFollowup.ok, true);
  assert.equal(report.chronicFollowup.summary.notificationMessages >= 1, true);
  assert.equal(report.chronicFollowup.summary.alerts >= 1, true);
  assert.equal(report.chronicFollowup.summary.residentExperienceItems >= 1, true);
  assert.equal(report.chronicFollowup.summary.fieldIntegrationItems >= 1, true);
  assert.equal(report.chronicInstitutionInterfaces.summary.readyContracts, report.chronicInstitutionInterfaces.summary.contracts);
  assert.equal(report.chronicLaunchCore.summary.readyItems, 5);
  assert.equal(report.chronicLaunchCore.summary.closureRows >= 14, true);
  assert.equal(report.chronicLaunchCore.summary.signedSignoffs, 6);
  assert.equal(report.chronicFollowup.summary.policyAligned, report.chronicFollowup.summary.policyItems);
  assert.equal(report.chronicFollowup.apiSurface.includes("POST /api/chronic/followup-feedback"), true);
  assert.equal(report.chronicFollowup.apiSurface.includes("GET /api/chronic/public-health-loop"), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:institutionInterfaces" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:launchCore" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:publicHealthLoop" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:publicHealthIntegrations" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "chronicFollowup:informatizationSources" && item.passed), true);
  assert.equal(report.chronicInformatizationSources.ok, true);
  assert.equal(report.chronicInformatizationSources.summary.readyCapabilityTracks, report.chronicInformatizationSources.summary.capabilityTracks);
  assert.equal(report.chronicInstitutionInterfaces.summary.readyContracts, report.chronicInstitutionInterfaces.summary.contracts);
  assert.equal(report.chronicLaunchCore.summary.readyItems, 5);
  assert.equal(report.checks.some((item) => item.name === "dataQuality:report" && item.passed), true);
  assert.equal(report.dataQuality.ok, true);
  assert.equal(report.checks.some((item) => item.name === "healthDashboard:industryGovernanceIndicators" && item.passed), true);
  assert.equal(report.healthDashboard.indicatorCenter.indicators.length, 8);
  assert.equal(report.healthDashboard.indicatorCenter.periodViews.length, 2);
  assert.equal(report.checks.some((item) => item.name === "digitalHospitalStandards:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "digitalHospitalStandards:api" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "digitalHospitalStandards:launchReadiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "digitalHospitalStandards:controlRemediation" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "digitalHospitalStandards:selfAssessment" && item.passed), true);
  assert.equal(report.digitalHospitalStandards.ok, true);
  assert.equal(report.checks.some((item) => item.name === "digitalHospitalPilot:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "digitalHospitalPilot:functionalState" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "digitalHospitalPilot:formalBoundary" && item.passed && item.severity === "warn"), true);
  assert.equal(report.digitalHospitalPilot.ok, true);
  assert.equal(report.digitalHospitalPilot.functionalState, "pilot-launch-ready");
  assert.equal(report.digitalHospitalPilot.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(report.platformProductionAudit.ok, true);
  assert.equal(report.platformProductionAudit.productionReady, false);
  assert.equal(report.checks.some((item) => item.name === "platformProductionAudit:capabilities" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "platformProductionAudit:mvpRequiredModules" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "financialGateway:callbackReconciliation" && item.passed), true);
  assert.equal(report.digitalHospitalStandards.summary.standardDomains >= 6, true);
  assert.equal(report.digitalHospitalStandards.summary.apiMarkers >= 5, true);
  assert.equal(report.digitalHospitalStandards.summary.launchMarkers >= 16, true);
  assert.equal(report.digitalHospitalStandards.summary.evidenceModes >= 5, true);
  assert.equal(report.checks.some((item) => item.name === "phase2Proposal:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "phase2Proposal:externalBoundary" && item.passed), true);
  assert.equal(report.phase2Proposal.ok, true);
  assert.equal(report.phase2Proposal.summary.gapRows >= 12, true);
  assert.equal(report.checks.some((item) => item.name === "phase2Catalog:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "phase2Catalog:tables" && item.passed), true);
  assert.equal(report.phase2Catalog.ok, true);
  assert.equal(report.phase2Catalog.summary.tablesMapped >= 216, true);
  assert.equal(report.checks.some((item) => item.name === "phase2JointTest:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "phase2JointTest:payloads" && item.passed), true);
  assert.equal(report.phase2JointTest.ok, true);
  assert.equal(report.phase2JointTest.summary.institutions >= 3, true);
  assert.equal(report.checks.some((item) => item.name === "phase2MutualRecognition:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "phase2MutualRecognition:catalog" && item.passed), true);
  assert.equal(report.phase2MutualRecognition.ok, true);
  assert.equal(report.phase2MutualRecognition.summary.catalogItems >= 78, true);
  assert.equal(report.checks.some((item) => item.name === "phase2DiseaseReporting:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "phase2DiseaseReporting:receipts" && item.passed), true);
  assert.equal(report.phase2DiseaseReporting.ok, true);
  assert.equal(report.phase2DiseaseReporting.summary.reportCards >= 4, true);
  assert.equal(report.checks.some((item) => item.name === "phase2ClinicalAssist:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "phase2ClinicalAssist:alerts" && item.passed), true);
  assert.equal(report.phase2ClinicalAssist.ok, true);
  assert.equal(report.phase2ClinicalAssist.summary.alerts >= 4, true);
  assert.equal(report.checks.some((item) => item.name === "phase2FamilyDoctor:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "phase2FamilyDoctor:fulfillment" && item.passed), true);
  assert.equal(report.phase2FamilyDoctor.ok, true);
  assert.equal(report.phase2FamilyDoctor.summary.contracts >= 3, true);
  assert.equal(report.checks.some((item) => item.name === "citizenOperations:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "citizenOperations:production-boundary" && item.passed), true);
  assert.equal(report.citizenOperations.ok, true);
  assert.equal(report.citizenOperations.summary.publishedContents >= 3, true);
  assert.equal(report.citizenOperations.summary.productionReadyHospitals, 0);
  assert.equal(report.checks.some((item) => item.name === "registrationJourney:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "registrationJourney:cross-role" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "registrationJourney:production-boundary" && item.passed), true);
  assert.equal(report.registrationJourney.ok, true);
  assert.equal(report.registrationJourney.center.summary.orders >= 1, true);
  assert.equal(report.registrationJourney.center.summary.productionReady, 0);
  assert.equal(report.checks.some((item) => item.name === "registrationIntegration:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "registrationIntegration:gateway" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "registrationIntegration:production-boundary" && item.passed), true);
  assert.equal(report.registrationIntegration.ok, true);
  assert.equal(report.registrationIntegration.center.contract.id, "appointment-order-v1");
  assert.equal(report.registrationIntegration.center.summary.productionReady, 0);
  assert.equal(report.checks.some((item) => item.name === "commercialCrypto:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "commercialCrypto:production-boundary" && item.passed), true);
  assert.equal(report.commercialCrypto.ok, true);
  assert.equal(report.commercialCrypto.summary.capabilities, 6);
  assert.equal(report.commercialCrypto.summary.productionReady, 0);
  assert.equal(report.checks.some((item) => item.name === "drugConsumable:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "drugConsumable:supplyAlert" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "drugConsumable:traceabilityPolicy" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "drugConsumable:traceabilityEvidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "drugConsumable:traceabilitySubmission" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "drugConsumable:traceabilityCoverage" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "drugConsumable:launchReadiness" && item.passed), true);
  assert.equal(report.drugConsumable.ok, true);
  assert.equal(report.checks.some((item) => item.name === "integration:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "integration:runtimeAdapters" && item.passed), true);
  assert.equal(report.integrationReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "objectStorage:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "objectStorage:productionBoundary" && item.passed), true);
  assert.equal(report.objectStorageReadiness.ok, true);
  assert.equal(report.objectStorageReadiness.productionReady, false);
  assert.equal(report.checks.some((item) => item.name === "financialGateway:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "financialGateway:productionBoundary" && item.passed), true);
  assert.equal(report.financialGatewayReadiness.ok, true);
  assert.equal(report.financialGatewayReadiness.productionReady, false);
  assert.equal(report.checks.some((item) => item.name === "interfaceMapping:report" && item.passed), true);
  assert.equal(report.interfaceMapping.ok, true);
  assert.equal(report.checks.some((item) => item.name === "hospitalOps:readiness" && item.passed), true);
  assert.equal(report.hospitalOperationsReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "hospitalOpsRelease:ready" && item.passed), true);
  assert.equal(report.hospitalOperationsRelease.ok, true);
  assert.equal(report.checks.some((item) => item.name === "hospitalOpsBriefPdf:ready" && item.passed), true);
  assert.equal(report.hospitalOperationsBriefPdf.ok, true);
  assert.equal(report.checks.some((item) => item.name === "regionalDataSharing:report" && item.passed), true);
  assert.equal(report.regionalDataSharing.ok, true);
  assert.equal(report.checks.some((item) => item.name === "regionalDataSharing:handoffEvidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "regionalDataSharing:handoffRuntime" && item.passed), true);
  assert.equal(report.regionalDataSharing.summary.referralHandoffReady >= 1, true);
  assert.equal(report.regionalDataSharing.packages.every((item) => item.referralHandoff?.total === 6), true);
  assert.equal(report.checks.some((item) => item.name === "regionalConfiguration:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "regionalConfiguration:valueBoundary" && item.passed), true);
  assert.equal(report.regionalConfigurationReadiness.productionReady, false);
  assert.equal(report.checks.some((item) => item.name === "regionalSiteEvidence:verifier" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "regionalSiteEvidence:minimizedBoundary" && item.passed), true);
  assert.equal(report.regionalSiteEvidenceReadiness.productionReady, false);
  assert.equal(report.regionalSiteEvidenceReadiness.containsEvidenceBodies, false);
  assert.equal(report.checks.some((item) => item.name === "regionalDossier:control" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "regionalDossier:productionBoundary" && item.passed), true);
  assert.equal(report.regionalCutoverDossier.productionReady, false);
  assert.equal(report.checks.some((item) => item.name === "regionalReferralOverlap:report" && item.passed), true);
  assert.equal(report.regionalReferralOverlap.runtimeMergeAllowed, false);
  assert.equal(report.checks.some((item) => item.name === "monitoring:readiness" && item.passed), true);
  assert.equal(report.monitoringReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "referralTeleconsultation:readiness" && item.passed), true);
  assert.equal(report.referralTeleconsultationReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "escortService:citizenProviderAvailability" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "escortService:citizenSubmitReadiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "escortService:appointmentFieldGuard" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "internetNursing:closedLoopSummary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "internetNursing:highlightFeatures" && item.passed), true);
  assert.equal(report.internetNursingReadiness.summary.highlightFeatures, 10);
  assert.equal(report.checks.some((item) => item.name === "productionGoNoGo:evidenceDrift" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "diseasePayment:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "diseasePayment:formalGroupingOperations" && item.passed), true);
  assert.equal(report.diseasePaymentReadiness.ready, true);
  assert.equal(report.checks.some((item) => item.name === "operations:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "operations:runCenter" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "operations:production-boundary" && item.passed), true);
  assert.equal(report.operationsReadiness.ok, true);
  assert.equal(report.operationsReadiness.runCenter.summary.serviceLevels, 4);
  assert.equal(report.operationsReadiness.runCenter.summary.productionReady, 0);
  assert.equal(report.checks.some((item) => item.name === "process:audit" && item.passed), true);
  assert.equal(report.processAudit.ok, true);
  assert.equal(report.checks.some((item) => item.name === "service:chronicDomains" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "service:countyDomains" && item.passed), true);
  assert.equal(report.serviceAcceptance.chronic.summary.domains, 8);
  assert.equal(report.serviceAcceptance.county.summary.domains, 5);
  assert.equal(report.serviceAcceptance.chronic.openActions.some((item) => item.id === "cst-001" && item.collection === "chronicScreeningTasks"), true);
  assert.equal(report.serviceAcceptance.county.openActions.some((item) => item.id === "cco-001" && item.collection === "countyCollaborationOrders"), true);
  assert.equal(report.serviceAcceptance.chronic.openActions.find((item) => item.id === "cst-001").priority, "high");
  assert.equal(report.serviceAcceptance.county.openActions.find((item) => item.id === "cco-001").priority, "high");
  assert.equal(report.checks.some((item) => item.name === "sitePack:readiness" && item.passed), true);
  assert.equal(report.siteReadinessPack.ok, true);
  assert.equal(report.checks.some((item) => item.name === "onsiteLaunch:requirements" && item.passed), true);
  assert.equal(report.onsiteLaunchRequirements.ok, true);
  assert.equal(report.onsiteLaunchRequirements.formalGoLiveState, "blocked-until-site-materials-signed");
  assert.equal(report.checks.some((item) => item.name === "productionDb:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:cutoverCenter" && item.passed), true);
  assert.equal(report.productionDbReadiness.ok, true);
  assert.equal(report.productionDbReadiness.cutoverCenter.summary.migrationBatches, 4);
  assert.equal(report.productionDbReadiness.cutoverCenter.summary.productionReadyRuns, 0);
  assert.equal(report.checks.some((item) => item.name === "productionDb:migrationPackage" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:migrationBoundary" && item.passed), true);
  assert.equal(report.productionDbReadiness.postgresMigrationPackage.manifest.mode, "manifest");
  assert.equal(report.checks.some((item) => item.name === "productionDb:transactionalOutbox" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:idempotentWorker" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:baselineBootstrap" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:shadowReconciliation" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:primaryReadRehearsal" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:productionAdapter" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:reconciliationCaseWorkflow" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:reconciliationScheduler" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:shadowBoundary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "evaluation:evidence" && item.passed), true);
  assert.equal(report.evaluationEvidence.ok, true);
  assert.equal(report.checks.some((item) => item.name === "environment:matrix" && item.passed), true);
  assert.equal(report.environmentMatrix.ok, true);
  assert.equal(report.checks.some((item) => item.name === "hybridDeployment:readiness" && item.passed), true);
  assert.equal(report.hybridDeploymentReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "deploymentPackage:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "deploymentPackage:secretBoundary" && item.passed), true);
  assert.equal(report.productionDeploymentPackage.ok, true);
  assert.equal(report.productionDeploymentPackage.verification.ok, true);
  assert.equal(report.productionDeploymentPackage.productionReady, false);
  assert.equal(report.checks.some((item) => item.name === "priorityApps:conversationStarters" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "priorityApps:implementationChecklists" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "priorityApps:acceptanceGates" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "maternalChild:riskMetrics" && item.passed), true);
  assert.deepEqual(Object.keys(report.maternalChildReadiness.summary.riskMetrics), ["pendingPublicSecuritySync", "pendingMaternalChildSync", "qualityPending"]);
  assert.equal(report.checks.some((item) => item.name === "immunization:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "immunization:launchBoard" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "immunization:productionBoundary" && item.passed), true);
  assert.equal(report.immunizationReadiness.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(report.immunizationReadiness.summary.launchSitePending >= 4, true);
  const publicHealthReadiness = report.checks.find((item) => item.name === "publicHealth:readiness");
  assert.equal(Boolean(publicHealthReadiness), true);
  assert.equal(publicHealthReadiness.passed || (publicHealthReadiness.severity === "warn" && /site cutover blockers/.test(publicHealthReadiness.detail)), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:standardTotal" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:standardImplementationLedger" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:standardImplementationActions" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:eventActionApi" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:nextPlan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:exchangeRuns" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:institutionTasks" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:onsiteAcceptance" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:cutoverBlockers" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:cutoverReadiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:cutoverEvidencePackets" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:cutoverDrills" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:productionHandoffs" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:goLiveObservations" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:launchIncidents" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:launchDutyShifts" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:launchCommandBriefs" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:siteEvidenceBridge" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:siteEvidenceVerificationTasks" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:launchApprovalPreflight" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealth:launchGate" && item.passed), true);
  assert.equal(report.publicHealthReadiness.ok, true);
  assert.equal(report.publicHealthReadiness.summary.domains, 21);
  assert.equal(report.publicHealthReadiness.summary.secondaryIndicators, 125);
  assert.equal(report.publicHealthReadiness.summary.tertiaryIndicators, 421);
  assert.equal(report.publicHealthReadiness.standardImplementationBoard.status, "mapping-review-pending");
  assert.equal(report.publicHealthReadiness.standardImplementationBoard.summary.domains, 21);
  assert.equal(report.publicHealthReadiness.standardImplementationBoard.summary.mappingComplete, 21);
  assert.equal(report.publicHealthReadiness.standardImplementationBoard.summary.gaps, 0);
  assert.equal(report.publicHealthReadiness.summary.standardImplementationEvidenceCandidates, 0);
  assert.equal(report.publicHealthReadiness.summary.standardImplementationAssignedGaps, 0);
  assert.equal(report.publicHealthReadiness.summary.standardImplementationVerifiedGaps, 0);
  assert.equal(report.publicHealthReadiness.summary.standardImplementationUnassignedGaps, 0);
  assert.equal(report.publicHealthReadiness.summary.standardImplementationDueSoonGaps, 0);
  assert.equal(report.publicHealthReadiness.summary.standardImplementationOverdueGaps, 0);
  assert.equal(report.publicHealthReadiness.summary.exchangeExceptions >= 2, true);
  assert.equal(report.publicHealthReadiness.summary.openExchangeExceptions >= 1, true);
  assert.equal(report.publicHealthReadiness.summary.resolvedExchangeExceptions >= 1, true);
  assert.equal(Number.isFinite(report.publicHealthReadiness.summary.eventActions), true);
  assert.equal(report.publicHealthReadiness.summary.exchangeRuns >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.institutionTasks >= 7, true);
  assert.equal(report.publicHealthReadiness.summary.onsiteAcceptances >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.cutoverBlockers >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.cutoverEvidencePackets >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.cutoverDrills >= 4, true);
  assert.equal(report.publicHealthReadiness.summary.productionHandoffs >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.goLiveObservations >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.goLiveObservationPlanReady >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.goLiveOpenCriticalSignals, 0);
  assert.equal(report.publicHealthReadiness.summary.launchIncidentLanes >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.launchIncidentDeskReady >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.launchIncidentCriticalOpen, 0);
  assert.equal(report.publicHealthReadiness.summary.launchDutyShifts >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.launchDutyReadyShifts >= 6, true);
  assert.equal(report.publicHealthReadiness.summary.launchDutyMissedHandoffs, 0);
  assert.equal(report.publicHealthReadiness.summary.launchCommandBriefs >= 5, true);
  assert.equal(report.publicHealthReadiness.summary.launchCommandReadyBriefs >= 5, true);
  assert.equal(report.publicHealthReadiness.summary.launchCommandBlockedBriefs, 0);
  assert.equal(report.publicHealthReadiness.summary.launchCommandExpectedAcknowledgements, 0);
  assert.equal(report.publicHealthReadiness.summary.launchCommandAcknowledgedRecipients, 0);
  assert.equal(report.publicHealthReadiness.summary.launchCommandPendingAcknowledgements, 0);
  assert.equal(report.publicHealthReadiness.productionHandoffBoard.status, "blocked");
  assert.equal(report.publicHealthReadiness.productionHandoffBoard.summary.releaseArtifacts >= 8, true);
  assert.equal(report.publicHealthReadiness.goLiveObservationBoard.status, "watch-ready");
  assert.equal(report.publicHealthReadiness.goLiveObservationBoard.summary.rollbackPlans >= 6, true);
  assert.equal(report.publicHealthReadiness.launchIncidentBoard.status, "desk-ready");
  assert.equal(report.publicHealthReadiness.launchIncidentBoard.summary.rollbackDecisionOwners >= 4, true);
  assert.equal(report.publicHealthReadiness.launchDutyBoard.status, "roster-ready");
  assert.equal(report.publicHealthReadiness.launchDutyBoard.summary.backupContacts >= 6, true);
  assert.equal(report.publicHealthReadiness.launchCommandBriefBoard.status, "briefing-ready");
  assert.equal(report.publicHealthReadiness.launchCommandBriefBoard.summary.sourceBoards >= 4, true);
  assert.equal(report.publicHealthReadiness.launchCommandBriefBoard.summary.expectedAcknowledgements, 0);
  assert.equal(report.publicHealthReadiness.summary.siteEvidenceBridgeLinks >= 8, true);
  assert.equal(report.publicHealthReadiness.summary.siteEvidenceVerificationTasks >= 9, true);
  assert.equal(report.publicHealthReadiness.summary.siteEvidenceVerificationVerifiedTasks, 0);
  assert.equal(report.publicHealthReadiness.siteEvidenceVerificationBoard.status, "evidence-pending");
  assert.equal(report.publicHealthReadiness.summary.launchApprovals >= 6, true);
  assert.equal(report.publicHealthReadiness.launchGate.approvalPreflight.status, "blocked");
  assert.equal(report.publicHealthReadiness.launchGate.approvalPreflight.blockedPrerequisites >= 1, true);
  assert.equal(report.publicHealthReadiness.cutoverEvidenceBoard.summary.requiredItems >= 20, true);
  assert.equal(report.publicHealthReadiness.siteEvidenceBridge.summary.linkedItems >= 20, true);
  assert.equal(report.publicHealthReadiness.siteEvidenceBridge.status, "missing-site-evidence");
  assert.equal(report.publicHealthReadiness.summary.p0OpenCutoverBlockers >= 1, true);
  assert.equal(report.publicHealthReadiness.cutoverReadiness.readinessLevel, "blocked");
  assert.equal(report.publicHealthReadiness.cutoverReadiness.releaseGate, "site-evidence-required");
  assert.equal(report.publicHealthReadiness.cutoverDrillBoard.status, "blocked");
  assert.equal(report.publicHealthReadiness.cutoverDrillBoard.summary.openFindings >= 4, true);
  assert.equal(report.publicHealthReadiness.launchGate.summary.requirements >= 8, true);
  assert.equal(report.publicHealthReadiness.launchGate.releaseGate, "site-evidence-required");
  assert.equal(report.publicHealthFinalReadiness.ok, true);
  assert.equal(report.publicHealthFinalReadiness.summary.passed, 91);
  assert.equal(report.publicHealthFinalReadiness.summary.t08FunctionalPassed, 70);
  assert.equal(report.publicHealthFinalReadiness.summary.t00BoundaryPassed, 21);
  assert.equal(report.publicHealthFinalReadiness.productionReady, false);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:keyProvider" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:dualCas" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:resilienceAlerts" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:contractGovernance" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:contractCutover" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:contractChain" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:contractChainPersistence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:activeEndpointProbe" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:endpointProbeCampaign" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:modernizationRoutes" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:modernizationPersistence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "publicHealthFinal:modernizationUi" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "citizenLaunch:readiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "citizenLaunch:phoneCodeDelivery" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "citizenLaunch:accountProvisioning" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "citizenLaunch:externalDependencies" && item.passed && /owners, blockers, evidence, and onsite acceptance/.test(item.detail)), true);
  assert.equal(report.checks.some((item) => item.name === "citizenLaunch:mobilePreviewServiceSwitch" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "citizenLaunch:pipelineAcceptanceChecklist" && item.passed), true);
  assert.equal(report.citizenLaunchFoundation.ok, true);
  assert.equal(report.citizenLaunchFoundation.acceptancePanel.entry, "citizen.html?client=app&page=health-record&launch=1#citizen-pipeline-panel");
  assert.equal(report.citizenLaunchFoundation.acceptancePanel.copyActionId, "copy-citizen-pipeline-audit");
  assert.equal(report.citizenLaunchFoundation.checks.some((item) => item.id === "citizen-foundation:phone-code-delivery" && item.passed), true);
  assert.equal(report.citizenLaunchFoundation.checks.some((item) => item.id === "citizen-foundation:pipeline-acceptance-checklist" && item.passed), true);
  assert.equal(report.citizenLaunchFoundation.externalDependencies.every((item) => item.owner && item.cutoverBlocker && item.evidence && item.onsiteAcceptance), true);
  assert.equal(report.priorityApplicationTemplates.templates.every((item) => item.conversationStarter && item.implementationChecklist.length >= 8 && item.acceptanceGate.readyWhen.length >= 4), true);
  assert.equal(report.priorityApplicationTemplates.templates.every((item) => item.implementationChecklist.some((step) => /Follow Codex loop/.test(step))), true);
  assert.equal(report.environmentMatrix.profiles.some((item) => item.id === "staging"), true);
  assert.equal(report.checks.some((item) => item.name === "qualitySafety:siteSignoffTracker" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "qualitySafety:warningIndicators" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "qualitySafety:goLiveReadiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "qualitySafetyInterface:standard" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "qualitySafetyInterfaceJointTest:pack" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "qualitySafetyInterfaceJointTest:siteSampleAcceptance" && item.passed), true);
  assert.equal(report.qualitySafety.goLiveReadiness.usable, true);
  assert.equal(report.qualitySafety.goLiveReadiness.stage, "controlled_pilot_ready");
  assert.equal(report.qualitySafety.siteSignoffs.length >= 6, true);
  assert.equal(report.qualitySafety.warningIndicators.some((item) => item.id === "warning-rectification-sla" && item.closedLoopReady), true);
  assert.equal(report.qualitySafetyInterfaceStandard.ok, true);
  assert.equal(report.qualitySafetyInterfaceStandard.summary.interfaces >= 6, true);
  assert.equal(report.qualitySafetyInterfaceJointTest.ok, true);
  assert.equal(report.qualitySafetyInterfaceJointTest.summary.sampleAccepted, report.qualitySafetyInterfaceJointTest.summary.sampleRequests);
  assert.equal(report.qualitySafetyInterfaceJointTest.summary.siteSampleReady, report.qualitySafetyInterfaceJointTest.summary.siteSampleAcceptance);
  assert.equal(report.qualityOperationsGovernance.ok, true);
  assert.equal(report.qualityOperationsGovernance.productionReady, false);
  assert.equal(report.qualityOperationsGovernance.catalog.sourceCollections.length, 3);
  assert.equal(report.checks.some((item) => item.name === "qualityOperationsGovernance:readiness" && item.passed), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-env-file"), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-institution-interfaces" && !item.passed), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-chronic-launch-core" && !item.passed), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-insurance-certificate" && !item.passed), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-monitoring" && !item.passed), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-dr-rehearsal" && !item.passed), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Release readiness report/);
  assert.match(markdown, /Production cutover checklist/);
  assert.match(markdown, /Storage model inspection/);
  assert.match(markdown, /Identity integration contract/);
  assert.match(markdown, /Audit retention report/);
  assert.match(markdown, /Chronic launch core readiness/);
  assert.match(markdown, /Integration readiness report/);
  assert.match(markdown, /Interface mapping report/);
  assert.match(markdown, /Regional data sharing and referral overlap report/);
  assert.match(markdown, /Regional configuration admission and cutover dossier/);
  assert.match(markdown, /Data quality and master index report/);
  assert.match(markdown, /Digital hospital standards readiness report/);
  assert.match(markdown, /digital-hospital-standards-readiness-report\.md/);
  assert.match(markdown, /copyable C-end pipeline acceptance checklist/);
  assert.match(markdown, /Phase 2 proposal readiness report/);
  assert.match(markdown, /phase2-proposal-readiness-report\.md/);
  assert.match(markdown, /Phase 2 catalog readiness report/);
  assert.match(markdown, /phase2-catalog-readiness-report\.md/);
  assert.match(markdown, /Phase 2 joint-test readiness report/);
  assert.match(markdown, /phase2-joint-test-readiness-report\.md/);
  assert.match(markdown, /Phase 2 mutual recognition readiness report/);
  assert.match(markdown, /phase2-mutual-recognition-readiness-report\.md/);
  assert.match(markdown, /Phase 2 disease reporting readiness report/);
  assert.match(markdown, /phase2-disease-reporting-readiness-report\.md/);
  assert.match(markdown, /Phase 2 clinical assist readiness report/);
  assert.match(markdown, /phase2-clinical-assist-readiness-report\.md/);
  assert.match(markdown, /Phase 2 family doctor readiness report/);
  assert.match(markdown, /phase2-family-doctor-readiness-report\.md/);
  assert.match(markdown, /Drug consumable readiness report/);
  assert.match(markdown, /Monitoring readiness report/);
  assert.match(markdown, /Referral teleconsultation readiness report/);
  assert.match(markdown, /Operations readiness report/);
  assert.match(markdown, /Citizen launch foundation readiness report/);
  assert.match(markdown, /Full process audit report/);
  assert.match(markdown, /Hospital operations readiness report/);
  assert.match(markdown, /Hospital operations release report/);
  assert.match(markdown, /Hospital operations module function report/);
  assert.match(markdown, /Hospital operations brief PDF report/);
  assert.match(markdown, /Service acceptance summary/);
  assert.match(markdown, /service:chronicDomains/);
  assert.match(markdown, /Service open action preview/);
  assert.match(markdown, /cst-001/);
  assert.match(markdown, /Site readiness pack/);
  assert.match(markdown, /On-site launch requirements/);
  assert.match(markdown, /Production database readiness report/);
  assert.match(markdown, /Interoperability evaluation evidence report/);
  assert.match(markdown, /Environment matrix report/);
  assert.match(markdown, /Hybrid deployment readiness report/);
  assert.match(markdown, /public-health-readiness-report\.md/);
  assert.match(markdown, /public-health-final-readiness-report\.md/);
  assert.match(markdown, /Release artifact manifest/);
  assert.match(markdown, /Quality-safety institution interface standard/);
  assert.match(markdown, /Quality-safety institution joint-test pack/);
  assert.match(markdown, /cutover-identity/);
  assert.match(markdown, /snapshot:acceptanceEvidence/);
  assert.match(markdown, /snapshot:securityAcceptance/);
  assert.match(markdown, /snapshot:productionDeploymentPlan/);
  assert.match(markdown, /snapshot:interfaceReadiness/);
  assert.match(markdown, /snapshot:externalDependencyRisks/);
  assert.match(markdown, /snapshot:drugTraceabilityPolicySources/);
  assert.match(markdown, /snapshot:drugTraceabilityEvidenceRequirements/);

  const cutoverMarkdown = renderCutoverMarkdown(report);
  assert.match(cutoverMarkdown, /Production cutover checklist/);
  assert.match(cutoverMarkdown, /cutover-audit-retention/);
  assert.match(cutoverMarkdown, /cutover-institution-interfaces/);
  assert.match(cutoverMarkdown, /cutover-chronic-launch-core/);
  assert.match(cutoverMarkdown, /missing site signoff/);

  const signedReport = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret",
      CUTOVER_SITE_INTERFACE_SIGNOFF: "signed",
      CUTOVER_CHRONIC_LAUNCH_CORE_SIGNOFF: "signed",
      CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF: "signed",
      CUTOVER_MONITORING_SIGNOFF: "signed",
      SIEM_ENDPOINT: "https://siem.example.internal/events",
      SIEM_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
      CUTOVER_DR_REHEARSAL_SIGNOFF: "signed"
    }
  });
  assert.equal(signedReport.productionCutover.some((item) => item.id === "cutover-institution-interfaces" && item.passed), true);
  assert.equal(signedReport.productionCutover.some((item) => item.id === "cutover-chronic-launch-core" && item.passed), true);
  assert.equal(signedReport.productionCutover.some((item) => item.id === "cutover-monitoring" && item.passed), true);

  const storageMarkdown = renderStorageModelMarkdown(report);
  assert.match(storageMarkdown, /Storage model inspection/);
  assert.match(storageMarkdown, /JSON snapshot/);
  assert.match(storageMarkdown, /SQLite store/);

  const serviceMarkdown = renderServiceAcceptanceMarkdown(report);
  assert.match(serviceMarkdown, /Service acceptance summary/);
  assert.match(serviceMarkdown, /Chronic domains: 8\/8 modeled/);
  assert.match(serviceMarkdown, /County domains: 5\/5 modeled/);
  assert.match(serviceMarkdown, /Open action preview/);
  assert.match(serviceMarkdown, /cco-001/);
  assert.match(serviceMarkdown, /\| chronic \| high \| chronicScreeningTasks \| cst-001/);
});

test("release report writes standalone production cutover and storage artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "release-report-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret"
    }
  });

  writeOutput(report, {
    output: path.join("tmp", "release-report-test", "release-report.json"),
    markdown: path.join("tmp", "release-report-test", "release-report.md")
  });

  const cutoverJson = JSON.parse(fs.readFileSync(path.join(outputDir, "production-cutover-checklist.json"), "utf8"));
  const releaseMarkdown = fs.readFileSync(path.join(outputDir, "release-report.md"), "utf8");
  const cutoverMarkdown = fs.readFileSync(path.join(outputDir, "production-cutover-checklist.md"), "utf8");
  const storageJson = JSON.parse(fs.readFileSync(path.join(outputDir, "storage-model-inspection.json"), "utf8"));
  const storageMarkdown = fs.readFileSync(path.join(outputDir, "storage-model-inspection.md"), "utf8");
  const identityJson = JSON.parse(fs.readFileSync(path.join(outputDir, "identity-contract.json"), "utf8"));
  const identityMarkdown = fs.readFileSync(path.join(outputDir, "identity-contract.md"), "utf8");
  const auditJson = JSON.parse(fs.readFileSync(path.join(outputDir, "audit-retention-report.json"), "utf8"));
  const auditMarkdown = fs.readFileSync(path.join(outputDir, "audit-retention-report.md"), "utf8");
  const chronicFollowupJson = JSON.parse(fs.readFileSync(path.join(outputDir, "chronic-followup-readiness-report.json"), "utf8"));
  const chronicFollowupMarkdown = fs.readFileSync(path.join(outputDir, "chronic-followup-readiness-report.md"), "utf8");
  const chronicInformatizationJson = JSON.parse(fs.readFileSync(path.join(outputDir, "chronic-informatization-sources.json"), "utf8"));
  const chronicInformatizationMarkdown = fs.readFileSync(path.join(outputDir, "chronic-informatization-sources.md"), "utf8");
  const chronicInstitutionInterfacesJson = JSON.parse(fs.readFileSync(path.join(outputDir, "chronic-institution-interfaces.json"), "utf8"));
  const chronicInstitutionInterfacesMarkdown = fs.readFileSync(path.join(outputDir, "chronic-institution-interfaces.md"), "utf8");
  const chronicLaunchCoreJson = JSON.parse(fs.readFileSync(path.join(outputDir, "chronic-launch-core.json"), "utf8"));
  const chronicLaunchCoreMarkdown = fs.readFileSync(path.join(outputDir, "chronic-launch-core.md"), "utf8");
  const diseasePaymentJson = JSON.parse(fs.readFileSync(path.join(outputDir, "disease-payment-readiness-report.json"), "utf8"));
  const diseasePaymentMarkdown = fs.readFileSync(path.join(outputDir, "disease-payment-readiness-report.md"), "utf8");
  const dataQualityJson = JSON.parse(fs.readFileSync(path.join(outputDir, "data-quality-report.json"), "utf8"));
  const dataQualityMarkdown = fs.readFileSync(path.join(outputDir, "data-quality-report.md"), "utf8");
  const digitalHospitalStandardsJson = JSON.parse(fs.readFileSync(path.join(outputDir, "digital-hospital-standards-readiness-report.json"), "utf8"));
  const digitalHospitalStandardsMarkdown = fs.readFileSync(path.join(outputDir, "digital-hospital-standards-readiness-report.md"), "utf8");
  const digitalHospitalPilotJson = JSON.parse(fs.readFileSync(path.join(outputDir, "digital-hospital-pilot-readiness-report.json"), "utf8"));
  const digitalHospitalPilotMarkdown = fs.readFileSync(path.join(outputDir, "digital-hospital-pilot-readiness-report.md"), "utf8");
  const phase2ProposalJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-proposal-readiness-report.json"), "utf8"));
  const phase2ProposalMarkdown = fs.readFileSync(path.join(outputDir, "phase2-proposal-readiness-report.md"), "utf8");
  const phase2CatalogJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-catalog-readiness-report.json"), "utf8"));
  const phase2CatalogMarkdown = fs.readFileSync(path.join(outputDir, "phase2-catalog-readiness-report.md"), "utf8");
  const phase2JointTestJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-joint-test-readiness-report.json"), "utf8"));
  const phase2JointTestMarkdown = fs.readFileSync(path.join(outputDir, "phase2-joint-test-readiness-report.md"), "utf8");
  const phase2MutualRecognitionJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-mutual-recognition-readiness-report.json"), "utf8"));
  const phase2MutualRecognitionMarkdown = fs.readFileSync(path.join(outputDir, "phase2-mutual-recognition-readiness-report.md"), "utf8");
  const phase2DiseaseReportingJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-disease-reporting-readiness-report.json"), "utf8"));
  const phase2DiseaseReportingMarkdown = fs.readFileSync(path.join(outputDir, "phase2-disease-reporting-readiness-report.md"), "utf8");
  const phase2ClinicalAssistJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-clinical-assist-readiness-report.json"), "utf8"));
  const phase2ClinicalAssistMarkdown = fs.readFileSync(path.join(outputDir, "phase2-clinical-assist-readiness-report.md"), "utf8");
  const phase2FamilyDoctorJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-family-doctor-readiness-report.json"), "utf8"));
  const phase2FamilyDoctorMarkdown = fs.readFileSync(path.join(outputDir, "phase2-family-doctor-readiness-report.md"), "utf8");
  const citizenOperationsJson = JSON.parse(fs.readFileSync(path.join(outputDir, "citizen-operations-readiness-report.json"), "utf8"));
  const citizenOperationsMarkdown = fs.readFileSync(path.join(outputDir, "citizen-operations-readiness-report.md"), "utf8");
  const registrationJourneyJson = JSON.parse(fs.readFileSync(path.join(outputDir, "registration-journey-readiness-report.json"), "utf8"));
  const registrationJourneyMarkdown = fs.readFileSync(path.join(outputDir, "registration-journey-readiness-report.md"), "utf8");
  const registrationIntegrationJson = JSON.parse(fs.readFileSync(path.join(outputDir, "registration-integration-readiness-report.json"), "utf8"));
  const registrationIntegrationMarkdown = fs.readFileSync(path.join(outputDir, "registration-integration-readiness-report.md"), "utf8");
  const commercialCryptoJson = JSON.parse(fs.readFileSync(path.join(outputDir, "commercial-crypto-readiness-report.json"), "utf8"));
  const commercialCryptoMarkdown = fs.readFileSync(path.join(outputDir, "commercial-crypto-readiness-report.md"), "utf8");
  const drugConsumableJson = JSON.parse(fs.readFileSync(path.join(outputDir, "drug-consumable-readiness-report.json"), "utf8"));
  const drugConsumableMarkdown = fs.readFileSync(path.join(outputDir, "drug-consumable-readiness-report.md"), "utf8");
  const integrationJson = JSON.parse(fs.readFileSync(path.join(outputDir, "integration-readiness-report.json"), "utf8"));
  const integrationMarkdown = fs.readFileSync(path.join(outputDir, "integration-readiness-report.md"), "utf8");
  const objectStorageJson = JSON.parse(fs.readFileSync(path.join(outputDir, "object-storage-readiness-report.json"), "utf8"));
  const objectStorageMarkdown = fs.readFileSync(path.join(outputDir, "object-storage-readiness-report.md"), "utf8");
  const interfaceMappingJson = JSON.parse(fs.readFileSync(path.join(outputDir, "interface-mapping-report.json"), "utf8"));
  const interfaceMappingMarkdown = fs.readFileSync(path.join(outputDir, "interface-mapping-report.md"), "utf8");
  const regionalDataSharingJson = JSON.parse(fs.readFileSync(path.join(outputDir, "regional-data-sharing-report.json"), "utf8"));
  const regionalDataSharingMarkdown = fs.readFileSync(path.join(outputDir, "regional-data-sharing-report.md"), "utf8");
  const regionalConfigurationJson = JSON.parse(fs.readFileSync(path.join(outputDir, "regional-configuration-readiness.json"), "utf8"));
  const regionalConfigurationMarkdown = fs.readFileSync(path.join(outputDir, "regional-configuration-readiness.md"), "utf8");
  const regionalSiteEvidenceJson = JSON.parse(fs.readFileSync(path.join(outputDir, "regional-site-evidence-readiness.json"), "utf8"));
  const regionalSiteEvidenceMarkdown = fs.readFileSync(path.join(outputDir, "regional-site-evidence-readiness.md"), "utf8");
  const regionalCutoverDossierJson = JSON.parse(fs.readFileSync(path.join(outputDir, "regional-cutover-dossier.json"), "utf8"));
  const regionalCutoverDossierMarkdown = fs.readFileSync(path.join(outputDir, "regional-cutover-dossier.md"), "utf8");
  const regionalReferralOverlapJson = JSON.parse(fs.readFileSync(path.join(outputDir, "regional-referral-overlap-report.json"), "utf8"));
  const regionalReferralOverlapMarkdown = fs.readFileSync(path.join(outputDir, "regional-referral-overlap-report.md"), "utf8");
  const monitoringJson = JSON.parse(fs.readFileSync(path.join(outputDir, "monitoring-readiness-report.json"), "utf8"));
  const monitoringMarkdown = fs.readFileSync(path.join(outputDir, "monitoring-readiness-report.md"), "utf8");
  const referralJson = JSON.parse(fs.readFileSync(path.join(outputDir, "referral-teleconsultation-readiness-report.json"), "utf8"));
  const referralMarkdown = fs.readFileSync(path.join(outputDir, "referral-teleconsultation-readiness-report.md"), "utf8");
  const citizenLaunchJson = JSON.parse(fs.readFileSync(path.join(outputDir, "citizen-launch-foundation-readiness.json"), "utf8"));
  const citizenLaunchMarkdown = fs.readFileSync(path.join(outputDir, "citizen-launch-foundation-readiness.md"), "utf8");
  const operationsJson = JSON.parse(fs.readFileSync(path.join(outputDir, "operations-readiness-report.json"), "utf8"));
  const operationsMarkdown = fs.readFileSync(path.join(outputDir, "operations-readiness-report.md"), "utf8");
  const hospitalOperationsJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-readiness-report.json"), "utf8"));
  const hospitalOperationsMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-readiness-report.md"), "utf8");
  const hospitalOperationsReleaseJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-release-report.json"), "utf8"));
  const hospitalOperationsReleaseMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-release-report.md"), "utf8");
  const hospitalOperationsModuleJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-module-report.json"), "utf8"));
  const hospitalOperationsModuleMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-module-report.md"), "utf8");
  const hospitalOperationsBriefPdfJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-brief-pdf-report.json"), "utf8"));
  const hospitalOperationsBriefPdfMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-brief-pdf-report.md"), "utf8");
  const processAuditJson = JSON.parse(fs.readFileSync(path.join(outputDir, "process-audit-report.json"), "utf8"));
  const processAuditMarkdown = fs.readFileSync(path.join(outputDir, "process-audit-report.md"), "utf8");
  const serviceAcceptanceJson = JSON.parse(fs.readFileSync(path.join(outputDir, "service-acceptance-summary.json"), "utf8"));
  const serviceAcceptanceMarkdown = fs.readFileSync(path.join(outputDir, "service-acceptance-summary.md"), "utf8");
  const siteReadinessJson = JSON.parse(fs.readFileSync(path.join(outputDir, "site-readiness-pack.json"), "utf8"));
  const siteReadinessMarkdown = fs.readFileSync(path.join(outputDir, "site-readiness-pack.md"), "utf8");
  const onsiteLaunchJson = JSON.parse(fs.readFileSync(path.join(outputDir, "onsite-launch-requirements.json"), "utf8"));
  const onsiteLaunchMarkdown = fs.readFileSync(path.join(outputDir, "onsite-launch-requirements.md"), "utf8");
  const identityTemplateReadme = fs.readFileSync(path.join(outputDir, "templates", "identity-source-mapping", "README.md"), "utf8");
  const interfaceTemplateReadme = fs.readFileSync(path.join(outputDir, "templates", "interface-joint-test", "README.md"), "utf8");
  const monitoringTemplateReadme = fs.readFileSync(path.join(outputDir, "templates", "monitoring-on-call", "README.md"), "utf8");
  const signoffTemplateReadme = fs.readFileSync(path.join(outputDir, "templates", "production-signoff", "README.md"), "utf8");
  const productionDbJson = JSON.parse(fs.readFileSync(path.join(outputDir, "production-db-readiness-report.json"), "utf8"));
  const productionDbMarkdown = fs.readFileSync(path.join(outputDir, "production-db-readiness-report.md"), "utf8");
  const evaluationJson = JSON.parse(fs.readFileSync(path.join(outputDir, "evaluation-evidence-report.json"), "utf8"));
  const evaluationMarkdown = fs.readFileSync(path.join(outputDir, "evaluation-evidence-report.md"), "utf8");
  const environmentJson = JSON.parse(fs.readFileSync(path.join(outputDir, "environment-matrix-report.json"), "utf8"));
  const environmentMarkdown = fs.readFileSync(path.join(outputDir, "environment-matrix-report.md"), "utf8");
  const hybridDeploymentJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hybrid-deployment-readiness-report.json"), "utf8"));
  const hybridDeploymentMarkdown = fs.readFileSync(path.join(outputDir, "hybrid-deployment-readiness-report.md"), "utf8");
  const productionDeploymentPackageJson = JSON.parse(fs.readFileSync(path.join(outputDir, "production-deployment-package.json"), "utf8"));
  const productionDeploymentPackageMarkdown = fs.readFileSync(path.join(outputDir, "production-deployment-package.md"), "utf8");
  const priorityTemplatesJson = JSON.parse(fs.readFileSync(path.join(outputDir, "priority-application-templates.json"), "utf8"));
  const priorityTemplatesMarkdown = fs.readFileSync(path.join(outputDir, "priority-application-templates.md"), "utf8");
  const pilotAcceptanceJson = JSON.parse(fs.readFileSync(path.join(outputDir, "pilot-acceptance-readiness-report.json"), "utf8"));
  const pilotAcceptanceMarkdown = fs.readFileSync(path.join(outputDir, "pilot-acceptance-readiness-report.md"), "utf8");
  const manifestJson = JSON.parse(fs.readFileSync(path.join(outputDir, "release-artifact-manifest.json"), "utf8"));
  const manifestMarkdown = fs.readFileSync(path.join(outputDir, "release-artifact-manifest.md"), "utf8");
  const platformCapabilityMapJson = JSON.parse(fs.readFileSync(path.join(outputDir, "platform-capability-map.json"), "utf8"));
  const platformCapabilityMapMarkdown = fs.readFileSync(path.join(outputDir, "platform-capability-map.md"), "utf8");
  const platformGoLiveSlicesJson = JSON.parse(fs.readFileSync(path.join(outputDir, "platform-go-live-slices.json"), "utf8"));
  const platformGoLiveSlicesMarkdown = fs.readFileSync(path.join(outputDir, "platform-go-live-slices.md"), "utf8");
  const platformStandardsLedgersJson = JSON.parse(fs.readFileSync(path.join(outputDir, "platform-standards-ledgers.json"), "utf8"));
  const platformStandardsLedgersMarkdown = fs.readFileSync(path.join(outputDir, "platform-standards-ledgers.md"), "utf8");
  assert.equal(cutoverJson.checklist.some((item) => item.id === "cutover-identity"), true);
  assert.match(cutoverMarkdown, /cutover-storage-adapter/);
  assert.equal(storageJson.storageModel.jsonSnapshot.present, true);
  assert.match(storageMarkdown, /Storage model inspection/);
  assert.match(storageMarkdown, /Largest/);
  assert.equal(platformCapabilityMapJson.ok, true);
  assert.equal(platformCapabilityMapJson.summary.releaseArtifacts >= 60, true);
  assert.match(platformCapabilityMapMarkdown, /Platform capability map/);
  assert.match(platformCapabilityMapMarkdown, /Release artifacts/);
  assert.equal(platformGoLiveSlicesJson.ok, true);
  assert.equal(platformGoLiveSlicesJson.summary.serviceOrders >= 8, true);
  assert.equal(platformGoLiveSlicesJson.summary.masterDataDomains >= 6, true);
  assert.match(platformGoLiveSlicesMarkdown, /Platform go-live slices readiness/);
  assert.match(platformGoLiveSlicesMarkdown, /Unified Blocker Register/);
  assert.equal(platformStandardsLedgersJson.ok, true);
  assert.equal(platformStandardsLedgersJson.summary.ledgers, 6);
  assert.equal(platformStandardsLedgersJson.summary.formalGoLiveReady, 0);
  assert.match(platformStandardsLedgersMarkdown, /六类可验收台账/);
  assert.equal(identityJson.identityContract.ok, true);
  assert.match(identityMarkdown, /Required external claims/);
  assert.equal(auditJson.auditRetention.ok, true);
  assert.match(auditMarkdown, /Audit chains/);
  assert.equal(chronicFollowupJson.chronicFollowup.ok, true);
  assert.equal(chronicFollowupJson.chronicFollowup.summary.notificationMessages >= 1, true);
  assert.equal(chronicFollowupJson.chronicFollowup.summary.highPriorityAlerts >= 1, true);
  assert.equal(chronicFollowupJson.chronicFollowup.summary.residentExperienceItems >= 1, true);
  assert.equal(chronicFollowupJson.chronicFollowup.summary.fieldIntegrationItems >= 1, true);
  assert.equal(chronicFollowupJson.chronicFollowup.summary.policyAligned, chronicFollowupJson.chronicFollowup.summary.policyItems);
  assert.equal(chronicInstitutionInterfacesJson.chronicInstitutionInterfaces.ok, true);
  assert.match(chronicInstitutionInterfacesMarkdown, /chronic-device-measurement-v1/);
  assert.equal(chronicLaunchCoreJson.chronicLaunchCore.ok, true);
  assert.equal(chronicLaunchCoreJson.chronicLaunchCore.summary.signedSignoffs, 6);
  assert.match(chronicLaunchCoreMarkdown, /institution-systems/);
  assert.match(chronicLaunchCoreMarkdown, /Site Signoffs/);
  assert.match(chronicFollowupMarkdown, /resident-feedback/);
  assert.equal(chronicInformatizationJson.chronicInformatizationSources.ok, true);
  assert.match(chronicInformatizationMarkdown, /institution-integration-launch/);
  assert.equal(chronicInstitutionInterfacesJson.chronicInstitutionInterfaces.ok, true);
  assert.match(chronicInstitutionInterfacesMarkdown, /chronic-device-measurement-v1/);
  assert.equal(chronicLaunchCoreJson.chronicLaunchCore.ok, true);
  assert.equal(chronicLaunchCoreJson.chronicLaunchCore.summary.signedSignoffs, 6);
  assert.match(chronicLaunchCoreMarkdown, /Site Signoffs/);
  assert.equal(diseasePaymentJson.diseasePaymentReadiness.ready, true);
  assert.match(diseasePaymentMarkdown, /按病种付费系统就绪报告/);
  assert.equal(dataQualityJson.dataQuality.ok, true);
  assert.match(dataQualityMarkdown, /Resident-linked collections/);
  assert.equal(digitalHospitalStandardsJson.digitalHospitalStandards.ok, true);
  assert.match(digitalHospitalStandardsMarkdown, /Digital hospital standards readiness report/);
  assert.match(digitalHospitalStandardsMarkdown, /digitalHospital:apiContract/);
  assert.match(digitalHospitalStandardsMarkdown, /digitalHospital:launchReadiness/);
  assert.match(digitalHospitalStandardsMarkdown, /digitalHospital:officialSources/);
  assert.equal(digitalHospitalPilotJson.ok, true);
  assert.equal(digitalHospitalPilotJson.functionalState, "pilot-launch-ready");
  assert.match(digitalHospitalPilotMarkdown, /Digital hospital pilot readiness report/);
  assert.match(digitalHospitalPilotMarkdown, /blocked-until-site-evidence-signed/);
  assert.equal(phase2ProposalJson.phase2Proposal.ok, true);
  assert.match(phase2ProposalMarkdown, /Phase 2 proposal readiness report/);
  assert.match(phase2ProposalMarkdown, /commercial-crypto-devices/);
  assert.equal(phase2CatalogJson.phase2Catalog.ok, true);
  assert.match(phase2CatalogMarkdown, /Phase 2 catalog readiness report/);
  assert.match(phase2CatalogMarkdown, /p2dc-lab-imaging-recognition/);
  assert.equal(phase2JointTestJson.phase2JointTest.ok, true);
  assert.match(phase2JointTestMarkdown, /Phase 2 joint-test readiness report/);
  assert.match(phase2JointTestMarkdown, /p2trace-lis-report/);
  assert.equal(phase2MutualRecognitionJson.phase2MutualRecognition.ok, true);
  assert.match(phase2MutualRecognitionMarkdown, /Phase 2 mutual recognition readiness report/);
  assert.match(phase2MutualRecognitionMarkdown, /P2-MR-001/);
  assert.equal(phase2DiseaseReportingJson.phase2DiseaseReporting.ok, true);
  assert.match(phase2DiseaseReportingMarkdown, /Phase 2 disease reporting readiness report/);
  assert.match(phase2DiseaseReportingMarkdown, /County receipts/);
  assert.equal(phase2ClinicalAssistJson.phase2ClinicalAssist.ok, true);
  assert.match(phase2ClinicalAssistMarkdown, /Phase 2 clinical assist readiness report/);
  assert.match(phase2ClinicalAssistMarkdown, /Plugin contracts/);
  assert.equal(phase2FamilyDoctorJson.phase2FamilyDoctor.ok, true);
  assert.match(phase2FamilyDoctorMarkdown, /Phase 2 family doctor readiness report/);
  assert.match(phase2FamilyDoctorMarkdown, /Applications/);
  assert.equal(citizenOperationsJson.citizenOperations.ok, true);
  assert.equal(registrationJourneyJson.registrationJourney.ok, true);
  assert.match(registrationJourneyMarkdown, /Registration journey readiness report/);
  assert.match(registrationJourneyMarkdown, /registrationJourney:stateMachine/);
  assert.equal(registrationIntegrationJson.registrationIntegration.ok, true);
  assert.match(registrationIntegrationMarkdown, /Registration integration readiness report/);
  assert.match(registrationIntegrationMarkdown, /registrationIntegration:gateway/);
  assert.match(citizenOperationsMarkdown, /Citizen service operations readiness report/);
  assert.match(citizenOperationsMarkdown, /Production boundary/);
  assert.equal(commercialCryptoJson.commercialCrypto.ok, true);
  assert.match(commercialCryptoMarkdown, /Commercial crypto adapter center readiness report/);
  assert.match(commercialCryptoMarkdown, /Runtime compatibility probe/);
  assert.match(commercialCryptoMarkdown, /Production boundary/);
  assert.equal(drugConsumableJson.drugConsumable.ok, true);
  assert.match(drugConsumableMarkdown, /Drug consumable readiness report/);
  assert.match(drugConsumableMarkdown, /Launch readiness/);
  assert.match(drugConsumableMarkdown, /Traceability policy sources/);
  assert.match(drugConsumableMarkdown, /Traceability evidence requirements/);
  assert.equal(integrationJson.integrationReadiness.ok, true);
  assert.match(integrationMarkdown, /P0 coverage/);
  assert.equal(objectStorageJson.objectStorageReadiness.ok, true);
  assert.equal(objectStorageJson.objectStorageReadiness.productionReady, false);
  assert.match(objectStorageMarkdown, /Object storage and attachment security readiness/);
  assert.equal(interfaceMappingJson.interfaceMapping.ok, true);
  assert.match(interfaceMappingMarkdown, /Contract field mappings/);
  assert.equal(regionalDataSharingJson.regionalDataSharing.summary.referralHandoffReady >= 1, true);
  assert.equal(regionalDataSharingJson.regionalDataSharing.packages.every((item) => item.referralHandoff?.total === 6), true);
  assert.match(regionalDataSharingMarkdown, /转诊会诊交接证据/);
  assert.equal(regionalConfigurationJson.productionReady, false);
  assert.match(regionalConfigurationMarkdown, /地区配置准入审计/);
  assert.equal(regionalSiteEvidenceJson.productionReady, false);
  assert.equal(regionalSiteEvidenceJson.containsEvidenceBodies, false);
  assert.match(regionalSiteEvidenceMarkdown, /地区现场证据准入报告/);
  assert.equal(regionalCutoverDossierJson.productionReady, false);
  assert.match(regionalCutoverDossierMarkdown, /地区投产档案/);
  assert.equal(regionalReferralOverlapJson.regionalReferralOverlap.ok, true);
  assert.equal(regionalReferralOverlapJson.regionalReferralOverlap.runtimeMergeAllowed, false);
  assert.match(regionalReferralOverlapMarkdown, /区域诊疗数据共享与医联体转诊重合度检查报告/);
  assert.equal(monitoringJson.monitoringReadiness.ok, true);
  assert.match(monitoringMarkdown, /SLO targets/);
  assert.equal(referralJson.referralTeleconsultationReadiness.ok, true);
  assert.match(referralMarkdown, /Referral teleconsultation readiness report/);
  assert.equal(citizenLaunchJson.citizenLaunchFoundation.ok, true);
  assert.match(citizenLaunchMarkdown, /Citizen launch foundation readiness/);
  assert.match(citizenLaunchMarkdown, /phone-code delivery/);
  assert.match(releaseMarkdown, /citizenLaunch:accountProvisioning/);
  assert.equal(operationsJson.operationsReadiness.ok, true);
  assert.match(operationsMarkdown, /External dependency risks/);
  assert.match(operationsMarkdown, /Production operations run center/);
  assert.match(operationsMarkdown, /Production boundary/);
  assert.equal(processAuditJson.processAudit.ok, true);
  assert.match(processAuditMarkdown, /Full process audit report/);
  assert.equal(serviceAcceptanceJson.serviceAcceptance.ok, true);
  assert.equal(serviceAcceptanceJson.serviceAcceptance.chronic.openActions.some((item) => item.id === "cst-001"), true);
  assert.match(serviceAcceptanceMarkdown, /Service acceptance summary/);
  assert.match(serviceAcceptanceMarkdown, /Open action preview/);
  assert.equal(siteReadinessJson.siteReadinessPack.ok, true);
  assert.equal(siteReadinessJson.siteReadinessPack.policySourceRules.sources.length >= 5, true);
  assert.match(siteReadinessMarkdown, /Site signoff template/);
  assert.equal(onsiteLaunchJson.onsiteLaunchRequirements.ok, true);
  assert.equal(onsiteLaunchJson.onsiteLaunchRequirements.summary.p0Requirements >= 10, true);
  assert.match(onsiteLaunchMarkdown, /On-site launch requirements/);
  assert.match(onsiteLaunchMarkdown, /resident-services/);
  assert.match(identityTemplateReadme, /Identity source mapping template/);
  assert.match(interfaceTemplateReadme, /Interface joint-test template/);
  assert.match(monitoringTemplateReadme, /Monitoring and on-call template/);
  assert.match(signoffTemplateReadme, /Production cutover signoff template/);
  assert.equal(productionDbJson.productionDbReadiness.ok, true);
  assert.match(productionDbMarkdown, /Production database readiness report/);
  assert.equal(evaluationJson.evaluationEvidence.ok, true);
  assert.match(evaluationMarkdown, /Artifact coverage/);
  assert.equal(environmentJson.environmentMatrix.ok, true);
  assert.match(environmentMarkdown, /Environment matrix report/);
  assert.equal(hybridDeploymentJson.hybridDeploymentReadiness.ok, true);
  assert.match(hybridDeploymentMarkdown, /Hybrid deployment readiness report/);
  assert.equal(productionDeploymentPackageJson.verification.ok, true);
  assert.match(productionDeploymentPackageMarkdown, /Production deployment package/);
  assert.equal(priorityTemplatesJson.priorityApplicationTemplates.ok, true);
  assert.equal(priorityTemplatesJson.priorityApplicationTemplates.templates.length, 8);
  assert.equal(priorityTemplatesJson.priorityApplicationTemplates.templates.every((item) => item.conversationStarter && item.acceptanceGate.evidence.length), true);
  assert.match(priorityTemplatesMarkdown, /Priority application templates/);
  assert.match(priorityTemplatesMarkdown, /Conversation starters/);
  assert.match(priorityTemplatesMarkdown, /Acceptance gates/);
  assert.match(priorityTemplatesMarkdown, /卫生健康综合驾驶舱/);
  assert.equal(pilotAcceptanceJson.ok, true);
  assert.equal(pilotAcceptanceJson.summary.applications, 8);
  assert.equal(pilotAcceptanceJson.summary.onsiteTasks, 10);
  assert.equal(pilotAcceptanceJson.summary.interfaceSamples, 4);
  assert.equal(pilotAcceptanceJson.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.match(pilotAcceptanceMarkdown, /Eight-application regression matrix/);
  assert.match(pilotAcceptanceMarkdown, /synthetic identifiers and contain no patient data/);
  assert.equal(manifestJson.releaseArtifactManifest.ok, true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "service-acceptance"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "hospital-operations-brief-pdf"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "referral-teleconsultation"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "chronic-followup"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "priority-application-templates"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "pilot-acceptance-readiness"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "hybrid-deployment"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "production-deployment-package"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "digital-hospital-standards"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "phase2-proposal"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "phase2-catalog"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "phase2-joint-test"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "phase2-mutual-recognition"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "phase2-disease-reporting"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "phase2-clinical-assist"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "phase2-family-doctor"), true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "onsite-launch-requirements"), true);
  assert.match(manifestMarkdown, /Release artifact manifest/);
  assert.match(manifestMarkdown, /regional-referral-overlap-report\.md/);
  assert.match(manifestMarkdown, /service-acceptance-summary\.md/);
  assert.match(manifestMarkdown, /release\/templates\/identity-source-mapping\/README\.md/);
});

test("release report CLI argument parser keeps command and flags", () => {
  const parsed = parseArgs(["report", "--profile=production", "--config-env=.env", "--run-commands"]);
  assert.equal(parsed.command, "report");
  assert.equal(parsed.flags.profile, "production");
  assert.equal(parsed.flags["config-env"], ".env");
  assert.equal(parsed.flags["run-commands"], true);
});
