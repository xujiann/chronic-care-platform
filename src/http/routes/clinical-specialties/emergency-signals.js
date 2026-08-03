"use strict";

function createRouteSegment(runtime) {
  const { BloodBusinessService, BloodEventHub, BloodGoLiveService, BloodInnovationService, BloodIntegrationGateway, BloodMasterData, BloodService, BloodTransactionService, EmergencyLifeChain, EmergencyProduction, EmergencyService, ImagingCloudProduction, PhysicalExaminationService, allowedResidentIdsForUser, appendDataAccessLog, appendOperationsIntegrationAudit, appendQualitySafetyAudit, appendSecurityEvent, applyDispatchStatusUpdate, assertSignedOperationsPayload, buildHospitalOperationsDashboard, buildImageCloudDashboard, buildImageCloudDerivedRecords, buildImagingCloudProductionResponse, buildObservabilityAlertCenter, buildOhifStudyUrl, buildOperationsInterfaceMappingEvidence, buildOperationsMobileDuty, buildOperationsSiteJointPatrol, buildPerformanceMonitoringEvidence, buildPhysicalExamProductionReadiness, buildProductionOperationsCenter, buildQualitySafetyCoreSystemMatrix, buildQualitySafetyDashboard, buildQualitySafetyInterfaceJointTestPack, buildQualitySafetyInterfaceStandard, buildQualitySafetyIssues, buildRuntimeMetrics, canAccessResident, canAccessSecureAttachment, collectJson, createHash, createImageCloudMutualRecognitionChain, createOperationsMobileDutyReminder, integrationGatewaySecret, integrationPayloadAllowedForInstitution, isProductionRuntime, listOrthancStudySummaries, mergeByKey, normalizeDiagnosticReport, normalizeDispatchAction, normalizeHandoverSignoff, normalizeImageCloudStudy, normalizeOperationSnapshot, normalizeQualitySafetyStatus, normalizeReconciliationBatchItem, normalizeState, patchCollectionItem, personIndexForResident, prependAuditTrailEntry, publishDiagnosticReportToFhir, publishImagingStudyToFhir, qualitySafetySlaState, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, reviewImageCloudRecognitionAppeal, reviewMutualRecognitionRecord, rowMatchesOrganizationScope, sendDownload, sendJson, sendT10ProductionControlError, solutionAHealth, submitImageCloudRecognitionAppeal, upsertPhase2MutualRecognitionCitation, validateQualitySafetyInterfaceMessage, writeDatabase } = runtime;
  return {
      id: "clinical-specialties-09",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/emergency-signals/")) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/emergency-signals/:id");
        if (!user) return true;
        const result = patchCollectionItem({
          data: readDatabase(),
          collection: "emergencySignals",
          id: decodeURIComponent(url.pathname.replace("/api/emergency-signals/", "")),
          patch: await collectJson(req),
          user,
          action: "更新公卫预警"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-09", SUBDOMAIN: "emergency-signals" };
