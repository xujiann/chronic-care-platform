"use strict";

const { SupervisionCaseError, createCase, executeCaseAction, listCases } = require("../../../public-health/health-supervision/case-service");
const locks = new Map();
const REQUIRED_DEPENDENCIES = Object.freeze(["collectJson", "randomUUID", "readDatabase", "requireApiRole", "sendJson", "writeDatabase"]);

function withLock(key, work) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.then(work, work);
  const tail = current.then(() => undefined, () => undefined);
  locks.set(key, tail);
  tail.finally(() => { if (locks.get(key) === tail) locks.delete(key); });
  return current;
}

function sendError(runtime, res, error) {
  const known = error instanceof SupervisionCaseError;
  runtime.sendJson(res, known ? error.statusCode : 500, {
    error: known ? "Case command rejected" : "Internal Server Error",
    code: known ? error.code : "SUPERVISION_CASE_STORAGE_FAILED",
    message: known ? error.message : "supervision case persistence failed"
  });
}

function createRouteSegment(runtime) {
  const { collectJson, randomUUID, readDatabase, requireApiRole, sendJson, writeDatabase } = runtime;
  return {
    id: "public-health-06",
    domain: "public-health",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/public-health/supervision/cases") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/public-health/supervision/cases");
        if (!user) return true;
        const cases = listCases(readDatabase(), user);
        sendJson(res, 200, { generatedAt: new Date().toISOString(), cases, summary: { total: cases.length, open: cases.filter((item) => item.status !== "结案").length, closed: cases.filter((item) => item.status === "结案").length } });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/api/public-health/supervision/cases") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/supervision/cases");
        if (!user) return true;
        const payload = await collectJson(req);
        try {
          const result = await withLock("supervision-case-create", () => {
            const executed = createCase(readDatabase(), payload, user, { idempotencyKey: req.headers?.["idempotency-key"], randomUUID });
            if (!executed.replayed) writeDatabase(executed.state);
            return executed;
          });
          sendJson(res, result.replayed ? 200 : 201, { case: result.caseRecord, idempotentReplay: result.replayed });
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }
      const match = url.pathname.match(/^\/api\/public-health\/supervision\/cases\/([^/]+)\/actions$/);
      if (req.method === "POST" && match) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/public-health/supervision/cases/:id/actions");
        if (!user) return true;
        const caseId = decodeURIComponent(match[1]);
        const payload = await collectJson(req);
        try {
          const result = await withLock(`supervision-case:${caseId}`, () => {
            const executed = executeCaseAction(readDatabase(), caseId, payload, user, { idempotencyKey: req.headers?.["idempotency-key"] });
            if (!executed.replayed) writeDatabase(executed.state);
            return executed;
          });
          sendJson(res, 200, { case: result.caseRecord, idempotentReplay: result.replayed });
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }
      return false;
    }
  };
}

module.exports = { REQUIRED_DEPENDENCIES, ROUTE_SEGMENT_ID: "public-health-06", SUBDOMAIN: "health-supervision-cases", createRouteSegment, withLock };
