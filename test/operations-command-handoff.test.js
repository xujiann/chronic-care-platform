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
const OPERATIONS_BEHAVIOR_MATRIX = Object.freeze([
  { method: "GET", path: "/api/operations/performance-monitoring", roles: ["commission"], response: "performance" },
  { method: "GET", path: "/api/operations/command-chains", roles: ["commission"], response: "commandChains" },
  { method: "GET", path: "/api/operations/playbooks", roles: ["commission"], response: "playbooks" },
  { method: "GET", path: "/api/operations/handover", roles: ["commission"], response: "handover" },
  { method: "GET", path: "/api/operations/handover/owners", roles: ["commission"], response: "handoverOwnerMatrix" },
  {
    method: "POST", path: "/api/operations/handover/signoff", roles: ["commission"], status: 201,
    payload: { shift: "night" }, mutations: ["operationHandoverSignoffs", "platformProcessAudit", "securityEvents"],
    audit: "inline", invalid: "handover-normalizer", steps: ["collectJson", "readDatabase", "buildHospitalOperationsDashboard", "normalizeHandoverSignoff", "randomUUID", "writeDatabase", "sendJson"]
  },
  { method: "GET", path: "/api/operations/interface-mapping", roles: ["commission"], response: "interfaceMapping" },
  { method: "GET", path: "/api/operations/site-joint-tests", roles: ["commission"], response: "siteJointTests" },
  { method: "GET", path: "/api/operations/site-joint-patrol", roles: ["commission"], response: "siteJointPatrol" },
  {
    method: "POST", path: "/api/operations/site-joint-patrol/actions", roles: ["commission"], status: 201,
    payload: { patrolId: "patrol-1", status: "已巡检", note: "verified" }, mutations: ["platformProcessAudit", "securityEvents"],
    audit: "inline", invalid: "empty-site-patrol", steps: ["collectJson", "readDatabase", "buildHospitalOperationsDashboard", "randomUUID", "writeDatabase", "buildOperationsSiteJointPatrol", "sendJson"]
  },
  { method: "GET", path: "/api/operations/production-hardening", roles: ["commission"], response: "productionHardening" },
  { method: "GET", path: "/api/operations/cutover-command", roles: ["commission"], response: "cutoverCommand" },
  {
    method: "POST", path: "/api/operations/cutover-command/actions", roles: ["commission"], status: 201,
    payload: { itemId: "cutover-1", status: "已签收" }, mutations: ["platformProcessAudit", "securityEvents"],
    audit: "inline", invalid: "empty-cutover", steps: ["collectJson", "readDatabase", "buildHospitalOperationsDashboard", "randomUUID", "writeDatabase", "buildHospitalOperationsDashboard", "sendJson"]
  },
  { method: "GET", path: "/api/operations/post-cutover-observation", roles: ["commission"], response: "postCutoverObservation" },
  { method: "GET", path: "/api/operations/go-live-gates", roles: ["commission"], response: "goLiveGates" },
  {
    method: "POST", path: "/api/operations/go-live-gates/actions", roles: ["commission"], status: 201,
    payload: { gateId: "gate-1", status: "已复核" }, mutations: ["platformProcessAudit", "securityEvents"],
    audit: "inline", invalid: "empty-go-live", steps: ["collectJson", "readDatabase", "buildHospitalOperationsDashboard", "randomUUID", "writeDatabase", "buildHospitalOperationsDashboard", "sendJson"]
  },
  {
    method: "POST", path: "/api/operations/post-cutover-observation/actions", roles: ["commission"], status: 201,
    payload: { itemId: "observation-1", status: "已观察" }, mutations: ["platformProcessAudit", "securityEvents"],
    audit: "inline", invalid: "empty-observation", steps: ["collectJson", "readDatabase", "buildHospitalOperationsDashboard", "randomUUID", "writeDatabase", "buildHospitalOperationsDashboard", "sendJson"]
  },
  { method: "GET", path: "/api/operations/intelligence", roles: ["commission"], response: "intelligence" },
  { method: "GET", path: "/api/operations/resource-pool", roles: ["commission"], response: "resourcePool" },
  { method: "GET", path: "/api/operations/emergency-dispatch-loop", roles: ["commission"], response: "emergencyDispatchLoop" },
  {
    method: "POST", path: "/api/operations/emergency-dispatch-loop/actions", roles: ["commission"], status: 201,
    payload: { loopId: "loop-1", status: "triage-confirmed" }, mutations: ["emergencyDispatchLoops", "platformProcessAudit", "securityEvents"],
    audit: "inline", invalid: "empty-emergency-loop", steps: ["collectJson", "readDatabase", "buildHospitalOperationsDashboard", "randomUUID", "writeDatabase", "buildHospitalOperationsDashboard", "sendJson"]
  },
  { method: "GET", path: "/api/operations/mobile-duty", roles: ["commission"], response: "mobileDuty" },
  {
    method: "POST", path: "/api/operations/mobile-duty/actions", roles: ["commission"], status: 201,
    payload: { cardId: "card-1", note: "remind" }, mutations: ["taskMessages", "platformProcessAudit", "securityEvents"],
    audit: "inline", invalid: "empty-mobile-duty", steps: ["collectJson", "readDatabase", "buildHospitalOperationsDashboard", "createOperationsMobileDutyReminder", "randomUUID", "writeDatabase", "buildOperationsMobileDuty", "sendJson"]
  },
  { method: "GET", path: "/api/operations/governance-report", roles: ["commission"], response: "governanceReport" },
  { method: "GET", path: "/api/operations/governance-export-package", roles: ["commission"], response: "governanceExportPackage" },
  { method: "GET", path: "/api/operations/next-development-research", roles: ["commission"], response: "nextDevelopmentResearch" },
  {
    method: "POST", path: "/api/operations/integration/snapshots", roles: ["commission", "institution"], status: 202,
    payload: { snapshots: [{ institutionId: "ORG-1", snapshotAt: "2030-08-23T00:00:00.000Z" }] },
    mutations: ["hospitalOperationSnapshots", "securityEvents"], audit: "integration",
    invalid: "invalid-snapshots", scope: "institution-payload", signedPurpose: "operations-snapshots",
    steps: ["collectJson", "assertSignedOperationsPayload", "integrationPayloadAllowedForInstitution", "readDatabase", "normalizeOperationSnapshot", "appendOperationsIntegrationAudit", "writeDatabase", "sendJson"]
  },
  {
    method: "POST", path: "/api/operations/integration/dispatch-feedback", roles: ["commission", "institution"], status: 200,
    payload: { dispatchId: "dispatch-1", status: "in-progress", receiptNo: "receipt-1" },
    mutations: ["resourceDispatchRequests", "securityEvents"], audit: "integration",
    invalid: "missing-dispatch-id", scope: "dispatch-party", signedPurpose: "operations-dispatch-feedback",
    steps: ["collectJson", "assertSignedOperationsPayload", "readDatabase", "applyDispatchStatusUpdate", "appendOperationsIntegrationAudit", "writeDatabase", "sendJson"]
  },
  {
    method: "POST", path: "/api/operations/integration/reconciliation", roles: ["commission", "institution"], status: 202,
    payload: { reconciliations: [{ institutionId: "ORG-1", sourceBatch: "batch-1" }] },
    mutations: ["statisticsReconciliationReviews", "securityEvents"], audit: "integration",
    invalid: "invalid-reconciliations", scope: "institution-payload", signedPurpose: "operations-reconciliation",
    steps: ["collectJson", "assertSignedOperationsPayload", "integrationPayloadAllowedForInstitution", "readDatabase", "normalizeReconciliationBatchItem", "appendOperationsIntegrationAudit", "writeDatabase", "sendJson"]
  },
  {
    method: "POST", path: "/api/operations/dispatch", roles: ["commission"], status: 201,
    payload: { resourceType: "bed", quantity: 2 }, mutations: ["resourceDispatchRequests", "securityEvents"],
    audit: "inline", invalid: "dispatch-normalizer", steps: ["collectJson", "readDatabase", "normalizeDispatchAction", "randomUUID", "writeDatabase", "sendJson"]
  },
  {
    method: "POST", path: "/api/operations/dispatch/:id/status", requestPath: "/api/operations/dispatch/dispatch-1/status",
    roles: ["commission"], status: 200, payload: { status: "closed" }, mutations: ["resourceDispatchRequests", "securityEvents"],
    audit: "inline", invalid: "missing-dispatch", steps: ["collectJson", "readDatabase", "applyDispatchStatusUpdate", "randomUUID", "writeDatabase", "sendJson"]
  },
  {
    method: "POST", path: "/api/operations/reconciliation/:id/review", requestPath: "/api/operations/reconciliation/review-1/review",
    roles: ["commission"], status: 200, payload: { status: "approved", reviewNote: "verified" }, mutations: ["statisticsReconciliationReviews", "securityEvents"],
    audit: "inline", invalid: "missing-review", steps: ["collectJson", "readDatabase", "randomUUID", "writeDatabase", "sendJson"]
  }
]);

function createRuntime(overrides = {}) {
  return {
    ...Object.fromEntries(COMMAND_DEPENDENCIES.map((name) => [name, () => undefined])),
    ...overrides
  };
}

function createDashboardFixture() {
  return {
    generatedAt: "2030-08-23T00:00:00.000Z",
    summary: { institutions: 4 },
    commandChains: [
      { id: "critical", severity: "critical" },
      { id: "warning", severity: "warning" },
      { id: "normal", severity: "normal" }
    ],
    playbooks: [
      { id: "active", activeInstitutions: 1, severity: "critical" },
      { id: "inactive", activeInstitutions: 0, severity: "normal" }
    ],
    handover: { projection: "handover" },
    handoverOwnerMatrix: { projection: "handover-owners" },
    siteJointTests: { projection: "site-joint-tests" },
    siteJointPatrol: {
      projection: "site-joint-patrol",
      rows: [{ id: "patrol-1", owner: "owner-1", priority: "高", sourceSystem: "HIS", nextAction: "review" }]
    },
    productionHardening: { projection: "production-hardening" },
    cutoverCommand: {
      projection: "cutover-command",
      items: [{ id: "cutover-1", checkId: "check-1", name: "cutover", owner: "owner-1", priority: "高" }]
    },
    postCutoverObservation: {
      projection: "post-cutover-observation",
      items: [{ id: "observation-1", title: "observe", metric: "latency", owner: "owner-1", priority: "高" }]
    },
    goLiveGates: {
      projection: "go-live-gates",
      rows: [{ id: "gate-1", name: "gate", status: "pending", owner: "owner-1", ready: false, severity: "高" }]
    },
    intelligence: { projection: "intelligence" },
    resourcePool: { projection: "resource-pool" },
    emergencyDispatchLoop: {
      projection: "emergency-dispatch-loop",
      rows: [{
        id: "loop-1",
        snapshotId: "snapshot-loop-1",
        institution: "hospital-1",
        owner: "owner-1",
        priority: "high",
        pressure: { waitingOver30Min: 3, emergencyVisits: 10 },
        dispatchIds: ["dispatch-1"],
        auditTrail: []
      }]
    },
    mobileDuty: {
      projection: "mobile-duty",
      cards: [{ id: "card-1", owner: "owner-1", priority: "高" }]
    },
    governanceReport: { projection: "governance-report" },
    governanceExportPackage: { projection: "governance-export-package" },
    nextDevelopmentResearch: { projection: "next-development-research" },
    snapshots: [{ id: "snapshot-dashboard-1" }],
    dispatchRequests: [{ id: "dispatch-dashboard-1" }],
    reconciliationReviews: [{ id: "review-dashboard-1" }]
  };
}

function createBehaviorHarness(entry, options = {}) {
  const calls = [];
  const user = options.user || {
    id: "commission-operator",
    username: "health",
    name: "治理人员",
    role: "commission",
    orgCode: "ORG-1",
    orgType: "health_admin"
  };
  const dashboard = createDashboardFixture();
  const state = {
    operationAlertRules: [],
    operationHandoverSignoffs: [{ id: "signoff-existing" }],
    platformProcessAudit: [{ process: "existing" }],
    securityEvents: [{ id: "security-existing" }],
    emergencyDispatchLoops: [{ id: "loop-existing" }],
    taskMessages: [{ id: "message-existing" }],
    hospitalOperationSnapshots: [{ id: "snapshot-existing" }],
    resourceDispatchRequests: [{
      id: "dispatch-1",
      sourceInstitutionId: "ORG-1",
      targetInstitutionId: "ORG-2",
      status: "assigned",
      auditTrail: []
    }],
    statisticsReconciliationReviews: [{ id: "review-1", status: "pending", auditTrail: [] }]
  };
  let payload = structuredClone(entry.payload || {});

  switch (options.invalid) {
    case "empty-site-patrol": dashboard.siteJointPatrol.rows = []; break;
    case "empty-cutover": dashboard.cutoverCommand.items = []; break;
    case "empty-go-live": dashboard.goLiveGates.rows = []; break;
    case "empty-observation": dashboard.postCutoverObservation.items = []; break;
    case "empty-emergency-loop": dashboard.emergencyDispatchLoop.rows = []; break;
    case "empty-mobile-duty": dashboard.mobileDuty.cards = []; break;
    case "invalid-snapshots": payload = { snapshots: [] }; break;
    case "missing-dispatch-id": payload = {}; break;
    case "invalid-reconciliations": payload = { reconciliations: [] }; break;
    case "missing-dispatch": state.resourceDispatchRequests = []; break;
    case "missing-review": state.statisticsReconciliationReviews = []; break;
    default: break;
  }

  const signoff = {
    id: "signoff-1",
    signer: user.name,
    shift: "night",
    itemCount: 2,
    criticalCount: 1,
    nextShiftFocus: "continue"
  };
  const dispatch = {
    id: "dispatch-new",
    resourceType: "bed",
    quantity: 2,
    status: "pending"
  };
  const reminder = {
    id: "message-1",
    targetRole: "operations-owner",
    channel: "mobile",
    body: "remind"
  };
  const initialState = structuredClone(state);
  let response;
  function recordResponse(status, responsePayload) {
    calls.push(["sendJson", status, responsePayload]);
    response = { status, payload: responsePayload };
  }
  const runtime = createRuntime({
    appendOperationsIntegrationAudit(data, receivedUser, action, target, detail) {
      calls.push(["appendOperationsIntegrationAudit", data, receivedUser, action, target, detail]);
      if (options.failAudit) throw new Error("audit unavailable");
      data.securityEvents.unshift({ id: `audit-${action}`, action, result: "allowed" });
    },
    applyDispatchStatusUpdate(receivedDispatch, receivedPayload, receivedUser) {
      calls.push(["applyDispatchStatusUpdate", receivedDispatch, receivedPayload, receivedUser]);
      return {
        ...receivedDispatch,
        status: String(receivedPayload.status || "closed"),
        auditTrail: [...(receivedDispatch.auditTrail || []), { action: "status-change" }]
      };
    },
    assertSignedOperationsPayload(req, res, receivedPayload, receivedUser, purpose) {
      calls.push(["assertSignedOperationsPayload", req, res, receivedPayload, receivedUser, purpose]);
      if (options.signatureAllowed === false) {
        recordResponse(401, { error: "Unauthorized", message: "医院运行接口签名校验失败" });
      }
      return options.signatureAllowed !== false;
    },
    buildHospitalOperationsDashboard(receivedData) {
      calls.push(["buildHospitalOperationsDashboard", receivedData]);
      return dashboard;
    },
    buildOperationsInterfaceMappingEvidence(receivedData) {
      calls.push(["buildOperationsInterfaceMappingEvidence", receivedData]);
      return { projection: "interface-mapping" };
    },
    buildOperationsMobileDuty(received) {
      calls.push(["buildOperationsMobileDuty", received]);
      return { projection: "mobile-duty-refreshed" };
    },
    buildOperationsSiteJointPatrol(received) {
      calls.push(["buildOperationsSiteJointPatrol", received]);
      return { projection: "site-joint-patrol-refreshed" };
    },
    buildPerformanceMonitoringEvidence(receivedData, receivedDashboard) {
      calls.push(["buildPerformanceMonitoringEvidence", receivedData, receivedDashboard]);
      return { projection: "performance-monitoring" };
    },
    async collectJson(req) {
      calls.push(["collectJson", req]);
      return payload;
    },
    createOperationsMobileDutyReminder(card, receivedPayload, receivedUser) {
      calls.push(["createOperationsMobileDutyReminder", card, receivedPayload, receivedUser]);
      return reminder;
    },
    integrationPayloadAllowedForInstitution(item, receivedUser) {
      calls.push(["integrationPayloadAllowedForInstitution", item, receivedUser]);
      return options.scopeAllowed !== false;
    },
    normalizeDispatchAction(receivedPayload, receivedUser) {
      calls.push(["normalizeDispatchAction", receivedPayload, receivedUser]);
      if (options.invalid === "dispatch-normalizer") throw new Error("invalid dispatch payload");
      return dispatch;
    },
    normalizeHandoverSignoff(receivedPayload, receivedUser, handover) {
      calls.push(["normalizeHandoverSignoff", receivedPayload, receivedUser, handover]);
      if (options.invalid === "handover-normalizer") throw new Error("invalid handover payload");
      return signoff;
    },
    normalizeOperationSnapshot(item, receivedUser, rules) {
      calls.push(["normalizeOperationSnapshot", item, receivedUser, rules]);
      return { ...item, id: "snapshot-1", normalizedStatus: "critical" };
    },
    normalizeReconciliationBatchItem(item, receivedUser) {
      calls.push(["normalizeReconciliationBatchItem", item, receivedUser]);
      return { ...item, id: "reconciliation-1", status: "blocked" };
    },
    randomUUID() {
      calls.push(["randomUUID"]);
      if (options.failAudit) throw new Error("audit unavailable");
      return "audit-fixed-1";
    },
    readDatabase() {
      calls.push(["readDatabase"]);
      return state;
    },
    requireApiRole(req, res, roles, purpose) {
      calls.push(["requireApiRole", req, res, roles, purpose]);
      return options.deny ? null : user;
    },
    sendJson(res, status, responsePayload) {
      recordResponse(status, responsePayload);
    },
    writeDatabase(receivedData) {
      calls.push(["writeDatabase", receivedData]);
      if (options.failWrite) throw new Error("write unavailable");
    }
  });

  return {
    calls,
    dashboard,
    dispatch,
    initialState,
    payload,
    reminder,
    response: () => response,
    segment: createRouteSegment(runtime),
    signoff,
    state,
    user
  };
}

function callNames(calls) {
  return calls.map(([name]) => name);
}

function assertOrderedSubsequence(actual, expected, message) {
  let cursor = -1;
  for (const step of expected) {
    cursor = actual.indexOf(step, cursor + 1);
    assert.notEqual(cursor, -1, `${message}: missing ordered step ${step}`);
  }
}

async function invokeBehavior(entry, options) {
  const harness = createBehaviorHarness(entry, options);
  const handled = await harness.segment.handle(
    { method: entry.method },
    {},
    new URL(`http://localhost${entry.requestPath || entry.path}`)
  );
  return { handled, ...harness };
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
  const user = { id: "commission-operator", name: "治理人员", role: "commission", orgCode: "ORG-1", orgType: "health_admin" };
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
  assert.deepEqual(response, { status: 201, payload: { ...dispatch, version: 1 } });
  assert.deepEqual(
    { ...written.resourceDispatchRequests[0], _apiCommandReceipts: undefined },
    { ...dispatch, version: 1, _apiCommandReceipts: undefined }
  );
  assert.equal(written.resourceDispatchRequests[0]._apiCommandReceipts.length, 1);
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

test("TEST-007 behavior matrix covers every operations command path exactly once", () => {
  assert.equal(OPERATIONS_BEHAVIOR_MATRIX.length, 32);
  assert.deepEqual(
    OPERATIONS_BEHAVIOR_MATRIX.map(({ path }) => path).sort(),
    COMMAND_PATHS
  );
  assert.equal(new Set(OPERATIONS_BEHAVIOR_MATRIX.map(({ method, path }) => `${method} ${path}`)).size, 32);

  for (const entry of OPERATIONS_BEHAVIOR_MATRIX) {
    assert.match(entry.method, /^(GET|POST)$/);
    assert.equal(entry.roles.length > 0, true, entry.path);
    if (entry.method === "POST") {
      assert.equal(entry.mutations.length > 0, true, `${entry.path}: mutations`);
      assert.match(entry.audit, /^(inline|integration)$/, `${entry.path}: audit`);
      assert.equal(entry.steps.at(-1), "sendJson", `${entry.path}: response last`);
      assert.equal(entry.steps.indexOf("writeDatabase") < entry.steps.indexOf("sendJson"), true, `${entry.path}: write before response`);
      assert.equal(typeof entry.invalid, "string", `${entry.path}: invalid payload/error case`);
    }
  }
});

test("TEST-007 behavior matrix has a named fail-closed CI gate", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.equal(
    packageJson.scripts["operations-command:behavior-test"],
    "node --test test/operations-command-handoff.test.js test/operations-quality-api-behavior.test.js"
  );
  assert.match(
    workflow,
    /- name: Protect all operations command runtime behaviors\r?\n\s+run: npm run operations-command:behavior-test/
  );
});

test("TEST-007 executes the 32-path success matrix with roles, responses, mutations and ordering", async () => {
  for (const entry of OPERATIONS_BEHAVIOR_MATRIX) {
    const result = await invokeBehavior(entry);
    const names = callNames(result.calls);
    assert.equal(result.handled, true, entry.path);
    assert.equal(names[0], "requireApiRole", entry.path);
    assert.deepEqual(result.calls[0].slice(3), [entry.roles, entry.path], entry.path);
    assert.equal(names.filter((name) => name === "readDatabase").length, 1, `${entry.path}: one read`);
    assert.equal(result.response()?.status, entry.status || 200, `${entry.path}: status`);

    if (entry.method === "GET") {
      assert.equal(names.includes("writeDatabase"), false, `${entry.path}: read-only`);
      assert.deepEqual(result.state, result.initialState, `${entry.path}: no data side effect`);
      assertOrderedSubsequence(names, ["requireApiRole", "readDatabase", "sendJson"], entry.path);
      if (entry.response === "performance") {
        assert.deepEqual(result.response().payload, { projection: "performance-monitoring" });
      } else if (entry.response === "interfaceMapping") {
        assert.deepEqual(result.response().payload, { projection: "interface-mapping" });
      } else if (entry.response === "commandChains") {
        assert.deepEqual(result.response().payload, {
          ok: true,
          generatedAt: result.dashboard.generatedAt,
          summary: { institutions: 4, critical: 1, warning: 1, normal: 1 },
          commandChains: result.dashboard.commandChains
        });
      } else if (entry.response === "playbooks") {
        assert.deepEqual(result.response().payload, {
          ok: true,
          generatedAt: result.dashboard.generatedAt,
          summary: { playbooks: 2, active: 1, critical: 1 },
          playbooks: result.dashboard.playbooks
        });
      } else {
        assert.deepEqual(result.response().payload, result.dashboard[entry.response], entry.path);
      }
      continue;
    }

    assertOrderedSubsequence(names, ["requireApiRole", ...entry.steps], entry.path);
    assert.equal(names.filter((name) => name === "writeDatabase").length, 1, `${entry.path}: one write`);
    assert.equal(names.filter((name) => name === "sendJson").length, 1, `${entry.path}: one response`);
    for (const mutation of entry.mutations) {
      assert.notDeepEqual(result.state[mutation], result.initialState[mutation], `${entry.path}: ${mutation}`);
    }
    for (const stateKey of Object.keys(result.initialState).filter((key) => !entry.mutations.includes(key))) {
      assert.deepEqual(result.state[stateKey], result.initialState[stateKey], `${entry.path}: unexpected ${stateKey} mutation`);
    }

    switch (entry.path) {
      case "/api/operations/handover/signoff":
        assert.deepEqual(result.response().payload, result.signoff);
        break;
      case "/api/operations/site-joint-patrol/actions":
        assert.equal(result.response().payload.audit.status, "已巡检");
        assert.deepEqual(result.response().payload.siteJointPatrol, { projection: "site-joint-patrol-refreshed" });
        break;
      case "/api/operations/cutover-command/actions":
        assert.equal(result.response().payload.audit.status, "已签收");
        assert.equal(result.response().payload.cutoverCommand.projection, "cutover-command");
        break;
      case "/api/operations/go-live-gates/actions":
        assert.equal(result.response().payload.audit.status, "已复核");
        assert.equal(result.response().payload.goLiveGates.projection, "go-live-gates");
        break;
      case "/api/operations/post-cutover-observation/actions":
        assert.equal(result.response().payload.audit.status, "已观察");
        assert.equal(result.response().payload.postCutoverObservation.projection, "post-cutover-observation");
        break;
      case "/api/operations/emergency-dispatch-loop/actions":
        assert.equal(result.response().payload.loop.status, "triage-confirmed");
        assert.equal(result.response().payload.emergencyDispatchLoop.projection, "emergency-dispatch-loop");
        break;
      case "/api/operations/mobile-duty/actions":
        assert.deepEqual(result.response().payload.message, result.reminder);
        assert.deepEqual(result.response().payload.mobileDuty, { projection: "mobile-duty-refreshed" });
        break;
      case "/api/operations/integration/snapshots":
        assert.deepEqual(result.response().payload, {
          ok: true, accepted: 1, ids: ["snapshot-1"], critical: 1, warning: 0
        });
        break;
      case "/api/operations/integration/dispatch-feedback":
        assert.equal(result.response().payload.id, "dispatch-1");
        assert.equal(result.response().payload.status, "in-progress");
        assert.equal(result.response().payload.externalReceipt.receiptNo, "receipt-1");
        break;
      case "/api/operations/integration/reconciliation":
        assert.deepEqual(result.response().payload, {
          ok: true, accepted: 1, ids: ["reconciliation-1"], blocked: 1
        });
        break;
      case "/api/operations/dispatch":
        assert.deepEqual(result.response().payload, { ...result.dispatch, version: 1 });
        break;
      case "/api/operations/dispatch/:id/status":
        assert.equal(result.response().payload.id, "dispatch-1");
        assert.equal(result.response().payload.status, "closed");
        break;
      case "/api/operations/reconciliation/:id/review":
        assert.equal(result.response().payload.id, "review-1");
        assert.equal(result.response().payload.status, "approved");
        assert.equal(result.response().payload.reviewedBy, "health");
        break;
      default:
        assert.fail(`missing response assertion for ${entry.path}`);
    }
  }
});

test("TEST-007 denies all 32 paths before payload collection or database reads", async () => {
  for (const entry of OPERATIONS_BEHAVIOR_MATRIX) {
    const result = await invokeBehavior(entry, { deny: true });
    const names = callNames(result.calls);
    assert.equal(result.handled, true, entry.path);
    assert.deepEqual(names, ["requireApiRole"], entry.path);
    assert.deepEqual(result.calls[0].slice(3), [entry.roles, entry.path], entry.path);
    assert.equal(result.response(), undefined, entry.path);
  }
});

test("TEST-007 protects signed integration payloads and institution scope", async () => {
  const integrations = OPERATIONS_BEHAVIOR_MATRIX.filter(({ signedPurpose }) => signedPurpose);
  assert.equal(integrations.length, 3);

  for (const entry of integrations) {
    const unsigned = await invokeBehavior(entry, { signatureAllowed: false });
    const unsignedNames = callNames(unsigned.calls);
    assert.equal(unsigned.calls.find(([name]) => name === "assertSignedOperationsPayload").at(-1), entry.signedPurpose);
    assert.deepEqual(unsigned.response(), {
      status: 401,
      payload: { error: "Unauthorized", message: "医院运行接口签名校验失败" }
    });
    assert.equal(unsignedNames.includes("readDatabase"), false, `${entry.path}: unsigned read`);
    assert.equal(unsignedNames.includes("writeDatabase"), false, `${entry.path}: unsigned write`);

    const allowedInstitution = await invokeBehavior(entry, {
      user: { username: "hospital", name: "医院", role: "institution", orgCode: "ORG-1" }
    });
    assert.equal(allowedInstitution.response().status, entry.status, `${entry.path}: institution allowed`);
    assert.equal(callNames(allowedInstitution.calls).includes("writeDatabase"), true, `${entry.path}: institution write`);
  }

  for (const entry of integrations.filter(({ scope }) => scope === "institution-payload")) {
    const denied = await invokeBehavior(entry, {
      user: { username: "hospital", name: "医院", role: "institution", orgCode: "OTHER" },
      scopeAllowed: false
    });
    assert.equal(denied.response().status, 403, entry.path);
    assert.equal(callNames(denied.calls).includes("readDatabase"), false, `${entry.path}: scope before read`);
    assert.equal(callNames(denied.calls).includes("writeDatabase"), false, entry.path);
  }

  const feedback = integrations.find(({ scope }) => scope === "dispatch-party");
  const deniedFeedback = await invokeBehavior(feedback, {
    user: { username: "hospital", name: "医院", role: "institution", orgCode: "OTHER" }
  });
  assert.equal(deniedFeedback.response().status, 403);
  assertOrderedSubsequence(callNames(deniedFeedback.calls), ["assertSignedOperationsPayload", "readDatabase", "sendJson"], feedback.path);
  assert.equal(callNames(deniedFeedback.calls).includes("applyDispatchStatusUpdate"), false);
  assert.equal(callNames(deniedFeedback.calls).includes("writeDatabase"), false);
});

test("TEST-007 locks each write path payload and error behavior", async () => {
  const writes = OPERATIONS_BEHAVIOR_MATRIX.filter(({ method }) => method === "POST");
  assert.equal(writes.length, 13);
  const expectedErrors = {
    "empty-site-patrol": [400, "现场联调巡检项不存在"],
    "empty-cutover": [400, "生产割接签收项不存在"],
    "empty-go-live": [400, "上线前门禁项不存在"],
    "empty-observation": [400, "上线后观察项不存在"],
    "empty-emergency-loop": [400, "急诊拥堵调度闭环不存在"],
    "empty-mobile-duty": [400, "移动值守卡片不存在"],
    "invalid-snapshots": [400, "运行快照必须包含 institutionId 和 snapshotAt"],
    "missing-dispatch-id": [400, "调度回执必须包含 dispatchId"],
    "invalid-reconciliations": [400, "统计对账批次必须包含 institutionId 和 sourceBatch"],
    "missing-dispatch": [404, "dispatch request not found"],
    "missing-review": [404, "reconciliation review not found"]
  };

  for (const entry of writes) {
    if (entry.invalid === "handover-normalizer") {
      await assert.rejects(
        () => invokeBehavior(entry, { invalid: entry.invalid }),
        /invalid .* payload/,
        entry.path
      );
      continue;
    }
    if (entry.invalid === "dispatch-normalizer") {
      const result = await invokeBehavior(entry, { invalid: entry.invalid });
      assert.equal(result.response().status, 400, entry.path);
      assert.equal(result.response().payload.code, "OPERATIONS_COMMAND_INVALID", entry.path);
      assert.equal(callNames(result.calls).includes("writeDatabase"), false, entry.path);
      continue;
    }
    const result = await invokeBehavior(entry, { invalid: entry.invalid });
    const [status, message] = expectedErrors[entry.invalid];
    assert.equal(result.response().status, status, entry.path);
    assert.equal(result.response().payload.message, message, entry.path);
    assert.equal(callNames(result.calls).includes("writeDatabase"), false, entry.path);
  }
});

test("TEST-007 makes audit and write failures explicit for every write path", async () => {
  const writes = OPERATIONS_BEHAVIOR_MATRIX.filter(({ method }) => method === "POST");
  for (const entry of writes) {
    const auditFailure = createBehaviorHarness(entry, { failAudit: true });
    const hasStableCommandError = [
      "/api/operations/dispatch",
      "/api/operations/reconciliation/:id/review"
    ].includes(entry.path);
    if (hasStableCommandError) {
      await auditFailure.segment.handle(
        { method: entry.method },
        {},
        new URL(`http://localhost${entry.requestPath || entry.path}`)
      );
      assert.equal(auditFailure.response().status, 500, `${entry.path}: audit failure`);
      assert.equal(auditFailure.response().payload.code, "OPERATIONS_COMMAND_STORAGE_FAILED");
      assert.equal(callNames(auditFailure.calls).includes("writeDatabase"), false, `${entry.path}: audit blocks write`);
    } else {
    await assert.rejects(
      () => auditFailure.segment.handle(
        { method: entry.method },
        {},
        new URL(`http://localhost${entry.requestPath || entry.path}`)
      ),
      /audit unavailable/,
      `${entry.path}: audit failure`
    );
    assert.equal(callNames(auditFailure.calls).includes("writeDatabase"), false, `${entry.path}: audit blocks write`);
    assert.equal(callNames(auditFailure.calls).includes("sendJson"), false, `${entry.path}: audit blocks response`);
    }

    const writeFailure = createBehaviorHarness(entry, { failWrite: true });
    if (hasStableCommandError) {
      await writeFailure.segment.handle(
        { method: entry.method },
        {},
        new URL(`http://localhost${entry.requestPath || entry.path}`)
      );
      assert.equal(writeFailure.response().status, 500, `${entry.path}: write failure`);
      assert.equal(writeFailure.response().payload.code, "OPERATIONS_COMMAND_STORAGE_FAILED");
      assert.equal(callNames(writeFailure.calls).filter((name) => name === "writeDatabase").length, 1);
      continue;
    }
    await assert.rejects(
      () => writeFailure.segment.handle(
        { method: entry.method },
        {},
        new URL(`http://localhost${entry.requestPath || entry.path}`)
      ),
      /write unavailable/,
      `${entry.path}: write failure`
    );
    const writeFailureNames = callNames(writeFailure.calls);
    const auditStep = entry.audit === "integration" ? "appendOperationsIntegrationAudit" : "randomUUID";
    assertOrderedSubsequence(writeFailureNames, [auditStep, "writeDatabase"], entry.path);
    assert.equal(writeFailureNames.includes("sendJson"), false, `${entry.path}: no success response after write failure`);
  }
});
