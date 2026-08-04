"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDigestSnapshot,
  compareDigestSnapshots,
  runShadowOutboxRelayOnce,
  sha256
} = require("../src/platform/operations/shadow-outbox-relay");

function event(id, sequence, payload) {
  return { id, sequence, payload, payloadDigest: sha256(payload) };
}

test("shadow relay resumes after a crash without duplicating the target event", async () => {
  const events = [
    event("event-1", 1, { commandId: "command-1", value: "one" }),
    event("event-2", 2, { commandId: "command-2", value: "two" })
  ];
  const stored = new Map();
  let checkpoint = { sequence: 0 };
  let injected = false;
  const options = {
    relayId: "referral-shadow",
    source: {
      readBatch: async ({ afterSequence, limit }) =>
        events.filter((item) => item.sequence > afterSequence).slice(0, limit)
    },
    sink: {
      enqueue: async (payload) => {
        const id = payload.commandId;
        const idempotentReplay = stored.has(id);
        stored.set(id, structuredClone(payload));
        return { idempotentReplay };
      }
    },
    checkpoint: {
      load: async () => structuredClone(checkpoint),
      save: async (next) => { checkpoint = structuredClone(next); }
    },
    faultInjector: async (phase, current) => {
      if (!injected && phase === "after-enqueue" && current.sequence === 1) {
        injected = true;
        throw Object.assign(new Error("simulated crash"), { code: "FAULT_INJECTED" });
      }
    }
  };
  await assert.rejects(() => runShadowOutboxRelayOnce(options), /simulated crash/);
  assert.equal(stored.size, 1);
  assert.equal(checkpoint.sequence, 0);
  options.faultInjector = undefined;
  const recovered = await runShadowOutboxRelayOnce(options);
  assert.equal(recovered.relayed, 2);
  assert.equal(recovered.outcomes[0].idempotentReplay, true);
  assert.equal(checkpoint.sequence, 2);
  assert.equal(stored.size, 2);
  assert.doesNotMatch(JSON.stringify(recovered), /"value"/);
});

test("shadow relay rejects payload drift before the target is called", async () => {
  let sinkCalled = false;
  await assert.rejects(
    () => runShadowOutboxRelayOnce({
      relayId: "tamper-check",
      source: {
        readBatch: async () => [{
          id: "event-1",
          sequence: 1,
          payload: { value: "tampered" },
          payloadDigest: sha256({ value: "original" })
        }]
      },
      sink: { enqueue: async () => { sinkCalled = true; } },
      checkpoint: { load: async () => ({ sequence: 0 }), save: async () => undefined }
    }),
    (error) => error.code === "SHADOW_RELAY_DIGEST_INVALID"
  );
  assert.equal(sinkCalled, false);
});

test("digest reconciliation compares count, watermark and immutable metadata", () => {
  const source = buildDigestSnapshot([
    event("event-2", 2, { private: "not included in snapshot" }),
    event("event-1", 1, { private: "also hidden" })
  ]);
  const target = buildDigestSnapshot([
    event("event-1", 1, { private: "also hidden" }),
    event("event-2", 2, { private: "not included in snapshot" })
  ]);
  const matched = compareDigestSnapshots(source, target);
  assert.equal(matched.ok, true);
  assert.equal(matched.payloadsExposed, false);
  const drifted = compareDigestSnapshots(source, {
    ...target,
    digest: `sha256:${"f".repeat(64)}`
  });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.checks.digest, false);
});
