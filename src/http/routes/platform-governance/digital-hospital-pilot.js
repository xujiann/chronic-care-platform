"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-04";
const SUBDOMAIN = "digital-hospital-pilot";

function createRouteSegment(runtime) {
  const { appendSecurityEvent, applyProductionOperationsAction, buildProductionOperationsCenter, buildRuntimeMetrics, collectJson, mergeByKey, normalizeState, randomUUID, readDatabase, requireApiRole, sealAuditTrail, seedDisasterRecoveryDrills, seedOperationsDutyShifts, seedOperationsEvidencePackets, seedOperationsIncidents, sendJson, writeDatabase } = runtime;
  return {
      id: "platform-governance-04",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/production-operations/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-operations/center");
        if (!user) return true;
        const data = readDatabase();
        const center = buildProductionOperationsCenter(data, { runtimeMetrics: buildRuntimeMetrics(data) });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "production-operations-center-read",
          target: "/api/production-operations/center",
          result: "allowed",
          detail: `${center.summary.serviceLevels} SLOs / ${center.summary.openIncidents} open incidents / ${center.summary.validatedDrills} local drills / production ready 0`
        });
        sendJson(res, 200, { ok: center.ok, generatedAt: new Date().toISOString(), center });
        return true;
      }

      const productionOperationsActionMatch = url.pathname.match(/^\/api\/production-operations\/(incidents|duty-shifts|drills)\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionOperationsActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-operations/:resource/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const resource = productionOperationsActionMatch[1];
        const itemId = decodeURIComponent(productionOperationsActionMatch[2]);
        const definitions = {
          incidents: { collection: "operationsIncidents", seed: seedOperationsIncidents },
          "duty-shifts": { collection: "operationsDutyShifts", seed: seedOperationsDutyShifts },
          drills: { collection: "disasterRecoveryDrills", seed: seedDisasterRecoveryDrills }
        };
        const definition = definitions[resource];
        const data = readDatabase();
        const rows = mergeByKey(definition.seed(), data[definition.collection], "id");
        const index = rows.findIndex((item) => item.id === itemId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production operations item not found" });
          return true;
        }
        let normalized;
        try {
          normalized = applyProductionOperationsAction(resource, rows[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        rows[index] = normalized.item;
        data[definition.collection] = rows;
        if (normalized.evidencePacket) {
          data.operationsEvidencePackets = [normalized.evidencePacket, ...mergeByKey(seedOperationsEvidencePackets(), data.operationsEvidencePackets, "id")].slice(0, 80);
        }
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "production-operations-action",
            target: `${resource}:${itemId}`,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.fromStatus} -> ${normalized.history.toStatus} / production ready false`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 200, {
          ok: true,
          item: normalized.item,
          action: normalized.history,
          evidencePacket: normalized.evidencePacket,
          center: buildProductionOperationsCenter(refreshed, { runtimeMetrics: buildRuntimeMetrics(refreshed) })
        });
        return true;
      }
        return false;
      }
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
