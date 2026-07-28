"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

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

async function post(baseUrl, pathname, token, idempotencyKey, body) {
  return request(baseUrl, pathname, token, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body)
  });
}

test("model governance API keeps shadow advice isolated and persists CAS-bound evidence", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-model-governance-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = ["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: "public-health-model-governance-api-session-secret-2026",
    SESSION_STORE: "memory"
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

  const healthToken = await login(baseUrl, "health");
  const cityToken = await login(baseUrl, "city");
  const hospitalToken = await login(baseUrl, "hospital");

  const anonymous = await request(baseUrl, "/api/public-health/surveillance-model-governance");
  assert.equal(anonymous.response.status, 401);
  const forbidden = await request(
    baseUrl,
    "/api/public-health/surveillance-model-governance",
    hospitalToken
  );
  assert.equal(forbidden.response.status, 403);
  const queryInjection = await request(
    baseUrl,
    "/api/public-health/surveillance-model-governance?at=2030-01-01T00:00:00.000Z",
    healthToken
  );
  assert.equal(queryInjection.response.status, 400);
  assert.equal(
    queryInjection.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
  );

  const observedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const signalDefinitions = [
    {
      sourceId: "ph-source-clinical-syndrome",
      externalSignalId: "MODEL-API-CLINICAL-001",
      signalType: "clinical-syndrome",
      institutionId: "medical-institution-model-api",
      metricCode: "fever-respiratory-count",
      value: 18,
      baseline: 3
    },
    {
      sourceId: "ph-source-laboratory-pathogen",
      externalSignalId: "MODEL-API-LAB-001",
      signalType: "laboratory-pathogen",
      institutionId: "laboratory-model-api",
      metricCode: "pathogen-positive-count",
      value: 12,
      baseline: 2
    }
  ];
  const signalIds = [];
  for (const [index, definition] of signalDefinitions.entries()) {
    const created = await post(
      baseUrl,
      "/api/public-health/surveillance-signals",
      healthToken,
      `model-api-signal-${index}`,
      {
        expectedVersion: 0,
        sourceId: definition.sourceId,
        externalSignalId: definition.externalSignalId,
        signalType: definition.signalType,
        institutionId: definition.institutionId,
        regionCode: "210202",
        observedAt,
        metrics: [{
          metricCode: definition.metricCode,
          value: definition.value,
          unit: "cases/24h",
          baseline: definition.baseline
        }],
        evidenceRefs: [`MODEL-API-SIGNAL-EVIDENCE-${index}`]
      }
    );
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    signalIds.push(created.body.signal.id);
    const verified = await post(
      baseUrl,
      `/api/public-health/surveillance-signals/${encodeURIComponent(created.body.signal.id)}/actions`,
      healthToken,
      `model-api-signal-verify-${index}`,
      {
        action: "verify-signal",
        expectedVersion: 1,
        decision: "confirmed",
        note: "human source and quality verification complete",
        evidenceRefs: [`MODEL-API-HUMAN-VERIFY-${index}`]
      }
    );
    assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  }

  const unverified = await post(
    baseUrl,
    "/api/public-health/surveillance-signals",
    healthToken,
    "model-api-unverified-signal",
    {
      expectedVersion: 0,
      sourceId: "ph-source-clinical-syndrome",
      externalSignalId: "MODEL-API-UNVERIFIED-001",
      signalType: "clinical-syndrome",
      institutionId: "medical-institution-model-api",
      regionCode: "210202",
      observedAt,
      metrics: [{
        metricCode: "fever-respiratory-count",
        value: 8,
        unit: "cases/24h",
        baseline: 3
      }],
      evidenceRefs: ["MODEL-API-UNVERIFIED-EVIDENCE"]
    }
  );
  assert.equal(unverified.response.status, 201, JSON.stringify(unverified.body));
  const rejectedUnverified = await post(
    baseUrl,
    "/api/public-health/surveillance-models/ph-model-baseline-deviation/shadow-runs",
    healthToken,
    "model-api-unverified-run",
    {
      expectedVersion: 0,
      expectedModelVersion: 1,
      signalIds: [unverified.body.signal.id],
      windowStart,
      windowEnd,
      evidenceRefs: ["MODEL-API-UNVERIFIED-RUN"]
    }
  );
  assert.equal(rejectedUnverified.response.status, 400);

  const forgedRun = await post(
    baseUrl,
    "/api/public-health/surveillance-models/ph-model-cross-source-concordance/shadow-runs",
    healthToken,
    "model-api-forged-run",
    {
      expectedVersion: 0,
      expectedModelVersion: 1,
      signalIds,
      windowStart,
      windowEnd,
      evidenceRefs: ["MODEL-API-RUN-EVIDENCE"],
      output: { score: 1 },
      riskBand: "confirmed-alert",
      modelAdviceOnly: false,
      humanDecisionRequired: false,
      alertCreated: true,
      integrityDigest: "attacker",
      residentId: "resident-forbidden"
    }
  );
  assert.equal(forgedRun.response.status, 400);
  assert.equal(
    forgedRun.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
  );

  const beforeRun = readDatabase();
  const signalsBefore = JSON.stringify(beforeRun.publicHealthSurveillanceSignals);
  const alertsBefore = JSON.stringify(beforeRun.publicHealthSurveillanceAlerts || []);
  const run = await post(
    baseUrl,
    "/api/public-health/surveillance-models/ph-model-cross-source-concordance/shadow-runs",
    healthToken,
    "model-api-shadow-run",
    {
      expectedVersion: 0,
      expectedModelVersion: 1,
      signalIds,
      windowStart,
      windowEnd,
      evidenceRefs: ["MODEL-API-RUN-EVIDENCE"]
    }
  );
  assert.equal(run.response.status, 201, JSON.stringify(run.body));
  assert.equal(run.body.run.modelAdviceOnly, true);
  assert.equal(run.body.run.humanDecisionRequired, true);
  assert.equal(run.body.run.alertCreated, false);
  assert.equal(run.body.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify(run.body),
    /residentId|patientId|idempotencyKey|inputDigest|integrityDigest|executedBy|evidenceRefs/i
  );
  const afterRun = readDatabase();
  assert.equal(JSON.stringify(afterRun.publicHealthSurveillanceSignals), signalsBefore);
  assert.equal(JSON.stringify(afterRun.publicHealthSurveillanceAlerts || []), alertsBefore);
  assert.equal(afterRun.publicHealthSurveillanceModelRuns.length, 1);
  assert.equal(afterRun.publicHealthSurveillanceModelAudit.length, 1);

  const validationPayload = {
    expectedVersion: 0,
    expectedModelVersion: 1,
    sampleWindowStart: new Date(Date.now() - 30 * 86400000).toISOString(),
    sampleWindowEnd: new Date(Date.now() - 86400000).toISOString(),
    sampleSize: 120,
    sensitivity: 0.91,
    positivePredictiveValue: 0.72,
    falseNegativeRate: 0.07,
    note: "retrospective performance validation submitted for independent review",
    evidenceRefs: ["MODEL-API-VALIDATION-DATASET", "MODEL-API-VALIDATION-REPORT"]
  };
  const forgedValidation = await post(
    baseUrl,
    "/api/public-health/surveillance-models/ph-model-cross-source-concordance/validations",
    healthToken,
    "model-api-validation-forged",
    { ...validationPayload, score: 1, signatureVerified: true }
  );
  assert.equal(forgedValidation.response.status, 400);
  assert.equal(
    forgedValidation.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
  );

  const submitted = await post(
    baseUrl,
    "/api/public-health/surveillance-models/ph-model-cross-source-concordance/validations",
    healthToken,
    "model-api-validation-submit",
    validationPayload
  );
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
  assert.equal(submitted.body.validation.status, "submitted");
  const validationId = submitted.body.validation.id;

  const selfReview = await post(
    baseUrl,
    `/api/public-health/surveillance-model-validations/${encodeURIComponent(validationId)}/actions`,
    healthToken,
    "model-api-validation-self-review",
    {
      action: "review-model-validation",
      expectedVersion: 1,
      decision: "approved",
      note: "self review must fail",
      evidenceRefs: ["MODEL-API-SELF-REVIEW"]
    }
  );
  assert.equal(selfReview.response.status, 400);
  assert.equal(
    selfReview.body.code,
    "PUBLIC_HEALTH_SURVEILLANCE_MODEL_REVIEWER_NOT_INDEPENDENT"
  );

  const reviewed = await post(
    baseUrl,
    `/api/public-health/surveillance-model-validations/${encodeURIComponent(validationId)}/actions`,
    cityToken,
    "model-api-validation-review",
    {
      action: "review-model-validation",
      expectedVersion: 1,
      decision: "approved",
      note: "independent commission review completed",
      evidenceRefs: ["MODEL-API-INDEPENDENT-REVIEW"]
    }
  );
  assert.equal(reviewed.response.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.validation.status, "validated-shadow");
  assert.equal(reviewed.body.productionReady, false);

  const lowSubmitted = await post(
    baseUrl,
    "/api/public-health/surveillance-models/ph-model-baseline-deviation/validations",
    healthToken,
    "model-api-low-validation-submit",
    {
      ...validationPayload,
      sensitivity: 0.62,
      positivePredictiveValue: 0.35,
      falseNegativeRate: 0.22
    }
  );
  assert.equal(lowSubmitted.response.status, 201, JSON.stringify(lowSubmitted.body));
  const lowReviewed = await post(
    baseUrl,
    `/api/public-health/surveillance-model-validations/${encodeURIComponent(lowSubmitted.body.validation.id)}/actions`,
    cityToken,
    "model-api-low-validation-review",
    {
      action: "review-model-validation",
      expectedVersion: 1,
      decision: "approved",
      note: "performance gate not met; remediation required",
      evidenceRefs: ["MODEL-API-LOW-PERFORMANCE-REVIEW"]
    }
  );
  assert.equal(lowReviewed.response.status, 200, JSON.stringify(lowReviewed.body));
  assert.equal(lowReviewed.body.validation.status, "remediation-required");

  const governance = await request(
    baseUrl,
    "/api/public-health/surveillance-model-governance",
    healthToken
  );
  assert.equal(governance.response.status, 200);
  assert.equal(governance.body.summary.models, 3);
  assert.equal(governance.body.summary.modelRuns, 1);
  assert.equal(governance.body.summary.validatedShadowModels, 1);
  assert.equal(governance.body.summary.remediationRequired, 1);
  assert.equal(governance.body.models.every((item) => item.productionReady === false), true);
  assert.equal(governance.body.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify(governance.body),
    /residentId|patientId|modelDigest|inputDigest|integrityDigest|idempotencyKey|submittedBy|reviewedBy|evidenceRefs/i
  );

  const persisted = readDatabase();
  assert.equal(persisted.publicHealthSurveillanceModelRuns.length, 1);
  assert.equal(persisted.publicHealthSurveillanceModelAudit.length, 1);
  assert.equal(persisted.publicHealthSurveillanceModelValidations.length, 2);

  const { DatabaseSync } = require("node:sqlite");
  const sqlite = new DatabaseSync(path.join(dataDir, "health-city.sqlite"));
  const rows = sqlite.prepare(`
    SELECT key, payload
    FROM state_collections
    WHERE key IN (
      'publicHealthSurveillanceModelRuns',
      'publicHealthSurveillanceModelAudit',
      'publicHealthSurveillanceModelValidations'
    )
    ORDER BY key
  `).all();
  sqlite.close();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => JSON.parse(row.payload).length), [1, 1, 2]);
});
