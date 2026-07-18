const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPhase2FamilyDoctorReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/phase2-family-doctor-readiness");

const ROOT = path.resolve(__dirname, "..");

test("phase 2 family doctor readiness covers templates teams packages contracts and UIs", () => {
  const report = buildPhase2FamilyDoctorReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.templates >= 3, true);
  assert.equal(report.summary.teams >= 3, true);
  assert.equal(report.summary.packages >= 4, true);
  assert.equal(report.summary.applications >= 4, true);
  assert.equal(report.summary.contracts >= 3, true);
  assert.equal(report.summary.fulfillments >= 5, true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("phase 2 family doctor readiness fails when template review steps are missing", () => {
  const report = buildPhase2FamilyDoctorReadiness({
    templates: [
      { id: "p2fdt-basic", requiredFields: ["residentId"], status: "active" }
    ]
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "phase2FamilyDoctor:templates").passed, false);
});

test("phase 2 family doctor readiness fails when fulfillment audit hashes are missing", () => {
  const report = buildPhase2FamilyDoctorReadiness({
    fulfillments: [
      { id: "broken", contractId: "p2fdc-r1", residentId: "r1", serviceType: "followup", status: "completed" }
    ]
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "phase2FamilyDoctor:contract-fulfillment").passed, false);
});

test("phase 2 family doctor readiness keeps release wiring honest", () => {
  const report = buildPhase2FamilyDoctorReadiness({
    pkg: { scripts: {} },
    manifestSource: "",
    deployCheckSource: "",
    releaseReportSource: ""
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "phase2FamilyDoctor:release-wiring").passed, false);
});

test("phase 2 family doctor readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "phase2-family-doctor-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPhase2FamilyDoctorReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Phase 2 family doctor readiness report/);
  assert.match(markdown, /Applications/);
  writeOutput(report, {
    output: path.join("tmp", "phase2-family-doctor-readiness-test", "report.json"),
    markdown: path.join("tmp", "phase2-family-doctor-readiness-test", "report.md")
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "report.md"), "utf8"), /Contracts/);
  const parsed = parseArgs(["--output=release/custom.json", "--markdown=release/custom.md", "--write=false"]);
  assert.equal(parsed.output, "release/custom.json");
  assert.equal(parsed.markdown, "release/custom.md");
  assert.equal(parsed.write, "false");
});
