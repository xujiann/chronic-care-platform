const P0_INTERFACES = Object.freeze([
  { id: "P0-01", domain: "HIS", contractId: "his-patient-v1", direction: "inbound", target: "personalRecords", businessOwner: "medical-affairs-office", technicalOwner: "hospital-information-center", externalParty: "pilot-hospital-HIS-vendor" },
  { id: "P0-02", domain: "EMR", contractId: "emr-summary-v1", direction: "inbound", target: "personalRecords", businessOwner: "medical-affairs-office", technicalOwner: "hospital-information-center", externalParty: "pilot-hospital-EMR-vendor" },
  { id: "P0-03", domain: "LIS", contractId: "lis-report-v1", direction: "inbound", target: "diagnosticReports", businessOwner: "laboratory-department", technicalOwner: "medical-resource-center", externalParty: "pilot-hospital-LIS-vendor" },
  { id: "P0-04", domain: "PACS", contractId: "pacs-report-v1", direction: "inbound", target: "diagnosticReports", businessOwner: "radiology-department", technicalOwner: "medical-resource-center", externalParty: "pilot-hospital-PACS-vendor" },
  { id: "P0-05", domain: "INSURANCE", contractId: "insurance-settlement-v1", direction: "bidirectional", target: "insuranceClaims", businessOwner: "medical-insurance-office", technicalOwner: "cross-agency-integration", externalParty: "regional-insurance-platform" },
  { id: "P0-06", domain: "CERTIFICATE", contractId: "certificate-sync-v1", direction: "bidirectional", target: "digitalCredentials", businessOwner: "government-service-office", technicalOwner: "cross-agency-integration", externalParty: "electronic-certificate-platform" },
  { id: "P0-07", domain: "PUBLIC_HEALTH", contractId: "public-health-direct-report-v1", direction: "outbound-callback", target: "publicHealthEvents", businessOwner: "disease-control-office", technicalOwner: "public-health-integration", externalParty: "public-health-direct-report-platform" }
]);

const FIELD_RESPONSIBILITY_MATRIX = Object.freeze([
  { contractId: "his-patient-v1", identity: "HIS: externalId/residentId/visitNo", clinical: "medical-affairs: encounter type/status", organization: "hospital-information-center: institution/department codes", platform: "T03: validation/idempotency/personalRecords projection" },
  { contractId: "emr-summary-v1", identity: "EMR: externalId/residentId/documentNo", clinical: "medical-affairs: diagnosis/code/summary", organization: "hospital-information-center: author department", platform: "T03: minimization/idempotency/personalRecords projection" },
  { contractId: "lis-report-v1", identity: "LIS: externalId/residentId/specimenNo", clinical: "laboratory: item/result/flag/unit/report time", organization: "hospital-information-center: institution code", platform: "T03: diagnostic landing/direct-report trigger" },
  { contractId: "pacs-report-v1", identity: "PACS: externalId/residentId/accessionNo", clinical: "radiology: modality/conclusion/body part", organization: "hospital-information-center: institution code", platform: "T03: reference-only imaging projection; no binary DICOM" },
  { contractId: "insurance-settlement-v1", identity: "hospital/insurance: claimNo/residentId/settlementNo", clinical: "insurance office: claim type/disease type", organization: "hospital: institutionCode", platform: "T03: amount/status validation, callback projection, reconciliation" },
  { contractId: "certificate-sync-v1", identity: "certificate platform: externalId/certificateNo/subjectReference", clinical: "government-service office: certificate type/status", organization: "government-service office: provider", platform: "T03: resident resolution, callback projection, reconciliation" },
  { contractId: "public-health-direct-report-v1", identity: "T03: versioned keyed-HMAC subject/specimen pseudonyms", clinical: "disease-control/laboratory: disease/test/result/report type", organization: "hospital: reporting institution code", platform: "T03: minimized signed dispatch, callback and dead-letter compensation" }
]);

const EXTERNAL_DEPENDENCIES = Object.freeze([
  "official field dictionaries, code systems and contract version signoff",
  "site HTTPS endpoints, VPN or network allowlists and DNS/TLS chain",
  "non-production machine accounts, HMAC secrets or certificates with rotation owners",
  "test resident linkage data authorized for joint testing",
  "provider callback URLs and callback signing secrets",
  "joint-test windows, vendor contacts and incident escalation roster",
  "signed receipts, reconciliation statements and failure-replay evidence"
]);

const IMPLEMENTATION_STEPS = Object.freeze([
  "freeze contract version, field owner and code dictionaries",
  "configure isolated joint-test endpoints, identities, signing keys and allowlists",
  "run signature, required-field, minimization and institution-scope negative cases",
  "run one normal transaction and one idempotent replay for every P0 contract",
  "run timeout, retry, dead-letter, callback replay and manual compensation cases",
  "reconcile source, gateway ledger and target business record counts and amounts",
  "collect masked request digests, provider receipts, callback evidence and owner signoffs",
  "T00 wires shared routes/persistence and publishes the final release gate"
]);

const ENVIRONMENT_REQUIREMENTS = Object.freeze({
  common: ["NODE_ENV", "INTEGRATION_GATEWAY_SECRET"],
  hospital: ["HIS_ADAPTER_URL", "HIS_ADAPTER_SECRET", "EMR_ADAPTER_URL", "EMR_ADAPTER_SECRET", "LIS_ADAPTER_URL", "LIS_ADAPTER_SECRET", "PACS_ADAPTER_URL", "PACS_ADAPTER_SECRET", "HOSPITAL_ADAPTER_TIMEOUT_MS", "HOSPITAL_ADAPTER_MAX_ATTEMPTS"],
  insurance: ["INSURANCE_GATEWAY_URL", "INSURANCE_GATEWAY_SECRET", "INSURANCE_CALLBACK_SECRET"],
  certificate: ["CERTIFICATE_GATEWAY_URL", "CERTIFICATE_GATEWAY_SECRET", "CERTIFICATE_CALLBACK_SECRET"],
  publicHealth: ["PUBLIC_HEALTH_DIRECT_REPORT_URL", "PUBLIC_HEALTH_DIRECT_REPORT_SECRET", "PUBLIC_HEALTH_REFERENCE_SECRET", "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET", "PUBLIC_HEALTH_DIRECT_REPORT_TIMEOUT_MS", "PUBLIC_HEALTH_DIRECT_REPORT_MAX_ATTEMPTS"]
});

const SAMPLE_MESSAGES = Object.freeze({
  his: { contractId: "his-patient-v1", idempotencyKey: "jt-his-001", payload: { externalId: "JT-VISIT-001", residentId: "JT-RESIDENT-001", institutionCode: "JT-HOSP-001", institution: "Joint Test Hospital", visitedAt: "2026-07-22T01:00:00Z", visitNo: "JT-V-001", visitStatus: "completed" } },
  emr: { contractId: "emr-summary-v1", idempotencyKey: "jt-emr-001", payload: { externalId: "JT-EMR-001", residentId: "JT-RESIDENT-001", institutionCode: "JT-HOSP-001", diagnosis: "test diagnosis", diagnosisCode: "JT-CODE-001", recordDate: "2026-07-22", documentNo: "JT-DOC-001" } },
  lis: { contractId: "lis-report-v1", idempotencyKey: "jt-lis-001", payload: { externalId: "JT-LAB-001", residentId: "JT-RESIDENT-001", institutionCode: "JT-HOSP-001", item: "joint test item", itemCode: "JT-LAB-CODE-001", result: "negative", resultFlag: "normal", reportedAt: "2026-07-22T01:30:00Z", publicHealthReportRequired: false } },
  pacs: { contractId: "pacs-report-v1", idempotencyKey: "jt-pacs-001", payload: { externalId: "JT-PACS-001", residentId: "JT-RESIDENT-001", institutionCode: "JT-HOSP-001", modality: "CT", conclusion: "joint test conclusion", reportedAt: "2026-07-22T01:40:00Z", imagingReference: "dicom-study:JT-1.2.3" } },
  insurance: { contractId: "insurance-settlement-v1", idempotencyKey: "jt-insurance-001", payload: { externalId: "JT-CLAIM-001", residentId: "JT-RESIDENT-001", institutionCode: "JT-HOSP-001", claimStatus: "succeeded", amount: 123.45, occurredAt: "2026-07-22T02:00:00Z" } },
  certificate: { contractId: "certificate-sync-v1", idempotencyKey: "jt-certificate-001", payload: { externalId: "JT-CERT-EXT-001", residentId: "JT-RESIDENT-001", institutionCode: "JT-AGENCY-001", certificateNo: "JT-CERT-001", status: "active", certificateType: "joint-test-certificate", occurredAt: "2026-07-22T02:10:00Z" } },
  publicHealth: { contractId: "public-health-direct-report-v1", idempotencyKey: "public-health-direct-report-v1|JT-HOSP-001|JT-LAB-POS-001", payload: { externalId: "JT-LAB-POS-001", subjectReference: `hmac-sha256:v1:${"1".repeat(64)}`, specimenReference: `hmac-sha256:v1:${"2".repeat(64)}`, institutionCode: "JT-HOSP-001", reportType: "infectious-disease-laboratory-positive", diseaseCode: "JT-DISEASE-001", testCode: "JT-LAB-CODE-001", resultFlag: "positive", occurredAt: "2026-07-22T02:20:00Z", reportedAt: "2026-07-22T02:21:00Z" } }
});

const TEST_CHECKLIST = Object.freeze([
  "valid signature accepted and invalid/expired signature rejected",
  "required fields, dates, amounts and official code values validated",
  "same scoped identity replays idempotently; changed payload conflicts",
  "cross-institution identity cannot overwrite another institution record",
  "embedded credentials, direct identifiers in direct-report payload and binary images rejected",
  "normal projection creates exactly one target record and traceable ledger evidence",
  "transient timeout retries are bounded and keep stable request identity",
  "permanent failure enters dead letter or P0 reconciliation without partial unscoped records",
  "corrected replay resolves the case within the retry limit",
  "callback nonce replay, amount mismatch, out-of-order and terminal-state regression rejected",
  "source/provider/platform counts and insurance amounts reconcile",
  "public status and evidence views expose no secret, nonce, raw payload or resident identifier"
]);

const ACCEPTANCE_STANDARDS = Object.freeze([
  "all seven P0 contracts have named business, technical and external owners",
  "each contract passes normal, duplicate, negative-validation and compensation scenarios",
  "HIS/EMR/LIS/PACS records are queryable from their target collections with ledger trace IDs",
  "insurance and certificate callbacks update business records only after verified state application",
  "positive LIS result produces a minimized public-health request and verified final receipt",
  "zero unresolved P0 reconciliation cases at acceptance cutoff",
  "source/provider/platform transaction count difference is zero; insurance amount difference is zero",
  "evidence package contains masked request digest, receipt, callback, retry and responsible-owner signoff",
  "T00 readiness report passes and productionReady remains false until real site evidence is attached"
]);

function buildJointTestPackage() {
  return {
    version: "t03-joint-test-package-v1",
    productionReady: false,
    p0Interfaces: P0_INTERFACES,
    fieldResponsibilityMatrix: FIELD_RESPONSIBILITY_MATRIX,
    externalDependencies: EXTERNAL_DEPENDENCIES,
    implementationSteps: IMPLEMENTATION_STEPS,
    environmentRequirements: ENVIRONMENT_REQUIREMENTS,
    sampleMessages: SAMPLE_MESSAGES,
    testChecklist: TEST_CHECKLIST,
    acceptanceStandards: ACCEPTANCE_STANDARDS
  };
}

module.exports = {
  ACCEPTANCE_STANDARDS,
  ENVIRONMENT_REQUIREMENTS,
  EXTERNAL_DEPENDENCIES,
  FIELD_RESPONSIBILITY_MATRIX,
  IMPLEMENTATION_STEPS,
  P0_INTERFACES,
  SAMPLE_MESSAGES,
  TEST_CHECKLIST,
  buildJointTestPackage
};
