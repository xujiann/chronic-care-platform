#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { evaluatePilotCutover } = require("../src/platform/cutover/pilot-cutover-orchestrator");

const ROOT = path.resolve(__dirname, "..");
const PROGRAM_FILE = path.join(ROOT, "config", "platform-iteration-program.json");
const ARTIFACTS = Object.freeze({
  "iteration-1": [
    "src/platform/composition/production-adapter-runtime.js",
    "scripts/production-adapter-runtime.js",
    "deploy/platform-production-adapters.env.template"
  ],
  "iteration-2": [
    "src/platform/operations/shadow-outbox-relay.js",
    "src/platform/operations/sqlite-shadow-relay-checkpoint.js",
    "src/platform/operations/sqlite-shadow-relay-operations.js",
    "src/platform/operations/domain-shadow-relay-runtime.js",
    "scripts/platform-shadow-relay.js",
    "deploy/platform-shadow-relay@.service.template",
    "deploy/platform-shadow-relay@.timer.template",
    "deploy/platform-shadow-reconcile@.service.template",
    "deploy/platform-shadow-reconcile@.timer.template"
  ],
  "iteration-3": [
    "config/regional-integration-contracts.json",
    "src/platform/integration/regional-joint-test.js",
    "scripts/regional-joint-test.js"
  ],
  "iteration-4": [
    "src/platform/orchestration/regional-business-loop.js"
  ],
  "iteration-5": [
    "config/platform-operational-controls.json",
    "src/platform/governance/operational-control-plane.js"
  ],
  "iteration-6": [
    "src/platform/cutover/pilot-cutover-orchestrator.js",
    "docs/evidence-templates/platform-iterations/pilot-cutover.template.json"
  ]
});

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...rest] = item.slice(2).split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function buildIterationProgramReport(program = JSON.parse(fs.readFileSync(PROGRAM_FILE, "utf8"))) {
  const iterations = program.iterations.map((iteration) => {
    const artifacts = (ARTIFACTS[iteration.id] || []).map((file) => ({
      file,
      present: fs.existsSync(path.join(ROOT, file))
    }));
    const localFoundationReady = artifacts.length > 0 && artifacts.every((item) => item.present);
    return {
      id: iteration.id,
      name: iteration.name,
      artifacts,
      localFoundationReady,
      externalGates: iteration.requiredExternalGates.map((id) => ({
        id,
        status: "pending-external"
      })),
      status: localFoundationReady
        ? (iteration.requiredExternalGates.length ? "local-ready-external-pending" : "local-ready")
        : "local-incomplete",
      productionReady: false
    };
  });
  return {
    schema: "platform-iteration-program-report-v1",
    programId: program.programId,
    baselineTag: program.baselineTag,
    localFoundationReady: iterations.every((item) => item.localFoundationReady),
    iterations,
    defaultDecision: "NO-GO",
    productionReady: false,
    boundary: "Artifact presence proves only the repository-local foundation. Runtime checks and every listed external gate remain separately required."
  };
}

function run(args = parseArgs()) {
  if (args["cutover-input"]) {
    const input = JSON.parse(fs.readFileSync(path.resolve(String(args["cutover-input"])), "utf8"));
    const report = evaluatePilotCutover(input, args.now || new Date().toISOString());
    return { report, exitCode: report.decision === "GO-CANDIDATE" ? 0 : 1 };
  }
  const report = buildIterationProgramReport();
  return { report, exitCode: report.localFoundationReady ? 0 : 1 };
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "PLATFORM_ITERATION_CONTROL_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ARTIFACTS, buildIterationProgramReport, parseArgs, run };
