const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDigitalHospitalPilotReadiness, renderMarkdown } = require("../scripts/digital-hospital-pilot-readiness");

test("digital hospital pilot readiness validates P0-P1 evaluation delivery", () => {
  const report = buildDigitalHospitalPilotReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.functionalState, "pilot-launch-ready");
  assert.equal(report.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(report.summary.projects, 70);
  assert.equal(report.summary.pilotInstitutions, 2);
  assert.equal(report.summary.activePilotInstitutions, 1);
  assert.equal(report.summary.pilotIssues, 2);
  assert.equal(report.summary.openPilotIssues, 2);
  assert.equal(report.checks.some((item) => item.id === "pilotReadiness:operations" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "pilotReadiness:issueClosure" && item.passed), true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.match(renderMarkdown(report), /Digital hospital pilot readiness report/);
});
