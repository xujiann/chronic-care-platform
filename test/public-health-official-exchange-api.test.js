"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE
} = require("../public-health-official-exchange-receipt-service");

const ROOT = path.resolve(__dirname, "..");
const CALLBACK_TOKEN = "public-health-official-exchange-callback-token-2026";
const KEY_SECRET = "public-health-official-exchange-managed-secret-2026";

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

async function login(baseUrl, username) {
  const result = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.token;
}

async function post(baseUrl, pathname, token, idempotencyKey, body, headers = {}) {
  return request(baseUrl, pathname, token, {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey,
      ...headers
    },
    body: JSON.stringify(body)
  });
}

test("official exchange callbacks append trusted receipts and alert actions atomically with redacted public views", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-official-exchange-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = [
    "NODE_ENV",
    "DATA_DIR",
    "STORAGE_ENGINE",
    "SESSION_SECRETS",
    "SESSION_STORE",
    "PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_KEYRING_JSON",
    "PUBLIC_HEALTH_OFFICIAL_EXCHANGE_CALLBACK_TOKEN"
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const now = Date.now();
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: "public-health-official-exchange-api-session-secret-2026",
    SESSION_STORE: "memory",
    PUBLIC_HEALTH_OFFICIAL_EXCHANGE_CALLBACK_TOKEN: CALLBACK_TOKEN,
    PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_KEYRING_JSON: JSON.stringify({
      purpose: PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE,
      activeKeyId: "official-exchange-active",
      keys: [{
        keyId: "official-exchange-active",
        secret: KEY_SECRET,
        status: "active",
        notBefore: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 3_600_000).toISOString(),
        revokedAt: ""
      }]
    })
  });

  const { readDatabase, server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const commissionToken = await login(baseUrl, "health");
  const signal = await post(
    baseUrl,
    "/api/public-health/surveillance-signals",
    commissionToken,
    "official-exchange-signal-intake",
    {
      expectedVersion: 0,
      sourceId: "ph-source-clinical-syndrome",
      externalSignalId: "OFFICIAL-EXCHANGE-API-SIGNAL-001",
      signalType: "clinical-syndrome",
      institutionId: "medical-institution-001",
      regionCode: "210202",
      observedAt: new Date(now - 120_000).toISOString(),
      metrics: [{
        metricCode: "fever-respiratory-count",
        value: 8,
        unit: "cases/24h",
        baseline: 3
      }],
      evidenceRefs: ["official-exchange-signal-evidence"]
    }
  );
  assert.equal(signal.response.status, 201, JSON.stringify(signal.body));
  const signalId = signal.body.signal.id;
  const verified = await post(
    baseUrl,
    `/api/public-health/surveillance-signals/${encodeURIComponent(signalId)}/actions`,
    commissionToken,
    "official-exchange-signal-verify",
    {
      action: "verify-signal",
      expectedVersion: 1,
      decision: "confirmed",
      note: "人工确认信号来源与统计口径",
      evidenceRefs: ["official-exchange-human-verification"]
    }
  );
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  const evaluated = await post(
    baseUrl,
    `/api/public-health/surveillance-signals/${encodeURIComponent(signalId)}/actions`,
    commissionToken,
    "official-exchange-signal-evaluate",
    { action: "evaluate-signal", expectedVersion: 2 }
  );
  assert.equal(evaluated.response.status, 200, JSON.stringify(evaluated.body));
  const alertId = evaluated.body.alert.id;

  const alertSteps = [
    ["verify-alert", 1, {
      riskLevel: "high",
      conclusion: "人工研判需要正式上报",
      evidenceRefs: ["official-exchange-risk-assessment"]
    }],
    ["dispatch-alert", 2, {
      medicalInstitutionId: "medical-institution-001",
      primaryCareOrganizationId: "primary-care-organization-001",
      dueAt: new Date(now + 86_400_000).toISOString(),
      note: "派发正式上报核查"
    }],
    ["start-investigation", 3, {
      investigationOwner: "市疾控流调组",
      note: "启动本轮正式上报调查"
    }]
  ];
  for (const [action, expectedVersion, extra] of alertSteps) {
    const result = await post(
      baseUrl,
      `/api/public-health/surveillance-alerts/${encodeURIComponent(alertId)}/actions`,
      commissionToken,
      `official-exchange-alert-${action}`,
      { action, expectedVersion, ...extra }
    );
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
  }

  const forgedBrowserAction = await post(
    baseUrl,
    `/api/public-health/surveillance-alerts/${encodeURIComponent(alertId)}/actions`,
    commissionToken,
    "official-exchange-browser-forgery",
    {
      action: "record-official-report",
      expectedVersion: 4,
      trustedReceiptId: "client-forged-trusted-receipt",
      reportId: "CLIENT-FORGED-REPORT",
      receiptCode: "CLIENT-FORGED-CODE",
      evidenceRefs: ["client-forged-evidence"],
      signatureVerified: true
    }
  );
  assert.equal(forgedBrowserAction.response.status, 400);
  assert.equal(
    forgedBrowserAction.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
  );

  const callbackHeaders = {
    "X-Public-Health-Official-Exchange-Callback-Token": CALLBACK_TOKEN
  };
  const unauthenticatedCallback = await post(
    baseUrl,
    "/api/public-health/official-exchange/official-report-receipts",
    "",
    "official-exchange-unauthenticated-callback",
    {
      alertId,
      reportId: "OFFICIAL-REPORT-API-001",
      externalReceiptCode: "OFFICIAL-REPORT-ACCEPTED-API-001",
      evidenceRefs: ["official-report-upstream-evidence"],
      expectedVersion: 4
    }
  );
  assert.equal(unauthenticatedCallback.response.status, 401);
  assert.equal(
    unauthenticatedCallback.body.code,
    "PUBLIC_HEALTH_OFFICIAL_EXCHANGE_CALLBACK_AUTH_INVALID"
  );
  const trustedMetadataInjection = await post(
    baseUrl,
    "/api/public-health/official-exchange/official-report-receipts",
    "",
    "official-exchange-trust-metadata-injection",
    {
      alertId,
      reportId: "OFFICIAL-REPORT-API-001",
      externalReceiptCode: "OFFICIAL-REPORT-ACCEPTED-API-001",
      evidenceRefs: ["official-report-upstream-evidence"],
      expectedVersion: 4,
      signatureVerified: true
    },
    callbackHeaders
  );
  assert.equal(trustedMetadataInjection.response.status, 400);
  assert.equal(
    trustedMetadataInjection.body.code,
    "PUBLIC_HEALTH_OFFICIAL_EXCHANGE_CALLBACK_OVERRIDE_FORBIDDEN"
  );

  const report = await post(
    baseUrl,
    "/api/public-health/official-exchange/official-report-receipts",
    "",
    "official-exchange-report-callback",
    {
      alertId,
      reportId: "OFFICIAL-REPORT-API-001",
      externalReceiptCode: "OFFICIAL-REPORT-ACCEPTED-API-001",
      evidenceRefs: ["official-report-upstream-evidence"],
      expectedVersion: 4
    },
    callbackHeaders
  );
  assert.equal(report.response.status, 201, JSON.stringify(report.body));
  assert.equal(report.body.alert.status, "reported");
  assert.equal(report.body.receipt.stage, "official-report");

  const duplicateExternalCode = await post(
    baseUrl,
    "/api/public-health/official-exchange/feedback-receipts",
    "",
    "official-exchange-duplicate-external-code",
    {
      alertId,
      reportId: "OFFICIAL-REPORT-API-001",
      externalReceiptCode: "OFFICIAL-REPORT-ACCEPTED-API-001",
      conclusion: "重复外部业务码不得写入",
      evidenceRefs: ["duplicate-external-code-evidence"],
      expectedVersion: 5
    },
    callbackHeaders
  );
  assert.equal(duplicateExternalCode.response.status, 400);
  assert.equal(readDatabase().publicHealthOfficialExchangeReceipts.length, 1);
  assert.equal(readDatabase().publicHealthSurveillanceAlerts
    .find((item) => item.id === alertId).version, 5);

  const feedback = await post(
    baseUrl,
    "/api/public-health/official-exchange/feedback-receipts",
    "",
    "official-exchange-feedback-callback",
    {
      alertId,
      reportId: "OFFICIAL-REPORT-API-001",
      externalReceiptCode: "OFFICIAL-FEEDBACK-ACCEPTED-API-001",
      conclusion: "上级平台已接收并要求持续监测",
      evidenceRefs: ["official-feedback-upstream-evidence"],
      expectedVersion: 5
    },
    callbackHeaders
  );
  assert.equal(feedback.response.status, 201, JSON.stringify(feedback.body));
  assert.equal(feedback.body.alert.status, "feedback-confirmed");

  const center = await request(
    baseUrl,
    "/api/public-health/surveillance-center",
    commissionToken
  );
  assert.equal(center.response.status, 200, JSON.stringify(center.body));
  assert.equal(center.body.summary.trustedOfficialReports, 1);
  assert.equal(center.body.summary.trustedOfficialFeedbacks, 1);
  assert.equal(center.body.officialExchangeReceipts.summary.findings, 0);
  assert.equal(center.body.productionReady, false);
  const publicText = JSON.stringify({ report: report.body, feedback: feedback.body, center: center.body });
  [
    KEY_SECRET,
    "receiptSignature",
    "\"keyId\"",
    "\"signedBy\"",
    "\"verifiedBy\"",
    "official-report-upstream-evidence",
    "official-feedback-upstream-evidence"
  ].forEach((token) => assert.equal(publicText.includes(token), false, token));

  const stored = readDatabase();
  assert.equal(stored.publicHealthOfficialExchangeReceipts.length, 2);
  assert.equal(stored.publicHealthOfficialExchangeReceiptAudit.length, 2);
  assert.equal(stored.publicHealthSurveillanceAlerts
    .find((item) => item.id === alertId).version, 6);
  assert.equal(JSON.stringify(stored).includes(KEY_SECRET), false);

  const replay = await post(
    baseUrl,
    "/api/public-health/official-exchange/feedback-receipts",
    "",
    "official-exchange-feedback-callback",
    {
      alertId,
      reportId: "OFFICIAL-REPORT-API-001",
      externalReceiptCode: "OFFICIAL-FEEDBACK-ACCEPTED-API-001",
      conclusion: "上级平台已接收并要求持续监测",
      evidenceRefs: ["official-feedback-upstream-evidence"],
      expectedVersion: 5
    },
    callbackHeaders
  );
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotent, true);
  assert.equal(readDatabase().publicHealthOfficialExchangeReceipts.length, 2);
});
