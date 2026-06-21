const assert = require("node:assert/strict");
const { pbkdf2Sync } = require("node:crypto");
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

test("API authentication, scoping and governance regression suite", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-test-"));
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.accounts[0].name = "????A??";
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
    assert.deepEqual(Object.keys(healthBody).sort(), ["ok", "storage"]);
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
    assert.equal(body.applicationCatalog.length, 6);
    assert.equal(body.institutionCreditEvaluations.length, 3);
    assert.equal(body.securityAcceptanceLedger.length, 4);
    ["residents", "personalRecords", "platformEvidence", "applicationCatalog", "institutionCreditEvaluations", "securityAcceptanceLedger"].forEach((key) => {
      assert.ok(Array.isArray(body[key]), `${key} 应保持数组契约`);
    });
  });

  const citizenLogin = await login(baseUrl, "citizen");
  assert.equal(citizenLogin.response.status, 200);
  const citizenToken = citizenLogin.body.token;

  await t.test("scopes citizen state to household members and hides management data", async () => {
    const { response, body } = await api(baseUrl, "/api/state", authorized(citizenToken));
    assert.equal(response.status, 200);
    assert.deepEqual(body.residents.map((item) => item.id).sort(), ["r1", "r4"]);
    [
      "authUsers",
      "authOrganizations",
      "securityEvents",
      "platformAudit",
      "platformProcessAudit",
      "applicationCatalog",
      "institutionCreditEvaluations",
      "securityAcceptanceLedger"
    ].forEach((key) => assert.equal(body[key], undefined, `${key} 不应返回给居民端`));
  });

  await t.test("enforces personal record ownership and protects record identity", async () => {
    const ownRecords = await api(baseUrl, "/api/personal-records?residentId=r1", authorized(citizenToken));
    assert.equal(ownRecords.response.status, 200);
    assert.ok(Array.isArray(ownRecords.body));

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

  await t.test("enforces certificate roles and resident scope", async () => {
    const ownBirth = await api(baseUrl, "/api/birth-certificates?residentId=r1", authorized(citizenToken));
    assert.equal(ownBirth.response.status, 200);
    assert.ok(ownBirth.body.certificates.every((item) => item.maternalResidentId === "r1" || item.residentId === "r1"));

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
  });

  await t.test("allows commission state persistence without losing governance collections", async () => {
    const current = await api(baseUrl, "/api/state", authorized(commissionToken));
    const saved = await api(baseUrl, "/api/state", authorized(commissionToken, {
      method: "PUT",
      body: JSON.stringify(current.body)
    }));
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.applicationCatalog.length, 6);
    assert.equal(saved.body.institutionCreditEvaluations.length, 3);
    assert.equal(saved.body.securityAcceptanceLedger.length, 4);
  });

  await t.test("invalidates a session after logout", async () => {
    const session = await login(baseUrl, "county");
    const logout = await api(baseUrl, "/api/auth/logout", authorized(session.body.token, { method: "POST" }));
    assert.equal(logout.response.status, 200);
    const me = await api(baseUrl, "/api/auth/me", authorized(session.body.token));
    assert.equal(me.response.status, 401);
  });
});
