const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildQualitySafetyInterfaceStandard, renderMarkdown, writeOutput } = require("../scripts/quality-safety-interface-standard");

const ROOT = path.resolve(__dirname, "..");

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
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

test("quality safety institution interface standard covers format security and examples", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildQualitySafetyInterfaceStandard({ data });
  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.standard.documentFormat.requiredChapters.length >= 8, true);
  assert.equal(report.standard.security.requiredHeaders.includes("X-Signature"), true);
  assert.equal(report.standard.interfaces.length >= 6, true);
  assert.equal(report.standard.interfaces.some((item) => item.id === "qs-critical-value-alert-v1" && item.samplePayload.payload.reportId), true);
  assert.equal(report.standard.interfaces.some((item) => item.targetCollection === "qualityRectificationOrders"), true);
  assert.equal(report.standard.acceptanceChecklist.some((item) => item.id === "cutover-signoff"), true);
  assert.equal(report.standard.documentControl.title, "\u533b\u7597\u8d28\u91cf\u4e0e\u5b89\u5168\u76d1\u7ba1\u5e73\u53f0\u533b\u7597\u673a\u6784\u63a5\u53e3\u6587\u6863\u6807\u51c6");
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Document Format/);
  assert.match(markdown, /Interface List/);
  assert.match(markdown, /HMAC-SHA256/);
});

test("quality safety interface standard writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "quality-safety-interface-standard-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildQualitySafetyInterfaceStandard();
  writeOutput(report, {
    output: path.join("tmp", "quality-safety-interface-standard-test", "standard.json"),
    markdown: path.join("tmp", "quality-safety-interface-standard-test", "standard.md")
  });
  const json = JSON.parse(fs.readFileSync(path.join(outputDir, "standard.json"), "utf8"));
  const markdown = fs.readFileSync(path.join(outputDir, "standard.md"), "utf8");
  assert.equal(json.ok, true);
  assert.match(markdown, /Acceptance Checklist/);
});

test("quality safety interface standard API is available to regulator and institution roles", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-safety-interface-standard-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
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

  const commissionLogin = await login(baseUrl, "health");
  assert.equal(commissionLogin.response.status, 200);
  const commissionStandard = await api(baseUrl, "/api/quality-safety/interface-standard", authorized(commissionLogin.body.token));
  assert.equal(commissionStandard.response.status, 200);
  assert.equal(commissionStandard.body.ok, true);
  assert.equal(commissionStandard.body.standard.interfaces.some((item) => item.id === "qs-mutual-recognition-qc-v1"), true);

  const institutionLogin = await login(baseUrl, "hospital");
  assert.equal(institutionLogin.response.status, 200);
  const institutionStandard = await api(baseUrl, "/api/quality-safety/interface-standard", authorized(institutionLogin.body.token));
  assert.equal(institutionStandard.response.status, 200);
  assert.equal(institutionStandard.body.standard.security.requiredHeaders.includes("X-Idempotency-Key"), true);

  const citizenLogin = await login(baseUrl, "citizen");
  assert.equal(citizenLogin.response.status, 200);
  const forbidden = await api(baseUrl, "/api/quality-safety/interface-standard", authorized(citizenLogin.body.token));
  assert.equal(forbidden.response.status, 403);
});
