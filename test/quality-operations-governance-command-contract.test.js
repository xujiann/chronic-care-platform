"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { executeGovernanceCommand } = require("../quality-operations-governance");
const {
  applyGovernanceResultToData,
  buildGovernanceRuntimeState,
  governanceAuditForRecord,
  publicGovernanceRecord
} = require("../quality-operations-governance-adapter");
const { createRouteSegment } = require("../src/http/routes/platform-governance/governance-catalog");

const ACTION_PATH = "/api/quality-operations-governance/items/quality-1/actions";

function stateFixture() {
  return {
    authOrganizations: [{ orgCode: "HOSP-A", name: "Hospital A" }],
    authUsers: [],
    qualitySafetyEvents: [{ id: "issue-1", institutionId: "HOSP-A", institutionName: "Hospital A" }],
    qualityRectificationOrders: [{
      id: "quality-1",
      issueId: "issue-1",
      institutionId: "HOSP-A",
      institutionName: "Hospital A",
      requirement: "submit evidence",
      status: "dispatched",
      auditTrail: []
    }],
    resourceDispatchRequests: [],
    drugConsumableSupervisions: [],
    qualityOperationsGovernanceAuditEvents: [],
    qualityOperationsGovernanceCommandReceipts: {},
    platformProcessAudit: [],
    securityEvents: [],
    storageMeta: { collectionVersions: { qualityRectificationOrders: 4 } }
  };
}

function actionPayload(note = "work started") {
  return {
    domain: "quality-rectification",
    action: "start",
    expectedVersion: 0,
    payload: { note }
  };
}

function governanceActorFromUser(user = {}) {
  return {
    id: String(user.id || user.username || user.name || "").trim(),
    role: String(user.role || "").trim(),
    institutionId: String(user.orgCode || "").trim(),
    scopeInstitutionIds: Array.isArray(user.scopeInstitutionIds) ? user.scopeInstitutionIds : []
  };
}

function governanceHttpStatus(code) {
  if (["ACTOR_FORBIDDEN", "INSTITUTION_SCOPE_DENIED"].includes(code)) return 403;
  if (code === "RECORD_NOT_FOUND") return 404;
  if (["INVALID_TRANSITION", "DOMAIN_MISMATCH", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(code)) return 409;
  return 400;
}

function createHarness(options = {}) {
  let state = structuredClone(options.state || stateFixture());
  let reads = 0;
  let collections = 0;
  let writes = 0;
  const user = options.user || {
    id: "hospital-a-user",
    username: "hospital-a-user",
    name: "Hospital A User",
    role: "institution",
    orgCode: "HOSP-A"
  };
  const runtime = {
    applyGovernanceResultToData,
    buildGovernanceCatalog: () => ({}),
    buildGovernanceRuntimeState,
    async collectJson(req) {
      collections += 1;
      if (options.collectJson) return options.collectJson(req);
      return structuredClone(req.payload);
    },
    executeGovernanceCommand,
    governanceActorFromUser,
    governanceAuditForRecord,
    governanceHttpStatus,
    listGovernanceRecords: () => ({}),
    publicGovernanceRecord,
    readDatabase() {
      reads += 1;
      return structuredClone(state);
    },
    requireApiRole(req, res) {
      if (options.authenticated === false) {
        runtime.sendJson(res, 401, { error: "Unauthorized" });
        return null;
      }
      return req.user || user;
    },
    sealAuditTrail: (rows) => rows,
    sendJson(res, status, body) {
      res.status = status;
      res.body = structuredClone(body);
    },
    writeDatabase(next, writeOptions) {
      writes += 1;
      if (options.writeDatabase) return options.writeDatabase(next, writeOptions, { writes });
      state = structuredClone(next);
    }
  };
  return {
    segment: createRouteSegment(runtime),
    counts: () => ({ reads, collections, writes }),
    state: () => structuredClone(state),
    updateState(mutator) {
      const next = structuredClone(state);
      mutator(next);
      state = next;
    }
  };
}

async function invoke(segment, options = {}) {
  const response = { status: null, body: null };
  const id = options.id || "quality-1";
  const req = {
    method: "POST",
    headers: options.key ? { "idempotency-key": options.key } : {},
    payload: options.payload || actionPayload(),
    user: options.user
  };
  const handled = await segment.handle(
    req,
    response,
    new URL(`http://local/api/quality-operations-governance/items/${id}/actions`)
  );
  assert.equal(handled, true);
  return response;
}

test("quality governance item action denies identity before body collection or state read", async () => {
  const harness = createHarness({ authenticated: false });
  const response = await invoke(harness.segment, { key: "quality-denied-before-read" });
  assert.equal(response.status, 401);
  assert.deepEqual(harness.counts(), { reads: 0, collections: 0, writes: 0 });
});

test("quality governance item action checks resource scope before receipt replay and keeps missing records write-free", async () => {
  const harness = createHarness();
  const accepted = await invoke(harness.segment, { key: "quality-scope-command" });
  assert.equal(accepted.status, 200);
  const originalReceipt = harness.state().qualityOperationsGovernanceCommandReceipts["quality-scope-command"];

  const denied = await invoke(harness.segment, {
    key: "quality-scope-command",
    user: {
      id: "hospital-b-user",
      username: "hospital-b-user",
      name: "Hospital B User",
      role: "institution",
      orgCode: "HOSP-B"
    }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "INSTITUTION_SCOPE_DENIED");
  assert.equal(denied.body.replayed, false);
  assert.equal(denied.body.record, null);
  assert.equal(denied.body.auditEvent, null);
  assert.deepEqual(
    harness.state().qualityOperationsGovernanceCommandReceipts["quality-scope-command"],
    originalReceipt
  );
  assert.equal(harness.state().qualityOperationsGovernanceAuditEvents.at(-1).outcome, "denied");

  const beforeMissing = harness.counts();
  const missing = await invoke(harness.segment, { id: "missing", key: "quality-missing" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "RECORD_NOT_FOUND");
  assert.equal(harness.counts().writes, beforeMissing.writes);
  assert.equal(harness.state().qualityOperationsGovernanceCommandReceipts["quality-missing"], undefined);
});

test("quality governance item action never replays a prior success after record visibility is revoked", async () => {
  const harness = createHarness();
  const accepted = await invoke(harness.segment, { key: "quality-revoked-scope" });
  assert.equal(accepted.status, 200);
  const originalReceipt = harness.state().qualityOperationsGovernanceCommandReceipts["quality-revoked-scope"];

  harness.updateState((state) => {
    state.qualityRectificationOrders[0].institutionId = "HOSP-B";
    state.qualityRectificationOrders[0].institutionName = "Hospital B";
  });
  const visibility = governanceAuditForRecord(harness.state(), "quality-1", {
    id: "hospital-a-user",
    role: "institution",
    orgCode: "HOSP-A"
  });
  assert.equal(visibility.found, true);
  assert.equal(visibility.allowed, false);

  const denied = await invoke(harness.segment, { key: "quality-revoked-scope" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "INSTITUTION_SCOPE_DENIED");
  assert.equal(denied.body.replayed, false);
  assert.equal(denied.body.record, null);
  assert.equal(denied.body.auditEvent, null);
  assert.deepEqual(
    harness.state().qualityOperationsGovernanceCommandReceipts["quality-revoked-scope"],
    originalReceipt
  );
  assert.equal(harness.state().qualityOperationsGovernanceAuditEvents.at(-1).outcome, "denied");
  assert.equal(harness.counts().writes, 2);
});

test("quality governance item action replays exact commands and rejects payload drift", async () => {
  const harness = createHarness();
  const first = await invoke(harness.segment, { key: "quality-replay" });
  const replay = await invoke(harness.segment, { key: "quality-replay" });
  const conflict = await invoke(harness.segment, {
    key: "quality-replay",
    payload: actionPayload("different intent")
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.replayed, false);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.record, first.body.record);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(harness.state().qualityRectificationOrders[0].governanceVersion, 1);
  assert.equal(Object.keys(harness.state().qualityOperationsGovernanceCommandReceipts).length, 1);
  assert.equal(harness.counts().writes, 2);
});

test("quality governance item action serializes same-record concurrent equal and conflicting commands", async () => {
  const equalHarness = createHarness();
  const equal = await Promise.all([
    invoke(equalHarness.segment, { key: "quality-concurrent-equal" }),
    invoke(equalHarness.segment, { key: "quality-concurrent-equal" })
  ]);
  assert.deepEqual(equal.map((item) => item.status), [200, 200]);
  assert.deepEqual(equal.map((item) => item.body.replayed).sort(), [false, true]);
  assert.equal(equalHarness.counts().writes, 1);
  assert.equal(equalHarness.state().qualityOperationsGovernanceAuditEvents.length, 1);

  const conflictHarness = createHarness();
  const conflict = await Promise.all([
    invoke(conflictHarness.segment, { key: "quality-concurrent-conflict", payload: actionPayload("intent-a") }),
    invoke(conflictHarness.segment, { key: "quality-concurrent-conflict", payload: actionPayload("intent-b") })
  ]);
  assert.deepEqual(conflict.map((item) => item.status).sort(), [200, 409]);
  assert.equal(conflictHarness.state().qualityRectificationOrders[0].governanceVersion, 1);
  assert.equal(Object.keys(conflictHarness.state().qualityOperationsGovernanceCommandReceipts).length, 1);
  assert.equal(conflictHarness.state().qualityOperationsGovernanceAuditEvents.length, 2);
});

test("quality governance item action commits record receipt and three audit projections in one write", async () => {
  let committed = null;
  const harness = createHarness({
    writeDatabase(next) {
      committed = structuredClone(next);
    }
  });
  const response = await invoke(harness.segment, { key: "quality-atomic" });
  assert.equal(response.status, 200);
  assert.equal(harness.counts().writes, 1);
  assert.equal(committed.qualityRectificationOrders[0].governanceVersion, 1);
  assert.equal(committed.qualityOperationsGovernanceCommandReceipts["quality-atomic"].ok, true);
  assert.equal(committed.qualityOperationsGovernanceAuditEvents.length, 1);
  assert.equal(committed.platformProcessAudit.length, 1);
  assert.equal(committed.securityEvents.length, 1);
});

test("quality governance item action redacts persistence failures and maps SQLite CAS without fallback audit write", async () => {
  const secretFailure = createHarness({
    writeDatabase() {
      throw new Error("provider password=secret and private row payload");
    }
  });
  const failed = await invoke(secretFailure.segment, { key: "quality-write-failed" });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error.code, "QUALITY_GOVERNANCE_COMMAND_FAILED");
  assert.equal(failed.body.error.message, "quality governance command failed");
  assert.doesNotMatch(JSON.stringify(failed.body), /password|secret|private row/);
  assert.equal(secretFailure.counts().writes, 1);

  const casFailure = createHarness({
    writeDatabase() {
      throw new Error("SQLite optimistic lock conflict on qualityRectificationOrders: expected 4, current 5; internal payload");
    }
  });
  const conflict = await invoke(casFailure.segment, { key: "quality-cas-failed" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "QUALITY_GOVERNANCE_VERSION_CONFLICT");
  assert.equal(conflict.body.error.message, "quality governance state changed; retry with a fresh snapshot");
  assert.doesNotMatch(JSON.stringify(conflict.body), /qualityRectificationOrders|internal payload/);
  assert.equal(casFailure.counts().writes, 1);
});
