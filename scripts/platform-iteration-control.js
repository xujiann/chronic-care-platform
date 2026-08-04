#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  evaluatePilotCutoverFile
} = require("../src/platform/cutover/pilot-cutover-package");

const ROOT = path.resolve(__dirname, "..");
const PROGRAM_FILE = path.join(ROOT, "config", "platform-iteration-program.json");
const ARTIFACTS = Object.freeze({
  "iteration-1": [
    "src/identity-security/pilot-cutover-trust-provider.js",
    "deploy/identity-trust-provider.env.template",
    "docs/evidence-templates/identity-trust-provider-anchors.template.json",
    "docs/evidence-templates/identity-trust-provider-snapshot.template.json",
    "test/pilot-cutover-trust-provider.test.js"
  ],
  "iteration-2": [
    "src/platform/cutover/preproduction-environment-readiness.js",
    "docs/evidence-templates/platform-iterations/preproduction-environment-evidence.template.json",
    "test/preproduction-six-iteration-control.test.js"
  ],
  "iteration-3": [
    "config/external-joint-test-campaign.json",
    "src/platform/integration/external-joint-test-campaign.js",
    "src/http/routes/integration/external-joint-test.js",
    "docs/evidence-templates/external-integration/external-joint-test-evidence-bundle.template.json",
    "docs/evidence-templates/external-integration/external-joint-test-trust-registry.template.json",
    "test/external-joint-test-campaign.test.js"
  ],
  "iteration-4": [
    "src/platform/cutover/pilot-cutover-alert-lifecycle.js",
    "src/platform/cutover/pilot-cutover-alert-runtime.js",
    "src/platform/cutover/pilot-cutover-monitoring-acceptance.js",
    "scripts/platform-cutover-alert-worker.js",
    "deploy/platform-cutover-alert-worker.service.template",
    "deploy/platform-cutover-alert-worker.timer.template",
    "deploy/pilot-cutover-monitoring.env.template",
    "docs/evidence-templates/pilot-cutover-monitoring-acceptance-v1.json",
    "test/pilot-cutover-alert-lifecycle.test.js",
    "test/pilot-cutover-alert-runtime.test.js",
    "test/pilot-cutover-monitoring-acceptance.test.js"
  ],
  "iteration-5": [
    "src/platform/cutover/pilot-cutover-rehearsal-session.js",
    "docs/evidence-templates/platform-iterations/pilot-cutover-rehearsal-session.template.json",
    "test/preproduction-six-iteration-control.test.js"
  ],
  "iteration-6": [
    "src/platform/cutover/pilot-cutover-candidate-review.js",
    "scripts/platform-preproduction-control.js",
    "deploy/platform-production-adapters.env.template",
    "docs/预生产六迭代交付与验收手册-2026-08-04.md",
    "test/platform-preproduction-control-cli.test.js"
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
    const report = evaluatePilotCutoverFile({
      file: args["cutover-input"],
      now: args.now || new Date().toISOString()
    });
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
