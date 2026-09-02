"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-11";
const SUBDOMAIN = "productization-center";
const PROCUREMENT_REQUIREMENT_ERRORS = Object.freeze({
  PROCUREMENT_REQUIREMENT_IDEMPOTENCY_KEY_REQUIRED: Object.freeze([400, "Bad Request", "必须提供招标需求复核幂等键。"]),
  PROCUREMENT_REQUIREMENT_INPUT_INVALID: Object.freeze([400, "Bad Request", "招标需求复核请求无效。"]),
  PROCUREMENT_REQUIREMENT_SCOPE_FORBIDDEN: Object.freeze([403, "Forbidden", "当前身份不能复核招标需求。"]),
  PROCUREMENT_REQUIREMENT_NOT_FOUND: Object.freeze([404, "Not Found", "招标需求候选不存在。"]),
  PROCUREMENT_REQUIREMENT_COMMAND_CONFLICT: Object.freeze([409, "Conflict", "幂等键已用于不同的复核请求。"]),
  PROCUREMENT_REQUIREMENT_REPLAY_UNAVAILABLE: Object.freeze([409, "Conflict", "历史回执缺少精确结果快照，不能重放。"]),
  PROCUREMENT_REQUIREMENT_VERSION_CONFLICT: Object.freeze([409, "Conflict", "招标需求复核版本冲突。"]),
  PROCUREMENT_REQUIREMENT_TRANSITION_CONFLICT: Object.freeze([409, "Conflict", "当前状态不允许执行该复核动作。"]),
  PROCUREMENT_REQUIREMENT_CAPACITY_EXCEEDED: Object.freeze([409, "Conflict", "招标需求治理记录已达到受控容量上限。"]),
  PROCUREMENT_REQUIREMENT_AUDIT_FAILED: Object.freeze([500, "Internal Server Error", "招标需求复核审计记录失败。"]),
  PROCUREMENT_REQUIREMENT_STORAGE_FAILED: Object.freeze([500, "Internal Server Error", "招标需求复核保存失败。"]),
  PROCUREMENT_REQUIREMENT_COMMAND_FAILED: Object.freeze([500, "Internal Server Error", "招标需求复核执行失败。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_IDEMPOTENCY_KEY_REQUIRED: Object.freeze([400, "Bad Request", "必须提供受控导入登记幂等键。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_INPUT_INVALID: Object.freeze([400, "Bad Request", "受控导入登记请求无效。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_SCOPE_FORBIDDEN: Object.freeze([403, "Forbidden", "当前身份不能登记受控导入。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_COMMAND_CONFLICT: Object.freeze([409, "Conflict", "幂等键已用于不同的导入登记请求。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_REPLAY_UNAVAILABLE: Object.freeze([409, "Conflict", "历史导入回执缺少精确结果快照，不能重放。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_VERSION_CONFLICT: Object.freeze([409, "Conflict", "受控导入登记版本冲突。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_CAPACITY_EXCEEDED: Object.freeze([409, "Conflict", "受控导入登记已达到容量上限。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_AUDIT_FAILED: Object.freeze([500, "Internal Server Error", "受控导入登记审计失败。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_STORAGE_FAILED: Object.freeze([500, "Internal Server Error", "受控导入登记保存失败。"])
  ,PROCUREMENT_IMPORT_REGISTRATION_COMMAND_FAILED: Object.freeze([500, "Internal Server Error", "受控导入登记执行失败。"])
  ,PROCUREMENT_DELIVERY_IDEMPOTENCY_KEY_REQUIRED: Object.freeze([400, "Bad Request", "必须提供交付治理幂等键。"])
  ,PROCUREMENT_DELIVERY_INPUT_INVALID: Object.freeze([400, "Bad Request", "招标需求交付治理请求无效。"])
  ,PROCUREMENT_DELIVERY_SCOPE_FORBIDDEN: Object.freeze([403, "Forbidden", "当前身份不能治理交付。"])
  ,PROCUREMENT_DELIVERY_NOT_FOUND: Object.freeze([404, "Not Found", "已采纳招标需求不存在。"])
  ,PROCUREMENT_DELIVERY_EVIDENCE_NOT_FOUND: Object.freeze([404, "Not Found", "待核验仓库证据不存在。"])
  ,PROCUREMENT_DELIVERY_COMMAND_CONFLICT: Object.freeze([409, "Conflict", "幂等键已用于不同的交付治理请求。"])
  ,PROCUREMENT_DELIVERY_REPLAY_UNAVAILABLE: Object.freeze([409, "Conflict", "历史交付回执缺少精确结果快照，不能重放。"])
  ,PROCUREMENT_DELIVERY_VERSION_CONFLICT: Object.freeze([409, "Conflict", "招标需求交付治理版本冲突。"])
  ,PROCUREMENT_DELIVERY_TRANSITION_CONFLICT: Object.freeze([409, "Conflict", "当前状态不允许执行该交付治理动作。"])
  ,PROCUREMENT_DELIVERY_INDEPENDENCE_REQUIRED: Object.freeze([409, "Conflict", "证据提交人与核验人必须相互独立。"])
  ,PROCUREMENT_DELIVERY_ACCEPTANCE_INDEPENDENCE_REQUIRED: Object.freeze([409, "Conflict", "交付验收申请人与验收人必须相互独立。"])
  ,PROCUREMENT_DELIVERY_SOURCE_STALE: Object.freeze([409, "Conflict", "产品计划绑定的需求复核证据已经失效。"])
  ,PROCUREMENT_DELIVERY_CAPACITY_EXCEEDED: Object.freeze([409, "Conflict", "招标需求交付治理记录已达到容量上限。"])
  ,PROCUREMENT_DELIVERY_AUDIT_FAILED: Object.freeze([500, "Internal Server Error", "招标需求交付治理审计失败。"])
  ,PROCUREMENT_DELIVERY_STORAGE_FAILED: Object.freeze([500, "Internal Server Error", "招标需求交付治理保存失败。"])
  ,PROCUREMENT_DELIVERY_COMMAND_FAILED: Object.freeze([500, "Internal Server Error", "招标需求交付治理执行失败。"])
});

function sendProcurementRequirementError(sendJson, res, error, stage = "command", family = "PROCUREMENT_REQUIREMENT") {
  let code = stage === "input" ? `${family}_INPUT_INVALID` : stage === "command" ? error?.code : undefined;
  if (!PROCUREMENT_REQUIREMENT_ERRORS[code]) {
    if (error instanceof SyntaxError) code = `${family}_INPUT_INVALID`;
    else if (stage === "storage" && (error?.code === "STORAGE_CONFLICT" || error?.name === "StorageConflictError" || /optimistic lock conflict|version conflict|CAS conflict/i.test(String(error?.message || "")))) code = `${family}_VERSION_CONFLICT`;
    else if (stage === "audit") code = `${family}_AUDIT_FAILED`;
    else if (stage === "storage") code = `${family}_STORAGE_FAILED`;
    else code = `${family}_COMMAND_FAILED`;
  }
  const [statusCode, label, message] = PROCUREMENT_REQUIREMENT_ERRORS[code];
  sendJson(res, statusCode, { ok: false, error: label, code, message });
}

function createRouteSegment(runtime) {
  const { appendSecurityEvent, applyPlatformWorkItemAction, applyPlatformWorkItemV2GovernanceAction, applyProcurementImportRegistration, applyProcurementRequirementDeliveryAction, applyProcurementRequirementReviewAction, buildPlatformEnhancementCockpit, buildPlatformProductOperationsCockpit, buildPlatformProductizationCenter, collectJson, prependAuditTrailEntry, randomUUID, readDatabase, registerInstitutionIntegrationProfile, requireApiRole, runInstitutionSyntheticJointTest, sendJson, writeDatabase } = runtime;
  return {
    id: ROUTE_SEGMENT_ID,
    domain: "platform-governance",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/platform/productization/center") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const report = buildPlatformProductizationCenter(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "platform-productization-center-read",
          target: url.pathname,
          result: "allowed",
          detail: `${report.dataPromotion.summary.promotedP0} promoted P0; ${report.dataPromotion.summary.repositoryPlanReady} owner-reviewed repository plan-ready; ${report.dataPromotion.summary.firstReleaseMigrationPlans} persistent first-release plans; ${report.workItems.summary.open} open work items; ${report.regionalRequirements.summary.requirements} compatibility requirements; ${report.requirementGovernance.summary.candidates} procurement candidates; production gate closed`
        });
        sendJson(res, 200, report);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/productization/operations/cockpit") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const report = buildPlatformProductOperationsCockpit(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "platform-product-operations-cockpit-read",
          target: url.pathname,
          result: "allowed",
          detail: `${report.summary.projectedWorkItems} projected work items; ${report.summary.regionalSites} minimized regional sites; production gate closed`
        });
        sendJson(res, 200, report);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/productization/enhancements/cockpit") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const report = buildPlatformEnhancementCockpit(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "platform-enhancement-cockpit-read",
          target: url.pathname,
          result: "allowed",
          detail: `${report.summary.productIterations}/6 product iterations; ${report.summary.workItems} work items; production gate closed`
        });
        sendJson(res, 200, report);
        return true;
      }

      const workItemMatch = url.pathname.match(/^\/api\/platform\/productization\/work-items\/([^/]+)\/actions$/);
      if (req.method === "POST" && workItemMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/productization/work-items/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const execution = applyPlatformWorkItemAction(readDatabase(), {
          ...payload,
          itemId: decodeURIComponent(workItemMatch[1])
        });
        writeDatabase(execution.data);
        appendSecurityEvent({ actor: user.name, role: user.role, action: `platform-work-item-${payload.action}`, target: execution.result.id, result: "allowed", detail: `version=${execution.result.version}; replayed=${execution.replayed}` });
        sendJson(res, 200, { ok: true, replayed: execution.replayed, item: execution.result, productionReady: false });
        return true;
      }

      const requirementReviewMatch = url.pathname.match(/^\/api\/platform\/productization\/requirements\/([^/]+)\/actions$/);
      if (req.method === "POST" && requirementReviewMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/productization/requirements/:id/actions");
        if (!user) return true;
        const idempotencyKey = String(req.headers?.["idempotency-key"] || "").trim();
        if (!idempotencyKey) {
          sendProcurementRequirementError(sendJson, res, { code: "PROCUREMENT_REQUIREMENT_IDEMPOTENCY_KEY_REQUIRED" });
          return true;
        }
        const requirementId = decodeURIComponent(requirementReviewMatch[1]);
        let payload;
        try {
          payload = await collectJson(req);
        } catch (error) {
          sendProcurementRequirementError(sendJson, res, error, "input");
          return true;
        }
        let execution;
        try {
          execution = applyProcurementRequirementReviewAction(readDatabase(), {
            ...payload,
            commandId: idempotencyKey,
            requirementId
          }, user);
        } catch (error) {
          sendProcurementRequirementError(sendJson, res, error);
          return true;
        }
        if (!execution.replayed) {
          try {
            execution.data.securityEvents = prependAuditTrailEntry(execution.data.securityEvents, {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: `procurement-requirement-${payload.action}`,
              target: execution.result.id,
              result: "allowed",
              detail: `version=${execution.result.version}; source content omitted; production gate closed`
            });
          } catch (error) {
            sendProcurementRequirementError(sendJson, res, error, "audit");
            return true;
          }
          try {
            writeDatabase(execution.data);
          } catch (error) {
            sendProcurementRequirementError(sendJson, res, error, "storage");
            return true;
          }
        }
        sendJson(res, 200, { ok: true, replayed: execution.replayed, requirement: execution.result, productionReady: false });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/platform/productization/requirement-batches") {
        const family = "PROCUREMENT_IMPORT_REGISTRATION";
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const idempotencyKey = String(req.headers?.["idempotency-key"] || "").trim();
        if (!idempotencyKey) {
          sendProcurementRequirementError(sendJson, res, { code: `${family}_IDEMPOTENCY_KEY_REQUIRED` });
          return true;
        }
        let payload;
        try { payload = await collectJson(req); } catch (error) {
          sendProcurementRequirementError(sendJson, res, error, "input", family);
          return true;
        }
        let execution;
        try {
          execution = applyProcurementImportRegistration(readDatabase(), { ...payload, commandId: idempotencyKey }, user);
        } catch (error) {
          sendProcurementRequirementError(sendJson, res, error, "command", family);
          return true;
        }
        if (!execution.replayed) {
          try {
            execution.data.securityEvents = prependAuditTrailEntry(execution.data.securityEvents, { id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "procurement-import-batch-register", target: execution.result.artifactDigest, result: "allowed", detail: `documents=${execution.result.registeredDocuments}; candidates=${execution.result.registeredCandidates}; source content omitted; production gate closed` });
          } catch (error) {
            sendProcurementRequirementError(sendJson, res, error, "audit", family);
            return true;
          }
          try { writeDatabase(execution.data); } catch (error) {
            sendProcurementRequirementError(sendJson, res, error, "storage", family);
            return true;
          }
        }
        sendJson(res, 200, { ok: true, replayed: execution.replayed, registration: execution.result, productionReady: false });
        return true;
      }

      const requirementDeliveryMatch = url.pathname.match(/^\/api\/platform\/productization\/requirements\/([^/]+)\/lifecycle-actions$/);
      if (req.method === "POST" && requirementDeliveryMatch) {
        const family = "PROCUREMENT_DELIVERY";
        const user = requireApiRole(req, res, ["commission"], "/api/platform/productization/requirements/:id/lifecycle-actions");
        if (!user) return true;
        const idempotencyKey = String(req.headers?.["idempotency-key"] || "").trim();
        if (!idempotencyKey) {
          sendProcurementRequirementError(sendJson, res, { code: `${family}_IDEMPOTENCY_KEY_REQUIRED` });
          return true;
        }
        let payload;
        try { payload = await collectJson(req); } catch (error) {
          sendProcurementRequirementError(sendJson, res, error, "input", family);
          return true;
        }
        let execution;
        try {
          execution = applyProcurementRequirementDeliveryAction(readDatabase(), { ...payload, commandId: idempotencyKey, requirementId: decodeURIComponent(requirementDeliveryMatch[1]) }, user);
        } catch (error) {
          sendProcurementRequirementError(sendJson, res, error, "command", family);
          return true;
        }
        if (!execution.replayed) {
          try {
            execution.data.securityEvents = prependAuditTrailEntry(execution.data.securityEvents, { id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: `procurement-delivery-${payload.action}`, target: execution.result.requirementId, result: "allowed", detail: `version=${execution.result.version}; evidence content omitted; production gate closed` });
          } catch (error) {
            sendProcurementRequirementError(sendJson, res, error, "audit", family);
            return true;
          }
          try { writeDatabase(execution.data); } catch (error) {
            sendProcurementRequirementError(sendJson, res, error, "storage", family);
            return true;
          }
        }
        sendJson(res, 200, { ok: true, replayed: execution.replayed, delivery: execution.result, productionReady: false });
        return true;
      }

      const workItemV2Match = url.pathname.match(/^\/api\/platform\/productization\/work-items-v2\/([^/]+)\/actions$/);
      if (req.method === "POST" && workItemV2Match) {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/productization/work-items-v2/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const execution = applyPlatformWorkItemV2GovernanceAction(readDatabase(), {
          ...payload,
          itemId: decodeURIComponent(workItemV2Match[1])
        }, user);
        writeDatabase(execution.data);
        appendSecurityEvent({ actor: user.name, role: user.role, action: `platform-work-item-v2-${payload.action}`, target: execution.result.id, result: "allowed", detail: `version=${execution.result.version}; replayed=${execution.replayed}; production gate closed` });
        sendJson(res, 200, { ok: true, replayed: execution.replayed, item: execution.result, productionReady: false });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/platform/productization/institutions/profiles") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const payload = await collectJson(req);
        const execution = registerInstitutionIntegrationProfile(readDatabase(), payload);
        writeDatabase(execution.data);
        appendSecurityEvent({ actor: user.name, role: user.role, action: "institution-integration-profile-register", target: execution.result.profileId, result: "allowed", detail: `${execution.result.adapters.length} adapters; production gate closed` });
        sendJson(res, execution.replayed ? 200 : 201, { ok: true, replayed: execution.replayed, profile: execution.result, productionReady: false });
        return true;
      }

      const syntheticMatch = url.pathname.match(/^\/api\/platform\/productization\/institutions\/profiles\/([^/]+)\/synthetic-runs$/);
      if (req.method === "POST" && syntheticMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/productization/institutions/profiles/:id/synthetic-runs");
        if (!user) return true;
        const payload = await collectJson(req);
        const execution = runInstitutionSyntheticJointTest(readDatabase(), {
          ...payload,
          profileId: decodeURIComponent(syntheticMatch[1])
        });
        writeDatabase(execution.data);
        appendSecurityEvent({ actor: user.name, role: user.role, action: "institution-synthetic-joint-test", target: execution.result.runId, result: "allowed", detail: `${execution.result.scenarioCount} synthetic scenarios; site evidence pending` });
        sendJson(res, execution.replayed ? 200 : 201, { ok: true, replayed: execution.replayed, run: execution.result, profile: execution.profile, productionReady: false });
        return true;
      }

      return false;
    }
  };
}

module.exports = { PROCUREMENT_REQUIREMENT_ERRORS, ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment, sendProcurementRequirementError };
