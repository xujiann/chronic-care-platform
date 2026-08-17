"use strict";

const program = require("../../config/care-integration-v2-program.json");
const { sha256, validateProgram } = require("./institution-adapter-contract-sdk");

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const REF = /^(?:artifact|cmdb|evidence|ticket|vault):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const LOOP_ID = /^ccl-[a-f0-9]{20}$/;
const RISK_BANDS = new Set(["low", "medium", "high", "critical"]);
const SEVERITIES = new Set(["warning", "urgent", "critical"]);

function careError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function required(value, label, maximum = 240) {
  const result = clean(value, maximum);
  if (!result) throw careError("CONTINUOUS_CARE_INPUT_INVALID", `${label} is required`, 400);
  return result;
}

function commandId(value) {
  const result = clean(value, 72);
  if (!/^[A-Za-z0-9._:-]{8,72}$/.test(result)) throw careError("CONTINUOUS_CARE_COMMAND_INVALID", "commandId is invalid", 400);
  return result;
}

function digest(value, label) {
  const result = clean(value, 80);
  if (!SHA256.test(result)) throw careError("CONTINUOUS_CARE_DIGEST_INVALID", `${label} must be a SHA-256 digest`, 400);
  return result;
}

function evidenceRef(value, label) {
  const result = clean(value, 240);
  if (!REF.test(result)) throw careError("CONTINUOUS_CARE_EVIDENCE_INVALID", `${label} must be a controlled reference`, 400);
  return result;
}

function now(value) {
  const parsed = value ? Date.parse(value) : Date.now();
  if (!Number.isFinite(parsed)) throw careError("CONTINUOUS_CARE_TIME_INVALID", "transition time is invalid", 400);
  return new Date(parsed).toISOString();
}

function normalize(data) {
  const next = structuredClone(data || {});
  next.continuousCareLoops = Array.isArray(next.continuousCareLoops) ? next.continuousCareLoops : [];
  next.continuousCareCommands = Array.isArray(next.continuousCareCommands) ? next.continuousCareCommands : [];
  return next;
}

function publicLoop(loop) {
  return Object.freeze({
    loopId: loop.loopId, correlationId: loop.correlationId, subjectRefDigest: loop.subjectRefDigest,
    status: loop.status, version: loop.version, risk: Object.freeze(structuredClone(loop.risk)),
    carePlan: loop.carePlan ? Object.freeze(structuredClone(loop.carePlan)) : null,
    escalation: loop.escalation ? Object.freeze(structuredClone(loop.escalation)) : null,
    referral: loop.referral ? Object.freeze(structuredClone(loop.referral)) : null,
    referralReceipt: loop.referralReceipt ? Object.freeze(structuredClone(loop.referralReceipt)) : null,
    externalReceiptProjection: Object.freeze(loop.externalReceipts.map((item) => Object.freeze(structuredClone(item)))),
    followup: loop.followup ? Object.freeze(structuredClone(loop.followup)) : null,
    eventChainDigest: sha256(loop.events.map((item) => item.eventDigest)), updatedAt: loop.updatedAt,
    patientDataStored: false, externalEvidenceVerified: false, productionReady: false
  });
}

function findLoop(data, loopId) {
  if (!LOOP_ID.test(loopId || "")) throw careError("CONTINUOUS_CARE_LOOP_INVALID", "loopId is invalid", 400);
  const loop = data.continuousCareLoops.find((item) => item.loopId === loopId);
  if (!loop) throw careError("CONTINUOUS_CARE_LOOP_NOT_FOUND", "continuous care loop was not found", 404);
  return loop;
}

function commandReplay(data, id, fingerprint) {
  const previous = data.continuousCareCommands.find((item) => item.commandId === id);
  if (!previous) return null;
  if (previous.fingerprint !== fingerprint) throw careError("CONTINUOUS_CARE_COMMAND_CONFLICT", "commandId was reused with different metadata");
  return previous;
}

function version(loop, expected) {
  if (!Number.isInteger(Number(expected)) || Number(expected) !== loop.version) {
    throw careError("CONTINUOUS_CARE_VERSION_CONFLICT", "expectedVersion does not match care loop");
  }
}

function append(loop, type, details, recordedAt) {
  const previousDigest = loop.events.at(-1)?.eventDigest || sha256(`genesis:${loop.loopId}`);
  const eventDigest = sha256({ loopId: loop.loopId, type, details, previousDigest, recordedAt });
  loop.events.push({ type, eventDigest, previousDigest, recordedAt });
  loop.version += 1;
  loop.updatedAt = recordedAt;
  return eventDigest;
}

function prepare(data, command, fingerprint, allowedStatuses) {
  const next = normalize(data);
  const id = commandId(command.commandId);
  const previous = commandReplay(next, id, fingerprint);
  if (previous) return { next, id, replayed: publicLoop(findLoop(next, previous.loopId)) };
  const loop = findLoop(next, required(command.loopId, "loopId", 32));
  version(loop, command.expectedVersion);
  if (!allowedStatuses.includes(loop.status)) throw careError("CONTINUOUS_CARE_TRANSITION_NOT_ALLOWED", `transition is not allowed from ${loop.status}`);
  return { next, id, loop };
}

function finish(context, fingerprint, recordedAt, extra = {}) {
  context.next.continuousCareCommands.push({
    commandId: context.id, fingerprint, loopId: context.loop.loopId, recordedAt
  });
  return Object.freeze({ data: context.next, result: publicLoop(context.loop), replayed: false, ...extra });
}

function openContinuousCareLoop(data, command = {}, options = {}) {
  validateProgram(options.program || program);
  const id = commandId(command.commandId);
  const correlationId = required(command.correlationId, "correlationId", 120);
  const subjectRefDigest = digest(command.subjectRefDigest, "subjectRefDigest");
  const riskAssessmentDigest = digest(command.riskAssessmentDigest, "riskAssessmentDigest");
  const riskEvidenceRef = evidenceRef(command.riskEvidenceRef, "riskEvidenceRef");
  const riskBand = required(command.riskBand, "riskBand", 20);
  if (!RISK_BANDS.has(riskBand)) throw careError("CONTINUOUS_CARE_RISK_INVALID", "riskBand is invalid", 400);
  let next = normalize(data);
  const fingerprint = sha256({ correlationId, subjectRefDigest, riskAssessmentDigest, riskEvidenceRef, riskBand });
  const previous = commandReplay(next, id, fingerprint);
  if (previous) return Object.freeze({ data: next, result: publicLoop(findLoop(next, previous.loopId)), replayed: true });
  const recordedAt = now(options.now);
  const loopId = `ccl-${sha256({ correlationId, subjectRefDigest }).slice(7, 27)}`;
  if (next.continuousCareLoops.some((item) => item.loopId === loopId)) throw careError("CONTINUOUS_CARE_LOOP_CONFLICT", "care loop already exists");
  const loop = {
    loopId, correlationId, subjectRefDigest, status: "risk-assessed", version: 0,
    risk: { riskBand, riskAssessmentDigest, riskEvidenceRef, revision: 1, assessedAt: recordedAt },
    carePlan: null, escalation: null, referral: null, referralReceipt: null,
    externalReceipts: [], followup: null, events: [], createdAt: recordedAt, updatedAt: recordedAt
  };
  loop.events.push({ type: "risk-assessed", previousDigest: sha256(`genesis:${loopId}`),
    eventDigest: sha256({ loopId, type: "risk-assessed", riskAssessmentDigest, riskBand, recordedAt }), recordedAt });
  next.continuousCareLoops.push(loop);
  next.continuousCareCommands.push({ commandId: id, fingerprint, loopId, recordedAt });
  return Object.freeze({ data: next, result: publicLoop(loop), replayed: false });
}

function updateDynamicRisk(data, command = {}, options = {}) {
  const riskAssessmentDigest = digest(command.riskAssessmentDigest, "riskAssessmentDigest");
  const riskEvidenceRef = evidenceRef(command.riskEvidenceRef, "riskEvidenceRef");
  const riskBand = required(command.riskBand, "riskBand", 20);
  if (!RISK_BANDS.has(riskBand)) throw careError("CONTINUOUS_CARE_RISK_INVALID", "riskBand is invalid", 400);
  const fingerprint = sha256({ loopId: command.loopId, riskAssessmentDigest, riskEvidenceRef, riskBand });
  const context = prepare(data, command, fingerprint, ["risk-assessed"]);
  if (context.replayed) return Object.freeze({ data: context.next, result: context.replayed, replayed: true });
  const recordedAt = now(options.now);
  context.loop.risk = { riskBand, riskAssessmentDigest, riskEvidenceRef,
    revision: context.loop.risk.revision + 1, assessedAt: recordedAt };
  append(context.loop, "risk-reassessed", { riskAssessmentDigest, riskBand }, recordedAt);
  return finish(context, fingerprint, recordedAt);
}

function activateContinuousCarePlan(data, command = {}, options = {}) {
  const carePlanDigest = digest(command.carePlanDigest, "carePlanDigest");
  const carePlanEvidenceRef = evidenceRef(command.carePlanEvidenceRef, "carePlanEvidenceRef");
  const goalDigests = Array.isArray(command.goalDigests) ? command.goalDigests.map((item) => digest(item, "goalDigest")) : [];
  const taskDigests = Array.isArray(command.taskDigests) ? command.taskDigests.map((item) => digest(item, "taskDigest")) : [];
  if (goalDigests.length === 0 || taskDigests.length === 0) throw careError("CONTINUOUS_CARE_PLAN_INCOMPLETE", "care plan requires goal and task digests", 400);
  const fingerprint = sha256({ loopId: command.loopId, carePlanDigest, carePlanEvidenceRef, goalDigests, taskDigests });
  const context = prepare(data, command, fingerprint, ["risk-assessed"]);
  if (context.replayed) return Object.freeze({ data: context.next, result: context.replayed, replayed: true });
  const recordedAt = now(options.now);
  context.loop.carePlan = { carePlanDigest, carePlanEvidenceRef, goalDigests, taskDigests,
    basedOnRiskDigest: context.loop.risk.riskAssessmentDigest, activatedAt: recordedAt };
  context.loop.status = "care-plan-activated";
  append(context.loop, "care-plan-activated", { carePlanDigest, goalDigests, taskDigests }, recordedAt);
  return finish(context, fingerprint, recordedAt);
}

function escalateContinuousCareAnomaly(data, command = {}, options = {}) {
  const anomalyDigest = digest(command.anomalyDigest, "anomalyDigest");
  const anomalyEvidenceRef = evidenceRef(command.anomalyEvidenceRef, "anomalyEvidenceRef");
  const severity = required(command.severity, "severity", 20);
  if (!SEVERITIES.has(severity)) throw careError("CONTINUOUS_CARE_SEVERITY_INVALID", "anomaly severity is invalid", 400);
  const fingerprint = sha256({ loopId: command.loopId, anomalyDigest, anomalyEvidenceRef, severity });
  const context = prepare(data, command, fingerprint, ["care-plan-activated"]);
  if (context.replayed) return Object.freeze({ data: context.next, result: context.replayed, replayed: true });
  const recordedAt = now(options.now);
  context.loop.escalation = { anomalyDigest, anomalyEvidenceRef, severity, escalatedAt: recordedAt };
  context.loop.status = "anomaly-escalated";
  append(context.loop, "anomaly-escalated", { anomalyDigest, severity }, recordedAt);
  return finish(context, fingerprint, recordedAt);
}

function adapterRun(data, runId, expectedSystem) {
  const run = (data.careAdapterContractRuns || []).find((item) => item.runId === runId);
  if (!run || run.system !== expectedSystem || run.status !== "passed" || run.receipt?.matched !== true) {
    throw careError("CONTINUOUS_CARE_ADAPTER_EVIDENCE_REQUIRED", `a passed and reconciled ${expectedSystem} adapter run is required`);
  }
  return run;
}

function requestContinuousCareReferral(data, command = {}, options = {}) {
  const referralDigest = digest(command.referralDigest, "referralDigest");
  const referralEvidenceRef = evidenceRef(command.referralEvidenceRef, "referralEvidenceRef");
  const contractRunId = required(command.contractRunId, "contractRunId", 32);
  const fingerprint = sha256({ loopId: command.loopId, referralDigest, referralEvidenceRef, contractRunId });
  const context = prepare(data, command, fingerprint, ["anomaly-escalated"]);
  if (context.replayed) return Object.freeze({ data: context.next, result: context.replayed, replayed: true });
  const run = adapterRun(context.next, contractRunId, "HIS");
  if (run.requestDigest !== referralDigest) throw careError("CONTINUOUS_CARE_REFERRAL_MISMATCH", "referral digest does not match HIS adapter request");
  const recordedAt = now(options.now);
  context.loop.referral = { referralDigest, referralEvidenceRef, contractRunId, requestedAt: recordedAt };
  context.loop.status = "referral-requested";
  append(context.loop, "referral-requested", { referralDigest, contractRunId }, recordedAt);
  return finish(context, fingerprint, recordedAt);
}

function reconcileContinuousCareReferralReceipt(data, command = {}, options = {}) {
  const contractRunId = required(command.contractRunId, "contractRunId", 32);
  const fingerprint = sha256({ loopId: command.loopId, contractRunId });
  const context = prepare(data, command, fingerprint, ["referral-requested"]);
  if (context.replayed) return Object.freeze({ data: context.next, result: context.replayed, replayed: true });
  if (context.loop.referral.contractRunId !== contractRunId) throw careError("CONTINUOUS_CARE_REFERRAL_RUN_MISMATCH", "referral contract run changed");
  const run = adapterRun(context.next, contractRunId, "HIS");
  const recordedAt = now(options.now);
  context.loop.referralReceipt = {
    receiptDigest: run.receipt.receiptDigest, receiptEvidenceRef: run.receipt.receiptEvidenceRef,
    signatureDigest: run.receipt.signatureDigest,
    signatureVerificationEvidenceRef: run.receipt.signatureVerificationEvidenceRef,
    reconciledAt: recordedAt, externalEvidenceVerified: false
  };
  context.loop.status = "referral-receipt-reconciled";
  append(context.loop, "referral-receipt-reconciled", { receiptDigest: run.receipt.receiptDigest }, recordedAt);
  return finish(context, fingerprint, recordedAt);
}

function linkExternalCareReceipt(data, command = {}, options = {}) {
  const sourceType = required(command.sourceType, "sourceType", 20);
  const contractRunId = required(command.contractRunId, "contractRunId", 32);
  const active = options.program || program;
  validateProgram(active);
  if (!active.requiredExternalReceiptTypes.includes(sourceType)) throw careError("CONTINUOUS_CARE_RECEIPT_TYPE_INVALID", "external receipt type is invalid", 400);
  const fingerprint = sha256({ loopId: command.loopId, sourceType, contractRunId });
  const context = prepare(data, command, fingerprint, ["referral-receipt-reconciled"]);
  if (context.replayed) return Object.freeze({ data: context.next, result: context.replayed, replayed: true });
  if (context.loop.externalReceipts.some((item) => item.sourceType === sourceType)) {
    throw careError("CONTINUOUS_CARE_RECEIPT_ALREADY_LINKED", `${sourceType} receipt is already linked`);
  }
  const expectedSystem = sourceType === "pharmacy" ? "PHARMACY" : "INSURANCE";
  const run = adapterRun(context.next, contractRunId, expectedSystem);
  const recordedAt = now(options.now);
  const projection = {
    sourceType, contractRunIdDigest: sha256(contractRunId), receiptDigest: run.receipt.receiptDigest,
    receiptEvidenceRef: run.receipt.receiptEvidenceRef, responseDigest: run.receipt.responseDigest,
    linkedAt: recordedAt, rawBusinessDataStored: false, externalEvidenceVerified: false
  };
  context.loop.externalReceipts.push(projection);
  append(context.loop, `${sourceType}-receipt-linked`, { receiptDigest: projection.receiptDigest }, recordedAt);
  return finish(context, fingerprint, recordedAt, { projection: Object.freeze(structuredClone(projection)) });
}

function closeContinuousCareFollowup(data, command = {}, options = {}) {
  const followupDigest = digest(command.followupDigest, "followupDigest");
  const followupEvidenceRef = evidenceRef(command.followupEvidenceRef, "followupEvidenceRef");
  const outcomeDigest = digest(command.outcomeDigest, "outcomeDigest");
  const fingerprint = sha256({ loopId: command.loopId, followupDigest, followupEvidenceRef, outcomeDigest });
  const context = prepare(data, command, fingerprint, ["referral-receipt-reconciled"]);
  if (context.replayed) return Object.freeze({ data: context.next, result: context.replayed, replayed: true });
  const active = options.program || program;
  if (!active.requiredExternalReceiptTypes.every((type) => context.loop.externalReceipts.some((item) => item.sourceType === type))) {
    throw careError("CONTINUOUS_CARE_EXTERNAL_RECEIPTS_INCOMPLETE", "pharmacy and insurance receipt projections are required before followup closure");
  }
  const recordedAt = now(options.now);
  context.loop.followup = { followupDigest, followupEvidenceRef, outcomeDigest, closedAt: recordedAt };
  context.loop.status = "followup-closed";
  append(context.loop, "followup-closed", { followupDigest, outcomeDigest }, recordedAt);
  return finish(context, fingerprint, recordedAt);
}

function buildContinuousCareReadiness(data, options = {}) {
  const active = options.program || program;
  validateProgram(active);
  const state = normalize(data);
  const loops = state.continuousCareLoops.map(publicLoop);
  const closed = loops.filter((item) => item.status === "followup-closed");
  const completeExternalProjections = closed.filter((loop) =>
    active.requiredExternalReceiptTypes.every((type) => loop.externalReceiptProjection.some((item) => item.sourceType === type))).length;
  return Object.freeze({
    schema: "continuous-care-closure-readiness-v1", generatedAt: now(options.now),
    ok: closed.length > 0 && completeExternalProjections === closed.length,
    localTechnicalReady: closed.length > 0 && completeExternalProjections === closed.length,
    summary: Object.freeze({ loops: loops.length, closedLoops: closed.length, completeExternalProjections }),
    loops: Object.freeze(loops), productionGate: "NO-GO", productionReady: false,
    externalEvidenceVerified: false, blockers: Object.freeze([...active.productionBlockers])
  });
}

module.exports = {
  activateContinuousCarePlan,
  buildContinuousCareReadiness,
  closeContinuousCareFollowup,
  escalateContinuousCareAnomaly,
  linkExternalCareReceipt,
  openContinuousCareLoop,
  reconcileContinuousCareReferralReceipt,
  requestContinuousCareReferral,
  updateDynamicRisk
};
