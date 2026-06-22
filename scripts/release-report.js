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

function buildProductionCutoverChecklist(env, checks) {
  const byName = Object.fromEntries(checks.map((item) => [item.name, item]));
  const ready = (...names) => names.every((name) => byName[name]?.passed);
  const detail = (...names) => names.map((name) => `${name}: ${byName[name]?.detail || "missing"}`).join("; ");
  const storageEngine = String(env.STORAGE_ENGINE || "auto").toLowerCase();
  return [
    {
      id: "cutover-env-file",
      phase: "environment",
      owner: "platform-ops",
      passed: ready("env:file", "env:NODE_ENV.production", "env:STORAGE_ENGINE", "env:STORAGE_ENGINE.production"),
      evidence: detail("env:file", "env:NODE_ENV.production", "env:STORAGE_ENGINE", "env:STORAGE_ENGINE.production"),
      nextAction: "在目标服务器创建真实 .env，设置 NODE_ENV=production，并确认不使用 JSON 作为生产主存储。"
    },
    {
      id: "cutover-secrets",
      phase: "security",
      owner: "security-admin",
      passed: ready("env:SESSION_SECRETS.present", "env:SESSION_SECRETS.productionQuality", "env:INTEGRATION_GATEWAY_SECRET.present", "env:INTEGRATION_GATEWAY_SECRET.productionQuality"),
      evidence: detail("env:SESSION_SECRETS.present", "env:SESSION_SECRETS.productionQuality", "env:INTEGRATION_GATEWAY_SECRET.present", "env:INTEGRATION_GATEWAY_SECRET.productionQuality"),
      nextAction: "生成不少于 32 位、非占位的会话密钥和接口网关 HMAC 密钥；按轮换策略把新密钥放在 SESSION_SECRETS 首位。"
    },
    {
      id: "cutover-identity",
      phase: "identity",
      owner: "identity-integration",
      passed: ready("env:OIDC.identityAdapter"),
      evidence: detail("env:OIDC.identityAdapter"),
      nextAction: "确认政务统一认证 OIDC/SAML 参数、客户端密钥、回调地址、机构目录和医生身份源映射。"
    },
    {
      id: "cutover-audit-retention",
      phase: "audit",
      owner: "security-admin",
      passed: ready("env:AUDIT.retentionTarget"),
      evidence: detail("env:AUDIT.retentionTarget"),
      nextAction: "配置 AUDIT_EXPORT_PATH 或 SIEM_ENDPOINT，并确认日志保全、留存年限、访问审计和导出权限。"
    },
    {
      id: "cutover-storage-adapter",
      phase: "storage",
      owner: "data-platform",
      passed: ready("env:STORAGE_ENGINE.runtimeAdapter", "env:DATABASE_URL.requiredForPostgres") && !["postgres", "postgresql"].includes(storageEngine),
      evidence: detail("env:STORAGE_ENGINE.runtimeAdapter", "env:DATABASE_URL.requiredForPostgres"),
      nextAction: "当前运行时支持 auto/sqlite；如切换 PostgreSQL，需先完成正式数据库适配器、迁移、回滚和原生备份演练。"
    }
  ];
}

function validateProductionConfig(options = {}) {
  const profile = String(options.profile || "demo").toLowerCase();
  const envFile = options.envFile || ".env.example";
  const envFileExists = !envFile || fs.existsSync(path.resolve(ROOT, envFile));
  const env = { ...readEnvFile(envFile), ...options.env };
  const strict = profile === "production" || options.strict === true;
  const sessionSecrets = String(env.SESSION_SECRETS || env.SESSION_SECRET || "");
  const sessionSecretItems = sessionSecrets.split(",").map((item) => item.trim()).filter(Boolean);
  const gatewaySecret = String(env.INTEGRATION_GATEWAY_SECRET || "");
  const storageEngine = String(env.STORAGE_ENGINE || "auto").toLowerCase();
  const nodeEnv = String(env.NODE_ENV || "");

  const checks = [
    check("env:file", envFileExists, envFileExists ? envFile : `${envFile} missing`, strict ? "error" : "warn", "environment"),
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
      check("env:STORAGE_ENGINE.runtimeAdapter", ["auto", "sqlite"].includes(storageEngine), ["auto", "sqlite"].includes(storageEngine) ? storageEngine : `${storageEngine} adapter not enabled`, "error", "environment"),
      check("env:DATABASE_URL.requiredForPostgres", !["postgres", "postgresql"].includes(storageEngine) || Boolean(env.DATABASE_URL), env.DATABASE_URL ? "configured" : "missing", "error", "environment"),
      check("env:OIDC.identityAdapter", Boolean(env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET), env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET ? "configured" : "missing OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET", "error", "environment"),
      check("env:AUDIT.retentionTarget", Boolean(env.AUDIT_EXPORT_PATH || env.SIEM_ENDPOINT), env.AUDIT_EXPORT_PATH || env.SIEM_ENDPOINT ? "configured" : "missing AUDIT_EXPORT_PATH or SIEM_ENDPOINT", "error", "environment")
    );
  }

  return {
    profile,
    envFile,
    passed: checks.every((item) => item.severity !== "error" || item.passed),
    checks,
    cutoverChecklist: buildProductionCutoverChecklist(env, checks)
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
    "platformInterfaces",
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
  const securityAcceptanceLedger = Array.isArray(data.securityAcceptanceLedger) ? data.securityAcceptanceLedger : [];
  const productionDeploymentPlan = Array.isArray(data.productionDeploymentPlan) ? data.productionDeploymentPlan : [];
  const p0Interfaces = (Array.isArray(data.platformInterfaces) ? data.platformInterfaces : []).filter((item) => item.priority === "P0");
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const externalDependencyRiskIds = [
    "identity-source",
    "institution-systems",
    "insurance-core",
    "certificate-sharing",
    "security-assessment",
    "disaster-recovery"
  ];

  return [
    check("snapshot:collections", requiredCollections.every((key) => data[key]), requiredCollections.filter((key) => !data[key]).join(",") || "all present", "error", "snapshot"),
    check("snapshot:p2Complete", p2.length > 0 && p2.every((item) => item.status === "已完成"), p2.map((item) => `${item.title}:${item.status}`).join(";"), "error", "snapshot"),
    check("snapshot:acceptanceEvidence", acceptanceRecords.length >= 2, `${acceptanceRecords.length} evidence records`, "error", "snapshot"),
    check("snapshot:securityAcceptance", securityAcceptanceLedger.length >= 4 && securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), `${securityAcceptanceLedger.length} security acceptance items`, "error", "snapshot"),
    check("snapshot:productionDeploymentPlan", productionDeploymentPlan.length >= 4 && productionDeploymentPlan.every((item) => item.id && item.owner && item.nextAction), `${productionDeploymentPlan.length} deployment tracks`, "error", "snapshot"),
    check("snapshot:interfaceReadiness", p0Interfaces.length >= 4 && p0Interfaces.every((item) => item.id && item.owner && item.status && item.next), `${p0Interfaces.length} P0 interface tracks`, "error", "snapshot"),
    check("snapshot:externalDependencyRisks", externalDependencyRiskIds.every((id) => serverSource.includes(id)), `${externalDependencyRiskIds.length} external dependency risks`, "error", "snapshot"),
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
  const commandLine = [command, ...args].join(" ");
  const result = process.platform === "win32"
    ? spawnSync(commandLine, { cwd: ROOT, stdio: "pipe", shell: true, encoding: "utf8" })
    : spawnSync(command, args, { cwd: ROOT, stdio: "pipe", shell: false, encoding: "utf8" });
  return {
    command: commandLine,
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
    run(npm, ["run", "test:coverage"]),
    run(npm, ["run", "test:e2e"]),
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
    checks,
    productionCutover: env.cutoverChecklist
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : item.severity.toUpperCase()} | ${item.category} | ${item.name} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const cutoverRows = (report.productionCutover || []).map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.phase} | ${item.owner} | ${item.id} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
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
    "",
    "## Production cutover checklist",
    "",
    "| Result | Phase | Owner | Item | Next action |",
    "|---|---|---|---|---|",
    ...cutoverRows,
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
    envFile: flags["config-env"] || flags["env-file"] || ".env.example",
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
  throw new Error("Usage: release-report.js env-check|report [--profile=demo|production] [--config-env=.env] [--run-commands] [--output=path] [--markdown=path]");
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildProductionCutoverChecklist, buildReleaseReport, parseArgs, readEnvFile, renderMarkdown, validateProductionConfig };
