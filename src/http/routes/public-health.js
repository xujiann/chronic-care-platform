"use strict";

const runtimeContextFactory = require("../runtime-contexts/context-factory");
const publicHealthContext = require("../runtime-contexts/public-health");
const segment01 = require("./public-health/surveillance-foundation");
const segment02 = require("./public-health/public-health-operations");
const segment03 = require("./public-health/vital-records");
const segment04 = require("./public-health/infectious-reporting");
const segment05 = require("./public-health/health-supervision");
const segment06 = require("./public-health/health-supervision-cases");

const DOMAIN = "public-health";
const SUBDOMAIN_SEGMENTS = Object.freeze([
  ["surveillance-foundation", segment01],
  ["public-health-operations", segment02],
  ["vital-records", segment03],
  ["infectious-reporting", segment04],
  ["health-supervision", segment05],
  ["health-supervision-cases", segment06]
]);

function createRouteSegments(runtime) {
  return SUBDOMAIN_SEGMENTS.map(([subdomain, routeModule]) => routeModule.createRouteSegment(
    runtimeContextFactory.projectRuntimeSubcontext(runtime, {
      domain: DOMAIN,
      subdomain,
      dependencies: publicHealthContext.SUBDOMAIN_DEPENDENCIES[subdomain]
    })
  ));
}

module.exports = { createRouteSegments, SUBDOMAIN_SEGMENTS };
