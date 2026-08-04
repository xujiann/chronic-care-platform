#!/usr/bin/env node
"use strict";

const {
  evaluateOperationalControlRuntime
} = require("../src/platform/governance/operational-control-runtime");

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...rest] = item.slice(2).split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function run(args = parseArgs(), options = {}) {
  const report = evaluateOperationalControlRuntime({
    env: options.env,
    file: args.input,
    controlFile: args.controls,
    now: args.now || options.now,
    maximumBytes: options.maximumBytes
  });
  return {
    report,
    exitCode: args["require-operational-ready"] === true && !report.operationalReady
      ? 2
      : 0
  };
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "OPERATIONAL_CONTROL_RUNTIME_FAILED").slice(0, 120),
      message: String(error?.message || "operational control runtime failed").slice(0, 300),
      sensitiveDataExposed: false,
      productionReady: false
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run };
