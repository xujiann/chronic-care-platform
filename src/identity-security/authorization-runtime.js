"use strict";

const KNOWN_ROLES = new Set(["commission", "institution", "insurance", "citizen", "county", "system"]);
const POLICY_KEYS = new Set([
  "roles", "accountTypes", "permissions", "permissionMode", "orgTypes",
  "organizationScope", "regionScope"
]);

function list(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function permissionSet(user = {}) {
  return new Set([
    ...list(user.permissions),
    ...list(user.bloodPermissions),
    ...list(user.scopes),
    ...list(user.capabilities)
  ]);
}

function deny(code, detail) {
  return { allowed: false, code, detail };
}

function authorize(user, policy, resource = {}) {
  if (!user || typeof user !== "object") return deny("AUTHENTICATION_REQUIRED", "authenticated user required");
  const role = String(user.role || "").trim();
  if (!KNOWN_ROLES.has(role)) return deny("UNKNOWN_ROLE", "unknown roles are denied");
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return deny("UNKNOWN_POLICY", "authorization policy is required");
  const keys = Object.keys(policy);
  if (!keys.length || keys.some((key) => !POLICY_KEYS.has(key))) return deny("UNKNOWN_POLICY", "empty or unsupported policy is denied");

  const roles = list(policy.roles);
  if (!roles.length || roles.some((item) => !KNOWN_ROLES.has(item))) return deny("UNKNOWN_POLICY", "policy must declare known roles");
  if (!roles.includes(role)) return deny("ROLE_DENIED", "role is not allowed");

  const accountTypes = list(policy.accountTypes);
  if (accountTypes.length && !accountTypes.includes(String(user.accountType || "").trim())) {
    return deny("ACCOUNT_TYPE_DENIED", "account type is not allowed");
  }
  const orgTypes = list(policy.orgTypes);
  if (orgTypes.length && !orgTypes.includes(String(user.orgType || "").trim())) {
    return deny("ORGANIZATION_TYPE_DENIED", "organization type is not allowed");
  }

  const requiredPermissions = list(policy.permissions);
  if (requiredPermissions.length) {
    if (requiredPermissions.includes("*")) return deny("UNKNOWN_POLICY", "wildcard permissions are forbidden");
    const granted = permissionSet(user);
    const permissionMode = policy.permissionMode || "all";
    if (!new Set(["all", "any"]).has(permissionMode)) return deny("UNKNOWN_POLICY", "unknown permission mode");
    const permitted = permissionMode === "any"
      ? requiredPermissions.some((item) => granted.has(item))
      : requiredPermissions.every((item) => granted.has(item));
    if (!permitted) return deny("PERMISSION_DENIED", "required permission is not granted");
  }

  const organizationScope = policy.organizationScope || "any";
  if (!new Set(["any", "self"]).has(organizationScope)) return deny("UNKNOWN_POLICY", "unknown organization scope");
  if (organizationScope === "self") {
    const actorOrg = String(user.orgCode || "").trim();
    const targetOrg = String(resource.orgCode || resource.organizationId || resource.institutionId || "").trim();
    if (!actorOrg || !targetOrg || actorOrg !== targetOrg) return deny("ORGANIZATION_SCOPE_DENIED", "resource is outside the actor organization");
  }

  const regionScope = policy.regionScope || "any";
  if (!new Set(["any", "self", "active"]).has(regionScope)) return deny("UNKNOWN_POLICY", "unknown region scope");
  if (regionScope !== "any") {
    const actorRegion = String(user.regionCode || resource.activeRegionCode || "").trim();
    const targetRegion = String(resource.regionCode || resource.activeRegionCode || "").trim();
    if (!actorRegion || !targetRegion || actorRegion !== targetRegion) return deny("REGION_SCOPE_DENIED", "resource is outside the active actor region");
  }
  return { allowed: true, code: "ALLOWED" };
}

function safeAuthorizationContext(user, access = {}) {
  const safeUser = {
    id: String(user?.id || ""),
    username: String(user?.username || ""),
    name: String(user?.name || ""),
    role: String(user?.role || ""),
    roleName: String(user?.roleName || ""),
    accountType: String(user?.accountType || ""),
    orgCode: String(user?.orgCode || ""),
    orgName: String(user?.orgName || ""),
    orgType: String(user?.orgType || ""),
    regionCode: String(user?.regionCode || access.regionCode || ""),
    home: String(user?.home || "")
  };
  return {
    user: safeUser,
    permissions: list(access.permissions),
    pages: list(access.pages),
    menus: (Array.isArray(access.menus) ? access.menus : []).map((item) => ({
      id: String(item?.id || ""),
      label: String(item?.label || ""),
      href: String(item?.href || "")
    })).filter((item) => item.id && item.label && item.href),
    scopes: {
      organization: String(access.organizationScope || user?.orgCode || ""),
      region: String(access.regionCode || user?.regionCode || "")
    },
    productionReady: false
  };
}

module.exports = {
  KNOWN_ROLES,
  authorize,
  permissionSet,
  safeAuthorizationContext
};
