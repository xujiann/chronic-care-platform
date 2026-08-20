#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { listTests, parseBatchSize } = require("./test-all");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "standard-test-suites.json");
const STANDARD_SUITES = new Set(["unit", "integration", "smoke"]);

function normalizeTestPath(file) {
  return String(file || "").replaceAll("\\", "/");
}

function loadStandardTestSuites() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function duplicateValues(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function validateStandardTestSuites(config = loadStandardTestSuites()) {
  const all = listTests().map(normalizeTestPath);
  const allSet = new Set(all);
  const integration = (config.integration || []).map(normalizeTestPath);
  const smoke = (config.smoke || []).map(normalizeTestPath);
  const errors = [];

  if (config.version !== 1) errors.push("standard test suite version must be 1");
  if (!integration.length) errors.push("integration suite must not be empty");
  if (!smoke.length) errors.push("smoke suite must not be empty");

  for (const [name, files] of [["integration", integration], ["smoke", smoke]]) {
    const duplicates = [...new Set(duplicateValues(files))];
    if (duplicates.length) errors.push(`${name} suite contains duplicates: ${duplicates.join(", ")}`);
    const missing = files.filter((file) => !allSet.has(file));
    if (missing.length) errors.push(`${name} suite references missing tests: ${missing.join(", ")}`);
  }

  const integrationSet = new Set(integration);
  const unit = all.filter((file) => !integrationSet.has(file));
  if (unit.length + integration.length !== all.length) {
    errors.push("unit and integration suites must partition every root Node test");
  }

  return {
    ok: errors.length === 0,
    errors,
    total: all.length,
    unit: unit.length,
    integration: integration.length,
    smoke: smoke.length
  };
}

function listStandardSuite(name, config = loadStandardTestSuites()) {
  if (!STANDARD_SUITES.has(name)) throw new Error(`unknown standard test suite: ${name}`);
  const validation = validateStandardTestSuites(config);
  if (!validation.ok) throw new Error(validation.errors.join("; "));

  const all = listTests().map(normalizeTestPath);
  if (name === "integration") return config.integration.map(normalizeTestPath);
  if (name === "smoke") return config.smoke.map(normalizeTestPath);
  const integration = new Set(config.integration.map(normalizeTestPath));
  return all.filter((file) => !integration.has(file));
}

function runStandardSuite(name, options = {}) {
  const tests = listStandardSuite(name);
  if (options.listOnly) {
    process.stdout.write(`${tests.join("\n")}\n`);
    return { ok: true, suite: name, tests: tests.length, batches: 0 };
  }

  const batchSize = name === "smoke" ? tests.length : parseBatchSize(options.batchSize);
  const batches = Math.ceil(tests.length / batchSize);
  for (let offset = 0; offset < tests.length; offset += batchSize) {
    const batch = tests.slice(offset, offset + batchSize);
    const batchNumber = Math.floor(offset / batchSize) + 1;
    process.stdout.write(`\n[standard-test:${name}] batch ${batchNumber}/${batches}: ${batch.length} files\n`);
    const result = spawnSync(
      process.execPath,
      ["--test", "--test-concurrency=1", ...batch],
      { cwd: ROOT, stdio: "inherit", windowsHide: true }
    );
    if (result.status !== 0) {
      return { ok: false, suite: name, tests: tests.length, batches, failedBatch: batchNumber };
    }
  }
  return { ok: true, suite: name, tests: tests.length, batches };
}

if (require.main === module) {
  try {
    const name = process.argv[2];
    const result = runStandardSuite(name, { listOnly: process.argv.includes("--list") });
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONFIG_PATH,
  listStandardSuite,
  loadStandardTestSuites,
  normalizeTestPath,
  runStandardSuite,
  validateStandardTestSuites
};
