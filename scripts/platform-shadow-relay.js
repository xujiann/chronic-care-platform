#!/usr/bin/env node
"use strict";

const {
  createProductionAdapterRuntime
} = require("../src/platform/composition/production-adapter-runtime");
const {
  reconcileDomainShadowRelay,
  runDomainShadowRelayOnce
} = require("../src/platform/operations/domain-shadow-relay-runtime");
const {
  openSqliteCheckpointStore
} = require("../src/platform/operations/sqlite-shadow-relay-checkpoint");

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...rest] = item.slice(2).split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function enabled(value) {
  return /^(?:1|true|yes|enabled)$/i.test(String(value || "").trim());
}

async function run(args = parseArgs(), options = {}) {
  const env = options.env || process.env;
  const domain = String(args.domain || "");
  const runtime = options.runtime || createProductionAdapterRuntime({
    env,
    factories: options.factories,
    pools: options.pools,
    poolSecurityEvidence: options.poolSecurityEvidence
  });
  let checkpoint = null;
  try {
    const verifySchema = args["verify-schema"] === true;
    if (args.run === true || args.reconcile === true) {
      if (!enabled(env.PLATFORM_SHADOW_RELAY_ENABLED)) {
        throw Object.assign(new Error("platform shadow relay activation flag is closed"), {
          code: "PLATFORM_SHADOW_RELAY_DISABLED",
          statusCode: 409
        });
      }
    }
    if (args.run === true) {
      checkpoint = options.checkpoint || openSqliteCheckpointStore({
        file: env.PLATFORM_SHADOW_CHECKPOINT_FILE,
        DatabaseSync: options.DatabaseSync,
        now: options.now
      });
      let injected = false;
      const faultSequence = Number(args["fault-after-enqueue"]);
      return {
        report: await runDomainShadowRelayOnce({
          domain,
          runtime,
          readDatabase: options.readDatabase || require("../server").readDatabase,
          checkpoint,
          relayId: args["relay-id"],
          limit: args.limit,
          verifySchema,
          faultInjector: Number.isSafeInteger(faultSequence) && faultSequence > 0
            ? async (phase, event) => {
              if (!injected && phase === "after-enqueue" && event.sequence === faultSequence) {
                injected = true;
                throw Object.assign(new Error("configured shadow relay fault drill"), {
                  code: "PLATFORM_SHADOW_RELAY_FAULT_INJECTED"
                });
              }
            }
            : undefined
        }),
        exitCode: 0
      };
    }
    if (args.reconcile === true) {
      const report = await reconcileDomainShadowRelay({
        domain,
        runtime,
        readDatabase: options.readDatabase || require("../server").readDatabase,
        verifySchema
      });
      return { report, exitCode: report.ok ? 0 : 2 };
    }
    const report = await runtime.shadowRelayReadiness(domain, { verifySchema });
    return { report, exitCode: args["require-eligible"] === true && !report.eligible ? 2 : 0 };
  } finally {
    if (checkpoint && checkpoint !== options.checkpoint) await checkpoint.close();
    if (!options.runtime) await runtime.close();
  }
}

async function main() {
  try {
    const result = await run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "PLATFORM_SHADOW_RELAY_FAILED").slice(0, 120),
      message: String(error?.message || "platform shadow relay failed").slice(0, 300),
      payloadsExposed: false,
      productionReady: false
    })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { enabled, parseArgs, run };
