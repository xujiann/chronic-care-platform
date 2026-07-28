"use strict";

const crypto = require("node:crypto");
const {
  buildPublicHealthDataFoundation
} = require("./public-health-data-foundation-service");

const PUBLIC_HEALTH_SURVEILLANCE_MODELS = Object.freeze([
  Object.freeze({
    id: "ph-model-baseline-deviation",
    version: 1,
    name: "多病种基线偏离影子模型",
    algorithm: "relative-baseline-uplift-v1",
    owner: "疾控监测部门",
    status: "shadow",
    minSignals: 1,
    minDistinctSources: 1,
    minDistinctRegions: 1,
    reviewThreshold: 0.65
  }),
  Object.freeze({
    id: "ph-model-cross-source-concordance",
    version: 1,
    name: "跨来源异常一致性影子模型",
    algorithm: "cross-source-concordance-v1",
    owner: "疾控监测与数据治理部门",
    status: "shadow",
    minSignals: 2,
    minDistinctSources: 2,
    minDistinctRegions: 1,
    reviewThreshold: 0.55
  }),
  Object.freeze({
    id: "ph-model-spatiotemporal-cluster",
    version: 1,
    name: "时空聚集影子模型",
    algorithm: "spatiotemporal-cluster-v1",
    owner: "疾控监测与应急部门",
    status: "shadow",
    minSignals: 2,
    minDistinctSources: 1,
    minDistinctRegions: 1,
    reviewThreshold: 0.6
  })
]);

const MODEL_RUN_ROLES = new Set(["system", "cdc-surveillance", "commission"]);
const MODEL_VALIDATION_SUBMIT_ROLES = new Set(["cdc-surveillance"]);
const MODEL_VALIDATION_REVIEW_ROLES = new Set(["commission"]);
const MODEL_VALIDATION_MAX_AGE_DAYS = 90;
const DIRECT_IDENTIFIER_KEYS = new Set([
  "residentid",
  "name",
  "idcard",
  "identitynumber",
  "phone",
  "mobile",
  "address",
  "medicalrecordnumber",
  "patientid"
]);

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

function actorRole(user = {}) {
  return clean(user.role).toLowerCase();
}

function actorName(user = {}) {
  return clean(user.name || user.username || user.id || "unknown");
}

function authorize(roles, user, action) {
  const role = actorRole(user);
  if (!roles.has(role)) throw new Error(`role ${role || "missing"} is not allowed to ${action}`);
  return role;
}

function safeDate(value, label) {
  const text = clean(value);
  const parsed = new Date(text);
  if (!text || !Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid date-time`);
  return parsed.toISOString();
}

function isValidDateTime(value) {
  return Boolean(clean(value)) && Number.isFinite(new Date(clean(value)).getTime());
}

function evidenceRefs(payload = {}) {
  return Array.isArray(payload.evidenceRefs)
    ? [...new Set(payload.evidenceRefs.map(clean).filter(Boolean))]
    : [];
}

function assertNoDirectIdentifiers(value, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoDirectIdentifiers(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (DIRECT_IDENTIFIER_KEYS.has(key.toLowerCase())) {
      throw new Error(`direct resident identifier is not allowed in model governance payload: ${path}.${key}`);
    }
    assertNoDirectIdentifiers(item, `${path}.${key}`);
  });
}

function canonicalModel(model = {}) {
  return {
    id: clean(model.id),
    version: Number(model.version),
    name: clean(model.name),
    algorithm: clean(model.algorithm),
    owner: clean(model.owner),
    status: clean(model.status),
    minSignals: Number(model.minSignals),
    minDistinctSources: Number(model.minDistinctSources),
    minDistinctRegions: Number(model.minDistinctRegions),
    reviewThreshold: Number(model.reviewThreshold)
  };
}

function modelDigest(model) {
  return sha256(stableStringify(canonicalModel(model)));
}

function modelById(modelId) {
  return PUBLIC_HEALTH_SURVEILLANCE_MODELS.find((item) => item.id === clean(modelId));
}

function signalSnapshot(signal = {}) {
  return {
    id: clean(signal.id),
    version: Number(signal.version),
    sourceId: clean(signal.sourceId),
    sourceRecordHash: clean(signal.sourceRecordHash),
    contentFingerprint: clean(signal.contentFingerprint),
    signalType: clean(signal.signalType),
    institutionId: clean(signal.institutionId),
    regionCode: clean(signal.regionCode),
    observedAt: clean(signal.observedAt),
    metrics: (Array.isArray(signal.metrics) ? signal.metrics : [])
      .map((metric) => ({
        metricCode: clean(metric.metricCode),
        value: Number(metric.value),
        unit: clean(metric.unit),
        baseline: metric.baseline === undefined || metric.baseline === null
          ? null
          : Number(metric.baseline)
      }))
      .sort((left, right) => left.metricCode.localeCompare(right.metricCode)),
    verification: {
      decision: clean(signal.verification?.decision),
      role: clean(signal.verification?.role),
      at: clean(signal.verification?.at),
      evidenceRefs: evidenceRefs(signal.verification),
      idempotencyKeyHash: clean(signal.verification?.idempotencyKeyHash),
      payloadFingerprint: clean(signal.verification?.payloadFingerprint)
    }
  };
}

function signalInputDigest(signals) {
  return sha256(stableStringify(signals
    .map(signalSnapshot)
    .sort((left, right) => left.id.localeCompare(right.id))));
}

function normalizedModelRunPayload(payload = {}) {
  return {
    expectedModelVersion: Number(payload.expectedModelVersion),
    signalIds: Array.isArray(payload.signalIds)
      ? [...new Set(payload.signalIds.map(clean).filter(Boolean))].sort()
      : [],
    windowStart: clean(payload.windowStart),
    windowEnd: clean(payload.windowEnd),
    evidenceRefs: evidenceRefs(payload)
  };
}

function modelRunPayloadFingerprint(payload = {}) {
  return sha256(stableStringify(normalizedModelRunPayload(payload)));
}

function relativeAnomaly(signal) {
  const ratios = (Array.isArray(signal.metrics) ? signal.metrics : [])
    .filter((metric) => Number.isFinite(Number(metric.value)) && Number.isFinite(Number(metric.baseline)))
    .map((metric) => Math.max(0, (Number(metric.value) - Number(metric.baseline)) / Math.max(Math.abs(Number(metric.baseline)), 1)));
  return ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 0;
}

function round(value) {
  return Number(Number(value).toFixed(6));
}

function scoreModel(model, signals) {
  const anomalyValues = signals.map(relativeAnomaly);
  const averageAnomaly = anomalyValues.length
    ? anomalyValues.reduce((sum, value) => sum + value, 0) / anomalyValues.length
    : 0;
  const sourceCount = new Set(signals.map((item) => clean(item.sourceId))).size;
  const regionCounts = signals.reduce((result, item) => {
    const region = clean(item.regionCode);
    result.set(region, (result.get(region) || 0) + 1);
    return result;
  }, new Map());
  const regionCount = regionCounts.size;
  const regionConcentration = signals.length
    ? Math.max(...regionCounts.values()) / signals.length
    : 0;
  let score = Math.min(1, averageAnomaly / 3);
  if (model.algorithm === "cross-source-concordance-v1") {
    score *= Math.min(1, sourceCount / Math.max(model.minDistinctSources, 1));
  }
  if (model.algorithm === "spatiotemporal-cluster-v1") {
    score *= Math.min(1, signals.length / Math.max(model.minSignals + 1, 1)) * regionConcentration;
  }
  const normalizedScore = round(score);
  return {
    score: normalizedScore,
    riskBand: normalizedScore >= model.reviewThreshold
      ? "manual-review-recommended"
      : normalizedScore >= model.reviewThreshold / 2
        ? "watch"
        : "baseline",
    recommendation: normalizedScore >= model.reviewThreshold
      ? "Submit the shadow observation for human epidemiological review."
      : "Retain the shadow observation for trend and drift monitoring.",
    explainability: {
      signals: signals.length,
      distinctSources: sourceCount,
      distinctRegions: regionCount,
      averageRelativeBaselineUplift: round(averageAnomaly),
      regionConcentration: round(regionConcentration)
    },
    modelAdviceOnly: true,
    humanDecisionRequired: true,
    alertCreated: false
  };
}

function assertModelInputs(data, model, payload) {
  const normalized = normalizedModelRunPayload(payload);
  const windowStart = safeDate(normalized.windowStart, "model run windowStart");
  const windowEnd = safeDate(normalized.windowEnd, "model run windowEnd");
  if (new Date(windowEnd).getTime() <= new Date(windowStart).getTime()) {
    throw new Error("model run windowEnd must be after windowStart");
  }
  if (normalized.expectedModelVersion !== model.version) {
    throw new Error(`public health surveillance model version conflict: expected ${normalized.expectedModelVersion}, current ${model.version}`);
  }
  if (!normalized.signalIds.length) throw new Error("signalIds are required for a shadow model run");
  if (!normalized.evidenceRefs.length) throw new Error("evidenceRefs are required for a shadow model run");
  const signals = Array.isArray(data.publicHealthSurveillanceSignals)
    ? data.publicHealthSurveillanceSignals
    : [];
  const selected = normalized.signalIds.map((id) => signals.find((item) => clean(item.id) === id));
  if (selected.some((item) => !item)) throw new Error("shadow model input contains an unknown public health signal");
  const foundation = buildPublicHealthDataFoundation({ data });
  const findingSignalIds = new Set(foundation.qualityFindings.map((item) => clean(item.signalId)).filter(Boolean));
  selected.forEach((signal) => {
    if (findingSignalIds.has(clean(signal.id))) throw new Error("shadow model input signal integrity is invalid");
    if (clean(signal.verification?.decision) !== "confirmed"
      || !["cdc-surveillance", "commission"].includes(clean(signal.verification?.role))
      || !evidenceRefs(signal.verification).length
      || !/^[a-f0-9]{64}$/.test(clean(signal.verification?.idempotencyKeyHash))
      || !/^[a-f0-9]{64}$/.test(clean(signal.verification?.payloadFingerprint))) {
      throw new Error("shadow model inputs must be human-verified public health signals");
    }
    const observedAt = new Date(safeDate(signal.observedAt, "signal observedAt")).getTime();
    if (observedAt < new Date(windowStart).getTime() || observedAt > new Date(windowEnd).getTime()) {
      throw new Error("shadow model input signal is outside the declared evaluation window");
    }
  });
  const distinctSources = new Set(selected.map((item) => clean(item.sourceId))).size;
  const distinctRegions = new Set(selected.map((item) => clean(item.regionCode))).size;
  if (selected.length < model.minSignals) throw new Error(`shadow model requires at least ${model.minSignals} signals`);
  if (distinctSources < model.minDistinctSources) {
    throw new Error(`shadow model requires at least ${model.minDistinctSources} distinct sources`);
  }
  if (distinctRegions < model.minDistinctRegions) {
    throw new Error(`shadow model requires at least ${model.minDistinctRegions} distinct regions`);
  }
  return { normalized, selected, windowStart, windowEnd };
}

function modelRunIntegrityPayload(run = {}) {
  return {
    id: clean(run.id),
    modelId: clean(run.modelId),
    modelVersion: Number(run.modelVersion),
    modelDigest: clean(run.modelDigest),
    status: clean(run.status),
    signalIds: Array.isArray(run.signalIds) ? run.signalIds.map(clean).sort() : [],
    inputDigest: clean(run.inputDigest),
    windowStart: clean(run.windowStart),
    windowEnd: clean(run.windowEnd),
    output: run.output,
    evidenceRefs: evidenceRefs(run),
    executedBy: clean(run.executedBy),
    executedByRole: clean(run.executedByRole),
    executedAt: clean(run.executedAt),
    idempotencyKeyHash: clean(run.idempotencyKeyHash),
    payloadFingerprint: clean(run.payloadFingerprint)
  };
}

function runPublicHealthSurveillanceModelToState(data = {}, modelId, payload = {}, user = {}) {
  const role = authorize(MODEL_RUN_ROLES, user, "run a public health surveillance shadow model");
  assertNoDirectIdentifiers(payload);
  const model = modelById(modelId);
  if (!model) throw new Error("unknown public health surveillance model");
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error("idempotencyKey is required for a shadow model run");
  const idempotencyKeyHash = sha256(idempotencyKey);
  const payloadFingerprint = modelRunPayloadFingerprint(payload);
  const runs = Array.isArray(data.publicHealthSurveillanceModelRuns)
    ? clone(data.publicHealthSurveillanceModelRuns)
    : [];
  const replay = runs.find((item) => item.modelId === model.id && item.idempotencyKeyHash === idempotencyKeyHash);
  if (replay) {
    const auditEntries = Array.isArray(data.publicHealthSurveillanceModelAudit)
      ? data.publicHealthSurveillanceModelAudit
      : [];
    const integrityCode = validateModelRun(replay, data, model, auditEntries);
    if (integrityCode) throw new Error(`public health model run integrity invalid: ${integrityCode}`);
    if (clean(replay.payloadFingerprint) !== payloadFingerprint) {
      throw new Error("public health model run idempotency key payload conflict");
    }
    return { ok: true, idempotent: true, run: replay, nextData: data, productionReady: false };
  }
  const { normalized, selected, windowStart, windowEnd } = assertModelInputs(data, model, payload);
  const executedAt = safeDate(payload.at || new Date().toISOString(), "model run at");
  const output = scoreModel(model, selected);
  const run = {
    id: `ph-model-run-${sha256(`${model.id}\n${idempotencyKeyHash}`).slice(0, 24)}`,
    modelId: model.id,
    modelVersion: model.version,
    modelDigest: modelDigest(model),
    status: "shadow-observation",
    signalIds: normalized.signalIds,
    inputDigest: signalInputDigest(selected),
    windowStart,
    windowEnd,
    output,
    evidenceRefs: normalized.evidenceRefs,
    executedBy: actorName(user),
    executedByRole: role,
    executedAt,
    idempotencyKeyHash,
    payloadFingerprint,
    integrityDigest: "",
    productionReady: false
  };
  run.integrityDigest = sha256(stableStringify(modelRunIntegrityPayload(run)));
  const audit = {
    id: `${run.id}:created`,
    modelRunId: run.id,
    action: "run-shadow-model",
    actor: run.executedBy,
    role,
    at: executedAt,
    integrityDigest: run.integrityDigest,
    evidenceCount: run.evidenceRefs.length
  };
  const nextData = {
    ...data,
    publicHealthSurveillanceModelRuns: [...runs, run],
    publicHealthSurveillanceModelAudit: [
      ...(Array.isArray(data.publicHealthSurveillanceModelAudit)
        ? clone(data.publicHealthSurveillanceModelAudit)
        : []),
      audit
    ]
  };
  return {
    ok: true,
    idempotent: false,
    run: clone(run),
    audit,
    nextData,
    productionReady: false
  };
}

function normalizedValidationSubmission(record = {}) {
  return {
    modelId: clean(record.modelId),
    modelVersion: Number(record.modelVersion),
    modelDigest: clean(record.modelDigest),
    sampleWindowStart: clean(record.sampleWindowStart),
    sampleWindowEnd: clean(record.sampleWindowEnd),
    performance: {
      sampleSize: Number(record.performance?.sampleSize),
      sensitivity: Number(record.performance?.sensitivity),
      positivePredictiveValue: Number(record.performance?.positivePredictiveValue),
      falseNegativeRate: Number(record.performance?.falseNegativeRate)
    },
    note: clean(record.note),
    evidenceRefs: evidenceRefs(record),
    submittedBy: clean(record.submittedBy),
    submittedByRole: clean(record.submittedByRole)
  };
}

function performanceMeetsShadowGate(performance = {}) {
  return Number(performance.sampleSize) >= 30
    && Number(performance.sensitivity) >= 0.8
    && Number(performance.positivePredictiveValue) >= 0.5
    && Number(performance.falseNegativeRate) <= 0.1;
}

function submitPublicHealthSurveillanceModelValidationToState(data = {}, modelId, payload = {}, user = {}) {
  const role = authorize(MODEL_VALIDATION_SUBMIT_ROLES, user, "submit public health model validation");
  assertNoDirectIdentifiers(payload);
  const model = modelById(modelId);
  if (!model) throw new Error("unknown public health surveillance model");
  const idempotencyKey = clean(payload.idempotencyKey);
  const refs = evidenceRefs(payload);
  const sampleWindowStart = safeDate(payload.sampleWindowStart, "model validation sampleWindowStart");
  const sampleWindowEnd = safeDate(payload.sampleWindowEnd, "model validation sampleWindowEnd");
  if (new Date(sampleWindowEnd).getTime() <= new Date(sampleWindowStart).getTime()) {
    throw new Error("model validation sampleWindowEnd must be after sampleWindowStart");
  }
  const performance = {
    sampleSize: Number(payload.sampleSize),
    sensitivity: Number(payload.sensitivity),
    positivePredictiveValue: Number(payload.positivePredictiveValue),
    falseNegativeRate: Number(payload.falseNegativeRate)
  };
  if (!idempotencyKey || !clean(payload.note) || !refs.length
    || Number(payload.expectedModelVersion) !== model.version
    || !Number.isInteger(performance.sampleSize) || performance.sampleSize <= 0
    || !["sensitivity", "positivePredictiveValue", "falseNegativeRate"]
      .every((key) => Number.isFinite(performance[key]) && performance[key] >= 0 && performance[key] <= 1)) {
    throw new Error("model version, sample window, performance metrics, note, evidenceRefs and idempotencyKey are required");
  }
  const idempotencyKeyHash = sha256(idempotencyKey);
  const validations = Array.isArray(data.publicHealthSurveillanceModelValidations)
    ? clone(data.publicHealthSurveillanceModelValidations)
    : [];
  const submittedAt = safeDate(payload.at || new Date().toISOString(), "model validation submittedAt");
  const draft = {
    id: `ph-model-validation-${sha256(`${model.id}\n${idempotencyKeyHash}`).slice(0, 24)}`,
    version: 1,
    modelId: model.id,
    modelVersion: model.version,
    modelDigest: modelDigest(model),
    status: "submitted",
    sampleWindowStart,
    sampleWindowEnd,
    performance,
    performanceGatePassed: performanceMeetsShadowGate(performance),
    note: clean(payload.note),
    evidenceRefs: refs,
    submittedBy: actorName(user),
    submittedByRole: role,
    submittedAt,
    idempotencyKeyHash,
    payloadFingerprint: "",
    review: null,
    timeline: []
  };
  draft.payloadFingerprint = sha256(stableStringify(normalizedValidationSubmission(draft)));
  const replay = validations.find((item) => item.modelId === model.id && item.idempotencyKeyHash === idempotencyKeyHash);
  if (replay) {
    const integrityCode = validateModelValidation(replay, model);
    if (integrityCode) throw new Error(`public health model validation integrity invalid: ${integrityCode}`);
    if (clean(replay.payloadFingerprint) !== draft.payloadFingerprint) {
      throw new Error("public health model validation idempotency key payload conflict");
    }
    return { ok: true, idempotent: true, validation: replay, nextData: data, productionReady: false };
  }
  draft.timeline.push({
    action: "submit-model-validation",
    from: "draft",
    to: "submitted",
    actor: draft.submittedBy,
    role,
    at: submittedAt,
    idempotencyKeyHash,
    payloadFingerprint: draft.payloadFingerprint
  });
  const nextData = {
    ...data,
    publicHealthSurveillanceModelValidations: [...validations, draft]
  };
  return { ok: true, idempotent: false, validation: clone(draft), nextData, productionReady: false };
}

function reviewFingerprint(payload = {}) {
  return sha256(stableStringify({
    decision: clean(payload.decision).toLowerCase(),
    note: clean(payload.note),
    evidenceRefs: evidenceRefs(payload)
  }));
}

function reviewPublicHealthSurveillanceModelValidationToState(data = {}, validationId, payload = {}, user = {}) {
  const role = authorize(MODEL_VALIDATION_REVIEW_ROLES, user, "review public health model validation");
  assertNoDirectIdentifiers(payload);
  const validations = Array.isArray(data.publicHealthSurveillanceModelValidations)
    ? clone(data.publicHealthSurveillanceModelValidations)
    : [];
  const index = validations.findIndex((item) => clean(item.id) === clean(validationId));
  if (index < 0) throw new Error("unknown public health model validation");
  const validation = validations[index];
  const validationIntegrityCode = validateModelValidation(validation, modelById(validation.modelId));
  if (validationIntegrityCode) {
    throw new Error(`public health model validation integrity invalid: ${validationIntegrityCode}`);
  }
  const decision = clean(payload.decision).toLowerCase();
  const idempotencyKey = clean(payload.idempotencyKey);
  const refs = evidenceRefs(payload);
  if (!["approved", "rejected"].includes(decision)
    || !idempotencyKey
    || !clean(payload.note)
    || !refs.length) {
    throw new Error("approved/rejected decision, note, evidenceRefs and idempotencyKey are required");
  }
  const idempotencyKeyHash = sha256(idempotencyKey);
  const fingerprint = reviewFingerprint(payload);
  const duplicate = validation.review?.idempotencyKeyHash === idempotencyKeyHash;
  if (duplicate) {
    if (clean(validation.review.payloadFingerprint) !== fingerprint) {
      throw new Error("public health model validation review idempotency key payload conflict");
    }
    return { ok: true, idempotent: true, validation, nextData: data, productionReady: false };
  }
  if (clean(validation.status) !== "submitted") throw new Error(`model validation review is not allowed from ${clean(validation.status)}`);
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(validation.version)) {
    throw new Error(`public health model validation version conflict: expected ${payload.expectedVersion}, current ${validation.version}`);
  }
  if (actorName(user) === clean(validation.submittedBy)) {
    throw new Error("model validation requires an independent reviewer");
  }
  const reviewedAt = safeDate(payload.at || new Date().toISOString(), "model validation reviewedAt");
  const status = decision === "approved" && validation.performanceGatePassed === true
    ? "validated-shadow"
    : "remediation-required";
  const next = {
    ...validation,
    version: Number(validation.version) + 1,
    status,
    review: {
      decision,
      note: clean(payload.note),
      evidenceRefs: refs,
      reviewedBy: actorName(user),
      reviewedByRole: role,
      reviewedAt,
      idempotencyKeyHash,
      payloadFingerprint: fingerprint
    },
    timeline: [
      ...validation.timeline,
      {
        action: "review-model-validation",
        from: "submitted",
        to: status,
        decision,
        actor: actorName(user),
        role,
        at: reviewedAt,
        idempotencyKeyHash,
        payloadFingerprint: fingerprint
      }
    ]
  };
  validations[index] = next;
  return {
    ok: true,
    idempotent: false,
    validation: clone(next),
    nextData: { ...data, publicHealthSurveillanceModelValidations: validations },
    productionReady: false
  };
}

function validateModelRun(run, data, model, auditEntries) {
  if (!model
    || Number(run.modelVersion) !== model.version
    || clean(run.modelDigest) !== modelDigest(model)
    || clean(run.status) !== "shadow-observation"
    || run.output?.modelAdviceOnly !== true
    || run.output?.humanDecisionRequired !== true
    || run.output?.alertCreated !== false
    || !MODEL_RUN_ROLES.has(clean(run.executedByRole))
    || !isValidDateTime(run.executedAt)
    || !/^[a-f0-9]{64}$/.test(clean(run.idempotencyKeyHash))
    || !/^[a-f0-9]{64}$/.test(clean(run.payloadFingerprint))) {
    return "model-run-contract-invalid";
  }
  const signals = Array.isArray(data.publicHealthSurveillanceSignals)
    ? data.publicHealthSurveillanceSignals
    : [];
  const selected = (Array.isArray(run.signalIds) ? run.signalIds : [])
    .map((id) => signals.find((item) => clean(item.id) === clean(id)));
  if (!selected.length || selected.some((item) => !item)) return "model-run-input-missing";
  try {
    assertModelInputs(data, model, {
      expectedModelVersion: run.modelVersion,
      signalIds: run.signalIds,
      windowStart: run.windowStart,
      windowEnd: run.windowEnd,
      evidenceRefs: run.evidenceRefs
    });
  } catch {
    return "model-run-input-contract-invalid";
  }
  if (clean(run.inputDigest) !== signalInputDigest(selected)) return "model-run-input-digest-invalid";
  if (stableStringify(run.output) !== stableStringify(scoreModel(model, selected))) return "model-run-output-invalid";
  const integrityDigest = sha256(stableStringify(modelRunIntegrityPayload(run)));
  if (clean(run.integrityDigest) !== integrityDigest) return "model-run-integrity-digest-invalid";
  const matchingAudit = auditEntries.filter((item) => item.modelRunId === run.id
    && item.action === "run-shadow-model"
    && item.integrityDigest === run.integrityDigest
    && item.actor === run.executedBy
    && item.role === run.executedByRole
    && item.at === run.executedAt);
  if (matchingAudit.length !== 1) {
    return matchingAudit.length ? "model-run-audit-duplicated" : "model-run-audit-missing";
  }
  return "";
}

function validateModelValidation(validation, model) {
  const performance = validation.performance || {};
  const performanceValid = Number.isInteger(Number(performance.sampleSize))
    && Number(performance.sampleSize) > 0
    && ["sensitivity", "positivePredictiveValue", "falseNegativeRate"]
      .every((key) => Number.isFinite(Number(performance[key]))
        && Number(performance[key]) >= 0
        && Number(performance[key]) <= 1);
  const timeline = Array.isArray(validation.timeline) ? validation.timeline : [];
  const submission = timeline[0] || {};
  if (!model
    || Number(validation.modelVersion) !== model.version
    || clean(validation.modelDigest) !== modelDigest(model)
    || clean(validation.submittedByRole) !== "cdc-surveillance"
    || !clean(validation.submittedBy)
    || !clean(validation.note)
    || !evidenceRefs(validation).length
    || !/^[a-f0-9]{64}$/.test(clean(validation.idempotencyKeyHash))
    || clean(validation.payloadFingerprint) !== sha256(stableStringify(normalizedValidationSubmission(validation)))
    || !performanceValid
    || validation.performanceGatePassed !== performanceMeetsShadowGate(validation.performance)
    || Number(validation.version) !== timeline.length
    || !isValidDateTime(validation.sampleWindowStart)
    || !isValidDateTime(validation.sampleWindowEnd)
    || !isValidDateTime(validation.submittedAt)
    || new Date(validation.sampleWindowEnd).getTime() <= new Date(validation.sampleWindowStart).getTime()
    || clean(submission.action) !== "submit-model-validation"
    || clean(submission.from) !== "draft"
    || clean(submission.to) !== "submitted"
    || clean(submission.actor) !== clean(validation.submittedBy)
    || clean(submission.role) !== clean(validation.submittedByRole)
    || clean(submission.at) !== clean(validation.submittedAt)
    || clean(submission.idempotencyKeyHash) !== clean(validation.idempotencyKeyHash)
    || clean(submission.payloadFingerprint) !== clean(validation.payloadFingerprint)) {
    return "model-validation-integrity-invalid";
  }
  if (validation.status === "submitted") {
    if (validation.review !== null || validation.version !== 1) return "model-validation-state-invalid";
    return "";
  }
  if (!["validated-shadow", "remediation-required"].includes(validation.status)
    || !validation.review
    || clean(validation.review.reviewedBy) === clean(validation.submittedBy)
    || clean(validation.review.reviewedByRole) !== "commission"
    || !clean(validation.review.note)
    || !evidenceRefs(validation.review).length
    || !/^[a-f0-9]{64}$/.test(clean(validation.review.idempotencyKeyHash))
    || !isValidDateTime(validation.review.reviewedAt)
    || clean(validation.review.payloadFingerprint) !== reviewFingerprint(validation.review)
    || clean(timeline[1]?.action) !== "review-model-validation"
    || clean(timeline[1]?.from) !== "submitted"
    || clean(timeline[1]?.to) !== clean(validation.status)
    || clean(timeline[1]?.decision) !== clean(validation.review.decision)
    || clean(timeline[1]?.actor) !== clean(validation.review.reviewedBy)
    || clean(timeline[1]?.role) !== clean(validation.review.reviewedByRole)
    || clean(timeline[1]?.at) !== clean(validation.review.reviewedAt)
    || clean(timeline[1]?.idempotencyKeyHash) !== clean(validation.review.idempotencyKeyHash)
    || clean(timeline[1]?.payloadFingerprint) !== clean(validation.review.payloadFingerprint)) {
    return "model-validation-review-invalid";
  }
  const expectedStatus = validation.review.decision === "approved" && validation.performanceGatePassed
    ? "validated-shadow"
    : "remediation-required";
  return validation.status === expectedStatus ? "" : "model-validation-outcome-invalid";
}

function buildPublicHealthSurveillanceModelGovernance({ data = {}, at = new Date().toISOString() } = {}) {
  const observedAt = safeDate(at, "model governance at");
  const models = PUBLIC_HEALTH_SURVEILLANCE_MODELS.map((item) => clone(item));
  const findings = [];
  const materialized = Array.isArray(data.publicHealthSurveillanceModels)
    ? data.publicHealthSurveillanceModels
    : [];
  if (materialized.length) {
    const trusted = new Map(models.map((item) => [`${item.id}:${item.version}`, modelDigest(item)]));
    materialized.forEach((item) => {
      if (trusted.get(`${clean(item.id)}:${Number(item.version)}`) !== modelDigest(item)) {
        findings.push({
          modelId: clean(item.id),
          code: "ungoverned-model-materialization"
        });
      }
    });
  }
  const runs = Array.isArray(data.publicHealthSurveillanceModelRuns)
    ? data.publicHealthSurveillanceModelRuns
    : [];
  const auditEntries = Array.isArray(data.publicHealthSurveillanceModelAudit)
    ? data.publicHealthSurveillanceModelAudit
    : [];
  const runIdCounts = runs.reduce((result, run) => {
    result.set(clean(run.id), (result.get(clean(run.id)) || 0) + 1);
    return result;
  }, new Map());
  const runIdempotencyCounts = runs.reduce((result, run) => {
    const key = `${clean(run.modelId)}:${clean(run.idempotencyKeyHash)}`;
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map());
  runs.forEach((run) => {
    if (runIdCounts.get(clean(run.id)) > 1
      || runIdempotencyCounts.get(`${clean(run.modelId)}:${clean(run.idempotencyKeyHash)}`) > 1) {
      findings.push({
        modelId: clean(run.modelId),
        modelRunId: clean(run.id),
        code: "model-run-duplicate"
      });
      return;
    }
    const code = validateModelRun(run, data, modelById(run.modelId), auditEntries);
    if (code) findings.push({ modelId: clean(run.modelId), modelRunId: clean(run.id), code });
  });
  auditEntries.forEach((audit) => {
    if (!runs.some((run) => clean(run.id) === clean(audit.modelRunId))) {
      findings.push({
        modelRunId: clean(audit.modelRunId),
        auditId: clean(audit.id),
        code: "model-run-audit-orphan"
      });
    }
  });
  const validations = Array.isArray(data.publicHealthSurveillanceModelValidations)
    ? data.publicHealthSurveillanceModelValidations
    : [];
  const validationIdCounts = validations.reduce((result, validation) => {
    result.set(clean(validation.id), (result.get(clean(validation.id)) || 0) + 1);
    return result;
  }, new Map());
  const validationIdempotencyCounts = validations.reduce((result, validation) => {
    const key = `${clean(validation.modelId)}:${clean(validation.idempotencyKeyHash)}`;
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map());
  validations.forEach((validation) => {
    if (validationIdCounts.get(clean(validation.id)) > 1
      || validationIdempotencyCounts.get(`${clean(validation.modelId)}:${clean(validation.idempotencyKeyHash)}`) > 1) {
      findings.push({
        modelId: clean(validation.modelId),
        validationId: clean(validation.id),
        code: "model-validation-duplicate"
      });
      return;
    }
    const code = validateModelValidation(validation, modelById(validation.modelId));
    if (code) {
      findings.push({ modelId: clean(validation.modelId), validationId: clean(validation.id), code });
      return;
    }
    const effectiveAt = clean(validation.review?.reviewedAt || validation.submittedAt);
    if (new Date(effectiveAt).getTime() > new Date(observedAt).getTime()) {
      findings.push({
        modelId: clean(validation.modelId),
        validationId: clean(validation.id),
        code: "model-validation-effective-in-future"
      });
    }
  });
  const validRunIds = new Set(runs
    .filter((run) => !findings.some((item) => item.modelRunId === run.id))
    .map((run) => run.id));
  const validValidationIds = new Set(validations
    .filter((validation) => !findings.some((item) => item.validationId === validation.id))
    .map((validation) => validation.id));
  const modelCards = models.map((model) => {
    const modelRuns = runs.filter((run) => run.modelId === model.id && validRunIds.has(run.id));
    const modelValidations = validations
      .filter((validation) => validation.modelId === model.id && validValidationIds.has(validation.id));
    const latestRun = [...modelRuns].sort((left, right) => clean(right.executedAt).localeCompare(clean(left.executedAt)))[0];
    const latestValidation = [...modelValidations]
      .sort((left, right) => clean(right.review?.reviewedAt || right.submittedAt)
        .localeCompare(clean(left.review?.reviewedAt || left.submittedAt)))[0];
    const latestValidationAt = clean(latestValidation?.review?.reviewedAt || latestValidation?.submittedAt);
    const validationAgeDays = latestValidationAt
      ? Math.max(0, Math.floor((new Date(observedAt).getTime() - new Date(latestValidationAt).getTime()) / 86400000))
      : null;
    const driftReviewDue = clean(latestValidation?.status) === "validated-shadow"
      && validationAgeDays > MODEL_VALIDATION_MAX_AGE_DAYS;
    return {
      ...canonicalModel(model),
      modelDigest: modelDigest(model),
      runs: modelRuns.length,
      latestRunAt: clean(latestRun?.executedAt),
      validationState: clean(latestValidation?.status || "not-submitted"),
      latestValidationAt,
      validationAgeDays,
      driftState: driftReviewDue
        ? "review-due"
        : clean(latestValidation?.status) === "validated-shadow"
          ? "within-window"
          : "not-validated",
      validatedForShadowUse: clean(latestValidation?.status) === "validated-shadow" && !driftReviewDue,
      productionReady: false
    };
  });
  return {
    generatedAt: observedAt,
    ok: findings.length === 0,
    functionalState: findings.length
      ? "surveillance-model-governance-integrity-blocked"
      : "surveillance-model-shadow-governance-runnable",
    formalGoLiveState: "blocked-until-production-data-model-validation-drift-window-and-human-approval",
    summary: {
      models: modelCards.length,
      shadowModels: modelCards.filter((item) => item.status === "shadow").length,
      validatedShadowModels: modelCards.filter((item) => item.validatedForShadowUse).length,
      modelRuns: validRunIds.size,
      manualReviewRecommendations: runs.filter((run) => validRunIds.has(run.id)
        && run.output?.riskBand === "manual-review-recommended").length,
      pendingValidations: validations.filter((item) => validValidationIds.has(item.id)
        && item.status === "submitted").length,
      remediationRequired: validations.filter((item) => validValidationIds.has(item.id)
        && item.status === "remediation-required").length,
      driftReviewsDue: modelCards.filter((item) => item.driftState === "review-due").length,
      findings: findings.length
    },
    models: modelCards,
    runs: runs.filter((run) => validRunIds.has(run.id)).map((run) => ({
      id: run.id,
      modelId: run.modelId,
      modelVersion: run.modelVersion,
      status: run.status,
      signalCount: run.signalIds.length,
      score: run.output.score,
      riskBand: run.output.riskBand,
      modelAdviceOnly: true,
      humanDecisionRequired: true,
      executedAt: run.executedAt,
      productionReady: false
    })),
    validations: validations.filter((item) => validValidationIds.has(item.id)).map((item) => ({
      id: item.id,
      modelId: item.modelId,
      modelVersion: item.modelVersion,
      version: item.version,
      status: item.status,
      performanceGatePassed: item.performanceGatePassed,
      submittedAt: item.submittedAt,
      reviewedAt: clean(item.review?.reviewedAt),
      productionReady: false
    })),
    findings,
    productionReady: false,
    blockers: [
      "Shadow model output cannot create, verify, publish or close a public health alert.",
      "Production use requires approved high-quality datasets, independent validation, sustained drift monitoring and human authorization."
    ]
  };
}

module.exports = {
  PUBLIC_HEALTH_SURVEILLANCE_MODELS,
  buildPublicHealthSurveillanceModelGovernance,
  modelDigest,
  performanceMeetsShadowGate,
  reviewPublicHealthSurveillanceModelValidationToState,
  runPublicHealthSurveillanceModelToState,
  submitPublicHealthSurveillanceModelValidationToState
};
