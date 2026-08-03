"use strict";

const DOMAIN = "insurance-payment";
const PROCESS = "T07";
const DEPENDENCIES = Object.freeze([
  "DiseasePaymentGrouperContract", "DiseasePaymentIntake", "DiseasePaymentService", "FinancialCallbackError",
  "OnlinePaymentRefunds", "appendSecurityEvent", "applyFinancialCallback", "authorizeInsurancePaymentAction",
  "collectJson", "createFinancialReconciliationRun", "diseasePaymentPackageSignatureOptions",
  "dispatchFinancialRequest", "financialGatewayCenter", "financialGatewayOperationsCenter", "normalizeState",
  "patchBusinessCollectionItem", "randomUUID", "readDatabase", "requireApiRole", "requireInsuranceSystemCommand",
  "sendInsurancePaymentError", "sendJson", "validateFinancialRequest", "verifyFinancialCallback", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };
