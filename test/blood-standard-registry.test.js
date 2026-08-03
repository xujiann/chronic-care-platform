const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../blood-standard-registry");

test("WS/T 866 registry represents all twelve clinical blood dataset subsets", () => {
  const coverage = registry.coverage();
  assert.equal(coverage.standard.number, "WS/T 866—2025");
  assert.equal(coverage.standard.effectiveAt, "2026-01-01");
  assert.equal(coverage.subsets, 12);
  assert.equal(coverage.completeSubsetCoverage, true);
  assert.ok(coverage.registeredElements >= 29);
});

test("WS/T 866 registry rejects incomplete crossmatch records", () => {
  assert.equal(registry.validateRecord("crossmatch", {}).valid, false);
  assert.equal(registry.validateRecord("crossmatch", {
    crossmatchMethodCode: "1",
    crossmatchResultCode: "1",
    performedBy: "operator",
    reviewedBy: "reviewer"
  }).valid, true);
  assert.equal(registry.validateRecord("unknown", {}).valid, false);
});
