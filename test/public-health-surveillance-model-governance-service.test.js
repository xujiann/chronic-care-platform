"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ingestPublicHealthSurveillanceSignalToState
} = require("../public-health-data-foundation-service");
const {
  verifyPublicHealthSurveillanceSignalToState
} = require("../public-health-surveillance-workflow-service");
const {
  buildPublicHealthSurveillanceModelGovernance,
  reviewPublicHealthSurveillanceModelValidationToState,
  runPublicHealthSurveillanceModelToState,
  submitPublicHealthSurveillanceModelValidationToState
} = require("../public-health-surveillance-model-governance-service");

function signalPayload(kind, index) {
  if (kind === "clinical") {
    return {
      sourceId: "ph-source-clinical-syndrome",
      externalSignalId: `MODEL-CLINICAL-${index}`,
      signalType: "clinical-syndrome",
      institutionId: "medical-institution-model-001",
      regionCode: "210202",
      observedAt: `2026-07-28T08:0${index}:00.000Z`,
      metrics: [{
        metricCode: "fever-respiratory-count",
        value: 18,
        unit: "cases/24h",
        baseline: 3
      }],
      evidenceRefs: [`MODEL-CLINICAL-EVIDENCE-${index}`],
      idempotencyKey: `model-clinical-intake-${index}`
    };
  }
  return {
    sourceId: "ph-source-laboratory-pathogen",
    externalSignalId: `MODEL-LAB-${index}`,
    signalType: "laboratory-pathogen",
    institutionId: "laboratory-model-001",
    regionCode: "210202",
    observedAt: `2026-07-28T08:0${index}:30.000Z`,
    metrics: [{
      metricCode: "pathogen-positive-count",
      value: 12,
      unit: "positive/24h",
      baseline: 2
    }],
    evidenceRefs: [`MODEL-LAB-EVIDENCE-${index}`],
    idempotencyKey: `model-lab-intake-${index}`
  };
}

function addVerifiedSignal(data, kind, index) {
  const intake = ingestPublicHealthSurveillanceSignalToState(
    data,
    signalPayload(kind, index),
    {
      name: kind === "clinical" ? "医院公共卫生科" : "疾控实验室",
      role: kind === "clinical" ? "medical-public-health" : "laboratory"
    },
    { at: `2026-07-28T08:1${index}:00.000Z` }
  );
  return verifyPublicHealthSurveillanceSignalToState(
    intake.nextData,
    intake.signal.id,
    {
      decision: "confirmed",
      note: "已完成人工来源、口径和证据核实",
      evidenceRefs: [`MODEL-HUMAN-VERIFY-${kind}-${index}`],
      idempotencyKey: `model-human-verify-${kind}-${index}`,
      expectedVersion: 1,
      at: `2026-07-28T08:2${index}:00.000Z`
    },
    { name: `疾控监测员-${kind}-${index}`, role: "cdc-surveillance" }
  );
}

function preparedSignals() {
  const first = addVerifiedSignal({}, "clinical", 1);
  const second = addVerifiedSignal(first.nextData, "laboratory", 2);
  return {
    data: second.nextData,
    signalIds: [
      first.signal.id,
      second.signal.id
    ]
  };
}

function modelRunPayload(signalIds, overrides = {}) {
  return {
    expectedModelVersion: 1,
    signalIds,
    windowStart: "2026-07-28T08:00:00.000Z",
    windowEnd: "2026-07-28T09:00:00.000Z",
    evidenceRefs: ["MODEL-RUN-DATASET-SNAPSHOT-001"],
    idempotencyKey: "model-cross-source-run-001",
    at: "2026-07-28T09:01:00.000Z",
    ...overrides
  };
}

function validationPayload(overrides = {}) {
  return {
    expectedModelVersion: 1,
    sampleWindowStart: "2026-07-01T00:00:00.000Z",
    sampleWindowEnd: "2026-07-27T23:59:59.000Z",
    sampleSize: 120,
    sensitivity: 0.91,
    positivePredictiveValue: 0.72,
    falseNegativeRate: 0.07,
    note: "完成回顾性样本验证并提交独立复核",
    evidenceRefs: ["MODEL-VALIDATION-DATASET-001", "MODEL-VALIDATION-REPORT-001"],
    idempotencyKey: "model-validation-submit-001",
    at: "2026-07-28T09:10:00.000Z",
    ...overrides
  };
}

test("model governance exposes a versioned advisory-only model library", () => {
  const board = buildPublicHealthSurveillanceModelGovernance({
    data: {},
    at: "2026-07-28T09:00:00.000Z"
  });
  assert.equal(board.ok, true);
  assert.equal(board.summary.models, 3);
  assert.equal(board.summary.shadowModels, 3);
  assert.equal(board.summary.validatedShadowModels, 0);
  assert.equal(board.models.every((item) => item.status === "shadow"), true);
  assert.equal(board.models.every((item) => item.productionReady === false), true);
  assert.equal(board.productionReady, false);
  assert.match(board.blockers.join(" "), /cannot create, verify, publish or close/i);
});

test("human-verified cross-source signals create an explainable shadow observation without changing business state", () => {
  const prepared = preparedSignals();
  const beforeSignals = JSON.parse(JSON.stringify(prepared.data.publicHealthSurveillanceSignals));
  const result = runPublicHealthSurveillanceModelToState(
    prepared.data,
    "ph-model-cross-source-concordance",
    modelRunPayload(prepared.signalIds),
    { name: "模型影子执行器", role: "system" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.run.status, "shadow-observation");
  assert.equal(result.run.output.modelAdviceOnly, true);
  assert.equal(result.run.output.humanDecisionRequired, true);
  assert.equal(result.run.output.alertCreated, false);
  assert.equal(result.run.output.riskBand, "manual-review-recommended");
  assert.deepEqual(result.nextData.publicHealthSurveillanceSignals, beforeSignals);
  assert.equal(result.nextData.publicHealthSurveillanceAlerts, undefined);
  assert.equal(result.productionReady, false);

  const replay = runPublicHealthSurveillanceModelToState(
    result.nextData,
    "ph-model-cross-source-concordance",
    modelRunPayload(prepared.signalIds),
    { name: "模型影子执行器", role: "system" }
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthSurveillanceModelRuns.length, 1);

  const board = buildPublicHealthSurveillanceModelGovernance({
    data: result.nextData,
    at: "2026-07-28T09:02:00.000Z"
  });
  assert.equal(board.ok, true);
  assert.equal(board.summary.modelRuns, 1);
  assert.equal(board.summary.manualReviewRecommendations, 1);
});

test("model runs reject unverified data, insufficient source diversity, identifiers and payload-conflicting replay", () => {
  const intake = ingestPublicHealthSurveillanceSignalToState(
    {},
    signalPayload("clinical", 1),
    { name: "医院公共卫生科", role: "medical-public-health" },
    { at: "2026-07-28T08:11:00.000Z" }
  );
  assert.throws(
    () => runPublicHealthSurveillanceModelToState(
      intake.nextData,
      "ph-model-baseline-deviation",
      modelRunPayload([intake.signal.id], { idempotencyKey: "unverified-run" }),
      { name: "模型影子执行器", role: "system" }
    ),
    /human-verified/
  );

  const oneSource = addVerifiedSignal({}, "clinical", 1);
  assert.throws(
    () => runPublicHealthSurveillanceModelToState(
      oneSource.nextData,
      "ph-model-cross-source-concordance",
      modelRunPayload([oneSource.signal.id], { idempotencyKey: "insufficient-diversity" }),
      { name: "模型影子执行器", role: "system" }
    ),
    /at least 2 signals|at least 2 distinct sources/
  );

  const prepared = preparedSignals();
  assert.throws(
    () => runPublicHealthSurveillanceModelToState(
      prepared.data,
      "ph-model-cross-source-concordance",
      modelRunPayload(prepared.signalIds, { residentId: "forbidden" }),
      { name: "模型影子执行器", role: "system" }
    ),
    /direct resident identifier/
  );
  assert.throws(
    () => runPublicHealthSurveillanceModelToState(
      prepared.data,
      "ph-model-cross-source-concordance",
      modelRunPayload(prepared.signalIds),
      { name: "居民", role: "resident" }
    ),
    /not allowed/
  );

  const first = runPublicHealthSurveillanceModelToState(
    prepared.data,
    "ph-model-cross-source-concordance",
    modelRunPayload(prepared.signalIds),
    { name: "模型影子执行器", role: "system" }
  );
  assert.throws(
    () => runPublicHealthSurveillanceModelToState(
      first.nextData,
      "ph-model-cross-source-concordance",
      modelRunPayload(prepared.signalIds, {
        windowEnd: "2026-07-28T10:00:00.000Z"
      }),
      { name: "模型影子执行器", role: "system" }
    ),
    /idempotency key payload conflict/
  );
});

test("model validation requires independent review and retains the shadow-only boundary", () => {
  const submitted = submitPublicHealthSurveillanceModelValidationToState(
    {},
    "ph-model-cross-source-concordance",
    validationPayload(),
    { name: "疾控模型管理员", role: "cdc-surveillance" }
  );
  assert.equal(submitted.validation.status, "submitted");
  assert.equal(submitted.validation.performanceGatePassed, true);
  const replay = submitPublicHealthSurveillanceModelValidationToState(
    submitted.nextData,
    "ph-model-cross-source-concordance",
    validationPayload({ at: "2026-07-28T09:11:00.000Z" }),
    { name: "疾控模型管理员", role: "cdc-surveillance" }
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthSurveillanceModelValidations.length, 1);

  assert.throws(
    () => reviewPublicHealthSurveillanceModelValidationToState(
      submitted.nextData,
      submitted.validation.id,
      {
        decision: "approved",
        note: "同人变换角色不能完成独立复核",
        evidenceRefs: ["MODEL-SELF-REVIEW"],
        idempotencyKey: "model-validation-self-review",
        expectedVersion: 1,
        at: "2026-07-28T09:20:00.000Z"
      },
      { name: "疾控模型管理员", role: "commission" }
    ),
    /independent reviewer/
  );

  const reviewed = reviewPublicHealthSurveillanceModelValidationToState(
    submitted.nextData,
    submitted.validation.id,
    {
      decision: "approved",
      note: "独立复核数据集、指标口径和误判样本后同意继续影子运行",
      evidenceRefs: ["MODEL-INDEPENDENT-REVIEW-001"],
      idempotencyKey: "model-validation-review-001",
      expectedVersion: 1,
      at: "2026-07-28T09:21:00.000Z"
    },
    { name: "委级模型复核员", role: "commission" }
  );
  assert.equal(reviewed.validation.status, "validated-shadow");
  assert.equal(reviewed.validation.version, 2);
  assert.equal(reviewed.productionReady, false);
  const board = buildPublicHealthSurveillanceModelGovernance({
    data: reviewed.nextData,
    at: "2026-07-28T09:22:00.000Z"
  });
  assert.equal(board.ok, true);
  assert.equal(board.summary.validatedShadowModels, 1);
  assert.equal(board.summary.driftReviewsDue, 0);
  assert.equal(board.models.find((item) => item.id === "ph-model-cross-source-concordance").validatedForShadowUse, true);
  assert.equal(board.productionReady, false);

  const staleBoard = buildPublicHealthSurveillanceModelGovernance({
    data: reviewed.nextData,
    at: "2026-11-01T09:22:00.000Z"
  });
  const staleModel = staleBoard.models.find((item) => item.id === "ph-model-cross-source-concordance");
  assert.equal(staleBoard.ok, true);
  assert.equal(staleBoard.summary.validatedShadowModels, 0);
  assert.equal(staleBoard.summary.driftReviewsDue, 1);
  assert.equal(staleModel.driftState, "review-due");
  assert.equal(staleModel.validatedForShadowUse, false);
});

test("sub-threshold model performance enters remediation and persisted tampering fails closed", () => {
  const submitted = submitPublicHealthSurveillanceModelValidationToState(
    {},
    "ph-model-baseline-deviation",
    validationPayload({
      sensitivity: 0.62,
      positivePredictiveValue: 0.35,
      falseNegativeRate: 0.22,
      idempotencyKey: "model-low-performance-submit"
    }),
    { name: "疾控模型管理员二", role: "cdc-surveillance" }
  );
  const reviewed = reviewPublicHealthSurveillanceModelValidationToState(
    submitted.nextData,
    submitted.validation.id,
    {
      decision: "approved",
      note: "指标未达影子验证门槛，转入整改",
      evidenceRefs: ["MODEL-LOW-PERFORMANCE-REVIEW"],
      idempotencyKey: "model-low-performance-review",
      expectedVersion: 1,
      at: "2026-07-28T09:30:00.000Z"
    },
    { name: "委级模型复核员二", role: "commission" }
  );
  assert.equal(reviewed.validation.status, "remediation-required");
  let board = buildPublicHealthSurveillanceModelGovernance({
    data: reviewed.nextData,
    at: "2026-07-28T09:31:00.000Z"
  });
  assert.equal(board.summary.remediationRequired, 1);
  assert.equal(board.productionReady, false);

  const prepared = preparedSignals();
  const run = runPublicHealthSurveillanceModelToState(
    prepared.data,
    "ph-model-cross-source-concordance",
    modelRunPayload(prepared.signalIds),
    { name: "模型影子执行器", role: "system" }
  );
  const tamperedRun = JSON.parse(JSON.stringify(run.nextData));
  tamperedRun.publicHealthSurveillanceModelRuns[0].output.score = 0;
  board = buildPublicHealthSurveillanceModelGovernance({
    data: tamperedRun,
    at: "2026-07-28T09:32:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.summary.modelRuns, 0);
  assert.equal(board.findings.some((item) => item.code === "model-run-output-invalid"), true);

  const duplicatedRun = JSON.parse(JSON.stringify(run.nextData));
  duplicatedRun.publicHealthSurveillanceModelRuns.push(
    JSON.parse(JSON.stringify(duplicatedRun.publicHealthSurveillanceModelRuns[0]))
  );
  board = buildPublicHealthSurveillanceModelGovernance({
    data: duplicatedRun,
    at: "2026-07-28T09:32:30.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.summary.modelRuns, 0);
  assert.equal(board.findings.some((item) => item.code === "model-run-duplicate"), true);

  const tamperedValidation = JSON.parse(JSON.stringify(reviewed.nextData));
  tamperedValidation.publicHealthSurveillanceModelValidations[0].performance.sensitivity = 0.99;
  board = buildPublicHealthSurveillanceModelGovernance({
    data: tamperedValidation,
    at: "2026-07-28T09:33:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.findings.some((item) => item.code === "model-validation-integrity-invalid"), true);

  board = buildPublicHealthSurveillanceModelGovernance({
    data: {
      publicHealthSurveillanceModels: [{
        id: "ph-model-cross-source-concordance",
        version: 2,
        status: "active",
        algorithm: "client-promoted-model"
      }]
    },
    at: "2026-07-28T09:34:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.findings.some((item) => item.code === "ungoverned-model-materialization"), true);
  assert.equal(board.productionReady, false);
});
