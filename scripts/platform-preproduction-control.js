#!/usr/bin/env node
"use strict";

const {
  readBoundedJsonFile
} = require("../src/platform/cutover/pilot-cutover-package");
const {
  evaluatePreproductionEnvironmentFile
} = require("../src/platform/cutover/preproduction-environment-readiness");
const {
  buildRehearsalLedgerPayload,
  evaluatePilotCutoverRehearsalSessionFile
} = require("../src/platform/cutover/pilot-cutover-rehearsal-session");
const {
  buildPilotCutoverCandidateReview
} = require("../src/platform/cutover/pilot-cutover-candidate-review");

const MAX_REPORT_BYTES = 1024 * 1024;

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "", ...rest] = argv;
  return {
    command,
    options: Object.fromEntries(rest.filter((item) => item.startsWith("--")).map((item) => {
      const [key, ...value] = item.slice(2).split("=");
      return [key, value.length ? value.join("=") : true];
    }))
  };
}

function requireOption(options, name) {
  const value = String(options[name] || "").trim();
  if (!value) {
    throw Object.assign(new Error(`--${name} is required`), {
      code: "PLATFORM_PREPRODUCTION_OPTION_REQUIRED"
    });
  }
  return value;
}

function readReport(options, name) {
  return readBoundedJsonFile(requireOption(options, name), {
    label: `${name} report`,
    maximumBytes: MAX_REPORT_BYTES
  });
}

function run(parsed = parseArgs(), runtime = {}) {
  const now = parsed.options.now || runtime.now;
  if (parsed.command === "environment") {
    const report = evaluatePreproductionEnvironmentFile({
      file: requireOption(parsed.options, "input"),
      releaseId: parsed.options["release-id"],
      packageFingerprint: parsed.options["package-fingerprint"],
      now
    });
    return {
      report,
      exitCode: parsed.options["require-ready"] === true && !report.ready ? 2 : 0
    };
  }
  if (parsed.command === "rehearsal") {
    const inputFile = requireOption(parsed.options, "input");
    const report = evaluatePilotCutoverRehearsalSessionFile({
      file: inputFile,
      releaseId: parsed.options["release-id"],
      packageFingerprint: parsed.options["package-fingerprint"],
      now
    });
    return {
      report: parsed.options["ledger-payload"] === true
        ? buildRehearsalLedgerPayload(
          readBoundedJsonFile(inputFile, {
            label: "pilot cutover rehearsal session",
            maximumBytes: MAX_REPORT_BYTES
          }),
          report
        )
        : report,
      exitCode: parsed.options["require-ready"] === true && !report.ready ? 2 : 0
    };
  }
  if (parsed.command === "candidate") {
    const report = buildPilotCutoverCandidateReview({
      authorization: readReport(parsed.options, "authorization"),
      preproduction: readReport(parsed.options, "preproduction"),
      jointTests: readReport(parsed.options, "joint-tests"),
      monitoring: readReport(parsed.options, "monitoring"),
      rehearsal: readReport(parsed.options, "rehearsal")
    }, { now });
    return {
      report,
      exitCode: parsed.options["require-go-candidate"] === true
        && report.decision !== "GO-CANDIDATE"
        ? 2
        : 0
    };
  }
  throw Object.assign(new Error("command must be environment, rehearsal or candidate"), {
    code: "PLATFORM_PREPRODUCTION_COMMAND_INVALID"
  });
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "PLATFORM_PREPRODUCTION_CONTROL_FAILED").slice(0, 120),
      message: String(error?.message || "platform pre-production control failed").slice(0, 300),
      cutoverExecutionAuthorized: false,
      productionPrimary: false,
      productionReady: false
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { MAX_REPORT_BYTES, parseArgs, run };
