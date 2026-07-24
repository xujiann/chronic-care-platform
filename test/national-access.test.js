const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const NationalAccessService = require("../national-access-service");
const { NationalHealthAccessClient } = require("../national-access-developer-sdk");

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

function authorized(token, method = "GET", body = undefined) {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

async function login(baseUrl, username) {
  return api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" })
  });
}

test("national access domain enforces the 1+N+M registry and package dependencies", () => {
  const state = NationalAccessService.seed();
  const actor = { username: "national-admin", name: "国家平台主管", role: "commission", orgCode: "CN-NATIONAL" };
  const center = NationalAccessService.buildCenter(state, actor);

  assert.equal(center.architecture.model, "1+N+M");
  assert.equal(center.summary.crossProvinceLabSharingReady, true);
  assert.equal(center.summary.servicePackages, 6);
  assert.equal(center.nodes.some((item) => item.nodeType === "national"), true);
  assert.equal(center.summary.healthyNodes, 4);

  const route = NationalAccessService.planCrossProvinceRoute(state, {
    sourceOrgCode: "MR1",
    targetOrgCode: "ZJ-H001",
    packageId: "pkg-lab-imaging",
    purpose: "cross-province-lab-query"
  }, actor);
  assert.equal(route.entity.crossProvince, true);
  assert.deepEqual(route.entity.hops, ["node-liaoning", "node-national", "node-zhejiang"]);
  assert.equal(route.entity.status, "ready");

  const createdNode = NationalAccessService.createNode(state, {
    nodeCode: "CN-44",
    name: "广东省候选节点",
    nodeType: "provincial",
    regionCode: "44",
    capabilities: ["institution-gateway", "clinical-routing"]
  }, actor);
  assert.equal(createdNode.entity.status, "submitted");

  const duplicateState = {
    ...state,
    nationalAccessNodes: [createdNode.entity, ...state.nationalAccessNodes]
  };
  assert.throws(
    () => NationalAccessService.createNode(duplicateState, {
      nodeCode: "CN-44",
      name: "重复节点",
      nodeType: "provincial",
      regionCode: "44"
    }, actor),
    (error) => error.code === "NATIONAL_ACCESS_NODE_EXISTS" && error.status === 409
  );

  const missingDependencyState = {
    ...state,
    nationalAccessInstitutions: [
      {
        id: "no-base-package",
        orgCode: "NOBASE-H001",
        nationalOrgCode: "CN-110100-H-099",
        name: "未开通基础包的机构",
        institutionType: "hospital",
        regionCode: "110100",
        nodeId: "node-national",
        status: "active"
      },
      ...state.nationalAccessInstitutions
    ]
  };
  assert.throws(
    () => NationalAccessService.createSubscription(missingDependencyState, {
      orgCode: "NOBASE-H001",
      packageId: "pkg-lab-imaging"
    }, actor),
    (error) => error.code === "NATIONAL_ACCESS_PACKAGE_DEPENDENCY_MISSING" && error.status === 409
  );
});

test("national access security, failover, envelopes, SLA and standards are governed end to end", () => {
  const state = NationalAccessService.seed();
  const actor = { username: "national-admin", name: "National administrator", role: "commission", orgCode: "CN-NATIONAL" };

  const certificate = NationalAccessService.issueAccessCertificate(state, {
    subjectType: "institution",
    subjectId: "national-inst-zj1",
    environment: "pilot",
    publicKeyFingerprint: "c".repeat(64)
  }, actor);
  assert.equal(certificate.entity.status, "active");
  assert.match(certificate.entity.serialNumber, /^NHP-PILOT-INSTITUTION-/);
  assert.throws(
    () => NationalAccessService.issueAccessCertificate(state, {
      subjectType: "institution",
      subjectId: "national-inst-zj1",
      environment: "production",
      publicKeyFingerprint: "d".repeat(64)
    }, actor),
    (error) => error.code === "NATIONAL_ACCESS_PRODUCTION_CERTIFICATE_BLOCKED" && error.status === 409
  );

  const credential = NationalAccessService.issueDeveloperCredential(state, {
    orgCode: "MR1",
    name: "LIS integration sandbox key",
    environment: "sandbox",
    scopes: ["pkg-identity-basic", "pkg-lab-imaging"]
  }, actor);
  assert.match(credential.secret, /^nhp_/);
  assert.equal(credential.entity.secretHash.length, 64);
  assert.equal(credential.entity.quotaPolicyId, "quota-sandbox-default");
  const credentialState = {
    ...state,
    nationalDeveloperCredentials: [credential.entity, ...state.nationalDeveloperCredentials]
  };
  const center = NationalAccessService.buildCenter(credentialState, actor);
  assert.equal(center.developerCredentials.some((item) => Object.hasOwn(item, "secretHash")), false);
  assert.throws(
    () => NationalAccessService.issueDeveloperCredential(state, {
      orgCode: "MR1",
      name: "Production key",
      environment: "production",
      scopes: ["pkg-identity-basic"]
    }, actor),
    (error) => error.code === "NATIONAL_ACCESS_PRODUCTION_CREDENTIAL_BLOCKED" && error.status === 409
  );

  const sandboxCall = NationalAccessService.invokeDeveloperSandbox(credentialState, credential.secret, {
    packageId: "pkg-lab-imaging",
    contractId: "LIS_LAB_REPORT_PUBLISH",
    idempotencyKey: "lis-report-0001",
    payloadDigest: "9".repeat(64)
  }, { now: "2026-07-24T08:00:00.000Z" });
  assert.equal(sandboxCall.event.status, "accepted");
  assert.equal(sandboxCall.event.payloadIncluded, false);
  assert.equal(sandboxCall.event.dailyUsage, 1);
  assert.equal(sandboxCall.credential.usageCount, 1);

  const meteredState = {
    ...credentialState,
    nationalApiUsageEvents: [sandboxCall.event],
    nationalApiQuotaPolicies: credentialState.nationalApiQuotaPolicies.map((item) => (
      item.id === "quota-sandbox-default" ? { ...item, minuteLimit: 1 } : item
    ))
  };
  const replay = NationalAccessService.invokeDeveloperSandbox(meteredState, credential.secret, {
    packageId: "pkg-lab-imaging",
    contractId: "LIS_LAB_REPORT_PUBLISH",
    idempotencyKey: "lis-report-0001",
    payloadDigest: "9".repeat(64)
  }, { now: "2026-07-24T08:00:30.000Z" });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event.id, sandboxCall.event.id);
  assert.throws(
    () => NationalAccessService.invokeDeveloperSandbox(meteredState, credential.secret, {
      packageId: "pkg-lab-imaging",
      contractId: "LIS_LAB_REPORT_PUBLISH",
      idempotencyKey: "lis-report-0002",
      payloadDigest: "8".repeat(64)
    }, { now: "2026-07-24T08:00:30.000Z" }),
    (error) => error.code === "NATIONAL_ACCESS_MINUTE_QUOTA_EXCEEDED" && error.status === 429
  );

  const expiredCredential = {
    ...credential.entity,
    id: "expired-developer-key",
    expiresAt: "2026-07-23T00:00:00.000Z"
  };
  const securityEvaluation = NationalAccessService.evaluateSecurityLifecycle({
    ...state,
    nationalDeveloperCredentials: [expiredCredential]
  }, actor, { now: "2026-07-24T09:00:00.000Z" });
  assert.equal(securityEvaluation.credentials[0].status, "expired");
  assert.equal(securityEvaluation.alerts[0].severity, "critical");
  assert.equal(securityEvaluation.summary.productionReady, false);

  const certification = NationalAccessService.createCertificationReport(credentialState, {
    orgCode: "MR1",
    environment: "pilot"
  }, actor, { now: "2026-07-24T09:00:00.000Z" });
  assert.equal(certification.entity.status, "passed");
  assert.equal(certification.entity.score, 100);
  assert.equal(certification.entity.productionReady, false);
  assert.throws(
    () => NationalAccessService.createCertificationReport(credentialState, {
      orgCode: "MR1",
      environment: "production"
    }, actor),
    (error) => error.code === "NATIONAL_ACCESS_PRODUCTION_CERTIFICATION_BLOCKED" && error.status === 409
  );

  const unavailableProbe = NationalAccessService.recordNodeHealthProbe(state, {
    nodeId: "node-zhejiang",
    status: "unavailable",
    latencyMs: 0,
    detail: "primary node maintenance"
  }, actor);
  const failoverState = {
    ...state,
    nationalNodeHealthProbes: [unavailableProbe.entity, ...state.nationalNodeHealthProbes]
  };
  const route = NationalAccessService.planCrossProvinceRoute(failoverState, {
    sourceOrgCode: "MR1",
    targetOrgCode: "ZJ-H001",
    packageId: "pkg-lab-imaging",
    purpose: "authorized lab result query"
  }, actor);
  assert.equal(route.entity.status, "failover");
  assert.equal(route.entity.primaryTargetNodeId, "node-zhejiang");
  assert.equal(route.entity.targetNodeId, "node-zhejiang-dr");
  assert.deepEqual(route.entity.hops, ["node-liaoning", "node-national", "node-zhejiang-dr"]);

  const routedStateWithoutConsent = {
    ...failoverState,
    nationalRoutingTraces: [route.entity, ...state.nationalRoutingTraces]
  };
  const consent = NationalAccessService.createConsentAuthorization(routedStateWithoutConsent, {
    residentReference: "resident-token-consent-001",
    sourceOrgCode: "MR1",
    targetOrgCodes: ["ZJ-H001"],
    packageIds: ["pkg-lab-imaging"],
    contractIds: ["LIS_LAB_REPORT_PUBLISH"],
    purpose: route.entity.purpose,
    legalBasis: "resident-consent",
    evidenceDigest: "6".repeat(64),
    validUntil: new Date(Date.now() + 10 * 86_400_000).toISOString()
  }, actor);
  const routedState = {
    ...routedStateWithoutConsent,
    nationalConsentAuthorizations: [consent.entity]
  };
  const envelope = NationalAccessService.createRoutingEnvelope(routedState, {
    routeId: route.entity.id,
    contractId: "LIS_LAB_REPORT_PUBLISH",
    payloadDigest: "e".repeat(64),
    consentReference: consent.entity.reference
  }, actor);
  assert.equal(envelope.entity.status, "prepared");
  assert.equal(envelope.entity.payloadIncluded, false);
  assert.equal(envelope.entity.targetNodeId, "node-zhejiang-dr");
  assert.equal(envelope.entity.consentId, consent.entity.id);

  const revokedConsent = NationalAccessService.applyConsentAuthorizationAction(consent.entity, "revoke", actor);
  assert.throws(
    () => NationalAccessService.createRoutingEnvelope({
      ...routedState,
      nationalConsentAuthorizations: [revokedConsent.entity]
    }, {
      routeId: route.entity.id,
      contractId: "LIS_LAB_REPORT_PUBLISH",
      payloadDigest: "e".repeat(64),
      consentReference: consent.entity.reference
    }, actor),
    (error) => error.code === "NATIONAL_ACCESS_CONSENT_INACTIVE" && error.status === 409
  );

  const sdkManifest = NationalAccessService.buildDeveloperSdkManifest(credentialState, actor);
  assert.equal(sdkManifest.sdk.productionBlocked, true);
  assert.equal(sdkManifest.contracts.some((item) => item.id === "LIS_LAB_REPORT_PUBLISH"), true);
  assert.equal(sdkManifest.requestSchema.payloadIncluded, false);
  assert.deepEqual(sdkManifest.integrationSchema.requiredChecks, NationalAccessService.CONTRACT_TEST_CHECKS);
  assert.equal(sdkManifest.callbackSchema.productionDeliveryBlocked, true);

  const adapter = NationalAccessService.createIntegrationAdapter(state, {
    orgCode: "MR1",
    systemType: "LIS",
    name: "MR1 LIS pilot adapter",
    vendor: "Test vendor",
    systemVersion: "1.0",
    integrationMode: "signed-event-callback",
    environment: "pilot",
    endpointReference: "vault://national-access/mr1/lis/pilot",
    certificateId: "cert-inst-mr1-pilot",
    supportedContracts: ["LIS_LAB_REPORT_PUBLISH"],
    adapterConfigDigest: "1".repeat(64)
  }, actor);
  assert.equal(adapter.entity.status, "configured");
  assert.equal(adapter.entity.secretsIncluded, false);

  const failedTest = NationalAccessService.runContractConformanceTest({
    ...state,
    nationalIntegrationAdapters: [adapter.entity]
  }, adapter.entity.id, {
    contractId: "LIS_LAB_REPORT_PUBLISH",
    evidenceDigest: "2".repeat(64),
    results: { schemaValid: true }
  }, actor);
  assert.equal(failedTest.entity.status, "failed");
  assert.throws(
    () => NationalAccessService.applyIntegrationAdapterAction({
      ...state,
      nationalContractTestRuns: [failedTest.entity]
    }, adapter.entity, "verify", actor),
    (error) => error.code === "NATIONAL_ACCESS_ADAPTER_TESTS_INCOMPLETE" && error.status === 409
  );

  const passedTest = NationalAccessService.runContractConformanceTest({
    ...state,
    nationalIntegrationAdapters: [adapter.entity]
  }, adapter.entity.id, {
    contractId: "LIS_LAB_REPORT_PUBLISH",
    evidenceDigest: "3".repeat(64),
    results: Object.fromEntries(NationalAccessService.CONTRACT_TEST_CHECKS.map((check) => [check, true]))
  }, actor);
  assert.equal(passedTest.entity.status, "passed");
  const verifiedAdapter = NationalAccessService.applyIntegrationAdapterAction({
    ...state,
    nationalContractTestRuns: [passedTest.entity]
  }, adapter.entity, "verify", actor);
  assert.equal(verifiedAdapter.entity.status, "verified");

  const callback = NationalAccessService.createCallbackSubscription(state, {
    orgCode: "MR1",
    name: "MR1 integration callback",
    environment: "pilot",
    endpointReference: "vault://national-access/mr1/callback",
    eventTypes: ["contract-test.completed"],
    publicKeyFingerprint: "4".repeat(64)
  }, actor);
  const deliveries = NationalAccessService.createCallbackDeliveries({
    ...state,
    nationalCallbackSubscriptions: [callback.entity]
  }, {
    orgCode: "MR1",
    eventType: "contract-test.completed",
    subjectReference: passedTest.entity.id,
    eventDigest: passedTest.entity.evidenceDigest
  }, actor);
  assert.equal(deliveries.entities.length, 1);
  assert.equal(deliveries.entities[0].payloadIncluded, false);
  assert.equal(
    NationalAccessService.applyCallbackDeliveryAction(
      deliveries.entities[0],
      "acknowledge",
      { receiptDigest: "5".repeat(64), receiptCode: "MR1-ACK-001" },
      actor
    ).entity.status,
    "acknowledged"
  );

  const operations = NationalAccessService.evaluateOperations(routedState, actor, {
    now: new Date(Date.now() + 10 * 60_000).toISOString()
  });
  assert.equal(operations.summary.alerts > 0, true);
  assert.equal(operations.alerts.some((item) => item.targetId === "node-zhejiang" && item.severity === "critical"), true);
  assert.equal(operations.summary.failoverRoutes, 1);
  assert.equal(operations.summary.productionReady, false);

  const compatible = NationalAccessService.registerStandardExtension(state, {
    nodeId: "node-zhejiang",
    standardId: "std-routing-envelope",
    basedOnVersion: "1.0.0",
    extensionVersion: "1.0.0-zj.1",
    name: "Zhejiang routing extension",
    fields: ["CN-33.localPolicyCode"]
  }, actor);
  assert.equal(compatible.entity.status, "compatible");
  assert.equal(NationalAccessService.applyStandardExtensionAction(compatible.entity, "approve", actor).entity.status, "approved");

  const conflict = NationalAccessService.registerStandardExtension(state, {
    nodeId: "node-zhejiang",
    standardId: "std-routing-envelope",
    basedOnVersion: "0.9.0",
    extensionVersion: "0.9.0-zj.1",
    name: "Conflicting extension",
    fields: ["localPolicyCode"]
  }, actor);
  assert.equal(conflict.entity.status, "conflict");
  assert.equal(conflict.entity.conflictReasons.length, 2);
  assert.throws(
    () => NationalAccessService.applyStandardExtensionAction(conflict.entity, "approve", actor),
    (error) => error.code === "NATIONAL_ACCESS_STANDARD_EXTENSION_ACTION_INVALID" && error.status === 409
  );
});

test("national access JavaScript SDK sends metadata only and creates verifiable request helpers", async () => {
  let captured = null;
  const client = new NationalHealthAccessClient({
    baseUrl: "https://sandbox.example.test",
    apiKey: "nhp_test_only",
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 202,
        json: async () => ({ accepted: true })
      };
    }
  });

  const result = await client.invoke({
    packageId: "pkg-lab-imaging",
    contractId: "LIS_LAB_REPORT_PUBLISH",
    idempotencyKey: "sdk-test-0001",
    payloadDigest: "a".repeat(64),
    requestId: "hospital-request-001",
    clinicalPayload: { residentName: "must-not-leave-source-system" }
  });

  assert.equal(result.accepted, true);
  assert.equal(captured.url, "https://sandbox.example.test/api/national-access/sandbox/invoke");
  assert.equal(captured.options.headers["X-National-Access-Key"], "nhp_test_only");
  assert.deepEqual(Object.keys(captured.body).sort(), [
    "contractId",
    "idempotencyKey",
    "packageId",
    "payloadDigest",
    "requestId"
  ]);
  assert.match(client.createIdempotencyKey("lis report"), /^lis-report-/);
  assert.equal(
    await client.sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("national access API registers a node, certifies an institution and activates packages", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "national-access-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";

  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const commissionLogin = await login(baseUrl, "health");
  assert.equal(commissionLogin.response.status, 200);
  const commissionToken = commissionLogin.body.token;

  const initial = await api(baseUrl, "/api/national-access", authorized(commissionToken));
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.architecture.model, "1+N+M");
  assert.equal(initial.body.summary.crossProvinceLabSharingReady, true);

  const degradedHealth = await api(baseUrl, "/api/national-access/node-health", authorized(commissionToken, "POST", {
    nodeId: "node-zhejiang",
    status: "degraded",
    latencyMs: 420,
    detail: "跨省试点链路高延迟"
  }));
  assert.equal(degradedHealth.response.status, 201);

  const routePlan = await api(baseUrl, "/api/national-access/routes/plan", authorized(commissionToken, "POST", {
    sourceOrgCode: "MR1",
    targetOrgCode: "ZJ-H001",
    packageId: "pkg-lab-imaging",
    purpose: "检验报告跨省查询",
    residentReference: "demo-resident-token"
  }));
  assert.equal(routePlan.response.status, 201);
  assert.equal(routePlan.body.route.crossProvince, true);
  assert.equal(routePlan.body.route.status, "degraded");
  assert.deepEqual(routePlan.body.route.hops, ["node-liaoning", "node-national", "node-zhejiang"]);

  const nodeCreated = await api(baseUrl, "/api/national-access/nodes", authorized(commissionToken, "POST", {
    nodeCode: "CN-44",
    name: "广东省试点节点",
    nodeType: "provincial",
    regionCode: "44",
    capabilities: ["institution-gateway", "clinical-routing", "local-policy"]
  }));
  assert.equal(nodeCreated.response.status, 201);
  assert.equal(nodeCreated.body.node.status, "submitted");

  const nodeVerified = await api(
    baseUrl,
    `/api/national-access/nodes/${nodeCreated.body.node.id}/actions`,
    authorized(commissionToken, "POST", { action: "verify" })
  );
  assert.equal(nodeVerified.response.status, 200);
  assert.equal(nodeVerified.body.node.status, "verified");

  const nodeActivated = await api(
    baseUrl,
    `/api/national-access/nodes/${nodeCreated.body.node.id}/actions`,
    authorized(commissionToken, "POST", { action: "activate" })
  );
  assert.equal(nodeActivated.body.node.status, "active");

  const institutionCreated = await api(baseUrl, "/api/national-access/institutions", authorized(commissionToken, "POST", {
    orgCode: "GD-H001",
    nationalOrgCode: "CN-440100-H-001",
    name: "广东省试点综合医院",
    institutionType: "hospital",
    regionCode: "440100",
    nodeId: nodeCreated.body.node.id,
    accessMode: "provincial-node",
    requestedPackageIds: ["pkg-identity-basic", "pkg-lab-imaging"]
  }));
  assert.equal(institutionCreated.response.status, 201);

  const institutionId = institutionCreated.body.institution.id;
  for (const action of ["verify", "activate"]) {
    const result = await api(
      baseUrl,
      `/api/national-access/institutions/${institutionId}/actions`,
      authorized(commissionToken, "POST", { action })
    );
    assert.equal(result.response.status, 200);
  }

  const identitySubscription = await api(
    baseUrl,
    "/api/national-access/subscriptions",
    authorized(commissionToken, "POST", {
      orgCode: "GD-H001",
      packageId: "pkg-identity-basic",
      purpose: "统一机构身份和跨省路由认证"
    })
  );
  assert.equal(identitySubscription.response.status, 201);

  for (const action of ["approve", "activate"]) {
    const result = await api(
      baseUrl,
      `/api/national-access/subscriptions/${identitySubscription.body.subscription.id}/actions`,
      authorized(commissionToken, "POST", { action })
    );
    assert.equal(result.response.status, 200);
  }

  const labSubscription = await api(
    baseUrl,
    "/api/national-access/subscriptions",
    authorized(commissionToken, "POST", {
      orgCode: "GD-H001",
      packageId: "pkg-lab-imaging",
      environment: "sandbox",
      purpose: "跨省检验检查共享互认"
    })
  );
  assert.equal(labSubscription.response.status, 201);
  assert.equal(labSubscription.body.subscription.status, "requested");

  for (const action of ["approve", "activate"]) {
    const result = await api(
      baseUrl,
      `/api/national-access/subscriptions/${labSubscription.body.subscription.id}/actions`,
      authorized(commissionToken, "POST", { action })
    );
    assert.equal(result.response.status, 200);
  }

  const certificateIssued = await api(baseUrl, "/api/national-access/certificates", authorized(commissionToken, "POST", {
    subjectType: "institution",
    subjectId: institutionId,
    environment: "pilot",
    publicKeyFingerprint: "f".repeat(64)
  }));
  assert.equal(certificateIssued.response.status, 201);
  assert.equal(certificateIssued.body.certificate.status, "active");

  const credentialIssued = await api(baseUrl, "/api/national-access/credentials", authorized(commissionToken, "POST", {
    orgCode: "GD-H001",
    name: "Guangdong LIS pilot integration",
    environment: "pilot",
    scopes: ["pkg-identity-basic", "pkg-lab-imaging"]
  }));
  assert.equal(credentialIssued.response.status, 201);
  assert.match(credentialIssued.body.secret, /^nhp_/);
  assert.equal(Object.hasOwn(credentialIssued.body.credential, "secretHash"), false);

  const centerAfterCredential = await api(baseUrl, "/api/national-access", authorized(commissionToken));
  const storedCredential = centerAfterCredential.body.developerCredentials.find((item) => item.id === credentialIssued.body.credential.id);
  assert.ok(storedCredential);
  assert.equal(Object.hasOwn(storedCredential, "secretHash"), false);
  assert.equal(Object.hasOwn(storedCredential, "secret"), false);

  const credentialRotated = await api(
    baseUrl,
    `/api/national-access/credentials/${credentialIssued.body.credential.id}/actions`,
    authorized(commissionToken, "POST", { action: "rotate" })
  );
  assert.equal(credentialRotated.response.status, 200);
  assert.match(credentialRotated.body.secret, /^nhp_/);
  assert.notEqual(credentialRotated.body.secret, credentialIssued.body.secret);

  const sandboxPayload = {
    packageId: "pkg-lab-imaging",
    contractId: "LIS_LAB_REPORT_PUBLISH",
    idempotencyKey: "gd-lis-sandbox-0001",
    payloadDigest: "7".repeat(64)
  };
  const sandboxInvoked = await api(baseUrl, "/api/national-access/sandbox/invoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-National-Access-Key": credentialRotated.body.secret
    },
    body: JSON.stringify(sandboxPayload)
  });
  assert.equal(sandboxInvoked.response.status, 202);
  assert.equal(sandboxInvoked.body.duplicate, false);
  assert.equal(sandboxInvoked.body.usage.dailyUsage, 1);

  const sandboxReplay = await api(baseUrl, "/api/national-access/sandbox/invoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-National-Access-Key": credentialRotated.body.secret
    },
    body: JSON.stringify(sandboxPayload)
  });
  assert.equal(sandboxReplay.response.status, 200);
  assert.equal(sandboxReplay.body.duplicate, true);
  assert.equal(sandboxReplay.body.acknowledgement.acknowledgementId, sandboxInvoked.body.acknowledgement.acknowledgementId);

  const invalidSandboxKey = await api(baseUrl, "/api/national-access/sandbox/invoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-National-Access-Key": "nhp_invalid"
    },
    body: JSON.stringify({ ...sandboxPayload, idempotencyKey: "gd-lis-sandbox-0002" })
  });
  assert.equal(invalidSandboxKey.response.status, 401);
  assert.equal(invalidSandboxKey.body.error, "NATIONAL_ACCESS_DEVELOPER_KEY_INVALID");

  const wrongContractScope = await api(baseUrl, "/api/national-access/sandbox/invoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-National-Access-Key": credentialRotated.body.secret
    },
    body: JSON.stringify({
      ...sandboxPayload,
      packageId: "pkg-identity-basic",
      idempotencyKey: "gd-lis-sandbox-0003"
    })
  });
  assert.equal(wrongContractScope.response.status, 403);
  assert.equal(wrongContractScope.body.error, "NATIONAL_ACCESS_DEVELOPER_CONTRACT_FORBIDDEN");

  const nearExpiryCredential = await api(baseUrl, "/api/national-access/credentials", authorized(commissionToken, "POST", {
    orgCode: "MR1",
    name: "Near-expiry security evaluation key",
    environment: "sandbox",
    expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    scopes: ["pkg-identity-basic"]
  }));
  assert.equal(nearExpiryCredential.response.status, 201);

  const securityEvaluated = await api(baseUrl, "/api/national-access/security/evaluate", authorized(commissionToken, "POST", {}));
  assert.equal(securityEvaluated.response.status, 200);
  assert.equal(securityEvaluated.body.alerts.some((item) => (
    item.targetId === nearExpiryCredential.body.credential.id && item.severity === "critical"
  )), true);

  const gdHealth = await api(baseUrl, "/api/national-access/node-health", authorized(commissionToken, "POST", {
    nodeId: nodeCreated.body.node.id,
    status: "healthy",
    latencyMs: 88,
    detail: "certification readiness probe"
  }));
  assert.equal(gdHealth.response.status, 201);

  const certificationReport = await api(baseUrl, "/api/national-access/certification-reports", authorized(commissionToken, "POST", {
    orgCode: "GD-H001",
    environment: "pilot"
  }));
  assert.equal(certificationReport.response.status, 201);
  assert.equal(certificationReport.body.report.status, "passed", JSON.stringify(certificationReport.body.report.checklist));
  assert.equal(certificationReport.body.report.score, 100);
  assert.equal(certificationReport.body.report.productionReady, false);

  const operationalCenter = await api(baseUrl, "/api/national-access", authorized(commissionToken));
  assert.equal(operationalCenter.body.summary.apiCalls, 1);
  assert.equal(operationalCenter.body.summary.openSecurityAlerts > 0, true);
  assert.equal(operationalCenter.body.summary.validCertificationReports, 1);
  assert.equal(operationalCenter.body.apiUsageEvents[0].payloadIncluded, false);

  const routeForEnvelope = await api(baseUrl, "/api/national-access/routes/plan", authorized(commissionToken, "POST", {
    sourceOrgCode: "MR1",
    targetOrgCode: "ZJ-H001",
    packageId: "pkg-lab-imaging",
    purpose: "authorized LIS contract exchange",
    residentReference: "resident-token-002"
  }));
  assert.equal(routeForEnvelope.response.status, 201);

  const routeConsent = await api(baseUrl, "/api/national-access/consents", authorized(commissionToken, "POST", {
    residentReference: "resident-token-002",
    sourceOrgCode: "MR1",
    targetOrgCodes: ["ZJ-H001"],
    packageIds: ["pkg-lab-imaging"],
    contractIds: ["LIS_LAB_REPORT_PUBLISH"],
    purpose: routeForEnvelope.body.route.purpose,
    legalBasis: "resident-consent",
    evidenceDigest: "6".repeat(64),
    validUntil: new Date(Date.now() + 10 * 86_400_000).toISOString()
  }));
  assert.equal(routeConsent.response.status, 201);

  const envelopeCreated = await api(baseUrl, "/api/national-access/routes/envelopes", authorized(commissionToken, "POST", {
    routeId: routeForEnvelope.body.route.id,
    contractId: "LIS_LAB_REPORT_PUBLISH",
    payloadDigest: "a".repeat(64),
    consentReference: routeConsent.body.consent.reference
  }));
  assert.equal(envelopeCreated.response.status, 201);
  assert.equal(envelopeCreated.body.envelope.payloadIncluded, false);
  assert.equal(envelopeCreated.body.envelope.consentId, routeConsent.body.consent.id);

  const operationsEvaluated = await api(baseUrl, "/api/national-access/operations/evaluate", authorized(commissionToken, "POST", {}));
  assert.equal(operationsEvaluated.response.status, 200);
  assert.equal(operationsEvaluated.body.summary.alerts > 0, true);
  assert.equal(operationsEvaluated.body.alerts.some((item) => item.targetId === "node-zhejiang"), true);

  const compatibleExtension = await api(baseUrl, "/api/national-access/standards/extensions", authorized(commissionToken, "POST", {
    nodeId: nodeCreated.body.node.id,
    standardId: "std-routing-envelope",
    basedOnVersion: "1.0.0",
    extensionVersion: "1.0.0-gd.1",
    name: "Guangdong local routing extension",
    fields: ["CN-44.localPolicyCode"]
  }));
  assert.equal(compatibleExtension.response.status, 201);
  assert.equal(compatibleExtension.body.extension.status, "compatible");

  const extensionApproved = await api(
    baseUrl,
    `/api/national-access/standards/extensions/${compatibleExtension.body.extension.id}/actions`,
    authorized(commissionToken, "POST", { action: "approve" })
  );
  assert.equal(extensionApproved.response.status, 200);
  assert.equal(extensionApproved.body.extension.status, "approved");

  const conflictingExtension = await api(baseUrl, "/api/national-access/standards/extensions", authorized(commissionToken, "POST", {
    nodeId: nodeCreated.body.node.id,
    standardId: "std-routing-envelope",
    basedOnVersion: "0.9.0",
    extensionVersion: "0.9.0-gd.1",
    name: "Conflicting Guangdong extension",
    fields: ["localPolicyCode"]
  }));
  assert.equal(conflictingExtension.response.status, 201);
  assert.equal(conflictingExtension.body.extension.status, "conflict");

  const conflictApproval = await api(
    baseUrl,
    `/api/national-access/standards/extensions/${conflictingExtension.body.extension.id}/actions`,
    authorized(commissionToken, "POST", { action: "approve" })
  );
  assert.equal(conflictApproval.response.status, 409);
  assert.equal(conflictApproval.body.error, "NATIONAL_ACCESS_STANDARD_EXTENSION_ACTION_INVALID");

  const hospitalLogin = await login(baseUrl, "hospital");
  const hospitalToken = hospitalLogin.body.token;
  const scoped = await api(baseUrl, "/api/national-access", authorized(hospitalToken));
  assert.equal(scoped.response.status, 200);
  assert.deepEqual(scoped.body.institutions.map((item) => item.orgCode), ["MR1"]);
  assert.equal(scoped.body.audit.length, 0);
  assert.equal(scoped.body.routingTraces.some((item) => item.sourceOrgCode === "MR1"), true);

  const institutionRoute = await api(baseUrl, "/api/national-access/routes/plan", authorized(hospitalToken, "POST", {
    sourceOrgCode: "MR1",
    targetOrgCode: "ZJ-H001",
    packageId: "pkg-lab-imaging",
    purpose: "本机构跨省检验查询"
  }));
  assert.equal(institutionRoute.response.status, 201);

  const ownCredential = await api(baseUrl, "/api/national-access/credentials", authorized(hospitalToken, "POST", {
    orgCode: "MR1",
    name: "Hospital-owned LIS key",
    environment: "sandbox",
    scopes: ["pkg-identity-basic", "pkg-lab-imaging"]
  }));
  assert.equal(ownCredential.response.status, 201);
  assert.match(ownCredential.body.secret, /^nhp_/);

  const sdkManifest = await api(baseUrl, "/api/national-access/sdk/manifest", authorized(hospitalToken));
  assert.equal(sdkManifest.response.status, 200);
  assert.equal(sdkManifest.body.sdk.productionBlocked, true);
  assert.equal(sdkManifest.body.contracts.some((item) => item.id === "SHARED_RESULT_QUERY"), true);
  assert.equal(sdkManifest.body.integrationSchema.secretsAccepted, false);

  const ownCallback = await api(baseUrl, "/api/national-access/callbacks", authorized(hospitalToken, "POST", {
    orgCode: "MR1",
    name: "MR1 pilot callback",
    environment: "pilot",
    endpointReference: "vault://national-access/mr1/callback",
    eventTypes: ["routing-envelope.prepared", "consent.revoked", "contract-test.completed"],
    publicKeyFingerprint: "7".repeat(64)
  }));
  assert.equal(ownCallback.response.status, 201);
  assert.equal(ownCallback.body.callback.productionReady, false);

  const ownAdapter = await api(baseUrl, "/api/national-access/adapters", authorized(hospitalToken, "POST", {
    orgCode: "MR1",
    systemType: "LIS",
    name: "MR1 LIS adapter",
    vendor: "Pilot vendor",
    systemVersion: "2026.1",
    integrationMode: "signed-event-callback",
    environment: "pilot",
    endpointReference: "vault://national-access/mr1/lis/pilot",
    certificateId: "cert-inst-mr1-pilot",
    supportedContracts: ["LIS_LAB_REPORT_PUBLISH"],
    adapterConfigDigest: "8".repeat(64)
  }));
  assert.equal(ownAdapter.response.status, 201);
  assert.equal(ownAdapter.body.adapter.status, "configured");

  const ownContractTest = await api(
    baseUrl,
    `/api/national-access/adapters/${ownAdapter.body.adapter.id}/contract-tests`,
    authorized(hospitalToken, "POST", {
      contractId: "LIS_LAB_REPORT_PUBLISH",
      evidenceDigest: "9".repeat(64),
      results: Object.fromEntries(NationalAccessService.CONTRACT_TEST_CHECKS.map((check) => [check, true]))
    })
  );
  assert.equal(ownContractTest.response.status, 201);
  assert.equal(ownContractTest.body.contractTest.status, "passed");
  assert.equal(ownContractTest.body.callbackDeliveries.length, 1);

  const forbiddenSelfVerify = await api(
    baseUrl,
    `/api/national-access/adapters/${ownAdapter.body.adapter.id}/actions`,
    authorized(hospitalToken, "POST", { action: "verify" })
  );
  assert.equal(forbiddenSelfVerify.response.status, 403);
  assert.equal(forbiddenSelfVerify.body.error, "NATIONAL_ACCESS_ADAPTER_VERIFY_FORBIDDEN");

  const verifiedOwnAdapter = await api(
    baseUrl,
    `/api/national-access/adapters/${ownAdapter.body.adapter.id}/actions`,
    authorized(commissionToken, "POST", { action: "verify" })
  );
  assert.equal(verifiedOwnAdapter.response.status, 200);
  assert.equal(verifiedOwnAdapter.body.adapter.status, "verified");

  const acknowledgedContractTest = await api(
    baseUrl,
    `/api/national-access/callback-deliveries/${ownContractTest.body.callbackDeliveries[0].id}/actions`,
    authorized(hospitalToken, "POST", {
      action: "acknowledge",
      receiptDigest: "a".repeat(64),
      receiptCode: "MR1-CONTRACT-ACK-001"
    })
  );
  assert.equal(acknowledgedContractTest.response.status, 200);
  assert.equal(acknowledgedContractTest.body.callbackDelivery.status, "acknowledged");

  const ownConsent = await api(baseUrl, "/api/national-access/consents", authorized(hospitalToken, "POST", {
    residentReference: "resident-token-hospital-001",
    sourceOrgCode: "MR1",
    targetOrgCodes: ["ZJ-H001"],
    packageIds: ["pkg-lab-imaging"],
    contractIds: ["SHARED_RESULT_QUERY"],
    purpose: institutionRoute.body.route.purpose,
    legalBasis: "resident-consent",
    evidenceDigest: "5".repeat(64),
    validUntil: new Date(Date.now() + 10 * 86_400_000).toISOString()
  }));
  assert.equal(ownConsent.response.status, 201);

  const ownEnvelope = await api(baseUrl, "/api/national-access/routes/envelopes", authorized(hospitalToken, "POST", {
    routeId: institutionRoute.body.route.id,
    contractId: "SHARED_RESULT_QUERY",
    payloadDigest: "b".repeat(64),
    consentReference: ownConsent.body.consent.reference
  }));
  assert.equal(ownEnvelope.response.status, 201);
  assert.equal(ownEnvelope.body.envelope.sourceOrgCode, "MR1");
  assert.equal(ownEnvelope.body.callbackDeliveries.length, 1);

  const forbiddenConsent = await api(baseUrl, "/api/national-access/consents", authorized(hospitalToken, "POST", {
    residentReference: "resident-token-forbidden",
    sourceOrgCode: "ZJ-H001",
    targetOrgCodes: ["MR1"],
    packageIds: ["pkg-lab-imaging"],
    contractIds: ["SHARED_RESULT_QUERY"],
    purpose: "cross-tenant attempt",
    legalBasis: "resident-consent",
    evidenceDigest: "4".repeat(64),
    validUntil: new Date(Date.now() + 10 * 86_400_000).toISOString()
  }));
  assert.equal(forbiddenConsent.response.status, 403);

  const revokedOwnConsent = await api(
    baseUrl,
    `/api/national-access/consents/${ownConsent.body.consent.id}/actions`,
    authorized(hospitalToken, "POST", { action: "revoke" })
  );
  assert.equal(revokedOwnConsent.response.status, 200);
  assert.equal(revokedOwnConsent.body.consent.status, "revoked");
  assert.equal(revokedOwnConsent.body.callbackDeliveries.length, 1);

  const blockedByRevokedConsent = await api(baseUrl, "/api/national-access/routes/envelopes", authorized(hospitalToken, "POST", {
    routeId: institutionRoute.body.route.id,
    contractId: "SHARED_RESULT_QUERY",
    payloadDigest: "c".repeat(64),
    consentReference: ownConsent.body.consent.reference
  }));
  assert.equal(blockedByRevokedConsent.response.status, 409);
  assert.equal(blockedByRevokedConsent.body.error, "NATIONAL_ACCESS_CONSENT_INACTIVE");

  const forbiddenCredential = await api(baseUrl, "/api/national-access/credentials", authorized(hospitalToken, "POST", {
    orgCode: "ZJ-H001",
    name: "Cross-tenant key",
    environment: "sandbox",
    scopes: ["pkg-identity-basic"]
  }));
  assert.equal(forbiddenCredential.response.status, 403);
  assert.equal(forbiddenCredential.body.error, "NATIONAL_ACCESS_SCOPE_FORBIDDEN");

  const forbiddenCertificate = await api(baseUrl, "/api/national-access/certificates", authorized(hospitalToken, "POST", {
    subjectType: "institution",
    subjectId: institutionId,
    environment: "sandbox",
    publicKeyFingerprint: "c".repeat(64)
  }));
  assert.equal(forbiddenCertificate.response.status, 403);

  const forbiddenNode = await api(baseUrl, "/api/national-access/nodes", authorized(hospitalToken, "POST", {
    nodeCode: "CN-99",
    name: "越权节点",
    nodeType: "regional",
    regionCode: "99"
  }));
  assert.equal(forbiddenNode.response.status, 403);

  const forbiddenOtherOrg = await api(baseUrl, "/api/national-access/subscriptions", authorized(hospitalToken, "POST", {
    orgCode: "ZJ-H001",
    packageId: "pkg-health-record"
  }));
  assert.equal(forbiddenOtherOrg.response.status, 403);
  assert.equal(forbiddenOtherOrg.body.error, "NATIONAL_ACCESS_SCOPE_FORBIDDEN");
});
