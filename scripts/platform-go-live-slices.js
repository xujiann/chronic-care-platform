#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildReleaseReport } = require("./release-report");
const { buildReleaseArtifactManifest } = require("./release-artifact-manifest");
const { buildCapabilityMap } = require("../platform-capability-map");
const { buildPlatformGoLiveSlices, renderPlatformGoLiveSlicesMarkdown } = require("../platform-go-live-slices");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "platform-go-live-slices.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "platform-go-live-slices.md");

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

function buildPlatformGoLiveSlicesReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const releaseReport = options.releaseReport || buildReleaseReport({ data, env: process.env, profile: "demo" });
  const manifest = options.manifest || buildReleaseArtifactManifest({ releaseReport });
  const capabilityMap = options.capabilityMap || buildCapabilityMap({ data, manifest });
  return buildPlatformGoLiveSlices(data, capabilityMap);
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderPlatformGoLiveSlicesMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildPlatformGoLiveSlicesReport();
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
  buildPlatformGoLiveSlicesReport,
  parseArgs,
  renderPlatformGoLiveSlicesMarkdown,
  writeOutput
};
