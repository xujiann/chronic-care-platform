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
const { createRouteSegment } = require("../src/http/routes/platform-governance/operations-dashboard");

const ROOT = path.resolve(__dirname, "..");
const API_PATH = "/api/operations/dashboard";
const DASHBOARD_DEPENDENCIES = [
  "BloodEventHub",
  "buildHospitalOperationsDashboard",
  "buildObservabilityAlertCenter",
  "buildProductionOperationsCenter",
  "buildRuntimeMetrics",
  "readDatabase",
  "requireApiRole",
  "sendJson"
];

test("operations dashboard handoff preserves the GET contract and response deeply", async () => {
  const req = { method: "GET" };
  const res = {};
  const user = { id: "commission-operator", role: "commission" };
  const data = { operationSnapshots: [{ id: "snapshot-1" }] };
  const runtimeMetrics = { uptimeSeconds: 42, requests: { active: 2 } };
  const calls = [];
  let response;
  const runtime = {
    BloodEventHub: {
      dashboard(receivedData, receivedUser) {
        calls.push(["BloodEventHub.dashboard", receivedData, receivedUser]);
        return {
          status: "ready",
          projections: [
            { id: "ops-1", consumer: "operations", details: { priority: "high" } },
            { id: "emergency-1", consumer: "emergency", details: { priority: "critical" } }
          ]
        };
      }
    },
    buildHospitalOperationsDashboard(receivedData) {
      calls.push(["buildHospitalOperationsDashboard", receivedData]);
      return { ok: true, summary: { institutions: 3 }, nested: { unchanged: ["legacy"] } };
    },
    buildObservabilityAlertCenter(receivedData) {
      calls.push(["buildObservabilityAlertCenter", receivedData]);
      return { alerts: [{ id: "alert-1", severity: "warning" }] };
    },
    buildProductionOperationsCenter(receivedData, options) {
      calls.push(["buildProductionOperationsCenter", receivedData, options]);
      return { summary: { serviceLevels: 4 }, runtimeMetrics: options.runtimeMetrics };
    },
    buildRuntimeMetrics(receivedData) {
      calls.push(["buildRuntimeMetrics", receivedData]);
      return runtimeMetrics;
    },
    readDatabase() {
      calls.push(["readDatabase"]);
      return data;
    },
    requireApiRole(receivedReq, receivedRes, roles, purpose) {
      calls.push(["requireApiRole", receivedReq, receivedRes, roles, purpose]);
      return user;
    },
    sendJson(receivedRes, status, payload) {
      calls.push(["sendJson", receivedRes, status, payload]);
      response = { status, payload };
    }
  };

  const handled = await createRouteSegment(runtime).handle(req, res, new URL(`http://localhost${API_PATH}`));

  assert.equal(handled, true);
  assert.deepEqual(response, {
    status: 200,
    payload: {
      ok: true,
      summary: { institutions: 3 },
      nested: { unchanged: ["legacy"] },
      runCenter: { summary: { serviceLevels: 4 }, runtimeMetrics },
      observability: { alerts: [{ id: "alert-1", severity: "warning" }] },
      bloodCoordination: {
        status: "ready",
        projections: [{ id: "ops-1", consumer: "operations", details: { priority: "high" } }]
      }
    }
  });
  assert.deepEqual(calls.map(([name]) => name), [
    "requireApiRole",
    "readDatabase",
    "buildHospitalOperationsDashboard",
    "buildRuntimeMetrics",
    "buildProductionOperationsCenter",
    "buildObservabilityAlertCenter",
    "BloodEventHub.dashboard",
    "BloodEventHub.dashboard",
    "sendJson"
  ]);
  assert.deepEqual(calls[0].slice(3), [["commission"], API_PATH]);
});

test("operations dashboard remains fail-closed for the same role and ignores other methods", async () => {
  const roleCalls = [];
  let reads = 0;
  const runtime = Object.fromEntries(DASHBOARD_DEPENDENCIES.map((name) => [name, () => {}]));
  runtime.BloodEventHub = { dashboard() { return { projections: [] }; } };
  runtime.requireApiRole = (_req, _res, roles, purpose) => {
    roleCalls.push({ roles, purpose });
    return null;
  };
  runtime.readDatabase = () => {
    reads += 1;
    return {};
  };
  const segment = createRouteSegment(runtime);

  assert.equal(await segment.handle({ method: "POST" }, {}, new URL(`http://localhost${API_PATH}`)), false);
  assert.equal(await segment.handle({ method: "GET" }, {}, new URL(`http://localhost${API_PATH}`)), true);
  assert.deepEqual(roleCalls, [{ roles: ["commission"], purpose: API_PATH }]);
  assert.equal(reads, 0);
});

test("operations dashboard has one T02 source owner at the unchanged manifest slot", () => {
  const sourceOwners = routeSourceFiles(ROOT)
    .filter((file) => fs.readFileSync(file, "utf8").includes(API_PATH))
    .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"));

  assert.deepEqual(sourceOwners, ["src/http/routes/platform-governance/operations-dashboard.js"]);
  assert.equal(ROUTE_SUBDOMAINS["platform-governance-12"], "operations-dashboard");
  assert.equal(ROUTE_SUBDOMAINS["clinical-specialties-02"], undefined);
  assert.deepEqual(ROUTE_ORDER.slice(12, 15), [
    { domain: "platform-governance", id: "platform-governance-03" },
    { domain: "platform-governance", id: "platform-governance-12" },
    { domain: "shared", id: "shared-03" }
  ]);
});

test("T06 drops dashboard dependencies and the completed handoff cannot flow back", () => {
  assert.equal(clinicalContext.SUBDOMAIN_DEPENDENCIES["operations-dashboard"], undefined);
  assert.deepEqual(platformContext.SUBDOMAIN_DEPENDENCIES["operations-dashboard"], DASHBOARD_DEPENDENCIES);
  for (const dependency of ["buildObservabilityAlertCenter", "buildProductionOperationsCenter", "buildRuntimeMetrics"]) {
    assert.equal(clinicalContext.DEPENDENCIES.includes(dependency), false, dependency);
    assert.equal(platformContext.DEPENDENCIES.includes(dependency), true, dependency);
  }

  const clinicalFacade = fs.readFileSync(path.join(ROOT, "src/http/routes/clinical-specialties.js"), "utf8");
  const clinicalRuntime = fs.readFileSync(path.join(ROOT, "src/http/runtime-contexts/clinical-specialties.js"), "utf8");
  const legacyRoute = path.join(ROOT, "src/http/routes/clinical-specialties/operations-dashboard.js");
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "config/clinical-subdomains.json"), "utf8"));
  const legacyArea = registry.legacyRouteAreas.find(({ id }) => id === "legacy-platform-operations");

  assert.doesNotMatch(clinicalFacade, /operations-dashboard/);
  assert.doesNotMatch(clinicalRuntime, /operations-dashboard/);
  assert.equal(fs.existsSync(legacyRoute), false);
  assert.equal(registry.routeSubcontextAssignments["operations-dashboard"], undefined);
  assert.deepEqual(legacyArea.currentRouteSubcontexts, ["operations-command"]);
  assert.deepEqual(legacyArea.completedRouteSubcontexts, ["operations-dashboard"]);
});
