"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  REQUIRED_GROUPS,
  REQUIRED_NEGATIVE_CASES,
  coverageArguments,
  readConfig,
  validateConfig
} = require("../scripts/internal-boundary-coverage");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_BASELINES = Object.freeze({
  "runtime-identity-policy": Object.freeze({ lines: 96.83, functions: 100, branches: 64.84 }),
  "audit-chain-source": Object.freeze({ lines: 93.19, functions: 100, branches: 74.49 }),
  "object-storage-trust": Object.freeze({ lines: 97.63, functions: 100, branches: 69.27 }),
  "api-governance": Object.freeze({ lines: 95.66, functions: 92.3, branches: 80.97 })
});

test("internal boundary coverage config locks every reviewed group and current baseline", () => {
  const config = readConfig();
  assert.deepEqual(validateConfig(config), []);
  assert.deepEqual(new Set(config.groups.map((group) => group.id)), REQUIRED_GROUPS);
  assert.deepEqual(new Set(config.negativeMatrix.map((item) => item.id)), REQUIRED_NEGATIVE_CASES);
  assert.deepEqual(new Set(config.negativeMatrix.map((item) => item.group)), REQUIRED_GROUPS);
  assert.deepEqual(config.legacyServerCoverage.minimum, { lines: 85, functions: 85, branches: 55 });
  for (const group of config.groups) assert.deepEqual(group.baseline, EXPECTED_BASELINES[group.id]);
});

test("coverage runner writes reports only below a caller supplied temporary directory", () => {
  const config = readConfig();
  const group = config.groups[0];
  const reportDirectory = path.join("C:\\temp", "coverage-report");
  const tempDirectory = path.join("C:\\temp", "coverage-raw");
  const args = coverageArguments(group, reportDirectory, tempDirectory);
  assert.equal(args.includes(`--reports-dir=${reportDirectory}`), true);
  assert.equal(args.includes(`--temp-directory=${tempDirectory}`), true);
  assert.equal(args.some((arg) => arg === "--reports-dir=coverage" || arg === "--temp-directory=coverage/tmp"), false);
});

test("legacy server coverage remains at least 85 lines 85 functions and 55 branches", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const command = pkg.scripts["test:coverage"];
  assert.match(command, /--include=server\.js/);
  assert.match(command, /--lines 85/);
  assert.match(command, /--functions 85/);
  assert.match(command, /--branches 55/);
  assert.equal(pkg.scripts["test:coverage:boundaries"], "node scripts/internal-boundary-coverage.js");
});

test("coverage governance rejects baseline relaxation and missing negative evidence", () => {
  const relaxed = structuredClone(readConfig());
  relaxed.groups[0].baseline.lines = -1;
  assert.match(validateConfig(relaxed).join("\n"), /invalid lines baseline/);

  const missingNegative = structuredClone(readConfig());
  missingNegative.negativeMatrix.pop();
  assert.match(validateConfig(missingNegative).join("\n"), /missing required negative matrix case/);
});
