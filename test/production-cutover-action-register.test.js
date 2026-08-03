"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildActionRegisterReport,
  containsSensitiveMaterial,
  loadRegister
} = require("../scripts/production-cutover-action-register");

test("production cutover action register is complete, redacted and fail-closed", () => {
  const register = loadRegister();
  const report = buildActionRegisterReport(register);

  assert.equal(report.ok, true);
  assert.equal(report.status, "tracked-no-go");
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.actions, 14);
  assert.equal(report.summary.externalBlocked, 14);
  assert.equal(report.summary.issues, 5);
  assert.deepEqual(containsSensitiveMaterial(register), []);
});

test("missing actions or embedded credentials fail structural validation", () => {
  const register = structuredClone(loadRegister());
  register.cutoverActions.pop();
  register.credential = "must-not-exist";
  const report = buildActionRegisterReport(register);

  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "actionRegister:cutoverCoverage").passed, false);
  assert.equal(report.checks.find((item) => item.id === "actionRegister:secretBoundary").passed, false);
});
