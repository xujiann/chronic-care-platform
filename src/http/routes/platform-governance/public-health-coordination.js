"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-02";
const SUBDOMAIN = "public-health-coordination";

function createRouteSegment(runtime) {
  const { advanceDigitalHospitalPublicHealthIncident, appendSecurityEvent, authorizeDigitalHospitalPublicHealthHospital, buildDigitalHospitalPublicHealthBoard, collectJson, createDigitalHospitalPublicHealthIncident, digitalHospitalPublicHealthHospitalScope, escalateDigitalHospitalPublicHealthIncident, randomUUID, readDatabase, renderDigitalHospitalPublicHealthIncidentCsv, requireApiRole, reviewDigitalHospitalPublicHealthIncidentEvidence, sealAuditTrail, sendDownload, sendJson, submitDigitalHospitalPublicHealthIncidentEvidence, writeDatabase } = runtime;
  return {
      id: "platform-governance-02",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/digital-hospital/public-health/coordination") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/public-health/coordination");
        if (!user) return true;
        const data = readDatabase();
        const filters = Object.fromEntries(url.searchParams.entries());
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        if (!authorizeDigitalHospitalPublicHealthHospital(
          user,
          filters.hospitalCode,
          authorizedHospitalCodes,
          res,
          "/api/digital-hospital/public-health/coordination"
        )) return true;
        const board = await buildDigitalHospitalPublicHealthBoard(data, {
          filters,
          authorizedHospitalCodes
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-public-health-coordination-read",
          target: "/api/digital-hospital/public-health/coordination",
          result: "allowed",
          detail: `${authorizedHospitalCodes.length} hospitals / ${board.summary.totalLanes} lanes / ${board.summary.filteredIncidents} filtered incidents / ${board.summary.overdueIncidents} overdue / productionReady=false`
        });
        sendJson(res, 200, board);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/public-health/incidents/export") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/public-health/incidents/export");
        if (!user) return true;
        const data = readDatabase();
        const query = Object.fromEntries(url.searchParams.entries());
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        if (!authorizeDigitalHospitalPublicHealthHospital(
          user,
          query.hospitalCode,
          authorizedHospitalCodes,
          res,
          "/api/digital-hospital/public-health/incidents/export"
        )) return true;
        const format = String(query.format || "json").trim().toLowerCase();
        if (!["json", "csv"].includes(format)) {
          sendJson(res, 400, {
            error: "Bad Request",
            code: "PUBLIC_HEALTH_EXPORT_FORMAT_INVALID",
            message: "format must be json or csv"
          });
          return true;
        }
        const board = await buildDigitalHospitalPublicHealthBoard(data, {
          filters: query,
          authorizedHospitalCodes
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-public-health-incident-export",
          target: "/api/digital-hospital/public-health/incidents/export",
          result: "allowed",
          detail: `${format} / ${board.summary.filteredIncidents} incidents / productionReady=false`
        });
        const filename = `digital-hospital-public-health-incidents-${new Date().toISOString().slice(0, 10)}.${format}`;
        if (format === "csv") {
          sendDownload(
            res,
            200,
            renderDigitalHospitalPublicHealthIncidentCsv(board),
            "text/csv; charset=utf-8",
            filename
          );
          return true;
        }
        sendDownload(
          res,
          200,
          JSON.stringify({
            ok: true,
            generatedAt: board.generatedAt,
            filters: board.filters,
            summary: board.summary,
            statistics: board.statistics,
            incidents: board.coordination.incidents,
            productionBoundary: board.productionBoundary
          }, null, 2),
          "application/json; charset=utf-8",
          filename
        );
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/public-health/incidents") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/public-health/incidents");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        if (!authorizeDigitalHospitalPublicHealthHospital(
          user,
          payload.hospitalCode,
          authorizedHospitalCodes,
          res,
          "/api/digital-hospital/public-health/incidents"
        )) return true;
        try {
          const result = createDigitalHospitalPublicHealthIncident(
            data.digitalHospitalPublicHealthCoordination,
            payload,
            user,
            { authorizedHospitalCodes }
          );
          data.digitalHospitalPublicHealthCoordination = result.state;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-public-health-incident-create",
              target: result.incident.id,
              result: "allowed",
              detail: `${result.incident.level} / ${result.incident.laneId} / revision ${result.incident.revision}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 201, {
            ok: true,
            incident: result.incident,
            action: result.action,
            board: await buildDigitalHospitalPublicHealthBoard(data, { authorizedHospitalCodes })
          });
        } catch (error) {
          sendJson(res, Number(error.status || 400), {
            error: Number(error.status || 400) === 409 ? "Conflict" : "Bad Request",
            code: error.code || "PUBLIC_HEALTH_COORDINATION_INVALID",
            message: error.message
          });
        }
        return true;
      }

      const digitalHospitalPublicHealthIncidentEvidenceMatch = url.pathname.match(
        /^\/api\/digital-hospital\/public-health\/incidents\/([^/]+)\/evidence$/
      );
      if (req.method === "POST" && digitalHospitalPublicHealthIncidentEvidenceMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/digital-hospital/public-health/incidents/:id/evidence"
        );
        if (!user) return true;
        const incidentId = decodeURIComponent(digitalHospitalPublicHealthIncidentEvidenceMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        try {
          const result = submitDigitalHospitalPublicHealthIncidentEvidence(
            data.digitalHospitalPublicHealthCoordination,
            incidentId,
            payload,
            user,
            { authorizedHospitalCodes }
          );
          data.digitalHospitalPublicHealthCoordination = result.state;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-public-health-evidence-submit",
              target: result.evidence.id,
              result: "allowed",
              detail: `${result.incident.id} / ${result.evidence.evidenceType} / incident revision ${result.incident.revision} / productionEvidence=false`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 201, {
            ok: true,
            incident: result.incident,
            evidence: result.evidence,
            action: result.action,
            closureGate: result.closureGate,
            board: await buildDigitalHospitalPublicHealthBoard(data, { authorizedHospitalCodes })
          });
        } catch (error) {
          sendJson(res, Number(error.status || 400), {
            error: Number(error.status || 400) === 409
              ? "Conflict"
              : Number(error.status || 400) === 404 ? "Not Found" : "Bad Request",
            code: error.code || "PUBLIC_HEALTH_COORDINATION_INVALID",
            message: error.message
          });
        }
        return true;
      }

      const digitalHospitalPublicHealthEvidenceActionMatch = url.pathname.match(
        /^\/api\/digital-hospital\/public-health\/evidence\/([^/]+)\/actions$/
      );
      if (req.method === "POST" && digitalHospitalPublicHealthEvidenceActionMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/digital-hospital/public-health/evidence/:id/actions"
        );
        if (!user) return true;
        const evidenceId = decodeURIComponent(digitalHospitalPublicHealthEvidenceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        try {
          const result = reviewDigitalHospitalPublicHealthIncidentEvidence(
            data.digitalHospitalPublicHealthCoordination,
            evidenceId,
            payload,
            user,
            { authorizedHospitalCodes }
          );
          data.digitalHospitalPublicHealthCoordination = result.state;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-public-health-evidence-review",
              target: result.evidence.id,
              result: "allowed",
              detail: `${result.action.action} / ${result.incident.id} / incident revision ${result.incident.revision} / productionEvidence=false`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 200, {
            ok: true,
            incident: result.incident,
            evidence: result.evidence,
            action: result.action,
            closureGate: result.closureGate,
            board: await buildDigitalHospitalPublicHealthBoard(data, { authorizedHospitalCodes })
          });
        } catch (error) {
          sendJson(res, Number(error.status || 400), {
            error: Number(error.status || 400) === 409
              ? "Conflict"
              : Number(error.status || 400) === 404 ? "Not Found" : "Bad Request",
            code: error.code || "PUBLIC_HEALTH_COORDINATION_INVALID",
            message: error.message
          });
        }
        return true;
      }

      const digitalHospitalPublicHealthIncidentActionMatch = url.pathname.match(
        /^\/api\/digital-hospital\/public-health\/incidents\/([^/]+)\/actions$/
      );
      if (req.method === "POST" && digitalHospitalPublicHealthIncidentActionMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/digital-hospital/public-health/incidents/:id/actions"
        );
        if (!user) return true;
        const incidentId = decodeURIComponent(digitalHospitalPublicHealthIncidentActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        try {
          const result = String(payload.action || "") === "escalate-overdue"
            ? escalateDigitalHospitalPublicHealthIncident(
              data.digitalHospitalPublicHealthCoordination,
              incidentId,
              payload,
              user,
              { authorizedHospitalCodes }
            )
            : advanceDigitalHospitalPublicHealthIncident(
              data.digitalHospitalPublicHealthCoordination,
              incidentId,
              payload,
              user,
              { authorizedHospitalCodes }
            );
          data.digitalHospitalPublicHealthCoordination = result.state;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-public-health-incident-action",
              target: result.incident.id,
              result: "allowed",
              detail: `${result.action.action} / ${result.incident.status} / revision ${result.incident.revision}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 200, {
            ok: true,
            incident: result.incident,
            action: result.action,
            board: await buildDigitalHospitalPublicHealthBoard(data, { authorizedHospitalCodes })
          });
        } catch (error) {
          sendJson(res, Number(error.status || 400), {
            error: Number(error.status || 400) === 409 ? "Conflict" : "Bad Request",
            code: error.code || "PUBLIC_HEALTH_COORDINATION_INVALID",
            message: error.message
          });
        }
        return true;
      }
        return false;
      }
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
