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
  assert.equal(report.summary.releaseChecks, 42);
  assert.equal(report.artifacts.length >= 17, true);
  assert.equal(report.templateReadmes.length, 4);
  assert.equal(report.artifacts.some((item) => item.id === "release-report" && item.command === "release:report"), true);
  assert.equal(report.artifacts.some((item) => item.id === "release-artifact-manifest" && item.command === "release:manifest"), true);
  assert.equal(report.artifacts.some((item) => item.id === "platform-production-audit" && item.command === "platform:production-audit" && item.markdown === "docs/数智医院标准平台全程审计与生产前开发规划.md" && item.evidence === "release/production-cutover-checklist.md"), true);
  assert.equal(report.artifacts.some((item) => item.id === "platform-development-report-20260711" && item.command === "release:report" && item.markdown === "docs/数智医院标准平台开发报告与下一步计划-2026-07-11.md"), true);
  assert.equal(report.artifacts.some((item) => item.id === "object-storage-readiness" && item.command === "object-storage:readiness" && item.markdown === "release/object-storage-readiness-report.md" && item.evidence === "/api/attachments/storage"), true);
  assert.equal(report.artifacts.some((item) => item.id === "financial-gateway-readiness" && item.command === "financial-gateway:readiness" && item.markdown === "release/financial-gateway-readiness-report.md" && item.evidence === "/api/financial-gateways"), true);
  assert.equal(report.artifacts.some((item) => item.id === "platform-rd-report" && item.command === "release:report" && item.markdown === "docs/卫生健康信息平台研发报告.md"), true);
  assert.equal(report.artifacts.some((item) => item.id === "launch-smoke" && item.command === "launch:smoke" && item.markdown === "release/launch-smoke-report.md" && item.evidence === "/api/health"), true);
  assert.equal(report.artifacts.some((item) => item.id === "onsite-launch-requirements" && item.command === "onsite:launch-requirements" && item.markdown === "release/onsite-launch-requirements.md" && item.evidence === "docs/on-site-launch-materials.md"), true);
  assert.equal(report.artifacts.some((item) => item.id === "site-readiness" && item.evidence === "/api/site-readiness-pack"), true);
  assert.equal(report.artifacts.some((item) => item.id === "site-launch-evidence" && item.command === "site:pack" && item.evidence === "/api/site-launch-evidence"), true);
  assert.equal(report.artifacts.some((item) => item.id === "production-db" && item.command === "production-db:readiness" && item.evidence === "/api/production-database/cutover-center"), true);
  assert.equal(report.artifacts.some((item) => item.id === "service-acceptance" && item.markdown === "release/service-acceptance-summary.md" && item.evidence === "/api/service-acceptance-summary"), true);
  assert.equal(report.artifacts.some((item) => item.id === "health-dashboard" && item.command === "health-dashboard:summary" && item.markdown === "release/health-dashboard-summary.md" && item.evidence === "/api/health-dashboard/summary"), true);
  assert.equal(report.artifacts.some((item) => item.id === "health-dashboard-indicator-center" && item.command === "health-dashboard:summary" && item.markdown === "docs/health-dashboard-indicator-center-report.md" && item.evidence === "/api/health-dashboard/industry-governance-indicators"), true);
  assert.equal(report.artifacts.some((item) => item.id === "priority-application-templates" && item.command === "priority-apps:templates" && item.markdown === "release/priority-application-templates.md" && item.evidence === "/api/priority-applications/templates"), true);
  assert.equal(report.artifacts.some((item) => item.id === "citizen-launch-foundation" && item.command === "citizen:launch-foundation" && item.markdown === "release/citizen-launch-foundation-readiness.md" && item.evidence === "login.html?redirect=citizen.html&client=app&page=nursing#account-provisioning"), true);
  assert.equal(report.artifacts.some((item) => item.id === "maternal-child-readiness" && item.command === "maternal-child:readiness" && item.markdown === "release/maternal-child-readiness-report.md" && item.evidence === "maternal-child-about.html"), true);
  assert.equal(report.artifacts.some((item) => item.id === "public-health-readiness" && item.command === "public-health:readiness" && item.markdown === "release/public-health-readiness-report.md" && item.evidence === "/api/public-health/system"), true);
  assert.equal(report.artifacts.some((item) => item.id === "hybrid-deployment" && item.command === "hybrid:deployment-readiness" && item.markdown === "release/hybrid-deployment-readiness-report.md"), true);
  assert.equal(report.artifacts.some((item) => item.id === "multi-practice" && item.command === "multi-practice:readiness" && item.markdown === "release/multi-practice-readiness-report.md" && item.evidence === "/api/multi-practice-registry"), true);
  assert.equal(report.artifacts.some((item) => item.id === "chronic-followup" && item.command === "chronic:followup-readiness"), true);
  assert.equal(report.artifacts.some((item) => item.id === "chronic-institution-interfaces" && item.command === "chronic:institution-interfaces"), true);
  assert.equal(report.artifacts.some((item) => item.id === "chronic-launch-core" && item.command === "chronic:launch-core" && item.evidence === "/api/chronic/launch-core"), true);
  assert.equal(report.artifacts.some((item) => item.id === "data-governance" && item.command === "data-governance:readiness" && item.markdown === "release/data-governance-readiness-report.md" && item.evidence === "/api/data-governance"), true);
  assert.equal(report.artifacts.some((item) => item.id === "digital-hospital-standards" && item.command === "digital-hospital:standards-readiness" && item.markdown === "release/digital-hospital-standards-readiness-report.md" && item.evidence === "digital-hospital-standards.html"), true);
  assert.equal(report.artifacts.some((item) => item.id === "phase2-proposal" && item.command === "phase2:proposal-readiness" && item.markdown === "release/phase2-proposal-readiness-report.md"), true);
  assert.equal(report.artifacts.some((item) => item.id === "phase2-catalog" && item.command === "phase2:catalog-readiness" && item.markdown === "release/phase2-catalog-readiness-report.md" && item.evidence === "/api/phase2/catalog"), true);
  assert.equal(report.artifacts.some((item) => item.id === "phase2-joint-test" && item.command === "phase2:joint-test-readiness" && item.markdown === "release/phase2-joint-test-readiness-report.md" && item.evidence === "/api/phase2/joint-test-pilot"), true);
  assert.equal(report.artifacts.some((item) => item.id === "phase2-mutual-recognition" && item.command === "phase2:mutual-recognition-readiness" && item.markdown === "release/phase2-mutual-recognition-readiness-report.md" && item.evidence === "/api/phase2/mutual-recognition"), true);
  assert.equal(report.artifacts.some((item) => item.id === "phase2-disease-reporting" && item.command === "phase2:disease-reporting-readiness" && item.markdown === "release/phase2-disease-reporting-readiness-report.md" && item.evidence === "/api/phase2/disease-reporting"), true);
  assert.equal(report.artifacts.some((item) => item.id === "phase2-clinical-assist" && item.command === "phase2:clinical-assist-readiness" && item.markdown === "release/phase2-clinical-assist-readiness-report.md" && item.evidence === "/api/phase2/clinical-assist"), true);
  assert.equal(report.artifacts.some((item) => item.id === "phase2-family-doctor" && item.command === "phase2:family-doctor-readiness" && item.markdown === "release/phase2-family-doctor-readiness-report.md" && item.evidence === "/api/phase2/family-doctor-contracts"), true);
  assert.equal(report.artifacts.some((item) => item.id === "registration-journey" && item.command === "registration:journey-readiness" && item.markdown === "release/registration-journey-readiness-report.md" && item.evidence === "/api/registrations/dashboard"), true);
  assert.equal(report.artifacts.some((item) => item.id === "registration-integration" && item.command === "registration:integration-readiness" && item.markdown === "release/registration-integration-readiness-report.md" && item.evidence === "/api/registrations/integration-center"), true);
  assert.equal(report.artifacts.some((item) => item.id === "citizen-operations" && item.command === "phase2:citizen-operations-readiness" && item.markdown === "release/citizen-operations-readiness-report.md" && item.evidence === "/api/citizen-operations/center"), true);
  assert.equal(report.artifacts.some((item) => item.id === "commercial-crypto" && item.command === "security:commercial-crypto-readiness" && item.markdown === "release/commercial-crypto-readiness-report.md" && item.evidence === "/api/commercial-crypto/center"), true);
  assert.equal(report.artifacts.some((item) => item.id === "operations-readiness" && item.command === "operations:readiness" && item.markdown === "release/operations-readiness-report.md" && item.evidence === "/api/production-operations/center"), true);
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
  assert.match(markdown, /launch-smoke-report\.md/);
  assert.match(markdown, /onsite-launch-requirements\.md/);
  assert.match(markdown, /health-dashboard-summary\.md/);
  assert.match(markdown, /health-dashboard-indicator-center-report\.md/);
  assert.match(markdown, /priority-application-templates\.md/);
  assert.match(markdown, /citizen-launch-foundation-readiness\.md/);
  assert.match(markdown, /login\.html\?redirect=citizen\.html&client=app&page=nursing#account-provisioning/);
  assert.match(markdown, /maternal-child-readiness-report\.md/);
  assert.match(markdown, /public-health-readiness-report\.md/);
  assert.match(markdown, /Maternal-child main function and readiness report/);
  assert.match(markdown, /Public health informatization standard readiness report/);
  assert.match(markdown, /Hybrid static preview and dynamic backend readiness/);
  assert.match(markdown, /Doctor multi-practice readiness report/);
  assert.match(markdown, /Template READMEs/);
  assert.match(markdown, /release-artifact-manifest\.md/);
  assert.match(markdown, /数智医院标准平台全程审计与生产前开发规划\.md/);
  assert.match(markdown, /卫生健康信息平台研发报告\.md/);
  assert.match(markdown, /data-governance-readiness-report\.md/);
  assert.match(markdown, /digital-hospital-standards-readiness-report\.md/);
  assert.match(markdown, /phase2-proposal-readiness-report\.md/);
  assert.match(markdown, /phase2-catalog-readiness-report\.md/);
  assert.match(markdown, /phase2-joint-test-readiness-report\.md/);
  assert.match(markdown, /phase2-mutual-recognition-readiness-report\.md/);
  assert.match(markdown, /phase2-disease-reporting-readiness-report\.md/);
  assert.match(markdown, /phase2-clinical-assist-readiness-report\.md/);
  assert.match(markdown, /phase2-family-doctor-readiness-report\.md/);
  assert.match(markdown, /registration-journey-readiness-report\.md/);
  assert.match(markdown, /registration-integration-readiness-report\.md/);
  assert.match(markdown, /citizen-operations-readiness-report\.md/);
  assert.match(markdown, /commercial-crypto-readiness-report\.md/);
  assert.match(markdown, /\/api\/production-database\/cutover-center/);

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
