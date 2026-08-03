"use strict";

function createRouteSegment(runtime) {
  const { BloodBusinessService, BloodEventHub, BloodGoLiveService, BloodInnovationService, BloodIntegrationGateway, BloodMasterData, BloodService, BloodTransactionService, EmergencyLifeChain, EmergencyProduction, EmergencyService, ImagingCloudProduction, PhysicalExaminationService, allowedResidentIdsForUser, appendDataAccessLog, appendOperationsIntegrationAudit, appendQualitySafetyAudit, appendSecurityEvent, applyDispatchStatusUpdate, assertSignedOperationsPayload, buildHospitalOperationsDashboard, buildImageCloudDashboard, buildImageCloudDerivedRecords, buildImagingCloudProductionResponse, buildObservabilityAlertCenter, buildOhifStudyUrl, buildOperationsInterfaceMappingEvidence, buildOperationsMobileDuty, buildOperationsSiteJointPatrol, buildPerformanceMonitoringEvidence, buildPhysicalExamProductionReadiness, buildProductionOperationsCenter, buildQualitySafetyCoreSystemMatrix, buildQualitySafetyDashboard, buildQualitySafetyInterfaceJointTestPack, buildQualitySafetyInterfaceStandard, buildQualitySafetyIssues, buildRuntimeMetrics, canAccessResident, canAccessSecureAttachment, collectJson, createHash, createImageCloudMutualRecognitionChain, createOperationsMobileDutyReminder, integrationGatewaySecret, integrationPayloadAllowedForInstitution, isProductionRuntime, listOrthancStudySummaries, mergeByKey, normalizeDiagnosticReport, normalizeDispatchAction, normalizeHandoverSignoff, normalizeImageCloudStudy, normalizeOperationSnapshot, normalizeQualitySafetyStatus, normalizeReconciliationBatchItem, normalizeState, patchCollectionItem, personIndexForResident, prependAuditTrailEntry, publishDiagnosticReportToFhir, publishImagingStudyToFhir, qualitySafetySlaState, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, reviewImageCloudRecognitionAppeal, reviewMutualRecognitionRecord, rowMatchesOrganizationScope, sendDownload, sendJson, sendT10ProductionControlError, solutionAHealth, submitImageCloudRecognitionAppeal, upsertPhase2MutualRecognitionCitation, validateQualitySafetyInterfaceMessage, writeDatabase } = runtime;
  return {
      id: "clinical-specialties-05",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/quality-safety/dashboard") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/dashboard");
        if (!user) return true;
        const data = readDatabase();
        const bloodCoordination = BloodEventHub.dashboard(data, user);
        sendJson(res, 200, { ...buildQualitySafetyDashboard(data, user), bloodCoordination: { ...bloodCoordination, projections: bloodCoordination.projections.filter((item) => item.consumer === "quality-safety") } });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/quality-safety/interface-standard") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/interface-standard");
        if (!user) return true;
        sendJson(res, 200, buildQualitySafetyInterfaceStandard({ data: readDatabase() }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/quality-safety/interface-joint-test-pack") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/interface-joint-test-pack");
        if (!user) return true;
        sendJson(res, 200, buildQualitySafetyInterfaceJointTestPack({ data: readDatabase(), secret: integrationGatewaySecret() }));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/quality-safety/interface-messages/validate") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/interface-messages/validate");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const standard = buildQualitySafetyInterfaceStandard({ data }).standard;
        const result = validateQualitySafetyInterfaceMessage({
          standard,
          interfaceId: payload.interfaceId,
          method: payload.method || "POST",
          path: payload.path,
          headers: payload.headers || {},
          message: payload.message || payload.payload || {},
          previousIdempotencyKeys: Array.isArray(payload.previousIdempotencyKeys) ? payload.previousIdempotencyKeys : [],
          secret: integrationGatewaySecret()
        });
        appendQualitySafetyAudit(data, user, "quality-safety interface message validation", result.interfaceId || String(payload.interfaceId || ""), `${result.status}: ${result.errors.map((item) => item.code).join(",") || "accepted"}`);
        writeDatabase(data);
        sendJson(res, 200, result);
        return true;
      }

      const qualityDispatchMatch = url.pathname.match(/^\/api\/quality-safety\/issues\/([^/]+)\/dispatch$/);
      if (req.method === "POST" && qualityDispatchMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/issues/:id/dispatch");
        if (!user) return true;
        const data = readDatabase();
        const issueId = decodeURIComponent(qualityDispatchMatch[1]);
        const issue = buildQualitySafetyIssues(data).find((item) => item.id === issueId || item.sourceId === issueId);
        if (!issue) {
          sendJson(res, 404, { error: "Not Found", message: "Quality safety issue not found" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const order = {
          id: `qro-${randomUUID()}`,
          issueId: issue.id,
          sourceType: issue.type || issue.sourceType || "quality_safety_issue",
          institutionName: String(payload.institutionName || issue.institutionName || issue.owner || "site-pending").trim(),
          ownerRole: String(payload.ownerRole || issue.ownerRole || "institution").trim(),
          owner: String(payload.owner || issue.owner || user.name || "").trim(),
          requirement: String(payload.requirement || issue.description || issue.title || "Complete quality-safety rectification.").trim(),
          status: "dispatched",
          dispatchedAt: now,
          dueAt: String(payload.dueAt || issue.dueAt || "").trim(),
          feedback: [],
          review: [],
          auditTrail: [{ at: now, by: user.username || user.role, action: "dispatch", note: String(payload.comment || "").trim() }]
        };
        data.qualityRectificationOrders = [order, ...(Array.isArray(data.qualityRectificationOrders) ? data.qualityRectificationOrders : [])].slice(0, 300);
        data.qualitySafetyEvents = (Array.isArray(data.qualitySafetyEvents) ? data.qualitySafetyEvents : []).map((item) => item.id === issue.sourceId || item.id === issue.id ? {
          ...item,
          status: "dispatched",
          rectificationOrderId: order.id,
          auditTrail: [{ at: now, by: user.username || user.role, action: "dispatch", note: order.requirement }, ...(item.auditTrail || [])].slice(0, 50)
        } : item);
        appendQualitySafetyAudit(data, user, "quality-safety dispatch", issue.id, order.requirement);
        writeDatabase(data);
        sendJson(res, 201, order);
        return true;
      }

      const qualityFeedbackMatch = url.pathname.match(/^\/api\/quality-safety\/rectifications\/([^/]+)\/feedback$/);
      if (req.method === "POST" && qualityFeedbackMatch) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/quality-safety/rectifications/:id/feedback");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityFeedbackMatch[1]);
        const orders = Array.isArray(data.qualityRectificationOrders) ? data.qualityRectificationOrders : [];
        const index = orders.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality rectification order not found" });
          return true;
        }
        if (user.role !== "commission" && ![user.role, ""].includes(String(orders[index].ownerRole || ""))) {
          sendJson(res, 403, { error: "Forbidden", message: "Current role cannot submit this rectification feedback" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const feedback = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          content: String(payload.content || payload.feedback || "").trim(),
          attachments: Array.isArray(payload.attachments) ? payload.attachments.map((item) => String(item).trim()).filter(Boolean) : []
        };
        orders[index] = {
          ...orders[index],
          status: "feedback_submitted",
          feedback: [feedback, ...(orders[index].feedback || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "feedback", note: feedback.content }, ...(orders[index].auditTrail || [])].slice(0, 50)
        };
        data.qualityRectificationOrders = orders;
        appendQualitySafetyAudit(data, user, "quality-safety feedback", id, feedback.content);
        writeDatabase(data);
        sendJson(res, 200, orders[index]);
        return true;
      }

      const qualityReviewMatch = url.pathname.match(/^\/api\/quality-safety\/rectifications\/([^/]+)\/review$/);
      if (req.method === "POST" && qualityReviewMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/rectifications/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityReviewMatch[1]);
        const orders = Array.isArray(data.qualityRectificationOrders) ? data.qualityRectificationOrders : [];
        const index = orders.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality rectification order not found" });
          return true;
        }
        const payload = await collectJson(req);
        const decision = String(payload.decision || "approved").trim();
        if (!["approved", "returned", "closed"].includes(decision)) {
          sendJson(res, 400, { error: "Bad Request", message: "decision must be approved, returned or closed" });
          return true;
        }
        const now = new Date().toISOString();
        const review = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          decision,
          comment: String(payload.comment || "").trim()
        };
        const status = decision === "returned" ? "returned" : "closed";
        orders[index] = {
          ...orders[index],
          status,
          review: [review, ...(orders[index].review || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "review", note: `${decision}: ${review.comment}` }, ...(orders[index].auditTrail || [])].slice(0, 50)
        };
        data.qualityRectificationOrders = orders;
        data.qualitySafetyEvents = (Array.isArray(data.qualitySafetyEvents) ? data.qualitySafetyEvents : []).map((item) => item.id === orders[index].issueId ? {
          ...item,
          status,
          reviewedAt: now,
          reviewedBy: user.username || user.role
        } : item);
        appendQualitySafetyAudit(data, user, "quality-safety review", id, `${decision}: ${review.comment}`);
        writeDatabase(data);
        sendJson(res, 200, orders[index]);
        return true;
      }

      const qualityEscalationMatch = url.pathname.match(/^\/api\/quality-safety\/rectifications\/([^/]+)\/escalate$/);
      if (req.method === "POST" && qualityEscalationMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/rectifications/:id/escalate");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityEscalationMatch[1]);
        const orders = Array.isArray(data.qualityRectificationOrders) ? data.qualityRectificationOrders : [];
        const index = orders.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality rectification order not found" });
          return true;
        }
        if (normalizeQualitySafetyStatus(orders[index].status) === "closed") {
          sendJson(res, 400, { error: "Bad Request", message: "Closed rectification orders cannot be escalated" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const sla = qualitySafetySlaState(orders[index], new Date(now));
        const escalation = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          level: String(payload.level || (sla.slaStatus === "overdue" ? "overdue" : "watch")).trim(),
          reason: String(payload.reason || payload.comment || "Manual quality-safety escalation.").trim(),
          slaStatus: sla.slaStatus,
          daysRemaining: sla.daysRemaining
        };
        orders[index] = {
          ...orders[index],
          status: "escalated",
          escalationLevel: escalation.level,
          escalations: [escalation, ...(orders[index].escalations || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "escalate", note: escalation.reason }, ...(orders[index].auditTrail || [])].slice(0, 50)
        };
        data.qualityRectificationOrders = orders;
        appendQualitySafetyAudit(data, user, "quality-safety escalation", id, `${escalation.level}: ${escalation.reason}`);
        writeDatabase(data);
        sendJson(res, 200, { ...orders[index], ...qualitySafetySlaState(orders[index], new Date(now)) });
        return true;
      }

      const qualityCriticalAckMatch = url.pathname.match(/^\/api\/quality-safety\/critical-values\/([^/]+)\/acknowledge$/);
      if (req.method === "POST" && qualityCriticalAckMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/quality-safety/critical-values/:id/acknowledge");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityCriticalAckMatch[1]);
        const alerts = Array.isArray(data.criticalValueAlerts) ? data.criticalValueAlerts : [];
        const index = alerts.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Critical value alert not found" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const acknowledgement = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          note: String(payload.note || payload.comment || "Critical value acknowledged.").trim()
        };
        alerts[index] = {
          ...alerts[index],
          status: normalizeQualitySafetyStatus(alerts[index].status) === "closed" ? alerts[index].status : "acknowledged",
          acknowledgedAt: alerts[index].acknowledgedAt || now,
          acknowledgement,
          auditTrail: [{ at: now, by: user.username || user.role, action: "acknowledge", note: acknowledgement.note }, ...(alerts[index].auditTrail || [])].slice(0, 50)
        };
        data.criticalValueAlerts = alerts;
        appendQualitySafetyAudit(data, user, "quality-safety critical value acknowledgement", id, acknowledgement.note);
        writeDatabase(data);
        sendJson(res, 200, { ...alerts[index], normalizedStatus: normalizeQualitySafetyStatus(alerts[index].status), acknowledgementComplete: true, dispositionComplete: Boolean(alerts[index].disposedAt) });
        return true;
      }

      const qualityCriticalDisposeMatch = url.pathname.match(/^\/api\/quality-safety\/critical-values\/([^/]+)\/dispose$/);
      if (req.method === "POST" && qualityCriticalDisposeMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/quality-safety/critical-values/:id/dispose");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityCriticalDisposeMatch[1]);
        const alerts = Array.isArray(data.criticalValueAlerts) ? data.criticalValueAlerts : [];
        const index = alerts.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Critical value alert not found" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const disposition = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          action: String(payload.action || payload.disposition || "Responsible physician notified and disposition note completed.").trim(),
          outcome: String(payload.outcome || "disposed").trim()
        };
        alerts[index] = {
          ...alerts[index],
          status: "disposed",
          acknowledgedAt: alerts[index].acknowledgedAt || now,
          disposedAt: now,
          disposition,
          action: disposition.action,
          auditTrail: [{ at: now, by: user.username || user.role, action: "dispose", note: disposition.action }, ...(alerts[index].auditTrail || [])].slice(0, 50)
        };
        data.criticalValueAlerts = alerts;
        data.qualitySafetyEvents = (Array.isArray(data.qualitySafetyEvents) ? data.qualitySafetyEvents : []).map((item) => item.id === alerts[index].eventId ? {
          ...item,
          status: "closed",
          auditTrail: [{ at: now, by: user.username || user.role, action: "critical-value-disposition", note: disposition.action }, ...(item.auditTrail || [])].slice(0, 50)
        } : item);
        appendQualitySafetyAudit(data, user, "quality-safety critical value disposition", id, disposition.action);
        writeDatabase(data);
        sendJson(res, 200, { ...alerts[index], normalizedStatus: normalizeQualitySafetyStatus(alerts[index].status), acknowledgementComplete: true, dispositionComplete: true });
        return true;
      }

      const qualityPathwayReviewMatch = url.pathname.match(/^\/api\/quality-safety\/clinical-pathways\/([^/]+)\/review$/);
      if (req.method === "POST" && qualityPathwayReviewMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/clinical-pathways/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityPathwayReviewMatch[1]);
        const cases = Array.isArray(data.clinicalPathwayCases) ? data.clinicalPathwayCases : [];
        const index = cases.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Clinical pathway case not found" });
          return true;
        }
        const payload = await collectJson(req);
        const decision = String(payload.decision || "approved").trim();
        if (!["approved", "returned"].includes(decision)) {
          sendJson(res, 400, { error: "Bad Request", message: "decision must be approved or returned" });
          return true;
        }
        const now = new Date().toISOString();
        const review = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          decision,
          comment: String(payload.comment || "").trim(),
          evidence: Array.isArray(payload.evidence) ? payload.evidence.map((item) => String(item).trim()).filter(Boolean) : []
        };
        const status = decision === "approved" ? "review_passed" : "returned";
        cases[index] = {
          ...cases[index],
          status,
          reviewedAt: now,
          reviewedBy: user.username || user.role,
          reviewTrail: [review, ...(cases[index].reviewTrail || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "clinical-pathway-review", note: `${decision}: ${review.comment}` }, ...(cases[index].auditTrail || [])].slice(0, 50)
        };
        data.clinicalPathwayCases = cases;
        data.qualitySafetyEvents = (Array.isArray(data.qualitySafetyEvents) ? data.qualitySafetyEvents : []).map((item) => item.id === cases[index].eventId ? {
          ...item,
          status: decision === "approved" ? "closed" : "returned",
          reviewedAt: now,
          reviewedBy: user.username || user.role,
          auditTrail: [{ at: now, by: user.username || user.role, action: "clinical-pathway-review", note: `${decision}: ${review.comment}` }, ...(item.auditTrail || [])].slice(0, 50)
        } : item);
        appendQualitySafetyAudit(data, user, "quality-safety clinical pathway review", id, `${decision}: ${review.comment}`);
        writeDatabase(data);
        sendJson(res, 200, { ...cases[index], normalizedStatus: normalizeQualitySafetyStatus(cases[index].status), reviewComplete: normalizeQualitySafetyStatus(cases[index].status) === "closed" });
        return true;
      }

      const qualitySiteSignoffEvidenceMatch = url.pathname.match(/^\/api\/quality-safety\/site-signoffs\/([^/]+)\/evidence$/);
      if (req.method === "POST" && qualitySiteSignoffEvidenceMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/site-signoffs/:id/evidence");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualitySiteSignoffEvidenceMatch[1]);
        const signoffs = Array.isArray(data.qualitySafetySiteSignoffs) ? data.qualitySafetySiteSignoffs : [];
        const index = signoffs.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality-safety site sign-off item not found" });
          return true;
        }
        const ownerRole = String(signoffs[index].ownerRole || "commission");
        if (user.role !== "commission" && ownerRole !== user.role) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "访问接口", target: "/api/quality-safety/site-signoffs/:id/evidence", result: "拒绝", detail: `site sign-off ${id} belongs to ${ownerRole}` });
          sendJson(res, 403, { error: "Forbidden", message: "Site sign-off evidence can only be submitted by the owner role or commission" });
          return true;
        }
        const payload = await collectJson(req);
        const evidence = Array.isArray(payload.evidence) ? payload.evidence.map((item) => String(item).trim()).filter(Boolean) : [];
        const note = String(payload.note || payload.comment || "").trim();
        if (evidence.length === 0 && !note) {
          sendJson(res, 400, { error: "Bad Request", message: "evidence or note is required" });
          return true;
        }
        const now = new Date().toISOString();
        const submission = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          ownerRole,
          note,
          evidence
        };
        signoffs[index] = {
          ...signoffs[index],
          status: "evidence_submitted",
          latestNote: note || signoffs[index].latestNote,
          submittedAt: now,
          submittedBy: user.username || user.role,
          evidence: [...evidence, ...(signoffs[index].evidence || [])].slice(0, 50),
          submissionTrail: [submission, ...(signoffs[index].submissionTrail || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "site-signoff-evidence", note: note || evidence.join(", ") }, ...(signoffs[index].auditTrail || [])].slice(0, 50)
        };
        data.qualitySafetySiteSignoffs = signoffs;
        appendQualitySafetyAudit(data, user, "quality-safety site signoff evidence", id, note || evidence.join(", "));
        writeDatabase(data);
        sendJson(res, 200, { ...signoffs[index], normalizedStatus: normalizeQualitySafetyStatus(signoffs[index].status), evidenceCount: (signoffs[index].evidence || []).length });
        return true;
      }

      const qualityCoreSystemEvidenceMatch = url.pathname.match(/^\/api\/quality-safety\/core-systems\/([^/]+)\/evidence$/);
      if (req.method === "POST" && qualityCoreSystemEvidenceMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/core-systems/:id/evidence");
        if (!user) return true;
        const data = readDatabase();
        const coreSystemId = decodeURIComponent(qualityCoreSystemEvidenceMatch[1]);
        const matrix = buildQualitySafetyCoreSystemMatrix(data);
        const row = matrix.find((item) => item.id === coreSystemId);
        if (!row) {
          sendJson(res, 404, { error: "Not Found", message: "Core safety system item not found" });
          return true;
        }
        const payload = await collectJson(req);
        const evidence = Array.isArray(payload.evidence) ? payload.evidence.map((item) => String(item).trim()).filter(Boolean) : [];
        const note = String(payload.note || payload.comment || "").trim();
        if (!note && evidence.length === 0) {
          sendJson(res, 400, { error: "Bad Request", message: "evidence or note is required" });
          return true;
        }
        const now = new Date().toISOString();
        const submission = {
          id: randomUUID(),
          coreSystemId,
          coreSystemName: row.name,
          at: now,
          by: user.username || user.role,
          byName: user.name,
          role: user.role,
          orgCode: user.orgCode || "",
          orgName: user.orgName || "",
          note,
          evidence
        };
        data.qualitySafetyCoreSystemEvidence = [submission, ...(Array.isArray(data.qualitySafetyCoreSystemEvidence) ? data.qualitySafetyCoreSystemEvidence : [])].slice(0, 300);
        appendQualitySafetyAudit(data, user, "quality-safety core system evidence", coreSystemId, note || evidence.join(", "));
        writeDatabase(data);
        const updated = buildQualitySafetyCoreSystemMatrix(data).find((item) => item.id === coreSystemId);
        sendJson(res, 200, updated);
        return true;
      }

      const qualitySiteSignoffMatch = url.pathname.match(/^\/api\/quality-safety\/site-signoffs\/([^/]+)\/review$/);
      if (req.method === "POST" && qualitySiteSignoffMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/site-signoffs/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualitySiteSignoffMatch[1]);
        const signoffs = Array.isArray(data.qualitySafetySiteSignoffs) ? data.qualitySafetySiteSignoffs : [];
        const index = signoffs.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality-safety site sign-off item not found" });
          return true;
        }
        const payload = await collectJson(req);
        const decision = String(payload.decision || payload.status || "ready_for_joint_test").trim();
        if (!["ready_for_joint_test", "accepted", "returned", "pending_site_confirmation"].includes(decision)) {
          sendJson(res, 400, { error: "Bad Request", message: "decision must be ready_for_joint_test, accepted, returned, or pending_site_confirmation" });
          return true;
        }
        const now = new Date().toISOString();
        const review = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          decision,
          note: String(payload.note || payload.comment || "").trim(),
          evidence: Array.isArray(payload.evidence) ? payload.evidence.map((item) => String(item).trim()).filter(Boolean) : []
        };
        signoffs[index] = {
          ...signoffs[index],
          status: decision,
          latestNote: review.note || signoffs[index].latestNote,
          reviewedAt: now,
          reviewedBy: user.username || user.role,
          evidence: [...review.evidence, ...(signoffs[index].evidence || [])].slice(0, 50),
          reviewTrail: [review, ...(signoffs[index].reviewTrail || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "site-signoff-review", note: `${decision}: ${review.note}` }, ...(signoffs[index].auditTrail || [])].slice(0, 50)
        };
        data.qualitySafetySiteSignoffs = signoffs;
        appendQualitySafetyAudit(data, user, "quality-safety site signoff review", id, `${decision}: ${review.note}`);
        writeDatabase(data);
        sendJson(res, 200, { ...signoffs[index], normalizedStatus: normalizeQualitySafetyStatus(signoffs[index].status), evidenceCount: (signoffs[index].evidence || []).length });
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-05", SUBDOMAIN: "quality-safety" };
