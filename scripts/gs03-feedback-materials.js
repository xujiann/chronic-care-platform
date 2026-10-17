#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { types: { isProxy } } = require("node:util");
const { readInput } = require("./gs03-admission");
const INPUT_VERSION = "gs03-feedback-materials-input.v1";
const GROUP_IDS = Object.freeze(Array.from({ length: 9 }, (_, i) => "S" + String(i + 1).padStart(2, "0")));
const GROUP_FIELDS = ["id", "decisionVersion", "ownerAuthorizationRef", "signoffRef", "materialIds", "dependsOn"];
const MATERIAL_FIELDS = ["recordId", "groupId", "nameRef", "version", "ownerAuthorizationRef", "controlledRef", "digestObjectRef", "sha256", "signoffRef", "accessRef", "scopeRef", "validityRef", "submissionRef", "dependencyIds"];
const PLACEHOLDER = /^(?:待定|待确认|未确定|待审批|未知|未填写|未提供|〔填写〕|tbd|todo|pending|unknown|unset|none|null|n\/a)$/i;
const MAX_ROWS = 128;

function report(issues) {
  return {
    schemaVersion: "gs03-feedback-materials-report.v1",
    metadataComplete: issues.length === 0,
    professionalSignaturesVerified: false,
    materialContentVerified: false,
    admissionAllowed: false,
    runtimeImplementationAuthorized: false,
    productionReady: false,
    productionDecision: "NO-GO",
    issues
  };
}

// These are resource/format bounds, not professional policy or approved production values.
function reference(value) {
  return typeof value === "string" && !PLACEHOLDER.test(value)
    && /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,159}$/.test(value);
}
function identifier(value) {
  return typeof value === "string" && !PLACEHOLDER.test(value)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}
function hex(value, length) {
  return typeof value === "string" && value.length === length
    && /^[0-9a-f]+$/.test(value) && !/^0+$/.test(value);
}
function cycle(graph) {
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    for (const next of graph.get(id) || []) if (graph.has(next) && visit(next)) return true;
    visiting.delete(id); done.add(id); return false;
  }
  return [...graph.keys()].some(visit);
}

function validate(input) {
  const issues = [];
  const add = (location, code) => issues.push({ path: location, code });
  function shape(value, fields, location) {
    if (value === null || typeof value !== "object" || isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      add(location, "INVALID_OBJECT"); return false;
    }
    const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.length > 32 || keys.some((key) => typeof key !== "string"
      || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) {
      add(location, "INVALID_DATA_PROPERTIES"); return false;
    }
    if (keys.some((key) => !fields.includes(key))) add(location, "UNKNOWN_FIELDS");
    const missing = fields.filter((key) => !Object.hasOwn(value, key));
    for (const key of missing) add(location + "." + key, "MISSING");
    return missing.length === 0;
  }
  function list(value, location, maximum = MAX_ROWS) {
    if (isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      add(location, "INVALID_ARRAY"); return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length.value, keys = Reflect.ownKeys(value);
    if (length > maximum || keys.length !== length + 1 || keys.some((key) => key !== "length"
      && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)
        || Number(key) >= length || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value")))) {
      add(location, "INVALID_ARRAY"); return null;
    }
    return value;
  }
  function references(value, location, predicate) {
    const values = list(value, location);
    if (!values) return [];
    if (values.some((v) => !predicate(v))) { add(location, "INVALID_REFERENCE"); return []; }
    if (new Set(values).size !== values.length) add(location, "DUPLICATE_REFERENCE");
    return values;
  }
  if (!shape(input, ["schemaVersion", "environment", "scope", "baseline", "groups", "materials"], "$")) return report(issues);
  if (input.schemaVersion !== INPUT_VERSION) add("schemaVersion", "UNSUPPORTED_VERSION");
  if (!["development", "test"].includes(input.environment)) add("environment", "NONPRODUCTION_REQUIRED");
  if (input.scope !== "feedback-only") add("scope", "FEEDBACK_ONLY_REQUIRED");
  if (shape(input.baseline, ["commit", "contractRef", "contractSha256"], "baseline")) {
    if (!hex(input.baseline.commit, 40)) add("baseline.commit", "INVALID_COMMIT");
    if (!reference(input.baseline.contractRef)) add("baseline.contractRef", "INVALID_REFERENCE");
    if (!hex(input.baseline.contractSha256, 64)) add("baseline.contractSha256", "INVALID_SHA256");
  }
  const groups = list(input.groups, "groups", 9), materials = list(input.materials, "materials");
  if (!groups || !materials) return report(issues);
  const groupMap = new Map(), materialMap = new Map();
  groups.forEach((row, i) => {
    const location = "groups[" + i + "]";
    if (!shape(row, GROUP_FIELDS, location)) return;
    if (!GROUP_IDS.includes(row.id)) add(location + ".id", "INVALID_GROUP");
    else if (groupMap.has(row.id)) add(location + ".id", "DUPLICATE_GROUP");
    else groupMap.set(row.id, { row, location });
    for (const key of ["decisionVersion", "ownerAuthorizationRef", "signoffRef"]) {
      if (!reference(row[key])) add(location + "." + key, "INVALID_REFERENCE");
    }
    const ids = references(row.materialIds, location + ".materialIds", identifier);
    if (!ids.length) add(location + ".materialIds", "MATERIAL_REQUIRED");
    references(row.dependsOn, location + ".dependsOn", (v) => GROUP_IDS.includes(v));
  });
  if (groupMap.size !== 9 || GROUP_IDS.some((id) => !groupMap.has(id))) add("groups", "GROUP_SET_MISMATCH");
  materials.forEach((row, i) => {
    const location = "materials[" + i + "]";
    if (!shape(row, MATERIAL_FIELDS, location)) return;
    if (!identifier(row.recordId)) add(location + ".recordId", "INVALID_IDENTIFIER");
    else if (materialMap.has(row.recordId)) add(location + ".recordId", "DUPLICATE_MATERIAL");
    else materialMap.set(row.recordId, { row, location });
    if (!GROUP_IDS.includes(row.groupId)) add(location + ".groupId", "INVALID_GROUP");
    for (const key of MATERIAL_FIELDS.filter((key) => !["recordId", "groupId", "sha256", "dependencyIds"].includes(key))) {
      if (!reference(row[key])) add(location + "." + key, "INVALID_REFERENCE");
    }
    if (!hex(row.sha256, 64)) add(location + ".sha256", "INVALID_SHA256");
    references(row.dependencyIds, location + ".dependencyIds", identifier);
  });
  // Do not traverse a malformed graph or invoke any rejected data properties.
  if (issues.length) return report(issues);
  const referenced = new Set();
  for (const [id, { row, location }] of groupMap) {
    for (const dependency of row.dependsOn) {
      if (dependency === id) add(location + ".dependsOn", "SELF_DEPENDENCY");
    }
    for (const materialId of row.materialIds) {
      const material = materialMap.get(materialId);
      if (!material) add(location + ".materialIds", "DANGLING_REFERENCE");
      else if (material.row.groupId !== id) add(location + ".materialIds", "GROUP_MISMATCH");
      else referenced.add(materialId);
    }
  }
  for (const [id, { row, location }] of materialMap) {
    if (!referenced.has(id)) add(location + ".recordId", "ORPHAN_MATERIAL");
    for (const dependency of row.dependencyIds) {
      const target = materialMap.get(dependency);
      if (dependency === id) add(location + ".dependencyIds", "SELF_DEPENDENCY");
      if (!target) add(location + ".dependencyIds", "DANGLING_REFERENCE");
      else if (target.row.groupId !== row.groupId && !groupMap.get(row.groupId).row.dependsOn.includes(target.row.groupId)) {
        add(location + ".dependencyIds", "GROUP_DEPENDENCY_UNDECLARED");
      }
    }
  }
  if (cycle(new Map([...groupMap].map(([id, entry]) => [id, entry.row.dependsOn])))) add("groups", "DEPENDENCY_CYCLE");
  if (cycle(new Map([...materialMap].map(([id, entry]) => [id, entry.row.dependencyIds])))) add("materials", "DEPENDENCY_CYCLE");
  return report(issues);
}

function validateFeedbackMaterials(input) {
  try { return validate(input); }
  catch { return report([{ path: "$", code: "INVALID_DATA_PROPERTIES" }]); }
}
function runCli(args = process.argv.slice(2)) {
  if (!Array.isArray(args) || !(args.length === 0 || (args.length === 2 && args[0] === "--input"
    && typeof args[1] === "string" && args[1] && !args[1].startsWith("--")))) {
    return { exitCode: 2, report: report([{ path: "$", code: "INVALID_ARGUMENTS" }]) };
  }
  try {
    const input = readInput(args[1] || path.join(__dirname, "../config/gs03-feedback-materials.example.json"));
    const result = validateFeedbackMaterials(input);
    return { exitCode: result.metadataComplete ? 0 : 1, report: result };
  } catch {
    return { exitCode: 2, report: report([{ path: "$", code: "INPUT_UNREADABLE" }]) };
  }
}
if (require.main === module) {
  const result = runCli();
  process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
  process.exitCode = result.exitCode;
}
module.exports = { validateFeedbackMaterials, runCli, INPUT_VERSION };
