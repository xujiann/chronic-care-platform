"use strict";

const crypto = require("node:crypto");
const {
  ingestPublicHealthSurveillanceSignalToState
} = require("./public-health-data-foundation-service");

const RESPIRATORY_PATHOGENS = Object.freeze([
  { code: "sars-cov-2", name: "新型冠状病毒", group: "virus" },
  { code: "influenza-a", name: "甲型流感病毒", group: "virus" },
  { code: "influenza-b", name: "乙型流感病毒", group: "virus" },
  { code: "rsv", name: "呼吸道合胞病毒", group: "virus" },
  { code: "adenovirus", name: "腺病毒", group: "virus" },
  { code: "human-metapneumovirus", name: "人偏肺病毒", group: "virus" },
  { code: "parainfluenza-1", name: "副流感病毒1型", group: "virus" },
  { code: "parainfluenza-2", name: "副流感病毒2型", group: "virus" },
  { code: "parainfluenza-3", name: "副流感病毒3型", group: "virus" },
  { code: "parainfluenza-4", name: "副流感病毒4型", group: "virus" },
  { code: "rhinovirus", name: "鼻病毒", group: "virus" },
  { code: "coronavirus-229e", name: "人冠状病毒229E", group: "virus" },
  { code: "coronavirus-nl63", name: "人冠状病毒NL63", group: "virus" },
  { code: "coronavirus-oc43", name: "人冠状病毒OC43", group: "virus" },
  { code: "coronavirus-hku1", name: "人冠状病毒HKU1", group: "virus" },
  { code: "mycoplasma-pneumoniae", name: "肺炎支原体", group: "bacteria" },
  { code: "chlamydia-pneumoniae", name: "肺炎衣原体", group: "bacteria" },
  { code: "bordetella-pertussis", name: "百日咳鲍特菌", group: "bacteria" }
]);

const RESPIRATORY_PATHOGEN_CODES = new Set(RESPIRATORY_PATHOGENS.map((item) => item.code));
const RESPIRATORY_PANEL = Object.freeze({
  id: "ph-respiratory-panel-18-v1",
  version: 1,
  name: "呼吸道18病原体多联检测面板",
  pathogenCodes: RESPIRATORY_PATHOGENS.map((item) => item.code),
  planningMinimumPathogens: 15
});
const AGE_GROUPS = new Set(["child", "older-adult", "general", "mixed"]);
const PLACE_TYPES = new Set([
  "school",
  "childcare",
  "elderly-care",
  "medical-institution",
  "community",
  "port",
  "other"
]);
const INTAKE_ROLES = new Set(["laboratory", "medical-public-health", "cdc-surveillance"]);
const VERIFY_ROLES = new Set(["cdc-surveillance", "commission"]);
const PUBLISH_ROLES = new Set(["system", "cdc-surveillance", "commission"]);
const DIRECT_IDENTIFIER_KEYS = new Set([
  "residentid",
  "patientid",
  "name",
  "idcard",
  "identitynumber",
  "phone",
  "mobile",
  "address",
  "medicalrecordnumber",
  "specimenid",
  "sampleid"
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

function safeDate(value, label) {
  const text = clean(value);
  const parsed = new Date(text);
  if (!text || !Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid date-time`);
  return parsed.toISOString();
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

function assertNoDirectIdentifiers(value, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoDirectIdentifiers(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (DIRECT_IDENTIFIER_KEYS.has(key.toLowerCase())) {
      throw new Error(`respiratory surveillance batch must not contain a direct resident or specimen identifier: ${path}.${key}`);
    }
    assertNoDirectIdentifiers(item, `${path}.${key}`);
  });
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

function normalizeResults(results, specimenCount) {
  if (!Array.isArray(results) || !results.length) {
    throw new Error("respiratory pathogen results are required");
  }
  const normalized = results.map((item) => {
    const pathogenCode = clean(item.pathogenCode).toLowerCase();
    const testedSpecimens = Number(item.testedSpecimens);
    const positiveSpecimens = Number(item.positiveSpecimens);
    if (!RESPIRATORY_PATHOGEN_CODES.has(pathogenCode)
      || !Number.isInteger(testedSpecimens)
      || testedSpecimens < 0
      || testedSpecimens > specimenCount
      || !Number.isInteger(positiveSpecimens)
      || positiveSpecimens < 0
      || positiveSpecimens > testedSpecimens) {
      throw new Error("respiratory pathogen result code and specimen counts are invalid");
    }
    return {
      pathogenCode,
      testedSpecimens,
      positiveSpecimens,
      positivityRate: testedSpecimens ? Number((positiveSpecimens / testedSpecimens).toFixed(6)) : 0
    };
  }).sort((left, right) => left.pathogenCode.localeCompare(right.pathogenCode));
  if (new Set(normalized.map((item) => item.pathogenCode)).size !== normalized.length) {
    throw new Error("respiratory pathogen results contain duplicate pathogen codes");
  }
  return normalized;
}

function batchContent(batch = {}) {
  return {
    sourceId: clean(batch.sourceId),
    institutionId: clean(batch.institutionId),
    regionCode: clean(batch.regionCode),
    observedAt: clean(batch.observedAt),
    panelId: clean(batch.panelId),
    panelVersion: Number(batch.panelVersion),
    ageGroup: clean(batch.ageGroup),
    placeType: clean(batch.placeType),
    specimenCount: Number(batch.specimenCount),
    results: Array.isArray(batch.results) ? batch.results : [],
    evidenceRefs: evidenceRefs(batch)
  };
}

function batchContentFingerprint(batch) {
  return sha256(stableStringify(batchContent(batch)));
}

function verificationIntegrityPayload(batch = {}) {
  return {
    batchId: clean(batch.id),
    contentFingerprint: clean(batch.contentFingerprint),
    decision: clean(batch.verification?.decision),
    verifiedBy: clean(batch.verification?.verifiedBy),
    role: clean(batch.verification?.role),
    at: clean(batch.verification?.at),
    note: clean(batch.verification?.note),
    evidenceRefs: evidenceRefs(batch.verification),
    idempotencyKeyHash: clean(batch.verification?.idempotencyKeyHash),
    payloadFingerprint: clean(batch.verification?.payloadFingerprint)
  };
}

function publicationIntegrityPayload(batch = {}) {
  return {
    batchId: clean(batch.id),
    contentFingerprint: clean(batch.contentFingerprint),
    verificationIntegrityDigest: clean(batch.verification?.integrityDigest),
    publishedBy: clean(batch.publication?.publishedBy),
    role: clean(batch.publication?.role),
    at: clean(batch.publication?.at),
    note: clean(batch.publication?.note),
    evidenceRefs: evidenceRefs(batch.publication),
    signalIds: Array.isArray(batch.publication?.signalIds)
      ? batch.publication.signalIds.map(clean).sort()
      : [],
    idempotencyKeyHash: clean(batch.publication?.idempotencyKeyHash),
    payloadFingerprint: clean(batch.publication?.payloadFingerprint)
  };
}

function normalizeRespiratoryPathogenBatch(payload = {}, options = {}) {
  assertNoDirectIdentifiers(payload);
  const sourceId = clean(payload.sourceId);
  const externalBatchId = clean(payload.externalBatchId);
  const idempotencyKey = clean(payload.idempotencyKey);
  const institutionId = clean(payload.institutionId);
  const regionCode = clean(payload.regionCode);
  const specimenCount = Number(payload.specimenCount);
  const ageGroup = clean(payload.ageGroup).toLowerCase();
  const placeType = clean(payload.placeType).toLowerCase();
  const refs = evidenceRefs(payload);
  if (sourceId !== "ph-source-laboratory-pathogen") {
    throw new Error("respiratory pathogen batch must use the registered laboratory-pathogen source");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(externalBatchId) || !idempotencyKey) {
    throw new Error("externalBatchId and idempotencyKey are required for respiratory pathogen intake");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{2,63}$/i.test(institutionId)
    || !/^[a-z0-9][a-z0-9._:-]{2,31}$/i.test(regionCode)) {
    throw new Error("institutionId and regionCode are required for respiratory pathogen intake");
  }
  if (!Number.isInteger(specimenCount) || specimenCount <= 0 || specimenCount > 100000) {
    throw new Error("specimenCount must be an integer between 1 and 100000");
  }
  if (clean(payload.panelId) !== RESPIRATORY_PANEL.id
    || Number(payload.panelVersion) !== RESPIRATORY_PANEL.version) {
    throw new Error("known respiratory multi-pathogen panelId and panelVersion are required");
  }
  if (!AGE_GROUPS.has(ageGroup) || !PLACE_TYPES.has(placeType) || !refs.length) {
    throw new Error("ageGroup, placeType and evidenceRefs are required for respiratory pathogen intake");
  }
  const sourceRecordHash = sha256(`${sourceId}\n${externalBatchId}`);
  const batch = {
    id: `ph-respiratory-batch-${sourceRecordHash.slice(0, 24)}`,
    version: 1,
    sourceId,
    sourceRecordHash,
    institutionId,
    regionCode,
    observedAt: safeDate(payload.observedAt, "respiratory batch observedAt"),
    receivedAt: safeDate(payload.receivedAt || options.at || new Date().toISOString(), "respiratory batch receivedAt"),
    panelId: RESPIRATORY_PANEL.id,
    panelVersion: RESPIRATORY_PANEL.version,
    ageGroup,
    placeType,
    specimenCount,
    results: normalizeResults(payload.results, specimenCount),
    evidenceRefs: refs,
    status: "received",
    verification: null,
    publication: null,
    idempotencyKeyHash: sha256(idempotencyKey),
    contentFingerprint: "",
    productionReady: false
  };
  batch.contentFingerprint = batchContentFingerprint(batch);
  return batch;
}

function batchQualityFindings(batch = {}) {
  const findings = [];
  if (clean(batch.id) !== `ph-respiratory-batch-${clean(batch.sourceRecordHash).slice(0, 24)}`) {
    findings.push("respiratory-batch-id-binding-invalid");
  }
  if (clean(batch.sourceId) !== "ph-source-laboratory-pathogen") findings.push("respiratory-batch-source-invalid");
  if (!/^[a-f0-9]{64}$/.test(clean(batch.sourceRecordHash))) findings.push("respiratory-batch-source-hash-invalid");
  if (!/^[a-f0-9]{64}$/.test(clean(batch.idempotencyKeyHash))) findings.push("respiratory-batch-idempotency-hash-invalid");
  if (clean(batch.panelId) !== RESPIRATORY_PANEL.id || Number(batch.panelVersion) !== RESPIRATORY_PANEL.version) {
    findings.push("respiratory-panel-version-invalid");
  }
  if (!AGE_GROUPS.has(clean(batch.ageGroup)) || !PLACE_TYPES.has(clean(batch.placeType))) {
    findings.push("respiratory-batch-population-context-invalid");
  }
  if (!Number.isInteger(Number(batch.specimenCount)) || Number(batch.specimenCount) <= 0) {
    findings.push("respiratory-batch-specimen-count-invalid");
  }
  const results = Array.isArray(batch.results) ? batch.results : [];
  const pathogenCodes = results.map((item) => clean(item.pathogenCode));
  if (!results.length
    || new Set(pathogenCodes).size !== pathogenCodes.length
    || pathogenCodes.some((code) => !RESPIRATORY_PATHOGEN_CODES.has(code))) {
    findings.push("respiratory-batch-results-invalid");
  }
  if (results.length < RESPIRATORY_PANEL.planningMinimumPathogens) {
    findings.push("respiratory-pathogen-coverage-below-15");
  }
  if (results.some((item) => Number(item.testedSpecimens) !== Number(batch.specimenCount))) {
    findings.push("one-sample-multi-test-incomplete");
  }
  if (results.some((item) => !Number.isInteger(Number(item.positiveSpecimens))
    || Number(item.positiveSpecimens) < 0
    || Number(item.positiveSpecimens) > Number(item.testedSpecimens)
    || Number(item.positivityRate) !== Number((Number(item.positiveSpecimens) / Math.max(Number(item.testedSpecimens), 1)).toFixed(6)))) {
    findings.push("respiratory-pathogen-counts-invalid");
  }
  if (!Array.isArray(batch.evidenceRefs) || !batch.evidenceRefs.length) findings.push("respiratory-batch-evidence-missing");
  if (clean(batch.contentFingerprint) !== batchContentFingerprint(batch)) {
    findings.push("respiratory-batch-content-fingerprint-invalid");
  }
  if (!Number.isFinite(new Date(batch.observedAt).getTime())
    || !Number.isFinite(new Date(batch.receivedAt).getTime())) {
    findings.push("respiratory-batch-time-invalid");
  }
  if (findDirectIdentifier(batch)) findings.push("respiratory-batch-direct-identifier-present");
  const status = clean(batch.status);
  if (!["received", "human-verified", "dismissed", "published", "published-no-positive"].includes(status)) {
    findings.push("respiratory-batch-status-invalid");
  }
  const expectedVersion = status === "received" ? 1
    : ["human-verified", "dismissed"].includes(status) ? 2
      : 3;
  if (Number(batch.version) !== expectedVersion) findings.push("respiratory-batch-version-state-invalid");
  if (status === "received" && (batch.verification || batch.publication)) {
    findings.push("respiratory-batch-unexpected-workflow-evidence");
  }
  if (status !== "received") {
    const expectedDecision = status === "dismissed" ? "dismissed" : "confirmed";
    if (clean(batch.verification?.decision) !== expectedDecision
      || !VERIFY_ROLES.has(clean(batch.verification?.role))
      || !clean(batch.verification?.verifiedBy)
      || !Number.isFinite(new Date(batch.verification?.at).getTime())
      || !clean(batch.verification?.note)
      || !evidenceRefs(batch.verification).length
      || !/^[a-f0-9]{64}$/.test(clean(batch.verification?.idempotencyKeyHash))
      || !/^[a-f0-9]{64}$/.test(clean(batch.verification?.payloadFingerprint))
      || clean(batch.verification?.integrityDigest) !== sha256(stableStringify(verificationIntegrityPayload(batch)))) {
      findings.push("respiratory-batch-verification-integrity-invalid");
    }
  }
  if (["human-verified", "dismissed"].includes(status) && batch.publication) {
    findings.push("respiratory-batch-unexpected-publication");
  }
  if (["published", "published-no-positive"].includes(status)) {
    if (!batch.publication
      || !PUBLISH_ROLES.has(clean(batch.publication.role))
      || !clean(batch.publication.publishedBy)
      || !Number.isFinite(new Date(batch.publication.at).getTime())
      || !evidenceRefs(batch.publication).length
      || !/^[a-f0-9]{64}$/.test(clean(batch.publication.idempotencyKeyHash))
      || !/^[a-f0-9]{64}$/.test(clean(batch.publication.payloadFingerprint))
      || clean(batch.publication.integrityDigest) !== sha256(stableStringify(publicationIntegrityPayload(batch)))
      || !Array.isArray(batch.publication.signalIds)
      || (status === "published" && !batch.publication.signalIds.length)
      || (status === "published-no-positive" && batch.publication.signalIds.length)) {
      findings.push("respiratory-batch-publication-integrity-invalid");
    }
  }
  return [...new Set(findings)];
}

function findDirectIdentifier(value) {
  if (Array.isArray(value)) return value.find((item) => findDirectIdentifier(item)) || "";
  if (!value || typeof value !== "object") return "";
  for (const [key, item] of Object.entries(value)) {
    if (DIRECT_IDENTIFIER_KEYS.has(key.toLowerCase())) return key;
    const nested = findDirectIdentifier(item);
    if (nested) return nested;
  }
  return "";
}

function batchCollection(data = {}) {
  return Array.isArray(data.publicHealthRespiratoryPathogenBatches)
    ? clone(data.publicHealthRespiratoryPathogenBatches)
    : [];
}

function auditCollection(data = {}) {
  return Array.isArray(data.publicHealthRespiratoryPathogenAudit)
    ? clone(data.publicHealthRespiratoryPathogenAudit)
    : [];
}

function ingestPublicHealthRespiratoryPathogenBatchToState(data = {}, payload = {}, user = {}, options = {}) {
  const role = authorize(INTAKE_ROLES, user, "ingest a respiratory pathogen batch");
  const batch = normalizeRespiratoryPathogenBatch(payload, options);
  const batches = batchCollection(data);
  const existing = batches.find((item) => item.sourceRecordHash === batch.sourceRecordHash
    || item.idempotencyKeyHash === batch.idempotencyKeyHash);
  if (existing) {
    if (existing.sourceRecordHash === batch.sourceRecordHash
      && existing.idempotencyKeyHash === batch.idempotencyKeyHash
      && existing.contentFingerprint === batch.contentFingerprint) {
      const findings = batchQualityFindings(existing);
      if (findings.some((code) => !["respiratory-pathogen-coverage-below-15", "one-sample-multi-test-incomplete"].includes(code))) {
        throw new Error(`respiratory pathogen batch integrity invalid: ${findings[0]}`);
      }
      return { ok: true, idempotent: true, batch: existing, nextData: data, productionReady: false };
    }
    throw new Error("respiratory pathogen batch source or idempotency conflict");
  }
  const audit = {
    id: `${batch.id}:intake:1`,
    batchId: batch.id,
    action: "ingest-respiratory-pathogen-batch",
    actor: actorName(user),
    role,
    at: batch.receivedAt,
    version: 1,
    pathogenCount: batch.results.length,
    specimenCount: batch.specimenCount,
    contentFingerprint: batch.contentFingerprint
  };
  const nextData = {
    ...data,
    publicHealthRespiratoryPathogenBatches: [...batches, batch],
    publicHealthRespiratoryPathogenAudit: [...auditCollection(data), audit]
  };
  return { ok: true, idempotent: false, batch: clone(batch), audit, nextData, productionReady: false };
}

function findBatch(data, batchId) {
  const batches = batchCollection(data);
  const index = batches.findIndex((item) => clean(item.id) === clean(batchId));
  if (index < 0) throw new Error("unknown public health respiratory pathogen batch");
  return { batches, index, batch: batches[index] };
}

function verifyPublicHealthRespiratoryPathogenBatchToState(data = {}, batchId, payload = {}, user = {}) {
  const role = authorize(VERIFY_ROLES, user, "verify a respiratory pathogen batch");
  assertNoDirectIdentifiers(payload);
  const { batches, index, batch } = findBatch(data, batchId);
  const structuralFindings = batchQualityFindings(batch);
  const blockingFindings = structuralFindings.filter((code) => ![
    "respiratory-pathogen-coverage-below-15",
    "one-sample-multi-test-incomplete"
  ].includes(code));
  if (blockingFindings.length) throw new Error(`respiratory pathogen batch integrity invalid: ${blockingFindings[0]}`);
  const decision = clean(payload.decision).toLowerCase();
  const idempotencyKey = clean(payload.idempotencyKey);
  const idempotencyKeyHash = sha256(idempotencyKey);
  const payloadFingerprint = actionPayloadFingerprint(payload);
  const refs = evidenceRefs(payload);
  if (!["confirmed", "dismissed"].includes(decision)
    || !idempotencyKey
    || !clean(payload.note)
    || !refs.length) {
    throw new Error("confirmed/dismissed decision, note, evidenceRefs and idempotencyKey are required");
  }
  if (batch.verification?.idempotencyKeyHash === idempotencyKeyHash) {
    if (clean(batch.verification.payloadFingerprint) !== payloadFingerprint) {
      throw new Error("respiratory pathogen verification idempotency key payload conflict");
    }
    return { ok: true, idempotent: true, batch, nextData: data, productionReady: false };
  }
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(batch.version)) {
    throw new Error(`respiratory pathogen batch version conflict: expected ${payload.expectedVersion}, current ${batch.version}`);
  }
  if (batch.status !== "received") throw new Error(`respiratory pathogen verification is not allowed from ${batch.status}`);
  if (decision === "confirmed" && structuralFindings.length) {
    throw new Error(`respiratory pathogen batch cannot be confirmed: ${structuralFindings[0]}`);
  }
  const at = safeDate(payload.at || new Date().toISOString(), "respiratory pathogen verification at");
  const nextBatch = {
    ...batch,
    version: 2,
    status: decision === "confirmed" ? "human-verified" : "dismissed",
    verification: {
      decision,
      verifiedBy: actorName(user),
      role,
      at,
      note: clean(payload.note),
      evidenceRefs: refs,
      idempotencyKeyHash,
      payloadFingerprint,
      integrityDigest: ""
    }
  };
  nextBatch.verification.integrityDigest = sha256(stableStringify(verificationIntegrityPayload(nextBatch)));
  batches[index] = nextBatch;
  const audit = {
    id: `${batch.id}:verification:2`,
    batchId: batch.id,
    action: "verify-respiratory-pathogen-batch",
    decision,
    actor: actorName(user),
    role,
    at,
    version: 2,
    evidenceCount: refs.length,
    integrityDigest: nextBatch.verification.integrityDigest
  };
  return {
    ok: true,
    idempotent: false,
    batch: clone(nextBatch),
    audit,
    nextData: {
      ...data,
      publicHealthRespiratoryPathogenBatches: batches,
      publicHealthRespiratoryPathogenAudit: [...auditCollection(data), audit]
    },
    productionReady: false
  };
}

function publicationSignalsValid(batch, data) {
  if (!batch.publication) return false;
  const signals = Array.isArray(data.publicHealthSurveillanceSignals)
    ? data.publicHealthSurveillanceSignals
    : [];
  const positiveCodes = batch.results
    .filter((item) => item.positiveSpecimens > 0)
    .map((item) => item.pathogenCode)
    .sort();
  const boundSignals = batch.publication.signalIds
    .map((id) => signals.find((item) => clean(item.id) === clean(id)));
  if (boundSignals.some((item) => !item)
    || boundSignals.length !== positiveCodes.length
    || new Set(batch.publication.signalIds.map(clean)).size !== batch.publication.signalIds.length) {
    return false;
  }
  return boundSignals.every((signal) => {
    const result = batch.results.find((item) => item.pathogenCode === clean(signal.pathogenCode));
    const expectedExternalHash = sha256(`${batch.sourceId}\nRESP-${batch.id}-${clean(signal.pathogenCode)}`);
    const positiveMetric = signal.metrics?.find((item) => item.metricCode === "pathogen-positive-count");
    const rateMetric = signal.metrics?.find((item) => item.metricCode === "pathogen-positivity-rate");
    return Boolean(result)
      && result.positiveSpecimens > 0
      && clean(signal.id) === `ph-signal-${expectedExternalHash.slice(0, 24)}`
      && clean(signal.externalSignalKeyHash) === expectedExternalHash
      && clean(signal.sourceId) === clean(batch.sourceId)
      && clean(signal.signalType) === "laboratory-pathogen"
      && clean(signal.institutionId) === clean(batch.institutionId)
      && clean(signal.regionCode) === clean(batch.regionCode)
      && clean(signal.observedAt) === clean(batch.observedAt)
      && Number(positiveMetric?.value) === Number(result.positiveSpecimens)
      && Number(rateMetric?.value) === Number(result.positivityRate)
      && signal.evidenceRefs?.includes(`respiratory-batch:${batch.id}`);
  });
}

function publishPublicHealthRespiratoryPathogenSignalsToState(data = {}, batchId, payload = {}, user = {}) {
  const role = authorize(PUBLISH_ROLES, user, "publish respiratory pathogen signals");
  assertNoDirectIdentifiers(payload);
  const { batches, index, batch } = findBatch(data, batchId);
  const findings = batchQualityFindings(batch);
  if (findings.length) throw new Error(`respiratory pathogen batch integrity invalid: ${findings[0]}`);
  const idempotencyKey = clean(payload.idempotencyKey);
  const idempotencyKeyHash = sha256(idempotencyKey);
  const payloadFingerprint = actionPayloadFingerprint(payload);
  const refs = evidenceRefs(payload);
  if (!idempotencyKey || !clean(payload.note) || !refs.length) {
    throw new Error("note, evidenceRefs and idempotencyKey are required to publish respiratory pathogen signals");
  }
  if (batch.publication?.idempotencyKeyHash === idempotencyKeyHash) {
    if (clean(batch.publication.payloadFingerprint) !== payloadFingerprint
      || !publicationSignalsValid(batch, data)) {
      throw new Error("respiratory pathogen publication idempotency or signal binding conflict");
    }
    return { ok: true, idempotent: true, batch, signalIds: batch.publication.signalIds, nextData: data, productionReady: false };
  }
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(batch.version)) {
    throw new Error(`respiratory pathogen batch version conflict: expected ${payload.expectedVersion}, current ${batch.version}`);
  }
  if (batch.status !== "human-verified") {
    throw new Error("only a human-verified respiratory pathogen batch can publish minimized signals");
  }
  const at = safeDate(payload.at || new Date().toISOString(), "respiratory pathogen publication at");
  let nextData = data;
  const signalIds = [];
  const positiveResults = batch.results.filter((item) => item.positiveSpecimens > 0);
  positiveResults.forEach((result) => {
    const ingested = ingestPublicHealthSurveillanceSignalToState(nextData, {
      sourceId: batch.sourceId,
      externalSignalId: `RESP-${batch.id}-${result.pathogenCode}`,
      signalType: "laboratory-pathogen",
      institutionId: batch.institutionId,
      regionCode: batch.regionCode,
      observedAt: batch.observedAt,
      receivedAt: at,
      pathogenCode: result.pathogenCode,
      metrics: [
        {
          metricCode: "pathogen-positive-count",
          value: result.positiveSpecimens,
          unit: "positive-specimens"
        },
        {
          metricCode: "pathogen-positivity-rate",
          value: result.positivityRate,
          unit: "ratio"
        }
      ],
      evidenceRefs: [
        ...batch.evidenceRefs,
        ...refs,
        `respiratory-batch:${batch.id}`
      ],
      idempotencyKey: `${idempotencyKey}:${result.pathogenCode}`
    }, { name: actorName(user), role }, { at });
    nextData = ingested.nextData;
    signalIds.push(ingested.signal.id);
  });
  const nextBatch = {
    ...batch,
    version: 3,
    status: signalIds.length ? "published" : "published-no-positive",
    publication: {
      publishedBy: actorName(user),
      role,
      at,
      note: clean(payload.note),
      evidenceRefs: refs,
      signalIds,
      idempotencyKeyHash,
      payloadFingerprint,
      integrityDigest: ""
    }
  };
  nextBatch.publication.integrityDigest = sha256(stableStringify(publicationIntegrityPayload(nextBatch)));
  batches[index] = nextBatch;
  const audit = {
    id: `${batch.id}:publication:3`,
    batchId: batch.id,
    action: "publish-respiratory-pathogen-signals",
    actor: actorName(user),
    role,
    at,
    version: 3,
    signalCount: signalIds.length,
    evidenceCount: refs.length,
    integrityDigest: nextBatch.publication.integrityDigest
  };
  nextData = {
    ...nextData,
    publicHealthRespiratoryPathogenBatches: batches,
    publicHealthRespiratoryPathogenAudit: [...auditCollection(data), audit]
  };
  return {
    ok: true,
    idempotent: false,
    batch: clone(nextBatch),
    signalIds,
    audit,
    nextData,
    productionReady: false
  };
}

function validateBatchAudit(batch, auditEntries) {
  const expected = [{
    action: "ingest-respiratory-pathogen-batch",
    version: 1,
    integrityField: "contentFingerprint",
    integrityValue: batch.contentFingerprint
  }];
  if (batch.verification) expected.push({
    action: "verify-respiratory-pathogen-batch",
    version: 2,
    integrityField: "integrityDigest",
    integrityValue: batch.verification.integrityDigest
  });
  if (batch.publication) expected.push({
    action: "publish-respiratory-pathogen-signals",
    version: 3,
    integrityField: "integrityDigest",
    integrityValue: batch.publication.integrityDigest
  });
  return expected.every((item) => auditEntries.filter((audit) => audit.batchId === batch.id
    && audit.action === item.action
    && Number(audit.version) === item.version
    && clean(audit[item.integrityField]) === clean(item.integrityValue)).length === 1);
}

function buildPublicHealthRespiratoryPathogenSurveillance({ data = {}, at = new Date().toISOString() } = {}) {
  const generatedAt = safeDate(at, "respiratory pathogen surveillance at");
  const batches = batchCollection(data);
  const auditEntries = auditCollection(data);
  const findings = [];
  const sourceCounts = batches.reduce((result, batch) => {
    result.set(clean(batch.sourceRecordHash), (result.get(clean(batch.sourceRecordHash)) || 0) + 1);
    return result;
  }, new Map());
  const idempotencyCounts = batches.reduce((result, batch) => {
    result.set(clean(batch.idempotencyKeyHash), (result.get(clean(batch.idempotencyKeyHash)) || 0) + 1);
    return result;
  }, new Map());
  batches.forEach((batch) => {
    if (sourceCounts.get(clean(batch.sourceRecordHash)) > 1
      || idempotencyCounts.get(clean(batch.idempotencyKeyHash)) > 1) {
      findings.push({ batchId: clean(batch.id), code: "respiratory-batch-duplicate" });
      return;
    }
    batchQualityFindings(batch).forEach((code) => findings.push({ batchId: clean(batch.id), code }));
    if (!validateBatchAudit(batch, auditEntries)) {
      findings.push({ batchId: clean(batch.id), code: "respiratory-batch-audit-invalid" });
    }
    if (batch.publication && !publicationSignalsValid(batch, data)) {
      findings.push({ batchId: clean(batch.id), code: "respiratory-batch-signal-binding-invalid" });
    }
  });
  auditEntries.forEach((audit) => {
    if (!batches.some((batch) => batch.id === audit.batchId)) {
      findings.push({ batchId: clean(audit.batchId), auditId: clean(audit.id), code: "respiratory-batch-audit-orphan" });
    }
  });
  const validBatchIds = new Set(batches
    .filter((batch) => !findings.some((item) => item.batchId === batch.id))
    .map((batch) => batch.id));
  const validBatches = batches.filter((batch) => validBatchIds.has(batch.id));
  const observedPathogens = new Set(validBatches.flatMap((batch) => batch.results
    .filter((item) => item.testedSpecimens > 0)
    .map((item) => item.pathogenCode)));
  const oneSampleMultiTestBatches = validBatches.filter((batch) => batch.results.length >= 15
    && batch.results.every((item) => item.testedSpecimens === batch.specimenCount));
  const planningCoverageReady = observedPathogens.size >= RESPIRATORY_PANEL.planningMinimumPathogens
    && oneSampleMultiTestBatches.length > 0;
  return {
    generatedAt,
    ok: findings.length === 0,
    functionalState: findings.length
      ? "respiratory-pathogen-surveillance-quality-review-required"
      : planningCoverageReady
        ? "respiratory-pathogen-network-planning-coverage-runnable"
        : "respiratory-pathogen-network-coverage-building",
    formalGoLiveState: "blocked-until-production-laboratory-network-panel-mapping-quality-window-and-site-evidence-verified",
    summary: {
      catalogPathogens: RESPIRATORY_PATHOGENS.length,
      planningMinimumPathogens: RESPIRATORY_PANEL.planningMinimumPathogens,
      observedPathogens: observedPathogens.size,
      batches: validBatches.length,
      humanVerifiedBatches: validBatches.filter((item) => ["human-verified", "published", "published-no-positive"].includes(item.status)).length,
      publishedBatches: validBatches.filter((item) => ["published", "published-no-positive"].includes(item.status)).length,
      oneSampleMultiTestBatches: oneSampleMultiTestBatches.length,
      childBatches: validBatches.filter((item) => item.ageGroup === "child").length,
      olderAdultBatches: validBatches.filter((item) => item.ageGroup === "older-adult").length,
      priorityPlaceBatches: validBatches.filter((item) => ["school", "childcare", "elderly-care"].includes(item.placeType)).length,
      institutions: new Set(validBatches.map((item) => item.institutionId)).size,
      publishedSignals: validBatches.reduce((sum, item) => sum + (item.publication?.signalIds?.length || 0), 0),
      findings: findings.length,
      planningCoverageReady
    },
    panel: clone(RESPIRATORY_PANEL),
    pathogens: RESPIRATORY_PATHOGENS.map((item) => ({
      ...item,
      observed: observedPathogens.has(item.code)
    })),
    batches: validBatches.map((item) => ({
      id: item.id,
      version: item.version,
      institutionId: item.institutionId,
      regionCode: item.regionCode,
      observedAt: item.observedAt,
      ageGroup: item.ageGroup,
      placeType: item.placeType,
      specimenCount: item.specimenCount,
      pathogenCoverage: item.results.length,
      positivePathogens: item.results.filter((result) => result.positiveSpecimens > 0).length,
      status: item.status,
      publishedSignals: item.publication?.signalIds?.length || 0,
      oneSampleMultiTest: item.results.length >= 15
        && item.results.every((result) => result.testedSpecimens === item.specimenCount),
      productionReady: false
    })),
    findings,
    productionReady: false,
    blockers: [
      "Production laboratory panel mappings, sentinel network authorization and sustained quality observation remain required.",
      "Published pathogen signals still require human verification and governed rule evaluation before any alert.",
      "Trusted site evidence and formal launch approval remain required."
    ]
  };
}

module.exports = {
  RESPIRATORY_PANEL,
  RESPIRATORY_PATHOGENS,
  buildPublicHealthRespiratoryPathogenSurveillance,
  ingestPublicHealthRespiratoryPathogenBatchToState,
  normalizeRespiratoryPathogenBatch,
  publishPublicHealthRespiratoryPathogenSignalsToState,
  verifyPublicHealthRespiratoryPathogenBatchToState
};
