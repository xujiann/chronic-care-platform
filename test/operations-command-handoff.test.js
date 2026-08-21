"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const clinicalContext = require("../src/http/runtime-contexts/clinical-specialties");
const platformContext = require("../src/http/runtime-contexts/platform-governance");
const { ROUTE_SUBDOMAINS } = require("../src/http/route-subdomains");
const { routeSourceFiles } = require("../src/http/runtime-source");
const { ROUTE_ORDER } = require("../src/http/routes");
const {
  createRouteSegment,
  ROUTE_SEGMENT_ID,
  SUBDOMAIN
} = require("../src/http/routes/platform-governance/operations-command");

const ROOT = path.resolve(__dirname, "..");
const TARGET_SOURCE = "src/http/routes/platform-governance/operations-command.js";
const COMMAND_DEPENDENCIES = Object.freeze([
  "appendOperationsIntegrationAudit",
  "applyDispatchStatusUpdate",
  "assertSignedOperationsPayload",
  "buildHospitalOperationsDashboard",
  "buildOperationsInterfaceMappingEvidence",
  "buildOperationsMobileDuty",
  "buildOperationsSiteJointPatrol",
  "buildPerformanceMonitoringEvidence",
  "collectJson",
  "createOperationsMobileDutyReminder",
  "integrationPayloadAllowedForInstitution",
  "normalizeDispatchAction",
  "normalizeHandoverSignoff",
  "normalizeOperationSnapshot",
  "normalizeReconciliationBatchItem",
  "randomUUID",
  "readDatabase",
  "requireApiRole",
  "sendJson",
  "writeDatabase"
]);
const COMMAND_PATHS = Object.freeze([
  "/api/operations/command-chains",
  "/api/operations/cutover-command",
  "/api/operations/cutover-command/actions",
  "/api/operations/dispatch",
  "/api/operations/dispatch/:id/status",
  "/api/operations/emergency-dispatch-loop",
  "/api/operations/emergency-dispatch-loop/actions",
  "/api/operations/go-live-gates",
  "/api/operations/go-live-gates/actions",
  "/api/operations/governance-export-package",
  "/api/operations/governance-report",
  "/api/operations/handover",
  "/api/operations/handover/owners",
  "/api/operations/handover/signoff",
  "/api/operations/integration/dispatch-feedback",
  "/api/operations/integration/reconciliation",
  "/api/operations/integration/snapshots",
  "/api/operations/intelligence",
  "/api/operations/interface-mapping",
  "/api/operations/mobile-duty",
  "/api/operations/mobile-duty/actions",
  "/api/operations/next-development-research",
  "/api/operations/performance-monitoring",
  "/api/operations/playbooks",
  "/api/operations/post-cutover-observation",
  "/api/operations/post-cutover-observation/actions",
  "/api/operations/production-hardening",
  "/api/operations/reconciliation/:id/review",
  "/api/operations/resource-pool",
  "/api/operations/site-joint-patrol",
  "/api/operations/site-joint-patrol/actions",
  "/api/operations/site-joint-tests"
]);

function createRuntime(overrides = {}) {
  return {
    ...Object.fromEntries(COMMAND_DEPENDENCIES.map((name) => [name, () => undefined])),
    ...overrides
  };
}

function relativeRouteSource(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

test("operations command handoff gives all 32 paths one T02 owner at the unchanged route slot", () => {
  const targetFile = path.join(ROOT, TARGET_SOURCE);
  const targetSource = fs.readFileSync(targetFile, "utf8");
  const declaredPaths = [...new Set(
    [...targetSource.matchAll(/"(\/api\/operations[^"]*)"/g)].map((match) => match[1])
  )].sort();

  assert.deepEqual(declaredPaths, COMMAND_PATHS);
  assert.equal(ROUTE_SEGMENT_ID, "platform-governance-13");
  assert.equal(SUBDOMAIN, "operations-command");
  assert.equal(ROUTE_SUBDOMAINS["platform-governance-13"], "operations-command");
  assert.equal(ROUTE_SUBDOMAINS["clinical-specialties-03"], undefined);
  assert.deepEqual(ROUTE_ORDER.slice(15, 18), [
    { domain: "platform-governance", id: "platform-governance-04" },
    { domain: "platform-governance", id: "platform-governance-13" },
    { domain: "shared", id: "shared-04" }
  ]);

  for (const apiPath of COMMAND_PATHS) {
    const owners = routeSourceFiles(ROOT)
      .filter((file) => fs.readFileSync(file, "utf8").includes(`"${apiPath}"`))
      .map(relativeRouteSource);
    assert.deepEqual(owners, [TARGET_SOURCE], apiPath);
  }
});

test("all 20 operations command dependencies move to T02 and cannot flow back to T06", () => {
  assert.deepEqual(platformContext.SUBDOMAIN_DEPENDENCIES["operations-command"], COMMAND_DEPENDENCIES);
  assert.equal(clinicalContext.SUBDOMAIN_DEPENDENCIES["operations-command"], undefined);

  const clinicalFacade = fs.readFileSync(path.join(ROOT, "src/http/routes/clinical-specialties.js"), "utf8");
  const clinicalRuntime = fs.readFileSync(path.join(ROOT, "src/http/runtime-contexts/clinical-specialties.js"), "utf8");
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "config/clinical-subdomains.json"), "utf8"));
  const legacyArea = registry.legacyRouteAreas.find(({ id }) => id === "legacy-platform-operations");
  assert.doesNotMatch(clinicalFacade, /operations-command/);
  assert.doesNotMatch(clinicalRuntime, /operations-command/);
  assert.equal(fs.existsSync(path.join(ROOT, "src/http/routes/clinical-specialties/operations-command.js")), false);
  assert.equal(registry.routeSubcontextAssignments["operations-command"], undefined);
  assert.deepEqual(legacyArea.currentRouteSubcontexts, []);
  assert.deepEqual(legacyArea.completedRouteSubcontexts, ["operations-dashboard", "operations-command"]);
  assert.equal(legacyArea.status, "handoff-complete");
});

test("operations command remains commission-only and fails closed before reads", async () => {
  const authorizationCalls = [];
  let reads = 0;
  const segment = createRouteSegment(createRuntime({
    readDatabase() {
      reads += 1;
      return {};
    },
    requireApiRole(req, res, roles, purpose) {
      authorizationCalls.push({ req, res, roles, purpose });
      return null;
    }
  }));
  const req = { method: "GET" };
  const res = {};

  assert.equal(
    await segment.handle(req, res, new URL("http://localhost/api/operations/command-chains")),
    true
  );
  assert.deepEqual(authorizationCalls, [{
    req,
    res,
    roles: ["commission"],
    purpose: "/api/operations/command-chains"
  }]);
  assert.equal(reads, 0);
});

test("operations command preserves the representative GET response deeply", async () => {
  const data = { hospitalOperationSnapshots: [{ id: "snapshot-1" }] };
  const dashboard = {
    generatedAt: "2030-08-22T00:00:00.000Z",
    summary: { institutions: 4 },
    commandChains: [
      { id: "chain-critical", severity: "critical", nested: { unchanged: true } },
      { id: "chain-warning", severity: "warning" },
      { id: "chain-normal", severity: "normal" },
      { id: "chain-normal-2", severity: "normal" }
    ]
  };
  const calls = [];
  let response;
  const segment = createRouteSegment(createRuntime({
    buildHospitalOperationsDashboard(receivedData) {
      calls.push(["buildHospitalOperationsDashboard", receivedData]);
      return dashboard;
    },
    readDatabase() {
      calls.push(["readDatabase"]);
      return data;
    },
    requireApiRole(_req, _res, roles, purpose) {
      calls.push(["requireApiRole", roles, purpose]);
      return { id: "commission-operator", role: "commission" };
    },
    sendJson(_res, status, payload) {
      calls.push(["sendJson", status, payload]);
      response = { status, payload };
    }
  }));

  assert.equal(
    await segment.handle(
      { method: "GET" },
      {},
      new URL("http://localhost/api/operations/command-chains")
    ),
    true
  );
  assert.deepEqual(response, {
    status: 200,
    payload: {
      ok: true,
      generatedAt: "2030-08-22T00:00:00.000Z",
      summary: { institutions: 4, critical: 1, warning: 1, normal: 2 },
      commandChains: dashboard.commandChains
    }
  });
  assert.deepEqual(calls.map(([name]) => name), [
    "requireApiRole",
    "readDatabase",
    "buildHospitalOperationsDashboard",
    "sendJson"
  ]);
  assert.deepEqual(calls[0].slice(1), [["commission"], "/api/operations/command-chains"]);
});

test("operations dispatch preserves read-write-audit order and response without clock coupling", async () => {
  const payload = { resourceType: "bed", quantity: 2 };
  const user = { id: "commission-operator", name: "治理人员", role: "commission" };
  const dispatch = {
    id: "dispatch-fixed-1",
    resourceType: "bed",
    quantity: 2,
    status: "pending",
    createdAt: "2030-08-22T01:00:00.000Z"
  };
  const data = {
    resourceDispatchRequests: [],
    securityEvents: [{ id: "existing-event" }]
  };
  const calls = [];
  let written;
  let response;
  const segment = createRouteSegment(createRuntime({
    async collectJson(receivedReq) {
      calls.push(["collectJson", receivedReq]);
      return payload;
    },
    normalizeDispatchAction(receivedPayload, receivedUser) {
      calls.push(["normalizeDispatchAction", receivedPayload, receivedUser]);
      return dispatch;
    },
    randomUUID() {
      calls.push(["randomUUID"]);
      return "audit-fixed-1";
    },
    readDatabase() {
      calls.push(["readDatabase"]);
      return data;
    },
    requireApiRole(_req, _res, roles, purpose) {
      calls.push(["requireApiRole", roles, purpose]);
      return user;
    },
    sendJson(_res, status, responsePayload) {
      calls.push(["sendJson", status, responsePayload]);
      response = { status, payload: responsePayload };
    },
    writeDatabase(receivedData) {
      calls.push(["writeDatabase", receivedData]);
      written = structuredClone(receivedData);
    }
  }));

  assert.equal(
    await segment.handle(
      { method: "POST" },
      {},
      new URL("http://localhost/api/operations/dispatch")
    ),
    true
  );
  assert.deepEqual(calls.map(([name]) => name), [
    "requireApiRole",
    "collectJson",
    "readDatabase",
    "normalizeDispatchAction",
    "randomUUID",
    "writeDatabase",
    "sendJson"
  ]);
  assert.deepEqual(response, { status: 201, payload: dispatch });
  assert.deepEqual(written.resourceDispatchRequests, [dispatch]);
  const { at, ...audit } = written.securityEvents[0];
  assert.equal(typeof at, "string");
  assert.notEqual(at.length, 0);
  assert.deepEqual(audit, {
    id: "audit-fixed-1",
    actor: "治理人员",
    role: "commission",
    action: "operations-dispatch",
    target: "dispatch-fixed-1",
    result: "allowed",
    detail: "bed:2:pending"
  });
  assert.deepEqual(written.securityEvents.slice(1), [{ id: "existing-event" }]);
});
