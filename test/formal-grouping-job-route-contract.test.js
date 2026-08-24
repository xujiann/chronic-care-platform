"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const DiseasePaymentIntake = require("../disease-payment-intake");
const DiseasePaymentService = require("../disease-payment-service");
const { createRouteSegments } = require("../src/http/routes/insurance-payment");

function payload(overrides = {}) {
  return {
    id: "formal-job-route-1",
    correlationId: "formal-correlation-route-1",
    idempotencyKey: "formal-idempotency-route-1",
    mode: "DRG",
    schemeVersion: "DRG-2.0-DL",
    caseIds: ["dp-case-001"],
    maxAttempts: 3,
    ...overrides
  };
}

function createHarness(options = {}) {
  let persisted = structuredClone(options.initialState || {
    diseasePayment: DiseasePaymentService.seedDiseasePaymentState(),
    securityEvents: [],
    storageMeta: {
      engine: "sqlite",
      collectionVersions: { diseasePayment: 4, securityEvents: 8 }
    }
  });
  let sequence = 0;
  const calls = {
    appendSecurityEvent: [],
    authorization: [],
    collects: 0,
    reads: 0,
    responsibilityChecks: 0,
    writes: []
  };
  const defaultUser = options.user || {
    username: "insurance-operator",
    name: "医保正式分组员",
    role: "insurance",
    orgCode: "ORG-MI-CENTER-DL",
    orgType: "insurance_center"
  };
  const runtime = {
    DiseasePaymentIntake,
    DiseasePaymentService,
    appendSecurityEvent(event) {
      calls.appendSecurityEvent.push(structuredClone(event));
      if (options.auditError) throw options.auditError;
    },
    authorizeInsurancePaymentAction(action) {
      calls.responsibilityChecks += 1;
      assert.equal(action, "formal-grouping.create");
      return options.responsibilityDenied !== true;
    },
    collectJson(req) {
      calls.collects += 1;
      if (options.collectError) return Promise.reject(options.collectError);
      return Promise.resolve(structuredClone(req.body));
    },
    prependAuditTrailEntry(rows, entry) {
      return [entry, ...(Array.isArray(rows) ? rows : [])].slice(0, 120);
    },
    randomUUID() {
      sequence += 1;
      return `formal-audit-${sequence}`;
    },
    readDatabase() {
      calls.reads += 1;
      return structuredClone(persisted);
    },
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return options.authorized === false ? null : defaultUser;
    },
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
  const segment = createRouteSegments(runtime).find((item) => item.id === "insurance-payment-02");
  return {
    calls,
    getPersisted: () => structuredClone(persisted),
    async request(body) {
      const res = {};
      const handled = await segment.handle(
        { method: "POST", body, headers: {} },
        res,
        new URL("http://platform.test/api/disease-payment/formal-grouping/jobs")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("formal grouping create denies identity and responsibility before body or state access", async () => {
  const identityDenied = createHarness({ authorized: false });
  const identityResponse = await identityDenied.request(payload());
  assert.equal(identityResponse.status, undefined);
  assert.equal(identityDenied.calls.collects, 0);
  assert.equal(identityDenied.calls.reads, 0);
  assert.equal(identityDenied.calls.writes.length, 0);

  const responsibilityDenied = createHarness({ responsibilityDenied: true });
  const responsibilityResponse = await responsibilityDenied.request(payload());
  assert.equal(responsibilityResponse.status, undefined);
  assert.equal(responsibilityDenied.calls.collects, 0);
  assert.equal(responsibilityDenied.calls.reads, 0);
  assert.equal(responsibilityDenied.calls.writes.length, 0);
});

test("formal grouping create rejects district commission scope before body or state access", async () => {
  const harness = createHarness({
    user: {
      username: "district",
      name: "区县监管员",
      role: "commission",
      orgCode: "ORG-DIST-ZS",
      orgType: "district"
    }
  });
  const response = await harness.request(payload());

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "FORMAL_GROUPING_CASE_SCOPE_DENIED");
  assert.equal(harness.calls.collects, 0);
  assert.equal(harness.calls.reads, 0);
  assert.equal(harness.calls.writes.length, 0);
  assert.equal(harness.calls.appendSecurityEvent[0].detail, "FORMAL_GROUPING_CASE_SCOPE_DENIED");

  const districtInsurance = createHarness({
    user: {
      username: "district_mi",
      name: "区市县医保局管理员",
      role: "insurance",
      orgCode: "ORG-MI-DIST-ZS",
      orgType: "district_insurance_bureau"
    }
  });
  const districtInsuranceResponse = await districtInsurance.request(payload());
  assert.equal(districtInsuranceResponse.status, 403);
  assert.equal(districtInsuranceResponse.body.code, "FORMAL_GROUPING_CASE_SCOPE_DENIED");
  assert.equal(districtInsurance.calls.collects, 0);
  assert.equal(districtInsurance.calls.reads, 0);

  const auditFailure = createHarness({
    user: {
      username: "district_mi",
      name: "区市县医保局管理员",
      role: "insurance",
      orgCode: "ORG-MI-DIST-ZS",
      orgType: "district_insurance_bureau"
    },
    auditError: new Error("audit storage failed: internal-path")
  });
  const auditFailureResponse = await auditFailure.request(payload());
  assert.equal(auditFailureResponse.status, 500);
  assert.equal(auditFailureResponse.body.code, "FORMAL_GROUPING_JOB_STORAGE_FAILED");
  assert.doesNotMatch(JSON.stringify(auditFailureResponse.body), /internal-path|audit storage failed/);
  assert.equal(auditFailure.calls.collects, 0);
  assert.equal(auditFailure.calls.reads, 0);
});

test("formal grouping create allows only city platform and insurance bureau or center scopes", async () => {
  const users = [
    { username: "city", name: "市级管理员", role: "commission", orgType: "city" },
    { username: "health", name: "卫健委管理员", role: "commission", orgType: "health_admin" },
    { username: "bureau", name: "医保局管理员", role: "insurance", orgType: "insurance_bureau" },
    { username: "center", name: "医保中心审核员", role: "insurance", orgType: "insurance_center" }
  ];
  for (const [index, user] of users.entries()) {
    const harness = createHarness({ user });
    const response = await harness.request(payload({
      id: `formal-job-scope-${index}`,
      correlationId: `formal-correlation-scope-${index}`,
      idempotencyKey: `formal-idempotency-scope-${index}`
    }));
    assert.equal(response.status, 201, user.orgType);
  }
});

test("formal grouping create exact replay is read-only and preserves one durable job and audit", async () => {
  const harness = createHarness();
  const first = await harness.request(payload());
  const replay = await harness.request(payload());

  assert.equal(first.status, 201);
  assert.equal(first.body.idempotent, false);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.job.id, first.body.job.id);
  assert.equal(harness.calls.writes.length, 1);
  const persisted = harness.getPersisted();
  assert.equal(persisted.diseasePayment.formalGroupingJobs.length, 1);
  assert.equal(persisted.securityEvents.length, 1);
});

test("formal grouping create serializes concurrent replay and conflicting reuse", async () => {
  const replayHarness = createHarness();
  const replayResults = await Promise.all([
    replayHarness.request(payload()),
    replayHarness.request(payload())
  ]);
  assert.deepEqual(replayResults.map((item) => item.status).sort(), [200, 201]);
  assert.equal(replayHarness.getPersisted().diseasePayment.formalGroupingJobs.length, 1);
  assert.equal(replayHarness.calls.writes.length, 1);

  const implicitHarness = createHarness();
  const implicitRequest = payload({ id: undefined, correlationId: undefined, idempotencyKey: undefined });
  const implicitResults = await Promise.all([
    implicitHarness.request(implicitRequest),
    implicitHarness.request(implicitRequest)
  ]);
  assert.deepEqual(implicitResults.map((item) => item.status).sort(), [200, 201]);
  assert.equal(implicitResults[0].body.job.id, implicitResults[1].body.job.id);
  assert.equal(implicitHarness.getPersisted().diseasePayment.formalGroupingJobs.length, 1);
  assert.equal(implicitHarness.calls.writes.length, 1);

  const conflictHarness = createHarness();
  const conflictResults = await Promise.all([
    conflictHarness.request(payload()),
    conflictHarness.request(payload({ caseIds: ["dp-case-002"] }))
  ]);
  assert.deepEqual(conflictResults.map((item) => item.status).sort(), [201, 409]);
  assert.equal(conflictResults.find((item) => item.status === 409).body.code, "FORMAL_GROUPING_JOB_IDEMPOTENCY_CONFLICT");
  assert.equal(conflictHarness.getPersisted().diseasePayment.formalGroupingJobs.length, 1);
  assert.equal(conflictHarness.calls.writes.length, 1);
});

test("formal grouping create commits queued job and chained audit in one write", async () => {
  const harness = createHarness();
  const response = await harness.request(payload());

  assert.equal(response.status, 201);
  assert.equal(harness.calls.writes.length, 1);
  const committed = harness.calls.writes[0];
  assert.equal(committed.diseasePayment.formalGroupingJobs.length, 1);
  assert.equal(committed.securityEvents.length, 1);
  assert.equal(committed.securityEvents[0].action, "create formal grouping job");
  assert.equal(committed.securityEvents[0].target, response.body.job.id);
  assert.match(committed.securityEvents[0].detail, new RegExp(response.body.job.requestDigest));
  assert.equal(harness.calls.appendSecurityEvent.length, 0);
});

test("formal grouping create returns stable validation, not-found and conflict errors", async () => {
  const malformed = createHarness({ collectError: new SyntaxError("secret parser detail") });
  const malformedResponse = await malformed.request(payload());
  assert.deepEqual(malformedResponse.body, {
    error: "Bad Request",
    code: "FORMAL_GROUPING_JOB_BODY_INVALID",
    message: "formal grouping job body is invalid"
  });
  assert.equal(malformed.calls.reads, 0);

  for (const invalidPayload of [
    payload({ mode: "INVALID" }),
    payload({ caseIds: "dp-case-001" }),
    payload({ caseIds: [] }),
    payload({ caseIds: [""] }),
    payload({ maxAttempts: "3" }),
    payload({ idempotencyKey: "" })
  ]) {
    const strict = createHarness();
    const strictResponse = await strict.request(invalidPayload);
    assert.equal(strictResponse.status, 400);
    assert.equal(strictResponse.body.code, "FORMAL_GROUPING_JOB_INVALID");
    assert.equal(strict.calls.reads, 0);
    assert.equal(strict.calls.writes.length, 0);
  }

  const invalid = createHarness();
  const invalidResponse = await invalid.request(payload({ schemeVersion: "UNAPPROVED" }));
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResponse.body.code, "FORMAL_GROUPING_JOB_INVALID");

  const missing = createHarness();
  const missingResponse = await missing.request(payload({ caseIds: ["missing-case"] }));
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.body.code, "FORMAL_GROUPING_CASE_NOT_FOUND");

  const conflict = createHarness();
  await conflict.request(payload());
  const conflictResponse = await conflict.request(payload({ idempotencyKey: "new-key", caseIds: ["dp-case-002"] }));
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflictResponse.body.code, "FORMAL_GROUPING_JOB_ID_CONFLICT");
});

test("formal grouping create maps CAS and storage failures without leaking internal details", async () => {
  const cas = createHarness({
    writeError: new Error("SQLite optimistic lock conflict on securityEvents: expected 8, current 9")
  });
  const casResponse = await cas.request(payload());
  assert.equal(casResponse.status, 409);
  assert.equal(casResponse.body.code, "FORMAL_GROUPING_JOB_VERSION_CONFLICT");
  assert.doesNotMatch(JSON.stringify(casResponse.body), /securityEvents|expected 8|current 9/);
  assert.equal(cas.calls.writes.length, 1);
  assert.equal(cas.getPersisted().diseasePayment.formalGroupingJobs.length, 0);

  const failed = createHarness({ writeError: new Error("disk failed: provider-secret") });
  const failedResponse = await failed.request(payload());
  assert.equal(failedResponse.status, 500);
  assert.equal(failedResponse.body.code, "FORMAL_GROUPING_JOB_STORAGE_FAILED");
  assert.equal(failedResponse.body.message, "formal grouping job storage failed");
  assert.doesNotMatch(JSON.stringify(failedResponse.body), /provider-secret|disk failed/);
  assert.equal(failed.calls.writes.length, 1);
  assert.equal(failed.calls.appendSecurityEvent.length, 0);
  assert.equal(failed.getPersisted().securityEvents.length, 0);
});
