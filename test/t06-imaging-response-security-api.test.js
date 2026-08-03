"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const FORBIDDEN_KEYS = /^(?:(?:object|physical|storage)[_-]?path|object[_-]?key|access[_-]?url|signed[_-]?url|(?:access|refresh)?[_-]?token|authorization|api[_-]?key|secrets?|passwords?|credentials?|credential[_-]?ref|private[_-]?key|signatures?|signing[_-]?keys?|signature[_-]?keys?|certificate[_-]?fingerprint|endpoint|base[_-]?url|bucket(?:Name)?|containerName)$/i;

function assertPublicBoundary(value, pathName = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicBoundary(item, `${pathName}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.doesNotMatch(key, FORBIDDEN_KEYS, `${pathName}.${key} is a forbidden public field`);
    assertPublicBoundary(item, `${pathName}.${key}`);
  }
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

test("real imaging APIs keep internal storage and share secrets behind the response boundary", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "t06-imaging-security-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = ["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "t06-imaging-response-security-session-secret-2026",
    SESSION_STORE: "memory"
  });

  const { server, startServer, stopServer } = require("../server");
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username: "health", password: "123456" })
  });
  assert.equal(login.response.status, 200);

  const dashboard = await request(baseUrl, "/api/imaging-cloud?residentId=r1", login.body.token);
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.studies[0].id, "ics-ct-r1-20260521");
  assertPublicBoundary(dashboard.body);
  assert.doesNotMatch(JSON.stringify(dashboard.body), /liaoning-imaging-cloud|IMG-SHARE-DEMO-R1/);

  const productionCenter = await request(baseUrl, "/api/imaging-cloud/production-center", login.body.token);
  assert.equal(productionCenter.response.status, 200);
  assertPublicBoundary(productionCenter.body);

  const shared = await request(baseUrl, "/api/imaging-cloud/studies/ics-ct-r1-20260521/share", login.body.token, {
    method: "POST",
    body: JSON.stringify({ validDays: 7, channel: "governed-link" })
  });
  assert.equal(shared.response.status, 201);
  assert.match(shared.body.id, /^ics-share-/);
  assert.equal(shared.body.studyId, "ics-ct-r1-20260521");
  assert.equal(shared.body.status, "active");
  assert.equal("token" in shared.body, false);
  assertPublicBoundary(shared.body);

  const viewer = await request(baseUrl, "/api/imaging-cloud/studies/ics-ct-r1-20260521/viewer", login.body.token);
  assert.equal(viewer.response.status, 200);
  assert.equal(viewer.body.studyId, "ics-ct-r1-20260521");
  assert.match(viewer.body.viewerUrl, /StudyInstanceUIDs=1\.2\.156/);
  assert.doesNotMatch(viewer.body.viewerUrl, /access_token|signature|password/i);

  await stopServer();
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
  const internalShare = persisted.imageCloudShares.find((item) => item.id === shared.body.id);
  assert.match(internalShare.token, /^IMG-/);
  assert.match(persisted.imageCloudStudies[0].objectPath, /^oss:\/\//);
});
