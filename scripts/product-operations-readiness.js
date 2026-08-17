#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildProductOperationsCenter } = require("../src/platform/productization/product-operations-center");
const { buildMonitoringReadinessReport } = require("./monitoring-readiness");
const { buildExercise } = require("./regional-replication-exercise");

const ROOT = path.resolve(__dirname, "..");

function buildProductOperationsReadiness(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const data = options.data || JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));
  const monitoring = options.monitoring || buildMonitoringReadinessReport();
  const replication = options.replication || buildExercise({
    root,
    generatedAt: options.now || new Date().toISOString(),
    gitCommit: options.gitCommit
  });
  return buildProductOperationsCenter(data, {
    root,
    now: options.now,
    program: options.program,
    monitoring,
    replication,
    nonfunctional: options.nonfunctional
  });
}

function runCli() {
  const report = buildProductOperationsReadiness();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildProductOperationsReadiness, runCli };
