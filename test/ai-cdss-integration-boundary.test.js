"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRouteSegment: clinicalRoute } = require("../src/http/routes/platform-governance/phase2-operations");
const { createRouteSegment: governanceRoute } = require("../src/http/routes/identity-security/ai-governance");
const { sourceDigest } = require("../src/identity-security/ai-governance");
const { auditHashFor, verifyAuditTrail } = require("../src/identity-security/audit-chain");
const { createRouteSegments: stateRoutes } = require("../src/http/routes/state-data");
const { withLock } = require("../src/http/routes/identity-security/account-lifecycle");

function fixture() {
  let state = { phase2ClinicalAssistRules: [{ id: "rule-1", configStatus: "active", severity: "low" }], securityEvents: [] };
  let writes = 0;
  const ports = {
    readDatabase: () => state,
    writeDatabase: (next) => { state = next; writes++; },
    collectJson: async (req) => req.payload,
    requireApiRole: (req, res, roles) => { if (roles.includes(req.user.role)) return req.user; res.status = 403; return null; },
    sendJson: (res, status, body) => Object.assign(res, { status, body }),
    verifyAuditTrail,
    prependAuditTrailEntry: (rows, event) => {
      const row = { ...event, previousAuditHash: rows[0]?.auditHash || "" };
      return [{ ...row, auditHash: auditHashFor(row) }, ...rows];
    },
    randomUUID: () => "audit-1",
    buildPhase2ClinicalAssistOverview: () => ({ productionReady: false }),
    enforceSensitiveMutation: () => true
  };
  return { ports, get state() { return state; }, get writes() { return writes; } };
}
const actor = { id: "reviewer", role: "commission" };
const url = (path) => new URL(path, "http://local");

test("clinical receipt and AI registration share the same state mutation lock", async () => {
  const f = fixture();
  let unlock; let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const paused = new Promise((resolve) => { unlock = resolve; });
  const clinical = clinicalRoute({ ...f.ports, executePhase2ClinicalAssistReceipt: async () => { entered(); await paused; return { productionReady: false }; } });
  const receipt = clinical.handle({ method: "POST", headers: {}, user: actor, payload: {} }, {}, url("/api/phase2/clinical-assist/alerts/a1/receipt"));
  await started;
  const response = {};
  const command = governanceRoute(f.ports).handle({ method: "POST", headers: {}, user: actor, payload: {
    action: "register", expectedVersion: 0, idempotencyKey: "register-1",
    card: { sourceRef: "rule:1", sourceDigest: sourceDigest(f.state.phase2ClinicalAssistRules[0]), ruleVersion: "1", evidenceRef: "evidence:1", evidenceDigest: "a".repeat(64), riskLevel: "low" }
  } }, response, url("/api/ai-governance/rules/rule-1/actions"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.writes, 0);
  unlock(); await Promise.all([receipt, command]);
  assert.equal(f.writes, 1); assert.equal(response.status, 200);
  assert.equal(f.state.phase2ClinicalAssistRules[0].governance.status, "draft");
});

test("legacy rule configuration rejects governed rules, wrong roles, invalid values and broken audit", async () => {
  for (const condition of ["governed", "role", "payload", "audit", "storage"]) {
    const f = fixture();
    if (condition === "governed") f.state.phase2ClinicalAssistRules[0].governance = { version: 1 };
    if (condition === "audit") f.state.securityEvents.push({ id: "bad" });
    const original = structuredClone(f.state);
    const ports = { ...f.ports };
    if (condition === "storage") ports.writeDatabase = () => { throw Error("private storage detail"); };
    const response = {};
    await clinicalRoute(ports).handle({ method: "POST", user: condition === "role" ? { id: "doctor", role: "institution" } : actor,
      payload: { severity: condition === "payload" ? "unexpected" : "high" }
    }, response, url("/api/phase2/clinical-assist/rules/rule-1/config"));
    assert.equal(response.status, { governed: 409, role: 403, payload: 400, audit: 409, storage: 500 }[condition]);
    assert.deepEqual(f.state, original); assert.equal(f.writes, 0);
    assert.equal(JSON.stringify(response).includes("private storage detail"), false);
  }
});

test("missing clinical organization is a stable forbidden response", async () => {
  const f = fixture(); const response = {};
  f.ports.buildPhase2ClinicalAssistOverview = () => { throw Object.assign(new Error("private"), { code: "CDSS_SCOPE_DENIED", statusCode: 403 }); };
  await clinicalRoute(f.ports).handle({ method: "GET", user: actor }, response, url("/api/phase2/clinical-assist"));
  assert.equal(response.status, 403); assert.equal(response.body.code, "CDSS_SCOPE_DENIED");
  assert.equal(JSON.stringify(response).includes("private"), false);
});

test("unrelated state routes and pending request bodies do not acquire the clinical mutation lock", async () => {
  const f = fixture(); let rejectBody;
  f.ports.collectJson = () => new Promise((_resolve, reject) => { rejectBody = reject; });
  const route = stateRoutes(f.ports).find((item) => item.id === "state-data-02");
  await withLock("clinical-assist:state", async () => {
    assert.equal(await route.handle({ method: "GET" }, {}, url("/api/unrelated")), false);
  });
  const pending = route.handle({ method: "PUT", user: actor }, {}, url("/api/state"));
  const rejected = assert.rejects(pending, /body-aborted/);
  await withLock("clinical-assist:state", async () => { assert.equal(f.writes, 0); });
  rejectBody(new Error("body-aborted"));
  await rejected;
});

test("production rejects the legacy config path before request body parsing", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const f = fixture(); const response = {};
    f.ports.collectJson = () => { throw new Error("body must not be read"); };
    await clinicalRoute(f.ports).handle({ method: "POST", user: actor }, response, url("/api/phase2/clinical-assist/rules/rule-1/config"));
    assert.equal(response.status, 403); assert.equal(response.body.code, "CDSS_LEGACY_CONFIG_DISABLED");
    assert.equal(f.writes, 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
