"use strict";

const DOMAIN = "citizen-chronic";
const PROCESS = "T04";
const DEPENDENCIES = Object.freeze([
  "CitizenRecordsPolicy", "CitizenRecordsV1", "CitizenRecordsV2", "PERSONAL_RECORD_PROTECTED_FIELDS",
  "appendDataAccessLog", "appendSecurityEvent", "applyCitizenLifecycleAction", "applyCitizenOperationsAction",
  "buildChronicAcceptanceLedger", "buildChronicArchiveStandardization", "buildChronicFollowupSummary",
  "buildChronicInstitutionInterfaceReport", "buildChronicInteroperabilityProfiles", "buildChronicLaunchCoreReport",
  "buildChronicPathwayQualityReport", "buildChronicPharmacyInsuranceClosure", "buildChronicProductionSafetyEvidenceBridge",
  "buildChronicProductionSafetyReport", "buildChronicPublicHealthLoop", "buildChronicReferralContinuity",
  "buildChronicRiskStratification", "buildCitizenLifecycleActionMessage", "buildCitizenLifecycleActions",
  "buildCitizenOperationsCenter", "buildCitizenOperationsPublic", "canAccessResident", "canManageResidentProfile",
  "citizenCareIdempotencyKey", "citizenCareReceipt", "citizenCareReplay", "citizenCareRequestDigest",
  "citizenCareWorkspace", "cleanResidentPatch", "closeFamilyDoctorChronicAction", "collectJson", "createHash",
  "dispatchChronicFollowupAction", "escalateChronicFollowupAction", "ingestChronicDeviceMeasurement", "mergeByKey",
  "normalizePersonalRecord", "normalizeState", "patchBusinessCollectionItem", "personIndexForResident",
  "prependAuditTrailEntry", "randomUUID", "readDatabase", "recordChronicLaunchCoreAction",
  "recordChronicPharmacyCallback", "recordChronicReferralContinuity", "redactSensitiveResponse", "requireApiRole",
  "scheduleChronicReminderOutreach", "scopeStateForUser", "sealAuditTrail", "seedCitizenHospitalServiceConfigs",
  "seedCitizenIdentityReviewCases", "seedCitizenOperationContents", "seedCitizenServiceBlacklist", "sendJson",
  "upsertChronicFeedback", "upsertResidentExperienceCheckin", "validateChronicInteroperabilityMessage", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };
