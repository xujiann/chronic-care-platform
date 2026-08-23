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
  const isolated = config.isolated || {};
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

  for (const [name, files] of Object.entries(isolated)) {
    if (!STANDARD_SUITES.has(name)) {
      errors.push(`isolated suite is unknown: ${name}`);
      continue;
    }
    if (!Array.isArray(files)) {
      errors.push(`isolated suite must be an array: ${name}`);
      continue;
    }
    const normalized = files.map(normalizeTestPath);
    const duplicates = [...new Set(duplicateValues(normalized))];
    if (duplicates.length) errors.push(`isolated ${name} suite contains duplicates: ${duplicates.join(", ")}`);
    const suiteFiles = name === "integration" ? integration : name === "smoke" ? smoke : all.filter((file) => !integration.includes(file));
    const outsideSuite = normalized.filter((file) => !suiteFiles.includes(file));
    if (outsideSuite.length) errors.push(`isolated ${name} files are outside the suite: ${outsideSuite.join(", ")}`);
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

function buildStandardTestBatches(name, tests, config, batchSize) {
  const isolated = new Set((config.isolated?.[name] || []).map(normalizeTestPath));
  const batches = [];
  let pending = [];

  function flushPending() {
    while (pending.length) {
      batches.push({ files: pending.slice(0, batchSize), isolated: false });
      pending = pending.slice(batchSize);
    }
  }

  for (const file of tests) {
    if (isolated.has(file)) {
      flushPending();
      batches.push({ files: [file], isolated: true });
      continue;
    }
    pending.push(file);
    if (pending.length === batchSize) flushPending();
  }
  flushPending();
  return batches;
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
  const config = loadStandardTestSuites();
  const tests = listStandardSuite(name, config);
  if (options.listOnly) {
    process.stdout.write(`${tests.join("\n")}\n`);
    return { ok: true, suite: name, tests: tests.length, batches: 0 };
  }

  const now = options.now || Date.now;
  const spawn = options.spawnSync || spawnSync;
  const batchSize = name === "smoke" ? tests.length : parseBatchSize(options.batchSize);
  const testBatches = buildStandardTestBatches(name, tests, config, batchSize);
  const suiteStartedAt = now();
  const batchDurationsMs = [];
  for (let index = 0; index < testBatches.length; index += 1) {
    const { files, isolated } = testBatches[index];
    const batchNumber = index + 1;
    process.stdout.write(`\n[standard-test:${name}] batch ${batchNumber}/${testBatches.length}: ${files.length} files${isolated ? " (isolated hotspot)" : ""}\n`);
    const batchStartedAt = now();
    const result = spawn(
      process.execPath,
      ["--test", "--test-concurrency=1", ...files],
      { cwd: ROOT, stdio: "inherit", windowsHide: true }
    );
    batchDurationsMs.push(Math.max(0, now() - batchStartedAt));
    if (result.status !== 0) {
      const metrics = {
        suite: name,
        tests: tests.length,
        batches: testBatches.length,
        durationMs: Math.max(0, now() - suiteStartedAt),
        batchDurationsMs,
        failedBatch: batchNumber
      };
      process.stdout.write(`[standard-test:metrics] ${JSON.stringify(metrics)}\n`);
      return { ok: false, ...metrics };
    }
  }
  const metrics = {
    suite: name,
    tests: tests.length,
    batches: testBatches.length,
    durationMs: Math.max(0, now() - suiteStartedAt),
    batchDurationsMs
  };
  process.stdout.write(`[standard-test:metrics] ${JSON.stringify(metrics)}\n`);
  return { ok: true, ...metrics };
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
  buildStandardTestBatches,
  listStandardSuite,
  loadStandardTestSuites,
  normalizeTestPath,
  runStandardSuite,
  validateStandardTestSuites
};
