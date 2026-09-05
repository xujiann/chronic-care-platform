"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAiGovernanceCenter, executeAiGovernanceAction, sourceDigest } = require("../src/identity-security/ai-governance");
const { createRouteSegment } = require("../src/http/routes/identity-security/ai-governance");
const { verifyAuditTrail, auditHashFor } = require("../src/identity-security/audit-chain");
const author = { id: "author", role: "commission" };
const reviewer = { id: "reviewer", role: "commission" };
const seed = () => ({ phase2ClinicalAssistRules: [{ id: "rule-1", enabled: true, threshold: 3 }], phase2ClinicalAssistAlerts: [{ residentId: "private" }], securityEvents: [] });
function payload(data, action = "register", version = 0) {
  return { action, expectedVersion: version, idempotencyKey: `key-${action}-${version}`, ...(action === "register" ? { card: { sourceRef: "rules:rule-1", sourceDigest: sourceDigest(data.phase2ClinicalAssistRules[0]), ruleVersion: "v1", evidenceRef: "evidence:rule-1", evidenceDigest: "a".repeat(64), riskLevel: "high" } } : {}) };
}
function run(data, action, version, actor = author) { return executeAiGovernanceAction(data, "rule-1", payload(data, action, version), actor); }
test("governance lifecycle preserves clinical rule and needs independent approval", () => {
  const original = seed();
  let result = run(original, "register", 0);
  assert.equal(original.phase2ClinicalAssistRules[0].governance, undefined);
  assert.equal(result.response.rule.governance.status, "draft");
  result = run(result.state, "submit", 1);
  assert.throws(() => run(result.state, "approve", 2), { code: "AI_GOVERNANCE_SELF_REVIEW" });
  result = run(result.state, "approve", 2, reviewer);
  assert.equal(result.response.rule.governance.status, "approved");
  assert.equal(result.response.productionReady, false);
  result = run(result.state, "suspend", 3, reviewer);
  result = run(result.state, "rollback", 4, reviewer);
  assert.equal(result.response.rule.governance.status, "draft");
  assert.equal(result.state.phase2ClinicalAssistRules[0].threshold, 3);
  assert.equal(result.state.phase2ClinicalAssistRules[0].governance.history.length, 5);
});
test("center omits clinical data and refuses unauthorized or missing actors", () => {
  const result = buildAiGovernanceCenter(seed(), author);
  assert.equal(result.summary.unregistered, 1);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("threshold"), false);
  for (const actor of [null, { role: "citizen", id: "x" }, { role: "commission" }]) {
    assert.throws(() => buildAiGovernanceCenter(seed(), actor));
    assert.throws(() => run(seed(), "register", 0, actor));
  }
});
test("input, source, state and version are strictly validated", () => {
  const data = seed();
  const p = payload(data);
  for (const mutated of [{ ...p, patientText: "forbidden" }, { ...p, expectedVersion: "0" }, { ...p, card: { ...p.card, name: "forbidden" } }, { ...p, card: { ...p.card, sourceRef: "arbitrary text" } }]) assert.throws(() => executeAiGovernanceAction(data, "rule-1", mutated, author));
  assert.throws(() => run(data, "register", 1), { code: "AI_GOVERNANCE_VERSION_CONFLICT" });
  assert.throws(() => run(data, "submit", 0), { code: "AI_GOVERNANCE_STATE_CONFLICT" });
  const registered = run(data, "register", 0).state;
  registered.phase2ClinicalAssistRules[0].threshold = 4;
  assert.throws(() => run(registered, "submit", 1), { code: "AI_GOVERNANCE_SOURCE_CHANGED" });
  assert.throws(() => executeAiGovernanceAction(data, "missing", p, author), { code: "AI_GOVERNANCE_NOT_FOUND" });
});
test("receipt replays exact snapshot, rejects changed payload and binds actor", () => {
  const data = seed(); const p = payload(data);
  const first = executeAiGovernanceAction(data, "rule-1", p, author);
  const replay = executeAiGovernanceAction(first.state, "rule-1", p, author);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.response, first.response);
  assert.throws(() => executeAiGovernanceAction(first.state, "rule-1", { ...p, card: { ...p.card, riskLevel: "low" } }, author), { code: "AI_GOVERNANCE_KEY_CONFLICT" });
  assert.throws(() => executeAiGovernanceAction(first.state, "rule-1", p, reviewer), { code: "AI_GOVERNANCE_VERSION_CONFLICT" });
  assert.throws(() => executeAiGovernanceAction(data, "rule-1", p, author, { idempotencyKey: "different" }), { code: "AI_GOVERNANCE_KEY_MISMATCH" });
});
test("HTTP persists audit and state once; audit/storage failures never mutate input", async () => {
  for (const failure of [null, "audit", "storage"]) {
    let data = seed(); const original = structuredClone(data); let writes = 0; let response;
    const p = payload(data);
    const segment = createRouteSegment({ verifyAuditTrail, collectJson: async () => p, readDatabase: () => data, writeDatabase: async (state) => { writes++; if (failure === "storage") throw Error("secret"); data = state; }, requireApiRole: () => author, sendJson: (_res, status, body) => { response = { status, body }; }, prependAuditTrailEntry: (events, event) => { if (failure === "audit") throw Error("secret"); const sealed = { ...event, previousAuditHash: events[0]?.auditHash || "" }; return [{ ...sealed, auditHash: auditHashFor(sealed) }, ...events]; }, enforceSensitiveMutation: () => true });
    const req = { method: "POST", headers: {} }; const url = new URL("http://local/api/ai-governance/rules/rule-1/actions");
    assert.equal(await segment.handle(req, {}, url), true);
    if (failure) { assert.equal(response.status, 500); assert.deepEqual(data, original); assert.equal(JSON.stringify(response).includes("secret"), false); }
    else { assert.equal(response.status, 200); assert.equal(writes, 1); assert.equal(data.securityEvents.length, 1); await segment.handle(req, {}, url); assert.equal(writes, 1); assert.equal(response.body.idempotentReplay, true); }
  }
});
test("HTTP unauthorized and absent mutation guard fail before body/read/write", async () => {
  let touched = 0; let response;
  const ports = { verifyAuditTrail, collectJson: () => { touched++; }, readDatabase: () => { touched++; }, writeDatabase: () => { touched++; }, requireApiRole: () => null, sendJson: (_res, status) => { response = status; }, prependAuditTrailEntry: () => [] };
  const req = { method: "POST" }; const url = new URL("http://local/api/ai-governance/rules/rule-1/actions");
  await createRouteSegment(ports).handle(req, {}, url); assert.equal(touched, 0);
  await createRouteSegment({ ...ports, requireApiRole: () => author }).handle(req, {}, url); assert.equal(response, 503); assert.equal(touched, 0);
});
test("tampered existing audit chain is rejected before reseal or write", async () => {
  const data = seed(); data.securityEvents = [{ id: "tampered", action: "forged" }];
  let status; let touched = 0;
  const segment = createRouteSegment({ verifyAuditTrail, collectJson: async () => payload(data), readDatabase: () => data, writeDatabase: () => { touched++; }, requireApiRole: () => author, sendJson: (_res, code) => { status = code; }, prependAuditTrailEntry: () => { touched++; }, enforceSensitiveMutation: () => true });
  await segment.handle({ method: "POST", headers: {} }, {}, new URL("http://local/api/ai-governance/rules/rule-1/actions"));
  assert.equal(status, 409); assert.equal(touched, 0); assert.equal(data.phase2ClinicalAssistRules[0].governance, undefined);
});
test("approved source drift becomes stale and requires a new registration and approval", () => {
  let data = run(seed(), "register", 0).state;
  data = run(data, "submit", 1).state;
  data = run(data, "approve", 2, reviewer).state;
  const originalRequest = payload(data, "approve", 2);
  data.phase2ClinicalAssistRules[0].threshold = 10;
  const center = buildAiGovernanceCenter(data, author);
  assert.equal(center.summary.approved, 0); assert.equal(center.summary.stale, 1);
  assert.equal(center.rules[0].governance.storedStatus, "approved");
  assert.equal(center.rules[0].governance.sourceIntegrity, "drifted");
  const replay = executeAiGovernanceAction(data, "rule-1", originalRequest, reviewer);
  assert.equal(replay.replayed, true); assert.equal(replay.response.rule.governance.status, "approved");
  assert.throws(() => run(data, "suspend", 3), { code: "AI_GOVERNANCE_SOURCE_CHANGED" });
  const renewed = run(data, "register", 3);
  assert.equal(renewed.response.rule.governance.status, "draft");
  assert.equal(renewed.response.rule.governance.sourceIntegrity, "matched");
});
test("capacity and version exhaustion reject fresh commands without evicting replay receipts", () => {
  const initial = seed(); const original = payload(initial);
  const data = run(initial, "register", 0).state;
  data.phase2ClinicalAssistRules[0].governance.version = Number.MAX_SAFE_INTEGER;
  assert.throws(() => run(data, "register", Number.MAX_SAFE_INTEGER), { code: "AI_GOVERNANCE_VERSION_EXHAUSTED" });
  data.phase2ClinicalAssistRules[0].governance.version = 1;
  for (const field of ["history", "receipts"]) {
    const saturated = structuredClone(data); saturated.phase2ClinicalAssistRules[0].governance[field] = Array(1000).fill(saturated.phase2ClinicalAssistRules[0].governance[field][0]);
    assert.throws(() => run(saturated, "register", 1), { code: "AI_GOVERNANCE_CAPACITY_EXHAUSTED" });
    assert.equal(executeAiGovernanceAction(saturated, "rule-1", original, author).replayed, true);
  }
});
test("actor organization change cannot replay another organization context receipt", () => {
  const data = seed(); const p = payload(data);
  const result = executeAiGovernanceAction(data, "rule-1", p, { ...author, orgCode: "org-a" });
  assert.throws(() => executeAiGovernanceAction(result.state, "rule-1", p, { ...author, orgCode: "org-b" }), { code: "AI_GOVERNANCE_KEY_CONFLICT" });
});
