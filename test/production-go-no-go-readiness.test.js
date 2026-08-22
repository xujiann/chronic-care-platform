const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProductionGoNoGoReadiness, renderMarkdown } = require("../scripts/production-go-no-go-readiness");

test("global go/no-go readiness validates software controls while preserving runtime blockers", () => {
  const report = buildProductionGoNoGoReadiness({ now: "2026-07-20T00:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.center.gate.softwareControlReady, true);
  assert.equal(report.center.gate.productionGoRecorded, false);
  assert.equal(report.checks.some((item) => item.id === "goNoGoReadiness:evidenceDrift" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "goNoGoReadiness:trustedReceipt" && item.passed), true);
  assert.equal(report.center.checks.some((item) => item.id === "goNoGo:trustedPreflightDecision" && !item.passed), true);
  assert.match(renderMarkdown(report), /Runtime prerequisites/);
  assert.match(renderMarkdown(report), /Stale approvals/);
});
