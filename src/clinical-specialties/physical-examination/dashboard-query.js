"use strict";

const OWNER = "T06/physical-examination";
const USE_CASE = "physical-examination-dashboard-query.v1";

function requirePort(name, port) {
  if (typeof port !== "function") {
    throw new TypeError(`${name} port must be a function`);
  }
  return port;
}

function createPhysicalExaminationDashboardQuery({
  buildPhysicalExamOverview,
  buildPhysicalExamReadiness
} = {}) {
  const buildOverview = requirePort("buildPhysicalExamOverview", buildPhysicalExamOverview);
  const buildReadiness = requirePort("buildPhysicalExamReadiness", buildPhysicalExamReadiness);

  return Object.freeze({
    execute({
      data,
      user,
      residentId = "",
      residentIds = [],
      excludeDemoData = false
    }) {
      const overview = buildOverview(data, {
        residentId,
        residentIds,
        excludeDemoData
      });
      overview.readiness = buildReadiness(data, overview);
      if (!["commission", "institution"].includes(user.role)) {
        delete overview.jointTests;
        delete overview.gatewayEvents;
        delete overview.specializedIntakes;
        overview.readiness = {
          codeReady: overview.readiness.codeReady,
          quality: overview.readiness.quality,
          blockers: overview.readiness.blockers.length
        };
      }
      return overview;
    }
  });
}

module.exports = {
  OWNER,
  USE_CASE,
  createPhysicalExaminationDashboardQuery
};
