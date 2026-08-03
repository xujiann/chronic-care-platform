"use strict";

function createRouteSegment(runtime) {
  const { BloodEventHub, buildHospitalOperationsDashboard, buildObservabilityAlertCenter, buildProductionOperationsCenter, buildRuntimeMetrics, readDatabase, requireApiRole, sendJson } = runtime;
  return {
      id: "clinical-specialties-02",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/operations/dashboard") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/dashboard");
        if (!user) return true;
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        dashboard.runCenter = buildProductionOperationsCenter(data, { runtimeMetrics: buildRuntimeMetrics(data) });
        dashboard.observability = buildObservabilityAlertCenter(data);
        dashboard.bloodCoordination = { ...BloodEventHub.dashboard(data, user), projections: BloodEventHub.dashboard(data, user).projections.filter((item) => item.consumer === "operations") };
        sendJson(res, 200, dashboard);
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-02", SUBDOMAIN: "operations-dashboard" };
