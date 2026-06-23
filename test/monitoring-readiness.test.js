const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildMonitoringReadinessReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/monitoring-readiness");

const ROOT = path.resolve(__dirname, "..");

test("monitoring readiness validates routes metrics alerts and SLO evidence", () => {
  const report = buildMonitoringReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.routes.every((item) => item.present && item.documented), true);
  assert.equal(report.metricSignals.every((item) => item.present), true);
  assert.equal(report.alertSignals.some((item) => item.signal === "CUTOVER_MONITORING_SIGNOFF" && item.present), true);
  assert.equal(report.sloTargets.every((item) => item.covered), true);
});

test("monitoring readiness fails when metrics route documentation is missing", () => {
  const report = buildMonitoringReadinessReport({
    readme: "",
    deployment: "",
    serverSource: fs.readFileSync(path.join(ROOT, "server.js"), "utf8")
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "monitoring:routes" && !item.passed), true);
});

test("monitoring readiness fails when runtime alert signals are missing", () => {
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8")
    .replace(/deadLetters/g, "dead_letter_marker_missing")
    .replace(/slowRequests/g, "slow_request_marker_missing");
  const report = buildMonitoringReadinessReport({ serverSource });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "monitoring:metricSignals" && !item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "monitoring:alertSignals" && !item.passed), true);
});

test("monitoring readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "monitoring-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildMonitoringReadinessReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Monitoring readiness report/);
  assert.match(markdown, /SLO targets/);

  writeOutput(report, {
    output: path.join("tmp", "monitoring-readiness-test", "monitoring-readiness-report.json"),
    markdown: path.join("tmp", "monitoring-readiness-test", "monitoring-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "monitoring-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "monitoring-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Alert signals/);
});

test("monitoring readiness CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/monitoring-readiness-report.json", "--markdown=release/monitoring-readiness-report.md"]);
  assert.equal(parsed.output, "release/monitoring-readiness-report.json");
  assert.equal(parsed.markdown, "release/monitoring-readiness-report.md");
});
