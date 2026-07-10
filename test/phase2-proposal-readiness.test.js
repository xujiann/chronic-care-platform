const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildPhase2ProposalReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/phase2-proposal-readiness");

const ROOT = path.resolve(__dirname, "..");

test("phase 2 proposal readiness covers gaps work packages and blockers", () => {
  const report = buildPhase2ProposalReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.gapRows >= 12, true);
  assert.equal(report.summary.domains >= 10, true);
  assert.equal(report.summary.p0WorkPackages >= 4, true);
  assert.equal(report.summary.p1WorkPackages >= 3, true);
  assert.equal(report.summary.p2WorkPackages >= 1, true);
  assert.equal(report.summary.onsiteBlockers >= 8, true);
  assert.equal(report.gapLedger.some((item) => item.id === "data-service-catalog" && item.status === "mvp-ready-onsite-blocked"), true);
  assert.equal(report.gapLedger.some((item) => item.id === "production-database" && item.stage === "cutover-rehearsal"), true);
  assert.equal(report.workPackages.some((item) => item.id === "p0-production-db-gateway" && item.status === "rehearsal-center-ready-onsite-blocked"), true);
  assert.equal(report.gapLedger.some((item) => item.id === "lab-mutual-recognition-ledger" && item.status === "mvp-ready-onsite-blocked"), true);
  assert.equal(report.gapLedger.some((item) => item.id === "consumer-operations-backend" && item.status === "mvp-ready-onsite-blocked" && item.stage === "ops-console-mvp"), true);
  assert.equal(report.gapLedger.some((item) => item.id === "citizen-unified-entry" && item.status === "journey-mvp-onsite-blocked" && item.stage === "appointment-journey-mvp"), true);
  assert.equal(report.gapLedger.some((item) => item.id === "ops-backup-dr" && item.status === "run-center-ready-onsite-blocked" && item.stage === "run-center-mvp"), true);
  assert.equal(report.workPackages.some((item) => item.id === "p1-citizen-and-family-doctor" && item.status === "mvp-ready-onsite-blocked"), true);
  assert.equal(report.gapLedger.every((item) => item.owner && item.nextStep && item.status), true);
  assert.equal(report.workPackages.some((item) => item.id === "p0-data-service-catalog"), true);
  assert.equal(report.onsiteBlockers.some((item) => item.id === "commercial-crypto-devices"), true);
});

test("phase 2 proposal readiness fails when the plan document loses scope markers", () => {
  const report = buildPhase2ProposalReadiness({ planDoc: "P0 only" });
  assert.equal(report.ok, false);
  assert.equal(report.summary.missingPlanTokens > 0, true);
  assert.equal(report.checks.some((item) => item.id === "phase2:plan-document" && !item.passed), true);
});

test("phase 2 proposal readiness keeps release wiring honest", () => {
  const report = buildPhase2ProposalReadiness({
    pkg: { scripts: {} },
    manifestSource: "",
    deployCheckSource: "",
    releaseReportSource: ""
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2:release-wiring" && !item.passed), true);
});

test("phase 2 proposal readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "phase2-proposal-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPhase2ProposalReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Phase 2 proposal readiness report/);
  assert.match(markdown, /commercial-crypto-devices/);
  assert.match(markdown, /p0-data-service-catalog/);

  writeOutput(report, {
    output: path.join("tmp", "phase2-proposal-readiness-test", "phase2-proposal-readiness-report.json"),
    markdown: path.join("tmp", "phase2-proposal-readiness-test", "phase2-proposal-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-proposal-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "phase2-proposal-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Onsite and external blockers/);

  const parsed = parseArgs(["--output=release/phase2-proposal-readiness-report.json", "--markdown=release/phase2-proposal-readiness-report.md"]);
  assert.equal(parsed.output, "release/phase2-proposal-readiness-report.json");
  assert.equal(parsed.markdown, "release/phase2-proposal-readiness-report.md");
});
