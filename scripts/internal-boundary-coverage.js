#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_FILE = path.join(ROOT, "config", "internal-boundary-coverage.json");
const REQUIRED_GROUPS = new Set([
  "runtime-identity-policy",
  "audit-chain-source",
  "object-storage-trust",
  "api-governance"
]);
const REQUIRED_NEGATIVE_CASES = new Set([
  "runtime-identity-production-trust",
  "audit-tampering",
  "object-storage-trust-tampering",
  "missing-authentication",
  "method-path-drift",
  "idempotency-missing",
  "production-promotion"
]);
const METRICS = Object.freeze(["lines", "functions", "branches"]);

function readConfig(file = CONFIG_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function safeRepositoryPath(relativePath) {
  const value = String(relativePath || "").replaceAll("\\", "/");
  if (!value || path.isAbsolute(value) || value.includes("..") || !value.endsWith(".js")) return null;
  const resolved = path.resolve(ROOT, value);
  return resolved.startsWith(`${ROOT}${path.sep}`) ? resolved : null;
}

function validateConfig(config = readConfig()) {
  const errors = [];
  if (config.schemaVersion !== "internal-boundary-coverage-v1") errors.push("unsupported internal boundary coverage schema");
  if (config.reportPolicy !== "temporary-ci-artifact-only") errors.push("coverage reports must remain temporary CI artifacts");
  const legacy = config.legacyServerCoverage?.minimum || {};
  if (config.legacyServerCoverage?.script !== "test:coverage") errors.push("legacy server coverage script must remain test:coverage");
  if (legacy.lines < 85 || legacy.functions < 85 || legacy.branches < 55) errors.push("legacy server coverage cannot fall below 85/85/55");

  const groupIds = new Set();
  for (const group of config.groups || []) {
    if (!group.id || groupIds.has(group.id)) errors.push(`duplicate or missing coverage group: ${group.id || "unknown"}`);
    groupIds.add(group.id);
    if (!/^T\d{2}$/.test(String(group.owner || ""))) errors.push(`invalid coverage owner: ${group.id}`);
    for (const field of ["includes", "tests"]) {
      if (!Array.isArray(group[field]) || group[field].length === 0) errors.push(`${group.id} has no ${field}`);
      for (const relativePath of group[field] || []) {
        const resolved = safeRepositoryPath(relativePath);
        if (!resolved || !fs.existsSync(resolved)) errors.push(`${group.id} has unsafe or missing ${field} path: ${relativePath}`);
      }
    }
    for (const metric of METRICS) {
      const value = group.baseline?.[metric];
      if (typeof value !== "number" || value < 0 || value > 100) errors.push(`${group.id} has invalid ${metric} baseline`);
    }
  }
  for (const id of REQUIRED_GROUPS) if (!groupIds.has(id)) errors.push(`missing required coverage group: ${id}`);

  const negativeIds = new Set();
  const negativeGroupIds = new Set();
  for (const item of config.negativeMatrix || []) {
    if (!item.id || negativeIds.has(item.id)) errors.push(`duplicate or missing negative matrix id: ${item.id || "unknown"}`);
    negativeIds.add(item.id);
    if (!REQUIRED_GROUPS.has(item.group)) errors.push(`negative matrix case has unknown group: ${item.id}`);
    negativeGroupIds.add(item.group);
    const resolved = safeRepositoryPath(item.test);
    if (!resolved || !fs.existsSync(resolved)) errors.push(`negative matrix test is unsafe or missing: ${item.test}`);
    else if (!fs.readFileSync(resolved, "utf8").includes(`test("${item.title}"`)) errors.push(`negative matrix title is missing: ${item.id}`);
  }
  for (const id of REQUIRED_NEGATIVE_CASES) if (!negativeIds.has(id)) errors.push(`missing required negative matrix case: ${id}`);
  for (const id of REQUIRED_GROUPS) if (!negativeGroupIds.has(id)) errors.push(`coverage group has no direct negative matrix case: ${id}`);
  return errors;
}

function coverageArguments(group, reportDirectory, tempDirectory) {
  const c8 = path.join(ROOT, "node_modules", "c8", "bin", "c8.js");
  if (!fs.existsSync(c8)) throw new Error("c8 is not installed; run npm ci");
  const args = [c8];
  for (const include of group.includes) args.push(`--include=${include}`);
  args.push(
    "--reporter=text",
    "--reporter=json-summary",
    `--reports-dir=${reportDirectory}`,
    `--temp-directory=${tempDirectory}`,
    "--check-coverage",
    `--lines=${group.baseline.lines}`,
    `--functions=${group.baseline.functions}`,
    `--branches=${group.baseline.branches}`,
    process.execPath,
    "--test",
    ...group.tests
  );
  return args;
}

function readSummary(reportDirectory) {
  const summary = JSON.parse(fs.readFileSync(path.join(reportDirectory, "coverage-summary.json"), "utf8")).total;
  return Object.fromEntries(METRICS.map((metric) => [metric, summary[metric].pct]));
}

function runCoverage(config = readConfig()) {
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join("\n"));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-boundary-coverage-"));
  const results = [];
  try {
    for (const group of config.groups) {
      const reportDirectory = path.join(temporaryRoot, group.id, "report");
      const tempDirectory = path.join(temporaryRoot, group.id, "raw");
      const child = spawnSync(process.execPath, coverageArguments(group, reportDirectory, tempDirectory), {
        cwd: ROOT,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 16 * 1024 * 1024
      });
      if (child.stdout) process.stdout.write(child.stdout);
      if (child.stderr) process.stderr.write(child.stderr);
      if (child.status !== 0) throw new Error(`coverage group failed: ${group.id}`);
      const actual = readSummary(reportDirectory);
      for (const metric of METRICS) {
        if (actual[metric] < group.baseline[metric]) throw new Error(`${group.id} ${metric} coverage regressed below ${group.baseline[metric]}`);
      }
      results.push({ id: group.id, owner: group.owner, baseline: group.baseline, actual });
    }
    return {
      ok: true,
      schemaVersion: config.schemaVersion,
      reportPolicy: config.reportPolicy,
      reportPersisted: false,
      legacyServerCoverage: config.legacyServerCoverage,
      groups: results
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function runCli() {
  const report = runCoverage();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONFIG_FILE,
  REQUIRED_GROUPS,
  REQUIRED_NEGATIVE_CASES,
  coverageArguments,
  readConfig,
  runCoverage,
  safeRepositoryPath,
  validateConfig
};
