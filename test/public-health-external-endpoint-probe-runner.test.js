"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  EXTERNAL_ADAPTER_PROFILES
} = require("../public-health-external-adapter-service");
const {
  buildPublicHealthExternalEndpointProbeRegistry
} = require("../public-health-external-endpoint-verification-service");
const {
  normalizeProbePolicy,
  normalizeResolvedAddresses,
  runPublicHealthExternalEndpointProbe,
  runPublicHealthExternalEndpointProbeBatch,
  safeTlsClientOptions
} = require("../public-health-external-endpoint-probe-runner");

const AT = "2026-07-27T08:00:00.000Z";
const KEY_SECRET = "public-health-active-probe-key-2026-07-123456";

function keyring() {
  return {
    purpose: "public-health-endpoint-probe",
    activeKeyId: "endpoint-probe-2026-07",
    keys: [{
      keyId: "endpoint-probe-2026-07",
      secret: KEY_SECRET,
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
  return crypto.createHash("sha256").update(`active-probe-certificate:${laneId}`).digest("hex");
}

function addressFor(laneId) {
  const index = EXTERNAL_ADAPTER_PROFILES.findIndex((item) => item.laneId === laneId);
  return `93.184.216.${index + 1}`;
}

function deterministicUuid() {
  let sequence = 0;
  return () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

function successfulOptions(overrides = {}) {
  return {
    env: envForProfiles(),
    at: AT,
    randomUUID: deterministicUuid(),
    keyringResolver: () => keyring(),
    policyResolver: (laneId) => ({
      maxLatencyMs: 1200,
      timeoutMs: 2000,
      ttlSeconds: 600,
      requireMutualTls: true,
      certificatePins: [fingerprintFor(laneId)]
    }),
    resolveAddresses: async (hostname, context) => [{
      address: addressFor(context.laneId),
      family: 4
    }],
    transport: async (context) => ({
      statusCode: 204,
      latencyMs: 75,
      remoteAddress: context.resolvedAddress,
      authorized: true,
      tlsProtocol: "TLSv1.3",
      certificateFingerprintSha256: fingerprintFor(context.laneId),
      mutualTlsVerified: true
    }),
    ...overrides
  };
}

test("server runner actively probes all eight configured endpoints and emits verifiable receipts", async () => {
  const observed = [];
  const options = successfulOptions({
    transport: async (context) => {
      observed.push({
        laneId: context.laneId,
        endpoint: context.endpoint,
        sniHostname: context.sniHostname,
        resolvedAddress: context.resolvedAddress,
        method: context.policy.method
      });
      return {
        statusCode: 204,
        latencyMs: 75,
        remoteAddress: context.resolvedAddress,
        authorized: true,
        tlsProtocol: "TLSv1.3",
        certificateFingerprintSha256: fingerprintFor(context.laneId),
        mutualTlsVerified: true
      };
    }
  });
  const batch = await runPublicHealthExternalEndpointProbeBatch(options);
  assert.equal(batch.ok, true);
  assert.deepEqual(batch.summary, { lanes: 8, succeeded: 8, failed: 0 });
  assert.equal(batch.productionReady, false);
  assert.equal(observed.length, 8);
  assert.equal(observed.every((item) => (
    item.endpoint === endpointFor(item.laneId)
    && item.sniHostname === new URL(endpointFor(item.laneId)).hostname
    && item.resolvedAddress === addressFor(item.laneId)
    && item.method === "HEAD"
  )), true);

  const registry = buildPublicHealthExternalEndpointProbeRegistry({
    env: options.env,
    receipts: batch.results.map((item) => item.receipt),
    keyringResolver: () => keyring(),
    policyResolver: (laneId) => ({
      requireMutualTls: true,
      certificatePins: [fingerprintFor(laneId)]
    }),
    at: AT
  });
  assert.equal(registry.endpointConnectivityReady, true);
  assert.equal(registry.summary.endpointProbesVerified, 8);
  assert.equal(registry.productionReady, false);
  assert.equal(JSON.stringify(registry).includes("https://"), false);
  assert.equal(JSON.stringify(registry).includes("93.184.216."), false);
  assert.equal(JSON.stringify(registry).includes(KEY_SECRET), false);
});

test("probe command cannot override endpoint contract trust DNS TLS or signing inputs", async () => {
  const forbidden = [
    "endpoint",
    "contract",
    "verification",
    "status",
    "resolvedAddress",
    "tls",
    "keyring",
    "at",
    "policy"
  ];
  for (const key of forbidden) {
    await assert.rejects(
      runPublicHealthExternalEndpointProbe({
        laneId: EXTERNAL_ADAPTER_PROFILES[0].laneId,
        [key]: key === "verification" ? { signatureVerified: true } : "client-override"
      }, successfulOptions()),
      (error) => error.code === "ENDPOINT_PROBE_COMMAND_OVERRIDE_FORBIDDEN"
    );
  }
});

test("private mixed reserved and excessive DNS results fail before transport", async () => {
  const laneId = EXTERNAL_ADAPTER_PROFILES[0].laneId;
  const rejectedSets = [
    [{ address: "10.0.0.8", family: 4 }],
    [{ address: "93.184.216.1", family: 4 }, { address: "192.168.1.8", family: 4 }],
    [{ address: "::ffff:10.0.0.8", family: 6 }],
    [{ address: "fc00::8", family: 6 }],
    Array.from({ length: 17 }, (_, index) => ({ address: `93.184.216.${index + 1}`, family: 4 }))
  ];
  for (const rows of rejectedSets) {
    let transportCalls = 0;
    await assert.rejects(
      runPublicHealthExternalEndpointProbe({ laneId }, successfulOptions({
        resolveAddresses: async () => rows,
        transport: async () => {
          transportCalls += 1;
          return {};
        }
      })),
      (error) => ["ENDPOINT_PROBE_DNS_NON_PUBLIC", "ENDPOINT_PROBE_DNS_EXCESSIVE"].includes(error.code)
    );
    assert.equal(transportCalls, 0);
  }
  assert.doesNotThrow(() => normalizeResolvedAddresses([
    { address: "2606:4700:4700::1111", family: 6 }
  ]));
});

test("pinned DNS peer binding rejects rebinding before a receipt can be signed", async () => {
  const laneId = EXTERNAL_ADAPTER_PROFILES[0].laneId;
  await assert.rejects(
    runPublicHealthExternalEndpointProbe({ laneId }, successfulOptions({
      transport: async () => ({
        statusCode: 204,
        latencyMs: 30,
        remoteAddress: "1.1.1.1",
        authorized: true,
        tlsProtocol: "TLSv1.3",
        certificateFingerprintSha256: fingerprintFor(laneId),
        mutualTlsVerified: true
      })
    })),
    (error) => error.code === "ENDPOINT_PROBE_DNS_REBINDING"
  );
});

test("HTTP redirect latency TLS authorization protocol certificate pin and mTLS policies fail closed", async () => {
  const laneId = EXTERNAL_ADAPTER_PROFILES[0].laneId;
  const base = {
    statusCode: 204,
    latencyMs: 75,
    remoteAddress: addressFor(laneId),
    authorized: true,
    tlsProtocol: "TLSv1.3",
    certificateFingerprintSha256: fingerprintFor(laneId),
    mutualTlsVerified: true
  };
  const cases = [
    [{ statusCode: 302 }, "ENDPOINT_PROBE_HTTP_UNHEALTHY"],
    [{ latencyMs: 1201 }, "ENDPOINT_PROBE_LATENCY_EXCEEDED"],
    [{ authorized: false }, "ENDPOINT_PROBE_TLS_UNAUTHORIZED"],
    [{ tlsProtocol: "TLSv1.1" }, "ENDPOINT_PROBE_TLS_PROTOCOL_REJECTED"],
    [{ certificateFingerprintSha256: "a".repeat(64) }, "ENDPOINT_PROBE_CERTIFICATE_PIN_MISMATCH"],
    [{ mutualTlsVerified: false }, "ENDPOINT_PROBE_MTLS_REQUIRED"]
  ];
  for (const [override, code] of cases) {
    await assert.rejects(
      runPublicHealthExternalEndpointProbe({ laneId }, successfulOptions({
        transport: async () => ({ ...base, ...override })
      })),
      (error) => error.code === code
    );
  }
});

test("registry rejects a signed receipt when server certificate or mTLS policy changes", async () => {
  const profile = EXTERNAL_ADAPTER_PROFILES[0];
  const result = await runPublicHealthExternalEndpointProbe(
    { laneId: profile.laneId },
    successfulOptions()
  );
  const common = {
    env: envForProfiles(),
    receipts: [result.receipt],
    keyringResolver: () => keyring(),
    at: AT
  };
  const changedPin = buildPublicHealthExternalEndpointProbeRegistry({
    ...common,
    policyResolver: () => ({
      requireMutualTls: true,
      certificatePins: ["a".repeat(64)]
    })
  });
  assert.equal(changedPin.summary.endpointProbesVerified, 0);
  assert.match(changedPin.entries[0].blockerReason, /fingerprint/);

  const noMtlsReceipt = await runPublicHealthExternalEndpointProbe(
    { laneId: profile.laneId },
    successfulOptions({
      policyResolver: () => ({
        maxLatencyMs: 1200,
        timeoutMs: 2000,
        ttlSeconds: 600,
        requireMutualTls: false,
        certificatePins: [fingerprintFor(profile.laneId)]
      }),
      transport: async (context) => ({
        statusCode: 204,
        latencyMs: 75,
        remoteAddress: context.resolvedAddress,
        authorized: true,
        tlsProtocol: "TLSv1.3",
        certificateFingerprintSha256: fingerprintFor(profile.laneId),
        mutualTlsVerified: false
      })
    })
  );
  const changedMtls = buildPublicHealthExternalEndpointProbeRegistry({
    ...common,
    receipts: [noMtlsReceipt.receipt],
    policyResolver: () => ({ requireMutualTls: true })
  });
  assert.equal(changedMtls.summary.endpointProbesVerified, 0);
  assert.match(changedMtls.entries[0].blockerReason, /mutual TLS/);
});

test("batch failures expose neither endpoint IP key material nor restricted diagnostics", async () => {
  const secretDiagnostic = `${endpointFor(EXTERNAL_ADAPTER_PROFILES[0].laneId)} 10.0.0.8 ${KEY_SECRET}`;
  const batch = await runPublicHealthExternalEndpointProbeBatch(successfulOptions({
    resolveAddresses: async () => {
      throw new Error(secretDiagnostic);
    }
  }));
  assert.equal(batch.ok, false);
  assert.equal(batch.summary.failed, 8);
  const serialized = JSON.stringify(batch);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("10.0.0.8"), false);
  assert.equal(serialized.includes(KEY_SECRET), false);
  assert.equal(batch.results.every((item) => item.code === "ENDPOINT_PROBE_DNS_FAILED"), true);
});

test("probe policies reject unsafe timeouts TTLs methods pins and limits", () => {
  [
    { maxLatencyMs: 0 },
    { timeoutMs: 99 },
    { ttlSeconds: 59 },
    { ttlSeconds: 901 },
    { method: "POST" },
    { certificatePins: ["not-a-digest"] },
    { certificatePins: Array.from({ length: 17 }, (_, index) => (
      crypto.createHash("sha256").update(`pin:${index}`).digest("hex")
    )) }
  ].forEach((policy) => assert.throws(() => normalizeProbePolicy(policy)));
});

test("TLS credential resolver cannot override target verification DNS pinning or HTTP request controls", () => {
  const safe = safeTlsClientOptions({
    cert: "client-certificate",
    key: "client-key",
    ca: "trusted-ca",
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined,
    lookup: () => undefined,
    hostname: "attacker.invalid",
    servername: "attacker.invalid",
    method: "POST",
    path: "/side-effect"
  });
  assert.deepEqual(safe, {
    ca: "trusted-ca",
    cert: "client-certificate",
    key: "client-key"
  });
});
