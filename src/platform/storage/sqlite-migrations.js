"use strict";

const { createHash } = require("node:crypto");
const { createSqliteSessionSchema } = require("../../../session-store");
const {
  auditDeliverySourceMigrationFingerprintDependencies,
  backfillAuditDeliverySourceFromCollections,
  createAuditDeliverySourceSchema
} = require("../../identity-security/audit-delivery-source");

const MIGRATION_OWNER = "T00/data-governance";
const FROZEN_LEGACY_MAX_VERSION = 14;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function functionSource(value) {
  if (typeof value !== "function") throw new TypeError("migration apply must be a function");
  return Function.prototype.toString.call(value).replaceAll("\r\n", "\n");
}

function migrationContentFingerprint(migration) {
  const dependencies = (migration.fingerprintDependencies || []).map(functionSource);
  return sha256(JSON.stringify({
    version: Number(migration.version),
    name: String(migration.name || ""),
    owner: String(migration.owner || ""),
    apply: functionSource(migration.apply),
    dependencies
  }));
}

function legacyLedgerChecksum(migration) {
  return sha256(`${migration.version}:${migration.name}`);
}

const MIGRATION_DEFINITIONS = [
  {
    version: 1,
    name: "create collection state and storage events",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS state_collections (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS storage_events (
          id TEXT PRIMARY KEY,
          at TEXT NOT NULL,
          event TEXT NOT NULL,
          detail TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 2,
    name: "add collection versions and update index",
    apply(db) {
      const columns = db.prepare("PRAGMA table_info(state_collections)").all();
      if (!columns.some((column) => column.name === "version")) {
        db.exec("ALTER TABLE state_collections ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_state_collections_updated_at ON state_collections(updated_at)");
    }
  },
  {
    version: 3,
    name: "add structured identity mirror tables",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS residents (
          id TEXT PRIMARY KEY,
          person_index TEXT,
          name TEXT NOT NULL,
          id_card TEXT,
          phone TEXT,
          gender TEXT,
          birth_date TEXT,
          organization TEXT,
          family_doctor TEXT,
          address TEXT,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_residents_person_index
          ON residents(person_index)
          WHERE person_index IS NOT NULL AND person_index != '';
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT,
          role TEXT,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_members (
          account_id TEXT NOT NULL,
          resident_id TEXT NOT NULL,
          relation TEXT,
          person_index TEXT,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (account_id, resident_id),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_account_members_resident_id
          ON account_members(resident_id);
        CREATE INDEX IF NOT EXISTS idx_account_members_person_index
          ON account_members(person_index);
        CREATE TABLE IF NOT EXISTS person_indexes (
          person_index TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL UNIQUE,
          id_card TEXT,
          phone TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 4,
    name: "add structured personal record mirror table",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS personal_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          category TEXT NOT NULL,
          record_date TEXT,
          name TEXT NOT NULL,
          result TEXT,
          source TEXT,
          created_by TEXT,
          created_at TEXT,
          updated_by TEXT,
          updated_at TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_personal_records_resident_category
          ON personal_records(resident_id, category);
        CREATE INDEX IF NOT EXISTS idx_personal_records_person_index
          ON personal_records(person_index);
        CREATE INDEX IF NOT EXISTS idx_personal_records_record_date
          ON personal_records(record_date);
      `);
    }
  },
  {
    version: 5,
    name: "add structured business workflow mirror tables",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chronic_records (
          id TEXT PRIMARY KEY,
          collection TEXT NOT NULL,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          disease_type TEXT,
          title TEXT NOT NULL,
          status TEXT,
          owner TEXT,
          due_date TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chronic_records_collection_status
          ON chronic_records(collection, status);
        CREATE INDEX IF NOT EXISTS idx_chronic_records_resident
          ON chronic_records(resident_id);
        CREATE INDEX IF NOT EXISTS idx_chronic_records_due_date
          ON chronic_records(due_date);
        CREATE TABLE IF NOT EXISTS followup_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          disease_type TEXT,
          planned_at TEXT,
          assignee TEXT,
          status TEXT,
          result TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_followup_records_resident_status
          ON followup_records(resident_id, status);
        CREATE INDEX IF NOT EXISTS idx_followup_records_planned_at
          ON followup_records(planned_at);
        CREATE TABLE IF NOT EXISTS insurance_claim_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          institution TEXT,
          claim_type TEXT,
          disease_type TEXT,
          total_amount REAL,
          insurance_pay REAL,
          self_pay REAL,
          status TEXT,
          claim_date TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_insurance_claim_records_resident_status
          ON insurance_claim_records(resident_id, status);
        CREATE INDEX IF NOT EXISTS idx_insurance_claim_records_claim_date
          ON insurance_claim_records(claim_date);
        CREATE TABLE IF NOT EXISTS certificate_records (
          id TEXT PRIMARY KEY,
          certificate_type TEXT NOT NULL,
          certificate_no TEXT,
          resident_id TEXT,
          person_index TEXT,
          subject_name TEXT,
          issuing_institution TEXT,
          status TEXT,
          electronic_license_status TEXT,
          event_at TEXT,
          last_updated TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_certificate_records_type_status
          ON certificate_records(certificate_type, status);
        CREATE INDEX IF NOT EXISTS idx_certificate_records_resident
          ON certificate_records(resident_id);
        CREATE INDEX IF NOT EXISTS idx_certificate_records_event_at
          ON certificate_records(event_at);
      `);
    }
  },
  {
    version: 6,
    name: "add service and county workflow mirror tables",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS care_order_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          institution TEXT,
          department TEXT,
          order_type TEXT,
          status TEXT,
          priority TEXT,
          order_date TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_care_order_records_resident_status
          ON care_order_records(resident_id, status);
        CREATE INDEX IF NOT EXISTS idx_care_order_records_order_date
          ON care_order_records(order_date);
        CREATE TABLE IF NOT EXISTS medication_pickup_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          medication TEXT NOT NULL,
          pharmacy TEXT,
          next_pickup TEXT,
          status TEXT,
          coverage TEXT,
          delivery_mode TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_medication_pickup_records_resident_status
          ON medication_pickup_records(resident_id, status);
        CREATE INDEX IF NOT EXISTS idx_medication_pickup_records_next_pickup
          ON medication_pickup_records(next_pickup);
        CREATE TABLE IF NOT EXISTS county_workflow_records (
          id TEXT PRIMARY KEY,
          collection TEXT NOT NULL,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          region TEXT,
          institution TEXT,
          workflow_type TEXT,
          status TEXT,
          event_at TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_county_workflow_records_collection_status
          ON county_workflow_records(collection, status);
        CREATE INDEX IF NOT EXISTS idx_county_workflow_records_resident
          ON county_workflow_records(resident_id);
        CREATE INDEX IF NOT EXISTS idx_county_workflow_records_event_at
          ON county_workflow_records(event_at);
      `);
    }
  },
  {
    version: 7,
    name: "add governance research and accessibility mirror tables",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS institution_credit_evaluation_records (
          id TEXT PRIMARY KEY,
          institution_name TEXT NOT NULL,
          institution_type TEXT,
          period TEXT,
          score REAL,
          grade TEXT,
          status TEXT,
          owner TEXT,
          appeal_status TEXT,
          publication_status TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_credit_evaluation_grade_status
          ON institution_credit_evaluation_records(grade, status);
        CREATE INDEX IF NOT EXISTS idx_credit_evaluation_period
          ON institution_credit_evaluation_records(period);
        CREATE TABLE IF NOT EXISTS research_dataset_records (
          id TEXT PRIMARY KEY,
          disease_type TEXT NOT NULL,
          name TEXT NOT NULL,
          version TEXT,
          ethics_approval TEXT,
          anonymization TEXT,
          authorization_status TEXT,
          records_count INTEGER,
          status TEXT,
          usage_audit_count INTEGER,
          outcome_count INTEGER,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_research_dataset_disease_status
          ON research_dataset_records(disease_type, status);
        CREATE TABLE IF NOT EXISTS disease_registry_model_records (
          id TEXT PRIMARY KEY,
          disease_type TEXT NOT NULL,
          version TEXT,
          population TEXT,
          threshold_rule TEXT,
          review_status TEXT,
          reviewer TEXT,
          output_count INTEGER,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_disease_registry_model_disease_review
          ON disease_registry_model_records(disease_type, review_status);
        CREATE TABLE IF NOT EXISTS accessibility_checklist_records (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          item TEXT NOT NULL,
          status TEXT,
          evidence TEXT,
          tester TEXT,
          updated_at TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_accessibility_checklist_category_status
          ON accessibility_checklist_records(category, status);
      `);
    }
  },
  {
    version: 8,
    name: "add PostgreSQL transactional sync outbox",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS postgres_sync_outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          payload TEXT NOT NULL,
          payload_sha256 TEXT NOT NULL,
          previous_chain_hash TEXT NOT NULL DEFAULT '',
          chain_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retry', 'delivered', 'failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          next_attempt_at TEXT NOT NULL,
          delivered_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_postgres_sync_outbox_delivery
          ON postgres_sync_outbox(status, next_attempt_at, sequence);
        CREATE INDEX IF NOT EXISTS idx_postgres_sync_outbox_created_at
          ON postgres_sync_outbox(created_at);
      `);
    }
  },
  {
    version: 9,
    name: "add PostgreSQL shadow reconciliation ledger",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS postgres_sync_reconciliations (
          run_id TEXT PRIMARY KEY,
          checked_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('matched', 'mismatched', 'error')),
          local_collections INTEGER NOT NULL DEFAULT 0,
          remote_collections INTEGER NOT NULL DEFAULT 0,
          matched INTEGER NOT NULL DEFAULT 0,
          mismatched INTEGER NOT NULL DEFAULT 0,
          missing_remote INTEGER NOT NULL DEFAULT 0,
          unexpected_remote INTEGER NOT NULL DEFAULT 0,
          version_mismatches INTEGER NOT NULL DEFAULT 0,
          digest_mismatches INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          error_code TEXT NOT NULL DEFAULT '',
          detail_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_postgres_sync_reconciliations_checked_at
          ON postgres_sync_reconciliations(checked_at DESC);
        CREATE INDEX IF NOT EXISTS idx_postgres_sync_reconciliations_status
          ON postgres_sync_reconciliations(status, checked_at DESC);
      `);
    }
  },
  {
    version: 10,
    name: "add PostgreSQL reconciliation case workflow",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS postgres_sync_reconciliation_cases (
          case_id TEXT PRIMARY KEY,
          collection_name TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'reopened')),
          owner TEXT NOT NULL DEFAULT 'database-operations',
          severity TEXT NOT NULL DEFAULT 'critical',
          first_run_id TEXT NOT NULL,
          latest_run_id TEXT NOT NULL,
          cleared_run_id TEXT NOT NULL DEFAULT '',
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          cleared_at TEXT NOT NULL DEFAULT '',
          occurrence_count INTEGER NOT NULL DEFAULT 1,
          difference_types_json TEXT NOT NULL DEFAULT '[]',
          local_version INTEGER,
          remote_version INTEGER,
          local_digest TEXT NOT NULL DEFAULT '',
          remote_digest TEXT NOT NULL DEFAULT '',
          resolution_note TEXT NOT NULL DEFAULT '',
          resolved_at TEXT NOT NULL DEFAULT '',
          resolved_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_postgres_sync_reconciliation_cases_status
          ON postgres_sync_reconciliation_cases(status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_postgres_sync_reconciliation_cases_owner
          ON postgres_sync_reconciliation_cases(owner, status);
        CREATE TABLE IF NOT EXISTS postgres_sync_reconciliation_case_actions (
          action_id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          action TEXT NOT NULL,
          from_status TEXT NOT NULL,
          to_status TEXT NOT NULL,
          actor TEXT NOT NULL,
          role TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          evidence_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES postgres_sync_reconciliation_cases(case_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_postgres_sync_reconciliation_case_actions_case
          ON postgres_sync_reconciliation_case_actions(case_id, created_at DESC);
      `);
    }
  },
  {
    version: 11,
    name: "add durable authentication sessions",
    fingerprintDependencies: [createSqliteSessionSchema],
    apply(db) {
      createSqliteSessionSchema(db);
    }
  },
  {
    version: 12,
    name: "add public health modernization unique signal keys",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS public_health_modernization_signal_keys (
          signal_id TEXT PRIMARY KEY,
          source_record_hash TEXT NOT NULL UNIQUE,
          idempotency_key_hash TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_public_health_modernization_source_record_hash
          ON public_health_modernization_signal_keys(source_record_hash);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_public_health_modernization_idempotency_key_hash
          ON public_health_modernization_signal_keys(idempotency_key_hash);
      `);
    }
  },
  {
    version: 13,
    name: "add respiratory network lifecycle replay keys",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS public_health_respiratory_lifecycle_request_keys (
          request_id TEXT PRIMARY KEY,
          idempotency_key_hash TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS public_health_respiratory_lifecycle_event_keys (
          event_id TEXT PRIMARY KEY,
          receipt_id TEXT NOT NULL UNIQUE,
          request_id TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS public_health_respiratory_lifecycle_audit_keys (
          audit_id TEXT PRIMARY KEY,
          idempotency_key_hash TEXT NOT NULL UNIQUE,
          request_stage_key TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 14,
    name: "add public health official exchange receipt replay keys",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS public_health_official_exchange_receipt_keys (
          record_id TEXT PRIMARY KEY,
          server_receipt_id TEXT NOT NULL UNIQUE,
          external_receipt_code TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS public_health_official_exchange_audit_keys (
          audit_id TEXT PRIMARY KEY,
          idempotency_key_hash TEXT NOT NULL UNIQUE,
          record_id TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 15,
    name: "add append-only continuous audit delivery source",
    fingerprintDependencies: [
      createAuditDeliverySourceSchema,
      backfillAuditDeliverySourceFromCollections,
      ...auditDeliverySourceMigrationFingerprintDependencies
    ],
    apply(db) {
      createAuditDeliverySourceSchema(db);
      backfillAuditDeliverySourceFromCollections(db);
    }
  }
].map((migration) => ({ ...migration, owner: MIGRATION_OWNER }));

// These values are intentionally literal. Updating a v1-v14 migration requires
// a separate migration instead of refreshing this baseline in place.
const FROZEN_LEGACY_FINGERPRINTS = Object.freeze({
  1: "4bdafd992003885fec51697ed2cf4133b5466d4ae18bd753116f12faac36c444",
  2: "98658a4be1c5731edf66aae6bf3a11abd74aac8e60768af8d1cec35e990b9d68",
  3: "36062760c38324447c91251d6724f58a7e5c7e6047c8e9461b913005d2bdcdde",
  4: "3d17d45364bb2f5a811d30c65740cf2c9b44959f6a081ae86febb9df00c6c415",
  5: "fc415137941313ae4a28f28040c8b7f3b685b2f0c7470376220cffe2af3e76a4",
  6: "61a0f3809a08edfd1b97ba6cd509d25f64654be2b043780e9c2bb493592b75d1",
  7: "c04ae07dcfdde52839151981da2e4e0debba918285319466f4d50cdd01476922",
  8: "8b5efeb1f711f3fb519958ae05aaf07fd48b02f1b7431f33eee09ede1375c680",
  9: "48ff849a31fc7c89c3626b0bc243badb033ceeefe7f9ce21a4006b55696842d2",
  10: "f3a7e14f18977c266262cf58efc736ff9264dec3e125ce34d8b8be9b72c60f94",
  11: "8b3008a7ffdf1c19e6666ae94fb72f4867898e90dee6b0024acdfabd3b88b49d",
  12: "4e851a0cdc4c6d30a2dd5ab869df48940fbce31628ed0b4ad2fada8681ac4430",
  13: "0f38bf5db867cb8e49821df23d5aee311ee5874528107405638db359a47842ec",
  14: "534276704f73255c21c9c84afd396fa8aa1ce96026fbbf1d17433244741150a0"
});

const SQLITE_MIGRATIONS = Object.freeze(MIGRATION_DEFINITIONS.map((migration) => Object.freeze({
  ...migration,
  fingerprintDependencies: Object.freeze([...(migration.fingerprintDependencies || [])]),
  contentFingerprint: migrationContentFingerprint(migration)
})));
const SQLITE_SCHEMA_HEAD = Math.max(...SQLITE_MIGRATIONS.map((migration) => migration.version));

function validateSqliteMigrationRegistry(migrations = SQLITE_MIGRATIONS) {
  if (!Array.isArray(migrations) || migrations.length === 0) throw new Error("SQLite migration registry is empty");
  const fingerprints = [];
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (Number(migration.version) !== expectedVersion) {
      throw new Error(`SQLite migration registry must be continuous at version ${expectedVersion}`);
    }
    if (!String(migration.name || "").trim()) throw new Error(`SQLite migration ${expectedVersion} name is required`);
    if (migration.owner !== MIGRATION_OWNER) throw new Error(`SQLite migration ${expectedVersion} owner mismatch`);
    const fingerprint = migrationContentFingerprint(migration);
    if (migration.contentFingerprint && migration.contentFingerprint !== fingerprint) {
      throw new Error(`SQLite migration ${expectedVersion} declared content fingerprint mismatch`);
    }
    if (expectedVersion <= FROZEN_LEGACY_MAX_VERSION && FROZEN_LEGACY_FINGERPRINTS[expectedVersion] !== fingerprint) {
      throw new Error(`SQLite migration ${expectedVersion} frozen content fingerprint mismatch`);
    }
    fingerprints.push(`${expectedVersion}:${fingerprint}`);
  });
  if (migrations.length < FROZEN_LEGACY_MAX_VERSION) {
    throw new Error(`SQLite migration registry must retain frozen v1-v${FROZEN_LEGACY_MAX_VERSION}`);
  }
  return Object.freeze({
    head: Number(migrations.at(-1).version),
    registryFingerprint: sha256(fingerprints.join("\n"))
  });
}

function ledgerChecksum(migration) {
  return migration.version <= FROZEN_LEGACY_MAX_VERSION
    ? legacyLedgerChecksum(migration)
    : migrationContentFingerprint(migration);
}

function ensureMigrationLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function validateAppliedLedger(rows, migrations) {
  rows.forEach((row, index) => {
    const version = Number(row.version);
    if (version !== index + 1) throw new Error(`SQLite migration ledger must be a continuous prefix at version ${index + 1}`);
    const migration = migrations[index];
    if (!migration) throw new Error(`SQLite migration ledger version ${version} is newer than this runtime`);
    if (row.name !== migration.name) throw new Error(`SQLite migration ${version} name mismatch`);
    if (row.checksum !== ledgerChecksum(migration)) throw new Error(`SQLite migration ${version} checksum mismatch`);
  });
}

function applySqliteMigrations(db, options = {}) {
  const migrations = options.migrations || SQLITE_MIGRATIONS;
  const registry = validateSqliteMigrationRegistry(migrations);
  const targetVersion = options.targetVersion === undefined ? registry.head : Number(options.targetVersion);
  if (!Number.isInteger(targetVersion) || targetVersion < 0 || targetVersion > registry.head) {
    throw new Error(`SQLite migration target version ${options.targetVersion} is invalid`);
  }

  ensureMigrationLedger(db);
  const rows = db.prepare("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version").all();
  validateAppliedLedger(rows, migrations);
  const appliedHead = rows.length ? Number(rows.at(-1).version) : 0;
  if (appliedHead > targetVersion) throw new Error(`SQLite migration target v${targetVersion} is behind applied v${appliedHead}`);

  let applied = 0;
  for (const migration of migrations) {
    if (migration.version <= appliedHead || migration.version > targetVersion) continue;
    const now = new Date().toISOString();
    try {
      db.exec("BEGIN");
      migration.apply(db);
      db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
        .run(migration.version, migration.name, ledgerChecksum(migration), now);
      db.exec("COMMIT");
      applied += 1;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original migration failure when SQLite already rolled back.
      }
      throw new Error(`SQLite migration ${migration.version} failed: ${error.message}`);
    }
  }

  return Object.freeze({
    head: targetVersion,
    applied,
    registryFingerprint: registry.registryFingerprint
  });
}

function readSqliteSchemaFingerprint(db) {
  const rows = db.prepare(`
    SELECT type, name, tbl_name, COALESCE(sql, '') AS sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
  const canonical = rows.map((row) => ({
    type: row.type,
    name: row.name,
    table: row.tbl_name,
    sql: String(row.sql || "").replace(/\s+/g, " ").trim()
  }));
  return sha256(JSON.stringify(canonical));
}

module.exports = {
  FROZEN_LEGACY_FINGERPRINTS,
  FROZEN_LEGACY_MAX_VERSION,
  SQLITE_MIGRATIONS,
  SQLITE_SCHEMA_HEAD,
  applySqliteMigrations,
  legacyLedgerChecksum,
  migrationContentFingerprint,
  readSqliteSchemaFingerprint,
  validateSqliteMigrationRegistry
};
