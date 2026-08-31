"use strict";

const emergencySignalWrite = require("../t06-emergency-signal-write");
const emergencySignalDelivery = require("../t06-emergency-signal-delivery");

function createRouteSegment(runtime) {
  const { appendSecurityEvent, collectJson, prependAuditTrailEntry, readDatabase, requireApiRole, rowMatchesOrganizationScope, sendJson, writeDatabase } = runtime;
  return {
    id: "clinical-specialties-09",
    domain: "clinical-specialties",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/emergency-signals/deliveries") {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency-signals/deliveries");
        if (!user) return true;
        try {
          sendJson(res, 200, emergencySignalDelivery.listEmergencySignalDeliveries(readDatabase(), {
            status: url.searchParams.get("status"),
            limit: url.searchParams.get("limit")
          }));
        } catch (error) {
          if (!(error instanceof emergencySignalDelivery.EmergencySignalDeliveryError)) throw error;
          sendJson(res, error.statusCode, {
            error: error.statusCode === 404 ? "Not Found" : "Conflict",
            code: error.code,
            message: error.message
          });
        }
        return true;
      }

      const replayMatch = url.pathname.match(
        /^\/api\/emergency-signals\/deliveries\/([^/]+)\/replay$/
      );
      if (req.method === "POST" && replayMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/emergency-signals/deliveries/:eventId/replay"
        );
        if (!user) return true;
        const payload = await collectJson(req);
        const eventId = decodeURIComponent(replayMatch[1]);
        try {
          const replay = await emergencySignalDelivery.transactEmergencySignalDelivery({
            readDatabase,
            writeDatabase,
            event: "clinical-specialties.emergency-signal-delivery-replay.v1"
          }, (data) => {
            const result = emergencySignalDelivery.replayEmergencySignalDelivery(
              data,
              eventId,
              payload,
              user
            );
            if (!result.duplicate) {
              data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
                id: `emergency-delivery-replay:${eventId}:${result.generation}`,
                at: new Date().toISOString(),
                actor: user.name || user.username || user.role,
                role: user.role,
                action: "重放急救信号死信交付",
                target: eventId,
                result: "允许",
                detail: `generation=${result.generation}; productionReady=false`,
                ownershipContract: {
                  owner: emergencySignalWrite.DOMAIN,
                  outbox: emergencySignalWrite.OUTBOX_COLLECTION,
                  unitOfWork: true
                }
              });
            }
            return result;
          });
          sendJson(res, 200, {
            ...replay,
            eventId,
            productionReady: false
          });
        } catch (error) {
          if (!(error instanceof emergencySignalDelivery.EmergencySignalDeliveryError)) throw error;
          sendJson(res, error.statusCode, {
            error: error.statusCode === 403 ? "Forbidden"
              : error.statusCode === 404 ? "Not Found"
                : "Conflict",
            code: error.code,
            message: error.message
          });
        }
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/emergency-signals/")) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/emergency-signals/:id");
        if (!user) return true;
        const id = decodeURIComponent(url.pathname.replace("/api/emergency-signals/", ""));
        const access = emergencySignalWrite.inspectEmergencySignalAccess({
          id,
          user,
          readDatabase,
          rowMatchesOrganizationScope
        });
        if (!access.allowed) {
          if (access.statusCode === 404) {
            res.setHeader("X-Idempotent-Replay", "false");
            sendJson(res, 404, {
              error: "Not Found",
              message: "未找到业务记录",
              idempotentReplay: false
            });
            return true;
          }
          if (access.statusCode === 403) {
            appendSecurityEvent({
              actor: user.name || user.username || user.role,
              role: user.role,
              action: "更新公卫预警",
              target: id,
              result: "拒绝",
              detail: "resource scope denied"
            });
          }
          sendJson(res, access.statusCode, {
            error: "Forbidden",
            code: access.code,
            message: "无权更新该急救信号"
          });
          return true;
        }
        let result;
        try {
          result = await emergencySignalWrite.updateEmergencySignal({
            id,
            payload: await collectJson(req),
            user,
            correlationId: req.correlationId || req.headers["x-correlation-id"],
            causationId: req.headers["idempotency-key"],
            readDatabase,
            writeDatabase,
            prependAuditTrailEntry,
            rowMatchesOrganizationScope
          });
        } catch (error) {
          if (!(error instanceof emergencySignalWrite.EmergencySignalCommandError)) throw error;
          if (error.statusCode === 403) {
            appendSecurityEvent({
              actor: user.name || user.username || user.role,
              role: user.role,
              action: "更新公卫预警",
              target: id,
              result: "拒绝",
              detail: "resource scope denied after command lock"
            });
          }
          sendJson(res, error.statusCode, {
            error: error.statusCode === 403 ? "Forbidden"
              : error.statusCode === 409 ? "Conflict"
                : "Internal Server Error",
            code: error.code,
            message: error.statusCode === 403 ? "无权更新该急救信号" : error.message
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
