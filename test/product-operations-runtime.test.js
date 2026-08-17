"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildPlatformProductOperationsCockpit,
  projectProductOperationsCockpit
} = require("../src/platform/productization/product-operations-runtime");

const PROGRAM = Object.freeze({
  schemaVersion: "product-operations-program-v1",
  requiredSections: ["work-items", "frontend", "monitoring", "nonfunctional", "regional-replication"],
  minimumProjectedWorkItems: 0,
  maximumVisibleWorkItems: 2,
  frontendAsset: { file: "product-operations-ui.js", maximumBytes: 12000, maximumLines: 250 },
  minimumReplicationSites: 1,
  requiredMonitoringChecks: ["monitoring:routes"],
  externalBlockers: ["signed-site-acceptance-pending"]
});

function evidence() {
  return {
    monitoring: {
      ok: true,
      productionReady: false,
      status: "local-control-ready",
      summary: { routes: 5, controls: 6, blockers: 1 },
      checks: [{ id: "monitoring:routes", passed: true, probeBody: "patient-payload-must-not-project" }],
      endpoint: "https://secret.example/health",
      credential: "must-not-project"
    },
    replication: {
      ok: true,
      technicalReady: true,
      productionReady: false,
      sites: [{
        siteId: "validation-site",
        regionCode: "990001",
        stage: "validation",
        deploymentClass: "test",
        host: "secret.internal",
        path: "C:/patient-payload-must-not-project",
        credential: "must-not-project"
      }]
    }
  };
}

test("runtime cockpit exposes allowlisted operational metadata and remains fail closed", () => {
  const local = evidence();
  const report = buildPlatformProductOperationsCockpit({
    platformWorkItems: [{
      id: "wi-safe-runtime-001",
      sourceRefDigest: "sha256:source",
      sourceCollection: "publicHealthCommandTasks",
      domain: "public-health",
      label: "患者张三高血压随访",
      sourceStatus: "pending",
      sourceState: "open",
      priority: "high",
      dueAt: "",
      status: "queued",
      assigneeRole: "",
      version: 0,
      latestEvidenceRef: "",
      updatedAt: "2026-08-17T08:00:00.000Z"
    }]
  }, {
    program: PROGRAM,
    now: "2026-08-17T08:00:00.000Z",
    nonfunctional: {
      ok: true,
      productionReady: false,
      summary: { assets: 6, assetsWithinBudget: 6, testFiles: 400, routeFiles: 60 },
      checks: [{ id: "nonfunctional:frontendBudgets", passed: true, detail: "C:/secret" }]
    },
    ...local
  });
  assert.equal(report.schemaVersion, "platform-product-operations-cockpit-v1");
  assert.equal(report.productionReady, false);
  assert.equal(report.siteReady, false);
  assert.equal(report.containsBusinessPayload, false);
  assert.equal(report.containsCredentials, false);
  assert.equal(report.cockpit.workItems[0].label, "平台运行事项");
  assert.deepEqual(report.replication.sites[0], {
    siteId: "validation-site",
    regionCode: "990001",
    stage: "validation",
    deploymentClass: "test",
    productionReady: false
  });
  assert.doesNotMatch(JSON.stringify(report), /张三|patient-payload|secret\.internal|C:\/|credential|probeBody|endpoint/);
});

test("runtime cockpit rejects non-allowlisted labels, states and infrastructure identifiers", () => {
  const report = projectProductOperationsCockpit({
    generatedAt: "2026-08-17T08:00:00.000Z",
    frontend: {
      status: "local-control-ready",
      cards: [{ id: "open-work-items", label: "patient-name", value: 1, state: "ready" }, { id: "secret-card", label: "secret", value: 9, state: "ready" }],
      sections: [{ id: "monitoring", state: "ready" }, { id: "secret", state: "ready" }],
      workItems: [{ id: "wi-safe", label: "patient-name", domain: "public-health", status: "leaking", priority: "secret", version: 1 }]
    },
    monitoring: { status: "C:/monitor", requiredChecks: [{ id: "C:/probe", passed: true }] },
    nonfunctional: {},
    replication: { sites: [{ siteId: "C:/host", regionCode: "host-name", stage: "unknown", deploymentClass: "unknown" }] }
  });
  assert.equal(report.cockpit.cards.length, 1);
  assert.equal(report.cockpit.cards[0].label, "开放事项");
  assert.equal(report.cockpit.sections.length, 1);
  assert.equal(report.cockpit.workItems[0].label, "平台运行事项");
  assert.equal(report.cockpit.workItems[0].status, "blocked");
  assert.equal(report.cockpit.workItems[0].priority, "blocked");
  assert.equal(report.monitoring.status, "redacted");
  assert.equal(report.monitoring.requiredChecks[0].id, "redacted");
  assert.equal(report.replication.sites[0].siteId, "redacted");
  assert.equal(report.replication.sites[0].regionCode, "redacted");
  assert.equal(report.productionReady, false);
});

test("missing local evidence fails closed without exposing error details", () => {
  const report = buildPlatformProductOperationsCockpit({}, {
    program: PROGRAM,
    monitoring: { ok: false, productionReady: false, status: "blocked", checks: [] }
  });
  assert.equal(report.ok, false);
  assert.equal(report.localControlReady, false);
  assert.equal(report.replication.summary.sites, 0);
  assert.equal(report.productionReady, false);
});
