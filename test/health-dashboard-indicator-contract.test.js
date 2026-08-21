"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTRACT_VERSION,
  POPULATION_SERVICE_VISITS_CONTRACT,
  buildPopulationServiceVisitsMeasurement,
  legacyAliasFor
} = require("../src/platform/governance/health-dashboard-indicator-contract");

function board(value = 321) {
  return {
    eventAnchor: "2026-06-16",
    statisticsPeriod: "2026-06",
    periods: [{
      id: "month",
      metrics: [{ id: "visits", value }]
    }]
  };
}

function signedDailyReport(overrides = {}) {
  return {
    id: "daily-service-20260616",
    reportDate: "2026-06-16",
    receiptNo: "receipt-ref-20260616",
    reconciled: true,
    sourceVersion: "daily-report.v3",
    sourceVersionApproved: true,
    interfaceData: { outpatientVisits: 300, emergencyVisits: 21 },
    ...overrides
  };
}

test("population service visits contract freezes owner, formula, unit, period and timezone", () => {
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.id, "population-service-visits.v1");
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.contractVersion, CONTRACT_VERSION);
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.ownerProcess, "T02");
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.sourceOwner, "T03");
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.aggregation.formula, "sum(outpatientVisits + emergencyVisits)");
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.valueType, "integer");
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.unit, "visits");
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.period, "calendar-month-to-date");
  assert.equal(POPULATION_SERVICE_VISITS_CONTRACT.timezone, "Asia/Shanghai");
});

test("signed or approved daily sources produce a typed deterministic ready measurement", () => {
  const input = {
    populationServiceBoard: board(),
    healthStatistics: { dailyServiceReports: [signedDailyReport()] },
    scope: { regionCode: "210200" }
  };
  const first = buildPopulationServiceVisitsMeasurement({
    ...input,
    computedAt: "2026-08-21T00:00:00.000Z"
  });
  const replay = buildPopulationServiceVisitsMeasurement({
    ...input,
    computedAt: "2026-08-21T01:00:00.000Z"
  });

  assert.deepEqual(first.value, { type: "integer", amount: 321, unit: "visits" });
  assert.deepEqual(first.period, {
    id: "2026-06",
    start: "2026-06-01",
    end: "2026-06-16",
    completeness: "month-to-date"
  });
  assert.equal(first.scope.provenance, "server-runtime");
  assert.equal(first.sourceWatermark, "2026-06-16");
  assert.equal(first.qualityStatus, "ready");
  assert.deepEqual(first.blockers, []);
  assert.equal(first.digest, replay.digest);
  assert.notEqual(first.computedAt, replay.computedAt);
});

test("monthly fallback and unsigned daily sources stay blocked instead of becoming production evidence", () => {
  const monthly = buildPopulationServiceVisitsMeasurement({
    populationServiceBoard: board(500),
    healthStatistics: { period: "2026-06", serviceReports: [{ institutionId: "org-1" }] },
    scope: { regionCode: "210200" }
  });
  assert.equal(monthly.sourceMode, "monthly-snapshot-estimate");
  assert.equal(monthly.estimated, true);
  assert.equal(monthly.qualityStatus, "blocked");
  assert.equal(monthly.blockers.includes("MONTHLY_SNAPSHOT_ESTIMATE_NOT_PRODUCTION_READY"), true);

  const unsigned = buildPopulationServiceVisitsMeasurement({
    populationServiceBoard: board(),
    healthStatistics: { dailyServiceReports: [signedDailyReport({ sourceVersionApproved: false })] },
    scope: { regionCode: "210200" }
  });
  assert.equal(unsigned.qualityStatus, "blocked");
  assert.equal(unsigned.blockers.includes("DAILY_SOURCE_SIGNATURE_OR_VERSION_MISSING"), true);
});

test("missing server-derived scope and unknown contract versions fail closed", () => {
  const missingScope = buildPopulationServiceVisitsMeasurement({
    populationServiceBoard: board(),
    healthStatistics: { dailyServiceReports: [signedDailyReport()] }
  });
  assert.equal(missingScope.qualityStatus, "blocked");
  assert.equal(missingScope.blockers.includes("SERVER_SCOPE_UNRESOLVED"), true);

  assert.throws(
    () => buildPopulationServiceVisitsMeasurement({ contractVersion: "health-dashboard-indicator-contract.v2" }),
    (error) => error.code === "HEALTH_DASHBOARD_INDICATOR_CONTRACT_UNSUPPORTED"
  );
});

test("late corrections publish a new digest revision and invalidation remains blocked", () => {
  const base = {
    populationServiceBoard: board(),
    healthStatistics: { dailyServiceReports: [signedDailyReport()] },
    scope: { regionCode: "210200" },
    computedAt: "2026-08-21T00:00:00.000Z"
  };
  const first = buildPopulationServiceVisitsMeasurement({ ...base, revision: 1 });
  const revised = buildPopulationServiceVisitsMeasurement({ ...base, revision: 2 });
  assert.equal(first.qualityStatus, "ready");
  assert.equal(revised.revision, 2);
  assert.notEqual(revised.digest, first.digest);

  const invalidated = buildPopulationServiceVisitsMeasurement({
    ...base,
    revision: 2,
    invalidatedAt: "2026-08-21T02:00:00.000Z"
  });
  assert.equal(invalidated.qualityStatus, "blocked");
  assert.equal(invalidated.blockers.includes("MEASUREMENT_INVALIDATED"), true);
  assert.throws(
    () => buildPopulationServiceVisitsMeasurement({ ...base, revision: 0 }),
    (error) => error.code === "HEALTH_DASHBOARD_INDICATOR_REVISION_INVALID"
  );
});

test("legacy dashboard ids use an explicit deprecated alias table", () => {
  assert.deepEqual(legacyAliasFor("performance-public-hospital"), {
    id: "industry-appointment-reconciliation",
    drilldownHref: "./citizen.html",
    canonicalId: "performance-public-hospital",
    deprecated: true,
    mapping: "explicit-compatibility-alias"
  });
  assert.equal(legacyAliasFor("unknown-indicator"), null);
});
