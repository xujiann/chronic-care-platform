"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDirectReportObservabilityReport,
  collectDirectReportObservabilitySnapshot,
  evaluateDirectReportObservability,
  renderDirectReportObservabilityJson,
  renderDirectReportPrometheus
} = require("../public-health-direct-report-observability");

const NOW = "2026-08-05T08:00:00.000Z";
const DICTIONARY_DIGEST = "a".repeat(64);
const MAPPING_FINGERPRINT = "b".repeat(64);

function healthyInput(overrides = {}) {
  return {
    generatedAt: NOW,
    deliveries: [
      {
        id: "must-not-leak-delivery",
        caseId: "must-not-leak-case",
        state: "callback-accepted",
        attemptCount: 1,
        payload: { residentId: "must-not-leak-resident" }
      }
    ],
    signatureFailureCount: 0,
    controlStatus: {
      activationReady: true,
      evidenceExpiresAt: "2026-08-07T08:00:00.000Z",
      dictionaryDigest: DICTIONARY_DIGEST,
      mappingFingerprint: MAPPING_FINGERPRINT,
      publicKeyPem: "must-not-leak-key",
      signature: "must-not-leak-signature",
      endpoint: "https://must-not-leak.example"
    },
    expectedControl: {
      dictionaryDigest: DICTIONARY_DIGEST,
      mappingFingerprint: MAPPING_FINGERPRINT
    },
    ...overrides
  };
}

test("healthy aggregate projection meets technical SLOs but never approves production", () => {
  const report = buildDirectReportObservabilityReport(healthyInput(), { now: NOW });
  assert.equal(report.status, "healthy");
  assert.equal(report.monitoringReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.alerts.length, 0);
  assert.equal(report.metrics.deadLetterRateRatio, 0);
  assert.equal(report.metrics.evidenceExpirySeconds, 172800);
  assert.deepEqual(report.blockers, ["SITE_MONITORING_DELIVERY_AND_SIGNED_ACCEPTANCE_REQUIRED"]);
  assert.ok(report.slos.every((item) => item.met));
});

test("queue backlog, dead-letter rate and callback timeout produce stable aggregate alerts", () => {
  const deliveries = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `queued-${index}`,
      state: "queued",
      attemptCount: 0
    })),
    {
      id: "dead",
      state: "dead-letter",
      attemptCount: 3,
      lastFailure: { code: "MUST_NOT_LEAK_PROVIDER_ERROR" }
    },
    {
      id: "waiting",
      state: "awaiting-callback",
      attemptCount: 1,
      providerReceipt: {
        receiptId: "must-not-leak-receipt",
        acceptedAt: "2026-08-05T07:50:00.000Z"
      }
    }
  ];
  const report = buildDirectReportObservabilityReport(
    healthyInput({ deliveries }),
    {
      now: NOW,
      thresholds: {
        queueBacklogMax: 2,
        deadLetterRateMaxRatio: 0.1,
        callbackTimeoutSeconds: 300,
        evidenceExpiryWarningSeconds: 86400
      }
    }
  );
  const alertCodes = report.alerts.map((item) => item.code);
  assert.equal(report.status, "critical");
  assert.equal(report.metrics.queueBacklog, 5);
  assert.equal(report.metrics.deadLetterRateRatio, 0.5);
  assert.equal(report.metrics.callbackTimeouts, 1);
  assert.deepEqual(alertCodes, [
    "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_TIMEOUT",
    "PUBLIC_HEALTH_DIRECT_REPORT_DEAD_LETTER_RATE_HIGH",
    "PUBLIC_HEALTH_DIRECT_REPORT_QUEUE_BACKLOG_HIGH"
  ]);
  const queueAlert = report.alerts.find((item) => item.code.endsWith("QUEUE_BACKLOG_HIGH"));
  assert.equal(queueAlert.severity, "critical");
  assert.equal(queueAlert.responsibleParty, "hospital-information-center");
  assert.equal(queueAlert.recoveryCondition, "QUEUE_BACKLOG_AT_OR_BELOW_SLO");
  const json = renderDirectReportObservabilityJson(report);
  assert.doesNotMatch(
    json,
    /queued-0|must-not-leak-receipt|MUST_NOT_LEAK_PROVIDER_ERROR/
  );
});

test("evidence expiry has deterministic warning, expired and unavailable states", () => {
  const warning = buildDirectReportObservabilityReport(
    healthyInput({
      controlStatus: {
        ...healthyInput().controlStatus,
        evidenceExpiresAt: "2026-08-05T12:00:00.000Z"
      }
    }),
    { now: NOW }
  );
  assert.ok(warning.alerts.some((item) => item.code.endsWith("EVIDENCE_EXPIRING")));
  assert.equal(warning.status, "degraded");

  const expired = buildDirectReportObservabilityReport(
    healthyInput({
      controlStatus: {
        ...healthyInput().controlStatus,
        evidenceExpiresAt: "2026-08-05T07:59:59.000Z"
      }
    }),
    { now: NOW }
  );
  assert.ok(expired.alerts.some((item) => item.code.endsWith("EVIDENCE_EXPIRED")));
  assert.equal(expired.status, "critical");

  const unavailable = buildDirectReportObservabilityReport(
    healthyInput({
      controlStatus: {
        ...healthyInput().controlStatus,
        evidenceExpiresAt: ""
      }
    }),
    { now: NOW }
  );
  assert.ok(unavailable.alerts.some((item) => item.code.endsWith("EVIDENCE_UNAVAILABLE")));
});

test("dictionary drift, mapping drift and signature failures remain deidentified", () => {
  const report = buildDirectReportObservabilityReport(
    healthyInput({
      deliveries: [{
        state: "callback-rejected",
        attemptCount: 1,
        trustedCallback: {
          signatureVerified: false,
          signature: "must-not-leak-callback-signature"
        }
      }],
      signatureFailureCount: 2,
      controlStatus: {
        ...healthyInput().controlStatus,
        dictionaryDigest: "c".repeat(64),
        mappingFingerprint: "d".repeat(64)
      }
    }),
    { now: NOW }
  );
  assert.equal(report.metrics.dictionaryDrift, true);
  assert.equal(report.metrics.mappingDrift, true);
  assert.equal(report.metrics.signatureFailures, 3);
  assert.deepEqual(report.alerts.map((item) => item.code), [
    "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_DRIFT",
    "PUBLIC_HEALTH_DIRECT_REPORT_MAPPING_DRIFT",
    "PUBLIC_HEALTH_DIRECT_REPORT_SIGNATURE_FAILURE"
  ]);
  assert.equal(new Set(report.alerts.map((item) => item.fingerprint)).size, 3);
  const rendered = `${renderDirectReportObservabilityJson(report)}${renderDirectReportPrometheus(report)}`;
  assert.doesNotMatch(
    rendered,
    /must-not-leak|publicKeyPem|https:\/\/must-not-leak\.example/
  );
});

test("missing approved digest references fail closed without exposing runtime digests", () => {
  const report = buildDirectReportObservabilityReport(
    healthyInput({ expectedControl: {} }),
    { now: NOW }
  );
  assert.equal(report.metrics.dictionaryDrift, null);
  assert.equal(report.metrics.mappingDrift, null);
  assert.ok(report.alerts.some((item) => item.code.endsWith("CONTROL_REFERENCE_MISSING")));
  assert.equal(report.slos.find((item) => item.code === "dictionary-fingerprint").met, false);
  assert.doesNotMatch(renderDirectReportObservabilityJson(report), new RegExp(DICTIONARY_DIGEST));
});

test("Prometheus export has bounded labels and explicit production fail-closed metric", () => {
  const report = buildDirectReportObservabilityReport(healthyInput(), { now: NOW });
  const output = renderDirectReportPrometheus(report);
  assert.match(output, /health_platform_public_health_direct_report_queue_backlog 0/);
  assert.match(output, /health_platform_public_health_direct_report_dead_letter_rate_ratio 0/);
  assert.match(output, /health_platform_public_health_direct_report_production_ready 0/);
  assert.doesNotMatch(output, /\{(?:[^}]*(?:id|case|receipt|digest|fingerprint|endpoint))=/);
  assert.doesNotMatch(output, /must-not-leak|https?:\/\//);
});

test("snapshot and report validation reject unsafe operational shapes deterministically", () => {
  assert.throws(
    () => collectDirectReportObservabilitySnapshot(
      healthyInput({ signatureFailureCount: -1 }),
      { now: NOW }
    ),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_COUNT_INVALID"
  );
  assert.throws(
    () => collectDirectReportObservabilitySnapshot(
      healthyInput(),
      { now: "not-a-time" }
    ),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_TIME_INVALID"
  );
  assert.throws(
    () => buildDirectReportObservabilityReport(
      healthyInput(),
      { now: NOW, thresholds: { callbackTimeoutSeconds: 1 } }
    ),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_THRESHOLD_INVALID"
  );
  assert.throws(
    () => evaluateDirectReportObservability({}),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_SNAPSHOT_INVALID"
  );
  assert.throws(
    () => renderDirectReportPrometheus({}),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_REPORT_INVALID"
  );
});
