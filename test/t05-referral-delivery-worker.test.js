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

test("single-run worker acknowledges verified delivery and persists failure through repository methods", async () => {
  const acknowledged = [];
  const failed = [];
  const repository = {
    claim: async () => claims(),
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
      if (claim.id === "event-failure") {
        const error = new Error("private provider diagnostic");
        error.code = "PROVIDER_REJECTED";
        throw error;
      }
      return {
        eventId: claim.id,
        payloadDigest: claim.payloadDigest,
        providerMessageId: "provider-001",
        status: "accepted",
        occurredAt: "2026-08-04T03:00:00.000Z",
        signatureVerified: true
      };
    }
  });
  assert.equal(acknowledged.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].input.errorCode, "PROVIDER_REJECTED");
  assert.equal(result.claimed, 2);
  assert.equal(result.counts.delivered, 1);
  assert.equal(result.counts.pending, 1);
  assert.equal(result.productionReady, false);
  assert.equal(result.payloadsExposed, false);
  assert.equal(result.leaseTokensExposed, false);
  assert.doesNotMatch(JSON.stringify(result), /residentId|lease-success|lease-failure|private provider diagnostic/);
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
      eventId: claim.id,
      payloadDigest: claim.payloadDigest,
      providerMessageId: "provider-stale",
      status: "accepted",
      occurredAt: "2026-08-04T03:00:00.000Z",
      signatureVerified: true
    })
  });
  assert.equal(failAttempted, false);
  assert.equal(result.counts["stale-lease"], 1);
});

test("readiness remains false without credentials, evidence and central cutover", () => {
  const blocked = buildReferralWorkerReadiness({
    env: {},
    postgresConfig: { writeEnabled: false, evidenceReady: false },
    transportReadiness: { configured: false, https: false, evidenceReady: false }
  });
  assert.equal(blocked.productionReady, false);
  assert.equal(blocked.requirements.centralCutover, false);
  assert.ok(blocked.blockers.includes("postgresWriteEnabled"));
  assert.ok(blocked.blockers.includes("signedHttpsTransport"));

  const configuredButNotCutover = buildReferralWorkerReadiness({
    env: { REFERRAL_DELIVERY_WORKER_EVIDENCE_ID: "worker-evidence-001" },
    postgresConfig: { writeEnabled: true, evidenceReady: true },
    transportReadiness: { configured: true, https: true, evidenceReady: true }
  });
  assert.equal(configuredButNotCutover.productionReady, false);
  assert.deepEqual(configuredButNotCutover.blockers, ["centralCutover"]);
});
