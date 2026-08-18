"use strict";

const { projectImagingDashboardResponse } = require("./public-response");

const OWNER = "T06/imaging";
const USE_CASE = "imaging-dashboard-query.v1";

function requirePort(name, port) {
  if (typeof port !== "function") {
    throw new TypeError(`${name} port must be a function`);
  }
  return port;
}

function createImagingDashboardQuery({
  buildImagingDashboard,
  redactSensitiveResponse
} = {}) {
  const buildDashboard = requirePort("buildImagingDashboard", buildImagingDashboard);
  const redactResponse = requirePort("redactSensitiveResponse", redactSensitiveResponse);

  return Object.freeze({
    execute({ data, user, residentId = "", institutionCode = "" }) {
      const dashboard = buildDashboard(data, user, { residentId, institutionCode });
      return projectImagingDashboardResponse(redactResponse(dashboard, user));
    }
  });
}

module.exports = {
  OWNER,
  USE_CASE,
  createImagingDashboardQuery
};
