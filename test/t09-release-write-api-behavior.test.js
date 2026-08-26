"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createRouteSegments: createResearchRouteSegments } = require("../src/http/routes/research");
const { createRouteSegments: createSharedRouteSegments } = require("../src/http/routes/shared");
const {
  ResearchDatasetCommandError,
  applyResearchDatasetCommand
} = require("../src/http/research/dataset-write-command");
const {
  DrugConsumableCommandError,
  executeDrugConsumableCommand
} = require("../src/http/shared/drug-consumable-command");

const NOW = "2026-08-26T08:00:00.000Z";

function readyDataset(overrides = {}) {
  return {
    id: "research-dataset-1",
    name: "De-identified cohort",
    createdBy: "institution-researcher",
    domainVersion: 0,
    status: "published",
    authorizationStatus: "approved",
    ethicsStatus: "approved",
    deidentificationStatus: "released",
    anonymization: "k-anonymity",
    governance: {
      dataUseAgreement: "DUA-001",
      minimumNecessary: true,
      reidentificationProhibited: true,
      exportReviewRequired: true,
      retentionDays: 180,
      policyBasis: ["PIPL"]
    },
    sandbox: { status: "active" },
    evidenceDocuments: [
      { id: "ethics-1", type: "ethics-approval", referenceNo: "ETH-001", status: "verified" },
      { id: "dua-1", type: "data-use-agreement", referenceNo: "DUA-001", status: "verified" }
    ],
    accessRequests: [],
    usageAudit: [],
    outcomes: [],
    ...overrides
  };
}

function drugState() {
  return {
    drugConsumableSupervisions: [{
      id: "drug-record-1",
      residentId: "resident-1",
      domainVersion: 0,
      status: "open",
      auditTrail: []
    }],
    securityEvents: []
  };
}

const researchDeps = {
  appendResearchAudit(state, user, dataset, action, detail, result = "allowed") {
    dataset.usageAudit = [{ at: NOW, by: user.username, role: user.role, action, purpose: detail, result }, ...(dataset.usageAudit || [])];
    state.dataAccessLogs = [{ at: NOW, actor: user.username, action, result }, ...(state.dataAccessLogs || [])];
  },
  normalizeResearchApproval(dataset, payload, user) {
    const approved = (payload.decision || "approved") === "approved";
    return {
      ...dataset,
      approval: { at: NOW, by: user.username, decision: approved ? "approved" : "rejected" },
      governance: payload.governance ? { ...dataset.governance, ...payload.governance } : dataset.governance,
      ethicsStatus: approved ? "approved" : "rejected",
      authorizationStatus: approved ? "approved" : "rejected",
      deidentificationStatus: approved ? "released" : "blocked",
      status: approved ? "published" : "rejected",
      sandbox: { status: approved ? "active" : "blocked" }
    };
  },
  normalizeResearchEvidenceDocument(payload, user, dataset) {
    return {
      id: payload.id || `${dataset.id}-${payload.type}`,
      type: payload.type,
      title: payload.title,
      referenceNo: payload.referenceNo,
      status: payload.status || "verified",
      addedBy: user.username
    };
  },
  requireDatasetSandboxAccess(dataset) {
    return dataset.authorizationStatus === "approved"
      && dataset.ethicsStatus === "approved"
      && dataset.deidentificationStatus === "released"
      && dataset.status === "published"
      && dataset.sandbox?.status === "active"
      && dataset.governance?.minimumNecessary === true
      && dataset.governance?.reidentificationProhibited === true
      && ["ethics-approval", "data-use-agreement"].every((type) => dataset.evidenceDocuments?.some((item) => item.type === type && item.status !== "rejected"));
  }
};

function researchUser(endpoint) {
  if (endpoint === "approval") return { username: "independent-reviewer", name: "Reviewer", role: "commission", orgType: "city", orgCode: "CITY-001" };
  return { username: "institution-researcher", name: "Researcher", role: "institution", orgType: "hospital", orgCode: "HOSP-001" };
}

function researchPayload(endpoint) {
  if (endpoint === "approval") return { expectedVersion: 0, decision: "approved", governance: { minimumNecessary: true, reidentificationProhibited: true } };
  if (endpoint === "evidence") return { expectedVersion: 0, type: "export-review", title: "Export review", referenceNo: "EXP-001", status: "verified" };
  if (endpoint === "outcomes") return { expectedVersion: 0, title: "Outcome", summary: "Only de-identified aggregate outcomes are returned." };
  if (endpoint === "sandbox-access") return { expectedVersion: 0, purpose: "approved cohort analysis" };
  return { expectedVersion: 0, purpose: "approved cohort analysis", destination: "approved research sandbox", requestedFields: ["ageBand", "diagnosisGroup"] };
}

function executeResearch(state, endpoint, payload, user, key) {
  return applyResearchDatasetCommand({
    state,
    datasetId: "research-dataset-1",
    endpoint,
    payload,
    user,
    headerKey: key,
    now: NOW,
    ...researchDeps
  });
}

test("T09 research write commands bind actor-scoped keys, replay with zero writes, reject conflicts, and enforce CAS", () => {
  for (const endpoint of ["approval", "evidence", "compliant-export", "outcomes", "sandbox-access"]) {
    const state = { researchDatasets: [readyDataset()], compliantDataExports: [], dataAccessLogs: [] };
    const user = researchUser(endpoint);
    const payload = researchPayload(endpoint);
    const first = executeResearch(state, endpoint, payload, user, `research-${endpoint}-key`);
    assert.equal(first.replayed, false, endpoint);
    assert.equal(state.researchDatasets[0].domainVersion, 1, endpoint);
    assert.equal(state.researchDatasets[0].usageAudit.length, 1, endpoint);
    assert.equal(state.dataAccessLogs.length, 1, endpoint);
    const persisted = structuredClone(state);

    const replay = executeResearch(state, endpoint, payload, user, `research-${endpoint}-key`);
    assert.equal(replay.replayed, true, endpoint);
    assert.deepEqual(state, persisted, `${endpoint} exact replay must be zero-write`);

    assert.throws(
      () => executeResearch(state, endpoint, { ...payload, note: "different semantic payload" }, user, `research-${endpoint}-key`),
      (error) => error instanceof ResearchDatasetCommandError && error.code === "RESEARCH_COMMAND_IDEMPOTENCY_CONFLICT" && error.status === 409,
      endpoint
    );
    assert.throws(
      () => executeResearch(state, endpoint, { ...payload, expectedVersion: 0 }, user, `research-${endpoint}-stale`),
      (error) => error instanceof ResearchDatasetCommandError && error.code === "RESEARCH_COMMAND_VERSION_CONFLICT" && error.status === 409,
      endpoint
    );
  }
});

test("T09 research replay returns the original response after a later command advances the aggregate", () => {
  const state = { researchDatasets: [readyDataset()], compliantDataExports: [], dataAccessLogs: [] };
  const user = researchUser("evidence");
  const firstPayload = researchPayload("evidence");
  const first = executeResearch(state, "evidence", firstPayload, user, "research-original-response");
  executeResearch(
    state,
    "evidence",
    { ...firstPayload, expectedVersion: 1, referenceNo: "EXP-002", title: "Later evidence" },
    user,
    "research-later-command"
  );
  const beforeReplay = structuredClone(state);
  const replay = executeResearch(state, "evidence", firstPayload, user, "research-original-response");
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.response, first.response);
  assert.equal(replay.response.domainVersion, 1);
  assert.equal(state.researchDatasets[0].domainVersion, 2);
  assert.deepEqual(state, beforeReplay);
});

test("T09 research commands enforce ethics, minimum-necessary, independent approval, and institution evidence boundaries", () => {
  const noEvidence = readyDataset({ evidenceDocuments: [] });
  assert.throws(
    () => executeResearch({ researchDatasets: [noEvidence] }, "approval", researchPayload("approval"), researchUser("approval"), "approval-no-evidence"),
    (error) => error.code === "RESEARCH_APPROVAL_EVIDENCE_REQUIRED" && error.status === 409
  );
  assert.throws(
    () => executeResearch(
      { researchDatasets: [readyDataset()] },
      "approval",
      { ...researchPayload("approval"), governance: { minimumNecessary: false, reidentificationProhibited: true } },
      researchUser("approval"),
      "approval-minimization"
    ),
    (error) => error.code === "RESEARCH_APPROVAL_MINIMIZATION_REQUIRED" && error.status === 409
  );
  assert.throws(
    () => executeResearch({ researchDatasets: [readyDataset()] }, "approval", researchPayload("approval"), { ...researchUser("approval"), username: "institution-researcher" }, "self-approval"),
    (error) => error.code === "RESEARCH_APPROVAL_SEPARATION_REQUIRED" && error.status === 403
  );
  const evidenceState = { researchDatasets: [readyDataset()] };
  executeResearch(evidenceState, "evidence", researchPayload("evidence"), researchUser("evidence"), "institution-evidence");
  assert.equal(evidenceState.researchDatasets[0].evidenceDocuments[0].status, "submitted");
  assert.throws(
    () => executeResearch({ researchDatasets: [readyDataset()] }, "evidence", null, researchUser("evidence"), "null-body"),
    (error) => error.code === "RESEARCH_COMMAND_INVALID" && error.status === 400
  );
  const fullReceiptDataset = readyDataset({
    commandReceipts: Array.from({ length: 100 }, (_, index) => ({ endpoint: "evidence", commandKeyHash: `old-${index}`, requestDigest: `digest-${index}` }))
  });
  assert.throws(
    () => executeResearch({ researchDatasets: [fullReceiptDataset] }, "evidence", researchPayload("evidence"), researchUser("evidence"), "receipt-capacity"),
    (error) => error.code === "RESEARCH_COMMAND_RECEIPT_CAPACITY_EXCEEDED" && error.status === 409
  );
});

function drugUser(action) {
  if (action === "remediation") return { username: "hospital-operator", name: "Hospital", role: "institution", orgType: "hospital", orgCode: "HOSP-001" };
  return { username: "insurance-operator", name: "Insurance", role: "insurance", orgType: "insurance_center", orgCode: "INS-001" };
}

function drugPayload(action) {
  if (action === "review") return { expectedVersion: 0, reviewStatus: "review-passed", status: "in-review" };
  if (action === "remediation") return { expectedVersion: 0, remediationStatus: "submitted", evidence: "controlled-evidence-reference" };
  return { expectedVersion: 0, insuranceStatus: "synced", settlementBatch: "batch-001" };
}

function executeDrug(state, action, payload, user, key) {
  return executeDrugConsumableCommand({
    state,
    recordId: "drug-record-1",
    action,
    input: payload,
    user,
    headerKey: key,
    now: NOW,
    canAccessResident: () => true,
    prependAuditTrailEntry: (events, event) => [event, ...(events || [])],
    randomUUID: () => "security-event-1"
  });
}

test("T09 drug write commands bind actor-scoped keys, replay with zero writes, reject conflicts, and persist audit atomically", () => {
  for (const action of ["review", "remediation", "insurance-sync"]) {
    const state = drugState();
    const payload = drugPayload(action);
    const user = drugUser(action);
    const first = executeDrug(state, action, payload, user, `drug-${action}-key`);
    assert.equal(first.replayed, false, action);
    assert.equal(state.drugConsumableSupervisions[0].domainVersion, 1, action);
    assert.equal(state.drugConsumableSupervisions[0].auditTrail.length, 1, action);
    assert.equal(state.securityEvents.length, 1, action);
    const persisted = structuredClone(state);

    const replay = executeDrug(state, action, payload, user, `drug-${action}-key`);
    assert.equal(replay.replayed, true, action);
    assert.deepEqual(state, persisted, `${action} exact replay must be zero-write`);
    assert.throws(
      () => executeDrug(state, action, { ...payload, note: "different semantic payload" }, user, `drug-${action}-key`),
      (error) => error instanceof DrugConsumableCommandError && error.code === "DRUG_CONSUMABLE_IDEMPOTENCY_CONFLICT" && error.status === 409,
      action
    );
    assert.throws(
      () => executeDrug(state, action, payload, user, `drug-${action}-stale`),
      (error) => error instanceof DrugConsumableCommandError && error.code === "DRUG_CONSUMABLE_VERSION_CONFLICT" && error.status === 409,
      action
    );
  }
});

test("T09 drug replay returns the original response after a later command advances the aggregate", () => {
  const state = drugState();
  const firstPayload = drugPayload("review");
  const first = executeDrug(state, "review", firstPayload, drugUser("review"), "drug-original-response");
  executeDrug(
    state,
    "remediation",
    { ...drugPayload("remediation"), expectedVersion: 1 },
    drugUser("remediation"),
    "drug-later-command"
  );
  const beforeReplay = structuredClone(state);
  const replay = executeDrug(state, "review", firstPayload, drugUser("review"), "drug-original-response");
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.response, first.response);
  assert.equal(replay.response.domainVersion, 1);
  assert.equal(state.drugConsumableSupervisions[0].domainVersion, 2);
  assert.deepEqual(state, beforeReplay);
});

test("T09 drug commands preserve institution and insurance separation of duties", () => {
  assert.throws(
    () => executeDrug(drugState(), "remediation", drugPayload("remediation"), drugUser("review"), "insurance-remediation"),
    (error) => error.code === "DRUG_CONSUMABLE_DUTY_SEPARATION_REQUIRED" && error.status === 403
  );
  assert.throws(
    () => executeDrug(drugState(), "insurance-sync", drugPayload("insurance-sync"), drugUser("remediation"), "institution-sync"),
    (error) => error.code === "DRUG_CONSUMABLE_DUTY_SEPARATION_REQUIRED" && error.status === 403
  );
  assert.throws(
    () => executeDrug(drugState(), "review", drugPayload("review"), { ...drugUser("review"), orgType: "hospital" }, "bad-insurance-scope"),
    (error) => error.code === "DRUG_CONSUMABLE_INSURANCE_SCOPE_DENIED" && error.status === 403
  );
  const fullReceiptState = drugState();
  fullReceiptState.drugConsumableSupervisions[0].commandReceipts = Array.from({ length: 100 }, (_, index) => ({ action: "review", commandKeyHash: `old-${index}`, requestDigest: `digest-${index}` }));
  assert.throws(
    () => executeDrug(fullReceiptState, "review", drugPayload("review"), drugUser("review"), "receipt-capacity"),
    (error) => error.code === "DRUG_CONSUMABLE_RECEIPT_CAPACITY_EXCEEDED" && error.status === 409
  );
});

async function dispatch(segments, req, pathname) {
  const response = { status: 0, body: null };
  const res = {};
  for (const segment of segments) {
    if (await segment.handle(req, res, new URL(pathname, "http://localhost"))) break;
  }
  return { response, res };
}

function sendJsonFor(response) {
  return (_res, status, body) => {
    response.status = status;
    response.body = body;
  };
}

const sharedRoutePorts = {
  authorizationState: () => ({ key: "active" }),
  buildAuthorizationLifecycle: () => ({ items: [{ active: true, lifecycleKey: "active" }] }),
  appendDataAccessLog: () => {},
  canAccessResident: () => true,
  prependAuditTrailEntry: (events, event) => [event, ...(events || [])],
  randomUUID: () => "security-event-1"
};

test("T09 routes authenticate before body/state access and map persistence failure without fallback writes", async () => {
  for (const build of [
    () => {
      const counts = { body: 0, read: 0, write: 0 };
      const response = { status: 0, body: null };
      const runtime = {
        ...sharedRoutePorts,
        requireApiRole: () => null,
        collectJson: async () => { counts.body += 1; return {}; },
        readDatabase: () => { counts.read += 1; return { researchDatasets: [] }; },
        sendJson: sendJsonFor(response)
      };
      return { segments: createResearchRouteSegments(runtime), path: "/api/research/datasets/research-dataset-1/evidence", counts, response };
    },
    () => {
      const counts = { body: 0, read: 0, write: 0 };
      const response = { status: 0, body: null };
      const runtime = {
        ...sharedRoutePorts,
        requireApiRole: () => null,
        collectJson: async () => { counts.body += 1; return {}; },
        readDatabase: () => { counts.read += 1; return drugState(); },
        sendJson: sendJsonFor(response)
      };
      return { segments: createSharedRouteSegments(runtime), path: "/api/drug-consumable-supervision/drug-record-1/review", counts, response };
    }
  ]) {
    const harness = build();
    await dispatch(harness.segments, { method: "POST", headers: {} }, harness.path);
    assert.deepEqual(harness.counts, { body: 0, read: 0, write: 0 });
  }

  const researchState = { researchDatasets: [readyDataset()], dataAccessLogs: [] };
  let researchWrites = 0;
  const researchResponse = { status: 0, body: null };
  const researchRuntime = {
    ...researchDeps,
    requireApiRole: () => researchUser("evidence"),
    collectJson: async (req) => req.body,
    readDatabase: () => researchState,
    writeDatabase: () => { researchWrites += 1; throw new Error("database unavailable: secret-path"); },
    sendJson: sendJsonFor(researchResponse)
  };
  await dispatch(createResearchRouteSegments(researchRuntime), { method: "POST", headers: { "idempotency-key": "research-storage" }, body: researchPayload("evidence") }, "/api/research/datasets/research-dataset-1/evidence");
  assert.equal(researchWrites, 1);
  assert.equal(researchResponse.status, 500);
  assert.equal(researchResponse.body.code, "RESEARCH_COMMAND_STORAGE_FAILED");
  assert.doesNotMatch(JSON.stringify(researchResponse.body), /secret-path/);
  assert.equal(researchState.researchDatasets[0].domainVersion, 0);

  const sharedState = drugState();
  let sharedWrites = 0;
  const sharedResponse = { status: 0, body: null };
  const sharedRuntime = {
    ...sharedRoutePorts,
    requireApiRole: () => drugUser("review"),
    collectJson: async (req) => req.body,
    readDatabase: () => sharedState,
    writeDatabase: () => { sharedWrites += 1; throw new Error("database unavailable: secret-path"); },
    sendJson: sendJsonFor(sharedResponse),
    canAccessResident: () => true,
    prependAuditTrailEntry: sharedRoutePorts.prependAuditTrailEntry,
    randomUUID: sharedRoutePorts.randomUUID
  };
  await dispatch(createSharedRouteSegments(sharedRuntime), { method: "POST", headers: { "idempotency-key": "drug-storage" }, body: drugPayload("review") }, "/api/drug-consumable-supervision/drug-record-1/review");
  assert.equal(sharedWrites, 1);
  assert.equal(sharedResponse.status, 500);
  assert.equal(sharedResponse.body.code, "DRUG_CONSUMABLE_STORAGE_FAILED");
  assert.doesNotMatch(JSON.stringify(sharedResponse.body), /secret-path/);
  assert.equal(sharedState.drugConsumableSupervisions[0].domainVersion, 0);
});

test("T09 aggregate locks re-read inside the lock and collapse concurrent exact replays to one write", async () => {
  const researchState = { researchDatasets: [readyDataset()], dataAccessLogs: [] };
  let researchWrites = 0;
  const researchRuntime = {
    ...researchDeps,
    requireApiRole: () => researchUser("evidence"),
    collectJson: async (req) => req.body,
    readDatabase: () => structuredClone(researchState),
    writeDatabase: (next) => { researchWrites += 1; Object.assign(researchState, structuredClone(next)); },
    sendJson: () => {}
  };
  const researchRequest = { method: "POST", headers: { "idempotency-key": "concurrent-research" }, body: { ...researchPayload("evidence"), expectedVersion: undefined } };
  await Promise.all([
    dispatch(createResearchRouteSegments(researchRuntime), researchRequest, "/api/research/datasets/research-dataset-1/evidence"),
    dispatch(createResearchRouteSegments(researchRuntime), researchRequest, "/api/research/datasets/research-dataset-1/evidence")
  ]);
  assert.equal(researchWrites, 1);

  const sharedState = drugState();
  let sharedWrites = 0;
  const sharedRuntime = {
    ...sharedRoutePorts,
    requireApiRole: () => drugUser("review"),
    collectJson: async (req) => req.body,
    readDatabase: () => structuredClone(sharedState),
    writeDatabase: (next) => { sharedWrites += 1; Object.assign(sharedState, structuredClone(next)); },
    sendJson: () => {},
    canAccessResident: () => true,
    prependAuditTrailEntry: sharedRoutePorts.prependAuditTrailEntry,
    randomUUID: sharedRoutePorts.randomUUID
  };
  const sharedRequest = { method: "POST", headers: { "idempotency-key": "concurrent-drug" }, body: { reviewStatus: "review-passed" } };
  await Promise.all([
    dispatch(createSharedRouteSegments(sharedRuntime), sharedRequest, "/api/drug-consumable-supervision/drug-record-1/review"),
    dispatch(createSharedRouteSegments(sharedRuntime), sharedRequest, "/api/drug-consumable-supervision/drug-record-1/review")
  ]);
  assert.equal(sharedWrites, 1);
});
