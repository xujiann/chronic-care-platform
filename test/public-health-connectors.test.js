const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createKeyedReference,
  directReportConnectorCenter,
  dispatchPublicHealthDirectReport,
  signDirectReportCallback,
  signDirectReportRequest,
  sha256,
  stableStringify,
  validateDirectReportPayload,
  verifyDirectReportCallback
} = require("../public-health-connectors");

const REFERENCE_SECRET = "public-health-reference-secret-with-32-characters";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function reportPayload() {
  return {
    externalId: "LAB-20260722-0001",
    subjectReference: `hmac-sha256:v1:${"a".repeat(64)}`,
    institutionCode: "MR1",
    reportType: "laboratory-positive",
    diseaseCode: "TEST-DISEASE-001",
    testCode: "TEST-LAB-001",
    resultFlag: "positive",
    occurredAt: "2026-07-22T01:20:00.000Z",
    reportedAt: "2026-07-22T01:30:00.000Z",
    sourceSystem: "LIS"
  };
}

test("direct-report connector signs a minimized stable envelope and returns a normalized receipt", async () => {
  let captured;
  const receipt = await dispatchPublicHealthDirectReport({
    idempotencyKey: "public-health-direct-report-v1|MR1|LAB-20260722-0001",
    requestId: "phdr-request-001",
    payload: reportPayload()
  }, {
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_DIRECT_REPORT_URL: "https://cdc.example.gov.cn/direct-report",
      PUBLIC_HEALTH_DIRECT_REPORT_SECRET: "direct-report-signing-secret-with-32-characters",
      PUBLIC_HEALTH_REFERENCE_SECRET: REFERENCE_SECRET,
      PUBLIC_HEALTH_DIRECT_REPORT_TOKEN: "site-token"
    },
    nowMs: Date.parse("2026-07-22T01:31:00.000Z"),
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ receiptId: "CDC-DR-001", status: "accepted", acceptedAt: "2026-07-22T01:31:01.000Z" });
    }
  });

  const envelope = JSON.parse(captured.options.body);
  assert.equal(captured.url, "https://cdc.example.gov.cn/direct-report");
  assert.equal(captured.options.headers.Authorization, "Bearer site-token");
  assert.equal(captured.options.headers["X-Idempotency-Key"], "public-health-direct-report-v1|MR1|LAB-20260722-0001");
  assert.equal(captured.options.headers["X-Signature"], signDirectReportRequest(
    stableStringify(envelope),
    "direct-report-signing-secret-with-32-characters",
    captured.options.headers["X-Timestamp"],
    "phdr-request-001"
  ));
  assert.equal(receipt.receiptId, "CDC-DR-001");
  assert.equal(receipt.attempts, 1);
  assert.doesNotMatch(JSON.stringify(receipt), /site-token|direct-report-signing-secret/);
});

test("direct-report connector retries transient failures with stable request identity", async () => {
  const requests = [];
  const receipt = await dispatchPublicHealthDirectReport({
    idempotencyKey: "public-health-direct-report-v1|MR1|LAB-RETRY-001",
    payload: { ...reportPayload(), externalId: "LAB-RETRY-001" }
  }, {
    env: {
      PUBLIC_HEALTH_DIRECT_REPORT_URL: "http://127.0.0.1/direct-report",
      PUBLIC_HEALTH_DIRECT_REPORT_SECRET: "test-secret",
      PUBLIC_HEALTH_REFERENCE_SECRET: REFERENCE_SECRET,
      PUBLIC_HEALTH_DIRECT_REPORT_MAX_ATTEMPTS: "3"
    },
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (requests.length < 3) return jsonResponse({ message: "temporary unavailable" }, 503);
      return jsonResponse({ receiptId: "CDC-DR-RETRY-001", status: "queued" });
    }
  });
  assert.equal(receipt.attempts, 3);
  assert.equal(new Set(requests.map((item) => item.headers["X-Request-Id"])).size, 1);
  assert.equal(new Set(requests.map((item) => item.headers["X-Idempotency-Key"])).size, 1);
  assert.equal(new Set(requests.map((item) => item.headers["X-Signature"])).size, 1);
});

test("direct-report payload validation rejects direct identifiers and malformed dates", () => {
  assert.throws(() => validateDirectReportPayload({ ...reportPayload(), patient: { idCard: "raw-id" } }), (error) => error.code === "DIRECT_REPORT_SENSITIVE_FIELD");
  assert.throws(() => validateDirectReportPayload({ ...reportPayload(), reportedAt: "not-a-date" }), (error) => error.code === "DIRECT_REPORT_DATE_INVALID");
  assert.throws(() => validateDirectReportPayload({ ...reportPayload(), subjectReference: "TEST-PERSON-001" }), (error) => error.code === "DIRECT_REPORT_SUBJECT_REFERENCE_INVALID");
  assert.throws(() => validateDirectReportPayload({
    ...reportPayload(), occurredAt: "2026-07-22T01:31:00.000Z", reportedAt: "2026-07-22T01:30:00.000Z"
  }), (error) => error.code === "DIRECT_REPORT_TIME_ORDER_INVALID");
  assert.throws(() => validateDirectReportPayload(reportPayload(), {
    nowMs: Date.parse("2026-07-22T01:00:00.000Z"), maximumFutureSkewMs: 60 * 1000
  }), (error) => error.code === "DIRECT_REPORT_TIME_IN_FUTURE");
});

test("keyed subject and specimen references are stable, secret-dependent and not raw SHA-256", () => {
  const value = "LOW-ENTROPY-ID";
  const first = createKeyedReference(value, "subject", { secret: REFERENCE_SECRET, env: {} });
  const replay = createKeyedReference(value, "subject", { secret: REFERENCE_SECRET, env: {} });
  const differentSecret = createKeyedReference(value, "subject", {
    secret: "different-public-health-reference-secret-32-bytes",
    env: {}
  });
  const specimen = createKeyedReference(value, "specimen", { secret: REFERENCE_SECRET, env: {} });
  assert.equal(first, replay);
  assert.notEqual(first, differentSecret);
  assert.notEqual(first, specimen);
  assert.notEqual(first.split(":").at(-1), sha256(value));
  assert.match(first, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.match(specimen, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.throws(() => createKeyedReference(value, "subject", {
    env: { NODE_ENV: "production" }
  }), (error) => error.code === "DIRECT_REPORT_REFERENCE_SECRET_NOT_CONFIGURED");
  assert.throws(() => createKeyedReference(value, "specimen", {
    env: { NODE_ENV: "production", PUBLIC_HEALTH_REFERENCE_SECRET: "short" }
  }), (error) => error.code === "DIRECT_REPORT_REFERENCE_SECRET_WEAK");
});

test("production direct-report connector requires HTTPS and strong secrets", async () => {
  await assert.rejects(() => dispatchPublicHealthDirectReport({ idempotencyKey: "phdr-https", payload: reportPayload() }, {
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_DIRECT_REPORT_URL: "http://cdc.internal/direct-report",
      PUBLIC_HEALTH_DIRECT_REPORT_SECRET: "short"
    },
    fetchImpl: async () => jsonResponse({ receiptId: "never-called" })
  }), /HTTPS/);
  await assert.rejects(() => dispatchPublicHealthDirectReport({ idempotencyKey: "phdr-weak-secret", payload: reportPayload() }, {
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_DIRECT_REPORT_URL: "https://cdc.example.gov.cn/direct-report",
      PUBLIC_HEALTH_DIRECT_REPORT_SECRET: "short",
      PUBLIC_HEALTH_REFERENCE_SECRET: REFERENCE_SECRET
    },
    nowMs: Date.parse("2026-07-22T01:31:00.000Z"),
    fetchImpl: async () => jsonResponse({ receiptId: "never-called" })
  }), /signing secret does not meet production quality/);
  await assert.rejects(() => dispatchPublicHealthDirectReport({ idempotencyKey: "phdr-missing-config", payload: reportPayload() }, {
    env: { NODE_ENV: "production" },
    nowMs: Date.parse("2026-07-22T01:31:00.000Z"),
    fetchImpl: async () => jsonResponse({ receiptId: "never-called" })
  }), /is not configured/);
});

test("direct-report callback verifier enforces signature time window and replay identity inputs", () => {
  const secret = "direct-report-callback-secret-with-32-characters";
  const nowMs = Date.parse("2026-07-22T01:35:00.000Z");
  const timestamp = String(Math.floor(nowMs / 1000));
  const nonce = "direct-report-callback-nonce-001";
  const payload = {
    eventId: "cdc-callback-event-001",
    receiptId: "CDC-DR-001",
    status: "succeeded",
    occurredAt: "2026-07-22T01:34:59.000Z",
    providerCode: "SUCCESS"
  };
  const signature = signDirectReportCallback(payload, { secret, timestamp, nonce });
  const verified = verifyDirectReportCallback(payload, {
    env: { NODE_ENV: "production", PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature: `sha256=${signature}`,
    nowMs
  });
  assert.equal(verified.status, "succeeded");
  assert.match(verified.nonceDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => verifyDirectReportCallback({ ...payload, status: "failed" }, {
    env: { NODE_ENV: "production", PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature,
    nowMs
  }), (error) => error.code === "DIRECT_REPORT_CALLBACK_SIGNATURE_MISMATCH");
  assert.throws(() => verifyDirectReportCallback(payload, {
    env: { NODE_ENV: "production", PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET: "short" },
    timestamp,
    nonce,
    signature,
    nowMs
  }), (error) => error.code === "DIRECT_REPORT_CALLBACK_SECRET_WEAK");
});

test("direct-report connector center never exposes endpoint or credentials", () => {
  const center = directReportConnectorCenter({
    NODE_ENV: "production",
    PUBLIC_HEALTH_DIRECT_REPORT_URL: "https://cdc.example.gov.cn/direct-report",
    PUBLIC_HEALTH_DIRECT_REPORT_SECRET: "direct-report-signing-secret-with-32-characters",
    PUBLIC_HEALTH_REFERENCE_SECRET: REFERENCE_SECRET,
    PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET: "direct-report-callback-secret-with-32-characters",
    PUBLIC_HEALTH_DIRECT_REPORT_TOKEN: "site-token"
  });
  assert.equal(center.adapterReady, true);
  assert.equal(center.callbackReady, true);
  assert.equal(center.productionReady, false);
  const serialized = JSON.stringify(center);
  assert.doesNotMatch(serialized, /cdc\.example\.gov\.cn|site-token|signing-secret|callback-secret|reference-secret/);
  const missingReference = directReportConnectorCenter({
    NODE_ENV: "production",
    PUBLIC_HEALTH_DIRECT_REPORT_URL: "https://cdc.example.gov.cn/direct-report",
    PUBLIC_HEALTH_DIRECT_REPORT_SECRET: "direct-report-signing-secret-with-32-characters"
  });
  assert.equal(missingReference.adapterReady, false);
  assert.equal(missingReference.blockers.includes("keyed pseudonym reference secret"), true);
  const weakReference = directReportConnectorCenter({
    NODE_ENV: "production",
    PUBLIC_HEALTH_DIRECT_REPORT_URL: "https://cdc.example.gov.cn/direct-report",
    PUBLIC_HEALTH_DIRECT_REPORT_SECRET: "direct-report-signing-secret-with-32-characters",
    PUBLIC_HEALTH_REFERENCE_SECRET: "short"
  });
  assert.equal(weakReference.adapterReady, false);
  assert.equal(weakReference.blockers.includes("production-quality keyed pseudonym reference secret"), true);
});
