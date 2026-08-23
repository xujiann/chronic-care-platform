"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-01";
const SUBDOMAIN = "governance-catalog";
const governanceRecordWriteTails = new Map();

function withGovernanceRecordWriteLock(recordId, work) {
  const key = String(recordId || "");
  const previous = governanceRecordWriteTails.get(key) || Promise.resolve();
  const execution = previous.then(work, work);
  const tail = execution.then(() => undefined, () => undefined);
  governanceRecordWriteTails.set(key, tail);
  tail.finally(() => {
    if (governanceRecordWriteTails.get(key) === tail) governanceRecordWriteTails.delete(key);
  });
  return execution;
}

function governanceCommandResponse(result) {
  const scopeDenied = ["ACTOR_FORBIDDEN", "INSTITUTION_SCOPE_DENIED"].includes(result.error?.code);
  return {
    ok: result.ok,
    replayed: result.replayed,
    record: scopeDenied ? null : result.record,
    auditEvent: scopeDenied ? null : result.auditEvent,
    error: result.error
  };
}

function persistenceErrorResponse(error) {
  const versionConflict = String(error?.message || "").includes("SQLite optimistic lock conflict");
  return {
    status: versionConflict ? 409 : 500,
    body: {
      ok: false,
      replayed: false,
      record: null,
      auditEvent: null,
      error: {
        code: versionConflict ? "QUALITY_GOVERNANCE_VERSION_CONFLICT" : "QUALITY_GOVERNANCE_COMMAND_FAILED",
        message: versionConflict
          ? "quality governance state changed; retry with a fresh snapshot"
          : "quality governance command failed"
      }
    }
  };
}

function createRouteSegment(runtime) {
  const { applyGovernanceResultToData, buildGovernanceCatalog, buildGovernanceRuntimeState, collectJson, executeGovernanceCommand, governanceActorFromUser, governanceAuditForRecord, governanceHttpStatus, listGovernanceRecords, publicGovernanceRecord, readDatabase, requireApiRole, sealAuditTrail, sendJson, writeDatabase } = runtime;
  return {
      id: "platform-governance-01",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/quality-operations-governance/catalog") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, buildGovernanceCatalog(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/quality-operations-governance/items") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, listGovernanceRecords(readDatabase(), user, {
          domain: url.searchParams.get("domain"),
          status: url.searchParams.get("status"),
          institutionId: url.searchParams.get("institutionId")
        }));
        return true;
      }

      const governanceAuditMatch = url.pathname.match(/^\/api\/quality-operations-governance\/items\/([^/]+)\/audit$/);
      if (req.method === "GET" && governanceAuditMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], "/api/quality-operations-governance/items/:id/audit");
        if (!user) return true;
        const result = governanceAuditForRecord(readDatabase(), decodeURIComponent(governanceAuditMatch[1]), user);
        if (!result.found) {
          sendJson(res, 404, { error: "Not Found", code: "RECORD_NOT_FOUND", message: "governance record not found" });
          return true;
        }
        if (!result.allowed) {
          sendJson(res, 403, { error: "Forbidden", code: "INSTITUTION_SCOPE_DENIED", message: "record is outside the actor scope" });
          return true;
        }
        sendJson(res, 200, result);
        return true;
      }

      const governanceActionMatch = url.pathname.match(/^\/api\/quality-operations-governance\/items\/([^/]+)\/actions$/);
      if (req.method === "POST" && governanceActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], "/api/quality-operations-governance/items/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const recordId = decodeURIComponent(governanceActionMatch[1]);
        await withGovernanceRecordWriteLock(recordId, async () => {
          const data = readDatabase();
          const visibility = governanceAuditForRecord(data, recordId, user);
          if (!visibility.found) {
            sendJson(res, 404, {
              ok: false,
              replayed: false,
              record: null,
              auditEvent: null,
              error: { code: "RECORD_NOT_FOUND", message: "governance record not found" }
            });
            return;
          }
          const command = {
            idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
            domain: String(payload.domain || "").trim(),
            recordId,
            action: String(payload.action || "").trim(),
            actor: governanceActorFromUser(user),
            expectedVersion: payload.expectedVersion,
            occurredAt: new Date().toISOString(),
            payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {}
          };
          const runtime = buildGovernanceRuntimeState(data);
          const result = executeGovernanceCommand(runtime.state, command);
          applyGovernanceResultToData(data, result);
          if (!result.replayed) {
            data.securityEvents = sealAuditTrail(data.securityEvents, { recompute: true });
            try {
              writeDatabase(data);
            } catch (error) {
              const failure = persistenceErrorResponse(error);
              sendJson(res, failure.status, failure.body);
              return;
            }
          }
          const response = governanceCommandResponse(result);
          sendJson(res, result.ok ? 200 : governanceHttpStatus(result.error?.code), {
            ...response,
            record: response.record ? publicGovernanceRecord(response.record) : null
          });
        });
        return true;
      }
        return false;
      }
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
