"use strict";

// TEST-027 only. No application module imports this isolated synthetic protocol.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { SQLITE_MIGRATIONS, applySqliteMigrations } = require("../../src/platform/storage/sqlite-migrations");
const { GS03_CALLBACK_RECEIPT_MIGRATION, verifyGs03CallbackReceiptSchema } = require("../../src/platform/storage/gs03-callback-receipt-migration");
const { auditHashFor, verifyAuditTrail } = require("../../src/identity-security/audit-chain");
const { appendAuditDeliverySourceChanges, buildAuditDeliverySourceCandidate } = require("../../src/identity-security/audit-delivery-source");

const SYNTHETIC_PROTOCOL_ID = "gs03-storage-transaction-experiment-v1-not-formal-v2";
const MARKER = "GS03-STORAGE-EXPERIMENT-001";
const APPLICATION_ID = 0x47533345;
const DIRECTORY_PREFIX = "gs03-storage-experiment-";
const FILE_NAME = "experiment.sqlite";
const PURPOSE = "teleconsultation-callback";
const CONTRACTS = Object.freeze({
  feedback: { id: "referral-feedback-callback", fields: ["feedbackText"] },
  schedule: { id: "referral-schedule-callback", fields: ["meetingWindow", "receivingDoctor"] },
  report: { id: "referral-report-callback", fields: ["reportSummary", "externalReportId"] }
});
const COLLECTIONS = Object.freeze(["personalRecords", "referralTeleconsultations", "taskMessages", "securityEvents", "dataAccessLogs", "integrationGatewayEvents"]);
const MIGRATIONS = Object.freeze([...SQLITE_MIGRATIONS, GS03_CALLBACK_RECEIPT_MIGRATION]);
const RECEIPT_COLUMNS = Object.freeze(["receipt_id", "namespace_digest", "contract_id", "contract_version", "key_digest", "target_id", "authorization_id", "intent_digest_version", "intent_digest", "result_status", "recorded_at_ms", "security_stream", "security_audit_event_id", "access_stream", "access_audit_event_id"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fail(`INVALID_${label}`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !Object.hasOwn(descriptors[key], "value"))) throw fail(`INVALID_${label}`);
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function required(value, label, max = 240) {
  if (typeof value !== "string" || !value || value.trim() !== value || Buffer.byteLength(value) > max || /[\u0000-\u001f]/u.test(value)) throw fail(`INVALID_${label}`);
  return value;
}
function milliseconds(value) {
  const number = typeof value === "string" ? Date.parse(value) : value;
  if (!Number.isSafeInteger(number) || number < 0 || number > 8640000000000000) throw fail("INVALID_TIME");
  return number;
}
function nowFrom(clock) { return milliseconds(clock()); }
function iso(value) { return new Date(milliseconds(value)).toISOString(); }
function phase(hook, name, context = {}) {
  if (!hook) return;
  if (typeof hook !== "function") throw fail("INVALID_HOOK");
  const result = hook(name, context);
  if (result && typeof result.then === "function") throw fail("ASYNC_HOOK");
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function oneDrive(location) { return location.split(/[\\/]/u).some((segment) => /^OneDrive(?:\s*-.*)?$/iu.test(segment)); }
function approvedRoot(value) {
  const candidate = path.resolve(value || (process.platform === "win32" ? path.join(os.homedir(), "Temp") : os.tmpdir()));
  if (!fs.existsSync(candidate) || fs.lstatSync(candidate).isSymbolicLink()) throw fail("UNSAFE_TEMP_ROOT");
  const root = fs.realpathSync(candidate);
  if (oneDrive(root) || !fs.statSync(root).isDirectory()) throw fail("UNSAFE_TEMP_ROOT");
  if (process.platform === "win32") {
    const approved = fs.realpathSync(path.join(os.homedir(), "Temp"));
    const projectTmp = path.resolve(__dirname, "../../tmp");
    if (root !== approved && root !== projectTmp) throw fail("UNSAFE_TEMP_ROOT");
  }
  return root;
}
function locationOf(directoryValue, rootValue) {
  const root = approvedRoot(rootValue);
  const directory = path.resolve(required(directoryValue, "DIRECTORY", 4096));
  if (!within(root, directory) || !path.basename(directory).startsWith(DIRECTORY_PREFIX)) throw fail("FOREIGN_FILE");
  if (fs.lstatSync(directory).isSymbolicLink()) throw fail("UNSAFE_LINK");
  const realDirectory = fs.realpathSync(directory);
  if (directory !== realDirectory || !within(root, realDirectory) || !fs.statSync(directory).isDirectory()) throw fail("FOREIGN_FILE");
  const dbPath = path.join(directory, FILE_NAME);
  if (fs.lstatSync(dbPath).isSymbolicLink() || !fs.statSync(dbPath).isFile() || fs.realpathSync(dbPath) !== dbPath) throw fail("FOREIGN_FILE");
  const entries = fs.readdirSync(directory).sort();
  if (entries.some((entry) => ![FILE_NAME, `${FILE_NAME}-wal`, `${FILE_NAME}-shm`].includes(entry))) throw fail("FOREIGN_FILE");
  for (const entry of entries) {
    const stat = fs.lstatSync(path.join(directory, entry));
    if (stat.isSymbolicLink()) throw fail("UNSAFE_LINK");
    if (!stat.isFile()) throw fail("FOREIGN_FILE");
  }
  return { root, directory, dbPath };
}
function schemaObjects(db) {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all()
    .filter((row) => !row.name.startsWith("sqlite_"))
    .map((row) => [row.type, row.name, row.tbl_name, row.sql || ""]);
}
let expected;
function expectedStructure() {
  if (expected) return expected;
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    applySqliteMigrations(db, { migrations: MIGRATIONS });
    verifyGs03CallbackReceiptSchema(db);
    expected = {
      objects: JSON.stringify(schemaObjects(db)),
      ledger: JSON.stringify(db.prepare("SELECT version,name,checksum FROM schema_migrations ORDER BY version").all())
    };
    return expected;
  } finally { db.close(); }
}
function verifyDatabase(db, identity) {
  try {
    if (db.prepare("PRAGMA application_id").get()?.application_id !== APPLICATION_ID || db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) throw fail("FOREIGN_DATABASE");
    // This mode is selected only at creation. Reopening an unknown file never
    // changes its journal mode to make it pass the path allowlist.
    if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "wal") throw fail("JOURNAL_MODE_DRIFT");
    const structure = expectedStructure();
    if (JSON.stringify(schemaObjects(db)) !== structure.objects) throw fail("SCHEMA_DRIFT");
    if (JSON.stringify(db.prepare("SELECT version,name,checksum FROM schema_migrations ORDER BY version").all()) !== structure.ledger) throw fail("LEDGER_DRIFT");
    verifyGs03CallbackReceiptSchema(db);
    const marker = db.prepare("SELECT detail FROM storage_events WHERE id=? AND event=?").get(MARKER, MARKER);
    const detail = marker && JSON.parse(marker.detail);
    if (!detail || detail.identity !== identity || detail.protocol !== SYNTHETIC_PROTOCOL_ID || detail.objectsDigest !== sha(structure.objects)) throw fail("FOREIGN_DATABASE");
  } catch (error) {
    if (["FOREIGN_DATABASE", "SCHEMA_DRIFT", "LEDGER_DRIFT", "JOURNAL_MODE_DRIFT"].includes(error.code)) throw error;
    throw fail("FOREIGN_DATABASE");
  }
}
function openConnection(dbPath, readOnly, busyTimeoutMs = 150) {
  const db = new DatabaseSync(dbPath, { readOnly });
  try {
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(`PRAGMA busy_timeout=${Math.max(0, Math.min(5000, Number(busyTimeoutMs) || 0))}`);
    return db;
  } catch (error) { db.close(); throw error; }
}
function preflightWithoutSourceSidecars(location, identity) {
  // node:sqlite on this runtime has no immutable URI open option. Even its
  // read-only WAL connection may create -shm/-wal beside the supplied file.
  // Verify a disposable copy first; never use that copy for authorization,
  // receipt decisions, or proof that an in-flight writer has completed.
  const scratch = fs.mkdtempSync(path.join(location.root, "gs03-preflight-"));
  const copyPath = path.join(scratch, FILE_NAME);
  try {
    fs.copyFileSync(location.dbPath, copyPath, fs.constants.COPYFILE_EXCL);
    const walPath = `${location.dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      if (fs.lstatSync(walPath).isSymbolicLink() || !fs.statSync(walPath).isFile()) throw fail("UNSAFE_LINK");
      try { fs.copyFileSync(walPath, `${copyPath}-wal`, fs.constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const db = openConnection(copyPath, true);
    try { verifyDatabase(db, identity); } finally { db.close(); }
  } finally {
    if (!within(location.root, scratch) || fs.lstatSync(scratch).isSymbolicLink()) throw fail("UNSAFE_TEMP_ROOT");
    const allowed = new Set([FILE_NAME, `${FILE_NAME}-wal`, `${FILE_NAME}-shm`, `${FILE_NAME}-journal`]);
    const entries = fs.readdirSync(scratch);
    if (entries.some((entry) => !allowed.has(entry) || !fs.lstatSync(path.join(scratch, entry)).isFile())) throw fail("UNSAFE_TEMP_ROOT");
    for (const entry of entries) fs.unlinkSync(path.join(scratch, entry));
    fs.rmdirSync(scratch);
  }
}
function fileIdentity(dbPath) {
  const stat = fs.statSync(dbPath);
  return `${stat.dev}:${stat.ino}`;
}
function collection(db, key) {
  const row = db.prepare("SELECT payload,version FROM state_collections WHERE key=?").get(key);
  if (!row) return { rows: [], version: 0 };
  let rows;
  try { rows = JSON.parse(row.payload); } catch { throw fail("COLLECTION_CORRUPT"); }
  if (!Array.isArray(rows)) throw fail("COLLECTION_CORRUPT");
  return { rows, version: row.version };
}
function putCollection(db, key, rows, at) {
  if (!COLLECTIONS.includes(key) || !Array.isArray(rows)) throw fail("INVALID_COLLECTION");
  const old = collection(db, key);
  if (old.version === 0) db.prepare("INSERT INTO state_collections(key,payload,updated_at,version) VALUES(?,?,?,1)").run(key, JSON.stringify(rows), at);
  else {
    const result = db.prepare("UPDATE state_collections SET payload=?,updated_at=?,version=version+1 WHERE key=? AND version=?").run(JSON.stringify(rows), at, key, old.version);
    if (result.changes !== 1) throw fail("COLLECTION_VERSION_CONFLICT");
  }
}
function commandOf(value) {
  const input = plain(value, "COMMAND");
  const contract = CONTRACTS[input.contract];
  if (!contract || input.version !== 2) throw fail("UNSUPPORTED_CONTRACT");
  const principal = plain(input.principal, "PRINCIPAL");
  const id = required(principal.id, "PRINCIPAL");
  const role = required(principal.role, "ROLE");
  if (!["institution", "county", "commission"].includes(role)) throw fail("INVALID_ROLE");
  const institutionId = required(principal.institutionId, "INSTITUTION");
  const key = required(input.key, "KEY");
  const targetId = required(input.targetId, "TARGET");
  const authorizationId = required(input.authorizationId, "AUTHORIZATION");
  const intent = plain(input.intent, "INTENT");
  if (Object.keys(intent).sort().join(",") !== [...contract.fields].sort().join(",")) throw fail("INVALID_INTENT");
  for (const field of contract.fields) required(intent[field], field.toUpperCase(), 1000);
  return {
    contract: input.contract, contractId: contract.id, principal: { id, role, institutionId }, key,
    targetId, authorizationId, intent,
    namespaceDigest: sha(JSON.stringify([SYNTHETIC_PROTOCOL_ID, "namespace", id, role, institutionId])),
    keyDigest: sha(JSON.stringify([SYNTHETIC_PROTOCOL_ID, "key", key])),
    intentDigest: sha(JSON.stringify([SYNTHETIC_PROTOCOL_ID, "intent", contract.id, 2, targetId, authorizationId, contract.fields.map((field) => intent[field])]))
  };
}
function authorization(db, command, time) {
  const cases = collection(db, "referralTeleconsultations").rows;
  const item = cases.find((row) => row.id === command.targetId);
  const records = collection(db, "personalRecords").rows;
  const auth = records.find((row) => row.id === command.authorizationId && row.kind === "synthetic-authorization");
  if (!item || !auth || item.residentAuthorizationId !== command.authorizationId || item.residentId !== auth.residentId
    || item.targetInstitutionCode !== auth.targetInstitutionCode || item.status !== "active"
    || !Array.isArray(item.allowedPrincipalIds) || !item.allowedPrincipalIds.includes(command.principal.id)
    || (command.principal.role === "institution" && command.principal.institutionId !== item.targetInstitutionCode)
    || auth.status !== "active" || auth.purpose !== PURPOSE || milliseconds(auth.expiresAt) <= time) throw fail("AUTHORIZATION_REJECTED");
  return item;
}
function receiptFor(db, command) {
  return db.prepare("SELECT * FROM gs03_callback_receipts WHERE namespace_digest=? AND contract_id=? AND contract_version=2 AND key_digest=?")
    .get(command.namespaceDigest, command.contractId, command.keyDigest);
}
function matchReceipt(row, command) {
  if (row.target_id !== command.targetId || row.authorization_id !== command.authorizationId || row.intent_digest !== command.intentDigest) throw fail("RECEIPT_CONFLICT");
}
function projectReceipt(row) {
  const contract = Object.entries(CONTRACTS).find(([, definition]) => definition.id === row.contract_id)?.[0];
  if (!contract) throw fail("FOREIGN_RECEIPT");
  return { receiptId: row.receipt_id, contract, targetId: row.target_id, authorizationId: row.authorization_id };
}
function appendAudit(rows, value) {
  if (rows.length >= 120) throw fail("AUDIT_CAPACITY_EXCEEDED");
  if (!verifyAuditTrail(rows).passed) throw fail("AUDIT_CHAIN_INVALID");
  const event = { ...value, previousAuditHash: rows[0]?.auditHash || "" };
  event.auditHash = auditHashFor(event);
  const next = [event, ...rows];
  if (!verifyAuditTrail(next).passed) throw fail("AUDIT_CHAIN_INVALID");
  return next;
}
function assertCurrentAuditRef(db, stream, eventId, event, command, receiptId) {
  if (eventId !== event.id || event.actor !== command.principal.id
    || event.receiptId !== receiptId || event.contractId !== command.contractId
    || event.result !== "allowed" || (stream === "securityEvents" ? event.target : event.scope) !== command.targetId) throw fail("AUDIT_REFERENCE_MISMATCH");
  const candidate = buildAuditDeliverySourceCandidate(stream, event);
  const source = db.prepare("SELECT * FROM audit_delivery_source_events WHERE stream=? AND source_event_id=?").get(stream, eventId);
  if (!source || source.source_digest !== candidate.sourceDigest || source.projection_digest !== candidate.projectionDigest
    || source.projection_json !== candidate.projectionJson || source.historical_baseline !== 0) throw fail("AUDIT_REFERENCE_MISMATCH");
}
function transaction(db, hook, work, preCommit = null) {
  let began = false;
  let committed = false;
  let commitAttempted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    began = true;
    phase(hook, "afterBegin");
    const result = work();
    phase(hook, "beforeCommit");
    if (preCommit) preCommit();
    commitAttempted = true;
    db.exec("COMMIT");
    began = false;
    committed = true;
    phase(hook, "afterCommit");
    return result;
  } catch (error) {
    if (committed) { error.outcome = "ack-lost"; throw error; }
    if (began) {
      try { db.exec("ROLLBACK"); error.outcome = commitAttempted ? "unknown" : "rolledback"; }
      catch { error.outcome = "unknown"; }
    } else error.outcome = "unknown";
    throw error;
  }
}
function instance(location, identity, options = {}) {
  const clock = options.clock || Date.now;
  if (typeof clock !== "function") throw fail("INVALID_CLOCK");
  const originalFileIdentity = fileIdentity(location.dbPath);
  let db = openConnection(location.dbPath, false, options.busyTimeoutMs);
  if (fileIdentity(location.dbPath) !== originalFileIdentity) { db.close(); throw fail("FOREIGN_FILE"); }
  verifyDatabase(db, identity);
  const defaultHook = options.onPhase;
  function ensure() {
    if (!db) throw fail("CLOSED");
    locationOf(location.directory, location.root);
    if (fileIdentity(location.dbPath) !== originalFileIdentity) throw fail("FOREIGN_FILE");
    verifyDatabase(db, identity);
  }
  return Object.freeze({
    directory: location.directory,
    dbPath: location.dbPath,
    identity,
    seed(value) {
      ensure();
      const input = plain(value, "SEED");
      const authorizations = Array.isArray(input.authorizations) ? input.authorizations.map((row) => {
        const item = plain(row, "AUTHORIZATION");
        return { kind: "synthetic-authorization", id: required(item.id, "AUTHORIZATION"), residentId: required(item.residentId, "RESIDENT"), targetInstitutionCode: required(item.targetInstitutionCode || item.institutionId, "INSTITUTION"), status: item.status || "active", purpose: item.purpose || PURPOSE, expiresAt: iso(item.expiresAt) };
      }) : [];
      const cases = Array.isArray(input.cases) ? input.cases.map((row) => {
        const item = plain(row, "CASE");
        if (!Array.isArray(item.allowedPrincipalIds)) throw fail("INVALID_SCOPE");
        return { id: required(item.id, "TARGET"), residentId: required(item.residentId, "RESIDENT"), residentAuthorizationId: required(item.residentAuthorizationId || item.authorizationId, "AUTHORIZATION"), targetInstitutionCode: required(item.targetInstitutionCode || item.targetInstitutionId, "INSTITUTION"), status: item.status || "active", allowedPrincipalIds: item.allowedPrincipalIds.map((id) => required(id, "PRINCIPAL")), version: 0 };
      }) : [];
      const at = iso(nowFrom(clock));
      return transaction(db, defaultHook, () => {
        if (COLLECTIONS.some((key) => collection(db, key).version !== 0)) throw fail("ALREADY_SEEDED");
        putCollection(db, "personalRecords", authorizations, at);
        putCollection(db, "referralTeleconsultations", cases, at);
        for (const key of COLLECTIONS.slice(2)) putCollection(db, key, [], at);
        return { seeded: true };
      });
    },
    seedUnrelatedSuccessAudit(value = {}) {
      ensure();
      const input = plain(value, "UNRELATED_AUDIT");
      const actor = required(input.actor || "unrelated-synthetic-principal", "ACTOR");
      const targetId = required(input.targetId || "unrelated-synthetic-target", "TARGET");
      const receiptId = required(input.receiptId || `unrelated:${randomUUID()}`, "RECEIPT");
      const contractId = "referral-feedback-callback";
      return transaction(db, null, () => {
        const at = iso(nowFrom(clock));
        const priorSecurity = collection(db, "securityEvents").rows;
        const priorAccess = collection(db, "dataAccessLogs").rows;
        const securityEventId = `unrelated-security:${randomUUID()}`;
        const accessEventId = `unrelated-access:${randomUUID()}`;
        const nextSecurity = appendAudit(priorSecurity, { id: securityEventId, at, action: contractId, result: "allowed", role: "institution", actor, target: targetId, receiptId, contractId });
        const nextAccess = appendAudit(priorAccess, { id: accessEventId, at, action: "data-access", result: "allowed", role: "institution", actor, scope: targetId, residentId: "unrelated-synthetic-resident", receiptId, contractId });
        putCollection(db, "securityEvents", nextSecurity, at);
        putCollection(db, "dataAccessLogs", nextAccess, at);
        appendAuditDeliverySourceChanges(db, { securityEvents: priorSecurity, dataAccessLogs: priorAccess }, { securityEvents: nextSecurity, dataAccessLogs: nextAccess }, { recordedAt: at });
        return { securityAuditEventId: securityEventId, accessAuditEventId: accessEventId };
      });
    },
    applyCallback(value, optionsForCall = {}) {
      ensure();
      const command = commandOf(value);
      const opts = plain(optionsForCall, "OPTIONS");
      const hook = opts.onPhase || defaultHook;
      return transaction(db, hook, () => {
        const item = authorization(db, command, nowFrom(clock));
        phase(hook, "afterAuthorization");
        const prior = receiptFor(db, command);
        if (prior) {
          matchReceipt(prior, command);
          authorization(db, command, nowFrom(clock));
          return { state: "confirmed", outcome: "replay", receipt: projectReceipt(prior) };
        }
        const receiptId = `gs03-${randomUUID()}`;
        const atMs = nowFrom(clock);
        const at = iso(atMs);
        const cases = collection(db, "referralTeleconsultations").rows;
        const target = cases.find((row) => row.id === item.id);
        target.version = Number(target.version || 0) + 1;
        Object.assign(target, command.intent);
        putCollection(db, "referralTeleconsultations", cases, at);
        phase(hook, "afterBusiness", { receiptId });
        if (command.contract === "report") {
          const records = collection(db, "personalRecords").rows;
          if (records.length >= 500) throw fail("COLLECTION_CAPACITY_EXCEEDED");
          records.push({ id: `report:${receiptId}`, residentId: item.residentId, caseId: item.id, targetId: item.id, authorizationId: command.authorizationId, externalReportId: command.intent.externalReportId, summary: command.intent.reportSummary, receiptId });
          putCollection(db, "personalRecords", records, at);
          phase(hook, "afterReport", { receiptId });
        }
        const messages = collection(db, "taskMessages").rows;
        if (messages.length > 298) throw fail("COLLECTION_CAPACITY_EXCEEDED");
        for (const [index, targetRole] of ["requester", "receiver"].entries()) {
          messages.push({ id: `message:${receiptId}:${index + 1}`, receiptId, contractId: command.contractId, targetId: command.targetId, targetRole, status: "queued" });
          putCollection(db, "taskMessages", messages, at);
          phase(hook, `afterMessage${index + 1}`, { receiptId });
        }
        const previousSecurity = collection(db, "securityEvents").rows;
        const previousAccess = collection(db, "dataAccessLogs").rows;
        const securityEvent = { id: `security:${receiptId}`, at, action: command.contractId, result: "allowed", role: command.principal.role, actor: command.principal.id, target: command.targetId, receiptId, contractId: command.contractId };
        const accessEvent = { id: `access:${receiptId}`, at, action: "data-access", result: "allowed", role: command.principal.role, actor: command.principal.id, scope: command.targetId, residentId: item.residentId, receiptId, contractId: command.contractId };
        const nextSecurity = appendAudit(previousSecurity, securityEvent);
        putCollection(db, "securityEvents", nextSecurity, at);
        phase(hook, "afterSecurityAudit", { receiptId });
        const nextAccess = appendAudit(previousAccess, accessEvent);
        putCollection(db, "dataAccessLogs", nextAccess, at);
        phase(hook, "afterAccessAudit", { receiptId });
        appendAuditDeliverySourceChanges(db, { securityEvents: previousSecurity, dataAccessLogs: previousAccess }, { securityEvents: nextSecurity, dataAccessLogs: previousAccess }, { recordedAt: at });
        phase(hook, "afterSecuritySource", { receiptId });
        appendAuditDeliverySourceChanges(db, { securityEvents: nextSecurity, dataAccessLogs: previousAccess }, { securityEvents: nextSecurity, dataAccessLogs: nextAccess }, { recordedAt: at });
        phase(hook, "afterAccessSource", { receiptId });
        authorization(db, command, nowFrom(clock));
        phase(hook, "beforeReceipt", { receiptId });
        const override = opts.testOnlyAuditRefOverride ? plain(opts.testOnlyAuditRefOverride, "AUDIT_OVERRIDE") : {};
        const securityId = override.securityAuditEventId || securityEvent.id;
        const accessId = override.accessAuditEventId || accessEvent.id;
        assertCurrentAuditRef(db, "securityEvents", securityId, nextSecurity[0], command, receiptId);
        assertCurrentAuditRef(db, "dataAccessLogs", accessId, nextAccess[0], command, receiptId);
        const row = {
          receipt_id: receiptId, namespace_digest: command.namespaceDigest, contract_id: command.contractId, contract_version: 2,
          key_digest: command.keyDigest, target_id: command.targetId, authorization_id: command.authorizationId,
          intent_digest_version: 2, intent_digest: command.intentDigest, result_status: "committed", recorded_at_ms: atMs,
          security_stream: "securityEvents", security_audit_event_id: securityId, access_stream: "dataAccessLogs", access_audit_event_id: accessId
        };
        db.prepare(`INSERT INTO gs03_callback_receipts(${RECEIPT_COLUMNS.join(",")}) VALUES(${RECEIPT_COLUMNS.map(() => "?").join(",")})`).run(...RECEIPT_COLUMNS.map((name) => row[name]));
        phase(hook, "afterReceipt", { receiptId });
        return { state: "confirmed", outcome: "first", receipt: projectReceipt(row) };
      }, () => authorization(db, command, nowFrom(clock)));
    },
    revokeAuthorization(value, optionsForCall = {}) {
      ensure();
      const input = typeof value === "string" ? { authorizationId: value } : plain(value, "REVOKE");
      const authorizationId = required(input.authorizationId, "AUTHORIZATION");
      const hook = optionsForCall.onPhase || defaultHook;
      return transaction(db, hook, () => {
        const records = collection(db, "personalRecords").rows;
        const auth = records.find((row) => row.id === authorizationId && row.kind === "synthetic-authorization");
        if (!auth) throw fail("AUTHORIZATION_REJECTED");
        auth.status = "revoked";
        auth.revokedAt = iso(nowFrom(clock));
        putCollection(db, "personalRecords", records, auth.revokedAt);
        phase(hook, "afterAuthorization");
        return { state: "revoked", authorizationId };
      });
    },
    reconcile(value, optionsForCall = {}) {
      ensure();
      const command = commandOf(value);
      const opts = plain(optionsForCall, "OPTIONS");
      const location = locationOf(this.directory, path.dirname(this.directory));
      let fresh;
      try {
        fresh = openConnection(location.dbPath, false, opts.busyTimeoutMs ?? 75);
        verifyDatabase(fresh, identity);
        fresh.exec("BEGIN IMMEDIATE");
      } catch (error) {
        if (fresh) fresh.close();
        const sqliteNumber = Number(error.sqliteCode ?? error.errno);
        if (sqliteNumber === 5 || sqliteNumber === 6
          || /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database is busy/i.test(`${error.code || ""} ${error.message || ""}`)) return { state: "unknown" };
        throw error;
      }
      try {
        authorization(fresh, command, nowFrom(clock));
        const row = receiptFor(fresh, command);
        if (row) matchReceipt(row, command);
        fresh.exec("COMMIT");
        return row ? { state: "confirmed", outcome: "replay", receipt: projectReceipt(row) } : { state: "not-found" };
      } catch (error) {
        try { fresh.exec("ROLLBACK"); } catch { /* preserve original */ }
        throw error;
      } finally { fresh.close(); }
    },
    snapshot() {
      ensure();
      const collections = Object.fromEntries(COLLECTIONS.map((key) => [key, collection(db, key).rows]));
      return {
        collections,
        collectionVersions: Object.fromEntries(COLLECTIONS.map((key) => [key, collection(db, key).version])),
        receipts: db.prepare("SELECT * FROM gs03_callback_receipts ORDER BY receipt_id").all(),
        sourceEvents: db.prepare("SELECT * FROM audit_delivery_source_events ORDER BY sequence").all()
      };
    },
    close() { if (db) { db.close(); db = null; } },
    cleanup() {
      if (db) { db.close(); db = null; }
      const checked = locationOf(location.directory, location.root);
      if (fileIdentity(checked.dbPath) !== originalFileIdentity) throw fail("FOREIGN_FILE");
      const checkDb = openConnection(checked.dbPath, true);
      try { verifyDatabase(checkDb, identity); } finally { checkDb.close(); }
      // Only this identity's exact disposable directory, after path and DB re-verification.
      fs.rmSync(checked.directory, { recursive: true, force: false });
    }
  });
}
function createExperiment(options = {}) {
  const root = approvedRoot(options.tempRoot);
  const directory = fs.mkdtempSync(path.join(root, DIRECTORY_PREFIX));
  const dbPath = path.join(directory, FILE_NAME);
  const identity = randomUUID();
  const descriptor = fs.openSync(dbPath, "wx", 0o600);
  fs.closeSync(descriptor);
  const db = openConnection(dbPath, false);
  try {
    if (db.prepare("PRAGMA journal_mode=WAL").get()?.journal_mode !== "wal") throw fail("JOURNAL_MODE_DRIFT");
    applySqliteMigrations(db, { migrations: MIGRATIONS });
    verifyGs03CallbackReceiptSchema(db);
    db.exec(`PRAGMA application_id=${APPLICATION_ID}`);
    const at = new Date().toISOString();
    db.prepare("INSERT INTO storage_events(id,at,event,detail) VALUES(?,?,?,?)")
      .run(MARKER, at, MARKER, JSON.stringify({ identity, protocol: SYNTHETIC_PROTOCOL_ID, objectsDigest: sha(expectedStructure().objects) }));
    if (db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()?.busy !== 0) throw fail("INITIAL_CHECKPOINT_BUSY");
  } finally { db.close(); }
  return instance({ root, directory, dbPath }, identity, options);
}
function openExperiment(options = {}) {
  const input = plain(options, "OPEN");
  const identity = required(input.identity, "IDENTITY");
  const location = locationOf(input.directory, input.tempRoot);
  const originalFileIdentity = fileIdentity(location.dbPath);
  preflightWithoutSourceSidecars(location, identity);
  if (fileIdentity(location.dbPath) !== originalFileIdentity) throw fail("FOREIGN_FILE");
  return instance(location, identity, input);
}

module.exports = { SYNTHETIC_PROTOCOL_ID, PURPOSE, createExperiment, openExperiment };
