"use strict";

const DOMAIN = "shared";
const PROCESS = "T09";
const DEPENDENCIES = Object.freeze([
  "BloodClinicalProduction", "EmergencyModuleGate", "SERVICE_ORDER_SOURCE_COLLECTIONS", "T10SpecialtyModuleGovernance",
  "appendDataAccessLog", "appendSecurityEvent", "applyPilotInterfaceReviewAction", "authorizationState",
  "buildAuthorizationLifecycle", "buildConsortiumPerformanceReport", "buildDataGovernanceOverview", "buildDataQualityIssues",
  "buildDataQualityScorecard", "buildDrugConsumableSupervision",
  "buildDrugTraceabilityEvidenceSubmission", "buildMasterDataDirectory", "buildMobileExperience", "buildMultiPracticeRegistry",
  "buildObservabilityAlertCenter", "buildPilotAcceptanceCenter", "buildPriorityApplicationTemplates", "buildServiceAcceptanceSummary",
  "buildServiceOrderSummary", "buildSpecialtyCutoverPack",
  "buildT10PlatformBlockedReadiness", "calculateCreditEvaluations", "canAccessResident", "canAccessServiceOrder",
  "canReadT10InstitutionModules", "collectJson", "dispatchAlert", "normalizeServiceOrders", "normalizeState",
  "prependAuditTrailEntry", "randomUUID", "readDatabase", "redactSensitiveResponse", "regionalSharingReadModel", "requireApiRole",
  "resealAuditTrail", "scopeStateForUser",
  "sealAuditTrail", "seedAccessibilityChecklist", "seedMobileExperienceSettings", "sendJson",
  "sendT10SpecialtyModuleError", "trustedT10Institution", "updateDrugConsumableSupervision", "upsertAlertDeliveryIncident",
  "validateAlert", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };

