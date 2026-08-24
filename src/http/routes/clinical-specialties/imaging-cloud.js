"use strict";

const {
  projectImagingErrorResponse,
  projectPublicImagingResponse
} = require("../../../clinical-specialties/imaging/public-response");
const {
  createImagingStudyShare
} = require("../../../clinical-specialties/imaging/study-share-command");
const {
  commitImagingStudyQualityControl,
  createImagingStudyQualityControlCommand
} = require("../../../clinical-specialties/imaging/study-quality-control-command");

function createRouteSegment(runtime) {
  const { ImagingCloudProduction, appendDataAccessLog, appendSecurityEvent, buildImagingCloudProductionResponse, canAccessResident, collectJson, publishDiagnosticReportToFhir, randomUUID, readDatabase, requireApiRole, sendJson, writeDatabase } = runtime;
  const sendImagingJson = (res, status, body) => sendJson(
    res,
    status,
    status >= 400 ? projectImagingErrorResponse(body) : projectPublicImagingResponse(body)
  );
  return {
      id: "clinical-specialties-01",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/imaging-cloud/production-center") {
        const user = requireApiRole(req, res, ["commission", "institution"], url.pathname);
        if (!user) return true;
        const center = buildImagingCloudProductionResponse(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "imaging-production-center-read",
          target: url.pathname,
          result: "allowed",
          detail: `${center.summary?.blockers || 0} module blockers; platform production gate closed`
        });
        sendImagingJson(res, 200, center);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/imaging-cloud/production/smoke") {
        const user = requireApiRole(req, res, ["commission", "institution"], url.pathname);
        if (!user) return true;
        const smoke = ImagingCloudProduction.runStandaloneSmoke(readDatabase());
        sendImagingJson(res, 200, {
          ...smoke,
          moduleEvidenceReady: smoke.releaseDecision === "go",
          releaseDecision: "no-go-platform-approval-pending",
          productionReady: false,
          formalGoLiveState: "blocked-until-trusted-site-evidence-and-platform-launch-approval"
        });
        return true;
      }

      const imagingShareMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/share$/);
      if (req.method === "POST" && imagingShareMatch) {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/imaging-cloud/studies/:id/share");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingShareMatch[1]);
        const study = (data.imageCloudStudies || []).find((item) => item.id === studyId);
        if (!study) {
          sendImagingJson(res, 404, { error: "Not Found", message: "未找到影像云检查" });
          return true;
        }
        if (!canAccessResident(user, study.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "share imaging study", target: studyId, result: "denied", detail: "resident scope denied" });
          sendImagingJson(res, 403, { error: "Forbidden", message: "无权分享该居民影像资料" });
          return true;
        }
        const payload = await collectJson(req);
        const share = createImagingStudyShare(data, user, study, studyId, payload, {
          appendDataAccessLog,
          randomUUID
        });
        writeDatabase(data);
        sendImagingJson(res, 201, share);
        return true;
      }

      const imagingQcMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/qc$/);
      if (req.method === "POST" && imagingQcMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/imaging-cloud/studies/:id/qc");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingQcMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        if (studyIndex < 0) {
          sendImagingJson(res, 404, { error: "Not Found", message: "未找到影像云检查" });
          return true;
        }
        const payload = await collectJson(req);
        const command = createImagingStudyQualityControlCommand(
          user,
          data.imageCloudStudies[studyIndex],
          payload,
          { randomUUID }
        );
        let fhirReportSync;
        try {
          fhirReportSync = await publishDiagnosticReportToFhir(command.updatedStudy, command.review);
        } catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "sync DiagnosticReport to FHIR", target: studyId, result: "failed", detail: error.message });
          sendImagingJson(res, 502, { error: "FHIR DiagnosticReport Sync Failed", message: error.message });
          return true;
        }
        const result = commitImagingStudyQualityControl(data, studyIndex, command, fhirReportSync);
        writeDatabase(data);
        sendImagingJson(res, 200, result);
        return true;
      }

      const imagingProductionEndpointMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/endpoints\/([^/]+)\/probe$/);
      const imagingProductionSyntheticMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/synthetic-checks\/([^/]+)\/actions$/);
      const imagingProductionRequirementMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/requirements\/([^/]+)\/actions$/);
      const imagingProductionReceiptMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/receipts\/([^/]+)\/(submit|verify)$/);
      const imagingProductionDrillMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/drills\/([^/]+)\/complete$/);
      const imagingProductionApprovalMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/approvals\/([^/]+)\/sign$/);
      if (req.method === "POST" && (
        imagingProductionEndpointMatch
        || imagingProductionSyntheticMatch
        || imagingProductionRequirementMatch
        || imagingProductionReceiptMatch
        || imagingProductionDrillMatch
        || imagingProductionApprovalMatch
      )) {
        const commissionOnly = Boolean(
          (imagingProductionReceiptMatch && imagingProductionReceiptMatch[2] === "verify")
          || imagingProductionApprovalMatch
        );
        const user = requireApiRole(req, res, commissionOnly ? ["commission"] : ["commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        try {
          let item;
          let action;
          if (imagingProductionEndpointMatch) {
            action = "probe-production-endpoint";
            item = ImagingCloudProduction.probeEndpoint(data, user, decodeURIComponent(imagingProductionEndpointMatch[1]), payload);
          } else if (imagingProductionSyntheticMatch) {
            action = "record-synthetic-check";
            item = ImagingCloudProduction.recordSyntheticCheck(data, user, decodeURIComponent(imagingProductionSyntheticMatch[1]), payload);
          } else if (imagingProductionRequirementMatch) {
            action = "govern-site-requirement";
            item = ImagingCloudProduction.signRequirement(data, user, decodeURIComponent(imagingProductionRequirementMatch[1]), payload);
          } else if (imagingProductionReceiptMatch) {
            const type = decodeURIComponent(imagingProductionReceiptMatch[1]);
            action = imagingProductionReceiptMatch[2] === "verify" ? "verify-site-receipt" : "submit-site-receipt";
            item = imagingProductionReceiptMatch[2] === "verify"
              ? ImagingCloudProduction.verifySiteReceipt(data, user, type, payload)
              : ImagingCloudProduction.submitSiteReceipt(data, user, type, payload);
          } else if (imagingProductionDrillMatch) {
            action = "complete-production-drill";
            item = ImagingCloudProduction.completeDrill(data, user, decodeURIComponent(imagingProductionDrillMatch[1]), payload);
          } else {
            action = "sign-module-cutover-approval";
            item = ImagingCloudProduction.signApproval(data, user, decodeURIComponent(imagingProductionApprovalMatch[1]), payload);
          }
          writeDatabase(data);
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: `imaging-production-${action}`,
            target: String(item?.id || item?.type || url.pathname),
            result: "allowed",
            detail: "module evidence updated; platform production gate remains closed"
          });
          sendImagingJson(res, 200, {
            item,
            center: buildImagingCloudProductionResponse(data),
            productionReady: false
          });
        } catch (error) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "imaging-production-control",
            target: url.pathname,
            result: "denied",
            detail: String(error?.message || "control rejected").slice(0, 240)
          });
          const status = Number(error?.statusCode || error?.status || 400);
          sendImagingJson(res, status >= 400 && status < 600 ? status : 400, {
            error: String(error?.code || "Imaging Production Control Rejected"),
            code: error?.code,
            message: error?.message,
            productionReady: false
          });
        }
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-01", SUBDOMAIN: "imaging-cloud" };
