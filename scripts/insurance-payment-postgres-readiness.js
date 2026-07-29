#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Postgres = require("../insurance-payment-postgres-repository");

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...value] = item.slice(2).split("=");
    return [key, value.length ? value.join("=") : true];
  }));
}

function buildReadiness(env = process.env, schemaReport = null, checkedAt = new Date().toISOString()) {
  const config = Postgres.buildPostgresInsurancePaymentConfig(env);
  const checks = [
    { id: "adapter-mode-enabled", passed: config.requirements.modeEnabled },
    { id: "database-url-configured", passed: config.requirements.databaseUrl },
    { id: "tls-verify-full", passed: config.requirements.tlsVerified },
    { id: "migration-evidence", passed: config.requirements.migrationEvidence },
    { id: "backup-evidence", passed: config.requirements.backupEvidence },
    { id: "restore-drill-evidence", passed: config.requirements.recoveryEvidence },
    { id: "cutover-approval", passed: config.requirements.cutoverApproval },
    { id: "schema-verified", passed: schemaReport?.ok === true }
  ];
  return {
    schema: "insurance-payment-postgres-readiness-v1",
    checkedAt,
    adapter: config.adapter,
    mode: config.mode,
    configured: config.configured,
    evidenceReady: config.evidenceReady,
    writeEnabled: config.writeEnabled,
    schemaVerified: schemaReport?.ok === true,
    localFoundationReady: /^sha256:[a-f0-9]{64}$/.test(config.migration.sha256),
    productionPrimary: false,
    migration: config.migration,
    checks,
    blockers: checks.filter((item) => !item.passed).map((item) => item.id),
    credentialsPersisted: false,
    boundary: config.boundary
  };
}

function shouldFail(report, args = {}) {
  if (report.localFoundationReady !== true) return true;
  if (args["require-write-ready"] === true && report.writeEnabled !== true) return true;
  if (args["require-schema"] === true && report.schemaVerified !== true) return true;
  return false;
}

async function run(args = parseArgs(), env = process.env) {
  let schemaReport = null;
  if (args["verify-schema"] === true || args["require-schema"] === true) {
    const repository = Postgres.createPostgresInsurancePaymentRepository({ env });
    try {
      schemaReport = await repository.verifySchema();
    } finally {
      await repository.close();
    }
  }
  const report = buildReadiness(env, schemaReport);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) {
    const output = path.resolve(String(args.output));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, json, "utf8");
  }
  process.stdout.write(json);
  return { report, exitCode: shouldFail(report, args) ? 1 : 0 };
}

if (require.main === module) {
  run().then(({ exitCode }) => { process.exitCode = exitCode; }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "PERSISTENCE_READINESS_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildReadiness, parseArgs, run, shouldFail };
