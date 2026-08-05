#!/usr/bin/env node
"use strict";

const {
  publicDirectReportControlStatus
} = require("../public-health-direct-report-control-package");

function main(argv = process.argv.slice(2), env = process.env) {
  const status = publicDirectReportControlStatus(env);
  process.stdout.write(`${JSON.stringify(status)}\n`);
  if (argv.includes("--require-ready") && status.activationReady !== true) {
    process.exitCode = 2;
  }
  return status;
}

if (require.main === module) main();

module.exports = { main };
