#!/usr/bin/env node
"use strict";

const {
  appendAuthorizationEvent,
  evaluatePilotCutoverAuthorizationLedger,
  loadLedgerCommandInput
} = require("../src/platform/cutover/pilot-cutover-authorization-ledger");
const {
  evaluatePilotCutoverControlHealth
} = require("../src/platform/cutover/pilot-cutover-observability");
const {
  buildPilotCutoverCommandPlan
} = require("../src/platform/cutover/pilot-cutover-command-plan");

const COMMAND_TYPES = Object.freeze({
  "register-evidence": "evidence-registered",
  "record-approval": "approval-recorded",
  "record-rehearsal": "rehearsal-recorded",
  revoke: "evidence-revoked"
});

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "", ...rest] = argv;
  return {
    command,
    options: Object.fromEntries(rest.filter((item) => item.startsWith("--")).map((item) => {
      const [key, ...value] = item.slice(2).split("=");
      return [key, value.length ? value.join("=") : true];
    }))
  };
}

function run(parsed = parseArgs(), runtime = {}) {
  if (Object.hasOwn(COMMAND_TYPES, parsed.command)) {
    const input = loadLedgerCommandInput(parsed.options.input);
    const expectedSchema = `pilot-cutover-${parsed.command}-v1`;
    if (input?.schemaVersion !== expectedSchema
      || !input.payload || typeof input.payload !== "object") {
      throw Object.assign(new Error(`input schema must be ${expectedSchema}`), {
        code: "PILOT_CUTOVER_AUTHORIZATION_INPUT_INVALID"
      });
    }
    const event = appendAuthorizationEvent({
      file: parsed.options.ledger,
      type: COMMAND_TYPES[parsed.command],
      actorAccount: input.actorAccount,
      recordedAt: input.recordedAt || runtime.now,
      eventId: input.eventId,
      payload: input.payload
    });
    return {
      report: {
        schema: "pilot-cutover-authorization-append-v1",
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type,
        eventDigest: event.eventDigest,
        cutoverExecutionAuthorized: false,
        productionReady: false
      },
      exitCode: 0
    };
  }
  if (parsed.command === "status") {
    const report = evaluatePilotCutoverAuthorizationLedger({
      packageFile: parsed.options.package,
      ledgerFile: parsed.options.ledger,
      trustRegistryFile: parsed.options["trust-registry"],
      rehearsalMaximumAgeHours: parsed.options["rehearsal-max-age-hours"],
      now: parsed.options.now || runtime.now
    });
    return {
      report,
      exitCode: parsed.options["require-go-candidate"] === true
        && report.decision !== "GO-CANDIDATE"
        ? 2
        : 0
    };
  }
  if (parsed.command === "health") {
    const report = evaluatePilotCutoverControlHealth({
      packageFile: parsed.options.package,
      ledgerFile: parsed.options.ledger,
      trustRegistryFile: parsed.options["trust-registry"],
      rehearsalMaximumAgeHours: parsed.options["rehearsal-max-age-hours"],
      warningHours: parsed.options["warning-hours"],
      now: parsed.options.now || runtime.now
    });
    return {
      report,
      exitCode: parsed.options["require-healthy"] === true && report.status !== "healthy" ? 2 : 0
    };
  }
  if (parsed.command === "plan") {
    return {
      report: buildPilotCutoverCommandPlan({
        releaseId: parsed.options["release-id"],
        packageFingerprint: parsed.options["package-fingerprint"]
      }),
      exitCode: 0
    };
  }
  throw Object.assign(
    new Error("command must be register-evidence, record-approval, record-rehearsal, revoke, status, health or plan"),
    { code: "PILOT_CUTOVER_AUTHORIZATION_COMMAND_INVALID" }
  );
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: String(error?.code || "PILOT_CUTOVER_AUTHORIZATION_FAILED").slice(0, 120),
      message: String(error?.message || "pilot cutover authorization failed").slice(0, 300),
      cutoverExecutionAuthorized: false,
      productionPrimary: false,
      productionReady: false
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { COMMAND_TYPES, parseArgs, run };
