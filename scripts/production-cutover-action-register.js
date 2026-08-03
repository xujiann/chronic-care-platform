#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REGISTER = path.join(ROOT, "config", "production-cutover-actions.json");
const REQUIRED_CUTOVER_IDS = [
  "cutover-env-file",
  "cutover-identity",
  "cutover-audit-retention",
  "cutover-storage-adapter",
  "cutover-institution-interfaces",
  "cutover-chronic-launch-core",
  "cutover-insurance-certificate",
  "cutover-monitoring",
  "cutover-dr-rehearsal"
];
const REQUIRED_EVIDENCE_IDS = [
  "security-assessment",
  "monitoring-drill",
  "dr-rehearsal",
  "site-acceptance",
  "go-no-go"
];
const ALLOWED_STATUSES = new Set(["blocked-external", "evidence-submitted", "verified"]);

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail: String(detail || "") };
}

function exactIdSet(rows, expected) {
  const ids = Array.isArray(rows) ? rows.map((item) => item?.id) : [];
  return ids.length === expected.length
    && new Set(ids).size === ids.length
    && expected.every((id) => ids.includes(id));
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

function actionShapeValid(item, requireBlocker) {
  return Boolean(
    item
    && typeof item.owner === "string"
    && item.owner.trim()
    && Number.isSafeInteger(item.issue)
    && item.issue > 0
    && ALLOWED_STATUSES.has(item.status)
    && (!requireBlocker || (typeof item.blocker === "string" && item.blocker.trim()))
    && Array.isArray(item.requiredEvidence)
    && item.requiredEvidence.length > 0
    && item.requiredEvidence.every((entry) => typeof entry === "string" && entry.trim())
    && Array.isArray(item.verificationCommands)
    && item.verificationCommands.length > 0
    && item.verificationCommands.every((entry) => /^(?:npm run|node )/.test(entry))
  );
}

function buildActionRegisterReport(register) {
  const cutoverActions = Array.isArray(register?.cutoverActions) ? register.cutoverActions : [];
  const evidenceActions = Array.isArray(register?.evidenceActions) ? register.evidenceActions : [];
  const sensitive = containsSensitiveMaterial(register);
  const checks = [
    check("actionRegister:schema", register?.schemaVersion === "production-cutover-actions-v1", register?.schemaVersion || "missing schema"),
    check("actionRegister:defaultDecision", register?.policy?.defaultDecision === "NO-GO", register?.policy?.defaultDecision || "missing decision"),
    check("actionRegister:cutoverCoverage", exactIdSet(cutoverActions, REQUIRED_CUTOVER_IDS), `${cutoverActions.length}/${REQUIRED_CUTOVER_IDS.length} cutover blockers tracked`),
    check("actionRegister:evidenceCoverage", exactIdSet(evidenceActions, REQUIRED_EVIDENCE_IDS), `${evidenceActions.length}/${REQUIRED_EVIDENCE_IDS.length} evidence documents tracked`),
    check("actionRegister:cutoverShape", cutoverActions.every((item) => actionShapeValid(item, true)), "owners, issues, blockers, evidence and commands are required"),
    check("actionRegister:evidenceShape", evidenceActions.every((item) => actionShapeValid(item, false)), "owners, issues, evidence and commands are required"),
    check("actionRegister:secretBoundary", sensitive.length === 0, sensitive.length ? sensitive.join(", ") : "no embedded credentials or secret-bearing keys")
  ];
  const allActions = [...cutoverActions, ...evidenceActions];
  const productionReady = allActions.length > 0 && allActions.every((item) => item.status === "verified");
  return {
    ok: checks.every((item) => item.passed),
    status: productionReady ? "ready-for-final-decision" : "tracked-no-go",
    productionReady,
    summary: {
      actions: allActions.length,
      externalBlocked: allActions.filter((item) => item.status === "blocked-external").length,
      evidenceSubmitted: allActions.filter((item) => item.status === "evidence-submitted").length,
      verified: allActions.filter((item) => item.status === "verified").length,
      issues: new Set(allActions.map((item) => item.issue)).size
    },
    checks
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
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_CUTOVER_IDS,
  REQUIRED_EVIDENCE_IDS,
  buildActionRegisterReport,
  containsSensitiveMaterial,
  loadRegister
};
