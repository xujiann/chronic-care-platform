"use strict";

const segment01 = require("./public-health/surveillance-foundation");
const segment02 = require("./public-health/public-health-operations");
const segment03 = require("./public-health/vital-records");

function createRouteSegments(runtime) {
  return [
    segment01.createRouteSegment(runtime),
    segment02.createRouteSegment(runtime),
    segment03.createRouteSegment(runtime)
  ];
}

module.exports = { createRouteSegments };
