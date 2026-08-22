#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  readBoundedJsonFile,
  signedEnvelopeSubject,
  validateTrustAnchors,
  verifySignedEnvelope
} = require("../src/platform/governance/production-evidence-trust-provider");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REGISTER = path.join(ROOT, "config", "production-cutover-actions.json");
const DEFINITION_SCHEMA = "production-cutover-action-definitions-v2";
const EVIDENCE_SCHEMA = "production-cutover-action-evidence-decision-v2";
const ACTION_EVIDENCE_PURPOSE = "production-cutover-action-verification.v2";
const ACTION_REQUIRED_ROLES = Object.freeze(["action-evidence-custodian", "independent-release-verifier"]);
const REQUIRED_CUTOVER_IDS = [
  "cutover-env-file", "cutover-identity", "cutover-audit-retention", "cutover-storage-adapter",
  "cutover-institution-interfaces", "cutover-chronic-launch-core", "cutover-insurance-certificate",
  "cutover-monitoring", "cutover-dr-rehearsal"
];
const REQUIRED_EVIDENCE_IDS = ["security-assessment", "monitoring-drill", "dr-rehearsal", "site-acceptance", "go-no-go"];
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CONTROLLED_REF = /^controlled:\/\/[A-Za-z0-9._~!$&'()*+,;=:@/-]{1,480}$/;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail: String(detail || "") };
}

function exactIdSet(rows, expected) {
  const ids = Array.isArray(rows) ? rows.map((item) => item?.id) : [];
  return ids.length === expected.length && new Set(ids).size === ids.length && expected.every((id) => ids.includes(id));
}

function containsSensitiveMaterial(value, currentPath = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...containsSensitiveMaterial(item, `${currentPath}[${index}]`)));
    return findings;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      const itemPath = `${currentPath}.${key}`;
      if (/(?:password|secret|token|private[_-]?key|credential)/i.test(key)) findings.push(itemPath);
      findings.push(...containsSensitiveMaterial(item, itemPath));
    });
    return findings;
  }
  if (typeof value === "string" && (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || /(?:password|secret|token)\s*[=:]\s*[^\s]+/i.test(value)
    || /https?:\/\/[^/\s:@]+:[^@\s]+@/i.test(value)
  )) findings.push(currentPath);
  return findings;
}

function parseTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  return Date.parse(value);
}

function actionShapeValid(item, requireBlocker) {
  return Boolean(
    item && typeof item.owner === "string" && item.owner.trim()
    && Number.isSafeInteger(item.issue) && item.issue > 0
    && !("status" in item)
    && (!requireBlocker || (typeof item.blocker === "string" && item.blocker.trim()))
    && Array.isArray(item.requiredEvidence) && item.requiredEvidence.length > 0
    && item.requiredEvidence.every((entry) => typeof entry === "string" && entry.trim())
    && Array.isArray(item.verificationCommands) && item.verificationCommands.length > 0
    && item.verificationCommands.every((entry) => /^(?:npm run|node )/.test(entry))
  );
}

function buildActionRegisterReport(register, options = {}) {
  const cutoverActions = Array.isArray(register?.cutoverActions) ? register.cutoverActions : [];
  const evidenceActions = Array.isArray(register?.evidenceActions) ? register.evidenceActions : [];
  const allActions = [...cutoverActions, ...evidenceActions];
  const sensitive = containsSensitiveMaterial(register);
  const now = new Date(options.now || Date.now()).getTime();
  const asOf = Date.parse(`${register?.asOf || ""}T00:00:00.000Z`);
  const reviewAfter = Date.parse(`${register?.reviewAfter || ""}T23:59:59.999Z`);
  const checks = [
    check("actionRegister:schema", register?.schemaVersion === DEFINITION_SCHEMA, register?.schemaVersion || "missing schema"),
    check("actionRegister:defaultDecision", register?.policy?.defaultDecision === "NO-GO", register?.policy?.defaultDecision || "missing decision"),
    check("actionRegister:definitionOnly", register?.policy?.definitionStatusIsAuthoritative === false && allActions.every((item) => !("status" in (item || {}))), "committed definitions cannot assert evidence status"),
    check("actionRegister:reviewWindow", Number.isFinite(asOf) && Number.isFinite(reviewAfter) && asOf <= now + CALENDAR_DAY_MS && reviewAfter >= now, register?.reviewAfter || "missing or stale reviewAfter"),
    check("actionRegister:cutoverCoverage", exactIdSet(cutoverActions, REQUIRED_CUTOVER_IDS), `${cutoverActions.length}/${REQUIRED_CUTOVER_IDS.length} cutover blockers tracked`),
    check("actionRegister:evidenceCoverage", exactIdSet(evidenceActions, REQUIRED_EVIDENCE_IDS), `${evidenceActions.length}/${REQUIRED_EVIDENCE_IDS.length} evidence documents tracked`),
    check("actionRegister:cutoverShape", cutoverActions.every((item) => actionShapeValid(item, true)), "owners, issues, blockers, evidence and commands are required; status is forbidden"),
    check("actionRegister:evidenceShape", evidenceActions.every((item) => actionShapeValid(item, false)), "owners, issues, evidence and commands are required; status is forbidden"),
    check("actionRegister:secretBoundary", sensitive.length === 0, sensitive.length ? sensitive.join(", ") : "no embedded credentials or secret-bearing keys")
  ];
  return {
    schemaVersion: DEFINITION_SCHEMA,
    ok: checks.every((item) => item.passed),
    status: "definitions-only-no-go",
    productionReady: false,
    summary: { actions: allActions.length, externallyEvaluated: 0, verified: 0, issues: new Set(allActions.map((item) => item.issue)).size },
    checks
  };
}

function sha256Json(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function normalizedDecisionValid(decision, action, manifest, now) {
  const verifiedAt = parseTimestamp(decision?.verifiedAt);
  const validUntil = parseTimestamp(decision?.validUntil);
  const signerIds = Array.isArray(decision?.signerIds) ? decision.signerIds : [];
  return Boolean(
    decision?.schemaVersion === EVIDENCE_SCHEMA && decision?.verified === true
    && IDENTIFIER.test(String(decision?.decisionId || ""))
    && decision?.actionId === action.id && decision?.releaseId === manifest?.releaseId
    && String(decision?.artifactDigest || "").toLowerCase() === String(manifest?.artifact?.digest || "").toLowerCase()
    && decision?.previousState === "evidence-submitted" && decision?.effectiveState === "verified"
    && SHA256.test(String(decision?.previousTransitionDigest || ""))
    && SHA256.test(String(decision?.evidenceDigest || ""))
    && SHA256.test(String(decision?.evidenceFingerprint || ""))
    && SHA256.test(String(decision?.commandReceiptDigest || ""))
    && SHA256.test(String(decision?.envelopeDigest || ""))
    && CONTROLLED_REF.test(String(decision?.evidenceRef || ""))
    && Number.isFinite(verifiedAt) && Number.isFinite(validUntil)
    && verifiedAt <= now + CLOCK_SKEW_MS && validUntil > now
    && typeof decision?.evidenceProducerRole === "string" && decision.evidenceProducerRole !== action.owner
    && typeof decision?.verifierRole === "string" && decision.verifierRole !== action.owner
    && decision.verifierRole !== decision.evidenceProducerRole
    && signerIds.length >= 2 && new Set(signerIds).size === signerIds.length
    && signerIds.every((item) => typeof item === "string" && /^[A-Za-z0-9._:@/-]{3,160}$/.test(item))
  );
}

function actionTrustError(code) {
  return Object.assign(new Error("production cutover action verification failed closed"), { code, statusCode: 400 });
}

function actionEvidenceConfig(env = process.env) {
  const directory = path.resolve(String(env.PRODUCTION_CUTOVER_ACTION_EVIDENCE_DIR || ""));
  const anchorsFile = path.resolve(String(env.PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE || ""));
  const expectedAnchorsDigest = String(env.PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256 || "").trim().toLowerCase();
  if (!path.isAbsolute(String(env.PRODUCTION_CUTOVER_ACTION_EVIDENCE_DIR || ""))
    || !path.isAbsolute(String(env.PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE || ""))
    || !SHA256.test(expectedAnchorsDigest)) {
    throw actionTrustError("ACTION_EVIDENCE_CONFIGURATION_INVALID");
  }
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch {
    throw actionTrustError("ACTION_EVIDENCE_DIRECTORY_UNAVAILABLE");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw actionTrustError("ACTION_EVIDENCE_DIRECTORY_INVALID");
  }
  return Object.freeze({ directory, anchorsFile, expectedAnchorsDigest });
}

function validateActionEvidenceRecord(record, context = {}) {
  const allowed = new Set([
    "schema", "decisionId", "actionId", "releaseId", "artifactDigest", "previousState", "effectiveState",
    "previousTransitionDigest", "evidenceRef", "evidenceDigest", "evidenceFingerprint", "commandReceiptDigest",
    "evidenceProducerRole", "issuedAt", "validUntil"
  ]);
  if (!record || typeof record !== "object" || Array.isArray(record)
    || Object.keys(record).some((key) => !allowed.has(key))
    || record.schema !== EVIDENCE_SCHEMA
    || !IDENTIFIER.test(String(record.decisionId || ""))
    || record.actionId !== context.action?.id
    || record.releaseId !== context.manifest?.releaseId
    || String(record.artifactDigest || "").toLowerCase() !== String(context.manifest?.artifact?.digest || "").toLowerCase()
    || record.previousState !== "evidence-submitted"
    || record.effectiveState !== "verified"
    || !SHA256.test(String(record.previousTransitionDigest || ""))
    || !CONTROLLED_REF.test(String(record.evidenceRef || ""))
    || !SHA256.test(String(record.evidenceDigest || ""))
    || !SHA256.test(String(record.evidenceFingerprint || ""))
    || !SHA256.test(String(record.commandReceiptDigest || ""))
    || !IDENTIFIER.test(String(record.evidenceProducerRole || ""))
    || record.evidenceProducerRole === context.action?.owner
    || !Number.isFinite(parseTimestamp(record.issuedAt))
    || !Number.isFinite(parseTimestamp(record.validUntil))) {
    throw actionTrustError("ACTION_EVIDENCE_RECORD_INVALID");
  }
  return record;
}

function loadActionTrustMaterial(config) {
  const anchorsFile = readBoundedJsonFile(config.anchorsFile);
  if (anchorsFile.digest !== config.expectedAnchorsDigest) {
    throw actionTrustError("ACTION_EVIDENCE_ANCHOR_DIGEST_MISMATCH");
  }
  return Object.freeze({ anchors: validateTrustAnchors(anchorsFile.document), anchorsDigest: anchorsFile.digest });
}

function loadActionEvidenceRecords(config, actions) {
  const records = {};
  const errors = {};
  const expectedFiles = new Set(actions.map((action) => `${action.id}.json`));
  const unexpectedFiles = fs.readdirSync(config.directory).filter((name) => !expectedFiles.has(name));
  if (unexpectedFiles.length > 0) {
    actions.forEach((action) => { errors[action.id] = "ACTION_EVIDENCE_DIRECTORY_CONTENT_INVALID"; });
    return Object.freeze({ records: Object.freeze(records), errors: Object.freeze(errors) });
  }
  for (const action of actions) {
    const file = path.join(config.directory, `${action.id}.json`);
    if (path.dirname(file) !== config.directory) {
      errors[action.id] = "ACTION_EVIDENCE_PATH_INVALID";
      continue;
    }
    try {
      records[action.id] = readBoundedJsonFile(file).document;
    } catch (error) {
      errors[action.id] = error?.code === "PRODUCTION_EVIDENCE_TRUST_FILE_UNAVAILABLE"
        ? "ACTION_EVIDENCE_FILE_UNAVAILABLE"
        : "ACTION_EVIDENCE_FILE_INVALID";
    }
  }
  return Object.freeze({ records: Object.freeze(records), errors: Object.freeze(errors) });
}

function createFileBackedCutoverActionEvidenceVerifier(options = {}) {
  const config = actionEvidenceConfig(options.env || process.env);
  const material = loadActionTrustMaterial(config);
  return async function verifyCutoverActionEvidence(context = {}) {
    const result = verifySignedEnvelope({
      envelope: context.envelope,
      anchors: material.anchors,
      expectedPurpose: ACTION_EVIDENCE_PURPOSE,
      requiredRoles: ACTION_REQUIRED_ROLES,
      validateRecord: (record) => validateActionEvidenceRecord(record, context),
      expectedRecord: {
        schema: EVIDENCE_SCHEMA,
        actionId: context.action?.id,
        releaseId: context.manifest?.releaseId,
        artifactDigest: String(context.manifest?.artifact?.digest || "").toLowerCase()
      },
      now: typeof options.now === "function" ? options.now() : options.now
    });
    return Object.freeze({
      schemaVersion: EVIDENCE_SCHEMA,
      verified: true,
      ...result.record,
      verifiedAt: result.record.issuedAt,
      verifierRole: "independent-release-verifier",
      signerIds: result.signerIds,
      envelopeDigest: result.envelopeDigest
    });
  };
}

function resolveCutoverActionEvidenceProvider(env, actions, options = {}) {
  if (typeof options.externalActionEvidenceVerifier === "function") {
    return Object.freeze({
      configured: true,
      source: "injected",
      verifier: options.externalActionEvidenceVerifier,
      records: options.cutoverActionEvidenceRecords || {},
      errors: {}
    });
  }
  try {
    const config = actionEvidenceConfig(env);
    const loaded = loadActionEvidenceRecords(config, actions);
    return Object.freeze({
      configured: true,
      source: "controlled-files",
      verifier: createFileBackedCutoverActionEvidenceVerifier({ env, now: options.now }),
      records: loaded.records,
      errors: loaded.errors
    });
  } catch {
    return Object.freeze({ configured: false, source: "unavailable", verifier: undefined, records: {}, errors: {} });
  }
}

async function buildEffectiveActionReport(register, options = {}) {
  const definitions = buildActionRegisterReport(register, options);
  const actions = [...(register?.cutoverActions || []), ...(register?.evidenceActions || [])];
  const records = options.evidenceRecords && typeof options.evidenceRecords === "object" ? options.evidenceRecords : {};
  const evidenceErrors = options.evidenceErrors && typeof options.evidenceErrors === "object" ? options.evidenceErrors : {};
  const verifier = options.externalEvidenceVerifier;
  const now = new Date(options.now || Date.now()).getTime();
  const results = [];
  for (const action of actions) {
    const envelope = records[action.id];
    let decision = null;
    let errorCode = evidenceErrors[action.id]
      || (envelope ? "ACTION_EVIDENCE_VERIFIER_UNAVAILABLE" : "ACTION_EVIDENCE_MISSING");
    if (envelope && typeof verifier === "function") {
      try {
        const candidate = await verifier({ action, envelope, manifest: options.manifest, now: new Date(now).toISOString() });
        if (normalizedDecisionValid(candidate, action, options.manifest, now)) {
          decision = candidate;
          errorCode = "";
        } else errorCode = "ACTION_EVIDENCE_DECISION_INVALID";
      } catch {
        errorCode = "ACTION_EVIDENCE_VERIFICATION_FAILED";
      }
    }
    results.push({
      actionId: action.id,
      effectiveStatus: decision ? "verified" : "blocked-external",
      decisionId: decision?.decisionId || "",
      envelopeDigest: decision?.envelopeDigest || "",
      evidenceDigest: decision?.evidenceDigest || "",
      evidenceFingerprint: decision?.evidenceFingerprint || "",
      commandReceiptDigest: decision?.commandReceiptDigest || "",
      verifiedAt: decision?.verifiedAt || "",
      validUntil: decision?.validUntil || "",
      errorCode
    });
  }
  const productionReady = definitions.ok && results.length === actions.length && results.every((item) => item.effectiveStatus === "verified");
  const projection = results.map((item) => ({ ...item }));
  return {
    schemaVersion: "production-cutover-action-evaluation-v2",
    ok: definitions.ok,
    status: productionReady ? "verified-for-bound-release" : "tracked-no-go",
    productionReady,
    releaseId: options.manifest?.releaseId || "",
    artifactDigest: options.manifest?.artifact?.digest || "",
    reportDigest: sha256Json(projection),
    summary: {
      actions: actions.length,
      externallyEvaluated: results.filter((item) => item.errorCode !== "ACTION_EVIDENCE_MISSING").length,
      verified: results.filter((item) => item.effectiveStatus === "verified").length,
      blocked: results.filter((item) => item.effectiveStatus !== "verified").length
    },
    definitions: { ok: definitions.ok, checks: definitions.checks },
    actions: results,
    boundary: "Committed action definitions never prove completion. Effective status requires externally verified, current, release-bound evidence decisions."
  };
}

function loadRegister(file = DEFAULT_REGISTER) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (require.main === module) {
  try {
    const report = buildActionRegisterReport(loadRegister(process.argv[2]));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch {
    process.stderr.write("production cutover action definitions are invalid\n");
    process.exitCode = 1;
  }
}

module.exports = {
  DEFINITION_SCHEMA,
  EVIDENCE_SCHEMA,
  REQUIRED_CUTOVER_IDS,
  REQUIRED_EVIDENCE_IDS,
  buildActionRegisterReport,
  buildEffectiveActionReport,
  ACTION_EVIDENCE_PURPOSE,
  ACTION_REQUIRED_ROLES,
  actionEvidenceConfig,
  containsSensitiveMaterial,
  createFileBackedCutoverActionEvidenceVerifier,
  loadActionEvidenceRecords,
  loadActionTrustMaterial,
  loadRegister,
  normalizedDecisionValid,
  resolveCutoverActionEvidenceProvider,
  signedEnvelopeSubject,
  validateActionEvidenceRecord
};
