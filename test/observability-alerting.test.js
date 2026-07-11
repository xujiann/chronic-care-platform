const assert = require("node:assert/strict");
const test = require("node:test");

const {
  alertRoutingCenter,
  dispatchAlert,
  signAlertRequest,
  stableStringify,
  validateAlert
} = require("../observability-alerting");

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function sampleAlert(overrides = {}) {
  return {
    fingerprint: "integration-dead-letter:3",
    source: "integration-gateway",
    severity: "critical",
    title: "Integration dead letters require triage",
    summary: "Three outbound integration events are awaiting reconciliation.",
    occurredAt: "2026-07-11T06:00:00.000Z",
    labels: { environment: "production", owner: "integration-operations" },
    metrics: { deadLetters: "3" },
    evidenceRefs: ["/api/integration/monitor"],
    ...overrides
  };
}

test("SIEM alert delivery signs minimized payloads and normalizes receipts", async () => {
  let captured;
  const receipt = await dispatchAlert({ route: "SIEM", idempotencyKey: "alert-001", requestId: "request-001", alert: sampleAlert() }, {
    env: {
      NODE_ENV: "production",
      SIEM_ENDPOINT: "https://siem.example.gov.cn/events",
      SIEM_SIGNING_SECRET: "siem-signing-secret",
      SIEM_TOKEN: "siem-token"
    },
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ eventId: "siem-event-001", status: "accepted" });
    }
  });
  const body = JSON.parse(captured.options.body);
  assert.equal(captured.options.headers["X-Signature"], signAlertRequest(stableStringify(body), "siem-signing-secret", captured.options.headers["X-Timestamp"], "request-001"));
  assert.equal(captured.options.headers.Authorization, "Bearer siem-token");
  assert.equal(receipt.receiptId, "siem-event-001");
  assert.equal(JSON.stringify(receipt).includes("siem-token"), false);
});

test("alert delivery retries transient receiver failures with stable identity", async () => {
  const requests = [];
  const receipt = await dispatchAlert({ route: "WEBHOOK", idempotencyKey: "alert-002", alert: sampleAlert({ fingerprint: "slow-requests:2" }) }, {
    env: { ALERT_WEBHOOK_URL: "http://127.0.0.1/alerts", ALERT_WEBHOOK_SECRET: "webhook-secret", ALERTING_MAX_ATTEMPTS: "3" },
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (requests.length === 1) return jsonResponse({ message: "temporary unavailable" }, 503);
      return jsonResponse({ receiptId: "webhook-002", status: "delivered" });
    }
  });
  assert.equal(receipt.attempts, 2);
  assert.equal(new Set(requests.map((item) => item.headers["X-Request-Id"])).size, 1);
  assert.equal(new Set(requests.map((item) => item.headers["X-Signature"])).size, 1);
});

test("alert validation rejects patient identifiers invalid severity and missing fields", () => {
  assert.throws(() => validateAlert({ route: "SIEM", alert: sampleAlert({ residentId: "r1" }) }), /sensitive field/);
  assert.throws(() => validateAlert({ route: "SIEM", alert: sampleAlert({ severity: "fatal" }) }), /severity/);
  assert.throws(() => validateAlert({ route: "SIEM", alert: sampleAlert({ fingerprint: "" }) }), /fingerprint/);
  assert.throws(() => validateAlert({ route: "SIEM", idempotencyKey: "unsafe\r\nheader", alert: sampleAlert() }), /control characters/);
  assert.throws(() => validateAlert({ route: "SIEM", idempotencyKey: "x".repeat(201), alert: sampleAlert() }), /must not exceed 200/);
});

test("production alert routes require HTTPS and configured secrets", async () => {
  await assert.rejects(() => dispatchAlert({ route: "SIEM", alert: sampleAlert() }, {
    env: { NODE_ENV: "production", SIEM_ENDPOINT: "http://siem.internal/events", SIEM_SIGNING_SECRET: "secret" },
    fetchImpl: async () => jsonResponse({ receiptId: "never" })
  }), /HTTPS/);
  await assert.rejects(() => dispatchAlert({ route: "WEBHOOK", alert: sampleAlert() }, {
    env: { ALERT_WEBHOOK_URL: "http://127.0.0.1/events" },
    fetchImpl: async () => jsonResponse({ receiptId: "never" })
  }), /not configured/);
});

test("alert routing center exposes configuration without endpoints or credentials", () => {
  const center = alertRoutingCenter({
    NODE_ENV: "production",
    SIEM_ENDPOINT: "https://siem.example.gov.cn/events",
    SIEM_SIGNING_SECRET: "siem-secret",
    ALERT_WEBHOOK_URL: "https://alerts.example.gov.cn/hooks",
    ALERT_WEBHOOK_SECRET: "webhook-secret"
  });
  assert.equal(center.adapterReady, true);
  assert.equal(center.productionReady, false);
  assert.equal(center.summary.total, 2);
  assert.equal(center.summary.configured, 2);
  const serialized = JSON.stringify(center);
  assert.equal(serialized.includes("siem.example.gov.cn"), false);
  assert.equal(serialized.includes("siem-secret"), false);
});
