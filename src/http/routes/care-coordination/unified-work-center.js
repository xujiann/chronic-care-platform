"use strict";

const {
  WorkCenterError,
  acknowledgeMessage,
  buildCenter,
  executeTaskAction,
  sendTaskMessage
} = require("../../../work-center/unified-work-center-service");

const ROUTE_SEGMENT_ID = "work-center-01";
const SUBDOMAIN = "unified-work-center";
const REQUIRED_DEPENDENCIES = Object.freeze(["buildUnifiedTasks", "canAccessTaskMessage", "collectJson", "readDatabase", "requireApiRole", "sendJson", "writeDatabase"]);
const locks = new Map();

function withLock(key, work) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  const tail = current.catch(() => undefined);
  locks.set(key, tail);
  return current.finally(() => { if (locks.get(key) === tail) locks.delete(key); });
}

function sendError(runtime, res, error) {
  const known = error instanceof WorkCenterError;
  runtime.sendJson(res, known ? error.statusCode : 500, {
    error: known ? (error.statusCode === 403 ? "Forbidden" : error.statusCode === 404 ? "Not Found" : error.statusCode === 409 ? "Conflict" : "Bad Request") : "Internal Server Error",
    code: known ? error.code : "WORK_CENTER_STORAGE_FAILED",
    message: known ? error.message : "work center persistence failed"
  });
}

function createRouteSegment(runtime) {
  for (const dependency of REQUIRED_DEPENDENCIES) {
    if (typeof runtime?.[dependency] !== "function") throw new TypeError(`unified work center requires runtime.${dependency}`);
  }
  const dependencies = { buildUnifiedTasks: runtime.buildUnifiedTasks, canAccessTaskMessage: runtime.canAccessTaskMessage };
  return {
    id: ROUTE_SEGMENT_ID,
    domain: "care-coordination",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/work-center") {
        const user = runtime.requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/work-center");
        if (!user) return true;
        try { runtime.sendJson(res, 200, buildCenter(runtime.readDatabase(), user, dependencies)); }
        catch (error) { sendError(runtime, res, error); }
        return true;
      }

      const taskAction = url.pathname.match(/^\/api\/work-center\/tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && taskAction) {
        const user = runtime.requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/work-center/tasks/:id/actions");
        if (!user) return true;
        const payload = await runtime.collectJson(req);
        const taskId = decodeURIComponent(taskAction[1]);
        try {
          const result = await withLock(`work-task:${taskId}`, () => {
            const executed = executeTaskAction(runtime.readDatabase(), taskId, payload, user, { ...dependencies, idempotencyKey: req.headers?.["idempotency-key"] });
            if (!executed.replayed) runtime.writeDatabase(executed.state);
            return executed;
          });
          runtime.sendJson(res, 200, { task: result.task, idempotentReplay: result.replayed });
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }

      const taskMessage = url.pathname.match(/^\/api\/work-center\/tasks\/([^/]+)\/messages$/);
      if (req.method === "POST" && taskMessage) {
        const user = runtime.requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/work-center/tasks/:id/messages");
        if (!user) return true;
        const payload = await runtime.collectJson(req);
        const taskId = decodeURIComponent(taskMessage[1]);
        try {
          const result = await withLock(`work-message:${taskId}`, () => {
            const executed = sendTaskMessage(runtime.readDatabase(), taskId, payload, user, { ...dependencies, idempotencyKey: req.headers?.["idempotency-key"] });
            if (!executed.replayed) runtime.writeDatabase(executed.state);
            return executed;
          });
          runtime.sendJson(res, result.replayed ? 200 : 201, { message: result.message, idempotentReplay: result.replayed });
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }

      const messageReceipt = url.pathname.match(/^\/api\/work-center\/messages\/([^/]+)\/receipt$/);
      if (req.method === "POST" && messageReceipt) {
        const user = runtime.requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/work-center/messages/:id/receipt");
        if (!user) return true;
        const payload = await runtime.collectJson(req);
        const messageId = decodeURIComponent(messageReceipt[1]);
        try {
          const result = await withLock(`work-receipt:${messageId}`, () => {
            const executed = acknowledgeMessage(runtime.readDatabase(), messageId, payload, user, { ...dependencies, idempotencyKey: req.headers?.["idempotency-key"] });
            if (!executed.replayed) runtime.writeDatabase(executed.state);
            return executed;
          });
          runtime.sendJson(res, 200, { message: result.message, idempotentReplay: result.replayed });
        } catch (error) { sendError(runtime, res, error); }
        return true;
      }
      return false;
    }
  };
}

module.exports = { REQUIRED_DEPENDENCIES, ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment, sendError, withLock };
