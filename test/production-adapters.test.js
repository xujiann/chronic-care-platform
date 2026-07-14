const assert = require("node:assert/strict");
const test = require("node:test");

const {
  digestPhoneVerificationCode,
  fetchIdentityDirectory,
  fetchOidcUserInfo,
  generatePhoneVerificationCode,
  productionAdapterCenter,
  refreshOidcAccessToken,
  revokeOidcToken,
  sendSmsVerificationCode
} = require("../production-adapters");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

test("OIDC adapter discovers UserInfo and returns verified subject claims", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("openid-configuration")) {
      return jsonResponse({ userinfo_endpoint: "https://identity.example.gov.cn/userinfo" });
    }
    return jsonResponse({ sub: "external-health-001", preferred_username: "health", org_code: "ORG-HEALTH-DL", roles: ["commission"] });
  };
  const result = await fetchOidcUserInfo("upstream-access-token", {
    env: {
      NODE_ENV: "production",
      OIDC_ISSUER_URL: "https://identity.example.gov.cn/real-issuer",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "client-secret",
      IDENTITY_ADAPTER_TIMEOUT_MS: "5000"
    },
    fetchImpl
  });

  assert.equal(result.claims.sub, "external-health-001");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers.Authorization, "Bearer upstream-access-token");
});

test("OIDC lifecycle refreshes and revokes tokens without persisting credentials", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("openid-configuration")) {
      return jsonResponse({
        token_endpoint: "https://identity.example.gov.cn/token",
        revocation_endpoint: "https://identity.example.gov.cn/revoke"
      });
    }
    if (String(url).endsWith("/token")) {
      return jsonResponse({ access_token: "rotated-access-token", refresh_token: "rotated-refresh-token", token_type: "Bearer", expires_in: 600 });
    }
    return jsonResponse({});
  };
  const env = {
    NODE_ENV: "production",
    OIDC_ISSUER_URL: "https://identity.example.gov.cn/real-issuer",
    OIDC_CLIENT_ID: "health-platform",
    OIDC_CLIENT_SECRET: "client-secret"
  };
  const refreshed = await refreshOidcAccessToken("initial-refresh-token", { env, fetchImpl });
  assert.equal(refreshed.accessToken, "rotated-access-token");
  assert.equal(refreshed.refreshRotated, true);
  assert.match(requests.find((item) => item.url.endsWith("/token")).options.body, /grant_type=refresh_token/);
  const receipt = await revokeOidcToken("rotated-access-token", { env, fetchImpl });
  assert.equal(receipt.status, "revoked");
  assert.equal(receipt.credentialsPersisted, false);
  assert.doesNotMatch(JSON.stringify(receipt), /rotated-access-token|client-secret/);
});

test("identity directory adapter normalizes SCIM users and keeps credentials out of results", async () => {
  let request;
  const directory = await fetchIdentityDirectory({
    env: {
      NODE_ENV: "production",
      OIDC_ISSUER_URL: "https://identity.example.gov.cn",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "client-secret",
      IDENTITY_DIRECTORY_URL: "https://directory.example.gov.cn/scim/v2/Users",
      IDENTITY_DIRECTORY_TOKEN: "directory-secret"
    },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse({
        totalResults: 2,
        Resources: [
          { id: "sub-health", userName: "health", displayName: "Health operator", active: true, orgCode: "ORG-HEALTH-DL" },
          { id: "sub-old", userName: "retired-user", displayName: "Retired user", active: false, orgCode: "MR1" }
        ]
      });
    }
  });
  assert.equal(directory.records.length, 2);
  assert.equal(directory.records[1].active, false);
  assert.match(request.url, /startIndex=1/);
  assert.equal(request.options.headers.Authorization, "Bearer directory-secret");
  assert.doesNotMatch(JSON.stringify(directory), /directory-secret|IDENTITY_DIRECTORY_URL/);
});

test("production identity and SMS adapters require HTTPS", async () => {
  await assert.rejects(() => fetchOidcUserInfo("token", {
    env: {
      NODE_ENV: "production",
      OIDC_ISSUER_URL: "http://identity.internal",
      OIDC_USERINFO_URL: "http://identity.internal/userinfo",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "secret"
    },
    fetchImpl: async () => jsonResponse({ sub: "user" })
  }), /HTTPS/);

  await assert.rejects(() => sendSmsVerificationCode({ phone: "13800000000", code: "123456" }, {
    env: {
      NODE_ENV: "production",
      SMS_GATEWAY_URL: "http://sms.internal/send",
      SMS_TEMPLATE_ID: "login-code"
    },
    fetchImpl: async () => jsonResponse({ providerMessageId: "sms-1" })
  }), /HTTPS/);
});

test("SMS adapter records provider acceptance without exposing credentials", async () => {
  let request;
  const receipt = await sendSmsVerificationCode({
    phone: "13800000000",
    code: "654321",
    expiresInMinutes: 5,
    clientRequestId: "phone-code-001"
  }, {
    env: {
      NODE_ENV: "production",
      SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
      SMS_GATEWAY_TOKEN: "provider-token",
      SMS_TEMPLATE_ID: "resident-login-code",
      SMS_SENDER: "health-platform"
    },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse({ providerMessageId: "provider-sms-001", status: "accepted", acceptedAt: "2026-07-11T02:00:00.000Z" });
    }
  });

  assert.equal(receipt.providerMessageId, "provider-sms-001");
  assert.equal(request.options.headers.Authorization, "Bearer provider-token");
  assert.equal(JSON.parse(request.options.body).parameters.code, "654321");
  assert.equal(JSON.stringify(receipt).includes("provider-token"), false);
});

test("SMS adapter rejects negative provider receipts", async () => {
  await assert.rejects(() => sendSmsVerificationCode({ phone: "13800000000", code: "654321" }, {
    env: {
      NODE_ENV: "production",
      SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
      SMS_TEMPLATE_ID: "resident-login-code"
    },
    fetchImpl: async () => jsonResponse({ providerMessageId: "provider-sms-rejected", status: "rejected" })
  }), /rejected the request/);
});

test("phone verification codes are random and stored as keyed digests", () => {
  const code = generatePhoneVerificationCode();
  assert.match(code, /^\d{6}$/);
  const digest = digestPhoneVerificationCode("13800000000", code, "session-secret");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digestPhoneVerificationCode("13800000000", code, "session-secret"), digest);
  assert.notEqual(digestPhoneVerificationCode("13800000000", "000000", "session-secret"), digest);
});

test("adapter center separates configured code from site joint-test readiness", () => {
  const center = productionAdapterCenter({
    NODE_ENV: "production",
    OIDC_ISSUER_URL: "https://identity.example.gov.cn",
    OIDC_CLIENT_ID: "health-platform",
    OIDC_CLIENT_SECRET: "secret",
    IDENTITY_DIRECTORY_URL: "https://identity.example.gov.cn/scim/v2/Users",
    IDENTITY_DIRECTORY_TOKEN: "directory-secret",
    SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
    SMS_TEMPLATE_ID: "resident-login-code"
  });
  assert.equal(center.ready, true);
  assert.equal(center.adapterReady, true);
  assert.equal(center.identityLifecycleReady, true);
  assert.equal(center.productionReady, false);
  assert.equal(center.blockers.includes("real provider joint-test receipts and site signoff"), true);
});
