#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  applyTransitionPlan,
  buildReleaseBindingFromComposite,
  buildRollbackDecision,
  buildTransitionPlan,
  buildVersionDiff,
  getRelease,
  readRegistry,
  summarizeRegistry,
  verifyRegistry
} = require("../src/platform/regional/regional-release-governance");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REGISTRY = "config/regional-release-registry.json";
const COMMAND_FLAGS = Object.freeze({
  status: ["registry"],
  verify: ["registry"],
  register: [
    "registry", "composite", "platform-digest", "data-impact", "actor", "reason",
    "recorded-at", "snapshot-ref", "snapshot-digest", "snapshot-at", "snapshot-by", "write"
  ],
  transition: [
    "registry", "region", "release", "to", "actor", "reason", "recorded-at",
    "evidence-ref", "evidence-digest", "evidence-at", "evidence-by",
    "reviewer", "reviewed-at",
    "authorization-ref", "authorization-digest", "authorization-at", "authorization-by",
    "write"
  ],
  diff: ["registry", "region", "from", "to"],
  rollback: ["registry", "region", "release"]
});

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "status", ...items] = argv;
  if (!Object.prototype.hasOwnProperty.call(COMMAND_FLAGS, command)) {
    throw new TypeError(`unsupported regional release governance command: ${command}`);
  }
  const allowed = new Set(COMMAND_FLAGS[command]);
  const flags = {};
  for (const item of items) {
    if (!item.startsWith("--")) throw new TypeError(`unsupported argument: ${item}`);
    const [key, ...parts] = item.slice(2).split("=");
    if (!allowed.has(key)) {
      throw new TypeError(`unsupported ${command} flag: --${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      throw new TypeError(`duplicate ${command} flag: --${key}`);
    }
    if (key === "write") {
      if (parts.length) throw new TypeError("--write does not accept a value");
      flags[key] = true;
    } else {
      if (!parts.length || !parts.join("=").trim()) {
        throw new TypeError(`--${key} requires a value`);
      }
      flags[key] = parts.join("=");
    }
  }
  return { command, flags };
}

function controlledEvidence(flags, prefix) {
  const ref = flags[`${prefix}-ref`];
  const digest = flags[`${prefix}-digest`];
  const recordedAt = flags[`${prefix}-at`];
  const recordedBy = flags[`${prefix}-by`];
  if (![ref, digest, recordedAt, recordedBy].some(Boolean)) return null;
  return { ref, digest, recordedAt, recordedBy };
}

function loadJson(root, relativePath, label) {
  if (!relativePath) throw new TypeError(`${label} path is required`);
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError(`${label} path must remain inside the project root`);
  }
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function resolveRegistryPath(root, value) {
  const absolutePath = path.resolve(root, value || DEFAULT_REGISTRY);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("regional release registry must remain inside the project root");
  }
  return absolutePath;
}

function writeOutput(value, stdout = process.stdout) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runCli(argv = process.argv.slice(2), options = {}) {
  const root = path.resolve(options.root || ROOT);
  const { command, flags } = parseArgs(argv);
  const registryPath = resolveRegistryPath(root, flags.registry);
  const registry = readRegistry(registryPath);
  let result;

  if (command === "status") {
    result = summarizeRegistry(registry);
  } else if (command === "verify") {
    result = verifyRegistry(registry);
  } else if (command === "register") {
    const composite = loadJson(root, flags.composite, "regional composite release");
    const release = buildReleaseBindingFromComposite(composite, {
      root,
      platformDigest: flags["platform-digest"],
      dataImpact: flags["data-impact"] || "none",
      rollbackSnapshot: controlledEvidence(flags, "snapshot")
    });
    const plan = buildTransitionPlan(registry, {
      release,
      toState: "draft",
      actor: flags.actor,
      reason: flags.reason || "register immutable regional release",
      recordedAt: flags["recorded-at"]
    });
    result = flags.write ? applyTransitionPlan(registryPath, plan) : plan;
  } else if (command === "transition") {
    const release = getRelease(registry, String(flags.region || ""), String(flags.release || ""));
    if (!release) throw new TypeError("regional release is not registered");
    const plan = buildTransitionPlan(registry, {
      release,
      toState: flags.to,
      actor: flags.actor,
      reason: flags.reason,
      recordedAt: flags["recorded-at"],
      externalEvidence: controlledEvidence(flags, "evidence"),
      review: flags.reviewer || flags["reviewed-at"]
        ? { reviewerId: flags.reviewer, reviewedAt: flags["reviewed-at"] }
        : null,
      externalAuthorization: controlledEvidence(flags, "authorization")
    });
    result = flags.write ? applyTransitionPlan(registryPath, plan) : plan;
  } else if (command === "diff") {
    result = buildVersionDiff(registry, {
      regionCode: String(flags.region || ""),
      fromReleaseId: String(flags.from || ""),
      toReleaseId: String(flags.to || "")
    });
  } else if (command === "rollback") {
    result = buildRollbackDecision(registry, {
      regionCode: String(flags.region || ""),
      releaseId: String(flags.release || "")
    });
  }

  writeOutput(result, options.stdout);
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
  DEFAULT_REGISTRY,
  controlledEvidence,
  parseArgs,
  resolveRegistryPath,
  runCli
};
