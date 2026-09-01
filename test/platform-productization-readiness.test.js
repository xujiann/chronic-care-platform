"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const promotionProgram = require("../config/p0-data-promotions.json");
const { promotionPhaseCounts } = require("../src/platform/data/promotion-contract");
const { buildPlatformProductizationReadiness } = require("../src/platform/productization/productization-readiness");
const { renderMarkdown } = require("../scripts/platform-productization-readiness");

const ROOT = path.resolve(__dirname, "..");

test("productization readiness completes local gates and keeps production fail closed", () => {
  const report = buildPlatformProductizationReadiness({ root: ROOT, now: "2026-08-17T00:00:00.000Z" });
  const phases = promotionPhaseCounts(promotionProgram);
  assert.equal(report.ok, true);
  assert.equal(report.localFoundationReady, true);
  assert.equal(report.siteReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.iterations, 6);
  assert.equal(report.summary.promotedP0, phases.promotedP0);
  assert.equal(report.summary.repositoryPlanReady, phases.repositoryPlanReady);
  assert.equal(report.summary.firstReleaseMigrationPlans, 20);
  assert.equal(report.summary.firstReleaseDerivedReadModels, 1);
  assert.equal(report.summary.regionalRequirements, 19);
  assert.equal(report.summary.regionalRequirementOwnerReview, 19);
  assert.equal(report.containsPatientData, false);
  assert.equal(report.containsCredentials, false);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.checks.find((item) => item.id === "productization:regionalAssembly").detail, "template");
  assert.equal(report.checks.find((item) => item.id === "productization:regionalRequirements").detail, "19 normalized requirements / 19 owner review");
  assert.match(renderMarkdown(report), /Production readiness: NO-GO/);
  assert.match(renderMarkdown(report), /P0 collections promoted: 12/);
  assert.match(renderMarkdown(report), /Collections repository plan-ready: 19/);
  assert.match(renderMarkdown(report), /First-release persistent migration plans: 20/);
});

test("productization readiness rejects incomplete iteration programs", () => {
  assert.throws(() => buildPlatformProductizationReadiness({
    root: ROOT,
    program: { schemaVersion: "platform-productization-program-v1", iterations: [] }
  }), /six iterations/);
});
