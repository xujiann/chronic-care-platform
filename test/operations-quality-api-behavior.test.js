"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const operationsRoute = require("../src/http/routes/platform-governance/operations-command");
const qualityRoute = require("../src/http/routes/clinical-specialties/quality-safety");

const commission = Object.freeze({
  id: "u-health",
  username: "health",
  name: "Health commission",
  role: "commission",
  orgCode: "ORG-HEALTH-DL",
  orgName: "Health commission",
  orgType: "health_admin"
});
const institution = Object.freeze({
  id: "u-hospital",
  username: "hospital",
  name: "Hospital operator",
  role: "institution",
  orgCode: "MR1",
  orgName: "Dalian Central Hospital",
  orgType: "medical_institution"
});

function baseState() {
  return {
    storageMeta: { collectionVersions: { resourceDispatchRequests: 3, statisticsReconciliationReviews: 4, qualityRectificationOrders: 5, qualitySafetyEvents: 6, securityEvents: 7 } },
    securityEvents: [],
    resourceDispatchRequests: [],
    statisticsReconciliationReviews: [{ id: "recon-1", status: "pending", auditTrail: [] }],
    qualitySafetyEvents: [{
      id: "issue-1",
      sourceId: "source-1",
      type: "quality_event",
      institutionId: "MR1",
      institutionName: "Dalian Central Hospital",
      ownerRole: "institution",
      owner: "Quality office",
      status: "open",
      auditTrail: []
    }],
    qualityRectificationOrders: [{
      id: "order-1",
      issueId: "issue-1",
      institutionId: "MR1",
      institutionName: "Dalian Central Hospital",
      ownerRole: "institution",
      owner: "Quality office",
      requirement: "Submit evidence",
      status: "dispatched",
      version: 1,
      feedback: [],
      review: [],
      auditTrail: []
    }]
  };
}

function createHarness(kind, options = {}) {
  let state = structuredClone(options.state || baseState());
  let writes = 0;
  let reads = 0;
  let collects = 0;
  let auditCalls = 0;
  let uuid = 0;
  const runtime = {
    BloodEventHub: { dashboard() { return {}; } },
    appendQualitySafetyAudit(data, user, action, target, detail) {
      auditCalls += 1;
      if (options.failAudit) throw new Error("audit unavailable");
      data.securityEvents = [{ id: `quality-audit-${auditCalls}`, actor: user.username, action, target, detail }, ...(data.securityEvents || [])];
    },
    buildQualitySafetyIssues(data) {
      return structuredClone(data.qualitySafetyEvents || []);
    },
    async collectJson(req) {
      collects += 1;
      return structuredClone(req.payload || {});
    },
    normalizeDispatchAction(payload, user) {
      return {
        id: payload.id || "dispatch-1",
        resourceType: String(payload.resourceType || "bed"),
        quantity: Number(payload.quantity || 1),
        status: String(payload.status || "pending"),
        updatedAt: "2030-08-26T00:00:00.000Z",
        updatedBy: user.username,
        auditTrail: [{ at: "2030-08-26T00:00:00.000Z", actor: user.username, action: "upsert", note: "pending" }]
      };
    },
    randomUUID() {
      uuid += 1;
      if (options.failAudit && kind === "operations") throw new Error("audit unavailable");
      return `uuid-${uuid}`;
    },
    readDatabase() {
      reads += 1;
      return structuredClone(state);
    },
    requireApiRole(req, res) {
      if (req.user === null) {
        res.result = { status: 401, body: { error: "Unauthorized" } };
        return null;
      }
      return req.user || commission;
    },
    sendJson(res, status, body) {
      res.result = { status, body: structuredClone(body) };
    },
    writeDatabase(data) {
      if (options.failWrite) throw new Error("write unavailable");
      writes += 1;
      state = structuredClone(data);
    }
  };
  const segment = (kind === "operations" ? operationsRoute : qualityRoute).createRouteSegment(runtime);
  return {
    async invoke(path, payload, user, key) {
      const req = {
        method: "POST",
        headers: key ? { "idempotency-key": key } : {},
        payload,
        user
      };
      const res = {};
      assert.equal(await segment.handle(req, res, new URL(`http://localhost${path}`)), true);
      assert.ok(res.result);
      return res.result;
    },
    auditCalls: () => auditCalls,
    collects: () => collects,
    reads: () => reads,
    state: () => structuredClone(state),
    writes: () => writes
  };
}

const contracts = [
  {
    name: "operations dispatch",
    kind: "operations",
    path: "/api/operations/dispatch",
    user: commission,
    payload: { id: "dispatch-1", resourceType: "bed", quantity: 2, expectedVersion: 0 },
    changed: { id: "dispatch-1", resourceType: "bed", quantity: 3, expectedVersion: 0 },
    stale: { id: "dispatch-1", resourceType: "bed", quantity: 4, expectedVersion: 0 },
    collection: "resourceDispatchRequests",
    recordId: "dispatch-1",
    successStatus: 201
  },
  {
    name: "operations reconciliation review",
    kind: "operations",
    path: "/api/operations/reconciliation/recon-1/review",
    user: commission,
    payload: { status: "approved", reviewNote: "verified", expectedVersion: 0 },
    changed: { status: "correcting", reviewNote: "changed", expectedVersion: 0 },
    stale: { status: "approved", reviewNote: "stale", expectedVersion: 0 },
    collection: "statisticsReconciliationReviews",
    recordId: "recon-1",
    successStatus: 200
  },
  {
    name: "quality issue dispatch",
    kind: "quality",
    path: "/api/quality-safety/issues/issue-1/dispatch",
    user: commission,
    payload: { institutionId: "MR1", ownerRole: "institution", requirement: "Submit evidence", expectedVersion: 0 },
    changed: { institutionId: "MR1", ownerRole: "institution", requirement: "Changed", expectedVersion: 0 },
    stale: { institutionId: "MR1", ownerRole: "institution", requirement: "Stale", expectedVersion: 0 },
    collection: "qualityRectificationOrders",
    recordId: null,
    successStatus: 201
  },
  {
    name: "quality rectification feedback",
    kind: "quality",
    path: "/api/quality-safety/rectifications/order-1/feedback",
    user: institution,
    payload: { content: "Evidence uploaded", attachments: ["evidence-ref"], expectedVersion: 1 },
    changed: { content: "Changed evidence", attachments: ["evidence-ref"], expectedVersion: 1 },
    stale: { content: "Stale evidence", attachments: [], expectedVersion: 1 },
    collection: "qualityRectificationOrders",
    recordId: "order-1",
    successStatus: 200
  },
  {
    name: "quality rectification review",
    kind: "quality",
    path: "/api/quality-safety/rectifications/order-1/review",
    user: commission,
    payload: { decision: "approved", comment: "accepted", expectedVersion: 1 },
    changed: { decision: "returned", comment: "changed", expectedVersion: 1 },
    stale: { decision: "approved", comment: "stale", expectedVersion: 1 },
    collection: "qualityRectificationOrders",
    recordId: "order-1",
    successStatus: 200
  }
];

test("five release-scope commands enforce durable replay, payload conflicts and expectedVersion", async (t) => {
  for (const contract of contracts) {
    await t.test(contract.name, async () => {
      const harness = createHarness(contract.kind);
      const first = await harness.invoke(contract.path, contract.payload, contract.user, `${contract.name}-key`);
      assert.equal(first.status, contract.successStatus);
      assert.equal(harness.writes(), 1);
      const auditRowsAfterFirst = harness.state().securityEvents.length;
      const committed = harness.state()[contract.collection];
      const target = contract.recordId ? committed.find((item) => item.id === contract.recordId) : committed[0];
      assert.equal(Array.isArray(target._apiCommandReceipts), true);
      assert.equal(JSON.stringify(target).includes(`${contract.name}-key`), false);

      const replay = await harness.invoke(contract.path, contract.payload, contract.user, `${contract.name}-key`);
      assert.deepEqual(replay, first);
      assert.equal(harness.writes(), 1, "exact replay must not write");
      assert.equal(harness.state().securityEvents.length, auditRowsAfterFirst, "exact replay must not append audit");

      const conflict = await harness.invoke(contract.path, contract.changed, contract.user, `${contract.name}-key`);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.code, `${contract.kind === "operations" ? "OPERATIONS" : "QUALITY_SAFETY"}_COMMAND_IDEMPOTENCY_CONFLICT`);
      assert.equal(harness.writes(), 1);

      const stale = await harness.invoke(contract.path, contract.stale, contract.user, `${contract.name}-stale-key`);
      assert.equal(stale.status, 409);
      assert.equal(stale.body.code, `${contract.kind === "operations" ? "OPERATIONS" : "QUALITY_SAFETY"}_COMMAND_VERSION_CONFLICT`);
      assert.equal(harness.writes(), 1);
    });
  }
});

test("identity, organization and rectification resource scope fail before protected work", async () => {
  const deniedIdentity = createHarness("operations");
  await deniedIdentity.invoke("/api/operations/dispatch", { id: "dispatch-1" }, null);
  assert.equal(deniedIdentity.collects(), 0);
  assert.equal(deniedIdentity.reads(), 0);

  const deniedOrganization = createHarness("operations");
  const wrongCommission = { ...commission, orgCode: "BLOOD-DL", orgType: "blood_center" };
  const organizationResponse = await deniedOrganization.invoke("/api/operations/dispatch", { id: "dispatch-1" }, wrongCommission);
  assert.equal(organizationResponse.status, 403);
  assert.equal(deniedOrganization.collects(), 0);
  assert.equal(deniedOrganization.reads(), 0);

  const deniedResource = createHarness("quality");
  const otherInstitution = { ...institution, orgCode: "MR3", orgName: "Other Hospital" };
  const resourceResponse = await deniedResource.invoke(
    "/api/quality-safety/rectifications/order-1/feedback",
    { content: "must not be collected" },
    otherInstitution
  );
  assert.equal(resourceResponse.status, 403);
  assert.equal(deniedResource.collects(), 0);
  assert.equal(deniedResource.writes(), 0);
});

test("explicit idempotency contract requires expectedVersion while legacy calls remain compatible", async () => {
  const explicit = createHarness("operations");
  const rejected = await explicit.invoke(
    "/api/operations/dispatch",
    { id: "dispatch-1", resourceType: "bed" },
    commission,
    "missing-version"
  );
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, "OPERATIONS_COMMAND_EXPECTED_VERSION_REQUIRED");
  assert.equal(explicit.writes(), 0);

  const legacy = createHarness("operations");
  const first = await legacy.invoke(
    "/api/operations/dispatch",
    { id: "legacy-dispatch", resourceType: "bed" },
    commission
  );
  const replay = await legacy.invoke(
    "/api/operations/dispatch",
    { id: "legacy-dispatch", resourceType: "bed" },
    commission
  );
  assert.equal(first.status, 201);
  assert.deepEqual(replay, first);
  assert.equal(legacy.writes(), 1);
  const compatibleUpdate = await legacy.invoke(
    "/api/operations/dispatch",
    { id: "legacy-dispatch", resourceType: "bed", quantity: 2 },
    commission
  );
  assert.equal(compatibleUpdate.status, 200);
  assert.equal(compatibleUpdate.body.version, 2);
  assert.equal(legacy.writes(), 2);
});

test("concurrent exact duplicates serialize and commit business plus audit once", async () => {
  const harness = createHarness("quality");
  const contract = contracts.find((item) => item.name === "quality rectification feedback");
  const [first, second] = await Promise.all([
    harness.invoke(contract.path, contract.payload, contract.user, "concurrent-feedback"),
    harness.invoke(contract.path, contract.payload, contract.user, "concurrent-feedback")
  ]);
  assert.deepEqual(second, first);
  assert.equal(harness.writes(), 1);
  assert.equal(harness.auditCalls(), 1);
  assert.equal(harness.state().qualityRectificationOrders[0].feedback.length, 1);
});

test("audit and storage failures produce stable errors without fallback writes", async () => {
  for (const [kind, path, payload, user] of [
    ["operations", "/api/operations/dispatch", { id: "dispatch-1", resourceType: "bed", expectedVersion: 0 }, commission],
    ["quality", "/api/quality-safety/rectifications/order-1/feedback", { content: "evidence", expectedVersion: 1 }, institution]
  ]) {
    const auditFailure = createHarness(kind, { failAudit: true });
    const auditResponse = await auditFailure.invoke(path, payload, user, `${kind}-audit-failure`);
    assert.equal(auditResponse.status, 500);
    assert.equal(auditResponse.body.code, `${kind === "operations" ? "OPERATIONS" : "QUALITY_SAFETY"}_COMMAND_STORAGE_FAILED`);
    assert.equal(auditFailure.writes(), 0);

    const writeFailure = createHarness(kind, { failWrite: true });
    const writeResponse = await writeFailure.invoke(path, payload, user, `${kind}-write-failure`);
    assert.equal(writeResponse.status, 500);
    assert.equal(writeResponse.body.code, `${kind === "operations" ? "OPERATIONS" : "QUALITY_SAFETY"}_COMMAND_STORAGE_FAILED`);
    assert.equal(writeFailure.writes(), 0);
  }
});
