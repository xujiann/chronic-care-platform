"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTRACT_ID,
  READ_MODEL_DEPENDENCIES,
  buildResearchSandboxReadModel,
  canReadResearchDataset,
  normalizeResearchPurpose
} = require("../src/http/research/sandbox-read-model");
const {
  isSharedRouteAllowed,
  protectSharedRouteSegments
} = require("../src/http/shared/route-policy");

function approvedDataset(overrides = {}) {
  return {
    id: "rd-test-001",
    diseaseType: "hypertension",
    name: "Internal cohort name",
    version: "1.0.0",
    records: 8,
    status: "published",
    authorizationStatus: "approved",
    ethicsStatus: "approved",
    deidentificationStatus: "released",
    sourceCollections: ["personalRecords", "diagnosticReports"],
    createdBy: "hospital",
    accessRequests: [{ by: "hospital", status: "submitted" }],
    governance: {
      dataUseAgreement: "DUA-TEST",
      minimumNecessary: true,
      reidentificationProhibited: true,
      exportReviewRequired: true,
      retentionDays: 180
    },
    evidenceDocuments: [
      { type: "ethics-approval", status: "verified" },
      { type: "data-use-agreement", status: "verified" }
    ],
    sandbox: { status: "active" },
    ...overrides
  };
}

test("research read model is versioned, read-only, and suppresses small cells", () => {
  const readModel = buildResearchSandboxReadModel(approvedDataset());
  assert.equal(readModel.contract.id, CONTRACT_ID);
  assert.equal(readModel.contract.mode, "read-only");
  assert.deepEqual(readModel.provenance.readModelDependencies, READ_MODEL_DEPENDENCIES);
  assert.deepEqual(readModel.provenance.crossDomainReads, []);
  assert.equal(readModel.provenance.rawRecordAccess, false);
  assert.deepEqual(readModel.cohort.recordCount, {
    value: null,
    suppressed: true,
    reason: "minimum-cell-size-10"
  });
  const serialized = JSON.stringify(readModel);
  assert.equal(serialized.includes("personalRecords"), false);
  assert.equal(serialized.includes("diagnosticReports"), false);
  assert.equal(serialized.includes("Internal cohort name"), false);
  assert.equal(serialized.includes("DUA-TEST"), false);
});

test("research read model publishes only non-small aggregate counts", () => {
  const readModel = buildResearchSandboxReadModel(approvedDataset({ records: 24 }));
  assert.deepEqual(readModel.cohort.recordCount, {
    value: 24,
    suppressed: false,
    reason: ""
  });
});

test("research scope is commission-wide and institution-owner only", () => {
  const dataset = approvedDataset();
  assert.equal(canReadResearchDataset({ role: "commission", username: "health" }, dataset), true);
  assert.equal(canReadResearchDataset({ role: "institution", username: "hospital" }, dataset), true);
  assert.equal(canReadResearchDataset({ role: "institution", username: "community" }, dataset), false);
  assert.equal(canReadResearchDataset(
    { role: "institution", username: "community" },
    approvedDataset({ accessRequests: [{ by: "community", status: "submitted" }] })
  ), false);
  assert.equal(canReadResearchDataset(
    { role: "institution", username: "community" },
    approvedDataset({ accessRequests: [{ by: "community", status: "approved" }] })
  ), true);
  assert.equal(canReadResearchDataset({ role: "citizen", username: "citizen" }, dataset), false);
  assert.equal(normalizeResearchPurpose(" approved cohort validation "), "approved cohort validation");
  assert.throws(() => normalizeResearchPurpose("short"), /at least 8 characters/);
});

test("shared boundary admits only declared route and method combinations", () => {
  assert.equal(isSharedRouteAllowed("GET", "/api/data-governance"), true);
  assert.equal(isSharedRouteAllowed("POST", "/api/data-governance"), false);
  assert.equal(isSharedRouteAllowed("POST", "/api/mobile/experience"), true);
  assert.equal(isSharedRouteAllowed("DELETE", "/api/mobile/experience"), false);
  assert.equal(isSharedRouteAllowed("POST", "/api/research/datasets"), false);
  assert.equal(isSharedRouteAllowed("POST", "/api/state"), false);
  assert.equal(isSharedRouteAllowed("POST", "/api/anything"), false);
});

test("shared segment wrapper cannot become a generic write catch-all", async () => {
  let calls = 0;
  const [segment] = protectSharedRouteSegments([{
    id: "shared-test",
    domain: "shared",
    async handle() {
      calls += 1;
      return true;
    }
  }]);
  assert.equal(await segment.handle(
    { method: "POST" },
    {},
    new URL("http://localhost/api/research/datasets")
  ), false);
  assert.equal(calls, 0);
  assert.equal(await segment.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/data-governance")
  ), true);
  assert.equal(calls, 1);
});
