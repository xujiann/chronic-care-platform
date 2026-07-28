const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  EXTERNAL_ADAPTER_PROFILES,
  signPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");
const {
  publicHealthContractRuntimeReleaseDigest
} = require("../public-health-external-contract-integration");
const {
  ENDPOINT_PROBE_SCHEMA_VERSION,
  signPublicHealthExternalEndpointProbeReceipt
} = require("../public-health-external-endpoint-verification-service");

const ROOT = path.resolve(__dirname, "..");
const REQUEST_SECRET = "api-request-secret-1234567890-123456789";
const RECEIPT_SECRET = "api-receipt-secret-1234567890-123456789";
const CONTRACT_SECRET = "api-contract-secret-1234567890-12345678";
const ENDPOINT_PROBE_SECRET = "api-endpoint-probe-secret-1234567890-12345";
const ENDPOINT_CAMPAIGN_SECRET = "api-endpoint-campaign-secret-1234567890";
const IMMUNIZATION_ENDPOINT = "https://immunization.public-health.dalian.gov.cn/dispatch";
const hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const ENDPOINT_CERTIFICATE_FINGERPRINT = hex("api-immunization-endpoint-certificate");

function endpointForLane(laneId) {
  return laneId === "immunization"
    ? IMMUNIZATION_ENDPOINT
    : `https://${laneId}.public-health.dalian.gov.cn/dispatch`;
}

function activeProbeEnvironment() {
  return Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.flatMap((profile) => {
    const base = profile.endpointEnv.replace(/_ENDPOINT$/, "");
    return [
      [profile.endpointEnv, endpointForLane(profile.laneId)],
      [`${base}_REQUEST_SECRET`, REQUEST_SECRET],
      [`${base}_RECEIPT_SECRET`, RECEIPT_SECRET],
      [`${base}_ENDPOINT_PROBE_SECRET`, ENDPOINT_PROBE_SECRET],
      [`${base}_ENDPOINT_PROBE_TLS_REF`, `secret://public-health/${profile.laneId}/probe-tls`]
    ];
  }));
}

function activeProbePolicies() {
  return Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.map((profile) => [profile.laneId, {
    maxLatencyMs: 1200,
    timeoutMs: 2000,
    ttlSeconds: 600,
    minIntervalSeconds: 60,
    requireMutualTls: true,
    certificatePins: [ENDPOINT_CERTIFICATE_FINGERPRINT]
  }]));
}

function signedEndpointProbe(overrides = {}) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);
  return signPublicHealthExternalEndpointProbeReceipt({
    schemaVersion: ENDPOINT_PROBE_SCHEMA_VERSION,
    receiptId: "api-endpoint-probe-immunization-001",
    laneId: "immunization",
    adapterId: "ph-adapter-immunization",
    contract: "immunization-registry-v1",
    endpoint: IMMUNIZATION_ENDPOINT,
    status: "healthy",
    httpStatus: 204,
    latencyMs: 87,
    network: {
      resolvedAddress: "8.8.8.8",
      sniHostname: "immunization.public-health.dalian.gov.cn"
    },
    tls: {
      authorized: true,
      protocol: "TLSv1.3",
      certificateFingerprintSha256: ENDPOINT_CERTIFICATE_FINGERPRINT,
      mutualTlsVerified: true
    },
    verification: {
      attestationOrigin: "server-generated",
      verificationSource: "platform-observability",
      signatureVerified: true
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: "api-endpoint-probe-nonce-immunization-001",
    ...overrides
  }, ENDPOINT_PROBE_SECRET);
}

function contractReleaseEvidence(now) {
  const t08ReleaseDigest = hex("T08-904e2e0");
  const t00ReleaseDigest = hex("T00-public-contract-integration");
  return [{
    id: "api-immunization-v2-release",
    status: "deployed-and-verified",
    laneId: "immunization",
    fromContract: "immunization-registry-v1",
    toContract: "immunization-registry-v2",
    requestSchemaVersion: "public-health-external-dispatch/v2",
    receiptSchemaVersion: "public-health-external-receipt/v2",
    changeType: "additive",
    fieldDictionaryDigest: hex("api-field-dictionary"),
    sampleRequestDigest: hex("api-sample-request"),
    sampleReceiptDigest: hex("api-sample-receipt"),
    t08ReleaseDigest,
    t00ReleaseDigest,
    runtimeReleaseDigest: publicHealthContractRuntimeReleaseDigest(t08ReleaseDigest, t00ReleaseDigest),
    producerApproval: {
      organizationId: "producer-org",
      role: "producer-contract-owner",
      approverIdHash: hex("api-producer-approver"),
      approvedAt: new Date(now - 3_600_000).toISOString()
    },
    consumerApproval: {
      organizationId: "consumer-org",
      role: "consumer-contract-owner",
      approverIdHash: hex("api-consumer-approver"),
      approvedAt: new Date(now - 1_800_000).toISOString()
    },
    evidenceRefs: ["field-dictionary:api-immunization-v2"],
    jointTestEvidenceRef: "joint-test:api-immunization-v2",
    rollbackEvidenceRef: "rollback:api-immunization-v2",
    deployedAt: new Date(now - 7_200_000).toISOString(),
    verifiedAt: new Date(now - 900_000).toISOString()
  }];
}

async function request(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

async function login(baseUrl, username = "health") {
  const result = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

async function post(baseUrl, pathname, token, idempotencyKey, body, headers = {}) {
  return request(baseUrl, pathname, token, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey, ...headers },
    body: JSON.stringify(body)
  });
}

test("public health external routes use server time full keyrings and secret-free persistence", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-external-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const probeEnvironment = activeProbeEnvironment();
  const envKeys = [
    "NODE_ENV",
    "DATA_DIR",
    "STORAGE_ENGINE",
    "SESSION_SECRETS",
    "SESSION_STORE",
    ...Object.keys(probeEnvironment),
    "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES",
    "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_MAX_CONCURRENT",
    "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_SECRET",
    "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_REQUIRED",
    "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_MAX_GAP_SECONDS",
    "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_TTL_SECONDS",
    "PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_SECRET",
    "PUBLIC_HEALTH_EXTERNAL_CONTRACT_RELEASE_EVIDENCE"
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const testNow = Date.now();
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "public-health-external-api-session-secret-2026",
    SESSION_STORE: "memory",
    ...probeEnvironment,
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES: JSON.stringify(activeProbePolicies()),
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_MAX_CONCURRENT: "1",
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_SECRET: ENDPOINT_CAMPAIGN_SECRET,
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_REQUIRED: "3",
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_MAX_GAP_SECONDS: "900",
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_TTL_SECONDS: "3600",
    PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_SECRET: CONTRACT_SECRET,
    PUBLIC_HEALTH_EXTERNAL_CONTRACT_RELEASE_EVIDENCE: JSON.stringify(contractReleaseEvidence(testNow))
  });

  const {
    configurePublicHealthEndpointProbeRuntime,
    readDatabase,
    server,
    startServer,
    stopServer,
    writeDatabase
  } = require("../server");
  let releaseProbeTransport;
  let notifyProbeTransport;
  const probeTransportEntered = new Promise((resolve) => {
    notifyProbeTransport = resolve;
  });
  const probeTransportRelease = new Promise((resolve) => {
    releaseProbeTransport = resolve;
  });
  let probeTransportCalls = 0;
  configurePublicHealthEndpointProbeRuntime({
    tlsLoader: async () => ({
      cert: "restricted-client-certificate",
      key: "restricted-client-key",
      hostname: "attacker.invalid",
      rejectUnauthorized: false
    }),
    resolveAddresses: async () => [{ address: "8.8.8.8", family: 4 }],
    transport: async (context) => {
      probeTransportCalls += 1;
      notifyProbeTransport();
      await probeTransportRelease;
      return {
        statusCode: 204,
        latencyMs: 82,
        remoteAddress: context.resolvedAddress,
        authorized: true,
        tlsProtocol: "TLSv1.3",
        certificateFingerprintSha256: ENDPOINT_CERTIFICATE_FINGERPRINT,
        mutualTlsVerified: true
      };
    }
  });
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    configurePublicHealthEndpointProbeRuntime(null);
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const token = await login(baseUrl);
  const forgedApproval = await post(
    baseUrl,
    "/api/public-health/external/contracts/attestations",
    token,
    "api-contract-forged",
    {
      expectedVersion: 0,
      status: "approved",
      laneId: "immunization",
      fromContract: "immunization-registry-v1",
      runtimeReleaseDigest: hex("client-forged-release"),
      effectiveAt: new Date(testNow + 86_400_000).toISOString(),
      sunsetAt: new Date(testNow + 2_592_000_000).toISOString()
    }
  );
  assert.equal(forgedApproval.response.status, 400, JSON.stringify(forgedApproval.body));

  const contractApproval = await post(
    baseUrl,
    "/api/public-health/external/contracts/attestations",
    token,
    "api-contract-approved",
    {
      evidenceId: "api-immunization-v2-release",
      expectedVersion: 0,
      status: "rejected",
      effectiveAt: new Date(testNow + 86_400_000).toISOString(),
      sunsetAt: new Date(testNow + 2_592_000_000).toISOString()
    }
  );
  assert.equal(contractApproval.response.status, 201, JSON.stringify(contractApproval.body));
  assert.equal(contractApproval.body.attestation.status, "approved");
  assert.doesNotMatch(JSON.stringify(contractApproval.body), new RegExp(CONTRACT_SECRET));

  const replayedApproval = await post(
    baseUrl,
    "/api/public-health/external/contracts/attestations",
    token,
    "api-contract-approved",
    {
      evidenceId: "api-immunization-v2-release",
      expectedVersion: 0,
      effectiveAt: new Date(testNow + 86_400_000).toISOString(),
      sunsetAt: new Date(testNow + 2_592_000_000).toISOString()
    }
  );
  assert.equal(replayedApproval.response.status, 200, JSON.stringify(replayedApproval.body));
  assert.equal(replayedApproval.body.idempotent, true);

  const replayConflict = await post(
    baseUrl,
    "/api/public-health/external/contracts/attestations",
    token,
    "api-contract-approved",
    {
      evidenceId: "api-immunization-v2-release",
      expectedVersion: 0,
      effectiveAt: new Date(testNow + 86_400_000).toISOString(),
      sunsetAt: new Date(testNow + 2_678_400_000).toISOString()
    }
  );
  assert.equal(replayConflict.response.status, 409, JSON.stringify(replayConflict.body));

  const cityToken = await login(baseUrl, "city");
  const forbiddenApproval = await post(
    baseUrl,
    "/api/public-health/external/contracts/attestations",
    cityToken,
    "api-contract-forbidden-role",
    {
      evidenceId: "api-immunization-v2-release",
      expectedVersion: 0,
      effectiveAt: new Date(testNow + 86_400_000).toISOString(),
      sunsetAt: new Date(testNow + 2_592_000_000).toISOString()
    }
  );
  assert.equal(forbiddenApproval.response.status, 403, JSON.stringify(forbiddenApproval.body));

  const uniqueConflict = await post(
    baseUrl,
    "/api/public-health/external/contracts/attestations",
    token,
    "api-contract-unique-conflict",
    {
      evidenceId: "api-immunization-v2-release",
      expectedVersion: 0,
      effectiveAt: new Date(testNow + 86_400_000).toISOString(),
      sunsetAt: new Date(testNow + 2_592_000_000).toISOString()
    }
  );
  assert.equal(uniqueConflict.response.status, 409, JSON.stringify(uniqueConflict.body));

  const contractGovernance = await request(baseUrl, "/api/public-health/external/contracts/governance", token);
  assert.equal(contractGovernance.response.status, 200, JSON.stringify(contractGovernance.body));
  assert.equal(contractGovernance.body.summary.scheduled, 1);
  assert.equal(contractGovernance.body.productionReady, false);

  const anonymousEndpointSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/summary"
  );
  assert.equal(anonymousEndpointSummary.response.status, 401);
  const hospitalToken = await login(baseUrl, "hospital");
  const forbiddenEndpointSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/summary",
    hospitalToken
  );
  assert.equal(forbiddenEndpointSummary.response.status, 403);
  const forbiddenEndpointReceipt = await post(
    baseUrl,
    "/api/public-health/external/endpoints/receipts",
    hospitalToken,
    "api-endpoint-forbidden",
    { receipt: signedEndpointProbe() }
  );
  assert.equal(forbiddenEndpointReceipt.response.status, 403);
  const forbiddenActiveProbe = await post(
    baseUrl,
    "/api/public-health/external/endpoints/probes",
    hospitalToken,
    "api-active-probe-forbidden",
    { laneId: "immunization" }
  );
  assert.equal(forbiddenActiveProbe.response.status, 403);
  const forbiddenCampaignSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns/summary",
    hospitalToken
  );
  assert.equal(forbiddenCampaignSummary.response.status, 403);
  const forbiddenCampaign = await post(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns",
    hospitalToken,
    "api-endpoint-campaign-forbidden",
    {}
  );
  assert.equal(forbiddenCampaign.response.status, 403);

  const initialEndpointSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/summary",
    token
  );
  assert.equal(initialEndpointSummary.response.status, 200);
  assert.equal(initialEndpointSummary.body.endpointConnectivityReady, false);
  assert.equal(initialEndpointSummary.body.productionReady, false);
  assert.equal(Number.isInteger(initialEndpointSummary.body.summary.lanes), true);
  assert.equal(Number.isInteger(initialEndpointSummary.body.summary.endpointsConfigured), true);
  assert.equal(Number.isInteger(initialEndpointSummary.body.summary.endpointProbesVerified), true);
  assert.equal(Number.isInteger(initialEndpointSummary.body.worker.succeeded), true);
  assert.equal(Number.isInteger(initialEndpointSummary.body.worker.rejected), true);
  const initialCampaignSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns/summary",
    token
  );
  assert.equal(initialCampaignSummary.response.status, 200, JSON.stringify(initialCampaignSummary.body));
  assert.equal(initialCampaignSummary.body.endpointConnectivityReady, false);
  assert.equal(initialCampaignSummary.body.continuousConnectivityReady, false);
  assert.equal(initialCampaignSummary.body.summary.continuityBreaks, 0);
  assert.equal(Number.isInteger(initialCampaignSummary.body.summary.campaignsVerified), true);
  assert.equal(Number.isInteger(initialCampaignSummary.body.summary.consecutiveCampaigns), true);
  assert.equal(initialCampaignSummary.body.summary.requiredConsecutiveCampaigns, 3);
  assert.equal(initialCampaignSummary.body.continuityBreak, null);
  assert.equal(Number.isInteger(initialCampaignSummary.body.worker.succeeded), true);
  assert.equal(Number.isInteger(initialCampaignSummary.body.worker.rejected), true);
  assert.equal(initialCampaignSummary.body.productionReady, false);

  const injectedCampaign = await post(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns",
    token,
    "api-endpoint-campaign-injected-body",
    {
      endpoint: "https://attacker.invalid/dispatch",
      policy: { maxLatencyMs: 1 },
      requiredConsecutiveCampaigns: 1,
      keyring: "attacker-keyring"
    }
  );
  assert.equal(injectedCampaign.response.status, 400, JSON.stringify(injectedCampaign.body));
  assert.equal(injectedCampaign.body.code, "ENDPOINT_PROBE_CAMPAIGN_COMMAND_OVERRIDE_FORBIDDEN");
  assert.doesNotMatch(JSON.stringify(injectedCampaign.body), /attacker|keyring/i);

  const queryInjectedCampaign = await post(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns?at=1999-01-01T00%3A00%3A00.000Z&maxLatencyMs=1",
    token,
    "api-endpoint-campaign-injected-query",
    {}
  );
  assert.equal(queryInjectedCampaign.response.status, 400, JSON.stringify(queryInjectedCampaign.body));
  assert.equal(queryInjectedCampaign.body.code, "ENDPOINT_PROBE_CAMPAIGN_COMMAND_OVERRIDE_FORBIDDEN");

  delete process.env.PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_SECRET;
  const missingCampaignConfig = await post(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns",
    token,
    "api-endpoint-campaign-config-missing",
    {}
  );
  process.env.PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_SECRET = ENDPOINT_CAMPAIGN_SECRET;
  assert.equal(missingCampaignConfig.response.status, 503, JSON.stringify(missingCampaignConfig.body));
  assert.equal(missingCampaignConfig.body.code, "ENDPOINT_PROBE_CAMPAIGN_FAILED");

  const injectedActiveProbe = await post(
    baseUrl,
    "/api/public-health/external/endpoints/probes",
    token,
    "api-active-probe-injected-body",
    {
      laneId: "immunization",
      endpoint: "https://attacker.invalid/dispatch",
      policy: { requireMutualTls: false },
      keyring: "attacker-keyring"
    }
  );
  assert.equal(injectedActiveProbe.response.status, 400, JSON.stringify(injectedActiveProbe.body));
  assert.equal(injectedActiveProbe.body.code, "ENDPOINT_PROBE_COMMAND_OVERRIDE_FORBIDDEN");
  assert.doesNotMatch(JSON.stringify(injectedActiveProbe.body), /attacker|keyring/i);

  const queryInjectedActiveProbe = await post(
    baseUrl,
    "/api/public-health/external/endpoints/probes?laneId=immunization&timeoutMs=1&requireMutualTls=false",
    token,
    "api-active-probe-injected-query",
    { laneId: "immunization" }
  );
  assert.equal(queryInjectedActiveProbe.response.status, 400, JSON.stringify(queryInjectedActiveProbe.body));
  assert.equal(queryInjectedActiveProbe.body.code, "ENDPOINT_PROBE_COMMAND_OVERRIDE_FORBIDDEN");

  delete process.env.PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_SECRET;
  const missingProbeConfig = await post(
    baseUrl,
    "/api/public-health/external/endpoints/probes",
    token,
    "api-active-probe-config-missing",
    { laneId: "immunization" }
  );
  process.env.PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_SECRET = ENDPOINT_PROBE_SECRET;
  assert.equal(missingProbeConfig.response.status, 503, JSON.stringify(missingProbeConfig.body));
  assert.equal(missingProbeConfig.body.code, "ENDPOINT_PROBE_FAILED");

  const activeProbePromise = post(
    baseUrl,
    "/api/public-health/external/endpoints/probes",
    token,
    "api-active-probe-success",
    { laneId: "immunization" }
  );
  await probeTransportEntered;
  const concurrentActiveProbe = await post(
    baseUrl,
    "/api/public-health/external/endpoints/probes",
    token,
    "api-active-probe-concurrent",
    { laneId: "immunization" }
  );
  assert.equal(concurrentActiveProbe.response.status, 429, JSON.stringify(concurrentActiveProbe.body));
  assert.equal(concurrentActiveProbe.body.code, "ENDPOINT_PROBE_CONCURRENCY_LIMIT");
  releaseProbeTransport();
  const activeProbe = await activeProbePromise;
  assert.equal(activeProbe.response.status, 201, JSON.stringify(activeProbe.body));
  assert.equal(activeProbe.body.lane.connectivityVerified, true);
  assert.equal(activeProbe.body.endpointConnectivityReady, false);
  assert.equal(activeProbe.body.productionReady, false);
  assert.equal(probeTransportCalls, 1);
  const serializedActiveProbe = JSON.stringify(activeProbe.body);
  assert.doesNotMatch(serializedActiveProbe, /https:\/\//);
  assert.doesNotMatch(serializedActiveProbe, /8\.8\.8\.8/);
  assert.doesNotMatch(serializedActiveProbe, new RegExp(ENDPOINT_PROBE_SECRET));
  assert.doesNotMatch(serializedActiveProbe, new RegExp(ENDPOINT_CERTIFICATE_FINGERPRINT));

  const frequencyLimitedProbe = await post(
    baseUrl,
    "/api/public-health/external/endpoints/probes",
    token,
    "api-active-probe-frequency",
    { laneId: "immunization" }
  );
  assert.equal(frequencyLimitedProbe.response.status, 429, JSON.stringify(frequencyLimitedProbe.body));
  assert.equal(frequencyLimitedProbe.body.code, "ENDPOINT_PROBE_FREQUENCY_LIMIT");

  process.env.PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES = JSON.stringify(
    Object.fromEntries(Object.entries(activeProbePolicies()).map(([laneId, policy]) => [
      laneId,
      { ...policy, minIntervalSeconds: 1 }
    ]))
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  let releaseCampaignTransport;
  let notifyCampaignTransport;
  const campaignTransportEntered = new Promise((resolve) => {
    notifyCampaignTransport = resolve;
  });
  const campaignTransportRelease = new Promise((resolve) => {
    releaseCampaignTransport = resolve;
  });
  configurePublicHealthEndpointProbeRuntime({
    tlsLoader: async () => ({
      cert: "restricted-client-certificate",
      key: "restricted-client-key",
      hostname: "attacker.invalid",
      rejectUnauthorized: false
    }),
    resolveAddresses: async () => [{ address: "8.8.8.8", family: 4 }],
    transport: async (context) => {
      probeTransportCalls += 1;
      notifyCampaignTransport();
      await campaignTransportRelease;
      return {
        statusCode: 204,
        latencyMs: 82,
        remoteAddress: context.resolvedAddress,
        authorized: true,
        tlsProtocol: "TLSv1.3",
        certificateFingerprintSha256: ENDPOINT_CERTIFICATE_FINGERPRINT,
        mutualTlsVerified: true
      };
    }
  });
  const campaignPromise = post(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns",
    token,
    "api-endpoint-campaign-success",
    {}
  );
  await campaignTransportEntered;
  const concurrentCampaign = await post(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns",
    token,
    "api-endpoint-campaign-concurrent",
    {}
  );
  assert.equal(concurrentCampaign.response.status, 429, JSON.stringify(concurrentCampaign.body));
  assert.equal(concurrentCampaign.body.code, "ENDPOINT_PROBE_CAMPAIGN_CONCURRENCY_LIMIT");
  releaseCampaignTransport();
  const acceptedCampaign = await campaignPromise;
  assert.equal(acceptedCampaign.response.status, 201, JSON.stringify(acceptedCampaign.body));
  assert.equal(acceptedCampaign.body.endpointConnectivityReady, true);
  assert.equal(acceptedCampaign.body.continuousConnectivityReady, false);
  assert.equal(acceptedCampaign.body.productionReady, false);
  assert.equal(acceptedCampaign.body.summary.campaignsVerified, 1);
  assert.equal(acceptedCampaign.body.summary.consecutiveCampaigns, 1);
  assert.equal(acceptedCampaign.body.summary.requiredConsecutiveCampaigns, 3);
  assert.equal(probeTransportCalls, 9);
  const serializedCampaign = JSON.stringify(acceptedCampaign.body);
  assert.doesNotMatch(serializedCampaign, /https:\/\/|8\.8\.8\.8/);
  assert.doesNotMatch(serializedCampaign, new RegExp(ENDPOINT_PROBE_SECRET));
  assert.doesNotMatch(serializedCampaign, new RegExp(ENDPOINT_CAMPAIGN_SECRET));
  assert.doesNotMatch(serializedCampaign, new RegExp(ENDPOINT_CERTIFICATE_FINGERPRINT));
  assert.doesNotMatch(
    serializedCampaign,
    /"receiptId"|"nonce"|"signingKeyId"|"signature"|"certificatePins"|"network"|"verification"/i
  );

  const campaignSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns/summary",
    token
  );
  assert.equal(campaignSummary.response.status, 200, JSON.stringify(campaignSummary.body));
  assert.equal(campaignSummary.body.endpointConnectivityReady, true);
  assert.equal(campaignSummary.body.continuousConnectivityReady, false);
  assert.equal(campaignSummary.body.productionReady, false);
  assert.equal(campaignSummary.body.summary.campaignsVerified, 1);
  assert.equal(campaignSummary.body.summary.continuityBreaks, 0);
  assert.equal(campaignSummary.body.continuityBreak, null);
  assert.doesNotMatch(JSON.stringify(campaignSummary.body), /https:\/\/|8\.8\.8\.8|"receiptId"|"nonce"|"signature"/i);

  const endpointReceipt = signedEndpointProbe();
  const acceptedEndpointReceipt = await post(
    baseUrl,
    "/api/public-health/external/endpoints/receipts?expectedEndpoint=https%3A%2F%2Fattacker.invalid%2Fdispatch&contract=immunization-registry-v99",
    token,
    "api-endpoint-accepted",
    {
      receipt: endpointReceipt,
      expectedEndpoint: "https://attacker.invalid/dispatch",
      expectedContract: "immunization-registry-v99",
      keyring: "attacker-controlled-keyring",
      at: "1999-01-01T00:00:00.000Z"
    }
  );
  assert.equal(acceptedEndpointReceipt.response.status, 201, JSON.stringify(acceptedEndpointReceipt.body));
  assert.equal(acceptedEndpointReceipt.body.lane.connectivityVerified, true);
  assert.equal(acceptedEndpointReceipt.body.productionReady, false);

  const replayedEndpointReceipt = await post(
    baseUrl,
    "/api/public-health/external/endpoints/receipts",
    token,
    "api-endpoint-replay",
    { receipt: endpointReceipt }
  );
  assert.equal(replayedEndpointReceipt.response.status, 409, JSON.stringify(replayedEndpointReceipt.body));

  const nonceReplayReceipt = signedEndpointProbe({
    receiptId: "api-endpoint-probe-immunization-002"
  });
  const nonceReplay = await post(
    baseUrl,
    "/api/public-health/external/endpoints/receipts",
    token,
    "api-endpoint-nonce-replay",
    { receipt: nonceReplayReceipt }
  );
  assert.equal(nonceReplay.response.status, 409, JSON.stringify(nonceReplay.body));

  const forgedEndpointReceipt = signedEndpointProbe({
    receiptId: "api-endpoint-probe-immunization-003",
    endpoint: "https://other.public-health.dalian.gov.cn/dispatch",
    network: {
      resolvedAddress: "1.1.1.1",
      sniHostname: "other.public-health.dalian.gov.cn"
    },
    nonce: "api-endpoint-probe-nonce-immunization-003"
  });
  const forgedEndpoint = await post(
    baseUrl,
    "/api/public-health/external/endpoints/receipts",
    token,
    "api-endpoint-forged-config",
    {
      receipt: forgedEndpointReceipt,
      expectedEndpoint: "https://other.public-health.dalian.gov.cn/dispatch",
      keyring: RECEIPT_SECRET
    }
  );
  assert.equal(forgedEndpoint.response.status, 400, JSON.stringify(forgedEndpoint.body));

  const endpointSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/summary",
    token
  );
  assert.equal(endpointSummary.response.status, 200, JSON.stringify(endpointSummary.body));
  assert.equal(endpointSummary.body.summary.endpointProbesVerified, 8);
  assert.equal(endpointSummary.body.endpointConnectivityReady, true);
  assert.equal(endpointSummary.body.productionReady, false);
  const serializedEndpointSummary = JSON.stringify(endpointSummary.body);
  assert.doesNotMatch(serializedEndpointSummary, /https:\/\//);
  assert.doesNotMatch(serializedEndpointSummary, /8\.8\.8\.8/);
  assert.doesNotMatch(serializedEndpointSummary, new RegExp(RECEIPT_SECRET));
  assert.doesNotMatch(serializedEndpointSummary, new RegExp(ENDPOINT_PROBE_SECRET));
  assert.doesNotMatch(serializedEndpointSummary, new RegExp(ENDPOINT_CERTIFICATE_FINGERPRINT));
  assert.doesNotMatch(serializedEndpointSummary, /"receiptId"|"signingKeyId"|"network"|"signature"|"verification"/i);
  const scopedState = await request(baseUrl, "/api/state", token);
  assert.equal(scopedState.response.status, 200);
  assert.equal("publicHealthExternalEndpointProbeReceipts" in scopedState.body, false);
  assert.equal("publicHealthExternalEndpointProbeAudit" in scopedState.body, false);
  assert.equal("publicHealthExternalEndpointProbeCampaigns" in scopedState.body, false);
  assert.equal("publicHealthExternalEndpointProbeCampaignAudit" in scopedState.body, false);

  const runtime = await request(baseUrl, "/api/public-health/coordination-runtime", token);
  assert.equal(runtime.response.status, 200);
  assert.equal(runtime.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(runtime.body), /residentId/);
  const handoff = runtime.body.handoffs.find((item) => item.laneId === "immunization");
  assert.ok(handoff);

  const assigned = await post(
    baseUrl,
    `/api/public-health/coordination/${encodeURIComponent(handoff.id)}/actions`,
    token,
    "api-immunization-assign",
    {
      action: "assign-coordination",
      expectedVersion: 1,
      assignedTo: handoff.owner,
      dueAt: "2026-07-31",
      note: "assign local coordination",
      at: "1999-01-01T00:00:00.000Z"
    }
  );
  assert.equal(assigned.response.status, 200, JSON.stringify(assigned.body));
  assert.notEqual(assigned.body.action.at, "1999-01-01T00:00:00.000Z");

  const started = await post(
    baseUrl,
    `/api/public-health/coordination/${encodeURIComponent(handoff.id)}/actions`,
    token,
    "api-immunization-start",
    { action: "start-coordination", expectedVersion: 2, note: "start local coordination" }
  );
  assert.equal(started.response.status, 200, JSON.stringify(started.body));

  const enqueued = await post(
    baseUrl,
    `/api/public-health/external/handoffs/${encodeURIComponent(handoff.id)}/enqueue`,
    token,
    "api-immunization-enqueue",
    {
      operation: "coordination-handoff",
      evidenceRefs: ["api-immunization-request"],
      exceptionOwner: "immunization compensation team",
      exceptionDueAt: "2026-07-31",
      contractBinding: {
        contract: "immunization-registry-v99",
        requestSchemaVersion: "public-health-external-dispatch/v99",
        receiptSchemaVersion: "public-health-external-receipt/v99"
      },
      resiliencePolicies: { immunization: { maxPending: 0 } },
      at: "1999-01-01T00:00:00.000Z"
    }
  );
  assert.equal(enqueued.response.status, 200, JSON.stringify(enqueued.body));
  assert.equal(enqueued.body.dispatch.outboxVersion, 1);
  assert.equal(enqueued.body.dispatch.contract, "immunization-registry-v1");
  assert.equal(enqueued.body.dispatch.request.schemaVersion, "public-health-external-dispatch/v1");
  assert.notEqual(enqueued.body.dispatch.request.issuedAt, "1999-01-01T00:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(enqueued.body), new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(JSON.stringify(enqueued.body), new RegExp(RECEIPT_SECRET));
  const dispatch = enqueued.body.dispatch;

  const due = await request(baseUrl, "/api/public-health/external/outbox/due", token);
  assert.equal(due.response.status, 200);
  assert.equal(due.body.candidateOnly, true);
  assert.equal(due.body.due.some((item) => item.id === dispatch.id), true);

  const claimed = await post(
    baseUrl,
    `/api/public-health/external/dispatches/${dispatch.id}/claim`,
    token,
    "api-immunization-claim",
    { expectedVersion: 1, expectedLaneControlVersion: 999, leaseSeconds: 60 }
  );
  assert.equal(claimed.response.status, 200, JSON.stringify(claimed.body));
  assert.match(claimed.body.leaseToken, /^[a-f0-9]{64}$/);
  assert.equal(claimed.body.dispatch.outboxVersion, 2);
  assert.equal(claimed.body.laneControl.version, 1);
  assert.equal(claimed.body.laneControl.circuitState, "closed");

  const staleLaneAttempt = await post(
    baseUrl,
    `/api/public-health/external/dispatches/${dispatch.id}/attempt`,
    token,
    "api-immunization-attempt-stale-lane",
    { expectedVersion: 2, expectedLaneControlVersion: 0, transportStatus: 503 },
    { "X-Public-Health-Lease-Token": claimed.body.leaseToken }
  );
  assert.equal(staleLaneAttempt.response.status, 409, JSON.stringify(staleLaneAttempt.body));

  const attempted = await post(
    baseUrl,
    `/api/public-health/external/dispatches/${dispatch.id}/attempt`,
    token,
    "api-immunization-attempt",
    {
      expectedVersion: 2,
      expectedLaneControlVersion: claimed.body.laneControl.version,
      transportStatus: 503,
      at: "1999-01-01T00:00:00.000Z"
    },
    { "X-Public-Health-Lease-Token": claimed.body.leaseToken }
  );
  assert.equal(attempted.response.status, 200, JSON.stringify(attempted.body));
  assert.equal(attempted.body.dispatch.deliveryState, "retry-scheduled");
  assert.equal(attempted.body.dispatch.outboxVersion, 3);
  assert.equal(attempted.body.laneControl.version, 2);
  assert.notEqual(attempted.body.dispatch.attempts[0].at, "1999-01-01T00:00:00.000Z");

  const receiptAt = new Date().toISOString();
  const receipt = signPublicHealthExternalReceipt({
    dispatchId: dispatch.id,
    requestDigest: dispatch.requestDigest,
    laneId: dispatch.laneId,
    handoffId: dispatch.handoffId,
    status: "accepted",
    receiptCode: "API-IMM-ACCEPT-001",
    evidenceRefs: ["api-immunization-receipt"],
    receivedAt: receiptAt,
    issuedAt: receiptAt
  }, RECEIPT_SECRET);
  const callback = await post(
    baseUrl,
    `/api/public-health/external/callbacks/${dispatch.id}`,
    "",
    "api-immunization-callback",
    { expectedVersion: 3, receipt, at: "1999-01-01T00:00:00.000Z" }
  );
  assert.equal(callback.response.status, 200, JSON.stringify(callback.body));
  assert.equal(callback.body.deliveryState, "delivered");
  assert.equal(callback.body.productionReady, false);

  const board = await request(baseUrl, "/api/public-health/external/operations-board", token);
  assert.equal(board.response.status, 200);
  assert.equal(board.body.productionReady, false);
  assert.equal(board.body.summary.signatureVerified, 1);
  assert.equal(board.body.keySafety.automaticRecoveryAllowed, false);
  assert.equal(board.body.keySafety.automaticResignAllowed, false);
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(RECEIPT_SECRET));
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(CONTRACT_SECRET));
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(ENDPOINT_PROBE_SECRET));
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(ENDPOINT_CAMPAIGN_SECRET));
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(ENDPOINT_CERTIFICATE_FINGERPRINT));
  assert.equal(board.body.contractGovernance.summary.scheduled, 1);
  assert.equal(board.body.endpointVerification.summary.endpointProbesVerified, 8);
  assert.equal(board.body.endpointVerification.endpointConnectivityReady, true);
  assert.equal(board.body.endpointVerification.productionReady, false);
  assert.doesNotMatch(JSON.stringify(board.body.endpointVerification), /https:\/\/|8\.8\.8\.8|"receiptId"|"signingKeyId"/i);
  assert.equal(board.body.endpointProbeContinuity.summary.campaignsVerified, 1);
  assert.equal(board.body.endpointProbeContinuity.endpointConnectivityReady, true);
  assert.equal(board.body.endpointProbeContinuity.continuousConnectivityReady, false);
  assert.equal(board.body.endpointProbeContinuity.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify(board.body.endpointProbeContinuity),
    /https:\/\/|8\.8\.8\.8|"receiptId"|"nonce"|"signingKeyId"|"signature"|"certificatePins"/i
  );

  const rotation = await request(baseUrl, "/api/public-health/external/key-rotation", token);
  assert.equal(rotation.response.status, 200);
  assert.equal(rotation.body.productionReady, false);
  assert.deepEqual(rotation.body.keySafety.rotation.steps.map((item) => item.step), [
    "new-active",
    "old-grace",
    "cross-key-audit-smoke",
    "cross-key-callback-smoke",
    "old-expire-or-revoke"
  ]);
  assert.doesNotMatch(JSON.stringify(rotation.body), new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(JSON.stringify(rotation.body), new RegExp(RECEIPT_SECRET));
  assert.doesNotMatch(JSON.stringify(rotation.body), new RegExp(CONTRACT_SECRET));

  const persisted = readDatabase();
  const persistedDispatch = persisted.publicHealthExternalDispatches.find((item) => item.id === dispatch.id);
  assert.equal(persistedDispatch.deliveryState, "delivered");
  assert.notEqual(persistedDispatch.attempts.at(-1).at, "1999-01-01T00:00:00.000Z");
  assert.equal(persisted.publicHealthExternalDispatchAudit.length, 4);
  assert.equal(persisted.publicHealthExternalLaneControls.find((item) => item.laneId === "immunization").version, 2);
  assert.equal(persisted.publicHealthExternalLaneControlAudit.length, 2);
  assert.equal(persisted.publicHealthExternalContractAttestations.length, 1);
  assert.equal(persisted.publicHealthExternalContractGovernanceAudit.length, 5);
  assert.equal(persisted.publicHealthExternalEndpointProbeReceipts.length, 10);
  assert.equal(
    new Set(persisted.publicHealthExternalEndpointProbeReceipts.map((item) => item.laneId)).size,
    8
  );
  assert.equal(
    persisted.publicHealthExternalEndpointProbeReceipts.every((item) =>
      item.endpoint === endpointForLane(item.laneId)
    ),
    true
  );
  assert.equal(
    persisted.publicHealthExternalEndpointProbeReceipts.every((item) => item.network.resolvedAddress === "8.8.8.8"),
    true
  );
  assert.equal(
    persisted.publicHealthExternalEndpointProbeReceipts.every((item) => item.productionReady === false),
    true
  );
  assert.equal(persisted.publicHealthExternalEndpointProbeAudit.length, 23);
  assert.deepEqual(
    persisted.publicHealthExternalEndpointProbeAudit.reduce((counts, item) => {
      counts[item.result] = (counts[item.result] || 0) + 1;
      return counts;
    }, {}),
    { rejected: 5, started: 9, succeeded: 9 }
  );
  assert.equal(
    persisted.publicHealthExternalEndpointProbeAudit.every((item) =>
      !("endpoint" in item)
      && !("resolvedAddress" in item)
      && !("certificate" in item)
      && !("error" in item)
    ),
    true
  );
  assert.equal(persisted.publicHealthExternalEndpointProbeCampaigns.length, 1);
  assert.equal(
    persisted.publicHealthExternalEndpointProbeCampaigns[0].receiptReferences.length,
    8
  );
  assert.equal(persisted.publicHealthExternalEndpointProbeCampaignAudit.length, 7);
  assert.deepEqual(
    persisted.publicHealthExternalEndpointProbeCampaignAudit.reduce((counts, item) => {
      counts[item.result] = (counts[item.result] || 0) + 1;
      return counts;
    }, {}),
    { rejected: 4, started: 2, succeeded: 1 }
  );
  assert.equal(
    persisted.publicHealthExternalEndpointProbeCampaignAudit.every((item) =>
      !("endpoint" in item)
      && !("resolvedAddress" in item)
      && !("certificate" in item)
      && !("signature" in item)
      && !("error" in item)
    ),
    true
  );
  assert.deepEqual(
    persisted.publicHealthExternalContractGovernanceAudit.map((item) => item.result).sort(),
    ["accepted", "rejected", "rejected", "rejected", "rejected"]
  );
  const acceptedGovernanceAudit = persisted.publicHealthExternalContractGovernanceAudit
    .find((item) => item.result === "accepted");
  assert.equal(acceptedGovernanceAudit.actorRole, "commission");
  assert.equal(acceptedGovernanceAudit.governanceRole, "public-health-contract-governance");
  assert.match(acceptedGovernanceAudit.requestDigest, /^[a-f0-9]{64}$/);
  const serializedState = JSON.stringify(persisted);
  assert.doesNotMatch(serializedState, new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(serializedState, new RegExp(RECEIPT_SECRET));
  assert.doesNotMatch(serializedState, new RegExp(ENDPOINT_PROBE_SECRET));
  assert.doesNotMatch(serializedState, new RegExp(ENDPOINT_CAMPAIGN_SECRET));
  assert.doesNotMatch(serializedState, /requestKeyring|receiptKeyring/);
  assert.doesNotMatch(serializedState, new RegExp(CONTRACT_SECRET));
  assert.doesNotMatch(serializedState, /signingMaterial/);

  for (let campaignIndex = 2; campaignIndex <= 4; campaignIndex += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const additionalCampaign = await post(
      baseUrl,
      "/api/public-health/external/endpoints/campaigns",
      token,
      `api-endpoint-campaign-gap-${campaignIndex}`,
      {}
    );
    assert.equal(additionalCampaign.response.status, 201, JSON.stringify(additionalCampaign.body));
  }

  const fourCampaignState = readDatabase();
  const campaignsOldestFirst = fourCampaignState.publicHealthExternalEndpointProbeCampaigns
    .slice()
    .sort((left, right) =>
      String(left.attestation.completedAt).localeCompare(String(right.attestation.completedAt))
    );
  assert.equal(campaignsOldestFirst.length, 4);

  const middleTamperedState = structuredClone(fourCampaignState);
  const middleCampaignId = campaignsOldestFirst[1].attestation.campaignId;
  middleTamperedState.publicHealthExternalEndpointProbeCampaigns
    .find((item) => item.attestation.campaignId === middleCampaignId)
    .attestation.signature = "f".repeat(64);
  writeDatabase(middleTamperedState, { event: "public-health-endpoint-probe-campaign-middle-tamper-test" });
  const middleBreakSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns/summary",
    token
  );
  assert.equal(middleBreakSummary.response.status, 200, JSON.stringify(middleBreakSummary.body));
  assert.equal(middleBreakSummary.body.summary.campaignsVerified, 3);
  assert.equal(middleBreakSummary.body.summary.campaignsRejected, 1);
  assert.equal(middleBreakSummary.body.summary.consecutiveCampaigns, 2);
  assert.equal(middleBreakSummary.body.summary.continuityBreaks, 1);
  assert.deepEqual(middleBreakSummary.body.continuityBreak, {
    campaignId: middleCampaignId,
    code: "ENDPOINT_PROBE_CAMPAIGN_VERIFICATION_FAILED"
  });
  assert.equal(middleBreakSummary.body.continuousConnectivityReady, false);
  assert.equal(middleBreakSummary.body.productionReady, false);

  const latestTamperedState = structuredClone(fourCampaignState);
  const latestCampaignId = campaignsOldestFirst.at(-1).attestation.campaignId;
  latestTamperedState.publicHealthExternalEndpointProbeCampaigns
    .find((item) => item.attestation.campaignId === latestCampaignId)
    .attestation.signature = "e".repeat(64);
  writeDatabase(latestTamperedState, { event: "public-health-endpoint-probe-campaign-latest-tamper-test" });
  const latestBreakSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns/summary",
    token
  );
  assert.equal(latestBreakSummary.body.summary.consecutiveCampaigns, 0);
  assert.equal(latestBreakSummary.body.summary.continuityBreaks, 1);
  assert.equal(latestBreakSummary.body.continuityBreak.campaignId, latestCampaignId);
  assert.equal(latestBreakSummary.body.continuousConnectivityReady, false);

  const historicalTamperedState = structuredClone(fourCampaignState);
  const historicalCampaignId = campaignsOldestFirst[0].attestation.campaignId;
  historicalTamperedState.publicHealthExternalEndpointProbeCampaigns
    .find((item) => item.attestation.campaignId === historicalCampaignId)
    .attestation.signature = "d".repeat(64);
  writeDatabase(historicalTamperedState, { event: "public-health-endpoint-probe-campaign-historical-tamper-test" });
  const historicalBreakSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/campaigns/summary",
    token
  );
  assert.equal(historicalBreakSummary.body.summary.campaignsRejected, 1);
  assert.equal(historicalBreakSummary.body.summary.consecutiveCampaigns, 3);
  assert.equal(historicalBreakSummary.body.summary.continuityBreaks, 0);
  assert.equal(historicalBreakSummary.body.continuityBreak, null);
  assert.equal(historicalBreakSummary.body.continuousConnectivityReady, true);
  assert.equal(historicalBreakSummary.body.productionReady, false);

  for (const summary of [middleBreakSummary.body, latestBreakSummary.body, historicalBreakSummary.body]) {
    const serializedSummary = JSON.stringify(summary);
    assert.doesNotMatch(serializedSummary, /https:\/\/|8\.8\.8\.8|"receiptId"|"nonce"|"signature"/i);
    assert.doesNotMatch(serializedSummary, /invalid|tamper|untrusted|certificate|keyring|signingKeyId/i);
  }
});
