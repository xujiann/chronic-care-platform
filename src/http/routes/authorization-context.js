"use strict";

const AccessPolicy = require("../../../access-control-policy");
const { permissionSet, safeAuthorizationContext } = require("../../identity-security/authorization-runtime");
const { identityClaims, publicIdentity } = require("../../identity-security/runtime-identity-policy");

const CATALOG_CAPABILITIES = Object.freeze([...new Set(Object.values(AccessPolicy.pageCatalog)
  .flatMap((policy) => policy.capabilities || []))].sort());

function configuredRegionalCapabilities(environment = process.env) {
  const configured = String(environment.REGIONAL_CAPABILITIES || "").split(/[,;\n]/)
    .map((item) => item.trim()).filter(Boolean);
  if (configured.length) return [...new Set(configured)].sort();
  return String(environment.NODE_ENV || "").toLowerCase() === "production" ? [] : [...CATALOG_CAPABILITIES];
}

function buildAuthorizationContext(user, options = {}) {
  const regionalContext = options.regionalContext || {};
  const claims = identityClaims(user);
  const permissions = [...permissionSet(user)].sort();
  const regionalCapabilities = configuredRegionalCapabilities(options.environment);
  const policyContext = { permissions, regionalCapabilities };
  const pages = AccessPolicy.pagesForUser(user, policyContext, { includeHome: true });
  const context = safeAuthorizationContext(user, {
    permissions,
    pages: pages.map((item) => item.page),
    menus: pages.map((item) => ({ id: item.page, label: item.label, href: item.href })),
    organizationScope: claims.organizationScope,
    regionCode: regionalContext.regionCode || user?.regionCode
  });
  return Object.freeze({
    ...context,
    user: Object.freeze({ ...publicIdentity(user), home: AccessPolicy.homeForUser(user, policyContext) }),
    regionalCapabilities: Object.freeze(regionalCapabilities),
    regional: Object.freeze({
      regionCode: String(regionalContext.regionCode || user?.regionCode || ""),
      regionName: String(regionalContext.regionName || ""),
      deploymentClass: String(regionalContext.deploymentClass || ""),
      productionReady: false
    }),
    policy: Object.freeze({
      schemaVersion: "access-control-policy-v1",
      unknownPages: "deny",
      unknownRoles: "deny"
    })
  });
}

function createRouteSegment(runtime, options = {}) {
  if (!runtime || typeof runtime.currentSession !== "function" || typeof runtime.sendJson !== "function") {
    throw new TypeError("authorization context route requires identity runtime");
  }
  return {
    id: "authorization-context-01",
    domain: "identity-security",
    async handle(req, res, url) {
      if (req.method !== "GET" || url.pathname !== "/api/auth/context") return false;
      const session = runtime.currentSession(req);
      if (!session?.user) {
        runtime.sendJson(res, 401, { ok: false, error: "Unauthorized", message: "请先登录后再访问授权上下文" });
        return true;
      }
      if (!AccessPolicy.knownRoles.includes(String(session.user.role || ""))) {
        runtime.sendJson(res, 403, { ok: false, error: "Forbidden", code: "UNKNOWN_ROLE", message: "未知角色默认拒绝访问" });
        return true;
      }
      const context = buildAuthorizationContext(session.user, options);
      runtime.sendJson(res, 200, { ok: true, expiresAt: session.expiresAt, ...context });
      return true;
    }
  };
}

module.exports = {
  CATALOG_CAPABILITIES,
  buildAuthorizationContext,
  configuredRegionalCapabilities,
  createRouteSegment
};
