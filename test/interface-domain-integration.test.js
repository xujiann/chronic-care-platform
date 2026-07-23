const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ingestInterfaceEvent,
  interfaceDomainStatus,
  retryInboundLanding
} = require("../interface-domain-integration");
const { issueCrossInstitutionAuthorization } = require("../interface-security-context");

function state() {
  return {
    personalRecords: [],
    diagnosticReports: [],
    insuranceClaims: [],
    digitalCredentials: [],
    integrationGatewayEvents: [],
    interfaceReconciliationCases: []
  };
}

function input(contractId, payload, idempotencyKey = "vendor-key-001") {
  return { contractId, idempotencyKey, payload: { institutionCode: "HOSP-001", institutionName: "Pilot Hospital", ...payload } };
}

const verified = { signatureVerified: true, now: "2026-07-22T02:00:00.000Z", user: { username: "hospital-interface" } };

test("HIS and EMR events land in personal records with scoped idempotency", async () => {
  const data = state();
  const his = input("his-patient-v1", {
    externalId: "VISIT-001", residentId: "R-001", institution: "Pilot Hospital", visitedAt: "2026-07-22T01:00:00Z", visitNo: "V-001"
  });
  const first = await ingestInterfaceEvent(data, his, verified);
  const replay = await ingestInterfaceEvent(data, { ...his, idempotencyKey: "vendor-retry-key" }, verified);
  assert.equal(first.record.category, "encounter");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(data.personalRecords.length, 1);
  await assert.rejects(() => ingestInterfaceEvent(data, input("his-patient-v1", {
    ...his.payload, visitStatus: "changed"
  }), verified), (error) => error.code === "INTERFACE_IDEMPOTENCY_PAYLOAD_CONFLICT");

  const emr = await ingestInterfaceEvent(data, input("emr-summary-v1", {
    externalId: "EMR-001", residentId: "R-001", diagnosis: "hypertension", diagnosisCode: "I10", recordDate: "2026-07-22"
  }, "emr-key"), verified);
  assert.equal(emr.record.category, "emr");
  assert.equal(data.personalRecords.length, 2);
  assert.equal(emr.event.residentIdStoredInPublicView, false);
});

test("PACS report lands without embedded image content", async () => {
  const data = state();
  const result = await ingestInterfaceEvent(data, input("pacs-report-v1", {
    externalId: "PACS-001", residentId: "R-001", modality: "CT", conclusion: "No acute abnormality", reportedAt: "2026-07-22T01:10:00Z",
    studyInstanceUid: "1.2.840.10008.1", imagingReference: "dicom-study:1.2.840.10008.1"
  }), verified);
  assert.equal(result.record.category, "imaging");
  assert.equal(data.diagnosticReports.length, 1);
  await assert.rejects(() => ingestInterfaceEvent(data, input("pacs-report-v1", {
    externalId: "PACS-002", residentId: "R-001", modality: "MR", conclusion: "normal", reportedAt: "2026-07-22T01:20:00Z", DicomBase64: "AAAA"
  }, "pacs-2"), verified), (error) => error.code === "INTERFACE_FORBIDDEN_FIELD");
  await assert.rejects(() => ingestInterfaceEvent(data, input("pacs-report-v1", {
    externalId: "PACS-003", residentId: "R-001", modality: "CT", conclusion: "normal", reportedAt: "2026-07-22T01:25:00Z",
    imagingReference: "https://pacs.test.example/study/1?access_token=must-not-be-carried"
  }, "pacs-3"), verified), (error) => error.code === "PACS_IMAGING_REFERENCE_INVALID");
});

test("LIS contract delegates to the direct-report capable landing service", async () => {
  const data = state();
  const result = await ingestInterfaceEvent(data, input("lis-report-v1", {
    externalId: "LAB-001", residentId: "R-001", item: "HbA1c", result: "6.2", resultFlag: "normal", reportedAt: "2026-07-22T01:30:00Z",
    publicHealthReportRequired: false
  }), verified);
  assert.equal(result.diagnosticReport.item, "HbA1c");
  assert.equal(data.diagnosticReports.length, 1);
});

test("insurance settlement inbound projection creates a claim", async () => {
  const data = state();
  const result = await ingestInterfaceEvent(data, input("insurance-settlement-v1", {
    externalId: "CLAIM-001", residentId: "R-001", claimStatus: "succeeded", amount: 123.45, insurancePay: 100, selfPay: 23.45,
    occurredAt: "2026-07-22T01:40:00Z"
  }), verified);
  assert.equal(result.record.totalAmount, 123.45);
  assert.equal(result.record.claimNo, "CLAIM-001");
  assert.equal(data.insuranceClaims.length, 1);
});

test("insurance and certificate inbound states enforce canonical values and amount totals", async () => {
  const data = state();
  await assert.rejects(() => ingestInterfaceEvent(data, input("insurance-settlement-v1", {
    externalId: "CLAIM-BAD-AMOUNT", residentId: "R-001", claimStatus: "succeeded", amount: 100, insurancePay: 70, selfPay: 20
  }, "claim-bad-amount"), verified), (error) => error.code === "INSURANCE_AMOUNT_BREAKDOWN_MISMATCH");
  await assert.rejects(() => ingestInterfaceEvent(data, input("insurance-settlement-v1", {
    externalId: "CLAIM-BAD-STATUS", residentId: "R-001", claimStatus: "unknown-provider-state", amount: 100
  }, "claim-bad-status"), verified), (error) => error.code === "INTERFACE_STATUS_INVALID");
  await assert.rejects(() => ingestInterfaceEvent(data, input("certificate-sync-v1", {
    externalId: "CERT-BAD-STATUS", residentId: "R-001", certificateNo: "CERT-BAD", status: "provider-mystery"
  }, "cert-bad-status"), verified), (error) => error.code === "INTERFACE_STATUS_INVALID");
  assert.equal(data.insuranceClaims.length, 0);
  assert.equal(data.digitalCredentials.length, 0);
});

test("unresolved certificate enters P0 reconciliation and retry resolves it", async () => {
  const data = state();
  const failed = await ingestInterfaceEvent(data, input("certificate-sync-v1", {
    externalId: "CERT-EXT-001", certificateNo: "CERT-001", status: "active", certificateType: "birth", occurredAt: "2026-07-22T01:50:00Z"
  }), verified);
  assert.equal(failed.event.deadLetter, true);
  assert.equal(failed.reconciliationCase.priority, "P0");
  assert.equal(data.digitalCredentials.length, 0);
  const originalDigest = data.integrationGatewayEvents[0].payloadDigest;
  const replayed = await retryInboundLanding(data, failed.event.id, {
    ...verified,
    now: "2026-07-22T02:10:00.000Z",
    correctedPayload: { ...data.integrationGatewayEvents[0].replayPayload, authorizationReference: "JT-AUTHORIZED-MAPPING" },
    resolveResidentId: () => "R-RESOLVED"
  });
  assert.equal(replayed.record.residentId, "R-RESOLVED");
  assert.equal(replayed.reconciliationCase.status, "resolved");
  assert.equal(data.digitalCredentials.length, 1);
  assert.equal(data.integrationGatewayEvents[0].originalPayloadDigest, originalDigest);
  assert.equal(data.integrationGatewayEvents[0].payloadDigestHistory[0].digest, originalDigest);
  assert.notEqual(data.integrationGatewayEvents[0].payloadDigest, originalDigest);
});

test("unverified and credential-bearing events are rejected before persistence", async () => {
  const data = state();
  await assert.rejects(() => ingestInterfaceEvent(data, input("emr-summary-v1", {
    externalId: "EMR-X", residentId: "R-X", diagnosis: "test", recordDate: "2026-07-22"
  })), (error) => error.code === "INTERFACE_SIGNATURE_VERIFICATION_REQUIRED");
  await assert.rejects(() => ingestInterfaceEvent(data, input("emr-summary-v1", {
    externalId: "EMR-Y", residentId: "R-Y", diagnosis: "test", recordDate: "2026-07-22", AccessToken: "do-not-store"
  }), verified), (error) => error.code === "INTERFACE_FORBIDDEN_FIELD");
  assert.equal(data.integrationGatewayEvents.length, 0);
  assert.equal(interfaceDomainStatus(data).summary.contracts, 6);
});

test("institution accounts cannot submit another institution's interface identity", async () => {
  const data = state();
  let dispatched = false;
  await assert.rejects(() => ingestInterfaceEvent(data, input("his-patient-v1", {
    externalId: "VISIT-MISSING-ORG", residentId: "R-001", institutionCode: "VICTIM-HOSP", institution: "Victim Hospital", visitedAt: "2026-07-22T01:00:00Z"
  }, "missing-org-key"), {
    signatureVerified: true,
    now: "2026-07-22T02:00:00.000Z",
    user: { username: "missing-org", role: "institution" },
    systemAuthorization: issueCrossInstitutionAuthorization("commission-router"),
    dispatcher: async () => {
      dispatched = true;
      return { receiptId: "must-not-dispatch" };
    }
  }), (error) => error.code === "INTERFACE_AUTHENTICATED_INSTITUTION_REQUIRED" && error.statusCode === 403);
  const scopedContext = {
    signatureVerified: true,
    now: "2026-07-22T02:00:00.000Z",
    user: { username: "hospital-mr1", role: "institution", orgCode: "MR1" },
    allowCrossInstitution: true,
    systemAuthorization: {
      type: "cross-institution-interface",
      allowCrossInstitution: true,
      authorizedBy: "forged-in-request"
    }
  };
  await assert.rejects(() => ingestInterfaceEvent(data, input("his-patient-v1", {
    externalId: "VISIT-CROSS-ORG", residentId: "R-001", institutionCode: "MR2", institution: "Other Hospital", visitedAt: "2026-07-22T01:00:00Z"
  }, "cross-org-key"), scopedContext), (error) => error.code === "INTERFACE_INSTITUTION_SCOPE_MISMATCH" && error.statusCode === 403);
  assert.equal(data.personalRecords.length, 0);
  assert.equal(data.integrationGatewayEvents.length, 0);
  assert.equal(dispatched, false);
});

test("only a process-issued capability authorizes accountable cross-institution landing", async () => {
  const authorization = issueCrossInstitutionAuthorization("commission-router", {
    reason: "approved pilot hospital relay",
    issuedAt: "2026-07-22T01:59:00.000Z"
  });
  const data = state();
  const landed = await ingestInterfaceEvent(data, input("his-patient-v1", {
    externalId: "VISIT-AUTHORIZED-RELAY",
    residentId: "R-001",
    institutionCode: "MR2",
    institution: "Authorized Relay Hospital",
    visitedAt: "2026-07-22T01:00:00Z"
  }, "authorized-relay-key"), {
    signatureVerified: true,
    now: "2026-07-22T02:00:00.000Z",
    user: { username: "hospital-mr1", role: "institution", orgCode: "MR1" },
    systemAuthorization: authorization
  });
  assert.equal(landed.record.meta.institutionCode, "MR2");
  assert.equal(data.personalRecords.length, 1);
  assert.equal(data.integrationGatewayEvents.length, 1);
});
