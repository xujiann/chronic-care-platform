"use strict";

const DOMAIN = "clinical-specialties";
const PROCESS = "T06";
const DEPENDENCIES = Object.freeze([
  "BloodBusinessService", "BloodEventHub", "BloodGoLiveService", "BloodInnovationService",
  "BloodIntegrationGateway", "BloodMasterData", "BloodService", "BloodTransactionService",
  "EmergencyLifeChain", "EmergencyProduction", "EmergencyService", "ImagingCloudProduction",
  "PhysicalExaminationService", "allowedResidentIdsForUser", "appendDataAccessLog", "appendOperationsIntegrationAudit",
  "appendQualitySafetyAudit", "appendSecurityEvent", "applyDispatchStatusUpdate", "assertSignedOperationsPayload",
  "buildHospitalOperationsDashboard", "buildImageCloudDashboard", "buildImageCloudDerivedRecords", "buildImagingCloudProductionResponse",
  "buildObservabilityAlertCenter", "buildOhifStudyUrl", "buildOperationsInterfaceMappingEvidence", "buildOperationsMobileDuty",
  "buildOperationsSiteJointPatrol", "buildPerformanceMonitoringEvidence", "buildPhysicalExamProductionReadiness", "buildProductionOperationsCenter",
  "buildQualitySafetyCoreSystemMatrix", "buildQualitySafetyDashboard", "buildQualitySafetyInterfaceJointTestPack", "buildQualitySafetyInterfaceStandard",
  "buildQualitySafetyIssues", "buildRuntimeMetrics", "canAccessResident", "canAccessSecureAttachment",
  "collectJson", "createHash", "createImageCloudMutualRecognitionChain", "createOperationsMobileDutyReminder",
  "integrationGatewaySecret", "integrationPayloadAllowedForInstitution", "isProductionRuntime", "listOrthancStudySummaries",
  "mergeByKey", "normalizeDiagnosticReport", "normalizeDispatchAction", "normalizeHandoverSignoff",
  "normalizeImageCloudStudy", "normalizeOperationSnapshot", "normalizeQualitySafetyStatus", "normalizeReconciliationBatchItem",
  "normalizeState", "patchCollectionItem", "personIndexForResident", "prependAuditTrailEntry",
  "publishDiagnosticReportToFhir", "publishImagingStudyToFhir", "qualitySafetySlaState", "randomUUID",
  "readDatabase", "redactSensitiveResponse", "requireApiRole", "reviewImageCloudRecognitionAppeal",
  "reviewMutualRecognitionRecord", "rowMatchesOrganizationScope", "sendDownload", "sendJson",
  "sendT10ProductionControlError", "solutionAHealth", "submitImageCloudRecognitionAppeal", "upsertPhase2MutualRecognitionCitation",
  "validateQualitySafetyInterfaceMessage", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };

