#!/usr/bin/env node
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { buildStaticPublication } = require("./static-publication");

const ROOT = path.resolve(__dirname, "..");

function outputArgument(argv = process.argv.slice(2)) {
  const prefix = "--output=";
  const argument = argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

function resolveStandardBuildOutput(argv = process.argv.slice(2)) {
  const explicit = outputArgument(argv);
  if (explicit) return path.resolve(explicit);
  return path.join(os.tmpdir(), `health-platform-static-build-${process.pid}-${randomUUID()}`);
}

function runStandardBuild(argv = process.argv.slice(2)) {
  const output = resolveStandardBuildOutput(argv);
  const result = buildStaticPublication({ output });
  return {
    ok: true,
    root: ROOT,
    output: result.output,
    manifest: result.manifest
  };
}

if (require.main === module) {
  try {
    const result = runStandardBuild();
    process.stdout.write(`${JSON.stringify({
      ok: result.ok,
      output: result.output,
      profile: result.manifest.profile,
      schemaVersion: result.manifest.schemaVersion,
      files: result.manifest.files.length
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`standard build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  outputArgument,
  resolveStandardBuildOutput,
  runStandardBuild
};
