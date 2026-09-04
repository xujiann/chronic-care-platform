"use strict";

const RegionalClinicalDocuments = require("../../../platform/integration/regional-clinical-document-service");

function createHandler(runtime) {
  const { appendSecurityEvent, readDatabase, requireApiRole, sendJson } = runtime;
  return async function handleRegionalClinicalDocuments(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/integration/clinical-documents/center") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/integration/clinical-documents/center");
        if (!user) return true;
        try {
          const center = RegionalClinicalDocuments.buildRegionalClinicalDocumentCenter(readDatabase(), user);
          appendSecurityEvent({
            actor: user.name || user.username,
            role: user.role,
            action: "regional clinical document center read",
            target: center.scope.organizationCode,
            result: "allowed",
            detail: `${center.summary.documents} documents / ${center.summary.exceptions} exceptions`
          });
          sendJson(res, 200, center);
        } catch (error) {
          const known = error instanceof RegionalClinicalDocuments.RegionalClinicalDocumentError;
          appendSecurityEvent({
            actor: user.name || user.username,
            role: user.role,
            action: "regional clinical document center read",
            target: String(user.orgCode || "unbound").slice(0, 120),
            result: "denied",
            detail: known ? error.code : "REGIONAL_CLINICAL_DOCUMENT_CENTER_FAILED"
          });
          sendJson(res, known ? error.statusCode : 503, {
            ok: false,
            code: known ? error.code : "REGIONAL_CLINICAL_DOCUMENT_CENTER_FAILED",
            message: known ? error.message : "regional clinical document center is temporarily unavailable",
            productionReady: false
          });
        }
        return true;
      }
      return false;
  };
}

function createRouteSegments(runtime) {
  return [{
    id: "integration-clinical-documents-01",
    domain: "integration",
    handle: createHandler(runtime)
  }];
}

module.exports = { createHandler, createRouteSegments };
