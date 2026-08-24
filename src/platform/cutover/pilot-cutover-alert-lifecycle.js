"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  assertMetadataOnly,
  sha256,
  stableStringify
} = require("../governance/technical-evidence");

const ALERT_EVENT_SCHEMA = "pilot-cutover-monitoring-event-v1";
const ALERT_JOURNAL_SCHEMA = "pilot-cutover-monitoring-projection-v1";
const ALERT_GENESIS_DIGEST = `sha256:${"0".repeat(64)}`;
const MAX_ALERT_JOURNAL_BYTES = 4 * 1024 * 1024;
const MAX_ALERT_EVENT_BYTES = 16 * 1024;
const ALERT_EVENT_TYPES = Object.freeze([
  "alert-opened",
  "delivery-attempted",
  "delivery-acknowledged",
  "delivery-failed",
  "delivery-dead-lettered",
  "alert-acknowledged",
  "alert-escalated",
  "alert-recovered",
  "dead-letter-redriven"
]);
const ALERT_SEVERITIES = new Set(["warning", "critical"]);
const ROUTES = new Set(["SIEM", "WEBHOOK"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CONTROLLED_REFERENCE = /^(?:alert|evidence|artifact|cmdb|monitoring|siem|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const TRUST_KEY_CHECKS = Object.freeze([
  "keyKnown",
  "keyActiveAtIssuance",
  "keyCurrent",
  "account",
  "scope"
]);
const TRUST_SIGNATURE_CHECKS = Object.freeze([
  "attestationSchema",
  "algorithm",
  "nonce",
  "subjectDigest",
  "signatureFormat",
  "signature"
]);

function lifecycleError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
    : fallback;
}

function parseInstant(value, label) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) {
    throw lifecycleError("PILOT_CUTOVER_ALERT_TIME_INVALID", `${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function resolveJournalFile(file) {
  if (!path.isAbsolute(String(file || ""))) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_PATH_INVALID",
      "pilot cutover alert journal must use an absolute path"
    );
  }
  return path.resolve(String(file));
}

function assertJournalDirectory(directory) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_DIRECTORY_INVALID",
      "pilot cutover alert journal directory is unavailable"
    );
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_DIRECTORY_INVALID",
      "pilot cutover alert journal directory must be a real directory"
    );
  }
}

function validateDigest(value, label) {
  if (!SHA256.test(clean(value, 80))) {
    throw lifecycleError("PILOT_CUTOVER_ALERT_DIGEST_INVALID", `${label} must be a SHA-256 digest`);
  }
}

function validateControlledReference(value, label) {
  if (!CONTROLLED_REFERENCE.test(clean(value, 240))) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_REFERENCE_INVALID",
      `${label} must be a controlled metadata reference`
    );
  }
}

function validateAlertDetails(type, details = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_DETAILS_INVALID",
      "pilot cutover alert event details must be an object"
    );
  }
  assertMetadataOnly(details, "pilotCutoverAlertEvent.details");
  if (type === "alert-opened") {
    if (!clean(details.signalCode, 120)
      || !ALERT_SEVERITIES.has(clean(details.severity, 20))
      || !clean(details.title, 200)
      || !clean(details.summary, 1000)) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_OPEN_INVALID",
        "opening an alert requires a signal code, severity, title and summary"
      );
    }
    const evidenceRefs = Array.isArray(details.evidenceRefs) ? details.evidenceRefs : [];
    evidenceRefs.forEach((item) => validateControlledReference(item, "alert evidence reference"));
    return;
  }
  if (["delivery-attempted", "delivery-acknowledged", "delivery-failed", "delivery-dead-lettered"].includes(type)) {
    if (!ROUTES.has(clean(details.route, 20)) || !Number.isInteger(details.attempt) || details.attempt < 1) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_DELIVERY_INVALID",
        "delivery events require a supported route and positive attempt number"
      );
    }
  }
  if (type === "delivery-acknowledged") {
    validateControlledReference(details.receiptRef, "monitoring receipt reference");
    validateDigest(details.receiptDigest, "monitoring receipt digest");
  }
  if (type === "delivery-failed" || type === "delivery-dead-lettered") {
    if (!clean(details.errorCode, 120)) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_DELIVERY_INVALID",
        "failed delivery events require a stable error code"
      );
    }
    validateDigest(details.errorDigest, "delivery error digest");
  }
  if (["alert-acknowledged", "alert-escalated", "alert-recovered", "dead-letter-redriven"].includes(type)) {
    validateControlledReference(details.evidenceRef, "lifecycle evidence reference");
    validateDigest(details.evidenceDigest, "lifecycle evidence digest");
  }
  if (type === "alert-escalated" && !clean(details.level, 40)) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_ESCALATION_INVALID",
      "alert escalation requires a level"
    );
  }
}

function eventProjection(event) {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    sequence: event.sequence,
    type: event.type,
    alertFingerprint: event.alertFingerprint,
    recordedAt: event.recordedAt,
    actorAccount: event.actorAccount,
    previousEventDigest: event.previousEventDigest,
    details: event.details
  };
}

function validateAlertEvent(event, index, previousDigest, events) {
  if (event?.schemaVersion !== ALERT_EVENT_SCHEMA
    || !clean(event.eventId, 120)
    || event.sequence !== index + 1
    || !ALERT_EVENT_TYPES.includes(event.type)
    || !clean(event.alertFingerprint, 200)
    || !clean(event.actorAccount, 160)
    || events.some((row) => row.eventId === event.eventId)
    || !Number.isFinite(Date.parse(event.recordedAt || ""))
    || event.previousEventDigest !== previousDigest
    || !SHA256.test(clean(event.eventDigest, 80))) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_CHAIN_INVALID",
      `pilot cutover alert journal event ${index + 1} is malformed or out of sequence`
    );
  }
  validateAlertDetails(event.type, event.details);
  if (event.eventDigest !== sha256(eventProjection(event))) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_DIGEST_INVALID",
      `pilot cutover alert journal event ${index + 1} digest is invalid`
    );
  }
}

function readPilotCutoverAlertJournal(file, options = {}) {
  const resolved = resolveJournalFile(file);
  const fileSystem = options.fileSystem || fs;
  let stat;
  let descriptor = null;
  try {
    stat = fileSystem.lstatSync(resolved);
  } catch {
    if (options.allowMissing === true) return Object.freeze([]);
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_UNAVAILABLE",
      "pilot cutover alert journal is unavailable"
    );
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_ALERT_JOURNAL_BYTES) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID",
      "pilot cutover alert journal must be a regular file within the size limit"
    );
  }
  let text;
  try {
    descriptor = fileSystem.openSync(resolved, fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0));
    const opened = fileSystem.fstatSync(descriptor);
    const current = fileSystem.lstatSync(resolved);
    if (!opened.isFile()
      || current.isSymbolicLink()
      || !current.isFile()
      || stat.dev !== opened.dev
      || stat.ino !== opened.ino
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || opened.size > MAX_ALERT_JOURNAL_BYTES
      || current.size !== opened.size) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID",
        "pilot cutover alert journal must match the opened regular file and remain within the size limit"
      );
    }
    const bytes = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fileSystem.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const finished = fileSystem.fstatSync(descriptor);
    if (offset !== opened.size || finished.size !== opened.size) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID",
        "pilot cutover alert journal changed while it was being read"
      );
    }
    text = bytes.subarray(0, offset).toString("utf8");
  } catch (error) {
    if (error?.code?.startsWith("PILOT_CUTOVER_")) throw error;
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID",
      "pilot cutover alert journal is unavailable"
    );
  } finally {
    if (descriptor !== null) fileSystem.closeSync(descriptor);
  }
  if (!text.trim()) return Object.freeze([]);
  const events = [];
  let previousDigest = ALERT_GENESIS_DIGEST;
  for (const [index, line] of text.split(/\r?\n/).filter(Boolean).entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_JOURNAL_JSON_INVALID",
        `pilot cutover alert journal event ${index + 1} is not valid JSON`
      );
    }
    validateAlertEvent(event, index, previousDigest, events);
    events.push(Object.freeze(structuredClone(event)));
    previousDigest = event.eventDigest;
  }
  return Object.freeze(events);
}

function appendPilotCutoverAlertEvent(options = {}) {
  const file = resolveJournalFile(options.file);
  assertJournalDirectory(path.dirname(file));
  if (!ALERT_EVENT_TYPES.includes(options.type)) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_EVENT_INVALID",
      "pilot cutover alert event type is invalid"
    );
  }
  const lockFile = `${file}.lock`;
  let lockDescriptor = null;
  try {
    lockDescriptor = fs.openSync(lockFile, "wx", 0o600);
  } catch {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_JOURNAL_LOCKED",
      "pilot cutover alert journal is locked by another writer",
      409
    );
  }
  try {
    const events = readPilotCutoverAlertJournal(file, { allowMissing: true });
    validateAlertDetails(options.type, options.details);
    const eventId = clean(options.eventId, 120) || randomUUID();
    if (events.some((event) => event.eventId === eventId)) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_EVENT_DUPLICATE",
        "pilot cutover alert event id already exists",
        409
      );
    }
    const event = {
      schemaVersion: ALERT_EVENT_SCHEMA,
      eventId,
      sequence: events.length + 1,
      type: options.type,
      alertFingerprint: clean(options.alertFingerprint, 200),
      recordedAt: new Date(parseInstant(
        options.recordedAt || new Date().toISOString(),
        "recordedAt"
      )).toISOString(),
      actorAccount: clean(options.actorAccount, 160),
      previousEventDigest: events.length
        ? events[events.length - 1].eventDigest
        : ALERT_GENESIS_DIGEST,
      details: structuredClone(options.details)
    };
    if (!event.alertFingerprint || !event.actorAccount) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_EVENT_ACTOR_INVALID",
        "pilot cutover alert event requires a fingerprint and actor account"
      );
    }
    event.eventDigest = sha256(eventProjection(event));
    const line = `${stableStringify(event)}\n`;
    const eventBytes = Buffer.byteLength(line);
    const currentBytes = fs.existsSync(file) ? fs.lstatSync(file).size : 0;
    if (eventBytes > MAX_ALERT_EVENT_BYTES || currentBytes + eventBytes > MAX_ALERT_JOURNAL_BYTES) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_JOURNAL_SIZE_INVALID",
        "pilot cutover alert event or journal exceeds the size limit"
      );
    }
    let descriptor = null;
    try {
      if (fs.existsSync(file)) {
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw lifecycleError(
            "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID",
            "pilot cutover alert journal must remain a regular file"
          );
        }
        descriptor = fs.openSync(file, "a");
      } else {
        descriptor = fs.openSync(file, "wx", 0o600);
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

function alertStatusFromEvents(events) {
  let status = "open";
  let escalationLevel = "";
  const routeStates = new Map();
  events.forEach((event) => {
    const route = clean(event.details?.route, 20);
    if (event.type === "delivery-attempted" && route && !routeStates.has(route)) {
      routeStates.set(route, "pending");
    }
    if (event.type === "delivery-acknowledged" && route) routeStates.set(route, "delivered");
    if (event.type === "delivery-dead-lettered" && route) routeStates.set(route, "dead-letter");
    if (event.type === "dead-letter-redriven") {
      routeStates.forEach((routeStatus, routeName) => {
        if (routeStatus === "dead-letter") routeStates.set(routeName, "pending");
      });
    }
    if (event.type === "alert-acknowledged") status = "acknowledged";
    if (event.type === "alert-escalated") {
      status = "escalated";
      escalationLevel = clean(event.details.level, 40);
    }
    if (event.type === "alert-recovered") status = "recovered";
  });
  const routeStatusRows = [...routeStates.values()];
  const deliveryStatus = routeStatusRows.includes("dead-letter")
    ? "dead-letter"
    : (routeStatusRows.length > 0 && routeStatusRows.every((row) => row === "delivered")
      ? "delivered"
      : "pending");
  return { status, deliveryStatus, escalationLevel };
}

function buildPilotCutoverAlertProjection(options = {}) {
  const events = options.events || readPilotCutoverAlertJournal(options.file, {
    fileSystem: options.fileSystem
  });
  const grouped = new Map();
  events.forEach((event) => {
    const rows = grouped.get(event.alertFingerprint) || [];
    rows.push(event);
    grouped.set(event.alertFingerprint, rows);
  });
  const alerts = [...grouped.entries()].map(([fingerprint, rows]) => {
    const opened = rows.find((event) => event.type === "alert-opened");
    if (!opened) {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_JOURNAL_STATE_INVALID",
        `alert ${fingerprint} has lifecycle events without an opening event`
      );
    }
    const state = alertStatusFromEvents(rows);
    return Object.freeze({
      fingerprint,
      signalCode: opened.details.signalCode,
      severity: opened.details.severity,
      status: state.status,
      deliveryStatus: state.deliveryStatus,
      escalationLevel: state.escalationLevel,
      openedAt: opened.recordedAt,
      lastChangedAt: rows.at(-1).recordedAt,
      eventCount: rows.length
    });
  });
  return Object.freeze({
    schema: ALERT_JOURNAL_SCHEMA,
    evaluatedAt: clean(options.now, 40) || new Date().toISOString(),
    chainValid: true,
    headDigest: events.length ? events.at(-1).eventDigest : ALERT_GENESIS_DIGEST,
    events: events.length,
    alerts: Object.freeze(alerts),
    summary: Object.freeze({
      total: alerts.length,
      open: alerts.filter((alert) => alert.status !== "recovered").length,
      critical: alerts.filter((alert) =>
        alert.severity === "critical" && alert.status !== "recovered").length,
      deadLetter: alerts.filter((alert) => alert.deliveryStatus === "dead-letter").length,
      recovered: alerts.filter((alert) => alert.status === "recovered").length
    }),
    monitoringAcceptanceProven: false,
    productionReady: false
  });
}

function candidate(code, severity, title, summary, scope, context = {}) {
  const fingerprint = `${code.toLowerCase()}:${sha256({
    scope,
    releaseId: clean(context.releaseId, 160),
    packageFingerprint: clean(context.packageFingerprint, 80),
    ledgerHeadDigest: clean(context.ledgerHeadDigest, 80)
  }).slice(7, 31)}`;
  return Object.freeze({
    fingerprint,
    source: "pilot-cutover-control",
    severity,
    signalCode: code,
    title,
    summary,
    occurredAt: context.now,
    labels: Object.freeze({
      environment: "pre-production",
      releaseId: clean(context.releaseId, 160),
      scope: clean(scope, 120),
      owner: "cutover-observability"
    }),
    metrics: Object.freeze({ count: "1" }),
    evidenceRefs: Object.freeze(["monitoring://pilot-cutover/control-health"])
  });
}

function derivePilotCutoverAlertCandidates(control = {}, options = {}) {
  const nowIso = options.now || control.evaluatedAt || new Date().toISOString();
  const now = parseInstant(nowIso, "evaluation time");
  const warningHours = boundedInteger(options.warningHours, 24, 1, 720);
  const warningWindow = warningHours * 60 * 60 * 1000;
  const ledger = control.ledger || {};
  const context = {
    now: new Date(now).toISOString(),
    releaseId: control.releaseId || ledger.releaseId,
    packageFingerprint: ledger.packageFingerprint,
    ledgerHeadDigest: ledger.headDigest
  };
  const candidates = new Map();
  const add = (...args) => {
    const row = candidate(...args, context);
    candidates.set(row.fingerprint, row);
  };

  if (ledger.chainValid !== true) {
    add(
      "LEDGER_CHAIN_INVALID",
      "critical",
      "Pilot cutover authorization ledger chain is invalid",
      "Authorization decisions remain NO-GO until the append-only chain is independently repaired and verified.",
      "authorization-ledger"
    );
  }

  const lifecycle = Array.isArray(ledger.lifecycle) ? ledger.lifecycle : [];
  lifecycle.forEach((row) => {
    const scope = clean(row.scope || row.eventId, 120);
    const expiry = Date.parse(row.expiresAt || "");
    if (row.revoked === true) {
      add(
        "CONTROL_EVIDENCE_REVOKED",
        "critical",
        "Pilot cutover evidence was revoked",
        "A signed cutover-control event is revoked and cannot authorize production activity.",
        scope
      );
    }
    if (Number.isFinite(expiry) && expiry <= now) {
      add(
        "CONTROL_EVIDENCE_EXPIRED",
        "critical",
        "Pilot cutover evidence expired",
        "A required evidence or approval window expired; production readiness remains blocked.",
        scope
      );
    } else if (Number.isFinite(expiry) && expiry - now <= warningWindow) {
      add(
        "CONTROL_EVIDENCE_EXPIRING",
        "warning",
        "Pilot cutover evidence is approaching expiry",
        `A required evidence or approval window expires within ${warningHours} hours.`,
        scope
      );
    }
  });

  const trustRows = Array.isArray(ledger.trust) ? ledger.trust : [];
  let specificTrustAlert = false;
  trustRows.forEach((row) => {
    const checks = row.result?.checks || {};
    const scope = clean(row.result?.scope || row.eventId, 120);
    if (TRUST_KEY_CHECKS.some((check) => checks[check] === false)) {
      specificTrustAlert = true;
      add(
        "CUTOVER_PUBLIC_KEY_INVALID",
        "critical",
        "Pilot cutover public identity key is unavailable or invalid",
        "The current trust registry cannot authenticate a required account, scope or validity window.",
        scope
      );
    }
    if (TRUST_SIGNATURE_CHECKS.some((check) => checks[check] === false)) {
      specificTrustAlert = true;
      add(
        "CUTOVER_SIGNATURE_ANOMALY",
        "critical",
        "Pilot cutover signature verification failed",
        "A signed control event failed canonical digest, nonce, algorithm or Ed25519 signature verification.",
        scope
      );
    }
  });
  if (ledger.trustReady !== true && trustRows.length === 0) {
    add(
      "CUTOVER_TRUST_REGISTRY_UNAVAILABLE",
      "critical",
      "Pilot cutover trust registry is unavailable",
      "No verifiable public-key trust projection is available; authorization remains fail-closed.",
      "trust-registry"
    );
  } else if (ledger.trustReady !== true && !specificTrustAlert) {
    add(
      "CUTOVER_TRUST_VERIFICATION_BLOCKED",
      "critical",
      "Pilot cutover trust verification is blocked",
      "One or more required signed control events are incomplete or not trusted.",
      "trust-verification"
    );
  }
  if (ledger.rehearsalReady !== true) {
    add(
      "PREPRODUCTION_REHEARSAL_EXPIRED",
      "critical",
      "Pre-production cutover rehearsal is missing or stale",
      "A fresh, signed and package-bound rehearsal is required before candidate review.",
      "pre-production-rehearsal"
    );
  }

  return Object.freeze([...candidates.values()].sort((left, right) =>
    left.signalCode.localeCompare(right.signalCode)
      || left.fingerprint.localeCompare(right.fingerprint)));
}

function appendLifecycleTransition(options, type, details) {
  const projection = buildPilotCutoverAlertProjection({ file: options.file });
  const alert = projection.alerts.find((row) => row.fingerprint === options.alertFingerprint);
  if (!alert) {
    throw lifecycleError("PILOT_CUTOVER_ALERT_NOT_FOUND", "pilot cutover alert is not found", 404);
  }
  if (alert.status === "recovered" && type !== "dead-letter-redriven") {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_STATE_INVALID",
      "recovered pilot cutover alerts cannot be changed"
    );
  }
  if (type === "alert-recovered" && !["acknowledged", "escalated"].includes(alert.status)) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_RECOVERY_INVALID",
      "pilot cutover alert must be acknowledged or escalated before recovery"
    );
  }
  if (type === "dead-letter-redriven" && alert.deliveryStatus !== "dead-letter") {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_REDRIVE_INVALID",
      "only dead-lettered pilot cutover alerts can be redriven"
    );
  }
  return appendPilotCutoverAlertEvent({
    ...options,
    type,
    details
  });
}

function acknowledgePilotCutoverAlert(options = {}) {
  return appendLifecycleTransition(options, "alert-acknowledged", {
    evidenceRef: options.evidenceRef,
    evidenceDigest: options.evidenceDigest
  });
}

function escalatePilotCutoverAlert(options = {}) {
  return appendLifecycleTransition(options, "alert-escalated", {
    level: clean(options.level, 40),
    ownerGroup: clean(options.ownerGroup, 120),
    evidenceRef: options.evidenceRef,
    evidenceDigest: options.evidenceDigest
  });
}

function recoverPilotCutoverAlert(options = {}) {
  return appendLifecycleTransition(options, "alert-recovered", {
    evidenceRef: options.evidenceRef,
    evidenceDigest: options.evidenceDigest
  });
}

function redrivePilotCutoverAlert(options = {}) {
  return appendLifecycleTransition(options, "dead-letter-redriven", {
    evidenceRef: options.evidenceRef,
    evidenceDigest: options.evidenceDigest
  });
}

function normalizeRoutes(value) {
  const rows = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const routes = [...new Set(rows.map((item) => clean(item, 20).toUpperCase()).filter(Boolean))];
  if (!routes.length || routes.some((route) => !ROUTES.has(route))) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_ROUTES_INVALID",
      "one or more SIEM/WEBHOOK pilot cutover alert routes are required"
    );
  }
  return routes;
}

function publicDeliveryReceipt(receipt = {}, route) {
  const receiptId = clean(receipt.receiptId || receipt.eventId || receipt.alertId, 200);
  if (!receiptId) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_RECEIPT_INVALID",
      "monitoring adapter receipt is missing its stable identifier"
    );
  }
  const receiptDigest = sha256({
    route,
    receiptId,
    status: clean(receipt.status || "accepted", 40),
    acceptedAt: clean(receipt.acceptedAt, 40)
  });
  return {
    receiptRef: `monitoring://${route.toLowerCase()}/${receiptDigest.slice(7)}`,
    receiptDigest
  };
}

async function deliverPilotCutoverAlert(options = {}) {
  const candidateAlert = options.candidate;
  if (!candidateAlert || typeof candidateAlert !== "object") {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_CANDIDATE_INVALID",
      "a pilot cutover alert candidate is required"
    );
  }
  assertMetadataOnly(candidateAlert, "pilotCutoverAlertCandidate");
  const routes = normalizeRoutes(options.routes
    || options.env?.PLATFORM_PILOT_CUTOVER_ALERT_ROUTES
    || process.env.PLATFORM_PILOT_CUTOVER_ALERT_ROUTES);
  const actorAccount = clean(options.actorAccount, 160);
  const file = resolveJournalFile(options.file);
  const dispatcher = options.dispatcher || require("../../../observability-alerting").dispatchAlert;
  if (typeof dispatcher !== "function" || !actorAccount) {
    throw lifecycleError(
      "PILOT_CUTOVER_ALERT_ADAPTER_UNAVAILABLE",
      "pilot cutover alert delivery requires an actor and monitoring dispatcher"
    );
  }
  const existing = readPilotCutoverAlertJournal(file, { allowMissing: true })
    .filter((event) => event.alertFingerprint === candidateAlert.fingerprint);
  if (existing.length) {
    const existingAlert = buildPilotCutoverAlertProjection({ events: existing })
      .alerts.find((row) => row.fingerprint === candidateAlert.fingerprint);
    if (existingAlert?.status === "recovered") {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_ALREADY_RECOVERED",
        "recovered pilot cutover alerts cannot be delivered again"
      );
    }
    if (existingAlert?.deliveryStatus === "dead-letter") {
      throw lifecycleError(
        "PILOT_CUTOVER_ALERT_REDRIVE_REQUIRED",
        "dead-lettered pilot cutover alerts require an audited redrive approval"
      );
    }
    if (existingAlert?.deliveryStatus === "delivered") {
      return Object.freeze({
        schema: "pilot-cutover-alert-delivery-result-v1",
        fingerprint: candidateAlert.fingerprint,
        delivered: true,
        idempotentReplay: true,
        outcomes: Object.freeze([]),
        failClosed: false,
        monitoringAcceptanceProven: false,
        productionReady: false
      });
    }
  }
  if (!existing.some((event) => event.type === "alert-opened")) {
    appendPilotCutoverAlertEvent({
      file,
      type: "alert-opened",
      alertFingerprint: candidateAlert.fingerprint,
      actorAccount,
      recordedAt: options.now,
      details: {
        signalCode: candidateAlert.signalCode,
        severity: candidateAlert.severity,
        title: candidateAlert.title,
        summary: candidateAlert.summary,
        evidenceRefs: candidateAlert.evidenceRefs
      }
    });
  }
  const maximumAttempts = boundedInteger(
    options.maximumAttempts
      ?? options.env?.PLATFORM_PILOT_CUTOVER_ALERT_MAX_ATTEMPTS
      ?? process.env.PLATFORM_PILOT_CUTOVER_ALERT_MAX_ATTEMPTS,
    3,
    1,
    5
  );
  const outcomes = [];
  for (const route of routes) {
    let lastError;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      appendPilotCutoverAlertEvent({
        file,
        type: "delivery-attempted",
        alertFingerprint: candidateAlert.fingerprint,
        actorAccount,
        recordedAt: options.now,
        details: { route, attempt }
      });
      try {
        const receipt = await dispatcher({
          route,
          idempotencyKey: `${candidateAlert.fingerprint}:${route.toLowerCase()}`,
          alert: {
            fingerprint: candidateAlert.fingerprint,
            source: candidateAlert.source,
            severity: candidateAlert.severity,
            title: candidateAlert.title,
            summary: candidateAlert.summary,
            occurredAt: candidateAlert.occurredAt,
            labels: candidateAlert.labels,
            metrics: candidateAlert.metrics,
            evidenceRefs: candidateAlert.evidenceRefs
          }
        }, {
          env: {
            ...(options.env || process.env),
            ALERTING_MAX_ATTEMPTS: "1"
          },
          fetchImpl: options.fetchImpl,
          retryDelayMs: 0
        });
        const publicReceipt = publicDeliveryReceipt(receipt, route);
        appendPilotCutoverAlertEvent({
          file,
          type: "delivery-acknowledged",
          alertFingerprint: candidateAlert.fingerprint,
          actorAccount,
          recordedAt: options.now,
          details: { route, attempt, ...publicReceipt }
        });
        outcomes.push(Object.freeze({
          route,
          delivered: true,
          attempts: attempt,
          ...publicReceipt
        }));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const errorCode = clean(error?.code || error?.name || "MONITORING_DELIVERY_FAILED", 120);
        const errorDigest = sha256({
          route,
          errorCode,
          message: clean(error?.message, 500)
        });
        appendPilotCutoverAlertEvent({
          file,
          type: "delivery-failed",
          alertFingerprint: candidateAlert.fingerprint,
          actorAccount,
          recordedAt: options.now,
          details: {
            route,
            attempt,
            errorCode,
            errorDigest,
            retryable: error?.retryable !== false
          }
        });
        if (error?.retryable === false) break;
        if (attempt < maximumAttempts && typeof options.sleep === "function") {
          await options.sleep(Math.min(2000, 200 * (2 ** (attempt - 1))));
        }
      }
    }
    if (lastError) {
      const failedRows = readPilotCutoverAlertJournal(file)
        .filter((event) =>
          event.alertFingerprint === candidateAlert.fingerprint
          && event.type === "delivery-failed"
          && event.details.route === route);
      const finalFailure = failedRows.at(-1);
      appendPilotCutoverAlertEvent({
        file,
        type: "delivery-dead-lettered",
        alertFingerprint: candidateAlert.fingerprint,
        actorAccount,
        recordedAt: options.now,
        details: {
          route,
          attempt: finalFailure.details.attempt,
          errorCode: finalFailure.details.errorCode,
          errorDigest: finalFailure.details.errorDigest
        }
      });
      outcomes.push(Object.freeze({
        route,
        delivered: false,
        attempts: finalFailure.details.attempt,
        deadLetter: true,
        errorCode: finalFailure.details.errorCode
      }));
    }
  }
  const delivered = outcomes.length > 0 && outcomes.every((row) => row.delivered);
  return Object.freeze({
    schema: "pilot-cutover-alert-delivery-result-v1",
    fingerprint: candidateAlert.fingerprint,
    delivered,
    outcomes: Object.freeze(outcomes),
    failClosed: !delivered,
    monitoringAcceptanceProven: false,
    productionReady: false
  });
}

function pilotCutoverMonitoringAdapterStatus(options = {}) {
  let journalReady = false;
  try {
    const file = resolveJournalFile(options.file
      || options.env?.PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE
      || process.env.PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE);
    assertJournalDirectory(path.dirname(file));
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      journalReady = stat.isFile() && !stat.isSymbolicLink()
        && stat.size <= MAX_ALERT_JOURNAL_BYTES;
    } else {
      journalReady = true;
    }
  } catch {
    journalReady = false;
  }
  let routes = [];
  try {
    routes = normalizeRoutes(options.routes
      || options.env?.PLATFORM_PILOT_CUTOVER_ALERT_ROUTES
      || process.env.PLATFORM_PILOT_CUTOVER_ALERT_ROUTES);
  } catch {}
  const env = options.env || process.env;
  const routeReady = routes.map((route) => {
    const endpoint = route === "SIEM"
      ? env.SIEM_ENDPOINT
      : env.ALERT_WEBHOOK_URL;
    const signingSecret = route === "SIEM"
      ? env.SIEM_SIGNING_SECRET
      : env.ALERT_WEBHOOK_SECRET;
    return Object.freeze({
      route,
      configured: Boolean(clean(endpoint, 2048) && clean(signingSecret, 2048)),
      https: /^https:\/\//i.test(clean(endpoint, 2048))
    });
  });
  const ready = journalReady
    && routeReady.length > 0
    && routeReady.every((row) => row.configured && row.https);
  return Object.freeze({
    schema: "pilot-cutover-monitoring-adapter-status-v1",
    journalReady,
    routes: Object.freeze(routeReady),
    adapterReady: ready,
    failClosed: !ready,
    monitoringAcceptanceProven: false,
    productionReady: false,
    blockers: Object.freeze([
      ...(journalReady ? [] : ["append-only alert journal"]),
      ...routeReady.filter((row) => !row.configured || !row.https)
        .map((row) => `${row.route} HTTPS endpoint and signing secret`),
      ...(routeReady.length ? [] : ["SIEM or WEBHOOK route"]),
      "signed monitoring delivery, paging, escalation and recovery acceptance evidence"
    ])
  });
}

module.exports = {
  ALERT_EVENT_SCHEMA,
  ALERT_EVENT_TYPES,
  ALERT_GENESIS_DIGEST,
  MAX_ALERT_EVENT_BYTES,
  MAX_ALERT_JOURNAL_BYTES,
  acknowledgePilotCutoverAlert,
  appendPilotCutoverAlertEvent,
  buildPilotCutoverAlertProjection,
  deliverPilotCutoverAlert,
  derivePilotCutoverAlertCandidates,
  escalatePilotCutoverAlert,
  pilotCutoverMonitoringAdapterStatus,
  readPilotCutoverAlertJournal,
  recoverPilotCutoverAlert,
  redrivePilotCutoverAlert
};
