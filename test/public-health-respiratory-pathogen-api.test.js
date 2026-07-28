"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  RESPIRATORY_PATHOGENS
} = require("../public-health-respiratory-pathogen-surveillance-service");

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

function aggregateResults(specimenCount, positives = {}) {
  return RESPIRATORY_PATHOGENS.map((item) => ({
    pathogenCode: item.code,
    testedSpecimens: specimenCount,
    positiveSpecimens: Number(positives[item.code] || 0)
  }));
}

function intakePayload(externalBatchId, results, overrides = {}) {
  return {
    expectedVersion: 0,
    externalBatchId,
    institutionId: "sentinel-laboratory-001",
    regionCode: "210202",
    observedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    ageGroup: "child",
    placeType: "school",
    specimenCount: 20,
    results,
    evidenceRefs: ["RESPIRATORY-PANEL-AGGREGATE-EVIDENCE"],
    ...overrides
  };
}

test("respiratory pathogen API persists aggregate batches and signals atomically without trust bypass", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-respiratory-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = ["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: "public-health-respiratory-api-session-secret-2026",
    SESSION_STORE: "memory"
  });

  const {
    readDatabase,
    server,
    startServer,
    stopServer,
    writeDatabase
  } = require("../server");
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
  const hospitalToken = await login(baseUrl, "hospital");
  const baseline = readDatabase();
  const baselineSignals = baseline.publicHealthSurveillanceSignals?.length || 0;
  const baselineLineage = baseline.publicHealthDataLineageAudit?.length || 0;
  const alertsBefore = JSON.stringify(baseline.publicHealthSurveillanceAlerts || []);

  const anonymous = await request(baseUrl, "/api/public-health/respiratory-pathogen-surveillance");
  assert.equal(anonymous.response.status, 401);
  const forbidden = await request(
    baseUrl,
    "/api/public-health/respiratory-pathogen-surveillance",
    hospitalToken
  );
  assert.equal(forbidden.response.status, 403);
  const queryOverride = await request(
    baseUrl,
    "/api/public-health/respiratory-pathogen-surveillance?at=2030-01-01T00:00:00.000Z",
    healthToken
  );
  assert.equal(queryOverride.response.status, 400);
  assert.equal(queryOverride.body.code, "PUBLIC_HEALTH_RESPIRATORY_PATHOGEN_PAYLOAD_FORBIDDEN");

  const completeResults = aggregateResults(20, {
    "influenza-a": 3,
    rsv: 2,
    "mycoplasma-pneumoniae": 1
  });
  const institutionScopeOverride = await post(
    baseUrl,
    "/api/public-health/respiratory-pathogen-batches",
    hospitalToken,
    "respiratory-api-institution-scope-override",
    intakePayload("RESP-API-SCOPE-OVERRIDE-001", completeResults)
  );
  assert.equal(institutionScopeOverride.response.status, 403);
  assert.equal(institutionScopeOverride.body.code, "PUBLIC_HEALTH_MODERNIZATION_FORBIDDEN");

  for (const [suffix, injected] of [
    ["status", { status: "human-verified" }],
    ["verification", { verification: { decision: "confirmed" } }],
    ["rate", { results: [{ ...completeResults[0], positivityRate: 1 }, ...completeResults.slice(1)] }],
    ["resident", { residentId: "resident-forged" }],
    ["sample", { metadata: { sampleId: "sample-forged" } }],
    ["panel", { panelId: "client-panel", panelVersion: 99 }]
  ]) {
    const forged = await post(
      baseUrl,
      "/api/public-health/respiratory-pathogen-batches",
      healthToken,
      `respiratory-api-forged-${suffix}`,
      intakePayload(`RESP-API-FORGED-${suffix}-001`, completeResults, injected)
    );
    assert.equal(forged.response.status, 400, `${suffix}: ${JSON.stringify(forged.body)}`);
    assert.equal(forged.body.code, "PUBLIC_HEALTH_RESPIRATORY_PATHOGEN_PAYLOAD_FORBIDDEN");
  }

  const incompleteExternalId = "RESP-API-INCOMPLETE-001";
  const incompleteResults = completeResults.map((item, index) => index === 0
    ? { ...item, testedSpecimens: 19, positiveSpecimens: 0 }
    : item);
  const incomplete = await post(
    baseUrl,
    "/api/public-health/respiratory-pathogen-batches",
    healthToken,
    "respiratory-api-incomplete-intake",
    intakePayload(incompleteExternalId, incompleteResults)
  );
  assert.equal(incomplete.response.status, 201, JSON.stringify(incomplete.body));
  assert.equal(incomplete.body.batch.oneSampleMultiTest, false);
  assert.doesNotMatch(
    JSON.stringify(incomplete.body),
    /externalBatchId|sourceRecordHash|idempotencyKeyHash|contentFingerprint|verification|publication|integrityDigest/i
  );
  const incompleteConfirm = await post(
    baseUrl,
    `/api/public-health/respiratory-pathogen-batches/${encodeURIComponent(incomplete.body.batch.id)}/actions`,
    healthToken,
    "respiratory-api-incomplete-confirm",
    {
      action: "verify-respiratory-pathogen-batch",
      expectedVersion: 1,
      decision: "confirmed",
      note: "forged confirmation of incomplete panel",
      evidenceRefs: ["RESPIRATORY-INCOMPLETE-REVIEW"]
    }
  );
  assert.equal(incompleteConfirm.response.status, 400, JSON.stringify(incompleteConfirm.body));

  const externalBatchId = "RESP-API-COMPLETE-001";
  const intake = await post(
    baseUrl,
    "/api/public-health/respiratory-pathogen-batches",
    healthToken,
    "respiratory-api-complete-intake",
    intakePayload(externalBatchId, completeResults)
  );
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  assert.equal(intake.body.batch.pathogenCoverage, 18);
  assert.equal(intake.body.batch.oneSampleMultiTest, true);
  assert.equal(intake.body.batch.status, "received");
  assert.equal(intake.body.productionReady, false);

  const prematurePublish = await post(
    baseUrl,
    `/api/public-health/respiratory-pathogen-batches/${encodeURIComponent(intake.body.batch.id)}/actions`,
    healthToken,
    "respiratory-api-premature-publish",
    {
      action: "publish-respiratory-pathogen-signals",
      expectedVersion: 1,
      note: "must remain blocked",
      evidenceRefs: ["RESPIRATORY-PREMATURE-PUBLISH"]
    }
  );
  assert.equal(prematurePublish.response.status, 409, JSON.stringify(prematurePublish.body));
  assert.equal(prematurePublish.body.code, "PUBLIC_HEALTH_MODERNIZATION_STATE_CONFLICT");

  const forgedVerification = await post(
    baseUrl,
    `/api/public-health/respiratory-pathogen-batches/${encodeURIComponent(intake.body.batch.id)}/actions`,
    healthToken,
    "respiratory-api-forged-verification",
    {
      action: "verify-respiratory-pathogen-batch",
      expectedVersion: 1,
      decision: "confirmed",
      verification: { signatureVerified: true },
      positivityRate: 1,
      signalIds: ["forged-signal"],
      note: "forged verification",
      evidenceRefs: ["RESPIRATORY-FORGED-VERIFICATION"]
    }
  );
  assert.equal(forgedVerification.response.status, 400);
  assert.equal(forgedVerification.body.code, "PUBLIC_HEALTH_RESPIRATORY_PATHOGEN_PAYLOAD_FORBIDDEN");

  const verified = await post(
    baseUrl,
    `/api/public-health/respiratory-pathogen-batches/${encodeURIComponent(intake.body.batch.id)}/actions`,
    healthToken,
    "respiratory-api-complete-verify",
    {
      action: "verify-respiratory-pathogen-batch",
      expectedVersion: 1,
      decision: "confirmed",
      note: "aggregate panel independently confirmed",
      evidenceRefs: ["RESPIRATORY-COMPLETE-VERIFICATION"]
    }
  );
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.batch.status, "human-verified");
  assert.equal(verified.body.batch.version, 2);

  const forgedPublication = await post(
    baseUrl,
    `/api/public-health/respiratory-pathogen-batches/${encodeURIComponent(intake.body.batch.id)}/actions`,
    healthToken,
    "respiratory-api-forged-publication",
    {
      action: "publish-respiratory-pathogen-signals",
      expectedVersion: 2,
      signalIds: ["forged-signal"],
      publication: { signatureVerified: true },
      note: "forged signal binding",
      evidenceRefs: ["RESPIRATORY-FORGED-PUBLICATION"]
    }
  );
  assert.equal(forgedPublication.response.status, 400);
  assert.equal(forgedPublication.body.code, "PUBLIC_HEALTH_RESPIRATORY_PATHOGEN_PAYLOAD_FORBIDDEN");

  const published = await post(
    baseUrl,
    `/api/public-health/respiratory-pathogen-batches/${encodeURIComponent(intake.body.batch.id)}/actions`,
    healthToken,
    "respiratory-api-complete-publish",
    {
      action: "publish-respiratory-pathogen-signals",
      expectedVersion: 2,
      note: "publish minimized pathogen signals for human review",
      evidenceRefs: ["RESPIRATORY-PUBLICATION-APPROVAL"]
    }
  );
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.batch.status, "published");
  assert.equal(published.body.batch.publishedSignals, 3);
  assert.equal(published.body.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify(published.body),
    /externalBatchId|sourceRecordHash|idempotencyKeyHash|contentFingerprint|integrityDigest|signalIds/i
  );

  const persisted = readDatabase();
  const newSignals = persisted.publicHealthSurveillanceSignals.slice(baselineSignals);
  assert.equal(newSignals.length, 3);
  assert.equal(newSignals.every((item) =>
    item.signalType === "laboratory-pathogen"
    && item.workflowState === "received"
    && item.verification === null), true);
  assert.equal(JSON.stringify(persisted.publicHealthSurveillanceAlerts || []), alertsBefore);
  assert.equal(
    persisted.publicHealthDataLineageAudit.length,
    baselineLineage + 3
  );
  assert.equal(persisted.publicHealthRespiratoryPathogenBatches.length, 2);
  assert.equal(persisted.publicHealthRespiratoryPathogenAudit.length, 4);
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(externalBatchId, "i"));
  assert.doesNotMatch(JSON.stringify(persisted), /respiratory-api-complete-(?:intake|verify|publish)/i);

  const duplicate = structuredClone(persisted);
  duplicate.publicHealthRespiratoryPathogenBatches.push(
    structuredClone(duplicate.publicHealthRespiratoryPathogenBatches[1])
  );
  assert.throws(
    () => writeDatabase(duplicate, { event: "respiratory-duplicate-negative" }),
    /unique conflict/i
  );

  const goodState = structuredClone(persisted);
  const tampered = structuredClone(goodState);
  tampered.publicHealthRespiratoryPathogenBatches[1].results[0].positiveSpecimens += 1;
  writeDatabase(tampered, { event: "respiratory-tamper-negative" });
  const tamperedBoard = await request(
    baseUrl,
    "/api/public-health/respiratory-pathogen-surveillance",
    healthToken
  );
  assert.equal(tamperedBoard.response.status, 200);
  assert.equal(tamperedBoard.body.ok, false);
  assert.equal(tamperedBoard.body.summary.planningCoverageReady, false);
  assert.equal(tamperedBoard.body.findings.some((item) =>
    /respiratory-pathogen-counts-invalid|respiratory-batch-content-fingerprint-invalid/.test(item.code)), true);

  goodState.storageMeta = readDatabase().storageMeta;
  writeDatabase(goodState, { event: "respiratory-restore-before-orphan-negative" });
  const orphaned = structuredClone(readDatabase());
  orphaned.publicHealthRespiratoryPathogenAudit.push({
    id: "respiratory-orphan-audit",
    batchId: "missing-respiratory-batch",
    action: "ingest-respiratory-pathogen-batch",
    version: 1,
    contentFingerprint: "0".repeat(64)
  });
  writeDatabase(orphaned, { event: "respiratory-orphan-negative" });
  const orphanBoard = await request(
    baseUrl,
    "/api/public-health/respiratory-pathogen-surveillance",
    healthToken
  );
  assert.equal(orphanBoard.body.ok, false);
  assert.equal(orphanBoard.body.findings.some((item) =>
    item.code === "respiratory-batch-audit-orphan"), true);

  goodState.storageMeta = readDatabase().storageMeta;
  writeDatabase(goodState, { event: "respiratory-restore-final" });
  const { DatabaseSync } = require("node:sqlite");
  const sqlite = new DatabaseSync(path.join(dataDir, "health-city.sqlite"));
  const rows = sqlite.prepare(`
    SELECT key, payload
    FROM state_collections
    WHERE key IN (
      'publicHealthRespiratoryPathogenBatches',
      'publicHealthRespiratoryPathogenAudit',
      'publicHealthSurveillanceSignals',
      'publicHealthDataLineageAudit'
    )
  `).all();
  sqlite.close();
  assert.equal(rows.length, 4);
  const sqliteState = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.payload)]));
  assert.equal(sqliteState.publicHealthRespiratoryPathogenBatches.length, 2);
  assert.equal(sqliteState.publicHealthRespiratoryPathogenAudit.length, 4);
  assert.equal(sqliteState.publicHealthSurveillanceSignals.length, baselineSignals + 3);
  assert.equal(sqliteState.publicHealthDataLineageAudit.length, baselineLineage + 3);
});
