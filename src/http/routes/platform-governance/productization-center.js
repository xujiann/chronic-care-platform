"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-11";
const SUBDOMAIN = "productization-center";

function createRouteSegment(runtime) {
  const { appendSecurityEvent, applyPlatformWorkItemAction, applyPlatformWorkItemV2GovernanceAction, buildPlatformEnhancementCockpit, buildPlatformProductOperationsCockpit, buildPlatformProductizationCenter, collectJson, readDatabase, registerInstitutionIntegrationProfile, requireApiRole, runInstitutionSyntheticJointTest, sendJson, writeDatabase } = runtime;
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
          detail: `${report.dataPromotion.summary.promotedP0} promoted P0; ${report.dataPromotion.summary.repositoryPlanReady} owner-reviewed repository plan-ready; ${report.dataPromotion.summary.firstReleaseMigrationPlans} persistent first-release plans; ${report.workItems.summary.open} open work items; ${report.regionalRequirements.summary.requirements} normalized regional requirements; production gate closed`
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

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
