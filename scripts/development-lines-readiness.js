#!/usr/bin/env node
"use strict";

const { buildDataMigrationControlCenter } = require("../src/platform/data/migration-control-center");
const { assessMigrationExecutionState } = require("../src/platform/data/migration-execution-runtime");
const { buildInstitutionPilotReadiness } = require("../src/platform/integration/institution-pilot-orchestrator");
const { buildInstitutionSandboxReadiness } = require("../src/platform/integration/institution-sandbox-joint-test");
const { buildProductOperationsReadiness } = require("./product-operations-readiness");

function project(report, fields) {
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, report[field]])));
}

function buildDevelopmentLinesReadiness(options = {}) {
  const now = options.now || new Date().toISOString();
  const dataMigration = options.dataMigration || buildDataMigrationControlCenter([], { now });
  const dataExecution = options.dataExecution || assessMigrationExecutionState({
    schemaVersion: "data-migration-execution-recovery-v1",
    batches: [],
    outboxEvents: []
  }, { now });
  const interfacePilot = options.interfacePilot || buildInstitutionPilotReadiness({}, { now });
  const institutionSandbox = options.institutionSandbox || buildInstitutionSandboxReadiness({}, { now });
  const productOperations = options.productOperations || buildProductOperationsReadiness({ now });

  const checks = Object.freeze([
    Object.freeze({
      id: "developmentLines:dataControlPlane",
      passed: dataMigration.ok === true && dataMigration.controlPlaneReady === true && dataMigration.productionReady === false,
      detail: `${dataMigration.summary?.collections || 0} governed collections`
    }),
    Object.freeze({
      id: "developmentLines:interfaceFailClosed",
      passed: interfacePilot.productionGate === "NO-GO" && interfacePilot.productionReady === false && interfacePilot.externalEvidenceVerified === false,
      detail: `${interfacePilot.summary?.localClosedLoops || 0} local closed loops`
    }),
    Object.freeze({
      id: "developmentLines:dataExecution",
      passed: dataExecution.ok === true && dataExecution.controlPlaneReady === true && dataExecution.productionReady === false,
      detail: `${dataExecution.summary?.batches || 0} recoverable migration batches`
    }),
    Object.freeze({
      id: "developmentLines:institutionSandboxFailClosed",
      passed: institutionSandbox.productionGate === "NO-GO" && institutionSandbox.productionReady === false && institutionSandbox.externalEvidenceVerified === false,
      detail: `${institutionSandbox.summary?.closedLoops || 0} sandbox closed loops`
    }),
    Object.freeze({
      id: "developmentLines:productOperations",
      passed: productOperations.ok === true && productOperations.productionReady === false,
      detail: `${productOperations.summary?.projectedWorkItems ?? productOperations.summary?.workItems ?? 0} work items projected`
    }),
    Object.freeze({
      id: "developmentLines:productionFailClosed",
      passed: [dataMigration, dataExecution, interfacePilot, institutionSandbox, productOperations].every((report) => report.productionReady === false),
      detail: "repository-local controls cannot authorize production"
    })
  ]);

  return Object.freeze({
    schemaVersion: "development-lines-readiness-v1",
    generatedAt: now,
    ok: checks.every((item) => item.passed),
    localReady: dataMigration.localGateReady === true && dataExecution.localGateReady === true && interfacePilot.ok === true && institutionSandbox.localTechnicalReady === true && productOperations.ok === true,
    productionGate: "NO-GO",
    productionReady: false,
    lines: Object.freeze({
      data: Object.freeze({
        ...project(dataMigration, ["schemaVersion", "ok", "controlPlaneReady", "localGateReady", "productionReady", "summary"]),
        execution: project(dataExecution, ["schemaVersion", "ok", "controlPlaneReady", "localGateReady", "productionReady", "summary"])
      }),
      interfacePilot: project(interfacePilot, ["schema", "ok", "productionGate", "productionReady", "summary", "blockers"]),
      institutionSandbox: project(institutionSandbox, ["schema", "ok", "localTechnicalReady", "productionGate", "productionReady", "summary", "blockers"]),
      productOperations: project(productOperations, ["schemaVersion", "ok", "status", "productionReady", "summary", "blockers"])
    }),
    checks,
    boundary: "The three lines provide local engineering evidence only; real migration, institution connectivity, site acceptance and production authorization remain external gates."
  });
}

function runCli() {
  const report = buildDevelopmentLinesReadiness();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildDevelopmentLinesReadiness, runCli };
