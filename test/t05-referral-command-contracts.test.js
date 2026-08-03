"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTRACT_ID,
  EVENT_TYPE,
  INBOX_COLLECTION,
  OUTBOX_COLLECTION,
  createReferralCommandService,
  createReferralOrderAntiCorruptionAdapter
} = require("../src/care-coordination/referral-command-service");
const { createRouteSegments } = require("../src/http/routes/care-coordination");

function fixture() {
  return {
    residents: [{ id: "r1" }],
    referralSystem: {
      referrals: [{
        id: "rf1",
        residentId: "r1",
        type: "上转",
        from: "社区卫生服务中心",
        to: "市中心医院",
        status: "待接诊",
        priority: "高",
        version: 1,
        lastUpdated: "2026-08-03T08:00:00.000Z"
      }],
      referralOutbox: [],
      referralCommandInbox: []
    }
  };
}

test("referral command commits aggregate, versioned contract, outbox and inbox in one UoW", async () => {
  let state = fixture();
  let writes = 0;
  const service = createReferralCommandService({
    readState: () => state,
    writeState: (next) => {
      writes += 1;
      state = next;
    },
    now: () => "2026-08-03T12:00:00.000Z"
  });

  const result = await service.update({
    referralId: "rf1",
    commandId: " referral-command-001 ",
    expectedVersion: 1,
    correlationId: "trace-referral-12345678",
    actor: { username: "county", name: "County Operator", role: "county" },
    input: { status: "已接诊", receivingFeedback: "接诊资源已确认" }
  });

  assert.equal(writes, 1);
  assert.equal(result.replayed, false);
  assert.equal(result.referral.version, 2);
  assert.equal(result.contract.contractId, CONTRACT_ID);
  assert.equal(result.contract.contractVersion, "1.0.0");
  assert.equal(result.event.type, EVENT_TYPE);
  assert.equal(result.event.correlationId, "trace-referral-12345678");
  assert.equal(result.event.causationId, "referral-command-001");
  assert.equal(state.referralSystem.referrals[0].status, "已接诊");
  assert.equal(state.referralSystem[OUTBOX_COLLECTION].length, 1);
  assert.equal(state.referralSystem[OUTBOX_COLLECTION][0].status, "pending");
  assert.equal(state.referralSystem[OUTBOX_COLLECTION][0].payload.contract.version, 2);
  assert.equal(state.referralSystem[INBOX_COLLECTION].length, 1);
  assert.equal(state.referralSystem[INBOX_COLLECTION][0].commandId, "referral-command-001");

  const replay = await service.update({
    referralId: "rf1",
    commandId: "referral-command-001",
    expectedVersion: 1,
    correlationId: "trace-retry-12345678",
    actor: { username: "county", name: "County Operator", role: "county" },
    input: { status: "已接诊", receivingFeedback: "接诊资源已确认" }
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.event.id, result.event.id);
  assert.deepEqual(replay.event, result.event);
  assert.equal(replay.event.causationId, "referral-command-001");
  assert.equal(writes, 1);

  await service.update({
    referralId: "rf1",
    commandId: "referral-command-002",
    expectedVersion: 2,
    correlationId: "trace-referral-next-1234",
    actor: { username: "county", name: "County Operator", role: "county" },
    input: { status: "已完成" }
  });
  const lateReplay = await service.update({
    referralId: "rf1",
    commandId: "referral-command-001",
    expectedVersion: 1,
    correlationId: "trace-late-retry-1234",
    actor: { username: "county", name: "County Operator", role: "county" },
    input: { status: "已接诊", receivingFeedback: "接诊资源已确认" }
  });
  assert.equal(state.referralSystem.referrals[0].version, 3);
  assert.equal(lateReplay.referral.version, 2);
  assert.equal(lateReplay.contract.version, 2);
  assert.equal(writes, 2);
});

test("referral command rejects stale versions and idempotency-key intent drift", async () => {
  let state = fixture();
  const service = createReferralCommandService({
    readState: () => state,
    writeState: (next) => { state = next; }
  });

  await assert.rejects(
    () => service.update({
      referralId: "rf1",
      commandId: "referral-command-stale",
      expectedVersion: 2,
      input: { status: "已接诊" }
    }),
    (error) => error.code === "REFERRAL_VERSION_CONFLICT" && error.statusCode === 409
  );

  await service.update({
    referralId: "rf1",
    commandId: "referral-command-drift",
    expectedVersion: 1,
    input: { status: "已接诊" }
  });
  await assert.rejects(
    () => service.update({
      referralId: "rf1",
      commandId: "referral-command-drift",
      expectedVersion: 1,
      input: { status: "已取消" }
    }),
    (error) => error.code === "REFERRAL_COMMAND_IDEMPOTENCY_CONFLICT" && error.statusCode === 409
  );
});

test("concurrent duplicate commands commit once across service instances", async () => {
  let state = fixture();
  let writes = 0;
  const dependencies = {
    readState: () => state,
    writeState: async (next) => {
      await new Promise((resolve) => setImmediate(resolve));
      writes += 1;
      state = next;
    },
    now: () => "2026-08-03T12:30:00.000Z"
  };
  const command = {
    referralId: "rf1",
    commandId: "concurrent-referral-command",
    expectedVersion: 1,
    correlationId: "trace-concurrent-1234",
    input: { status: "已接诊" }
  };
  const [left, right] = await Promise.all([
    createReferralCommandService(dependencies).update(command),
    createReferralCommandService(dependencies).update(command)
  ]);

  assert.equal(writes, 1);
  assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
  assert.equal(left.event.id, right.event.id);
  assert.equal(state.referralSystem.referrals[0].version, 2);
  assert.equal(state.referralSystem[OUTBOX_COLLECTION].length, 1);
  assert.equal(state.referralSystem[INBOX_COLLECTION].length, 1);
});

test("referral anti-corruption adapter maps the authorized integration contract", () => {
  const adapter = createReferralOrderAntiCorruptionAdapter("integration");
  const decoded = adapter.decode({
    referral_id: "rf1",
    resident_id: "r1",
    status: "accepted",
    version: 3,
    source_institution: "primary",
    target_institution: "hospital"
  });
  assert.equal(decoded.referralId, "rf1");
  assert.equal(decoded.residentId, "r1");
  assert.equal(decoded.version, 3);
  const encoded = adapter.encode(decoded);
  assert.equal(encoded.contract_id, CONTRACT_ID);
  assert.equal(encoded.contract_version, "1.0.0");
  assert.equal(encoded.referral_id, "rf1");
  assert.throws(
    () => createReferralOrderAntiCorruptionAdapter("insurance-payment"),
    /not an authorized consumer/
  );
});

test("T05 route exposes an authorized idempotent referral command", async () => {
  let state = fixture();
  const securityEvents = [];
  const responses = [];
  const runtime = {
    appendSecurityEvent: (event) => securityEvents.push(event),
    canAccessResident: () => true,
    collectJson: async () => ({
      expectedVersion: 1,
      status: "已接诊",
      receivingFeedback: "route-level receipt"
    }),
    readDatabase: () => state,
    requireApiRole: () => ({ username: "county", name: "County Operator", role: "county" }),
    sendJson: (res, status, body) => {
      responses.push({ status, body });
      res.statusCode = status;
      res.body = body;
    },
    writeDatabase: (next) => { state = next; }
  };
  const segment = createRouteSegments(runtime).find((item) => item.id === "care-coordination-10");
  const req = {
    method: "POST",
    url: "/api/referrals/rf1/actions",
    correlationId: "trace-route-referral-1234",
    headers: { "idempotency-key": "route-referral-command-001" }
  };
  const res = {};
  const url = new URL("http://localhost/api/referrals/rf1/actions");

  assert.equal(await segment.handle(req, res, url), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.idempotentReplay, false);
  assert.equal(res.body.referral.version, 2);
  assert.equal(res.body.contract.contractId, CONTRACT_ID);
  assert.equal(res.body.event.status, "pending");
  assert.equal(securityEvents[0].result, "allowed");

  assert.equal(await segment.handle(req, {}, url), true);
  assert.equal(responses[1].status, 200);
  assert.equal(responses[1].body.idempotentReplay, true);
  assert.equal(state.referralSystem[OUTBOX_COLLECTION].length, 1);
  assert.equal(state.referralSystem[INBOX_COLLECTION].length, 1);
});
