const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EXTERNAL_ADAPTER_PROFILES
} = require("../public-health-external-adapter-service");
const {
  ROTATION_SEQUENCE,
  buildPublicHealthKeySafetyBoard,
  evaluateRotationEvidence,
  loadPublicHealthContractGovernance,
  loadPublicHealthEndpointProbeCampaignContext,
  loadPublicHealthEndpointProbeContext,
  loadPublicHealthEndpointProbePolicies,
  loadPublicHealthLaneCredentials,
  loadPublicHealthResiliencePolicies
} = require("../public-health-external-key-provider");

const AT = "2026-07-23T08:00:00.000Z";
const REQUEST_SECRET = "provider-request-secret-1234567890-123456";
const RECEIPT_SECRET = "provider-receipt-secret-1234567890-123456";
const CONTRACT_SECRET = "provider-contract-secret-1234567890-12345";
const ENDPOINT_PROBE_SECRET = "provider-endpoint-probe-secret-1234567890";
const CAMPAIGN_SECRET = "provider-endpoint-campaign-secret-1234567890";
const LANE_IDS = [
  "infectious-reporting",
  "immunization",
  "maternal-child",
  "senior-health",
  "chronic-management",
  "public-health-followup",
  "health-education",
  "family-doctor"
];
const RESILIENCE_POLICIES = Object.fromEntries([
  ...LANE_IDS
].map((laneId) => [laneId, {
  failureThreshold: 3,
  openSeconds: 120,
  halfOpenMaxProbes: 1,
  rateLimitPerMinute: 30,
  maxPending: 100
}]));
const ENDPOINT_PROBE_POLICIES = Object.fromEntries(LANE_IDS.map((laneId) => [laneId, {
  timeoutMs: 2000,
  maxLatencyMs: 1200,
  receiptTtlSeconds: 600,
  minIntervalSeconds: 60,
  certificatePins: ["a".repeat(64)],
  requireMutualTls: true
}]));

function managedKeyring(purpose, activeKeyId, keys) {
  return { purpose, activeKeyId, keys };
}

function laneEnvironment(overrides = {}) {
  return {
    ...Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.flatMap((profile) => {
      const base = profile.endpointEnv.replace(/_ENDPOINT$/, "");
      return [
        [profile.endpointEnv, `https://${profile.laneId}.example.test/dispatch`],
        [`${base}_REQUEST_SECRET`, REQUEST_SECRET],
        [`${base}_RECEIPT_SECRET`, RECEIPT_SECRET],
        [`${base}_ENDPOINT_PROBE_SECRET`, ENDPOINT_PROBE_SECRET]
      ];
    })),
    PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_SECRET: CONTRACT_SECRET,
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_SECRET: CAMPAIGN_SECRET,
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES: JSON.stringify(ENDPOINT_PROBE_POLICIES),
    ...overrides
  };
}

test("local compatibility credentials stay non-enumerable and production blocked", async () => {
  const credentials = await loadPublicHealthLaneCredentials("immunization", {
    at: AT,
    env: {
      NODE_ENV: "test",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
      PUBLIC_HEALTH_IMMUNIZATION_REQUEST_SECRET: REQUEST_SECRET,
      PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_SECRET: RECEIPT_SECRET
    }
  });
  assert.equal(credentials.endpoint, "https://immunization.example.test/dispatch");
  assert.equal(credentials.requestKeyring, REQUEST_SECRET);
  assert.equal(credentials.receiptKeyring, RECEIPT_SECRET);
  assert.equal(credentials.resiliencePolicies.immunization.maxPending, 100);
  assert.equal(credentials.summary.source, "legacy-static");
  assert.equal(credentials.summary.resilience.lanes, 8);
  assert.equal(credentials.summary.productionReady, false);
  const serialized = JSON.stringify(credentials);
  assert.doesNotMatch(serialized, new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(serialized, new RegExp(RECEIPT_SECRET));
  assert.doesNotMatch(serialized, /example\.test\/dispatch/);
  assert.doesNotMatch(serialized, /failureThreshold|maxPending/);
});

test("production loads request and receipt keyrings by lane reference", async () => {
  const calls = [];
  const requestKeyring = managedKeyring("public-health-request", "request-2026-08", [{
    keyId: "request-2026-08",
    secret: REQUEST_SECRET,
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const receiptKeyring = managedKeyring("public-health-receipt", "receipt-2026-08", [{
    keyId: "receipt-2026-08",
    secret: RECEIPT_SECRET,
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const credentials = await loadPublicHealthLaneCredentials("immunization", {
    at: AT,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
      PUBLIC_HEALTH_IMMUNIZATION_REQUEST_KEYRING_REF: "kms://public-health/immunization/request",
      PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_KEYRING_REF: "kms://public-health/immunization/receipt",
      PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES: JSON.stringify(RESILIENCE_POLICIES)
    },
    loader: async (request) => {
      calls.push(request);
      return request.purpose.endsWith("request") ? requestKeyring : receiptKeyring;
    }
  });
  assert.deepEqual(calls.map((item) => [item.laneId, item.purpose, item.reference]), [
    ["immunization", "public-health-request", "kms://public-health/immunization/request"],
    ["immunization", "public-health-receipt", "kms://public-health/immunization/receipt"]
  ]);
  assert.equal(credentials.requestKeyring, requestKeyring);
  assert.equal(credentials.receiptKeyring, receiptKeyring);
  assert.deepEqual(credentials.resiliencePolicies.immunization, RESILIENCE_POLICIES.immunization);
  assert.equal(credentials.summary.source, "managed-key-service");
  assert.equal(credentials.summary.productionReady, false);
  assert.doesNotMatch(JSON.stringify(credentials), /provider-(request|receipt)-secret/);
});

test("contract governance uses an independent non-enumerable managed keyring", async () => {
  const contractKeyring = managedKeyring("public-health-contract-governance", "contract-2026-08", [{
    keyId: "contract-2026-08",
    secret: CONTRACT_SECRET,
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const calls = [];
  const context = await loadPublicHealthContractGovernance({}, {
    at: AT,
    production: true,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_KEYRING_REF: "kms://public-health/contracts/governance"
    },
    loader: async (request) => {
      calls.push(request);
      return contractKeyring;
    }
  });
  assert.deepEqual(calls, [{
    laneId: "contract-governance",
    purpose: "public-health-contract-governance",
    reference: "kms://public-health/contracts/governance",
    at: AT
  }]);
  assert.equal(context.signingMaterial, contractKeyring);
  assert.equal(context.governance.summary.lanes, 8);
  assert.equal(context.summary.source, "managed-key-service");
  assert.doesNotMatch(JSON.stringify(context), new RegExp(CONTRACT_SECRET));
  assert.doesNotMatch(JSON.stringify(context), /signingMaterial/);
});

test("active endpoint probe context keeps endpoint, policy, TLS and signing keyring server-only", async () => {
  const context = await loadPublicHealthEndpointProbeContext("immunization", {}, {
    at: AT,
    env: {
      NODE_ENV: "test",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_SECRET: ENDPOINT_PROBE_SECRET,
      PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_SECRET: CONTRACT_SECRET,
      PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES: JSON.stringify(ENDPOINT_PROBE_POLICIES)
    }
  });
  assert.equal(context.endpoint, "https://immunization.example.test/dispatch");
  assert.equal(context.contract, "immunization-registry-v1");
  assert.equal(context.keyring, ENDPOINT_PROBE_SECRET);
  assert.equal(context.policy.requireMutualTls, true);
  assert.equal(context.policy.minIntervalSeconds, 60);
  assert.deepEqual(context.tlsOptions, {});
  assert.equal(context.summary.productionReady, false);
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /example\.test\/dispatch/);
  assert.doesNotMatch(serialized, new RegExp(ENDPOINT_PROBE_SECRET));
  assert.doesNotMatch(serialized, /certificatePins|timeoutMs|maxLatencyMs/);
});

test("production active probe resolves independent keyring, TLS credentials and complete policies", async () => {
  const endpointProbeKeyring = managedKeyring("public-health-endpoint-probe", "probe-2026-08", [{
    keyId: "probe-2026-08",
    secret: ENDPOINT_PROBE_SECRET,
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const keyCalls = [];
  const tlsCalls = [];
  const context = await loadPublicHealthEndpointProbeContext("immunization", {}, {
    at: AT,
    production: true,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_KEYRING_REF: "kms://public-health/immunization/endpoint-probe",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_TLS_REF: "vault://public-health/immunization/probe-tls",
      PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES: JSON.stringify(ENDPOINT_PROBE_POLICIES)
    },
    contractGovernance: {
      ok: true,
      entries: [{ laneId: "immunization", currentContract: "immunization-registry-v1" }]
    },
    loader: async (request) => {
      keyCalls.push(request);
      return endpointProbeKeyring;
    },
    tlsLoader: async (request) => {
      tlsCalls.push(request);
      return { cert: "managed-cert", key: "managed-private-key" };
    }
  });
  assert.deepEqual(keyCalls.map((item) => [item.laneId, item.purpose, item.reference]), [[
    "immunization",
    "public-health-endpoint-probe",
    "kms://public-health/immunization/endpoint-probe"
  ]]);
  assert.deepEqual(tlsCalls.map((item) => [item.laneId, item.purpose, item.reference]), [[
    "immunization",
    "public-health-endpoint-probe-tls",
    "vault://public-health/immunization/probe-tls"
  ]]);
  assert.equal(context.keyring, endpointProbeKeyring);
  assert.deepEqual(context.tlsOptions, { cert: "managed-cert", key: "managed-private-key" });
  assert.equal(context.summary.source, "managed-key-service");
  assert.equal(context.summary.tlsReferenceConfigured, true);
  assert.equal(context.summary.productionReady, false);
  assert.doesNotMatch(JSON.stringify(context), /managed-private-key|provider-endpoint-probe-secret/);
});

test("campaign context is global, non-enumerable and independent from every lane key", async () => {
  const context = await loadPublicHealthEndpointProbeCampaignContext({}, {
    at: AT,
    env: laneEnvironment({ NODE_ENV: "test" })
  });
  assert.equal(context.campaignKeyring.purpose, "public-health-endpoint-probe-campaign");
  assert.equal(Object.keys(context.laneContexts).length, 8);
  assert.equal(context.requiredConsecutiveCampaigns, 3);
  assert.equal(context.maxCampaignGapSeconds, 900);
  assert.equal(context.ttlSeconds, 3600);
  assert.equal(context.summary.independentFromLaneKeys, true);
  assert.equal(context.summary.productionReady, false);
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, new RegExp(CAMPAIGN_SECRET));
  assert.doesNotMatch(serialized, new RegExp(ENDPOINT_PROBE_SECRET));
  assert.doesNotMatch(serialized, /example\.test\/dispatch|certificatePins|campaignKeyring|laneContexts/);

  await assert.rejects(() => loadPublicHealthEndpointProbeCampaignContext({}, {
    at: AT,
    env: laneEnvironment({
      NODE_ENV: "test",
      PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_SECRET: REQUEST_SECRET
    })
  }), /independent from request, receipt and single-probe keys/);
  await assert.rejects(() => loadPublicHealthEndpointProbeCampaignContext({}, {
    at: AT,
    env: laneEnvironment({
      NODE_ENV: "test",
      PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_SECRET: ENDPOINT_PROBE_SECRET
    })
  }), /independent from request, receipt and single-probe keys/);
});

test("production campaign context requires a purpose-bound managed global keyring", async () => {
  const productionPolicies = Object.fromEntries(LANE_IDS.map((laneId) => [laneId, {
    ...ENDPOINT_PROBE_POLICIES[laneId],
    certificatePins: [],
    requireMutualTls: false
  }]));
  const env = {
    NODE_ENV: "production",
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_KEYRING_REF: "kms://public-health/endpoint-campaign",
    PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_KEYRING_REF: "kms://public-health/contracts",
    PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES: JSON.stringify(productionPolicies),
    PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES: JSON.stringify(RESILIENCE_POLICIES),
    ...Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.flatMap((profile) => {
      const base = profile.endpointEnv.replace(/_ENDPOINT$/, "");
      return [
        [profile.endpointEnv, `https://${profile.laneId}.example.test/dispatch`],
        [`${base}_REQUEST_KEYRING_REF`, `kms://${profile.laneId}/request`],
        [`${base}_RECEIPT_KEYRING_REF`, `kms://${profile.laneId}/receipt`],
        [`${base}_ENDPOINT_PROBE_KEYRING_REF`, `kms://${profile.laneId}/probe`]
      ];
    }))
  };
  const secretForPurpose = (purpose) => {
    if (purpose === "public-health-endpoint-probe-campaign") return CAMPAIGN_SECRET;
    if (purpose === "public-health-contract-governance") return CONTRACT_SECRET;
    if (purpose === "public-health-endpoint-probe") return ENDPOINT_PROBE_SECRET;
    if (purpose === "public-health-request") return REQUEST_SECRET;
    return RECEIPT_SECRET;
  };
  const loader = async ({ purpose }) => managedKeyring(purpose, `${purpose}-active`, [{
    keyId: `${purpose}-active`,
    secret: secretForPurpose(purpose),
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const context = await loadPublicHealthEndpointProbeCampaignContext({}, {
    at: AT,
    env,
    loader
  });
  assert.equal(context.campaignKeyring.purpose, "public-health-endpoint-probe-campaign");
  assert.equal(context.summary.source, "managed-key-service");
  assert.equal(context.summary.referenceConfigured, true);
  assert.equal(context.summary.productionReady, false);

  await assert.rejects(() => loadPublicHealthEndpointProbeCampaignContext({}, {
    at: AT,
    env,
    loader: async (request) => {
      const keyring = await loader(request);
      return request.purpose === "public-health-endpoint-probe-campaign"
        ? { ...keyring, purpose: "public-health-endpoint-probe" }
        : keyring;
    }
  }), /campaign keyring purpose is invalid/);

  await assert.rejects(() => loadPublicHealthEndpointProbeCampaignContext({}, {
    at: AT,
    env,
    loader: async (request) => {
      const keyring = await loader(request);
      if (request.purpose !== "public-health-request") return keyring;
      return managedKeyring("public-health-request", "request-active", [
        {
          keyId: "request-active",
          secret: REQUEST_SECRET,
          status: "active",
          notBefore: "2026-07-01T00:00:00.000Z",
          expiresAt: "2026-09-01T00:00:00.000Z",
          revokedAt: ""
        },
        {
          keyId: "request-grace",
          secret: CAMPAIGN_SECRET,
          status: "grace",
          notBefore: "2026-06-01T00:00:00.000Z",
          expiresAt: "2026-08-01T00:00:00.000Z",
          revokedAt: ""
        }
      ]);
    }
  }), /independent from request, receipt and single-probe keys/);
});

test("production resilience configuration covers all eight lanes and rejects gaps", () => {
  const policies = loadPublicHealthResiliencePolicies({
    production: true,
    resiliencePolicies: RESILIENCE_POLICIES
  });
  assert.equal(Object.keys(policies).length, 8);
  assert.equal(policies["family-doctor"].halfOpenMaxProbes, 1);
  assert.throws(() => loadPublicHealthResiliencePolicies({
    production: true,
    resiliencePolicies: { immunization: RESILIENCE_POLICIES.immunization }
  }), /production resilience policy is required/);
  assert.throws(() => loadPublicHealthResiliencePolicies({
    production: true,
    resiliencePolicies: { ...RESILIENCE_POLICIES, immunization: { ...RESILIENCE_POLICIES.immunization, maxPending: 0 } }
  }), /maxPending must be an integer/);
});

test("production endpoint probe policies and managed material fail closed when incomplete", async () => {
  const policies = loadPublicHealthEndpointProbePolicies({
    production: true,
    endpointProbePolicies: ENDPOINT_PROBE_POLICIES
  });
  assert.equal(Object.keys(policies).length, 8);
  assert.equal(policies.immunization.requireMutualTls, true);
  assert.throws(() => loadPublicHealthEndpointProbePolicies({
    production: true,
    endpointProbePolicies: { immunization: ENDPOINT_PROBE_POLICIES.immunization }
  }), /production endpoint probe policy is required/);
  await assert.rejects(() => loadPublicHealthEndpointProbeContext("immunization", {}, {
    at: AT,
    production: true,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
      PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES: JSON.stringify(ENDPOINT_PROBE_POLICIES)
    },
    contractGovernance: {
      ok: true,
      entries: [{ laneId: "immunization", currentContract: "immunization-registry-v1" }]
    }
  }), /ENDPOINT_PROBE_KEYRING_REF is required/);
  await assert.rejects(() => loadPublicHealthEndpointProbeContext("immunization", {}, {
    at: AT,
    production: true,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT_PROBE_KEYRING_REF: "kms://endpoint-probe",
      PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES: JSON.stringify(ENDPOINT_PROBE_POLICIES)
    },
    contractGovernance: {
      ok: true,
      entries: [{ laneId: "immunization", currentContract: "immunization-registry-v1" }]
    },
    loader: async () => managedKeyring("public-health-endpoint-probe", "probe-active", [{
      keyId: "probe-active",
      secret: ENDPOINT_PROBE_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      revokedAt: ""
    }])
  }), /ENDPOINT_PROBE_TLS_REF is required/);
});

test("production fails closed without references or a managed key service", async () => {
  await assert.rejects(() => loadPublicHealthLaneCredentials("immunization", {
    at: AT,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES: JSON.stringify(RESILIENCE_POLICIES)
    }
  }), /REQUEST_KEYRING_REF is required/);
  await assert.rejects(() => loadPublicHealthLaneCredentials("immunization", {
    at: AT,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_IMMUNIZATION_REQUEST_KEYRING_REF: "kms://request",
      PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_KEYRING_REF: "kms://receipt",
      PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES: JSON.stringify(RESILIENCE_POLICIES)
    }
  }), /managed public health key service is unavailable/);
  await assert.rejects(() => loadPublicHealthContractGovernance({}, {
    at: AT,
    production: true,
    env: { NODE_ENV: "production" }
  }), /CONTRACT_GOVERNANCE_KEYRING_REF is required/);
});

test("rotation evidence must follow active grace smoke and retirement order", () => {
  const outOfOrder = evaluateRotationEvidence([
    { step: "new-active", status: "verified" },
    { step: "cross-key-callback-smoke", status: "verified" }
  ]);
  assert.equal(outOfOrder.ok, false);
  assert.equal(outOfOrder.steps.find((item) => item.step === "cross-key-callback-smoke").status, "blocked-by-sequence");

  const complete = evaluateRotationEvidence(ROTATION_SEQUENCE.map((step) => ({ step, status: "verified" })));
  assert.equal(complete.ok, true);
  assert.equal(complete.complete, true);
  assert.equal(complete.productionReady, false);
});

test("revoked historical references enter security quarantine without automatic recovery", () => {
  const requestKeyring = managedKeyring("public-health-request", "request-active", [
    {
      keyId: "request-revoked",
      secret: REQUEST_SECRET,
      status: "revoked",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      revokedAt: "2026-07-23T07:00:00.000Z"
    },
    {
      keyId: "request-active",
      secret: "provider-next-request-secret-1234567890",
      status: "active",
      notBefore: "2026-07-23T07:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      revokedAt: ""
    }
  ]);
  const receiptKeyring = managedKeyring("public-health-receipt", "receipt-active", [{
    keyId: "receipt-active",
    secret: RECEIPT_SECRET,
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const credentials = { requestKeyring, receiptKeyring };
  const board = buildPublicHealthKeySafetyBoard({
    publicHealthExternalDispatches: [{
      id: "dispatch-1",
      laneId: "immunization",
      requestSignatureKeyId: "request-revoked",
      request: { issuedAt: AT }
    }],
    publicHealthExternalDispatchAudit: []
  }, { immunization: credentials });
  assert.equal(board.ok, false);
  assert.equal(board.emergencyDisposition, "security-quarantine");
  assert.equal(board.automaticResignAllowed, false);
  assert.equal(board.automaticRecoveryAllowed, false);
  assert.equal(board.revocationIssues[0].code, "emergency-key-revocation-reference");
});
