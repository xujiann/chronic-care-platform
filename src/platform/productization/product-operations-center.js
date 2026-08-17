"use strict";

const path = require("node:path");
const defaultProgram = require("../../../config/product-operations-program.json");
const { buildPlatformNonfunctionalReadiness, fileMetrics } = require("../governance/platform-nonfunctional-readiness");
const { buildPlatformWorkItemCenter } = require("./work-item-center");
const { buildProductOperationsViewModel } = require("./product-operations-view-model");

function validateProgram(program = defaultProgram) {
  if (program?.schemaVersion !== "product-operations-program-v1") throw new TypeError("product operations program is invalid");
  if (!Array.isArray(program.requiredSections) || program.requiredSections.length !== 5) throw new TypeError("product operations program requires five sections");
  if (new Set(program.requiredSections).size !== program.requiredSections.length) throw new TypeError("product operations section ids must be unique");
  if (!Number.isInteger(program.minimumProjectedWorkItems) || program.minimumProjectedWorkItems < 0) throw new TypeError("minimumProjectedWorkItems must be a non-negative integer");
  if (!Number.isInteger(program.maximumVisibleWorkItems) || program.maximumVisibleWorkItems < 1 || program.maximumVisibleWorkItems > 50) throw new TypeError("maximumVisibleWorkItems must be between 1 and 50");
  if (!program.frontendAsset || !/^[A-Za-z0-9._/-]+$/.test(String(program.frontendAsset.file || ""))) throw new TypeError("frontendAsset.file must be a safe relative path");
  if (!Number.isInteger(program.frontendAsset.maximumBytes) || program.frontendAsset.maximumBytes < 1) throw new TypeError("frontendAsset.maximumBytes must be a positive integer");
  if (!Number.isInteger(program.frontendAsset.maximumLines) || program.frontendAsset.maximumLines < 1) throw new TypeError("frontendAsset.maximumLines must be a positive integer");
  if (!Number.isInteger(program.minimumReplicationSites) || program.minimumReplicationSites < 1) throw new TypeError("minimumReplicationSites must be a positive integer");
  if (!Array.isArray(program.requiredMonitoringChecks) || program.requiredMonitoringChecks.length === 0) throw new TypeError("requiredMonitoringChecks must be a non-empty array");
  if (!Array.isArray(program.externalBlockers) || program.externalBlockers.length === 0) throw new TypeError("externalBlockers must be a non-empty array");
  return true;
}

function safeIdentifier(value, maximum = 96) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9._:/-]+$/.test(text) ? text.slice(0, maximum) : "invalid";
}

function summarizeMonitoring(report, requiredChecks) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const indexed = new Map(checks.map((check) => [String(check?.id || ""), Boolean(check?.passed)]));
  const required = requiredChecks.map((id) => Object.freeze({ id, passed: indexed.get(id) === true }));
  return Object.freeze({
    schemaVersion: "product-operations-monitoring-summary-v1",
    ok: report?.ok === true && required.every((check) => check.passed),
    status: safeIdentifier(report?.status || "missing", 80),
    productionReady: false,
    summary: Object.freeze({
      routes: Number(report?.summary?.routes) || 0,
      controls: Number(report?.summary?.controls) || 0,
      blockers: Number(report?.summary?.blockers) || required.filter((check) => !check.passed).length
    }),
    requiredChecks: Object.freeze(required),
    boundary: "No probe body, endpoint, credential, raw alert payload or delivery receipt is exposed."
  });
}

function summarizeReplication(report, minimumSites) {
  const sites = (Array.isArray(report?.sites) ? report.sites : []).map((site) => Object.freeze({
    siteId: safeIdentifier(site?.siteId, 64),
    regionCode: safeIdentifier(site?.regionCode, 16),
    stage: safeIdentifier(site?.stage, 24),
    deploymentClass: safeIdentifier(site?.deploymentClass, 24),
    productionReady: false
  }));
  const localReady = report?.ok === true
    && report?.technicalReady === true
    && sites.length >= minimumSites
    && sites.every((site) => site.siteId !== "invalid" && site.regionCode !== "invalid");
  return Object.freeze({
    schemaVersion: "product-operations-replication-summary-v1",
    ok: localReady,
    technicalReady: localReady,
    productionReady: false,
    summary: Object.freeze({ sites: sites.length, validationSites: sites.filter((site) => site.stage === "validation").length }),
    sites: Object.freeze(sites),
    boundary: "Host names, ports, paths, identities, storage resources and runtime secrets are excluded from the cockpit."
  });
}

function buildProductOperationsCenter(data, options = {}) {
  const program = options.program || defaultProgram;
  validateProgram(program);
  const root = path.resolve(options.root || path.join(__dirname, "..", "..", ".."));
  const workItems = buildPlatformWorkItemCenter(data || {}, { now: options.now });
  const nonfunctional = options.nonfunctional || buildPlatformNonfunctionalReadiness({ root, now: options.now });
  const monitoring = summarizeMonitoring(options.monitoring, program.requiredMonitoringChecks);
  const replication = summarizeReplication(options.replication, program.minimumReplicationSites);
  const assetMetrics = fileMetrics(root, program.frontendAsset.file);
  const asset = Object.freeze({
    ...assetMetrics,
    maximumBytes: program.frontendAsset.maximumBytes,
    maximumLines: program.frontendAsset.maximumLines,
    withinBudget: assetMetrics.present
      && assetMetrics.bytes <= program.frontendAsset.maximumBytes
      && assetMetrics.lines <= program.frontendAsset.maximumLines
  });
  const viewModel = buildProductOperationsViewModel(
    { workItems, monitoring, nonfunctional, replication },
    { maximumVisibleWorkItems: program.maximumVisibleWorkItems }
  );
  const frontend = Object.freeze({ ...viewModel, asset });
  const checks = Object.freeze([
    Object.freeze({ id: "operations:workItems", passed: workItems.ok && workItems.summary.total >= program.minimumProjectedWorkItems, detail: `${workItems.summary.total} metadata projections` }),
    Object.freeze({ id: "operations:frontend", passed: frontend.status === "local-control-ready" && frontend.asset.withinBudget, detail: `${frontend.sections.filter((item) => item.state === "ready").length}/${frontend.sections.length} sections; ${frontend.asset.bytes}/${frontend.asset.maximumBytes} bytes` }),
    Object.freeze({ id: "operations:monitoring", passed: monitoring.ok, detail: `${monitoring.requiredChecks.filter((item) => item.passed).length}/${monitoring.requiredChecks.length} required checks` }),
    Object.freeze({ id: "operations:nonfunctional", passed: nonfunctional.ok === true, detail: `${nonfunctional.summary?.assetsWithinBudget || 0}/${nonfunctional.summary?.assets || 0} frontend budgets` }),
    Object.freeze({ id: "operations:regionalReplication", passed: replication.ok, detail: `${replication.summary.sites} isolated sites` }),
    Object.freeze({ id: "operations:productionFailClosed", passed: workItems.productionReady === false && monitoring.productionReady === false && nonfunctional.productionReady === false && replication.productionReady === false && frontend.productionReady === false, detail: "NO-GO until independent external evidence and authorization" })
  ]);
  return Object.freeze({
    schemaVersion: "product-operations-center-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((check) => check.passed),
    localControlReady: checks.every((check) => check.passed),
    siteReady: false,
    productionReady: false,
    containsBusinessPayload: false,
    containsCredentials: false,
    summary: Object.freeze({
      projectedWorkItems: workItems.summary.total,
      openWorkItems: workItems.summary.open,
      monitoringControls: monitoring.summary.controls,
      frontendAssetsWithinBudget: nonfunctional.summary?.assetsWithinBudget || 0,
      operationsUiWithinBudget: frontend.asset.withinBudget,
      regionalSites: replication.summary.sites
    }),
    workItems,
    frontend,
    monitoring,
    nonfunctional,
    replication,
    checks,
    blockers: Object.freeze([...program.externalBlockers]),
    boundary: "Repository-local operational controls can be ready while site acceptance and production activation remain fail-closed."
  });
}

module.exports = {
  buildProductOperationsCenter,
  summarizeMonitoring,
  summarizeReplication,
  validateProgram
};
