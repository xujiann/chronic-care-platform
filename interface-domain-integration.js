const { createHash, randomUUID } = require("node:crypto");

const {
  LIS_CONTRACT_ID,
  ingestLisReport,
  lisIdempotencyKey,
  validateLisReport
} = require("./medical-public-health-integration");
const { stableStringify } = require("./public-health-connectors");
const { isIssuedCrossInstitutionAuthorization } = require("./interface-security-context");

const MAX_ROWS = 5000;
const INSURANCE_CLAIM_STATUSES = new Set(["accepted", "processing", "succeeded", "failed", "cancelled", "reversed"]);
const CERTIFICATE_STATUSES = new Set(["pending", "active", "suspended", "revoked", "expired", "invalid"]);
const CONTRACTS = Object.freeze({
  "his-patient-v1": {
    domain: "HIS",
    targetCollection: "personalRecords",
    owner: "institution-integration",
    requiredFields: ["externalId", "residentId", "institution", "visitedAt"]
  },
  "emr-summary-v1": {
    domain: "EMR",
    targetCollection: "personalRecords",
    owner: "institution-integration",
    requiredFields: ["externalId", "residentId", "diagnosis", "recordDate"]
  },
  [LIS_CONTRACT_ID]: {
    domain: "LIS",
    targetCollection: "diagnosticReports",
    owner: "medical-resource-center",
    requiredFields: ["externalId", "residentId", "item", "result", "reportedAt"]
  },
  "pacs-report-v1": {
    domain: "PACS",
    targetCollection: "diagnosticReports",
    owner: "medical-resource-center",
    requiredFields: ["externalId", "residentId", "modality", "conclusion", "reportedAt"]
  },
  "insurance-settlement-v1": {
    domain: "INSURANCE",
    targetCollection: "insuranceClaims",
    owner: "cross-agency-integration",
    requiredFields: ["externalId", "residentId", "claimStatus", "amount"]
  },
  "certificate-sync-v1": {
    domain: "CERTIFICATE",
    targetCollection: "digitalCredentials",
    owner: "cross-agency-integration",
    requiredFields: ["externalId", "certificateNo", "status"]
  }
});

const FORBIDDEN_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "privateKey",
  "secret",
  "documentBase64",
  "imageBase64",
  "dicomBase64",
  "certificateContent"
].map((key) => key.toLowerCase()));

function safeText(value, maximumLength = 240) {
  return String(value || "").trim().replace(/[\r\n]/g, " ").slice(0, maximumLength);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function payloadDigest(payload) {
  return sha256(stableStringify(payload));
}

function integrationError(message, code, statusCode = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function normalizeState(data) {
  if (!data || typeof data !== "object") throw integrationError("interface integration state is unavailable", "INTERFACE_STATE_UNAVAILABLE", 503);
  data.personalRecords = Array.isArray(data.personalRecords) ? data.personalRecords : [];
  data.diagnosticReports = Array.isArray(data.diagnosticReports) ? data.diagnosticReports : [];
  data.insuranceClaims = Array.isArray(data.insuranceClaims) ? data.insuranceClaims : [];
  data.digitalCredentials = Array.isArray(data.digitalCredentials) ? data.digitalCredentials : [];
  data.integrationGatewayEvents = Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [];
  data.interfaceReconciliationCases = Array.isArray(data.interfaceReconciliationCases) ? data.interfaceReconciliationCases : [];
  return data;
}

function unwrapPayload(input = {}) {
  if (input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)) {
    return {
      ...input.payload,
      externalId: input.payload.externalId ?? input.externalId,
      residentId: input.payload.residentId ?? input.residentId
    };
  }
  return { ...input };
}

function forbiddenPayloadPaths(value, prefix = "payload") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenPayloadPaths(item, `${prefix}[${index}]`));
  return Object.entries(value).flatMap(([key, item]) => [
    ...(FORBIDDEN_KEYS.has(key.toLowerCase()) ? [`${prefix}.${key}`] : []),
    ...forbiddenPayloadPaths(item, `${prefix}.${key}`)
  ]);
}

function requireDate(value, label) {
  if (!Number.isFinite(Date.parse(value))) throw integrationError(`${label} is invalid`, "INTERFACE_DATE_INVALID", 422, { field: label });
  return new Date(value).toISOString();
}

function requireAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw integrationError("insurance amount must be a non-negative number", "INSURANCE_AMOUNT_INVALID", 422);
  return Math.round(amount * 100) / 100;
}

function requireCanonicalStatus(value, allowed, label) {
  const status = safeText(value, 80).toLowerCase();
  if (!allowed.has(status)) throw integrationError(`${label} is unsupported`, "INTERFACE_STATUS_INVALID", 422, { field: label, status });
  return status;
}

function validateInsuranceBreakdown(amount, insurancePay, selfPay) {
  if (insurancePay === null || selfPay === null) return;
  if (Math.abs((insurancePay + selfPay) - amount) > 0.009) throw integrationError(
    "insurancePay and selfPay must equal the settlement amount",
    "INSURANCE_AMOUNT_BREAKDOWN_MISMATCH",
    422
  );
}

function requireImagingReference(value) {
  const reference = safeText(value, 500);
  if (!reference) return "";
  if (/^dicom-study:[A-Za-z0-9._:-]{1,400}$/.test(reference)) return reference;
  try {
    const parsed = new URL(reference);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("unsafe imaging reference");
    return reference;
  } catch {
    throw integrationError(
      "imagingReference must be a token-free HTTPS URL or dicom-study reference",
      "PACS_IMAGING_REFERENCE_INVALID",
      422
    );
  }
}

function validateEnvelope(input, context = {}) {
  if (context.signatureVerified !== true) throw integrationError("interface signature must be verified before landing", "INTERFACE_SIGNATURE_VERIFICATION_REQUIRED", 401);
  const contractId = safeText(input?.contractId, 160);
  const contract = CONTRACTS[contractId];
  if (!contract) throw integrationError(`unsupported interface contract: ${contractId || "missing"}`, "INTERFACE_CONTRACT_UNSUPPORTED", 400);
  const vendorIdempotencyKey = safeText(input.idempotencyKey, 240);
  if (!vendorIdempotencyKey) throw integrationError("interface idempotencyKey is required", "INTERFACE_IDEMPOTENCY_KEY_REQUIRED", 422);
  const payload = unwrapPayload(input);
  const missingFields = contract.requiredFields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
  if (missingFields.length) throw integrationError(
    `interface payload is missing required fields: ${missingFields.join(", ")}`,
    "INTERFACE_REQUIRED_FIELDS_MISSING",
    422,
    { missingFields }
  );
  const forbiddenFields = forbiddenPayloadPaths(payload);
  if (forbiddenFields.length) throw integrationError(
    `interface payload contains forbidden embedded content or credentials: ${forbiddenFields.join(", ")}`,
    "INTERFACE_FORBIDDEN_FIELD",
    422,
    { forbiddenFields }
  );
  if (Buffer.byteLength(stableStringify(payload), "utf8") > 128 * 1024) throw integrationError("interface payload exceeds size limit", "INTERFACE_PAYLOAD_TOO_LARGE", 413);
  const payloadInstitutionCode = safeText(payload.institutionCode, 120);
  const userInstitutionCode = safeText(context.user?.orgCode, 120);
  const institutionScopeEnforced = context.enforceInstitutionScope === true || context.user?.role === "institution";
  if (institutionScopeEnforced && !userInstitutionCode) throw integrationError(
    "authenticated institution orgCode is required for interface landing",
    "INTERFACE_AUTHENTICATED_INSTITUTION_REQUIRED",
    403
  );
  const crossInstitutionAuthorized = isIssuedCrossInstitutionAuthorization(context.systemAuthorization);
  if (institutionScopeEnforced
    && payloadInstitutionCode
    && payloadInstitutionCode !== userInstitutionCode
    && !crossInstitutionAuthorized) throw integrationError(
    "interface institutionCode is outside the authenticated institution scope",
    "INTERFACE_INSTITUTION_SCOPE_MISMATCH",
    403
  );
  const institutionCode = safeText(payloadInstitutionCode || userInstitutionCode, 120);
  if (!institutionCode) throw integrationError("interface institutionCode is required", "INTERFACE_INSTITUTION_REQUIRED", 422);
  const externalId = safeText(payload.externalId, 160);
  const scopeKey = `${contractId}|${institutionCode}|${externalId}`;
  return { contractId, contract, vendorIdempotencyKey, payload, institutionCode, externalId, scopeKey, digest: payloadDigest(payload) };
}

function normalizePayload(validated, context = {}) {
  const { contractId, payload, institutionCode } = validated;
  const common = {
    externalId: safeText(payload.externalId, 160),
    residentId: safeText(payload.residentId, 160),
    personIndex: safeText(payload.personIndex, 200),
    institutionCode,
    institutionName: safeText(payload.institutionName || payload.institution || context.user?.orgName, 200),
    sourceSystem: safeText(payload.sourceSystem || validated.contract.domain, 80)
  };
  if (contractId === "his-patient-v1") return {
    ...common,
    institution: safeText(payload.institution, 200),
    visitedAt: requireDate(payload.visitedAt, "visitedAt"),
    visitNo: safeText(payload.visitNo, 160),
    encounterType: safeText(payload.encounterType || payload.visitType || "outpatient", 80),
    departmentCode: safeText(payload.departmentCode, 120),
    departmentName: safeText(payload.departmentName, 160),
    visitStatus: safeText(payload.visitStatus || "completed", 80)
  };
  if (contractId === "emr-summary-v1") return {
    ...common,
    diagnosis: safeText(payload.diagnosis, 500),
    diagnosisCode: safeText(payload.diagnosisCode, 120),
    recordDate: requireDate(payload.recordDate, "recordDate"),
    documentNo: safeText(payload.documentNo, 160),
    documentType: safeText(payload.documentType || "clinical-summary", 120),
    summary: safeText(payload.summary || payload.diagnosis, 1000),
    authorDepartmentCode: safeText(payload.authorDepartmentCode, 120)
  };
  if (contractId === "pacs-report-v1") return {
    ...common,
    modality: safeText(payload.modality, 40),
    conclusion: safeText(payload.conclusion, 1000),
    reportedAt: requireDate(payload.reportedAt, "reportedAt"),
    accessionNo: safeText(payload.accessionNo, 160),
    studyInstanceUid: safeText(payload.studyInstanceUid, 200),
    bodyPart: safeText(payload.bodyPart, 120),
    reportNo: safeText(payload.reportNo, 160),
    imagingReference: requireImagingReference(payload.imagingReference)
  };
  if (contractId === "insurance-settlement-v1") {
    const amount = requireAmount(payload.amount);
    const insurancePay = payload.insurancePay === undefined ? null : requireAmount(payload.insurancePay);
    const selfPay = payload.selfPay === undefined ? null : requireAmount(payload.selfPay);
    validateInsuranceBreakdown(amount, insurancePay, selfPay);
    return {
      ...common,
      claimStatus: requireCanonicalStatus(payload.claimStatus, INSURANCE_CLAIM_STATUSES, "claimStatus"),
      amount,
      claimNo: safeText(payload.claimNo || payload.externalId, 160),
      settlementNo: safeText(payload.settlementNo, 160),
      claimType: safeText(payload.claimType || "settlement", 120),
      diseaseType: safeText(payload.diseaseType, 160),
      insurancePay,
      selfPay,
      occurredAt: requireDate(payload.occurredAt || payload.settledAt || context.now || new Date().toISOString(), "occurredAt")
    };
  }
  if (contractId === "certificate-sync-v1") return {
    ...common,
    certificateNo: safeText(payload.certificateNo, 200),
    status: requireCanonicalStatus(payload.status, CERTIFICATE_STATUSES, "status"),
    certificateType: safeText(payload.certificateType || payload.type || "electronic-certificate", 160),
    provider: safeText(payload.provider || "electronic-certificate-platform", 200),
    authorizationReference: safeText(payload.authorizationReference, 240),
    occurredAt: requireDate(payload.occurredAt || payload.updatedAt || context.now || new Date().toISOString(), "occurredAt")
  };
  throw integrationError(`unsupported projection contract: ${contractId}`, "INTERFACE_PROJECTION_UNSUPPORTED", 400);
}

function projectionSource(validated) {
  return {
    contractId: validated.contractId,
    externalId: validated.externalId,
    institutionCode: validated.institutionCode,
    idempotencyKey: validated.scopeKey
  };
}

function buildProjection(validated, normalized, context = {}) {
  const now = String(context.now || new Date().toISOString());
  const source = projectionSource(validated);
  const actor = safeText(context.user?.username || context.user?.role || "interface-integration", 120);
  if (validated.contractId === "his-patient-v1") return {
    collection: "personalRecords",
    record: {
      id: `pr-his-${sha256(validated.scopeKey).slice(0, 24)}`,
      residentId: normalized.residentId,
      personIndex: normalized.personIndex,
      category: "encounter",
      date: normalized.visitedAt.slice(0, 10),
      recordDate: normalized.visitedAt,
      name: `${normalized.encounterType} encounter`,
      result: normalized.visitStatus,
      source: normalized.institution || normalized.institutionName,
      meta: {
        externalId: normalized.externalId,
        visitNo: normalized.visitNo,
        institutionCode: normalized.institutionCode,
        encounterType: normalized.encounterType,
        departmentCode: normalized.departmentCode,
        departmentName: normalized.departmentName,
        visitStatus: normalized.visitStatus,
        source
      },
      createdAt: now,
      createdBy: actor
    }
  };
  if (validated.contractId === "emr-summary-v1") return {
    collection: "personalRecords",
    record: {
      id: `pr-emr-${sha256(validated.scopeKey).slice(0, 24)}`,
      residentId: normalized.residentId,
      personIndex: normalized.personIndex,
      category: "emr",
      date: normalized.recordDate.slice(0, 10),
      recordDate: normalized.recordDate,
      name: normalized.documentType,
      result: normalized.summary,
      diagnosis: normalized.diagnosis,
      source: normalized.institutionName,
      meta: {
        externalId: normalized.externalId,
        documentNo: normalized.documentNo,
        diagnosisCode: normalized.diagnosisCode,
        institutionCode: normalized.institutionCode,
        authorDepartmentCode: normalized.authorDepartmentCode,
        source
      },
      createdAt: now,
      createdBy: actor
    }
  };
  if (validated.contractId === "pacs-report-v1") return {
    collection: "diagnosticReports",
    record: {
      id: `dr-pacs-${sha256(validated.scopeKey).slice(0, 24)}`,
      externalId: normalized.externalId,
      residentId: normalized.residentId,
      personIndex: normalized.personIndex,
      item: normalized.modality,
      category: "imaging",
      modality: normalized.modality,
      conclusion: normalized.conclusion,
      result: normalized.conclusion,
      reportedAt: normalized.reportedAt,
      sourceInstitution: normalized.institutionName,
      sourceInstitutionCode: normalized.institutionCode,
      accessionNo: normalized.accessionNo,
      studyInstanceUid: normalized.studyInstanceUid,
      bodyPart: normalized.bodyPart,
      reportNo: normalized.reportNo,
      imagingReference: normalized.imagingReference,
      status: "received",
      source,
      createdAt: now,
      createdBy: actor
    }
  };
  if (validated.contractId === "insurance-settlement-v1") return {
    collection: "insuranceClaims",
    record: {
      id: `ic-integration-${sha256(validated.scopeKey).slice(0, 24)}`,
      externalId: normalized.externalId,
      residentId: normalized.residentId,
      personIndex: normalized.personIndex,
      institution: normalized.institutionName,
      institutionCode: normalized.institutionCode,
      claimNo: normalized.claimNo,
      settlementNo: normalized.settlementNo,
      claimType: normalized.claimType,
      diseaseType: normalized.diseaseType,
      totalAmount: normalized.amount,
      insurancePay: normalized.insurancePay,
      selfPay: normalized.selfPay,
      status: normalized.claimStatus,
      date: normalized.occurredAt.slice(0, 10),
      updatedAt: normalized.occurredAt,
      source,
      createdAt: now,
      createdBy: actor
    }
  };
  if (validated.contractId === "certificate-sync-v1") {
    const existing = context.data.digitalCredentials.find((item) => item.credentialNo === normalized.certificateNo || item.source?.externalId === normalized.externalId);
    const resolvedResidentId = normalized.residentId || safeText(context.resolveResidentId?.(normalized) || "", 160);
    if (!existing && !resolvedResidentId) throw integrationError("new certificate status cannot be linked to a resident", "CERTIFICATE_RESIDENT_UNRESOLVED", 409);
    return {
      collection: "digitalCredentials",
      existing,
      record: {
        ...(existing || {}),
        id: existing?.id || `dc-integration-${sha256(validated.scopeKey).slice(0, 24)}`,
        externalId: normalized.externalId,
        residentId: existing?.residentId || resolvedResidentId,
        personIndex: existing?.personIndex || normalized.personIndex,
        type: normalized.certificateType,
        provider: normalized.provider,
        credentialNo: normalized.certificateNo,
        status: normalized.status,
        authorizationReference: normalized.authorizationReference,
        lastVerified: normalized.occurredAt,
        lastUpdated: normalized.occurredAt,
        source,
        createdAt: existing?.createdAt || now,
        createdBy: existing?.createdBy || actor,
        updatedBy: actor
      }
    };
  }
  throw integrationError(`projection builder is missing for ${validated.contractId}`, "INTERFACE_PROJECTION_MISSING", 500);
}

function persistProjection(data, projection) {
  const collection = data[projection.collection];
  if (!Array.isArray(collection)) throw integrationError(`target collection is unavailable: ${projection.collection}`, "INTERFACE_TARGET_UNAVAILABLE", 503);
  const index = projection.existing ? collection.findIndex((item) => item === projection.existing || item.id === projection.existing.id) : -1;
  if (index >= 0) collection[index] = projection.record;
  else data[projection.collection] = [projection.record, ...collection].slice(0, MAX_ROWS);
  return projection.record;
}

function buildEvent(validated, normalized, context = {}) {
  const now = String(context.now || new Date().toISOString());
  return {
    id: `igw-domain-${randomUUID()}`,
    direction: "inbound",
    adapterType: "interface-domain",
    contractId: validated.contractId,
    domain: validated.contract.domain,
    resource: validated.contractId,
    vendorIdempotencyKey: validated.vendorIdempotencyKey,
    idempotencyKey: validated.scopeKey,
    externalId: validated.externalId,
    residentId: safeText(normalized.residentId, 160),
    institutionCode: validated.institutionCode,
    payloadDigest: validated.digest,
    originalPayloadDigest: validated.digest,
    payloadDigestHistory: [],
    replayPayload: normalized,
    rawInboundPayloadStored: false,
    status: "landing",
    signatureVerified: true,
    retryCount: 0,
    deadLetter: false,
    reconciliationStatus: "landing",
    receivedAt: now,
    receivedBy: safeText(context.user?.username || context.user?.role || "interface-integration", 120)
  };
}

function publicEvent(event) {
  if (!event) return null;
  const { replayPayload, residentId, ...safe } = event;
  return { ...safe, replayPayloadStoredInPublicView: false, residentIdStoredInPublicView: false };
}

function recordReconciliationCase(data, event, error, context = {}) {
  const now = String(context.now || new Date().toISOString());
  const existing = data.interfaceReconciliationCases.find((item) => item.eventId === event.id && item.status !== "resolved");
  const row = existing || {
    id: `interface-case-${randomUUID()}`,
    eventId: event.id,
    contractId: event.contractId,
    institutionCode: event.institutionCode,
    externalId: event.externalId,
    status: "open",
    priority: "P0",
    openedAt: now,
    productionEvidence: false,
    history: []
  };
  Object.assign(row, {
    latestErrorCode: safeText(error.code || "INTERFACE_LANDING_FAILED", 120),
    latestError: safeText(error.message || "interface landing failed", 240),
    updatedAt: now,
    owner: event.contractId === "certificate-sync-v1" ? "cross-agency-integration" : "institution-integration"
  });
  row.history = [{ at: now, action: "landing-failed", errorCode: row.latestErrorCode, actor: safeText(context.user?.username || context.user?.role || "interface-integration", 120) }, ...row.history].slice(0, 30);
  if (!existing) data.interfaceReconciliationCases = [row, ...data.interfaceReconciliationCases].slice(0, 1000);
  event.reconciliationCaseId = row.id;
  return row;
}

async function ingestInterfaceEvent(data, input, context = {}) {
  normalizeState(data);
  const validated = validateEnvelope(input, context);
  if (validated.contractId === LIS_CONTRACT_ID) {
    const lisPayload = { ...validated.payload, institutionCode: validated.institutionCode };
    const normalizedLis = validateLisReport(lisPayload, context);
    return ingestLisReport(data, {
      contractId: LIS_CONTRACT_ID,
      idempotencyKey: lisIdempotencyKey(normalizedLis),
      payload: lisPayload
    }, context);
  }
  const duplicate = data.integrationGatewayEvents.find((item) => item.adapterType === "interface-domain" && item.idempotencyKey === validated.scopeKey);
  if (duplicate) {
    if (duplicate.payloadDigest !== validated.digest) throw integrationError("interface idempotency identity conflicts with a different payload", "INTERFACE_IDEMPOTENCY_PAYLOAD_CONFLICT", 409);
    const record = data[duplicate.targetCollection]?.find((item) => item.id === duplicate.landedRecordId) || null;
    return { idempotentReplay: true, event: publicEvent(duplicate), record };
  }
  const normalized = normalizePayload(validated, context);
  const event = buildEvent(validated, normalized, context);
  data.integrationGatewayEvents = [event, ...data.integrationGatewayEvents].slice(0, MAX_ROWS);
  try {
    const projection = buildProjection(validated, normalized, { ...context, data });
    const record = persistProjection(data, projection);
    Object.assign(event, {
      status: "accepted",
      landingStatus: "landed",
      targetCollection: projection.collection,
      landedRecordId: record.id,
      deadLetter: false,
      reconciliationStatus: "matched"
    });
    return { idempotentReplay: false, event: publicEvent(event), record };
  } catch (error) {
    Object.assign(event, {
      status: "failed",
      landingStatus: "rejected",
      deadLetter: true,
      deadLetterReason: safeText(error.message || "interface landing failed", 240),
      errorCode: safeText(error.code || "INTERFACE_LANDING_FAILED", 120),
      failedAt: String(context.now || new Date().toISOString()),
      reconciliationStatus: "dead-letter"
    });
    const reconciliationCase = recordReconciliationCase(data, event, error, context);
    return { idempotentReplay: false, event: publicEvent(event), record: null, reconciliationCase };
  }
}

async function retryInboundLanding(data, eventId, context = {}) {
  normalizeState(data);
  if (context.signatureVerified !== true) throw integrationError("corrected interface payload must be verified before replay", "INTERFACE_SIGNATURE_VERIFICATION_REQUIRED", 401);
  const event = data.integrationGatewayEvents.find((item) => item.id === eventId && item.adapterType === "interface-domain");
  if (!event) throw integrationError("interface dead-letter event was not found", "INTERFACE_EVENT_NOT_FOUND", 404);
  if (!event.deadLetter) throw integrationError("only dead-letter interface events can be retried", "INTERFACE_EVENT_NOT_RETRYABLE", 409);
  if (Number(event.retryCount || 0) >= 3) throw integrationError("interface event reached the retry limit", "INTERFACE_RETRY_LIMIT", 409);
  const payload = context.correctedPayload || event.replayPayload;
  const validated = validateEnvelope({ contractId: event.contractId, idempotencyKey: event.vendorIdempotencyKey, payload }, context);
  if (validated.scopeKey !== event.idempotencyKey) throw integrationError("corrected payload changes the original interface identity", "INTERFACE_RETRY_IDENTITY_CONFLICT", 409);
  const normalized = normalizePayload(validated, context);
  event.retryCount = Number(event.retryCount || 0) + 1;
  event.lastRetriedAt = String(context.now || new Date().toISOString());
  event.lastRetriedBy = safeText(context.user?.username || context.user?.name || context.user?.role || "integration-operator", 120);
  event.payloadDigestHistory = [{
    digest: event.payloadDigest,
    replacedAt: event.lastRetriedAt,
    replacedBy: event.lastRetriedBy,
    reason: context.correctedPayload ? "corrected-payload-retry" : "same-payload-retry"
  }, ...(Array.isArray(event.payloadDigestHistory) ? event.payloadDigestHistory : [])].slice(0, 10);
  event.payloadDigest = validated.digest;
  event.replayPayload = normalized;
  try {
    const projection = buildProjection(validated, normalized, { ...context, data });
    const record = persistProjection(data, projection);
    Object.assign(event, {
      status: "accepted",
      landingStatus: "landed",
      targetCollection: projection.collection,
      landedRecordId: record.id,
      deadLetter: false,
      deadLetterReason: "",
      errorCode: "",
      reconciliationStatus: "matched",
      lastRetryResult: "landed"
    });
    const reconciliationCase = data.interfaceReconciliationCases.find((item) => item.id === event.reconciliationCaseId);
    if (reconciliationCase) {
      reconciliationCase.status = "resolved";
      reconciliationCase.resolvedAt = event.lastRetriedAt;
      reconciliationCase.resolution = "corrected-payload-landed";
      reconciliationCase.productionEvidence = false;
    }
    return { event: publicEvent(event), record, reconciliationCase: reconciliationCase || null };
  } catch (error) {
    Object.assign(event, {
      status: "failed",
      landingStatus: "rejected",
      deadLetter: true,
      deadLetterReason: safeText(error.message || "interface landing retry failed", 240),
      errorCode: safeText(error.code || "INTERFACE_LANDING_FAILED", 120),
      failedAt: event.lastRetriedAt,
      reconciliationStatus: event.retryCount >= 3 ? "manual-reconciliation-required" : "dead-letter",
      lastRetryResult: "failed"
    });
    const reconciliationCase = recordReconciliationCase(data, event, error, context);
    return { event: publicEvent(event), record: null, reconciliationCase };
  }
}

function interfaceDomainStatus(data) {
  normalizeState(data);
  const events = data.integrationGatewayEvents.filter((item) => ["interface-domain", "medical-public-health"].includes(item.adapterType));
  return {
    productionReady: false,
    contracts: Object.entries(CONTRACTS).map(([id, contract]) => ({ id, ...contract, status: "code-ready-site-joint-test-pending" })),
    summary: {
      contracts: Object.keys(CONTRACTS).length,
      accepted: events.filter((item) => item.status === "accepted").length,
      deadLetters: events.filter((item) => item.deadLetter).length,
      reconciliationCases: data.interfaceReconciliationCases.length,
      unresolvedCases: data.interfaceReconciliationCases.filter((item) => item.status !== "resolved").length
    },
    blockers: [
      "T00 shared server routes and persistence wiring",
      "site endpoints, accounts, signing keys and network allowlists",
      "vendor field dictionaries and code-system signoff",
      "signed joint-test receipts and failure-replay evidence"
    ]
  };
}

module.exports = {
  CERTIFICATE_STATUSES,
  CONTRACTS,
  INSURANCE_CLAIM_STATUSES,
  buildProjection,
  forbiddenPayloadPaths,
  ingestInterfaceEvent,
  interfaceDomainStatus,
  normalizePayload,
  normalizeState,
  payloadDigest,
  publicEvent,
  retryInboundLanding,
  validateEnvelope
};
