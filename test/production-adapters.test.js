const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applySmsDeliveryCallback,
  buildSmsDeliveryCenter,
  digestPhoneVerificationCode,
  fetchIdentityDirectory,
  fetchOidcUserInfo,
  generatePhoneVerificationCode,
  productionAdapterCenter,
  recordSmsDeliveryAcceptance,
  refreshOidcAccessToken,
  revokeOidcToken,
  sendSmsVerificationCode,
  signSmsDeliveryCallback,
  verifySmsDeliveryCallback
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
      return jsonResponse({
        issuer: "https://identity.example.gov.cn/real-issuer",
        userinfo_endpoint: "https://identity.example.gov.cn/userinfo"
      });
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
  assert.equal(result.claims.iss, "https://identity.example.gov.cn/real-issuer");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers.Authorization, "Bearer upstream-access-token");
});

test("OIDC lifecycle refreshes and revokes tokens without persisting credentials", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("openid-configuration")) {
      return jsonResponse({
        issuer: "https://identity.example.gov.cn/real-issuer",
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
  const env = {
    NODE_ENV: "production",
    SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
    SMS_GATEWAY_TOKEN: "provider-token",
    SMS_TEMPLATE_ID: "resident-login-code"
  };
  for (const status of ["failed", "expired", "undeliverable", "rejected", "error", "denied"]) {
    await assert.rejects(() => sendSmsVerificationCode({ phone: "13800000000", code: "654321", clientRequestId: `phone-code-negative-${status}` }, {
      env,
      fetchImpl: async () => jsonResponse({ providerMessageId: `provider-sms-${status}`, status })
    }), (error) => error.code === "SMS_GATEWAY_REJECTED" && error.statusCode === 502);
  }
});

test("SMS adapter accepts only canonical positive receipt statuses and preserves a missing-status fallback", async () => {
  const env = {
    NODE_ENV: "production",
    SMS_GATEWAY_URL: "https://sms.example.gov.cn/send",
    SMS_GATEWAY_TOKEN: "provider-token",
    SMS_TEMPLATE_ID: "resident-login-code"
  };
  for (const status of ["accepted", "queued", "sent", "delivered", undefined, "   "]) {
    const suffix = status?.trim() || "missing";
    const body = { providerMessageId: `provider-sms-${suffix}` };
    if (status !== undefined) body.status = status;
    const receipt = await sendSmsVerificationCode({
      phone: "13800000000",
      code: "654321",
      clientRequestId: `phone-code-${suffix}`
    }, {
      env,
      fetchImpl: async () => jsonResponse(body)
    });
    assert.equal(receipt.status, status?.trim() || "accepted");
  }

  for (const status of ["processing", false, 0]) {
    await assert.rejects(() => sendSmsVerificationCode({
      phone: "13800000000",
      code: "654321",
      clientRequestId: `phone-code-unknown-${String(status)}`
    }, {
      env,
      fetchImpl: async () => jsonResponse({ providerMessageId: `provider-sms-unknown-${String(status)}`, status })
    }), (error) => error.code === "SMS_GATEWAY_RECEIPT_STATUS_INVALID" && error.statusCode === 502);
  }
});

test("SMS delivery callbacks require a current valid HMAC signature", () => {
  const secret = "sms-callback-secret-with-at-least-32-characters";
  const nowMs = Date.parse("2026-07-15T06:30:00.000Z");
  const timestamp = String(Math.floor(nowMs / 1000));
  const nonce = "callback-nonce-0001";
  const payload = {
    eventId: "sms-event-001",
    providerMessageId: "provider-sms-001",
    status: "delivered",
    occurredAt: "2026-07-15T06:29:58.000Z",
    providerCode: "DELIVRD",
    recipient: "13800000000"
  };
  const signature = signSmsDeliveryCallback(payload, { secret, timestamp, nonce });
  const verified = verifySmsDeliveryCallback(payload, {
    env: { NODE_ENV: "production", SMS_DELIVERY_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature: `sha256=${signature}`,
    nowMs
  });
  assert.equal(verified.status, "delivered");
  assert.equal(verified.signatureVerified, true);
  assert.equal("recipient" in verified, false);
  assert.match(verified.nonceDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(verified), /13800000000|sms-callback-secret/);

  assert.throws(() => verifySmsDeliveryCallback({ ...payload, status: "failed" }, {
    env: { NODE_ENV: "production", SMS_DELIVERY_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature,
    nowMs
  }), (error) => error.code === "SMS_CALLBACK_SIGNATURE_MISMATCH");
  assert.throws(() => verifySmsDeliveryCallback(payload, {
    env: { NODE_ENV: "production", SMS_DELIVERY_CALLBACK_SECRET: secret },
    timestamp: String(Math.floor((nowMs - 301_000) / 1000)),
    nonce,
    signature,
    nowMs
  }), (error) => error.code === "SMS_CALLBACK_TIMESTAMP_EXPIRED");
  const futurePayload = { ...payload, occurredAt: "2026-07-15T06:36:00.000Z" };
  assert.throws(() => verifySmsDeliveryCallback(futurePayload, {
    env: { NODE_ENV: "production", SMS_DELIVERY_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature: signSmsDeliveryCallback(futurePayload, { secret, timestamp, nonce }),
    nowMs
  }), (error) => error.code === "SMS_CALLBACK_TIME_IN_FUTURE");
});

test("SMS delivery ledger is idempotent and does not regress terminal state", () => {
  const data = { smsDeliveryReceipts: [] };
  const accepted = recordSmsDeliveryAcceptance(data, {
    providerMessageId: "provider-sms-001",
    clientRequestId: "phone-code-001",
    maskedPhone: "138****0000",
    status: "accepted",
    acceptedAt: "2026-07-15T06:00:00.000Z"
  });
  assert.equal(accepted.status, "accepted");
  accepted.code = "654321";
  accepted.signature = "provider-signature-must-not-leak";
  assert.equal(recordSmsDeliveryAcceptance(data, {
    providerMessageId: "provider-sms-001",
    clientRequestId: "phone-code-001"
  }), accepted);
  assert.throws(() => recordSmsDeliveryAcceptance(data, {
    providerMessageId: "provider-sms-001",
    clientRequestId: "phone-code-conflict"
  }), (error) => error.code === "SMS_ACCEPTANCE_IDENTITY_CONFLICT");

  const deliveredCallback = {
    eventId: "sms-event-delivered",
    providerMessageId: "provider-sms-001",
    status: "delivered",
    occurredAt: "2026-07-15T06:00:30.000Z",
    receivedAt: "2026-07-15T06:00:31.000Z",
    providerCode: "DELIVRD",
    failureReason: "",
    nonceDigest: "a".repeat(64),
    signatureVerified: true
  };
  const delivered = applySmsDeliveryCallback(data, deliveredCallback);
  assert.equal(delivered.receipt.status, "delivered");
  assert.equal(delivered.event.stateApplied, true);
  const duplicate = applySmsDeliveryCallback(data, deliveredCallback);
  assert.equal(duplicate.idempotentReplay, true);
  assert.throws(() => applySmsDeliveryCallback(data, {
    ...deliveredCallback,
    providerCode: "CONFLICT",
    nonceDigest: "d".repeat(64)
  }), (error) => error.code === "SMS_CALLBACK_EVENT_CONFLICT");

  const stale = applySmsDeliveryCallback(data, {
    ...deliveredCallback,
    eventId: "sms-event-stale",
    status: "sent",
    occurredAt: "2026-07-15T06:00:10.000Z",
    receivedAt: "2026-07-15T06:00:32.000Z",
    nonceDigest: "b".repeat(64)
  });
  assert.equal(stale.receipt.status, "delivered");
  assert.equal(stale.event.stateApplied, false);
  assert.equal(stale.event.ignoredReason, "out-of-order");

  const conflict = applySmsDeliveryCallback(data, {
    ...deliveredCallback,
    eventId: "sms-event-failed",
    status: "failed",
    occurredAt: "2026-07-15T06:00:40.000Z",
    receivedAt: "2026-07-15T06:00:41.000Z",
    nonceDigest: "c".repeat(64)
  });
  assert.equal(conflict.receipt.status, "delivered");
  assert.equal(conflict.event.ignoredReason, "terminal-conflict");
  assert.throws(() => applySmsDeliveryCallback(data, {
    ...deliveredCallback,
    eventId: "sms-event-replay",
    nonceDigest: "c".repeat(64)
  }), (error) => error.code === "SMS_CALLBACK_REPLAY_DETECTED");

  const center = buildSmsDeliveryCenter(data, { SMS_DELIVERY_CALLBACK_SECRET: "configured" });
  assert.equal(center.summary.receipts, 1);
  assert.equal(center.summary.delivered, 1);
  assert.equal(center.summary.ignoredEvents, 2);
  assert.equal(center.callbackConfigured, true);
  assert.doesNotMatch(JSON.stringify(center), /nonceDigest/);
  assert.doesNotMatch(JSON.stringify(center), /654321|provider-signature-must-not-leak/);
});

test("SMS acceptance ledger rejects explicit non-success statuses without persisting them", () => {
  for (const status of ["failed", "expired", "undeliverable", "rejected", "processing", false, 0]) {
    const data = { smsDeliveryReceipts: [] };
    assert.throws(() => recordSmsDeliveryAcceptance(data, {
      providerMessageId: `provider-sms-${status}`,
      clientRequestId: `phone-code-${status}`,
      status
    }), (error) => error.code === "SMS_ACCEPTANCE_STATUS_INVALID");
    assert.deepEqual(data.smsDeliveryReceipts, []);
  }

  const data = { smsDeliveryReceipts: [] };
  const receipt = recordSmsDeliveryAcceptance(data, {
    providerMessageId: "provider-sms-missing-status",
    clientRequestId: "phone-code-missing-status"
  });
  assert.equal(receipt.status, "accepted");
  assert.equal(data.smsDeliveryReceipts.length, 1);
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
    SMS_GATEWAY_TOKEN: "provider-token",
    SMS_TEMPLATE_ID: "resident-login-code",
    SMS_DELIVERY_CALLBACK_SECRET: "sms-callback-secret-with-at-least-32-characters"
  });
  assert.equal(center.ready, true);
  assert.equal(center.adapterReady, true);
  assert.equal(center.identityLifecycleReady, true);
  assert.equal(center.smsDeliveryCallbackReady, true);
  assert.equal(center.productionReady, false);
  assert.equal(center.blockers.includes("real provider joint-test receipts and site signoff"), true);
});
