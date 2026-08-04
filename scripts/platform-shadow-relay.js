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
const {
  openSqliteShadowRelayOperations
} = require("../src/platform/operations/sqlite-shadow-relay-operations");

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...rest] = item.slice(2).split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function enabled(value) {
  return /^(?:1|true|yes|enabled)$/i.test(String(value || "").trim());
}

function timestamp(now) {
  return new Date(typeof now === "function" ? now() : Date.now()).toISOString();
}

function operationReceipt(input = {}) {
  const report = input.report || {};
  const checkpointSequence = Number(input.checkpoint?.sequence) || 0;
  return {
    operationId: input.operationId,
    relayId: input.relayId,
    domain: input.domain,
    operation: input.operation,
    outcome: input.outcome,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    fromSequence: input.operation === "relay"
      ? Number(report.fromSequence ?? checkpointSequence) || 0
      : 0,
    toSequence: input.operation === "reconcile"
      ? Number(report.source?.highWatermark) || 0
      : Number(report.toSequence) || checkpointSequence,
    checkpointSequence,
    relayed: Number(report.relayed) || 0,
    idempotentReplays: Array.isArray(report.outcomes)
      ? report.outcomes.filter((item) => item?.idempotentReplay === true).length
      : 0,
    source: report.source,
    target: report.target,
    faultPhase: input.error?.faultPhase,
    faultSequence: input.error?.faultSequence,
    errorCode: input.error?.code
  };
}

async function run(args = parseArgs(), options = {}) {
  const env = options.env || process.env;
  const domain = String(args.domain || "");
  let runtime = options.runtime || null;
  let checkpoint = null;
  let operations = null;
  try {
    const verifySchema = args["verify-schema"] === true;
    if (args["control-plane"] === true) {
      operations = options.operations || openSqliteShadowRelayOperations({
        file: env.PLATFORM_SHADOW_OPERATIONS_FILE,
        readOnly: true,
        DatabaseSync: options.DatabaseSync,
        now: options.now
      });
      const report = await operations.report({
        maximumAgeMinutes: env.PLATFORM_SHADOW_RECONCILIATION_MAX_AGE_MINUTES
      });
      return { report, exitCode: args["require-ready"] === true && !report.ok ? 2 : 0 };
    }
    runtime ||= createProductionAdapterRuntime({
      env,
      factories: options.factories,
      pools: options.pools,
      poolSecurityEvidence: options.poolSecurityEvidence
    });
    if (args.run === true || args.reconcile === true) {
      if (!enabled(env.PLATFORM_SHADOW_RELAY_ENABLED)) {
        throw Object.assign(new Error("platform shadow relay activation flag is closed"), {
          code: "PLATFORM_SHADOW_RELAY_DISABLED",
          statusCode: 409
        });
      }
      if (!["referral", "emergency"].includes(domain)) {
        throw Object.assign(new Error("domain must be referral or emergency"), {
          code: "PLATFORM_SHADOW_RELAY_DOMAIN_INVALID",
          statusCode: 400
        });
      }
      operations = options.operations || openSqliteShadowRelayOperations({
        file: env.PLATFORM_SHADOW_OPERATIONS_FILE,
        DatabaseSync: options.DatabaseSync,
        now: options.now
      });
      checkpoint = options.checkpoint || openSqliteCheckpointStore({
        file: env.PLATFORM_SHADOW_CHECKPOINT_FILE,
        DatabaseSync: options.DatabaseSync,
        now: options.now
      });
    }
    if (args.run === true) {
      let injected = false;
      const faultSequence = Number(args["fault-after-enqueue"]);
      const relayId = String(args["relay-id"] || `${domain}-postgres-shadow-v1`);
      const operationId = args["operation-id"];
      const startedAt = timestamp(options.now);
      try {
        const report = await runDomainShadowRelayOnce({
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
                  code: "PLATFORM_SHADOW_RELAY_FAULT_INJECTED",
                  faultPhase: phase,
                  faultSequence: event.sequence
                });
              }
            }
            : undefined
        });
        const current = await checkpoint.load(relayId);
        await operations.append(operationReceipt({
          operationId,
          relayId,
          domain,
          operation: "relay",
          outcome: "success",
          startedAt,
          completedAt: timestamp(options.now),
          checkpoint: current,
          report
        }));
        return { report, exitCode: 0 };
      } catch (error) {
        const current = await checkpoint.load(relayId);
        await operations.append(operationReceipt({
          operationId,
          relayId,
          domain,
          operation: "relay",
          outcome: error?.code === "PLATFORM_SHADOW_RELAY_FAULT_INJECTED"
            ? "fault-injected"
            : "failed",
          startedAt,
          completedAt: timestamp(options.now),
          checkpoint: current,
          error
        }));
        throw error;
      }
    }
    if (args.reconcile === true) {
      const relayId = String(args["relay-id"] || `${domain}-postgres-shadow-v1`);
      const operationId = args["operation-id"];
      const startedAt = timestamp(options.now);
      try {
        const report = await reconcileDomainShadowRelay({
          domain,
          runtime,
          readDatabase: options.readDatabase || require("../server").readDatabase,
          verifySchema
        });
        const current = await checkpoint.load(relayId);
        await operations.append(operationReceipt({
          operationId,
          relayId,
          domain,
          operation: "reconcile",
          outcome: report.ok ? "success" : "mismatch",
          startedAt,
          completedAt: timestamp(options.now),
          checkpoint: current,
          report
        }));
        return { report, exitCode: report.ok ? 0 : 2 };
      } catch (error) {
        const current = await checkpoint.load(relayId);
        await operations.append(operationReceipt({
          operationId,
          relayId,
          domain,
          operation: "reconcile",
          outcome: "failed",
          startedAt,
          completedAt: timestamp(options.now),
          checkpoint: current,
          error
        }));
        throw error;
      }
    }
    const report = await runtime.shadowRelayReadiness(domain, { verifySchema });
    return { report, exitCode: args["require-eligible"] === true && !report.eligible ? 2 : 0 };
  } finally {
    if (checkpoint && checkpoint !== options.checkpoint) await checkpoint.close();
    if (operations && operations !== options.operations) await operations.close();
    if (!options.runtime && runtime) await runtime.close();
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

module.exports = { enabled, operationReceipt, parseArgs, run, timestamp };
