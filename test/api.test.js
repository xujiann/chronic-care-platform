const assert = require("node:assert/strict");
const { createHmac, pbkdf2Sync } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function login(baseUrl, username, password = "123456") {
  return api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

function authorized(token, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

function passwordHash(password, salt = "test-salt", iterations = 120_000) {
  return `pbkdf2-sha256$${iterations}$${salt}$${pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function integrationSignature(payload) {
  return createHmac("sha256", "health-platform-demo-integration-secret").update(stableStringify(payload)).digest("hex");
}

test("API authentication, scoping and governance regression suite", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-test-"));
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.accounts[0].name = "Needs normalization?";
  fixture.authUsers.push({
    id: "u-hashed-test",
    username: "hashed_commission",
    name: "哈希账号",
    role: "commission",
    roleName: "哈希认证测试账号",
    orgCode: "ORG-HEALTH-DL",
    orgName: "大连市卫生健康委",
    orgType: "health_admin",
    dataScope: "测试",
    home: "index.html",
    status: "启用",
    passwordHash: passwordHash("hashed-pass")
  });
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(fixture, null, 2), "utf8");

  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const health = await waitForHealth(baseUrl);
  assert.equal(health.ok, true);
  assert.equal(health.storage.engine, "json");

  await t.test("keeps health, authentication and error response contracts stable", async () => {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.match(healthResponse.headers.get("content-type") || "", /^application\/json/);
    const healthBody = await healthResponse.json();
    assert.deepEqual(Object.keys(healthBody).sort(), ["ok", "service", "storage"]);
    assert.equal(healthBody.service.name, "chronic-care-platform");
    assert.equal(typeof healthBody.service.version, "string");
    assert.equal(typeof healthBody.service.uptimeSeconds, "number");
    assert.equal(typeof healthBody.storage.mode, "string");
    assert.equal(typeof healthBody.storage.jsonFile, "string");

    const accountLogin = await login(baseUrl, "health");
    assert.equal(typeof accountLogin.body.token, "string");
    assert.equal(accountLogin.body.token.split(".").length, 4);
    assert.equal(typeof accountLogin.body.expiresAt, "string");
    assert.equal(accountLogin.body.user.username, "health");
    assert.equal(accountLogin.body.user.password, undefined);
    assert.equal(accountLogin.body.user.passwordHash, undefined);

    const missing = await api(baseUrl, "/api/not-found", authorized(accountLogin.body.token));
    assert.equal(missing.response.status, 404);
    assert.equal(typeof missing.body.error, "string");

    const metrics = await api(baseUrl, "/api/metrics", authorized(accountLogin.body.token));
    assert.equal(metrics.response.status, 200);
    assert.equal(metrics.body.service.name, "chronic-care-platform");
    assert.equal(metrics.body.http.apiRequests >= 1, true);
    assert.equal(typeof metrics.body.workload.unifiedTasks, "number");
    assert.equal(typeof metrics.body.workload.dataQualityIssues, "number");

    const readiness = await api(baseUrl, "/api/system/readiness", authorized(accountLogin.body.token));
    assert.equal(readiness.response.status, 200);
    assert.equal(readiness.body.passed, true);
    assert.equal(readiness.body.p2Collections.researchDatasets >= 2, true);
    assert.equal(readiness.body.checks.some((item) => item.id === "acceptance-evidence" && item.passed), true);
    assert.equal(readiness.body.checks.some((item) => item.id === "security-acceptance" && item.passed), true);
    assert.equal(readiness.body.securityAcceptanceLedger.length >= 4, true);
    assert.equal(readiness.body.checks.some((item) => item.id === "production-deployment-plan" && item.passed), true);
    assert.equal(readiness.body.productionDeploymentPlan.some((item) => item.id === "prod-identity-adapter"), true);
    assert.equal(Array.isArray(readiness.body.productionEnvironment.checks), true);
    assert.equal(readiness.body.productionEnvironment.checks.some((item) => item.id === "identity-adapter"), true);
    assert.equal(readiness.body.productionEnvironment.checks.some((item) => item.id === "site-interface-signoff"), true);
    assert.equal(readiness.body.productionEnvironment.checks.some((item) => item.id === "dr-rehearsal-signoff"), true);
    assert.equal(readiness.body.checks.some((item) => item.id === "interface-readiness" && item.passed), true);
    assert.equal(readiness.body.checks.some((item) => item.id === "release-artifact-manifest" && item.passed), true);
    assert.equal(readiness.body.releaseArtifactManifest.summary.artifacts >= 16, true);
    assert.equal(readiness.body.interfaceReadiness.p0Total >= 4, true);
    assert.equal(readiness.body.interfaceReadiness.rows.some((item) => item.id === "if-medical" && item.status === "演示对接完成" && item.externalBlocked), true);
    assert.equal(readiness.body.checks.some((item) => item.id === "audit-chain" && item.passed), true);
    assert.equal(readiness.body.externalDependencies.some((item) => item.id === "identity-source" && item.severity === "high"), true);
    assert.equal(readiness.body.externalDependencies.some((item) => item.id === "institution-systems" && item.nextAction), true);
    assert.equal(readiness.body.externalDependencySummary.total, readiness.body.externalDependencies.length);
    assert.equal(readiness.body.externalDependencySummary.high >= 3, true);

    const processAudit = await api(baseUrl, "/api/process-audit", authorized(accountLogin.body.token));
    assert.equal(processAudit.response.status, 200);
    assert.equal(processAudit.body.ok, true);
    assert.equal(processAudit.body.evidenceDomains.some((item) => item.id === "chronic-care" && item.passed), true);
    assert.equal(processAudit.body.evidenceDomains.some((item) => item.id === "county-consortium" && item.passed), true);

    const serviceAcceptance = await api(baseUrl, "/api/service-acceptance-summary", authorized(accountLogin.body.token));
    assert.equal(serviceAcceptance.response.status, 200);
    assert.equal(serviceAcceptance.body.ok, true);
    assert.equal(serviceAcceptance.body.serviceAcceptance.chronic.openActions.some((item) => item.id === "cst-001"), true);
    assert.equal(serviceAcceptance.body.serviceAcceptance.county.openActions.some((item) => item.id === "cco-001"), true);
    assert.equal(serviceAcceptance.body.serviceAcceptance.chronic.openActions.find((item) => item.id === "cst-001").priority, "high");

    const sitePack = await api(baseUrl, "/api/site-readiness-pack", authorized(accountLogin.body.token));
    assert.equal(sitePack.response.status, 200);
    assert.equal(sitePack.body.ok, true);
    assert.equal(sitePack.body.templates.identity.some((item) => item.field === "sub"), true);
    assert.equal(sitePack.body.templates.signoff.some((item) => item.id === "signoff-cutover-monitoring"), true);

    const templateReadmes = await api(baseUrl, "/api/site-template-readmes", authorized(accountLogin.body.token));
    assert.equal(templateReadmes.response.status, 200);
    assert.equal(templateReadmes.body.ok, true);
    assert.equal(templateReadmes.body.summary.readmes, 4);
    assert.equal(templateReadmes.body.readmes.some((item) => item.file === "release/templates/identity-source-mapping/README.md"), true);
    assert.equal(templateReadmes.body.readmes.every((item) => item.content.includes("Current implementation coverage")), true);

    const releaseReport = await api(baseUrl, "/api/release-report", authorized(accountLogin.body.token));
    assert.equal(releaseReport.response.status, 200);
    assert.equal(releaseReport.body.ok, true);
    assert.equal(releaseReport.body.checks.some((item) => item.name === "sitePack:readiness" && item.passed), true);
    assert.equal(releaseReport.body.siteReadinessPack.templates.signoff.some((item) => item.id === "signoff-cutover-monitoring"), true);

    const cutoverChecklist = await api(baseUrl, "/api/production-cutover-checklist", authorized(accountLogin.body.token));
    assert.equal(cutoverChecklist.response.status, 200);
    assert.equal(cutoverChecklist.body.ok, false);
    assert.equal(cutoverChecklist.body.summary.blocked >= 1, true);
    assert.equal(cutoverChecklist.body.checklist.some((item) => item.id === "cutover-monitoring"), true);

    const releaseManifest = await api(baseUrl, "/api/release-artifact-manifest", authorized(accountLogin.body.token));
    assert.equal(releaseManifest.response.status, 200);
    assert.equal(releaseManifest.body.ok, true);
    assert.equal(releaseManifest.body.artifacts.some((item) => item.id === "release-artifact-manifest"), true);
    assert.equal(releaseManifest.body.templateReadmes.some((item) => item.file === "release/templates/production-signoff/README.md"), true);

    const managementFunctions = await api(baseUrl, "/api/interoperability/management-functions", authorized(accountLogin.body.token));
    assert.equal(managementFunctions.response.status, 200);
    assert.equal(managementFunctions.body.ok, true);
    assert.equal(managementFunctions.body.summary.total >= 6, true);
    assert.equal(managementFunctions.body.functions.some((item) => item.id === "mgmt-medical-quality" && item.ready), true);
    assert.equal(managementFunctions.body.functions.some((item) => item.id === "mgmt-public-health" && item.sourceSystems.length >= 4), true);

    const identityPreview = await api(baseUrl, "/api/auth/identity/preview", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        claims: {
          sub: "oidc-doctor-001",
          preferred_username: "external_doctor",
          name: "外部医生",
          org_code: "MR1",
          roles: ["doctor"]
        }
      })
    }));
    assert.equal(identityPreview.response.status, 200);
    assert.equal(identityPreview.body.mapping.user.role, "institution");
    assert.equal(identityPreview.body.mapping.user.orgCode, "MR1");
    assert.equal(identityPreview.body.mapping.user.home, "institution.html");
  });

  await t.test("rejects invalid credentials and unauthenticated state reads", async () => {
    const badLogin = await login(baseUrl, "health", "wrong-password");
    assert.equal(badLogin.response.status, 401);

    const state = await api(baseUrl, "/api/state");
    assert.equal(state.response.status, 401);

    const hashedLogin = await login(baseUrl, "hashed_commission", "hashed-pass");
    assert.equal(hashedLogin.response.status, 200);
    assert.equal(hashedLogin.body.user.passwordHash, undefined);
    const badHashedLogin = await login(baseUrl, "hashed_commission", "123456");
    assert.equal(badHashedLogin.response.status, 401);

    const tamperedToken = `${hashedLogin.body.token.slice(0, -1)}x`;
    const tamperedState = await api(baseUrl, "/api/state", authorized(tamperedToken));
    assert.equal(tamperedState.response.status, 401);
  });

  await t.test("authenticates every documented role and scopes management collections", async () => {
    const accounts = [
      ["city", "commission"], ["district", "commission"], ["health", "commission"], ["whjw", "commission"],
      ["hospital", "institution"], ["community", "institution"], ["doctor", "institution"], ["doctor_wang", "institution"],
      ["mi", "insurance"], ["insurance", "insurance"], ["district_mi", "insurance"],
      ["citizen", "citizen"], ["county", "county"]
    ];
    for (const [username, role] of accounts) {
      const accountLogin = await login(baseUrl, username);
      assert.equal(accountLogin.response.status, 200, `${username} 应可登录`);
      assert.equal(accountLogin.body.user.role, role);
      const scopedState = await api(baseUrl, "/api/state", authorized(accountLogin.body.token));
      assert.equal(scopedState.response.status, 200);
      if (role !== "commission") {
        assert.equal(scopedState.body.applicationCatalog, undefined, `${username} 不应读取平台建设目录`);
        assert.equal(scopedState.body.securityAcceptanceLedger, undefined, `${username} 不应读取安全验收台账`);
        assert.equal(scopedState.body.productionDeploymentPlan, undefined, `${username} should not read production deployment plan`);
        assert.equal(scopedState.body.hospitalInteroperabilityFunctions, undefined, `${username} should not read hospital interoperability management functions`);
      }
    }
  });

  const commissionLogin = await login(baseUrl, "health");
  assert.equal(commissionLogin.response.status, 200);
  const commissionToken = commissionLogin.body.token;

  await t.test("returns governance modules to the commission role and repairs seeded text", async () => {
    const { response, body } = await api(baseUrl, "/api/state", authorized(commissionToken));
    assert.equal(response.status, 200);
    assert.equal(body.accounts[0].name, "演示居民A账户");
    assert.equal(body.residents[0].idCard, "DEMO-ID-R1");
    assert.equal(body.residents[0].phone, "DEMO-MOBILE-R1");
    assert.equal(body.applicationCatalog.length, 6);
    assert.equal(body.hospitalInteroperabilityFunctions.length, 6);
    assert.equal(body.institutionCreditEvaluations.length, 3);
    assert.equal(body.securityAcceptanceLedger.length, 4);
    assert.equal(body.productionDeploymentPlan.length, 4);
    ["residents", "personalRecords", "platformEvidence", "productionDeploymentPlan", "applicationCatalog", "hospitalInteroperabilityFunctions", "institutionCreditEvaluations", "securityAcceptanceLedger"].forEach((key) => {
      assert.ok(Array.isArray(body[key]), `${key} should keep array contract`);
    });
  });

  const citizenLogin = await login(baseUrl, "citizen");
  assert.equal(citizenLogin.response.status, 200);
  const citizenToken = citizenLogin.body.token;

  await t.test("scopes citizen state to household members and hides management data", async () => {
    const { response, body } = await api(baseUrl, "/api/state", authorized(citizenToken));
    assert.equal(response.status, 200);
    assert.deepEqual(body.residents.map((item) => item.id).sort(), ["r1", "r4"]);
    assert.match(body.residents[0].idCard, /^已脱敏-/);
    assert.match(body.residents[0].phone, /^已脱敏-/);
    assert.match(body.residents[0].address, /^已脱敏-/);
    assert.match(body.residents[0].personIndex, /^已脱敏-/);
    assert.notEqual(body.digitalCredentials[0].credentialNo, "MI-DEMO-MOBILE-R1");
    [
      "authUsers",
      "authOrganizations",
      "securityEvents",
      "platformAudit",
      "platformProcessAudit",
      "productionDeploymentPlan",
      "applicationCatalog",
      "hospitalInteroperabilityFunctions",
      "institutionCreditEvaluations",
      "securityAcceptanceLedger"
    ].forEach((key) => assert.equal(body[key], undefined, `${key} 不应返回给居民端`));
  });

  await t.test("enforces personal record ownership and protects record identity", async () => {
    const ownRecords = await api(baseUrl, "/api/personal-records?residentId=r1", authorized(citizenToken));
    assert.equal(ownRecords.response.status, 200);
    assert.ok(Array.isArray(ownRecords.body));
    assert.match(ownRecords.body[0].personIndex, /^已脱敏-/);

    const otherRecords = await api(baseUrl, "/api/personal-records?residentId=r2", authorized(citizenToken));
    assert.equal(otherRecords.response.status, 403);

    const created = await api(baseUrl, "/api/personal-records", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ id: "client-controlled-id", residentId: "r1", category: "self-upload", name: "居民自测记录", result: "正常" })
    }));
    assert.equal(created.response.status, 201);
    assert.notEqual(created.body.id, "client-controlled-id");
    assert.equal(created.body.residentId, "r1");

    const patched = await api(baseUrl, `/api/personal-records/${created.body.id}`, authorized(citizenToken, {
      method: "PATCH",
      body: JSON.stringify({ id: "tampered", residentId: "r2", result: "已复核", meta: { sourceTrust: "居民确认" } })
    }));
    assert.equal(patched.response.status, 200);
    assert.equal(patched.body.id, created.body.id);
    assert.equal(patched.body.residentId, "r1");
    assert.equal(patched.body.result, "已复核");
    assert.equal(patched.body.meta.sourceTrust, "居民确认");

    const forbiddenCreate = await api(baseUrl, "/api/personal-records", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r2", category: "self-upload", name: "越权记录" })
    }));
    assert.equal(forbiddenCreate.response.status, 403);
  });

  await t.test("supports authorization revocation and access history review", async () => {
    const authorizations = await api(baseUrl, "/api/personal-records?residentId=r1&category=authorizations", authorized(citizenToken));
    assert.equal(authorizations.response.status, 200);
    assert.ok(authorizations.body.length > 0);
    const authorizationId = authorizations.body[0].id;

    const revoked = await api(baseUrl, `/api/authorizations/${authorizationId}/revoke`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ reason: "居民主动撤销测试授权" })
    }));
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.status, "已撤销");
    assert.equal(revoked.body.revokeReason, "居民主动撤销测试授权");

    const review = await api(baseUrl, "/api/access-reviews?residentId=r1", authorized(citizenToken));
    assert.equal(review.response.status, 200);
    assert.equal(review.body.authorizations.some((item) => item.id === authorizationId && item.status === "已撤销"), true);
    assert.equal(review.body.accessLogs.some((item) => item.scope === "授权撤销"), true);
    assert.match(review.body.accessLogs[0].personIndex, /^已脱敏-/);

    const forbiddenReview = await api(baseUrl, "/api/access-reviews?residentId=r2", authorized(citizenToken));
    assert.equal(forbiddenReview.response.status, 403);
  });

  await t.test("enforces certificate roles and resident scope", async () => {
    const ownBirth = await api(baseUrl, "/api/birth-certificates?residentId=r1", authorized(citizenToken));
    assert.equal(ownBirth.response.status, 200);
    assert.ok(ownBirth.body.certificates.every((item) => item.maternalResidentId === "r1" || item.residentId === "r1"));
    assert.match(ownBirth.body.certificates[0].certificateNo, /^已脱敏-/);
    assert.match(ownBirth.body.certificates[0].motherDocumentNo, /^已脱敏-/);

    const otherBirth = await api(baseUrl, "/api/birth-certificates?residentId=r2", authorized(citizenToken));
    assert.equal(otherBirth.response.status, 403);

    const citizenBirthWrite = await api(baseUrl, "/api/birth-certificates", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ maternalResidentId: "r1", newbornName: "测试新生儿" })
    }));
    assert.equal(citizenBirthWrite.response.status, 403);

    const citizenDeathRead = await api(baseUrl, "/api/death-certificates?residentId=r1", authorized(citizenToken));
    assert.equal(citizenDeathRead.response.status, 403);

    const institution = await login(baseUrl, "hospital");
    const birthCreated = await api(baseUrl, "/api/birth-certificates", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ maternalResidentId: "r1", certificateNo: "BC-TEST-001", newbornName: "测试新生儿", newbornGender: "女" })
    }));
    assert.equal(birthCreated.response.status, 201);
    assert.equal(birthCreated.body.maternalResidentId, "r1");
    assert.equal(birthCreated.body.createdBy, "hospital");

    const deathCreated = await api(baseUrl, "/api/death-certificates", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", certificateNo: "DC-TEST-001", immediateCause: "测试原因", underlyingCause: "测试基础疾病" })
    }));
    assert.equal(deathCreated.response.status, 201);
    assert.equal(deathCreated.body.residentId, "r1");
    assert.equal(deathCreated.body.createdBy, "hospital");
  });

  await t.test("rejects citizen writes to commission state and statistics APIs", async () => {
    const stateWrite = await api(baseUrl, "/api/state", authorized(citizenToken, {
      method: "PUT",
      body: JSON.stringify({ residents: [] })
    }));
    assert.equal(stateWrite.response.status, 403);

    const statisticsWrite = await api(baseUrl, "/api/health-statistics/import-jobs", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ name: "越权任务" })
    }));
    assert.equal(statisticsWrite.response.status, 403);

    const workflowWrite = await api(baseUrl, "/api/workflow-actions", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ collection: "insuranceClaims", id: "ic1", status: "已通过" })
    }));
    assert.equal(workflowWrite.response.status, 403);
  });

  await t.test("accepts signed idempotent integration gateway events", async () => {
    const institution = await login(baseUrl, "hospital");
    const contracts = await api(baseUrl, "/api/integration/contracts", authorized(institution.body.token));
    assert.equal(contracts.response.status, 200);
    assert.equal(contracts.body.contracts.some((item) => item.id === "his-patient-v1"), true);

    const samples = await api(baseUrl, "/api/integration/samples?contractId=his-patient-v1", authorized(institution.body.token));
    assert.equal(samples.response.status, 200);
    assert.equal(samples.body.samples.length, 1);
    assert.equal(samples.body.samples[0].payload.contractId, "his-patient-v1");
    assert.equal(samples.body.samples[0].signature, integrationSignature(samples.body.samples[0].payload));

    const eventPayload = {
      contractId: "his-patient-v1",
      idempotencyKey: "his-r1-visit-001",
      externalId: "HIS-VISIT-001",
      residentId: "r1",
      institution: "大连市中心医院",
      visitedAt: "2026-06-21T10:00:00.000Z",
      payload: { diagnosis: "高血压复诊" }
    };
    const unsigned = await api(baseUrl, "/api/integration/events", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify(eventPayload)
    }));
    assert.equal(unsigned.response.status, 401);

    const accepted = await api(baseUrl, "/api/integration/events", authorized(institution.body.token, {
      method: "POST",
      headers: { "x-integration-signature": integrationSignature(eventPayload) },
      body: JSON.stringify(eventPayload)
    }));
    assert.equal(accepted.response.status, 202);
    assert.equal(accepted.body.contractId, "his-patient-v1");
    assert.equal(accepted.body.idempotencyKey, "his-r1-visit-001");
    assert.equal(accepted.body.reconciliationStatus, "待对账");

    const replay = await api(baseUrl, "/api/integration/events", authorized(institution.body.token, {
      method: "POST",
      headers: { "x-integration-signature": integrationSignature(eventPayload) },
      body: JSON.stringify(eventPayload)
    }));
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.id, accepted.body.id);
    assert.equal(replay.body.idempotentReplay, true);

    const commission = await login(baseUrl, "health");
    const retry = await api(baseUrl, `/api/integration/events/${accepted.body.id}/retry`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "upstream-timeout" })
    }));
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.status, "retrying");
    assert.equal(retry.body.retryCount, 1);
    assert.equal(retry.body.deadLetter, false);

    const deadLetter = await api(baseUrl, `/api/integration/events/${accepted.body.id}/dead-letter`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "schema-mapping-failed" })
    }));
    assert.equal(deadLetter.response.status, 200);
    assert.equal(deadLetter.body.status, "failed");
    assert.equal(deadLetter.body.deadLetter, true);
    assert.equal(deadLetter.body.deadLetterReason, "schema-mapping-failed");

    const monitor = await api(baseUrl, "/api/integration/monitor", authorized(commission.body.token));
    assert.equal(monitor.response.status, 200);
    assert.equal(monitor.body.summary.total >= 1, true);
    assert.equal(monitor.body.summary.deadLetters >= 1, true);
    assert.equal(monitor.body.summary.byStatus.failed >= 1, true);

    const simulated = await api(baseUrl, "/api/integration/simulate", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ contractId: "insurance-settlement-v1", sequence: 7 })
    }));
    assert.equal(simulated.response.status, 202);
    assert.equal(simulated.body.event.contractId, "insurance-settlement-v1");
    assert.equal(simulated.body.event.simulated, true);
    assert.equal(simulated.body.sample.signature, integrationSignature(simulated.body.sample.payload));

    const simulatedReplay = await api(baseUrl, "/api/integration/simulate", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ contractId: "insurance-settlement-v1", sequence: 7 })
    }));
    assert.equal(simulatedReplay.response.status, 200);
    assert.equal(simulatedReplay.body.event.id, simulated.body.event.id);
    assert.equal(simulatedReplay.body.event.idempotentReplay, true);
  });

  await t.test("closes mutual recognition report callback into resident records", async () => {
    const county = await login(baseUrl, "county");
    const rules = await api(baseUrl, "/api/mutual-recognition/rules", authorized(county.body.token));
    assert.equal(rules.response.status, 200);
    assert.equal(rules.body.rules.some((item) => item.id === "mrr-hba1c-001"), true);

    const report = await api(baseUrl, "/api/mutual-recognition/reports", authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({
        externalId: "LIS-CALLBACK-001",
        residentId: "r2",
        item: "HbA1c",
        category: "lab",
        sourceInstitution: "Wafangdian Central Hospital",
        targetInstitution: "Dalian Medical University Hospital",
        result: "6.7%",
        conclusion: "HbA1c follow-up result returned from county lab center.",
        qualityStatus: "passed",
        reportedAt: "2026-06-21T12:00:00.000Z"
      })
    }));
    assert.equal(report.response.status, 201);
    assert.equal(report.body.report.status, "recognized");
    assert.equal(report.body.report.ruleId, "mrr-hba1c-001");
    assert.equal(report.body.recognition.status, "recognized");
    assert.equal(report.body.personalRecord.reportId, report.body.report.id);

    const state = await api(baseUrl, "/api/state", authorized(county.body.token));
    assert.equal(state.body.diagnosticReports.some((item) => item.id === report.body.report.id), true);
    assert.equal(state.body.countyMutualRecognitionRecords.some((item) => item.id === report.body.recognition.id), true);
    assert.equal(state.body.personalRecords.some((item) => item.reportId === report.body.report.id), true);

    const critical = await api(baseUrl, "/api/mutual-recognition/reports", authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({
        externalId: "PACS-CRITICAL-001",
        residentId: "r1",
        item: "Chest CT",
        category: "imaging",
        sourceInstitution: "Pulandian Township Hospital",
        targetInstitution: "Pulandian Central Hospital",
        result: "urgent imaging finding",
        conclusion: "Critical value: suspected acute chest condition.",
        qualityStatus: "passed",
        critical: true,
        criticalLevel: "high",
        criticalAction: "Call receiving physician within 15 minutes.",
        reportedAt: "2026-06-21T13:00:00.000Z"
      })
    }));
    assert.equal(critical.response.status, 201);
    assert.equal(critical.body.criticalSignal.status, "pending_acknowledgement");
    assert.equal(critical.body.criticalSignal.sourceReportId, critical.body.report.id);

    const handled = await api(baseUrl, `/api/emergency-signals/${critical.body.criticalSignal.id}`, authorized(county.body.token, {
      method: "PATCH",
      body: JSON.stringify({ status: "acknowledged", action: "Receiving physician notified and disposition recorded." })
    }));
    assert.equal(handled.response.status, 200);
    assert.equal(handled.body.status, "acknowledged");

    const countyTasks = await api(baseUrl, "/api/tasks", authorized(county.body.token));
    assert.equal(countyTasks.response.status, 200);
    assert.equal(countyTasks.body.tasks.some((item) => item.id === `emergencySignals:${critical.body.criticalSignal.id}`), true);
    assert.equal(countyTasks.body.tasks.some((item) => item.collection === "insuranceClaims"), false);
    const countyServiceTask = countyTasks.body.tasks.find((item) => item.collection === "countyCollaborationOrders");
    assert.equal(countyServiceTask.serviceDomain, "collaboration");
    assert.equal(countyServiceTask.priorityLevel, "high");

    const taskHandled = await api(baseUrl, `/api/tasks/${encodeURIComponent(`emergencySignals:${critical.body.criticalSignal.id}`)}/actions`, authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({ status: "resolved", action: "close-critical-alert", comment: "Disposition completed." })
    }));
    assert.equal(taskHandled.response.status, 200);
    assert.equal(taskHandled.body.status, "resolved");

    const taskMessage = await api(baseUrl, `/api/tasks/${encodeURIComponent(`emergencySignals:${critical.body.criticalSignal.id}`)}/messages`, authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({
        targetRole: "citizen",
        channel: "in_app",
        title: "Critical result handled",
        body: "Your critical diagnostic result has been handled by the regional center."
      })
    }));
    assert.equal(taskMessage.response.status, 201);
    assert.equal(taskMessage.body.residentId, "r1");
    assert.equal(taskMessage.body.status, "sent");

    const rejectedReview = await api(baseUrl, `/api/mutual-recognition/records/${critical.body.recognition.id}/review`, authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", reasonCode: "poor-quality", comment: "DICOM package is incomplete." })
    }));
    assert.equal(rejectedReview.response.status, 200);
    assert.equal(rejectedReview.body.status, "rejected");
    assert.equal(rejectedReview.body.nonRecognitionReason, "poor-quality");

    const reviewedState = await api(baseUrl, "/api/state", authorized(county.body.token));
    const reviewedReport = reviewedState.body.diagnosticReports.find((item) => item.id === critical.body.report.id);
    assert.equal(reviewedReport.status, "not_recognized");
    assert.equal(reviewedReport.reviewReasonCode, "poor-quality");
    assert.equal(Array.isArray(reviewedState.body.countyAcceptanceLedger), true);

    const acceptance = await api(baseUrl, "/api/county/acceptance-ledger", authorized(county.body.token));
    assert.equal(acceptance.response.status, 200);
    assert.equal(acceptance.body.ok, true);
    assert.equal(acceptance.body.ledger.some((item) => item.id === "county-accept-report-return"), true);
    assert.equal(acceptance.body.ledger.some((item) => item.metricKey === "criticalAlert" && item.metric.denominator >= 1), true);
    assert.equal(acceptance.body.serviceSummary.summary.domains, 5);
    assert.equal(acceptance.body.serviceSummary.domains.some((item) => item.id === "performance"), true);

    const insurance = await login(baseUrl, "insurance");
    const insuranceAcceptance = await api(baseUrl, "/api/county/acceptance-ledger", authorized(insurance.body.token));
    assert.equal(insuranceAcceptance.response.status, 403);
    const insuranceTasks = await api(baseUrl, "/api/tasks", authorized(insurance.body.token));
    assert.equal(insuranceTasks.response.status, 200);
    assert.equal(insuranceTasks.body.tasks.some((item) => item.collection === "insuranceClaims"), true);
    assert.equal(insuranceTasks.body.tasks.some((item) => item.collection === "chronicScreeningTasks"), false);

    const citizen = await login(baseUrl, "citizen");
    const citizenMessages = await api(baseUrl, "/api/messages", authorized(citizen.body.token));
    assert.equal(citizenMessages.response.status, 200);
    assert.equal(citizenMessages.body.messages.some((item) => item.id === taskMessage.body.id), true);

    const receipt = await api(baseUrl, `/api/messages/${taskMessage.body.id}/receipt`, authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ status: "read" })
    }));
    assert.equal(receipt.response.status, 200);
    assert.equal(receipt.body.status, "read");
    assert.equal(receipt.body.receipts[0].by, citizen.body.user.username);

    const escalations = await api(baseUrl, "/api/tasks/escalations", authorized(commissionToken));
    assert.equal(escalations.response.status, 200);
    assert.equal(escalations.body.overdue.some((item) => item.overdue === true), true);
    const commissionTasks = await api(baseUrl, "/api/tasks", authorized(commissionToken));
    const chronicServiceTask = commissionTasks.body.tasks.find((item) => item.collection === "chronicScreeningTasks" && item.sourceId === "cst-001");
    assert.equal(chronicServiceTask.serviceDomain, "screening");
    assert.equal(chronicServiceTask.priorityLevel, "high");

    const escalationRun = await api(baseUrl, "/api/tasks/escalations/run", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(escalationRun.response.status, 201);
    assert.equal(escalationRun.body.summary.created > 0, true);

    const escalationReplay = await api(baseUrl, "/api/tasks/escalations/run", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(escalationReplay.response.status, 201);
    assert.equal(escalationReplay.body.summary.created, 0);

    const qualityIssues = await api(baseUrl, "/api/data-quality/issues", authorized(commissionToken));
    assert.equal(qualityIssues.response.status, 200);
    assert.equal(qualityIssues.body.issues.some((item) => item.type === "integration_dead_letter"), true);
    assert.equal(qualityIssues.body.issues.some((item) => item.type === "institution_credit_rectification"), true);
    const issue = qualityIssues.body.issues.find((item) => item.type === "institution_credit_rectification");
    const issueAction = await api(baseUrl, `/api/data-quality/issues/${issue.id}/actions`, authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ status: "closed", action: "rectified", comment: "Institution uploaded missing quality evidence." })
    }));
    assert.equal(issueAction.response.status, 200);
    assert.equal(issueAction.body.status, "closed");

    const scorecard = await api(baseUrl, "/api/data-quality/scorecard", authorized(commissionToken));
    assert.equal(scorecard.response.status, 200);
    assert.equal(scorecard.body.residentIndexCompleteness, 100);
    assert.equal(scorecard.body.trustedSources.some((item) => item.collection === "diagnosticReports"), true);
    assert.equal(Number.isFinite(scorecard.body.score), true);

    const credit = await api(baseUrl, "/api/credit-evaluations/calculate", authorized(commissionToken));
    assert.equal(credit.response.status, 200);
    assert.equal(credit.body.rules.version, "credit-rules-2026.1");
    assert.equal(credit.body.evaluations.length, 3);
    assert.equal(credit.body.evaluations.every((item) => Array.isArray(item.deductions)), true);
    const creditAction = await api(baseUrl, `/api/credit-evaluations/${credit.body.evaluations[0].id}/actions`, authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ appealStatus: "submitted", publicationStatus: "pending_appeal", appealComment: "Institution submitted supporting evidence." })
    }));
    assert.equal(creditAction.response.status, 200);
    assert.equal(creditAction.body.appealStatus, "submitted");

    const performance = await api(baseUrl, "/api/performance/consortium-report", authorized(commissionToken));
    assert.equal(performance.response.status, 200);
    assert.equal(performance.body.medicalConsortium.totalOrders >= 1, true);
    assert.equal(performance.body.pharmacyAndConsumables.medicationPlans >= 1, true);
    assert.equal(performance.body.peopleFinanceMaterials.doctors >= 1, true);
    assert.equal(Number.isFinite(performance.body.primaryCareFulfillment.completionRate), true);

    const chronicAcceptance = await api(baseUrl, "/api/chronic/acceptance-ledger", authorized(commissionToken));
    assert.equal(chronicAcceptance.response.status, 200);
    assert.equal(chronicAcceptance.body.ok, true);
    assert.equal(chronicAcceptance.body.ledger.some((item) => item.id === "chronic-accept-screening"), true);
    assert.equal(chronicAcceptance.body.ledger.some((item) => item.metricKey === "quality" && item.rate >= 80), true);
    assert.equal(chronicAcceptance.body.policyCollections.servicePathways >= 5, true);
    assert.equal(chronicAcceptance.body.serviceSummary.summary.domains, 8);
    assert.equal(chronicAcceptance.body.serviceSummary.domains.some((item) => item.id === "medicationSupport"), true);

    const chronicRisk = await api(baseUrl, "/api/chronic/risk-stratification", authorized(commissionToken));
    assert.equal(chronicRisk.response.status, 200);
    assert.equal(chronicRisk.body.ok, true);
    assert.equal(chronicRisk.body.summary.highPriority >= 1, true);
    assert.equal(chronicRisk.body.summary.openScreeningTasks >= 1, true);
    assert.equal(chronicRisk.body.queue.some((item) => item.residentId === "r1" && item.priority === "high"), true);
    assert.equal(chronicRisk.body.queue.every((item) => item.nextAction && item.serviceLevel && item.openCounts), true);

    const chronicFollowupSummary = await api(baseUrl, "/api/chronic/followup-summary", authorized(commissionToken));
    assert.equal(chronicFollowupSummary.response.status, 200);
    assert.equal(chronicFollowupSummary.body.ok, true);
    assert.equal(chronicFollowupSummary.body.summary.feedbackRecords >= 1, true);
    assert.equal(chronicFollowupSummary.body.residents.some((item) => item.residentId === "r1" && item.medicationAdherence.total >= 1), true);

    const citizenFollowupSummary = await api(baseUrl, "/api/chronic/followup-summary?residentId=r1", authorized(citizen.body.token));
    assert.equal(citizenFollowupSummary.response.status, 200);
    assert.equal(citizenFollowupSummary.body.residents.every((item) => ["r1"].includes(item.residentId)), true);

    const feedback = await api(baseUrl, "/api/chronic/followup-feedback", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        followupId: "f1",
        medicationTaken: true,
        symptoms: "home blood pressure remains high",
        nextRequest: "family doctor phone review"
      })
    }));
    assert.equal(feedback.response.status, 201);
    assert.equal(feedback.body.category, "chronic-feedback");
    assert.equal(feedback.body.meta.followupId, "f1");

    const feedbackDenied = await api(baseUrl, "/api/chronic/followup-feedback", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r2", followupId: "f2", feedback: "tampered resident" })
    }));
    assert.equal(feedbackDenied.response.status, 403);

    const dispatched = await api(baseUrl, "/api/chronic/followup-dispatch", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        collection: "followups",
        id: "f1",
        status: "已完成",
        updates: { result: "completed after resident feedback" },
        note: "closed by commission regression test"
      })
    }));
    assert.equal(dispatched.response.status, 200);
    assert.equal(dispatched.body.status, "已完成");
    assert.equal(dispatched.body.disposition, "handled");

    const dispatchDenied = await api(baseUrl, "/api/chronic/followup-dispatch", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "followups", id: "f2", status: "已完成" })
    }));
    assert.equal(dispatchDenied.response.status, 403);

    const chronicDenied = await api(baseUrl, "/api/chronic/acceptance-ledger", authorized(insurance.body.token));
    assert.equal(chronicDenied.response.status, 403);
    const chronicRiskDenied = await api(baseUrl, "/api/chronic/risk-stratification", authorized(insurance.body.token));
    assert.equal(chronicRiskDenied.response.status, 403);
    const serviceAcceptanceDenied = await api(baseUrl, "/api/service-acceptance-summary", authorized(insurance.body.token));
    assert.equal(serviceAcceptanceDenied.response.status, 403);

    const datasets = await api(baseUrl, "/api/research/datasets", authorized(commissionToken));
    assert.equal(datasets.response.status, 200);
    assert.equal(datasets.body.datasets.some((item) => item.diseaseType === "hypertension"), true);
    const usage = await api(baseUrl, "/api/research/datasets/rd-hypertension-001/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ action: "usage-audit", purpose: "risk stratification model validation", result: "allowed" })
    }));
    assert.equal(usage.response.status, 200);
    assert.equal(usage.body.usageAudit[0].purpose, "risk stratification model validation");
    const outcome = await api(baseUrl, "/api/research/datasets/rd-hypertension-001/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ action: "outcome-return", title: "Hypertension model calibration", summary: "Returned model threshold evidence." })
    }));
    assert.equal(outcome.response.status, 200);
    assert.equal(outcome.body.outcomes[0].title, "Hypertension model calibration");

    const models = await api(baseUrl, "/api/research/disease-models", authorized(commissionToken));
    assert.equal(models.response.status, 200);
    assert.equal(models.body.models.some((item) => item.id === "dm-hypertension-risk-v1"), true);
    const modelReview = await api(baseUrl, "/api/research/disease-models/dm-hypertension-risk-v1/review", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ version: "1.1.0", threshold: "systolic>=145 or riskLevel=high", reviewStatus: "reviewed", reviewComment: "Threshold reviewed by chronic disease expert group." })
    }));
    assert.equal(modelReview.response.status, 200);
    assert.equal(modelReview.body.version, "1.1.0");
    assert.equal(modelReview.body.reviewStatus, "reviewed");

    const accessibility = await api(baseUrl, "/api/mobile/accessibility-checklist", authorized(commissionToken));
    assert.equal(accessibility.response.status, 200);
    assert.equal(accessibility.body.checklist.some((item) => item.id === "a11y-large-font"), true);
    const accessibilityAction = await api(baseUrl, "/api/mobile/accessibility-checklist/a11y-screen-reader/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ status: "passed", evidence: "Landmark and aria-label review passed.", tester: "accessibility-reviewer" })
    }));
    assert.equal(accessibilityAction.response.status, 200);
    assert.equal(accessibilityAction.body.status, "passed");
    assert.equal(accessibilityAction.body.tester, "accessibility-reviewer");

    const mobileExperience = await api(baseUrl, "/api/mobile/experience", authorized(citizen.body.token));
    assert.equal(mobileExperience.response.status, 200);
    assert.equal(mobileExperience.body.settings.weakNetworkMode, "cache-last-state");
    assert.equal(mobileExperience.body.seniorServices.every((item) => ["r1", "r4"].includes(item.residentId)), true);
    assert.equal(mobileExperience.body.accessibilityChecklist.some((item) => item.category === "family_proxy"), true);
    const mobilePreference = await api(baseUrl, "/api/mobile/experience", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ largeMode: true, weakNetworkMode: "cache-last-state", proxyContact: "family", offlineHelpPreferred: true, messageTouchpoint: "family_proxy" })
    }));
    assert.equal(mobilePreference.response.status, 200);
    assert.equal(mobilePreference.body.preferences.largeMode, true);
    assert.equal(mobilePreference.body.experience.preferences.proxyContact, "family");

    const denied = await api(baseUrl, "/api/mutual-recognition/reports", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r2", item: "HbA1c" })
    }));
    assert.equal(denied.response.status, 403);
  });

  await t.test("enforces workflow collection ownership and protects structural fields", async () => {
    const institution = await login(baseUrl, "hospital");
    const insurance = await login(baseUrl, "insurance");
    const county = await login(baseUrl, "county");

    const institutionInsuranceWrite = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "insuranceClaims", id: "ic1", status: "已通过" })
    }));
    assert.equal(institutionInsuranceWrite.response.status, 403);

    const insuranceCareWrite = await api(baseUrl, "/api/workflow-actions", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "careOrders", id: "co1", status: "已完成" })
    }));
    assert.equal(insuranceCareWrite.response.status, 403);

    const countyMedicationWrite = await api(baseUrl, "/api/workflow-actions", authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "medicationPickups", id: "mp1", status: "已完成" })
    }));
    assert.equal(countyMedicationWrite.response.status, 403);

    const insuranceChronicWrite = await api(baseUrl, "/api/workflow-actions", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "chronicComorbidityPlans", id: "ccp-001", status: "已复核" })
    }));
    assert.equal(insuranceChronicWrite.response.status, 403);

    const allowed = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "careOrders",
        id: "co1",
        status: "已接诊",
        updates: { id: "tampered", residentId: "r3", institutionReview: "已接诊" }
      })
    }));
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.id, "co1");
    assert.notEqual(allowed.body.residentId, "r3");
    assert.equal(allowed.body.institutionReview, "已接诊");

    const chronicAllowed = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "chronicComorbidityPlans",
        id: "ccp-001",
        status: "已复核",
        updates: { residentId: "r3", assessment: "已完成多病共管复核" }
      })
    }));
    assert.equal(chronicAllowed.response.status, 200);
    assert.equal(chronicAllowed.body.id, "ccp-001");
    assert.notEqual(chronicAllowed.body.residentId, "r3");
    assert.equal(chronicAllowed.body.assessment, "已完成多病共管复核");

    const medicationSupportAllowed = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "chronicMedicationSupport",
        id: "cms-001",
        status: "运行中",
        updates: { stockStatus: "已完成库存复核" }
      })
    }));
    assert.equal(medicationSupportAllowed.response.status, 200);
    assert.equal(medicationSupportAllowed.body.stockStatus, "已完成库存复核");
  });

  await t.test("allows commission state persistence without losing governance collections", async () => {
    const current = await api(baseUrl, "/api/state", authorized(commissionToken));
    const saved = await api(baseUrl, "/api/state", authorized(commissionToken, {
      method: "PUT",
      body: JSON.stringify(current.body)
    }));
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.applicationCatalog.length, 6);
    assert.equal(saved.body.hospitalInteroperabilityFunctions.length, 6);
    assert.equal(saved.body.institutionCreditEvaluations.length, 3);
    assert.equal(saved.body.securityAcceptanceLedger.length, 4);
    assert.equal(saved.body.productionDeploymentPlan.length, 4);
  });

  await t.test("verifies audit hash chains and detects tampering", async () => {
    const verified = await api(baseUrl, "/api/audit/verify", authorized(commissionToken));
    assert.equal(verified.response.status, 200);
    assert.equal(verified.body.passed, true);
    assert.equal(verified.body.trails.securityEvents.passed, true);
    assert.equal(verified.body.trails.dataAccessLogs.passed, true);

    const auditExport = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(commissionToken));
    assert.equal(auditExport.response.status, 200);
    assert.equal(auditExport.body.securityEvents.length > 0, true);
    assert.equal(auditExport.body.dataAccessLogs.length, 0);

    const compliance = await api(baseUrl, "/api/security/compliance-report", authorized(commissionToken));
    assert.equal(compliance.response.status, 200);
    assert.equal(compliance.body.summary.auditPassed, true);
    assert.equal(compliance.body.ledger.length, 4);

    const highRisk = await api(baseUrl, "/api/security/high-risk-events", authorized(commissionToken));
    assert.equal(highRisk.response.status, 200);
    assert.equal(highRisk.body.events.length > 0, true);

    const controlId = compliance.body.ledger[0].id;
    const controlAction = await api(baseUrl, `/api/security/controls/${controlId}/actions`, authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ status: "证据已归档", evidence: "audit-export-and-compliance-report", action: "archive-evidence" })
    }));
    assert.equal(controlAction.response.status, 200);
    assert.equal(controlAction.body.evidence, "audit-export-and-compliance-report");

    const current = await api(baseUrl, "/api/state", authorized(commissionToken));
    current.body.securityEvents[0].detail = "tampered audit detail";
    const tamperedSave = await api(baseUrl, "/api/state", authorized(commissionToken, {
      method: "PUT",
      body: JSON.stringify(current.body)
    }));
    assert.equal(tamperedSave.response.status, 200);

    const tamperedVerify = await api(baseUrl, "/api/audit/verify", authorized(commissionToken));
    assert.equal(tamperedVerify.response.status, 200);
    assert.equal(tamperedVerify.body.passed, false);
    assert.equal(tamperedVerify.body.trails.securityEvents.passed, false);
    assert.ok(tamperedVerify.body.trails.securityEvents.broken.length > 0);
  });

  await t.test("invalidates a session after logout", async () => {
    const session = await login(baseUrl, "county");
    const logout = await api(baseUrl, "/api/auth/logout", authorized(session.body.token, { method: "POST" }));
    assert.equal(logout.response.status, 200);
    const me = await api(baseUrl, "/api/auth/me", authorized(session.body.token));
    assert.equal(me.response.status, 401);
  });
});
