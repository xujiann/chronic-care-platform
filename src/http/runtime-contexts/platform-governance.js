"use strict";

const DOMAIN = "platform-governance";
const PROCESS = "T02";
const DEPENDENCIES = Object.freeze([
  "POSTGRES_PRIMARY_READ_MODE", "POSTGRES_SYNC_MODE", "SQLITE_FILE", "advanceDigitalHospitalPublicHealthIncident",
  "allowedResidentIdsForUser", "appendSecurityEvent", "applyCommercialCryptoAction", "applyGovernanceResultToData",
  "applyPlatformCapabilityReviewAction", "applyPlatformProductionBlockerAction", "applyPostgresReconciliationCaseAction", "applyProductionDatabaseCutoverAction",
  "applyProductionOperationsAction", "authorizeDigitalHospitalPublicHealthHospital", "buildCapabilityMap", "buildCommercialCryptoCenter",
  "buildDigitalHospitalControlMatrixBoard", "buildDigitalHospitalEvaluationCatalog", "buildDigitalHospitalLaunchCommandBriefBoard", "buildDigitalHospitalLaunchReadiness",
  "buildDigitalHospitalPilotBoard", "buildDigitalHospitalPolicyRegisterBoard", "buildDigitalHospitalProductionEvidenceBoard", "buildDigitalHospitalPublicHealthBoard",
  "buildDigitalHospitalSecurityCenter", "buildDigitalHospitalSelfAssessmentBoard", "buildDigitalHospitalStandardsOverview", "buildGovernanceCatalog",
  "buildGovernanceRuntimeState", "buildPhase2CatalogOverview", "buildPhase2ClinicalAssistOverview", "buildPhase2DiseaseReportingOverview",
  "buildPhase2FamilyDoctorContractFromApplication", "buildPhase2FamilyDoctorOverview", "buildPhase2JointTestPilotOverview", "buildPhase2MutualRecognitionOverview",
  "buildPlatformBlockerRegister", "buildPlatformCapabilityOperationsCenter", "buildPlatformGoLiveSlices", "buildPlatformServiceOrderCenter",
  "buildPlatformStandardsLedgerDetail", "buildPlatformStandardsLedgers", "buildPostgresProductionAdapterConfig", "buildProcessAuditReport",
  "buildProductionDatabaseCutoverCenter", "buildProductionOperationsCenter", "buildProductionReleaseEvidencePublicSummary", "buildProductionSecurityAcceptanceCenter",
  "buildReleaseArtifactManifest", "buildReleaseReport", "buildRuntimeMetrics", "buildRuntimeProductionGoNoGoCenter",
  "buildSiteLaunchEvidenceDashboard", "buildSiteReadinessPack", "buildSiteTemplateReadmes", "canAccessPhase2ClinicalAssistAlert",
  "canAccessPhase2FamilyDoctorRow", "collectJson", "createDigitalHospitalPilotInstitution", "createDigitalHospitalPilotIssue",
  "createDigitalHospitalPublicHealthIncident", "createDigitalHospitalSelfAssessment", "createProductionDatabaseCutoverRun", "digitalHospitalClientCertificate",
  "digitalHospitalExecutionRuntime", "digitalHospitalPublicHealthHospitalScope", "digitalHospitalWorkerFingerprints", "escalateDigitalHospitalPublicHealthIncident",
  "executeGovernanceCommand", "fs", "governanceActorFromUser", "governanceAuditForRecord",
  "governanceHttpStatus", "isProductionRuntime", "listGovernanceRecords", "listPostgresReconciliationCases",
  "listPostgresReconciliationHistory", "mergeByKey", "normalizeDigitalHospitalCollectionJobAction", "normalizeDigitalHospitalControlAction",
  "normalizeDigitalHospitalEvaluationEvidenceAction", "normalizeDigitalHospitalFormalCutoverApprovalAction", "normalizeDigitalHospitalLaunchCommandBriefAction", "normalizeDigitalHospitalLaunchRequirementAction",
  "normalizeDigitalHospitalPilotInstitutionAction", "normalizeDigitalHospitalPilotIssueAction", "normalizeDigitalHospitalPolicyReview", "normalizeDigitalHospitalPreAssessmentAction",
  "normalizeDigitalHospitalProductionEvidencePacketAction", "normalizeDigitalHospitalSelfAssessmentAction", "normalizePhase2ClinicalAssistReceipt", "normalizePhase2DiseaseReportReceipt",
  "normalizePhase2FamilyDoctorApplication", "normalizeProductionGoNoGoApprovalAction", "normalizeProductionGoNoGoDecision", "normalizeProductionSecurityFindingAction",
  "normalizeProductionSecurityReleaseApprovalAction", "normalizeState", "phase2EvidenceHash", "publicGovernanceRecord",
  "randomUUID", "readDatabase", "readLatestPostgresReconciliation", "readPostgresReconciliationCase",
  "readPostgresReconciliationRun", "renderCapabilityMapMarkdown", "renderDigitalHospitalPublicHealthIncidentCsv", "renderPlatformGoLiveSlicesMarkdown",
  "renderPlatformStandardsLedgerDetailMarkdown", "renderPlatformStandardsLedgersMarkdown", "requireApiRole", "requireDigitalHospitalExecutionWorker",
  "reviewDigitalHospitalPublicHealthIncidentEvidence", "reviewMutualRecognitionRecord", "runDigitalHospitalPreAssessment", "runPostgresPrimaryReadRehearsal",
  "sealAuditTrail", "seedCommercialCryptoCapabilities", "seedCommercialCryptoEvidencePackets", "seedDigitalHospitalCollectionJobs",
  "seedDigitalHospitalControlMatrix", "seedDigitalHospitalEvaluationEvidence", "seedDigitalHospitalFormalCutoverApprovals", "seedDigitalHospitalLaunchCommandBriefs",
  "seedDigitalHospitalLaunchRequirements", "seedDigitalHospitalPilotInstitutions", "seedDigitalHospitalPilotIssues", "seedDigitalHospitalPolicyRegister",
  "seedDigitalHospitalPreAssessments", "seedDigitalHospitalProductionEvidencePackets", "seedDigitalHospitalSelfAssessments", "seedDisasterRecoveryDrills",
  "seedOperationsDutyShifts", "seedOperationsEvidencePackets", "seedOperationsIncidents", "seedPhase2ClinicalAssistAlerts",
  "seedPhase2ClinicalAssistRules", "seedPhase2DiseaseReportQueue", "seedPhase2FamilyDoctorApplications", "seedPhase2FamilyDoctorContracts",
  "seedProductionDatabaseCutoverRuns", "seedProductionDatabaseMigrationBatches", "sendDigitalHospitalExecutionError", "sendDownload",
  "sendJson", "sendText", "shouldUseSqlite", "submitDigitalHospitalPublicHealthIncidentEvidence",
  "todayOffset", "upsertPhase2MutualRecognitionCitation", "upsertSiteLaunchEvidence", "verifySignedExecutionCallback",
  "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };

