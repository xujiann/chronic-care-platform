#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 64 * 1024;
const INPUT_VERSION = "gs03-admission-input.v1";
const REQUIRED = Object.freeze({
  owners: Object.freeze({ authorizationRef: "ref", identityRef: "ref", storageRef: "ref", privacyRef: "ref", recoveryRef: "ref", decisionRef: "ref" }),
  identity: Object.freeze({ principalNamespaceRef: "ref", accountInstitutionBindingRef: "ref", crossPrincipalPolicyRef: "ref" }),
  protocol: Object.freeze({ version: "ref", contracts: "contracts", canonicalizationRef: "ref", signatureRef: "ref", receiptProjectionRef: "ref" }),
  transaction: Object.freeze({ authorityRef: "ref", writerInventoryRef: "ref", ownerResponsibilitiesRef: "ref", externalScopeFenceRef: "ref" }),
  retention: Object.freeze({ policyRef: "ref", periodDays: "positive", keyExpiryPolicyRef: "ref", privacyDeletionPolicyRef: "ref", capacityRef: "ref" }),
  recovery: Object.freeze({ policyRef: "ref", rpoSeconds: "nonnegative", rtoSeconds: "positive", sourceGenerationRef: "ref", reconciliationRef: "ref" })
});
const CONTRACTS = Object.freeze(["feedback", "schedule", "report"]);
const PLACEHOLDER = /^(?:待定|待确认|未确定|待审批|未知|tbd|todo|pending|unknown|unset|none|null|n\/a|未填写|未提供)$/i;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function reference(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 160
    && value === value.trim() && !PLACEHOLDER.test(value)
    && /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/.test(value);
}

function report(issues) {
  return {
    schemaVersion: "gs03-admission-report.v1",
    documentationComplete: issues.length === 0,
    eligibleForManualReview: issues.length === 0,
    admissionAllowed: false,
    runtimeImplementationAuthorized: false,
    productionReady: false,
    productionDecision: "NO-GO",
    issues
  };
}

// Only JSON-shaped metadata. References are opaque, untrusted claims, not authority.
function validateAdmission(input) {
  const issues = [];
  const add = (field, code) => issues.push({ path: field, code });
  function shape(value, fields, location) {
    if (!record(value)) { add(location, "INVALID_OBJECT"); return false; }
    if (Object.keys(value).some((key) => !fields.includes(key))) add(location, "UNKNOWN_FIELDS");
    return true;
  }
  if (!shape(input, ["schemaVersion", "environment", ...Object.keys(REQUIRED)], "$")) return report(issues);
  if (input.schemaVersion !== INPUT_VERSION) add("schemaVersion", "UNSUPPORTED_VERSION");
  if (!["development", "test"].includes(input.environment)) add("environment", "NONPRODUCTION_REQUIRED");
  for (const [section, fields] of Object.entries(REQUIRED)) {
    if (!Object.hasOwn(input, section)) { add(section, "MISSING"); continue; }
    const row = input[section];
    if (!shape(row, ["status", ...Object.keys(fields)], section)) continue;
    if (row.status !== "documented") add(section + ".status", "DOCUMENTATION_PENDING");
    for (const [field, kind] of Object.entries(fields)) {
      const location = section + "." + field;
      if (!Object.hasOwn(row, field)) { add(location, "MISSING"); continue; }
      const value = row[field];
      if (value === null || (typeof value === "string" && (!value.trim() || PLACEHOLDER.test(value.trim())))) {
        add(location, "UNRESOLVED"); continue;
      }
      if (kind === "ref" && !reference(value)) add(location, "INVALID_REFERENCE");
      if (kind === "positive" || kind === "nonnegative") {
        if (!Number.isSafeInteger(value) || value < (kind === "positive" ? 1 : 0)) add(location, "INVALID_INTEGER");
      }
      if (kind === "contracts" && (!Array.isArray(value) || value.length !== CONTRACTS.length
        || new Set(value).size !== CONTRACTS.length || !CONTRACTS.every((id) => value.includes(id)))) {
        add(location, "CONTRACT_SET_MISMATCH");
      }
    }
  }
  return report(issues);
}

function readInput(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES) throw new Error("input unavailable");
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size > MAX_BYTES || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error("input unavailable");
    }
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    let count;
    do {
      count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      length += count;
    } while (count && length < bytes.length);
    if (length > MAX_BYTES) throw new Error("input unavailable");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { fs.closeSync(descriptor); }
}

function runCli(args = process.argv.slice(2)) {
  if (!(args.length === 0 || (args.length === 2 && args[0] === "--input" && args[1] && !args[1].startsWith("--")))) {
    return { exitCode: 2, report: report([{ path: "$", code: "INVALID_ARGUMENTS" }]) };
  }
  try {
    const input = readInput(args[1] || path.join(__dirname, "../config/gs03-admission.example.json"));
    const result = validateAdmission(input);
    return { exitCode: result.documentationComplete ? 0 : 1, report: result };
  } catch {
    return { exitCode: 2, report: report([{ path: "$", code: "INPUT_UNREADABLE" }]) };
  }
}

if (require.main === module) {
  const result = runCli();
  process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
  process.exitCode = result.exitCode;
}

module.exports = { validateAdmission, runCli, REQUIRED, INPUT_VERSION, MAX_BYTES };
