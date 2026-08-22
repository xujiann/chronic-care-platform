#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  assertSyncMode,
  enqueuePostgresSyncBaseline,
  runPostgresShadowReconciliation
} = require("../postgres-runtime-sync");
const { attachWorkerObservability } = require("../src/platform/operations/worker-observability-contract");

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "reconcile", ...rawFlags] = argv;
  const flags = {};
  rawFlags.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return { command, flags };
}

function renderMarkdown(report) {
  const rows = (report.differences || []).map((item) =>
    `| ${item.collection} | ${item.types.join(", ")} | ${item.localVersion ?? "-"} | ${item.remoteVersion ?? "-"} |`
  );
  return [
    "# PostgreSQL shadow reconciliation",
    "",
    `- Checked at: ${report.checkedAt}`,
    `- Run ID: ${report.runId}`,
    `- Status: ${report.status}`,
    `- Production primary: no`,
    `- Local / remote collections: ${report.summary.localCollections} / ${report.summary.remoteCollections}`,
    `- Matched / mismatched: ${report.summary.matched} / ${report.summary.mismatched}`,
    `- Duration: ${report.durationMs} ms`,
    "",
    "| Collection | Difference | Local version | Remote version |",
    "|---|---|---:|---:|",
    ...(rows.length ? rows : ["| - | none | - | - |"]),
    "",
    "This report contains collection names, versions and digests only. It contains no business payloads or database credentials.",
    ""
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  if (flags.output) {
    const output = path.resolve(String(flags.output));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  }
  if (flags.markdown) {
    const markdown = path.resolve(String(flags.markdown));
    fs.mkdirSync(path.dirname(markdown), { recursive: true });
    fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  }
}

async function runCli() {
  const { command, flags } = parseArgs();
  const mode = assertSyncMode(process.env.POSTGRES_SYNC_MODE);
  if (mode !== "outbox") throw new Error("POSTGRES_SYNC_MODE=outbox is required");
  if (command === "bootstrap") {
    const result = enqueuePostgresSyncBaseline(flags["sqlite-file"], { force: flags.force === true });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (command !== "reconcile") throw new Error(`Unsupported PostgreSQL shadow command=${command}`);
  const sourceReport = await runPostgresShadowReconciliation({ mode, sqliteFile: flags["sqlite-file"] });
  const report = attachWorkerObservability("postgres-shadow-reconciliation", sourceReport, {
    observedAt: sourceReport.checkedAt || new Date().toISOString()
  });
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, renderMarkdown, runCli, writeOutput };
