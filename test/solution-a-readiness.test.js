const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSolutionAReadiness } = require("../scripts/solution-a-readiness");
test("solution A development assets are complete while production secrets remain a site gate", () => {
  const report = buildSolutionAReadiness({});
  assert.equal(report.ok, true); assert.equal(report.productionReady, false);
  assert.equal(report.checks.find((item) => item.id === "solution-a:production-secrets").siteBlocker, true);
});
