const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildFinancialGatewayReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/financial-gateway-readiness");

const ROOT = path.resolve(__dirname, "..");

test("financial gateway readiness separates adapter foundation from production acceptance", () => {
  const report = buildFinancialGatewayReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.status, "signed-callback-reconciliation-ready-site-joint-test-pending");
  assert.equal(report.summary.gateways, 3);
  assert.equal(report.summary.operations, 14);
  assert.equal(report.summary.capabilityGroupsReady, report.summary.capabilityGroups);
  assert.equal(report.capabilities.find((item) => item.id === "online-refund-closed-loop").passed, true);
  assert.equal(report.checks.find((item) => item.id === "financialGateway:operationsUi").passed, true);
  assert.equal(report.blockers.length, 6);
});

test("financial gateway readiness detects an incomplete online refund closed loop", () => {
  const source = fs
    .readFileSync(path.join(ROOT, "online-payment-refunds.js"), "utf8")
    .replaceAll("REFUND_LEDGER_INVALID", "REMOVED_REFUND_LEDGER_VERIFICATION");
  const report = buildFinancialGatewayReadiness({ refundSource: source });
  assert.equal(report.ok, false);
  assert.equal(report.capabilities.find((item) => item.id === "online-refund-closed-loop").passed, false);
});

test("financial gateway readiness requires governed rejected-refund resubmission", () => {
  const source = fs
    .readFileSync(path.join(ROOT, "online-payment-refunds.js"), "utf8")
    .replaceAll("REFUND_RESUBMISSION_NEW_EVIDENCE_REQUIRED", "REMOVED_REFUND_RESUBMISSION");
  const report = buildFinancialGatewayReadiness({ refundSource: source });
  assert.equal(report.ok, false);
  assert.equal(report.capabilities.find((item) => item.id === "online-refund-closed-loop").passed, false);
});

test("financial gateway readiness fails when sensitive payload protection is removed", () => {
  const source = fs.readFileSync(path.join(ROOT, "financial-gateways.js"), "utf8").replaceAll("FORBIDDEN_PAYLOAD_KEYS", "REMOVED_PAYLOAD_GUARD");
  const report = buildFinancialGatewayReadiness({ adapterSource: source });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "financialGateway:capabilities" && !item.passed), true);
});

test("financial gateway readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "financial-gateway-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildFinancialGatewayReadiness();
  assert.match(renderMarkdown(report), /Financial and certificate gateway readiness/);
  writeOutput(report, {
    output: "tmp/financial-gateway-readiness-test/report.json",
    markdown: "tmp/financial-gateway-readiness-test/report.md"
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "report.md"), "utf8"), /financialGateway:releaseWiring/);
});

test("financial gateway readiness CLI parser keeps output flags", () => {
  assert.deepEqual(parseArgs(["--output=release/financial.json", "--markdown=release/financial.md"]), {
    output: "release/financial.json",
    markdown: "release/financial.md"
  });
});
