const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_ROOT = path.join(ROOT, "test");
const DEFAULT_BATCH_SIZE = 40;

function listTests() {
  return fs.readdirSync(TEST_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
    .map((entry) => path.join("test", entry.name))
    .sort();
}

function parseBatchSize(value = process.env.TEST_BATCH_SIZE) {
  if (value === undefined || value === "") return DEFAULT_BATCH_SIZE;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error("TEST_BATCH_SIZE must be an integer from 1 to 200");
  }
  return parsed;
}

function runAllTests({ listOnly = process.argv.includes("--list") } = {}) {
  const tests = listTests();
  if (listOnly) {
    process.stdout.write(`${tests.join("\n")}\n`);
    return { ok: true, tests: tests.length, batches: 0 };
  }

  const batchSize = parseBatchSize();
  const batches = Math.ceil(tests.length / batchSize);
  for (let offset = 0; offset < tests.length; offset += batchSize) {
    const batch = tests.slice(offset, offset + batchSize);
    const batchNumber = Math.floor(offset / batchSize) + 1;
    process.stdout.write(`\n[full-test] batch ${batchNumber}/${batches}: ${batch.length} files\n`);
    const result = spawnSync(
      process.execPath,
      ["--test", "--test-concurrency=1", ...batch],
      { cwd: ROOT, stdio: "inherit", windowsHide: true }
    );
    if (result.status !== 0) {
      return { ok: false, tests: tests.length, batches, failedBatch: batchNumber };
    }
  }
  return { ok: true, tests: tests.length, batches };
}

if (require.main === module) {
  try {
    const result = runAllTests();
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  listTests,
  parseBatchSize,
  runAllTests
};
