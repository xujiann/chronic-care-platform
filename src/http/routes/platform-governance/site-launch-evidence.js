"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-03";
const SUBDOMAIN = "site-launch-evidence";

function createRouteSegment(runtime) {
  const { buildProcessAuditReport, readDatabase, requireApiRole, sendJson } = runtime;
  return {
      id: "platform-governance-03",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/process-audit") {
        const user = requireApiRole(req, res, ["commission"], "/api/process-audit");
        if (!user) return true;
        sendJson(res, 200, buildProcessAuditReport({ data: readDatabase() }));
        return true;
      }
        return false;
      }
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
