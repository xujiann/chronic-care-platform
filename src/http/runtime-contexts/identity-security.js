"use strict";

const DOMAIN = "identity-security";
const PROCESS = "T01";
const DEPENDENCIES = Object.freeze([
  "SmsDeliveryCallbackError", "appendDataAccessLog", "appendSecurityEvent", "applyIdentityDirectoryBinding",
  "applyIdentityDirectoryDeactivations", "applySmsDeliveryCallback", "buildComplianceReport",
  "buildIdentityDirectorySyncPlan", "buildSmsDeliveryCenter", "canAccessResident", "cleanupRuntimeSessions",
  "collectJson", "createSession", "currentSession", "fetchIdentityDirectory", "fetchOidcUserInfo", "findAuthUser",
  "findCitizenAuthUserByPhone", "highRiskSecurityEvents", "isProductionRuntime", "issuePhoneVerificationCode",
  "mapExternalIdentityClaims", "maskPhone", "normalizePhone", "normalizeState", "phoneLoginLockStatus",
  "prependAuditTrailEntry", "productionAdapterCenter", "randomUUID", "readDatabase", "recordPhoneLoginFailure",
  "redactSensitiveResponse", "refreshOidcAccessToken", "refreshSessionStoreStatus", "requireApiRole",
  "revokeOidcToken", "revokeSession", "sendJson", "sessionStoreStatus", "verifyAuditTrail", "verifyPassword",
  "verifyPhoneCode", "verifySmsDeliveryCallback", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };
