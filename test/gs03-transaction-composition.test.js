"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGs03CompositionHarness } = require("./helpers/gs03-transaction-composition");

const firstCommand = Object.freeze({ namespace: "synthetic-care", key: "request-1", target: "case-1", intent: "accept" });
const secondCommand = Object.freeze({ namespace: "synthetic-care", key: "request-2", target: "case-2", intent: "close" });
const updateCommand = Object.freeze({ namespace: "synthetic-care", key: "request-2", target: "case-1", intent: "close" });

function receiptId({ namespace, key }) {
  return JSON.stringify([namespace, key]);
}

function messageId(command, slot) {
  return JSON.stringify([command.namespace, command.key, slot]);
}

function auditId(command) {
  return JSON.stringify([command.namespace, command.key, "audit"]);
}

function factsFor(command) {
  const id = receiptId(command);
  return {
    case: { target: command.target, intent: command.intent, version: 1 },
    messages: [1, 2].map((slot) => ({
      id: messageId(command, slot), receiptId: id, slot,
      target: command.target, intent: command.intent
    })),
    audit: {
      id: auditId(command), receiptId: id, target: command.target,
      intent: command.intent, kind: "synthetic-placeholder"
    },
    receipt: {
      receiptId: id, namespace: command.namespace, key: command.key,
      target: command.target, intent: command.intent, caseVersion: 1,
      message1Id: messageId(command, 1), message2Id: messageId(command, 2),
      auditId: auditId(command)
    }
  };
}

function expectedSnapshot(commands = []) {
  const facts = commands.map(factsFor);
  return {
    cases: facts.map(({ case: row }) => row).sort((a, b) => a.target.localeCompare(b.target)),
    messages: facts.flatMap(({ messages }) => messages).sort((a, b) => a.id.localeCompare(b.id)),
    audit: facts.map(({ audit }) => audit).sort((a, b) => a.id.localeCompare(b.id)),
    receipts: facts.map(({ receipt }) => receipt)
      .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key)),
    transactionOpen: false
  };
}

function expectedUpdatedSnapshot() {
  const firstReceipt = '["synthetic-care","request-1"]';
  const updateReceipt = '["synthetic-care","request-2"]';
  const firstMessage1 = '["synthetic-care","request-1",1]';
  const firstMessage2 = '["synthetic-care","request-1",2]';
  const updateMessage1 = '["synthetic-care","request-2",1]';
  const updateMessage2 = '["synthetic-care","request-2",2]';
  const firstAudit = '["synthetic-care","request-1","audit"]';
  const updateAudit = '["synthetic-care","request-2","audit"]';
  return {
    cases: [{ target: "case-1", intent: "close", version: 2 }],
    messages: [
      { id: firstMessage1, receiptId: firstReceipt, slot: 1, target: "case-1", intent: "accept" },
      { id: firstMessage2, receiptId: firstReceipt, slot: 2, target: "case-1", intent: "accept" },
      { id: updateMessage1, receiptId: updateReceipt, slot: 1, target: "case-1", intent: "close" },
      { id: updateMessage2, receiptId: updateReceipt, slot: 2, target: "case-1", intent: "close" }
    ],
    audit: [
      { id: firstAudit, receiptId: firstReceipt, target: "case-1", intent: "accept", kind: "synthetic-placeholder" },
      { id: updateAudit, receiptId: updateReceipt, target: "case-1", intent: "close", kind: "synthetic-placeholder" }
    ],
    receipts: [
      {
        receiptId: firstReceipt, namespace: "synthetic-care", key: "request-1", target: "case-1", intent: "accept",
        caseVersion: 1, message1Id: firstMessage1, message2Id: firstMessage2, auditId: firstAudit
      },
      {
        receiptId: updateReceipt, namespace: "synthetic-care", key: "request-2", target: "case-1", intent: "close",
        caseVersion: 2, message1Id: updateMessage1, message2Id: updateMessage2, auditId: updateAudit
      }
    ],
    transactionOpen: false
  };
}

async function harness(t) {
  const value = await createGs03CompositionHarness({ environment: "test" });
  t.after(() => value.close());
  assert.equal(value.productionReady, false);
  return value;
}

function assertOutcome(actual, status, phase) {
  assert.deepEqual(actual, { status, phase, productionReady: false });
}

test("first command commits one linked state, two messages, placeholder audit, and synthetic receipt", async (t) => {
  const h = await harness(t);
  assert.deepEqual(h.snapshot(), expectedSnapshot());
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand]));
});

test("exact replay is immutable; same-key target and intent conflicts reveal no previous value", async (t) => {
  const h = await harness(t);
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  const committed = h.snapshot();
  assertOutcome(await h.execute(firstCommand), "confirmed-replay", "commit");
  assert.deepEqual(h.snapshot(), committed);

  for (const command of [
    { ...firstCommand, target: "other-target" },
    { ...firstCommand, intent: "other-intent" }
  ]) {
    const result = await h.execute(command);
    assertOutcome(result, "rolled-back", "apply");
    assert.equal(JSON.stringify(result).includes(firstCommand.target), false);
    assert.equal(JSON.stringify(result).includes(firstCommand.intent), false);
    assert.deepEqual(h.snapshot(), committed);
  }
});

test("the same key in another namespace has an independent receipt and linked facts", async (t) => {
  const h = await harness(t);
  const other = { namespace: "synthetic-other", key: firstCommand.key, target: "case-3", intent: "review" };
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assertOutcome(await h.execute(other), "confirmed-first", "commit");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand, other]));
  assertOutcome(await h.execute(other), "confirmed-replay", "commit");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand, other]));
});

test("a new key updates the same target to version 2 while old-key replay preserves current state and history", async (t) => {
  const h = await harness(t);
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assertOutcome(await h.execute(updateCommand), "confirmed-first", "commit");
  const updated = expectedUpdatedSnapshot();
  assert.deepEqual(h.snapshot(), updated);
  assertOutcome(await h.execute(firstCommand), "confirmed-replay", "commit");
  assert.deepEqual(h.snapshot(), updated);
  assertOutcome(await h.execute(updateCommand), "confirmed-replay", "commit");
  assert.deepEqual(h.snapshot(), updated);
});

for (const fault of ["after-state", "after-message-1", "after-message-2", "after-audit", "after-receipt", "verify"]) {
  test(`${fault} rolls back every linked fact and permits a fresh port`, async (t) => {
    const h = await harness(t);
    assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
    const before = h.snapshot();
    assertOutcome(await h.execute(secondCommand, { fault }), "rolled-back", fault === "verify" ? "verify" : "apply");
    assert.deepEqual(h.snapshot(), before);
    assertOutcome(await h.execute(secondCommand), "confirmed-first", "commit");
    assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand, secondCommand]));
  });

  test(`${fault} restores the existing target and every historical fact after an update failure`, async (t) => {
    const h = await harness(t);
    assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
    const history = expectedSnapshot([firstCommand]);
    assert.deepEqual(h.snapshot(), history);
    assertOutcome(await h.execute(updateCommand, { fault }), "rolled-back", fault === "verify" ? "verify" : "apply");
    assert.deepEqual(h.snapshot(), history);
    assertOutcome(await h.execute(updateCommand), "confirmed-first", "commit");
    assert.deepEqual(h.snapshot(), expectedUpdatedSnapshot());
  });
}

test("commit-before response failure is unknown despite native rollback, and the session remains usable", async (t) => {
  const h = await harness(t);
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  const before = h.snapshot();
  assertOutcome(await h.execute(secondCommand, { fault: "commit-before" }), "unknown", "commit");
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.snapshot().transactionOpen, false);
  assertOutcome(await h.execute(secondCommand), "confirmed-first", "commit");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand, secondCommand]));
});

test("commit-after response loss remains unknown with real committed facts and quarantines new requests", async (t) => {
  const h = await harness(t);
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assertOutcome(await h.execute(secondCommand, { fault: "commit-after" }), "unknown", "commit");
  const committed = expectedSnapshot([firstCommand, secondCommand]);
  assert.deepEqual(h.snapshot(), committed);
  assert.equal(h.snapshot().transactionOpen, false);
  assertOutcome(await h.execute({ ...secondCommand, key: "request-3", target: "case-3" }), "unknown", "begin");
  assert.deepEqual(h.snapshot(), committed);
});

test("two ports on one session preserve the winner when the other begin is rejected", async (t) => {
  const h = await harness(t);
  const first = h.execute(firstCommand);
  const competing = h.execute(secondCommand);
  const [winner, loser] = await Promise.all([first, competing]);
  assertOutcome(winner, "confirmed-first", "commit");
  assertOutcome(loser, "rolled-back", "begin");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand]));
  assertOutcome(await h.execute(firstCommand), "confirmed-replay", "commit");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand]));
});

test("same-key concurrent ports have one winner, one begin rejection, then explicit replay", async (t) => {
  const h = await harness(t);
  const first = h.execute(firstCommand);
  const competing = h.execute(firstCommand);
  const [winner, loser] = await Promise.all([first, competing]);
  assertOutcome(winner, "confirmed-first", "commit");
  assertOutcome(loser, "rolled-back", "begin");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand]));
  assertOutcome(await h.execute(firstCommand), "confirmed-replay", "commit");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand]));
});

test("factory rejects production, supplied paths, and external configuration", async () => {
  for (const options of [
    undefined, {}, { environment: "production" }, { environment: "development" },
    { environment: "test", path: ":memory:" },
    { environment: "test", path: "synthetic.db" },
    { environment: "test", config: {} }
  ]) {
    await assert.rejects(createGs03CompositionHarness(options), { code: "GS03_COMPOSITION_ADMISSION" });
  }
});

test("commands and fault options admit only exact synthetic test input without writing", async (t) => {
  const h = await harness(t);
  for (const command of [
    undefined, {}, { ...firstCommand, key: "" }, { ...firstCommand, intent: 1 },
    { ...firstCommand, path: "synthetic.db" }, { ...firstCommand, config: {} }
  ]) {
    await assert.rejects(h.execute(command), { code: "GS03_COMPOSITION_ADMISSION" });
    assert.deepEqual(h.snapshot(), expectedSnapshot());
  }
  for (const options of [{ fault: "other" }, { fault: "verify", config: {} }]) {
    await assert.rejects(h.execute(firstCommand, options), { code: "GS03_COMPOSITION_ADMISSION" });
    assert.deepEqual(h.snapshot(), expectedSnapshot());
  }
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand]));
});

test("close explicitly destroys the in-memory observation boundary", async () => {
  const h = await createGs03CompositionHarness({ environment: "test" });
  assertOutcome(await h.execute(firstCommand), "confirmed-first", "commit");
  assert.deepEqual(h.snapshot(), expectedSnapshot([firstCommand]));
  assert.equal(h.close(), true);
  assert.equal(h.close(), true);
  assert.throws(() => h.snapshot(), { code: "GS03_COMPOSITION_ADMISSION" });
  await assert.rejects(h.execute(firstCommand), { code: "GS03_COMPOSITION_ADMISSION" });
});
