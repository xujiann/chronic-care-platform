"use strict";

const DOMAIN = "insurance-payment";
const PROCESS = "T07";
const DEPENDENCIES = Object.freeze([
  "DiseasePaymentGrouperContract", "DiseasePaymentIntake", "DiseasePaymentService", "FinancialCallbackError",
  "OnlinePaymentRefunds", "appendSecurityEvent", "applyFinancialCallback", "authorizeInsurancePaymentAction",
  "collectJson", "createFinancialReconciliationRun", "diseasePaymentPackageSignatureOptions",
  "dispatchFinancialRequest", "financialDispatchRequestDigest", "financialGatewayCenter", "financialGatewayOperationsCenter", "normalizeState",
  "patchBusinessCollectionItem", "prependAuditTrailEntry", "randomUUID", "readDatabase", "requireApiRole", "requireInsuranceSystemCommand",
  "sendInsurancePaymentError", "sendJson", "validateFinancialRequest", "verifyFinancialCallback",
  "withFinancialDispatchLock", "withFinancialDispatchStateLock", "withFinancialReconciliationLock", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };
