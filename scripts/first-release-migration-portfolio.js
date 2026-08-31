#!/usr/bin/env node
"use strict";

const { buildFirstReleaseMigrationPortfolioReadiness } = require("../src/platform/data/first-release-migration-portfolio");

function run() {
  return buildFirstReleaseMigrationPortfolioReadiness();
}

if (require.main === module) {
  try {
    const report = run();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "FIRST_RELEASE_MIGRATION_PORTFOLIO_INVALID", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run };
