const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertPublicHealthExternalBackpressure,
  buildPublicHealthExternalResilienceRuntime,
  normalizePublicHealthExternalResiliencePolicy,
  recordPublicHealthExternalLaneOutcomeToState,
  reservePublicHealthExternalLaneCapacityToState,
  verifyPublicHealthExternalLaneControl,
  verifyPublicHealthExternalLaneControlAuditChain
} = require("../public-health-external-resilience-service");

const OLD_SECRET = "public-health-resilience-old-1234567890-1234";
const NEW_SECRET = "public-health-resilience-new-1234567890-1234";
const POLICY = {
  failureThreshold: 1,
  openSeconds: 30,
  halfOpenMaxProbes: 1,
  rateLimitPerMinute: 2,
  maxPending: 2
};

function oldKeyring() {
  return {
    purpose: "public-health-resilience",
    activeKeyId: "resilience-2026-07",
    keys: [{
      keyId: "resilience-2026-07",
      secret: OLD_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
}

function rotatedKeyring() {
  return {
    purpose: "public-health-resilience",
    activeKeyId: "resilience-2026-08",
    keys: [
      { ...oldKeyring().keys[0], status: "grace" },
      {
        keyId: "resilience-2026-08",
        secret: NEW_SECRET,
        status: "active",
        notBefore: "2026-07-23T08:00:30.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
        revokedAt: ""
      }
    ]
  };
}

test("resilience policy validates bounded rate circuit and queue controls", () => {
  assert.deepEqual(normalizePublicHealthExternalResiliencePolicy({}), {
    failureThreshold: 3,
    openSeconds: 120,
    halfOpenMaxProbes: 1,
    rateLimitPerMinute: 30,
    maxPending: 100
  });
  assert.throws(() => normalizePublicHealthExternalResiliencePolicy({ failureThreshold: 0 }), /failureThreshold/);
  assert.throws(() => normalizePublicHealthExternalResiliencePolicy({ openSeconds: 10 }), /openSeconds/);
  assert.throws(() => normalizePublicHealthExternalResiliencePolicy({ rateLimitPerMinute: 0 }), /rateLimitPerMinute/);
  assert.throws(() => normalizePublicHealthExternalResiliencePolicy({ maxPending: 0 }), /maxPending/);
  const reserved = reservePublicHealthExternalLaneCapacityToState(
    {},
    "immunization",
    { at: "2026-07-23T08:00:00.000Z", expectedVersion: 0 },
    OLD_SECRET,
    POLICY
  );
  assert.throws(() => recordPublicHealthExternalLaneOutcomeToState(
    reserved.nextData,
    "immunization",
    { type: "failure", reason: "resident 张三 network failure" },
    { at: "2026-07-23T08:00:10.000Z", expectedVersion: 1 },
    OLD_SECRET,
    POLICY
  ), /minimized reason code/);
});

test("fixed-window rate limiting advances only through signed lane-control versions", () => {
  const first = reservePublicHealthExternalLaneCapacityToState(
    {},
    "immunization",
    { at: "2026-07-23T08:00:00.000Z", expectedVersion: 0 },
    OLD_SECRET,
    { ...POLICY, rateLimitPerMinute: 1 }
  );
  assert.equal(first.control.version, 1);
  assert.equal(first.control.claimsInWindow, 1);
  assert.equal(verifyPublicHealthExternalLaneControl(first.control, OLD_SECRET).ok, true);
  assert.throws(() => reservePublicHealthExternalLaneCapacityToState(
    first.nextData,
    "immunization",
    { at: "2026-07-23T08:00:30.000Z", expectedVersion: 1 },
    OLD_SECRET,
    { ...POLICY, rateLimitPerMinute: 1 }
  ), /rate limit reached/);

  const reset = reservePublicHealthExternalLaneCapacityToState(
    first.nextData,
    "immunization",
    { at: "2026-07-23T08:01:00.000Z", expectedVersion: 1 },
    OLD_SECRET,
    { ...POLICY, rateLimitPerMinute: 1 }
  );
  assert.equal(reset.control.version, 2);
  assert.equal(reset.control.claimsInWindow, 1);
  assert.equal(reset.nextData.publicHealthExternalLaneControlAudit.length, 2);
});

test("failure opens the circuit and one half-open success closes it", () => {
  const reserved = reservePublicHealthExternalLaneCapacityToState(
    {},
    "family-doctor",
    { at: "2026-07-23T08:00:00.000Z", expectedVersion: 0 },
    OLD_SECRET,
    POLICY
  );
  const failed = recordPublicHealthExternalLaneOutcomeToState(
    reserved.nextData,
    "family-doctor",
    { type: "failure", reason: "network-error" },
    { at: "2026-07-23T08:00:10.000Z", expectedVersion: 1 },
    OLD_SECRET,
    POLICY
  );
  assert.equal(failed.control.circuitState, "open");
  assert.equal(failed.control.openUntil, "2026-07-23T08:00:40.000Z");
  assert.throws(() => reservePublicHealthExternalLaneCapacityToState(
    failed.nextData,
    "family-doctor",
    { at: "2026-07-23T08:00:20.000Z", expectedVersion: 2 },
    OLD_SECRET,
    POLICY
  ), /circuit is open/);

  const probe = reservePublicHealthExternalLaneCapacityToState(
    failed.nextData,
    "family-doctor",
    { at: "2026-07-23T08:00:40.000Z", expectedVersion: 2 },
    OLD_SECRET,
    POLICY
  );
  assert.equal(probe.control.circuitState, "half-open");
  assert.equal(probe.control.halfOpenProbesInFlight, 1);
  assert.throws(() => reservePublicHealthExternalLaneCapacityToState(
    probe.nextData,
    "family-doctor",
    { at: "2026-07-23T08:00:41.000Z", expectedVersion: 3 },
    OLD_SECRET,
    POLICY
  ), /half-open probe limit/);

  const recovered = recordPublicHealthExternalLaneOutcomeToState(
    probe.nextData,
    "family-doctor",
    { type: "success", reason: "verified-signed-receipt" },
    { at: "2026-07-23T08:00:45.000Z", expectedVersion: 3 },
    OLD_SECRET,
    POLICY
  );
  assert.equal(recovered.control.circuitState, "closed");
  assert.equal(recovered.control.consecutiveFailures, 0);
  assert.equal(recovered.control.openUntil, null);
  assert.equal(buildPublicHealthExternalResilienceRuntime(recovered.nextData).summary.closed, 1);
});

test("lane-control signatures and audit chain survive rotation and reject tampering", () => {
  const reserved = reservePublicHealthExternalLaneCapacityToState(
    {},
    "chronic-management",
    { at: "2026-07-23T08:00:00.000Z", expectedVersion: 0 },
    oldKeyring(),
    POLICY
  );
  const completed = recordPublicHealthExternalLaneOutcomeToState(
    reserved.nextData,
    "chronic-management",
    { type: "success", reason: "verified" },
    { at: "2026-07-23T08:00:30.000Z", expectedVersion: 1 },
    rotatedKeyring(),
    POLICY
  );
  assert.equal(completed.control.signatureKeyId, "resilience-2026-08");
  assert.deepEqual(
    completed.nextData.publicHealthExternalLaneControlAudit.map((item) => item.auditKeyId),
    ["resilience-2026-07", "resilience-2026-08"]
  );
  assert.equal(verifyPublicHealthExternalLaneControlAuditChain(
    completed.nextData,
    "chronic-management",
    rotatedKeyring()
  ).ok, true);
  assert.equal(JSON.stringify(completed.nextData).includes(OLD_SECRET), false);
  assert.equal(JSON.stringify(completed.nextData).includes(NEW_SECRET), false);

  const tamperedControl = structuredClone(completed.nextData);
  tamperedControl.publicHealthExternalLaneControls[0].claimsInWindow = 0;
  assert.equal(verifyPublicHealthExternalLaneControlAuditChain(
    tamperedControl,
    "chronic-management",
    rotatedKeyring()
  ).ok, false);
  const tamperedAudit = structuredClone(completed.nextData);
  tamperedAudit.publicHealthExternalLaneControlAudit[0].action = "forged-capacity";
  assert.equal(verifyPublicHealthExternalLaneControlAuditChain(
    tamperedAudit,
    "chronic-management",
    rotatedKeyring()
  ).ok, false);
});

test("backpressure counts only queued work and fails before a new enqueue", () => {
  const data = {
    publicHealthExternalDispatches: [
      { id: "pending-1", laneId: "senior-health", deliveryState: "pending" },
      { id: "retry-1", laneId: "senior-health", deliveryState: "retry-scheduled" },
      { id: "delivered-1", laneId: "senior-health", deliveryState: "delivered" },
      { id: "other-lane", laneId: "immunization", deliveryState: "pending" }
    ]
  };
  assert.throws(() => assertPublicHealthExternalBackpressure(
    data,
    "senior-health",
    { ...POLICY, maxPending: 2 }
  ), /backpressure limit reached/);
  assert.deepEqual(assertPublicHealthExternalBackpressure(
    data,
    "senior-health",
    { ...POLICY, maxPending: 3 }
  ), {
    ok: true,
    laneId: "senior-health",
    queued: 2,
    available: 1
  });
});
