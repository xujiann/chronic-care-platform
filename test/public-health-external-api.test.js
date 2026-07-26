const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
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
const IMMUNIZATION_ENDPOINT = "https://immunization.public-health.dalian.gov.cn/dispatch";
const hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const ENDPOINT_CERTIFICATE_FINGERPRINT = hex("api-immunization-endpoint-certificate");

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
  const envKeys = [
    "NODE_ENV",
    "DATA_DIR",
    "STORAGE_ENGINE",
    "SESSION_SECRETS",
    "SESSION_STORE",
    "PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT",
    "PUBLIC_HEALTH_IMMUNIZATION_REQUEST_SECRET",
    "PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_SECRET",
    "PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_SECRET",
    "PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_TLS_REF",
    "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES",
    "PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_MAX_CONCURRENT",
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
    PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: IMMUNIZATION_ENDPOINT,
    PUBLIC_HEALTH_IMMUNIZATION_REQUEST_SECRET: REQUEST_SECRET,
    PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_SECRET: RECEIPT_SECRET,
    PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_SECRET: ENDPOINT_PROBE_SECRET,
    PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_TLS_REF: "secret://public-health/immunization/probe-tls",
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES: JSON.stringify({
      immunization: {
        maxLatencyMs: 1200,
        timeoutMs: 2000,
        ttlSeconds: 600,
        minIntervalSeconds: 60,
        requireMutualTls: true,
        certificatePins: [ENDPOINT_CERTIFICATE_FINGERPRINT]
      }
    }),
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_MAX_CONCURRENT: "1",
    PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_SECRET: CONTRACT_SECRET,
    PUBLIC_HEALTH_EXTERNAL_CONTRACT_RELEASE_EVIDENCE: JSON.stringify(contractReleaseEvidence(testNow))
  });

  const {
    configurePublicHealthEndpointProbeRuntime,
    readDatabase,
    server,
    startServer,
    stopServer
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

  const initialEndpointSummary = await request(
    baseUrl,
    "/api/public-health/external/endpoints/summary",
    token
  );
  assert.equal(initialEndpointSummary.response.status, 200);
  assert.equal(initialEndpointSummary.body.endpointConnectivityReady, false);
  assert.equal(initialEndpointSummary.body.productionReady, false);

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
  assert.equal(endpointSummary.body.summary.endpointProbesVerified, 1);
  assert.equal(endpointSummary.body.endpointConnectivityReady, false);
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
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(ENDPOINT_CERTIFICATE_FINGERPRINT));
  assert.equal(board.body.contractGovernance.summary.scheduled, 1);
  assert.equal(board.body.endpointVerification.summary.endpointProbesVerified, 1);
  assert.equal(board.body.endpointVerification.endpointConnectivityReady, false);
  assert.equal(board.body.endpointVerification.productionReady, false);
  assert.doesNotMatch(JSON.stringify(board.body.endpointVerification), /https:\/\/|8\.8\.8\.8|"receiptId"|"signingKeyId"/i);

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
  assert.equal(persisted.publicHealthExternalEndpointProbeReceipts.length, 2);
  assert.equal(
    persisted.publicHealthExternalEndpointProbeReceipts.every((item) => item.endpoint === IMMUNIZATION_ENDPOINT),
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
  assert.equal(persisted.publicHealthExternalEndpointProbeAudit.length, 7);
  assert.deepEqual(
    persisted.publicHealthExternalEndpointProbeAudit.reduce((counts, item) => {
      counts[item.result] = (counts[item.result] || 0) + 1;
      return counts;
    }, {}),
    { rejected: 5, started: 1, succeeded: 1 }
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
  assert.doesNotMatch(serializedState, /requestKeyring|receiptKeyring/);
  assert.doesNotMatch(serializedState, new RegExp(CONTRACT_SECRET));
  assert.doesNotMatch(serializedState, /signingMaterial/);
});
