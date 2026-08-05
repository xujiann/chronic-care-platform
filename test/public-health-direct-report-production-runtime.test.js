"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
let sqliteAvailable = true;
try {
  require("node:sqlite");
} catch {
  sqliteAvailable = false;
}

test("production runtime binds the independent worker to the platform SQLite state", {
  skip: !sqliteAvailable
}, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-direct-report-runtime-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "sqlite";
  process.env.POSTGRES_SYNC_MODE = "disabled";
  const runtime = require("../public-health-direct-report-production-runtime");
  t.after(async () => {
    const server = require("../server");
    await server.stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const dependencies = runtime.createPublicHealthDirectReportRuntimeDependencies({
    env: {
      STORAGE_ENGINE: "sqlite",
      PUBLIC_HEALTH_REFERENCE_SECRET: "runtime-reference-secret"
    }
  });
  assert.equal(typeof dependencies.repository.transaction, "function");
  await dependencies.repository.transaction(async (transaction) => {
    const snapshot = await transaction.readState();
    assert.equal(snapshot.state.storageMeta.engine, "sqlite");
    snapshot.state.publicHealthInfectiousReportingDeliveries.push({
      id: "runtime-binding-delivery",
      state: "queued",
      version: 1
    });
    await transaction.writeState(snapshot.state, {
      expectedVersion: snapshot.version,
      event: "runtime-binding-test"
    });
  });

  const server = require("../server");
  const persisted = server.readDatabase();
  assert.equal(
    persisted.publicHealthInfectiousReportingDeliveries.some(
      (item) => item.id === "runtime-binding-delivery"
    ),
    true
  );
  assert.equal(dependencies.dispatchOptions.env.STORAGE_ENGINE, "sqlite");
});
