const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPhase2JointTestReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/phase2-joint-test-readiness");

const ROOT = path.resolve(__dirname, "..");

test("phase 2 joint-test readiness covers pilot institutions payloads traces and issues", () => {
  const report = buildPhase2JointTestReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.institutions >= 3, true);
  assert.equal(report.summary.links >= 6, true);
  assert.equal(report.summary.samplePayloads >= 8, true);
  assert.equal(report.summary.landedTraces >= 6, true);
  assert.equal(report.summary.replayableTraces >= 6, true);
  assert.equal(report.summary.runnableChains >= 5, true);
  assert.equal(report.summary.openIssues >= 3, true);
  assert.equal(report.institutions.some((item) => item.role === "tertiary-hospital"), true);
  assert.equal(report.links.some((item) => item.chain === "lis-report" && item.targetCollection === "diagnosticReports"), true);
});

test("phase 2 joint-test readiness fails when pilot institutions are missing", () => {
  const report = buildPhase2JointTestReadiness({ institutions: [] });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2JointTest:pilot-institutions" && !item.passed), true);
});

test("phase 2 joint-test readiness fails when gateway traces cannot be replayed", () => {
  const report = buildPhase2JointTestReadiness({
    traces: [
      { id: "p2trace-master-index", payloadId: "p2msg-master-index", targetCollection: "residents", status: "landed", signatureVerified: true, idempotencyKey: "idk", landedRecordId: "res-1", replayStatus: "none" }
    ]
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2JointTest:gateway-landing" && !item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "phase2JointTest:replayability" && !item.passed), true);
});

test("phase 2 joint-test readiness keeps release wiring honest", () => {
  const report = buildPhase2JointTestReadiness({
    pkg: { scripts: {} },
    manifestSource: "",
    deployCheckSource: "",
    releaseReportSource: ""
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2JointTest:release-wiring" && !item.passed), true);
});

test("phase 2 joint-test readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "phase2-joint-test-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPhase2JointTestReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Phase 2 joint-test readiness report/);
  assert.match(markdown, /p2pilot-hospital/);
  assert.match(markdown, /p2trace-lis-report/);

  writeOutput(report, {
    output: path.join("tmp", "phase2-joint-test-readiness-test", "phase2-joint-test-readiness-report.json"),
    markdown: path.join("tmp", "phase2-joint-test-readiness-test", "phase2-joint-test-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-joint-test-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "phase2-joint-test-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Gateway traces/);

  const parsed = parseArgs(["--output=release/phase2-joint-test-readiness-report.json", "--markdown=release/phase2-joint-test-readiness-report.md"]);
  assert.equal(parsed.output, "release/phase2-joint-test-readiness-report.json");
  assert.equal(parsed.markdown, "release/phase2-joint-test-readiness-report.md");
});
