"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  backupEnvironmentVariableForRegion,
  buildFleetStatus,
  environmentVariableForRegion,
  isBlockedIp,
  normalizeCertificateNotAfter,
  probeRegion,
  validateProbeBaseUrl
} = require("../src/platform/regional/multi-region-operations");

const NOW = "2026-08-06T12:00:00.000Z";
const VALID_CERTIFICATE = "2026-10-06T12:00:00.000Z";

function fakeResponses(regionCode = "210200", overrides = {}) {
  return {
    "/api/live": { statusCode: 200, body: { ok: true }, certificateNotAfter: VALID_CERTIFICATE },
    "/api/health": { statusCode: 200, body: { ok: true }, certificateNotAfter: VALID_CERTIFICATE },
    "/api/regional/context": {
      statusCode: 200,
      body: {
        regionCode,
        deploymentClass: regionCode === "210200" ? "production" : "test",
        contentDigest: overrides.contentDigest || ""
      },
      certificateNotAfter: VALID_CERTIFICATE
    }
  };
}

test("regional probe targets are server-owned HTTPS roots and reject local networks", () => {
  assert.equal(validateProbeBaseUrl("https://health.example.gov.cn").hostname, "health.example.gov.cn");
  for (const value of [
    "http://health.example.gov.cn",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://health.example.gov.cn/path",
    "https://user:pass@health.example.gov.cn",
    "https://health.example.gov.cn?target=internal"
  ]) {
    assert.throws(() => validateProbeBaseUrl(value), /regional probe/i);
  }
  assert.equal(isBlockedIp("192.168.1.1"), true);
  assert.equal(isBlockedIp("169.254.169.254"), true);
  assert.equal(isBlockedIp("203.0.113.10"), true);
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("::ffff:0a00:1"), true);
  assert.equal(normalizeCertificateNotAfter("not-a-certificate-date"), "");
  assert.equal(normalizeCertificateNotAfter(VALID_CERTIFICATE), VALID_CERTIFICATE);
});

test("fleet status exposes only release metadata and stable blocker codes", () => {
  const env = {
    [environmentVariableForRegion("210200")]: "https://dalian.example.gov.cn"
  };
  const fleet = buildFleetStatus({ env, now: NOW, receipts: [] });
  assert.equal(fleet.containsBusinessData, false);
  assert.equal(fleet.probeTargetsExposed, false);
  assert.equal(fleet.productionReady, false);
  assert.equal(fleet.sites.some((site) => "baseUrl" in site || "address" in site), false);
  const dalian = fleet.sites.find((site) => site.regionCode === "210200");
  assert.equal(dalian.endpointConfigured, true);
  assert.equal(dalian.status, "not-checked");
  const fixture = fleet.sites.find((site) => site.regionCode === "990001");
  assert.equal(fixture.status, "unconfigured");
  assert.ok(fixture.blockers.includes("server-owned-endpoint-missing"));
});

test("controlled probe pins public DNS and detects exact regional digest drift", async () => {
  const initialFleet = buildFleetStatus({ env: {}, now: NOW });
  const expected = initialFleet.sites.find((site) => site.regionCode === "210200");
  const env = {
    [environmentVariableForRegion("210200")]: "https://dalian.example.gov.cn"
  };
  const result = await probeRegion({
    env,
    regionCode: "210200",
    now: NOW,
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    transport: async ({ baseUrl, addresses, requiredPaths }) => {
      assert.equal(baseUrl.hostname, "dalian.example.gov.cn");
      assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
      assert.deepEqual(requiredPaths, ["/api/live", "/api/health", "/api/regional/context"]);
      return fakeResponses("210200", { contentDigest: expected.expectedContentDigest });
    }
  });
  assert.equal(result.endpointExposed, false);
  assert.equal(result.resolvedAddressesExposed, false);
  assert.equal(result.receipt.transportSafe, true);
  assert.equal(result.site.digestMatch, true);
  assert.ok(result.site.blockers.includes("backup-evidence-missing"));
  assert.equal(JSON.stringify(result).includes("dalian.example.gov.cn"), false);

  const backedUp = await probeRegion({
    env: {
      ...env,
      [backupEnvironmentVariableForRegion("210200")]: NOW
    },
    regionCode: "210200",
    now: NOW,
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    transport: async () => fakeResponses("210200", { contentDigest: expected.expectedContentDigest })
  });
  assert.equal(backedUp.site.status, "healthy");
  assert.equal(backedUp.site.blockers.includes("backup-evidence-missing"), false);

  const drift = await probeRegion({
    env,
    regionCode: "210200",
    now: NOW,
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    transport: async () => fakeResponses("210200", { contentDigest: "sha256:" + "f".repeat(64) })
  });
  assert.equal(drift.site.status, "drift");
  assert.ok(drift.site.blockers.includes("content-digest-drift"));
  assert.equal(drift.productionReady, false);
});

test("controlled probe rejects private DNS answers and client-selected regions", async () => {
  const env = {
    [environmentVariableForRegion("210200")]: "https://dalian.example.gov.cn"
  };
  await assert.rejects(
    probeRegion({
      env,
      regionCode: "210200",
      resolver: async () => [{ address: "10.0.0.5", family: 4 }],
      transport: async () => {
        throw new Error("transport must not run");
      }
    }),
    (error) => error.code === "REGIONAL_PROBE_DNS_BLOCKED"
  );
  await assert.rejects(
    probeRegion({ env, regionCode: "template" }),
    (error) => error.code === "REGIONAL_SITE_NOT_PROBE_ELIGIBLE"
  );
});
