const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildProductionGoNoGoReadiness, renderMarkdown } = require("../scripts/production-go-no-go-readiness");

test("go/no-go approval responsibility uses a namespace distinct from auth roles", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "production-go-no-go-ui.js"), "utf8");
  assert.match(source, /data-approval-role="\$\{escapeHtml\(item\.role\)\}"/);
  assert.match(source, /approval\.dataset\.approvalRole/);
  assert.doesNotMatch(source, /data-role="\$\{escapeHtml\(item\.role\)\}"/);
});

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
