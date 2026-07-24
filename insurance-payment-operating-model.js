"use strict";

const RESPONSIBILITY_MATRIX = Object.freeze([
  Object.freeze({ capability: "settlement-list-intake", accountable: "hospital-medical-insurance-office", responsible: ["hospital-medical-records", "hospital-information"], consulted: ["insurance-settlement-center"], evidence: ["source-file-digest", "quality-report", "correction-ledger"] }),
  Object.freeze({ capability: "formal-grouping", accountable: "insurance-payment-policy", responsible: ["official-grouper-operator"], consulted: ["hospital-medical-records"], evidence: ["signed-grouper-receipt", "trusted-transport-callback", "callback-replay-ledger", "redacted-production-configuration-gate", "scheme-version", "case-input-digest", "job-state-projection", "job-result-ledger-cross-check", "dead-letter-state-projection", "redacted-operations"] }),
  Object.freeze({ capability: "payment-parameter-release", accountable: "insurance-bureau", responsible: ["insurance-payment-policy", "fund-finance"], consulted: ["hospital-representatives"], evidence: ["impact-report", "dual-review", "approval-document-digest"] }),
  Object.freeze({ capability: "special-case-negotiation", accountable: "insurance-bureau", responsible: ["hospital-medical-insurance-office", "medical-insurance-review", "fund-finance-review"], consulted: ["clinical-expert-pool"], evidence: ["evidence-digests", "avoidance-record", "dual-review", "decision-digest", "original-review-state-projection", "appeal-original-decision-digest", "fresh-appeal-panel", "appeal-review-state-projection", "appeal-sla"] }),
  Object.freeze({ capability: "monthly-settlement", accountable: "insurance-settlement-center", responsible: ["insurance-settlement-operator", "hospital-finance"], consulted: ["fund-finance"], evidence: ["frozen-batch-digest", "core-receipt", "core-return-requirement-digest", "correction-sla", "resubmission-identity", "reconciliation-digest", "difference-evidence-digest", "dual-domain-review", "difference-state-projection", "payment-failure-evidence-digest", "payment-retry-identity", "payment-receipt", "settlement-state-projection", "sla-status"] }),
  Object.freeze({ capability: "annual-clearance", accountable: "insurance-bureau", responsible: ["insurance-settlement-center", "hospital-finance", "fund-finance"], consulted: ["insurance-payment-policy"], evidence: ["clearance-digest", "per-institution-confirmation", "institution-dispute-digest", "aggregate-confirmation-digest", "adjustment-approval", "finance-voucher", "lock-reference", "clearance-state-projection"] }),
  Object.freeze({ capability: "online-payment-refund", accountable: "hospital-finance", responsible: ["cashier", "business-reviewer", "finance-reviewer", "payment-gateway-adapter"], consulted: ["payment-provider"], evidence: ["original-payment-receipt", "dual-review", "rejection-decision-digest", "fresh-correction-evidence-digest", "immutable-review-history", "event-ledger-state-projection", "signed-provider-callback", "phase-sla", "redacted-exception-queue", "daily-reconciliation", "finance-voucher"] })
]);

const ACTION_RULES = Object.freeze({
  "formal-grouping.operations.read": Object.freeze({ roles: ["insurance", "commission", "institution"], organizations: ["insurance_center", "insurance_bureau", "platform", "medical_institution"] }),
  "formal-grouping.create": Object.freeze({ roles: ["insurance", "commission"], organizations: ["insurance_center", "insurance_bureau", "platform"] }),
  "formal-grouping.dispatch": Object.freeze({ roles: ["system"], organizations: ["official_grouper_adapter"] }),
  "formal-grouping.receipt": Object.freeze({ roles: ["system"], organizations: ["official_grouper_adapter"] }),
  "formal-grouping.fail": Object.freeze({ roles: ["system"], organizations: ["official_grouper_adapter", "platform"] }),
  "formal-grouping.retry": Object.freeze({ roles: ["insurance", "commission"], organizations: ["insurance_center", "insurance_bureau", "platform"] }),
  "formal-grouping.reconcile": Object.freeze({ roles: ["insurance"], organizations: ["insurance_center", "insurance_bureau"] }),
  "special-case.apply": Object.freeze({ roles: ["institution"], organizations: ["medical_institution"] }),
  "special-case.appeal": Object.freeze({ roles: ["institution"], organizations: ["medical_institution"] }),
  "special-case.review-medical": Object.freeze({ roles: ["insurance"], organizations: ["insurance_center", "insurance_bureau"] }),
  "special-case.review-fund": Object.freeze({ roles: ["insurance"], organizations: ["insurance_bureau"] }),
  "special-case.review-appeal": Object.freeze({ roles: ["insurance"], organizations: ["insurance_center", "insurance_bureau"] }),
  "settlement.freeze": Object.freeze({ roles: ["insurance"], organizations: ["insurance_center"] }),
  "settlement.reconcile": Object.freeze({ roles: ["insurance", "commission"], organizations: ["insurance_center", "insurance_bureau", "platform"] }),
  "settlement.core-callback": Object.freeze({ roles: ["system"], organizations: ["insurance_core_adapter"] }),
  "annual-clearance.confirm-hospital": Object.freeze({ roles: ["institution"], organizations: ["medical_institution"] }),
  "annual-clearance.approve": Object.freeze({ roles: ["insurance"], organizations: ["insurance_bureau"] }),
  "annual-clearance.post": Object.freeze({ roles: ["finance"], organizations: ["fund_finance"] }),
  "refund.request": Object.freeze({ roles: ["institution", "commission"], organizations: ["medical_institution", "platform"] }),
  "refund.resubmit": Object.freeze({ roles: ["institution", "commission"], organizations: ["medical_institution", "platform"] }),
  "refund.review": Object.freeze({ roles: ["institution", "finance"], organizations: ["medical_institution", "hospital_finance"] }),
  "refund.provider-callback": Object.freeze({ roles: ["system"], organizations: ["payment_gateway_adapter"] }),
  "refund.reconcile-close": Object.freeze({ roles: ["finance"], organizations: ["hospital_finance"] })
});

const T00_ROUTE_CONTRACTS = Object.freeze([
  Object.freeze({ id: "formal-grouping-operations", method: "GET", path: "/api/disease-payment/formal-grouping/operations", handler: "buildFormalGroupingOperations", roles: ["insurance", "commission", "institution"], organizations: ["insurance_center", "insurance_bureau", "platform", "medical_institution"], integrationMarkers: ["authorizeInsurancePaymentAction(\"formal-grouping.operations.read\""] }),
  Object.freeze({ id: "formal-grouping-create", method: "POST", path: "/api/disease-payment/formal-grouping/jobs", handler: "createFormalGroupingJob", roles: ["insurance", "commission"], organizations: ["insurance_center", "insurance_bureau", "platform"], integrationMarkers: ["authorizeInsurancePaymentAction(\"formal-grouping.create\""] }),
  Object.freeze({ id: "formal-grouping-dispatch", method: "POST", path: "/api/disease-payment/formal-grouping/jobs/:id/dispatch", handler: "dispatchFormalGroupingJob", roles: ["system"], organizations: ["official_grouper_adapter"], integrationMarkers: ["authorizeInsurancePaymentAction(\"formal-grouping.dispatch\""] }),
  Object.freeze({ id: "formal-grouping-receipt", method: "POST", path: "/api/disease-payment/formal-grouping/jobs/:id/receipts", handler: "receiveTrustedFormalGroupingReceipt", roles: ["system"], organizations: ["official_grouper_adapter"], integrationMarkers: ["authorizeInsurancePaymentAction(\"formal-grouping.receipt\"", "verifyTrustedGrouperCallback"] }),
  Object.freeze({ id: "formal-grouping-fail", method: "POST", path: "/api/disease-payment/formal-grouping/jobs/:id/fail", handler: "failFormalGroupingJob", roles: ["system"], organizations: ["official_grouper_adapter", "platform"], integrationMarkers: ["authorizeInsurancePaymentAction(\"formal-grouping.fail\""] }),
  Object.freeze({ id: "formal-grouping-retry", method: "POST", path: "/api/disease-payment/formal-grouping/jobs/:id/retry", handler: "retryFormalGroupingJob", roles: ["insurance", "commission"], organizations: ["insurance_center", "insurance_bureau", "platform"], integrationMarkers: ["authorizeInsurancePaymentAction(\"formal-grouping.retry\""] }),
  Object.freeze({ id: "formal-grouping-reconcile", method: "POST", path: "/api/disease-payment/formal-grouping/jobs/:id/reconcile", handler: "reconcileFormalGroupingDeadLetter", roles: ["insurance"], organizations: ["insurance_center", "insurance_bureau"], integrationMarkers: ["authorizeInsurancePaymentAction(\"formal-grouping.reconcile\""] }),
  Object.freeze({ id: "refund-create", method: "POST", path: "/api/online-payments/refunds", handler: "createRefundRequest", roles: ["institution", "commission"] }),
  Object.freeze({ id: "refund-resubmit", method: "POST", path: "/api/online-payments/refunds/:id/resubmit", handler: "resubmitRejectedRefund", roles: ["institution", "commission"] }),
  Object.freeze({ id: "refund-review", method: "POST", path: "/api/online-payments/refunds/:id/reviews", handler: "reviewRefundRequest", roles: ["institution", "commission"] }),
  Object.freeze({ id: "refund-dispatch", method: "POST", path: "/api/online-payments/refunds/:id/dispatch", handlers: ["prepareRefundDispatch", "dispatchFinancialRequest", "recordRefundDispatch"], roles: ["commission"] }),
  Object.freeze({ id: "refund-retry", method: "POST", path: "/api/online-payments/refunds/:id/retry", handler: "retryRefund", roles: ["commission"] }),
  Object.freeze({ id: "refund-cancel", method: "POST", path: "/api/online-payments/refunds/:id/cancel", handler: "cancelRefund", roles: ["institution", "commission"] }),
  Object.freeze({ id: "refund-reconcile", method: "POST", path: "/api/online-payments/refunds/:id/reconcile", handler: "reconcileRefund", roles: ["commission"] }),
  Object.freeze({ id: "refund-close", method: "POST", path: "/api/online-payments/refunds/:id/close", handler: "closeRefund", roles: ["commission"] }),
  Object.freeze({ id: "refund-callback-hook", method: "INTERNAL", path: "financial PAYMENT callback post-apply hook", handlers: ["applyFinancialCallback", "syncRefundFromFinancialCallback"], roles: ["system"] }),
  Object.freeze({ id: "special-case-reselect", method: "POST", path: "/api/disease-payment/special-cases/:id/expert-reselection", handler: "reselectSpecialCaseExpert", roles: ["insurance"] }),
  Object.freeze({ id: "special-case-disclosure", method: "GET", path: "/api/disease-payment/special-cases/disclosure", handler: "buildSpecialCaseDisclosure", roles: ["insurance", "commission", "institution"] }),
  Object.freeze({ id: "special-case-appeal-create", method: "POST", path: "/api/disease-payment/special-cases/:id/appeals", handler: "createSpecialCaseAppeal", roles: ["institution"] }),
  Object.freeze({ id: "special-case-appeal-review", method: "POST", path: "/api/disease-payment/special-cases/:id/appeals/review", handler: "reviewSpecialCaseAppeal", roles: ["insurance"] }),
  Object.freeze({ id: "settlement-core-callback", method: "INTERNAL", path: "financial INSURANCE callback post-apply hook", handler: "applyInsuranceCoreSettlementCallback", roles: ["system"] }),
  Object.freeze({ id: "annual-clearance-create", method: "POST", path: "/api/disease-payment/annual-clearances", handler: "createAnnualClearance", roles: ["insurance"] }),
  Object.freeze({ id: "annual-clearance-action", method: "POST", path: "/api/disease-payment/annual-clearances/:id/actions", handler: "applyAnnualClearanceAction", roles: ["insurance", "institution", "commission"] })
]);

function actorValues(actor = {}, field) {
  const value = actor[field];
  return new Set((Array.isArray(value) ? value : [value]).map((item) => String(item || "").trim()).filter(Boolean));
}

function authorizeAction(action, actor = {}) {
  const rule = ACTION_RULES[action];
  if (!rule) return { allowed: false, code: "INSURANCE_PAYMENT_ACTION_UNKNOWN", action };
  const roles = actorValues(actor, "roles");
  if (!roles.size && actor.role) roles.add(String(actor.role));
  const organizations = actorValues(actor, "organizationTypes");
  if (!organizations.size && actor.organizationType) organizations.add(String(actor.organizationType));
  const roleAllowed = rule.roles.some((item) => roles.has(item));
  const organizationAllowed = rule.organizations.some((item) => organizations.has(item));
  return { allowed: roleAllowed && organizationAllowed, code: roleAllowed && organizationAllowed ? "AUTHORIZED" : "INSURANCE_PAYMENT_RESPONSIBILITY_DENIED", action, requiredRoles: rule.roles, requiredOrganizations: rule.organizations };
}

function validateOperatingModel() {
  const capabilities = new Set(RESPONSIBILITY_MATRIX.map((item) => item.capability));
  const uniqueCapabilities = capabilities.size === RESPONSIBILITY_MATRIX.length;
  const completeResponsibilities = RESPONSIBILITY_MATRIX.every((item) => item.accountable && item.responsible.length && item.evidence.length);
  const uniqueRoutes = new Set(T00_ROUTE_CONTRACTS.map((item) => `${item.method}:${item.path}`)).size === T00_ROUTE_CONTRACTS.length;
  const completeRoutes = T00_ROUTE_CONTRACTS.every((item) => item.id && item.method && item.path && (item.handler || item.handlers?.length) && item.roles.length);
  return { ok: uniqueCapabilities && completeResponsibilities && uniqueRoutes && completeRoutes, responsibilityCapabilities: RESPONSIBILITY_MATRIX.length, actionRules: Object.keys(ACTION_RULES).length, t00Routes: T00_ROUTE_CONTRACTS.length, checks: { uniqueCapabilities, completeResponsibilities, uniqueRoutes, completeRoutes } };
}

function buildT00IntegrationHandoff(serverSource = "") {
  const routes = T00_ROUTE_CONTRACTS.map((item) => {
    const pathMarker = item.path.includes(":id") ? item.path.split("/:id")[0] : item.path;
    const handlers = item.handlers || [item.handler];
    const integrationMarkers = item.integrationMarkers || [];
    const baseWired = item.method === "INTERNAL" ? handlers.every((marker) => serverSource.includes(marker)) : serverSource.includes(pathMarker) && handlers.every((marker) => serverSource.includes(marker));
    const wired = baseWired && integrationMarkers.every((marker) => serverSource.includes(marker));
    return { ...item, owner: "T00", wired };
  });
  return { owner: "T00", domainOwner: "T07", readyForIntegration: validateOperatingModel().ok, wired: routes.filter((item) => item.wired).length, pending: routes.filter((item) => !item.wired).length, routes };
}

module.exports = { ACTION_RULES, RESPONSIBILITY_MATRIX, T00_ROUTE_CONTRACTS, authorizeAction, buildT00IntegrationHandoff, validateOperatingModel };
