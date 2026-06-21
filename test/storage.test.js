const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
let sqliteAvailable = true;
try {
  require("node:sqlite");
} catch {
  sqliteAvailable = false;
}

function withDatabase(storage, callback) {
  const db = storage.openSqliteDatabase();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

test("SQLite migrations are idempotent and collection versions change only on writes", { skip: !sqliteAvailable }, () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-storage-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "sqlite";

  const storage = require(path.join(ROOT, "server.js"));
  try {
    storage.ensureDatabase();
    storage.ensureDatabase();

    withDatabase(storage, (db) => {
      const migrations = db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all();
      assert.deepEqual(migrations.map((item) => Number(item.version)), [1, 2, 3, 4, 5, 6]);
      assert.ok(migrations.every((item) => item.name && /^[a-f0-9]{64}$/.test(item.checksum)));

      const columns = db.prepare("PRAGMA table_info(state_collections)").all().map((item) => item.name);
      assert.ok(columns.includes("version"));
      const indexes = db.prepare("PRAGMA index_list(state_collections)").all().map((item) => item.name);
      assert.ok(indexes.includes("idx_state_collections_updated_at"));

      const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((item) => item.name);
      [
        "residents",
        "accounts",
        "account_members",
        "person_indexes",
        "personal_records",
        "chronic_records",
        "followup_records",
        "insurance_claim_records",
        "certificate_records",
        "care_order_records",
        "medication_pickup_records",
        "county_workflow_records"
      ].forEach((tableName) => {
        assert.ok(tableNames.includes(tableName), `${tableName} mirror table should exist`);
      });
    });

    const currentState = storage.readDatabase();
    withDatabase(storage, (db) => {
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM residents").get().count), currentState.residents.length);
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM accounts").get().count), currentState.accounts.length);
      assert.equal(
        Number(db.prepare("SELECT COUNT(*) AS count FROM account_members").get().count),
        currentState.accounts.reduce((sum, account) => sum + account.members.length, 0)
      );
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM personal_records").get().count), currentState.personalRecords.length);
      assert.equal(
        Number(db.prepare("SELECT COUNT(*) AS count FROM chronic_records").get().count),
        currentState.chronicScreeningTasks.length + currentState.chronicEducationPushes.length + currentState.chronicManagementPlans.length
      );
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM followup_records").get().count), currentState.followups.length);
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM insurance_claim_records").get().count), currentState.insuranceClaims.length);
      assert.equal(
        Number(db.prepare("SELECT COUNT(*) AS count FROM certificate_records").get().count),
        currentState.deathCertificates.length + currentState.birthCertificates.length
      );
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM care_order_records").get().count), currentState.careOrders.length);
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM medication_pickup_records").get().count), currentState.medicationPickups.length);
      assert.equal(
        Number(db.prepare("SELECT COUNT(*) AS count FROM county_workflow_records").get().count),
        currentState.countyCollaborationOrders.length + currentState.countyAiDiagnosisCases.length + currentState.countyMutualRecognitionRecords.length
      );
      assert.equal(
        db.prepare("SELECT resident_id FROM person_indexes WHERE person_index = ?").get("DEMO-ID-R1#DEMO-MOBILE-R1").resident_id,
        "r1"
      );
      assert.equal(
        db.prepare(`
          SELECT am.account_id
          FROM account_members am
          JOIN person_indexes pi ON pi.person_index = am.person_index
          WHERE pi.resident_id = ?
        `).get("r4").account_id,
        "a1"
      );
      const recordRow = db.prepare(`
        SELECT pr.name, pr.category, pr.resident_id
        FROM personal_records pr
        JOIN residents r ON r.id = pr.resident_id
        WHERE pr.resident_id = ? AND pr.category = ?
        ORDER BY pr.record_date DESC, pr.id
      `).get("r1", "emr");
      assert.equal(recordRow.resident_id, "r1");
      assert.equal(recordRow.category, "emr");
      assert.ok(recordRow.name);
      assert.equal(
        db.prepare("SELECT status FROM chronic_records WHERE collection = ? AND resident_id = ?").get("chronicScreeningTasks", "r1").status,
        "待筛查"
      );
      assert.equal(
        db.prepare("SELECT status FROM followup_records WHERE resident_id = ? AND disease_type = ?").get("r1", "高血压").status,
        "已逾期"
      );
      assert.equal(
        db.prepare("SELECT total_amount FROM insurance_claim_records WHERE id = ?").get("ic1").total_amount,
        386.5
      );
      assert.equal(
        db.prepare("SELECT certificate_type FROM certificate_records WHERE certificate_no = ?").get("DC-210202-20260612001").certificate_type,
        "death"
      );
      assert.equal(db.prepare("SELECT priority FROM care_order_records WHERE id = ?").get("co1").priority, currentState.careOrders.find((item) => item.id === "co1").priority);
      assert.equal(db.prepare("SELECT next_pickup FROM medication_pickup_records WHERE id = ?").get("mp1").next_pickup, "2026-07-05");
      assert.equal(
        db.prepare("SELECT collection FROM county_workflow_records WHERE id = ?").get("cco-001").collection,
        "countyCollaborationOrders"
      );
    });

    storage.readDatabase();
    const afterFirstRead = withDatabase(storage, (db) => Number(db.prepare("SELECT version FROM state_collections WHERE key = 'residents'").get().version));

    storage.readDatabase();
    const afterSecondRead = withDatabase(storage, (db) => Number(db.prepare("SELECT version FROM state_collections WHERE key = 'residents'").get().version));
    assert.equal(afterSecondRead, afterFirstRead, "pure reads should not increment collection versions");

    const state = storage.readDatabase();
    const migratedAddress = "migration-test-address";
    state.residents[0].address = migratedAddress;
    storage.writeDatabase(state);

    const afterWrite = withDatabase(storage, (db) => Number(db.prepare("SELECT version FROM state_collections WHERE key = 'residents'").get().version));
    assert.equal(afterWrite, afterSecondRead + 1);
    assert.equal(storage.readDatabase().residents[0].address, migratedAddress);
    withDatabase(storage, (db) => {
      assert.equal(db.prepare("SELECT address FROM residents WHERE id = ?").get("r1").address, migratedAddress);
    });

    const recordState = storage.readDatabase();
    const residentsVersionBeforeRecordWrite = withDatabase(storage, (db) => Number(db.prepare("SELECT version FROM state_collections WHERE key = 'residents'").get().version));
    const recordId = recordState.personalRecords.find((item) => item.residentId === "r1" && item.category === "emr").id;
    const updatedResult = "structured-record-sync";
    recordState.personalRecords.find((item) => item.id === recordId).result = updatedResult;
    storage.writeDatabase(recordState);
    withDatabase(storage, (db) => {
      assert.equal(db.prepare("SELECT result FROM personal_records WHERE id = ?").get(recordId).result, updatedResult);
      assert.equal(
        Number(db.prepare("SELECT version FROM state_collections WHERE key = 'residents'").get().version),
        residentsVersionBeforeRecordWrite,
        "unrelated collection versions should not change"
      );
    });

    const firstWriterState = storage.readDatabase();
    const staleWriterState = storage.readDatabase();
    firstWriterState.residents[0].address = "first-writer-address";
    storage.writeDatabase(firstWriterState);
    staleWriterState.residents[0].address = "stale-writer-address";
    assert.throws(() => {
      storage.writeDatabase(staleWriterState);
    }, /optimistic lock conflict/);
    assert.equal(storage.readDatabase().residents[0].address, "first-writer-address");

    assert.throws(() => {
      const duplicateIndexState = storage.readDatabase();
      duplicateIndexState.residents[1].idCard = duplicateIndexState.residents[0].idCard;
      duplicateIndexState.residents[1].phone = duplicateIndexState.residents[0].phone;
      storage.writeDatabase(duplicateIndexState);
    }, /UNIQUE constraint failed/);
    assert.throws(() => {
      const orphanRecordState = storage.readDatabase();
      orphanRecordState.personalRecords[0].residentId = "missing-resident";
      storage.writeDatabase(orphanRecordState);
    }, /FOREIGN KEY constraint failed/);
    assert.throws(() => {
      const orphanBusinessState = storage.readDatabase();
      orphanBusinessState.insuranceClaims[0].residentId = "missing-resident";
      storage.writeDatabase(orphanBusinessState);
    }, /FOREIGN KEY constraint failed/);
    assert.throws(() => {
      const orphanServiceState = storage.readDatabase();
      orphanServiceState.careOrders[0].residentId = "missing-resident";
      storage.writeDatabase(orphanServiceState);
    }, /FOREIGN KEY constraint failed/);
    assert.equal(storage.storageMeta().schemaVersion, 6);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
