"use strict";

function createRouteSegment(runtime) {
  const { BloodBusinessService, BloodEventHub, BloodGoLiveService, BloodInnovationService, BloodIntegrationGateway, BloodMasterData, BloodService, BloodTransactionService, EmergencyLifeChain, EmergencyProduction, EmergencyService, ImagingCloudProduction, PhysicalExaminationService, allowedResidentIdsForUser, appendDataAccessLog, appendOperationsIntegrationAudit, appendQualitySafetyAudit, appendSecurityEvent, applyDispatchStatusUpdate, assertSignedOperationsPayload, buildHospitalOperationsDashboard, buildImageCloudDashboard, buildImageCloudDerivedRecords, buildImagingCloudProductionResponse, buildObservabilityAlertCenter, buildOhifStudyUrl, buildOperationsInterfaceMappingEvidence, buildOperationsMobileDuty, buildOperationsSiteJointPatrol, buildPerformanceMonitoringEvidence, buildPhysicalExamProductionReadiness, buildProductionOperationsCenter, buildQualitySafetyCoreSystemMatrix, buildQualitySafetyDashboard, buildQualitySafetyInterfaceJointTestPack, buildQualitySafetyInterfaceStandard, buildQualitySafetyIssues, buildRuntimeMetrics, canAccessResident, canAccessSecureAttachment, collectJson, createHash, createImageCloudMutualRecognitionChain, createOperationsMobileDutyReminder, integrationGatewaySecret, integrationPayloadAllowedForInstitution, isProductionRuntime, listOrthancStudySummaries, mergeByKey, normalizeDiagnosticReport, normalizeDispatchAction, normalizeHandoverSignoff, normalizeImageCloudStudy, normalizeOperationSnapshot, normalizeQualitySafetyStatus, normalizeReconciliationBatchItem, normalizeState, patchCollectionItem, personIndexForResident, prependAuditTrailEntry, publishDiagnosticReportToFhir, publishImagingStudyToFhir, qualitySafetySlaState, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, reviewImageCloudRecognitionAppeal, reviewMutualRecognitionRecord, rowMatchesOrganizationScope, sendDownload, sendJson, sendT10ProductionControlError, solutionAHealth, submitImageCloudRecognitionAppeal, upsertPhase2MutualRecognitionCitation, validateQualitySafetyInterfaceMessage, writeDatabase } = runtime;
  return {
      id: "clinical-specialties-04",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/emergency/dashboard") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/dashboard");
        if (!user) return true;
        const data = readDatabase();
        const bloodCoordination = BloodEventHub.dashboard(data, user);
        sendJson(res, 200, redactSensitiveResponse({ ...EmergencyService.buildDashboard(data, user), bloodCoordination: { ...bloodCoordination, projections: bloodCoordination.projections.filter((item) => item.consumer === "emergency") } }, user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/life-chain/overview") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/life-chain/overview");
        if (!user) return true;
        try { sendJson(res, 200, redactSensitiveResponse(EmergencyLifeChain.buildOverview(readDatabase(), user, url.searchParams.get("eventId") || ""), user)); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/life-chain/command-center") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/life-chain/command-center");
        if (!user) return true;
        try { sendJson(res, 200, EmergencyLifeChain.buildCommandCenter(readDatabase(), user)); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/life-chain/quality") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/life-chain/quality");
        if (!user) return true;
        try { sendJson(res, 200, EmergencyLifeChain.buildQualityDashboard(readDatabase(), user)); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/life-chain/authorizations") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/life-chain/authorizations");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyLifeChain.createAuthorization(data, user, await collectJson(req)); writeDatabase(data); sendJson(res, 201, { ok:true, item }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      const lifeChainAuthorizationRevokeMatch = url.pathname.match(/^\/api\/emergency\/life-chain\/authorizations\/([^/]+)\/revoke$/);
      if (req.method === "POST" && lifeChainAuthorizationRevokeMatch) {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/life-chain/authorizations/:id/revoke");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyLifeChain.revokeAuthorization(data, user, decodeURIComponent(lifeChainAuthorizationRevokeMatch[1]), await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, item }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/life-chain/family-contacts") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/life-chain/family-contacts");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyLifeChain.addFamilyContact(data, user, await collectJson(req)); writeDatabase(data); sendJson(res, 201, { ok:true, item }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/life-chain/device-sos") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/life-chain/device-sos");
        if (!user) return true;
        try { const data=readDatabase(); const event=EmergencyLifeChain.createAutomaticSos(data, user, await collectJson(req), EmergencyService); const submission=event.automaticSosSubmission || { deduplicated:false, eventId:event.id }; writeDatabase(data); sendJson(res, submission.deduplicated ? 200 : 201, { ok:true, event, submission, callInstruction:submission.deduplicated ? null : { telUri:"tel:120", requiresDeviceConfirmation:true, message:"A pre-authorized device SOS was submitted to the 120 information queue. The device must still obtain native call confirmation for 120." } }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      const automaticSosCancellationRequestMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/automatic-sos-cancellation-request$/);
      if (req.method === "POST" && automaticSosCancellationRequestMatch) {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/events/:id/automatic-sos-cancellation-request");
        if (!user) return true;
        try { const data=readDatabase(); const sos=EmergencyLifeChain.requestAutomaticSosCancellation(data, user, decodeURIComponent(automaticSosCancellationRequestMatch[1]), await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, sos }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : error.status === 409 ? "Conflict" : "Bad Request", message:error.message }); }
        return true;
      }

      const automaticSosCancellationResolveMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/automatic-sos-cancellation-resolve$/);
      if (req.method === "POST" && automaticSosCancellationResolveMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/events/:id/automatic-sos-cancellation-resolve");
        if (!user) return true;
        try { const data=readDatabase(); const sos=EmergencyLifeChain.resolveAutomaticSosCancellation(data, user, decodeURIComponent(automaticSosCancellationResolveMatch[1]), await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, sos }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : error.status === 409 ? "Conflict" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/aed-map") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/aed-map");
        if (!user) return true;
        try {
          const item = EmergencyService.buildAedMap(readDatabase(), user, { latitude:url.searchParams.get("latitude"), longitude:url.searchParams.get("longitude"), limit:url.searchParams.get("limit") });
          sendJson(res, 200, redactSensitiveResponse(item, user));
        } catch (error) {
          sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/calls") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/calls");
        if (!user) return true;
        try {
          const data = readDatabase();
          const payload = await collectJson(req);
          const event = EmergencyService.createCall(data, user, payload);
          writeDatabase(data);
          sendJson(res, 201, { ok: true, event, warning: "辅助呼救信息已提交，正式派车必须由120坐席人工确认；危急情况请立即拨打120。" });
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/sos") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/sos");
        if (!user) return true;
        try {
          const data = readDatabase();
          const event = EmergencyService.createSosCall(data, user, await collectJson(req));
          EmergencyLifeChain.coordinateEvent(data, user, event, event.sos || {});
          writeDatabase(data);
          sendJson(res, 201, { ok:true, event, callInstruction:{ telUri:"tel:120", requiresDeviceConfirmation:true, message:"SOS information was submitted to the 120 acceptance queue. Confirm the mobile system call to reach 120." } });
        } catch (error) {
          sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message });
        }
        return true;
      }

      const lifeChainCoordinateMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/life-chain\/coordinate$/);
      if (req.method === "POST" && lifeChainCoordinateMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/events/:id/life-chain/coordinate");
        if (!user) return true;
        try { const data=readDatabase(); const event=data.emergencyEvents.find((item) => item.id === decodeURIComponent(lifeChainCoordinateMatch[1])); const lifeChain=EmergencyLifeChain.coordinateEvent(data, user, event, await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, lifeChain }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      const greenChannelConfirmMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/green-channel\/confirm$/);
      if (req.method === "POST" && greenChannelConfirmMatch) {
        const user = requireApiRole(req, res, ["institution"], "/api/emergency/events/:id/green-channel/confirm");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyLifeChain.confirmGreenChannel(data, user, decodeURIComponent(greenChannelConfirmMatch[1]), await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, item }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      const emergencyEvidencePackageMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/evidence-package$/);
      if (req.method === "GET" && emergencyEvidencePackageMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/events/:id/evidence-package");
        if (!user) return true;
        try {
          const item = EmergencyService.buildEvidencePackage(readDatabase(), user, decodeURIComponent(emergencyEvidencePackageMatch[1]));
          sendJson(res, 200, redactSensitiveResponse(item, user));
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const emergencyEvidenceExportMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/evidence-package\/export$/);
      if (req.method === "GET" && emergencyEvidenceExportMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/events/:id/evidence-package/export");
        if (!user) return true;
        try {
          const evidencePackage = redactSensitiveResponse(EmergencyService.buildEvidencePackage(readDatabase(), user, decodeURIComponent(emergencyEvidenceExportMatch[1])), user);
          const output = EmergencyService.buildEvidenceExport(evidencePackage, url.searchParams.get("format") || "json");
          sendDownload(res, 200, output.body, output.contentType, output.filename);
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const emergencyCareActionMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/actions$/);
      if (req.method === "POST" && emergencyCareActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/events/:id/actions");
        if (!user) return true;
        try {
          const data = readDatabase();
          const payload = await collectJson(req);
          const event = EmergencyService.applyAction(data, user, decodeURIComponent(emergencyCareActionMatch[1]), payload);
          writeDatabase(data);
          sendJson(res, 200, { ok: true, event, dashboard: EmergencyService.buildDashboard(data, user) });
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/production-center") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production-center");
        if (!user) return true;
        sendJson(res, 200, EmergencyProduction.buildCenter(readDatabase()));
        return true;
      }

      const emergencyEndpointProbeMatch = url.pathname.match(/^\/api\/emergency\/production\/endpoints\/([^/]+)\/probe$/);
      if (req.method === "POST" && emergencyEndpointProbeMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/production/endpoints/:id/probe");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.probeEndpoint(data,user,decodeURIComponent(emergencyEndpointProbeMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/production/deliveries") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/deliveries");
        if (!user) return true;
        try { const data=readDatabase(); const result=EmergencyProduction.enqueue(data,user,await collectJson(req)); writeDatabase(data); sendJson(res,result.idempotentReplay?200:201,{ok:true,...result}); }
        catch(error){ sendJson(res,400,{error:"Bad Request",message:error.message}); }
        return true;
      }

      const emergencyDeliveryRetryMatch = url.pathname.match(/^\/api\/emergency\/production\/deliveries\/([^/]+)\/retry$/);
      if (req.method === "POST" && emergencyDeliveryRetryMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/deliveries/:id/retry");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.retryDelivery(data,user,decodeURIComponent(emergencyDeliveryRetryMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); }
        return true;
      }

      const emergencyDrillMatch = url.pathname.match(/^\/api\/emergency\/production\/drills\/([^/]+)\/complete$/);
      if (req.method === "POST" && emergencyDrillMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/production/drills/:id/complete");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.completeDrill(data,user,decodeURIComponent(emergencyDrillMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); }
        return true;
      }

      const emergencyRequirementMatch = url.pathname.match(/^\/api\/emergency\/production\/requirements\/([^/]+)\/sign$/);
      if (req.method === "POST" && emergencyRequirementMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/production/requirements/:id/sign");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.signRequirement(data,user,decodeURIComponent(emergencyRequirementMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); }
        return true;
      }

      const emergencyQualityMatch = url.pathname.match(/^\/api\/emergency\/production\/quality\/events\/([^/]+)\/validate$/);
      if (req.method === "POST" && emergencyQualityMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/quality/events/:id/validate"); if (!user) return true;
        try { const data=readDatabase(); const result=EmergencyProduction.validateEvent(data,user,decodeURIComponent(emergencyQualityMatch[1])); writeDatabase(data); sendJson(res,200,{ok:true,result,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); } return true;
      }

      const emergencyQualityIssueMatch = url.pathname.match(/^\/api\/emergency\/production\/quality\/issues\/([^/]+)\/resolve$/);
      if (req.method === "POST" && emergencyQualityIssueMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/quality/issues/:id/resolve"); if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.resolveDataQualityIssue(data,user,decodeURIComponent(emergencyQualityIssueMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); } return true;
      }

      const emergencyAlertMatch = url.pathname.match(/^\/api\/emergency\/production\/alerts\/([^/]+)\/actions$/);
      if (req.method === "POST" && emergencyAlertMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/alerts/:id/actions"); if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.applyAlertAction(data,user,decodeURIComponent(emergencyAlertMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); } return true;
      }

      const emergencyApprovalMatch = url.pathname.match(/^\/api\/emergency\/production\/approvals\/([^/]+)\/sign$/);
      if (req.method === "POST" && emergencyApprovalMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/production/approvals/:id/sign"); if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.signCutoverApproval(data,user,decodeURIComponent(emergencyApprovalMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); } return true;
      }

      const emergencyHandoffMatch = url.pathname.match(/^\/api\/emergency\/production\/handoffs\/([^/]+)\/accept$/);
      if (req.method === "POST" && emergencyHandoffMatch) { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/handoffs/:id/accept");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.acceptProductionHandoff(data,user,decodeURIComponent(emergencyHandoffMatch[1]),await collectJson(req));writeDatabase(data);sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message});}return true; }

      const emergencyBriefMatch = url.pathname.match(/^\/api\/emergency\/production\/command-briefs\/([^/]+)\/actions$/);
      if (req.method === "POST" && emergencyBriefMatch) { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/command-briefs/:id/actions");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.applyCommandBriefAction(data,user,decodeURIComponent(emergencyBriefMatch[1]),await collectJson(req));writeDatabase(data);sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message});}return true; }

      const emergencyObservationMatch = url.pathname.match(/^\/api\/emergency\/production\/observations\/([^/]+)\/record$/);
      if (req.method === "POST" && emergencyObservationMatch) { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/observations/:id/record");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.recordObservation(data,user,decodeURIComponent(emergencyObservationMatch[1]),await collectJson(req));writeDatabase(data);sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message});}return true; }

      if (req.method === "POST" && url.pathname === "/api/emergency/production/incidents") { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/incidents");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.createLaunchIncident(data,user,await collectJson(req));writeDatabase(data);sendJson(res,201,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,400,{error:"Bad Request",message:error.message});}return true; }

      const emergencyIncidentResolveMatch = url.pathname.match(/^\/api\/emergency\/production\/incidents\/([^/]+)\/resolve$/);
      if (req.method === "POST" && emergencyIncidentResolveMatch) { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/incidents/:id/resolve");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.resolveLaunchIncident(data,user,decodeURIComponent(emergencyIncidentResolveMatch[1]),await collectJson(req));writeDatabase(data);sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message});}return true; }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-04", SUBDOMAIN: "emergency-care" };
