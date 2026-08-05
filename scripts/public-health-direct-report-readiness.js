#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildDirectReportProductionCandidateReadiness
} = require("../public-health-direct-report-readiness");

const ALLOWED_ARGS = new Set(["input", "evaluated-at", "require-technical-ready"]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--") || !raw.includes("=")) {
      throw Object.assign(new Error(`unsupported argument ${raw}`), {
        code: "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_ARGUMENT_INVALID"
      });
    }
    const [key, ...parts] = raw.slice(2).split("=");
    const value = parts.join("=");
    if (!ALLOWED_ARGS.has(key) || !value) {
      throw Object.assign(new Error(`unsupported argument --${key}`), {
        code: "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_ARGUMENT_INVALID"
      });
    }
    args[key] = value;
  }
  return args;
}

function boolean(value, label) {
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw Object.assign(new Error(`${label} must be true or false`), {
    code: "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_ARGUMENT_INVALID"
  });
}

function readBoundedReadinessFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
    throw Object.assign(new Error("readiness input must be a regular JSON file up to 1 MiB"), {
      code: "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_INPUT_INVALID"
    });
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw Object.assign(new Error(`readiness input is not valid JSON: ${error.message}`), {
      code: "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_INPUT_INVALID"
    });
  }
}

function run(args = parseArgs()) {
  if (!args.input || !path.isAbsolute(args.input)) {
    throw Object.assign(new Error("--input must be an absolute JSON file path"), {
      code: "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_INPUT_NOT_ABSOLUTE"
    });
  }
  const input = readBoundedReadinessFile(args.input);
  const report = buildDirectReportProductionCandidateReadiness(input, {
    now: args["evaluated-at"]
  });
  const requireReady = boolean(
    args["require-technical-ready"],
    "--require-technical-ready"
  );
  return {
    report,
    exitCode: requireReady && !report.technicalCandidateReady ? 2 : 0
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
      code: error.code || "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_FAILED",
      message: error.message,
      productionReady: false
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { boolean, parseArgs, readBoundedReadinessFile, run };
