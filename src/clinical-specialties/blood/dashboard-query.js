"use strict";

const OWNER = "T06/blood";
const USE_CASE = "blood-dashboard-query.v1";

function requirePort(name, port) {
  if (typeof port !== "function") {
    throw new TypeError(`${name} port must be a function`);
  }
  return port;
}

function createBloodDashboardQuery({
  buildBloodDashboard,
  normalizeTransactionState
} = {}) {
  const buildDashboard = requirePort("buildBloodDashboard", buildBloodDashboard);
  const normalizeState = requirePort("normalizeTransactionState", normalizeTransactionState);

  return Object.freeze({
    execute({ data, user }) {
      normalizeState(data);
      const dashboard = buildDashboard(data, user);
      const scoped = (item) => user.role === "commission"
        || item.institutionCode === user.orgCode
        || item.destinationInstitution === user.orgCode;
      return {
        ...dashboard,
        testReports: user.role === "commission" ? data.bloodTestReports : [],
        releaseReviews: user.role === "commission" ? data.bloodReleaseReviews : [],
        shipments: data.bloodShipments.filter(scoped),
        safetyIncidents: data.bloodSafetyIncidents.filter(scoped),
        compatibilityTests: user.role === "institution"
          ? data.compatibilityTests.filter((item) => dashboard.transfusionRequests.some((request) => request.id === item.requestId))
          : data.compatibilityTests,
        transfusionEpisodes: data.transfusionEpisodes.filter(scoped)
      };
    }
  });
}

module.exports = {
  OWNER,
  USE_CASE,
  createBloodDashboardQuery
};
