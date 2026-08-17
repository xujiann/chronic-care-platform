"use strict";

const ROUTE_SUBDOMAINS = Object.freeze({
  "platform-governance-01": "governance-catalog",
  "platform-governance-02": "public-health-coordination",
  "platform-governance-03": "site-launch-evidence",
  "platform-governance-04": "digital-hospital-pilot",
  "platform-governance-05": "digital-hospital-readiness",
  "platform-governance-06": "production-operations",
  "platform-governance-07": "digital-hospital-governance",
  "platform-governance-08": "phase2-operations",
  "platform-governance-09": "mutual-recognition-overview",
  "platform-governance-10": "mutual-recognition-decision",
  "platform-governance-11": "productization-center",
  "public-health-01": "surveillance-foundation",
  "public-health-02": "public-health-operations",
  "public-health-03": "vital-records",
  "public-health-04": "infectious-reporting",
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
