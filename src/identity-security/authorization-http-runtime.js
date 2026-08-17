"use strict";

const AccessPolicy = require("../../access-control-policy");
const { configuredRegionalCapabilities } = require("../http/routes/authorization-context");
const { permissionSet } = require("./authorization-runtime");
const {
  evaluateStaticPageAccess,
  isProtectedStaticRequest,
  loginRedirect
} = require("./static-page-guard");

const BROWSER_SESSION_COOKIE = "health_city_browser_session";

function cookieValue(req, name) {
  for (const cookie of String(req.headers.cookie || "").split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(cookie.slice(separator + 1).trim()); } catch { return ""; }
  }
  return "";
}

function createAuthorizationHttpRuntime(options = {}) {
  const verifyToken = options.verifySignedSessionToken;
  const sessionStore = options.sessionStore;
  if (typeof verifyToken !== "function" || typeof sessionStore !== "function") {
    throw new TypeError("authorization HTTP runtime requires token verification and session store");
  }
  const browserSession = (req) => {
    const verified = verifyToken(cookieValue(req, BROWSER_SESSION_COOKIE));
    return verified ? sessionStore().get(verified.sessionId) || null : null;
  };
  return Object.freeze({
    isProtectedStaticRequest,
    async hydrateStaticRequestSession(req) {
      const store = sessionStore();
      if (typeof store.hydrate !== "function") return null;
      const verified = verifyToken(cookieValue(req, BROWSER_SESSION_COOKIE));
      return verified ? store.hydrate(verified.sessionId) : null;
    },
    evaluateStaticRequest(req) {
      const session = browserSession(req);
      return evaluateStaticPageAccess(req, session, AccessPolicy.accessDecision, {
        permissions: session?.user ? [...permissionSet(session.user)] : [],
        regionalCapabilities: configuredRegionalCapabilities(options.environment)
      });
    },
    denyStaticRequest(res, decision, user) {
      options.appendSecurityEvent?.({
        actor: user?.name || "anonymous", role: user?.role || "anonymous",
        action: "访问业务页面", target: decision.page, result: "拒绝",
        detail: decision.code, transient: !user
      });
      res.writeHead(302, {
        ...(options.securityResponseHeaders?.() || {}),
        "Cache-Control": "no-store",
        Location: loginRedirect(decision)
      });
      res.end();
    },
    currentBrowserUser(req) {
      return browserSession(req)?.user || null;
    }
  });
}

module.exports = { BROWSER_SESSION_COOKIE, cookieValue, createAuthorizationHttpRuntime };
