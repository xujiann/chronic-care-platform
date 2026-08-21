"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SERVER_MANAGED_REGIONAL_COLLECTIONS = [
  "regionalDataSharingScope",
  "regionalSharingPackages",
  "regionalSharingSnapshots",
  "regionalSharingAccessReviews"
];

async function json(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

async function login(baseUrl, username) {
  return json(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" })
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

function splitJson(baseUrl, pathname, token, payload, marker) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const markerOffset = body.indexOf(Buffer.from(marker, "utf8"));
  assert.notEqual(markerOffset, -1, `split marker ${marker} must be present`);
  const splitOffset = markerOffset + 1;
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Length": body.length,
        "Content-Type": "application/json"
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.write(body.subarray(0, splitOffset));
    setImmediate(() => request.end(body.subarray(splitOffset)));
  });
}

test("regional sharing command preserves route compatibility, safe denial audit and full-state audit protection", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "regional-sharing-access-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.STORAGE_ENGINE;
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const commission = await login(baseUrl, "whjw");
  const hospital = await login(baseUrl, "hospital");
  const community = await login(baseUrl, "community");

  const concurrentPayload = {
    packageId: "rsp-r2-diabetes",
    expectedVersion: 0,
    decision: "approved",
    purpose: "并发调阅只允许一个版本提交"
  };
  const concurrent = await Promise.all([
    json(baseUrl, "/api/regional-data-sharing/access-reviews", authorized(hospital.body.token, {
      method: "POST",
      headers: { "Idempotency-Key": "regional-concurrent-api-0001" },
      body: JSON.stringify(concurrentPayload)
    })),
    json(baseUrl, "/api/regional-data-sharing/access-reviews", authorized(hospital.body.token, {
      method: "POST",
      headers: { "Idempotency-Key": "regional-concurrent-api-0002" },
      body: JSON.stringify(concurrentPayload)
    }))
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [201, 409]);
  const concurrentReceiptId = concurrent.find((item) => item.response.status === 201).body.review.id;
  const afterConcurrent = await json(baseUrl, "/api/state", authorized(commission.body.token));
  assert.equal(afterConcurrent.body.regionalSharingPackages.find((item) => item.id === "rsp-r2-diabetes").version, 1);
  assert.equal(afterConcurrent.body.regionalSharingAccessReviews.filter((item) => item.id === concurrentReceiptId).length, 1);

  const allowed = await json(baseUrl, "/api/regional-data-sharing/access-reviews", authorized(hospital.body.token, {
    method: "POST",
    headers: { "Idempotency-Key": "regional-focused-api-0001" },
    body: JSON.stringify({
      packageId: "rsp-r2-diabetes",
      decision: "denied",
      purpose: "接续糖尿病复查前调阅区域检验报告",
      note: "不得持久化"
    })
  }));
  assert.equal(allowed.response.status, 201);
  assert.equal(allowed.body.review.decision, "allowed");
  assert.equal(allowed.body.legacyCompatibility, true);
  assert.equal(JSON.stringify(allowed.body).includes("不得持久化"), false);
  assert.equal(JSON.stringify(allowed.body).includes("DEMO-ID-"), false);
  for (const field of [
    "residentId",
    "personIndex",
    "authorizationId",
    "authorizationVersion",
    "purposeCode",
    "purposeDigest",
    "scopes",
    "idempotencyKeyHash",
    "requestDigest",
    "correlationId",
    "actorRef",
    "actorOrgCode",
    "actorRegionCode",
    "meta",
    "note"
  ]) {
    assert.equal(JSON.stringify(allowed.body).includes(`\"${field}\"`), false, field);
  }

  const commissionAccess = await json(baseUrl, "/api/regional-data-sharing/access-reviews", authorized(commission.body.token, {
    method: "POST",
    headers: { "Idempotency-Key": "regional-focused-commission-0001" },
    body: JSON.stringify({
      packageId: "rsp-r2-diabetes",
      decision: "denied",
      purpose: "管理端兼容调阅"
    })
  }));
  assert.equal(commissionAccess.response.status, 201);
  assert.equal(commissionAccess.body.review.decision, "allowed");

  const regionalView = await json(baseUrl, "/api/regional-data-sharing", authorized(hospital.body.token));
  const projectedReview = regionalView.body.accessReviews.find((item) => item.id === allowed.body.review.id);
  assert.ok(projectedReview);
  assert.equal(projectedReview.actor, "服务端授权命令");
  assert.equal(projectedReview.purpose, "已按结构化授权用途核验");
  for (const field of [
    "residentId",
    "personIndex",
    "authorizationId",
    "authorizationVersion",
    "purposeCode",
    "purposeDigest",
    "scopes",
    "idempotencyKeyHash",
    "requestDigest",
    "correlationId",
    "actorRef",
    "actorOrgCode",
    "actorRegionCode",
    "compatibilityBlockers",
    "meta"
  ]) {
    assert.equal(JSON.stringify(projectedReview).includes(`\"${field}\"`), false, `GET ${field}`);
  }

  const denied = await json(baseUrl, "/api/regional-data-sharing/access-reviews", authorized(community.body.token, {
    method: "POST",
    headers: { "Idempotency-Key": "regional-focused-api-0002" },
    body: JSON.stringify({ packageId: "rsp-r3-imaging", purpose: "越权明文不得进入审计" })
  }));
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, "REGIONAL_SHARING_ORGANIZATION_SCOPE_DENIED");

  const beforeSplitSubmission = await json(baseUrl, "/api/state", authorized(commission.body.token));
  const splitPayload = structuredClone(beforeSplitSubmission.body);
  delete splitPayload.securityEvents;
  delete splitPayload.dataAccessLogs;
  const splitSubmission = await splitJson(
    baseUrl,
    "/api/state",
    commission.body.token,
    splitPayload,
    beforeSplitSubmission.body.regionalDataSharingScope.name
  );
  assert.equal(splitSubmission.status, 200, JSON.stringify(splitSubmission.body));
  const current = await json(baseUrl, "/api/state", authorized(commission.body.token));
  for (const collection of SERVER_MANAGED_REGIONAL_COLLECTIONS) {
    assert.deepEqual(current.body[collection], beforeSplitSubmission.body[collection], `split UTF-8 must preserve ${collection}`);
  }
  const deniedAudit = current.body.securityEvents.find((item) =>
    item.action === "regional-sharing-access-command.v1" && item.detail === "REGIONAL_SHARING_ORGANIZATION_SCOPE_DENIED"
  );
  const allowedAccessAudit = current.body.dataAccessLogs.find((item) =>
    item.scope === "regionalDataSharing" && item.residentId === "r2" && /^principal:[a-f0-9]{16}$/.test(item.actor)
  );
  assert.match(deniedAudit.actor, /^principal:[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(deniedAudit).includes("越权明文不得进入审计"), false);
  assert.match(allowedAccessAudit.actor, /^principal:[a-f0-9]{16}$/);
  assert.match(allowedAccessAudit.purpose, /^purpose:[a-f0-9]{16}$/);
  assert.match(allowedAccessAudit.personIndex, /^resident:[a-f0-9]{24}$/);
  assert.equal(allowedAccessAudit.personIndex.includes("DEMO-ID-"), false);
  assert.equal(allowedAccessAudit.personIndex.includes("DEMO-MOBILE-"), false);

  const protectedRegionalState = Object.fromEntries(SERVER_MANAGED_REGIONAL_COLLECTIONS.map((collection) => [
    collection,
    structuredClone(current.body[collection])
  ]));
  const regionalTamperCases = [
    {
      collection: "regionalSharingAccessReviews",
      mutate: (value) => value.slice(1)
    },
    {
      collection: "regionalSharingAccessReviews",
      mutate: (value) => value.map((item, index) => index === 0 ? { ...item, decision: "forged" } : item)
    },
    {
      collection: "regionalSharingAccessReviews",
      mutate: (value) => [...value].reverse()
    },
    {
      collection: "regionalSharingAccessReviews",
      mutate: (value) => [{ id: "forged-receipt", decision: "allowed" }, ...value]
    },
    {
      collection: "regionalSharingPackages",
      mutate: (value) => value.map((item) => item.id === "rsp-r2-diabetes"
        ? { ...item, version: Number(item.version || 0) + 50, lastAccessReviewId: "forged-receipt" }
        : item)
    },
    {
      collection: "regionalDataSharingScope",
      mutate: (value) => ({ ...value, name: "client-forged-scope" })
    },
    {
      collection: "regionalSharingSnapshots",
      mutate: (value) => ({ ...value, generatedAt: "2099-01-01T00:00:00.000Z" })
    }
  ];
  for (const attack of regionalTamperCases) {
    const payload = structuredClone(current.body);
    delete payload.securityEvents;
    delete payload.dataAccessLogs;
    for (const collection of SERVER_MANAGED_REGIONAL_COLLECTIONS) delete payload[collection];
    payload[attack.collection] = attack.mutate(structuredClone(protectedRegionalState[attack.collection]));
    const blocked = await json(baseUrl, "/api/state", authorized(commission.body.token, {
      method: "PUT",
      body: JSON.stringify(payload)
    }));
    assert.equal(blocked.response.status, 409, attack.collection);
    assert.equal(blocked.body.code, "REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_CONFLICT");
    assert.equal(blocked.body.collection, attack.collection);
    const unchanged = await json(baseUrl, "/api/state", authorized(commission.body.token));
    for (const collection of SERVER_MANAGED_REGIONAL_COLLECTIONS) {
      assert.deepEqual(unchanged.body[collection], protectedRegionalState[collection], `${attack.collection} must not change ${collection}`);
    }
  }

  const delegatedBypass = await json(baseUrl, "/api/state-collections/regionalSharingAccessReviews", authorized(commission.body.token, {
    method: "PUT",
    body: JSON.stringify({ value: [] })
  }));
  assert.equal(delegatedBypass.response.status, 403);
  assert.equal(delegatedBypass.body.code, "REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_WRITE_DENIED");

  const tampered = structuredClone(current.body);
  tampered.securityEvents[0].detail = "tampered";
  for (const collection of SERVER_MANAGED_REGIONAL_COLLECTIONS) delete tampered[collection];
  const rejected = await json(baseUrl, "/api/state", authorized(commission.body.token, {
    method: "PUT",
    body: JSON.stringify(tampered)
  }));
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.code, "AUDIT_TRAIL_WRITE_REJECTED");

  const revokedState = structuredClone(current.body);
  const storedReceipt = revokedState.regionalSharingAccessReviews.find((item) => item.id === allowed.body.review.id);
  assert.ok(storedReceipt);
  const authorization = revokedState.personalRecords.find((item) => item.id === storedReceipt.authorizationId);
  assert.ok(authorization);
  authorization.status = "revoked";
  authorization.revokedAt = new Date().toISOString();
  authorization.meta = { ...(authorization.meta || {}), status: "revoked", revokedAt: authorization.revokedAt };
  delete revokedState.securityEvents;
  delete revokedState.dataAccessLogs;
  for (const collection of SERVER_MANAGED_REGIONAL_COLLECTIONS) delete revokedState[collection];
  const saved = await json(baseUrl, "/api/state", authorized(commission.body.token, {
    method: "PUT",
    body: JSON.stringify(revokedState)
  }));
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.regionalSharingAccessReviews.some((item) => item.id === allowed.body.review.id), true);

  const replayAfterRevoke = await json(baseUrl, "/api/regional-data-sharing/access-reviews", authorized(hospital.body.token, {
    method: "POST",
    headers: { "Idempotency-Key": "regional-focused-api-0001" },
    body: JSON.stringify({
      packageId: "rsp-r2-diabetes",
      decision: "approved",
      consentStatus: "active",
      purpose: "接续糖尿病复查前调阅区域检验报告"
    })
  }));
  assert.equal(replayAfterRevoke.response.status, 403);
  assert.equal(replayAfterRevoke.body.code, "REGIONAL_SHARING_AUTHORIZATION_REVOKED");
  assert.notEqual(replayAfterRevoke.body.replayed, true);
  assert.equal(replayAfterRevoke.body.authorizationReevaluated, true);

  const finalState = await json(baseUrl, "/api/state", authorized(commission.body.token));
  assert.equal(finalState.body.regionalSharingAccessReviews.filter((item) => item.id === allowed.body.review.id).length, 1);
  assert.equal(finalState.body.securityEvents.some((item) =>
    item.action === "regional-sharing-access-command.v1" && item.detail === "REGIONAL_SHARING_AUTHORIZATION_REVOKED"
  ), true);
});
