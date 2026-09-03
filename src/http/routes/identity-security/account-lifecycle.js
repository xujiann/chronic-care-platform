"use strict";

const {
  AccountLifecycleError,
  assertCommissionManager,
  checkConflicts,
  createRequest,
  listCenter,
  reviewRequest
} = require("../../../identity-security/account-lifecycle-service");

const ROUTE_SEGMENT_ID = "identity-security-account-lifecycle";
const SUBDOMAIN = "account-lifecycle";
const REQUIRED_DEPENDENCIES = Object.freeze(["collectJson", "readDatabase", "requireApiRole", "sendJson", "writeDatabase"]);
const locks = new Map();

function withLock(key, work) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  const tail = current.catch(() => undefined);
  locks.set(key, tail);
  return current.finally(() => { if (locks.get(key) === tail) locks.delete(key); });
}
function sendError(runtime, res, error) {
  const known = error instanceof AccountLifecycleError;
  runtime.sendJson(res, known ? error.statusCode : 500, {
    error: known ? (error.statusCode === 403 ? "Forbidden" : error.statusCode === 404 ? "Not Found" : error.statusCode === 409 ? "Conflict" : "Bad Request") : "Internal Server Error",
    code: known ? error.code : "ACCOUNT_LIFECYCLE_STORAGE_FAILED",
    message: known ? error.message : "account lifecycle persistence failed",
    ...(known && Array.isArray(error.conflicts) ? { conflicts: error.conflicts } : {})
  });
}
function enforceSensitiveMutation(runtime, req, res) {
  if (typeof runtime.enforceSensitiveMutation !== "function") {
    runtime.sendJson(res, 503, { error: "Service Unavailable", code: "ACCOUNT_LIFECYCLE_MUTATION_GUARD_UNAVAILABLE", message: "account lifecycle mutation guard is unavailable" });
    return false;
  }
  return Boolean(runtime.enforceSensitiveMutation(req, res, { stepUp: true }));
}

function createRouteSegment(runtime) {
  for (const dependency of REQUIRED_DEPENDENCIES) {
    if (typeof runtime?.[dependency] !== "function") throw new TypeError(`account lifecycle requires runtime.${dependency}`);
  }
  return {
    id: ROUTE_SEGMENT_ID,
    domain: "identity-security",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/auth/account-lifecycle-requests") {
        try {
          const user = runtime.requireApiRole(req, res, ["commission"], "/api/auth/account-lifecycle-requests");
          if (!user) return true;
          assertCommissionManager(user);
          runtime.sendJson(res, 200, listCenter(runtime.readDatabase(), user));
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/account-lifecycle-requests/conflicts") {
        try {
          const user = runtime.requireApiRole(req, res, ["commission"], "/api/auth/account-lifecycle-requests/conflicts");
          if (!user) return true;
          assertCommissionManager(user);
          const payload = await runtime.collectJson(req);
          const conflicts = checkConflicts(runtime.readDatabase(), payload, user);
          runtime.sendJson(res, 200, { ok: !conflicts.length, conflicts });
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/account-lifecycle-requests") {
        try {
          const user = runtime.requireApiRole(req, res, ["commission"], "/api/auth/account-lifecycle-requests");
          if (!user) return true;
          assertCommissionManager(user);
          if (!enforceSensitiveMutation(runtime, req, res)) return true;
          const payload = await runtime.collectJson(req);
          const result = await withLock("account-lifecycle:create", () => {
            const executed = createRequest(runtime.readDatabase(), payload, user, { idempotencyKey: req.headers?.["idempotency-key"] });
            if (!executed.replayed) runtime.writeDatabase(executed.state);
            return executed;
          });
          runtime.sendJson(res, result.replayed ? 200 : 201, { request: result.request, idempotentReplay: result.replayed });
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }

      const reviewMatch = url.pathname.match(/^\/api\/auth\/account-lifecycle-requests\/([^/]+)\/reviews$/);
      if (req.method === "POST" && reviewMatch) {
        try {
          const user = runtime.requireApiRole(req, res, ["commission"], "/api/auth/account-lifecycle-requests/:id/reviews");
          if (!user) return true;
          assertCommissionManager(user);
          if (!enforceSensitiveMutation(runtime, req, res)) return true;
          const requestId = decodeURIComponent(reviewMatch[1]);
          const payload = await runtime.collectJson(req);
          const result = await withLock(`account-lifecycle:${requestId}`, () => {
            const executed = reviewRequest(runtime.readDatabase(), requestId, payload, user, { idempotencyKey: req.headers?.["idempotency-key"] });
            if (!executed.replayed) runtime.writeDatabase(executed.state);
            return executed;
          });
          runtime.sendJson(res, 200, { request: result.request, idempotentReplay: result.replayed });
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }
      return false;
    }
  };
}

module.exports = { REQUIRED_DEPENDENCIES, ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment, enforceSensitiveMutation, sendError, withLock };
