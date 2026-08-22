#!/usr/bin/env node
"use strict";

const { DatabaseSync } = require("node:sqlite");
const { applySqliteMigrations, SQLITE_SCHEMA_HEAD } = require("../src/platform/storage/sqlite-migrations");
const { createSqliteFollowupDispatchRepository } = require("../src/citizen-chronic/followup-dispatch-outbox");
const {
  inspectFollowupDispatchWorkerReadiness,
  resolveFollowupDispatchSqliteFile,
  runFollowupDispatchWorker
} = require("../src/citizen-chronic/followup-dispatch-worker");
const {
  createFileBackedFollowupActivationVerifier,
  inspectFollowupActivationProvider
} = require("../src/citizen-chronic/followup-dispatch-activation-provider");

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((value) => {
    if (!value.startsWith("--")) return;
    const [key, ...rest] = value.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function workerRunExitCode(report = {}) {
  return Number(report.persistenceRejected || 0) > 0 || Number(report.deadLettered || 0) > 0 ? 1 : 0;
}

function cliErrorCode() {
  return "FOLLOWUP_DISPATCH_WORKER_FAILED";
}

function openRepository(env = process.env, flags = {}, options = {}) {
  const sqliteFile = options.db
    ? ":memory:"
    : resolveFollowupDispatchSqliteFile(env, flags["sqlite-file"]);
  const db = options.db || new DatabaseSync(sqliteFile);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  const migration = applySqliteMigrations(db);
  if (migration.head !== SQLITE_SCHEMA_HEAD) throw new Error("SQLite migration head mismatch");
  return Object.freeze({ db, repository: createSqliteFollowupDispatchRepository(db, options.repositoryOptions) });
}

async function main(argv = process.argv.slice(2), options = {}) {
  const flags = parseArgs(argv);
  const env = options.env || process.env;
  if (flags.preflight) {
    const activationProvider = inspectFollowupActivationProvider(env, {
      checkFilesystem: options.checkFilesystem !== false
    });
    const report = inspectFollowupDispatchWorkerReadiness(env, {
      activationVerifierConfigured: Boolean(options.activationVerifier) || activationProvider.configured
    });
    const combined = Object.freeze({ ...report, activationProvider, productionReady: false });
    process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
    return combined;
  }
  const opened = openRepository(env, flags, options);
  try {
    if (flags.status) {
      const report = opened.repository.health();
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report;
    }
    if (flags["replay-event"]) {
      const report = opened.repository.replayDeadLetter({
        eventId: flags["replay-event"],
        replayKeyDigest: flags["replay-key-sha256"],
        actorDigest: flags["actor-sha256"],
        reasonDigest: flags["reason-sha256"]
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report;
    }
    const remotePublisher = String(env.NODE_ENV || "").toLowerCase() === "production"
      || Boolean(String(env.CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL || "").trim());
    const activationVerifier = options.activationVerifier
      || (remotePublisher ? createFileBackedFollowupActivationVerifier({ env }) : undefined);
    const executeWorker = options.runWorker || runFollowupDispatchWorker;
    const report = await executeWorker({
      repository: opened.repository,
      publisher: options.publisher,
      activationVerifier,
      env,
      workerId: flags["worker-id"],
      limit: flags.limit || env.CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_LIMIT,
      leaseSeconds: flags["lease-seconds"] || env.CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_LEASE_SECONDS,
      baseBackoffSeconds: flags["base-backoff-seconds"] || env.CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_BASE_BACKOFF_SECONDS
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const exitCode = workerRunExitCode(report);
    if (exitCode) {
      const setExitCode = options.setExitCode || ((value) => { process.exitCode = value; });
      setExitCode(exitCode);
    }
    return report;
  } finally {
    if (!options.db) opened.db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${cliErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { cliErrorCode, main, openRepository, parseArgs, workerRunExitCode };
