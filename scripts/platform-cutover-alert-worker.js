#!/usr/bin/env node
"use strict";

const {
  buildPilotCutoverAlertControlStatus,
  runPilotCutoverAlertDeliveryCycle
} = require("../src/platform/cutover/pilot-cutover-alert-runtime");

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "run-once", ...rest] = argv;
  return {
    command,
    options: Object.fromEntries(rest.filter((item) => item.startsWith("--")).map((item) => {
      const [key, ...value] = item.slice(2).split("=");
      return [key, value.length ? value.join("=") : true];
    }))
  };
}

async function run(parsed = parseArgs(), runtime = {}) {
  if (parsed.command === "status") {
    const report = buildPilotCutoverAlertControlStatus({
      env: runtime.env || process.env,
      file: parsed.options.journal,
      routes: parsed.options.routes,
      now: parsed.options.now || runtime.now
    });
    return {
      report,
      exitCode: parsed.options["require-operational"] === true
        && report.status !== "operational"
        ? 2
        : 0
    };
  }
  if (parsed.command === "run-once") {
    const report = await runPilotCutoverAlertDeliveryCycle({
      env: runtime.env || process.env,
      file: parsed.options.journal,
      routes: parsed.options.routes,
      actorAccount: parsed.options.actor,
      now: parsed.options.now || runtime.now,
      maximumAttempts: parsed.options["maximum-attempts"],
      controlProvider: runtime.controlProvider,
      dispatcher: runtime.dispatcher,
      sleep: runtime.sleep
    });
    return {
      report,
      exitCode: report.status === "completed" ? 0 : 2
    };
  }
  throw Object.assign(new Error("command must be status or run-once"), {
    code: "PILOT_CUTOVER_ALERT_WORKER_COMMAND_INVALID"
  });
}

if (require.main === module) {
  run().then((result) => {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "PILOT_CUTOVER_ALERT_WORKER_FAILED").slice(0, 120),
      message: String(error?.message || "pilot cutover alert worker failed").slice(0, 300),
      cutoverExecutionAuthorized: false,
      productionReady: false
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, run };
