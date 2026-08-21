"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTRACT_ID,
  applyCompliantExportAction,
  createCompliantExportRequest,
  isExportVisibleToUser
} = require("../src/http/research/compliant-export-workflow");

function approvedDataset() {
  return {
    id: "rd-test-001",
    name: "Approved cohort",
    governance: {
      retentionDays: 180,
      policyBasis: ["PIPL"]
    },
    evidenceDocuments: [{ type: "data-use-agreement", referenceNo: "DUA-TEST-001", status: "verified" }]
  };
}

function createRequest(overrides = {}) {
  return createCompliantExportRequest({
    purpose: "approved de-identified cohort counts",
    destination: "governance-reviewed-share",
    requestedFields: ["ageBand", "riskLevel"],
    exportFormat: "csv",
    ...overrides
  }, { role: "institution", username: "hospital" }, approvedDataset(), {
    now: "2026-08-21T01:00:00.000Z",
    idGenerator: () => "request-001"
  });
}

test("compliant export requires independent approval before release", () => {
  const requested = createRequest();
  assert.equal(requested.contractId, CONTRACT_ID);
  assert.equal(requested.domainVersion, 1);
  assert.equal(requested.reviewStatus, "pending");
  assert.equal(requested.exportStatus, "blocked");
  assert.equal(requested.minimumNecessary, false);
  assert.equal(requested.watermark, "");
  assert.deepEqual(requested.decisionHistory.map((item) => item.action), ["requested"]);

  const approved = applyCompliantExportAction(requested, {
    action: "approve",
    expectedVersion: 1,
    reviewEvidenceRef: "REVIEW-001",
    reviewNote: "Minimum necessary field set verified."
  }, { role: "commission", username: "health" }, {
    commandId: "approve-001",
    now: "2026-08-21T02:00:00.000Z"
  });
  assert.equal(approved.replayed, false);
  assert.equal(approved.exportRecord.domainVersion, 2);
  assert.equal(approved.exportRecord.reviewStatus, "approved");
  assert.equal(approved.exportRecord.exportStatus, "approved-pending-release");
  assert.equal(approved.exportRecord.minimumNecessary, true);
  assert.equal(approved.exportRecord.reviewer, "health");

  const released = applyCompliantExportAction(approved.exportRecord, {
    action: "release",
    expectedVersion: 2,
    releaseEvidenceRef: "RELEASE-001",
    watermark: "wm-rd-test-001"
  }, { role: "commission", username: "health" }, {
    commandId: "release-001",
    now: "2026-08-21T03:00:00.000Z"
  });
  assert.equal(released.exportRecord.domainVersion, 3);
  assert.equal(released.exportRecord.exportStatus, "released");
  assert.equal(released.exportRecord.releasedBy, "health");
  assert.equal(released.exportRecord.watermark, "wm-rd-test-001");
  assert.deepEqual(released.exportRecord.decisionHistory.map((item) => item.action), ["requested", "approve", "release"]);
});

test("compliant export commands enforce CAS and idempotency", () => {
  const requested = createRequest();
  const payload = {
    action: "approve",
    expectedVersion: 1,
    reviewEvidenceRef: "REVIEW-001",
    reviewNote: "approved"
  };
  const approved = applyCompliantExportAction(requested, payload, { role: "commission", username: "health" }, {
    commandId: "approve-001",
    now: "2026-08-21T02:00:00.000Z"
  });
  const replay = applyCompliantExportAction(approved.exportRecord, payload, { role: "commission", username: "health" }, {
    commandId: "approve-001",
    now: "2026-08-21T04:00:00.000Z"
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.exportRecord.domainVersion, 2);
  assert.throws(() => applyCompliantExportAction(approved.exportRecord, {
    ...payload,
    reviewNote: "changed"
  }, { role: "commission", username: "health" }, { commandId: "approve-001" }), (error) => (
    error.code === "RESEARCH_EXPORT_IDEMPOTENCY_CONFLICT" && error.status === 409
  ));
  assert.throws(() => applyCompliantExportAction(approved.exportRecord, {
    action: "release",
    expectedVersion: 1,
    releaseEvidenceRef: "RELEASE-001",
    watermark: "wm-test"
  }, { role: "commission", username: "health" }, { commandId: "release-stale" }), (error) => (
    error.code === "RESEARCH_EXPORT_VERSION_CONFLICT" && error.status === 409
  ));
});

test("requester separation, role, identifiers, and read scope fail closed", () => {
  const requested = createRequest();
  assert.throws(() => applyCompliantExportAction(requested, {
    action: "approve",
    expectedVersion: 1,
    reviewEvidenceRef: "REVIEW-001"
  }, { role: "commission", username: "hospital" }, { commandId: "self-review" }), (error) => (
    error.code === "RESEARCH_EXPORT_REVIEWER_SEPARATION_REQUIRED" && error.status === 403
  ));
  assert.throws(() => applyCompliantExportAction(requested, {
    action: "approve",
    expectedVersion: 1,
    reviewEvidenceRef: "REVIEW-001"
  }, { role: "institution", username: "community" }, { commandId: "wrong-role" }), (error) => (
    error.code === "RESEARCH_EXPORT_REVIEW_ROLE_REQUIRED" && error.status === 403
  ));
  assert.throws(() => createRequest({ requestedFields: ["ageBand", "resident.id_card"] }), (error) => (
    error.code === "RESEARCH_EXPORT_DIRECT_IDENTIFIER_FORBIDDEN" && error.status === 403
  ));
  assert.equal(isExportVisibleToUser(requested, { role: "commission", username: "health" }), true);
  assert.equal(isExportVisibleToUser(requested, { role: "institution", username: "hospital" }), true);
  assert.equal(isExportVisibleToUser(requested, { role: "institution", username: "community" }), false);
});
