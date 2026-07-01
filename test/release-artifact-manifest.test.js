const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildReleaseArtifactManifest, parseArgs, renderMarkdown, writeOutput } = require("../scripts/release-artifact-manifest");

const ROOT = path.resolve(__dirname, "..");

test("release artifact manifest indexes reports templates commands and evidence", () => {
  const report = buildReleaseArtifactManifest({
    releaseReport: {
      summary: { total: 42 },
      checks: [{ name: "sitePack:readiness" }, { name: "process:audit" }]
    }
  });
  assert.equal(report.ok, true);
  assert.equal(report.artifacts.length >= 17, true);
  assert.equal(report.templateReadmes.length, 4);
  assert.equal(report.artifacts.some((item) => item.id === "release-report" && item.command === "release:report"), true);
  assert.equal(report.artifacts.some((item) => item.id === "release-artifact-manifest" && item.command === "release:manifest"), true);
  assert.equal(report.artifacts.some((item) => item.id === "site-readiness" && item.evidence === "/api/site-readiness-pack"), true);
  assert.equal(report.artifacts.some((item) => item.id === "service-acceptance" && item.markdown === "release/service-acceptance-summary.md" && item.evidence === "/api/service-acceptance-summary"), true);
  assert.equal(report.artifacts.some((item) => item.id === "health-dashboard" && item.command === "health-dashboard:summary" && item.markdown === "release/health-dashboard-summary.md" && item.evidence === "/api/health-dashboard/summary"), true);
  assert.equal(report.artifacts.some((item) => item.id === "priority-application-templates" && item.command === "priority-apps:templates" && item.markdown === "release/priority-application-templates.md" && item.evidence === "/api/priority-applications/templates"), true);
  assert.equal(report.artifacts.some((item) => item.id === "maternal-child-readiness" && item.command === "maternal-child:readiness" && item.markdown === "release/maternal-child-readiness-report.md" && item.evidence === "maternal-child-about.html"), true);
  assert.equal(report.artifacts.some((item) => item.id === "hybrid-deployment" && item.command === "hybrid:deployment-readiness" && item.markdown === "release/hybrid-deployment-readiness-report.md"), true);
  assert.equal(report.artifacts.some((item) => item.id === "multi-practice" && item.command === "multi-practice:readiness" && item.markdown === "release/multi-practice-readiness-report.md" && item.evidence === "/api/multi-practice-registry"), true);
  assert.equal(report.artifacts.some((item) => item.id === "chronic-followup" && item.command === "chronic:followup-readiness"), true);
  assert.equal(report.artifacts.some((item) => item.id === "chronic-institution-interfaces" && item.command === "chronic:institution-interfaces"), true);
  assert.equal(report.artifacts.some((item) => item.id === "chronic-launch-core" && item.command === "chronic:launch-core" && item.evidence === "/api/chronic/launch-core"), true);
  assert.equal(report.templateReadmes.some((item) => item.file === "release/templates/interface-joint-test/README.md"), true);
  assert.equal(report.templateReadmes.every((item) => item.evidence === "/api/site-template-readmes"), true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("release artifact manifest renders and writes artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "release-artifact-manifest-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildReleaseArtifactManifest();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Release artifact manifest/);
  assert.match(markdown, /health-dashboard-summary\.md/);
  assert.match(markdown, /priority-application-templates\.md/);
  assert.match(markdown, /maternal-child-readiness-report\.md/);
  assert.match(markdown, /Maternal-child main function and readiness report/);
  assert.match(markdown, /Hybrid static preview and dynamic backend readiness/);
  assert.match(markdown, /Doctor multi-practice readiness report/);
  assert.match(markdown, /Template READMEs/);
  assert.match(markdown, /release-artifact-manifest\.md/);

  writeOutput(report, {
    output: path.join("tmp", "release-artifact-manifest-test", "release-artifact-manifest.json"),
    markdown: path.join("tmp", "release-artifact-manifest-test", "release-artifact-manifest.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "release-artifact-manifest.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "release-artifact-manifest.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /release\/templates\/production-signoff\/README\.md/);
});

test("release artifact manifest CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/release-artifact-manifest.json", "--markdown=release/release-artifact-manifest.md"]);
  assert.equal(parsed.output, "release/release-artifact-manifest.json");
  assert.equal(parsed.markdown, "release/release-artifact-manifest.md");
});
