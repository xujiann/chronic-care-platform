"use strict";

const { sha256 } = require("./technical-evidence");

const CONTRACT_VERSION = "health-dashboard-indicator-contract.v1";
const INDICATOR_ID = "population-service-visits.v1";
const TIMEZONE = "Asia/Shanghai";

const POPULATION_SERVICE_VISITS_CONTRACT = Object.freeze({
  id: INDICATOR_ID,
  contractVersion: CONTRACT_VERSION,
  definitionVersion: "1.0.0",
  ownerProcess: "T02",
  sourceOwner: "T03",
  sourceCollections: Object.freeze([
    "healthStatistics.dailyServiceReports",
    "healthStatistics.serviceReports"
  ]),
  aggregation: Object.freeze({
    type: "sum",
    formula: "sum(outpatientVisits + emergencyVisits)",
    numeratorFields: Object.freeze(["outpatientVisits", "emergencyVisits"]),
    denominator: null
  }),
  valueType: "integer",
  unit: "visits",
  period: "calendar-month-to-date",
  timezone: TIMEZONE,
  classification: "aggregate-operational-statistic",
  effectiveFrom: "2026-08-21",
  deprecatedAt: null,
  qualityPolicy: Object.freeze({
    readySources: Object.freeze(["signed-daily-report", "approved-versioned-daily-report"]),
    estimatedSources: Object.freeze(["monthly-snapshot-estimate"]),
    missingScopeBehavior: "blocked",
    unknownVersionBehavior: "fail-closed"
  }),
  revisionPolicy: Object.freeze({
    lateData: "publish-new-monotonic-revision",
    correction: "retain-prior-digest-and-publish-new-revision",
    invalidation: "blocked-with-reason"
  })
});

const LEGACY_INDICATOR_ALIASES = Object.freeze({
  "standard-indicator-catalog": Object.freeze({
    id: "industry-physical-exam",
    displayName: "健康体检覆盖",
    statusOverride: "blocked"
  }),
  "performance-public-hospital": Object.freeze({
    id: "industry-appointment-reconciliation",
    drilldownHref: "./citizen.html"
  }),
  "grade-review-evidence": Object.freeze({
    id: "industry-disease-reporting",
    sourceSystems: Object.freeze(["HIS/EMR", "LIS", "CDC reporting gateway"])
  })
});

function contractError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function assertContractVersion(version = CONTRACT_VERSION) {
  if (version !== CONTRACT_VERSION) {
    throw contractError(
      "HEALTH_DASHBOARD_INDICATOR_CONTRACT_UNSUPPORTED",
      "unsupported health dashboard indicator contract version"
    );
  }
  return version;
}

function validDate(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function validPeriod(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : "";
}

function monthPeriod(anchor, fallbackPeriod) {
  const date = validDate(anchor);
  const month = date ? date.slice(0, 7) : validPeriod(fallbackPeriod);
  return {
    id: month || "unresolved",
    start: month ? `${month}-01` : null,
    end: date && date.startsWith(month) ? date : null,
    completeness: date && date.endsWith("-01") ? "partial" : "month-to-date"
  };
}

function normalizeScope(scope) {
  const input = scope && typeof scope === "object" ? scope : {};
  const regionCode = String(input.regionCode || "").trim();
  const institutionCode = String(input.institutionCode || "").trim();
  return {
    level: institutionCode ? "institution" : "region",
    regionCode: regionCode || null,
    institutionCode: institutionCode || null,
    provenance: "server-runtime"
  };
}

function dailyReportIsApproved(report) {
  const signatureDigest = String(report?.signatureDigest || "").trim();
  const sourceVersion = String(report?.sourceVersion || "").trim();
  const signed = /^sha256:[a-f0-9]{64}$/.test(signatureDigest);
  return signed || (sourceVersion && report?.sourceVersionApproved === true);
}

function sourceProjection(healthStatistics) {
  const statistics = healthStatistics && typeof healthStatistics === "object" ? healthStatistics : {};
  const daily = Array.isArray(statistics.dailyServiceReports) ? statistics.dailyServiceReports : [];
  const monthly = Array.isArray(statistics.serviceReports) ? statistics.serviceReports : [];
  const dailyDates = daily.map((item) => validDate(item?.reportDate || item?.date || item?.serviceDate)).filter(Boolean).sort();
  const dailyEvidence = daily.map((item) => ({
    id: String(item?.id || "").trim() || null,
    date: validDate(item?.reportDate || item?.date || item?.serviceDate) || null,
    sourceVersion: String(item?.sourceVersion || "").trim() || null,
    revision: Number.isSafeInteger(Number(item?.revision)) && Number(item.revision) > 0 ? Number(item.revision) : 1,
    receiptRef: String(item?.receiptNo || "").trim() || null,
    reconciled: item?.reconciled === true,
    approved: dailyReportIsApproved(item)
  }));
  return {
    daily,
    monthly,
    dailyEvidence,
    watermark: dailyDates.at(-1) || (validPeriod(statistics.period) ? `${statistics.period}-01` : null)
  };
}

function buildPopulationServiceVisitsMeasurement(options = {}) {
  assertContractVersion(options.contractVersion);
  const board = options.populationServiceBoard && typeof options.populationServiceBoard === "object"
    ? options.populationServiceBoard
    : {};
  const sources = sourceProjection(options.healthStatistics);
  const scope = normalizeScope(options.scope);
  const revision = Number(options.revision ?? 1);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw contractError("HEALTH_DASHBOARD_INDICATOR_REVISION_INVALID", "indicator revision must be a positive integer");
  }
  const monthlyPeriod = (board.periods || []).find((item) => item.id === "month") || { metrics: [] };
  const visitsMetric = (monthlyPeriod.metrics || []).find((item) => item.id === "visits") || {};
  const value = Number(visitsMetric.value || 0);
  const period = monthPeriod(board.eventAnchor || sources.watermark, board.statisticsPeriod);
  const blockers = [];
  let sourceMode = "missing";
  let estimated = false;

  if (sources.daily.length) {
    sourceMode = "daily-interface";
    if (!sources.dailyEvidence.every((item) => item.date && item.receiptRef && item.reconciled)) {
      blockers.push("DAILY_SOURCE_EVIDENCE_INCOMPLETE");
    }
    if (!sources.dailyEvidence.every((item) => item.approved)) {
      blockers.push("DAILY_SOURCE_SIGNATURE_OR_VERSION_MISSING");
    }
  } else if (sources.monthly.length) {
    sourceMode = "monthly-snapshot-estimate";
    estimated = true;
    blockers.push("MONTHLY_SNAPSHOT_ESTIMATE_NOT_PRODUCTION_READY");
  } else {
    blockers.push("SOURCE_DATA_MISSING");
  }
  if (!scope.regionCode) blockers.push("SERVER_SCOPE_UNRESOLVED");
  if (!period.start || !period.end) blockers.push("MEASUREMENT_PERIOD_UNRESOLVED");
  if (!Number.isSafeInteger(value) || value < 0) blockers.push("MEASUREMENT_VALUE_INVALID");
  const invalidatedAt = String(options.invalidatedAt || "").trim() || null;
  if (invalidatedAt) blockers.push("MEASUREMENT_INVALIDATED");

  const immutableProjection = {
    schemaVersion: CONTRACT_VERSION,
    indicatorId: INDICATOR_ID,
    definitionVersion: POPULATION_SERVICE_VISITS_CONTRACT.definitionVersion,
    revision,
    scope,
    period,
    value: {
      type: POPULATION_SERVICE_VISITS_CONTRACT.valueType,
      amount: Number.isSafeInteger(value) && value >= 0 ? value : null,
      unit: POPULATION_SERVICE_VISITS_CONTRACT.unit
    },
    sourceOwner: POPULATION_SERVICE_VISITS_CONTRACT.sourceOwner,
    sourceCollections: POPULATION_SERVICE_VISITS_CONTRACT.sourceCollections,
    sourceMode,
    sourceWatermark: sources.watermark,
    asOf: sources.watermark,
    sourceVersions: sources.dailyEvidence,
    estimated,
    invalidatedAt,
    qualityStatus: blockers.length ? "blocked" : "ready",
    blockers
  };
  return {
    ...immutableProjection,
    computedAt: String(options.computedAt || new Date().toISOString()),
    digest: sha256(immutableProjection)
  };
}

function legacyAliasFor(canonicalId) {
  const alias = LEGACY_INDICATOR_ALIASES[canonicalId];
  if (!alias) return null;
  return {
    ...alias,
    canonicalId,
    deprecated: true,
    mapping: "explicit-compatibility-alias"
  };
}

module.exports = {
  CONTRACT_VERSION,
  INDICATOR_ID,
  LEGACY_INDICATOR_ALIASES,
  POPULATION_SERVICE_VISITS_CONTRACT,
  TIMEZONE,
  assertContractVersion,
  buildPopulationServiceVisitsMeasurement,
  legacyAliasFor
};
