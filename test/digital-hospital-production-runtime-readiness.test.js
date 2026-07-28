const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildDigitalHospitalProductionRuntimeReadiness,
  renderMarkdown,
  writeOutput
} = require("../scripts/digital-hospital-production-runtime-readiness");

test("production runtime report marks software complete without overstating external activation", () => {
  const report = buildDigitalHospitalProductionRuntimeReadiness({
    env: { NODE_ENV: "production" },
    loaderConfigured: false
  });
  assert.equal(report.ok, true);
  assert.equal(report.softwareComplete, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.status, "software-complete-external-activation-required");
  assert.equal(report.summary.checks, 8);
  assert.equal(report.summary.passed, 8);
  assert.equal(report.summary.evidenceRequirements, 10);
  assert.equal(report.summary.approvalRoles, 4);
  assert.equal(report.externalBlockers.length, 5);
  assert.match(report.boundary, /Software capability is complete/);
  assert.match(renderMarkdown(report), /Production ready: no/);
});

test("production runtime report writes machine-readable and review artifacts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digital-hospital-readiness-"));
  const report = buildDigitalHospitalProductionRuntimeReadiness({
    env: {},
    loaderConfigured: false
  });
  const output = writeOutput(report, {
    jsonFile: path.join(directory, "report.json"),
    markdownFile: path.join(directory, "report.md")
  });
  const parsed = JSON.parse(fs.readFileSync(output.jsonFile, "utf8"));
  const markdown = fs.readFileSync(output.markdownFile, "utf8");
  assert.equal(parsed.version, "v0.18");
  assert.equal(parsed.softwareComplete, true);
  assert.match(markdown, /External activation blockers/);
  fs.rmSync(directory, { recursive: true, force: true });
});
