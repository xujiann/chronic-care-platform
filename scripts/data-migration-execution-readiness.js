#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertMetadataOnly } = require("../src/platform/governance/technical-evidence");
const { assessMigrationExecutionState } = require("../src/platform/data/migration-execution-runtime");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "data-migration-execution-readiness.json");

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const flag of argv) {
    if (!flag.startsWith("--")) continue;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  }
  return flags;
}

function readRecoveryState(input) {
  if (!input) return { schemaVersion: "data-migration-execution-recovery-v1", batches: [], outboxEvents: [] };
  const parsed = JSON.parse(fs.readFileSync(path.resolve(String(input)), "utf8"));
  assertMetadataOnly(parsed, "migrationExecutionReadinessInput");
  return parsed;
}

function writeReport(report, output = DEFAULT_OUTPUT) {
  const target = path.resolve(String(output));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2), "utf8");
  return target;
}

function runCli() {
  const flags = parseArgs();
  const report = assessMigrationExecutionState(readRecoveryState(flags.input));
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

module.exports = { DEFAULT_OUTPUT, parseArgs, readRecoveryState, writeReport };
