"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildReferralWorkerReadiness,
  runReferralDeliveryWorkerOnce
} = require("../src/care-coordination/referral-delivery-worker");

function claims() {
  return [
    {
      id: "event-success", leaseToken: "lease-success", leaseVersion: 1,
      payload: { residentId: "r1" }, payloadDigest: "sha256:success"
    },
    {
      id: "event-failure", leaseToken: "lease-failure", leaseVersion: 2,
      payload: { residentId: "r2" }, payloadDigest: "sha256:failure"
    }
  ];
}

test("single-run worker requests one claim with a lease covering maximum transport time", async () => {
  const acknowledged = [];
  const failed = [];
  let claimInput;
  const repository = {
    claim: async (input) => {
      claimInput = input;
      return [claims()[0]];
    },
    acknowledge: async (eventId, input) => {
      acknowledged.push({ eventId, input });
      return { idempotentReplay: false, event: { status: "delivered" } };
    },
    fail: async (eventId, input) => {
      failed.push({ eventId, input });
      return { status: "pending", lastErrorCode: input.errorCode };
    }
  };
  const result = await runReferralDeliveryWorkerOnce({
    repository,
    workerId: "worker-001",
    runId: "run-001",
    now: () => "2026-08-04T03:00:00.000Z",
    transport: async (claim) => {
      return {
        requestId: claim.id,
        eventId: claim.id,
        payloadDigest: claim.payloadDigest,
        providerMessageId: "provider-001",
        status: "accepted",
        occurredAt: "2026-08-04T03:00:00.000Z",
        attempt: 1,
        leaseVersion: claim.leaseVersion,
        sentAt: "2026-08-04T03:00:00.000Z",
        nonce: "a".repeat(64),
        signatureDigest: `sha256:${"b".repeat(64)}`,
        signatureVerified: true
      };
    }
  });
  assert.equal(acknowledged.length, 1);
  assert.equal(failed.length, 0);
  assert.equal(claimInput.limit, 1);
  assert.ok(claimInput.leaseMs >= 60000);
  assert.equal(result.claimed, 1);
  assert.equal(result.counts.delivered, 1);
  assert.equal(result.productionReady, false);
  assert.equal(result.payloadsExposed, false);
  assert.equal(result.leaseTokensExposed, false);
  assert.doesNotMatch(JSON.stringify(result), /residentId|lease-success|lease-failure|private provider diagnostic/);
});

test("transport failure is persisted through the claimed lease without exposing its message", async () => {
  const failed = [];
  const repository = {
    claim: async () => [claims()[1]],
    acknowledge: async () => { throw new Error("must not acknowledge"); },
    fail: async (eventId, input) => {
      failed.push({ eventId, input });
      return { status: "pending", lastErrorCode: input.errorCode };
    }
  };
  const result = await runReferralDeliveryWorkerOnce({
    repository,
    workerId: "worker-failure",
    transport: async () => {
      throw Object.assign(new Error("private provider diagnostic"), { code: "PROVIDER_REJECTED" });
    }
  });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].input.errorCode, "PROVIDER_REJECTED");
  assert.equal(result.counts.pending, 1);
  assert.doesNotMatch(JSON.stringify(result), /private provider diagnostic|lease-failure/);
});

test("worker rejects a repository that violates the single-claim contract", async () => {
  const repository = {
    claim: async () => claims(),
    acknowledge: async () => undefined,
    fail: async () => undefined
  };
  await assert.rejects(
    () => runReferralDeliveryWorkerOnce({ repository, transport: async () => ({}) }),
    /at most one claim/
  );
});

test("stale lease during acknowledgement cannot be overwritten or converted into delivery failure", async () => {
  let failAttempted = false;
  const stale = Object.assign(new Error("stale"), { code: "REFERRAL_DELIVERY_LEASE_STALE" });
  const repository = {
    claim: async () => [claims()[0]],
    acknowledge: async () => { throw stale; },
    fail: async () => {
      failAttempted = true;
      throw stale;
    }
  };
  const result = await runReferralDeliveryWorkerOnce({
    repository,
    workerId: "worker-stale",
    transport: async (claim) => ({
      requestId: claim.id,
      eventId: claim.id,
      payloadDigest: claim.payloadDigest,
      providerMessageId: "provider-stale",
      status: "accepted",
      occurredAt: "2026-08-04T03:00:00.000Z",
      attempt: 1,
      leaseVersion: claim.leaseVersion,
      sentAt: "2026-08-04T03:00:00.000Z",
      nonce: "a".repeat(64),
      signatureDigest: `sha256:${"b".repeat(64)}`,
      signatureVerified: true
    })
  });
  assert.equal(failAttempted, false);
  assert.equal(result.counts["stale-lease"], 1);
});

test("acknowledgement uses a short exact-receipt retry for transient database outcomes", async () => {
  let acknowledgeCalls = 0;
  const waits = [];
  const repository = {
    claim: async () => [claims()[0]],
    acknowledge: async () => {
      acknowledgeCalls += 1;
      if (acknowledgeCalls === 1) {
        throw Object.assign(new Error("commit outcome unknown"), { code: "REFERRAL_DELIVERY_DATABASE_FAILED" });
      }
      return { idempotentReplay: true, event: { status: "delivered" } };
    },
    fail: async () => { throw new Error("must not convert ack uncertainty into failure"); }
  };
  const result = await runReferralDeliveryWorkerOnce({
    repository,
    workerId: "worker-ack-retry",
    wait: async (delayMs) => { waits.push(delayMs); },
    transport: async (claim) => ({
      requestId: claim.id,
      eventId: claim.id,
      payloadDigest: claim.payloadDigest,
      providerMessageId: "provider-ack-retry",
      status: "accepted",
      occurredAt: "2026-08-04T03:00:00.000Z",
      attempt: 1,
      leaseVersion: claim.leaseVersion,
      sentAt: "2026-08-04T03:00:00.000Z",
      nonce: "a".repeat(64),
      signatureDigest: `sha256:${"b".repeat(64)}`,
      signatureVerified: true
    })
  });
  assert.equal(acknowledgeCalls, 2);
  assert.deepEqual(waits, [25]);
  assert.equal(result.counts.delivered, 1);
  assert.equal(result.outcomes[0].idempotentReplay, true);
});

test("readiness remains false without credentials, evidence and central cutover", () => {
  const blocked = buildReferralWorkerReadiness({
    env: {},
    postgresConfig: { writeEnabled: false, evidenceReady: false },
    transportReadiness: { configured: false, https: false, evidenceReady: false }
  });
  assert.equal(blocked.productionReady, false);
  assert.equal(blocked.requirements.centralCutoverRequested, false);
  assert.equal(blocked.requirements.centralCutoverConnected, false);
  assert.ok(blocked.blockers.includes("postgresWriteEnabled"));
  assert.ok(blocked.blockers.includes("signedHttpsTransport"));

  const configuredButNotCutover = buildReferralWorkerReadiness({
    env: {
      REFERRAL_DELIVERY_WORKER_EVIDENCE_ID: "worker-evidence-001",
      REFERRAL_DELIVERY_CENTRAL_CUTOVER_ENABLED: "true"
    },
    postgresConfig: { writeEnabled: true, evidenceReady: true },
    transportReadiness: { configured: true, https: true, evidenceReady: true }
  });
  assert.equal(configuredButNotCutover.productionReady, false);
  assert.equal(configuredButNotCutover.requirements.centralCutoverRequested, true);
  assert.deepEqual(configuredButNotCutover.blockers, ["centralCutoverConnected"]);
});
