const test = require("node:test");
const assert = require("node:assert/strict");
const {
  artifactAvailability,
  buildPublicHealthPriorityStandardReviewReadiness,
  parseArgs,
  renderMarkdown
} = require("../scripts/public-health-priority-standard-review-readiness");

test("priority standard review readiness covers eight tracks, seven domains and the site evidence boundary", () => {
  const report = buildPublicHealthPriorityStandardReviewReadiness();

  assert.equal(report.ok, true);
  assert.equal(report.functionalState, "priority-standard-review-pack-runnable");
  assert.equal(report.formalGoLiveState, "blocked-until-owner-review-persisted-and-site-evidence-verified");
  assert.equal(report.summary.checks, 17);
  assert.equal(report.summary.passed, report.summary.checks);
  assert.equal(report.summary.tracks, 8);
  assert.equal(report.summary.standardDomains, 7);
  assert.equal(report.summary.mappingReady, 8);
  assert.equal(report.summary.acceptanceReviewed, 8);
  assert.equal(report.summary.sourceLedgerReviewed, 0);
  assert.equal(report.summary.siteEvidencePending, 8);
  assert.equal(report.acceptanceScenario.productionReady, false);
  assert.equal(report.acceptanceScenario.productionBlockers.length, 8);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("priority standard review readiness fails when a required artifact is unavailable", () => {
  const availability = artifactAvailability();
  availability["immunization-schedule.js"] = false;
  const report = buildPublicHealthPriorityStandardReviewReadiness({ artifactAvailability: availability });

  assert.equal(report.ok, false);
  assert.equal(report.functionalState, "incomplete");
  assert.equal(report.checks.find((item) => item.id === "mapping:artifact-evidence").passed, false);
  assert.equal(report.checks.find((item) => item.id === "mapping:ready").passed, false);
});

test("priority standard review readiness renders scope and parses report destinations", () => {
  const report = buildPublicHealthPriorityStandardReviewReadiness();
  const markdown = renderMarkdown(report);
  const flags = parseArgs([
    "--output=tmp/public-health-priority-standard-review/report.json",
    "--markdown=tmp/public-health-priority-standard-review/report.md"
  ]);

  assert.equal(flags.output, "tmp/public-health-priority-standard-review/report.json");
  assert.equal(flags.markdown, "tmp/public-health-priority-standard-review/report.md");
  assert.match(markdown, /Public health priority standard review readiness/);
  assert.match(markdown, /blocked-until-owner-review-persisted-and-site-evidence-verified/);
  assert.match(markdown, /Business tracks: 8/);
  assert.match(markdown, /Standard domains: 7/);
  assert.match(markdown, /T00 integration boundary/);
});
