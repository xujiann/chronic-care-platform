"use strict";

const OWNER = "T06/emergency";
const BLOOD_COORDINATION_CONTRACT = "blood-emergency-coordination.v1";

function requirePort(name, port) {
  if (typeof port !== "function") {
    throw new TypeError(`${name} port must be a function`);
  }
  return port;
}

function createEmergencyDashboardQuery({
  buildEmergencyDashboard,
  readBloodCoordination
} = {}) {
  const buildDashboard = requirePort("buildEmergencyDashboard", buildEmergencyDashboard);
  const readCoordination = requirePort("readBloodCoordination", readBloodCoordination);

  return Object.freeze({
    execute({ data, user }) {
      const dashboard = buildDashboard(data, user);
      const bloodCoordination = readCoordination(data, user);
      return {
        ...dashboard,
        bloodCoordination: {
          ...bloodCoordination,
          projections: bloodCoordination.projections.filter((item) => item.consumer === "emergency")
        }
      };
    }
  });
}

module.exports = {
  BLOOD_COORDINATION_CONTRACT,
  OWNER,
  createEmergencyDashboardQuery
};
