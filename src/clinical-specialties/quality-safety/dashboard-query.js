"use strict";

const OWNER = "T06/quality-safety";
const USE_CASE = "quality-safety-dashboard-query.v1";
const BLOOD_QUALITY_SIGNAL_CONTRACT = "blood-quality-signal.v1";

function requirePort(name, port) {
  if (typeof port !== "function") {
    throw new TypeError(`${name} port must be a function`);
  }
  return port;
}

function createQualitySafetyDashboardQuery({
  buildQualitySafetyDashboard,
  readBloodCoordination
} = {}) {
  const buildDashboard = requirePort("buildQualitySafetyDashboard", buildQualitySafetyDashboard);
  const readCoordination = requirePort("readBloodCoordination", readBloodCoordination);

  return Object.freeze({
    execute({ data, user }) {
      const bloodCoordination = readCoordination(data, user);
      return {
        ...buildDashboard(data, user),
        bloodCoordination: {
          ...bloodCoordination,
          projections: bloodCoordination.projections.filter((item) => item.consumer === "quality-safety")
        }
      };
    }
  });
}

module.exports = {
  BLOOD_QUALITY_SIGNAL_CONTRACT,
  OWNER,
  USE_CASE,
  createQualitySafetyDashboardQuery
};
