"use strict";

const {
  buildFleetStatus,
  probeRegion
} = require("../../platform/regional/multi-region-operations");
const {
  buildRegionalCutoverDossier
} = require("../../platform/regional/regional-cutover-dossier");
const {
  buildRegionalCutoverWorkbench
} = require("../../platform/regional/regional-cutover-workbench");
const {
  buildRegionalPilotReadiness
} = require("../../platform/regional/regional-pilot-program");

function createRouteSegments({
  appendSecurityEvent,
  environment = process.env,
  readDatabase,
  regionalContext,
  requireApiRole,
  sendJson,
  writeDatabase
}) {
  if (!regionalContext || regionalContext.schemaVersion !== "regional-public-context-v1") {
    throw new TypeError("regional route requires a public regional context");
  }
  if (typeof sendJson !== "function") throw new TypeError("regional route requires sendJson");
  if (typeof requireApiRole !== "function") throw new TypeError("regional route requires requireApiRole");
  if (typeof readDatabase !== "function" || typeof writeDatabase !== "function") {
    throw new TypeError("regional route requires database access");
  }
  if (typeof appendSecurityEvent !== "function") throw new TypeError("regional route requires security audit");
  return [{
    id: "regional-01",
    domain: "regional",
    async handle(req, res, url) {
      if (req.method !== "GET" || url.pathname !== "/api/regional/context") return false;
      sendJson(res, 200, regionalContext);
      return true;
    }
  }, {
    id: "regional-02",
    domain: "regional",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/regional/pilot-program") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const report = buildRegionalPilotReadiness({
          env: environment,
          receipts: data.regionalDeploymentProbeReceipts
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "regional-pilot-program-read",
          target: report.program.programId,
          result: "allowed",
          detail: `local=${report.localFoundationReady}; site=${report.siteReady}; production gate closed`
        });
        sendJson(res, 200, report);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/regional/cutover-workbench") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const workbench = buildRegionalCutoverWorkbench({
          env: environment,
          receipts: data.regionalDeploymentProbeReceipts
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "regional-cutover-workbench-read",
          target: url.pathname,
          result: "allowed",
          detail: `${workbench.summary.regions} regions; ${workbench.summary.blocked} blocked; production gate closed`
        });
        sendJson(res, 200, workbench);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/regional/deployments") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const fleet = buildFleetStatus({
          env: environment,
          receipts: data.regionalDeploymentProbeReceipts
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "regional-deployment-fleet-read",
          target: url.pathname,
          result: "allowed",
          detail: `${fleet.summary.sites} sites; ${fleet.summary.drift} drift; production gate closed`
        });
        sendJson(res, 200, fleet);
        return true;
      }

      const dossierMatch = url.pathname.match(/^\/api\/regional\/deployments\/([^/]+)\/dossier$/);
      if (req.method === "GET" && dossierMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/regional/deployments/:regionCode/dossier");
        if (!user) return true;
        const regionCode = dossierMatch[1];
        if (url.search || !/^\d{6}$/.test(regionCode)) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "regional-cutover-dossier-read",
            target: regionCode,
            result: "denied",
            detail: "REGIONAL_DOSSIER_CLIENT_INPUT_REJECTED"
          });
          sendJson(res, 400, {
            error: "Bad Request",
            code: "REGIONAL_DOSSIER_CLIENT_INPUT_REJECTED",
            message: "regional dossier accepts only a registered region code",
            productionReady: false
          });
          return true;
        }
        try {
          const data = readDatabase();
          const dossier = buildRegionalCutoverDossier({
            env: environment,
            receipts: data.regionalDeploymentProbeReceipts,
            regionCode
          });
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "regional-cutover-dossier-read",
            target: regionCode,
            result: "allowed",
            detail: `${dossier.release.governanceState}; ${dossier.operations.status}; candidate=${dossier.candidateReady}; production gate closed`
          });
          sendJson(res, 200, dossier);
        } catch {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "regional-cutover-dossier-read",
            target: regionCode,
            result: "denied",
            detail: "REGIONAL_DOSSIER_NOT_AVAILABLE"
          });
          sendJson(res, 404, {
            error: "Not Found",
            code: "REGIONAL_DOSSIER_NOT_AVAILABLE",
            message: "regional cutover dossier is not available",
            productionReady: false
          });
        }
        return true;
      }

      const probeMatch = url.pathname.match(/^\/api\/regional\/deployments\/([^/]+)\/probes$/);
      if (req.method === "POST" && probeMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/regional/deployments/:regionCode/probes");
        if (!user) return true;
        const hasRequestBody = Number(req.headers?.["content-length"] || 0) > 0 || Boolean(req.headers?.["transfer-encoding"]);
        if (hasRequestBody || url.search) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "regional-deployment-probe",
            target: probeMatch[1],
            result: "denied",
            detail: "REGIONAL_PROBE_CLIENT_INPUT_REJECTED"
          });
          sendJson(res, 400, {
            error: "Bad Request",
            code: "REGIONAL_PROBE_CLIENT_INPUT_REJECTED",
            message: "regional probe accepts only the server-configured target",
            productionReady: false
          });
          return true;
        }
        const regionCode = probeMatch[1];
        try {
          const result = await probeRegion({ env: environment, regionCode });
          const data = readDatabase();
          data.regionalDeploymentProbeReceipts = [
            result.receipt,
            ...(Array.isArray(data.regionalDeploymentProbeReceipts) ? data.regionalDeploymentProbeReceipts : [])
          ].slice(0, 200);
          writeDatabase(data);
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "regional-deployment-probe",
            target: regionCode,
            result: result.site.status === "drift" ? "degraded" : "allowed",
            detail: `${result.site.status}; ${result.site.blockers.join(",") || "no-local-blockers"}; production gate closed`
          });
          sendJson(res, 200, {
            ...result,
            fleet: buildFleetStatus({
              env: environment,
              receipts: data.regionalDeploymentProbeReceipts,
              now: result.receipt.checkedAt
            })
          });
        } catch (error) {
          const code = String(error?.code || "REGIONAL_PROBE_FAILED").slice(0, 120);
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "regional-deployment-probe",
            target: regionCode,
            result: "denied",
            detail: code
          });
          sendJson(res, 409, {
            error: "Conflict",
            code,
            message: "regional deployment probe was rejected",
            productionReady: false
          });
        }
        return true;
      }
      return false;
    }
  }];
}

module.exports = { createRouteSegments };
