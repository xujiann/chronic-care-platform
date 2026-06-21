#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_RELEASE_DIR = path.join(ROOT, "release");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "report", ...rawFlags] = argv;
  const flags = {};
  rawFlags.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return { command, flags };
}

function readEnvFile(file) {
  if (!file) return {};
  const resolved = path.resolve(ROOT, file);
  if (!fs.existsSync(resolved)) return {};
  return Object.fromEntries(fs.readFileSync(resolved, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const [key, ...valueParts] = line.split("=");
      return [key.trim(), valueParts.join("=").trim().replace(/^["']|["']$/g, "")];
    }));
}

function hasPlaceholder(value) {
  return /replace-with|change-me|changeme|demo-|demo_|example|placeholder/i.test(String(value || ""));
}

function secretQuality(value, minLength = 32) {
  const text = String(value || "");
  return {
    present: Boolean(text),
    length: text.length,
    placeholder: hasPlaceholder(text),
    strongEnough: text.length >= minLength && !hasPlaceholder(text)
  };
}

function check(name, passed, detail, severity = "error", category = "release") {
  return { name, category, severity, passed: Boolean(passed), detail };
}

function validateProductionConfig(options = {}) {
  const profile = String(options.profile || "demo").toLowerCase();
  const envFile = options.envFile || ".env.example";
  const env = { ...readEnvFile(envFile), ...options.env };
  const strict = profile === "production" || options.strict === true;
  const sessionSecrets = String(env.SESSION_SECRETS || env.SESSION_SECRET || "");
  const sessionSecretItems = sessionSecrets.split(",").map((item) => item.trim()).filter(Boolean);
  const gatewaySecret = String(env.INTEGRATION_GATEWAY_SECRET || "");
  const storageEngine = String(env.STORAGE_ENGINE || "auto").toLowerCase();
  const nodeEnv = String(env.NODE_ENV || "");

  const checks = [
    check("env:NODE_ENV", Boolean(nodeEnv), nodeEnv || "missing", strict ? "error" : "warn", "environment"),
    check("env:STORAGE_ENGINE", ["auto", "json", "sqlite", "postgres", "postgresql"].includes(storageEngine), storageEngine, "error", "environment"),
    check("env:SESSION_SECRETS.present", sessionSecretItems.length > 0, `${sessionSecretItems.length} configured`, "error", "environment"),
    check("env:SESSION_SECRETS.productionQuality", !strict || sessionSecretItems.every((item) => secretQuality(item).strongEnough), strict ? "production secrets must be non-placeholder and at least 32 chars" : "not enforced outside production", strict ? "error" : "warn", "environment"),
    check("env:INTEGRATION_GATEWAY_SECRET.present", Boolean(gatewaySecret), gatewaySecret ? "configured" : "missing", "error", "environment"),
    check("env:INTEGRATION_GATEWAY_SECRET.productionQuality", !strict || secretQuality(gatewaySecret).strongEnough, strict ? "production secret must be non-placeholder and at least 32 chars" : "not enforced outside production", strict ? "error" : "warn", "environment")
  ];

  if (strict) {
    checks.push(
      check("env:NODE_ENV.production", nodeEnv === "production", nodeEnv || "missing", "error", "environment"),
      check("env:STORAGE_ENGINE.production", storageEngine !== "json", "json storage is demo-only", "error", "environment"),
      check("env:DATABASE_URL.requiredForPostgres", !["postgres", "postgresql"].includes(storageEngine) || Boolean(env.DATABASE_URL), env.DATABASE_URL ? "configured" : "missing", "error", "environment")
    );
  }

  return {
    profile,
    envFile,
    passed: checks.every((item) => item.severity !== "error" || item.passed),
    checks
  };
}

function assertFile(relativePath) {
  const file = path.join(ROOT, relativePath);
  return check(`file:${relativePath}`, fs.existsSync(file), fs.existsSync(file) ? "present" : "missing", "error", "files");
}

function snapshotChecks(data) {
  const requiredCollections = [
    "residents",
    "authUsers",
    "platformRoadmap",
    "platformEvidence",
    "productionDeploymentPlan",
    "institutionCreditEvaluations",
    "researchDatasets",
    "diseaseRegistryModels",
    "accessibilityChecklist",
    "securityAcceptanceLedger"
  ];
  const raw = fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8");
  const p2 = (data.platformRoadmap || []).filter((item) => item.priority === "P2");
  const evidence = Array.isArray(data.platformEvidence) ? data.platformEvidence : [];
  const acceptanceRecords = evidence.flatMap((item) => item.records || []);
  const productionDeploymentPlan = Array.isArray(data.productionDeploymentPlan) ? data.productionDeploymentPlan : [];

  return [
    check("snapshot:collections", requiredCollections.every((key) => data[key]), requiredCollections.filter((key) => !data[key]).join(",") || "all present", "error", "snapshot"),
    check("snapshot:p2Complete", p2.length > 0 && p2.every((item) => item.status === "已完成"), p2.map((item) => `${item.title}:${item.status}`).join(";"), "error", "snapshot"),
    check("snapshot:acceptanceEvidence", acceptanceRecords.length >= 2, `${acceptanceRecords.length} evidence records`, "error", "snapshot"),
    check("snapshot:productionDeploymentPlan", productionDeploymentPlan.length >= 4 && productionDeploymentPlan.every((item) => item.id && item.owner && item.nextAction), `${productionDeploymentPlan.length} deployment tracks`, "error", "snapshot"),
    check("snapshot:noCorruptedPlaceholders", !/编码损坏|缂栫爜鎹熷潖|\?\?\?/.test(raw), "no known corrupted placeholders", "error", "snapshot"),
    check("snapshot:accessibility", Array.isArray(data.accessibilityChecklist) && data.accessibilityChecklist.length >= 5, `${data.accessibilityChecklist?.length || 0} checklist items`, "error", "snapshot")
  ];
}

function packageChecks(pkg) {
  const requiredScripts = [
    "check",
    "test",
    "test:coverage",
    "test:e2e",
    "deploy:check",
    "env:check",
    "release:report",
    "storage:backup",
    "storage:assess",
    "rollback:snapshot"
  ];
  return [
    check("package:scripts", requiredScripts.every((name) => pkg.scripts?.[name]), requiredScripts.filter((name) => !pkg.scripts?.[name]).join(",") || "all required scripts present", "error", "package"),
    check("package:nodeEngine", Boolean(pkg.engines?.node), pkg.engines?.node || "missing", "error", "package")
  ];
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "pipe", shell: process.platform === "win32", encoding: "utf8" });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    passed: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function commandChecks(runCommands) {
  if (!runCommands) return [];
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return [
    run(npm, ["run", "check"]),
    run(npm, ["test"]),
    run(npm, ["run", "deploy:check"]),
    run(npm, ["audit", "--omit=dev"])
  ].map((item) => check(`command:${item.command}`, item.passed, item.passed ? "passed" : item.stderr || item.stdout, "error", "commands"));
}

function buildReleaseReport(options = {}) {
  const pkg = readJson("package.json");
  const data = readJson("data/db.json");
  const env = validateProductionConfig(options);
  const checks = [
    assertFile("README.md"),
    assertFile("DEPLOYMENT.md"),
    assertFile(".env.example"),
    assertFile("data/db.json"),
    assertFile("server.js"),
    assertFile("scripts/storage-admin.js"),
    ...packageChecks(pkg),
    ...snapshotChecks(data),
    ...env.checks,
    ...commandChecks(options.runCommands)
  ];

  const failed = checks.filter((item) => item.severity === "error" && !item.passed);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    project: pkg.name,
    version: pkg.version,
    profile: env.profile,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: failed.length,
      warnings: checks.filter((item) => item.severity === "warn" && !item.passed).length
    },
    checks
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : item.severity.toUpperCase()} | ${item.category} | ${item.name} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    `# Release readiness report`,
    "",
    `- Project: ${report.project}`,
    `- Version: ${report.version}`,
    `- Profile: ${report.profile}`,
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Checks: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`,
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
    ""
  ].join("\n");
}

function writeOutput(report, flags) {
  if (flags.output) {
    const output = path.resolve(ROOT, String(flags.output));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  }
  if (flags.markdown) {
    const markdown = path.resolve(ROOT, String(flags.markdown));
    fs.mkdirSync(path.dirname(markdown), { recursive: true });
    fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  }
}

function runCli() {
  const { command, flags } = parseArgs();
  const options = {
    profile: flags.profile || "demo",
    envFile: flags["env-file"] || ".env.example",
    runCommands: flags["run-commands"] === true
  };
  if (command === "env-check") {
    const result = validateProductionConfig(options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (command === "report") {
    const report = buildReleaseReport(options);
    if (!flags.output && !flags.markdown && flags.write !== false) {
      flags.output = path.relative(ROOT, path.join(DEFAULT_RELEASE_DIR, "release-report.json"));
      flags.markdown = path.relative(ROOT, path.join(DEFAULT_RELEASE_DIR, "release-report.md"));
    }
    writeOutput(report, flags);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: release-report.js env-check|report [--profile=demo|production] [--env-file=.env] [--run-commands] [--output=path] [--markdown=path]");
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildReleaseReport, parseArgs, readEnvFile, renderMarkdown, validateProductionConfig };
