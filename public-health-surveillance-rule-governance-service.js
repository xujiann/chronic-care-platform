"use strict";

const crypto = require("node:crypto");
const {
  resolveVerificationKey,
  selectSigningKey,
  summarizeKeyring
} = require("./public-health-external-keyring-service");

const RULE_ACTIVATION_KEYRING_PURPOSE = "public-health-surveillance-rule-activation";
const PUBLIC_HEALTH_SURVEILLANCE_RULES = Object.freeze([
  { id: "ph-rule-case-report", version: 1, signalType: "case-report", metricCode: "reportable-case-count", operator: ">=", threshold: 1, severity: "high", status: "active", owner: "传染病监测部门" },
  { id: "ph-rule-clinical-syndrome", version: 1, signalType: "clinical-syndrome", metricCode: "fever-respiratory-count", operator: ">=", threshold: 5, severity: "high", status: "active", owner: "传染病监测部门" },
  { id: "ph-rule-laboratory-pathogen", version: 1, signalType: "laboratory-pathogen", metricCode: "pathogen-positive-count", operator: ">=", threshold: 3, severity: "critical", status: "active", owner: "疾控实验室" },
  { id: "ph-rule-public-health-event", version: 1, signalType: "public-health-event", metricCode: "event-severity-score", operator: ">=", threshold: 3, severity: "critical", status: "active", owner: "疾控应急管理部门" },
  { id: "ph-rule-immunization-aefi", version: 1, signalType: "immunization-aefi", metricCode: "aefi-cluster-count", operator: ">=", threshold: 2, severity: "high", status: "active", owner: "免疫规划部门" },
  { id: "ph-rule-vector-environment", version: 1, signalType: "vector-environment", metricCode: "vector-density-index", operator: ">=", threshold: 1, severity: "high", status: "active", owner: "环境与病媒部门" },
  { id: "ph-rule-department-collaboration", version: 1, signalType: "department-collaboration", metricCode: "coordinated-risk-score", operator: ">=", threshold: 3, severity: "high", status: "active", owner: "联防联控专班" },
  { id: "ph-rule-social-sensing", version: 1, signalType: "social-sensing", metricCode: "verified-report-count", operator: ">=", threshold: 2, severity: "medium", status: "active", owner: "风险沟通部门" }
]);

const RULE_CHANGE_ACTIONS = Object.freeze({
  "submit-rule-change": { from: "", to: "submitted" },
  "review-rule-change": { from: "submitted", to: null },
  "activate-rule-change": { from: "approved", to: "activated" }
});

const RECEIPT_VERSION = "public-health-surveillance-rule-activation/v1";
const RECEIPT_SOURCE = "server-rule-governance";
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const RULE_STATUSES = new Set(["active", "paused", "retired"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
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

function actorRole(user = {}) {
  return clean(user.role).toLowerCase();
}

function actorName(user = {}) {
  return clean(user.name || user.username || user.id || "unknown");
}

function actorId(user = {}) {
  return clean(user.id || user.username || user.name || "unknown");
}

function evidenceRefs(payload = {}) {
  return Array.isArray(payload.evidenceRefs)
    ? [...new Set(payload.evidenceRefs.map(clean).filter(Boolean))]
    : [];
}

function actionPayloadFingerprint(payload = {}) {
  return sha256(stableStringify(Object.fromEntries(Object.entries(payload)
    .filter(([key]) => !["idempotencyKey", "at"].includes(key)))));
}

function safeDate(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid date-time`);
  return parsed.toISOString();
}

function changeId(ruleId, toVersion) {
  return `ph-rule-change-${sha256(`${clean(ruleId)}\n${Number(toVersion)}`).slice(0, 24)}`;
}

function canonicalRule(rule = {}) {
  return {
    id: clean(rule.id),
    version: Number(rule.version),
    signalType: clean(rule.signalType),
    metricCode: clean(rule.metricCode),
    operator: clean(rule.operator),
    threshold: Number(rule.threshold),
    severity: clean(rule.severity),
    status: clean(rule.status),
    owner: clean(rule.owner)
  };
}

function activationReceiptPayload(change = {}) {
  const activation = change.activation || {};
  const receipt = activation.receipt || {};
  return [
    RECEIPT_VERSION,
    clean(change.id),
    clean(change.ruleId),
    Number(change.fromVersion),
    Number(change.toVersion),
    clean(change.status),
    stableStringify(change.proposed || {}),
    clean(change.submittedBy),
    clean(change.submittedActorId),
    clean(change.review?.reviewedBy),
    clean(change.review?.reviewedActorId),
    clean(change.review?.decision),
    clean(activation.activatedBy),
    clean(activation.activatedActorId),
    clean(activation.role),
    clean(activation.at),
    clean(receipt.verificationSource),
    receipt.signatureVerified === true ? "true" : "false",
    clean(receipt.keyId),
    clean(receipt.signedAt),
    sha256(stableStringify(change.timeline || []))
  ].join("\n");
}

function materialForLegacyReceipt(material, receipt = {}) {
  if (typeof material === "string") {
    return { secret: material, keyId: clean(receipt.keyId || "rule-governance-static") };
  }
  if (material && typeof material === "object" && clean(material.secret) && !clean(material.keyId)) {
    return { ...material, keyId: clean(receipt.keyId || "rule-governance-static") };
  }
  return material;
}

function ruleActivationMaterial(options = {}) {
  if (options.activationKeyring) return options.activationKeyring;
  if (options.verificationMaterial) return options.verificationMaterial;
  if (clean(options.verificationSecret)) {
    return clean(options.keyId)
      ? { secret: clean(options.verificationSecret), keyId: clean(options.keyId) }
      : clean(options.verificationSecret);
  }
  return "";
}

function signPublicHealthSurveillanceRuleActivationReceipt(change = {}, signingMaterial = "") {
  const receipt = change.activation?.receipt || {};
  const material = materialForLegacyReceipt(signingMaterial, receipt);
  const key = selectSigningKey(material, clean(receipt.signedAt || change.activation?.at));
  if (!key.legacy && key.purpose !== RULE_ACTIVATION_KEYRING_PURPOSE) {
    throw new Error(`rule activation keyring purpose must be ${RULE_ACTIVATION_KEYRING_PURPOSE}`);
  }
  if (clean(key.keyId) !== clean(receipt.keyId)) {
    throw new Error("rule activation receipt keyId must identify the active signing key");
  }
  return crypto.createHmac("sha256", key.secret).update(activationReceiptPayload(change)).digest("hex");
}

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(clean(left)) || !/^[a-f0-9]{64}$/.test(clean(right))) return false;
  return crypto.timingSafeEqual(Buffer.from(clean(left), "hex"), Buffer.from(clean(right), "hex"));
}

function verifyPublicHealthSurveillanceRuleActivationReceipt(change = {}, verificationMaterial = "") {
  const receipt = change.activation?.receipt || {};
  if (clean(change.status) !== "activated"
    || clean(receipt.version) !== RECEIPT_VERSION
    || clean(receipt.verificationSource) !== RECEIPT_SOURCE
    || receipt.signatureVerified !== true
    || clean(receipt.signatureAlgorithm) !== "HMAC-SHA256"
    || !clean(receipt.keyId)) {
    return false;
  }
  const material = materialForLegacyReceipt(verificationMaterial, receipt);
  const resolution = resolveVerificationKey(material, receipt.keyId, receipt.signedAt);
  if (!resolution.ok) return false;
  if (!resolution.key.legacy && resolution.key.purpose !== RULE_ACTIVATION_KEYRING_PURPOSE) return false;
  let expected;
  try {
    expected = crypto.createHmac("sha256", resolution.key.secret)
      .update(activationReceiptPayload(change))
      .digest("hex");
  } catch {
    return false;
  }
  return timingSafeHexEqual(receipt.signature, expected);
}

function validatePublicHealthSurveillanceRuleChange(change = {}) {
  const findings = [];
  const definition = PUBLIC_HEALTH_SURVEILLANCE_RULES.find((item) => item.id === clean(change.ruleId));
  if (!definition) return ["unknown-rule"];
  if (Number(change.fromVersion) < definition.version
    || Number(change.toVersion) !== Number(change.fromVersion) + 1
    || clean(change.id) !== changeId(change.ruleId, change.toVersion)) {
    findings.push("rule-change-version-binding-invalid");
  }
  if (!Number.isFinite(Number(change.proposed?.threshold))
    || Number(change.proposed?.threshold) < 0
    || !SEVERITIES.has(clean(change.proposed?.severity))
    || !RULE_STATUSES.has(clean(change.proposed?.status))) {
    findings.push("rule-change-proposal-invalid");
  }
  if (!clean(change.reason) || !Array.isArray(change.evidenceRefs) || !change.evidenceRefs.length) {
    findings.push("rule-change-rationale-evidence-missing");
  }
  const timeline = Array.isArray(change.timeline) ? change.timeline : [];
  if (!timeline.length || Number(change.version) !== timeline.length) findings.push("rule-change-version-timeline-invalid");
  timeline.forEach((item, index) => {
    if (Number(item.sequence) !== index + 1
      || !/^[a-f0-9]{64}$/.test(clean(item.idempotencyKeyHash))
      || !/^[a-f0-9]{64}$/.test(clean(item.payloadFingerprint))) {
      findings.push("rule-change-timeline-integrity-invalid");
    }
    if (index === 0 && (clean(item.action) !== "submit-rule-change" || clean(item.from) || clean(item.to) !== "submitted")) {
      findings.push("rule-change-submit-history-invalid");
    }
    if (index > 0) {
      const previous = timeline[index - 1];
      const action = clean(item.action);
      const expectedTo = action === "review-rule-change"
        ? clean(item.decision) === "approved" ? "approved" : "rejected"
        : RULE_CHANGE_ACTIONS[action]?.to;
      if (!RULE_CHANGE_ACTIONS[action] || clean(item.from) !== clean(previous.to) || clean(item.to) !== clean(expectedTo)) {
        findings.push("rule-change-transition-history-invalid");
      }
    }
  });
  const submitEvent = timeline[0] || {};
  if (clean(submitEvent.actor) !== clean(change.submittedBy)
    || clean(submitEvent.actorId) !== clean(change.submittedActorId)
    || clean(submitEvent.role) !== clean(change.submitterRole)
    || clean(submitEvent.at) !== clean(change.submittedAt)) {
    findings.push("rule-change-submitter-binding-invalid");
  }
  if (timeline.length && clean(change.status) !== clean(timeline[timeline.length - 1].to)) {
    findings.push("rule-change-state-history-mismatch");
  }
  if (["approved", "activated", "rejected"].includes(clean(change.status))) {
    if (!["approved", "rejected"].includes(clean(change.review?.decision))
      || !clean(change.review?.reviewedBy)
      || !clean(change.review?.reviewedActorId)
      || clean(change.review?.reviewedActorId) === clean(change.submittedActorId)
      || !clean(change.review?.note)
      || !Array.isArray(change.review?.evidenceRefs)
      || !change.review.evidenceRefs.length) {
      findings.push("rule-change-independent-review-invalid");
    }
    const reviewEvent = timeline.find((item) => item.action === "review-rule-change");
    if (!reviewEvent
      || clean(reviewEvent.actor) !== clean(change.review?.reviewedBy)
      || clean(reviewEvent.actorId) !== clean(change.review?.reviewedActorId)
      || clean(reviewEvent.role) !== clean(change.review?.role)
      || clean(reviewEvent.at) !== clean(change.review?.at)
      || clean(reviewEvent.decision) !== clean(change.review?.decision)) {
      findings.push("rule-change-reviewer-binding-invalid");
    }
  }
  if (clean(change.status) === "activated"
    && (!clean(change.activation?.activatedBy)
      || !["commission", "system"].includes(clean(change.activation?.role))
      || !clean(change.activation?.note)
      || !Array.isArray(change.activation?.evidenceRefs)
      || !change.activation.evidenceRefs.length)) {
    findings.push("rule-change-activation-invalid");
  }
  if (clean(change.status) === "activated") {
    const activationEvent = timeline.find((item) => item.action === "activate-rule-change");
    if (!activationEvent
      || clean(activationEvent.actor) !== clean(change.activation?.activatedBy)
      || clean(activationEvent.actorId) !== clean(change.activation?.activatedActorId)
      || clean(activationEvent.role) !== clean(change.activation?.role)
      || clean(activationEvent.at) !== clean(change.activation?.at)) {
      findings.push("rule-change-activator-binding-invalid");
    }
  }
  return [...new Set(findings)];
}

function buildTrustedPublicHealthSurveillanceRuleRegistry(data = {}, options = {}) {
  const verificationMaterial = ruleActivationMaterial(options);
  const rules = PUBLIC_HEALTH_SURVEILLANCE_RULES.map((item) => clone(item));
  const ruleVersions = PUBLIC_HEALTH_SURVEILLANCE_RULES.map((item) => clone(item));
  const changes = Array.isArray(data.publicHealthSurveillanceRuleChanges)
    ? clone(data.publicHealthSurveillanceRuleChanges)
    : [];
  const findings = [];
  const trustedChanges = [];
  changes.forEach((change) => {
    validatePublicHealthSurveillanceRuleChange(change).forEach((code) => {
      findings.push({ changeId: clean(change.id), ruleId: clean(change.ruleId), code });
    });
  });
  const activated = changes.filter((item) => clean(item.status) === "activated")
    .sort((left, right) => Number(left.toVersion) - Number(right.toVersion));
  activated.forEach((change) => {
    if (validatePublicHealthSurveillanceRuleChange(change).length) return;
    const current = rules.find((item) => item.id === clean(change.ruleId));
    if (!current || Number(change.fromVersion) !== Number(current.version) || Number(change.toVersion) !== Number(current.version) + 1) {
      findings.push({ changeId: clean(change.id), ruleId: clean(change.ruleId), code: "rule-change-chain-invalid" });
      return;
    }
    if (!verifyPublicHealthSurveillanceRuleActivationReceipt(change, verificationMaterial)) {
      findings.push({ changeId: clean(change.id), ruleId: clean(change.ruleId), code: "trusted-rule-activation-receipt-invalid" });
      return;
    }
    current.version = Number(change.toVersion);
    current.threshold = Number(change.proposed.threshold);
    current.severity = clean(change.proposed.severity);
    current.status = clean(change.proposed.status);
    ruleVersions.push(clone(current));
    trustedChanges.push(clone(change));
  });
  const materialized = Array.isArray(data.publicHealthSurveillanceRules)
    ? data.publicHealthSurveillanceRules
    : [];
  materialized.forEach((candidate) => {
    const trusted = rules.find((item) => item.id === clean(candidate.id));
    if (!trusted || stableStringify(canonicalRule(candidate)) !== stableStringify(canonicalRule(trusted))) {
      findings.push({ changeId: "", ruleId: clean(candidate.id), code: "ungoverned-rule-materialization" });
    }
  });
  return {
    ok: findings.length === 0,
    rules,
    ruleVersions,
    changes,
    trustedChanges,
    findings,
    productionReady: false
  };
}

function ruleChangeCollection(data = {}) {
  return Array.isArray(data.publicHealthSurveillanceRuleChanges)
    ? clone(data.publicHealthSurveillanceRuleChanges)
    : [];
}

function proposePublicHealthSurveillanceRuleChangeToState(data = {}, payload = {}, user = {}, options = {}) {
  const role = actorRole(user);
  if (!["cdc-surveillance", "commission"].includes(role)) throw new Error(`role ${role || "missing"} is not allowed to submit a rule change`);
  const registry = buildTrustedPublicHealthSurveillanceRuleRegistry(data, options);
  if (registry.findings.length) throw new Error(`public health rule registry integrity invalid: ${registry.findings[0].code}`);
  const current = registry.rules.find((item) => item.id === clean(payload.ruleId));
  if (!current) throw new Error("known public health surveillance ruleId is required");
  if (payload.expectedCurrentVersion !== undefined && Number(payload.expectedCurrentVersion) !== Number(current.version)) {
    throw new Error(`public health rule version conflict: expected ${payload.expectedCurrentVersion}, current ${current.version}`);
  }
  const proposed = {
    threshold: Number(payload.threshold),
    severity: clean(payload.severity || current.severity).toLowerCase(),
    status: clean(payload.status || current.status).toLowerCase()
  };
  if (!Number.isFinite(proposed.threshold) || proposed.threshold < 0 || !SEVERITIES.has(proposed.severity) || !RULE_STATUSES.has(proposed.status)) {
    throw new Error("rule threshold, severity and status are invalid");
  }
  const refs = evidenceRefs(payload);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey || !clean(payload.reason) || !refs.length) {
    throw new Error("idempotencyKey, reason and evidenceRefs are required to submit a rule change");
  }
  const toVersion = Number(current.version) + 1;
  const id = changeId(current.id, toVersion);
  const changes = ruleChangeCollection(data);
  const fingerprint = actionPayloadFingerprint(payload);
  const idempotencyKeyHash = sha256(idempotencyKey);
  const existing = changes.find((item) => item.id === id);
  if (existing) {
    const first = existing.timeline?.[0] || {};
    if (clean(first.idempotencyKeyHash) === idempotencyKeyHash && clean(first.payloadFingerprint) === fingerprint) {
      return { ok: true, idempotent: true, change: existing, nextData: data, productionReady: false };
    }
    throw new Error("a public health rule change already targets this rule version");
  }
  const at = safeDate(payload.at || new Date().toISOString(), "rule change submittedAt");
  const event = {
    sequence: 1,
    action: "submit-rule-change",
    from: "",
    to: "submitted",
    actor: actorName(user),
    actorId: actorId(user),
    role,
    at,
    note: clean(payload.reason),
    evidenceRefs: refs,
    idempotencyKeyHash,
    payloadFingerprint: fingerprint
  };
  const change = {
    id,
    version: 1,
    ruleId: current.id,
    fromVersion: current.version,
    toVersion,
    proposed,
    reason: clean(payload.reason),
    evidenceRefs: refs,
    submittedBy: actorName(user),
    submittedActorId: actorId(user),
    submitterRole: role,
    submittedAt: at,
    status: "submitted",
    review: null,
    activation: null,
    timeline: [event],
    productionReady: false
  };
  changes.push(change);
  return {
    ok: true,
    idempotent: false,
    change: clone(change),
    nextData: { ...data, publicHealthSurveillanceRuleChanges: changes },
    productionReady: false
  };
}

function reviewPublicHealthSurveillanceRuleChangeToState(data = {}, changeIdValue, payload = {}, user = {}) {
  const role = actorRole(user);
  if (role !== "commission") throw new Error(`role ${role || "missing"} is not allowed to review a rule change`);
  const changes = ruleChangeCollection(data);
  const index = changes.findIndex((item) => clean(item.id) === clean(changeIdValue));
  if (index < 0) throw new Error("unknown public health rule change");
  const change = changes[index];
  const integrity = validatePublicHealthSurveillanceRuleChange(change);
  if (integrity.length) throw new Error(`public health rule change integrity invalid: ${integrity[0]}`);
  const decision = clean(payload.decision).toLowerCase();
  const refs = evidenceRefs(payload);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!["approved", "rejected"].includes(decision) || !idempotencyKey || !clean(payload.note) || !refs.length) {
    throw new Error("approved/rejected decision, idempotencyKey, note and evidenceRefs are required");
  }
  if (actorId(user) === clean(change.submittedActorId)) throw new Error("rule change reviewer must be independent from submitter");
  const idempotencyKeyHash = sha256(idempotencyKey);
  const fingerprint = actionPayloadFingerprint(payload);
  const duplicate = change.timeline.find((item) => item.action === "review-rule-change" && item.idempotencyKeyHash === idempotencyKeyHash);
  if (duplicate) {
    if (clean(duplicate.payloadFingerprint) !== fingerprint) throw new Error("rule change review idempotency payload conflict");
    return { ok: true, idempotent: true, change, nextData: data, productionReady: false };
  }
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(change.version)) {
    throw new Error(`public health rule change version conflict: expected ${payload.expectedVersion}, current ${change.version}`);
  }
  if (change.status !== "submitted") throw new Error(`rule change review is not allowed from ${change.status}`);
  const at = safeDate(payload.at || new Date().toISOString(), "rule change reviewedAt");
  const event = {
    sequence: change.version + 1,
    action: "review-rule-change",
    from: "submitted",
    to: decision,
    decision,
    actor: actorName(user),
    actorId: actorId(user),
    role,
    at,
    note: clean(payload.note),
    evidenceRefs: refs,
    idempotencyKeyHash,
    payloadFingerprint: fingerprint
  };
  const next = {
    ...change,
    version: change.version + 1,
    status: decision,
    review: {
      decision,
      reviewedBy: actorName(user),
      reviewedActorId: actorId(user),
      role,
      at,
      note: clean(payload.note),
      evidenceRefs: refs
    },
    timeline: [...change.timeline, event]
  };
  changes[index] = next;
  return {
    ok: true,
    idempotent: false,
    change: clone(next),
    nextData: { ...data, publicHealthSurveillanceRuleChanges: changes },
    productionReady: false
  };
}

function activatePublicHealthSurveillanceRuleChangeToState(data = {}, changeIdValue, payload = {}, user = {}, options = {}) {
  const role = actorRole(user);
  if (!["commission", "system"].includes(role)) throw new Error(`role ${role || "missing"} is not allowed to activate a rule change`);
  const signingMaterial = ruleActivationMaterial(options);
  let signingKey;
  try {
    signingKey = selectSigningKey(signingMaterial, clean(payload.at || new Date().toISOString()));
  } catch {
    throw new Error("trusted server rule activation signing keyring is required");
  }
  if (!signingKey.legacy && signingKey.purpose !== RULE_ACTIVATION_KEYRING_PURPOSE) {
    throw new Error(`rule activation keyring purpose must be ${RULE_ACTIVATION_KEYRING_PURPOSE}`);
  }
  const changes = ruleChangeCollection(data);
  const index = changes.findIndex((item) => clean(item.id) === clean(changeIdValue));
  if (index < 0) throw new Error("unknown public health rule change");
  const change = changes[index];
  const integrity = validatePublicHealthSurveillanceRuleChange(change);
  if (integrity.length) throw new Error(`public health rule change integrity invalid: ${integrity[0]}`);
  const refs = evidenceRefs(payload);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey || !clean(payload.note) || !refs.length) {
    throw new Error("idempotencyKey, note and evidenceRefs are required to activate a rule change");
  }
  const idempotencyKeyHash = sha256(idempotencyKey);
  const fingerprint = actionPayloadFingerprint(payload);
  const duplicate = change.timeline.find((item) => item.action === "activate-rule-change" && item.idempotencyKeyHash === idempotencyKeyHash);
  if (duplicate) {
    if (clean(duplicate.payloadFingerprint) !== fingerprint) throw new Error("rule change activation idempotency payload conflict");
    return { ok: true, idempotent: true, change, nextData: data, productionReady: false };
  }
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(change.version)) {
    throw new Error(`public health rule change version conflict: expected ${payload.expectedVersion}, current ${change.version}`);
  }
  if (change.status !== "approved") throw new Error(`rule change activation is not allowed from ${change.status}`);
  const at = safeDate(payload.at || new Date().toISOString(), "rule change activatedAt");
  const event = {
    sequence: change.version + 1,
    action: "activate-rule-change",
    from: "approved",
    to: "activated",
    actor: actorName(user),
    actorId: actorId(user),
    role,
    at,
    note: clean(payload.note),
    evidenceRefs: refs,
    idempotencyKeyHash,
    payloadFingerprint: fingerprint
  };
  const receipt = {
    version: RECEIPT_VERSION,
    verificationSource: RECEIPT_SOURCE,
    signatureVerified: true,
    keyId: signingKey.keyId,
    signedAt: at,
    signatureAlgorithm: "HMAC-SHA256",
    signature: ""
  };
  const next = {
    ...change,
    version: change.version + 1,
    status: "activated",
    activation: {
      activatedBy: actorName(user),
      activatedActorId: actorId(user),
      role,
      at,
      note: clean(payload.note),
      evidenceRefs: refs,
      receipt
    },
    timeline: [...change.timeline, event]
  };
  next.activation.receipt.signature = signPublicHealthSurveillanceRuleActivationReceipt(next, signingMaterial);
  changes[index] = next;
  const interimData = { ...data, publicHealthSurveillanceRuleChanges: changes };
  const registry = buildTrustedPublicHealthSurveillanceRuleRegistry({
    ...interimData,
    publicHealthSurveillanceRules: []
  }, { verificationMaterial: signingMaterial });
  if (registry.findings.length) throw new Error(`trusted public health rule activation failed: ${registry.findings[0].code}`);
  const nextData = {
    ...interimData,
    publicHealthSurveillanceRules: registry.rules
  };
  return {
    ok: true,
    idempotent: false,
    change: clone(next),
    rules: clone(registry.rules),
    nextData,
    productionReady: false
  };
}

function buildPublicHealthSurveillanceRuleGovernance({
  data = {},
  verificationSecret = "",
  activationKeyring = null,
  at = new Date().toISOString()
} = {}) {
  const verificationMaterial = activationKeyring || verificationSecret;
  const registry = buildTrustedPublicHealthSurveillanceRuleRegistry(data, { verificationMaterial });
  const keyring = verificationMaterial
    ? summarizeKeyring(verificationMaterial, at)
    : {
        ok: false,
        productionReady: false,
        activeKeyId: "",
        keys: [],
        blockers: ["Rule activation verification keyring is unavailable."]
      };
  return {
    ok: registry.ok,
    functionalState: registry.findings.length
      ? "surveillance-rule-governance-review-required"
      : "surveillance-rule-governance-runnable",
    formalGoLiveState: "blocked-until-production-threshold-approval-and-managed-signing-key-verified",
    summary: {
      rules: registry.rules.length,
      ruleVersions: registry.ruleVersions.length,
      activeRules: registry.rules.filter((item) => item.status === "active").length,
      changes: registry.changes.length,
      submitted: registry.changes.filter((item) => item.status === "submitted").length,
      approved: registry.changes.filter((item) => item.status === "approved").length,
      activated: registry.changes.filter((item) => item.status === "activated").length,
      trustedActivations: registry.trustedChanges.length,
      managedKeyringReady: keyring.productionReady === true
        && keyring.purpose === RULE_ACTIVATION_KEYRING_PURPOSE,
      findings: registry.findings.length
    },
    rules: registry.rules.map(canonicalRule),
    ruleVersions: registry.ruleVersions.map(canonicalRule),
    changes: registry.changes.map((item) => ({
      id: clean(item.id),
      version: Number(item.version),
      ruleId: clean(item.ruleId),
      fromVersion: Number(item.fromVersion),
      toVersion: Number(item.toVersion),
      status: clean(item.status),
      threshold: Number(item.proposed?.threshold),
      severity: clean(item.proposed?.severity),
      submittedBy: clean(item.submittedBy),
      reviewedBy: clean(item.review?.reviewedBy),
      activatedBy: clean(item.activation?.activatedBy)
    })),
    findings: registry.findings,
    keyring,
    productionReady: false,
    blockers: [
      "Production thresholds require disease-control approval and controlled change windows.",
      "A managed server signing key and on-site rule validation evidence remain required."
    ]
  };
}

module.exports = {
  RULE_ACTIVATION_KEYRING_PURPOSE,
  PUBLIC_HEALTH_SURVEILLANCE_RULES,
  RULE_CHANGE_ACTIONS,
  activatePublicHealthSurveillanceRuleChangeToState,
  buildPublicHealthSurveillanceRuleGovernance,
  buildTrustedPublicHealthSurveillanceRuleRegistry,
  proposePublicHealthSurveillanceRuleChangeToState,
  reviewPublicHealthSurveillanceRuleChangeToState,
  signPublicHealthSurveillanceRuleActivationReceipt,
  validatePublicHealthSurveillanceRuleChange,
  verifyPublicHealthSurveillanceRuleActivationReceipt
};
