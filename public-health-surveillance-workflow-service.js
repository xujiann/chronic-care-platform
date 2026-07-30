"use strict";

const crypto = require("node:crypto");
const {
  buildPublicHealthDataFoundation
} = require("./public-health-data-foundation-service");
const {
  buildPublicHealthMedicalPreventionBoard,
  ensurePublicHealthMedicalPreventionTasks,
  isValidClosedPublicHealthMedicalPreventionTask
} = require("./public-health-medical-prevention-collaboration-service");
const {
  PUBLIC_HEALTH_SURVEILLANCE_RULES,
  buildPublicHealthSurveillanceRuleGovernance,
  buildTrustedPublicHealthSurveillanceRuleRegistry
} = require("./public-health-surveillance-rule-governance-service");
const {
  buildPublicHealthSurveillanceModelGovernance
} = require("./public-health-surveillance-model-governance-service");
const {
  buildPublicHealthRespiratoryPathogenSurveillance
} = require("./public-health-respiratory-pathogen-surveillance-service");
const {
  buildPublicHealthOfficialExchangeReceiptRegistry,
  publicHealthOfficialExchangeReceiptBindingDigest
} = require("./public-health-official-exchange-receipt-service");

const ALERT_ACTIONS = Object.freeze({
  "verify-alert": { from: ["open"], to: "verified" },
  "dispatch-alert": { from: ["verified"], to: "dispatched" },
  "start-investigation": { from: ["dispatched"], to: "investigating" },
  "record-official-report": { from: ["investigating"], to: "reported" },
  "record-feedback": { from: ["reported"], to: "feedback-confirmed" },
  "close-alert": { from: ["feedback-confirmed"], to: "closed" },
  "reopen-alert": { from: ["closed"], to: "investigating" }
});

const SIGNAL_VERIFY_ROLES = new Set(["cdc-surveillance", "commission"]);
const SIGNAL_EVALUATE_ROLES = new Set(["system", "cdc-surveillance", "commission"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function actionPayloadFingerprint(payload = {}) {
  const normalized = Object.fromEntries(Object.entries(payload)
    .filter(([key]) => !["idempotencyKey", "at"].includes(key)));
  return sha256(stableStringify(normalized));
}

function actorRole(user = {}) {
  return clean(user.role).toLowerCase();
}

function actorName(user = {}) {
  return clean(user.name || user.username || user.id || "unknown");
}

function evidenceRefs(payload = {}) {
  return Array.isArray(payload.evidenceRefs)
    ? [...new Set(payload.evidenceRefs.map(clean).filter(Boolean))]
    : [];
}

function normalizedReceiptEvidenceRefs(receipt = {}) {
  return Array.isArray(receipt.evidenceRefs)
    ? [...new Set(receipt.evidenceRefs.map(clean).filter(Boolean))].sort()
    : [];
}

function officialExchangeReceiptRegistry(data = {}, options = {}, at = new Date().toISOString()) {
  return buildPublicHealthOfficialExchangeReceiptRegistry({
    receipts: Array.isArray(data.publicHealthOfficialExchangeReceipts)
      ? data.publicHealthOfficialExchangeReceipts
      : [],
    keyring: options.officialExchangeReceiptKeyring || {},
    at: options.officialExchangeReceiptAt || at
  });
}

function trustedOfficialExchangeReceipt(data, receiptId, stage, alertId, options, at) {
  const registry = officialExchangeReceiptRegistry(data, options, at);
  if (!registry.ok) {
    throw new Error(`public health official exchange receipt registry invalid: ${registry.findings[0]?.code || "keyring-unavailable"}`);
  }
  const receipt = registry.trustedReceipts.find((item) => clean(item.id) === clean(receiptId));
  if (!receipt
    || clean(receipt.stage) !== stage
    || clean(receipt.alertId) !== clean(alertId)) {
    throw new Error(`trusted ${stage} receipt bound to this alert is required`);
  }
  return receipt;
}

function authorizeSignal(roleSet, user, action) {
  const role = actorRole(user);
  if (!roleSet.has(role)) throw new Error(`role ${role || "missing"} is not allowed to ${action}`);
  return role;
}

function findSignal(data, signalId) {
  const signals = Array.isArray(data.publicHealthSurveillanceSignals)
    ? clone(data.publicHealthSurveillanceSignals)
    : [];
  const index = signals.findIndex((item) => clean(item.id) === clean(signalId));
  if (index < 0) throw new Error(`unknown public health surveillance signal: ${clean(signalId) || "missing"}`);
  return { signals, index, signal: signals[index] };
}

function verifyPublicHealthSurveillanceSignalToState(data = {}, signalId, payload = {}, user = {}) {
  const role = authorizeSignal(SIGNAL_VERIFY_ROLES, user, "verify public health signal");
  const { signals, index, signal } = findSignal(data, signalId);
  const idempotencyKey = clean(payload.idempotencyKey);
  const decision = clean(payload.decision).toLowerCase();
  const refs = evidenceRefs(payload);
  if (!idempotencyKey || !["confirmed", "dismissed"].includes(decision) || !clean(payload.note) || !refs.length) {
    throw new Error("idempotencyKey, confirmed/dismissed decision, note and evidenceRefs are required to verify a signal");
  }
  const idempotencyKeyHash = sha256(idempotencyKey);
  const payloadFingerprint = actionPayloadFingerprint(payload);
  if (signal.verification?.idempotencyKeyHash === idempotencyKeyHash) {
    if (clean(signal.verification.payloadFingerprint) !== payloadFingerprint) {
      throw new Error("public health signal verification idempotency key payload conflict");
    }
    return { ok: true, idempotent: true, signal, nextData: data, productionReady: false };
  }
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(signal.version)) {
    throw new Error(`public health signal version conflict: expected ${payload.expectedVersion}, current ${signal.version}`);
  }
  if (signal.workflowState !== "received") throw new Error(`signal verification is not allowed from ${signal.workflowState}`);
  const at = clean(payload.at || new Date().toISOString());
  const nextSignal = {
    ...signal,
    version: Number(signal.version || 0) + 1,
    workflowState: decision === "confirmed" ? "human-verified" : "dismissed",
    verification: {
      decision,
      verifiedBy: actorName(user),
      role,
      at,
      note: clean(payload.note),
      evidenceRefs: refs,
      idempotencyKeyHash,
      payloadFingerprint
    },
    productionReady: false
  };
  signals[index] = nextSignal;
  const audit = {
    id: `${nextSignal.id}:verification:${nextSignal.version}`,
    signalId: nextSignal.id,
    action: "verify-signal",
    decision,
    actor: actorName(user),
    role,
    at,
    version: nextSignal.version,
    evidenceCount: refs.length
  };
  const nextData = {
    ...data,
    publicHealthSurveillanceSignals: signals,
    publicHealthSurveillanceAudit: [
      ...(Array.isArray(data.publicHealthSurveillanceAudit) ? clone(data.publicHealthSurveillanceAudit) : []),
      audit
    ]
  };
  return { ok: true, idempotent: false, signal: clone(nextSignal), audit, nextData, productionReady: false };
}

function ruleMatches(rule, signal) {
  const metric = (signal.metrics || []).find((item) => clean(item.metricCode) === rule.metricCode);
  if (!metric) return { matched: false, observedValue: null };
  if (rule.operator !== ">=") throw new Error(`unsupported public health surveillance rule operator: ${rule.operator}`);
  return { matched: Number(metric.value) >= Number(rule.threshold), observedValue: Number(metric.value) };
}

function assertHumanVerifiedSignalIntegrity(data, signal) {
  const foundation = buildPublicHealthDataFoundation({ data });
  const signalFindings = foundation.qualityFindings.filter((item) => item.signalId === signal.id);
  if (signalFindings.length) throw new Error(`public health signal integrity invalid: ${signalFindings[0].code}`);
  if (clean(signal.verification?.decision) !== "confirmed"
    || !SIGNAL_VERIFY_ROLES.has(clean(signal.verification?.role))
    || !Array.isArray(signal.verification?.evidenceRefs)
    || !signal.verification.evidenceRefs.length
    || !/^[a-f0-9]{64}$/.test(clean(signal.verification?.idempotencyKeyHash))
    || !/^[a-f0-9]{64}$/.test(clean(signal.verification?.payloadFingerprint))) {
    throw new Error("public health signal human verification integrity is invalid");
  }
  const verificationAudit = (Array.isArray(data.publicHealthSurveillanceAudit) ? data.publicHealthSurveillanceAudit : [])
    .find((item) => item.signalId === signal.id
      && item.action === "verify-signal"
      && item.decision === "confirmed"
      && item.actor === signal.verification.verifiedBy
      && item.role === signal.verification.role);
  if (!verificationAudit) throw new Error("public health signal verification audit is missing");
}

function evaluatePublicHealthSurveillanceSignalToState(data = {}, signalId, payload = {}, user = {}, options = {}) {
  const role = authorizeSignal(SIGNAL_EVALUATE_ROLES, user, "evaluate public health signal");
  const { signals, index, signal } = findSignal(data, signalId);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error("idempotencyKey is required to evaluate a public health signal");
  if (signal.workflowState !== "human-verified") {
    throw new Error("only a human-verified public health signal can be evaluated");
  }
  assertHumanVerifiedSignalIntegrity(data, signal);
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(signal.version)) {
    throw new Error(`public health signal version conflict: expected ${payload.expectedVersion}, current ${signal.version}`);
  }
  const ruleGovernance = buildTrustedPublicHealthSurveillanceRuleRegistry(data, options);
  if (ruleGovernance.findings.length) {
    throw new Error(`public health rule registry integrity invalid: ${ruleGovernance.findings[0].code}`);
  }
  const rules = ruleGovernance.rules;
  const rule = rules.find((item) => item.status === "active" && item.signalType === signal.signalType);
  if (!rule) throw new Error("no active surveillance rule is available for the signal type");
  const alerts = Array.isArray(data.publicHealthSurveillanceAlerts)
    ? clone(data.publicHealthSurveillanceAlerts)
    : [];
  const existingAlert = alerts.find((item) => item.signalIds?.includes(signal.id) && item.ruleId === rule.id && item.ruleVersion === rule.version);
  if (existingAlert) {
    return { ok: true, idempotent: true, matched: true, alert: existingAlert, signal, nextData: data, productionReady: false };
  }
  const evaluation = ruleMatches(rule, signal);
  const at = clean(payload.at || new Date().toISOString());
  const nextSignal = {
    ...signal,
    version: Number(signal.version || 0) + 1,
    workflowState: evaluation.matched ? "alert-created" : "evaluated-no-alert",
    lastRuleEvaluation: {
      ruleId: rule.id,
      ruleVersion: rule.version,
      observedValue: evaluation.observedValue,
      threshold: rule.threshold,
      matched: evaluation.matched,
      evaluatedAt: at
    },
    productionReady: false
  };
  signals[index] = nextSignal;
  let alert = null;
  if (evaluation.matched) {
    const alertKey = sha256(`${signal.id}\n${rule.id}\n${rule.version}`);
    alert = {
      id: `ph-alert-${alertKey.slice(0, 24)}`,
      version: 1,
      status: "open",
      severity: rule.severity,
      ruleId: rule.id,
      ruleVersion: rule.version,
      ruleDigest: sha256(stableStringify(rule)),
      signalIds: [signal.id],
      signalType: signal.signalType,
      regionCode: signal.regionCode,
      institutionId: signal.institutionId,
      observedValue: evaluation.observedValue,
      threshold: rule.threshold,
      openedAt: at,
      assessment: null,
      dispatch: null,
      report: null,
      feedback: null,
      closure: null,
      timeline: [],
      productionReady: false
    };
    alerts.push(alert);
  }
  const audit = {
    id: `${signal.id}:evaluation:${nextSignal.version}`,
    signalId: signal.id,
    alertId: alert?.id || "",
    action: "evaluate-signal",
    ruleId: rule.id,
    ruleVersion: rule.version,
    matched: evaluation.matched,
    actor: actorName(user),
    role,
    at,
    idempotencyKeyHash: sha256(idempotencyKey)
  };
  const nextData = {
    ...data,
    publicHealthSurveillanceRules: rules,
    publicHealthSurveillanceSignals: signals,
    publicHealthSurveillanceAlerts: alerts,
    publicHealthSurveillanceAudit: [
      ...(Array.isArray(data.publicHealthSurveillanceAudit) ? clone(data.publicHealthSurveillanceAudit) : []),
      audit
    ]
  };
  return {
    ok: true,
    idempotent: false,
    matched: evaluation.matched,
    alert: clone(alert),
    signal: clone(nextSignal),
    audit,
    nextData,
    productionReady: false
  };
}

function authorizeAlertAction(action, user) {
  const role = actorRole(user);
  const allowedByAction = {
    "verify-alert": ["cdc-surveillance", "commission"],
    "dispatch-alert": ["cdc-surveillance", "commission"],
    "start-investigation": ["cdc-surveillance", "commission", "medical-public-health"],
    "record-official-report": ["cdc-surveillance", "commission", "medical-public-health"],
    "record-feedback": ["cdc-surveillance", "commission", "system"],
    "close-alert": ["cdc-surveillance", "commission"],
    "reopen-alert": ["cdc-surveillance", "commission"]
  };
  if (!allowedByAction[action]?.includes(role)) {
    throw new Error(`role ${role || "missing"} is not allowed to ${action}`);
  }
  return role;
}

function validatePublicHealthSurveillanceAlert(alert = {}, data = {}, options = {}) {
  const findings = [];
  const ruleGovernance = buildTrustedPublicHealthSurveillanceRuleRegistry(data, options);
  const rules = ruleGovernance.ruleVersions;
  const foundation = buildPublicHealthDataFoundation({ data });
  const officialReceipts = officialExchangeReceiptRegistry(data, options);
  if (ruleGovernance.findings.length) findings.push("alert-rule-governance-invalid");
  if (!officialReceipts.ok && (data.publicHealthOfficialExchangeReceipts || []).length) {
    findings.push("alert-official-exchange-receipt-registry-invalid");
  }
  const rule = rules.find((item) => item.id === clean(alert.ruleId) && item.version === Number(alert.ruleVersion));
  if (!rule || clean(alert.ruleDigest) !== sha256(stableStringify(rule))) findings.push("alert-rule-binding-invalid");
  const signals = Array.isArray(data.publicHealthSurveillanceSignals) ? data.publicHealthSurveillanceSignals : [];
  const boundSignals = Array.isArray(alert.signalIds)
    ? alert.signalIds.map((id) => signals.find((item) => clean(item.id) === clean(id)))
    : [];
  if (!boundSignals.length || boundSignals.some((item) => !item)) findings.push("alert-signal-binding-invalid");
  if (boundSignals.some((signal) => signal
    && foundation.qualityFindings.some((item) => item.signalId === clean(signal.id)))) {
    findings.push("alert-source-signal-integrity-invalid");
  }
  if (boundSignals.some((signal) => signal
    && (clean(signal.workflowState) !== "alert-created"
      || clean(signal.lastRuleEvaluation?.ruleId) !== clean(alert.ruleId)
      || Number(signal.lastRuleEvaluation?.ruleVersion) !== Number(alert.ruleVersion)
      || signal.lastRuleEvaluation?.matched !== true))) {
    findings.push("alert-signal-evaluation-invalid");
  }
  const timeline = Array.isArray(alert.timeline) ? alert.timeline : [];
  if (Number(alert.version) !== timeline.length + 1) findings.push("alert-version-timeline-invalid");
  const timelineReceiptIds = new Set();
  let latestTimelineReport = null;
  timeline.forEach((item, index) => {
    const definition = ALERT_ACTIONS[clean(item.action)];
    const expectedFrom = index ? clean(timeline[index - 1].to) : "open";
    if (!definition || clean(item.from) !== expectedFrom || clean(item.to) !== definition.to) {
      findings.push("alert-timeline-transition-invalid");
    }
    if (!/^[a-f0-9]{64}$/.test(clean(item.idempotencyKeyHash))
      || !/^[a-f0-9]{64}$/.test(clean(item.payloadFingerprint))) {
      findings.push("alert-timeline-integrity-fields-invalid");
    }
    if (["record-official-report", "record-feedback"].includes(clean(item.action))) {
      const expectedStage = clean(item.action) === "record-official-report"
        ? "official-report"
        : "feedback";
      const receiptId = clean(item.trustedReceiptId);
      const receipt = officialReceipts.trustedReceipts
        .find((candidate) => clean(candidate.id) === receiptId);
      if (!receiptId
        || timelineReceiptIds.has(receiptId)
        || !receipt
        || clean(receipt.stage) !== expectedStage
        || clean(receipt.alertId) !== clean(alert.id)
        || publicHealthOfficialExchangeReceiptBindingDigest(receipt)
          !== clean(item.receiptBindingDigest)) {
        findings.push("alert-timeline-official-receipt-binding-invalid");
      }
      if (expectedStage === "feedback" && (!latestTimelineReport
        || clean(receipt?.predecessorRecordId) !== clean(latestTimelineReport.id)
        || clean(receipt?.reportId) !== clean(latestTimelineReport.reportId))) {
        findings.push("alert-timeline-official-receipt-chain-invalid");
      }
      if (expectedStage === "official-report" && receipt) latestTimelineReport = receipt;
      timelineReceiptIds.add(receiptId);
    }
  });
  if (timeline.length && clean(alert.status) !== clean(timeline[timeline.length - 1].to)) {
    findings.push("alert-state-history-mismatch");
  }
  const reportRequired = ["reported", "feedback-confirmed", "closed"].includes(clean(alert.status));
  const feedbackRequired = ["feedback-confirmed", "closed"].includes(clean(alert.status));
  const reportReceipt = officialReceipts.trustedReceipts
    .find((item) => clean(item.id) === clean(alert.report?.trustedReceiptId));
  if (reportRequired && !alert.report) findings.push("alert-official-report-missing");
  if (alert.report && (!reportReceipt
    || clean(reportReceipt.stage) !== "official-report"
    || clean(reportReceipt.alertId) !== clean(alert.id)
    || clean(reportReceipt.reportId) !== clean(alert.report.reportId)
    || clean(reportReceipt.externalReceiptCode) !== clean(alert.report.receiptCode)
    || publicHealthOfficialExchangeReceiptBindingDigest(reportReceipt)
      !== clean(alert.report.receiptBindingDigest))) {
    findings.push("alert-official-report-receipt-binding-invalid");
  }
  const feedbackReceipt = officialReceipts.trustedReceipts
    .find((item) => clean(item.id) === clean(alert.feedback?.trustedReceiptId));
  if (feedbackRequired && !alert.feedback) findings.push("alert-official-feedback-missing");
  if (alert.feedback && (!feedbackReceipt
    || clean(feedbackReceipt.stage) !== "feedback"
    || clean(feedbackReceipt.alertId) !== clean(alert.id)
    || clean(feedbackReceipt.reportId) !== clean(alert.report?.reportId)
    || clean(feedbackReceipt.externalReceiptCode) !== clean(alert.feedback.feedbackCode)
    || clean(feedbackReceipt.conclusion) !== clean(alert.feedback.conclusion)
    || clean(feedbackReceipt.predecessorRecordId) !== clean(alert.report?.trustedReceiptId)
    || publicHealthOfficialExchangeReceiptBindingDigest(feedbackReceipt)
      !== clean(alert.feedback.receiptBindingDigest))) {
    findings.push("alert-official-feedback-receipt-binding-invalid");
  }
  if (clean(alert.status) === "closed" && (!clean(alert.closure?.conclusion) || !Array.isArray(alert.closure?.evidenceRefs))) {
    findings.push("alert-closure-invalid");
  }
  return [...new Set(findings)];
}

function applyAlertAction(alert, payload, user, data, options = {}) {
  const next = clone(alert);
  const integrityFindings = validatePublicHealthSurveillanceAlert(next, data, options);
  if (integrityFindings.length) {
    throw new Error(`public health alert integrity invalid: ${integrityFindings[0]}`);
  }
  const action = clean(payload.action);
  const definition = ALERT_ACTIONS[action];
  if (!definition) throw new Error(`unsupported public health alert action: ${action}`);
  const role = authorizeAlertAction(action, user);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error(`idempotencyKey is required for ${action}`);
  const idempotencyKeyHash = sha256(idempotencyKey);
  const payloadFingerprint = actionPayloadFingerprint(payload);
  const duplicate = (next.timeline || []).find((item) => item.action === action && item.idempotencyKeyHash === idempotencyKeyHash);
  if (duplicate) {
    if (clean(duplicate.payloadFingerprint) !== payloadFingerprint) {
      throw new Error("public health alert idempotency key payload conflict");
    }
    return { alert: next, history: duplicate, idempotent: true, riskAssessment: null };
  }
  if (!definition.from.includes(clean(next.status))) {
    throw new Error(`action ${action} is not allowed from alert state ${clean(next.status)}`);
  }
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(next.version)) {
    throw new Error(`public health alert version conflict: expected ${payload.expectedVersion}, current ${next.version}`);
  }
  const refs = evidenceRefs(payload);
  const at = clean(payload.at || new Date().toISOString());
  let riskAssessment = null;
  if (action === "verify-alert") {
    const riskLevel = clean(payload.riskLevel).toLowerCase();
    if (!["low", "medium", "high", "critical"].includes(riskLevel) || !clean(payload.conclusion) || !refs.length) {
      throw new Error("riskLevel, conclusion and evidenceRefs are required for manual alert verification");
    }
    riskAssessment = {
      id: `ph-risk-${sha256(`${next.id}\n${next.version}`).slice(0, 24)}`,
      alertId: next.id,
      signalIds: clone(next.signalIds),
      riskLevel,
      conclusion: clean(payload.conclusion),
      evidenceRefs: refs,
      assessedBy: actorName(user),
      assessorRole: role,
      assessedAt: at,
      humanDecision: true,
      modelAdviceOnly: true,
      productionReady: false
    };
    next.assessment = { id: riskAssessment.id, riskLevel, humanDecision: true };
  }
  if (action === "dispatch-alert") {
    if (!clean(payload.medicalInstitutionId)
      || !clean(payload.primaryCareOrganizationId)
      || !Number.isFinite(new Date(payload.dueAt).getTime())
      || !clean(payload.note)) {
      throw new Error("medicalInstitutionId, primaryCareOrganizationId, dueAt and note are required to dispatch an alert");
    }
    next.dispatch = {
      medicalInstitutionId: clean(payload.medicalInstitutionId),
      primaryCareOrganizationId: clean(payload.primaryCareOrganizationId),
      dueAt: new Date(payload.dueAt).toISOString(),
      dispatchedBy: actorName(user),
      dispatchedAt: at
    };
  }
  if (action === "start-investigation" && (!clean(payload.investigationOwner) || !clean(payload.note))) {
    throw new Error("investigationOwner and note are required to start investigation");
  }
  if (action === "start-investigation") next.investigationOwner = clean(payload.investigationOwner);
  if (action === "record-official-report") {
    if (["reportId", "receiptCode", "evidenceRefs"].some((key) => Object.hasOwn(payload, key))) {
      throw new Error("official report identity, status and evidence must come from a trusted server receipt");
    }
    const receipt = trustedOfficialExchangeReceipt(
      data,
      payload.trustedReceiptId,
      "official-report",
      next.id,
      options,
      at
    );
    if ((next.timeline || []).some((item) => clean(item.trustedReceiptId) === clean(receipt.id))) {
      throw new Error("trusted official exchange receipt was already used by this alert");
    }
    const investigationStartedAt = [...(next.timeline || [])]
      .reverse()
      .find((item) => clean(item.to) === "investigating")?.at;
    if (investigationStartedAt
      && new Date(receipt.issuedAt).getTime() < new Date(investigationStartedAt).getTime()) {
      throw new Error("trusted official-report receipt predates the current investigation cycle");
    }
    next.report = {
      trustedReceiptId: clean(receipt.id),
      receiptBindingDigest: publicHealthOfficialExchangeReceiptBindingDigest(receipt),
      reportId: clean(receipt.reportId),
      receiptCode: clean(receipt.externalReceiptCode),
      evidenceRefs: normalizedReceiptEvidenceRefs(receipt),
      reportedAt: clean(receipt.issuedAt),
      recordedBy: actorName(user),
      productionReady: false
    };
    next.feedback = null;
  }
  if (action === "record-feedback") {
    if (["feedbackCode", "conclusion", "evidenceRefs"].some((key) => Object.hasOwn(payload, key))) {
      throw new Error("official feedback identity, conclusion and evidence must come from a trusted server receipt");
    }
    const receipt = trustedOfficialExchangeReceipt(
      data,
      payload.trustedReceiptId,
      "feedback",
      next.id,
      options,
      at
    );
    if ((next.timeline || []).some((item) => clean(item.trustedReceiptId) === clean(receipt.id))) {
      throw new Error("trusted official exchange receipt was already used by this alert");
    }
    if (clean(receipt.predecessorRecordId) !== clean(next.report?.trustedReceiptId)
      || clean(receipt.reportId) !== clean(next.report?.reportId)) {
      throw new Error("trusted feedback receipt must bind the alert official-report receipt");
    }
    next.feedback = {
      trustedReceiptId: clean(receipt.id),
      receiptBindingDigest: publicHealthOfficialExchangeReceiptBindingDigest(receipt),
      feedbackCode: clean(receipt.externalReceiptCode),
      conclusion: clean(receipt.conclusion),
      evidenceRefs: normalizedReceiptEvidenceRefs(receipt),
      receivedAt: clean(receipt.issuedAt),
      productionReady: false
    };
  }
  if (action === "close-alert") {
    const tasks = (Array.isArray(data.publicHealthMedicalPreventionTasks) ? data.publicHealthMedicalPreventionTasks : [])
      .filter((item) => clean(item.alertId) === next.id);
    if (tasks.length < 2 || tasks.some((item) => !isValidClosedPublicHealthMedicalPreventionTask(item))) {
      throw new Error("all medical-prevention collaboration tasks must be closed before the alert");
    }
    if (!clean(payload.conclusion) || !refs.length) {
      throw new Error("conclusion and evidenceRefs are required to close an alert");
    }
    next.closure = {
      conclusion: clean(payload.conclusion),
      evidenceRefs: refs,
      closedBy: actorName(user),
      closedAt: at
    };
  }
  if (action === "reopen-alert") {
    if (!clean(payload.note)) throw new Error("note is required to reopen an alert");
    next.closure = null;
  }
  const sequence = (next.timeline || []).length + 1;
  const history = {
    id: `${next.id}:history:${sequence}`,
    sequence,
    action,
    from: next.status,
    to: definition.to,
    actor: actorName(user),
    role,
    at,
    idempotencyKeyHash,
    payloadFingerprint,
    note: clean(payload.note || payload.conclusion)
  };
  if (action === "record-official-report") {
    history.trustedReceiptId = clean(next.report?.trustedReceiptId);
    history.receiptBindingDigest = clean(next.report?.receiptBindingDigest);
  }
  if (action === "record-feedback") {
    history.trustedReceiptId = clean(next.feedback?.trustedReceiptId);
    history.receiptBindingDigest = clean(next.feedback?.receiptBindingDigest);
  }
  next.status = definition.to;
  next.version = Number(next.version || 0) + 1;
  next.timeline = [...(next.timeline || []), history].slice(-50);
  next.productionReady = false;
  return { alert: next, history, idempotent: false, riskAssessment };
}

function applyPublicHealthSurveillanceAlertActionToState(data = {}, alertId, payload = {}, user = {}, options = {}) {
  const alerts = Array.isArray(data.publicHealthSurveillanceAlerts)
    ? clone(data.publicHealthSurveillanceAlerts)
    : [];
  const index = alerts.findIndex((item) => clean(item.id) === clean(alertId));
  if (index < 0) throw new Error(`unknown public health surveillance alert: ${clean(alertId) || "missing"}`);
  const result = applyAlertAction(alerts[index], payload, user, data, options);
  alerts[index] = result.alert;
  let nextData = { ...data, publicHealthSurveillanceAlerts: alerts };
  if (result.riskAssessment) {
    nextData.publicHealthRiskAssessments = [
      ...(Array.isArray(data.publicHealthRiskAssessments) ? clone(data.publicHealthRiskAssessments) : []),
      result.riskAssessment
    ];
  }
  let createdCollaborationTasks = [];
  if (!result.idempotent && payload.action === "dispatch-alert") {
    const ensured = ensurePublicHealthMedicalPreventionTasks(nextData, result.alert, payload, {
      at: result.history.at,
      actor: result.history.actor,
      role: result.history.role
    });
    nextData.publicHealthMedicalPreventionTasks = ensured.tasks;
    createdCollaborationTasks = ensured.created;
  }
  const existingAudit = Array.isArray(data.publicHealthSurveillanceAudit)
    ? clone(data.publicHealthSurveillanceAudit)
    : [];
  nextData.publicHealthSurveillanceAudit = result.idempotent ? existingAudit : [...existingAudit, {
    id: `${result.alert.id}:audit:${result.history.sequence}`,
    alertId: result.alert.id,
    action: result.history.action,
    from: result.history.from,
    to: result.history.to,
    actor: result.history.actor,
    role: result.history.role,
    at: result.history.at,
    version: result.alert.version
  }];
  return {
    ok: true,
    idempotent: result.idempotent,
    alert: clone(result.alert),
    action: clone(result.history),
    riskAssessment: clone(result.riskAssessment),
    createdCollaborationTasks: clone(createdCollaborationTasks),
    nextData,
    surveillance: buildPublicHealthSurveillanceCenter({
      data: nextData,
      ruleVerificationSecret: options.verificationSecret,
      ruleActivationKeyring: options.activationKeyring,
      officialExchangeReceiptKeyring: options.officialExchangeReceiptKeyring,
      officialExchangeReceiptAt: options.officialExchangeReceiptAt || result.history.at
    }),
    productionReady: false
  };
}

function buildPublicHealthSurveillanceCenter({
  data = {},
  ruleVerificationSecret = "",
  ruleActivationKeyring = null,
  officialExchangeReceiptKeyring = null,
  officialExchangeReceiptAt = new Date().toISOString(),
  modelGovernanceAt = new Date().toISOString(),
  respiratorySurveillanceAt = new Date().toISOString()
} = {}) {
  const ruleGovernance = buildPublicHealthSurveillanceRuleGovernance({
    data,
    verificationSecret: ruleVerificationSecret,
    activationKeyring: ruleActivationKeyring
  });
  const rules = ruleGovernance.rules;
  const signals = Array.isArray(data.publicHealthSurveillanceSignals)
    ? clone(data.publicHealthSurveillanceSignals)
    : [];
  const alerts = Array.isArray(data.publicHealthSurveillanceAlerts)
    ? clone(data.publicHealthSurveillanceAlerts)
    : [];
  const assessments = Array.isArray(data.publicHealthRiskAssessments)
    ? clone(data.publicHealthRiskAssessments)
    : [];
  const dataFoundation = buildPublicHealthDataFoundation({ data });
  const collaboration = buildPublicHealthMedicalPreventionBoard({ data, alerts });
  const modelGovernance = buildPublicHealthSurveillanceModelGovernance({
    data,
    at: modelGovernanceAt
  });
  const respiratorySurveillance = buildPublicHealthRespiratoryPathogenSurveillance({
    data,
    at: respiratorySurveillanceAt
  });
  const officialExchangeReceipts = officialExchangeReceiptRegistry(data, {
    officialExchangeReceiptKeyring,
    officialExchangeReceiptAt
  }, officialExchangeReceiptAt);
  const alertIntegrityFindings = alerts.flatMap((alert) => validatePublicHealthSurveillanceAlert(alert, data, {
    verificationSecret: ruleVerificationSecret,
    activationKeyring: ruleActivationKeyring,
    officialExchangeReceiptKeyring,
    officialExchangeReceiptAt
  })
    .map((code) => ({ alertId: clean(alert.id), code })));
  const openAlerts = alerts.filter((item) => item.status !== "closed");
  return {
    ok: dataFoundation.ok
      && collaboration.ok
      && ruleGovernance.ok
      && modelGovernance.ok
      && respiratorySurveillance.ok
      && officialExchangeReceipts.ok
      && alertIntegrityFindings.length === 0,
    functionalState: !ruleGovernance.ok
      ? "multi-source-surveillance-rule-governance-review-required"
      : !modelGovernance.ok
        ? "multi-source-surveillance-model-governance-review-required"
        : !respiratorySurveillance.ok
          ? "multi-source-respiratory-pathogen-quality-review-required"
          : !officialExchangeReceipts.ok
            ? "multi-source-official-exchange-receipt-review-required"
            : alertIntegrityFindings.length
              ? "multi-source-surveillance-integrity-review-required"
              : "multi-source-surveillance-warning-workflow-runnable",
    formalGoLiveState: "blocked-until-production-source-interfaces-official-receipts-and-site-evidence-verified",
    summary: {
      rules: rules.length,
      activeRules: rules.filter((item) => item.status === "active").length,
      signals: signals.length,
      humanVerifiedSignals: signals.filter((item) => ["human-verified", "alert-created", "evaluated-no-alert"].includes(item.workflowState)).length,
      alerts: alerts.length,
      openAlerts: openAlerts.length,
      closedAlerts: alerts.length - openAlerts.length,
      riskAssessments: assessments.length,
      humanRiskAssessments: assessments.filter((item) => item.humanDecision === true).length,
      collaborationTasks: collaboration.summary.tasks,
      closedCollaborationTasks: collaboration.summary.closedTasks,
      alertIntegrityFindings: alertIntegrityFindings.length,
      trustedRuleActivations: ruleGovernance.summary.trustedActivations,
      ruleGovernanceFindings: ruleGovernance.summary.findings,
      models: modelGovernance.summary.models,
      validatedShadowModels: modelGovernance.summary.validatedShadowModels,
      modelRuns: modelGovernance.summary.modelRuns,
      modelGovernanceFindings: modelGovernance.summary.findings,
      respiratoryCatalogPathogens: respiratorySurveillance.summary.catalogPathogens,
      respiratoryObservedPathogens: respiratorySurveillance.summary.observedPathogens,
      respiratoryBatches: respiratorySurveillance.summary.batches,
      respiratoryPublishedSignals: respiratorySurveillance.summary.publishedSignals,
      respiratoryPlanningCoverageReady: respiratorySurveillance.summary.planningCoverageReady,
      respiratoryFindings: respiratorySurveillance.summary.findings,
      officialExchangeReceipts: officialExchangeReceipts.summary.receipts,
      trustedOfficialExchangeReceipts: officialExchangeReceipts.summary.trustedReceipts,
      trustedOfficialReports: officialExchangeReceipts.summary.officialReports,
      trustedOfficialFeedbacks: officialExchangeReceipts.summary.feedbacks,
      officialExchangeReceiptFindings: officialExchangeReceipts.summary.findings
    },
    rules: rules.map((item) => ({
      id: item.id,
      version: item.version,
      signalType: item.signalType,
      metricCode: item.metricCode,
      threshold: item.threshold,
      severity: item.severity,
      status: item.status,
      owner: item.owner
    })),
    alerts: alerts.map((item) => ({
      id: item.id,
      version: item.version,
      status: item.status,
      severity: item.severity,
      signalType: item.signalType,
      regionCode: item.regionCode,
      institutionId: item.institutionId,
      signalCount: Array.isArray(item.signalIds) ? item.signalIds.length : 0,
      riskLevel: clean(item.assessment?.riskLevel),
      collaborationTasks: collaboration.tasks.filter((task) => task.alertId === item.id).length
    })),
    dataFoundation,
    collaboration,
    ruleGovernance,
    modelGovernance,
    respiratorySurveillance,
    officialExchangeReceipts,
    alertIntegrityFindings,
    productionReady: false,
    blockers: [
      "Real national/provincial surveillance interfaces and continuous official receipt delivery are not yet verified.",
      "AI/model output remains advisory and cannot replace manual disease-control decisions.",
      "Trusted site evidence and launch approval remain required."
    ]
  };
}

module.exports = {
  ALERT_ACTIONS,
  PUBLIC_HEALTH_SURVEILLANCE_RULES,
  applyPublicHealthSurveillanceAlertActionToState,
  buildPublicHealthSurveillanceCenter,
  evaluatePublicHealthSurveillanceSignalToState,
  validatePublicHealthSurveillanceAlert,
  verifyPublicHealthSurveillanceSignalToState
};
