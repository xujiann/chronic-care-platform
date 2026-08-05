#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  runDirectReportSyntheticJointTest
} = require("../src/platform/integration/public-health-direct-report-joint-test-runner");

const ALLOWED_ARGS = new Set(["dictionary", "executed-at", "package-id"]);

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (const item of argv) {
    if (!item.startsWith("--") || !item.includes("=")) {
      throw Object.assign(new Error(`unsupported argument ${item}`), {
        code: "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_ARGUMENT_INVALID"
      });
    }
    const [key, ...rest] = item.slice(2).split("=");
    if (!ALLOWED_ARGS.has(key) || !rest.join("=")) {
      throw Object.assign(new Error(`unsupported argument --${key}`), {
        code: "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_ARGUMENT_INVALID"
      });
    }
    parsed[key] = rest.join("=");
  }
  return parsed;
}

function run(args = parseArgs()) {
  if (!args.dictionary) {
    throw Object.assign(new Error("--dictionary=<absolute-json-file> is required"), {
      code: "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_DICTIONARY_REQUIRED"
    });
  }
  if (!path.isAbsolute(args.dictionary)) {
    throw Object.assign(new Error("--dictionary must use an absolute path"), {
      code: "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_DICTIONARY_NOT_ABSOLUTE"
    });
  }
  const report = runDirectReportSyntheticJointTest({
    dictionaryFile: args.dictionary,
    executedAt: args["executed-at"],
    packageId: args["package-id"]
  });
  return { report, exitCode: 0 };
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_RUN_FAILED",
      message: error.message,
      productionReady: false
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run };
