"use strict";

const assert = require("node:assert/strict");
const { constants, generateKeyPairSync, sign } = require("node:crypto");
const test = require("node:test");
const {
  createHttpJsonTransport,
  createIdentityAdapter,
  createSmsAdapter,
  probeSmsAdapterHealth,
  sendSmsVerificationCode,
  verifyOidcIdToken
} = require("../production-adapters");

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function oidcFixture(algorithm = "RS256") {
  const issuer = "https://identity.example.gov.cn/issuer";
  const clientId = "health-platform";
  const pair = algorithm === "ES256"
    ? generateKeyPairSync("ec", { namedCurve: "P-256" })
    : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `${algorithm.toLowerCase()}-key`;
  const jwk = pair.publicKey.export({ format: "jwk" });
  const env = {
    NODE_ENV: "production",
    OIDC_ISSUER_URL: issuer,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: "injected-secret",
    OIDC_CLOCK_SKEW_SECONDS: "30",
    IDENTITY_ADAPTER_TIMEOUT_MS: "100"
  };
  const discovery = {
    issuer,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    token_endpoint: `${issuer}/token`
  };
  function token(overrides = {}) {
    const now = 1787184000;
    const header = Buffer.from(JSON.stringify({ alg: algorithm, kid, typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({
      iss: issuer,
      aud: clientId,
      sub: "external-subject-1",
      iat: now - 10,
      exp: now + 300,
      nonce: "nonce-1",
      ...overrides
    })).toString("base64url");
    const keyOptions = algorithm === "PS256"
      ? { key: pair.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }
      : algorithm === "ES256"
        ? { key: pair.privateKey, dsaEncoding: "ieee-p1363" }
        : pair.privateKey;
    return `${header}.${claims}.${sign("sha256", Buffer.from(`${header}.${claims}`), keyOptions).toString("base64url")}`;
  }
  const fetchImpl = async (url) => String(url).endsWith("/jwks")
    ? jsonResponse({ keys: [{ ...jwk, kid, alg: algorithm, use: "sig" }] })
    : jsonResponse(discovery);
  return { env, fetchImpl, token };
}

for (const algorithm of ["RS256", "PS256", "ES256"]) {
  test(`OIDC ${algorithm} signature and trust claims are verified`, async () => {
    const fixture = oidcFixture(algorithm);
    const verified = await verifyOidcIdToken(fixture.token(), {
      env: fixture.env,
      fetchImpl: fixture.fetchImpl,
      nonce: "nonce-1",
      nowMs: 1787184000 * 1000
    });
    assert.equal(verified.signatureVerified, true);
    assert.equal(verified.algorithm, algorithm);
    assert.equal(verified.claims.sub, "external-subject-1");
    assert.doesNotMatch(JSON.stringify(verified), /injected-secret/);
  });
}

test("OIDC token validation rejects issuer audience expiry and nonce drift", async () => {
  const fixture = oidcFixture();
  const options = { env: fixture.env, fetchImpl: fixture.fetchImpl, nonce: "nonce-1", nowMs: 1787184000 * 1000 };
  await assert.rejects(() => verifyOidcIdToken(fixture.token({ iss: "https://attacker.invalid" }), options), { code: "OIDC_ID_TOKEN_ISSUER_MISMATCH" });
  await assert.rejects(() => verifyOidcIdToken(fixture.token({ aud: "other-client" }), options), { code: "OIDC_ID_TOKEN_AUDIENCE_MISMATCH" });
  await assert.rejects(() => verifyOidcIdToken(fixture.token({ exp: 1787183900 }), options), { code: "OIDC_ID_TOKEN_EXPIRED" });
  await assert.rejects(() => verifyOidcIdToken(fixture.token(), { ...options, nonce: "wrong" }), { code: "OIDC_ID_TOKEN_NONCE_MISMATCH" });
});

test("HTTP transport bounds timeout and redacts provider failures", async () => {
  const transport = createHttpJsonTransport({ fetchImpl: async () => new Promise(() => {}) });
  await assert.rejects(() => transport.request("https://provider.example/health", {
    timeoutMs: 100,
    headers: { Authorization: "Bearer must-not-leak" }
  }), (error) => error.code === "ADAPTER_TIMEOUT" && !/must-not-leak/.test(error.message));
});

test("SMS retries preserve a caller-supplied random request id and redact logs", async () => {
  const requests = [];
  const logs = [];
  let attempt = 0;
  const receipt = await sendSmsVerificationCode({
    phone: "13800000000",
    code: "654321",
    clientRequestId: "phone-code-random-request-001"
  }, {
    env: {
      NODE_ENV: "production",
      SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
      SMS_GATEWAY_TOKEN: "provider-token-must-not-leak",
      SMS_GATEWAY_AUTH_MODE: "bearer",
      SMS_TEMPLATE_ID: "resident-login-code",
      SMS_GATEWAY_MAX_ATTEMPTS: "3",
      SMS_GATEWAY_TIMEOUT_MS: "100"
    },
    sleepImpl: async () => {},
    logger: { info: (event, fields) => logs.push({ event, fields }), warn: (event, fields) => logs.push({ event, fields }) },
    fetchImpl: async (_url, options) => {
      requests.push(options);
      attempt += 1;
      if (attempt === 1) throw new Error("network failure 13800000000 654321 provider-token-must-not-leak");
      if (attempt === 2) return jsonResponse({}, 503);
      return jsonResponse({ providerMessageId: "provider-message-001", status: "accepted" });
    }
  });
  assert.equal(receipt.providerMessageId, "provider-message-001");
  assert.equal(requests.length, 3);
  assert.deepEqual(new Set(requests.map((item) => item.headers["Idempotency-Key"])), new Set(["phone-code-random-request-001"]));
  assert.equal(new Set(requests.map((item) => item.body)).size, 1);
  assert.doesNotMatch(JSON.stringify(logs), /13800000000|654321|provider-token-must-not-leak|phone-code-random-request-001/);
});

test("SMS production sends fail closed without credentials or a caller request id", async () => {
  const baseEnv = {
    NODE_ENV: "production",
    SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
    SMS_TEMPLATE_ID: "resident-login-code"
  };
  await assert.rejects(() => sendSmsVerificationCode({ phone: "13800000000", code: "654321", clientRequestId: "request-001" }, { env: baseEnv }), { code: "SMS_GATEWAY_CREDENTIAL_MISSING" });
  await assert.rejects(() => sendSmsVerificationCode({ phone: "13800000000", code: "654321" }, {
    env: { ...baseEnv, SMS_GATEWAY_TOKEN: "injected-token" },
    fetchImpl: async () => jsonResponse({ providerMessageId: "must-not-send" })
  }), { code: "SMS_IDEMPOTENCY_KEY_REQUIRED" });
});

test("provider facades expose sanitized health without provider credentials", async () => {
  const fixture = oidcFixture();
  const identity = createIdentityAdapter({ env: fixture.env, fetchImpl: fixture.fetchImpl });
  assert.equal((await identity.health()).discoveryVerified, true);
  assert.equal(typeof identity.verifyIdToken, "function");
  const sms = createSmsAdapter({
    env: {
      NODE_ENV: "production",
      SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
      SMS_GATEWAY_TOKEN: "injected-token",
      SMS_TEMPLATE_ID: "resident-login-code"
    }
  });
  assert.equal((await sms.health()).providerReachable, false);
  assert.equal((await probeSmsAdapterHealth({ env: sms.status().productionConfigured ? {
    NODE_ENV: "production",
    SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
    SMS_GATEWAY_TOKEN: "injected-token",
    SMS_TEMPLATE_ID: "resident-login-code"
  } : {} })).credentialsExposed, false);
});
