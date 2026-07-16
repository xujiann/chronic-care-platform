#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildCapabilityMap, renderCapabilityMapMarkdown } = require("../platform-capability-map");
const { buildReleaseArtifactManifest } = require("./release-artifact-manifest");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "platform-capability-map.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "platform-capability-map.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function buildPlatformCapabilityMapReport(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const data = options.data || readJson("data/db.json");
  const manifest = options.manifest || buildReleaseArtifactManifest({
    pkg,
    releaseReport: options.releaseReport || { summary: { total: 0 }, checks: [] }
  });
  return buildCapabilityMap({ root: ROOT, pkg, data, manifest });
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderCapabilityMapMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildPlatformCapabilityMapReport();
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildPlatformCapabilityMapReport,
  parseArgs,
  writeOutput
};
