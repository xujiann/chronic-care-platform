"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const ACTIVATION_SECRET = "public-health-rule-activation-api-secret-2026";

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

async function post(baseUrl, pathname, token, key, body) {
  return request(baseUrl, pathname, token, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body)
  });
}

test("rule governance API binds independent actors and server-only activation trust", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-rule-governance-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = [
    "NODE_ENV",
    "DATA_DIR",
    "STORAGE_ENGINE",
    "SESSION_SECRETS",
    "SESSION_STORE",
    "PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_SECRET",
    "PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_KEY_ID"
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: "public-health-rule-governance-api-session-secret-2026",
    SESSION_STORE: "memory",
    PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_SECRET: ACTIVATION_SECRET,
    PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_KEY_ID: "api-managed-rule-key"
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

  const anonymousOperations = await request(baseUrl, "/api/public-health/data-source-operations");
  assert.equal(anonymousOperations.response.status, 401);
  const forbiddenGovernance = await request(
    baseUrl,
    "/api/public-health/surveillance-rule-governance",
    hospitalToken
  );
  assert.equal(forbiddenGovernance.response.status, 403);

  const operations = await request(
    baseUrl,
    "/api/public-health/data-source-operations",
    healthToken
  );
  assert.equal(operations.response.status, 200);
  assert.equal(operations.body.summary.sources, 8);
  assert.equal(operations.body.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify(operations.body),
    /endpoint|externalSignalId|externalSignalKeyHash|credential|secret|signature|keyId/i
  );
  const operationsInjection = await request(
    baseUrl,
    "/api/public-health/data-source-operations?now=2000-01-01T00:00:00.000Z",
    healthToken
  );
  assert.equal(operationsInjection.response.status, 400);
  assert.equal(
    operationsInjection.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
  );

  const signalPayload = {
    expectedVersion: 0,
    sourceId: "ph-source-clinical-syndrome",
    externalSignalId: "RULE-GOVERNANCE-HISTORICAL-V1-001",
    signalType: "clinical-syndrome",
    institutionId: "medical-institution-001",
    regionCode: "210202",
    observedAt: new Date().toISOString(),
    metrics: [{
      metricCode: "fever-respiratory-count",
      value: 8,
      unit: "cases/24h",
      baseline: 3
    }],
    evidenceRefs: ["RULE-GOVERNANCE-HISTORICAL-V1-EVIDENCE"]
  };
  const signalCreated = await post(
    baseUrl,
    "/api/public-health/surveillance-signals",
    healthToken,
    "rule-governance-history-signal",
    signalPayload
  );
  assert.equal(signalCreated.response.status, 201, JSON.stringify(signalCreated.body));
  const signalId = signalCreated.body.signal.id;
  const verified = await post(
    baseUrl,
    `/api/public-health/surveillance-signals/${encodeURIComponent(signalId)}/actions`,
    healthToken,
    "rule-governance-history-verify",
    {
      action: "verify-signal",
      expectedVersion: 1,
      decision: "confirmed",
      note: "manual confirmation before governed rule upgrade",
      evidenceRefs: ["RULE-GOVERNANCE-HISTORY-VERIFY"]
    }
  );
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  const evaluated = await post(
    baseUrl,
    `/api/public-health/surveillance-signals/${encodeURIComponent(signalId)}/actions`,
    healthToken,
    "rule-governance-history-evaluate",
    { action: "evaluate-signal", expectedVersion: 2 }
  );
  assert.equal(evaluated.response.status, 200, JSON.stringify(evaluated.body));
  assert.equal(evaluated.body.alert.version, 1);

  const proposal = {
    expectedVersion: 1,
    ruleId: "ph-rule-clinical-syndrome",
    threshold: 10,
    severity: "high",
    status: "active",
    reason: "controlled threshold update",
    evidenceRefs: ["RULE-GOVERNANCE-PROPOSAL"]
  };
  const forgedProposal = await post(
    baseUrl,
    "/api/public-health/surveillance-rule-changes",
    healthToken,
    "rule-governance-forged-proposal",
    { ...proposal, verificationSource: "client-trusted", signatureVerified: true }
  );
  assert.equal(forgedProposal.response.status, 400);
  assert.equal(
    forgedProposal.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
  );

  const submitted = await post(
    baseUrl,
    "/api/public-health/surveillance-rule-changes",
    healthToken,
    "rule-governance-submit",
    proposal
  );
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
  assert.equal(submitted.body.change.status, "submitted");
  assert.equal(submitted.body.change.version, 1);
  const changeId = submitted.body.change.id;

  const forgedReviewer = await post(
    baseUrl,
    `/api/public-health/surveillance-rule-changes/${encodeURIComponent(changeId)}/actions`,
    cityToken,
    "rule-governance-forged-reviewer",
    {
      action: "review-rule-change",
      expectedVersion: 1,
      decision: "approved",
      note: "independent review",
      evidenceRefs: ["RULE-GOVERNANCE-REVIEW"],
      reviewedBy: "client-selected-reviewer"
    }
  );
  assert.equal(forgedReviewer.response.status, 400);
  assert.equal(
    forgedReviewer.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
  );

  const selfReview = await post(
    baseUrl,
    `/api/public-health/surveillance-rule-changes/${encodeURIComponent(changeId)}/actions`,
    healthToken,
    "rule-governance-self-review",
    {
      action: "review-rule-change",
      expectedVersion: 1,
      decision: "approved",
      note: "must not self review",
      evidenceRefs: ["RULE-GOVERNANCE-SELF-REVIEW"]
    }
  );
  assert.equal(selfReview.response.status, 400);
  assert.equal(
    selfReview.body.code,
    "PUBLIC_HEALTH_SURVEILLANCE_RULE_REVIEWER_NOT_INDEPENDENT"
  );

  const reviewed = await post(
    baseUrl,
    `/api/public-health/surveillance-rule-changes/${encodeURIComponent(changeId)}/actions`,
    cityToken,
    "rule-governance-review",
    {
      action: "review-rule-change",
      expectedVersion: 1,
      decision: "approved",
      note: "independent commission review",
      evidenceRefs: ["RULE-GOVERNANCE-REVIEW"]
    }
  );
  assert.equal(reviewed.response.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.change.status, "approved");
  assert.equal(reviewed.body.change.version, 2);

  const forgedActivation = await post(
    baseUrl,
    `/api/public-health/surveillance-rule-changes/${encodeURIComponent(changeId)}/actions`,
    healthToken,
    "rule-governance-forged-activation",
    {
      action: "activate-rule-change",
      expectedVersion: 2,
      note: "client trust injection",
      evidenceRefs: ["RULE-GOVERNANCE-ACTIVATION"],
      threshold: 999,
      verificationSource: "client",
      signatureVerified: true,
      receipt: { signature: "forged" },
      keyId: "client-key"
    }
  );
  assert.equal(forgedActivation.response.status, 400);
  assert.equal(
    forgedActivation.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN"
  );

  delete process.env.PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_SECRET;
  const missingSecret = await post(
    baseUrl,
    `/api/public-health/surveillance-rule-changes/${encodeURIComponent(changeId)}/actions`,
    healthToken,
    "rule-governance-missing-secret",
    {
      action: "activate-rule-change",
      expectedVersion: 2,
      note: "must fail closed without managed secret",
      evidenceRefs: ["RULE-GOVERNANCE-ACTIVATION"]
    }
  );
  assert.equal(missingSecret.response.status, 503);
  assert.equal(
    missingSecret.body.code,
    "PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_SECRET_UNAVAILABLE"
  );
  process.env.PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_SECRET = ACTIVATION_SECRET;

  const activated = await post(
    baseUrl,
    `/api/public-health/surveillance-rule-changes/${encodeURIComponent(changeId)}/actions`,
    healthToken,
    "rule-governance-activate",
    {
      action: "activate-rule-change",
      expectedVersion: 2,
      note: "trusted server activation",
      evidenceRefs: ["RULE-GOVERNANCE-ACTIVATION"]
    }
  );
  assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
  assert.equal(activated.body.change.status, "activated");
  assert.equal(activated.body.change.version, 3);
  assert.equal(activated.body.summary.ruleVersions, 9);
  assert.equal(activated.body.summary.trustedActivations, 1);
  assert.equal(activated.body.productionReady, false);

  const governance = await request(
    baseUrl,
    "/api/public-health/surveillance-rule-governance",
    healthToken
  );
  assert.equal(governance.response.status, 200);
  assert.equal(governance.body.summary.activationConfigured, true);
  assert.equal(governance.body.summary.activated, 1);
  assert.equal(governance.body.rules.find((item) => item.id === proposal.ruleId).version, 2);
  assert.doesNotMatch(
    JSON.stringify(governance.body),
    /submittedBy|submittedActorId|reviewedBy|reviewedActorId|activatedBy|activatedActorId|verificationSource|signatureVerified|signatureAlgorithm|keyId|receipt|secret/i
  );

  const center = await request(baseUrl, "/api/public-health/surveillance-center", healthToken);
  assert.equal(center.response.status, 200);
  assert.equal(center.body.ok, true, JSON.stringify(center.body.alertIntegrityFindings));
  assert.equal(center.body.summary.trustedRuleActivations, 1);
  assert.equal(center.body.alerts.find((item) => item.id === evaluated.body.alert.id).version, 1);
  assert.equal(center.body.rules.find((item) => item.id === proposal.ruleId).version, 2);
  assert.equal(center.body.productionReady, false);

  const persisted = readDatabase();
  assert.equal(persisted.publicHealthSurveillanceRuleChanges.length, 1);
  assert.equal(persisted.publicHealthSurveillanceRuleChanges[0].status, "activated");
  assert.equal(persisted.publicHealthSurveillanceRules.find((item) => item.id === proposal.ruleId).version, 2);

  const { DatabaseSync } = require("node:sqlite");
  const sqlite = new DatabaseSync(path.join(dataDir, "health-city.sqlite"));
  const rows = sqlite.prepare(`
    SELECT key, payload
    FROM state_collections
    WHERE key IN ('publicHealthSurveillanceRuleChanges', 'publicHealthSurveillanceRules')
    ORDER BY key
  `).all();
  sqlite.close();
  assert.equal(rows.length, 2);
  assert.equal(JSON.parse(rows[0].payload).length, 1);
  assert.equal(JSON.parse(rows[1].payload).find((item) => item.id === proposal.ruleId).version, 2);
});
