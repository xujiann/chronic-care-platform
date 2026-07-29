"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
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

async function login(baseUrl, username) {
  return api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" })
  });
}

test("digital hospital public health coordination API persists an independently reviewed incident", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "digital-hospital-public-health-api-"));
  const databaseFile = path.join(dataDir, "db.json");
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), databaseFile);
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    delete process.env.DATA_DIR;
    delete process.env.STORAGE_ENGINE;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const anonymous = await api(baseUrl, "/api/digital-hospital/public-health/coordination");
  assert.equal(anonymous.response.status, 401);

  const cityLogin = await login(baseUrl, "city");
  const healthLogin = await login(baseUrl, "health");
  assert.equal(cityLogin.response.status, 200);
  assert.equal(healthLogin.response.status, 200);
  const cityToken = cityLogin.body.token;
  const healthToken = healthLogin.body.token;

  const initial = await api(
    baseUrl,
    "/api/digital-hospital/public-health/coordination",
    authorized(cityToken)
  );
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.summary.totalLanes, 8);
  assert.equal(initial.body.summary.filteredIncidents >= 4, true);
  assert.equal(initial.body.summary.overdueIncidents >= 1, true);
  assert.equal(initial.body.productionBoundary.productionReady, false);
  const linkedSeed = initial.body.coordination.incidents.find((item) => item.id === "PHE-20260728-003");
  assert.equal(linkedSeed.professionalAssociation.event.id, "phe-infectious-001");
  assert.equal(linkedSeed.professionalAssociation.exchange.runId, "phxr-direct-report-001");
  assert.equal(linkedSeed.professionalAssociation.endpointProbe.connectivityVerified, false);
  assert.match(linkedSeed.professionalAssociation.endpointProbe.blockerCode, /endpoint|probe/);

  const filtered = await api(
    baseUrl,
    "/api/digital-hospital/public-health/coordination?hospitalCode=H000003&status=%E5%A4%84%E7%BD%AE%E4%B8%AD",
    authorized(cityToken)
  );
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.body.summary.filteredIncidents, 1);
  assert.equal(filtered.body.coordination.incidents[0].hospitalCode, "H000003");
  assert.equal(filtered.body.statistics.byStatus["处置中"], 1);

  const escalated = await api(
    baseUrl,
    "/api/digital-hospital/public-health/incidents/PHE-20260728-003/actions",
    authorized(cityToken, {
      method: "POST",
      body: JSON.stringify({
        action: "escalate-overdue",
        expectedRevision: 1,
        note: "P0事件已超时并升级到联合指挥"
      })
    })
  );
  assert.equal(escalated.response.status, 200);
  assert.equal(escalated.body.incident.status, "待核查");
  assert.equal(escalated.body.incident.revision, 2);
  assert.equal(escalated.body.incident.escalation.level, "red");
  assert.equal(escalated.body.action.action, "escalate-overdue");

  const csvResponse = await fetch(
    `${baseUrl}/api/digital-hospital/public-health/incidents/export?format=csv&hospitalCode=H000001`,
    authorized(cityToken)
  );
  const csv = await csvResponse.text();
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get("content-type"), /text\/csv/);
  assert.match(csv, /事件编号/);
  assert.match(csv, /PHE-20260728-003/);
  assert.doesNotMatch(csv, /must-not-be-persisted|privateKey|rawPayload/i);

  const invalidExport = await api(
    baseUrl,
    "/api/digital-hospital/public-health/incidents/export?format=xlsx",
    authorized(cityToken)
  );
  assert.equal(invalidExport.response.status, 400);
  assert.equal(invalidExport.body.code, "PUBLIC_HEALTH_EXPORT_FORMAT_INVALID");

  const rejected = await api(
    baseUrl,
    "/api/digital-hospital/public-health/incidents",
    authorized(cityToken, {
      method: "POST",
      body: JSON.stringify({
        id: "PHE-API-SECRET",
        laneId: "infectious-reporting",
        title: "敏感字段拒绝测试",
        hospitalCode: "H000001",
        owner: "疾控与医政联络组",
        dueAt: "2026-07-30T12:00:00.000Z",
        note: "不得写入凭据",
        credential: "must-not-be-persisted"
      })
    })
  );
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.code, "PUBLIC_HEALTH_SENSITIVE_FIELD_REJECTED");

  const created = await api(
    baseUrl,
    "/api/digital-hospital/public-health/incidents",
    authorized(cityToken, {
      method: "POST",
      body: JSON.stringify({
        id: "PHE-API-001",
        laneId: "infectious-reporting",
        title: "生产联调回执超时",
        level: "P0",
        source: "连续探测",
        hospitalCode: "H000001",
        owner: "疾控与医政联络组",
        dueAt: "2026-07-30T12:00:00.000Z",
        note: "已登记并等待责任组核查"
      })
    })
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.body.incident.revision, 1);
  assert.equal(created.body.incident.status, "待核查");

  const advance = async (token, expectedRevision, action, note) => api(
    baseUrl,
    "/api/digital-hospital/public-health/incidents/PHE-API-001/actions",
    authorized(token, {
      method: "POST",
      body: JSON.stringify({ expectedRevision, action, note })
    })
  );

  const started = await advance(cityToken, 1, "start-handling", "核查确认异常并开始处置");
  assert.equal(started.response.status, 200);
  assert.equal(started.body.incident.status, "处置中");

  const submitted = await advance(cityToken, 2, "submit-review", "回执已补齐并提交独立复核");
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.body.incident.status, "待复核");

  const selfReview = await advance(cityToken, 3, "verify-close", "提交人尝试关闭事件");
  assert.equal(selfReview.response.status, 409);
  assert.equal(selfReview.body.code, "PUBLIC_HEALTH_INDEPENDENT_REVIEW_REQUIRED");

  const closed = await advance(healthToken, 3, "verify-close", "卫健委独立复核通过并关闭");
  assert.equal(closed.response.status, 200);
  assert.equal(closed.body.incident.status, "已关闭");
  assert.equal(closed.body.incident.revision, 4);
  assert.equal(closed.body.board.productionBoundary.productionReady, false);

  const persisted = await api(
    baseUrl,
    "/api/digital-hospital/public-health/coordination",
    authorized(healthToken)
  );
  assert.equal(
    persisted.body.coordination.incidents.find((item) => item.id === "PHE-API-001").status,
    "已关闭"
  );
  assert.equal(
    persisted.body.coordination.incidentActions.filter((item) => item.incidentId === "PHE-API-001").length,
    4
  );
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(databaseFile, "utf8"))).includes("must-not-be-persisted"), false);
});
