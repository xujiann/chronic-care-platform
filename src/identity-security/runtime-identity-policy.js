"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

const SESSION_COOKIE_NAME = "health_city_browser_session";
const CSRF_COOKIE_NAME = "health_platform_csrf";
const ACTIVE_ACCOUNT_STATES = new Set(["active", "enabled", "启用"]);
const KNOWN_ROLES = new Set(["commission", "institution", "insurance", "citizen", "county"]);
const ACCOUNT_TYPES_BY_ROLE = Object.freeze({
  commission: new Set(["manager", "identity_admin", "auditor", "quality_officer", "blood_quality"]),
  institution: new Set(["manager", "doctor", "nurse", "pharmacist", "technician", "blood_technologist", "quality_officer"]),
  insurance: new Set(["manager", "reviewer", "settlement"]),
  citizen: new Set(["resident", "guardian"]),
  county: new Set(["manager", "clinician", "coordinator"])
});
const ROLE_PERMISSIONS = Object.freeze({
  commission: ["platform.overview.read", "identity.directory.review", "security.audit.read", "security.control.manage"],
  institution: ["institution.workspace.read", "care.delivery.manage", "referral.collaborate"],
  insurance: ["insurance.workspace.read", "insurance.claim.review", "payment.reconcile"],
  citizen: ["citizen.workspace.read", "resident.record.read", "resident.authorization.manage"],
  county: ["county.workspace.read", "county.coordination.manage", "referral.collaborate"]
});
const STRONG_ASSURANCE_LEVELS = new Set(["aal2", "aal3", "mfa", "phr", "urn:mace:incommon:iap:silver"]);
const USER_IDENTITY_FIELDS = Object.freeze([
  "id", "username", "name", "role", "roleName", "accountType", "orgCode", "orgName", "orgType", "orgLevel",
  "dataScope", "home", "residentId", "accountId", "doctorId", "nurseId", "regionCode"
]);

class IdentityPolicyError extends Error {
  constructor(code, message, statusCode = 403) {
    super(message);
    this.name = "IdentityPolicyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function text(value) {
  return String(value || "").trim();
}

function isProduction(env = process.env) {
  return text(env.NODE_ENV).toLowerCase() === "production";
}

function normalizeIssuer(value) {
  const issuer = text(value);
  if (!issuer) return "";
  try {
    const parsed = new URL(issuer);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return issuer.replace(/\/$/, "");
  }
}

function externalIdentityKey(identity = {}) {
  const issuer = normalizeIssuer(identity.issuer || identity.externalIssuer || identity.iss);
  const subject = text(identity.subject || identity.externalSubject || identity.sub);
  if (!issuer || !subject) return "";
  return `${encodeURIComponent(issuer)}::${encodeURIComponent(subject)}`;
}

function normalizeAccountType(user = {}) {
  const aliases = {
    citizen: "resident",
    family_proxy: "guardian",
    family_proxy_guardian: "guardian",
    proxy: "guardian",
    admin: "manager",
    administrator: "manager"
  };
  const raw = text(user.accountType).toLowerCase();
  if (raw) return aliases[raw] || raw;
  if (user.doctorId) return "doctor";
  if (user.nurseId) return "nurse";
  if (user.role === "citizen") return "resident";
  if (KNOWN_ROLES.has(user.role)) return "manager";
  return "";
}

function organizationCompatible(role, organization = {}) {
  const type = text(organization.orgType).toLowerCase();
  if (role === "institution") return type === "medical_institution";
  if (role === "insurance") return type.includes("insurance");
  if (role === "county") return type === "county_consortium";
  if (role === "commission") return ["city", "district", "health_admin", "blood_center"].includes(type);
  return role === "citizen";
}

function validateLocalAccount(user, data = {}, options = {}) {
  if (!user || typeof user !== "object") throw new IdentityPolicyError("ACCOUNT_NOT_FOUND", "local account was not found", 401);
  const role = text(user.role).toLowerCase();
  if (!KNOWN_ROLES.has(role)) throw new IdentityPolicyError("UNKNOWN_ROLE_DENIED", "unknown account role is denied");
  const accountType = normalizeAccountType({ ...user, role });
  if (!ACCOUNT_TYPES_BY_ROLE[role]?.has(accountType)) {
    throw new IdentityPolicyError("UNKNOWN_ACCOUNT_TYPE_DENIED", "unknown or incompatible account type is denied");
  }
  const state = text(user.status || "enabled").toLowerCase();
  if (!ACTIVE_ACCOUNT_STATES.has(state)) throw new IdentityPolicyError("ACCOUNT_INACTIVE", "account is not active");

  const organizations = Array.isArray(data.authOrganizations) ? data.authOrganizations : [];
  const organization = organizations.find((item) => text(item.orgCode) === text(user.orgCode));
  if (role !== "citizen") {
    if (!text(user.orgCode) || !organization) throw new IdentityPolicyError("ORGANIZATION_BINDING_REQUIRED", "active organization binding is required");
    if (organization.status && !ACTIVE_ACCOUNT_STATES.has(text(organization.status).toLowerCase())) {
      throw new IdentityPolicyError("ORGANIZATION_INACTIVE", "bound organization is not active");
    }
    if (!organizationCompatible(role, organization)) {
      throw new IdentityPolicyError("ORGANIZATION_ROLE_MISMATCH", "account role is incompatible with the bound organization");
    }
  } else if (!text(user.residentId) && !text(user.accountId) && options.requireCitizenSubject !== false) {
    throw new IdentityPolicyError("CITIZEN_SUBJECT_BINDING_REQUIRED", "resident or household account binding is required");
  }
  return {
    user: { ...user, role, accountType },
    organization: organization || null
  };
}

function identitiesForUser(user = {}) {
  const identities = Array.isArray(user.externalIdentities) ? user.externalIdentities : [];
  const normalized = identities.map((item) => ({
    issuer: normalizeIssuer(item.issuer || item.externalIssuer),
    subject: text(item.subject || item.externalSubject),
    protocol: text(item.protocol || "oidc").toLowerCase()
  })).filter((item) => item.issuer && item.subject);
  const legacyIssuer = normalizeIssuer(user.externalIssuer);
  const legacySubject = text(user.externalSubject);
  if (legacyIssuer && legacySubject && !normalized.some((item) => item.issuer === legacyIssuer && item.subject === legacySubject)) {
    normalized.push({ issuer: legacyIssuer, subject: legacySubject, protocol: "oidc" });
  }
  return normalized;
}

function resolveExternalIdentity(claims = {}, data = {}, options = {}) {
  const expectedIssuer = normalizeIssuer(options.expectedIssuer);
  const claimedIssuer = normalizeIssuer(claims.iss || claims.issuer);
  if (expectedIssuer && claimedIssuer && expectedIssuer !== claimedIssuer) {
    throw new IdentityPolicyError("EXTERNAL_ISSUER_MISMATCH", "external identity issuer does not match the configured provider", 401);
  }
  const issuer = claimedIssuer || expectedIssuer;
  const subject = text(claims.sub || claims.subject);
  const key = externalIdentityKey({ issuer, subject });
  if (!key) throw new IdentityPolicyError("EXTERNAL_IDENTITY_INCOMPLETE", "issuer and subject are required", 401);

  const users = Array.isArray(data.authUsers) ? data.authUsers : [];
  const matches = users.filter((user) => identitiesForUser(user).some((item) => externalIdentityKey(item) === key));
  if (matches.length > 1) throw new IdentityPolicyError("EXTERNAL_IDENTITY_CONFLICT", "external identity is bound more than once", 409);
  if (!matches.length) {
    const legacyMatches = users.filter((user) => text(user.externalSubject) === subject && !normalizeIssuer(user.externalIssuer));
    return {
      status: legacyMatches.length ? "legacy-binding-review-required" : "controlled-binding-required",
      issuer,
      subject,
      key,
      warnings: legacyMatches.length ? ["legacy subject-only binding is not accepted at runtime"] : []
    };
  }

  const validated = validateLocalAccount(matches[0], data);
  const claimedOrgCode = text(claims.orgCode || claims.org_code || claims.organizationCode || claims.dept_code || claims.departmentCode);
  if (claimedOrgCode && claimedOrgCode !== text(validated.user.orgCode)) {
    throw new IdentityPolicyError("EXTERNAL_ORGANIZATION_MISMATCH", "external and local organization bindings do not match");
  }
  return {
    status: "matched-existing-user",
    issuer,
    subject,
    key,
    warnings: [],
    user: validated.user,
    organization: validated.organization
  };
}

function bindExternalIdentity(data, localUserId, identity = {}) {
  const issuer = normalizeIssuer(identity.issuer || identity.externalIssuer);
  const subject = text(identity.subject || identity.externalSubject);
  const key = externalIdentityKey({ issuer, subject });
  if (!key) throw new IdentityPolicyError("EXTERNAL_IDENTITY_INCOMPLETE", "issuer and subject are required for binding", 400);
  const users = Array.isArray(data.authUsers) ? data.authUsers : [];
  const conflict = users.find((user) => user.id !== localUserId && identitiesForUser(user).some((item) => externalIdentityKey(item) === key));
  if (conflict) throw new IdentityPolicyError("EXTERNAL_IDENTITY_CONFLICT", "issuer and subject are already bound", 409);
  let bound = null;
  data.authUsers = users.map((user) => {
    if (user.id !== localUserId) return user;
    validateLocalAccount(user, data);
    const existing = identitiesForUser(user);
    const sameSubjectDifferentIssuer = existing.find((item) => item.subject === subject && item.issuer !== issuer);
    if (sameSubjectDifferentIssuer && identity.confirmIssuerMigration !== true) {
      throw new IdentityPolicyError("EXTERNAL_ISSUER_CHANGE_REVIEW_REQUIRED", "subject issuer change requires a separate reviewed migration", 409);
    }
    const nextIdentity = { issuer, subject, protocol: text(identity.protocol || "oidc").toLowerCase(), boundAt: new Date().toISOString() };
    const externalIdentities = [...existing.filter((item) => externalIdentityKey(item) !== key), nextIdentity];
    bound = { ...user, externalIssuer: issuer, externalSubject: subject, externalIdentities };
    return bound;
  });
  if (!bound) throw new IdentityPolicyError("ACCOUNT_NOT_FOUND", "local account was not found", 404);
  return { user: bound, identityKey: key, issuer, subject };
}

function validateLiveSession(session, data = {}) {
  if (!session?.user?.id) throw new IdentityPolicyError("SESSION_INVALID", "session identity is invalid", 401);
  const live = (Array.isArray(data.authUsers) ? data.authUsers : []).find((item) => item.id === session.user.id);
  const validated = validateLocalAccount(live, data);
  const snapshotType = normalizeAccountType(session.user);
  const changed = text(session.user.role) !== validated.user.role
    || snapshotType !== validated.user.accountType
    || text(session.user.orgCode) !== text(validated.user.orgCode);
  if (changed) throw new IdentityPolicyError("SESSION_IDENTITY_CHANGED", "account role, account type or organization changed; sign in again", 401);
  return validated;
}

function publicIdentity(user = {}) {
  const safe = {};
  USER_IDENTITY_FIELDS.forEach((field) => {
    if (user[field] !== undefined && user[field] !== null && user[field] !== "") safe[field] = user[field];
  });
  safe.accountType = normalizeAccountType(user);
  return safe;
}

function identityClaims(user = {}) {
  const role = text(user.role);
  const explicit = Array.isArray(user.permissions) ? user.permissions.map(text).filter(Boolean) : [];
  const permissions = [...new Set([...(ROLE_PERMISSIONS[role] || []), ...explicit])].sort();
  return {
    role,
    accountType: normalizeAccountType(user),
    permissions,
    organizationScope: text(user.orgCode),
    regionScope: text(user.regionCode || "active"),
    dataScope: text(user.dataScope),
    defaultPolicy: "deny"
  };
}

function parseCookies(header) {
  return text(header).split(";").reduce((result, part) => {
    const index = part.indexOf("=");
    if (index < 1) return result;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { result[name] = decodeURIComponent(value); } catch { result[name] = value; }
    return result;
  }, {});
}

function sessionTransport(env = process.env) {
  const configured = text(env.AUTH_SESSION_TRANSPORT).toLowerCase();
  const cookieEnabled = configured === "cookie" || configured === "hybrid" || !configured;
  const bearerEnabled = configured === "bearer" || configured === "hybrid"
    || (!isProduction(env) && configured !== "cookie")
    || text(env.AUTH_BEARER_COMPATIBILITY).toLowerCase() === "enabled";
  return { cookieEnabled, bearerEnabled, mode: cookieEnabled ? (bearerEnabled ? "hybrid" : "cookie") : "bearer" };
}

function sessionFromRequest(req, currentSession, env = process.env) {
  const transport = sessionTransport(env);
  const authorization = text(req?.headers?.authorization);
  if (authorization && !transport.bearerEnabled) {
    throw new IdentityPolicyError("BEARER_AUTH_DISABLED", "bearer authentication is disabled for this runtime", 401);
  }
  let source = authorization ? "bearer" : "none";
  let request = req;
  if (!authorization && transport.cookieEnabled) {
    const token = parseCookies(req?.headers?.cookie)[SESSION_COOKIE_NAME];
    if (token) {
      source = "cookie";
      request = { ...req, headers: { ...(req.headers || {}), authorization: `Bearer ${token}` } };
    }
  }
  return { session: currentSession(request), source, transport };
}

function csrfSecret(env = process.env) {
  return text(env.CSRF_SECRET)
    || text(env.SESSION_SECRETS).split(",").map(text).filter(Boolean)[0]
    || text(env.SESSION_SECRET)
    || (isProduction(env) ? "" : "health-platform-demo-csrf-secret-not-for-production");
}

function csrfToken(session, env = process.env) {
  const secret = csrfSecret(env);
  if (!secret || !session?.sessionId) return "";
  return createHmac("sha256", secret).update(`csrf:${session.sessionId}`).digest("base64url");
}

function secureEqual(left, right) {
  const a = Buffer.from(text(left));
  const b = Buffer.from(text(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireCsrf(req, resolved, env = process.env) {
  if (resolved.source !== "cookie" || !["POST", "PUT", "PATCH", "DELETE"].includes(text(req.method).toUpperCase())) return true;
  const expected = csrfToken(resolved.session, env);
  const supplied = text(req.headers?.["x-csrf-token"]);
  const cookie = parseCookies(req.headers?.cookie)[CSRF_COOKIE_NAME];
  if (!expected || !supplied || !cookie || !secureEqual(expected, supplied) || !secureEqual(expected, cookie)) {
    throw new IdentityPolicyError("CSRF_VALIDATION_FAILED", "valid double-submit CSRF token is required", 403);
  }
  return true;
}

function appendSetCookie(res, value) {
  if (!res || typeof res.setHeader !== "function") return;
  const existing = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : undefined;
  const values = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader("Set-Cookie", [...values, value]);
}

function cookieAttributes(env = process.env) {
  const sameSite = ["Strict", "Lax", "None"].find((item) => item.toLowerCase() === text(env.AUTH_COOKIE_SAME_SITE || "Strict").toLowerCase()) || "Strict";
  const secure = isProduction(env) || text(env.AUTH_COOKIE_SECURE).toLowerCase() === "true" || sameSite === "None";
  return `Path=/; HttpOnly; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
}

function issueSessionCookies(res, session, env = process.env) {
  if (!sessionTransport(env).cookieEnabled || !session?.token) return;
  const maxAge = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
  appendSetCookie(res, `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.token)}; ${cookieAttributes(env)}; Max-Age=${maxAge}`);
  const csrf = csrfToken(session, env);
  if (csrf) {
    const sameSite = text(env.AUTH_COOKIE_SAME_SITE || "Strict");
    const secure = isProduction(env) || text(env.AUTH_COOKIE_SECURE).toLowerCase() === "true" || sameSite.toLowerCase() === "none";
    appendSetCookie(res, `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrf)}; Path=/; SameSite=${sameSite}${secure ? "; Secure" : ""}; Max-Age=${maxAge}`);
  }
}

function clearSessionCookies(res, env = process.env) {
  if (!sessionTransport(env).cookieEnabled) return;
  appendSetCookie(res, `${SESSION_COOKIE_NAME}=; ${cookieAttributes(env)}; Max-Age=0`);
  appendSetCookie(res, `${CSRF_COOKIE_NAME}=; Path=/; SameSite=${text(env.AUTH_COOKIE_SAME_SITE || "Strict")}; Max-Age=0`);
}

function sessionResponse(session, env = process.env) {
  const transport = sessionTransport(env);
  return {
    expiresAt: session.expiresAt,
    user: publicIdentity(session.user),
    transport: transport.mode,
    ...(transport.bearerEnabled ? { token: session.token } : {})
  };
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stepUpStatus(session, env = process.env, now = Date.now()) {
  if (!isProduction(env)) return { ok: true, mode: "development-bypass", productionEvidence: false };
  const user = session?.user || {};
  const assurance = text(user.assuranceLevel || user.acr).toLowerCase();
  const authTime = timestampMs(user.stepUpAt || user.authTime || user.auth_time);
  const maxAgeSeconds = Math.min(3600, Math.max(60, Number(env.AUTH_STEP_UP_MAX_AGE_SECONDS || 600) || 600));
  const ok = STRONG_ASSURANCE_LEVELS.has(assurance) && authTime > 0 && now >= authTime && now - authTime <= maxAgeSeconds * 1000;
  return { ok, assurance, authTime: authTime ? new Date(authTime).toISOString() : "", maxAgeSeconds, mode: "provider-verified", productionEvidence: ok };
}

function requireStepUp(session, env = process.env) {
  const status = stepUpStatus(session, env);
  if (!status.ok) throw new IdentityPolicyError("STEP_UP_REQUIRED", "recent provider-verified strong authentication is required", 403);
  return status;
}

function securityReadiness(env = process.env) {
  const transport = sessionTransport(env);
  const samlConfigured = ["SAML_ENTRY_POINT", "SAML_ENTITY_ID", "SAML_AUDIENCE", "SAML_IDP_CERT_FINGERPRINT"]
    .every((name) => Boolean(text(env[name])));
  const samlStrict = samlConfigured
    && text(env.SAML_REQUIRE_SIGNED_ASSERTIONS).toLowerCase() === "true"
    && text(env.SAML_REQUIRE_SIGNED_RESPONSE).toLowerCase() === "true"
    && text(env.SAML_NAME_ID_FORMAT).includes("persistent");
  const blockers = [
    ...(!transport.cookieEnabled ? ["production cookie session transport is not enabled"] : []),
    ...(transport.bearerEnabled && isProduction(env) ? ["production bearer compatibility remains enabled"] : []),
    ...(!csrfSecret(env) ? ["CSRF/session signing secret is not configured"] : []),
    ...(!samlStrict ? ["SAML strict signing, audience and persistent subject contract is incomplete"] : []),
    "SAML assertion runtime validation and real IdP joint-test evidence are not complete",
    "central cookie and CSRF wiring still requires controlled production-site verification"
  ];
  return {
    productionReady: false,
    transport,
    csrf: { mode: "signed-double-submit", configured: Boolean(csrfSecret(env)) },
    stepUp: { providerVerifiedRequired: true, maxAgeSeconds: Number(env.AUTH_STEP_UP_MAX_AGE_SECONDS || 600) || 600 },
    saml: {
      configured: samlConfigured,
      strictContractReady: samlStrict,
      runtimeAdapterReady: false,
      signatureRequired: true,
      responseSignatureRequired: true,
      persistentNameIdRequired: true,
      productionReady: false
    },
    blockers
  };
}

module.exports = {
  ACCOUNT_TYPES_BY_ROLE,
  CSRF_COOKIE_NAME,
  IdentityPolicyError,
  KNOWN_ROLES,
  SESSION_COOKIE_NAME,
  bindExternalIdentity,
  clearSessionCookies,
  csrfToken,
  externalIdentityKey,
  identityClaims,
  issueSessionCookies,
  normalizeAccountType,
  normalizeIssuer,
  publicIdentity,
  requireCsrf,
  requireStepUp,
  resolveExternalIdentity,
  securityReadiness,
  sessionFromRequest,
  sessionResponse,
  sessionTransport,
  stepUpStatus,
  validateLiveSession,
  validateLocalAccount
};
