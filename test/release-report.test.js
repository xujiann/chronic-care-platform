const assert = require("node:assert/strict");
const test = require("node:test");

const { buildReleaseReport, parseArgs, renderMarkdown, validateProductionConfig } = require("../scripts/release-report");

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

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Release readiness report/);
  assert.match(markdown, /snapshot:acceptanceEvidence/);
  assert.match(markdown, /snapshot:securityAcceptance/);
  assert.match(markdown, /snapshot:productionDeploymentPlan/);
  assert.match(markdown, /snapshot:interfaceReadiness/);
  assert.match(markdown, /snapshot:externalDependencyRisks/);
});

test("release report CLI argument parser keeps command and flags", () => {
  const parsed = parseArgs(["report", "--profile=production", "--config-env=.env", "--run-commands"]);
  assert.equal(parsed.command, "report");
  assert.equal(parsed.flags.profile, "production");
  assert.equal(parsed.flags["config-env"], ".env");
  assert.equal(parsed.flags["run-commands"], true);
});
