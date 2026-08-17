#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertMetadataOnly } = require("../src/platform/governance/technical-evidence");
const { buildDataMigrationControlCenter } = require("../src/platform/data/migration-control-center");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "data-migration-readiness-report.json");

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const flag of argv) {
    if (!flag.startsWith("--")) continue;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  }
  return flags;
}

function readRuns(input) {
  if (!input) return [];
  const target = path.resolve(String(input));
  const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
  const runs = Array.isArray(parsed) ? parsed : parsed.runs;
  if (!Array.isArray(runs)) throw new TypeError("migration readiness input must be an array or contain runs");
  assertMetadataOnly(runs, "migrationReadinessInput");
  return runs;
}

function writeReport(report, output = DEFAULT_OUTPUT) {
  const target = path.resolve(String(output));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2), "utf8");
  return target;
}

function runCli() {
  const flags = parseArgs();
  const report = buildDataMigrationControlCenter(readRuns(flags.input));
  if (flags.write === true || flags.output) writeReport(report, flags.output || DEFAULT_OUTPUT);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { DEFAULT_OUTPUT, parseArgs, readRuns, writeReport };
