const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  EXTERNAL_ADAPTER_PROFILES
} = require("../public-health-external-adapter-service");
const {
  ENDPOINT_PROBE_SCHEMA_VERSION,
  buildPublicHealthExternalEndpointProbeRegistry,
  normalizeProductionEndpoint,
  signPublicHealthExternalEndpointProbeReceipt,
  verifyPublicHealthExternalEndpointProbeReceipt
} = require("../public-health-external-endpoint-verification-service");

const PROBE_SECRET = "public-health-endpoint-probe-key-2026-07-123456";
const AT = "2026-07-25T08:05:00.000Z";

function keyring() {
  return {
    purpose: "public-health-endpoint-probe",
    activeKeyId: "endpoint-probe-2026-07",
    keys: [{
      keyId: "endpoint-probe-2026-07",
      secret: PROBE_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
}

function endpointFor(laneId) {
  return `https://${laneId}.public-health.dalian.gov.cn/dispatch`;
}

function envForProfiles() {
  return Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.map((profile) => [
    profile.endpointEnv,
    endpointFor(profile.laneId)
  ]));
}

function probeFor(profile, overrides = {}) {
  const index = EXTERNAL_ADAPTER_PROFILES.findIndex((item) => item.laneId === profile.laneId);
  return signPublicHealthExternalEndpointProbeReceipt({
    schemaVersion: ENDPOINT_PROBE_SCHEMA_VERSION,
    receiptId: `ph-endpoint-probe-${profile.laneId}-001`,
    laneId: profile.laneId,
    adapterId: profile.adapterId,
    contract: profile.contract,
    endpoint: endpointFor(profile.laneId),
    status: "healthy",
    httpStatus: 204,
    latencyMs: 80 + index,
    network: {
      resolvedAddress: `8.8.8.${index + 1}`,
      sniHostname: new URL(endpointFor(profile.laneId)).hostname
    },
    tls: {
      authorized: true,
      protocol: "TLSv1.3",
      certificateFingerprintSha256: crypto.createHash("sha256").update(`certificate:${profile.laneId}`).digest("hex"),
      mutualTlsVerified: true
    },
    verification: {
      attestationOrigin: "server-generated",
      verificationSource: "platform-observability",
      signatureVerified: true
    },
    issuedAt: `2026-07-25T08:00:${String(index).padStart(2, "0")}.000Z`,
    expiresAt: `2026-07-25T08:10:${String(index).padStart(2, "0")}.000Z`,
    nonce: `endpoint-probe-nonce-${profile.laneId}-001`,
    ...overrides
  }, keyring());
}

test("eight fresh server-signed endpoint probes verify connectivity without asserting production readiness", () => {
  const receipts = EXTERNAL_ADAPTER_PROFILES.map((profile) => probeFor(profile));
  const registry = buildPublicHealthExternalEndpointProbeRegistry({
    env: envForProfiles(),
    receipts,
    keyringResolver: () => keyring(),
    at: AT
  });

  assert.equal(registry.ok, true);
  assert.equal(registry.functionalState, "eight-endpoint-probes-verified");
  assert.equal(registry.summary.lanes, 8);
  assert.equal(registry.summary.endpointsConfigured, 8);
  assert.equal(registry.summary.endpointProbesVerified, 8);
  assert.equal(registry.endpointConnectivityReady, true);
  assert.equal(registry.productionReady, false);
  assert.equal(registry.entries.every((item) => item.blockerCode === "trusted-site-evidence-still-required"), true);
  assert.equal(JSON.stringify(registry).includes(PROBE_SECRET), false);
  assert.equal(JSON.stringify(registry).includes("https://"), false);
  assert.equal(JSON.stringify(registry).includes("8.8.8."), false);
});

test("endpoint probe signatures bind every trust field and target binding", () => {
  const profile = EXTERNAL_ADAPTER_PROFILES[0];
  const receipt = probeFor(profile);
  const options = {
    expectedEndpoint: endpointFor(profile.laneId),
    expectedContract: profile.contract,
    keyring: keyring(),
    at: AT
  };
  assert.equal(verifyPublicHealthExternalEndpointProbeReceipt(receipt, options).ok, true);

  const tampered = [
    { ...receipt, laneId: "immunization" },
    { ...receipt, adapterId: "ph-adapter-immunization" },
    { ...receipt, contract: "infectious-reporting-v2" },
    { ...receipt, endpoint: "https://other.public-health.dalian.gov.cn/dispatch" },
    { ...receipt, status: "healthy-looking" },
    { ...receipt, httpStatus: 200 },
    { ...receipt, latencyMs: 1 },
    { ...receipt, network: { ...receipt.network, resolvedAddress: "1.1.1.1" } },
    { ...receipt, network: { ...receipt.network, sniHostname: "other.public-health.dalian.gov.cn" } },
    { ...receipt, tls: { ...receipt.tls, authorized: false } },
    { ...receipt, tls: { ...receipt.tls, protocol: "TLSv1.2" } },
    {
      ...receipt,
      tls: {
        ...receipt.tls,
        certificateFingerprintSha256: crypto.createHash("sha256").update("forged-certificate").digest("hex")
      }
    },
    { ...receipt, tls: { ...receipt.tls, mutualTlsVerified: false } },
    { ...receipt, verification: { ...receipt.verification, attestationOrigin: "client-generated" } },
    { ...receipt, verification: { ...receipt.verification, verificationSource: "untrusted-client" } },
    { ...receipt, verification: { ...receipt.verification, signatureVerified: false } },
    { ...receipt, issuedAt: "2026-07-25T08:01:00.000Z" },
    { ...receipt, expiresAt: "2026-07-25T08:11:00.000Z" },
    { ...receipt, nonce: "endpoint-probe-nonce-forged-001" },
    { ...receipt, signingKeyId: "endpoint-probe-forged" }
  ];
  tampered.forEach((item) => {
    assert.equal(verifyPublicHealthExternalEndpointProbeReceipt(item, options).ok, false);
  });
});

test("signed client-origin claims and unsigned verified claims fail closed", () => {
  const profile = EXTERNAL_ADAPTER_PROFILES[0];
  const signedClientClaim = probeFor(profile, {
    verification: {
      attestationOrigin: "client-generated",
      verificationSource: "untrusted-client",
      signatureVerified: false
    }
  });
  const options = {
    expectedEndpoint: endpointFor(profile.laneId),
    expectedContract: profile.contract,
    keyring: keyring(),
    at: AT
  };
  assert.match(
    verifyPublicHealthExternalEndpointProbeReceipt(signedClientClaim, options).reason,
    /trust metadata/
  );

  const forgedVerifiedClaim = {
    ...probeFor(profile),
    signature: "a".repeat(64)
  };
  assert.equal(
    verifyPublicHealthExternalEndpointProbeReceipt(forgedVerifiedClaim, options).reason,
    "endpoint probe signature is invalid"
  );
});

test("stale future replayed and over-latency probes are rejected", () => {
  const profile = EXTERNAL_ADAPTER_PROFILES[0];
  const options = {
    expectedEndpoint: endpointFor(profile.laneId),
    expectedContract: profile.contract,
    keyring: keyring(),
    at: AT
  };
  const stale = probeFor(profile, {
    issuedAt: "2026-07-25T07:00:00.000Z",
    expiresAt: "2026-07-25T07:10:00.000Z",
    nonce: "endpoint-probe-stale-001"
  });
  assert.match(verifyPublicHealthExternalEndpointProbeReceipt(stale, options).reason, /expired/);

  const future = probeFor(profile, {
    issuedAt: "2026-07-25T08:10:00.000Z",
    expiresAt: "2026-07-25T08:20:00.000Z",
    nonce: "endpoint-probe-future-001"
  });
  assert.match(verifyPublicHealthExternalEndpointProbeReceipt(future, options).reason, /future/);

  const slow = probeFor(profile, {
    latencyMs: 3001,
    nonce: "endpoint-probe-slow-001"
  });
  assert.match(verifyPublicHealthExternalEndpointProbeReceipt(slow, options).reason, /latency/);

  const receipt = probeFor(profile);
  assert.match(verifyPublicHealthExternalEndpointProbeReceipt(receipt, {
    ...options,
    seenReceiptIds: new Set([receipt.receiptId])
  }).reason, /receipt replay/);
  assert.match(verifyPublicHealthExternalEndpointProbeReceipt(receipt, {
    ...options,
    seenNonces: new Set([receipt.nonce])
  }).reason, /nonce replay/);
});

test("private reserved and non-HTTPS endpoints never enter the trusted registry", () => {
  [
    "http://public-health.dalian.gov.cn/dispatch",
    "https://localhost/dispatch",
    "https://127.0.0.1/dispatch",
    "https://8.8.8.8/dispatch",
    "https://10.0.0.8/dispatch",
    "https://192.168.1.8/dispatch",
    "https://192.0.0.8/dispatch",
    "https://192.0.2.8/dispatch",
    "https://192.88.99.8/dispatch",
    "https://198.51.100.8/dispatch",
    "https://203.0.113.8/dispatch",
    "https://[::1]/dispatch",
    "https://[fc00::8]/dispatch",
    "https://[2001:db8::8]/dispatch",
    "https://[::ffff:10.0.0.8]/dispatch",
    "https://adapter.invalid/dispatch",
    "https://example.com/dispatch",
    "https://user:password@public-health.dalian.gov.cn/dispatch"
  ].forEach((value) => assert.throws(() => normalizeProductionEndpoint(value)));

  const profile = EXTERNAL_ADAPTER_PROFILES[0];
  const env = envForProfiles();
  env[profile.endpointEnv] = "https://localhost/dispatch";
  const registry = buildPublicHealthExternalEndpointProbeRegistry({
    env,
    receipts: EXTERNAL_ADAPTER_PROFILES.slice(1).map((item) => probeFor(item)),
    keyringResolver: () => keyring(),
    at: AT
  });
  assert.equal(registry.endpointConnectivityReady, false);
  assert.equal(registry.summary.endpointsConfigured, 7);
  assert.equal(registry.entries[0].blockerCode, "production-endpoint-configuration-required");
  assert.equal(registry.productionReady, false);

  const privateResolution = probeFor(profile, {
    network: {
      resolvedAddress: "10.0.0.8",
      sniHostname: new URL(endpointFor(profile.laneId)).hostname
    },
    nonce: "endpoint-probe-private-resolution-001"
  });
  assert.match(verifyPublicHealthExternalEndpointProbeReceipt(privateResolution, {
    expectedEndpoint: endpointFor(profile.laneId),
    expectedContract: profile.contract,
    keyring: keyring(),
    at: AT
  }).reason, /public IP address/);
});

test("cross-lane nonce reuse is rejected by the registry", () => {
  const sharedNonce = "endpoint-probe-cross-lane-nonce-001";
  const receipts = EXTERNAL_ADAPTER_PROFILES.map((profile, index) => probeFor(
    profile,
    index < 2 ? { nonce: sharedNonce } : {}
  ));
  const registry = buildPublicHealthExternalEndpointProbeRegistry({
    env: envForProfiles(),
    receipts,
    keyringResolver: () => keyring(),
    at: AT
  });
  assert.equal(registry.summary.endpointProbesVerified, 7);
  assert.equal(registry.endpointConnectivityReady, false);
  assert.match(registry.entries[1].blockerReason, /nonce replay/);
  assert.equal(registry.productionReady, false);
});
