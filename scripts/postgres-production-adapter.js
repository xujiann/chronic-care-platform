#!/usr/bin/env node
const {
  buildPostgresProductionAdapterConfig,
  verifyPostgresProductionAdapterSchema
} = require("../postgres-production-adapter");

function safeStatus(config) {
  return {
    ok: true,
    configured: config.configured,
    adapterMode: config.adapterMode,
    writeMode: config.writeMode,
    writeEnabled: config.writeEnabled,
    evidenceReady: config.evidenceReady,
    requirements: config.requirements,
    productionPrimary: false,
    runtimeCutoverEnabled: false,
    credentialsPersisted: false
  };
}

async function runCli(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0] || "status";
  const config = buildPostgresProductionAdapterConfig(env);
  if (command === "status") return safeStatus(config);
  if (command === "verify") {
    const verification = await verifyPostgresProductionAdapterSchema({ env, config });
    return { ...safeStatus(config), verification, ok: verification.ok };
  }
  throw new Error(`Unsupported PostgreSQL production adapter command=${command}`);
}

if (require.main === module) {
  runCli().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "POSTGRES_ADAPTER_COMMAND_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runCli, safeStatus };
