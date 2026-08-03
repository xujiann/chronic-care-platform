"use strict";

function createRouteSegment(runtime) {
  const { BloodBusinessService, BloodEventHub, BloodGoLiveService, BloodInnovationService, BloodIntegrationGateway, BloodMasterData, BloodService, BloodTransactionService, EmergencyLifeChain, EmergencyProduction, EmergencyService, ImagingCloudProduction, PhysicalExaminationService, allowedResidentIdsForUser, appendDataAccessLog, appendOperationsIntegrationAudit, appendQualitySafetyAudit, appendSecurityEvent, applyDispatchStatusUpdate, assertSignedOperationsPayload, buildHospitalOperationsDashboard, buildImageCloudDashboard, buildImageCloudDerivedRecords, buildImagingCloudProductionResponse, buildObservabilityAlertCenter, buildOhifStudyUrl, buildOperationsInterfaceMappingEvidence, buildOperationsMobileDuty, buildOperationsSiteJointPatrol, buildPerformanceMonitoringEvidence, buildPhysicalExamProductionReadiness, buildProductionOperationsCenter, buildQualitySafetyCoreSystemMatrix, buildQualitySafetyDashboard, buildQualitySafetyInterfaceJointTestPack, buildQualitySafetyInterfaceStandard, buildQualitySafetyIssues, buildRuntimeMetrics, canAccessResident, canAccessSecureAttachment, collectJson, createHash, createImageCloudMutualRecognitionChain, createOperationsMobileDutyReminder, integrationGatewaySecret, integrationPayloadAllowedForInstitution, isProductionRuntime, listOrthancStudySummaries, mergeByKey, normalizeDiagnosticReport, normalizeDispatchAction, normalizeHandoverSignoff, normalizeImageCloudStudy, normalizeOperationSnapshot, normalizeQualitySafetyStatus, normalizeReconciliationBatchItem, normalizeState, patchCollectionItem, personIndexForResident, prependAuditTrailEntry, publishDiagnosticReportToFhir, publishImagingStudyToFhir, qualitySafetySlaState, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, reviewImageCloudRecognitionAppeal, reviewMutualRecognitionRecord, rowMatchesOrganizationScope, sendDownload, sendJson, sendT10ProductionControlError, solutionAHealth, submitImageCloudRecognitionAppeal, upsertPhase2MutualRecognitionCitation, validateQualitySafetyInterfaceMessage, writeDatabase } = runtime;
  return {
      id: "clinical-specialties-02",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/operations/dashboard") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/dashboard");
        if (!user) return true;
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        dashboard.runCenter = buildProductionOperationsCenter(data, { runtimeMetrics: buildRuntimeMetrics(data) });
        dashboard.observability = buildObservabilityAlertCenter(data);
        dashboard.bloodCoordination = { ...BloodEventHub.dashboard(data, user), projections: BloodEventHub.dashboard(data, user).projections.filter((item) => item.consumer === "operations") };
        sendJson(res, 200, dashboard);
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-02", SUBDOMAIN: "operations-dashboard" };
