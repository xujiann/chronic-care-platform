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
  assert.equal(report.summary.checks, 73);
  assert.equal(report.summary.passed, 73);
  assert.equal(report.summary.t08FunctionalChecks, 55);
  assert.equal(report.summary.t08FunctionalPassed, 55);
  assert.equal(report.summary.t00BoundaryChecks, 18);
  assert.equal(report.summary.t00BoundaryPassed, 18);
  assert.equal(report.summary.lanes, 8);
  assert.equal(report.summary.handoffs, 8);
  assert.equal(report.summary.adapterProfiles, 8);
  assert.equal(report.summary.verifiedAcceptanceDeliveries, 8);
  assert.equal(report.summary.verifiedEndpointProbes, 8);
  assert.equal(report.summary.verifiedEndpointProbeCampaigns, 3);
  assert.equal(report.summary.verifiedEndpointProbeCampaignLinks, 2);
  assert.equal(report.summary.modernizationSources, 8);
  assert.equal(report.summary.modernizationCatalogEntries, 7);
  assert.equal(report.summary.modernizationRules, 8);
  assert.equal(report.summary.modernizationRuleVersions, 9);
  assert.equal(report.summary.modernizationTrustedRuleActivations, 1);
  assert.equal(report.summary.modernizationFreshSources, 1);
  assert.equal(report.summary.modernizationNoDataSources, 7);
  assert.equal(report.summary.modernizationClosedAlerts, 1);
  assert.equal(report.summary.modernizationClosedCollaborationTasks, 2);
  assert.equal(report.summary.persistedOutboxDispatches, 1);
  assert.equal(report.summary.persistedOutboxAuditEntries, 3);
  assert.equal(report.summary.recoveredDeadLetters, 1);
  assert.equal(report.summary.recoverySuccessors, 1);
  assert.equal(report.summary.operationsIssues, 0);
  assert.equal(report.summary.operationsSignatureVerified, 2);
  assert.equal(report.summary.sequentialContractTransitions, 2);
  assert.equal(report.outboxAcceptance.coordinationState, "receipt-confirmed");
  assert.equal(report.deadLetterRecoveryAcceptance.coordinationState, "in-progress");
  assert.equal(report.operationsBoard.operationallyHealthy, true);
  assert.equal(report.endpointProbeRegistry.endpointConnectivityReady, true);
  assert.equal(report.endpointProbeRegistry.productionReady, false);
  assert.equal(report.endpointProbeCampaignRegistry.continuousConnectivityReady, true);
  assert.equal(report.endpointProbeCampaignRegistry.productionReady, false);
  assert.equal(report.endpointProbeCampaignFailureRegistry.continuousConnectivityReady, false);
  assert.equal(report.endpointProbeCampaignFailureRegistry.summary.consecutiveCampaigns, 0);
  assert.equal(report.endpointProbeCampaignFailureRegistry.continuityBreak.code, "campaign-verification-failed");
  assert.equal(report.endpointProbeCampaignFailureRegistry.productionReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.remainingProductionBoundaries.length, 1);
  assert.equal(report.remainingT00Integration.length, 1);
  assert.deepEqual(report.remainingT00Integration, report.remainingProductionBoundaries);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-public-routes").passed, true);
  assert.equal(report.checks.find((item) => item.id === "resilience:runtime-enforcement").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-dual-cas").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-contract-governance").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-contract-cutover").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-contract-chain-persistence").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-endpoint-verification").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-active-endpoint-probe").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-endpoint-probe-campaign").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-endpoint-connectivity-ui").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-modernization-routes").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-modernization-persistence").passed, true);
  assert.equal(report.checks.find((item) => item.id === "integration:t00-modernization-ui-release").passed, true);
  assert.equal(report.checks.find((item) => item.id === "safety:emergency-revocation-quarantine").passed, true);
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
  assert.match(fs.readFileSync(markdown, "utf8"), /Verified endpoint probe campaigns: 3\/3/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Verified endpoint probe campaign links: 2\/2/);
  assert.match(fs.readFileSync(markdown, "utf8"), /T08 functional checks: 53\/53/);
  assert.match(fs.readFileSync(markdown, "utf8"), /T00 public boundary checks: 18\/18/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Modernization data sources: 8\/8/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Modernization trusted rule activations: 1/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Modernization fresh\/no-data sources: 1\/7/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Modernization closed collaboration tasks: 2\/2/);
  assert.match(renderMarkdown(report), /Remaining production integration/);
});
