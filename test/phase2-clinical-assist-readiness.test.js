const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPhase2ClinicalAssistReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/phase2-clinical-assist-readiness");

const ROOT = path.resolve(__dirname, "..");

test("phase 2 clinical assist readiness covers rules alerts receipts plugins and UIs", () => {
  const report = buildPhase2ClinicalAssistReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.rules >= 4, true);
  assert.equal(report.summary.alerts >= 4, true);
  assert.equal(report.summary.receipts >= 3, true);
  assert.equal(report.summary.pluginContracts >= 3, true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("phase 2 clinical assist readiness fails when duplicate reminder categories are missing", () => {
  const report = buildPhase2ClinicalAssistReadiness({
    rules: [
      { id: "p2ca-rule-duplicate-lab", category: "duplicate-lab", requiredFields: ["residentId"], configStatus: "active", defaultAction: "cite" }
    ]
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "phase2ClinicalAssist:rule-config").passed, false);
});

test("phase 2 clinical assist readiness fails when message receipts lose audit hashes", () => {
  const report = buildPhase2ClinicalAssistReadiness({
    receipts: [
      { id: "broken", alertId: "p2caa-med-r1", doctorId: "doc-liu", receiptStatus: "received", messageChannel: "doctor-workstation" }
    ]
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "phase2ClinicalAssist:message-receipts").passed, false);
});

test("phase 2 clinical assist readiness keeps release wiring honest", () => {
  const report = buildPhase2ClinicalAssistReadiness({
    pkg: { scripts: {} },
    manifestSource: "",
    deployCheckSource: "",
    releaseReportSource: ""
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "phase2ClinicalAssist:release-wiring").passed, false);
});

test("phase 2 clinical assist readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "phase2-clinical-assist-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPhase2ClinicalAssistReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Phase 2 clinical assist readiness report/);
  assert.match(markdown, /Plugin contracts/);
  writeOutput(report, {
    output: path.join("tmp", "phase2-clinical-assist-readiness-test", "report.json"),
    markdown: path.join("tmp", "phase2-clinical-assist-readiness-test", "report.md")
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "report.md"), "utf8"), /Alert queue/);
  const parsed = parseArgs(["--output=release/custom.json", "--markdown=release/custom.md", "--write=false"]);
  assert.equal(parsed.output, "release/custom.json");
  assert.equal(parsed.markdown, "release/custom.md");
  assert.equal(parsed.write, "false");
});
