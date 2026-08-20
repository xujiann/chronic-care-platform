"use strict";

const DOMAIN = "identity-security";
const PROCESS = "T01";
const DEPENDENCIES = Object.freeze([
  "SmsDeliveryCallbackError", "appendDataAccessLog", "appendSecurityEvent", "applyIdentityDirectoryBinding",
  "applyIdentityDirectoryDeactivations", "applySmsDeliveryCallback", "authLoginLockStatus", "buildComplianceReport",
  "buildIdentityDirectorySyncPlan", "buildSmsDeliveryCenter", "canAccessResident", "cleanupRuntimeSessions",
  "clearAuthLoginFailures", "clearPhoneLoginFailures", "collectJson", "consumeAuthRateLimit", "createSession", "currentSession", "fetchIdentityDirectory", "fetchOidcUserInfo", "findAuthUser",
  "findCitizenAuthUserByPhone", "highRiskSecurityEvents", "isProductionRuntime", "issuePhoneVerificationCode",
  "mapExternalIdentityClaims", "maskPhone", "normalizePhone", "normalizeState", "phoneLoginLockStatus",
  "prependAuditTrailEntry", "productionAdapterCenter", "randomUUID", "readDatabase", "recordAuthLoginFailure", "recordPhoneLoginFailure",
  "redactSensitiveResponse", "refreshOidcAccessToken", "refreshSessionStoreStatus", "requestRateLimitSubject",
  "requireApiRole", "revokeOidcToken", "revokeSession", "sendJson", "sessionStoreStatus", "verifyAuditTrail", "verifyPassword",
  "verifyPhoneCode", "verifySmsDeliveryCallback", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };
