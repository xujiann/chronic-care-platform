"use strict";

const {
  createPhysicalExaminationDashboardQuery
} = require("../../../clinical-specialties/physical-examination/dashboard-query");
const {
  createPhysicalExaminationSpecializedIntakeActionCommand
} = require("../../../clinical-specialties/physical-examination/specialized-intake-action-command");

function createRouteSegment(runtime) {
  const { BloodEventHub, BloodGoLiveService, BloodInnovationService, PhysicalExaminationService, allowedResidentIdsForUser, appendDataAccessLog, appendSecurityEvent, buildPhysicalExamProductionReadiness, canAccessResident, canAccessSecureAttachment, collectJson, isProductionRuntime, normalizeState, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, rowMatchesOrganizationScope, sendJson, writeDatabase } = runtime;
  return {
      id: "clinical-specialties-10",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/blood-system/innovation") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/innovation");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, { ...BloodInnovationService.dashboard(data, user, url.searchParams.get("code") || ""), eventHub: BloodEventHub.dashboard(data, user), goLive: BloodGoLiveService.center(data) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/blood-system/events") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/events");
        if (!user) return true;
        sendJson(res, 200, BloodEventHub.dashboard(readDatabase(), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/blood-system/go-live") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/go-live"); if (!user) return true;
        sendJson(res, 200, BloodGoLiveService.center(readDatabase())); return true;
      }

      const bloodGoLiveActionMatch = url.pathname.match(/^\/api\/blood-system\/go-live\/(endpoints|requirements|drills|migrations|approvals)\/([^/]+)\/(probe|actions|complete|reconcile|sign)$/);
      if (req.method === "POST" && bloodGoLiveActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/blood-system/go-live/actions"); if (!user) return true;
        const data = readDatabase(), payload = await collectJson(req), [,resource,id] = bloodGoLiveActionMatch;
        try {
          const fn = { endpoints: BloodGoLiveService.probe, requirements: BloodGoLiveService.signRequirement, drills: BloodGoLiveService.completeDrill, migrations: BloodGoLiveService.reconcileMigration, approvals: BloodGoLiveService.signApproval }[resource];
          const item = fn(data, user, decodeURIComponent(id), payload); writeDatabase(data); sendJson(res, 200, { ok:true, item, center:BloodGoLiveService.center(data) });
        } catch (error) { sendJson(res, error.status || 400, { error:error.status===404?"Not Found":"Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/blood-system/events/publish") {
        const user = requireApiRole(req, res, ["commission"], "/api/blood-system/events/publish");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const result = BloodEventHub.publish(data, user, { correlationId: payload.correlationId || "", failConsumer: payload.failConsumer || "" });
        writeDatabase(data);
        sendJson(res, 200, { ...result, dashboard: BloodEventHub.dashboard(data, user) });
        return true;
      }

      const bloodEventRetryMatch = url.pathname.match(/^\/api\/blood-system\/events\/deliveries\/([^/]+)\/retry$/);
      if (req.method === "POST" && bloodEventRetryMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/blood-system/events/deliveries/:id/retry");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodEventHub.retry(data, user, decodeURIComponent(bloodEventRetryMatch[1]));
        if (result.status < 500) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      const bloodInnovationMatch = url.pathname.match(/^\/api\/blood-system\/innovation\/([^/]+)\/execute$/);
      if (req.method === "POST" && bloodInnovationMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/innovation/actions");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodInnovationService.execute(data, user, decodeURIComponent(bloodInnovationMatch[1]), await collectJson(req));
        if (result.status < 500) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/physical-exams") {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/physical-exams");
        if (!user) return true;
        const data = readDatabase();
        const residentId = String(url.searchParams.get("residentId") || "").trim();
        const allowedResidentIds = allowedResidentIdsForUser(data, user);
        if (residentId && !allowedResidentIds.has(residentId)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "查看体检报告", target: residentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权查看该居民体检报告" });
          return true;
        }
        const physicalExaminationDashboardQuery = createPhysicalExaminationDashboardQuery({
          buildPhysicalExamOverview: PhysicalExaminationService.buildOverview,
          buildPhysicalExamReadiness: buildPhysicalExamProductionReadiness
        });
        const overview = physicalExaminationDashboardQuery.execute({
          data,
          user,
          residentId,
          residentIds: [...allowedResidentIds],
          excludeDemoData: isProductionRuntime()
        });
        if (residentId) {
          appendDataAccessLog(data, user, residentId, "历史体检报告", "同步查看居民健康档案中的体检报告");
          writeDatabase(data);
        }
        sendJson(res, 200, redactSensitiveResponse(overview, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/physical-exams/highlights/actions") {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/physical-exams/highlights/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const residentId = String(payload.residentId || "").trim();
        try {
          const result = PhysicalExaminationService.applyHighlightAction(data, payload, {
            id: `pe-highlight-${randomUUID()}`,
            actor: user.username || user.role,
            now: new Date().toISOString(),
            canAccessResident: (targetResidentId) => canAccessResident(user, targetResidentId, data)
          });
          appendDataAccessLog(data, user, residentId, "体检创新服务", `${payload.action} · ${result.type}`);
          data.securityEvents = [{ id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "体检创新服务", target: residentId, result: "允许", detail: `${payload.action} · ${result.type}` }, ...(data.securityEvents || [])].slice(0, 120);
          writeDatabase(normalizeState(data));
          const overview = PhysicalExaminationService.buildOverview(data, { residentId, residentIds: [...allowedResidentIdsForUser(data, user)], excludeDemoData: isProductionRuntime() });
          sendJson(res, 200, redactSensitiveResponse({ ok: true, result, highlights: overview.highlights }, user));
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          appendSecurityEvent({ actor: user.name, role: user.role, action: "体检创新服务", target: residentId || "unknown", result: "拒绝", detail: error.message });
          sendJson(res, status, { error: status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const physicalExamCaseActionMatch = url.pathname.match(/^\/api\/physical-exams\/abnormal-cases\/([^/]+)\/actions$/);
      if (req.method === "POST" && physicalExamCaseActionMatch) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/abnormal-cases/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const caseId = decodeURIComponent(physicalExamCaseActionMatch[1]);
        const current = (data.physicalExamAbnormalCases || []).find((item) => item.id === caseId);
        if (!current) {
          sendJson(res, 404, { error: "Not Found", message: "未找到体检异常处置记录" });
          return true;
        }
        if (!canAccessResident(user, current.residentId, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权处置该居民体检异常" });
          return true;
        }
        try {
          const abnormalCase = PhysicalExaminationService.applyAbnormalCaseAction(data, caseId, payload, { actor: user.username || user.role });
          if (String(payload.action || "").toLowerCase() === "notify") {
            data.taskMessages = [{
              id: `msg-${randomUUID()}`,
              taskId: `physicalExamAbnormalCases:${abnormalCase.id}`,
              collection: "physicalExamAbnormalCases",
              sourceId: abnormalCase.id,
              residentId: abnormalCase.residentId,
              targetRole: "citizen",
              channel: "in_app",
              notificationEvent: "physical-exam-abnormal-notice",
              deliveryChannels: ["in_app", "sms"],
              title: "体检异常项目随访提醒",
              body: abnormalCase.latestAction,
              status: "sent",
              receipts: [{ at: new Date().toISOString(), status: "delivered", channel: "in_app" }],
              createdAt: new Date().toISOString(),
              createdBy: user.username || user.role,
              createdByName: user.name
            }, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
          }
          appendDataAccessLog(data, user, abnormalCase.residentId, "体检异常闭环", `${payload.action} · ${abnormalCase.latestAction}`);
          data.securityEvents = [{ id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "体检异常处置", target: caseId, result: "允许", detail: `${payload.action} · ${abnormalCase.status}` }, ...(data.securityEvents || [])].slice(0, 120);
          writeDatabase(normalizeState(data));
          const overview = PhysicalExaminationService.buildOverview(data, { residentIds: [...allowedResidentIdsForUser(data, user)], excludeDemoData: isProductionRuntime() });
          sendJson(res, 200, { abnormalCase, overview });
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          sendJson(res, status, { error: status === 409 ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      const physicalExamSpecializedActionMatch = url.pathname.match(/^\/api\/physical-exams\/specialized-intakes\/([^/]+)\/actions$/);
      if (req.method === "POST" && physicalExamSpecializedActionMatch) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/specialized-intakes/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const intakeId = decodeURIComponent(physicalExamSpecializedActionMatch[1]);
        const current = (data.physicalExamSpecializedIntakes || []).find((item) => item.id === intakeId);
        if (current && !canAccessResident(user, current.residentId, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权处置该专项体检分流记录" });
          return true;
        }
        try {
          const physicalExaminationSpecializedIntakeActionCommand = createPhysicalExaminationSpecializedIntakeActionCommand({
            applySpecializedIntakeAction: (...args) => PhysicalExaminationService.applySpecializedIntakeAction(...args),
            appendDataAccessLog,
            appendSecurityEvent,
            normalizeState,
            now: () => new Date().toISOString(),
            writeDatabase
          });
          const intake = physicalExaminationSpecializedIntakeActionCommand.execute({ data, intakeId, payload, user });
          sendJson(res, 200, { ok: true, intake });
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          sendJson(res, status, { error: status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      const physicalExamJointTestActionMatch = url.pathname.match(/^\/api\/physical-exams\/joint-tests\/([^/]+)\/actions$/);
      if (req.method === "POST" && physicalExamJointTestActionMatch) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/joint-tests/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const jointTestId = decodeURIComponent(physicalExamJointTestActionMatch[1]);
        const current = (data.physicalExamJointTests || []).find((item) => item.id === jointTestId);
        if (!current) {
          sendJson(res, 404, { error: "Not Found", message: "未找到体检机构联调记录" });
          return true;
        }
        if (user.role === "institution" && !rowMatchesOrganizationScope(data, user, current)) {
          sendJson(res, 403, { error: "Forbidden", message: "只能维护本机构的现场联调记录" });
          return true;
        }
        try {
          const jointTest = PhysicalExaminationService.applyJointTestAction(data, jointTestId, payload, { actor: user.username || user.role, role: user.role });
          data.securityEvents = [{ id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "体检机构联调验收", target: jointTestId, result: "允许", detail: `${payload.action} · ${payload.evidenceRef || ""}` }, ...(data.securityEvents || [])].slice(0, 120);
          writeDatabase(normalizeState(data));
          const overview = PhysicalExaminationService.buildOverview(data, { residentIds: [...allowedResidentIdsForUser(data, user)], excludeDemoData: isProductionRuntime() });
          sendJson(res, 200, { jointTest, readiness: buildPhysicalExamProductionReadiness(data, overview) });
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          sendJson(res, status, { error: status === 409 ? "Conflict" : status === 404 ? "Not Found" : "Bad Request", message: error.message });
        }
        return true;
      }

      const physicalExamAttachmentMatch = url.pathname.match(/^\/api\/physical-exams\/([^/]+)\/link-attachment$/);
      if (req.method === "POST" && physicalExamAttachmentMatch) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/:id/link-attachment");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const reportId = decodeURIComponent(physicalExamAttachmentMatch[1]);
        const report = (data.personalRecords || []).find((item) => item.id === reportId);
        const attachment = (data.secureAttachments || []).find((item) => item.id === String(payload.attachmentId || ""));
        if (!report || !PhysicalExaminationService.isPhysicalExamRecord(report)) {
          sendJson(res, 404, { error: "Not Found", message: "未找到体检报告" });
          return true;
        }
        if (!attachment) {
          sendJson(res, 404, { error: "Not Found", message: "未找到原报告安全附件" });
          return true;
        }
        if (!canAccessResident(user, report.residentId, data) || !canAccessSecureAttachment(user, attachment, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权关联该报告或附件" });
          return true;
        }
        try {
          PhysicalExaminationService.linkSecureAttachment(report, attachment, { actor: user.username || user.role });
          appendDataAccessLog(data, user, report.residentId, "体检原报告归档", `${report.id} · ${attachment.id}`);
          writeDatabase(normalizeState(data));
          sendJson(res, 200, { report, attachment: { id: attachment.id, filename: attachment.filename, status: attachment.status, scanStatus: attachment.scanStatus } });
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          sendJson(res, status, { error: status === 409 ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/physical-exams/import") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/import");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        try {
          const result = PhysicalExaminationService.ingest(data, payload, {
            actor: user.username || user.role,
            actorName: user.name,
            requireStandards: String(process.env.NODE_ENV || "").toLowerCase() === "production",
            canAccessResident: (residentId) => canAccessResident(user, residentId, data)
          });
          result.created.forEach((record) => {
            appendDataAccessLog(data, user, record.residentId, "体检报告接入", `${record.source} · ${record.meta?.reportNo || record.meta?.externalId}`);
          });
          result.routed.forEach((record) => {
            appendDataAccessLog(data, user, record.residentId, "专项体检自动分流", `${record.examProgramName} · ${record.externalId}`);
          });
          writeDatabase(normalizeState(data));
          sendJson(res, result.created.length || result.routed.length ? 201 : 200, redactSensitiveResponse({
            ok: true,
            imported: result.created.length,
            duplicates: result.duplicates.length,
            routed: result.routed.length,
            routedDuplicates: result.routedDuplicates.length,
            total: result.total,
            records: result.created,
            duplicateRecords: result.duplicates,
            specializedIntakes: result.routed,
            specializedDuplicateRecords: result.routedDuplicates
          }, user));
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          appendSecurityEvent({ actor: user.name, role: user.role, action: "导入体检报告", target: payload?.residentId || "batch", result: "拒绝", detail: error.message });
          sendJson(res, status, { error: status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-10", SUBDOMAIN: "blood-innovation" };
