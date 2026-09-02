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
  const deliveryItem = after.body.requirementDelivery.items.find((item) => item.requirementId === candidate.id);
  assert.equal(deliveryItem.status, "awaiting-plan");

  const planned = await json(baseUrl, `/api/platform/productization/requirements/${encodeURIComponent(candidate.id)}/lifecycle-actions`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "procurement-api-plan-0001" },
    body: JSON.stringify({ action: "plan", expectedVersion: 0, releaseWindow: "next-release" })
  });
  assert.equal(planned.response.status, 200, JSON.stringify(planned.body));
  assert.equal(planned.body.delivery.status, "planned");
  assert.equal(planned.body.delivery.productionReady, false);

  const started = await json(baseUrl, `/api/platform/productization/requirements/${encodeURIComponent(candidate.id)}/lifecycle-actions`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "procurement-api-start-0001" },
    body: JSON.stringify({ action: "start-delivery", expectedVersion: 1 })
  });
  assert.equal(started.response.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.delivery.status, "in-delivery");

  const submitted = await json(baseUrl, `/api/platform/productization/requirements/${encodeURIComponent(candidate.id)}/lifecycle-actions`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "procurement-api-evidence-0001" },
    body: JSON.stringify({ action: "submit-evidence", expectedVersion: 2, evidenceType: "implementation", evidenceDigest: `sha256:${"a".repeat(64)}` })
  });
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.delivery.status, "evidence-review");

  const finalCenter = await json(baseUrl, "/api/platform/productization/center", { headers });
  assert.equal(finalCenter.body.requirementDelivery.summary.evidenceReview, 1);
  assert.equal(finalCenter.body.requirementDelivery.exportBundle.productionReady, false);
  assert.equal(JSON.stringify(finalCenter.body.requirementDelivery.exportBundle).includes("PR-SAMPLE"), false);

  const sourceDocument = structuredClone(require("../config/procurement-requirement-governance.json").documents[1]);
  sourceDocument.id = "DOC-API-NEUTRAL-0003";
  sourceDocument.seriesId = "SRC-000000000003";
  sourceDocument.sourceAlias = "需求来源 000000000003";
  sourceDocument.sha256 = `sha256:${"c".repeat(64)}`;
  sourceDocument.candidates = [{ ...sourceDocument.candidates[0], id: "PR-API-NEUTRAL-003-R001", logicalRequirementId: "REQ-000000000006", semanticDigest: `sha256:${"d".repeat(64)}` }];
  const artifact = {
    schemaVersion: "procurement-controlled-import-batch-v2",
    documents: [sourceDocument],
    revisionComparisons: [],
    summary: { documents: 1, byteSize: sourceDocument.byteSize, candidates: 1, reviewedPages: sourceDocument.reviewedPageCount },
    productionReady: false,
    boundary: "sanitized"
  };
  const registered = await json(baseUrl, "/api/platform/productization/requirement-batches", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "procurement-api-import-0001" },
    body: JSON.stringify({ expectedVersion: 0, artifact })
  });
  assert.equal(registered.response.status, 200, JSON.stringify(registered.body));
  assert.equal(registered.body.registration.registeredDocuments, 1);
  const importedCenter = await json(baseUrl, "/api/platform/productization/center", { headers });
  assert.equal(importedCenter.body.requirementGovernance.summary.candidates, before.body.requirementGovernance.summary.candidates + 1);
  assert.equal(importedCenter.body.requirementGovernance.catalogRegistrationVersion, 1);
});
