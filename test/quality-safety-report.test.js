const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildQualitySafetyReport, renderMarkdown } = require("../scripts/quality-safety-report");

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
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

test("quality safety report covers boundaries, reuse and routes", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildQualitySafetyReport({ data });
  assert.equal(report.ok, true);
  assert.equal(report.summary.modeledBoundaries, report.summary.boundaries);
  assert.equal(report.collections.every((item) => item.present && item.rows > 0), true);
  assert.equal(report.reusedCollections.some((item) => item.collection === "diagnosticReports" && item.present), true);
  assert.equal(report.reusedCollections.some((item) => item.collection === "countyMutualRecognitionRecords" && item.present), true);
  assert.equal(report.reusedCollections.some((item) => item.collection === "securityEvents" && item.present), true);
  assert.equal(report.routes.every((item) => item.present), true);
  assert.match(renderMarkdown(report), /Medical quality and safety supervision report/);
  assert.match(renderMarkdown(report), /mutual-recognition-qc/);
});

test("quality safety API supports dashboard, dispatch, feedback and review", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-safety-test-"));
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
  const token = commissionLogin.body.token;

  const dashboard = await api(baseUrl, "/api/quality-safety/dashboard", authorized(token));
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.summary.issues >= 3, true);
  assert.equal(dashboard.body.reusedCollections.some((item) => item.collection === "hospitalInteroperabilityFunctions"), true);

  const issue = dashboard.body.issues.find((item) => item.id === "qse-path-001") || dashboard.body.issues[0];
  const dispatch = await api(baseUrl, `/api/quality-safety/issues/${encodeURIComponent(issue.id)}/dispatch`, authorized(token, {
    method: "POST",
    body: JSON.stringify({
      ownerRole: "institution",
      owner: "Site quality office",
      requirement: "Submit correction evidence and department sign-off."
    })
  }));
  assert.equal(dispatch.response.status, 201);
  assert.equal(dispatch.body.status, "dispatched");

  const institutionLogin = await login(baseUrl, "hospital");
  assert.equal(institutionLogin.response.status, 200);
  const institutionDashboard = await api(baseUrl, "/api/quality-safety/dashboard", authorized(institutionLogin.body.token));
  assert.equal(institutionDashboard.response.status, 200);
  assert.equal(institutionDashboard.body.role, "institution");
  const forbiddenDispatch = await api(baseUrl, `/api/quality-safety/issues/${encodeURIComponent(issue.id)}/dispatch`, authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ ownerRole: "institution", requirement: "Should be forbidden." })
  }));
  assert.equal(forbiddenDispatch.response.status, 403);

  const countyLogin = await login(baseUrl, "county");
  assert.equal(countyLogin.response.status, 200);
  const countyDashboard = await api(baseUrl, "/api/quality-safety/dashboard", authorized(countyLogin.body.token));
  assert.equal(countyDashboard.response.status, 200);
  assert.equal(countyDashboard.body.role, "county");

  const feedback = await api(baseUrl, `/api/quality-safety/rectifications/${encodeURIComponent(dispatch.body.id)}/feedback`, authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ content: "Evidence uploaded.", attachments: ["qc-evidence"] })
  }));
  assert.equal(feedback.response.status, 200);
  assert.equal(feedback.body.status, "feedback_submitted");
  assert.equal(feedback.body.feedback.length, 1);

  const review = await api(baseUrl, `/api/quality-safety/rectifications/${encodeURIComponent(dispatch.body.id)}/review`, authorized(token, {
    method: "POST",
    body: JSON.stringify({ decision: "approved", comment: "Evidence accepted." })
  }));
  assert.equal(review.response.status, 200);
  assert.equal(review.body.status, "closed");

  const audit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(token));
  assert.equal(audit.response.status, 200);
  assert.equal(JSON.stringify(audit.body).includes("quality-safety review"), true);
});
