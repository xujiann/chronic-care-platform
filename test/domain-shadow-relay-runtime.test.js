"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDomainShadowSource,
  reconcileDomainShadowRelay,
  runDomainShadowRelayOnce
} = require("../src/platform/operations/domain-shadow-relay-runtime");
const { sha256 } = require("../src/platform/operations/shadow-outbox-relay");

function referralRow(id, relaySequence, occurredAt) {
  return {
    id,
    relaySequence,
    type: "care-coordination.referral-updated.v1",
    contractId: "referral-order.v1",
    aggregateVersion: relaySequence || 1,
    correlationId: `correlation-${id}`,
    occurredAt,
    payload: { commandId: `command-${id}`, intentDigest: "a".repeat(64), contract: { id } }
  };
}

function runtimeFor(domain, target) {
  return {
    shadowRelayReadiness: async (id) => ({
      eligible: id === domain,
      productionReady: false
    }),
    repository: () => ({
      enqueue: async (event) => {
        const exists = target.has(event.id);
        target.set(event.id, structuredClone(event));
        return { idempotentReplay: exists };
      },
      shadowSnapshot: async () => [...target.values()].map((event, index) => ({
        id: event.id,
        sequence: index + 1,
        payloadDigest: sha256(domain === "referral"
          ? event.payload
          : Object.fromEntries(Object.entries(event).filter(([key]) => key !== "delivery")))
      }))
    })
  };
}

test("domain source gives legacy rows a deterministic sequence and preserves explicit sequence", async () => {
  const state = {
    referralSystem: {
      referralOutbox: [
        referralRow("event-2", 2, "2030-08-04T00:02:00.000Z"),
        referralRow("event-1", undefined, "2030-08-04T00:01:00.000Z")
      ]
    }
  };
  const source = createDomainShadowSource({ domain: "referral", readDatabase: () => state });
  const rows = await source.readBatch({ afterSequence: 0, limit: 10 });
  assert.deepEqual(rows.map((row) => [row.id, row.sequence]), [
    ["event-1", 1],
    ["event-2", 2]
  ]);
  assert.doesNotMatch(JSON.stringify(await source.snapshot()), /command-event/);
});

test("referral shadow relay resumes idempotently after enqueue/checkpoint crash", async () => {
  const state = {
    referralSystem: {
      referralOutbox: [
        referralRow("event-2", 2, "2030-08-04T00:02:00.000Z"),
        referralRow("event-1", 1, "2030-08-04T00:01:00.000Z")
      ]
    }
  };
  const target = new Map();
  let saved = { sequence: 0 };
  let injected = false;
  const options = {
    domain: "referral",
    runtime: runtimeFor("referral", target),
    readDatabase: () => state,
    checkpoint: {
      load: async () => saved,
      save: async (value) => { saved = structuredClone(value); }
    },
    faultInjector: async (phase, event) => {
      if (!injected && phase === "after-enqueue" && event.sequence === 1) {
        injected = true;
        throw new Error("fault drill");
      }
    }
  };
  await assert.rejects(() => runDomainShadowRelayOnce(options), /fault drill/);
  options.faultInjector = undefined;
  const recovered = await runDomainShadowRelayOnce(options);
  assert.equal(recovered.relayed, 2);
  assert.equal(recovered.outcomes[0].idempotentReplay, true);
  assert.equal(saved.sequence, 2);
  assert.equal(target.get("event-1").contractId, "referral-order.v1");
  assert.doesNotMatch(JSON.stringify(recovered), /command-event-1/);
});

test("emergency projection preserves the delivery envelope and digest-only reconciliation matches", async () => {
  const emergency = {
    id: "emergency-1",
    relaySequence: 1,
    domain: "clinical-specialties",
    type: "clinical-specialties.emergency-signal-updated.v1",
    aggregateId: "signal-1",
    aggregateVersion: 1,
    correlationId: "correlation-1",
    causationId: "command-1",
    occurredAt: "2030-08-04T00:00:00.000Z",
    payload: { signalId: "signal-1", status: "acknowledged" },
    action: "domain-event-outbox",
    owner: "clinical-specialties",
    delivery: { schema: "emergency-signal-delivery.v1", status: "pending" }
  };
  const state = { emergencyAuditEvents: [emergency] };
  const target = new Map();
  let checkpoint = { sequence: 0 };
  const runtime = runtimeFor("emergency", target);
  await runDomainShadowRelayOnce({
    domain: "emergency",
    runtime,
    readDatabase: () => state,
    checkpoint: {
      load: async () => checkpoint,
      save: async (value) => { checkpoint = value; }
    }
  });
  assert.equal(target.get("emergency-1").delivery.status, "pending");
  const report = await reconcileDomainShadowRelay({
    domain: "emergency",
    runtime,
    readDatabase: () => state
  });
  assert.equal(report.ok, true);
  assert.equal(report.payloadsExposed, false);
});
