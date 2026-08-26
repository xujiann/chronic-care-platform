"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPublicHealthHighlights } = require("../public-health-highlights-service");
const { buildPublicHealthSystem: buildPublicHealthSystemView } = require("../scripts/public-health-readiness");
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

function scopedState() {
  return {
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
}

function assertDistrictHighlightsProjection(highlights) {
  assert.deepEqual(
    highlights.triggerCenter.signals.map((item) => item.id).sort(),
    ["hospital-signal", "own-signal"]
  );
  assert.deepEqual(highlights.triggerCenter.alerts.map((item) => item.id), ["visible-alert"]);
  assert.deepEqual(highlights.mapBoard.nodes.map((item) => item.id).sort(), ["hospital-signal", "own-signal", "visible-alert"]);
  assert.deepEqual(highlights.mapBoard.regions.map((item) => item.name).sort(), [
    "region-hospital-signal",
    "region-own-signal",
    "region-visible-alert"
  ]);
  assert.deepEqual(highlights.mapBoard.resourceSummary, []);
  assert.deepEqual(highlights.mapBoard.taskSummary, []);
  assert.deepEqual(highlights.commandCenter, {
    tasks: [], openTasks: [], resources: [], readyResources: [], escalationQueue: []
  });
  assert.deepEqual(highlights.aiCenter.reviews, []);
  assert.deepEqual(highlights.evidenceCenter.records, []);
  assert.deepEqual(highlights.evidenceCenter.summary, { score: 0, verified: 0, pending: 0, total: 0 });
  assert.equal(highlights.summary.signals, 2);
  assert.equal(highlights.summary.activeAlerts, 1);
  assert.equal(highlights.summary.criticalAlerts, 1);
  assert.equal(highlights.summary.openTasks, 0);
  assert.equal(highlights.triggerCenter.quality.verifiedSignals, 1);
  assert.equal(highlights.triggerCenter.quality.reviewSignals, 1);
  assert.deepEqual(highlights.triggerCenter.quality.sourceTypes, ["临床症候群"]);
  assert.doesNotMatch(JSON.stringify(highlights), /commandKeyHash|requestDigest|foreign-signal|unscoped-signal|mixed-secret-marker|unscoped-secret-marker/);
}

function createHarness(options = {}) {
  const state = structuredClone(options.initialState || {});
  const calls = { appends: [], authorization: [], builds: [], reads: 0, sends: [], systemBuilds: [] };
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
      if (options.auditError) throw options.auditError;
    },
    buildPublicHealthHighlights({ data }) {
      if (options.highlightBuildError) throw options.highlightBuildError;
      const value = buildPublicHealthHighlights({ data });
      calls.builds.push({ beforeProjection: structuredClone(value), value });
      return value;
    },
    buildPublicHealthSystem({ data }) {
      if (options.systemBuildError) throw options.systemBuildError;
      const value = buildPublicHealthSystemView({ data });
      calls.systemBuilds.push({ data: structuredClone(data), value: structuredClone(value) });
      return value;
    },
    readDatabase() {
      calls.reads += 1;
      if (options.readError) throw options.readError;
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
    async request(pathname = "/api/public-health/highlights") {
      const res = {};
      const handled = await segment.handle(
        { method: "GET", headers: {} },
        res,
        new URL(`http://platform.test${pathname}`)
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

test("public health system authenticates and rejects unsupported organization scope before state access", async () => {
  const identityDenied = createHarness({ authorized: false });
  const identityResponse = await identityDenied.request("/api/public-health/system");
  assert.deepEqual(identityDenied.calls.authorization, [{
    roles: ["commission"],
    route: "/api/public-health/system"
  }]);
  assert.equal(identityDenied.calls.reads, 0);
  assert.equal(identityDenied.calls.builds.length, 0);
  assert.equal(identityDenied.calls.systemBuilds.length, 0);
  assert.equal(identityDenied.calls.appends.length, 0);
  assert.equal(identityDenied.calls.sends.length, 0);
  assert.deepEqual(identityResponse, {});

  for (const user of [
    { name: "未知组织", role: "commission", orgCode: "ORG-OTHER", orgType: "other" },
    { name: "缺少组织", role: "commission", orgCode: " ", orgType: "district" }
  ]) {
    const denied = createHarness({ user });
    const response = await denied.request("/api/public-health/system");
    assert.equal(response.status, 403, user.name);
    assert.equal(response.body.code, "PUBLIC_HEALTH_SYSTEM_SCOPE_FORBIDDEN", user.name);
    assert.equal(denied.calls.reads, 0, user.name);
    assert.equal(denied.calls.builds.length, 0, user.name);
    assert.equal(denied.calls.systemBuilds.length, 0, user.name);
    assert.deepEqual(denied.calls.appends, [{
      actor: user.name,
      role: user.role,
      action: "public-health-system",
      target: "/api/public-health/system",
      result: "denied",
      detail: "PUBLIC_HEALTH_SYSTEM_SCOPE_FORBIDDEN"
    }], user.name);
  }

  const auditFailure = createHarness({
    user: { name: "未知组织", role: "commission", orgCode: "ORG-OTHER", orgType: "other" },
    auditError: new Error("private audit failure detail")
  });
  const auditResponse = await auditFailure.request("/api/public-health/system");
  assert.equal(auditResponse.status, 500);
  assert.equal(auditResponse.body.code, "PUBLIC_HEALTH_SYSTEM_AUDIT_FAILED");
  assert.doesNotMatch(JSON.stringify(auditResponse.body), /private|failure detail/);
  assert.equal(auditFailure.calls.reads, 0);
});

test("district public health highlights expose only the signal allowlist and fail closed for alerts", async () => {
  const harness = createHarness({
    initialState: scopedState(),
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
  assertDistrictHighlightsProjection(response.body);
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

test("district public health system embeds the allowlisted fail-closed highlights projection", async () => {
  const harness = createHarness({
    initialState: scopedState(),
    user: {
      username: "district",
      name: "区县管理员",
      role: "commission",
      orgCode: " ORG-DIST-ZS ",
      orgType: "district",
      publicHealthHospitalCodes: [" h000003 "]
    }
  });

  const response = await harness.request("/api/public-health/system");
  assert.equal(response.status, 200);
  assertDistrictHighlightsProjection(response.body.highlights);
  assert.equal(response.body.summary.highlightCapabilities, response.body.highlights.summary.capabilities);
  assert.equal(response.body.summary.highlightActiveAlerts, 1);
  assert.equal(response.body.summary.highlightOpenTasks, 0);
  assert.equal(response.body.summary.highlightEvidenceScore, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /commandKeyHash|requestDigest|foreign-signal|unscoped-signal|mixed-secret-marker|unscoped-secret-marker/);
  assert.equal(harness.calls.reads, 1);
  assert.equal(harness.calls.systemBuilds.length, 1);
  assert.equal(harness.calls.builds.length, 1);
  assert.equal(harness.calls.appends.length, 1);
  assert.equal(harness.calls.appends[0].action, "public-health-system");
  assert.equal(harness.calls.appends[0].result, "allowed");
});

test("public health system redacts allowed-path read, build, and audit failures", async () => {
  for (const [failure, options] of [
    ["read", { readError: new Error("private database path secret") }],
    ["system build", { systemBuildError: new Error("private system builder secret") }],
    ["highlight build", { highlightBuildError: new Error("private highlight builder secret") }],
    ["allowed audit", { auditError: new Error("private audit provider secret") }]
  ]) {
    const harness = createHarness(options);
    const response = await harness.request("/api/public-health/system");

    assert.equal(response.status, 500, failure);
    assert.deepEqual(response.body, {
      error: "Service Unavailable",
      code: "PUBLIC_HEALTH_SYSTEM_READ_FAILED",
      message: "public health system read failed"
    }, failure);
    assert.doesNotMatch(JSON.stringify(response.body), /private|secret|database path|builder|provider/, failure);
  }
});

test("city and health-admin system retain existing system fields while redacting embedded signal metadata", async () => {
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

    const response = await harness.request("/api/public-health/system");
    const builtSystem = harness.calls.systemBuilds[0].value;
    assert.equal(response.status, 200, user.orgType);
    assert.deepEqual(response.body, {
      ...builtSystem,
      highlights: response.body.highlights,
      summary: {
        ...builtSystem.summary,
        highlightCapabilities: response.body.highlights.summary.capabilities,
        highlightActiveAlerts: response.body.highlights.summary.activeAlerts,
        highlightOpenTasks: response.body.highlights.summary.openTasks,
        highlightEvidenceScore: response.body.highlights.summary.evidenceScore
      }
    }, user.orgType);
    assert.equal(response.body.highlights.triggerCenter.signals.some((item) => item.id === "custom-business-signal"), true, user.orgType);
    assert.equal(response.body.highlights.triggerCenter.alerts.some((item) => item.id === "custom-business-alert"), true, user.orgType);
    assert.equal(response.body.highlights.commandCenter.tasks.length > 0, true, user.orgType);
    assert.equal(response.body.highlights.aiCenter.reviews.length > 0, true, user.orgType);
    assert.equal(response.body.highlights.evidenceCenter.records.length > 0, true, user.orgType);
    assert.equal(response.body.summary.highlightCapabilities, response.body.highlights.summary.capabilities, user.orgType);
    assert.equal(response.body.summary.highlightActiveAlerts, response.body.highlights.summary.activeAlerts, user.orgType);
    assert.equal(response.body.summary.highlightOpenTasks, response.body.highlights.summary.openTasks, user.orgType);
    assert.equal(response.body.summary.highlightEvidenceScore, response.body.highlights.summary.evidenceScore, user.orgType);
    assert.doesNotMatch(JSON.stringify(response.body), /commandKeyHash|requestDigest/, user.orgType);
    assert.equal(harness.calls.reads, 1, user.orgType);
    assert.equal(harness.calls.systemBuilds.length, 1, user.orgType);
    assert.equal(harness.calls.builds.length, 1, user.orgType);
  }
});
