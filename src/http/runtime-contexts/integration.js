"use strict";

const DOMAIN = "integration";
const PROCESS = "T08";
const DEPENDENCIES = Object.freeze([
  "APPOINTMENT_CONTRACT_ID", "PHYSICAL_EXAM_CONTRACT_ID", "appendDataAccessLog", "appendSecurityEvent",
  "applyObjectLifecycle", "buildIntegrationSample", "canAccessResident", "canAccessSecureAttachment", "collectJson",
  "createObjectDownloadIntent", "createObjectUploadIntent", "dispatchFinancialRequest", "dispatchHospitalRequest",
  "finalizeObjectUpload", "hospitalConnectorCenter", "landAppointmentIntegrationEvent", "landPhysicalExamIntegrationEvent",
  "normalizeHospitalConnectorDomain", "normalizeIntegrationEvent", "objectStorageCenter", "prependAuditTrailEntry",
  "randomUUID", "readDatabase", "requireApiRole", "sendJson", "summarizeIntegrationGateway",
  "updateIntegrationEvent", "validateAttachmentMetadata", "verifyIntegrationSignature", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };
