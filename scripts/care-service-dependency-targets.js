#!/usr/bin/env node
"use strict";

const Evidence = require("../care-service-dependency-evidence");

function buildDependencyTargetInventory(env = process.env) {
  const targets = Evidence.dependencyTargets(env);
  const dependencies = Evidence.REQUIRED_DEPENDENCIES.map((dependency) => ({
    dependency,
    configured: (targets[dependency] || []).some(Boolean),
    targetDigest: Evidence.targetDigestForDependency(env, dependency)
  }));
  return {
    schemaVersion: "care-service-dependency-target-inventory-v1",
    generatedAt: new Date().toISOString(),
    complete: dependencies.every((item) => item.configured),
    dependencies,
    boundary: "This inventory contains target digests only. It does not prove connectivity and cannot replace fresh independently archived probe receipts."
  };
}

function main() {
  const inventory = buildDependencyTargetInventory(process.env);
  console.log(JSON.stringify(inventory, null, 2));
  if (!inventory.complete) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  buildDependencyTargetInventory
};
