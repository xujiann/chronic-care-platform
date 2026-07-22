const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ACCEPTED_BASELINE,
  PUBLIC_FILES,
  LINE_CONFIG,
  validateConfiguration,
  readIntakeDecisions,
  validateIntakeDecisions,
  applyIntakeDecision,
  buildIntegrationControlLedger,
  renderMarkdown,
  parseArgs,
  writeOutput
} = require("../scripts/integration-control-ledger");

const ROOT = path.resolve(__dirname, "..");

test("integration control configuration defines eleven acyclic professional lines", () => {
  const checks = validateConfiguration();
  assert.equal(checks.every((item) => item.passed), true);
  assert.equal(LINE_CONFIG.length, 11);
  assert.deepEqual(LINE_CONFIG.filter((item) => item.wave === 1).map((item) => item.id), ["T01", "T02", "T03", "T11", "T04", "T06"]);
  assert.deepEqual(LINE_CONFIG.slice().sort((a, b) => a.mergeOrder - b.mergeOrder).map((item) => item.id), ["T01", "T02", "T03", "T11", "T04", "T06", "T05", "T07", "T08", "T09", "T10"]);
  assert.deepEqual(PUBLIC_FILES, ["server.js", "portal.css", "package.json", "README.md", "scripts/release-report.js"]);
});

test("intake decisions are valid, commit-bound and fail closed", () => {
  const payload = readIntakeDecisions();
  const validation = validateIntakeDecisions(payload);
  assert.equal(validation.valid, true);
  assert.equal(payload.decisions.some((item) => item.lineId === "T01"), true);

  const candidate = {
    id: "T01",
    state: "intake-ready",
    head: "candidate-head",
    integrated: false,
    finalizer: false,
    blockersDetected: []
  };
  const accepted = applyIntakeDecision(candidate, {
    lineId: "T01",
    candidateHead: "candidate-head",
    decision: "accepted",
    checks: ["targeted regression passed"]
  });
  assert.equal(accepted.state, "merge-ready");
  assert.equal(accepted.intakeReview.decisionMatchesHead, true);

  const dependencyWait = applyIntakeDecision(candidate, {
    lineId: "T01",
    candidateHead: "candidate-head",
    decision: "accepted"
  }, ["T02"]);
  assert.equal(dependencyWait.state, "accepted-dependency-wait");

  const blocked = applyIntakeDecision(candidate, {
    lineId: "T01",
    candidateHead: "candidate-head",
    decision: "blocked",
    blockers: ["security review failed"]
  });
  assert.equal(blocked.state, "blocked-intake-review");
  assert.deepEqual(blocked.blockersDetected, ["security review failed"]);

  const stale = applyIntakeDecision(candidate, {
    lineId: "T01",
    candidateHead: "old-head",
    decision: "accepted"
  });
  assert.equal(stale.state, "review-stale");
  assert.equal(stale.intakeReview.decisionMatchesHead, false);
});

test("integration control ledger inspects registered worktrees without changing them", () => {
  const report = buildIntegrationControlLedger({ generatedAt: "2026-07-22T00:00:00.000Z" });
  const markdown = renderMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.acceptedBaseline, ACCEPTED_BASELINE);
  assert.equal(report.lines.length, 11);
  assert.equal(report.summary.worktreesPresent, 11);
  assert.equal(typeof report.summary.mergeReady, "number");
  assert.equal(typeof report.summary.reviewPending, "number");
  assert.equal(typeof report.summary.reviewBlocked, "number");
  assert.equal(typeof report.summary.integrated, "number");
  assert.equal(report.lines.every((line) => typeof line.intakeReview.effectiveState === "string"), true);
  assert.equal(report.lines.every((line) => typeof line.dependenciesSatisfied === "boolean"), true);
  assert.equal(typeof report.goNoGo.available, "boolean");
  assert.equal(typeof report.goNoGo.runtimeState, "string");
  assert.match(markdown, /T00 integration control ledger/);
  assert.match(markdown, /Professional line intake/);
  assert.match(markdown, /Intake review/);
  assert.match(markdown, /Interface contract change flow/);
  assert.match(markdown, /Current production Go\/No-Go snapshot/);
  assert.match(markdown, /server\.js/);
});

test("integration control report writes deterministic artifact shape", (t) => {
  const outputDir = path.join(ROOT, "tmp", "integration-control-ledger-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildIntegrationControlLedger({ generatedAt: "2026-07-22T00:00:00.000Z" });

  writeOutput(report, {
    output: path.join("tmp", "integration-control-ledger-test", "ledger.json"),
    markdown: path.join("tmp", "integration-control-ledger-test", "ledger.md")
  });

  const json = JSON.parse(fs.readFileSync(path.join(outputDir, "ledger.json"), "utf8"));
  const markdown = fs.readFileSync(path.join(outputDir, "ledger.md"), "utf8");
  assert.equal(json.lines.length, 11);
  assert.equal(json.policy.firstWave.length, 6);
  assert.equal(json.policy.publicFiles.length, 5);
  assert.match(markdown, /Release candidate gate:/);
});

test("integration control CLI parser supports strict gate and custom outputs", () => {
  const flags = parseArgs(["--gate", "--output=tmp/ledger.json", "--markdown=tmp/ledger.md", "--write=false"]);
  assert.equal(flags.gate, true);
  assert.equal(flags.output, "tmp/ledger.json");
  assert.equal(flags.markdown, "tmp/ledger.md");
  assert.equal(flags.write, "false");
});
