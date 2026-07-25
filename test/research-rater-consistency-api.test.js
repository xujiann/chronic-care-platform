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
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // The isolated test server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("rater consistency test server startup timed out");
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

test("rater consistency API completes Kappa calculation and acceptance bridging", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-rater-api-"));
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
  const created = await jsonRequest(baseUrl, "/api/research-project/rater-consistency/batches", hospitalToken, {
    method: "POST",
    body: JSON.stringify({
      batchNumber: 1,
      name: "试点案例分类一致性",
      method: "fleiss-kappa",
      expectedRaters: 2,
      caseCodes: ["API-CASE-001", "API-CASE-002", "API-CASE-003"],
      categories: ["通过", "不通过"]
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.batch.cases.length, 3);
  assert.equal(JSON.stringify(created.body.batch).includes("API-CASE-001"), false);

  for (const raterCode of ["API-RATER-001", "API-RATER-002"]) {
    const recorded = await jsonRequest(baseUrl, "/api/research-project/rater-consistency/batches/research-rater-batch-01/ratings", hospitalToken, {
      method: "POST",
      body: JSON.stringify({ raterCode, ratings: ["通过", "不通过", "通过"], noRaterPii: true })
    });
    assert.equal(recorded.response.status, 201, JSON.stringify(recorded.body));
    assert.equal(recorded.body.submission.raterKeyHash.length, 64);
    assert.equal(JSON.stringify(recorded.body.submission).includes(raterCode), false);
  }

  const finalized = await jsonRequest(baseUrl, "/api/research-project/rater-consistency/batches/research-rater-batch-01/actions", hospitalToken, {
    method: "POST",
    body: JSON.stringify({ action: "finalize-batch", note: "评价完成，锁定统计批次。" })
  });
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.body));
  assert.equal(finalized.body.batch.statistics.coefficient, 1);

  const verified = await jsonRequest(baseUrl, "/api/research-project/rater-consistency/batches/research-rater-batch-01/actions", reviewerToken, {
    method: "POST",
    body: JSON.stringify({ action: "verify-batch", note: "独立核对案例和统计结果后通过。" })
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.batch.status, "verified");
  assert.equal(verified.body.center.aggregate.minimumCoefficient, 1);

  const acceptance = await jsonRequest(baseUrl, "/api/research-project/acceptance-center", reviewerToken);
  const metric = acceptance.body.metrics.find((item) => item.id === "metric-rater-consistency");
  assert.equal(metric.status, "evidence-recorded");
  assert.equal(metric.measuredValue, 1);
  assert.equal(metric.meetsTarget, true);

  const report = await fetch(`${baseUrl}/api/research-project/rater-consistency?format=markdown`, {
    headers: { Authorization: `Bearer ${reviewerToken}` }
  });
  assert.equal(report.status, 200);
  assert.match(await report.text(), /Fleiss Kappa/);
  const persisted = fs.readFileSync(path.join(dataDir, "db.json"), "utf8");
  for (const rawIdentifier of ["API-CASE-001", "API-RATER-001", "API-RATER-002"]) {
    assert.equal(persisted.includes(rawIdentifier), false);
  }
});
