"use strict";

function createRouteSegment(runtime) {
  const { appendSecurityEvent, collectJson, normalizeDiagnosticReport, prependAuditTrailEntry, randomUUID, readDatabase, requireApiRole, sendJson, writeDatabase } = runtime;
  return {
      id: "clinical-specialties-07",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/mutual-recognition/reports") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/mutual-recognition/reports");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let normalized;
        try {
          normalized = normalizeDiagnosticReport(payload, user, data);
        } catch (error) {
          if (error.message === "forbidden resident scope") {
            appendSecurityEvent({ actor: user.name, role: user.role, action: "submit diagnostic report", target: payload.residentId || "", result: "denied", detail: "resident scope denied" });
            sendJson(res, 403, { error: "Forbidden", message: "无权回传该居民报告" });
            return true;
          }
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        data.diagnosticReports = [normalized.report, ...(Array.isArray(data.diagnosticReports) ? data.diagnosticReports : [])].slice(0, 300);
        data.countyMutualRecognitionRecords = [normalized.recognition, ...(Array.isArray(data.countyMutualRecognitionRecords) ? data.countyMutualRecognitionRecords : [])].slice(0, 300);
        data.personalRecords = [normalized.personalRecord, ...(Array.isArray(data.personalRecords) ? data.personalRecords : [])].slice(0, 500);
        if (normalized.criticalSignal) {
          data.emergencySignals = [normalized.criticalSignal, ...(Array.isArray(data.emergencySignals) ? data.emergencySignals : [])].slice(0, 200);
        }
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "submit diagnostic report",
          target: `${normalized.report.residentId}/${normalized.report.item}`,
          result: "allowed",
          detail: `${normalized.report.status} · ${normalized.report.ruleId || "no-rule"}${normalized.criticalSignal ? " · critical" : ""}`
        });
        writeDatabase(data);
        sendJson(res, 201, normalized);
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-07", SUBDOMAIN: "mutual-recognition-ingest" };
