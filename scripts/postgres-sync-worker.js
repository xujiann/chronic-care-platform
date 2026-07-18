#!/usr/bin/env node
const { runPostgresSyncWorker } = require("../postgres-runtime-sync");

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

async function runCli() {
  const flags = parseArgs();
  const result = await runPostgresSyncWorker({
    mode: process.env.POSTGRES_SYNC_MODE,
    sqliteFile: flags["sqlite-file"],
    limit: flags.limit,
    maxAttempts: flags["max-attempts"]
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, runCli };
