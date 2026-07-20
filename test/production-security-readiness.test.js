const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProductionSecurityReadiness, renderMarkdown } = require("../scripts/production-security-readiness");

test("production security readiness wires P0-07 controls without asserting formal approval", () => {
  const report = buildProductionSecurityReadiness({ now: "2026-07-18T00:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.center.productionGate.softwareControlReady, true);
  assert.equal(report.center.productionGate.formalProductionReady, false);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.match(renderMarkdown(report), /Production boundary/);
});
