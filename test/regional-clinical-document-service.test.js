"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Service = require("../src/platform/integration/regional-clinical-document-service");

function fixture() {
  return {
    integrationGatewayEvents: [
      {
        id: "doc-mr1-discharge",
        contractId: "emr-summary-v1",
        resource: "MedicalSummary",
        externalId: "DIS-MR1-001",
        residentId: "resident-mr1-001",
        institutionCode: "MR1",
        status: "accepted",
        signatureVerified: true,
        receivedAt: "2026-09-04T08:00:00.000Z",
        reconciliationStatus: "provider-accepted",
        payload: {
          documentType: "discharge-summary",
          institutionCode: "MR1",
          residentId: "resident-mr1-001",
          dischargedAt: "2026-09-04T07:00:00.000Z",
          diagnosis: "出院诊断摘要",
          dischargeSummary: "完成住院诊疗并按计划出院",
          secureAttachmentId: "attachment-discharge-1",
          accessToken: "must-not-leak"
        },
        requestPayload: { secret: "must-not-leak", payload: { rawDocument: "must-not-leak" } },
        retryCount: 0,
        deadLetter: false
      },
      {
        id: "doc-mr1-card-exception",
        contractId: "emr-summary-v1",
        resource: "MedicalSummary",
        externalId: "EMR-MR1-002",
        residentId: "resident-mr1-002",
        institutionCode: "MR1",
        status: "failed",
        signatureVerified: true,
        receivedAt: "2026-09-03T08:00:00.000Z",
        payload: {
          documentType: "medical-record-card",
          institutionCode: "MR1",
          residentId: "resident-mr1-002",
          recordDate: "2026-09-03",
          diagnosis: "门诊诊疗摘要"
        },
        retryCount: 2,
        deadLetter: true,
        deadLetterReason: "raw upstream error must not leak"
      },
      {
        id: "doc-mr2-card",
        contractId: "emr-summary-v1",
        resource: "MedicalSummary",
        externalId: "EMR-MR2-001",
        residentId: "resident-mr2-001",
        institutionCode: "MR2",
        status: "accepted",
        signatureVerified: true,
        receivedAt: "2026-09-04T08:30:00.000Z",
        payload: {
          documentType: "medical-record-card",
          institutionCode: "MR2",
          residentId: "resident-mr2-001",
          recordDate: "2026-09-04",
          diagnosis: "另一机构诊疗摘要"
        }
      },
      { id: "payment-event", contractId: "payment-transaction-v1", payload: { institutionCode: "MR1" } }
    ],
    secureAttachments: [{
      id: "attachment-discharge-1",
      status: "active",
      scanStatus: "clean",
      filename: "discharge-summary.pdf",
      objectKey: "must-not-leak"
    }]
  };
}

test("commission receives cross-institution operational projections without clinical content", () => {
  const center = Service.buildRegionalClinicalDocumentCenter(
    fixture(),
    { role: "commission", orgCode: "COMMISSION", username: "health" },
    { now: "2026-09-04T12:00:00.000Z" }
  );
  assert.equal(center.schemaVersion, "regional-clinical-document-center-v1");
  assert.equal(center.productionReady, false);
  assert.equal(center.summary.documents, 3);
  assert.equal(center.summary.institutions, 2);
  assert.equal(center.summary.collectedToday, 2);
  assert.equal(center.summary.dischargeSummaries, 1);
  assert.equal(center.summary.medicalRecordCards, 2);
  assert.equal(center.summary.exceptions, 1);
  assert.equal(center.actions.retryExceptions, true);
  assert.equal(center.documents.every((item) => item.clinicalSummary === ""), true);
  assert.equal(center.documents.every((item) => item.pdf.available === false), true);
  assert.equal(center.exceptions[0].actions.retryException, true);
  const serialized = JSON.stringify(center);
  assert.doesNotMatch(serialized, /must-not-leak|raw upstream error|objectKey|requestPayload|accessToken/);
});

test("institution is strictly scoped and can query minimized detail and verified PDF", () => {
  const center = Service.buildRegionalClinicalDocumentCenter(
    fixture(),
    { role: "institution", orgCode: "MR1", username: "doctor" },
    { now: "2026-09-04T12:00:00.000Z" }
  );
  assert.equal(center.summary.documents, 2);
  assert.equal(center.documents.every((item) => item.institutionCode === "MR1"), true);
  assert.equal(center.documents.some((item) => item.clinicalSummary === "完成住院诊疗并按计划出院"), true);
  assert.equal(center.documents.find((item) => item.id === "doc-mr1-discharge").pdf.available, true);
  assert.equal(center.documents.find((item) => item.id === "doc-mr1-discharge").pdf.attachmentId, "attachment-discharge-1");
  assert.equal(center.actions.retryExceptions, false);
  assert.equal(center.workstationReminders.length, 2);
  assert.equal(center.documents.some((item) => item.residentReference.includes("resident-mr1-001")), false);
});

test("institution without a trusted organization binding fails closed", () => {
  assert.throws(
    () => Service.buildRegionalClinicalDocumentCenter(fixture(), { role: "institution", orgCode: "" }),
    (error) => error.code === "REGIONAL_CLINICAL_DOCUMENT_SCOPE_REQUIRED" && error.statusCode === 403
  );
});

test("unrelated roles are rejected before any projection is built", () => {
  assert.throws(
    () => Service.buildRegionalClinicalDocumentCenter(fixture(), { role: "citizen", orgCode: "MR1" }),
    (error) => error.code === "REGIONAL_CLINICAL_DOCUMENT_ROLE_FORBIDDEN" && error.statusCode === 403
  );
});

