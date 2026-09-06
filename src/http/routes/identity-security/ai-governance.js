"use strict";

const { randomUUID } = require("node:crypto");
const { AiGovernanceError, assertActor, buildAiGovernanceCenter, executeAiGovernanceAction } = require("../../../identity-security/ai-governance");
const { withLock } = require("./account-lifecycle");
const REQUIRED_DEPENDENCIES = Object.freeze(["collectJson", "readDatabase", "writeDatabase", "requireApiRole", "sendJson", "prependAuditTrailEntry", "verifyAuditTrail"]);

function createRouteSegment(ports) {
  for (const name of REQUIRED_DEPENDENCIES) if (typeof ports[name] !== "function") throw new TypeError(`ai governance requires ${name}`);
  const { collectJson, readDatabase, writeDatabase, requireApiRole, sendJson, prependAuditTrailEntry, verifyAuditTrail, enforceSensitiveMutation } = ports;
  return { id: "identity-security-ai-governance", domain: "identity-security", async handle(req, res, url) {
    try {
      if (req.method === "GET" && url.pathname === "/api/ai-governance/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/ai-governance/center");
        if (!user) return true;
        assertActor(user);
        sendJson(res, 200, buildAiGovernanceCenter(readDatabase(), user));
        return true;
      }
      const match = url.pathname.match(/^\/api\/ai-governance\/rules\/([^/]+)\/actions$/);
      if (req.method === "POST" && match) {
      const user = requireApiRole(req, res, ["commission"], "/api/ai-governance/rules/:id/actions");
      if (!user) return true;
      assertActor(user);
      if (typeof enforceSensitiveMutation !== "function") throw new AiGovernanceError("AI_GOVERNANCE_GUARD_UNAVAILABLE", "mutation guard unavailable", 503);
      if (!enforceSensitiveMutation(req, res, { stepUp: true })) return true;
      let id;
      try { id = decodeURIComponent(match[1]); }
      catch { throw new AiGovernanceError("AI_GOVERNANCE_RESOURCE_INVALID", "resource encoding invalid", 400); }
      const payload = await collectJson(req);
      const result = await withLock("clinical-assist:state", async () => {
        const executed = executeAiGovernanceAction(readDatabase(), id, payload, user, { idempotencyKey: req.headers?.["idempotency-key"] });
        if (!executed.replayed) {
          if (verifyAuditTrail(executed.state.securityEvents).passed !== true) throw new AiGovernanceError("AI_GOVERNANCE_AUDIT_INVALID", "existing audit trail verification failed", 409);
          executed.state.securityEvents = prependAuditTrailEntry(executed.state.securityEvents || [], { id: randomUUID(), at: new Date().toISOString(), ...executed.audit });
          if (verifyAuditTrail(executed.state.securityEvents).passed !== true) throw new AiGovernanceError("AI_GOVERNANCE_AUDIT_INVALID", "updated audit trail verification failed", 409);
          await writeDatabase(executed.state);
        }
        return executed;
      });
      sendJson(res, 200, { ...result.response, idempotentReplay: result.replayed });
      return true;
      }
      return false;
    } catch (error) {
      const known = error instanceof AiGovernanceError;
      sendJson(res, known ? error.statusCode : 500, { ok: false, code: known ? error.code : "AI_GOVERNANCE_PERSISTENCE_FAILED", message: known ? error.message : "AI governance operation failed" });
    }
    return true;
  } };
}

module.exports = { REQUIRED_DEPENDENCIES, createRouteSegment };
