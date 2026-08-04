#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  createProductionAdapterRuntime
} = require("../src/platform/composition/production-adapter-runtime");

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...rest] = item.slice(2).split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function readAuthorization(file) {
  if (!file) return null;
  return JSON.parse(fs.readFileSync(path.resolve(String(file)), "utf8"));
}

async function run(args = parseArgs(), options = {}) {
  const runtime = createProductionAdapterRuntime({
    env: options.env || process.env,
    externalAuthorization: options.externalAuthorization || readAuthorization(args["approval-file"]),
    activateWorkers: args["activate-workers"] === true,
    factories: options.factories,
    pools: options.pools,
    poolSecurityEvidence: options.poolSecurityEvidence,
    fetch: options.fetch,
    now: options.now
  });
  try {
    if (args.worker) {
      const result = await runtime.runWorkerOnce(String(args.worker), {
        workerId: args["worker-id"],
        runId: args["run-id"]
      });
      return { report: result, exitCode: result.ok === false ? 2 : 0 };
    }
    const report = await runtime.readiness({ verifySchemas: args["verify-schemas"] === true });
    const requireReady = args["require-worker-ready"] === true;
    return { report, exitCode: requireReady && !report.workersEligible ? 1 : 0 };
  } finally {
    await runtime.close();
  }
}

async function main() {
  try {
    const result = await run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code || "PLATFORM_PRODUCTION_ADAPTER_RUNTIME_FAILED",
      message: String(error?.message || "production adapter runtime failed").slice(0, 300)
    })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, readAuthorization, run };
