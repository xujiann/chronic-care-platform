"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { main, parseArgs, sqliteFile } = require("../scripts/object-storage-command-worker");

test("object storage worker CLI parses bounded command flags", () => {
  assert.deepEqual(parseArgs(["--status", "--limit=5", "--worker-id=worker-1"]), {
    status: true,
    limit: "5",
    "worker-id": "worker-1"
  });
});

test("object storage worker CLI rejects paths outside canonical DATA_DIR SQLite", () => {
  const dataDirectory = path.resolve("tmp", "object-storage-cli-data");
  assert.equal(sqliteFile({ DATA_DIR: dataDirectory }), path.join(dataDirectory, "health-city.sqlite"));
  assert.throws(() => sqliteFile({ DATA_DIR: dataDirectory }, path.join(dataDirectory, "other.sqlite")), /OBJECT_STORAGE_SQLITE_PATH_MISMATCH/);
});

test("object storage worker status initializes v17 and remains NO-GO", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const report = await main(["--status"], { db, env: { OBJECT_STORAGE_CURSOR_SIGNING_SECRET: "cursor-secret-012345678901234567890123" } });
    assert.equal(report.schemaVersion, 17);
    assert.equal(report.productionReady, false);
  } finally { db.close(); }
});
