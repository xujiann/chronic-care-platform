"use strict";

// Synthetic component composition only: no principal, current authorization or recovery claim.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createGs03ReceiptCompositionHarness } = require("./helpers/gs03-receipt-composition");

const AT = "2026-10-09T00:00:00.000Z";
const ACTOR = "synthetic-gs03-actor";
const NAMESPACE_A = "a".repeat(64);
const NAMESPACE_B = "d".repeat(64);
const KEY_A = "b".repeat(64);
const KEY_B = "e".repeat(64);
const INTENT_A = "c".repeat(64);
const INTENT_B = "f".repeat(64);
const CONTRACTS = ["referral-feedback-callback", "referral-schedule-callback", "referral-report-callback"];
const firstCommand = Object.freeze({
  namespaceDigest: NAMESPACE_A, contractId: CONTRACTS[0], keyDigest: KEY_A,
  targetId: "case-synthetic-1", authorizationId: "authorization-synthetic-1", intentDigest: INTENT_A
});
const updateCommand = Object.freeze({
  ...firstCommand, keyDigest: KEY_B, intentDigest: INTENT_B
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function identifiers(command) {
  const digest = sha256(JSON.stringify([command.namespaceDigest, command.contractId, command.keyDigest]));
  return {
    receipt: `synthetic-receipt:${digest}`,
    security: `synthetic-security:${digest}`,
    access: `synthetic-access:${digest}`,
    message1: `synthetic-message:${digest}:1`,
    message2: `synthetic-message:${digest}:2`
  };
}

function eventFor(command, kind, priorHash) {
  const ids = identifiers(command);
  const event = {
    id: kind === "security" ? ids.security : ids.access,
    at: AT,
    action: kind === "security" ? command.contractId : "data-access",
    role: "synthetic",
    result: "allowed",
    actor: ACTOR,
    [kind === "security" ? "target" : "scope"]: command.targetId,
    authorizationId: command.authorizationId,
    receiptId: ids.receipt,
    intentDigest: command.intentDigest,
    previousAuditHash: priorHash
  };
  return { ...event, auditHash: sha256(canonical(event)) };
}

function expectedSourceRow(event, stream, sequence, previousSourceHash) {
  const { auditHash, previousAuditHash, ...record } = event;
  assert.equal(typeof auditHash, "string");
  assert.equal(typeof previousAuditHash, "string");
  const projection = {
    schemaVersion: "audit-delivery-minimal-projection-v1",
    stream,
    sourceEventId: event.id,
    occurredAt: AT,
    classification: stream === "dataAccessLogs" ? "restricted-data-access" : "security-event",
    action: stream === "dataAccessLogs" ? "data-access" : event.action,
    result: "allowed",
    role: "synthetic",
    actorRefDigest: sha256(`actor:${ACTOR}`),
    subjectRefDigest: "",
    targetRefDigest: sha256(`target:${stream === "dataAccessLogs" ? event.scope : event.target}`)
  };
  const projectionJson = canonical(projection);
  const sourceDigest = sha256(canonical({ stream, sourceEventId: event.id, record }));
  const projectionDigest = sha256(projectionJson);
  const sourceHash = sha256(canonical({
    contract: "append-only-audit-source-v2", sequence, stream,
    sourceEventId: event.id, occurredAt: AT, sourceDigest, projectionDigest,
    previousSourceHash, historicalBaseline: false, recordedAt: AT
  }));
  return {
    sequence, stream, source_event_id: event.id, occurred_at: AT,
    source_digest: sourceDigest, projection_schema: "audit-delivery-minimal-projection-v1",
    projection_json: projectionJson, projection_digest: projectionDigest,
    previous_source_hash: previousSourceHash, source_hash: sourceHash,
    historical_baseline: 0, recorded_at: AT
  };
}

function expectedSnapshot(commands = []) {
  const cases = new Map();
  const messages = [];
  const securityAudit = [];
  const accessAudit = [];
  const sourceEvents = [];
  const receipts = [];
  let securityHash = "";
  let accessHash = "";
  let sourceHash = "";
  for (const command of commands) {
    const ids = identifiers(command);
    const previous = cases.get(command.targetId);
    cases.set(command.targetId, {
      target_id: command.targetId, intent_digest: command.intentDigest,
      version: (previous?.version || 0) + 1
    });
    messages.push(
      { message_id: ids.message1, receipt_id: ids.receipt, slot: 1,
        target_id: command.targetId, intent_digest: command.intentDigest },
      { message_id: ids.message2, receipt_id: ids.receipt, slot: 2,
        target_id: command.targetId, intent_digest: command.intentDigest }
    );
    const security = eventFor(command, "security", securityHash);
    const access = eventFor(command, "access", accessHash);
    securityHash = security.auditHash;
    accessHash = access.auditHash;
    securityAudit.push({ sequence: securityAudit.length + 1, event_id: ids.security,
      receipt_id: ids.receipt, event_json: security });
    accessAudit.push({ sequence: accessAudit.length + 1, event_id: ids.access,
      receipt_id: ids.receipt, event_json: access });
    for (const [event, stream] of [[security, "securityEvents"], [access, "dataAccessLogs"]]) {
      const row = expectedSourceRow(event, stream, sourceEvents.length + 1, sourceHash);
      sourceEvents.push(row);
      sourceHash = row.source_hash;
    }
    receipts.push({
      receipt_id: ids.receipt, namespace_digest: command.namespaceDigest,
      contract_id: command.contractId, contract_version: 2, key_digest: command.keyDigest,
      target_id: command.targetId, authorization_id: command.authorizationId,
      intent_digest_version: 2, intent_digest: command.intentDigest,
      result_status: "committed", recorded_at_ms: Date.parse(AT),
      security_stream: "securityEvents", security_audit_event_id: ids.security,
      access_stream: "dataAccessLogs", access_audit_event_id: ids.access
    });
  }
  return {
    cases: [...cases.values()].sort((a, b) => a.target_id.localeCompare(b.target_id)),
    messages: messages.sort((a, b) => a.message_id.localeCompare(b.message_id)),
    securityAudit, accessAudit, sourceEvents,
    receipts: receipts.sort((a, b) => a.receipt_id.localeCompare(b.receipt_id)),
    databaseList: ["main"], transactionOpen: false
  };
}

function normalize(snapshot) {
  return {
    ...snapshot,
    securityAudit: snapshot.securityAudit.map((row) => ({ ...row, event_json: JSON.parse(row.event_json) })),
    accessAudit: snapshot.accessAudit.map((row) => ({ ...row, event_json: JSON.parse(row.event_json) }))
  };
}

function assertSnapshot(actual, commands = []) {
  assert.deepEqual(normalize(actual), expectedSnapshot(commands));
}

function assertOutcome(result, status, phase) {
  assert.deepEqual(result, { status, phase, productionReady: false });
}

async function harness(t) {
  const value = await createGs03ReceiptCompositionHarness({ environment: "test" });
  t.after(() => value.close());
  assert.equal(Object.isFrozen(value), true);
  assert.equal(value.productionReady, false);
  assertSnapshot(value.snapshot());
  return value;
}

for (const contractId of CONTRACTS) {
  test(`${contractId} commits one complete receipt, exact replay and private conflicts`, async (t) => {
    const h = await harness(t);
    const command = { ...firstCommand, contractId };
    assertOutcome(await h.execute(command), "confirmed-first", "commit");
    assertSnapshot(h.snapshot(), [command]);
    assertOutcome(await h.execute(command), "confirmed-replay", "commit");
    assertSnapshot(h.snapshot(), [command]);
    for (const changed of [
      { targetId: "case-synthetic-other" },
      { authorizationId: "authorization-synthetic-other" },
      { intentDigest: INTENT_B }
    ]) {
      const result = await h.execute({ ...command, ...changed });
      assertOutcome(result, "rolled-back", "apply");
      assert.equal(JSON.stringify(result).includes(command.targetId), false);
      assert.equal(JSON.stringify(result).includes(command.authorizationId), false);
      assertSnapshot(h.snapshot(), [command]);
    }
  });
}

test("same target update preserves historical receipt and replay cannot restore the old state", async (t) => {
  const h = await harness(t);
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assertOutcome(await h.execute(updateCommand), "confirmed-first", "commit");
  assertSnapshot(h.snapshot(), [firstCommand, updateCommand]);
  assertOutcome(await h.execute(firstCommand), "confirmed-replay", "commit");
  assertSnapshot(h.snapshot(), [firstCommand, updateCommand]);
});

test("same contract and key in separate namespaces produce independent receipts", async (t) => {
  const h = await harness(t);
  const other = { ...firstCommand, namespaceDigest: NAMESPACE_B, targetId: "case-synthetic-other" };
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assertOutcome(await h.execute(other), "confirmed-first", "commit");
  assertSnapshot(h.snapshot(), [firstCommand, other]);
  assertOutcome(await h.execute(other), "confirmed-replay", "commit");
  assertSnapshot(h.snapshot(), [firstCommand, other]);
});

for (const fault of [
  "after-state", "after-message-1", "after-message-2", "after-security-audit",
  "after-access-audit", "after-security-source", "after-access-source", "after-receipt", "verify",
  "missing-parent"
]) {
  test(`${fault} restores all committed facts after a same-target update`, async (t) => {
    const h = await harness(t);
    assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
    assertSnapshot(h.snapshot(), [firstCommand]);
    assertOutcome(await h.execute(updateCommand, { fault }), "rolled-back", fault === "verify" ? "verify" : "apply");
    assertSnapshot(h.snapshot(), [firstCommand]);
    assertOutcome(await h.execute(updateCommand), "confirmed-first", "commit");
    assertSnapshot(h.snapshot(), [firstCommand, updateCommand]);
  });
}

test("commit-before response loss is unknown after rollback and leaves the session reusable", async (t) => {
  const h = await harness(t);
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assertOutcome(await h.execute(updateCommand, { fault: "commit-before" }), "unknown", "commit");
  assertSnapshot(h.snapshot(), [firstCommand]);
  assert.equal(h.snapshot().transactionOpen, false);
  assertOutcome(await h.execute(updateCommand), "confirmed-first", "commit");
  assertSnapshot(h.snapshot(), [firstCommand, updateCommand]);
});

test("commit-after response loss retains the real commit and quarantines new ports", async (t) => {
  const h = await harness(t);
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assertOutcome(await h.execute(updateCommand, { fault: "commit-after" }), "unknown", "commit");
  assertSnapshot(h.snapshot(), [firstCommand, updateCommand]);
  assert.equal(h.snapshot().transactionOpen, false);
  assertOutcome(await h.execute({ ...updateCommand, keyDigest: "9".repeat(64) }), "unknown", "begin");
  assertSnapshot(h.snapshot(), [firstCommand, updateCommand]);
});

test("cooperating ports preserve the winner during same-key begin contention", async (t) => {
  const h = await harness(t);
  const first = h.execute(firstCommand);
  const competing = h.execute(firstCommand);
  const [winner, loser] = await Promise.all([first, competing]);
  assertOutcome(winner, "confirmed-first", "commit");
  assertOutcome(loser, "rolled-back", "begin");
  assertSnapshot(h.snapshot(), [firstCommand]);
  assertOutcome(await h.execute(firstCommand), "confirmed-replay", "commit");
  assertSnapshot(h.snapshot(), [firstCommand]);
});

test("factory and command admission are exact and close destroys observation", async () => {
  const admission = { code: "GS03_RECEIPT_COMPOSITION_ADMISSION", message: "GS03_RECEIPT_COMPOSITION_ADMISSION" };
  for (const options of [undefined, {}, { environment: "production" },
    { environment: "test", path: ":memory:" }]) {
    await assert.rejects(createGs03ReceiptCompositionHarness(options), admission);
  }
  const h = await createGs03ReceiptCompositionHarness({ environment: "test" });
  for (const invalid of [
    { ...firstCommand, path: ":memory:" }, { ...firstCommand, keyDigest: "A".repeat(64) },
    { ...firstCommand, authorizationId: "" }
  ]) {
    await assert.rejects(h.execute(invalid), admission);
    assertSnapshot(h.snapshot());
  }
  await assert.rejects(h.execute(firstCommand, { fault: "unknown" }), admission);
  assertSnapshot(h.snapshot());
  assert.equal(h.close(), true);
  assert.equal(h.close(), true);
  assert.throws(() => h.snapshot(), admission);
  await assert.rejects(h.execute(firstCommand), admission);
});
