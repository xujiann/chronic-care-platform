"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  APPROVAL_ROLES,
  createPilotCutoverEvidenceFingerprint,
  evaluatePilotCutover
} = require("./pilot-cutover-orchestrator");
const {
  readBoundedJsonFile,
  readPilotCutoverInput,
  resolveAbsoluteFile
} = require("./pilot-cutover-package");
const {
  SHA256,
  assertMetadataOnly,
  sha256,
  stableStringify
} = require("../governance/technical-evidence");

const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_BYTES = 32 * 1024;
const GENESIS_DIGEST = `sha256:${"0".repeat(64)}`;
const EVENT_SCHEMA = "pilot-cutover-authorization-event-v1";
const EVENT_TYPES = Object.freeze([
  "evidence-registered",
  "evidence-revoked",
  "approval-recorded"
]);
const REQUIRED_EXTERNAL_GATES = Object.freeze([
  "security-assessment",
  "monitoring-drill",
  "dr-rehearsal",
  "site-acceptance"
]);
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;

function ledgerError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function parseInstant(value, label) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) {
    throw ledgerError("PILOT_CUTOVER_LEDGER_TIME_INVALID", `${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function eventProjection(event) {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    sequence: event.sequence,
    type: event.type,
    recordedAt: event.recordedAt,
    actorAccount: event.actorAccount,
    previousEventDigest: event.previousEventDigest,
    payload: event.payload
  };
}

function validateEvidencePayload(payload = {}) {
  if (!REQUIRED_EXTERNAL_GATES.includes(payload.gateId)
    || !clean(payload.releaseId, 160)
    || !SHA256.test(clean(payload.packageFingerprint, 80))
    || !CONTROLLED_REFERENCE.test(clean(payload.evidenceRef, 240))
    || !SHA256.test(clean(payload.evidenceDigest, 80))
    || !clean(payload.issuerAccount, 160)
    || !clean(payload.verifierAccount, 160)
    || clean(payload.issuerAccount, 160) === clean(payload.verifierAccount, 160)) {
    throw ledgerError(
      "PILOT_CUTOVER_EVIDENCE_REGISTRATION_INVALID",
      "evidence registration requires a known gate, package binding, controlled reference, digest and independent verifier"
    );
  }
  const issuedAt = parseInstant(payload.issuedAt, "issuedAt");
  const expiresAt = parseInstant(payload.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt) {
    throw ledgerError(
      "PILOT_CUTOVER_EVIDENCE_WINDOW_INVALID",
      "evidence expiry must be later than issuance"
    );
  }
}

function validateApprovalPayload(payload = {}) {
  if (!APPROVAL_ROLES.includes(payload.role)
    || !clean(payload.account, 160)
    || !SHA256.test(clean(payload.packageFingerprint, 80))
    || !CONTROLLED_REFERENCE.test(clean(payload.evidenceRef, 240))
    || !SHA256.test(clean(payload.evidenceDigest, 80))
    || payload.confirmation !== "APPROVE PILOT CUTOVER"
    || !clean(payload.rollbackOwner, 160)) {
    throw ledgerError(
      "PILOT_CUTOVER_APPROVAL_INVALID",
      "approval requires a known role, package binding, controlled evidence, explicit confirmation and rollback owner"
    );
  }
  const approvedAt = parseInstant(payload.approvedAt, "approvedAt");
  const expiresAt = parseInstant(payload.expiresAt, "expiresAt");
  if (expiresAt <= approvedAt) {
    throw ledgerError(
      "PILOT_CUTOVER_APPROVAL_WINDOW_INVALID",
      "approval expiry must be later than approval"
    );
  }
}

function validateRevocationPayload(payload = {}, events = []) {
  const target = events.find((event) => event.eventId === payload.targetEventId);
  const alreadyRevoked = events.some((event) =>
    event.type === "evidence-revoked"
    && event.payload.targetEventId === payload.targetEventId);
  if (!target
    || target.type === "evidence-revoked"
    || alreadyRevoked
    || !CONTROLLED_REFERENCE.test(clean(payload.reasonRef, 240))
    || !SHA256.test(clean(payload.reasonDigest, 80))) {
    throw ledgerError(
      "PILOT_CUTOVER_REVOCATION_INVALID",
      "revocation must target one active ledger event and include controlled reason evidence"
    );
  }
}

function validatePayload(type, payload, events = []) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw ledgerError("PILOT_CUTOVER_LEDGER_PAYLOAD_INVALID", "ledger payload must be an object");
  }
  assertMetadataOnly(payload, "cutoverAuthorizationEvent");
  if (type === "evidence-registered") validateEvidencePayload(payload);
  if (type === "approval-recorded") validateApprovalPayload(payload);
  if (type === "evidence-revoked") validateRevocationPayload(payload, events);
}

function validateEvent(event, index, previousDigest, events = []) {
  if (event?.schemaVersion !== EVENT_SCHEMA
    || !clean(event.eventId, 120)
    || event.sequence !== index + 1
    || !EVENT_TYPES.includes(event.type)
    || !clean(event.actorAccount, 160)
    || events.some((item) => item.eventId === event.eventId)
    || !Number.isFinite(Date.parse(event.recordedAt || ""))
    || event.previousEventDigest !== previousDigest
    || !SHA256.test(clean(event.eventDigest, 80))) {
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_CHAIN_INVALID",
      `authorization ledger event ${index + 1} is malformed or out of sequence`
    );
  }
  validatePayload(event.type, event.payload, events);
  if (event.eventDigest !== sha256(eventProjection(event))) {
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_DIGEST_INVALID",
      `authorization ledger event ${index + 1} digest is invalid`
    );
  }
}

function readAuthorizationLedger(file, options = {}) {
  const resolved = resolveAbsoluteFile(file, "pilot cutover authorization ledger");
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    if (options.allowMissing === true) return Object.freeze([]);
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_UNAVAILABLE",
      "pilot cutover authorization ledger is unavailable"
    );
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_LEDGER_BYTES) {
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_BOUNDARY_INVALID",
      "authorization ledger must be a regular file within the size limit"
    );
  }
  const text = fs.readFileSync(resolved, "utf8");
  if (!text.trim()) return Object.freeze([]);
  const events = [];
  let previousDigest = GENESIS_DIGEST;
  for (const [index, line] of text.split(/\r?\n/).filter(Boolean).entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw ledgerError(
        "PILOT_CUTOVER_LEDGER_JSON_INVALID",
        `authorization ledger event ${index + 1} is not valid JSON`
      );
    }
    validateEvent(event, index, previousDigest, events);
    events.push(Object.freeze(structuredClone(event)));
    previousDigest = event.eventDigest;
  }
  return Object.freeze(events);
}

function assertLedgerDirectory(directory) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch {
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_DIRECTORY_INVALID",
      "authorization ledger directory is unavailable"
    );
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_DIRECTORY_INVALID",
      "authorization ledger directory must be a real directory"
    );
  }
}

function appendAuthorizationEvent(options = {}) {
  const file = resolveAbsoluteFile(options.file, "pilot cutover authorization ledger");
  const directory = path.dirname(file);
  assertLedgerDirectory(directory);
  if (!EVENT_TYPES.includes(options.type)) {
    throw ledgerError("PILOT_CUTOVER_LEDGER_EVENT_INVALID", "authorization ledger event type is invalid");
  }
  const lockFile = `${file}.lock`;
  let lockDescriptor = null;
  try {
    lockDescriptor = fs.openSync(lockFile, "wx", 0o600);
  } catch {
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_LOCKED",
      "authorization ledger is locked by another writer",
      409
    );
  }
  try {
    const events = readAuthorizationLedger(file, { allowMissing: true });
    validatePayload(options.type, options.payload, events);
    const eventId = clean(options.eventId, 120) || randomUUID();
    if (events.some((event) => event.eventId === eventId)) {
      throw ledgerError(
        "PILOT_CUTOVER_LEDGER_EVENT_DUPLICATE",
        "authorization ledger event id already exists",
        409
      );
    }
    const recordedAt = new Date(parseInstant(
      options.recordedAt || new Date().toISOString(),
      "recordedAt"
    )).toISOString();
    const previousEventDigest = events.length
      ? events[events.length - 1].eventDigest
      : GENESIS_DIGEST;
    const event = {
      schemaVersion: EVENT_SCHEMA,
      eventId,
      sequence: events.length + 1,
      type: options.type,
      recordedAt,
      actorAccount: clean(options.actorAccount, 160),
      previousEventDigest,
      payload: structuredClone(options.payload)
    };
    if (!event.actorAccount) {
      throw ledgerError(
        "PILOT_CUTOVER_LEDGER_ACTOR_REQUIRED",
        "authorization ledger actor account is required"
      );
    }
    event.eventDigest = sha256(eventProjection(event));
    const line = `${stableStringify(event)}\n`;
    const bytes = Buffer.byteLength(line);
    const currentBytes = fs.existsSync(file) ? fs.lstatSync(file).size : 0;
    if (bytes > MAX_EVENT_BYTES || currentBytes + bytes > MAX_LEDGER_BYTES) {
      throw ledgerError(
        "PILOT_CUTOVER_LEDGER_SIZE_INVALID",
        "authorization ledger event or file exceeds the size limit"
      );
    }
    let descriptor = null;
    try {
      if (!fs.existsSync(file)) {
        descriptor = fs.openSync(file, "wx", 0o600);
      } else {
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw ledgerError(
            "PILOT_CUTOVER_LEDGER_BOUNDARY_INVALID",
            "authorization ledger must remain a regular file"
          );
        }
        descriptor = fs.openSync(file, "a");
      }
      fs.writeFileSync(descriptor, line, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
    return Object.freeze(structuredClone(event));
  } finally {
    if (lockDescriptor !== null) fs.closeSync(lockDescriptor);
    try {
      fs.rmSync(lockFile, { force: true });
    } catch {}
  }
}

function buildAuthorizationLedgerProjection(options = {}) {
  const events = options.events || readAuthorizationLedger(options.file);
  const packageFingerprint = clean(options.packageFingerprint, 80);
  const releaseId = clean(options.releaseId, 160);
  if (!SHA256.test(packageFingerprint) || !releaseId) {
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_PACKAGE_FINGERPRINT_INVALID",
      "a release id and SHA-256 pilot package fingerprint are required"
    );
  }
  const now = Date.parse(options.now || new Date().toISOString());
  if (!Number.isFinite(now)) {
    throw ledgerError("PILOT_CUTOVER_LEDGER_TIME_INVALID", "evaluation time is invalid");
  }
  const revokedEventIds = new Set(events
    .filter((event) => event.type === "evidence-revoked")
    .map((event) => event.payload.targetEventId));
  const evidenceEvents = events.filter((event) =>
    event.type === "evidence-registered"
    && event.payload.packageFingerprint === packageFingerprint);
  const latestEvidence = new Map();
  evidenceEvents.forEach((event) => latestEvidence.set(event.payload.gateId, event));
  const evidenceChecks = Object.freeze(Object.fromEntries(REQUIRED_EXTERNAL_GATES.map((gateId) => {
    const event = latestEvidence.get(gateId);
    return [gateId, Boolean(event)
      && !revokedEventIds.has(event.eventId)
      && event.payload.releaseId === releaseId
      && Date.parse(event.payload.issuedAt) <= now
      && Date.parse(event.payload.expiresAt) > now];
  })));

  const approvalEvents = events.filter((event) =>
    event.type === "approval-recorded"
    && event.payload.packageFingerprint === packageFingerprint);
  const latestApprovals = new Map();
  approvalEvents.forEach((event) => latestApprovals.set(event.payload.role, event));
  const approvalRows = APPROVAL_ROLES
    .map((role) => latestApprovals.get(role))
    .filter((event) => event && !revokedEventIds.has(event.eventId));
  const accounts = approvalRows.map((event) => event.payload.account);
  const rollbackOwners = new Set(approvalRows.map((event) => event.payload.rollbackOwner));
  const approvalChecks = Object.freeze({
    roles: approvalRows.length === APPROVAL_ROLES.length,
    independentAccounts: accounts.length === APPROVAL_ROLES.length
      && new Set(accounts).size === APPROVAL_ROLES.length,
    currentWindow: approvalRows.length === APPROVAL_ROLES.length
      && approvalRows.every((event) =>
        Date.parse(event.payload.approvedAt) <= now
        && Date.parse(event.payload.expiresAt) > now),
    rollbackOwner: rollbackOwners.size === 1
      && Boolean(clean([...rollbackOwners][0], 160))
  });
  const approvalsReady = Object.values(approvalChecks).every(Boolean);
  const approvedAt = approvalsReady
    ? new Date(Math.max(...approvalRows.map((event) => Date.parse(event.payload.approvedAt)))).toISOString()
    : "";
  const expiresAt = approvalsReady
    ? new Date(Math.min(...approvalRows.map((event) => Date.parse(event.payload.expiresAt)))).toISOString()
    : "";
  const authorization = Object.freeze({
    decision: approvalsReady ? "GO" : "NO-GO",
    confirmation: approvalsReady ? "APPROVE PILOT CUTOVER" : "",
    evidenceFingerprint: packageFingerprint,
    approvedAt,
    expiresAt,
    rollbackOwner: approvalsReady ? [...rollbackOwners][0] : "",
    approvals: Object.freeze(approvalRows.map((event) => Object.freeze({
      role: event.payload.role,
      account: event.payload.account,
      status: "approved",
      evidenceRef: event.payload.evidenceRef,
      evidenceDigest: event.payload.evidenceDigest
    })))
  });
  const revoked = events.filter((event) => event.type === "evidence-revoked").length;
  return Object.freeze({
    schema: "pilot-cutover-authorization-ledger-projection-v1",
    evaluatedAt: new Date(now).toISOString(),
    releaseId,
    packageFingerprint,
    chainValid: true,
    headDigest: events.length ? events[events.length - 1].eventDigest : GENESIS_DIGEST,
    events: events.length,
    revoked,
    evidenceChecks,
    evidenceReady: Object.values(evidenceChecks).every(Boolean),
    approvalChecks,
    approvalsReady,
    authorization,
    productionReady: false,
    boundary: "Ledger entries are metadata-only records. Validation does not authenticate a human identity, execute cutover, or make production primary."
  });
}

function evaluatePilotCutoverAuthorizationLedger(options = {}) {
  const input = options.input || readPilotCutoverInput(
    options.packageFile || options.env?.PLATFORM_PILOT_CUTOVER_INPUT_FILE
      || process.env.PLATFORM_PILOT_CUTOVER_INPUT_FILE
  );
  const packageFingerprint = createPilotCutoverEvidenceFingerprint(input);
  if (input.candidateEvidenceFingerprint !== packageFingerprint) {
    throw ledgerError(
      "PILOT_CUTOVER_LEDGER_PACKAGE_BINDING_INVALID",
      "authorization ledger package binding does not match the immutable package"
    );
  }
  const ledger = buildAuthorizationLedgerProjection({
    file: options.ledgerFile
      || options.env?.PLATFORM_PILOT_CUTOVER_AUTHORIZATION_LEDGER_FILE
      || process.env.PLATFORM_PILOT_CUTOVER_AUTHORIZATION_LEDGER_FILE,
    events: options.events,
    packageFingerprint,
    releaseId: input.release.releaseId,
    now: options.now
  });
  const decision = evaluatePilotCutover({
    ...structuredClone(input),
    authorization: structuredClone(ledger.authorization)
  }, options.now || new Date().toISOString());
  const goCandidate = decision.decision === "GO-CANDIDATE"
    && ledger.evidenceReady
    && ledger.approvalsReady;
  return Object.freeze({
    ...decision,
    schema: "pilot-cutover-authorization-control-v1",
    decision: goCandidate ? "GO-CANDIDATE" : "NO-GO",
    checks: Object.freeze({
      ...decision.checks,
      authorizationLedger: ledger.chainValid,
      externalEvidenceRegistry: ledger.evidenceReady
    }),
    ledger,
    cutoverExecutionAuthorized: false,
    productionPrimary: false,
    productionReady: false,
    boundary: "GO-CANDIDATE requires an intact ledger, current external evidence and four independent approvals bound to this package. Execution remains a separate human-controlled operation."
  });
}

function loadLedgerCommandInput(file) {
  const input = readBoundedJsonFile(file, {
    label: "pilot cutover authorization command",
    maximumBytes: MAX_EVENT_BYTES
  });
  const allowed = new Set([
    "schemaVersion",
    "actorAccount",
    "recordedAt",
    "eventId",
    "payload",
    "boundary"
  ]);
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !allowed.has(key))) {
    throw ledgerError(
      "PILOT_CUTOVER_AUTHORIZATION_INPUT_INVALID",
      "authorization command contains unsupported top-level fields"
    );
  }
  assertMetadataOnly(input.payload, "cutoverAuthorizationCommand.event");
  return input;
}

module.exports = {
  EVENT_SCHEMA,
  EVENT_TYPES,
  GENESIS_DIGEST,
  MAX_EVENT_BYTES,
  MAX_LEDGER_BYTES,
  REQUIRED_EXTERNAL_GATES,
  appendAuthorizationEvent,
  buildAuthorizationLedgerProjection,
  evaluatePilotCutoverAuthorizationLedger,
  loadLedgerCommandInput,
  readAuthorizationLedger
};
