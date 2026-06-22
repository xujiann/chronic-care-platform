const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildReleaseReport, parseArgs, renderCutoverMarkdown, renderMarkdown, renderStorageModelMarkdown, validateProductionConfig, writeOutput } = require("../scripts/release-report");

const ROOT = path.resolve(__dirname, "..");

test("release report validates demo and production environment profiles", () => {
  const demo = validateProductionConfig({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret"
    }
  });
  assert.equal(demo.passed, true);
  assert.equal(demo.checks.some((item) => item.name === "env:SESSION_SECRETS.productionQuality" && item.severity === "warn"), true);

  const failedProduction = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "json",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "demo-secret"
    }
  });
  assert.equal(failedProduction.passed, false);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:STORAGE_ENGINE.production" && !item.passed), true);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:SESSION_SECRETS.productionQuality" && !item.passed), true);
  assert.equal(failedProduction.cutoverChecklist.some((item) => item.id === "cutover-secrets" && !item.passed), true);
  assert.equal(failedProduction.cutoverChecklist.some((item) => item.id === "cutover-identity" && !item.passed), true);

  const postgresBeforeAdapter = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "postgres",
      DATABASE_URL: "postgres://health:secret@example.internal:5432/health",
      SESSION_SECRETS: "0123456789abcdef0123456789abcdef",
      INTEGRATION_GATEWAY_SECRET: "fedcba9876543210fedcba9876543210",
      OIDC_ISSUER_URL: "https://identity.example.internal",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "abcdef0123456789abcdef0123456789",
      AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit"
    }
  });
  assert.equal(postgresBeforeAdapter.passed, false);
  assert.equal(postgresBeforeAdapter.checks.some((item) => item.name === "env:STORAGE_ENGINE.runtimeAdapter" && !item.passed), true);

  const production = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "sqlite",
      SESSION_SECRETS: "0123456789abcdef0123456789abcdef,abcdef0123456789abcdef0123456789",
      INTEGRATION_GATEWAY_SECRET: "fedcba9876543210fedcba9876543210",
      OIDC_ISSUER_URL: "https://identity.example.internal",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "abcdef0123456789abcdef0123456789",
      AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit"
    }
  });
  assert.equal(production.passed, true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-identity" && item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-audit-retention" && item.passed), true);

  const missingEnvFile = validateProductionConfig({
    profile: "production",
    envFile: ".env.missing"
  });
  assert.equal(missingEnvFile.passed, false);
  assert.equal(missingEnvFile.checks.some((item) => item.name === "env:file" && !item.passed), true);
});

test("release report summarizes repository readiness and renders markdown", () => {
  const report = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret"
    }
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.checks.some((item) => item.name === "package:scripts" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:acceptanceEvidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:securityAcceptance" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:productionDeploymentPlan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:interfaceReadiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:externalDependencyRisks" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "storage:jsonSnapshot.present" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "storage:jsonSnapshot.collections" && item.passed), true);
  assert.equal(report.storageModel.jsonSnapshot.present, true);
  assert.equal(report.storageModel.jsonSnapshot.collections >= 40, true);
  assert.equal(report.checks.some((item) => item.name === "identity:contract" && item.passed), true);
  assert.equal(report.identityContract.ok, true);
  assert.equal(report.checks.some((item) => item.name === "audit:retention" && item.passed), true);
  assert.equal(report.auditRetention.ok, true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-env-file"), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Release readiness report/);
  assert.match(markdown, /Production cutover checklist/);
  assert.match(markdown, /Storage model inspection/);
  assert.match(markdown, /Identity integration contract/);
  assert.match(markdown, /Audit retention report/);
  assert.match(markdown, /cutover-identity/);
  assert.match(markdown, /snapshot:acceptanceEvidence/);
  assert.match(markdown, /snapshot:securityAcceptance/);
  assert.match(markdown, /snapshot:productionDeploymentPlan/);
  assert.match(markdown, /snapshot:interfaceReadiness/);
  assert.match(markdown, /snapshot:externalDependencyRisks/);

  const cutoverMarkdown = renderCutoverMarkdown(report);
  assert.match(cutoverMarkdown, /Production cutover checklist/);
  assert.match(cutoverMarkdown, /cutover-audit-retention/);

  const storageMarkdown = renderStorageModelMarkdown(report);
  assert.match(storageMarkdown, /Storage model inspection/);
  assert.match(storageMarkdown, /JSON snapshot/);
  assert.match(storageMarkdown, /SQLite store/);
});

test("release report writes standalone production cutover and storage artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "release-report-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret"
    }
  });

  writeOutput(report, {
    output: path.join("tmp", "release-report-test", "release-report.json"),
    markdown: path.join("tmp", "release-report-test", "release-report.md")
  });

  const cutoverJson = JSON.parse(fs.readFileSync(path.join(outputDir, "production-cutover-checklist.json"), "utf8"));
  const cutoverMarkdown = fs.readFileSync(path.join(outputDir, "production-cutover-checklist.md"), "utf8");
  const storageJson = JSON.parse(fs.readFileSync(path.join(outputDir, "storage-model-inspection.json"), "utf8"));
  const storageMarkdown = fs.readFileSync(path.join(outputDir, "storage-model-inspection.md"), "utf8");
  const identityJson = JSON.parse(fs.readFileSync(path.join(outputDir, "identity-contract.json"), "utf8"));
  const identityMarkdown = fs.readFileSync(path.join(outputDir, "identity-contract.md"), "utf8");
  const auditJson = JSON.parse(fs.readFileSync(path.join(outputDir, "audit-retention-report.json"), "utf8"));
  const auditMarkdown = fs.readFileSync(path.join(outputDir, "audit-retention-report.md"), "utf8");
  assert.equal(cutoverJson.checklist.some((item) => item.id === "cutover-identity"), true);
  assert.match(cutoverMarkdown, /cutover-storage-adapter/);
  assert.equal(storageJson.storageModel.jsonSnapshot.present, true);
  assert.match(storageMarkdown, /Storage model inspection/);
  assert.match(storageMarkdown, /Largest/);
  assert.equal(identityJson.identityContract.ok, true);
  assert.match(identityMarkdown, /Required external claims/);
  assert.equal(auditJson.auditRetention.ok, true);
  assert.match(auditMarkdown, /Audit chains/);
});

test("release report CLI argument parser keeps command and flags", () => {
  const parsed = parseArgs(["report", "--profile=production", "--config-env=.env", "--run-commands"]);
  assert.equal(parsed.command, "report");
  assert.equal(parsed.flags.profile, "production");
  assert.equal(parsed.flags["config-env"], ".env");
  assert.equal(parsed.flags["run-commands"], true);
});
