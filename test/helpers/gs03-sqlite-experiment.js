'use strict';

// TEST-026 only: a disposable SQLite model, never imported by application runtime.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const MARKER = 'GS03-SQLITE-EXPERIMENT-001';
const APPLICATION_ID = 0x47533033;
const PURPOSE = 'teleconsultation-callback';
const VERSION = 2;
const DIRECTORY_PREFIX = 'gs03-sqlite-experiment-';
const FILE_NAME = 'experiment.sqlite';
const TABLES = ['authorizations', 'cases', 'receipts', 'events', 'reports', 'messages', 'audit', 'audit_source'];
const INTENT_FIELDS = {
  feedback: ['feedbackText'],
  schedule: ['meetingWindow', 'receivingDoctor'],
  report: ['reportSummary', 'externalReportId']
};

const SCHEMA_SQL = [
  'CREATE TABLE experiment_metadata (marker TEXT PRIMARY KEY, identity TEXT NOT NULL, fingerprint TEXT NOT NULL, seeded INTEGER NOT NULL CHECK(seeded IN (0,1))) STRICT;',
  'CREATE TABLE authorizations (id TEXT PRIMARY KEY, resident_id TEXT NOT NULL, status TEXT NOT NULL, purpose TEXT NOT NULL, institution_id TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT) STRICT;',
  'CREATE TABLE cases (id TEXT PRIMARY KEY, resident_id TEXT NOT NULL, authorization_id TEXT NOT NULL, target_institution_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, allowed_principal_ids TEXT NOT NULL, feedback_text TEXT, meeting_window TEXT, receiving_doctor TEXT, report_summary TEXT, external_report_id TEXT) STRICT;',
  'CREATE TABLE receipts (id TEXT PRIMARY KEY, namespace TEXT NOT NULL, contract TEXT NOT NULL, version INTEGER NOT NULL, idempotency_key TEXT NOT NULL, target_id TEXT NOT NULL, authorization_id TEXT NOT NULL, intent_digest TEXT NOT NULL, audit_ref TEXT NOT NULL, committed_at TEXT NOT NULL, UNIQUE(namespace,contract,version,idempotency_key)) STRICT;',
  'CREATE TABLE events (id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL UNIQUE REFERENCES receipts(id), target_id TEXT NOT NULL, contract TEXT NOT NULL, principal_id TEXT NOT NULL, intent_digest TEXT NOT NULL) STRICT;',
  'CREATE TABLE reports (id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL UNIQUE REFERENCES receipts(id), target_id TEXT NOT NULL, external_report_id TEXT NOT NULL, report_summary TEXT NOT NULL) STRICT;',
  'CREATE TABLE messages (id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES receipts(id), target_id TEXT NOT NULL, target_role TEXT NOT NULL, notification_key TEXT NOT NULL UNIQUE) STRICT;',
  'CREATE TABLE audit (id TEXT PRIMARY KEY, receipt_id TEXT, kind TEXT NOT NULL, target_id TEXT NOT NULL, actor_id TEXT NOT NULL, at TEXT NOT NULL) STRICT;',
  'CREATE TABLE audit_source (id TEXT PRIMARY KEY, audit_id TEXT NOT NULL UNIQUE REFERENCES audit(id), previous_hash TEXT NOT NULL, source_hash TEXT NOT NULL) STRICT;',
  "CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;",
  "CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;",
  "CREATE TRIGGER audit_source_no_update BEFORE UPDATE ON audit_source BEGIN SELECT RAISE(ABORT,'immutable audit source'); END;",
  "CREATE TRIGGER audit_source_no_delete BEFORE DELETE ON audit_source BEGIN SELECT RAISE(ABORT,'immutable audit source'); END;"
].join('\n');

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(code) {
  const error = new Error(code);
  error.code = 'GS03_EXPERIMENT_' + code;
  return error;
}

function required(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f]/u.test(value)) {
    throw fail('INVALID_' + field.toUpperCase());
  }
  return value;
}

function iso(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw fail('INVALID_TIME');
  }
  return value;
}

function controlledNow(clock) {
  return iso(clock());
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function tempRoot() {
  const root = fs.realpathSync(os.tmpdir());
  if (root.split(/[\\/]/u).some((segment) => /^OneDrive(?:\s*-.*)?$/iu.test(segment))) {
    throw fail('UNSAFE_TEMP_ROOT');
  }
  return root;
}

function verifyLocation(dbPath) {
  const root = tempRoot();
  const file = path.resolve(dbPath);
  const directory = path.dirname(file);
  if (path.basename(file) !== FILE_NAME || !path.basename(directory).startsWith(DIRECTORY_PREFIX)) {
    throw fail('FOREIGN_FILE');
  }
  if (fs.lstatSync(directory).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) throw fail('UNSAFE_LINK');
  const realDirectory = fs.realpathSync(directory);
  const realFile = fs.realpathSync(file);
  if (!within(root, realDirectory) || path.dirname(realFile) !== realDirectory || !within(root, realFile)) {
    throw fail('FOREIGN_FILE');
  }
  if (!fs.statSync(realFile).isFile()) throw fail('FOREIGN_FILE');
  return { directory: realDirectory, dbPath: realFile };
}

function schemaFingerprint(db) {
  const rows = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  return sha(JSON.stringify(rows));
}

let expectedFingerprint;
function expectedSchemaFingerprint() {
  if (!expectedFingerprint) {
    const memory = new DatabaseSync(':memory:');
    try {
      memory.exec(SCHEMA_SQL);
      expectedFingerprint = schemaFingerprint(memory);
    } finally {
      memory.close();
    }
  }
  return expectedFingerprint;
}

function verifyDatabase(db, identity) {
  try {
    if (Number(db.prepare('PRAGMA application_id').get().application_id) !== APPLICATION_ID
      || Number(db.prepare('PRAGMA user_version').get().user_version) !== 1) throw fail('FOREIGN_DATABASE');
    const row = db.prepare('SELECT * FROM experiment_metadata WHERE marker=?').get(MARKER);
    const expected = expectedSchemaFingerprint();
    if (!row || row.identity !== identity || row.fingerprint !== expected || schemaFingerprint(db) !== expected) {
      throw fail('FOREIGN_DATABASE');
    }
  } catch (error) {
    if (error.code?.startsWith('GS03_EXPERIMENT_')) throw error;
    throw fail('FOREIGN_DATABASE');
  }
}

function dataObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw fail('INVALID_' + name);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value'))) {
    throw fail('INVALID_' + name);
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function validateCommand(command) {
  const valuesByKey = dataObject(command, 'COMMAND');
  const contract = valuesByKey.contract;
  if (!Object.hasOwn(INTENT_FIELDS, contract) || valuesByKey.version !== VERSION) throw fail('UNSUPPORTED_CONTRACT');
  const principal = dataObject(valuesByKey.principal, 'PRINCIPAL');
  const principalId = required(principal.id, 'principal');
  const role = required(principal.role, 'role');
  const institutionId = required(principal.institutionId, 'institution');
  if (!['institution', 'county', 'commission'].includes(role)) throw fail('INVALID_ROLE');
  const key = required(valuesByKey.key, 'key');
  const targetId = required(valuesByKey.targetId, 'target');
  const authorizationId = required(valuesByKey.authorizationId, 'authorization');
  const intentData = dataObject(valuesByKey.intent, 'INTENT');
  if (Object.keys(intentData).sort().join(',') !== [...INTENT_FIELDS[contract]].sort().join(',')) {
    throw fail('INVALID_INTENT');
  }
  const values = INTENT_FIELDS[contract].map((field) => required(intentData[field], field));
  const intent = Object.fromEntries(INTENT_FIELDS[contract].map((field, index) => [field, values[index]]));
  // Test-only trusted-principal namespace; changing role or institution changes
  // the key space. This is not a provider identity or an approved v2 mapping.
  const namespace = sha(JSON.stringify([principalId, role, institutionId]));
  const intentDigest = sha(JSON.stringify(['gs03-intent-v1', contract, VERSION, targetId, authorizationId, ...values]));
  return { contract, version: VERSION, principalId, role, institutionId, namespace, key, targetId, authorizationId, intent, intentDigest };
}

function authorize(db, command, now) {
  const item = db.prepare('SELECT * FROM cases WHERE id=?').get(command.targetId);
  if (!item) throw fail('TARGET_NOT_FOUND');
  if (item.authorization_id !== command.authorizationId || item.status === 'authorization-on-hold') {
    throw fail('AUTHORIZATION_DENIED');
  }
  let allowed;
  try { allowed = JSON.parse(item.allowed_principal_ids); } catch { throw fail('INVALID_SCOPE'); }
  if (!Array.isArray(allowed) || !allowed.includes(command.principalId)) throw fail('SCOPE_DENIED');
  if (command.role === 'institution' && command.institutionId !== item.target_institution_id) throw fail('SCOPE_DENIED');
  const auth = db.prepare('SELECT * FROM authorizations WHERE id=?').get(command.authorizationId);
  if (!auth || auth.resident_id !== item.resident_id || auth.institution_id !== item.target_institution_id
    || auth.purpose !== PURPOSE || auth.status !== 'active'
    || !Number.isFinite(Date.parse(auth.expires_at)) || Date.parse(auth.expires_at) <= Date.parse(now)) {
    throw fail('AUTHORIZATION_DENIED');
  }
  return item;
}

function receiptFor(db, command) {
  return db.prepare('SELECT * FROM receipts WHERE namespace=? AND contract=? AND version=? AND idempotency_key=?')
    .get(command.namespace, command.contract, command.version, command.key);
}

function matchReceipt(receipt, command) {
  if (receipt.target_id !== command.targetId || receipt.authorization_id !== command.authorizationId
    || receipt.intent_digest !== command.intentDigest) throw fail('RECEIPT_CONFLICT');
}

function projectReceipt(row) {
  return {
    id: row.id,
    contract: row.contract,
    version: row.version,
    targetId: row.target_id,
    authorizationId: row.authorization_id,
    intentDigest: row.intent_digest,
    committedAt: row.committed_at
  };
}

function phase(onPhase, name) {
  if (onPhase) {
    if (typeof onPhase !== 'function') throw fail('INVALID_HOOK');
    const result = onPhase(name);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw fail('ASYNC_HOOK');
    }
  }
}

function mark(error, state) {
  error.transactionState = state;
  if (!error.code) error.code = 'GS03_EXPERIMENT_TRANSACTION_' + state.toUpperCase();
  return error;
}

function transaction(db, onPhase, work, preCommit = null) {
  db.exec('BEGIN IMMEDIATE');
  let committed = false;
  try {
    phase(onPhase, 'afterBegin');
    const result = work();
    phase(onPhase, 'beforeCommit');
    if (preCommit) preCommit();
    db.exec('COMMIT');
    committed = true;
    phase(onPhase, 'afterCommit');
    return result;
  } catch (error) {
    if (committed) throw mark(error, 'acklost');
    let rolledBack = false;
    try { db.exec('ROLLBACK'); rolledBack = true; } catch {}
    throw mark(error, rolledBack ? 'rolledback' : 'unknown');
  }
}

function auditRow(db, id, receiptId, kind, targetId, actorId, at) {
  db.prepare('INSERT INTO audit(id,receipt_id,kind,target_id,actor_id,at) VALUES(?,?,?,?,?,?)')
    .run(id, receiptId, kind, targetId, actorId, at);
  const previous = db.prepare('SELECT source_hash FROM audit_source ORDER BY rowid DESC LIMIT 1').get()?.source_hash || 'GENESIS';
  const sourceHash = sha(JSON.stringify([previous, id, receiptId, kind, targetId, actorId, at]));
  db.prepare('INSERT INTO audit_source(id,audit_id,previous_hash,source_hash) VALUES(?,?,?,?)')
    .run('source-' + id, id, previous, sourceHash);
}

function makeStore(db, location, identity, clock, ownsDirectory) {
  let closed = false;
  const assertOpen = () => { if (closed) throw fail('CLOSED'); };
  const store = {
    directory: location.directory,
    dbPath: location.dbPath,
    identity,
    seed({ authorizations, cases }) {
      assertOpen();
      if (!Array.isArray(authorizations) || !Array.isArray(cases) || !authorizations.length || !cases.length) {
        throw fail('INVALID_SEED');
      }
      return transaction(db, null, () => {
        const marker = db.prepare('SELECT seeded FROM experiment_metadata WHERE marker=?').get(MARKER);
        if (marker.seeded) throw fail('ALREADY_SEEDED');
        for (const auth of authorizations) {
          db.prepare('INSERT INTO authorizations(id,resident_id,status,purpose,institution_id,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)')
            .run(required(auth.id, 'authorization'), required(auth.residentId, 'resident'), required(auth.status, 'status'),
              required(auth.purpose, 'purpose'), required(auth.institutionId, 'institution'), iso(auth.expiresAt));
        }
        for (const item of cases) {
          if (!Array.isArray(item.allowedPrincipalIds) || !item.allowedPrincipalIds.length
            || item.allowedPrincipalIds.some((id) => typeof id !== 'string' || !id.trim())) throw fail('INVALID_SCOPE');
          db.prepare('INSERT INTO cases(id,resident_id,authorization_id,target_institution_id,status,version,allowed_principal_ids) VALUES(?,?,?,?,?,0,?)')
            .run(required(item.id, 'target'), required(item.residentId, 'resident'),
              required(item.authorizationId, 'authorization'), required(item.targetInstitutionId, 'institution'),
              required(item.status, 'status'), JSON.stringify([...new Set(item.allowedPrincipalIds)]));
        }
        db.prepare('UPDATE experiment_metadata SET seeded=1 WHERE marker=?').run(MARKER);
        return { state: 'confirmed' };
      });
    },
    applyCallback(input, { onPhase } = {}) {
      assertOpen();
      const command = validateCommand(input);
      const result = transaction(db, onPhase, () => {
        const now = controlledNow(clock);
        const item = authorize(db, command, now);
        phase(onPhase, 'afterAuthorization');
        const existing = receiptFor(db, command);
        if (existing) {
          matchReceipt(existing, command);
          return { state: 'confirmed', outcome: 'replay', receipt: projectReceipt(existing) };
        }
        const receiptId = 'receipt-' + randomUUID();
        const securityAuditId = 'audit-' + randomUUID();
        const status = { feedback: 'feedback-received', schedule: 'scheduled', report: 'report-returned' }[command.contract];
        const fields = {
          feedback: ['feedback_text', command.intent.feedbackText],
          schedule: ['meeting_window', command.intent.meetingWindow],
          report: ['report_summary', command.intent.reportSummary]
        }[command.contract];
        db.prepare('UPDATE cases SET status=?,version=version+1,' + fields[0] + '=? WHERE id=?')
          .run(status, fields[1], item.id);
        if (command.contract === 'schedule') {
          db.prepare('UPDATE cases SET receiving_doctor=? WHERE id=?').run(command.intent.receivingDoctor, item.id);
        }
        if (command.contract === 'report') {
          db.prepare('UPDATE cases SET external_report_id=? WHERE id=?').run(command.intent.externalReportId, item.id);
        }
        phase(onPhase, 'after:business');
        // The receipt is inserted before dependent facts, but all remain invisible until COMMIT.
        db.prepare('INSERT INTO receipts(id,namespace,contract,version,idempotency_key,target_id,authorization_id,intent_digest,audit_ref,committed_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(receiptId, command.namespace, command.contract, command.version, command.key, command.targetId,
            command.authorizationId, command.intentDigest, securityAuditId, now);
        phase(onPhase, 'after:receipt');
        db.prepare('INSERT INTO events(id,receipt_id,target_id,contract,principal_id,intent_digest) VALUES(?,?,?,?,?,?)')
          .run('event-' + receiptId, receiptId, item.id, command.contract, command.principalId, command.intentDigest);
        phase(onPhase, 'after:event');
        if (command.contract === 'report') {
          db.prepare('INSERT INTO reports(id,receipt_id,target_id,external_report_id,report_summary) VALUES(?,?,?,?,?)')
            .run('report-' + receiptId, receiptId, item.id, command.intent.externalReportId, command.intent.reportSummary);
          phase(onPhase, 'after:report');
        }
        for (const [index, role] of ['institution', 'citizen'].entries()) {
          db.prepare('INSERT INTO messages(id,receipt_id,target_id,target_role,notification_key) VALUES(?,?,?,?,?)')
            .run('message-' + receiptId + '-' + role, receiptId, item.id, role, receiptId + ':' + role);
          phase(onPhase, 'after:message:' + (index + 1));
        }
        db.prepare('INSERT INTO audit(id,receipt_id,kind,target_id,actor_id,at) VALUES(?,?,?,?,?,?)')
          .run(securityAuditId, receiptId, 'security-success', item.id, command.principalId, now);
        phase(onPhase, 'after:audit');
        const accessAuditId = 'audit-' + randomUUID();
        db.prepare('INSERT INTO audit(id,receipt_id,kind,target_id,actor_id,at) VALUES(?,?,?,?,?,?)')
          .run(accessAuditId, receiptId, 'access-success', item.id, command.principalId, now);
        phase(onPhase, 'after:accessAudit');
        for (const [index, auditId] of [securityAuditId, accessAuditId].entries()) {
          const row = db.prepare('SELECT * FROM audit WHERE id=?').get(auditId);
          const previous = db.prepare('SELECT source_hash FROM audit_source ORDER BY rowid DESC LIMIT 1').get()?.source_hash || 'GENESIS';
          const sourceHash = sha(JSON.stringify([previous, row.id, row.receipt_id, row.kind, row.target_id, row.actor_id, row.at]));
          db.prepare('INSERT INTO audit_source(id,audit_id,previous_hash,source_hash) VALUES(?,?,?,?)')
            .run('source-' + auditId, auditId, previous, sourceHash);
          phase(onPhase, 'after:auditSource:' + (index + 1));
        }
        phase(onPhase, 'after:auditSource');
        const receipt = db.prepare('SELECT * FROM receipts WHERE id=?').get(receiptId);
        return { state: 'confirmed', outcome: 'first', receipt: projectReceipt(receipt) };
      }, () => authorize(db, command, controlledNow(clock)));
      return result;
    },
    revokeAuthorization({ authorizationId }, { onPhase } = {}) {
      assertOpen();
      const id = required(authorizationId, 'authorization');
      return transaction(db, onPhase, () => {
        const auth = db.prepare('SELECT * FROM authorizations WHERE id=?').get(id);
        if (!auth || auth.status !== 'active') throw fail('AUTHORIZATION_DENIED');
        const now = controlledNow(clock);
        db.prepare("UPDATE authorizations SET status='revoked',revoked_at=? WHERE id=?").run(now, id);
        phase(onPhase, 'after:authorization');
        const affected = db.prepare('SELECT id FROM cases WHERE authorization_id=? AND status!=? ORDER BY id')
          .all(id, 'authorization-on-hold').map((row) => row.id);
        db.prepare("UPDATE cases SET status='authorization-on-hold',version=version+1 WHERE authorization_id=? AND status!='authorization-on-hold'").run(id);
        phase(onPhase, 'after:business');
        auditRow(db, 'audit-revoke-' + randomUUID(), null, 'authorization-revoked', id, 'synthetic-resident', now);
        phase(onPhase, 'after:auditSource');
        return { state: 'confirmed', authorizationId: id, affectedCaseIds: affected };
      });
    },
    reconcile(input) {
      assertOpen();
      const command = validateCommand(input);
      return transaction(db, null, () => {
        authorize(db, command, controlledNow(clock));
        const existing = receiptFor(db, command);
        if (!existing) return { state: 'not-found' };
        matchReceipt(existing, command);
        return { state: 'confirmed', outcome: 'reconciled', receipt: projectReceipt(existing) };
      }, () => authorize(db, command, controlledNow(clock)));
    },
    snapshot() {
      assertOpen();
      const reader = new DatabaseSync(location.dbPath, { readOnly: true });
      try {
        verifyDatabase(reader, identity);
        reader.exec('BEGIN');
        const result = {
          authorizations: reader.prepare('SELECT * FROM authorizations ORDER BY id').all(),
          cases: reader.prepare('SELECT * FROM cases ORDER BY id').all(),
          receipts: reader.prepare('SELECT * FROM receipts ORDER BY id').all(),
          events: reader.prepare('SELECT * FROM events ORDER BY id').all(),
          reports: reader.prepare('SELECT * FROM reports ORDER BY id').all(),
          messages: reader.prepare('SELECT * FROM messages ORDER BY id').all(),
          audit: reader.prepare('SELECT * FROM audit ORDER BY id').all(),
          auditSource: reader.prepare('SELECT * FROM audit_source ORDER BY id').all()
        };
        reader.exec('COMMIT');
        return result;
      } catch (error) {
        try { reader.exec('ROLLBACK'); } catch {}
        throw error;
      } finally {
        reader.close();
      }
    },
    close() {
      if (!closed) { db.close(); closed = true; }
    }
  };
  if (ownsDirectory) {
    store.cleanup = () => {
      store.close();
      const checked = verifyLocation(location.dbPath);
      if (checked.directory !== location.directory || checked.dbPath !== location.dbPath) throw fail('FOREIGN_FILE');
      fs.rmSync(location.directory, { recursive: true, force: false });
    };
  }
  return store;
}

function createExperiment({ clock = () => new Date().toISOString() } = {}) {
  if (typeof clock !== 'function') throw fail('INVALID_CLOCK');
  const root = tempRoot();
  const directory = fs.mkdtempSync(path.join(root, DIRECTORY_PREFIX));
  const dbPath = path.join(directory, FILE_NAME);
  let db;
  try {
    const fd = fs.openSync(dbPath, 'wx', 0o600);
    fs.closeSync(fd);
    const location = verifyLocation(dbPath);
    db = new DatabaseSync(location.dbPath);
    db.exec('PRAGMA application_id=' + APPLICATION_ID + '; PRAGMA user_version=1; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
    db.exec(SCHEMA_SQL);
    const identity = randomUUID();
    db.prepare('INSERT INTO experiment_metadata(marker,identity,fingerprint,seeded) VALUES(?,?,?,0)')
      .run(MARKER, identity, expectedSchemaFingerprint());
    db.exec('PRAGMA journal_mode=WAL');
    return makeStore(db, location, identity, clock, true);
  } catch (error) {
    if (db) db.close();
    const realDirectory = fs.realpathSync(directory);
    if (within(root, realDirectory) && path.basename(realDirectory).startsWith(DIRECTORY_PREFIX)) {
      fs.rmSync(realDirectory, { recursive: true, force: false });
    }
    throw error;
  }
}

function openExperiment({ dbPath, identity, clock = () => new Date().toISOString() }) {
  if (typeof clock !== 'function') throw fail('INVALID_CLOCK');
  required(identity, 'identity');
  const location = verifyLocation(dbPath);
  const reader = new DatabaseSync(location.dbPath, { readOnly: true });
  try { verifyDatabase(reader, identity); } finally { reader.close(); }
  const db = new DatabaseSync(location.dbPath);
  try {
    verifyDatabase(db, identity);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
    return makeStore(db, location, identity, clock, false);
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { createExperiment, openExperiment, PURPOSE, VERSION };
