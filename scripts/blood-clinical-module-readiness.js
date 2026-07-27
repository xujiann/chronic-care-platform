#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  MODULE_ID,
  manifest,
  seedProductionEvidence,
  evaluateProductionReadiness,
  validateDependencyIsolation
} = require("../blood-clinical-production");

const root = path.resolve(__dirname, "..");
const moduleFiles = fs.readdirSync(root).filter((name) => /^blood.*\.js$/i.test(name));
const isolation = moduleFiles.map((file) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  return { file, ...validateDependencyIsolation(source) };
});
const statePath = process.argv.find((arg) => arg.startsWith("--evidence="))?.slice("--evidence=".length);
const state = statePath ? JSON.parse(fs.readFileSync(path.resolve(statePath), "utf8")) : seedProductionEvidence();
const readiness = evaluateProductionReadiness(state);
const report = {
  moduleId: MODULE_ID,
  generatedAt: new Date().toISOString(),
  manifest,
  independentDeployment: isolation.every((item) => item.valid),
  isolation,
  readiness,
  decision: readiness.productionReady && isolation.every((item) => item.valid) ? "GO" : "NO-GO"
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes("--require-go") && report.decision !== "GO") process.exitCode = 2;

module.exports = { buildReport: () => report };
