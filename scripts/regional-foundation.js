#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildCompositeRegionalRelease, verifyCompositeRegionalRelease } = require("../src/platform/regional/composite-release");
const { loadRegionManifest } = require("../src/platform/regional/region-manifest");
const { loadRegionalRuntime } = require("../src/platform/regional/regional-runtime");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "status", ...items] = argv;
  const flags = {};
  for (const item of items) {
    if (!item.startsWith("--")) throw new TypeError(`unsupported argument: ${item}`);
    const [key, ...parts] = item.slice(2).split("=");
    flags[key] = parts.length > 0 ? parts.join("=") : true;
  }
  return { command, flags };
}

function regionStatus(regionCode, options = {}) {
  const runtime = loadRegionalRuntime({ root: options.root || ROOT, regionCode });
  const release = buildCompositeRegionalRelease({
    root: options.root || ROOT,
    regionCode,
    generatedAt: options.generatedAt
  });
  const verification = verifyCompositeRegionalRelease(release, { root: options.root || ROOT });
  return {
    regionCode: runtime.context.regionCode,
    regionName: runtime.context.regionName,
    deploymentClass: runtime.context.deploymentClass,
    manifestDigest: runtime.context.manifestDigest,
    contentDigest: runtime.context.contentDigest,
    activeExtensions: runtime.extensions.map((item) => ({
      id: item.id,
      kind: item.kind,
      version: item.version,
      ownedDomain: item.ownedDomain
    })),
    compositeRelease: release,
    verification,
    technicalReady: release.technicalReady && verification.ok,
    productionReady: false
  };
}

function regionalMatrix(options = {}) {
  const loaded = loadRegionManifest({ root: options.root || ROOT });
  const entries = loaded.registry.regions.filter((item) => item.enabled).map((item) => regionStatus(item.code, options));
  return {
    schemaVersion: "regional-foundation-matrix-v1",
    generatedAt: options.generatedAt || new Date().toISOString(),
    ok: entries.every((item) => item.technicalReady),
    productionReady: false,
    entries
  };
}

function resolveOutput(relativePath) {
  const releaseRoot = path.resolve(ROOT, "release", "regions");
  const output = path.resolve(releaseRoot, relativePath);
  if (output !== releaseRoot && !output.startsWith(`${releaseRoot}${path.sep}`)) {
    throw new TypeError("regional release output must remain under release/regions");
  }
  return output;
}

function writeJson(output, value) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertPackageEligible(status, options = {}) {
  if (status.deploymentClass === "test" && options.allowTestRegion !== true) {
    throw new TypeError(`test region ${status.regionCode} package requires --allow-test-region`);
  }
  return status;
}

function runCli(argv = process.argv.slice(2)) {
  const { command, flags } = parseArgs(argv);
  if (command === "status") {
    const status = regionStatus(flags.region);
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    if (!status.technicalReady || flags["require-production-ready"] === true) process.exitCode = 1;
    return status;
  }
  if (command === "matrix") {
    const matrix = regionalMatrix();
    process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
    if (!matrix.ok) process.exitCode = 1;
    return matrix;
  }
  if (command === "package") {
    if (!flags.region) throw new TypeError("regional package requires --region=<code>");
    const status = regionStatus(flags.region);
    assertPackageEligible(status, { allowTestRegion: flags["allow-test-region"] });
    const output = resolveOutput(String(flags.output || `${flags.region}/composite-release.json`));
    writeJson(output, status.compositeRelease);
    process.stdout.write(`${JSON.stringify({ output, ...status }, null, 2)}\n`);
    if (!status.technicalReady || flags["require-production-ready"] === true) process.exitCode = 1;
    return status;
  }
  throw new TypeError(`unsupported regional foundation command: ${command}`);
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
  assertPackageEligible,
  parseArgs,
  regionStatus,
  regionalMatrix,
  resolveOutput,
  runCli
};
