"use strict";

const emergencySignalWrite = require("../t06-emergency-signal-write");

function createRouteSegment(runtime) {
  const { collectJson, prependAuditTrailEntry, readDatabase, requireApiRole, sendJson, writeDatabase } = runtime;
  return {
      id: "clinical-specialties-09",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/emergency-signals/")) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/emergency-signals/:id");
        if (!user) return true;
        let result;
        try {
          result = await emergencySignalWrite.updateEmergencySignal({
            id: decodeURIComponent(url.pathname.replace("/api/emergency-signals/", "")),
            payload: await collectJson(req),
            user,
            correlationId: req.correlationId || req.headers["x-correlation-id"],
            causationId: req.headers["idempotency-key"],
            readDatabase,
            writeDatabase,
            prependAuditTrailEntry
          });
        } catch (error) {
          if (!(error instanceof emergencySignalWrite.EmergencySignalCommandError)) throw error;
          sendJson(res, error.statusCode, {
            error: error.statusCode === 409 ? "Conflict" : "Internal Server Error",
            code: error.code,
            message: error.message
          });
          return true;
        }
        if (result.event) {
          res.setHeader("X-Data-Owner", emergencySignalWrite.DOMAIN);
          res.setHeader("X-Domain-Event-Id", result.event.id);
          res.setHeader("X-Domain-Event-Type", result.event.type);
        }
        res.setHeader("X-Idempotent-Replay", String(result.replayed === true));
        sendJson(res, result.status, {
          ...result.body,
          idempotentReplay: result.replayed === true
        });
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-09", SUBDOMAIN: "emergency-signals" };
