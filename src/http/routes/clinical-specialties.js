"use strict";

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

function createRouteSegments(runtime) {
  return [
    segment01.createRouteSegment(runtime),
    segment02.createRouteSegment(runtime),
    segment03.createRouteSegment(runtime),
    segment04.createRouteSegment(runtime),
    segment05.createRouteSegment(runtime),
    segment06.createRouteSegment(runtime),
    segment07.createRouteSegment(runtime),
    segment08.createRouteSegment(runtime),
    segment09.createRouteSegment(runtime),
    segment10.createRouteSegment(runtime)
  ];
}

module.exports = { createRouteSegments };
