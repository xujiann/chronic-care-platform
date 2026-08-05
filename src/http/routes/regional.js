"use strict";

function createRouteSegments({ regionalContext, sendJson }) {
  if (!regionalContext || regionalContext.schemaVersion !== "regional-public-context-v1") {
    throw new TypeError("regional route requires a public regional context");
  }
  if (typeof sendJson !== "function") throw new TypeError("regional route requires sendJson");
  return [{
    id: "regional-01",
    domain: "regional",
    async handle(req, res, url) {
      if (req.method !== "GET" || url.pathname !== "/api/regional/context") return false;
      sendJson(res, 200, regionalContext);
      return true;
    }
  }];
}

module.exports = { createRouteSegments };
