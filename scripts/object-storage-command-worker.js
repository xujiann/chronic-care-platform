#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  SQLITE_SCHEMA_HEAD,
  applySqliteMigrations,
  createSqliteObjectStorageRepository
} = require("../src/platform/storage/sqlite-migrations");
const {
  applyObjectLifecycle,
  createObjectDownloadIntent,
  createObjectUploadIntent,
  finalizeObjectUpload,
  objectStorageCenter
} = require("../secure-object-storage");
const {
  inspectObjectStorageWorkerReadiness,
  runObjectStorageCommandWorker
} = require("../src/platform/operations/object-storage-command-worker");
const { sha256 } = require("../src/platform/storage/object-storage-durable");

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const value of argv) {
    if (!value.startsWith("--")) continue;
    const [key, ...rest] = value.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  }
  return flags;
}

function sqliteFile(env = process.env, explicit = "") {
  const dataDirectory = String(env.DATA_DIR || env.DEPLOYMENT_DATA_DIR || "").trim();
  if (!dataDirectory || !path.isAbsolute(dataDirectory)) throw new Error("OBJECT_STORAGE_DATA_DIR_INVALID");
  const canonical = path.resolve(dataDirectory, "health-city.sqlite");
  const candidate = String(explicit || env.OBJECT_STORAGE_COMMAND_SQLITE_FILE || "").trim();
  if (candidate && path.resolve(candidate).toLowerCase() !== canonical.toLowerCase()) {
    throw new Error("OBJECT_STORAGE_SQLITE_PATH_MISMATCH");
  }
  return canonical;
}

function openRepository(env = process.env, flags = {}, options = {}) {
  const db = options.db || new DatabaseSync(sqliteFile(env, flags["sqlite-file"]));
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  const migration = applySqliteMigrations(db);
  if (migration.head !== SQLITE_SCHEMA_HEAD || SQLITE_SCHEMA_HEAD !== 17) throw new Error("OBJECT_STORAGE_SCHEMA_HEAD_MISMATCH");
  const cursorSecret = String(env.OBJECT_STORAGE_CURSOR_SIGNING_SECRET || "");
  return Object.freeze({ db, repository: createSqliteObjectStorageRepository(db, { cursorSecret }) });
}

async function main(argv = process.argv.slice(2), options = {}) {
  const flags = parseArgs(argv);
  const env = options.env || process.env;
  if (flags.preflight) {
    const gateway = objectStorageCenter(env);
    const report = inspectObjectStorageWorkerReadiness(env, {
      sqliteHead: SQLITE_SCHEMA_HEAD,
      gatewayConfigured: gateway.adapterReady === true,
      providerStatusCapabilityVerified: false,
      externalEvidenceVerified: false,
      productionPromotionAllowed: false
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  }
  const opened = openRepository(env, flags, options);
  try {
    if (flags.status) {
      const report = opened.repository.health();
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report;
    }
    if (flags["replay-command"]) {
      const report = opened.repository.replayDeadLetter({
        commandId: flags["replay-command"],
        replayKeyDigest: flags["replay-key-sha256"],
        actorDigest: flags["actor-sha256"],
        reasonDigest: flags["reason-sha256"]
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report;
    }
    const report = await (options.runWorker || runObjectStorageCommandWorker)({
      repository: opened.repository,
      adapter: options.adapter || {
        applyObjectLifecycle,
        createObjectDownloadIntent,
        createObjectUploadIntent,
        finalizeObjectUpload
      },
      workerId: flags["worker-id"] || env.OBJECT_STORAGE_COMMAND_WORKER_ID,
      limit: flags.limit || env.OBJECT_STORAGE_COMMAND_WORKER_LIMIT,
      leaseSeconds: flags["lease-seconds"] || env.OBJECT_STORAGE_COMMAND_LEASE_SECONDS,
      baseBackoffSeconds: flags["base-backoff-seconds"] || env.OBJECT_STORAGE_COMMAND_BASE_BACKOFF_SECONDS
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (Number(report.persistenceRejected || 0) || Number(report.deadLettered || 0)) process.exitCode = 1;
    return report;
  } finally {
    if (!options.db) opened.db.close();
  }
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(`${sha256("OBJECT_STORAGE_COMMAND_WORKER_FAILED")}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, openRepository, parseArgs, sqliteFile };
