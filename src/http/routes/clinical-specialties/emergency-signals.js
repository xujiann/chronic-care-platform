"use strict";

function createRouteSegment(runtime) {
  const { collectJson, patchCollectionItem, readDatabase, requireApiRole, sendJson } = runtime;
  return {
      id: "clinical-specialties-09",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/emergency-signals/")) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/emergency-signals/:id");
        if (!user) return true;
        const result = patchCollectionItem({
          data: readDatabase(),
          collection: "emergencySignals",
          id: decodeURIComponent(url.pathname.replace("/api/emergency-signals/", "")),
          patch: await collectJson(req),
          user,
          action: "更新公卫预警"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-09", SUBDOMAIN: "emergency-signals" };
