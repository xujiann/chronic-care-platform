"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_POLICY_PATH = path.join(ROOT, "config", "regional-hardcode-baseline.json");

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function countMatches(source, pattern) {
  return [...String(source).matchAll(new RegExp(pattern, "giu"))].length;
}

function discoverFiles(root, policy, directory = root, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!policy.excludedDirectories.includes(entry.name)) discoverFiles(root, policy, absolutePath, output);
      continue;
    }
    if (policy.scopeExtensions.includes(path.extname(entry.name).toLowerCase())) output.push(absolutePath);
  }
  return output;
}

function collectFindings(root, policy) {
  return Object.fromEntries(discoverFiles(root, policy)
    .map((absolutePath) => {
      const count = countMatches(fs.readFileSync(absolutePath, "utf8"), policy.pattern);
      return [normalizePath(path.relative(root, absolutePath)), count];
    })
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function compareFindings(findings, baseline) {
  const violations = [];
  const reductions = [];
  for (const [file, count] of Object.entries(findings)) {
    const allowed = Number(baseline[file] || 0);
    if (count > allowed) violations.push({ file, count, allowed, added: count - allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = Number(findings[file] || 0);
    if (count < allowed) reductions.push({ file, count, allowed, removed: allowed - count });
  }
  return { violations, reductions };
}

function auditRegionalHardcodes(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const policyPath = path.resolve(options.policyPath || DEFAULT_POLICY_PATH);
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  if (policy.schemaVersion !== "regional-hardcode-baseline-v1") {
    throw new TypeError("regional hardcode baseline schemaVersion is invalid");
  }
  const findings = collectFindings(root, policy);
  const comparison = compareFindings(findings, policy.files);
  return { root, policyPath, policy, findings, ...comparison };
}

function runCli() {
  const result = auditRegionalHardcodes();
  result.reductions.forEach((item) => {
    console.log(`regional hardcode reduced: ${item.file} ${item.allowed} -> ${item.count}`);
  });
  if (result.violations.length) {
    result.violations.forEach((item) => {
      console.error(`regional hardcode violation: ${item.file} ${item.count} > ${item.allowed} (+${item.added})`);
    });
    process.exitCode = 1;
    return;
  }
  const current = Object.values(result.findings).reduce((sum, count) => sum + count, 0);
  const baseline = Object.values(result.policy.files).reduce((sum, count) => sum + Number(count), 0);
  console.log(`regional hardcode audit ok: ${current}/${baseline} legacy matches; new matches are blocked`);
}

if (require.main === module) runCli();

module.exports = {
  auditRegionalHardcodes,
  collectFindings,
  compareFindings,
  countMatches,
  discoverFiles,
  normalizePath
};
