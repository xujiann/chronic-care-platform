"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  EXTERNAL_ADAPTER_PROFILES
} = require("../public-health-external-adapter-service");
const {
  buildPublicHealthExternalEndpointProbeRegistry,
  signPublicHealthExternalEndpointProbeReceipt
} = require("../public-health-external-endpoint-verification-service");
const {
  buildPublicHealthExternalEndpointProbeCampaignRegistry,
  campaignSignaturePayload,
  createPublicHealthExternalEndpointProbeCampaign,
  endpointProbeCampaignAttestationDigest,
  probePolicyDigest,
  verifyPublicHealthExternalEndpointProbeCampaign
} = require("../public-health-external-endpoint-probe-campaign-service");

const RECEIPT_SECRET = "public-health-campaign-receipt-key-2026-07-123456";
const CAMPAIGN_SECRET = "public-health-campaign-attestation-key-2026-07-123";

function receiptKeyring() {
  return {
    purpose: "public-health-endpoint-probe",
    activeKeyId: "endpoint-probe-2026-07",
    keys: [{
      keyId: "endpoint-probe-2026-07",
      secret: RECEIPT_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
}

function campaignKeyring() {
  return {
    purpose: "public-health-endpoint-probe-campaign",
    activeKeyId: "endpoint-campaign-2026-07",
    keys: [{
      keyId: "endpoint-campaign-2026-07",
      secret: CAMPAIGN_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
}

function endpointFor(laneId) {
  return `https://${laneId}.public-health.dalian.gov.cn/health`;
}

function envForProfiles() {
  return Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.map((profile) => [
    profile.endpointEnv,
    endpointFor(profile.laneId)
  ]));
}

function fingerprintFor(laneId) {
  return crypto.createHash("sha256").update(`campaign-certificate:${laneId}`).digest("hex");
}

function policyFor(laneId, overrides = {}) {
  return {
    maxLatencyMs: 1200,
    timeoutMs: 2000,
    ttlSeconds: 600,
    method: "HEAD",
    requireMutualTls: true,
    certificatePins: [fingerprintFor(laneId)],
    ...overrides
  };
}

function iso(base, seconds) {
  return new Date(new Date(base).getTime() + seconds * 1000).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function receiptsFor(campaignIndex, startedAt, overrides = {}) {
  return EXTERNAL_ADAPTER_PROFILES.map((profile, index) => {
    const issuedAt = iso(startedAt, index);
    const nonce = overrides.sharedNonce && index < 2
      ? overrides.sharedNonce
      : `endpoint-campaign-${campaignIndex}-${profile.laneId}-nonce`;
    return signPublicHealthExternalEndpointProbeReceipt({
      receiptId: `endpoint-campaign-${campaignIndex}-${profile.laneId}-receipt`,
      laneId: profile.laneId,
      adapterId: profile.adapterId,
      contract: profile.contract,
      endpoint: endpointFor(profile.laneId),
      status: "healthy",
      httpStatus: 204,
      latencyMs: overrides.latencyMs ?? 80 + index,
      network: {
        resolvedAddress: `93.184.216.${index + 1}`,
        sniHostname: new URL(endpointFor(profile.laneId)).hostname
      },
      tls: {
        authorized: true,
        protocol: "TLSv1.3",
        certificateFingerprintSha256: fingerprintFor(profile.laneId),
        mutualTlsVerified: overrides.mutualTlsVerified !== false
      },
      verification: {
        attestationOrigin: "server-generated",
        verificationSource: "platform-observability",
        signatureVerified: true
      },
      issuedAt,
      expiresAt: iso(issuedAt, 600),
      nonce
    }, receiptKeyring());
  });
}

function deterministicUuid(prefix) {
  let sequence = 0;
  return () => `${prefix}-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

function campaignOptions(completedAt, overrides = {}) {
  return {
    env: envForProfiles(),
    at: completedAt,
    ttlSeconds: 3600,
    randomUUID: deterministicUuid(completedAt.slice(11, 19).replaceAll(":", "")),
    keyringResolver: () => receiptKeyring(),
    campaignKeyring: campaignKeyring(),
    policyResolver: (laneId) => policyFor(laneId),
    ...overrides
  };
}

function createCampaign(campaignIndex, startedAt, overrides = {}) {
  const receipts = overrides.receipts || receiptsFor(campaignIndex, startedAt, overrides);
  const completedAt = overrides.completedAt || iso(startedAt, 60);
  return createPublicHealthExternalEndpointProbeCampaign(
    receipts,
    campaignOptions(completedAt, overrides.options)
  );
}

function createCampaignChain(definitions) {
  let previousCampaign = null;
  return definitions.map(([campaignIndex, startedAt, overrides = {}]) => {
    const campaign = createCampaign(campaignIndex, startedAt, {
      ...overrides,
      options: {
        ...(overrides.options || {}),
        ...(previousCampaign ? { previousCampaign } : {})
      }
    });
    previousCampaign = campaign;
    return campaign;
  });
}

test("three fresh non-overlapping eight-lane campaigns prove continuous connectivity without production readiness", () => {
  const campaigns = createCampaignChain([
    [1, "2026-07-27T08:00:00.000Z"],
    [2, "2026-07-27T08:10:00.000Z"],
    [3, "2026-07-27T08:20:00.000Z"]
  ]);
  const registry = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns,
    ...campaignOptions("2026-07-27T08:21:30.000Z")
  });

  assert.equal(registry.ok, true);
  assert.equal(registry.functionalState, "consecutive-endpoint-probe-campaigns-verified");
  assert.equal(registry.summary.campaignsVerified, 3);
  assert.equal(registry.summary.consecutiveCampaigns, 3);
  assert.equal(registry.summary.campaignChainLinksVerified, 2);
  assert.equal(registry.continuousConnectivityReady, true);
  assert.equal(registry.productionReady, false);
  assert.equal(registry.campaigns.every((item) => item.verifiedReceipts === 8), true);
  const serialized = JSON.stringify(registry);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("93.184.216."), false);
  assert.equal(serialized.includes(RECEIPT_SECRET), false);
  assert.equal(serialized.includes(CAMPAIGN_SECRET), false);
  assert.equal(serialized.includes(fingerprintFor("immunization")), false);
});

test("campaign attestation signature binds trust policy receipts lane coverage and time window", () => {
  const campaign = createCampaign(1, "2026-07-27T08:00:00.000Z");
  const options = campaignOptions("2026-07-27T08:02:00.000Z");
  assert.equal(verifyPublicHealthExternalEndpointProbeCampaign(campaign, options).ok, true);

  const attestation = campaign.attestation;
  const tampered = [
    { ...attestation, status: "completed-looking" },
    { ...attestation, campaignId: `${attestation.campaignId}-forged` },
    { ...attestation, startedAt: iso(attestation.startedAt, 1) },
    { ...attestation, completedAt: iso(attestation.completedAt, 1) },
    { ...attestation, expiresAt: iso(attestation.expiresAt, 1) },
    { ...attestation, nonce: `${attestation.nonce}-forged` },
    { ...attestation, previousCampaignDigest: "d".repeat(64) },
    {
      ...attestation,
      verification: { ...attestation.verification, attestationOrigin: "client-generated" }
    },
    {
      ...attestation,
      verification: { ...attestation.verification, verificationSource: "untrusted-client" }
    },
    {
      ...attestation,
      verification: { ...attestation.verification, signatureVerified: false }
    },
    {
      ...attestation,
      entries: attestation.entries.map((entry, index) => (
        index ? entry : { ...entry, policyDigest: "a".repeat(64) }
      ))
    },
    {
      ...attestation,
      entries: attestation.entries.map((entry, index) => (
        index ? entry : { ...entry, receiptDigest: "b".repeat(64) }
      ))
    },
    { ...attestation, signature: "c".repeat(64) }
  ];
  tampered.forEach((value) => {
    assert.equal(verifyPublicHealthExternalEndpointProbeCampaign({
      attestation: value,
      receipts: campaign.receipts
    }, options).ok, false);
  });

  const clientOrigin = {
    ...attestation,
    verification: {
      attestationOrigin: "client-generated",
      verificationSource: "untrusted-client",
      signatureVerified: false
    }
  };
  clientOrigin.signature = crypto.createHmac("sha256", CAMPAIGN_SECRET)
    .update(stableStringify(campaignSignaturePayload(clientOrigin)))
    .digest("hex");
  assert.match(
    verifyPublicHealthExternalEndpointProbeCampaign({
      attestation: clientOrigin,
      receipts: campaign.receipts
    }, options).reason,
    /trust metadata/
  );
});

test("missing duplicated and nonce-reused lane receipts cannot form a campaign", () => {
  const receipts = receiptsFor(1, "2026-07-27T08:00:00.000Z");
  assert.throws(() => createPublicHealthExternalEndpointProbeCampaign(
    receipts.slice(0, 7),
    campaignOptions("2026-07-27T08:01:00.000Z")
  ));
  assert.throws(() => createPublicHealthExternalEndpointProbeCampaign(
    [...receipts.slice(0, 7), receipts[0]],
    campaignOptions("2026-07-27T08:01:00.000Z")
  ));
  assert.throws(() => createPublicHealthExternalEndpointProbeCampaign(
    receiptsFor(2, "2026-07-27T08:00:00.000Z", {
      sharedNonce: "cross-lane-campaign-shared-nonce"
    }),
    campaignOptions("2026-07-27T08:01:00.000Z")
  ), /nonce replay/);
});

test("campaign signing key purpose and secret must remain independent from single-probe receipts", () => {
  const receipts = receiptsFor(1, "2026-07-27T08:00:00.000Z");
  const sameSecretCampaignKeyring = {
    purpose: "public-health-endpoint-probe-campaign",
    activeKeyId: "endpoint-campaign-unsafe",
    keys: [{
      keyId: "endpoint-campaign-unsafe",
      secret: RECEIPT_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
  assert.throws(() => createPublicHealthExternalEndpointProbeCampaign(
    receipts,
    campaignOptions("2026-07-27T08:01:00.000Z", {
      campaignKeyring: sameSecretCampaignKeyring
    })
  ), /independent/);
  assert.throws(() => createPublicHealthExternalEndpointProbeCampaign(
    receipts,
    campaignOptions("2026-07-27T08:01:00.000Z", {
      campaignKeyring: {
        ...campaignKeyring(),
        purpose: "public-health-endpoint-probe"
      }
    })
  ), /purpose/);
});

test("current per-lane latency pin and mTLS policy is re-evaluated for receipts and campaign snapshots", () => {
  const startedAt = "2026-07-27T08:00:00.000Z";
  const campaign = createCampaign(1, startedAt);
  const changedPolicy = campaignOptions("2026-07-27T08:02:00.000Z", {
    policyResolver: (laneId) => policyFor(laneId, {
      maxLatencyMs: 50,
      timeoutMs: 2500
    })
  });
  const result = verifyPublicHealthExternalEndpointProbeCampaign(campaign, changedPolicy);
  assert.equal(result.ok, false);
  assert.match(result.reason, /policy snapshot/);

  const receipts = receiptsFor(2, startedAt, { latencyMs: 500 });
  const registry = buildPublicHealthExternalEndpointProbeRegistry({
    env: envForProfiles(),
    receipts,
    keyringResolver: () => receiptKeyring(),
    policyResolver: (laneId) => policyFor(laneId, { maxLatencyMs: 100 }),
    at: "2026-07-27T08:01:00.000Z"
  });
  assert.equal(registry.summary.endpointProbesVerified, 0);
  assert.equal(registry.endpointConnectivityReady, false);
  assert.equal(registry.entries.every((entry) => /latency/.test(entry.blockerReason)), true);
  assert.equal(registry.productionReady, false);
});

test("cross-campaign receipt replay does not count as another stability campaign", () => {
  const receipts = receiptsFor(1, "2026-07-27T08:00:00.000Z");
  const first = createPublicHealthExternalEndpointProbeCampaign(
    receipts,
    campaignOptions("2026-07-27T08:01:00.000Z")
  );
  const replay = createPublicHealthExternalEndpointProbeCampaign(
    receipts,
    campaignOptions("2026-07-27T08:01:30.000Z")
  );
  const registry = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [first, replay],
    ...campaignOptions("2026-07-27T08:02:00.000Z"),
    requiredConsecutiveCampaigns: 2
  });
  assert.equal(registry.summary.campaignsVerified, 1);
  assert.equal(registry.summary.campaignsRejected, 1);
  assert.match(registry.rejected[0].reason, /replay/);
  assert.equal(registry.continuousConnectivityReady, false);
  assert.equal(registry.productionReady, false);
});

test("a rejected campaign inside the current continuity window cannot be skipped", () => {
  const [first, second, third, failedLatest] = createCampaignChain([
    [1, "2026-07-27T08:00:00.000Z"],
    [2, "2026-07-27T08:10:00.000Z"],
    [3, "2026-07-27T08:20:00.000Z"],
    [4, "2026-07-27T08:30:00.000Z"]
  ]);
  failedLatest.attestation.signature = "f".repeat(64);
  const latestFailure = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [first, second, third, failedLatest],
    ...campaignOptions("2026-07-27T08:31:30.000Z")
  });

  assert.equal(latestFailure.summary.campaignsVerified, 3);
  assert.equal(latestFailure.summary.campaignsRejected, 1);
  assert.equal(latestFailure.summary.consecutiveCampaigns, 0);
  assert.equal(latestFailure.summary.continuityBreaks, 1);
  assert.equal(latestFailure.continuityBreak.campaignId, failedLatest.attestation.campaignId);
  assert.equal(latestFailure.continuityBreak.code, "campaign-verification-failed");
  assert.equal(latestFailure.functionalState, "endpoint-probe-campaign-continuity-broken");
  assert.equal(latestFailure.continuousConnectivityReady, false);
  assert.equal(latestFailure.productionReady, false);

  const [middleFirst, middleSecond, failedMiddle, middleLatest] = createCampaignChain([
    [7, "2026-07-27T08:00:00.000Z"],
    [8, "2026-07-27T08:10:00.000Z"],
    [5, "2026-07-27T08:20:00.000Z"],
    [6, "2026-07-27T08:30:00.000Z"]
  ]);
  failedMiddle.attestation.verification = {
    ...failedMiddle.attestation.verification,
    verificationSource: "untrusted-client"
  };
  const middleFailure = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [
      middleFirst,
      middleSecond,
      failedMiddle,
      middleLatest
    ],
    ...campaignOptions("2026-07-27T08:31:30.000Z")
  });

  assert.equal(middleFailure.summary.campaignsVerified, 3);
  assert.equal(middleFailure.summary.campaignsRejected, 1);
  assert.equal(middleFailure.summary.consecutiveCampaigns, 1);
  assert.equal(middleFailure.continuityBreak.campaignId, failedMiddle.attestation.campaignId);
  assert.equal(middleFailure.continuousConnectivityReady, false);
});

test("a rejected campaign older than the required current window remains visible without erasing fresh continuity", () => {
  const [rejectedHistory, second, third, fourth] = createCampaignChain([
    [1, "2026-07-27T08:00:00.000Z"],
    [2, "2026-07-27T08:10:00.000Z"],
    [3, "2026-07-27T08:20:00.000Z"],
    [4, "2026-07-27T08:30:00.000Z"]
  ]);
  rejectedHistory.attestation.signature = "e".repeat(64);
  const registry = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [
      rejectedHistory,
      second,
      third,
      fourth
    ],
    ...campaignOptions("2026-07-27T08:31:30.000Z")
  });

  assert.equal(registry.summary.campaignsRejected, 1);
  assert.equal(registry.summary.consecutiveCampaigns, 3);
  assert.equal(registry.summary.continuityBreaks, 0);
  assert.equal(registry.continuityBreak, null);
  assert.equal(registry.continuousConnectivityReady, true);
  assert.equal(registry.productionReady, false);
});

test("deleting a signed middle campaign breaks the current continuity chain closed", () => {
  const [first, second, third, fourth] = createCampaignChain([
    [1, "2026-07-27T08:00:00.000Z"],
    [2, "2026-07-27T08:10:00.000Z"],
    [3, "2026-07-27T08:20:00.000Z"],
    [4, "2026-07-27T08:30:00.000Z"]
  ]);
  const registry = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [first, third, fourth],
    ...campaignOptions("2026-07-27T08:31:30.000Z")
  });

  assert.equal(endpointProbeCampaignAttestationDigest(second), third.attestation.previousCampaignDigest);
  assert.equal(registry.summary.campaignsVerified, 3);
  assert.equal(registry.summary.consecutiveCampaigns, 2);
  assert.equal(registry.summary.campaignChainLinksVerified, 1);
  assert.equal(registry.continuityBreak.campaignId, third.attestation.campaignId);
  assert.equal(registry.continuityBreak.code, "campaign-chain-link-mismatch");
  assert.equal(registry.continuousConnectivityReady, false);
  assert.equal(registry.productionReady, false);
});

test("missing links forks and signed-link tampering cannot prove continuity", () => {
  const first = createCampaign(1, "2026-07-27T08:00:00.000Z");
  const unlinkedSecond = createCampaign(2, "2026-07-27T08:10:00.000Z");
  const unlinkedRegistry = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [first, unlinkedSecond],
    ...campaignOptions("2026-07-27T08:11:30.000Z"),
    requiredConsecutiveCampaigns: 2
  });
  assert.equal(unlinkedRegistry.continuityBreak.code, "campaign-chain-link-missing");
  assert.equal(unlinkedRegistry.continuousConnectivityReady, false);

  const forkLeft = createCampaign(3, "2026-07-27T08:10:00.000Z", {
    options: { previousCampaign: first }
  });
  const forkRight = createCampaign(4, "2026-07-27T08:20:00.000Z", {
    options: { previousCampaign: first }
  });
  const forkRegistry = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [first, forkLeft, forkRight],
    ...campaignOptions("2026-07-27T08:21:30.000Z")
  });
  assert.equal(forkRegistry.continuityBreak.code, "campaign-chain-link-mismatch");
  assert.equal(forkRegistry.continuousConnectivityReady, false);

  const [chainFirst, chainSecond] = createCampaignChain([
    [5, "2026-07-27T08:00:00.000Z"],
    [6, "2026-07-27T08:10:00.000Z"]
  ]);
  chainSecond.attestation.previousCampaignDigest = "a".repeat(64);
  const tampered = verifyPublicHealthExternalEndpointProbeCampaign(
    chainSecond,
    campaignOptions("2026-07-27T08:11:30.000Z")
  );
  assert.equal(tampered.ok, false);
  assert.match(tampered.reason, /signature is invalid/);
  assert.equal(endpointProbeCampaignAttestationDigest(chainFirst).length, 64);
});

test("an unparseable campaign completion time is evaluated first and breaks continuity closed", () => {
  const [first, second, third, malformed] = createCampaignChain([
    [1, "2026-07-27T08:00:00.000Z"],
    [2, "2026-07-27T08:10:00.000Z"],
    [3, "2026-07-27T08:20:00.000Z"],
    [4, "2026-07-27T08:30:00.000Z"]
  ]);
  malformed.attestation.completedAt = "not-a-server-time";
  const registry = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [
      first,
      second,
      third,
      malformed
    ],
    ...campaignOptions("2026-07-27T08:31:30.000Z")
  });

  assert.equal(registry.summary.campaignsVerified, 3);
  assert.equal(registry.summary.campaignsRejected, 1);
  assert.equal(registry.summary.consecutiveCampaigns, 0);
  assert.equal(registry.continuityBreak.code, "campaign-verification-failed");
  assert.equal(registry.continuousConnectivityReady, false);
});

test("overlapping distant stale and insufficient campaigns keep continuity pending", () => {
  const [first, overlapping, distant] = createCampaignChain([
    [1, "2026-07-27T08:00:00.000Z"],
    [2, "2026-07-27T08:00:30.000Z"],
    [3, "2026-07-27T08:40:00.000Z"]
  ]);
  const registry = buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns: [first, overlapping, distant],
    ...campaignOptions("2026-07-27T08:41:30.000Z")
  });
  assert.equal(registry.summary.campaignsVerified, 3);
  assert.equal(registry.summary.consecutiveCampaigns, 1);
  assert.equal(registry.summary.continuityBreaks, 1);
  assert.equal(registry.continuityBreak.code, "campaign-gap-exceeded");
  assert.equal(registry.continuousConnectivityReady, false);
  assert.equal(registry.productionReady, false);

  const expired = verifyPublicHealthExternalEndpointProbeCampaign(
    first,
    campaignOptions("2026-07-27T09:02:00.000Z")
  );
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /expired/);
});

test("policy digests are deterministic and do not expose certificate pins", () => {
  const laneId = "immunization";
  const left = probePolicyDigest(policyFor(laneId));
  const right = probePolicyDigest({
    certificatePins: [fingerprintFor(laneId)],
    requireMutualTls: true,
    method: "HEAD",
    ttlSeconds: 600,
    timeoutMs: 2000,
    maxLatencyMs: 1200
  });
  assert.equal(left, right);
  assert.equal(left.includes(fingerprintFor(laneId)), false);
});
