"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTRACT_ID,
  applyCompliantExportAction,
  createCompliantExportRequest,
  isExportVisibleToUser
} = require("../src/http/research/compliant-export-workflow");
const { createRouteSegments } = require("../src/http/routes/research");

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

test("research action route proves identity, replay, conflict, CAS, and audit behavior", async () => {
  let state = {
    compliantDataExports: [createRequest()],
    researchDatasets: [approvedDataset()],
    researchAudits: []
  };
  let payload = {
    action: "approve",
    expectedVersion: 1,
    reviewEvidenceRef: "REVIEW-ROUTE-001",
    reviewNote: "route-level behavior proof"
  };
  let user = { role: "commission", username: "health", name: "监管用户" };
  let writes = 0;
  let reads = 0;
  const runtime = {
    appendResearchAudit(data, actor, dataset, action, detail, result) {
      data.researchAudits.push({ actor: actor.username, datasetId: dataset.id, action, detail, result });
    },
    buildResearchSandboxSummary: () => ({}),
    collectJson: async () => payload,
    normalizeResearchApproval: () => ({}),
    normalizeResearchDatasetApplication: () => ({}),
    normalizeResearchEvidenceDocument: () => ({}),
    readDatabase() {
      reads += 1;
      return state;
    },
    requireApiRole: () => user,
    requireDatasetSandboxAccess: () => true,
    sendJson(res, status, body) {
      res.statusCode = status;
      res.body = body;
    },
    writeDatabase(next) {
      writes += 1;
      state = next;
    }
  };
  const segments = createRouteSegments(runtime);
  const dispatch = async (commandId) => {
    const res = {};
    const req = { method: "POST", headers: { "idempotency-key": commandId } };
    const url = new URL("http://localhost/api/research/compliant-exports/cde-rd-test-001-request-001/actions");
    let handled = false;
    for (const segment of segments) {
      if (await segment.handle(req, res, url)) {
        handled = true;
        break;
      }
    }
    assert.equal(handled, true);
    return res;
  };

  const deniedReads = reads;
  user = null;
  const denied = await dispatch("research-route-denied");
  assert.equal(denied.statusCode, undefined);
  assert.equal(reads, deniedReads);

  user = { role: "commission", username: "health", name: "监管用户" };
  const accepted = await dispatch("research-route-approve-001");
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.replayed, false);
  assert.equal(accepted.body.domainVersion, 2);
  assert.equal(writes, 1);
  assert.equal(state.researchAudits.length, 1);

  const replay = await dispatch("research-route-approve-001");
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.domainVersion, 2);
  assert.equal(writes, 1);
  assert.equal(state.researchAudits.length, 1);

  payload = { ...payload, reviewNote: "conflicting payload" };
  const conflict = await dispatch("research-route-approve-001");
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.code, "RESEARCH_EXPORT_IDEMPOTENCY_CONFLICT");
  assert.equal(writes, 2);
  assert.equal(state.researchAudits.at(-1).result, "denied");

  payload = {
    action: "release",
    expectedVersion: 1,
    releaseEvidenceRef: "RELEASE-ROUTE-001",
    watermark: "wm-route"
  };
  const stale = await dispatch("research-route-release-stale");
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.code, "RESEARCH_EXPORT_VERSION_CONFLICT");
  assert.equal(writes, 3);
  assert.equal(state.researchAudits.at(-1).result, "denied");
});
