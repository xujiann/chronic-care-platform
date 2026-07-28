"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildPublicHealthModernizationReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/public-health-modernization-readiness");

test("modernization readiness accepts data surveillance and medical-prevention functional closure", () => {
  const report = buildPublicHealthModernizationReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.functionalState, "public-health-data-surveillance-medical-prevention-foundation-complete");
  assert.equal(report.summary.checks, 20);
  assert.equal(report.summary.passed, 20);
  assert.equal(report.summary.sources, 8);
  assert.equal(report.summary.catalogEntries, 7);
  assert.equal(report.summary.rules, 8);
  assert.equal(report.summary.ruleVersions, 9);
  assert.equal(report.summary.trustedRuleActivations, 1);
  assert.equal(report.summary.freshSources, 1);
  assert.equal(report.summary.noDataSources, 7);
  assert.equal(report.summary.signals, 1);
  assert.equal(report.summary.alerts, 1);
  assert.equal(report.summary.closedAlerts, 1);
  assert.equal(report.summary.collaborationTasks, 2);
  assert.equal(report.summary.closedCollaborationTasks, 2);
  assert.equal(report.acceptance.alertState, "closed");
  assert.equal(report.productionReady, false);
  assert.equal(report.remainingT00Integration.length, 4);
});

test("modernization readiness fails when the privacy control contract is absent", () => {
  const report = buildPublicHealthModernizationReadiness({ dataSource: "" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "data:quality-controls").passed, false);
  assert.equal(report.productionReady, false);
});

test("modernization readiness renders and writes machine and human reports", () => {
  const report = buildPublicHealthModernizationReadiness();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-modernization-"));
  const output = path.join(directory, "report.json");
  const markdown = path.join(directory, "report.md");
  assert.deepEqual(parseArgs([`--output=${output}`, `--markdown=${markdown}`]), { output, markdown });
  writeOutput(report, { output, markdown });
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).summary.closedAlerts, 1);
  assert.match(fs.readFileSync(markdown, "utf8"), /Data sources: 8\/8/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Trusted rule activations: 1/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Fresh\/no-data sources: 1\/7/);
  assert.match(fs.readFileSync(markdown, "utf8"), /Closed medical-prevention tasks: 2\/2/);
  assert.match(renderMarkdown(report), /Remaining T00 integration/);
});
