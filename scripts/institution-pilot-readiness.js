#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildInstitutionPilotReadiness
} = require("../src/platform/integration/institution-pilot-orchestrator");

function parseArgs(argv) {
  const result = { input: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") {
      result.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (argv[index] === "--help") {
      result.help = true;
      continue;
    }
    throw new TypeError(`unknown argument: ${argv[index]}`);
  }
  return result;
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const write = dependencies.write || ((value) => process.stdout.write(value));
  if (args.help) {
    write("Usage: node scripts/institution-pilot-readiness.js [--input <state.json>]\n");
    return null;
  }
  const readFile = dependencies.readFile || fs.readFileSync;
  const state = args.input
    ? JSON.parse(readFile(path.resolve(args.input), "utf8"))
    : {};
  const report = buildInstitutionPilotReadiness(state, { now: dependencies.now });
  write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
