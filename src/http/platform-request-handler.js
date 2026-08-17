"use strict";

function requiredFunction(options, name) {
  if (typeof options[name] !== "function") throw new TypeError(`platform request handler requires ${name}`);
  return options[name];
}

function createPlatformRequestHandler(options = {}) {
  const observability = options.observability;
  if (!observability || typeof observability.run !== "function" || typeof observability.recordDependency !== "function") {
    throw new TypeError("platform request handler requires observability");
  }
  const hydrateRequestSession = requiredFunction(options, "hydrateRequestSession");
  const handleApi = requiredFunction(options, "handleApi");
  const serveStatic = requiredFunction(options, "serveStatic");
  const isProtectedStaticRequest = requiredFunction(options, "isProtectedStaticRequest");
  const hydrateStaticRequestSession = requiredFunction(options, "hydrateStaticRequestSession");
  const recordRequestMetrics = requiredFunction(options, "recordRequestMetrics");
  const sendJson = requiredFunction(options, "sendJson");
  const handleError = requiredFunction(options, "handleError");
  const logger = options.logger || console;

  return function platformRequestHandler(req, res) {
    return observability.run(req, res, async () => {
      const startedAt = Date.now();
      res.on("finish", () => recordRequestMetrics(req, res, startedAt));
      try {
        if (String(req.url || "").startsWith("/api/")) {
          try {
            await hydrateRequestSession(req);
            observability.recordDependency("session-store", { ok: true });
          } catch (error) {
            observability.recordDependency("session-store", { ok: false, detail: error.code || error.message });
            logger.error(`central session lookup failed: ${error.message}`);
            sendJson(res, 503, {
              ok: false,
              code: "SESSION_STORE_UNAVAILABLE",
              message: "authentication session service is temporarily unavailable"
            });
            return;
          }
          await handleApi(req, res);
          return;
        }
        if (isProtectedStaticRequest(req)) {
          try {
            await hydrateStaticRequestSession(req);
            observability.recordDependency("session-store", { ok: true });
          } catch (error) {
            observability.recordDependency("session-store", { ok: false, detail: error.code || error.message });
            logger.error(`protected page session lookup failed: ${error.message}`);
            sendJson(res, 503, {
              ok: false,
              code: "SESSION_STORE_UNAVAILABLE",
              message: "authentication session service is temporarily unavailable"
            });
            return;
          }
        }
        serveStatic(req, res);
      } catch (error) {
        handleError(req, res, error);
      }
    });
  };
}

module.exports = { createPlatformRequestHandler };
