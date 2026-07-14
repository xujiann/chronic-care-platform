const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function request(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

test("identity lifecycle API binds, refreshes, revokes and safely applies directory deactivation", async (t) => {
  let directoryMode = "binding";
  const providerRequests = [];
  const identityProvider = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      providerRequests.push({ method: req.method, url: req.url, authorization: req.headers.authorization || "", body });
      const providerBase = `http://127.0.0.1:${identityProvider.address().port}`;
      if (req.url === "/issuer/.well-known/openid-configuration") {
        sendJson(res, 200, {
          userinfo_endpoint: `${providerBase}/userinfo`,
          token_endpoint: `${providerBase}/token`,
          revocation_endpoint: `${providerBase}/revoke`
        });
        return;
      }
      if (req.url === "/token") {
        sendJson(res, 200, { access_token: "provider-access-rotated", refresh_token: "provider-refresh-rotated", token_type: "Bearer", expires_in: 600 });
        return;
      }
      if (req.url === "/userinfo") {
        sendJson(res, 200, { sub: "provider-health-subject", preferred_username: "health", name: "Health operator", org_code: "ORG-HEALTH-DL", roles: ["commission"] });
        return;
      }
      if (req.url === "/revoke") {
        sendJson(res, 200, {});
        return;
      }
      if (req.url.startsWith("/scim/v2/Users")) {
        const resources = directoryMode === "self"
          ? [{ id: "provider-city-subject", userName: "city", displayName: "City operator", active: false, orgCode: "ORG-CITY-DL" }]
          : [
              { id: "provider-health-subject", userName: "health", displayName: "Health operator", active: directoryMode === "binding", orgCode: "ORG-HEALTH-DL" },
              { id: "provider-city-subject", userName: "city", displayName: "City operator", active: true, orgCode: "ORG-CITY-DL" },
              { id: "provider-new-subject", userName: "new-admin", displayName: "Unbound administrator", active: true, orgCode: "ORG-HEALTH-DL" }
            ];
        sendJson(res, 200, { totalResults: resources.length, Resources: resources });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    });
  });
  identityProvider.listen(0, "127.0.0.1");
  await once(identityProvider, "listening");

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-lifecycle-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const previousEnv = Object.fromEntries([
    "NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET",
    "IDENTITY_DIRECTORY_URL", "IDENTITY_DIRECTORY_TOKEN"
  ].map((key) => [key, process.env[key]]));
  const providerBase = `http://127.0.0.1:${identityProvider.address().port}`;
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "identity-lifecycle-api-test-session-secret-2026",
    OIDC_ISSUER_URL: `${providerBase}/issuer`,
    OIDC_CLIENT_ID: "health-platform",
    OIDC_CLIENT_SECRET: "provider-client-secret",
    IDENTITY_DIRECTORY_URL: `${providerBase}/scim/v2/Users`,
    IDENTITY_DIRECTORY_TOKEN: "provider-directory-secret"
  });
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    await new Promise((resolve) => identityProvider.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  const cityLogin = await request(baseUrl, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username: "city", password: "123456" }) });
  assert.equal(cityLogin.response.status, 200);
  const cityToken = cityLogin.body.token;
  const lifecycle = await request(baseUrl, "/api/auth/identity-lifecycle", cityToken);
  assert.equal(lifecycle.response.status, 200);
  assert.equal(lifecycle.body.identity.refreshConfigured, true);
  assert.equal(lifecycle.body.identity.revocationConfigured, true);
  assert.equal(lifecycle.body.identity.directoryConfigured, true);
  assert.equal(lifecycle.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(lifecycle.body), /provider-client-secret|provider-directory-secret|127\.0\.0\.1/);

  const unboundRefresh = await request(baseUrl, "/api/auth/oidc/refresh", "", { method: "POST", body: JSON.stringify({ refreshToken: "provider-refresh-unbound" }) });
  assert.equal(unboundRefresh.response.status, 403);

  const bindingPreview = await request(baseUrl, "/api/auth/identity-directory/preview", cityToken, { method: "POST", body: JSON.stringify({}) });
  assert.equal(bindingPreview.response.status, 200);
  assert.equal(bindingPreview.body.plan.summary.deactivations, 0);
  assert.equal(bindingPreview.body.plan.items.find((item) => item.username === "health").action, "controlled-binding-required");
  assert.equal(bindingPreview.body.plan.items.find((item) => item.username === "new-admin").action, "new-account-review-required");

  const missingBindingConfirmation = await request(baseUrl, "/api/auth/identity-directory/bind", cityToken, {
    method: "POST",
    body: JSON.stringify({ localUserId: "u-health", externalSubject: "provider-health-subject", note: "Identity binding reviewed." })
  });
  assert.equal(missingBindingConfirmation.response.status, 400);
  assert.equal(missingBindingConfirmation.body.code, "IDENTITY_BINDING_CONFIRMATION_REQUIRED");

  const healthBinding = await request(baseUrl, "/api/auth/identity-directory/bind", cityToken, {
    method: "POST",
    body: JSON.stringify({ localUserId: "u-health", externalSubject: "provider-health-subject", note: "Health identity and organization were reviewed against the directory.", confirmation: "BIND EXTERNAL IDENTITY" })
  });
  assert.equal(healthBinding.response.status, 200);
  assert.equal(healthBinding.body.result.username, "health");
  assert.equal(healthBinding.body.result.roleChanged, false);
  assert.equal(healthBinding.body.result.organizationChanged, false);

  const cityBinding = await request(baseUrl, "/api/auth/identity-directory/bind", cityToken, {
    method: "POST",
    body: JSON.stringify({ localUserId: "u-city", externalSubject: "provider-city-subject", note: "City operator identity was reviewed against the directory.", confirmation: "BIND EXTERNAL IDENTITY" })
  });
  assert.equal(cityBinding.response.status, 200);

  const refreshed = await request(baseUrl, "/api/auth/oidc/refresh", "", { method: "POST", body: JSON.stringify({ refreshToken: "provider-refresh-initial" }) });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.user.username, "health");
  assert.equal(refreshed.body.upstreamRefreshRotated, true);
  assert.equal(refreshed.body.upstreamRefreshToken, "provider-refresh-rotated");
  const refreshedToken = refreshed.body.token;
  assert.equal((await request(baseUrl, "/api/auth/me", refreshedToken)).response.status, 200);

  const revoked = await request(baseUrl, "/api/auth/oidc/revoke", refreshedToken, {
    method: "POST",
    body: JSON.stringify({ upstreamToken: "provider-access-rotated", tokenTypeHint: "access_token" })
  });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.localSessionRevoked, true);
  assert.equal(revoked.body.receipt.status, "revoked");
  assert.doesNotMatch(JSON.stringify(revoked.body), /provider-access-rotated|provider-client-secret/);
  assert.equal((await request(baseUrl, "/api/auth/me", refreshedToken)).response.status, 401);

  const healthLogin = await request(baseUrl, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username: "health", password: "123456" }) });
  assert.equal(healthLogin.response.status, 200);
  const healthToken = healthLogin.body.token;
  directoryMode = "normal";
  const preview = await request(baseUrl, "/api/auth/identity-directory/preview", cityToken, { method: "POST", body: JSON.stringify({}) });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.plan.summary.deactivations, 1);
  assert.equal(preview.body.plan.summary.bindingReviews >= 1, true);
  assert.equal(preview.body.plan.items.find((item) => item.username === "new-admin").action, "new-account-review-required");

  const missingConfirmation = await request(baseUrl, "/api/auth/identity-directory/apply", cityToken, { method: "POST", body: JSON.stringify({ note: "Review completed." }) });
  assert.equal(missingConfirmation.response.status, 400);
  assert.equal(missingConfirmation.body.code, "IDENTITY_DIRECTORY_CONFIRMATION_REQUIRED");

  directoryMode = "self";
  const selfDeactivation = await request(baseUrl, "/api/auth/identity-directory/apply", cityToken, {
    method: "POST",
    body: JSON.stringify({ note: "Self-deactivation protection regression.", confirmation: "APPLY IDENTITY DIRECTORY DEACTIVATIONS" })
  });
  assert.equal(selfDeactivation.response.status, 409);
  assert.equal(selfDeactivation.body.code, "IDENTITY_DIRECTORY_SELF_DEACTIVATION_BLOCKED");

  directoryMode = "normal";
  const applied = await request(baseUrl, "/api/auth/identity-directory/apply", cityToken, {
    method: "POST",
    body: JSON.stringify({ note: "Approved directory deactivation rehearsal for the bound health account.", confirmation: "APPLY IDENTITY DIRECTORY DEACTIVATIONS" })
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.result.applied.length, 1);
  assert.equal(applied.body.result.applied[0].username, "health");
  assert.equal(applied.body.result.revokedSessions, 1);
  assert.equal(applied.body.productionReady, false);
  assert.equal((await request(baseUrl, "/api/auth/me", healthToken)).response.status, 401);
  assert.equal((await request(baseUrl, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username: "health", password: "123456" }) })).response.status, 401);
  assert.equal((await request(baseUrl, "/api/auth/oidc/refresh", "", { method: "POST", body: JSON.stringify({ refreshToken: "provider-refresh-after-disable" }) })).response.status, 403);

  const state = await request(baseUrl, "/api/state", cityToken);
  assert.equal(state.body.authUsers.find((item) => item.username === "health").status, "停用");
  assert.equal(state.body.authUsers.find((item) => item.username === "health").externalSubject, "provider-health-subject");
  assert.equal(state.body.securityEvents.some((item) => item.action === "external identity binding"), true);
  assert.equal(state.body.securityEvents.some((item) => item.action === "identity directory deactivation sync"), true);
  assert.equal(providerRequests.some((item) => item.url === "/token" && item.authorization.startsWith("Basic ")), true);
  assert.equal(providerRequests.some((item) => item.url === "/revoke" && item.body.includes("provider-access-rotated")), true);
});
