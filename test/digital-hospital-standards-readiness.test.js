const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REQUIRED_API_MARKERS,
  REQUIRED_LAUNCH_MARKERS,
  REQUIRED_SOURCE_MARKERS,
  REQUIRED_STANDARD_MARKERS,
  buildDigitalHospitalStandardsReadiness,
  renderMarkdown
} = require("../scripts/digital-hospital-standards-readiness");

test("digital hospital standards readiness verifies runnable page docs and release wiring", () => {
  const report = buildDigitalHospitalStandardsReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.standardDomains, REQUIRED_STANDARD_MARKERS.length);
  assert.equal(report.summary.officialSources, REQUIRED_SOURCE_MARKERS.length);
  assert.equal(report.summary.apiMarkers, REQUIRED_API_MARKERS.length);
  assert.equal(report.summary.launchMarkers, REQUIRED_LAUNCH_MARKERS.length);
  assert.equal(report.summary.evidenceModes >= 5, true);
  assert.equal(report.summary.pilotRows >= 5, true);
  assert.equal(report.summary.policyRecords >= 18, true);
  assert.equal(report.summary.policyControls >= 12, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.match(renderMarkdown(report), /Digital hospital standards readiness report/);
  assert.match(renderMarkdown(report), new RegExp(`API markers: ${REQUIRED_API_MARKERS.length}`));
  assert.match(renderMarkdown(report), new RegExp(`Launch markers: ${REQUIRED_LAUNCH_MARKERS.length}`));
});
