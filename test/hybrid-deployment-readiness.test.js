const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildHybridDeploymentReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/hybrid-deployment-readiness");

const ROOT = path.resolve(__dirname, "..");

test("hybrid deployment readiness validates static and dynamic deployment boundaries", () => {
  const report = buildHybridDeploymentReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.topology.staticPreview.snapshotFallback, true);
  assert.equal(report.topology.dynamicBackend.routeCoverage.every((item) => item.present), true);
  assert.equal(report.topology.storageBoundary.postgresBlocked, true);
  assert.equal(report.checks.some((item) => item.id === "hybrid:dynamicBackendRoutes" && item.passed), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Hybrid deployment readiness report/);
  assert.match(markdown, /GitHub Pages/);
  assert.match(markdown, /\/api\/health/);
});

test("hybrid deployment readiness fails when a required backend route is absent", () => {
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replaceAll("/api/health", "/api/health-missing");
  const report = buildHybridDeploymentReadinessReport({ serverSource });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "hybrid:dynamicBackendRoutes" && !item.passed), true);
});

test("hybrid deployment readiness writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "hybrid-deployment-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildHybridDeploymentReadinessReport();
  writeOutput(report, {
    output: path.join("tmp", "hybrid-deployment-readiness-test", "hybrid-deployment-readiness-report.json"),
    markdown: path.join("tmp", "hybrid-deployment-readiness-test", "hybrid-deployment-readiness-report.md")
  });
  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hybrid-deployment-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "hybrid-deployment-readiness-report.md"), "utf8");
  assert.equal(writtenJson.hybridDeploymentReadiness.ok, true);
  assert.match(writtenMarkdown, /Dynamic route coverage/);
});

test("hybrid deployment readiness CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/hybrid-deployment-readiness-report.json", "--markdown=release/hybrid-deployment-readiness-report.md"]);
  assert.equal(parsed.output, "release/hybrid-deployment-readiness-report.json");
  assert.equal(parsed.markdown, "release/hybrid-deployment-readiness-report.md");
});
