const assert = require("node:assert/strict");
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
      if (response.ok) return;
    } catch {
      // The isolated test server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("expert consultation test server startup timed out");
}

async function jsonRequest(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login(baseUrl, username) {
  const result = await jsonRequest(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.token;
}

function responsePayload(expertCode) {
  return {
    expertCode,
    noExpertPii: true,
    relevanceRatings: {
      "governance-standard": 4,
      "medical-service": 4,
      "quality-safety": 4,
      "public-health": 3,
      "operation-efficiency": 3,
      "data-security": 4
    },
    ahpJudgments: {
      standardVsOutcomes: 2,
      standardVsSecurity: 4,
      outcomesVsSecurity: 2
    }
  };
}

test("expert consultation API completes the audited calculation and acceptance bridge", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-expert-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await waitForHealth(baseUrl);

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const hospitalToken = await login(baseUrl, "hospital");
  const reviewerToken = await login(baseUrl, "health");
  const created = await jsonRequest(baseUrl, "/api/research-project/expert-consultation/rounds", hospitalToken, {
    method: "POST",
    body: JSON.stringify({ roundNumber: 1, name: "第一轮专家咨询", invitedExperts: 2 })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.round.status, "collecting");

  for (const expertCode of ["API-EXPERT-001", "API-EXPERT-002"]) {
    const recorded = await jsonRequest(baseUrl, "/api/research-project/expert-consultation/rounds/research-expert-round-01/responses", hospitalToken, {
      method: "POST",
      body: JSON.stringify(responsePayload(expertCode))
    });
    assert.equal(recorded.response.status, 201, JSON.stringify(recorded.body));
    assert.equal(recorded.body.response.expertKeyHash.length, 64);
    assert.equal(JSON.stringify(recorded.body.response).includes(expertCode), false);
  }

  const finalized = await jsonRequest(baseUrl, "/api/research-project/expert-consultation/rounds/research-expert-round-01/actions", hospitalToken, {
    method: "POST",
    body: JSON.stringify({ action: "finalize-round", note: "回收完成，锁定统计口径。" })
  });
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.body));
  assert.equal(finalized.body.round.status, "finalized");

  const verified = await jsonRequest(baseUrl, "/api/research-project/expert-consultation/rounds/research-expert-round-01/actions", reviewerToken, {
    method: "POST",
    body: JSON.stringify({ action: "verify-round", note: "独立核验通过。" })
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.round.status, "verified");
  assert.equal(verified.body.center.aggregate.responseRate, 100);
  assert.equal(verified.body.center.aggregate.minimumICVI, 1);
  assert.equal(verified.body.center.aggregate.maximumAHPCR, 0);

  const acceptance = await jsonRequest(baseUrl, "/api/research-project/acceptance-center", reviewerToken);
  const bridgedMetric = acceptance.body.metrics.find((item) => item.id === "metric-expert-response");
  assert.equal(bridgedMetric.status, "evidence-recorded");
  assert.equal(bridgedMetric.measuredValue, 100);
  assert.equal(bridgedMetric.meetsTarget, true);

  const markdown = await fetch(`${baseUrl}/api/research-project/expert-consultation?format=markdown`, {
    headers: { Authorization: `Bearer ${reviewerToken}` }
  });
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /最低 I-CVI：1/);
  const persisted = fs.readFileSync(path.join(dataDir, "db.json"), "utf8");
  assert.equal(persisted.includes("API-EXPERT-001"), false);
  assert.equal(persisted.includes("API-EXPERT-002"), false);
});
