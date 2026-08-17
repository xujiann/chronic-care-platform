"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { buildPlatformProductizationReadiness } = require("../src/platform/productization/productization-readiness");
const { renderMarkdown } = require("../scripts/platform-productization-readiness");

const ROOT = path.resolve(__dirname, "..");

test("productization readiness completes local gates and keeps production fail closed", () => {
  const report = buildPlatformProductizationReadiness({ root: ROOT, now: "2026-08-17T00:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.localFoundationReady, true);
  assert.equal(report.siteReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.iterations, 6);
  assert.equal(report.summary.promotedP0, 12);
  assert.equal(report.containsPatientData, false);
  assert.equal(report.containsCredentials, false);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.checks.find((item) => item.id === "productization:regionalAssembly").detail, "template");
  assert.match(renderMarkdown(report), /Production readiness: NO-GO/);
});

test("productization readiness rejects incomplete iteration programs", () => {
  assert.throws(() => buildPlatformProductizationReadiness({
    root: ROOT,
    program: { schemaVersion: "platform-productization-program-v1", iterations: [] }
  }), /six iterations/);
});
