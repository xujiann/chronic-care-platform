#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { collectPublicAssets, loadStaticPublicationContract } = require("../src/http/static-asset-policy");
const { loadBrowserSecurityPolicy } = require("../src/http/browser-security-policy");
const {
  riskBaselineFromInventory,
  scanBrowserSecurityInventory,
  verifyBrowserSecurityInventory
} = require("../src/http/browser-security-inventory");

const ROOT = path.resolve(__dirname, "..");

function browserSecurityInventory() {
  const contract = loadStaticPublicationContract();
  const assets = collectPublicAssets(ROOT, contract);
  return scanBrowserSecurityInventory({ root: ROOT, assets });
}

function run(command = "verify") {
  const policy = loadBrowserSecurityPolicy();
  const inventory = browserSecurityInventory();
  if (command === "inventory") return inventory;
  if (command === "baseline") return riskBaselineFromInventory(inventory, policy.riskBaseline.sourceRevision);
  if (command !== "verify") throw new Error(`Unknown browser security inventory command: ${command}`);
  const verification = verifyBrowserSecurityInventory(inventory, policy.riskBaseline);
  return {
    ...verification,
    contractId: policy.contractId,
    cspMode: policy.csp.mode,
    productionReady: false,
    blockers: policy.blockers,
    summary: inventory.summary
  };
}

if (require.main === module) {
  try {
    const result = run(process.argv[2] || "verify");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.ok === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`browser security inventory failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { browserSecurityInventory, run };
