const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildPostgresPrimaryReadSnapshot,
  runPostgresPrimaryReadRehearsal
} = require("../postgres-runtime-sync");
const { canonicalStringify } = require("../scripts/postgres-migration-package");
const { parseArgs, renderMarkdown } = require("../scripts/postgres-primary-read-rehearsal");

function digest(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function remoteRow(collection, value, sourceVersion = 1) {
  return {
    collection_name: collection,
    payload: value,
    payload_sha256: digest(value),
    source_version: sourceVersion,
    batch_id: `batch-${collection}`
  };
}

function expectedRow(collection, value, sourceVersion = 1) {
  return {
    collection,
    payloadSha256: digest(value),
    sourceVersion
  };
}

function createBaselineDatabase(file, rows) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE state_collections (key TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL)");
  const insert = db.prepare("INSERT INTO state_collections (key, payload, version) VALUES (?, ?, ?)");
  rows.forEach((row) => insert.run(row.collection, JSON.stringify(row.value), row.sourceVersion));
  db.close();
}

test("PostgreSQL primary read snapshot verifies digests and the complete shadow baseline", () => {
  const residents = [{ id: "r1", status: "active" }];
  const settings = { locale: "zh-CN" };
  const snapshot = buildPostgresPrimaryReadSnapshot([
    remoteRow("settings", settings, 2),
    remoteRow("residents", residents, 4)
  ], {
    expectedRows: [expectedRow("residents", residents, 4), expectedRow("settings", settings, 2)],
    requiredCollections: ["residents", "settings"]
  });

  assert.deepEqual(snapshot.state.residents, residents);
  assert.deepEqual(snapshot.state.settings, settings);
  assert.equal(snapshot.report.collections, 2);
  assert.equal(snapshot.report.matchedBaselineCollections, 2);
  assert.match(snapshot.report.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.report.productionPrimary, false);
  assert.equal(snapshot.report.writePrimary, false);
  assert.equal(snapshot.report.payloadsExposed, false);
});

test("PostgreSQL primary read snapshot rejects tampered payloads and stale baselines", () => {
  const row = remoteRow("residents", [{ id: "r1" }], 4);
  assert.throws(() => buildPostgresPrimaryReadSnapshot([{ ...row, payload_sha256: "0".repeat(64) }]), (error) => error.code === "PRIMARY_READ_DIGEST_MISMATCH");
  assert.throws(() => buildPostgresPrimaryReadSnapshot([row], {
    expectedRows: [expectedRow("residents", [{ id: "r1" }], 3)]
  }), (error) => error.code === "PRIMARY_READ_BASELINE_MISMATCH" && error.report.mismatched === 1);
  assert.throws(() => buildPostgresPrimaryReadSnapshot([row], {
    requiredCollections: ["accounts"]
  }), (error) => error.code === "PRIMARY_READ_REQUIRED_COLLECTION_MISSING");
});

test("PostgreSQL primary read rehearsal uses a repeatable read-only transaction and returns a safe report", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-primary-read-"));
  const sqliteFile = path.join(dir, "baseline.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const residents = [{ id: "r1", name: "sensitive resident" }];
  createBaselineDatabase(sqliteFile, [{ collection: "residents", value: residents, sourceVersion: 4 }]);
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql.trim());
      if (/SELECT collection_name/.test(sql)) return { rows: [remoteRow("residents", residents, 4)] };
      return { rows: [] };
    },
    release() {}
  };
  const result = await runPostgresPrimaryReadRehearsal({
    mode: "rehearsal",
    syncMode: "outbox",
    sqliteFile,
    pool: { async connect() { return client; } },
    runId: "pgread-test-1",
    checkedAt: "2026-07-14T04:00:00.000Z"
  });

  assert.equal(queries[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(queries.at(-1), "COMMIT");
  assert.deepEqual(result.state.residents, residents);
  assert.equal(result.report.status, "verified-rehearsal");
  assert.equal(result.report.matchedBaselineCollections, 1);
  assert.equal(result.report.runtimeCutoverEnabled, false);
  assert.doesNotMatch(JSON.stringify(result.report), /sensitive resident|DATABASE_URL|postgres:\/\//);
});

test("PostgreSQL primary read rehearsal keeps connection failures credential-free", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-primary-read-error-"));
  const sqliteFile = path.join(dir, "baseline.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  createBaselineDatabase(sqliteFile, [{ collection: "residents", value: [], sourceVersion: 1 }]);
  const client = {
    async query(sql) {
      if (/^BEGIN/.test(sql)) return { rows: [] };
      if (sql === "ROLLBACK") return { rows: [] };
      const error = new Error("postgres://user:secret@internal-db/platform unavailable");
      error.code = "ECONNREFUSED";
      throw error;
    },
    release() {}
  };

  await assert.rejects(() => runPostgresPrimaryReadRehearsal({
    mode: "rehearsal",
    syncMode: "outbox",
    sqliteFile,
    pool: { async connect() { return client; } }
  }), (error) => error.code === "ECONNREFUSED" && !/secret|internal-db/.test(error.message));
});

test("PostgreSQL primary read CLI keeps reports payload-free", () => {
  assert.deepEqual(parseArgs(["rehearse", "--sqlite-file=C:/data/health.sqlite", "--required-collections=residents,accounts"]), {
    command: "rehearse",
    flags: { "sqlite-file": "C:/data/health.sqlite", "required-collections": "residents,accounts" }
  });
  const markdown = renderMarkdown({
    runId: "pgread-cli-1",
    checkedAt: "2026-07-14T04:00:00.000Z",
    status: "verified-rehearsal",
    transaction: "repeatable-read-read-only",
    collections: 2,
    matchedBaselineCollections: 2,
    payloadBytes: 256,
    snapshotSha256: "a".repeat(64),
    productionPrimary: false,
    runtimeCutoverEnabled: false
  });
  assert.match(markdown, /contains no business payloads or database credentials/);
  assert.match(markdown, /Production primary: no/);
  assert.doesNotMatch(markdown, /DATABASE_URL|postgres:\/\//);
});
