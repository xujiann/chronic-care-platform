#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  applyEvidenceLifecycleTransitionPlan,
  buildEvidenceLifecycleTransitionPlan,
  createEmptyEvidenceLifecycleRegistry,
  readEvidenceLifecycleRegistry,
  summarizeEvidenceLifecycle,
  verifyEvidenceLifecycleRegistry
} = require("../src/platform/regional/regional-site-evidence-lifecycle");

const COMMAND_FLAGS = Object.freeze({
  status: Object.freeze(["registry", "region", "release", "composite-digest", "regional-content-digest", "evidence-digest"]),
  verify: Object.freeze(["registry"]),
  transition: Object.freeze([
    "registry",
    "action",
    "region",
    "release",
    "composite-digest",
    "regional-content-digest",
    "evidence-digest",
    "replacement-digest",
    "actor-digest",
    "reason-code",
    "recorded-at",
    "write"
  ])
});

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "status", ...items] = argv;
  if (!Object.hasOwn(COMMAND_FLAGS, command)) throw new TypeError(`unsupported regional evidence lifecycle command: ${command}`);
  const allowed = new Set(COMMAND_FLAGS[command]);
  const flags = {};
  for (const item of items) {
    if (!item.startsWith("--")) throw new TypeError(`unsupported argument: ${item}`);
    const [key, ...parts] = item.slice(2).split("=");
    if (!allowed.has(key)) throw new TypeError(`unsupported ${command} flag: --${key}`);
    if (Object.hasOwn(flags, key)) throw new TypeError(`duplicate ${command} flag: --${key}`);
    if (key === "write") {
      if (parts.length) throw new TypeError("--write does not accept a value");
      flags[key] = true;
    } else {
      const value = parts.join("=").trim();
      if (!value) throw new TypeError(`--${key} requires a value`);
      flags[key] = value;
    }
  }
  return { command, flags };
}

function resolveRegistryPath(value) {
  if (!value || !path.isAbsolute(value)) throw new TypeError("--registry must be an absolute path outside the application artifact");
  return path.resolve(value);
}

function readOrCreateRegistry(registryPath) {
  return fs.existsSync(registryPath)
    ? readEvidenceLifecycleRegistry(registryPath)
    : createEmptyEvidenceLifecycleRegistry();
}

function expectedFromFlags(flags) {
  return {
    regionCode: flags.region,
    releaseId: flags.release,
    compositeDigest: flags["composite-digest"],
    regionalContentDigest: flags["regional-content-digest"],
    evidenceSourceDigest: flags["evidence-digest"]
  };
}

function runCli(argv = process.argv.slice(2), options = {}) {
  const { command, flags } = parseArgs(argv);
  const registryPath = resolveRegistryPath(flags.registry);
  const registry = readOrCreateRegistry(registryPath);
  let result;
  if (command === "verify") {
    result = verifyEvidenceLifecycleRegistry(registry);
  } else if (command === "status") {
    const expectedFlags = ["region", "release", "composite-digest", "regional-content-digest", "evidence-digest"];
    const supplied = expectedFlags.filter((key) => flags[key]).length;
    if (supplied !== 0 && supplied !== expectedFlags.length) {
      throw new TypeError("status requires either all evidence binding flags or none");
    }
    result = supplied === 0
      ? verifyEvidenceLifecycleRegistry(registry)
      : summarizeEvidenceLifecycle(registry, expectedFromFlags(flags));
  } else {
    const plan = buildEvidenceLifecycleTransitionPlan(registry, {
      binding: expectedFromFlags(flags),
      evidenceSourceDigest: flags["evidence-digest"],
      replacementEvidenceSourceDigest: flags["replacement-digest"],
      action: flags.action,
      actorDigest: flags["actor-digest"],
      reasonCode: flags["reason-code"],
      recordedAt: flags["recorded-at"]
    });
    result = flags.write ? applyEvidenceLifecycleTransitionPlan(registryPath, plan) : plan;
  }
  (options.stdout || process.stdout).write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    const result = runCli();
    if (result?.ok === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  COMMAND_FLAGS,
  expectedFromFlags,
  parseArgs,
  readOrCreateRegistry,
  resolveRegistryPath,
  runCli
};
