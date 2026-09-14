"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const V2 = require("../citizen-records-v2");
const { auditHashFor, verifyAuditTrail } = require("../src/identity-security/audit-chain");
const { createAccessAcknowledgementCommand } = require("../src/citizen-chronic/access-acknowledgement-command");

const NOW = "2026-09-14T10:00:00.000Z";
const USER = { id: "u1", username: "resident-one", role: "citizen", residentId: "r1" };
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
function envelope(accessLogId = "access-1", nonce = "one") {
  return V2.buildIdempotentAction({ operation: "access-acknowledge", residentId: "r1", nonce, requestedAt: NOW,
    payload: V2.buildAccessAcknowledgement({ residentId: "r1", accessLogId, acknowledgedAt: NOW }) });
}
function harness() {
  let state = { residents: [{ id: "r1" }], accessAcknowledgements: [], securityEvents: [],
    dataAccessLogs: [{ id: "original-access", result: "拒绝" }], personalRecords: [{ id: "authorization-original" }],
    storageMeta: { collectionVersions: { accessAcknowledgements: 0, securityEvents: 0 } } };
  let writes = 0;
  let queries = 0;
  let sequence = 0;
  let writeFailure;
  let queryFailure;
  let authorization = () => undefined;
  let authorizations = 0;
  const session = { sessionId: "session-one", user: USER };
  let policy = { production: false, storageMode: "json" };
  const execute = createAccessAcknowledgementCommand({
    readDatabase: () => state,
    validateAuthorization: (context) => {
      authorizations += 1;
      assert.equal(context.data, state);
      assert.equal(context.session, session);
      return authorization(context);
    },
    writeDatabase: (next) => {
      if (writeFailure) throw writeFailure;
      assert.notEqual(next, state, "mutations must use a private snapshot");
      state = structuredClone(next);
      writes += 1;
    },
    queryResidentAccessEvent: ({ user, accessLogId }) => {
      queries += 1;
      if (queryFailure) throw queryFailure;
      return Object.freeze({ schemaVersion: "resident-access-event.v1", residentId: user.residentId, accessLogId });
    },
    appendSecurityAudit: (next, event) => {
      const row = { ...event, previousAuditHash: next.securityEvents[0]?.auditHash || "" };
      row.auditHash = auditHashFor(row);
      next.securityEvents = [row, ...next.securityEvents];
    },
    verifyAuditTrail,
    getRuntimePolicy: () => policy,
    now: () => new Date(NOW),
    randomUUID: () => `server-${++sequence}`
  });
  const command = (payload = envelope(), user = USER, key = payload.idempotencyKey) => execute({ user, session, accessLogId: payload.accessLogId, payload, idempotencyKey: key });
  return { execute, command, get state() { return state; }, set state(next) { state = next; }, get writes() { return writes; }, get queries() { return queries; },
    get authorizations() { return authorizations; }, authorize(next) { authorization = next; },
    policy(next) { policy = next; }, failWrite(error) { writeFailure = error; }, failQuery(error) { queryFailure = error; } };
}

test("missing session and rejected or asynchronous live authorization fail before any write", async () => {
  const missing = harness();
  const payload = envelope();
  await assert.rejects(missing.execute({ user: USER, accessLogId: payload.accessLogId, payload, idempotencyKey: payload.idempotencyKey }), { code: "CARE_ACCESS_ACK_FORBIDDEN", statusCode: 403 });
  assert.equal(missing.authorizations, 0);
  assert.equal(missing.writes, 0);
  for (const guard of [() => false, () => { throw new Error("revoked"); }, () => Promise.resolve(true)]) {
    const h = harness();
    h.authorize(guard);
    const before = structuredClone(h.state);
    await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_FORBIDDEN", statusCode: 403 });
    assert.deepEqual(h.state, before);
    assert.equal(h.writes, 0);
    assert.equal(h.queries, 0);
  }
});

test("cached replay revalidates live session before exposing its receipt", async () => {
  const h = harness();
  await h.command();
  const before = structuredClone(h.state);
  h.authorize(() => { throw new Error("session revoked after first commit"); });
  await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_FORBIDDEN", statusCode: 403 });
  assert.equal(h.authorizations, 2);
  assert.equal(h.writes, 1);
  assert.deepEqual(h.state, before);
});

test("real frontend envelope produces server facts, minimal receipt and one atomic audit", async () => {
  const h = harness();
  const original = structuredClone(h.state);
  const payload = envelope();
  const result = await h.command(payload);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.schemaVersion, "resident-access-acknowledgement.v1");
  assert.equal(result.body.status, "accepted");
  assert.equal(result.body.decision, "recognized");
  assert.notEqual(result.body.id, payload.id);
  assert.equal(result.body.acknowledgedAt, NOW);
  assert.equal(result.body.acceptedAt, NOW);
  for (const key of ["actorId", "idempotencyKeyHash", "requestDigest", "idempotencyKey"]) assert.equal(Object.hasOwn(result.body, key), false);
  assert.equal(h.state.accessAcknowledgements.length, 1);
  assert.equal(h.state.securityEvents.length, 1);
  assert.equal(verifyAuditTrail(h.state.securityEvents).passed, true);
  assert.deepEqual(h.state.dataAccessLogs, original.dataAccessLogs);
  assert.deepEqual(h.state.personalRecords, original.personalRecords);
  const projected = V2.projectAccessAcknowledgementReceipt(result.body, payload);
  assert.equal(projected.id, result.body.id);
  assert.equal(projected.acknowledgedAt, NOW);
  assert.equal(projected.receiptId, result.body.receiptId);
});

test("replay is stable, rechecks event permission and never adds another write", async () => {
  const h = harness();
  const first = await h.command();
  const replay = await h.command();
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(h.writes, 1);
  assert.equal(h.queries, 2);
  h.failQuery(Object.assign(new Error("revoked event scope"), { code: "RESIDENT_ACCESS_EVENT_SCOPE_DENIED", statusCode: 403 }));
  await assert.rejects(h.command(), { code: "RESIDENT_ACCESS_EVENT_SCOPE_DENIED" });
  assert.equal(h.writes, 1);
});

for (const user of [{ ...USER, role: "commission" }, { ...USER, role: "institution" }, { ...USER, residentId: "r2" }, { role: "citizen", residentId: "r1" }]) {
  test(`only trusted self may declare: ${JSON.stringify(user)}`, async () => {
    const h = harness();
    await assert.rejects(h.command(envelope(), user), { code: "CARE_ACCESS_ACK_FORBIDDEN" });
    assert.equal(h.writes, 0);
  });
}

for (const [field, value] of [["id", "changed-client-id"], ["acknowledgedAt", "2026-09-14T09:00:00.000Z"], ["requestedAt", "2026-09-14T08:00:00.000Z"], ["accessLogId", "access-2"]]) {
  test(`same key binds complete request field ${field}`, async () => {
    const h = harness();
    const payload = envelope();
    await h.command(payload);
    await assert.rejects(h.command({ ...payload, [field]: value }), { code: "CARE_ACCESS_ACK_IDEMPOTENCY_CONFLICT" });
    assert.equal(h.writes, 1);
  });
}

test("same event under another key cannot replace the original declaration", async () => {
  const h = harness();
  await h.command();
  const before = structuredClone(h.state);
  await assert.rejects(h.command(envelope("access-1", "second")), { code: "CARE_ACCESS_ACK_ALREADY_ACKNOWLEDGED" });
  assert.deepEqual(h.state, before);
});

for (const mutation of [
  (p) => ({ ...p, extra: true }), (p) => ({ ...p, residentId: " r1" }),
  (p) => ({ ...p, acknowledgedAt: "yesterday" }), (p) => ({ ...p, status: "accepted" }),
  (p) => ({ ...p, decision: "authorized" }), (p) => ({ ...p, id: 123 }),
  (p) => ({ ...p, idempotencyKey: "x".repeat(241) })
]) {
  test(`malformed envelope fails before write ${mutation.toString()}`, async () => {
    const h = harness();
    await assert.rejects(h.command(mutation(envelope())), { code: "CARE_ACCESS_ACK_INVALID" });
    assert.equal(h.writes, 0);
  });
}

test("full 240-character keys work and distinct tails cannot alias", async () => {
  const h = harness();
  const payload = { ...envelope(), idempotencyKey: "k".repeat(239) + "a" };
  await h.command(payload);
  await assert.rejects(h.command({ ...payload, idempotencyKey: "k".repeat(239) + "b" }), { code: "CARE_ACCESS_ACK_ALREADY_ACKNOWLEDGED" });
  await assert.rejects(h.command(payload, USER, "mismatch"), { code: "CARE_ACCESS_ACK_KEY_MISMATCH" });
  await assert.rejects(h.command(payload, USER, ""), { code: "CARE_ACCESS_ACK_INVALID" });
});

function fillHistory(h, count) {
  const first = h.state.accessAcknowledgements[0];
  h.state.accessAcknowledgements = Array.from({ length: count }, (_, index) => index === 0 ? first : {
    ...first, id: `historical-${index}`, accessLogId: `historic-event-${index}`, resourceId: `historic-event-${index}`,
    receiptId: `historic-receipt-${index}`, auditRef: `historic-audit-${index}`, idempotencyKeyHash: digest(index), requestDigest: digest(`payload-${index}`)
  });
}

test("capacity 2000 refuses additions without eviction but permits valid replay", async () => {
  const h = harness();
  const first = await h.command();
  fillHistory(h, 1999);
  await h.command(envelope("access-2", "two"));
  assert.equal(h.state.accessAcknowledgements.length, 2000);
  const before = structuredClone(h.state);
  await assert.rejects(h.command(envelope("access-3", "three")), { code: "CARE_ACCESS_ACK_CAPACITY" });
  assert.deepEqual(h.state, before);
  assert.deepEqual((await h.command()).body, first.body);
});

test("historical over-capacity remains intact and cannot be normalized away", async () => {
  const h = harness();
  await h.command();
  fillHistory(h, 2001);
  const before = structuredClone(h.state);
  await assert.rejects(h.command(envelope("new", "new")), { code: "CARE_ACCESS_ACK_CAPACITY" });
  assert.deepEqual(h.state, before);
});

for (const stateValue of [null, {}, [{ id: "legacy-incomplete" }]]) {
  test(`malformed stored declarations are not repaired ${JSON.stringify(stateValue)}`, async () => {
    const h = harness();
    h.state.accessAcknowledgements = stateValue;
    const before = structuredClone(h.state);
    await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_STORED_STATE_INVALID" });
    assert.deepEqual(h.state, before);
  });
}

test("damaged operation audit fails closed without resealing", async () => {
  const h = harness();
  h.state.securityEvents = [{ id: "unsealed" }];
  await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_STORED_STATE_INVALID" });
  assert.deepEqual(h.state.securityEvents, [{ id: "unsealed" }]);
});

test("production and unsupported storage block both writes and replay", async () => {
  const h = harness();
  await h.command();
  for (const [policy, code] of [[{ production: true, storageMode: "sqlite" }, "CARE_ACCESS_ACK_PRODUCTION_DISABLED"], [{ production: false, storageMode: "postgres" }, "CARE_ACCESS_ACK_STORAGE_UNSUPPORTED"]]) {
    h.policy(policy);
    await assert.rejects(h.command(), { code });
    await assert.rejects(h.command(envelope("new", "new")), { code });
  }
  assert.equal(h.writes, 1);
});

test("storage exception and CAS conflict leave original references untouched and key retryable", async () => {
  const h = harness();
  const original = h.state;
  const before = structuredClone(original);
  h.failWrite(new Error("private-storage-secret"));
  await assert.rejects(h.command(), (error) => error.code === "CARE_ACCESS_ACK_STORAGE_FAILED" && !error.message.includes("private-storage-secret"));
  assert.equal(h.state, original);
  assert.deepEqual(original, before);
  h.failWrite(Object.assign(new Error("cas"), { code: "STORAGE_CONFLICT" }));
  await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_STORAGE_CONFLICT" });
  assert.deepEqual(original, before);
  h.failWrite(null);
  assert.equal((await h.command()).statusCode, 201);
});

test("same-process concurrent replay creates one declaration and audit", async () => {
  const h = harness();
  const results = await Promise.all([h.command(), h.command(), h.command()]);
  assert.deepEqual(results.map((row) => row.statusCode).sort(), [200, 200, 201]);
  assert.equal(h.writes, 1);
  assert.equal(h.state.securityEvents.length, 1);
});

test("concurrent new commands cannot both take the final capacity slot", async () => {
  const h = harness();
  await h.command();
  fillHistory(h, 1999);
  const results = await Promise.allSettled([h.command(envelope("last-a", "last-a")), h.command(envelope("last-b", "last-b"))]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(results.find((row) => row.status === "rejected").reason.code, "CARE_ACCESS_ACK_CAPACITY");
  assert.equal(h.state.accessAcknowledgements.length, 2000);
});

test("ack receipt projection rejects foreign, incomplete and local-preview responses", async () => {
  const h = harness();
  const result = await h.command();
  for (const change of [{ residentId: "r2" }, { resourceId: "other" }, { receiptId: "" }, { auditRef: "" },
    { id: "" }, { acknowledgedAt: "invalid" }, { status: "resolved" }, { syncStatus: "local-preview" }, { schemaVersion: "unknown" }]) {
    assert.throws(() => V2.projectAccessAcknowledgementReceipt({ ...result.body, ...change }, envelope()));
  }
});
