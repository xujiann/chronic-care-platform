"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-06";
const SUBDOMAIN = "production-operations";

function createRouteSegment(runtime) {
  const { appendSecurityEvent, buildProductionReleaseEvidencePublicSummary, buildProductionSecurityAcceptanceCenter, buildRuntimeProductionGoNoGoCenter, collectJson, normalizeProductionGoNoGoApprovalAction, normalizeProductionGoNoGoDecision, normalizeProductionSecurityFindingAction, normalizeProductionSecurityReleaseApprovalAction, normalizeState, operationalControlPlaneReadiness, pilotCutoverControlPlaneReadiness, productionAdapterRuntimeReadiness, randomUUID, readDatabase, requireApiRole, sendJson, shadowRelayControlPlaneReadiness, writeDatabase } = runtime;
  return {
      id: "platform-governance-06",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/production-adapters/runtime") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const report = await productionAdapterRuntimeReadiness();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "production-adapter-runtime-read",
          target: url.pathname,
          result: "allowed",
          detail: `${report.mode || "blocked"}; workersEligible=${report.workersEligible === true}; production gate closed`
        });
        sendJson(res, 200, report);
        return true;
      }

    if (req.method === "GET" && url.pathname === "/api/production-adapters/shadow-relay") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const report = await shadowRelayControlPlaneReadiness();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "shadow-relay-control-plane-read",
          target: url.pathname,
          result: "allowed",
          detail: `${report.ok === true ? "verified" : "blocked"}; receipts=${Number(report.receipts) || 0}; production gate closed`
        });
        sendJson(res, 200, report);
        return true;
      }

    if (req.method === "GET" && url.pathname === "/api/production-adapters/operational-control") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const report = await operationalControlPlaneReadiness();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "operational-control-plane-read",
          target: url.pathname,
          result: "allowed",
          detail: `${report.operationalReady === true ? "verified" : "blocked"}; local=${report.localReady === true}; external=${report.externalReady === true}; production gate closed`
        });
        sendJson(res, 200, report);
        return true;
      }

    if (req.method === "GET" && url.pathname === "/api/production-adapters/pilot-cutover") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const report = await pilotCutoverControlPlaneReadiness();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "pilot-cutover-control-plane-read",
          target: url.pathname,
          result: "allowed",
          detail: `${report.decision === "GO-CANDIDATE" ? "candidate" : "blocked"}; execution=false; production gate closed`
        });
        sendJson(res, 200, report);
        return true;
      }

    if (req.method === "GET" && url.pathname === "/api/production-go-no-go/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-go-no-go/center");
        if (!user) return true;
        sendJson(res, 200, buildRuntimeProductionGoNoGoCenter(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-release/evidence-readiness") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const summary = buildProductionReleaseEvidencePublicSummary();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "production-release-evidence-readiness-read",
          target: url.pathname,
          result: "allowed",
          detail: `${summary.summary.present}/${summary.summary.documents} documents; ${summary.status}; production gate closed`
        });
        sendJson(res, 200, summary);
        return true;
      }

      const productionGoNoGoApprovalMatch = url.pathname.match(/^\/api\/production-go-no-go\/approvals\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionGoNoGoApprovalMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-go-no-go/approvals/:id/actions");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const approvalId = decodeURIComponent(productionGoNoGoApprovalMatch[1]);
        const index = data.productionGoNoGoApprovals.findIndex((item) => item.id === approvalId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production go/no-go approval not found" });
          return true;
        }
        const payload = await collectJson(req);
        const currentCenter = buildRuntimeProductionGoNoGoCenter(data);
        try {
          data.productionGoNoGoApprovals[index] = normalizeProductionGoNoGoApprovalAction(data.productionGoNoGoApprovals[index], payload, user, currentCenter);
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
          return true;
        }
        const center = buildRuntimeProductionGoNoGoCenter(data);
        data.securityEvents = [{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "production-go-no-go-approval", target: approvalId, result: "allowed",
          detail: `${payload.action || "unknown"}:${data.productionGoNoGoApprovals[index].status}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, approval: data.productionGoNoGoApprovals[index], center });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/production-go-no-go/decision") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-go-no-go/decision");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const payload = await collectJson(req);
        const currentCenter = buildRuntimeProductionGoNoGoCenter(data);
        try {
          data.productionGoNoGoDecision = normalizeProductionGoNoGoDecision(payload, user, currentCenter);
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
          return true;
        }
        const center = buildRuntimeProductionGoNoGoCenter(data);
        data.securityEvents = [{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "production-go-no-go-decision", target: data.productionGoNoGoDecision.id, result: "allowed",
          detail: `${data.productionGoNoGoDecision.decision}:${data.productionGoNoGoDecision.changeTicket}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, decision: data.productionGoNoGoDecision, center });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-security/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-security/center");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const center = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        sendJson(res, 200, center);
        return true;
      }

      const productionSecurityFindingActionMatch = url.pathname.match(/^\/api\/production-security\/findings\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionSecurityFindingActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-security/findings/:id/actions");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const findingId = decodeURIComponent(productionSecurityFindingActionMatch[1]);
        const index = data.productionSecurityFindings.findIndex((item) => item.id === findingId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production security finding not found" });
          return true;
        }
        const payload = await collectJson(req);
        try {
          data.productionSecurityFindings[index] = normalizeProductionSecurityFindingAction(data.productionSecurityFindings[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        let center = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        if (!center.summary.releaseEligible) {
          data.productionSecurityReleaseApprovals = data.productionSecurityReleaseApprovals.map((item) => item.status === "approved"
            ? { ...item, status: "pending", invalidatedAt: new Date().toISOString(), invalidatedByFindingId: findingId }
            : item);
          center = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        }
        data.securityEvents = [{
          id: randomUUID(),
          at: new Date().toISOString(),
          actor: user.name,
          role: user.role,
          action: "production-security-finding-action",
          target: findingId,
          result: "allowed",
          detail: `${payload.action || "unknown"}:${data.productionSecurityFindings[index].status}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, finding: data.productionSecurityFindings[index], center });
        return true;
      }

      const productionSecurityApprovalActionMatch = url.pathname.match(/^\/api\/production-security\/release-approvals\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionSecurityApprovalActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-security/release-approvals/:id/actions");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const approvalId = decodeURIComponent(productionSecurityApprovalActionMatch[1]);
        const index = data.productionSecurityReleaseApprovals.findIndex((item) => item.id === approvalId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production security release approval not found" });
          return true;
        }
        const payload = await collectJson(req);
        const currentCenter = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        try {
          data.productionSecurityReleaseApprovals[index] = normalizeProductionSecurityReleaseApprovalAction(
            data.productionSecurityReleaseApprovals[index], payload, user, currentCenter
          );
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
          return true;
        }
        const center = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        data.securityEvents = [{
          id: randomUUID(),
          at: new Date().toISOString(),
          actor: user.name,
          role: user.role,
          action: "production-security-release-opinion",
          target: approvalId,
          result: "allowed",
          detail: `${payload.action || "unknown"}:${data.productionSecurityReleaseApprovals[index].status}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, approval: data.productionSecurityReleaseApprovals[index], center });
        return true;
      }
        return false;
      }
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
