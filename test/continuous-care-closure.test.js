"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildAdapterContractReadiness,
  createInstitutionAdapterSdk,
  createReceiptDigest,
  sha256,
  startAdapterContractRun
} = require("../src/care-coordination/institution-adapter-contract-sdk");
const {
  activateContinuousCarePlan,
  buildContinuousCareReadiness,
  closeContinuousCareFollowup,
  escalateContinuousCareAnomaly,
  linkExternalCareReceipt,
  openContinuousCareLoop,
  reconcileContinuousCareReferralReceipt,
  requestContinuousCareReferral,
  updateDynamicRisk
} = require("../src/care-coordination/continuous-care-closure");
const program = require("../config/care-integration-v2-program.json");

async function passedRun(data, system, requestDigest, index) {
  const contract = program.adapterContracts.find((item) => item.system === system);
  const endpoint = `https://${system.toLowerCase()}-care.invalid/metadata`;
  let result = startAdapterContractRun(data, {
    commandId: `care-adapter-start-${index}`,
    contractId: contract.id,
    correlationId: `care-adapter-corr-${index}`,
    requestDigest,
    requestEvidenceRef: `artifact://continuous-care/${system.toLowerCase()}/request-${index}`,
    idempotencyKey: `care-adapter-key-${index}`
  }, { endpoint, now: `2026-08-17T13:0${index}:00.000Z` });
  const sdk = createInstitutionAdapterSdk({
    async dispatch(request) {
      const receipt = {
        acknowledgedRequestDigest: request.requestDigest,
        responseDigest: sha256(`care-response-${index}`),
        signatureDigest: sha256(`care-signature-${index}`),
        receiptEvidenceRef: `evidence://continuous-care/${system.toLowerCase()}/receipt-${index}`,
        receivedAt: `2026-08-17T13:0${index}:02.000Z`
      };
      return { outcome: "accepted", receipt: { ...receipt, receiptDigest: createReceiptDigest(receipt) } };
    },
    async verifyReceipt() {
      return { verified: true, evidenceRef: `vault://continuous-care/${system.toLowerCase()}/verification-${index}` };
    }
  });
  result = await sdk.execute(result.data, {
    commandId: `care-adapter-send-${index}`, runId: result.result.runId, expectedVersion: 0
  }, {
    endpoint, nonce: `care-nonce-${index}`,
    requestTimestamp: `2026-08-17T13:0${index}:01.000Z`, now: `2026-08-17T13:0${index}:03.000Z`
  });
  return result;
}

test("dynamic risk closes through plan, tasks, escalation, referral receipt and desensitized pharmacy/insurance projections", async () => {
  const referralDigest = sha256("opaque-referral-command");
  let his = await passedRun({}, "HIS", referralDigest, 1);
  let pharmacy = await passedRun(his.data, "PHARMACY", sha256("opaque-pharmacy-index"), 2);
  let insurance = await passedRun(pharmacy.data, "INSURANCE", sha256("opaque-insurance-index"), 3);
  let result = openContinuousCareLoop(insurance.data, {
    commandId: "care-loop-open-001",
    correlationId: "care-correlation-001",
    subjectRefDigest: sha256("opaque-subject-reference"),
    riskAssessmentDigest: sha256("initial-risk-assessment"),
    riskEvidenceRef: "evidence://continuous-care/risk/initial",
    riskBand: "medium"
  }, { now: "2026-08-17T13:10:00.000Z" });
  const loopId = result.result.loopId;
  assert.equal(result.result.status, "risk-assessed");
  assert.equal(result.result.patientDataStored, false);

  result = updateDynamicRisk(result.data, {
    commandId: "care-risk-update-001", loopId, expectedVersion: 0,
    riskAssessmentDigest: sha256("dynamic-high-risk-assessment"),
    riskEvidenceRef: "evidence://continuous-care/risk/reassessment",
    riskBand: "high"
  }, { now: "2026-08-17T13:11:00.000Z" });
  assert.equal(result.result.risk.revision, 2);
  assert.equal(result.result.risk.riskBand, "high");

  result = activateContinuousCarePlan(result.data, {
    commandId: "care-plan-activate-001", loopId, expectedVersion: 1,
    carePlanDigest: sha256("care-plan-revision-2"),
    carePlanEvidenceRef: "artifact://continuous-care/plan/revision-2",
    goalDigests: [sha256("goal-blood-pressure"), sha256("goal-adherence")],
    taskDigests: [sha256("task-monitoring"), sha256("task-medication-review")]
  }, { now: "2026-08-17T13:12:00.000Z" });
  assert.equal(result.result.status, "care-plan-activated");
  assert.equal(result.result.carePlan.basedOnRiskDigest, result.result.risk.riskAssessmentDigest);

  result = escalateContinuousCareAnomaly(result.data, {
    commandId: "care-escalate-001", loopId, expectedVersion: 2,
    anomalyDigest: sha256("anomaly-threshold-breach"),
    anomalyEvidenceRef: "evidence://continuous-care/anomaly/threshold",
    severity: "urgent"
  }, { now: "2026-08-17T13:13:00.000Z" });
  assert.equal(result.result.status, "anomaly-escalated");

  result = requestContinuousCareReferral(result.data, {
    commandId: "care-referral-request-001", loopId, expectedVersion: 3,
    referralDigest, referralEvidenceRef: "artifact://continuous-care/referral/request",
    contractRunId: his.result.runId
  }, { now: "2026-08-17T13:14:00.000Z" });
  assert.equal(result.result.status, "referral-requested");

  result = reconcileContinuousCareReferralReceipt(result.data, {
    commandId: "care-referral-receipt-001", loopId, expectedVersion: 4,
    contractRunId: his.result.runId
  }, { now: "2026-08-17T13:15:00.000Z" });
  assert.equal(result.result.status, "referral-receipt-reconciled");
  assert.match(result.result.referralReceipt.signatureDigest, /^sha256:[a-f0-9]{64}$/);

  assert.throws(() => closeContinuousCareFollowup(result.data, {
    commandId: "care-followup-early-001", loopId, expectedVersion: 5,
    followupDigest: sha256("followup-early"), followupEvidenceRef: "evidence://continuous-care/followup/early",
    outcomeDigest: sha256("outcome-early")
  }), (error) => error.code === "CONTINUOUS_CARE_EXTERNAL_RECEIPTS_INCOMPLETE");

  result = linkExternalCareReceipt(result.data, {
    commandId: "care-pharmacy-link-001", loopId, expectedVersion: 5,
    sourceType: "pharmacy", contractRunId: pharmacy.result.runId
  }, { now: "2026-08-17T13:16:00.000Z" });
  assert.equal(result.projection.sourceType, "pharmacy");
  assert.equal(result.projection.rawBusinessDataStored, false);

  result = linkExternalCareReceipt(result.data, {
    commandId: "care-insurance-link-001", loopId, expectedVersion: 6,
    sourceType: "insurance", contractRunId: insurance.result.runId
  }, { now: "2026-08-17T13:17:00.000Z" });
  assert.equal(result.result.externalReceiptProjection.length, 2);

  result = closeContinuousCareFollowup(result.data, {
    commandId: "care-followup-close-001", loopId, expectedVersion: 7,
    followupDigest: sha256("followup-record-index"),
    followupEvidenceRef: "evidence://continuous-care/followup/closed",
    outcomeDigest: sha256("goal-outcome-index")
  }, { now: "2026-08-17T13:18:00.000Z" });
  assert.equal(result.result.status, "followup-closed");
  assert.equal(result.result.version, 8);
  assert.match(result.result.eventChainDigest, /^sha256:[a-f0-9]{64}$/);

  const careReadiness = buildContinuousCareReadiness(result.data, { now: "2026-08-17T13:20:00.000Z" });
  assert.equal(careReadiness.ok, true);
  assert.equal(careReadiness.summary.closedLoops, 1);
  assert.equal(careReadiness.summary.completeExternalProjections, 1);
  assert.equal(careReadiness.productionGate, "NO-GO");
  assert.equal(careReadiness.productionReady, false);
  assert.equal(careReadiness.externalEvidenceVerified, false);

  const stored = JSON.stringify(result.data);
  assert.doesNotMatch(stored, /opaque-subject-reference|goal-blood-pressure|task-medication-review|https:\/\//);
  assert.doesNotMatch(stored, /"patient"|"payload"|"claim"|"prescription"|"amount"/i);
});

test("continuous care transitions are versioned, idempotent and fail closed without reconciled adapter evidence", () => {
  let result = openContinuousCareLoop({}, {
    commandId: "care-loop-open-002", correlationId: "care-correlation-002",
    subjectRefDigest: sha256("subject-002"), riskAssessmentDigest: sha256("risk-002"),
    riskEvidenceRef: "evidence://continuous-care/risk/002", riskBand: "high"
  }, { now: "2026-08-17T14:00:00.000Z" });
  const loopId = result.result.loopId;
  const command = {
    commandId: "care-plan-activate-002", loopId, expectedVersion: 0,
    carePlanDigest: sha256("plan-002"), carePlanEvidenceRef: "artifact://continuous-care/plan/002",
    goalDigests: [sha256("goal-002")], taskDigests: [sha256("task-002")]
  };
  result = activateContinuousCarePlan(result.data, command, { now: "2026-08-17T14:01:00.000Z" });
  const replay = activateContinuousCarePlan(result.data, command, { now: "2026-08-17T14:02:00.000Z" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.version, 1);
  assert.throws(() => escalateContinuousCareAnomaly(result.data, {
    commandId: "care-escalate-stale-002", loopId, expectedVersion: 0,
    anomalyDigest: sha256("anomaly-002"), anomalyEvidenceRef: "evidence://continuous-care/anomaly/002",
    severity: "urgent"
  }), (error) => error.code === "CONTINUOUS_CARE_VERSION_CONFLICT");

  result = escalateContinuousCareAnomaly(result.data, {
    commandId: "care-escalate-002", loopId, expectedVersion: 1,
    anomalyDigest: sha256("anomaly-002"), anomalyEvidenceRef: "evidence://continuous-care/anomaly/002",
    severity: "urgent"
  });
  assert.throws(() => requestContinuousCareReferral(result.data, {
    commandId: "care-referral-no-run-002", loopId, expectedVersion: 2,
    referralDigest: sha256("referral-002"), referralEvidenceRef: "artifact://continuous-care/referral/002",
    contractRunId: "acr-00000000000000000000"
  }), (error) => error.code === "CONTINUOUS_CARE_ADAPTER_EVIDENCE_REQUIRED");
  assert.equal(buildContinuousCareReadiness(result.data).ok, false);
  assert.equal(buildAdapterContractReadiness(result.data).ok, false);
});
