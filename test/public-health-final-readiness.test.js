const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildPublicHealthFinalReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/public-health-final-readiness");

test("final readiness accepts every planned T08 functional increment", () => {
  const report = buildPublicHealthFinalReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.functionalState, "t08-public-health-planned-functions-complete");
  assert.equal(report.summary.checks, 40);
  assert.equal(report.summary.passed, 40);
  assert.equal(report.summary.lanes, 8);
  assert.equal(report.summary.handoffs, 8);
  assert.equal(report.summary.adapterProfiles, 8);
  assert.equal(report.summary.verifiedAcceptanceDeliveries, 8);
  assert.equal(report.summary.verifiedEndpointProbes, 8);
  assert.equal(report.summary.persistedOutboxDispatches, 1);
  assert.equal(report.summary.persistedOutboxAuditEntries, 3);
  assert.equal(report.summary.recoveredDeadLetters, 1);
  assert.equal(report.summary.recoverySuccessors, 1);
  assert.equal(report.summary.operationsIssues, 0);
  assert.equal(report.summary.operationsSignatureVerified, 2);
  assert.equal(report.outboxAcceptance.coordinationState, "receipt-confirmed");
  assert.equal(report.deadLetterRecoveryAcceptance.coordinationState, "in-progress");
  assert.equal(report.operationsBoard.operationallyHealthy, true);
  assert.equal(report.endpointProbeRegistry.endpointConnectivityReady, true);
  assert.equal(report.endpointProbeRegistry.productionReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.remainingT00Integration.length, 3);
});

test("final readiness fails closed when the T00 route contract is absent", () => {
  const report = buildPublicHealthFinalReadiness({ pageSource: "" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "frontend:action-route-contract").passed, false);
  assert.equal(report.productionReady, false);
});

test("final readiness renders and writes machine and human reports", () => {
  const report = buildPublicHealthFinalReadiness();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-final-"));
  const output = path.join(directory, "report.json");
  const markdown = path.join(directory, "report.md");
  assert.deepEqual(parseArgs([`--output=${output}`, `--markdown=${markdown}`]), { output, markdown });
  writeOutput(report, { output, markdown });
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).summary.verifiedAcceptanceDeliveries, 8);
  assert.match(fs.readFileSync(markdown, "utf8"), /Signed acceptance deliveries: 8\/8/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Verified endpoint probes: 8\/8/);
  assert.match(renderMarkdown(report), /Remaining T00 and site integration/);
});
