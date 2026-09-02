"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function json(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

test("procurement requirement review persists through the real SQLite API boundary", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "procurement-requirement-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "sqlite";

  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const login = await json(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "city", password: "123456" })
  });
  assert.equal(login.response.status, 200);
  const headers = {
    Authorization: `Bearer ${login.body.token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "procurement-api-review-0001"
  };

  const before = await json(baseUrl, "/api/platform/productization/center", { headers });
  assert.equal(before.response.status, 200);
  const candidate = before.body.requirementGovernance.items[0];
  assert.equal(candidate.reviewStatus, "pending-review");

  const payload = {
    action: "accept",
    expectedVersion: candidate.version,
    note: "经真实存储边界复核确认采用当前能力映射建议"
  };
  const reviewed = await json(
    baseUrl,
    `/api/platform/productization/requirements/${encodeURIComponent(candidate.id)}/actions`,
    { method: "POST", headers, body: JSON.stringify(payload) }
  );
  assert.equal(reviewed.response.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.requirement.reviewStatus, "accepted");
  assert.equal(reviewed.body.requirement.version, 1);
  assert.equal(reviewed.body.productionReady, false);

  const replay = await json(
    baseUrl,
    `/api/platform/productization/requirements/${encodeURIComponent(candidate.id)}/actions`,
    { method: "POST", headers, body: JSON.stringify(payload) }
  );
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.requirement, reviewed.body.requirement);

  const after = await json(baseUrl, "/api/platform/productization/center", { headers });
  assert.equal(after.response.status, 200);
  assert.equal(after.body.requirementGovernance.items[0].reviewStatus, "accepted");
  assert.equal(after.body.requirementGovernance.items[0].version, 1);
  assert.equal(after.body.requirementGovernance.containsLocalPath, false);
  assert.equal(after.body.requirementGovernance.productionReady, false);
});
