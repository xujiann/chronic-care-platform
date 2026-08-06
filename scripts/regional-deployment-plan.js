#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildSiteDeploymentPlan,
  readSiteDeploymentDescriptor,
  renderSiteDeploymentMarkdown
} = require("../src/platform/regional/site-deployment-plan");
const { resolveWithin } = require("../src/platform/regional/region-manifest");

const ROOT = path.resolve(__dirname, "..");
const ALLOWED_FLAGS = new Set(["descriptor", "output", "write", "generated-at", "git-commit"]);

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((item) => {
    if (!item.startsWith("--")) throw new TypeError(`unsupported argument: ${item}`);
    const [key, ...parts] = item.slice(2).split("=");
    if (!ALLOWED_FLAGS.has(key)) throw new TypeError(`unsupported regional deployment flag: --${key}`);
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      throw new TypeError(`duplicate regional deployment flag: --${key}`);
    }
    if (key === "write" && parts.length) {
      throw new TypeError("regional deployment flag --write does not accept a value");
    }
    flags[key] = parts.length ? parts.join("=") : true;
  });
  if (!flags.descriptor) throw new TypeError("regional deployment plan requires --descriptor=<path>");
  return flags;
}

function resolveDescriptor(root, value) {
  return resolveWithin(root, String(value), "site deployment descriptor");
}

function resolveOutput(root, value, deploymentId) {
  const releaseRoot = path.resolve(root, "release", "deployments");
  const relative = String(value || deploymentId);
  return resolveWithin(releaseRoot, relative, "regional deployment output");
}

function writePlanArtifacts(plan, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "deployment-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(outputDirectory, "deployment-plan.md"),
    renderSiteDeploymentMarkdown(plan),
    "utf8"
  );
  plan.sites.forEach((site) => {
    Object.values(site.artifacts).forEach((artifact) => {
      const output = resolveWithin(outputDirectory, artifact.path, "regional deployment artifact");
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, artifact.content, "utf8");
    });
  });
}

function runCli(argv = process.argv.slice(2), options = {}) {
  const flags = parseArgs(argv);
  const root = path.resolve(options.root || ROOT);
  const descriptor = readSiteDeploymentDescriptor(resolveDescriptor(root, flags.descriptor));
  const plan = buildSiteDeploymentPlan(descriptor, {
    root,
    generatedAt: flags["generated-at"] || options.generatedAt,
    gitCommit: flags["git-commit"] || options.gitCommit
  });
  let output = null;
  if (flags.write === true) {
    output = resolveOutput(root, flags.output, plan.deploymentId);
    writePlanArtifacts(plan, output);
  }
  const result = { output, plan };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.stdout) options.stdout.write(serialized);
  else process.stdout.write(serialized);
  return result;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_FLAGS,
  parseArgs,
  resolveDescriptor,
  resolveOutput,
  runCli,
  writePlanArtifacts
};
