"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDevelopmentLinesReadiness } = require("../scripts/development-lines-readiness");

const NOW = "2026-08-17T03:30:00.000Z";

function fixtures(overrides = {}) {
  return {
    now: NOW,
    dataMigration: {
      schemaVersion: "data-migration-control-center-v1",
      ok: true,
      controlPlaneReady: true,
      localGateReady: false,
      productionReady: false,
      summary: { collections: 12, runs: 0 }
    },
    interfacePilot: {
      schema: "institution-pilot-readiness-v1",
      ok: false,
      productionGate: "NO-GO",
      productionReady: false,
      externalEvidenceVerified: false,
      summary: { sessions: 0, localClosedLoops: 0 },
      blockers: ["signed-joint-test-receipts-pending"]
    },
    productOperations: {
      schemaVersion: "product-operations-center-v1",
      ok: true,
      status: "locally-controlled",
      productionReady: false,
      summary: { workItems: 34 },
      blockers: ["site-acceptance-pending"]
    },
    ...overrides
  };
}

test("three-line readiness reports usable controls while production stays closed", () => {
  const report = buildDevelopmentLinesReadiness(fixtures());
  assert.equal(report.generatedAt, NOW);
  assert.equal(report.ok, true);
  assert.equal(report.localReady, false);
  assert.equal(report.productionGate, "NO-GO");
  assert.equal(report.productionReady, false);
  assert.equal(report.lines.data.summary.collections, 12);
  assert.equal(report.lines.productOperations.summary.workItems, 34);
  assert.equal(report.checks.length, 4);
});

test("three-line readiness detects any line that claims production readiness", () => {
  const input = fixtures();
  input.interfacePilot = { ...input.interfacePilot, productionReady: true };
  const report = buildDevelopmentLinesReadiness(input);
  assert.equal(report.ok, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.find((item) => item.id === "developmentLines:productionFailClosed").passed, false);
});
