#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildRegionalJointTestPlan,
  evaluateRegionalJointTestEvidence,
  loadRegionalIntegrationContracts
} = require("../src/platform/integration/regional-joint-test");

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...rest] = item.slice(2).split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function run(args = parseArgs(), env = process.env) {
  const registry = loadRegionalIntegrationContracts(args.registry);
  const plan = buildRegionalJointTestPlan({ registry, env });
  let evidence = null;
  if (args.evidence) {
    evidence = evaluateRegionalJointTestEvidence(
      JSON.parse(fs.readFileSync(path.resolve(String(args.evidence)), "utf8")),
      registry
    );
  }
  const report = {
    plan,
    evidence,
    productionReady: false
  };
  const requireEvidence = args["require-evidence"] === true;
  return {
    report,
    exitCode: !plan.localConfigurationReady
      || (requireEvidence && evidence?.externalEvidenceVerified !== true)
      ? 1
      : 0
  };
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "REGIONAL_JOINT_TEST_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run };
