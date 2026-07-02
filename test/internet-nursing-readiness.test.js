const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildInternetNursingReadinessReport,
  buildProductionEnvironmentStatus,
  renderMarkdown,
  writeReport
} = require("../scripts/internet-nursing-readiness");

test("internet nursing readiness validates three-role workflow and policy evidence", () => {
  const report = buildInternetNursingReadinessReport({ env: {} });
  assert.equal(report.ok, true);
  assert.equal(report.boundaries.includes("online application"), true);
  assert.equal(report.boundaries.includes("nurse qualification"), true);
  assert.equal(report.summary.institutions >= 2, true);
  assert.equal(report.summary.qualifiedNurses >= 2, true);
  assert.equal(report.summary.orders >= 3, true);
  assert.equal(report.checks.some((item) => item.id === "nursing:api" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:frontend" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:visibleText" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:mobileWorkflow" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:launchControls" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:operationSafety" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:authNavigation" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:moduleDoc" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:phaseOneEvidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:notificationGateway" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:phaseTwoOperations" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:phaseThreeRegulation" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:productionIntegration" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:paymentIntegration" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:deviceVerification" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:regulatorySubmission" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:siteCutoverPack" && item.passed), true);
  assert.equal(report.summary.cutoverTracks, 5);
  assert.equal(report.summary.cutoverReadyTracks, 5);
  assert.equal(report.summary.productionBlockers >= 1, true);
  assert.equal(report.cutoverPack.status, "ready-for-site-signoff");
  assert.equal(report.cutoverPack.productionReadiness, "production-blocked");
  assert.equal(report.cutoverPack.tracks.every((item) => item.id.startsWith("nursing-cutover-") && item.ready), true);
  assert.equal(report.cutoverPack.productionBlockers.some((item) => item.source === "audit-retention" && /AUDIT_EXPORT_PATH/.test(item.requiredAction)), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:developedFeatures" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:nextPlan" && item.passed), true);
  assert.match(renderMarkdown(report), /Internet nursing readiness report/);
  assert.match(renderMarkdown(report), /Site Cutover Pack/);
  assert.match(renderMarkdown(report), /Production Blockers/);
  assert.match(renderMarkdown(report), /audit-retention/);
  assert.match(renderMarkdown(report), /nursing-cutover-payment-reconciliation/);
  assert.match(renderMarkdown(report), /docs\/互联网护理服务模块说明\.md/);
});

test("internet nursing production environment status detects signed production profile", () => {
  const strongSecret = "abcdefghijklmnopqrstuvwxyz1234567890";
  const report = buildProductionEnvironmentStatus({
    NODE_ENV: "production",
    STORAGE_ENGINE: "postgres",
    SESSION_SECRETS: strongSecret,
    INTEGRATION_GATEWAY_SECRET: strongSecret,
    DATABASE_URL: "postgres://health:secret@db.internal:5432/health",
    OIDC_ISSUER_URL: "https://id.example.gov",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    AUDIT_EXPORT_PATH: "s3://audit/internet-nursing",
    CUTOVER_SITE_INTERFACE_SIGNOFF: "signed",
    CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF: "approved",
    CUTOVER_MONITORING_SIGNOFF: "ready",
    CUTOVER_DR_REHEARSAL_SIGNOFF: "yes"
  });

  assert.equal(report.passed, true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("internet nursing readiness writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "internet-nursing-readiness-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildInternetNursingReadinessReport({ env: {} });
  const output = path.join(outputDir, "internet-nursing-readiness-report.json");
  const markdown = path.join(outputDir, "internet-nursing-readiness-report.md");
  writeReport(report, output, markdown);
  const json = JSON.parse(fs.readFileSync(output, "utf8"));
  const md = fs.readFileSync(markdown, "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.internetNursingReadiness.ok, true);
  assert.equal(json.internetNursingReadiness.cutoverPack.productionReadiness, "production-blocked");
  assert.equal(json.internetNursingReadiness.cutoverPack.tracks.length, 5);
  assert.match(md, /Qualified nurses/);
  assert.match(md, /Site Cutover Pack/);
  assert.match(md, /Production Blockers/);
});
