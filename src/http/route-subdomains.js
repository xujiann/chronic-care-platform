"use strict";

const ROUTE_SUBDOMAINS = Object.freeze({
  "public-health-01": "surveillance-foundation",
  "public-health-02": "public-health-operations",
  "public-health-03": "vital-records",
  "clinical-specialties-01": "imaging-cloud",
  "clinical-specialties-02": "operations-dashboard",
  "clinical-specialties-03": "operations-command",
  "clinical-specialties-04": "emergency-care",
  "clinical-specialties-05": "quality-safety",
  "clinical-specialties-06": "clinical-blood",
  "clinical-specialties-07": "mutual-recognition-ingest",
  "clinical-specialties-08": "mutual-recognition-review",
  "clinical-specialties-09": "emergency-signals",
  "clinical-specialties-10": "blood-innovation"
});

function attachRouteSubdomain(segment) {
  const subdomain = ROUTE_SUBDOMAINS[segment.id];
  if (!subdomain) return segment;
  return Object.freeze({ ...segment, subdomain });
}

module.exports = { ROUTE_SUBDOMAINS, attachRouteSubdomain };
