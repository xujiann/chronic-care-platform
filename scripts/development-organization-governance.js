#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { validateDevelopmentOrganization } = require("../src/platform/governance/development-organization");

const ROOT = path.resolve(__dirname, "..");

function run() {
  const report = validateDevelopmentOrganization(ROOT);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) run();

module.exports = { run };
