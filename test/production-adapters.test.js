const assert = require("node:assert/strict");
const test = require("node:test");

const {
  digestPhoneVerificationCode,
  fetchOidcUserInfo,
  generatePhoneVerificationCode,
  productionAdapterCenter,
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
    SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
    SMS_TEMPLATE_ID: "resident-login-code"
  });
  assert.equal(center.ready, true);
  assert.equal(center.adapterReady, true);
  assert.equal(center.productionReady, false);
  assert.equal(center.blockers.includes("real provider joint-test receipts and site signoff"), true);
});
