const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildImagingCloudReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/imaging-cloud-readiness");

const ROOT = path.resolve(__dirname, "..");
const IMAGE_CLOUD_DOC = "docs/\u533b\u5b66\u5f71\u50cf\u4e91\u529f\u80fd\u8bf4\u660e.md";

test("imaging cloud readiness validates province-spec capabilities", () => {
  const report = buildImagingCloudReadinessReport();
  const markdown = renderMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.codeReady, true);
  assert.equal(report.functionalState, "ready-for-synthetic-acceptance");
  assert.equal(report.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.artifacts.page, "imaging-cloud.html");
  assert.equal(report.artifacts.doc, IMAGE_CLOUD_DOC);
  assert.equal(report.checks.some((item) => item.id === "spec:hospital-ingest" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "spec:emr-compatibility" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "spec:mutual-recognition" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "spec:recognition-appeal" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "spec:security" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "ui:development-plan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "docs:summary-plan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production:formal-boundary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production:synthetic-acceptance" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production:site-evidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production:structured-receipts" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production:standalone-smoke" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production:route-contract" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production:t00-public-wiring" && item.passed), true);
  assert.equal(report.summary.requiredCapabilities.includes("development plan"), true);
  assert.equal(report.summary.requiredCapabilities.includes("mutual-recognition appeal"), true);
  assert.equal(report.summary.requiredCapabilities.includes("formal production gate"), true);
  assert.equal(report.summary.production.syntheticChecks, 10);
  assert.equal(report.summary.production.requirements, 7);
  assert.equal(report.summary.production.siteReceipts, 5);
  assert.equal(report.productionCenter.standaloneSmoke.releaseDecision, "no-go");
  assert.equal(report.t00Integration.status, "integrated-platform-gate-still-blocked");
  assert.match(markdown, /Imaging cloud readiness report/);
  assert.match(markdown, /imaging-cloud\.html/);
  assert.match(markdown, /blocked-until-site-evidence-signed/);
});

test("imaging cloud readiness CLI parser and writer keep artifact paths", (t) => {
  const outputDir = path.join(ROOT, "tmp", "imaging-cloud-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const parsed = parseArgs(["--output=tmp/imaging-cloud-readiness-test/report.json", "--markdown=tmp/imaging-cloud-readiness-test/report.md"]);
  assert.equal(parsed.output, "tmp/imaging-cloud-readiness-test/report.json");
  assert.equal(parsed.markdown, "tmp/imaging-cloud-readiness-test/report.md");

  const report = buildImagingCloudReadinessReport();
  writeOutput(report, parsed);

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /hospital ingest/);
  assert.equal(writtenMarkdown.includes(IMAGE_CLOUD_DOC), true);
});
