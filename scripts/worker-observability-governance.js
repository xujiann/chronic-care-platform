#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const inventory = require("../config/worker-observability-contract.json");
const {
  validateInventory
} = require("../src/platform/operations/worker-observability-contract");

const ROOT = path.resolve(__dirname, "..");

function relative(file) {
  return String(file || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function regularTrackedSource(file) {
  const normalized = relative(file);
  const absolute = path.resolve(ROOT, normalized);
  const inside = path.relative(ROOT, absolute);
  return Boolean(normalized)
    && !inside.startsWith(`..${path.sep}`)
    && inside !== ".."
    && !path.isAbsolute(inside)
    && fs.existsSync(absolute)
    && fs.statSync(absolute).isFile();
}

function deployedWorkerEntrypoints(root = ROOT) {
  const deploy = path.join(root, "deploy");
  const entries = [];
  const visit = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) visit(absolute);
      if (!item.isFile() || !item.name.endsWith(".service.template")) continue;
      const body = fs.readFileSync(absolute, "utf8");
      for (const line of body.split(/\r?\n/).filter((value) => value.startsWith("ExecStart="))) {
        for (const match of line.matchAll(/(?:^|\s|\/)(scripts\/[A-Za-z0-9._/-]+\.js)(?=\s|$)/g)) {
          entries.push(relative(match[1]));
        }
      }
    }
  };
  visit(deploy);
  return [...new Set(entries)].sort();
}

function inspectWorkerObservabilityGovernance(options = {}) {
  const source = options.inventory || inventory;
  const checks = [];
  let inventoryReport;
  try {
    inventoryReport = validateInventory(source);
    checks.push({ id: "worker-observability:inventory", passed: true });
  } catch {
    inventoryReport = { profileCount: 0 };
    checks.push({ id: "worker-observability:inventory", passed: false });
  }
  const profiles = Array.isArray(source.profiles) ? source.profiles : [];
  const declaredEntrypoints = new Set(profiles.flatMap((profile) => profile.entrypoints || []).map(relative));
  const deployed = options.deployedEntrypoints || deployedWorkerEntrypoints(options.root || ROOT);
  checks.push({
    id: "worker-observability:deployed-entrypoints",
    passed: deployed.every((entrypoint) => declaredEntrypoints.has(entrypoint))
  });
  checks.push({
    id: "worker-observability:source-files",
    passed: profiles.every((profile) => [...profile.entrypoints, ...profile.implementationSources].every(regularTrackedSource))
  });
  checks.push({
    id: "worker-observability:adapter-integration",
    passed: profiles.every((profile) => [...profile.entrypoints, ...profile.implementationSources].some((file) => {
      if (!regularTrackedSource(file)) return false;
      const body = fs.readFileSync(path.resolve(ROOT, file), "utf8");
      return body.includes("attachWorkerObservability") && body.includes(`\"${profile.id}\"`);
    }))
  });
  checks.push({
    id: "worker-observability:no-proposed-object-storage-runtime",
    passed: profiles.every((profile) => !/object-storage/i.test(profile.id))
      && source.excludedWorkerLikeAssets?.some((item) => item.path === "object-storage-command-worker-v2")
  });
  checks.push({
    id: "worker-observability:production-authority",
    passed: source.productionAuthorization === "never"
  });
  return Object.freeze({
    schemaVersion: "worker-observability-governance-report-v1",
    ok: checks.every((item) => item.passed),
    contractVersion: source.contractVersion || "",
    profileCount: inventoryReport.profileCount || profiles.length,
    deployedEntrypointCount: deployed.length,
    checks: Object.freeze(checks.map((item) => Object.freeze(item))),
    productionReady: false,
    boundary: "This repository check verifies compatibility projections only. It neither changes worker state machines nor proves external worker operation or production authorization."
  });
}

function main() {
  const report = inspectWorkerObservabilityGovernance();
  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    contractVersion: report.contractVersion,
    profileCount: report.profileCount,
    deployedEntrypointCount: report.deployedEntrypointCount,
    failedChecks: report.checks.filter((item) => !item.passed).map((item) => item.id),
    productionReady: false
  })}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  deployedWorkerEntrypoints,
  inspectWorkerObservabilityGovernance,
  regularTrackedSource
};
