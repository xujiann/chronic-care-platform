"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const program = require("../config/regional-pilot-program.json");
const { buildRegionalPilotReadiness, validateProgram } = require("../src/platform/regional/regional-pilot-program");

test("regional pilot defines one runnable chronic-referral slice and preserves site boundaries", () => {
  assert.equal(validateProgram(program), true);
  const report = buildRegionalPilotReadiness({ env: {}, receipts: [], now: "2026-08-16T04:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.localFoundationReady, true);
  assert.equal(report.siteReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.program.steps.length, 6);
  assert.equal(report.adapterReceipts.length, 4);
  assert.equal(report.adapterReceipts.every((item) => item.status === "pending-external"), true);
  assert.equal(report.containsPatientData, false);
  assert.equal(report.containsCredentials, false);
});

test("regional pilot rejects unsigned or ownerless adapter contracts", () => {
  const invalid = structuredClone(program);
  invalid.adapterContracts[0].receipt = "local-boolean";
  assert.throws(() => validateProgram(invalid), /signed receipts/);
});
