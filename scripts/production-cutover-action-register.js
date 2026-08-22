#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REGISTER = path.join(ROOT, "config", "production-cutover-actions.json");
const DEFINITION_SCHEMA = "production-cutover-action-definitions-v2";
const EVIDENCE_SCHEMA = "production-cutover-action-evidence-decision-v2";
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
    && decision?.actionId === action.id && decision?.releaseId === manifest?.releaseId
    && String(decision?.artifactDigest || "").toLowerCase() === String(manifest?.artifact?.digest || "").toLowerCase()
    && decision?.previousState === "evidence-submitted" && decision?.effectiveState === "verified"
    && SHA256.test(String(decision?.previousTransitionDigest || ""))
    && SHA256.test(String(decision?.evidenceDigest || ""))
    && SHA256.test(String(decision?.evidenceFingerprint || ""))
    && SHA256.test(String(decision?.commandReceiptDigest || ""))
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

async function buildEffectiveActionReport(register, options = {}) {
  const definitions = buildActionRegisterReport(register, options);
  const actions = [...(register?.cutoverActions || []), ...(register?.evidenceActions || [])];
  const records = options.evidenceRecords && typeof options.evidenceRecords === "object" ? options.evidenceRecords : {};
  const verifier = options.externalEvidenceVerifier;
  const now = new Date(options.now || Date.now()).getTime();
  const results = [];
  for (const action of actions) {
    const envelope = records[action.id];
    let decision = null;
    let errorCode = envelope ? "ACTION_EVIDENCE_VERIFIER_UNAVAILABLE" : "ACTION_EVIDENCE_MISSING";
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
  containsSensitiveMaterial,
  loadRegister,
  normalizedDecisionValid
};
