"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { run } = require("../scripts/platform-shadow-relay");
const { sha256 } = require("../src/platform/operations/shadow-outbox-relay");
const {
  openSqliteShadowRelayOperations
} = require("../src/platform/operations/sqlite-shadow-relay-operations");

function fakeRuntime() {
  return {
    shadowRelayReadiness: async () => ({
      adapter: "referral",
      eligible: false,
      productionReady: false
    }),
    close: async () => undefined
  };
}

test("shadow relay CLI defaults to status and refuses mutation while activation is closed", async () => {
  const status = await run(
    { domain: "referral" },
    { env: {}, runtime: fakeRuntime() }
  );
  assert.equal(status.report.eligible, false);
  await assert.rejects(
    () => run(
      { domain: "referral", run: true },
      { env: { PLATFORM_SHADOW_RELAY_ENABLED: "false" }, runtime: fakeRuntime() }
    ),
    (error) => error.code === "PLATFORM_SHADOW_RELAY_DISABLED"
  );
});

test("shadow relay CLI persists fault, recovery, and reconciliation evidence", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-relay-cli-"));
  const operations = openSqliteShadowRelayOperations({
    file: path.join(directory, "operations.sqlite"),
    now: () => "2026-08-04T08:00:00.000Z"
  });
  t.after(async () => {
    await operations.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const target = new Map();
  let saved = { sequence: 0 };
  const checkpoint = {
    load: async () => structuredClone(saved),
    save: async (value) => { saved = structuredClone(value); }
  };
  const runtime = {
    shadowRelayReadiness: async () => ({ eligible: true, productionReady: false }),
    repository: () => ({
      enqueue: async (event) => {
        const exists = target.has(event.id);
        target.set(event.id, structuredClone(event));
        return { idempotentReplay: exists };
      },
      shadowSnapshot: async () => [...target.values()].map((event, index) => ({
        id: event.id,
        sequence: index + 1,
        payloadDigest: sha256(event.payload)
      }))
    })
  };
  const readDatabase = () => ({
    referralSystem: {
      referralOutbox: [{
        id: "event-1",
        relaySequence: 1,
        type: "care-coordination.referral-updated.v1",
        contractId: "referral-order.v1",
        aggregateVersion: 1,
        correlationId: "correlation-1",
        occurredAt: "2026-08-04T07:50:00.000Z",
        payload: { status: "accepted" }
      }]
    }
  });
  const options = {
    env: { PLATFORM_SHADOW_RELAY_ENABLED: "true" },
    runtime,
    checkpoint,
    operations,
    readDatabase,
    now: () => "2026-08-04T08:00:00.000Z"
  };

  await assert.rejects(
    () => run({
      domain: "referral",
      run: true,
      "fault-after-enqueue": "1",
      "operation-id": "fault"
    }, options),
    (error) => error.code === "PLATFORM_SHADOW_RELAY_FAULT_INJECTED"
  );
  const recovered = await run({
    domain: "referral",
    run: true,
    "operation-id": "recovery"
  }, options);
  assert.equal(recovered.report.outcomes[0].idempotentReplay, true);
  const reconciled = await run({
    domain: "referral",
    reconcile: true,
    "operation-id": "reconcile"
  }, options);
  assert.equal(reconciled.report.ok, true);

  const control = await run({ "control-plane": true }, options);
  assert.equal(control.report.domains.referral.ok, true);
  assert.equal(control.report.domains.referral.checks.faultRecoveryVerified, true);
  assert.equal(control.report.domains.emergency.ok, false);
  const rows = await operations.list({ domain: "referral" });
  assert.deepEqual(rows.map((row) => row.outcome), [
    "success",
    "success",
    "fault-injected"
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /accepted/);
});
