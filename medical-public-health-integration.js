const { createHash, randomUUID } = require("node:crypto");

const {
  DIRECT_REPORT_CONTRACT_ID,
  DIRECT_REPORT_REFERENCE_SCHEME,
  createKeyedReference,
  dispatchPublicHealthDirectReport,
  stableStringify
} = require("./public-health-connectors");
const { isIssuedCrossInstitutionAuthorization } = require("./interface-security-context");

const LIS_CONTRACT_ID = "lis-report-v1";
const MAX_LEDGER_ROWS = 5000;
const MAX_CALLBACK_ROWS = 10000;

const PUBLIC_HEALTH_DIRECT_REPORT_CONTRACT = Object.freeze({
  id: DIRECT_REPORT_CONTRACT_ID,
  domain: "公卫直报",
  version: "1.0.0-draft",
  direction: "outbound",
  resource: "PublicHealthDirectReport",
  requiredFields: [
    "externalId",
    "subjectReference",
    "institutionCode",
    "reportType",
    "diseaseCode",
    "testCode",
    "resultFlag",
    "occurredAt",
    "reportedAt"
  ],
  idempotencyKey: "externalId",
  signature: "HMAC-SHA256",
  referenceScheme: DIRECT_REPORT_REFERENCE_SCHEME,
  retryPolicy: "3 bounded attempts then dead letter and manual reconciliation",
  status: "code-ready-site-contract-pending",
  productionReady: false
});

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
  if (!data || typeof data !== "object") throw integrationError("integration state is unavailable", "INTEGRATION_STATE_UNAVAILABLE", 503);
  data.diagnosticReports = Array.isArray(data.diagnosticReports) ? data.diagnosticReports : [];
  data.integrationGatewayEvents = Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [];
  data.publicHealthDirectReportCallbacks = Array.isArray(data.publicHealthDirectReportCallbacks) ? data.publicHealthDirectReportCallbacks : [];
  return data;
}

function unwrapPayload(input = {}) {
  if (input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)) {
    return { ...input.payload, externalId: input.payload.externalId ?? input.externalId, residentId: input.payload.residentId ?? input.residentId };
  }
  return { ...input };
}

function booleanFlag(value) {
  if (value === true || value === 1) return true;
  return ["true", "yes", "1", "required"].includes(String(value || "").trim().toLowerCase());
}

function normalizeResultFlag(value) {
  const normalized = safeText(value, 40).toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    pos: "positive",
    detected: "positive",
    reactive: "positive",
    critical: "critical",
    abnormal: "abnormal",
    neg: "negative",
    "not-detected": "negative",
    normal: "normal"
  };
  return aliases[normalized] || normalized || "unknown";
}

function validateLisReport(input, options = {}) {
  const payload = unwrapPayload(input);
  const requiredFields = ["externalId", "residentId", "institutionCode", "item", "result", "reportedAt"];
  const missingFields = requiredFields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
  if (missingFields.length) throw integrationError(
    `LIS report is missing required fields: ${missingFields.join(", ")}`,
    "LIS_REQUIRED_FIELDS_MISSING",
    422,
    { missingFields }
  );
  if (!Number.isFinite(Date.parse(payload.reportedAt))) throw integrationError("LIS reportedAt is invalid", "LIS_REPORTED_AT_INVALID", 422);
  if (payload.occurredAt && !Number.isFinite(Date.parse(payload.occurredAt))) throw integrationError("LIS occurredAt is invalid", "LIS_OCCURRED_AT_INVALID", 422);
  const reportedAtMs = Date.parse(payload.reportedAt);
  const occurredAtMs = Date.parse(payload.occurredAt || payload.specimenCollectedAt || payload.reportedAt);
  if (occurredAtMs > reportedAtMs) throw integrationError("LIS occurredAt cannot be later than reportedAt", "LIS_TIME_ORDER_INVALID", 422);
  const requestedNowMs = Number(options.nowMs ?? Date.parse(options.now || ""));
  const nowMs = Number.isFinite(requestedNowMs) ? requestedNowMs : Date.now();
  const maximumFutureSkewMs = Number(options.maximumFutureSkewMs ?? 5 * 60 * 1000);
  if (Number.isFinite(nowMs) && reportedAtMs > nowMs + maximumFutureSkewMs) throw integrationError(
    "LIS reportedAt is outside the allowed future window",
    "LIS_REPORTED_AT_IN_FUTURE",
    422
  );
  const publicHealthReportRequired = booleanFlag(payload.publicHealthReportRequired);
  const resultFlag = normalizeResultFlag(payload.resultFlag);
  if (publicHealthReportRequired && !["positive", "critical"].includes(resultFlag)) throw integrationError(
    "public-health direct reporting requires a positive or critical LIS result flag",
    "LIS_DIRECT_REPORT_TRIGGER_INVALID",
    422
  );
  const directReportMissingFields = publicHealthReportRequired
    ? ["diseaseCode", "itemCode", "eventType"].filter((field) => !safeText(payload[field]))
    : [];
  if (directReportMissingFields.length) throw integrationError(
    `reportable LIS result is missing direct-report fields: ${directReportMissingFields.join(", ")}`,
    "LIS_DIRECT_REPORT_FIELDS_MISSING",
    422,
    { missingFields: directReportMissingFields }
  );
  return {
    externalId: safeText(payload.externalId, 160),
    residentId: safeText(payload.residentId, 160),
    personIndex: safeText(payload.personIndex, 200),
    institutionCode: safeText(payload.institutionCode, 120),
    institutionName: safeText(payload.institutionName || payload.institution, 200),
    item: safeText(payload.item, 200),
    itemCode: safeText(payload.itemCode, 120),
    result: safeText(payload.result, 240),
    resultFlag,
    unit: safeText(payload.unit, 40),
    conclusion: safeText(payload.conclusion || payload.result, 240),
    specimenNo: safeText(payload.specimenNo, 160),
    reportedAt: new Date(payload.reportedAt).toISOString(),
    occurredAt: new Date(payload.occurredAt || payload.specimenCollectedAt || payload.reportedAt).toISOString(),
    eventType: safeText(payload.eventType, 120),
    diseaseCode: safeText(payload.diseaseCode, 120),
    reportType: safeText(payload.reportType || "laboratory-positive", 120),
    publicHealthReportRequired,
    sourceSystem: safeText(payload.sourceSystem || "LIS", 80)
  };
}

function lisIdempotencyKey(report) {
  return `${LIS_CONTRACT_ID}|${report.institutionCode}|${report.externalId}`;
}

function directReportIdempotencyKey(report) {
  return `${DIRECT_REPORT_CONTRACT_ID}|${report.institutionCode}|${report.externalId}`;
}

function buildDiagnosticReport(report, context = {}) {
  const now = String(context.now || new Date().toISOString());
  return {
    id: `dr-lis-${sha256(lisIdempotencyKey(report)).slice(0, 24)}`,
    externalId: report.externalId,
    residentId: report.residentId,
    personIndex: report.personIndex,
    item: report.item,
    itemCode: report.itemCode,
    result: report.result,
    resultFlag: report.resultFlag,
    unit: report.unit,
    conclusion: report.conclusion,
    specimenNo: report.specimenNo,
    reportedAt: report.reportedAt,
    sourceInstitution: report.institutionName,
    sourceInstitutionCode: report.institutionCode,
    sourceSystem: report.sourceSystem,
    status: report.publicHealthReportRequired ? "public-health-report-pending" : "received",
    publicHealthReportRequired: report.publicHealthReportRequired,
    source: {
      type: "LIS",
      contractId: LIS_CONTRACT_ID,
      externalId: report.externalId,
      institutionCode: report.institutionCode,
      idempotencyKey: lisIdempotencyKey(report)
    },
    createdAt: now,
    createdBy: safeText(context.user?.username || context.user?.role || "lis-integration", 120),
    createdByName: safeText(context.user?.name || "LIS integration service", 160)
  };
}

function buildDirectReportPayload(report, options = {}) {
  return {
    externalId: report.externalId,
    subjectReference: createKeyedReference(report.personIndex || report.residentId, "subject", options),
    institutionCode: report.institutionCode,
    reportType: report.reportType,
    diseaseCode: report.diseaseCode,
    testCode: report.itemCode,
    resultFlag: report.resultFlag,
    occurredAt: report.occurredAt,
    reportedAt: report.reportedAt,
    sourceSystem: report.sourceSystem,
    specimenReference: report.specimenNo
      ? createKeyedReference(`${report.institutionCode}|${report.specimenNo}`, "specimen", options)
      : ""
  };
}

function directReportReferenceOptions(context = {}) {
  return {
    env: context.referenceEnv || context.dispatchOptions?.env || process.env
  };
}

function prependLedgerRow(data, row) {
  data.integrationGatewayEvents = [row, ...data.integrationGatewayEvents].slice(0, MAX_LEDGER_ROWS);
  return row;
}

function buildInboundEvent(report, diagnosticReport, input, context = {}) {
  const now = String(context.now || new Date().toISOString());
  return {
    id: `igw-lis-${randomUUID()}`,
    direction: "inbound",
    adapterType: "medical-public-health",
    contractId: LIS_CONTRACT_ID,
    domain: "LIS",
    resource: "LabReport",
    idempotencyKey: lisIdempotencyKey(report),
    externalId: report.externalId,
    residentId: report.residentId,
    institutionCode: report.institutionCode,
    status: "accepted",
    signatureVerified: context.signatureVerified === true,
    landingStatus: "landed",
    landedRecordId: diagnosticReport.id,
    payloadDigest: payloadDigest(unwrapPayload(input)),
    payloadStored: false,
    retryCount: 0,
    deadLetter: false,
    reconciliationStatus: "matched",
    receivedAt: now,
    receivedBy: safeText(context.user?.username || context.user?.role || "lis-integration", 120)
  };
}

function buildOutboundEvent(report, diagnosticReport, requestPayload, context = {}) {
  const now = String(context.now || new Date().toISOString());
  return {
    id: `igw-phdr-${randomUUID()}`,
    direction: "outbound",
    adapterType: "public-health-direct-report",
    contractId: DIRECT_REPORT_CONTRACT_ID,
    domain: "PUBLIC_HEALTH_DIRECT_REPORT",
    resource: "PublicHealthDirectReport",
    idempotencyKey: requestPayload.idempotencyKey,
    externalId: report.externalId,
    residentId: report.residentId,
    institutionCode: report.institutionCode,
    status: "dispatching",
    outboundSigned: true,
    diagnosticReportId: diagnosticReport.id,
    requestPayload,
    payloadDigest: payloadDigest(requestPayload.payload),
    rawInboundPayloadStored: false,
    outboundPayloadMinimized: true,
    retryCount: 0,
    deadLetter: false,
    reconciliationStatus: "dispatching",
    receivedAt: now,
    receivedBy: safeText(context.user?.username || context.user?.role || "lis-integration", 120),
    callbackEvents: []
  };
}

function publicOutboundEvent(data, event) {
  if (!event) return null;
  const { requestPayload, residentId, callbackEvents, ...safe } = event;
  return {
    ...safe,
    callbackEvents: (callbackEvents || []).map(({ nonceDigest, ...callback }) => callback),
    subjectReferenceStoredInPublicView: false,
    residentIdStoredInPublicView: false
  };
}

async function ingestLisReport(data, input, context = {}) {
  normalizeState(data);
  if (context.signatureVerified !== true) throw integrationError("LIS report signature must be verified before landing", "LIS_SIGNATURE_VERIFICATION_REQUIRED", 401);
  if (input.contractId && input.contractId !== LIS_CONTRACT_ID) throw integrationError(`unsupported LIS landing contract: ${safeText(input.contractId, 120)}`, "LIS_CONTRACT_INVALID", 400);
  const report = validateLisReport(input, context);
  const payloadInstitutionCode = report.institutionCode;
  const userInstitutionCode = safeText(context.user?.orgCode, 120);
  const institutionScopeEnforced = context.enforceInstitutionScope === true || context.user?.role === "institution";
  if (institutionScopeEnforced && !userInstitutionCode) throw integrationError(
    "authenticated institution orgCode is required for LIS landing",
    "LIS_AUTHENTICATED_INSTITUTION_REQUIRED",
    403
  );
  const crossInstitutionAuthorized = isIssuedCrossInstitutionAuthorization(context.systemAuthorization);
  if (institutionScopeEnforced
    && payloadInstitutionCode !== userInstitutionCode
    && !crossInstitutionAuthorized) throw integrationError(
    "LIS institutionCode is outside the authenticated institution scope",
    "LIS_INSTITUTION_SCOPE_MISMATCH",
    403
  );
  const idempotencyKey = lisIdempotencyKey(report);
  if (input.idempotencyKey && safeText(input.idempotencyKey, 240) !== idempotencyKey) throw integrationError("LIS idempotency key does not match the institution-scoped contract identity", "LIS_IDEMPOTENCY_KEY_CONFLICT", 409);
  const inboundPayloadDigest = payloadDigest(unwrapPayload(input));
  const duplicateEvent = data.integrationGatewayEvents.find((item) => item.contractId === LIS_CONTRACT_ID && item.idempotencyKey === idempotencyKey);
  if (duplicateEvent) {
    if (duplicateEvent.payloadDigest !== inboundPayloadDigest) throw integrationError("LIS idempotency identity conflicts with a different payload", "LIS_IDEMPOTENCY_PAYLOAD_CONFLICT", 409);
    const duplicateReport = data.diagnosticReports.find((item) => item.id === duplicateEvent.landedRecordId)
      || data.diagnosticReports.find((item) => item.source?.idempotencyKey === idempotencyKey);
    const outbound = data.integrationGatewayEvents.find((item) => item.contractId === DIRECT_REPORT_CONTRACT_ID && item.diagnosticReportId === duplicateReport?.id);
    return {
      idempotentReplay: true,
      diagnosticReport: duplicateReport || null,
      inboundEvent: duplicateEvent,
      directReportEvent: publicOutboundEvent(data, outbound)
    };
  }

  const requestPayload = report.publicHealthReportRequired ? {
    contractId: DIRECT_REPORT_CONTRACT_ID,
    idempotencyKey: directReportIdempotencyKey(report),
    payload: buildDirectReportPayload(report, directReportReferenceOptions(context))
  } : null;
  const diagnosticReport = buildDiagnosticReport(report, context);
  const inboundEvent = buildInboundEvent(report, diagnosticReport, input, context);
  data.diagnosticReports = [diagnosticReport, ...data.diagnosticReports].slice(0, MAX_LEDGER_ROWS);
  prependLedgerRow(data, inboundEvent);
  if (!report.publicHealthReportRequired) {
    return { idempotentReplay: false, diagnosticReport, inboundEvent, directReportEvent: null };
  }

  const directReportEvent = buildOutboundEvent(report, diagnosticReport, requestPayload, context);
  prependLedgerRow(data, directReportEvent);
  const dispatcher = context.dispatcher || dispatchPublicHealthDirectReport;
  try {
    const receipt = await dispatcher(requestPayload, context.dispatchOptions || {});
    Object.assign(directReportEvent, {
      status: receipt.status,
      adapterReceipt: receipt,
      dispatchedAt: receipt.acceptedAt,
      deadLetter: false,
      reconciliationStatus: "provider-accepted"
    });
    diagnosticReport.status = "public-health-report-accepted";
    diagnosticReport.publicHealthReceiptId = receipt.receiptId;
  } catch (error) {
    Object.assign(directReportEvent, {
      status: "failed",
      deadLetter: true,
      deadLetterReason: safeText(error.message || "public-health direct-report dispatch failed", 240),
      failedAt: String(context.now || new Date().toISOString()),
      reconciliationStatus: "dead-letter"
    });
    diagnosticReport.status = "public-health-report-dead-letter";
  }
  return {
    idempotentReplay: false,
    diagnosticReport,
    inboundEvent,
    directReportEvent: publicOutboundEvent(data, directReportEvent)
  };
}

async function retryDirectReport(data, eventId, context = {}) {
  normalizeState(data);
  const event = data.integrationGatewayEvents.find((item) => item.id === eventId && item.contractId === DIRECT_REPORT_CONTRACT_ID);
  if (!event) throw integrationError("direct-report event was not found", "DIRECT_REPORT_EVENT_NOT_FOUND", 404);
  if (!event.deadLetter && event.status !== "failed") throw integrationError("only failed direct-report events can be retried", "DIRECT_REPORT_EVENT_NOT_RETRYABLE", 409);
  if (!event.requestPayload) throw integrationError("direct-report event has no replayable request", "DIRECT_REPORT_REQUEST_MISSING", 409);
  if (Number(event.retryCount || 0) >= 3) throw integrationError("direct-report event reached the manual retry limit", "DIRECT_REPORT_RETRY_LIMIT", 409);
  event.retryCount = Number(event.retryCount || 0) + 1;
  event.lastRetriedAt = String(context.now || new Date().toISOString());
  event.lastRetriedBy = safeText(context.user?.username || context.user?.name || context.user?.role || "integration-operator", 120);
  event.status = "retrying";
  event.deadLetter = false;
  event.reconciliationStatus = "retrying";
  const dispatcher = context.dispatcher || dispatchPublicHealthDirectReport;
  const diagnosticReport = data.diagnosticReports.find((item) => item.id === event.diagnosticReportId);
  try {
    const receipt = await dispatcher(event.requestPayload, context.dispatchOptions || {});
    Object.assign(event, {
      status: receipt.status,
      adapterReceipt: receipt,
      dispatchedAt: receipt.acceptedAt,
      deadLetter: false,
      deadLetterReason: "",
      reconciliationStatus: "provider-accepted",
      lastRetryResult: "provider-accepted"
    });
    if (diagnosticReport) {
      diagnosticReport.status = "public-health-report-accepted";
      diagnosticReport.publicHealthReceiptId = receipt.receiptId;
    }
  } catch (error) {
    Object.assign(event, {
      status: "failed",
      deadLetter: true,
      deadLetterReason: safeText(error.message || "public-health direct-report retry failed", 240),
      failedAt: String(context.now || new Date().toISOString()),
      reconciliationStatus: Number(event.retryCount) >= 3 ? "manual-reconciliation-required" : "dead-letter",
      lastRetryResult: "failed"
    });
    if (diagnosticReport) diagnosticReport.status = "public-health-report-dead-letter";
  }
  return { event: publicOutboundEvent(data, event), diagnosticReport: diagnosticReport || null };
}

function applyDirectReportCallback(data, callback) {
  normalizeState(data);
  if (!callback?.signatureVerified || !callback.nonceDigest) throw integrationError("direct-report callback must be verified before persistence", "DIRECT_REPORT_CALLBACK_VERIFICATION_REQUIRED", 401);
  const duplicate = data.publicHealthDirectReportCallbacks.find((item) => item.eventId === callback.eventId);
  if (duplicate) {
    const same = ["receiptId", "status", "occurredAt", "providerCode", "failureReason"].every((field) => String(duplicate[field] || "") === String(callback[field] || ""));
    if (!same) throw integrationError("direct-report callback event id conflicts with persisted evidence", "DIRECT_REPORT_CALLBACK_EVENT_CONFLICT", 409);
    return { idempotentReplay: true, callbackEvent: publicCallbackEvent(duplicate), gatewayEvent: publicOutboundEvent(data, data.integrationGatewayEvents.find((item) => item.id === duplicate.gatewayEventId)) };
  }
  if (data.publicHealthDirectReportCallbacks.some((item) => item.nonceDigest === callback.nonceDigest)) throw integrationError("direct-report callback nonce was already used", "DIRECT_REPORT_CALLBACK_REPLAY_DETECTED", 409);
  const gatewayEvent = data.integrationGatewayEvents.find((item) => item.contractId === DIRECT_REPORT_CONTRACT_ID && item.adapterReceipt?.receiptId === callback.receiptId);
  if (!gatewayEvent) throw integrationError("direct-report callback receipt was not found", "DIRECT_REPORT_CALLBACK_RECEIPT_NOT_FOUND", 404);
  const callbackEvent = {
    ...callback,
    gatewayEventId: gatewayEvent.id,
    stateApplied: true
  };
  const currentTerminal = gatewayEvent.reconciliationStatus === "provider-final" || gatewayEvent.reconciliationStatus === "provider-exception";
  if (currentTerminal && gatewayEvent.providerStatus !== callback.status) {
    callbackEvent.stateApplied = false;
    callbackEvent.ignoredReason = "terminal-state-protected";
  }
  const statusRank = { accepted: 0, processing: 1, succeeded: 2, failed: 2, rejected: 2, cancelled: 2 };
  if (!currentTerminal && gatewayEvent.providerStatus && statusRank[callback.status] < statusRank[gatewayEvent.providerStatus]) {
    callbackEvent.stateApplied = false;
    callbackEvent.ignoredReason = "out-of-order-status";
  }
  gatewayEvent.callbackEvents = [callbackEvent, ...(Array.isArray(gatewayEvent.callbackEvents) ? gatewayEvent.callbackEvents : [])].slice(0, 50);
  gatewayEvent.latestCallbackAt = callback.receivedAt;
  if (callbackEvent.stateApplied) gatewayEvent.providerStatus = callback.status;
  if (callbackEvent.stateApplied && ["failed", "rejected", "cancelled"].includes(callback.status)) {
    gatewayEvent.status = "failed";
    gatewayEvent.deadLetter = true;
    gatewayEvent.deadLetterReason = callback.failureReason || callback.status;
    gatewayEvent.reconciliationStatus = "provider-exception";
  } else if (callbackEvent.stateApplied && callback.status === "succeeded") {
    gatewayEvent.status = "succeeded";
    gatewayEvent.deadLetter = false;
    gatewayEvent.deadLetterReason = "";
    gatewayEvent.reconciliationStatus = "provider-final";
  } else if (callbackEvent.stateApplied) {
    gatewayEvent.status = callback.status;
    gatewayEvent.deadLetter = false;
    gatewayEvent.reconciliationStatus = "provider-accepted";
  }
  const diagnosticReport = data.diagnosticReports.find((item) => item.id === gatewayEvent.diagnosticReportId);
  if (diagnosticReport && callbackEvent.stateApplied) diagnosticReport.status = callback.status === "succeeded"
    ? "public-health-report-confirmed"
    : ["failed", "rejected", "cancelled"].includes(callback.status)
      ? "public-health-report-dead-letter"
      : "public-health-report-accepted";
  data.publicHealthDirectReportCallbacks = [callbackEvent, ...data.publicHealthDirectReportCallbacks].slice(0, MAX_CALLBACK_ROWS);
  return { idempotentReplay: false, callbackEvent: publicCallbackEvent(callbackEvent), gatewayEvent: publicOutboundEvent(data, gatewayEvent), diagnosticReport: diagnosticReport || null };
}

function publicCallbackEvent(callback) {
  if (!callback) return null;
  const { nonceDigest, ...safe } = callback;
  return safe;
}

function firstIncrementStatus(data) {
  normalizeState(data);
  const inbound = data.integrationGatewayEvents.filter((item) => item.contractId === LIS_CONTRACT_ID && item.adapterType === "medical-public-health");
  const outbound = data.integrationGatewayEvents.filter((item) => item.contractId === DIRECT_REPORT_CONTRACT_ID);
  return {
    contract: PUBLIC_HEALTH_DIRECT_REPORT_CONTRACT,
    productionReady: false,
    summary: {
      lisAccepted: inbound.filter((item) => item.status === "accepted").length,
      directReportDispatched: outbound.length,
      providerFinal: outbound.filter((item) => item.reconciliationStatus === "provider-final").length,
      deadLetters: outbound.filter((item) => item.deadLetter).length,
      callbacks: data.publicHealthDirectReportCallbacks.length
    },
    blockers: [
      "official public-health direct-report field version",
      "site endpoint, network allowlist and agency credentials",
      "hospital LIS account and signing-key handoff",
      "signed positive-result callback and direct-report receipt"
    ]
  };
}

module.exports = {
  LIS_CONTRACT_ID,
  PUBLIC_HEALTH_DIRECT_REPORT_CONTRACT,
  applyDirectReportCallback,
  buildDiagnosticReport,
  buildDirectReportPayload,
  directReportIdempotencyKey,
  firstIncrementStatus,
  ingestLisReport,
  lisIdempotencyKey,
  normalizeResultFlag,
  normalizeState,
  payloadDigest,
  retryDirectReport,
  validateLisReport
};
