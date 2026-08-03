"use strict";

function assertRouteSegment(segment, index) {
  if (!segment || typeof segment !== "object") {
    throw new TypeError(`route segment ${index} must be an object`);
  }
  if (!segment.id || typeof segment.id !== "string") {
    throw new TypeError(`route segment ${index} must have an id`);
  }
  if (!segment.domain || typeof segment.domain !== "string") {
    throw new TypeError(`route segment ${segment.id} must have a domain`);
  }
  if (typeof segment.handle !== "function") {
    throw new TypeError(`route segment ${segment.id} must have a handler`);
  }
}

function createApiRouter(routeSegments) {
  if (!Array.isArray(routeSegments) || routeSegments.length === 0) {
    throw new TypeError("at least one route segment is required");
  }

  const seen = new Set();
  const segments = routeSegments.map((segment, index) => {
    assertRouteSegment(segment, index);
    if (seen.has(segment.id)) {
      throw new TypeError(`duplicate route segment id: ${segment.id}`);
    }
    seen.add(segment.id);
    return Object.freeze({ ...segment });
  });

  const manifest = Object.freeze(segments.map(({ id, domain, subdomain }) => Object.freeze({
    id,
    domain,
    ...(subdomain ? { subdomain } : {})
  })));

  return Object.freeze({
    manifest,
    async handle(req, res, url) {
      for (const segment of segments) {
        const handled = await segment.handle(req, res, url);
        if (handled === true || res.writableEnded || res.headersSent) return true;
      }
      return false;
    }
  });
}

module.exports = { createApiRouter };
