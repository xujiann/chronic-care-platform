const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPublicHealthEventReportingReadiness,
  parseArgs,
  renderMarkdown
} = require("../scripts/public-health-event-reporting-readiness");

test("infectious event reporting readiness proves the first auditable business closure", () => {
  const report = buildPublicHealthEventReportingReadiness();

  assert.equal(report.ok, true);
  assert.equal(report.functionalState, "business-closure-runnable");
  assert.equal(report.formalGoLiveState, "blocked-until-t00-integration-and-site-receipt-signed");
  assert.equal(report.summary.checks, 15);
  assert.equal(report.summary.passed, report.summary.checks);
  assert.equal(report.summary.stages, 7);
  assert.equal(report.summary.rejectedExceptionAssigned, true);
  assert.equal(report.acceptedScenario.state, "followup-closed");
  assert.equal(report.acceptedScenario.businessClosureComplete, true);
  assert.equal(report.acceptedScenario.productionReady, false);
  assert.equal(report.acceptedScenario.standardMapping.status, "reviewed");
  assert.equal(report.rejectedScenario.exception.status, "open");
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("infectious event reporting readiness fails when the stable source event link is broken", () => {
  const report = buildPublicHealthEventReportingReadiness({ event: { id: "wrong-event" } });

  assert.equal(report.ok, false);
  assert.equal(report.functionalState, "incomplete");
  assert.equal(report.checks.find((item) => item.id === "source:stable-link").passed, false);
  assert.match(report.checks.find((item) => item.id === "source:stable-link").detail, /phe-infectious-001/);
});

test("infectious event reporting readiness renders the production boundary and parses output flags", () => {
  const report = buildPublicHealthEventReportingReadiness();
  const markdown = renderMarkdown(report);
  const flags = parseArgs([
    "--output=tmp/public-health-event-reporting/report.json",
    "--markdown=tmp/public-health-event-reporting/report.md"
  ]);

  assert.equal(flags.output, "tmp/public-health-event-reporting/report.json");
  assert.equal(flags.markdown, "tmp/public-health-event-reporting/report.md");
  assert.match(markdown, /Public health infectious event reporting readiness/);
  assert.match(markdown, /blocked-until-t00-integration-and-site-receipt-signed/);
  assert.match(markdown, /T00 integration boundary/);
  assert.match(markdown, /EMR-LIS-CLUSTER-20260708-001/);
});
