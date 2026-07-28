"use strict";

const crypto = require("node:crypto");

const PUBLIC_HEALTH_SIGNAL_TYPES = Object.freeze([
  "case-report",
  "clinical-syndrome",
  "laboratory-pathogen",
  "public-health-event",
  "immunization-aefi",
  "vector-environment",
  "department-collaboration",
  "social-sensing"
]);

const PUBLIC_HEALTH_DATA_SOURCES = Object.freeze([
  {
    id: "ph-source-case-report",
    name: "传染病病例报告",
    owner: "医疗机构公共卫生科",
    stewardRole: "medical-public-health",
    sourceType: "case-report",
    sharingScope: "medical-cdc",
    expectedRefreshMinutes: 5,
    sensitivity: "S3",
    allowedSignalTypes: ["case-report"],
    status: "registered"
  },
  {
    id: "ph-source-clinical-syndrome",
    name: "临床症候群监测",
    owner: "医疗机构发热门诊/急诊",
    stewardRole: "medical-public-health",
    sourceType: "clinical-syndrome",
    sharingScope: "medical-cdc",
    expectedRefreshMinutes: 15,
    sensitivity: "S3",
    allowedSignalTypes: ["clinical-syndrome"],
    status: "registered"
  },
  {
    id: "ph-source-laboratory-pathogen",
    name: "实验室病原监测",
    owner: "区域检验与疾控实验室",
    stewardRole: "laboratory",
    sourceType: "laboratory-pathogen",
    sharingScope: "medical-cdc",
    expectedRefreshMinutes: 15,
    sensitivity: "S3",
    allowedSignalTypes: ["laboratory-pathogen"],
    status: "registered"
  },
  {
    id: "ph-source-public-health-event",
    name: "突发公共卫生事件",
    owner: "疾控应急管理部门",
    stewardRole: "cdc-surveillance",
    sourceType: "public-health-event",
    sharingScope: "cdc-command",
    expectedRefreshMinutes: 5,
    sensitivity: "S3",
    allowedSignalTypes: ["public-health-event"],
    status: "registered"
  },
  {
    id: "ph-source-immunization-aefi",
    name: "免疫接种与AEFI监测",
    owner: "疾控免疫规划部门",
    stewardRole: "immunization",
    sourceType: "immunization-aefi",
    sharingScope: "medical-cdc",
    expectedRefreshMinutes: 60,
    sensitivity: "S3",
    allowedSignalTypes: ["immunization-aefi"],
    status: "registered"
  },
  {
    id: "ph-source-vector-environment",
    name: "病媒生物与环境监测",
    owner: "疾控环境与病媒部门",
    stewardRole: "cdc-surveillance",
    sourceType: "vector-environment",
    sharingScope: "cdc-department",
    expectedRefreshMinutes: 1440,
    sensitivity: "S2",
    allowedSignalTypes: ["vector-environment"],
    status: "registered"
  },
  {
    id: "ph-source-department-collaboration",
    name: "跨部门协同监测",
    owner: "卫健联防联控专班",
    stewardRole: "commission",
    sourceType: "department-collaboration",
    sharingScope: "cross-department",
    expectedRefreshMinutes: 60,
    sensitivity: "S2",
    allowedSignalTypes: ["department-collaboration"],
    status: "registered"
  },
  {
    id: "ph-source-social-sensing",
    name: "社会感知与公众线索",
    owner: "疾控健康教育与风险沟通部门",
    stewardRole: "cdc-surveillance",
    sourceType: "social-sensing",
    sharingScope: "cdc-internal",
    expectedRefreshMinutes: 60,
    sensitivity: "S2",
    allowedSignalTypes: ["social-sensing"],
    status: "registered"
  }
]);

const PUBLIC_HEALTH_DATA_CATALOG = Object.freeze([
  { id: "ph-catalog-source", name: "数据源登记", collection: "publicHealthDataSources", owner: "平台数据治理组", retentionClass: "configuration" },
  { id: "ph-catalog-signal", name: "监测信号", collection: "publicHealthSurveillanceSignals", owner: "疾控监测部门", retentionClass: "business-audit" },
  { id: "ph-catalog-alert", name: "风险预警", collection: "publicHealthSurveillanceAlerts", owner: "疾控监测部门", retentionClass: "business-audit" },
  { id: "ph-catalog-assessment", name: "风险研判", collection: "publicHealthRiskAssessments", owner: "疾控研判专家组", retentionClass: "business-audit" },
  { id: "ph-catalog-response-task", name: "调查处置任务", collection: "publicHealthResponseTasks", owner: "疾控应急管理部门", retentionClass: "business-audit" },
  { id: "ph-catalog-collaboration", name: "医防协同任务", collection: "publicHealthMedicalPreventionTasks", owner: "卫健医防融合专班", retentionClass: "business-audit" },
  { id: "ph-catalog-lineage", name: "数据血缘审计", collection: "publicHealthDataLineageAudit", owner: "平台安全与数据治理组", retentionClass: "security-audit" }
]);

const RESTRICTED_SIGNAL_KEYS = new Set([
  "residentId",
  "patientName",
  "idCard",
  "identityNumber",
  "phone",
  "address",
  "medicalRecordNumber"
]);

const INGEST_ROLES = new Set([
  "system",
  "commission",
  "cdc-surveillance",
  "medical-public-health",
  "laboratory",
  "immunization",
  "primary-care-public-health"
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

function dateTime(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid date-time`);
  return parsed.toISOString();
}

function findRestrictedKey(value, path = "") {
  if (!value || typeof value !== "object") return "";
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (RESTRICTED_SIGNAL_KEYS.has(key)) return nextPath;
    const nestedMatch = findRestrictedKey(nested, nextPath);
    if (nestedMatch) return nestedMatch;
  }
  return "";
}

function sourceRegistry(data = {}) {
  const persisted = Array.isArray(data.publicHealthDataSources) ? data.publicHealthDataSources : [];
  const persistedById = new Map(persisted.map((item) => [clean(item.id), item]));
  return PUBLIC_HEALTH_DATA_SOURCES.map((definition) => {
    const current = persistedById.get(definition.id) || {};
    return {
      ...clone(definition),
      status: ["registered", "paused", "retired"].includes(clean(current.status))
        ? clean(current.status)
        : definition.status,
      lastObservedAt: clean(current.lastObservedAt)
    };
  });
}

function normalizeMetrics(metrics) {
  if (!Array.isArray(metrics) || !metrics.length) {
    throw new Error("at least one public health signal metric is required");
  }
  const metricCodes = new Set();
  return metrics.map((item) => {
    const metricCode = clean(item?.metricCode);
    const value = Number(item?.value);
    if (!/^[a-z][a-z0-9._-]{2,63}$/i.test(metricCode) || !Number.isFinite(value)) {
      throw new Error("public health signal metricCode and numeric value are required");
    }
    if (metricCodes.has(metricCode)) throw new Error("public health signal metricCode is duplicated");
    metricCodes.add(metricCode);
    return {
      metricCode,
      value,
      unit: clean(item.unit || "count"),
      baseline: Number.isFinite(Number(item.baseline)) ? Number(item.baseline) : null
    };
  });
}

function signalContentFingerprint(signal = {}) {
  return sha256(stableStringify({
    sourceId: clean(signal.sourceId),
    signalType: clean(signal.signalType),
    institutionId: clean(signal.institutionId),
    regionCode: clean(signal.regionCode),
    observedAt: clean(signal.observedAt),
    pathogenCode: clean(signal.pathogenCode),
    syndromeCode: clean(signal.syndromeCode),
    eventCode: clean(signal.eventCode),
    metrics: Array.isArray(signal.metrics) ? signal.metrics : [],
    evidenceRefs: Array.isArray(signal.evidenceRefs) ? signal.evidenceRefs : []
  }));
}

function normalizePublicHealthSurveillanceSignal(payload = {}, options = {}) {
  const restrictedKey = findRestrictedKey(payload);
  if (restrictedKey) {
    throw new Error(`public health surveillance signal must not contain direct resident identifier: ${restrictedKey}`);
  }
  const sourceId = clean(payload.sourceId);
  const source = (options.sources || PUBLIC_HEALTH_DATA_SOURCES).find((item) => item.id === sourceId);
  if (!source || source.status !== "registered") {
    throw new Error("public health surveillance signal source is not registered and active");
  }
  const signalType = clean(payload.signalType).toLowerCase();
  if (!PUBLIC_HEALTH_SIGNAL_TYPES.includes(signalType) || !source.allowedSignalTypes.includes(signalType)) {
    throw new Error("public health surveillance signal type is not allowed for its source");
  }
  const externalSignalId = clean(payload.externalSignalId);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(externalSignalId) || !idempotencyKey) {
    throw new Error("externalSignalId and idempotencyKey are required for public health signal intake");
  }
  const institutionId = clean(payload.institutionId);
  const regionCode = clean(payload.regionCode);
  if (!/^[a-z0-9][a-z0-9._:-]{2,63}$/i.test(institutionId) || !/^[a-z0-9][a-z0-9._:-]{2,31}$/i.test(regionCode)) {
    throw new Error("institutionId and regionCode are required for public health signal intake");
  }
  const evidenceRefs = Array.isArray(payload.evidenceRefs)
    ? [...new Set(payload.evidenceRefs.map(clean).filter(Boolean))]
    : [];
  if (!evidenceRefs.length) throw new Error("public health surveillance signal evidenceRefs are required");
  const externalSignalKeyHash = sha256(`${sourceId}\n${externalSignalId}`);
  const signal = {
    id: `ph-signal-${externalSignalKeyHash.slice(0, 24)}`,
    version: 1,
    sourceId,
    signalType,
    externalSignalKeyHash,
    institutionId,
    regionCode,
    observedAt: dateTime(payload.observedAt, "public health signal observedAt"),
    receivedAt: dateTime(payload.receivedAt || options.at || new Date().toISOString(), "public health signal receivedAt"),
    pathogenCode: clean(payload.pathogenCode),
    syndromeCode: clean(payload.syndromeCode),
    eventCode: clean(payload.eventCode),
    metrics: normalizeMetrics(payload.metrics),
    evidenceRefs,
    qualityStatus: "verified",
    workflowState: "received",
    verification: null,
    idempotencyKeyHash: sha256(idempotencyKey),
    productionReady: false
  };
  signal.contentFingerprint = signalContentFingerprint(signal);
  return signal;
}

function validatePersistedSignal(signal, registeredSourceIds) {
  const findings = [];
  const workflowState = clean(signal?.workflowState);
  const verification = signal?.verification;
  const verifiedStates = new Set(["human-verified", "alert-created", "evaluated-no-alert"]);
  if (!registeredSourceIds.has(clean(signal?.sourceId))) findings.push("unregistered-source");
  if (!PUBLIC_HEALTH_SIGNAL_TYPES.includes(clean(signal?.signalType))) findings.push("invalid-signal-type");
  if (!/^[a-f0-9]{64}$/.test(clean(signal?.externalSignalKeyHash))) findings.push("invalid-source-record-hash");
  if (clean(signal?.id) !== `ph-signal-${clean(signal?.externalSignalKeyHash).slice(0, 24)}`) findings.push("signal-id-binding-invalid");
  if (!/^[a-f0-9]{64}$/.test(clean(signal?.idempotencyKeyHash))) findings.push("invalid-idempotency-key-hash");
  if (clean(signal?.contentFingerprint) !== signalContentFingerprint(signal)) findings.push("signal-content-fingerprint-invalid");
  if (!Number.isFinite(new Date(signal?.observedAt).getTime())) findings.push("invalid-observed-at");
  if (!Array.isArray(signal?.metrics) || !signal.metrics.length) findings.push("missing-metrics");
  if (!Array.isArray(signal?.evidenceRefs) || !signal.evidenceRefs.length) findings.push("missing-evidence");
  if (!["received", "human-verified", "dismissed", "alert-created", "evaluated-no-alert"].includes(workflowState)) {
    findings.push("invalid-workflow-state");
  }
  if (workflowState === "received" && verification) findings.push("unexpected-human-verification");
  if (workflowState !== "received") {
    const expectedDecision = verifiedStates.has(workflowState) ? "confirmed" : "dismissed";
    if (clean(verification?.decision) !== expectedDecision
      || !["cdc-surveillance", "commission"].includes(clean(verification?.role))
      || !clean(verification?.verifiedBy)
      || !Number.isFinite(new Date(verification?.at).getTime())
      || !clean(verification?.note)
      || !Array.isArray(verification?.evidenceRefs)
      || !verification.evidenceRefs.length
      || !/^[a-f0-9]{64}$/.test(clean(verification?.idempotencyKeyHash))
      || !/^[a-f0-9]{64}$/.test(clean(verification?.payloadFingerprint))) {
      findings.push("human-verification-integrity-invalid");
    }
  }
  if (findRestrictedKey(signal)) findings.push("direct-identifier-present");
  return [...new Set(findings)];
}

function buildPublicHealthDataFoundation({ data = {} } = {}) {
  const sources = sourceRegistry(data);
  const signals = Array.isArray(data.publicHealthSurveillanceSignals)
    ? clone(data.publicHealthSurveillanceSignals)
    : [];
  const registeredSourceIds = new Set(sources.filter((item) => item.status === "registered").map((item) => item.id));
  const qualityFindings = signals.flatMap((signal) => validatePersistedSignal(signal, registeredSourceIds)
    .map((code) => ({ signalId: clean(signal.id), sourceId: clean(signal.sourceId), code })));
  const duplicateHashes = new Set();
  const seenHashes = new Set();
  signals.forEach((signal) => {
    const hash = clean(signal.externalSignalKeyHash);
    if (hash && seenHashes.has(hash)) duplicateHashes.add(hash);
    if (hash) seenHashes.add(hash);
  });
  duplicateHashes.forEach((hash) => {
    signals.filter((signal) => clean(signal.externalSignalKeyHash) === hash).forEach((signal) => {
      qualityFindings.push({ signalId: clean(signal.id), sourceId: clean(signal.sourceId), code: "duplicate-source-record" });
    });
  });
  const activeSourceIds = new Set(signals.map((item) => clean(item.sourceId)).filter(Boolean));
  return {
    ok: qualityFindings.length === 0,
    functionalState: qualityFindings.length
      ? "public-health-data-quality-review-required"
      : "public-health-data-foundation-runnable",
    formalGoLiveState: "blocked-until-production-sources-sharing-authorization-and-site-evidence-verified",
    summary: {
      catalogEntries: PUBLIC_HEALTH_DATA_CATALOG.length,
      sources: sources.length,
      registeredSources: registeredSourceIds.size,
      activeSources: activeSourceIds.size,
      signals: signals.length,
      qualityFindings: qualityFindings.length,
      lineageAuditEntries: Array.isArray(data.publicHealthDataLineageAudit)
        ? data.publicHealthDataLineageAudit.length
        : 0
    },
    catalog: clone(PUBLIC_HEALTH_DATA_CATALOG),
    sources,
    signals: signals.map((signal) => ({
      id: clean(signal.id),
      version: Number(signal.version || 0),
      sourceId: clean(signal.sourceId),
      signalType: clean(signal.signalType),
      institutionId: clean(signal.institutionId),
      regionCode: clean(signal.regionCode),
      observedAt: clean(signal.observedAt),
      qualityStatus: clean(signal.qualityStatus),
      workflowState: clean(signal.workflowState),
      evidenceCount: Array.isArray(signal.evidenceRefs) ? signal.evidenceRefs.length : 0
    })),
    qualityFindings,
    productionReady: false,
    blockers: [
      "Production source registrations and data-sharing authorizations require on-site verification.",
      "National/provincial interface mappings and source quality feedback remain subject to joint acceptance."
    ]
  };
}

function buildPublicHealthDataSourceOperations({ data = {}, now = new Date().toISOString() } = {}) {
  const nowValue = new Date(now).getTime();
  if (!Number.isFinite(nowValue)) throw new Error("public health data source operations now must be a valid date-time");
  const sources = sourceRegistry(data);
  const signals = Array.isArray(data.publicHealthSurveillanceSignals)
    ? clone(data.publicHealthSurveillanceSignals)
    : [];
  const foundation = buildPublicHealthDataFoundation({ data });
  const rows = sources.map((source) => {
    const sourceSignals = signals.filter((signal) => clean(signal.sourceId) === source.id);
    const observedValues = sourceSignals
      .map((signal) => new Date(signal.observedAt).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => right - left);
    const lastObservedValue = observedValues[0];
    const lastObservedAt = Number.isFinite(lastObservedValue)
      ? new Date(lastObservedValue).toISOString()
      : "";
    const ageMinutes = Number.isFinite(lastObservedValue)
      ? Math.round(((nowValue - lastObservedValue) / 60000) * 10) / 10
      : null;
    const sourceFindings = foundation.qualityFindings.filter((item) => clean(item.sourceId) === source.id);
    let operationalState;
    if (source.status !== "registered") operationalState = source.status;
    else if (lastObservedValue > nowValue + 5 * 60000) operationalState = "clock-skew";
    else if (sourceFindings.length) operationalState = "quality-review";
    else if (!Number.isFinite(lastObservedValue)) operationalState = "no-data";
    else if (ageMinutes <= source.expectedRefreshMinutes * 2) operationalState = "fresh";
    else if (ageMinutes <= source.expectedRefreshMinutes * 4) operationalState = "delayed";
    else operationalState = "stale";
    return {
      id: source.id,
      name: source.name,
      owner: source.owner,
      stewardRole: source.stewardRole,
      expectedRefreshMinutes: source.expectedRefreshMinutes,
      status: source.status,
      lastObservedAt,
      ageMinutes,
      signalCount: sourceSignals.length,
      qualityFindings: sourceFindings.length,
      operationalState,
      productionReady: false
    };
  });
  const alerts = rows.filter((item) => !["fresh", "paused", "retired"].includes(item.operationalState))
    .map((item) => {
      const detailByState = {
        "no-data": "No minimized signal has been observed for the registered source.",
        delayed: `The latest signal is older than twice the ${item.expectedRefreshMinutes}-minute refresh objective.`,
        stale: `The latest signal is older than four times the ${item.expectedRefreshMinutes}-minute refresh objective.`,
        "clock-skew": "The latest signal observation time is more than five minutes in the future.",
        "quality-review": "One or more persisted signal quality findings require source-owner review."
      };
      return {
        id: `ph-source-alert-${item.id}-${item.operationalState}`,
        sourceId: item.id,
        code: item.operationalState,
        severity: ["stale", "clock-skew", "quality-review"].includes(item.operationalState) ? "error" : "warning",
        owner: item.owner,
        requiredAction: detailByState[item.operationalState],
        productionReady: false
      };
    });
  const blockingStates = new Set(["stale", "clock-skew", "quality-review"]);
  return {
    ok: foundation.ok && !rows.some((item) => blockingStates.has(item.operationalState)),
    functionalState: rows.some((item) => blockingStates.has(item.operationalState))
      ? "public-health-source-operations-review-required"
      : "public-health-source-observability-runnable",
    formalGoLiveState: "blocked-until-production-source-cadence-and-quality-observation-window-verified",
    observedAt: new Date(nowValue).toISOString(),
    summary: {
      sources: rows.length,
      fresh: rows.filter((item) => item.operationalState === "fresh").length,
      delayed: rows.filter((item) => item.operationalState === "delayed").length,
      stale: rows.filter((item) => item.operationalState === "stale").length,
      noData: rows.filter((item) => item.operationalState === "no-data").length,
      clockSkew: rows.filter((item) => item.operationalState === "clock-skew").length,
      qualityReview: rows.filter((item) => item.operationalState === "quality-review").length,
      pausedOrRetired: rows.filter((item) => ["paused", "retired"].includes(item.operationalState)).length,
      alerts: alerts.length
    },
    sources: rows,
    alerts,
    productionReady: false,
    blockers: [
      "Production refresh objectives and source-owner escalation paths require joint confirmation.",
      "A sustained production data-quality observation window remains required."
    ]
  };
}

function ingestPublicHealthSurveillanceSignalToState(data = {}, payload = {}, user = {}, options = {}) {
  const role = actorRole(user);
  if (!INGEST_ROLES.has(role)) throw new Error(`role ${role || "missing"} is not allowed to ingest public health signals`);
  const sources = sourceRegistry(data);
  const signal = normalizePublicHealthSurveillanceSignal(payload, { ...options, sources });
  const source = sources.find((item) => item.id === signal.sourceId);
  if (![source.stewardRole, "system", "commission", "cdc-surveillance"].includes(role)) {
    throw new Error(`role ${role} is not allowed to ingest source ${source.id}`);
  }
  const existingSignals = Array.isArray(data.publicHealthSurveillanceSignals)
    ? clone(data.publicHealthSurveillanceSignals)
    : [];
  const duplicate = existingSignals.find((item) => clean(item.externalSignalKeyHash) === signal.externalSignalKeyHash);
  if (duplicate) {
    if (clean(duplicate.contentFingerprint) !== signal.contentFingerprint) {
      throw new Error("public health source signal conflict detected");
    }
    return {
      ok: true,
      idempotent: true,
      signal: clone(duplicate),
      nextData: data,
      dataFoundation: buildPublicHealthDataFoundation({ data }),
      productionReady: false
    };
  }
  const at = signal.receivedAt;
  const audit = {
    id: `ph-lineage-${sha256(`${signal.id}\n${signal.idempotencyKeyHash}`).slice(0, 24)}`,
    signalId: signal.id,
    sourceId: signal.sourceId,
    action: "ingest-signal",
    actor: actorName(user),
    role,
    at,
    sourceRecordHash: signal.externalSignalKeyHash,
    contentFingerprint: signal.contentFingerprint,
    evidenceCount: signal.evidenceRefs.length
  };
  const nextSources = sources.map((item) => item.id === signal.sourceId
    ? { ...item, lastObservedAt: signal.observedAt }
    : item);
  const nextData = {
    ...data,
    publicHealthDataSources: nextSources,
    publicHealthSurveillanceSignals: [...existingSignals, signal],
    publicHealthDataLineageAudit: [
      ...(Array.isArray(data.publicHealthDataLineageAudit) ? clone(data.publicHealthDataLineageAudit) : []),
      audit
    ]
  };
  return {
    ok: true,
    idempotent: false,
    signal: clone(signal),
    audit: clone(audit),
    nextData,
    dataFoundation: buildPublicHealthDataFoundation({ data: nextData }),
    productionReady: false
  };
}

module.exports = {
  PUBLIC_HEALTH_DATA_CATALOG,
  PUBLIC_HEALTH_DATA_SOURCES,
  PUBLIC_HEALTH_SIGNAL_TYPES,
  buildPublicHealthDataFoundation,
  buildPublicHealthDataSourceOperations,
  ingestPublicHealthSurveillanceSignalToState,
  normalizePublicHealthSurveillanceSignal
};
