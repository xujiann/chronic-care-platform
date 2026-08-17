"use strict";

const runtimeContextFactory = require("../runtime-contexts/context-factory");
const platformContext = require("../runtime-contexts/platform-governance");
const ownershipContract = require("./t02-state-ownership-contract");

const SEGMENTS = Object.freeze([
  { subdomain: "governance-catalog", route: require("./platform-governance/governance-catalog") },
  { subdomain: "public-health-coordination", route: require("./platform-governance/public-health-coordination") },
  { subdomain: "site-launch-evidence", route: require("./platform-governance/site-launch-evidence") },
  { subdomain: "digital-hospital-pilot", route: require("./platform-governance/digital-hospital-pilot") },
  { subdomain: "digital-hospital-readiness", route: require("./platform-governance/digital-hospital-readiness") },
  { subdomain: "production-operations", route: require("./platform-governance/production-operations") },
  { subdomain: "digital-hospital-governance", route: require("./platform-governance/digital-hospital-governance") },
  { subdomain: "phase2-operations", route: require("./platform-governance/phase2-operations") },
  { subdomain: "mutual-recognition-overview", route: require("./platform-governance/mutual-recognition-overview") },
  { subdomain: "mutual-recognition-decision", route: require("./platform-governance/mutual-recognition-decision") },
  { subdomain: "productization-center", route: require("./platform-governance/productization-center") }
]);

function createRouteSegments(runtime) {
  return SEGMENTS.map(({ subdomain, route }) => {
    const subcontext = runtimeContextFactory.projectRuntimeSubcontext(runtime, {
      domain: platformContext.DOMAIN,
      subdomain,
      dependencies: platformContext.SUBDOMAIN_DEPENDENCIES[subdomain]
    });
    return route.createRouteSegment(
      ownershipContract.createOwnershipEnforcedRuntime(subcontext, subdomain)
    );
  });
}

module.exports = { createRouteSegments };
