"use strict";

const DOMAIN = "care-coordination";
const PROCESS = "T05";
const DEPENDENCIES = Object.freeze([
  "APPOINTMENT_CONTRACT_ID", "CareServiceRuntime", "RegistrationReferralService", "WORKFLOW_COLLECTIONS",
  "WORKFLOW_ROLE_COLLECTIONS", "acknowledgeReferralTeleconsultationEscalation", "appendDataAccessLog",
  "appendDrugConsumableAuditTrail", "appendReferralTeleconsultationNotifications", "appendSecurityEvent",
  "applyAppointmentIntegrationReconciliationAction", "applyCitizenTaskAction", "applyInternetNursingOrderAction",
  "applyReferralTeleconsultationAction", "applyRegistrationCancel", "applyRegistrationDisruptionAction",
  "applyRegistrationJourneyAction", "applyRegistrationWaitlistAction", "assertReferralCallbackResident",
  "buildCareServiceProductionReadiness", "buildCitizenTaskActionMessage", "buildCountyAcceptanceLedger",
  "buildEscortServiceDashboard", "buildInternetNursingActionMessage", "buildInternetNursingDashboard",
  "buildLifecycleActionClosureMessage", "buildMultiPracticeRegistry", "buildMultiPracticeTaskMessage",
  "buildPrimaryPracticeConfirmation", "buildReferralConsortiumClosedLoopMetrics", "buildReferralInsurancePerformancePolicy",
  "buildReferralTeleconsultationEscalations", "buildReferralTeleconsultationJointTestLedger",
  "buildReferralTeleconsultationJointTestPack", "buildReferralTeleconsultationPersonalRecord",
  "buildReferralTeleconsultationSignoffSummary", "buildRegistrationDashboard", "buildRegistrationIntegrationCenter",
  "buildRegistrationJourneyTaskMessage", "buildRegistrationNotificationDeliveries", "buildRegistrationTaskMessage",
  "buildRegistrationWaitlistCenter", "buildRegistrationWaitlistDeliveries", "buildRegistrationWaitlistTaskMessage",
  "buildUnifiedTasks", "canAccessEscortOrder", "canAccessInternetNursingOrder", "canAccessMultiPracticeApplication",
  "canAccessReferralTeleconsultation", "canAccessRegistrationOrder", "canAccessRegistrationSchedule",
  "canAccessRegistrationWaitlistEntry", "canAccessResident", "canAccessTaskMessage", "canManageAppointmentIntegrationEvent",
  "careServiceActor", "careServiceCommandId", "careServiceCreatePayload", "careServicePlatformAdapter",
  "careServiceReadinessPublicSummary", "careServiceTransitionInput", "cleanMultiPracticePatch", "cleanWorkflowUpdates",
  "collectJson", "completeReferralTeleconsultationJointTestTask", "createReferralTeleconsultationEscalationMessage",
  "createReferralTeleconsultationJointTestTasks", "createTaskMessage", "findWorkflowCollection", "isClosedTaskStatus",
  "landAppointmentIntegrationEvent", "normalizeInternetNursingOrder", "normalizeMultiPracticeApplication",
  "normalizeReferralTeleconsultation", "normalizeReferralTeleconsultationCallback",
  "normalizeReferralTeleconsultationFeedbackCallback", "normalizeReferralTeleconsultationScheduleCallback",
  "normalizeReferralTeleconsultationStatus", "normalizeRegistrationOrder", "normalizeRegistrationWaitlistEntry",
  "normalizeState", "patchBusinessCollectionItem", "prependAuditTrailEntry", "promoteNextRegistrationWaitlist",
  "randomUUID", "readDatabase", "redactSensitiveResponse", "refreshBirthStatistics", "refreshMultiPracticeReviewState",
  "requireApiRole", "resealAuditTrail", "resolveMultiPracticeLifecyclePatch", "sealAuditTrail", "seedRegistrationSchedules",
  "sendCareServiceError", "sendJson", "updateIntegrationEvent", "upsertReferralTeleconsultationSignoff",
  "verifyDoctorElectronicRegistration", "verifyIntegrationSignature", "workflowStateCollectionKey", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };
