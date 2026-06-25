const assert = require("node:assert/strict");
const test = require("node:test");

const { buildDeployCheckReport } = require("../scripts/deploy-check");

test("deploy check report covers release-critical snapshot gates", () => {
  const report = buildDeployCheckReport();
  const checkNames = new Set(report.checks.map((item) => item.name));

  assert.equal(report.ok, true);
  [
    "file:README.md",
    "file:DEPLOYMENT.md",
    "file:drug-consumable-about.html",
    "package:scripts",
    "snapshot:collections",
    "snapshot:interfaceReadiness",
    "snapshot:securityAcceptance",
    "snapshot:externalDependencyRisks",
    "snapshot:drugTraceabilityPolicySources",
    "snapshot:p2-complete",
    "snapshot:accessibility",
    "snapshot:storageMeta"
  ].forEach((name) => assert.equal(checkNames.has(name), true, `${name} should be checked`));
});

test("deploy check report does not run expensive commands by default", () => {
  const report = buildDeployCheckReport();

  assert.equal(report.checks.some((item) => item.name.startsWith("command:")), false);
});
