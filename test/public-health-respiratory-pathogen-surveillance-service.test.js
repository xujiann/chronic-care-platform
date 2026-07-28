"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RESPIRATORY_PANEL,
  RESPIRATORY_PATHOGENS,
  buildPublicHealthRespiratoryPathogenSurveillance,
  ingestPublicHealthRespiratoryPathogenBatchToState,
  publishPublicHealthRespiratoryPathogenSignalsToState,
  verifyPublicHealthRespiratoryPathogenBatchToState
} = require("../public-health-respiratory-pathogen-surveillance-service");

function results(specimenCount = 20) {
  const positives = new Map([
    ["influenza-a", 4],
    ["rsv", 3],
    ["mycoplasma-pneumoniae", 2]
  ]);
  return RESPIRATORY_PATHOGENS.map((item) => ({
    pathogenCode: item.code,
    testedSpecimens: specimenCount,
    positiveSpecimens: positives.get(item.code) || 0
  }));
}

function batchPayload(index = 1, overrides = {}) {
  return {
    sourceId: "ph-source-laboratory-pathogen",
    externalBatchId: `RESP-PANEL-BATCH-20260729-${String(index).padStart(3, "0")}`,
    panelId: RESPIRATORY_PANEL.id,
    panelVersion: RESPIRATORY_PANEL.version,
    institutionId: `sentinel-laboratory-${String(index).padStart(3, "0")}`,
    regionCode: "210202",
    observedAt: `2026-07-29T08:0${index}:00.000Z`,
    receivedAt: `2026-07-29T08:1${index}:00.000Z`,
    specimenCount: 20,
    ageGroup: index === 1 ? "child" : "older-adult",
    placeType: index === 1 ? "school" : "elderly-care",
    results: results(),
    evidenceRefs: [`RESP-PANEL-RESULT-${index}`, `RESP-LAB-QC-${index}`],
    idempotencyKey: `resp-panel-intake-${index}`,
    ...overrides
  };
}

function verifiedBatch(data = {}, index = 1) {
  const intake = ingestPublicHealthRespiratoryPathogenBatchToState(
    data,
    batchPayload(index),
    { name: `哨点实验室-${index}`, role: "laboratory" }
  );
  return verifyPublicHealthRespiratoryPathogenBatchToState(
    intake.nextData,
    intake.batch.id,
    {
      decision: "confirmed",
      note: "已人工复核面板版本、质控证据和聚合计数",
      evidenceRefs: [`RESP-BATCH-HUMAN-VERIFY-${index}`],
      idempotencyKey: `resp-batch-verify-${index}`,
      expectedVersion: 1,
      at: `2026-07-29T08:2${index}:00.000Z`
    },
    { name: `疾控呼吸道监测员-${index}`, role: "cdc-surveillance" }
  );
}

function publicationPayload(index = 1, overrides = {}) {
  return {
    note: "将人工复核的阳性病原聚合结果发布为最小化监测信号",
    evidenceRefs: [`RESP-BATCH-PUBLISH-${index}`],
    idempotencyKey: `resp-batch-publish-${index}`,
    expectedVersion: 2,
    at: `2026-07-29T08:3${index}:00.000Z`,
    ...overrides
  };
}

test("respiratory catalog covers more than 15 pathogens with an 18-pathogen panel", () => {
  const board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: {},
    at: "2026-07-29T08:00:00.000Z"
  });
  assert.equal(RESPIRATORY_PATHOGENS.length, 18);
  assert.equal(RESPIRATORY_PANEL.planningMinimumPathogens, 15);
  assert.equal(board.summary.catalogPathogens, 18);
  assert.equal(board.summary.observedPathogens, 0);
  assert.equal(board.summary.planningCoverageReady, false);
  assert.equal(board.productionReady, false);
});

test("aggregated child and older-adult batches prove one-sample multi-test planning coverage", () => {
  const first = ingestPublicHealthRespiratoryPathogenBatchToState(
    {},
    batchPayload(1),
    { name: "儿童哨点实验室", role: "laboratory" }
  );
  const second = ingestPublicHealthRespiratoryPathogenBatchToState(
    first.nextData,
    batchPayload(2),
    { name: "老年哨点实验室", role: "laboratory" }
  );
  const serialized = JSON.stringify(second.nextData);
  assert.equal(serialized.includes("RESP-PANEL-BATCH-20260729-001"), false);
  assert.equal(serialized.includes("resp-panel-intake-001"), false);
  assert.equal(second.batch.sourceRecordHash.length, 64);
  assert.equal(second.batch.idempotencyKeyHash.length, 64);

  const board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: second.nextData,
    at: "2026-07-29T08:20:00.000Z"
  });
  assert.equal(board.ok, true);
  assert.equal(board.summary.observedPathogens, 18);
  assert.equal(board.summary.oneSampleMultiTestBatches, 2);
  assert.equal(board.summary.childBatches, 1);
  assert.equal(board.summary.olderAdultBatches, 1);
  assert.equal(board.summary.priorityPlaceBatches, 2);
  assert.equal(board.summary.institutions, 2);
  assert.equal(board.summary.planningCoverageReady, true);
  assert.equal(board.productionReady, false);

  const replay = ingestPublicHealthRespiratoryPathogenBatchToState(
    second.nextData,
    batchPayload(1),
    { name: "儿童哨点实验室", role: "laboratory" }
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthRespiratoryPathogenBatches.length, 2);
});

test("incomplete panels remain visible for quality review and cannot be confirmed", () => {
  const incompleteResults = results().slice(0, 14);
  incompleteResults[0] = {
    ...incompleteResults[0],
    testedSpecimens: 12,
    positiveSpecimens: Math.min(incompleteResults[0].positiveSpecimens, 12)
  };
  const intake = ingestPublicHealthRespiratoryPathogenBatchToState(
    {},
    batchPayload(3, {
      ageGroup: "general",
      placeType: "community",
      results: incompleteResults,
      idempotencyKey: "resp-incomplete-intake"
    }),
    { name: "不完整面板实验室", role: "laboratory" }
  );
  let board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: intake.nextData,
    at: "2026-07-29T08:30:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.findings.some((item) => item.code === "respiratory-pathogen-coverage-below-15"), true);
  assert.equal(board.findings.some((item) => item.code === "one-sample-multi-test-incomplete"), true);
  assert.throws(
    () => verifyPublicHealthRespiratoryPathogenBatchToState(
      intake.nextData,
      intake.batch.id,
      {
        decision: "confirmed",
        note: "不能确认不完整面板",
        evidenceRefs: ["RESP-INCOMPLETE-VERIFY"],
        idempotencyKey: "resp-incomplete-verify",
        expectedVersion: 1,
        at: "2026-07-29T08:31:00.000Z"
      },
      { name: "疾控监测员", role: "cdc-surveillance" }
    ),
    /cannot be confirmed/
  );

  const dismissed = verifyPublicHealthRespiratoryPathogenBatchToState(
    intake.nextData,
    intake.batch.id,
    {
      decision: "dismissed",
      note: "退回补齐病原覆盖和同一样本检测",
      evidenceRefs: ["RESP-INCOMPLETE-RETURN"],
      idempotencyKey: "resp-incomplete-dismiss",
      expectedVersion: 1,
      at: "2026-07-29T08:32:00.000Z"
    },
    { name: "疾控监测员", role: "cdc-surveillance" }
  );
  assert.equal(dismissed.batch.status, "dismissed");
  board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: dismissed.nextData,
    at: "2026-07-29T08:33:00.000Z"
  });
  assert.equal(board.productionReady, false);
});

test("verified multi-pathogen batch publishes positive minimized signals but never creates alerts", () => {
  const verified = verifiedBatch();
  const published = publishPublicHealthRespiratoryPathogenSignalsToState(
    verified.nextData,
    verified.batch.id,
    publicationPayload(),
    { name: "呼吸道信号发布服务", role: "system" }
  );
  assert.equal(published.ok, true);
  assert.equal(published.batch.status, "published");
  assert.equal(published.signalIds.length, 3);
  assert.equal(published.nextData.publicHealthSurveillanceSignals.length, 3);
  assert.equal(published.nextData.publicHealthSurveillanceAlerts, undefined);
  assert.deepEqual(
    published.nextData.publicHealthSurveillanceSignals.map((item) => item.pathogenCode).sort(),
    ["influenza-a", "mycoplasma-pneumoniae", "rsv"]
  );
  assert.equal(published.nextData.publicHealthSurveillanceSignals.every((item) => item.workflowState === "received"), true);
  assert.equal(published.nextData.publicHealthSurveillanceSignals.every((item) => item.verification === null), true);
  assert.equal(published.productionReady, false);

  const replay = publishPublicHealthRespiratoryPathogenSignalsToState(
    published.nextData,
    verified.batch.id,
    publicationPayload(),
    { name: "呼吸道信号发布服务", role: "system" }
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthSurveillanceSignals.length, 3);

  const board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: published.nextData,
    at: "2026-07-29T08:40:00.000Z"
  });
  assert.equal(board.ok, true);
  assert.equal(board.summary.humanVerifiedBatches, 1);
  assert.equal(board.summary.publishedBatches, 1);
  assert.equal(board.summary.publishedSignals, 3);
  assert.match(board.blockers.join(" "), /still require human verification/i);
});

test("respiratory workflow enforces roles identifiers versions and payload-bound idempotency", () => {
  assert.throws(
    () => ingestPublicHealthRespiratoryPathogenBatchToState(
      {},
      batchPayload(1, { patientId: "forbidden" }),
      { name: "哨点实验室", role: "laboratory" }
    ),
    /direct resident or specimen identifier/
  );
  assert.throws(
    () => ingestPublicHealthRespiratoryPathogenBatchToState(
      {},
      batchPayload(1),
      { name: "居民", role: "resident" }
    ),
    /not allowed/
  );
  const verified = verifiedBatch();
  assert.throws(
    () => publishPublicHealthRespiratoryPathogenSignalsToState(
      verified.nextData,
      verified.batch.id,
      publicationPayload(1, { expectedVersion: 99 }),
      { name: "呼吸道信号发布服务", role: "system" }
    ),
    /version conflict/
  );
  const published = publishPublicHealthRespiratoryPathogenSignalsToState(
    verified.nextData,
    verified.batch.id,
    publicationPayload(),
    { name: "呼吸道信号发布服务", role: "system" }
  );
  assert.throws(
    () => publishPublicHealthRespiratoryPathogenSignalsToState(
      published.nextData,
      verified.batch.id,
      publicationPayload(1, { note: "复用密钥但改变发布决策" }),
      { name: "呼吸道信号发布服务", role: "system" }
    ),
    /idempotency or signal binding conflict/
  );
});

test("persisted batch result verification signal binding duplicates and orphan audits fail closed", () => {
  const verified = verifiedBatch();
  const published = publishPublicHealthRespiratoryPathogenSignalsToState(
    verified.nextData,
    verified.batch.id,
    publicationPayload(),
    { name: "呼吸道信号发布服务", role: "system" }
  );

  const tamperedResult = JSON.parse(JSON.stringify(published.nextData));
  tamperedResult.publicHealthRespiratoryPathogenBatches[0].results[0].positiveSpecimens += 1;
  let board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: tamperedResult,
    at: "2026-07-29T08:41:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.findings.some((item) => item.code === "respiratory-batch-content-fingerprint-invalid"), true);

  const tamperedSignal = JSON.parse(JSON.stringify(published.nextData));
  tamperedSignal.publicHealthSurveillanceSignals[0].pathogenCode = "adenovirus";
  board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: tamperedSignal,
    at: "2026-07-29T08:42:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.findings.some((item) => item.code === "respiratory-batch-signal-binding-invalid"), true);

  const tamperedVerification = JSON.parse(JSON.stringify(published.nextData));
  tamperedVerification.publicHealthRespiratoryPathogenBatches[0].verification.note = "签名后篡改复核说明";
  board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: tamperedVerification,
    at: "2026-07-29T08:42:30.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.findings.some((item) => item.code === "respiratory-batch-verification-integrity-invalid"), true);

  const duplicated = JSON.parse(JSON.stringify(published.nextData));
  duplicated.publicHealthRespiratoryPathogenBatches.push(
    JSON.parse(JSON.stringify(duplicated.publicHealthRespiratoryPathogenBatches[0]))
  );
  board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: duplicated,
    at: "2026-07-29T08:43:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.findings.some((item) => item.code === "respiratory-batch-duplicate"), true);

  const orphanAudit = JSON.parse(JSON.stringify(published.nextData));
  orphanAudit.publicHealthRespiratoryPathogenAudit.push({
    id: "orphan-audit",
    batchId: "missing-batch",
    action: "ingest-respiratory-pathogen-batch",
    version: 1
  });
  board = buildPublicHealthRespiratoryPathogenSurveillance({
    data: orphanAudit,
    at: "2026-07-29T08:44:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.findings.some((item) => item.code === "respiratory-batch-audit-orphan"), true);
  assert.equal(board.productionReady, false);
});
