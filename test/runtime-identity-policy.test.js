"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  bindExternalIdentity,
  clearSessionCookies,
  csrfToken,
  externalIdentityKey,
  identityClaims,
  issueSessionCookies,
  requireCsrf,
  requireStepUp,
  resolveExternalIdentity,
  securityReadiness,
  sessionFromRequest,
  sessionResponse,
  sessionTransport,
  validateLiveSession,
  validateLocalAccount
} = require("../src/identity-security/runtime-identity-policy");

function fixture() {
  return {
    authOrganizations: [
      { orgCode: "HEALTH", orgType: "health_admin", status: "enabled" },
      { orgCode: "HOSPITAL", orgType: "medical_institution", status: "enabled" }
    ],
    authUsers: [
      {
        id: "health-1", username: "health", name: "Health Admin", role: "commission", accountType: "identity_admin",
        orgCode: "HEALTH", status: "enabled", externalIssuer: "https://idp-a.example/issuer", externalSubject: "shared-subject"
      },
      {
        id: "doctor-1", username: "doctor", name: "Doctor", role: "institution", accountType: "doctor",
        orgCode: "HOSPITAL", status: "enabled", externalIdentities: [
          { issuer: "https://idp-b.example/issuer", subject: "shared-subject", protocol: "oidc" }
        ]
      }
    ]
  };
}

function responseHeaders() {
  const headers = new Map();
  return {
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    headers
  };
}

test("external subjects are uniquely resolved inside their issuer namespace", () => {
  const data = fixture();
  const first = resolveExternalIdentity({ iss: "https://idp-a.example/issuer", sub: "shared-subject", org_code: "HEALTH" }, data);
  const second = resolveExternalIdentity({ iss: "https://idp-b.example/issuer", sub: "shared-subject", org_code: "HOSPITAL" }, data);
  assert.equal(first.user.id, "health-1");
  assert.equal(second.user.id, "doctor-1");
  assert.notEqual(first.key, second.key);
  assert.equal(externalIdentityKey({ issuer: first.issuer, subject: first.subject }), first.key);
  assert.throws(
    () => resolveExternalIdentity({ iss: "https://evil.example", sub: "shared-subject" }, data, { expectedIssuer: "https://idp-a.example/issuer" }),
    (error) => error.code === "EXTERNAL_ISSUER_MISMATCH" && error.statusCode === 401
  );
});

test("subject-only legacy bindings never authenticate and duplicate namespaced bindings conflict", () => {
  const data = fixture();
  data.authUsers.push({
    id: "legacy-1", username: "legacy", role: "commission", accountType: "manager", orgCode: "HEALTH", status: "enabled",
    externalSubject: "legacy-subject"
  });
  const legacy = resolveExternalIdentity({ iss: "https://idp-a.example/issuer", sub: "legacy-subject" }, data);
  assert.equal(legacy.status, "legacy-binding-review-required");

  data.authUsers.push({
    id: "duplicate-1", username: "duplicate", role: "commission", accountType: "manager", orgCode: "HEALTH", status: "enabled",
    externalIssuer: "https://idp-a.example/issuer", externalSubject: "shared-subject"
  });
  assert.throws(
    () => resolveExternalIdentity({ iss: "https://idp-a.example/issuer", sub: "shared-subject" }, data),
    (error) => error.code === "EXTERNAL_IDENTITY_CONFLICT" && error.statusCode === 409
  );
});

test("unknown role, account type, account state and organization binding fail closed", () => {
  const data = fixture();
  assert.throws(() => validateLocalAccount({ id: "x", role: "root", accountType: "manager", status: "enabled", orgCode: "HEALTH" }, data), /unknown account role/);
  assert.throws(() => validateLocalAccount({ id: "x", role: "institution", accountType: "superuser", status: "enabled", orgCode: "HOSPITAL" }, data), /account type/);
  assert.throws(() => validateLocalAccount({ id: "x", role: "institution", accountType: "doctor", status: "停用", orgCode: "HOSPITAL" }, data), /not active/);
  assert.throws(() => validateLocalAccount({ id: "x", role: "institution", accountType: "doctor", status: "enabled", orgCode: "HEALTH" }, data), /incompatible/);
  assert.throws(() => validateLocalAccount({ id: "x", role: "insurance", status: "enabled", orgCode: "MISSING" }, data), /organization binding/);
});

test("binding persists issuer plus subject and blocks cross-account reassignment", () => {
  const data = fixture();
  const bound = bindExternalIdentity(data, "doctor-1", {
    issuer: "https://hospital-id.example/issuer/",
    subject: "doctor-new-subject",
    protocol: "oidc"
  });
  assert.equal(bound.issuer, "https://hospital-id.example/issuer");
  assert.equal(data.authUsers.find((item) => item.id === "doctor-1").externalSubject, "doctor-new-subject");
  assert.throws(() => bindExternalIdentity(data, "health-1", {
    issuer: "https://hospital-id.example/issuer",
    subject: "doctor-new-subject"
  }), (error) => error.code === "EXTERNAL_IDENTITY_CONFLICT");
});

test("live session validation revokes trust after status, role, account type or organization changes", () => {
  const data = fixture();
  const session = { user: { ...data.authUsers[0] } };
  assert.equal(validateLiveSession(session, data).user.id, "health-1");
  data.authUsers[0] = { ...data.authUsers[0], role: "institution", accountType: "doctor", orgCode: "HOSPITAL" };
  assert.throws(() => validateLiveSession(session, data), (error) => error.code === "SESSION_IDENTITY_CHANGED");
  data.authUsers[0] = { ...data.authUsers[0], status: "停用" };
  assert.throws(() => validateLiveSession(session, data), (error) => error.code === "ACCOUNT_INACTIVE");
});

test("production sessions use secure HttpOnly cookies and omit bearer unless explicitly enabled", () => {
  const env = { NODE_ENV: "production", SESSION_SECRET: "a-production-session-secret-that-is-long-enough" };
  const session = {
    sessionId: "session-1",
    token: "signed.session.token",
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    user: fixture().authUsers[0]
  };
  const response = responseHeaders();
  issueSessionCookies(response, session, env);
  const cookies = response.getHeader("Set-Cookie");
  assert.equal(Array.isArray(cookies), true);
  assert.match(cookies[0], new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(cookies[0], /HttpOnly/);
  assert.match(cookies[0], /SameSite=Strict/);
  assert.match(cookies[0], /Secure/);
  assert.match(cookies[1], new RegExp(`^${CSRF_COOKIE_NAME}=`));
  assert.equal(Object.hasOwn(sessionResponse(session, env), "token"), false);
  assert.equal(sessionResponse(session, { NODE_ENV: "development" }).token, session.token);

  clearSessionCookies(response, env);
  assert.equal(response.getHeader("Set-Cookie").some((item) => item.includes("Max-Age=0")), true);
});

test("cookie context wins over a stale bearer when both credentials are present", () => {
  const env = { NODE_ENV: "production", SESSION_SECRET: "a-production-session-secret-that-is-long-enough" };
  let resolvedAuthorization = "";
  const resolved = sessionFromRequest({
    method: "GET",
    headers: {
      authorization: "Bearer stale-script-readable-token",
      cookie: `${SESSION_COOKIE_NAME}=current-cookie-session`
    }
  }, (request) => {
    resolvedAuthorization = request.headers.authorization;
    return { sessionId: "cookie-session", user: fixture().authUsers[0] };
  }, env);

  assert.equal(resolved.source, "cookie");
  assert.equal(resolvedAuthorization, "Bearer current-cookie-session");
});

test("production bearer and hybrid modes require the explicit compatibility gate and remain NO-GO", () => {
  const base = { NODE_ENV: "production", SESSION_SECRET: "a-production-session-secret-that-is-long-enough" };
  for (const mode of ["bearer", "hybrid"]) {
    const env = { ...base, AUTH_SESSION_TRANSPORT: mode };
    const transport = sessionTransport(env);
    assert.equal(transport.bearerEnabled, false, `${mode} must not bypass the compatibility gate`);
    assert.equal(transport.productionConfigurationValid, false);
    assert.equal(Object.hasOwn(sessionResponse({ token: "must-not-leak", user: fixture().authUsers[0] }, env), "token"), false);
    assert.throws(
      () => sessionFromRequest({ headers: { authorization: "Bearer rejected" } }, () => null, env),
      (error) => error.code === "BEARER_AUTH_DISABLED"
    );
    const readiness = securityReadiness(env);
    assert.equal(readiness.productionReady, false);
    assert.equal(readiness.blockers.includes("production bearer compatibility requires AUTH_BEARER_COMPATIBILITY=enabled"), true);
  }

  const explicitlyEnabled = {
    ...base,
    AUTH_SESSION_TRANSPORT: "hybrid",
    AUTH_BEARER_COMPATIBILITY: "enabled"
  };
  assert.equal(sessionTransport(explicitlyEnabled).bearerEnabled, true);
  assert.equal(sessionResponse({ token: "explicit-compatibility-token", user: fixture().authUsers[0] }, explicitlyEnabled).token, "explicit-compatibility-token");
  const readiness = securityReadiness(explicitlyEnabled);
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.blockers.includes("production bearer compatibility remains enabled"), true);
});

test("cookie mutation requires matching signed double-submit CSRF token", () => {
  const env = { NODE_ENV: "production", SESSION_SECRET: "a-production-session-secret-that-is-long-enough" };
  const session = { sessionId: "session-csrf", user: fixture().authUsers[0] };
  const token = csrfToken(session, env);
  const req = {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=session-token; ${CSRF_COOKIE_NAME}=${token}`,
      "x-csrf-token": token
    }
  };
  const resolved = sessionFromRequest(req, () => session, env);
  assert.equal(resolved.source, "cookie");
  assert.equal(requireCsrf(req, resolved, env), true);
  assert.throws(() => requireCsrf({ ...req, headers: { ...req.headers, "x-csrf-token": "wrong" } }, resolved, env), (error) => error.code === "CSRF_VALIDATION_FAILED");
});

test("production high-risk actions require recent strong provider authentication", () => {
  const env = { NODE_ENV: "production", AUTH_STEP_UP_MAX_AGE_SECONDS: "600" };
  const now = Date.now();
  const strong = { user: { assuranceLevel: "aal2", authTime: new Date(now - 1000).toISOString() } };
  assert.equal(requireStepUp(strong, env).ok, true);
  assert.throws(() => requireStepUp({ user: { assuranceLevel: "aal1", authTime: new Date(now).toISOString() } }, env), (error) => error.code === "STEP_UP_REQUIRED");
  assert.throws(() => requireStepUp({ user: { assuranceLevel: "aal2", authTime: new Date(now - 700000).toISOString() } }, env), (error) => error.code === "STEP_UP_REQUIRED");
});

test("identity context only exposes whitelisted fields and SAML remains truthful NO-GO", () => {
  const user = { ...fixture().authUsers[0], password: "secret", passwordHash: "secret-hash", permissions: ["custom.read"] };
  const claims = identityClaims(user);
  assert.equal(claims.defaultPolicy, "deny");
  assert.equal(claims.permissions.includes("custom.read"), true);
  assert.equal(JSON.stringify(claims).includes("secret"), false);

  const readiness = securityReadiness({
    NODE_ENV: "production",
    SESSION_SECRET: "a-production-session-secret-that-is-long-enough",
    SAML_ENTRY_POINT: "https://idp.example/sso",
    SAML_ENTITY_ID: "health-platform",
    SAML_AUDIENCE: "health-platform",
    SAML_IDP_CERT_FINGERPRINT: "sha256:abc",
    SAML_REQUIRE_SIGNED_ASSERTIONS: "true",
    SAML_REQUIRE_SIGNED_RESPONSE: "true",
    SAML_NAME_ID_FORMAT: "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent"
  });
  assert.equal(readiness.saml.strictContractReady, true);
  assert.equal(readiness.saml.runtimeAdapterReady, false);
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.blockers.some((item) => /joint-test evidence/.test(item)), true);
});
