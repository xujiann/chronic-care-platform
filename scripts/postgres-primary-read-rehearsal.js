#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { runPostgresPrimaryReadRehearsal } = require("../postgres-runtime-sync");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "postgres-primary-read-rehearsal.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "postgres-primary-read-rehearsal.md");

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "rehearse", ...items] = argv;
  const flags = {};
  items.forEach((item) => {
    if (!item.startsWith("--")) throw new Error(`Unsupported argument: ${item}`);
    const [key, ...parts] = item.slice(2).split("=");
    flags[key] = parts.length ? parts.join("=") : true;
  });
  return { command, flags };
}

function renderMarkdown(report) {
  return [
    "# PostgreSQL primary read rehearsal",
    "",
    `- Run: ${report.runId}`,
    `- Checked at: ${report.checkedAt}`,
    `- Status: ${report.status}`,
    `- Transaction: ${report.transaction}`,
    `- Collections: ${report.collections}`,
    `- Baseline matches: ${report.matchedBaselineCollections}`,
    `- Payload bytes verified in memory: ${report.payloadBytes}`,
    `- Snapshot SHA-256: ${report.snapshotSha256}`,
    `- Production primary: ${report.productionPrimary ? "yes" : "no"}`,
    `- Runtime cutover enabled: ${report.runtimeCutoverEnabled ? "yes" : "no"}`,
    "",
    "The report contains no business payloads or database credentials. A verified rehearsal proves that the remote shadow can rebuild a complete digest-checked snapshot; it does not enable PostgreSQL writes, production cutover, or site acceptance.",
    ""
  ].join("\n");
}

function resolveOutput(value, fallback) {
  return path.resolve(String(value || fallback));
}

async function runCli(argv = process.argv.slice(2), env = process.env) {
  const { command, flags } = parseArgs(argv);
  if (command !== "rehearse") throw new Error(`Unsupported PostgreSQL primary read command=${command}`);
  const result = await runPostgresPrimaryReadRehearsal({
    mode: env.POSTGRES_PRIMARY_READ_MODE,
    syncMode: env.POSTGRES_SYNC_MODE,
    env,
    sqliteFile: flags["sqlite-file"],
    maxCollections: flags["max-collections"],
    maxBytes: flags["max-bytes"],
    requiredCollections: String(flags["required-collections"] || "").split(",").map((item) => item.trim()).filter(Boolean)
  });
  const output = resolveOutput(flags.output, DEFAULT_OUTPUT);
  const markdown = resolveOutput(flags.markdown, DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, renderMarkdown(result.report), "utf8");
  return { report: result.report, output, markdown };
}

if (require.main === module) {
  runCli().then(({ report, output, markdown }) => {
    process.stdout.write(`${JSON.stringify({ ok: report.ok, runId: report.runId, status: report.status, collections: report.collections, output, markdown })}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "POSTGRES_PRIMARY_READ_REHEARSAL_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_MARKDOWN, DEFAULT_OUTPUT, parseArgs, renderMarkdown, runCli };
