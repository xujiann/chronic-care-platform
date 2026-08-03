"use strict";

const runtimeContextFactory = require("../runtime-contexts/context-factory");
const clinicalContext = require("../runtime-contexts/clinical-specialties");
const segment01 = require("./clinical-specialties/imaging-cloud");
const segment02 = require("./clinical-specialties/operations-dashboard");
const segment03 = require("./clinical-specialties/operations-command");
const segment04 = require("./clinical-specialties/emergency-care");
const segment05 = require("./clinical-specialties/quality-safety");
const segment06 = require("./clinical-specialties/clinical-blood");
const segment07 = require("./clinical-specialties/mutual-recognition-ingest");
const segment08 = require("./clinical-specialties/mutual-recognition-review");
const segment09 = require("./clinical-specialties/emergency-signals");
const segment10 = require("./clinical-specialties/blood-innovation");

const DOMAIN = "clinical-specialties";
const SUBDOMAIN_SEGMENTS = Object.freeze([
  ["imaging-cloud", segment01], ["operations-dashboard", segment02],
  ["operations-command", segment03], ["emergency-care", segment04],
  ["quality-safety", segment05], ["clinical-blood", segment06],
  ["mutual-recognition-ingest", segment07], ["mutual-recognition-review", segment08],
  ["emergency-signals", segment09], ["blood-innovation", segment10]
]);

function createRouteSegments(runtime) {
  return SUBDOMAIN_SEGMENTS.map(([subdomain, routeModule]) => routeModule.createRouteSegment(
    runtimeContextFactory.projectRuntimeSubcontext(runtime, {
      domain: DOMAIN,
      subdomain,
      dependencies: clinicalContext.SUBDOMAIN_DEPENDENCIES[subdomain]
    })
  ));
}

module.exports = { createRouteSegments, SUBDOMAIN_SEGMENTS };
