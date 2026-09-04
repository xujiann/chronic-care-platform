"use strict";

const FinancialGateways = require("../../financial-gateways");
const OnlinePaymentRefunds = require("../../online-payment-refunds");

const CENTER_SCHEMA_VERSION = "medical-payment-one-stop-view-v1";
const ALLOWED_ROLES = new Set(["commission", "institution", "insurance"]);
const ROLE_GATEWAY_TYPES = Object.freeze({
  commission: Object.freeze(["PAYMENT", "INSURANCE"]),
  institution: Object.freeze(["PAYMENT", "INSURANCE"]),
  insurance: Object.freeze(["INSURANCE"])
});

class MedicalPaymentCenterError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "MedicalPaymentCenterError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function safeText(value, maximum = 160) {
  return String(value || "").trim().replace(/[\r\n]/g, " ").slice(0, maximum);
}

function nonNegativeFen(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

function actorScope(actor = {}) {
  const role = safeText(actor.role, 40);
  if (!ALLOWED_ROLES.has(role)) {
    throw new MedicalPaymentCenterError("medical payment center role is not allowed", "MEDICAL_PAYMENT_CENTER_ROLE_DENIED", 403);
  }
  const organizationCode = safeText(actor.orgCode || actor.organizationCode, 120);
  if (role === "institution" && !organizationCode) {
    throw new MedicalPaymentCenterError("medical payment center requires a trusted organization binding", "MEDICAL_PAYMENT_CENTER_SCOPE_REQUIRED", 403);
  }
  return Object.freeze({
    role,
    organizationCode,
    gatewayTypes: ROLE_GATEWAY_TYPES[role]
  });
}

function eventInstitutionCode(event = {}) {
  return safeText(event.requestPayload?.payload?.institutionCode || event.organizationId, 120);
}

function scopeData(data = {}, scope) {
  const gatewayTypes = new Set(scope.gatewayTypes);
  const events = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
    .filter((event) => event?.adapterType === "financial" && gatewayTypes.has(safeText(event.gatewayType, 20).toUpperCase()))
    .filter((event) => scope.role !== "institution" || eventInstitutionCode(event) === scope.organizationCode);
  const eventIds = new Set(events.map((event) => event.id));
  const refunds = scope.role === "insurance" ? [] : (Array.isArray(data.onlinePaymentRefunds) ? data.onlinePaymentRefunds : [])
    .filter((row) => scope.role !== "institution" || (safeText(row.organizationId, 120) === scope.organizationCode && eventIds.has(row.paymentEventId)));
  return {
    integrationGatewayEvents: events,
    financialReconciliationRuns: scope.role === "institution" ? [] :
      (Array.isArray(data.financialReconciliationRuns) ? data.financialReconciliationRuns : [])
        .filter((run) => gatewayTypes.has(safeText(run.gatewayType, 20).toUpperCase())),
    onlinePaymentRefunds: refunds
  };
}

function paymentSplit(payload = {}, amountFen = 0) {
  const insuranceAmountFen = Math.min(amountFen, nonNegativeFen(payload.insuranceAmountFen));
  const explicitPersonal = payload.personalAmountFen ?? payload.selfPayAmountFen;
  const personalAmountFen = explicitPersonal === undefined
    ? Math.max(0, amountFen - insuranceAmountFen)
    : Math.min(amountFen, nonNegativeFen(explicitPersonal));
  return { insuranceAmountFen, personalAmountFen };
}

function projectQueue(scoped, operations, scope) {
  const rawById = new Map(scoped.integrationGatewayEvents.map((event) => [event.id, event]));
  const reservedStates = OnlinePaymentRefunds.RESERVED_STATES;
  return operations.events.map((event) => {
    const raw = rawById.get(event.id) || {};
    const payload = raw.requestPayload?.payload || {};
    const amountFen = nonNegativeFen(event.expectedAmountFen);
    const split = paymentSplit(payload, amountFen);
    const reservedRefundFen = scoped.onlinePaymentRefunds
      .filter((refund) => refund.paymentEventId === event.id && reservedStates.has(refund.state))
      .reduce((sum, refund) => sum + nonNegativeFen(refund.refundAmountFen), 0);
    const refundable = event.gatewayType === "PAYMENT"
      && event.operation === "create-payment"
      && event.status === "succeeded";
    return Object.freeze({
      id: safeText(event.id),
      gatewayType: safeText(event.gatewayType, 20),
      operation: safeText(event.operation, 60),
      contractId: safeText(event.contractId, 120),
      orderReference: safeText(payload.orderNo || payload.claimNo || raw.externalId || event.id, 160),
      institutionCode: eventInstitutionCode(raw),
      receiptId: safeText(event.receiptId, 200),
      status: safeText(event.status, 40),
      reconciliationStatus: safeText(event.reconciliationStatus, 80),
      businessDate: safeText(event.businessDate, 20),
      latestCallbackAt: safeText(event.latestCallbackAt, 80),
      amountFen,
      ...split,
      reservedRefundFen,
      availableRefundFen: refundable ? Math.max(0, amountFen - reservedRefundFen) : 0,
      actions: Object.freeze({
        requestRefund: refundable && amountFen > reservedRefundFen && ["commission", "institution"].includes(scope.role)
      }),
      productionEvidence: false
    });
  });
}

function summarize(queue, refundOperations, reconciliationRuns) {
  const orderReferences = new Set(queue.map((item) => item.orderReference).filter(Boolean));
  return Object.freeze({
    orders: orderReferences.size,
    transactions: queue.length,
    pending: queue.filter((item) => !["succeeded", "failed", "cancelled", "reversed"].includes(item.status)).length,
    succeeded: queue.filter((item) => item.status === "succeeded").length,
    exceptions: queue.filter((item) => ["failed", "cancelled", "reversed"].includes(item.status) || item.reconciliationStatus === "provider-exception").length,
    grossAmountFen: queue.reduce((sum, item) => sum + item.amountFen, 0),
    personalAmountFen: queue.reduce((sum, item) => sum + item.personalAmountFen, 0),
    insuranceAmountFen: queue.reduce((sum, item) => sum + item.insuranceAmountFen, 0),
    refundRequests: refundOperations.summary.total,
    refundPendingReview: refundOperations.summary.pendingReview,
    refundExceptions: refundOperations.summary.exceptions,
    reconciliationRuns: reconciliationRuns.length,
    reconciliationDifferences: reconciliationRuns.filter((item) => item.status === "difference").length
  });
}

function buildMedicalPaymentOneStopCenter(data = {}, actor = {}, env = process.env, options = {}) {
  const scope = actorScope(actor);
  const scoped = scopeData(data, scope);
  const operations = FinancialGateways.financialGatewayOperationsCenter(scoped, env);
  const queue = projectQueue(scoped, operations, scope);
  const refundOperations = operations.refundOperations || OnlinePaymentRefunds.buildRefundOperations({ onlinePaymentRefunds: [] }, { at: options.now });
  return Object.freeze({
    schemaVersion: CENTER_SCHEMA_VERSION,
    generatedAt: options.now || new Date().toISOString(),
    productionReady: false,
    scope: Object.freeze({ role: scope.role, organizationCode: scope.organizationCode || "cross-organization", gatewayTypes: scope.gatewayTypes }),
    actions: Object.freeze({
      dispatchPayment: ["commission", "institution"].includes(scope.role),
      requestRefund: ["commission", "institution"].includes(scope.role),
      reviewRefund: scope.role === "institution",
      runReconciliation: ["commission", "insurance"].includes(scope.role)
    }),
    summary: summarize(queue, refundOperations, operations.reconciliationRuns),
    queue: Object.freeze(queue),
    refunds: Object.freeze(refundOperations.refunds),
    refundExceptions: Object.freeze(refundOperations.exceptionQueue),
    reconciliationRuns: Object.freeze(operations.reconciliationRuns),
    gateways: Object.freeze(operations.gateways.filter((gateway) => scope.gatewayTypes.includes(gateway.type))),
    blockers: Object.freeze([
      "real payment and insurance gateway credentials and network allowlists",
      "provider-specific signed callbacks and statement delivery",
      "merchant, medical institution and insurance agency reconciliation acceptance",
      "production database multi-instance evidence, security assessment and site signoff"
    ]),
    boundary: "The center is a scoped operational projection over the existing payment, insurance, refund and reconciliation ledgers. It does not create a second source of truth or authorize production settlement."
  });
}

module.exports = {
  CENTER_SCHEMA_VERSION,
  MedicalPaymentCenterError,
  actorScope,
  buildMedicalPaymentOneStopCenter,
  scopeData
};
