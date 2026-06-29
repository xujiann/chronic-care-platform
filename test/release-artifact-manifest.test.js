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
  assert.equal(report.artifacts.some((item) => item.id === "quality-safety-interface-standard" && item.command === "quality-safety:interface-standard" && item.evidence === "/api/quality-safety/interface-standard"), true);
  assert.equal(report.artifacts.some((item) => item.id === "site-readiness" && item.evidence === "/api/site-readiness-pack"), true);
  assert.equal(report.artifacts.some((item) => item.id === "service-acceptance" && item.markdown === "release/service-acceptance-summary.md" && item.evidence === "/api/service-acceptance-summary"), true);
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
