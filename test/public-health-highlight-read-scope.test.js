"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPublicHealthHighlights } = require("../public-health-highlights-service");
const { createRouteSegment } = require("../src/http/routes/public-health/public-health-operations");

function signal(id, sourceOrgCode, overrides = {}) {
  return {
    id,
    ruleId: "phhr-rule-fever-cluster",
    sourceType: "临床症候群",
    sourceSystem: "read-scope-contract",
    metric: "fever-respiratory-cases",
    value: 9,
    baseline: 2,
    unit: "cases",
    region: `region-${id}`,
    institution: `institution-${id}`,
    observedAt: "2026-08-26T08:00:00.000Z",
    location: { x: 40, y: 50 },
    qualityStatus: "verified",
    status: "evaluated",
    evidenceRefs: [`evidence-${id}`],
    commandKeyHash: `command-hash-${id}`,
    requestDigest: `request-digest-${id}`,
    ...(sourceOrgCode ? { sourceOrgCode } : {}),
    ...overrides
  };
}

function alert(id, signalIds, overrides = {}) {
  return {
    id,
    ruleId: "phhr-rule-fever-cluster",
    title: `alert-${id}`,
    severity: "high",
    status: "open",
    region: `region-${id}`,
    sourceTypes: ["临床症候群"],
    signalIds,
    triggerCount: 9,
    threshold: 5,
    confidence: 0.9,
    evidenceRefs: [`alert-evidence-${id}`],
    recommendedAction: "review",
    actionHistory: [],
    ...overrides
  };
}

function createHarness(options = {}) {
  const state = structuredClone(options.initialState || {});
  const calls = { appends: [], authorization: [], builds: [], reads: 0, sends: [] };
  const user = options.user || {
    username: "health",
    name: "卫健委管理员",
    role: "commission",
    orgCode: "ORG-HEALTH-DL",
    orgType: "health_admin"
  };
  const segment = createRouteSegment({
    appendSecurityEvent(entry) {
      calls.appends.push(structuredClone(entry));
    },
    buildPublicHealthHighlights({ data }) {
      const value = buildPublicHealthHighlights({ data });
      calls.builds.push({ beforeProjection: structuredClone(value), value });
      return value;
    },
    readDatabase() {
      calls.reads += 1;
      return structuredClone(state);
    },
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return options.authorized === false ? null : user;
    },
    sendJson(res, status, body) {
      calls.sends.push({ status, body: structuredClone(body) });
      res.status = status;
      res.body = body;
    }
  });
  return {
    calls,
    state,
    async request() {
      const res = {};
      const handled = await segment.handle(
        { method: "GET", headers: {} },
        res,
        new URL("http://platform.test/api/public-health/highlights")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("public health highlights GET authenticates before reading state", async () => {
  const harness = createHarness({ authorized: false });
  const response = await harness.request();

  assert.deepEqual(harness.calls.authorization, [{
    roles: ["commission"],
    route: "/api/public-health/highlights"
  }]);
  assert.equal(harness.calls.reads, 0);
  assert.equal(harness.calls.appends.length, 0);
  assert.equal(harness.calls.sends.length, 0);
  assert.deepEqual(response, {});

  for (const user of [
    { name: "未知组织", role: "commission", orgCode: "ORG-OTHER", orgType: "other" },
    { name: "缺少组织", role: "commission", orgCode: " ", orgType: "district" }
  ]) {
    const denied = createHarness({ user });
    const deniedResponse = await denied.request();
    assert.equal(deniedResponse.status, 403, user.name);
    assert.equal(deniedResponse.body.code, "PUBLIC_HEALTH_HIGHLIGHT_SCOPE_FORBIDDEN", user.name);
    assert.equal(denied.calls.reads, 0, user.name);
    assert.equal(denied.calls.appends.length, 1, user.name);
    assert.equal(denied.calls.appends[0].result, "denied", user.name);
  }
});

test("district public health highlights expose only the signal allowlist and fail closed for alerts", async () => {
  const initialState = {
    publicHealthSignals: [
      signal("own-signal", "org-dist-zs"),
      signal("hospital-signal", "h000003", { qualityStatus: "manual-review" }),
      signal("foreign-signal", "H000001"),
      signal("unscoped-signal", "", { evidenceRefs: ["unscoped-secret-marker"] })
    ],
    publicHealthAlerts: [
      alert("visible-alert", ["own-signal", "hospital-signal"], { severity: "critical" }),
      alert("mixed-alert", ["own-signal", "foreign-signal"], { evidenceRefs: ["mixed-secret-marker"] }),
      alert("empty-alert", [])
    ],
    securityEvents: []
  };
  const harness = createHarness({
    initialState,
    user: {
      username: "district",
      name: "区县管理员",
      role: "commission",
      orgCode: " ORG-DIST-ZS ",
      orgType: "district",
      publicHealthHospitalCodes: [" h000003 "]
    }
  });

  const response = await harness.request();
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.triggerCenter.signals.map((item) => item.id).sort(),
    ["hospital-signal", "own-signal"]
  );
  assert.deepEqual(response.body.triggerCenter.alerts.map((item) => item.id), ["visible-alert"]);
  assert.deepEqual(response.body.mapBoard.nodes.map((item) => item.id).sort(), ["hospital-signal", "own-signal", "visible-alert"]);
  assert.deepEqual(response.body.mapBoard.regions.map((item) => item.name).sort(), [
    "region-hospital-signal",
    "region-own-signal",
    "region-visible-alert"
  ]);
  assert.deepEqual(response.body.mapBoard.resourceSummary, []);
  assert.deepEqual(response.body.mapBoard.taskSummary, []);
  assert.deepEqual(response.body.commandCenter, {
    tasks: [], openTasks: [], resources: [], readyResources: [], escalationQueue: []
  });
  assert.deepEqual(response.body.aiCenter.reviews, []);
  assert.deepEqual(response.body.evidenceCenter.records, []);
  assert.deepEqual(response.body.evidenceCenter.summary, { score: 0, verified: 0, pending: 0, total: 0 });
  assert.equal(response.body.summary.signals, 2);
  assert.equal(response.body.summary.activeAlerts, 1);
  assert.equal(response.body.summary.criticalAlerts, 1);
  assert.equal(response.body.summary.openTasks, 0);
  assert.equal(response.body.triggerCenter.quality.verifiedSignals, 1);
  assert.equal(response.body.triggerCenter.quality.reviewSignals, 1);
  assert.deepEqual(response.body.triggerCenter.quality.sourceTypes, ["临床症候群"]);
  assert.doesNotMatch(JSON.stringify(response.body), /commandKeyHash|requestDigest|foreign-signal|unscoped-signal|mixed-secret-marker|unscoped-secret-marker/);
  assert.equal(harness.calls.reads, 1);
  assert.equal(harness.calls.appends.length, 1);
  assert.equal(harness.calls.appends[0].detail, "5 capabilities / 1 active alerts / 0 open tasks");
  assert.deepEqual(harness.calls.builds[0].value, harness.calls.builds[0].beforeProjection);
});

test("city and health-admin retain full highlights without internal signal command metadata", async () => {
  for (const user of [
    { name: "市级管理员", role: "commission", orgCode: "ORG-CITY-DL", orgType: "city" },
    { name: "卫健委管理员", role: "commission", orgCode: "ORG-HEALTH-DL", orgType: "health_admin" }
  ]) {
    const harness = createHarness({
      user,
      initialState: {
        publicHealthSignals: [signal("custom-business-signal", "H000001")],
        publicHealthAlerts: [alert("custom-business-alert", ["custom-business-signal"])],
        securityEvents: []
      }
    });

    const response = await harness.request();
    assert.equal(response.status, 200, user.orgType);
    assert.equal(response.body.triggerCenter.signals.some((item) => item.id === "custom-business-signal"), true, user.orgType);
    assert.equal(response.body.triggerCenter.alerts.some((item) => item.id === "custom-business-alert"), true, user.orgType);
    assert.equal(response.body.commandCenter.tasks.length > 0, true, user.orgType);
    assert.equal(response.body.aiCenter.reviews.length > 0, true, user.orgType);
    assert.equal(response.body.evidenceCenter.records.length > 0, true, user.orgType);
    assert.equal(response.body.summary.signals, response.body.triggerCenter.signals.length, user.orgType);
    assert.equal(response.body.summary.activeAlerts, response.body.triggerCenter.alerts.length, user.orgType);
    assert.doesNotMatch(JSON.stringify(response.body), /commandKeyHash|requestDigest/, user.orgType);
    assert.equal(harness.calls.reads, 1, user.orgType);
    assert.equal(harness.calls.appends.length, 1, user.orgType);
    assert.deepEqual(harness.calls.builds[0].value, harness.calls.builds[0].beforeProjection, user.orgType);
  }
});
