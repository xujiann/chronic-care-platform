"use strict";

const { createAccessAcknowledgementCommand } = require("../citizen-chronic/access-acknowledgement-command");
const { queryResidentAccessEvent } = require("../identity-security/resident-access-event-query");

function createResidentAccessAcknowledgementRuntime(ports) {
  const { fs, path, DATA_DIR, DB_FILE, STORAGE_ENGINE, RUNTIME_STORAGE_ENGINES, POSTGRES_SYNC_MODE, shouldUseSqlite, loadSqliteModule, openSqliteDatabase, RUNTIME_INTERNAL_COLLECTION_KEYS, normalizeState, writeSqliteState, createHash, randomUUID, verifyAuditTrail, prependAuditTrailEntry } = ports;
function readAccessAcknowledgementState() {
  if (!shouldUseSqlite()) {
    const source = fs.readFileSync(DB_FILE, "utf8");
    const data = JSON.parse(source);
    data.storageMeta = { collectionVersions: {}, accessAcknowledgementSourceDigest: createHash("sha256").update(source).digest("hex") };
    return data;
  }
  const db = openSqliteDatabase();
  try {
    const rows = db.prepare("SELECT key, payload, version FROM state_collections").all();
    if (!rows.length) throw new Error("access acknowledgement requires an initialized authority");
    const data = {};
    const versions = {};
    for (const row of rows) {
      if (RUNTIME_INTERNAL_COLLECTION_KEYS.has(row.key)) continue;
      data[row.key] = JSON.parse(row.payload);
      versions[row.key] = Number(row.version);
    }
    data.storageMeta = { collectionVersions: versions };
    return data;
  } finally {
    db.close();
  }
}

function writeAccessAcknowledgementState(data) {
  if (shouldUseSqlite()) {
    // Do not turn a committed transaction into an apparent failure through a later preview write.
    const normalized = normalizeState(data);
    const keys = new Set([...Object.keys(data), ...Object.keys(normalized)]);
    for (const key of keys) {
      if (key === "storageMeta") continue;
      if (JSON.stringify(data[key]) !== JSON.stringify(normalized[key])) {
        throw new Error("access acknowledgement cannot repair or normalize authority data");
      }
    }
    return writeSqliteState(data, "resident-access-acknowledgement", data.storageMeta.collectionVersions);
  }
  const source = fs.readFileSync(DB_FILE, "utf8");
  if (createHash("sha256").update(source).digest("hex") !== data.storageMeta.accessAcknowledgementSourceDigest) {
    const error = new Error("access acknowledgement state changed");
    error.code = "STORAGE_CONFLICT";
    throw error;
  }
  const snapshot = { ...data, storageMeta: { engine: "json", collectionVersions: {} } };
  const temporary = path.join(DATA_DIR, `access-acknowledgement-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(snapshot, null, 2), "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, DB_FILE);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

return createAccessAcknowledgementCommand({
    queryResidentAccessEvent,
    readDatabase: readAccessAcknowledgementState,
    writeDatabase: writeAccessAcknowledgementState,
    verifyAuditTrail,
    randomUUID,
    getRuntimePolicy() {
      const environment = String(process.env.NODE_ENV || "").trim().toLowerCase();
      const allowed = ["", "development", "test"].includes(environment)
        && RUNTIME_STORAGE_ENGINES.has(STORAGE_ENGINE) && POSTGRES_SYNC_MODE === "disabled";
      return {
        production: environment === "production",
        storageMode: allowed && !(STORAGE_ENGINE === "sqlite" && !loadSqliteModule()?.DatabaseSync)
          ? (shouldUseSqlite() ? "sqlite" : "json") : "unavailable"
      };
    },
    appendSecurityAudit(data, event) {
      data.securityEvents = prependAuditTrailEntry(data.securityEvents, event);
    }
  });
}

module.exports = { createResidentAccessAcknowledgementRuntime };

