"use strict";

const DOMAIN = "runtime";
const PROCESS = "T01";
const DEPENDENCIES = Object.freeze([
  "BloodEventHub", "PROJECT_VERSION", "RUNTIME_STARTED_AT", "appendSecurityEvent",
  "buildHealthDashboardSummary", "buildReleaseReport", "buildRuntimeMetrics", "buildSystemReadinessReport",
  "collectJson", "normalizeHealthStatisticsImportJob", "prependAuditTrailEntry", "probeSessionStoreStatus",
  "randomUUID", "readDatabase", "renderPrometheusRuntimeMetrics", "requireApiRole",
  "seedHealthStatisticsIngestion", "sendJson", "sendText", "sessionStoreHealthStatus", "storageMeta", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };
