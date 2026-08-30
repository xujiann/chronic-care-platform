"use strict";

const {
  createBloodCoreHttpHandler
} = require("../../../clinical-specialties/blood/http-handler");
const {
  createImagingDashboardQuery
} = require("../../../clinical-specialties/imaging/dashboard-query");
const {
  projectImagingDashboardResponse,
  projectImagingErrorResponse,
  projectImagingViewerResponse,
  projectPublicImagingResponse,
  sanitizePublicString
} = require("../../../clinical-specialties/imaging/public-response");



function createRouteSegment(runtime) {
  const { BloodBusinessService, BloodIntegrationGateway, BloodMasterData, BloodService, BloodTransactionService, appendDataAccessLog, appendSecurityEvent, buildImageCloudDashboard, buildImageCloudDerivedRecords, buildOhifStudyUrl, canAccessResident, collectJson, createHash, createImageCloudMutualRecognitionChain, listOrthancStudySummaries, mergeByKey, normalizeImageCloudStudy, personIndexForResident, publishImagingStudyToFhir, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, reviewImageCloudRecognitionAppeal, reviewMutualRecognitionRecord, sendJson, solutionAHealth, submitImageCloudRecognitionAppeal, upsertPhase2MutualRecognitionCitation, writeDatabase } = runtime;
  const bloodCoreHttpHandler = createBloodCoreHttpHandler({
    BloodBusinessService,
    BloodIntegrationGateway,
    BloodMasterData,
    BloodService,
    BloodTransactionService,
    collectJson,
    readDatabase,
    requireApiRole,
    sendJson,
    writeDatabase
  });
  const sendImagingJson = (res, status, body, projector) => sendJson(
    res,
    status,
    (projector || (status >= 400 ? projectImagingErrorResponse : projectPublicImagingResponse))(body)
  );
  return {
      id: "clinical-specialties-06",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (await bloodCoreHttpHandler.handle(req, res, url)) return true;

      if (req.method === "GET" && url.pathname === "/api/imaging-cloud") {
        const user = requireApiRole(req, res, ["commission", "institution", "county", "citizen"], "/api/imaging-cloud");
        if (!user) return true;
        const imagingDashboardQuery = createImagingDashboardQuery({
          buildImagingDashboard: buildImageCloudDashboard,
          redactSensitiveResponse
        });
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "access imaging cloud", target: residentId, result: "denied", detail: "resident scope denied" });
          sendImagingJson(res, 403, { error: "Forbidden", message: "无权调阅该居民影像云资料" });
          return true;
        }
        if (residentId) {
          appendDataAccessLog(data, user, residentId, "医学影像云", "查询影像检查、报告和电子病历索引");
          writeDatabase(data);
        }
        const response = imagingDashboardQuery.execute({
          data,
          user,
          residentId,
          institutionCode: url.searchParams.get("institutionCode") || ""
        });
        sendJson(res, 200, response);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/imaging-cloud/solution-a/health") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/imaging-cloud/solution-a/health");
        if (!user) return true;
        const health = await solutionAHealth();
        appendSecurityEvent({ actor: user.name, role: user.role, action: "probe solution A", target: url.pathname, result: health.ok ? "allowed" : "degraded", detail: `${health.services.filter((item) => item.ok).length}/${health.services.length} services ready` });
        sendImagingJson(res, health.ok ? 200 : 503, health, projectPublicImagingResponse);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/imaging-cloud/solution-a/studies") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/imaging-cloud/solution-a/studies");
        if (!user) return true;
        const studies = await listOrthancStudySummaries();
        appendSecurityEvent({ actor: user.name, role: user.role, action: "list solution A studies", target: url.pathname, result: "allowed", detail: `${studies.length} normalized DICOMweb studies` });
        sendImagingJson(res, 200, { generatedAt: new Date().toISOString(), summary: { studies: studies.length, synthetic: studies.filter((item) => item.synthetic).length }, studies, boundary: "Non-synthetic patient identity is masked; resident linkage requires an explicit governed mapping workflow." });
        return true;
      }

      const solutionAStudyLinkMatch = url.pathname.match(/^\/api\/imaging-cloud\/solution-a\/studies\/([^/]+)\/link$/);
      if (req.method === "POST" && solutionAStudyLinkMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/imaging-cloud/solution-a/studies/:uid/link");
        if (!user) return true;
        const payload = await collectJson(req);
        const residentId = String(payload.residentId || "").trim();
        const approvalEvidence = String(payload.approvalEvidence || "").trim();
        const data = readDatabase();
        if (!residentId || !canAccessResident(user, residentId, data)) {
          sendImagingJson(res, residentId ? 403 : 400, { error: residentId ? "Forbidden" : "Bad Request", message: residentId ? "无权关联该居民" : "residentId不能为空" });
          return true;
        }
        const studyInstanceUID = decodeURIComponent(solutionAStudyLinkMatch[1]);
        const externalStudy = (await listOrthancStudySummaries()).find((item) => item.studyInstanceUID === studyInstanceUID);
        if (!externalStudy) { sendImagingJson(res, 404, { error: "Not Found", message: "Orthanc中未找到该检查" }); return true; }
        if (!externalStudy.synthetic && approvalEvidence.length < 12) {
          sendImagingJson(res, 409, { error: "Governance Evidence Required", message: "非合成检查必须提供经复核的主索引匹配证据" });
          return true;
        }
        const resident = (data.residents || []).find((item) => item.id === residentId);
        if (!resident) { sendImagingJson(res, 404, { error: "Not Found", message: "未找到居民" }); return true; }
        const existingIndex = (data.imageCloudStudies || []).findIndex((item) => item.studyInstanceUID === studyInstanceUID);
        const now = new Date().toISOString();
        const study = {
          ...(existingIndex >= 0 ? data.imageCloudStudies[existingIndex] : {}),
          id: existingIndex >= 0 ? data.imageCloudStudies[existingIndex].id : `ics-orthanc-${createHash("sha256").update(studyInstanceUID).digest("hex").slice(0, 16)}`,
          residentId, personIndex: personIndexForResident(new Map(data.residents.map((item) => [item.id, item])), residentId),
          institutionCode: String(payload.institutionCode || user.orgCode || "SOLUTION-A"), institutionName: String(payload.institutionName || user.orgName || "方案A试点机构"),
          accessionNumber: externalStudy.accessionNumber || `ORTHANC-${studyInstanceUID.split(".").pop()}`,
          studyInstanceUID, mainIndex: `${String(payload.institutionCode || user.orgCode || "SOLUTION-A")}#${resident.idCard || residentId}#${externalStudy.accessionNumber || studyInstanceUID}`,
          patientName: resident.name, modality: externalStudy.modalities || "OT", bodyPart: externalStudy.studyDescription || "合成影像预览",
          studyDate: externalStudy.studyDate || new Date().toISOString().slice(0, 10), reportConclusion: "方案A外部影像已完成受控索引关联，诊断报告待正式系统回传。",
          seriesCount: 1, imageCount: 1, diagnosticLevel: false, browserLevel: true, uploadMode: "Orthanc DICOMweb",
          uploadStatus: "已入云", integrityCheck: "DICOMweb可检索", qcStatus: "待质控", emrSyncStatus: "待报告审核后写入",
          externalSource: "solution-a-orthanc", synthetic: externalStudy.synthetic, approvalEvidence: externalStudy.synthetic ? "synthetic-test-data" : approvalEvidence,
          viewerUrl: externalStudy.viewerUrl, linkedBy: user.username || user.name, linkedAt: now, updatedAt: now
        };
        let fhirSync;
        try { fhirSync = await publishImagingStudyToFhir(study, resident); }
        catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "sync ImagingStudy to FHIR", target: studyInstanceUID, result: "failed", detail: error.message });
          sendImagingJson(res, 502, { error: "FHIR Sync Failed", message: error.message });
          return true;
        }
        study.fhirPatientId = fhirSync.patient.id;
        study.fhirImagingStudyId = fhirSync.imagingStudy.id;
        study.fhirSyncStatus = "synced";
        study.fhirSyncedAt = now;
        if (existingIndex >= 0) data.imageCloudStudies[existingIndex] = study;
        else data.imageCloudStudies = [study, ...(data.imageCloudStudies || [])].slice(0, 500);
        appendDataAccessLog(data, user, residentId, "医学影像云", `关联Orthanc检查 ${study.accessionNumber}`);
        writeDatabase(data);
        sendImagingJson(res, existingIndex >= 0 ? 200 : 201, { study, created: existingIndex < 0, governance: { synthetic: externalStudy.synthetic, evidence: study.approvalEvidence }, fhirSync });
        return true;
      }

      const imagingViewerMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/viewer$/);
      if (req.method === "GET" && imagingViewerMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county", "citizen"], "/api/imaging-cloud/studies/:id/viewer");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingViewerMatch[1]);
        const study = (data.imageCloudStudies || []).find((item) => item.id === studyId);
        if (!study) { sendImagingJson(res, 404, { error: "Not Found", message: "未找到影像检查" }); return true; }
        if (!canAccessResident(user, study.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "open OHIF viewer", target: studyId, result: "denied", detail: "resident scope denied" });
          sendImagingJson(res, 403, { error: "Forbidden", message: "无权调阅该居民影像" });
          return true;
        }
        const viewerUrl = buildOhifStudyUrl(study.studyInstanceUID);
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `通过OHIF调阅 ${study.accessionNumber}`);
        writeDatabase(data);
        sendImagingJson(res, 200, { studyId, studyInstanceUID: study.studyInstanceUID, viewerUrl, viewer: "OHIF", archive: "Orthanc DICOMweb", expiresAt: null }, projectImagingViewerResponse);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/imaging-cloud/ingest") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/imaging-cloud/ingest");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let study;
        try {
          study = normalizeImageCloudStudy(payload, user, data);
        } catch (error) {
          if (error.message === "forbidden resident scope") {
            appendSecurityEvent({ actor: user.name, role: user.role, action: "ingest imaging study", target: payload.residentId || "", result: "denied", detail: "resident scope denied" });
            sendImagingJson(res, 403, { error: "Forbidden", message: "无权为该居民接入影像数据" });
            return true;
          }
          sendImagingJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const derived = buildImageCloudDerivedRecords(study, user);
        const existingStudyIndex = (data.imageCloudStudies || []).findIndex((item) => item.studyInstanceUID === study.studyInstanceUID || item.id === study.id);
        if (existingStudyIndex >= 0) data.imageCloudStudies[existingStudyIndex] = { ...data.imageCloudStudies[existingStudyIndex], ...study };
        else data.imageCloudStudies = [study, ...(Array.isArray(data.imageCloudStudies) ? data.imageCloudStudies : [])].slice(0, 500);
        data.diagnosticReports = mergeByKey([derived.report], data.diagnosticReports, "id").slice(0, 300);
        data.personalRecords = mergeByKey([derived.personalRecord], data.personalRecords, "id").slice(0, 500);
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `接入 ${study.modality} ${study.accessionNumber}`);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "ingest imaging study",
            target: `${study.institutionCode}/${study.accessionNumber}`,
            result: "allowed",
            detail: `${study.uploadMode} / ${study.integrityCheck} / ${study.emrSyncStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendImagingJson(res, existingStudyIndex >= 0 ? 200 : 201, { study, ...derived });
        return true;
      }

      const imagingRecognitionMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/mutual-recognition$/);
      if (req.method === "POST" && imagingRecognitionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/imaging-cloud/studies/:id/mutual-recognition");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingRecognitionMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        if (studyIndex < 0) {
          sendImagingJson(res, 404, { error: "Not Found", message: "未找到影像云检查" });
          return true;
        }
        const study = data.imageCloudStudies[studyIndex];
        if (!canAccessResident(user, study.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "start imaging mutual recognition", target: studyId, result: "denied", detail: "resident scope denied" });
          sendImagingJson(res, 403, { error: "Forbidden", message: "无权将该居民影像纳入跨机构互认" });
          return true;
        }
        const payload = await collectJson(req);
        const chain = createImageCloudMutualRecognitionChain(data, study, payload, user);
        data.imageCloudStudies[studyIndex] = {
          ...study,
          mutualRecognitionStatus: chain.recognition.status,
          mutualRecognitionRecordId: chain.recognition.id,
          countyCollaborationOrderId: chain.order.id,
          updatedAt: new Date().toISOString()
        };
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `纳入跨机构互认 ${study.accessionNumber} · ${study.mainIndex}`);
        data.securityEvents = [{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "start imaging mutual recognition",
          target: studyId,
          result: "allowed",
          detail: `${chain.order.id} · ${chain.recognition.id} · ${study.mainIndex}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(data);
        sendImagingJson(res, chain.created ? 201 : 200, { ...chain, study: data.imageCloudStudies[studyIndex] });
        return true;
      }

      const imagingRecognitionDecisionMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/mutual-recognition\/decision$/);
      if (req.method === "POST" && imagingRecognitionDecisionMatch) {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/imaging-cloud/studies/:id/mutual-recognition/decision");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingRecognitionDecisionMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        if (studyIndex < 0) {
          sendImagingJson(res, 404, { error: "Not Found", message: "未找到影像云检查" });
          return true;
        }
        const study = data.imageCloudStudies[studyIndex];
        if (!canAccessResident(user, study.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "decide imaging mutual recognition", target: studyId, result: "denied", detail: "resident scope denied" });
          sendImagingJson(res, 403, { error: "Forbidden", message: "无权确认该居民影像互认结果" });
          return true;
        }
        const record = (data.countyMutualRecognitionRecords || []).find((item) => item.imageCloudStudyId === studyId);
        if (!record) {
          sendImagingJson(res, 409, { error: "Conflict", message: "请先将影像检查纳入跨机构互认" });
          return true;
        }
        const payload = await collectJson(req);
        let reviewed;
        try {
          reviewed = reviewMutualRecognitionRecord(data, record.id, payload, user);
        } catch (error) {
          sendImagingJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const recognized = reviewed.status === "recognized";
        const citation = upsertPhase2MutualRecognitionCitation(data, reviewed, payload, user);
        data.imageCloudStudies[studyIndex] = {
          ...study,
          mutualRecognitionStatus: recognized ? "已互认" : "不予互认",
          mutualRecognitionRecordId: reviewed.id,
          mutualRecognitionReason: reviewed.reviewReasonCode,
          mutualRecognitionReviewedAt: reviewed.reviewedAt,
          updatedAt: new Date().toISOString()
        };
        data.countyCollaborationOrders = (data.countyCollaborationOrders || []).map((item) => item.recognitionRecordId === reviewed.id ? {
          ...item,
          status: recognized ? "已完成互认" : "退回复核",
          result: recognized ? "影像报告已互认，可按授权主索引调阅" : `不予互认：${reviewed.reviewReasonCode}`,
          updatedAt: reviewed.reviewedAt
        } : item);
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `${recognized ? "确认互认" : "拒绝互认"} ${study.accessionNumber} · ${study.mainIndex}`);
        data.securityEvents = [{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "decide imaging mutual recognition",
          target: studyId,
          result: "allowed",
          detail: `${reviewed.status} · ${reviewed.reviewReasonCode} · ${citation?.evidenceHash || "no-citation"}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(data);
        sendImagingJson(res, 200, { study: data.imageCloudStudies[studyIndex], record: reviewed, citation });
        return true;
      }

      const imagingRecognitionAppealMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/mutual-recognition\/appeal$/);
      if (req.method === "POST" && imagingRecognitionAppealMatch) {
        const user = requireApiRole(req, res, ["institution"], "/api/imaging-cloud/studies/:id/mutual-recognition/appeal");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingRecognitionAppealMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        const record = (data.countyMutualRecognitionRecords || []).find((item) => item.imageCloudStudyId === studyId);
        if (studyIndex < 0 || !record) {
          sendImagingJson(res, 404, { error: "Not Found", message: "影像检查或互认记录不存在" });
          return true;
        }
        let result;
        try {
          result = submitImageCloudRecognitionAppeal(data, data.imageCloudStudies[studyIndex], record, await collectJson(req), user);
        } catch (error) {
          sendImagingJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        data.imageCloudStudies[studyIndex] = {
          ...data.imageCloudStudies[studyIndex],
          mutualRecognitionStatus: "appeal-pending",
          mutualRecognitionReason: result.appeal.reason,
          updatedAt: result.appeal.submittedAt
        };
        data.countyCollaborationOrders = (data.countyCollaborationOrders || []).map((item) => item.recognitionRecordId === record.id ? {
          ...item,
          status: "appeal-pending",
          result: `Appeal evidence pending independent review: ${result.appeal.evidenceRefs.join(", ")}`,
          updatedAt: result.appeal.submittedAt
        } : item);
        data.securityEvents = [{
          id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
          action: "submit imaging mutual recognition appeal", target: studyId, result: "allowed",
          detail: `${result.appeal.id} / ${result.appeal.evidenceRefs.join(",")}`
        }, ...(data.securityEvents || [])].slice(0, 120);
        writeDatabase(data);
        sendImagingJson(res, 201, { study: data.imageCloudStudies[studyIndex], ...result });
        return true;
      }

      const imagingRecognitionAppealReviewMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/mutual-recognition\/appeal\/review$/);
      if (req.method === "POST" && imagingRecognitionAppealReviewMatch) {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/imaging-cloud/studies/:id/mutual-recognition/appeal/review");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingRecognitionAppealReviewMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        const record = (data.countyMutualRecognitionRecords || []).find((item) => item.imageCloudStudyId === studyId);
        if (studyIndex < 0 || !record) {
          sendImagingJson(res, 404, { error: "Not Found", message: "影像检查或互认记录不存在" });
          return true;
        }
        let result;
        try {
          result = reviewImageCloudRecognitionAppeal(data, record, await collectJson(req), user);
        } catch (error) {
          sendImagingJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const citation = upsertPhase2MutualRecognitionCitation(data, result.record, { reasonCode: result.record.reviewReasonCode }, user);
        data.imageCloudStudies[studyIndex] = {
          ...data.imageCloudStudies[studyIndex],
          mutualRecognitionStatus: result.approved ? "recognized-after-appeal" : "rejected-after-appeal",
          mutualRecognitionReason: result.record.reviewReasonCode || result.appeal.reviewComment,
          mutualRecognitionReviewedAt: result.appeal.reviewedAt,
          updatedAt: result.appeal.reviewedAt
        };
        data.countyCollaborationOrders = (data.countyCollaborationOrders || []).map((item) => item.recognitionRecordId === record.id ? {
          ...item,
          status: result.approved ? "recognized-after-appeal" : "appeal-rejected",
          result: result.approved ? "Mutual recognition approved after independent appeal review" : "Appeal rejected after independent review",
          updatedAt: result.appeal.reviewedAt
        } : item);
        data.securityEvents = [{
          id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
          action: "review imaging mutual recognition appeal", target: studyId, result: "allowed",
          detail: `${result.appeal.status} / ${result.appeal.id} / ${citation?.evidenceHash || "no-citation"}`
        }, ...(data.securityEvents || [])].slice(0, 120);
        writeDatabase(data);
        sendImagingJson(res, 200, { study: data.imageCloudStudies[studyIndex], ...result, citation });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/mutual-recognition/rules") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/mutual-recognition/rules");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, { rules: data.mutualRecognitionRules || [] });
        return true;
      }
        return false;
      }
    };
}

module.exports = {
  createRouteSegment,
  projectImagingDashboardResponse,
  projectImagingErrorResponse,
  projectImagingViewerResponse,
  projectPublicImagingResponse,
  ROUTE_SEGMENT_ID: "clinical-specialties-06",
  sanitizePublicString,
  SUBDOMAIN: "clinical-blood"
};
