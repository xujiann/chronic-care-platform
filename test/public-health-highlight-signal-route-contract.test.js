"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildPublicHealthHighlights,
  normalizePublicHealthSignal,
  seedPublicHealthSignals
} = require("../public-health-highlights-service");
const { createRouteSegment } = require("../src/http/routes/public-health/public-health-operations");

function payload(overrides = {}) {
  return {
    id: "phsig-route-contract-1",
    idempotencyKey: "phsig-route-idempotency-1",
    ruleId: "phhr-rule-fever-cluster",
    sourceType: "临床症候群",
    sourceSystem: "route-contract-source",
    metric: "fever-respiratory-cases",
    value: 9,
    baseline: 2,
    unit: "cases",
    region: "contract-region",
    institution: "contract-institution",
    observedAt: "2026-08-24T08:00:00.000Z",
    evidenceRefs: ["PH-SIGNAL-CONTRACT-001"],
    ...overrides
  };
}

function mergeByKey(base, rows, key) {
  const result = [];
  const seen = new Set();
  for (const row of [...(Array.isArray(rows) ? rows : []), ...(Array.isArray(base) ? base : [])]) {
    if (!row || seen.has(row[key])) continue;
    seen.add(row[key]);
    result.push(structuredClone(row));
  }
  return result;
}

function createHarness(options = {}) {
  let persisted = structuredClone(options.initialState || {
    publicHealthSignals: [],
    securityEvents: [],
    storageMeta: {
      engine: "sqlite",
      collectionVersions: { publicHealthSignals: 2, securityEvents: 5 }
    }
  });
  let sequence = 0;
  const calls = {
    appends: [],
    authorization: [],
    collects: 0,
    reads: 0,
    seals: 0,
    writes: []
  };
  const defaultUser = options.user || {
    username: "health",
    name: "卫健委管理员",
    role: "commission",
    orgCode: "ORG-HEALTH-DL",
    orgType: "health_admin",
    publicHealthHospitalCodes: ["H000001", "H000002", "H000003"]
  };
  const runtime = {
    appendSecurityEvent(entry) {
      calls.appends.push(structuredClone(entry));
      if (options.auditError) throw options.auditError;
    },
    buildPublicHealthHighlights,
    collectJson(req) {
      calls.collects += 1;
      if (options.collectError) return Promise.reject(options.collectError);
      return Promise.resolve(structuredClone(req.body));
    },
    mergeByKey,
    normalizePublicHealthSignal,
    randomUUID() {
      if (options.randomUUID) return options.randomUUID(sequence++);
      sequence += 1;
      return `phsig-audit-${sequence}`;
    },
    readDatabase() {
      calls.reads += 1;
      return structuredClone(persisted);
    },
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return options.authorized === false ? null : defaultUser;
    },
    sealAuditTrail(rows) {
      calls.seals += 1;
      return structuredClone(rows);
    },
    seedPublicHealthSignals,
    sendJson(res, status, body) {
      res.status = status;
      res.body = body;
    },
    writeDatabase(next) {
      calls.writes.push(structuredClone(next));
      if (options.writeError) throw options.writeError;
      persisted = structuredClone(next);
    }
  };
  const segment = createRouteSegment(runtime);
  return {
    calls,
    getPersisted: () => structuredClone(persisted),
    async request(body, headers = {}) {
      const res = {};
      const handled = await segment.handle(
        { method: "POST", body, headers },
        res,
        new URL("http://platform.test/api/public-health/highlights/signals")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("public health signal identity and unsupported organization scope stop before body and state", async () => {
  const identityDenied = createHarness({ authorized: false });
  await identityDenied.request(payload());
  assert.equal(identityDenied.calls.collects, 0);
  assert.equal(identityDenied.calls.reads, 0);
  assert.equal(identityDenied.calls.writes.length, 0);

  const institutionDenied = createHarness({
    user: { name: "机构管理员", role: "commission", orgCode: "MR1", orgType: "medical_institution" }
  });
  const response = await institutionDenied.request(payload());
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "PUBLIC_HEALTH_SIGNAL_SCOPE_FORBIDDEN");
  assert.equal(institutionDenied.calls.collects, 0);
  assert.equal(institutionDenied.calls.reads, 0);
  assert.equal(institutionDenied.calls.appends[0].detail, "PUBLIC_HEALTH_SIGNAL_SCOPE_FORBIDDEN");
});

test("public health signal district scope accepts only its canonical organization allowlist", async () => {
  const districtUser = {
    username: "district",
    name: "区县管理员",
    role: "commission",
    orgCode: "ORG-DIST-ZS",
    orgType: "district",
    publicHealthHospitalCodes: ["H000003"]
  };
  const own = createHarness({
    user: districtUser,
    initialState: {
      publicHealthSignals: [
        { id: "allowed-existing", sourceOrgCode: "ORG-DIST-ZS", sourceType: "临床症候群", qualityStatus: "manual-review" },
        { id: "denied-existing", sourceOrgCode: "H000001", sourceType: "临床症候群", qualityStatus: "manual-review" }
      ],
      publicHealthAlerts: [{
        id: "mixed-scope-alert",
        signalIds: ["allowed-existing", "denied-existing"],
        status: "active",
        severity: "critical",
        evidenceRefs: ["must-not-leak"]
      }],
      securityEvents: []
    }
  });
  const ownResponse = await own.request(payload({ sourceOrgCode: "org-dist-zs" }));
  assert.equal(ownResponse.status, 201);
  assert.equal(ownResponse.body.signal.sourceOrgCode, "ORG-DIST-ZS");
  assert.equal(ownResponse.body.highlights.triggerCenter.signals.every((item) => item.sourceOrgCode === "ORG-DIST-ZS"), true);
  assert.equal(ownResponse.body.highlights.triggerCenter.signals.some((item) => item.id === "denied-existing"), false);
  assert.equal(ownResponse.body.highlights.triggerCenter.alerts.some((item) => item.id === "mixed-scope-alert"), false);
  assert.doesNotMatch(JSON.stringify(ownResponse.body.highlights), /must-not-leak|denied-existing|H000001/);
  assert.equal(ownResponse.body.highlights.commandCenter.tasks.length, 0);
  assert.equal(ownResponse.body.highlights.aiCenter.reviews.length, 0);
  assert.equal(ownResponse.body.highlights.evidenceCenter.records.length, 0);

  const hospital = createHarness({ user: districtUser });
  const hospitalResponse = await hospital.request(payload({ institutionCode: "h000003" }));
  assert.equal(hospitalResponse.status, 201);
  assert.equal(hospitalResponse.body.signal.sourceOrgCode, "H000003");
  assert.deepEqual(hospitalResponse.body.highlights.triggerCenter.signals.map((item) => item.sourceOrgCode), ["H000003"]);

  for (const deniedPayload of [payload(), payload({ sourceOrgCode: "H000001" })]) {
    const denied = createHarness({ user: districtUser });
    const deniedResponse = await denied.request(deniedPayload);
    assert.equal(deniedResponse.status, 403);
    assert.equal(deniedResponse.body.code, "PUBLIC_HEALTH_SIGNAL_SCOPE_FORBIDDEN");
    assert.equal(denied.calls.reads, 0);
    assert.equal(denied.calls.writes.length, 0);
    assert.equal(denied.calls.appends.length, 1);
  }
});

test("public health signal preserves legacy city and health-admin payloads without a source code", async () => {
  for (const user of [
    { name: "市级管理员", role: "commission", orgCode: "ORG-CITY-DL", orgType: "city" },
    { name: "卫健委管理员", role: "commission", orgCode: "ORG-HEALTH-DL", orgType: "health_admin" }
  ]) {
    const harness = createHarness({ user });
    const response = await harness.request(payload({ id: `legacy-${user.orgType}`, idempotencyKey: `legacy-key-${user.orgType}` }));
    assert.equal(response.status, 201, user.orgType);
    assert.equal(response.body.idempotent, false);
  }
});

test("public health signal exact replay is read-only and stores only hashed command identity", async () => {
  const harness = createHarness();
  const first = await harness.request(payload(), { "idempotency-key": "header-command-key" });
  const replay = await harness.request(payload({ idempotencyKey: "lower-priority-body-key-changed" }), { "idempotency-key": "header-command-key" });

  assert.equal(first.status, 201);
  assert.equal(first.body.idempotent, false);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.signal.id, first.body.signal.id);
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.seals, 1);
  const persisted = harness.getPersisted();
  const commandSignals = persisted.publicHealthSignals.filter((item) => item.commandKeyHash);
  assert.equal(commandSignals.length, 1);
  assert.match(commandSignals[0].commandKeyHash, /^[a-f0-9]{64}$/);
  assert.match(commandSignals[0].requestDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(persisted), /header-command-key|lower-priority-body-key-changed|phsig-route-idempotency-1/);
  const acceptedAudit = persisted.securityEvents.filter((item) => item.action === "public-health-highlight-signal");
  assert.equal(acceptedAudit.length, 1);
  assert.match(acceptedAudit[0].detail, /^signal=phsig-route-contract-1; requestDigest=[a-f0-9]{64}; scope=[a-f0-9]{16}$/);
  assert.doesNotMatch(acceptedAudit[0].detail, /contract-institution|PH-SIGNAL-CONTRACT-001|fever-respiratory-cases|value=9/);
});

test("public health signal key fallbacks and actor organization namespace remain deterministic", async () => {
  for (const body of [
    payload({ idempotencyKey: "body-key" }),
    payload({ idempotencyKey: undefined }),
    payload({ id: undefined, idempotencyKey: undefined })
  ]) {
    const harness = createHarness();
    const responses = await Promise.all([harness.request(body), harness.request(body)]);
    assert.deepEqual(responses.map((item) => item.status).sort(), [200, 201]);
    assert.equal(harness.calls.writes.length, 1);
  }

  const city = createHarness({ user: { name: "市级A", role: "commission", orgCode: "CITY-A", orgType: "city" } });
  const health = createHarness({ user: { name: "卫健B", role: "commission", orgCode: "HEALTH-B", orgType: "health_admin" } });
  const cityResponse = await city.request(payload({ id: "scope-a" }), { "idempotency-key": "shared-key" });
  const healthResponse = await health.request(payload({ id: "scope-b" }), { "idempotency-key": "shared-key" });
  assert.equal(cityResponse.body.signal.commandKeyHash, undefined);
  assert.equal(cityResponse.body.signal.requestDigest, undefined);
  assert.equal(healthResponse.body.signal.commandKeyHash, undefined);
  assert.equal(healthResponse.body.signal.requestDigest, undefined);
  assert.notEqual(
    city.getPersisted().publicHealthSignals[0].commandKeyHash,
    health.getPersisted().publicHealthSignals[0].commandKeyHash
  );
});

test("public health signal conflicting key reuse and occupied signal id return stable conflicts", async () => {
  const keyConflict = createHarness();
  await keyConflict.request(payload());
  const conflict = await keyConflict.request(payload({ value: 10 }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "PUBLIC_HEALTH_SIGNAL_IDEMPOTENCY_CONFLICT");
  assert.equal(keyConflict.calls.writes.length, 1);

  const idConflict = createHarness();
  await idConflict.request(payload());
  const occupied = await idConflict.request(payload({ idempotencyKey: "different-key", value: 10 }));
  assert.equal(occupied.status, 409);
  assert.equal(occupied.body.code, "PUBLIC_HEALTH_SIGNAL_ID_CONFLICT");
  assert.equal(idConflict.calls.writes.length, 1);
});

test("public health signal rejects generated id collisions for sequential and concurrent commands", async () => {
  const existing = createHarness({
    initialState: {
      publicHealthSignals: [{ id: "phsig-collision", sourceType: "临床症候群" }],
      securityEvents: []
    },
    randomUUID: () => "collision"
  });
  const occupied = await existing.request(payload({ id: undefined, idempotencyKey: "generated-id-occupied" }));
  assert.equal(occupied.status, 409);
  assert.equal(occupied.body.code, "PUBLIC_HEALTH_SIGNAL_ID_CONFLICT");
  assert.equal(existing.calls.writes.length, 0);

  const concurrent = createHarness({ randomUUID: () => "collision" });
  const responses = await Promise.all([
    concurrent.request(payload({ id: undefined, idempotencyKey: "generated-id-a" })),
    concurrent.request(payload({ id: undefined, idempotencyKey: "generated-id-b" }))
  ]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [201, 409]);
  assert.equal(responses.find((item) => item.status === 409).body.code, "PUBLIC_HEALTH_SIGNAL_ID_CONFLICT");
  assert.equal(concurrent.calls.writes.length, 1);
});

test("public health signal rejects malformed and non-canonical requests before state access", async () => {
  const malformed = createHarness({ collectError: new SyntaxError("secret parser details") });
  const malformedResponse = await malformed.request(payload());
  assert.deepEqual(malformedResponse.body, {
    error: "Bad Request",
    code: "PUBLIC_HEALTH_SIGNAL_BODY_INVALID",
    message: "public health signal body is invalid"
  });
  assert.equal(malformed.calls.reads, 0);

  for (const invalidPayload of [
    null,
    payload({ sourceType: "unsupported" }),
    payload({ value: "9" }),
    payload({ baseline: "2" }),
    payload({ id: "" }),
    payload({ idempotencyKey: "" }),
    payload({ observedAt: "not-a-date" }),
    payload({ x: "50" }),
    payload({ evidenceRefs: "evidence" }),
    payload({ evidenceRefs: [""] }),
    payload({ sourceOrgCode: "H000001", institutionCode: "H000002" })
  ]) {
    const harness = createHarness();
    const response = await harness.request(invalidPayload);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "PUBLIC_HEALTH_SIGNAL_INVALID");
    assert.equal(harness.calls.reads, 0);
    assert.equal(harness.calls.writes.length, 0);
  }
});

test("public health signal commits one bounded ledger record and chained audit in one write", async () => {
  const initialRows = Array.from({ length: 210 }, (_, index) => ({
    id: `legacy-signal-${index}`,
    sourceType: "环境",
    metric: "legacy",
    value: index
  }));
  const harness = createHarness({ initialState: { publicHealthSignals: initialRows, securityEvents: [] } });
  const response = await harness.request(payload());
  assert.equal(response.status, 201);
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.writes[0].publicHealthSignals.length, 200);
  assert.equal(harness.calls.writes[0].publicHealthSignals[0].id, response.body.signal.id);
  assert.equal(harness.calls.writes[0].securityEvents[0].target, response.body.signal.id);
});

test("public health signal maps scope-audit, SQLite CAS and storage failures without leaks", async () => {
  const auditFailure = createHarness({
    user: { name: "未知组织", role: "commission", orgCode: "ORG-OTHER", orgType: "other" },
    auditError: new Error("audit secret path")
  });
  const auditResponse = await auditFailure.request(payload());
  assert.equal(auditResponse.status, 500);
  assert.equal(auditResponse.body.code, "PUBLIC_HEALTH_SIGNAL_STORAGE_FAILED");
  assert.doesNotMatch(JSON.stringify(auditResponse.body), /secret|path/);

  const cas = createHarness({ writeError: new Error("SQLite optimistic lock conflict on publicHealthSignals: expected 2, current 3") });
  const casResponse = await cas.request(payload());
  assert.equal(casResponse.status, 409);
  assert.equal(casResponse.body.code, "PUBLIC_HEALTH_SIGNAL_VERSION_CONFLICT");
  assert.doesNotMatch(JSON.stringify(casResponse.body), /publicHealthSignals|expected 2|current 3/);
  assert.equal(cas.calls.writes.length, 1);
  assert.equal(cas.calls.appends.length, 0);

  const failed = createHarness({ writeError: new Error("disk failed with provider-secret") });
  const failedResponse = await failed.request(payload());
  assert.equal(failedResponse.status, 500);
  assert.equal(failedResponse.body.code, "PUBLIC_HEALTH_SIGNAL_STORAGE_FAILED");
  assert.doesNotMatch(JSON.stringify(failedResponse.body), /provider-secret|disk failed/);
  assert.equal(failed.calls.writes.length, 1);
  assert.equal(failed.calls.appends.length, 0);
});
