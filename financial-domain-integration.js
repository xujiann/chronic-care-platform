const { createHash, randomUUID } = require("node:crypto");

const { applyFinancialCallback } = require("./financial-gateways");

const MAX_ROWS = 5000;
const STATUS_LABELS = Object.freeze({
  accepted: "accepted",
  processing: "processing",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  reversed: "reversed"
});

function safeText(value, maximumLength = 240) {
  return String(value || "").trim().replace(/[\r\n]/g, " ").slice(0, maximumLength);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function domainError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeFinancialDomainState(data) {
  if (!data || typeof data !== "object") throw domainError("financial domain state is unavailable", "FINANCIAL_DOMAIN_STATE_UNAVAILABLE", 503);
  data.integrationGatewayEvents = Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [];
  data.insuranceClaims = Array.isArray(data.insuranceClaims) ? data.insuranceClaims : [];
  data.digitalCredentials = Array.isArray(data.digitalCredentials) ? data.digitalCredentials : [];
  data.interfaceReconciliationCases = Array.isArray(data.interfaceReconciliationCases) ? data.interfaceReconciliationCases : [];
  return data;
}

function requestPayload(event) {
  return event?.requestPayload?.payload || event?.payload || {};
}

function projectionEvidence(event, callbackEvent) {
  return (event.domainProjectionEvents || []).find((item) => item.callbackEventId === callbackEvent.eventId) || null;
}

function publicGatewayEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    gatewayType: event.gatewayType,
    operation: event.operation,
    contractId: event.contractId,
    providerStatus: event.providerStatus,
    reconciliationStatus: event.reconciliationStatus,
    latestCallbackAt: event.latestCallbackAt,
    domainProjectionStatus: event.domainProjectionStatus,
    domainProjectionRecordId: event.domainProjectionRecordId,
    requestPayloadExposed: false,
    residentIdExposed: false,
    callbackNonceExposed: false
  };
}

function publicEvidence(evidence) {
  if (!evidence) return null;
  const { residentIdDigest, ...safe } = evidence;
  return { ...safe, residentIdentityExposed: false };
}

function appendEvidence(event, callbackEvent, input = {}) {
  const evidence = {
    id: `financial-projection-${randomUUID()}`,
    callbackEventId: callbackEvent.eventId,
    callbackStatus: callbackEvent.status,
    stateApplied: callbackEvent.stateApplied,
    status: input.status,
    collection: input.collection || "",
    recordId: input.recordId || "",
    reconciliationCaseId: input.reconciliationCaseId || "",
    reason: safeText(input.reason, 200),
    projectedAt: input.now,
    projectedBy: input.actor,
    residentIdDigest: input.residentId ? sha256(input.residentId) : "",
    rawPayloadStored: false
  };
  event.domainProjectionEvents = [evidence, ...(Array.isArray(event.domainProjectionEvents) ? event.domainProjectionEvents : [])].slice(0, 30);
  event.domainProjectionStatus = evidence.status;
  event.domainProjectionRecordId = evidence.recordId;
  return evidence;
}

function recordProjectionCase(data, event, callbackEvent, reason, context = {}) {
  const now = String(context.now || callbackEvent.receivedAt || new Date().toISOString());
  const existing = data.interfaceReconciliationCases.find((item) =>
    item.source === "financial-domain-projection"
      && item.gatewayEventId === event.id
      && item.callbackEventId === callbackEvent.eventId
      && item.status !== "resolved"
  );
  const row = existing || {
    id: `financial-case-${randomUUID()}`,
    source: "financial-domain-projection",
    gatewayEventId: event.id,
    callbackEventId: callbackEvent.eventId,
    gatewayType: event.gatewayType,
    operation: event.operation,
    status: "open",
    priority: "P0",
    openedAt: now,
    retryCount: 0,
    productionEvidence: false,
    history: []
  };
  row.reason = safeText(reason, 240);
  row.owner = event.gatewayType === "INSURANCE" ? "medical-insurance-office" : "government-service-office";
  row.updatedAt = now;
  row.history = [{ at: now, action: "projection-pending", actor: safeText(context.user?.username || context.user?.role || "interface-integration", 120) }, ...row.history].slice(0, 30);
  if (!existing) data.interfaceReconciliationCases = [row, ...data.interfaceReconciliationCases].slice(0, 1000);
  return row;
}

function insuranceStatus(operation, callbackStatus) {
  if (operation === "settlement-cancel" && callbackStatus === "succeeded") return "cancelled";
  return STATUS_LABELS[callbackStatus] || safeText(callbackStatus, 80);
}

function findInsuranceClaim(data, event, payload) {
  return data.insuranceClaims.find((item) =>
    (payload.claimNo && (item.claimNo === payload.claimNo || item.externalId === payload.claimNo))
      || (payload.settlementNo && item.settlementNo === payload.settlementNo)
      || item.source?.gatewayEventId === event.id
  );
}

function projectInsurance(data, event, callbackEvent, context = {}) {
  const payload = requestPayload(event);
  if (!["settlement", "settlement-cancel"].includes(event.operation)) return { status: "not-applicable", reason: "operation-does-not-project" };
  const existing = findInsuranceClaim(data, event, payload);
  if (!existing && event.operation === "settlement-cancel") return { status: "pending-reconciliation", reason: "insurance claim for cancellation was not found" };
  const residentId = safeText(existing?.residentId || payload.residentId, 160);
  if (!residentId) return { status: "pending-reconciliation", reason: "insurance settlement resident could not be resolved" };
  const now = String(context.now || callbackEvent.occurredAt || new Date().toISOString());
  const amountFen = callbackEvent.amountFen ?? payload.amountFen;
  const amount = Number.isSafeInteger(Number(amountFen)) ? Number(amountFen) / 100 : existing?.totalAmount ?? null;
  const record = {
    ...(existing || {}),
    id: existing?.id || `ic-gateway-${sha256(event.id).slice(0, 24)}`,
    externalId: existing?.externalId || safeText(payload.claimNo || event.externalId, 160),
    residentId,
    personIndex: existing?.personIndex || safeText(payload.personIndex, 200),
    institution: existing?.institution || safeText(payload.institutionName, 200),
    institutionCode: existing?.institutionCode || safeText(payload.institutionCode, 120),
    claimNo: existing?.claimNo || safeText(payload.claimNo, 160),
    settlementNo: existing?.settlementNo || safeText(payload.settlementNo || event.adapterReceipt?.receiptId, 160),
    claimType: existing?.claimType || "gateway-settlement",
    diseaseType: existing?.diseaseType || safeText(payload.diseaseType, 160),
    totalAmount: amount,
    insurancePay: existing?.insurancePay ?? (payload.insurancePayFen === undefined ? null : Number(payload.insurancePayFen) / 100),
    selfPay: existing?.selfPay ?? (payload.selfPayFen === undefined ? null : Number(payload.selfPayFen) / 100),
    status: insuranceStatus(event.operation, callbackEvent.status),
    date: String(callbackEvent.businessDate || now).slice(0, 10),
    updatedAt: now,
    source: {
      contractId: event.contractId || "insurance-settlement-v1",
      gatewayEventId: event.id,
      callbackEventId: callbackEvent.eventId,
      receiptId: callbackEvent.receiptId
    },
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || safeText(context.user?.username || context.user?.role || "interface-integration", 120)
  };
  if (existing) data.insuranceClaims[data.insuranceClaims.indexOf(existing)] = record;
  else data.insuranceClaims = [record, ...data.insuranceClaims].slice(0, MAX_ROWS);
  return { status: "projected", collection: "insuranceClaims", record, residentId };
}

function certificateStatus(operation, callbackStatus, existingStatus = "") {
  if (callbackStatus !== "succeeded") return callbackStatus === "processing" || callbackStatus === "accepted" ? callbackStatus : `${operation}-${callbackStatus}`;
  if (operation === "issue") return "active";
  if (operation === "revoke") return "revoked";
  return existingStatus || "active";
}

function findCredential(data, event, payload) {
  const certificateNo = safeText(payload.certificateNo || event.adapterReceipt?.receiptId, 200);
  return data.digitalCredentials.find((item) =>
    item.credentialNo === certificateNo
      || item.source?.gatewayEventId === event.id
      || (payload.externalId && (item.externalId === payload.externalId || item.source?.externalId === payload.externalId))
  );
}

function projectCertificate(data, event, callbackEvent, context = {}) {
  const payload = requestPayload(event);
  if (!["issue", "revoke", "status-query"].includes(event.operation)) return { status: "not-applicable", reason: "operation-does-not-project" };
  const existing = findCredential(data, event, payload);
  if (["accepted", "processing", "failed", "cancelled"].includes(callbackEvent.status)) return {
    status: "no-business-change",
    reason: `certificate-${event.operation}-${callbackEvent.status}`,
    collection: existing ? "digitalCredentials" : "",
    record: existing || null,
    residentId: existing?.residentId || ""
  };
  if (callbackEvent.status === "reversed") return {
    status: "pending-reconciliation",
    reason: `certificate ${event.operation} reversal requires responsible-owner confirmation`
  };
  const resolvedResidentId = safeText(
    existing?.residentId
      || payload.residentId
      || context.resolveResidentId?.({
        subjectReference: payload.subjectReference,
        externalId: payload.externalId,
        certificateNo: payload.certificateNo || event.adapterReceipt?.receiptId,
        gatewayEventId: event.id
      }),
    160
  );
  if (!resolvedResidentId) return { status: "pending-reconciliation", reason: "certificate subject could not be linked to a resident" };
  if (!existing && event.operation !== "issue") return { status: "pending-reconciliation", reason: "certificate record for status update was not found" };
  const now = String(context.now || callbackEvent.occurredAt || new Date().toISOString());
  const certificateNo = safeText(existing?.credentialNo || payload.certificateNo || event.adapterReceipt?.receiptId, 200);
  if (!certificateNo) return { status: "pending-reconciliation", reason: "certificate number was not returned by the provider" };
  const record = {
    ...(existing || {}),
    id: existing?.id || `dc-gateway-${sha256(event.id).slice(0, 24)}`,
    externalId: existing?.externalId || safeText(payload.externalId, 160),
    residentId: resolvedResidentId,
    personIndex: existing?.personIndex || safeText(payload.personIndex, 200),
    type: existing?.type || safeText(payload.certificateType || "electronic-certificate", 160),
    provider: existing?.provider || safeText(callbackEvent.providerCode || "electronic-certificate-platform", 200),
    credentialNo: certificateNo,
    status: certificateStatus(event.operation, callbackEvent.status, existing?.status),
    authorizationReference: existing?.authorizationReference || safeText(payload.authorizationReference, 240),
    lastVerified: now,
    lastUpdated: now,
    source: {
      contractId: event.contractId || "certificate-sync-v1",
      gatewayEventId: event.id,
      callbackEventId: callbackEvent.eventId,
      externalId: safeText(payload.externalId, 160),
      receiptId: callbackEvent.receiptId,
      subjectReferenceDigest: payload.subjectReference ? sha256(payload.subjectReference) : ""
    },
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || safeText(context.user?.username || context.user?.role || "interface-integration", 120)
  };
  if (existing) data.digitalCredentials[data.digitalCredentials.indexOf(existing)] = record;
  else data.digitalCredentials = [record, ...data.digitalCredentials].slice(0, MAX_ROWS);
  return { status: "projected", collection: "digitalCredentials", record, residentId: resolvedResidentId };
}

function projectAppliedCallback(data, gatewayEvent, callbackEvent, context = {}) {
  if (gatewayEvent.gatewayType === "INSURANCE") return projectInsurance(data, gatewayEvent, callbackEvent, context);
  if (gatewayEvent.gatewayType === "CERTIFICATE") return projectCertificate(data, gatewayEvent, callbackEvent, context);
  return { status: "not-applicable", reason: "gateway-type-does-not-project" };
}

function applyFinancialCallbackAndSync(data, verifiedCallback, context = {}) {
  normalizeFinancialDomainState(data);
  const applied = applyFinancialCallback(data, verifiedCallback);
  const existingEvidence = projectionEvidence(applied.gatewayEvent, applied.callbackEvent);
  if (existingEvidence) return {
    idempotentReplay: true,
    gatewayEvent: publicGatewayEvent(applied.gatewayEvent),
    callback: { eventId: applied.callbackEvent.eventId, status: applied.callbackEvent.status, stateApplied: applied.callbackEvent.stateApplied },
    projection: publicEvidence(existingEvidence),
    record: existingEvidence.collection ? data[existingEvidence.collection]?.find((item) => item.id === existingEvidence.recordId) || null : null
  };
  const now = String(context.now || applied.callbackEvent.receivedAt || new Date().toISOString());
  const actor = safeText(context.user?.username || context.user?.role || "interface-integration", 120);
  let result;
  if (!applied.callbackEvent.stateApplied) result = { status: "ignored", reason: applied.callbackEvent.ignoredReason };
  else result = projectAppliedCallback(data, applied.gatewayEvent, applied.callbackEvent, context);
  let reconciliationCase = null;
  if (result.status === "pending-reconciliation") {
    reconciliationCase = recordProjectionCase(data, applied.gatewayEvent, applied.callbackEvent, result.reason, context);
  }
  const evidence = appendEvidence(applied.gatewayEvent, applied.callbackEvent, {
    ...result,
    recordId: result.record?.id,
    reconciliationCaseId: reconciliationCase?.id,
    now,
    actor
  });
  return {
    idempotentReplay: applied.idempotentReplay,
    gatewayEvent: publicGatewayEvent(applied.gatewayEvent),
    callback: { eventId: applied.callbackEvent.eventId, status: applied.callbackEvent.status, stateApplied: applied.callbackEvent.stateApplied },
    projection: publicEvidence(evidence),
    record: result.record || null,
    reconciliationCase
  };
}

function retryFinancialProjection(data, caseId, context = {}) {
  normalizeFinancialDomainState(data);
  const reconciliationCase = data.interfaceReconciliationCases.find((item) => item.id === caseId && item.source === "financial-domain-projection");
  if (!reconciliationCase) throw domainError("financial projection reconciliation case was not found", "FINANCIAL_PROJECTION_CASE_NOT_FOUND", 404);
  if (reconciliationCase.status === "resolved") return { idempotentReplay: true, reconciliationCase };
  if (Number(reconciliationCase.retryCount || 0) >= 3) throw domainError("financial projection reconciliation case reached the retry limit", "FINANCIAL_PROJECTION_RETRY_LIMIT", 409);
  const event = data.integrationGatewayEvents.find((item) => item.id === reconciliationCase.gatewayEventId && item.adapterType === "financial");
  const callbackEvent = event?.callbackEvents?.find((item) => item.eventId === reconciliationCase.callbackEventId);
  if (!event || !callbackEvent) throw domainError("financial callback evidence for reconciliation was not found", "FINANCIAL_PROJECTION_EVIDENCE_NOT_FOUND", 409);
  reconciliationCase.retryCount = Number(reconciliationCase.retryCount || 0) + 1;
  reconciliationCase.lastRetriedAt = String(context.now || new Date().toISOString());
  const result = projectAppliedCallback(data, event, callbackEvent, context);
  reconciliationCase.history = [{
    at: reconciliationCase.lastRetriedAt,
    action: result.status === "projected" ? "projection-resolved" : "projection-retry-failed",
    actor: safeText(context.user?.username || context.user?.role || "integration-operator", 120)
  }, ...(reconciliationCase.history || [])].slice(0, 30);
  if (result.status === "projected") {
    reconciliationCase.status = "resolved";
    reconciliationCase.resolvedAt = reconciliationCase.lastRetriedAt;
    reconciliationCase.resolution = `${result.collection}:${result.record.id}`;
    reconciliationCase.productionEvidence = false;
    event.domainProjectionStatus = "projected";
    event.domainProjectionRecordId = result.record.id;
    const evidence = projectionEvidence(event, callbackEvent);
    if (evidence) Object.assign(evidence, {
      status: "projected",
      collection: result.collection,
      recordId: result.record.id,
      reason: "",
      resolvedAt: reconciliationCase.resolvedAt,
      residentIdDigest: result.residentId ? sha256(result.residentId) : ""
    });
  } else {
    reconciliationCase.reason = safeText(result.reason, 240);
    reconciliationCase.updatedAt = reconciliationCase.lastRetriedAt;
    if (reconciliationCase.retryCount >= 3) reconciliationCase.status = "manual-reconciliation-required";
  }
  return { idempotentReplay: false, gatewayEvent: publicGatewayEvent(event), record: result.record || null, reconciliationCase };
}

function financialDomainStatus(data) {
  normalizeFinancialDomainState(data);
  const events = data.integrationGatewayEvents.filter((item) => item.adapterType === "financial" && ["INSURANCE", "CERTIFICATE"].includes(item.gatewayType));
  return {
    productionReady: false,
    supported: ["INSURANCE:settlement", "INSURANCE:settlement-cancel", "CERTIFICATE:issue", "CERTIFICATE:revoke", "CERTIFICATE:status-query"],
    summary: {
      events: events.length,
      projected: events.filter((item) => item.domainProjectionStatus === "projected").length,
      pendingReconciliation: events.filter((item) => item.domainProjectionStatus === "pending-reconciliation").length,
      openCases: data.interfaceReconciliationCases.filter((item) => item.source === "financial-domain-projection" && item.status !== "resolved").length
    },
    blockers: ["T00 callback route wiring", "provider joint-test accounts and keys", "signed callback and reconciliation evidence"]
  };
}

module.exports = {
  applyFinancialCallbackAndSync,
  financialDomainStatus,
  normalizeFinancialDomainState,
  projectAppliedCallback,
  retryFinancialProjection
};
