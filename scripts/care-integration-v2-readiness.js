#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildAdapterContractReadiness } = require("../src/care-coordination/institution-adapter-contract-sdk");
const { buildContinuousCareReadiness } = require("../src/care-coordination/continuous-care-closure");

function parseArgs(argv) {
  const result = { input: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") {
      result.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (argv[index] === "--help") {
      result.help = true;
      continue;
    }
    throw new TypeError(`unknown argument: ${argv[index]}`);
  }
  return result;
}

function buildCareIntegrationV2Readiness(state = {}, options = {}) {
  const adapters = buildAdapterContractReadiness(state, { now: options.now });
  const continuousCare = buildContinuousCareReadiness(state, { now: options.now });
  return Object.freeze({
    schema: "care-integration-v2-readiness-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: adapters.ok && continuousCare.ok,
    localTechnicalReady: adapters.localTechnicalReady && continuousCare.localTechnicalReady,
    sections: Object.freeze({ adapters, continuousCare }),
    productionGate: "NO-GO",
    productionReady: false,
    externalEvidenceVerified: false,
    boundary: "Metadata adapter contract results and continuous-care digest projections do not prove site connectivity, clinical acceptance, key custody or production authorization."
  });
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const write = dependencies.write || ((value) => process.stdout.write(value));
  if (args.help) {
    write("Usage: node scripts/care-integration-v2-readiness.js [--input <state.json>]\n");
    return null;
  }
  const readFile = dependencies.readFile || fs.readFileSync;
  const state = args.input ? JSON.parse(readFile(path.resolve(args.input), "utf8")) : {};
  const report = buildCareIntegrationV2Readiness(state, { now: dependencies.now });
  write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildCareIntegrationV2Readiness, main, parseArgs };
