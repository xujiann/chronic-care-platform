"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-09";
const SUBDOMAIN = "mutual-recognition-overview";

function createRouteSegment(runtime) {
  const { buildPhase2MutualRecognitionOverview, readDatabase, requireApiRole, sendJson } = runtime;
  return {
      id: "platform-governance-09",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/phase2/mutual-recognition") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/phase2/mutual-recognition");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPhase2MutualRecognitionOverview(data));
        return true;
      }
        return false;
      }
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
