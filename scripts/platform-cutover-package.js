#!/usr/bin/env node
"use strict";

const {
  buildPilotCutoverPackage,
  evaluatePilotCutoverFile,
  loadPilotCutoverManifest,
  writePilotCutoverPackage
} = require("../src/platform/cutover/pilot-cutover-package");

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

function run(parsed = parseArgs(), runtime = {}) {
  if (parsed.command === "build") {
    const manifest = loadPilotCutoverManifest(parsed.options.manifest);
    const input = buildPilotCutoverPackage(manifest);
    const artifact = writePilotCutoverPackage(parsed.options.output, input);
    return {
      report: {
        schema: "pilot-cutover-package-build-v1",
        status: input.status,
        candidateEvidenceFingerprint: input.candidateEvidenceFingerprint,
        evidenceDigests: input.evidenceDigests,
        artifact,
        authorizationIncluded: false,
        productionReady: false
      },
      exitCode: 0
    };
  }
  if (parsed.command === "verify") {
    const report = evaluatePilotCutoverFile({
      file: parsed.options.input,
      now: parsed.options.now || runtime.now
    });
    return {
      report,
      exitCode: parsed.options["require-go-candidate"] === true
        && report.decision !== "GO-CANDIDATE"
        ? 2
        : 0
    };
  }
  throw Object.assign(new Error("command must be build or verify"), {
    code: "PILOT_CUTOVER_PACKAGE_COMMAND_INVALID"
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
      code: String(error?.code || "PILOT_CUTOVER_PACKAGE_FAILED").slice(0, 120),
      message: String(error?.message || "pilot cutover package failed").slice(0, 300),
      cutoverExecutionAuthorized: false,
      productionPrimary: false,
      productionReady: false
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run };
